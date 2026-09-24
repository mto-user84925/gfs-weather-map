#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
ifs_open_data.py — Pipeline ECMWF IFS 0.25° (modèle physique haute précision, open data)
=======================================================================================
  - Source : https://data.ecmwf.int/forecasts/{date}/{hh}z/ifs/0p25/oper/
    fichiers GRIB2 par échéance : {run}-{lead}h-oper-fc.grib2 (téléchargement direct).
  - Runs : 00Z / 06Z / 12Z / 18Z.
  - Échéances :
      * Runs 00Z/12Z : H+00 → H+360 (15 jours) : pas 3 h (0-144h) puis 6 h (150-360h).
      * Runs 06Z/18Z : H+00 → H+144 (6 jours) : pas 3 h (0-144h).
  - Domaines : Europe (Lambert) + France (Mercator) + Domaines Mondiaux.
  - Couches : Z500, T850, pression, températures, vent, rafales (10fg natives),
    nuages, humidité, MUCAPE, pluie, neige au sol…
"""
import os
import re
import sys
import time
import datetime
import tempfile

import requests
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))

from domains import (  # noqa: E402
    EUROPE, FRANCE, ANTILLES, ETATS_UNIS,
    PACIFIQUE_EST, PACIFIQUE_OUEST, PACIFIQUE_SUD,
    OCEAN_INDIEN, OCEAN_INDIEN_NORD,
)
from render import (  # noqa: E402
    save_webp, write_hkv, write_places, write_manifest,
    render_z500_with_isobars, render_pression_with_isobars,
    render_temperature850_with_isotherms, ensure_dir,
    dew_point_c, heat_index_c, wind_chill_c, humidex_c,
)

HEADERS = {"User-Agent": "gfs-weather-map/2.0 (Monsieur Meteo)"}
BASE_URL = "https://data.ecmwf.int/forecasts"
MAX_LEAD = 360

# Alias shortName IFS (eccodes) → clés canoniques
ALIASES = {
    "2t": "T2M",
    "2d": "DPT",
    "10u": "U10",
    "10v": "V10",
    "10fg": "GUST",
    "10fg3": "GUST",
    "10fg6": "GUST",
    "fg10": "GUST",
    "tp": "APCP",          # précipitation totale cumulée (kg/m² = mm)
    "cp": "APCP_CONV",     # précipitation convective
    "sf": "SNOWFALL",      # chutes de neige cumulées
    "msl": "PRMSL",
    "sp": "PRES",
    "tcc": "TCDC",
    "lcc": "LCC",
    "mcc": "MCC",
    "hcc": "HCC",
    "cape": "CAPE", "mucape": "MUCAPE",
    "sd": "SNOD",
    "t": "T",              # température à niveaux isobariques (T850 sélectionné)
    "z": "Z",              # géopotentiel m²/s² (Z500 sélectionné)
    "gh": "GH",            # géopotentiel hauteur gpm (GH500 sélectionné)
    "mn2t3": "T2MIN",
    "mn2t6": "T2MIN",
    "mx2t3": "T2MAX",
    "mx2t6": "T2MAX",
}

LEVEL_TARGETS = {"T": 850, "Z": 500, "GH": 500}


def log(msg):
    print("[IFS] " + msg, flush=True)


RUN_MATURITY = 6 * 3600 + 45 * 60  # 6h45 après l'heure du run (ECMWF Open Data)


def latest_run(now=None):
    # ponytail: Détection déterministe avec maturité opérationnelle ECMWF (6h45).
    # Évite les blocages 429 (rate limit data.ecmwf.int) sur requests.head()
    # qui provoquaient une régression vers des runs obsolètes (ex. 06Z hier).
    now = now or datetime.datetime.now(datetime.timezone.utc)
    for day_offset in [0, 1]:
        d = now - datetime.timedelta(days=day_offset)
        for rh in [18, 12, 6, 0]:
            candidate = d.replace(hour=rh, minute=0, second=0, microsecond=0)
            if candidate > now:
                continue
            # Passé 6h45, le run est garanti disponible sur data.ecmwf.int
            if (now - candidate).total_seconds() >= RUN_MATURITY:
                return candidate
            # Entre 6h00 et 6h45, tester si les premiers GRIBs sont déjà déposés
            if (now - candidate).total_seconds() >= 6 * 3600:
                ymd = candidate.strftime("%Y%m%d")
                ts = candidate.strftime("%Y%m%d%H%M%S")
                test_url = (f"{BASE_URL}/{ymd}/{candidate.hour:02d}z/ifs/0p25/oper/"
                            f"{ts}-0h-oper-fc.grib2")
                try:
                    r = requests.head(test_url, headers=HEADERS, timeout=4)
                    if r.status_code in (200, 429):
                        return candidate
                except Exception:
                    pass
    return (now - datetime.timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0)


def compute_leads(max_hours=MAX_LEAD, run_hour=0):
    max_limit = 144 if run_hour in (6, 18) else MAX_LEAD
    max_h = max(3, min(int(max_hours), max_limit))
    leads = list(range(0, min(max_h, 144) + 1, 3))
    if max_h > 144:
        leads.extend(range(150, max_h + 1, 6))
    return sorted(set(leads))


def _file_url(run_dt, lead):
    return ("%s/%s/%02dz/ifs/0p25/oper/%s-%dh-oper-fc.grib2"
            % (BASE_URL, run_dt.strftime("%Y%m%d"), run_dt.hour,
               run_dt.strftime("%Y%m%d%H%M%S"), lead))


def _fetch(url, retries=6):
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=120, verify=True)
            if r.status_code == 200 and len(r.content) > 500:
                return r.content
            if r.status_code == 404:
                raise RuntimeError("404 introuvable: %s" % url)
            if r.status_code == 429:
                wait_sec = int(r.headers.get("Retry-After", 10 * attempt))
                log("  Rate limit 429 reçu de data.ecmwf.int, attente %ds (essai %d/%d)..."
                    % (wait_sec, attempt, retries))
                time.sleep(wait_sec)
                continue
            last = "HTTP %s" % r.status_code
        except Exception as e:
            last = "%s" % e
        time.sleep(3 * attempt)
    raise RuntimeError("Téléchargement %s impossible (%s)" % (url, last))


def decode_file(path, lead):
    """Décode un GRIB IFS (1 échéance) → {KEY: (values 2D, lat, lon)}."""
    from eccodes import (codes_grib_new_from_file, codes_get,
                         codes_get_array, codes_release)
    out = {}
    with open(path, "rb") as f:
        while True:
            gid = codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                short = codes_get(gid, "shortName").lower()
                key = ALIASES.get(short)
                if key is None:
                    continue
                ni = int(codes_get(gid, "Ni"))
                nj = int(codes_get(gid, "Nj"))
                vals = np.asarray(codes_get_array(gid, "values"),
                                  dtype=np.float32)
                lat2 = np.asarray(codes_get_array(gid, "latitudes"),
                                  dtype=np.float64).reshape(nj, ni)
                lon2 = np.asarray(codes_get_array(gid, "longitudes"),
                                  dtype=np.float64).reshape(nj, ni)
                lat = lat2[:, 0]
                lon = lon2[0, :]

                # Champs multi-niveaux (T, Z, GH) : garder le niveau cible
                if key in LEVEL_TARGETS:
                    lev = int(codes_get(gid, "level"))
                    if lev != LEVEL_TARGETS[key]:
                        continue
                    if key == "T":
                        out["T850"] = (vals.reshape(nj, ni), lat, lon)
                    elif key == "Z":
                        out["HGT"] = (vals.reshape(nj, ni), lat, lon)
                    elif key == "GH":
                        out["GH500"] = (vals.reshape(nj, ni), lat, lon)
                    continue

                if vals.size == ni * nj:
                    arr = vals.reshape(nj, ni)
                else:
                    continue
                out[key] = (arr, lat, lon)
            except Exception:
                pass
            finally:
                codes_release(gid)
    return out


def collect_lead(run_dt, lead):
    url = _file_url(run_dt, lead)
    data = _fetch(url)
    tmp = os.path.join(tempfile.gettempdir(), f"ifs_tmp_{lead}.grib2")
    with open(tmp, "wb") as f:
        f.write(data)
    try:
        return decode_file(tmp, lead)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass


def render_lead_par(fields, lead, run_dt, domain, out_dir):
    """Rend les couches d'une échéance IFS."""
    step = {"lead_hour": lead,
            "valid_time": (run_dt + datetime.timedelta(hours=lead)).isoformat(),
            "files": {},
            "probes": {}}

    def regrid(field, convert=None):
        if field is None:
            return None
        val, lat, lon = field
        if convert is not None:
            val = convert(val)
        return domain.regrid(val, lat, lon)

    def save(name, data):
        dst = os.path.join(out_dir, name, "%03d.webp" % lead)
        save_webp(data, name, dst)
        step["files"][name] = "maps/%s/%03d.webp" % (name, lead)
        write_hkv(data, os.path.join(out_dir, "values", name,
                                     "%03d.hkv.gz" % lead))
        step["probes"][name] = "maps/values/%s/%03d.hkv.gz" % (name, lead)

    gust_g = None
    apcp_g = None
    hgt = fields.get("HGT")
    gh500 = fields.get("GH500")
    prmsl = fields.get("PRMSL")

    if (hgt is not None or gh500 is not None) and prmsl is not None:
        p_hpa = regrid(prmsl, lambda v: v / 100.0)
        z = None
        if gh500 is not None:
            # Geopotential height gpm -> dam (5520 gpm = 552 dam)
            z = regrid(gh500, lambda v: v / 10.0)
        elif hgt is not None:
            z_raw = regrid(hgt)
            if z_raw is not None:
                z = z_raw / 98.0665  # m²/s² → dam

        if z is not None and p_hpa is not None:
            dst = os.path.join(out_dir, "geopotentiel_500", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst, style="synoptique")
            step["files"]["geopotentiel_500"] = "maps/geopotentiel_500/%03d.webp" % lead
            dst2 = os.path.join(out_dir, "geopotentiel_500_meteociel", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst2, style="detail")
            step["files"]["geopotentiel_500_meteociel"] = "maps/geopotentiel_500_meteociel/%03d.webp" % lead

    t850 = fields.get("T850")
    if t850 is not None:
        t850_c = regrid(t850, lambda v: v - 273.15)
        if t850_c is not None:
            dst_t850 = os.path.join(out_dir, "temperature_850", "%03d.webp" % lead)
            ensure_dir(os.path.dirname(dst_t850))
            render_temperature850_with_isotherms(t850_c, dst_t850)
            step["files"]["temperature_850"] = "maps/temperature_850/%03d.webp" % lead
            write_hkv(t850_c, os.path.join(out_dir, "values", "temperature_850",
                                            "%03d.hkv.gz" % lead))
            step["probes"]["temperature_850"] = "maps/values/temperature_850/%03d.hkv.gz" % lead

    t2m = fields.get("T2M")
    dpt = fields.get("DPT")
    u10 = fields.get("U10")
    v10 = fields.get("V10")

    rh_g = None
    if t2m is not None:
        t_c = regrid(t2m, lambda v: v - 273.15)
        save("temperature", t_c)
        td_c = None
        if dpt is not None:
            td_raw = regrid(dpt)
            if td_raw is not None:
                td_c = td_raw - 273.15
                save("point_rosee", td_c)
                save("humidex", humidex_c(t_c, td_c))
                with np.errstate(invalid="ignore", divide="ignore"):
                    es_t = np.exp(17.625 * t_c / (243.04 + t_c))
                    es_td = np.exp(17.625 * td_c / (243.04 + td_c))
                    rh_g = np.clip(100.0 * es_td / es_t, 0.0, 100.0)
        if u10 is not None and v10 is not None:
            spd = np.sqrt(u10[0].astype(np.float32) ** 2
                          + v10[0].astype(np.float32) ** 2) * 3.6
            wind_kmh = domain.regrid(spd, u10[1], u10[2])
            if wind_kmh is not None:
                if rh_g is not None and td_c is not None:
                    felt = heat_index_c(t_c, rh_g)
                    felt = wind_chill_c(felt, wind_kmh)
                else:
                    felt = wind_chill_c(t_c, wind_kmh)
                save("temperature_ressentie", felt)

    if rh_g is not None:
        save("humidite", rh_g)

    if u10 is not None and v10 is not None:
        spd = np.sqrt(u10[0].astype(np.float32) ** 2
                      + v10[0].astype(np.float32) ** 2) * 3.6
        save("vent", domain.regrid(spd, u10[1], u10[2]))

    # Rafales : priorité à la rafale native IFS (10fg), fallback V10 * 1.40
    gust = fields.get("GUST")
    if gust is not None:
        g = regrid(gust, lambda v: v * 3.6)
        if g is not None:
            save("rafales", g)
            gust_g = g
    elif u10 is not None and v10 is not None:
        spd = np.sqrt(u10[0].astype(np.float32) ** 2
                      + v10[0].astype(np.float32) ** 2) * 3.6
        g = domain.regrid(spd * 1.40, u10[1], u10[2])
        if g is not None:
            save("rafales", g)
            gust_g = g

    tcdc = fields.get("TCDC")
    if tcdc is not None:
        save("nebulosite", regrid(tcdc))

    clouds = []
    for ck, layer in (("LCC", "nuages_bas"),
                      ("MCC", "nuages_moyens"),
                      ("HCC", "nuages_eleves")):
        f = fields.get(ck)
        if f is not None:
            g = regrid(f)
            if g is not None:
                clouds.append(g)
                save(layer, g)
    if clouds and tcdc is None:
        save("nebulosite", np.maximum.reduce(clouds))

    snod = fields.get("SNOD")
    if snod is not None:
        save("neige_au_sol", regrid(snod, lambda v: v * 100.0))

    cape = fields.get("CAPE") or fields.get("MUCAPE")
    if cape is not None:
        val, _, _ = cape
        if np.isfinite(val).any() and float(np.nanmax(val)) > 1.0:
            save("mucape", regrid(cape))

    if prmsl is not None:
        p = regrid(prmsl, lambda v: v / 100.0)
        dst_p = os.path.join(out_dir, "pression", "%03d.webp" % lead)
        render_pression_with_isobars(p, dst_p)
        step["files"]["pression"] = "maps/pression/%03d.webp" % lead
        write_hkv(p, os.path.join(out_dir, "values", "pression", "%03d.hkv.gz" % lead))

    if fields.get("PRES") is not None:
        save("pression_surface", regrid(fields["PRES"], lambda v: v / 100.0))

    tmin = fields.get("T2MIN")
    if tmin is not None:
        save("temperature_min_24h", regrid(tmin, lambda v: v - 273.15))

    tmax = fields.get("T2MAX")
    if tmax is not None:
        save("temperature_max_24h", regrid(tmax, lambda v: v - 273.15))

    apcp = fields.get("APCP")
    if apcp is not None:
        # ponytail: Sur ECMWF IFS, 'tp' (Total Precipitation) est en mètres (m) dans le GRIB2.
        # Multiplication par 1000 obligatoire pour convertir en millimètres (mm).
        a = regrid(apcp, lambda v: v * 1000.0)
        if a is not None:
            apcp_g = a

    return step, gust_g, apcp_g


def _save_cumulative(out_dir, name, data, lead, step):
    dst = os.path.join(out_dir, name, "%03d.webp" % lead)
    save_webp(data, name, dst)
    step["files"][name] = "maps/%s/%03d.webp" % (name, lead)
    write_hkv(data, os.path.join(out_dir, "values", name,
                                 "%03d.hkv.gz" % lead))
    step["probes"][name] = "maps/values/%s/%03d.hkv.gz" % (name, lead)


def _apply_cumulative(state, out_dir, lead, step, gust_g, apcp_g, domain):
    if gust_g is not None:
        if state.get("max_gust") is None:
            state["max_gust"] = gust_g.copy()
        else:
            state["max_gust"] = np.maximum(state["max_gust"], gust_g)
        _save_cumulative(out_dir, "rafales_cumul", state["max_gust"], lead, step)
    elif lead == 0:
        zero_g = np.zeros((domain.height, domain.width), dtype=np.float32)
        state["max_gust"] = zero_g
        _save_cumulative(out_dir, "rafales_cumul", zero_g, lead, step)

    if apcp_g is not None:
        prev = state.get("tp_prev")
        if prev is not None:
            diff = np.where(np.isfinite(apcp_g) & np.isfinite(prev),
                            apcp_g - prev, np.nan)
            _save_cumulative(out_dir, "pluie_1h", np.clip(diff, 0, None), lead, step)
        else:
            _save_cumulative(out_dir, "pluie_1h", np.zeros_like(apcp_g), lead, step)
        state["tp_prev"] = apcp_g
        _save_cumulative(out_dir, "pluie_cumul", apcp_g, lead, step)
    elif lead == 0:
        zero_p = np.zeros((domain.height, domain.width), dtype=np.float32)
        _save_cumulative(out_dir, "pluie_1h", zero_p, lead, step)
        _save_cumulative(out_dir, "pluie_cumul", zero_p, lead, step)
        state["tp_prev"] = zero_p
    for name in step["files"]:
        state["counts"][name] = state["counts"].get(name, 0) + 1


def render_domain(all_fields, run_dt, domain, out_dir, model_label, resolution,
                  lead_min=0, lead_max=None, init_state=None):
    os.makedirs(out_dir, exist_ok=True)
    leads = sorted([lh for lh in all_fields
                    if lh >= lead_min and (lead_max is None or lh <= lead_max)])
    if not leads:
        log("Aucune échéance dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return 0
    state = {"counts": {}, "max_gust": None, "tp_prev": None}
    if init_state:
        if init_state.get("max_gust") is not None:
            state["max_gust"] = init_state["max_gust"]
        if init_state.get("cum_precip") is not None:
            state["tp_prev"] = init_state["cum_precip"]
    steps = []
    n_ok = 0
    for lh in leads:
        step, gust_g, apcp_g = render_lead_par(all_fields[lh], lh, run_dt,
                                               domain, out_dir)
        _apply_cumulative(state, out_dir, lh, step, gust_g, apcp_g, domain)
        steps.append(step)
        n_ok += 1
        log("  H+%03d OK (%d couches)" % (lh, len(step["files"])))
    if n_ok == 0:
        raise RuntimeError("Aucune échéance rendue pour IFS (%s)" % out_dir)
    write_places(domain, out_dir)
    write_manifest(out_dir, steps,
                   {"model_name": model_label,
                    "provider": "ECMWF — open data IFS (data.ecmwf.int)",
                    "resolution": resolution,
                    "run_time": run_dt.isoformat()},
                   domain)
    log("Terminé : %d échéances, couches %s" % (
        n_ok, ", ".join("%s=%d" % kv for kv in
                        sorted(state["counts"].items()))))
    return n_ok


def make_init_state(prior_field, dom_obj):
    # ponytail: Sur ECMWF IFS, 'tp' (APCP) est déjà le cumul complet de pluie depuis H+0.
    # Seule l'échéance immédiatement précédente (prior[-1]) est requise pour calculer la pluie
    # horaire de la 1ère dalle (apcp - prev) et initialiser max_gust. Le re-téléchargement
    # de 50 GRIBs antérieurs prenait >60min et causait des timeouts GHA.
    if not prior_field:
        return None
    state_warm = {"max_gust": None, "cum_precip": None}
    gust = prior_field.get("GUST")
    apcp = prior_field.get("APCP")
    if gust is not None:
        val, lat, lon = gust
        g = dom_obj.regrid(val * 3.6, lat, lon)
        if g is not None:
            state_warm["max_gust"] = g
    if apcp is not None:
        val, lat, lon = apcp
        a = dom_obj.regrid(val * 1000.0, lat, lon)
        if a is not None:
            state_warm["cum_precip"] = a
    return state_warm


def run_all(max_hours=MAX_LEAD, domain="europe", lead_min=0, lead_max=None):
    max_lead = max(3, min(int(max_hours), MAX_LEAD))
    run_dt = latest_run()
    log(f"Run IFS sélectionné : {run_dt.isoformat()}")
    all_leads = compute_leads(max_lead, run_dt.hour)
    chunk_leads = [lh for lh in all_leads
                   if lh >= lead_min and (lead_max is None or lh <= lead_max)]
    if not chunk_leads:
        log("Aucune échéance dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return

    prior = [lh for lh in all_leads if lh < lead_min]
    prior_field = None
    if prior:
        try:
            prior_field = collect_lead(run_dt, prior[-1])
            log(f"  échauffement H+{prior[-1]:03d} chargé (1 échéance)")
        except Exception as e:
            log(f"  échauffement H+{prior[-1]:03d} ignoré ({e})")

    all_fields = {}
    for lh in chunk_leads:
        try:
            all_fields[lh] = collect_lead(run_dt, lh)
            log("  H+%03d : %d champs" % (lh, len(all_fields[lh])))
        except Exception as e:
            log("!! H+%03d ignoré (%s)" % (lh, e))

    base = os.path.join(BASE_DIR, "output")
    if domain in ("both", "europe"):
        render_domain(all_fields, run_dt, EUROPE,
                      os.path.join(base, "ifs", "maps"),
                      "ECMWF IFS 0.25° Europe", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, EUROPE))
    if domain in ("both", "france"):
        render_domain(all_fields, run_dt, FRANCE,
                      os.path.join(base, "ifs_france", "maps"),
                      "ECMWF IFS 0.25° France", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, FRANCE))
    # ── domaines mondiaux ───────────────────────────────────────────────────
    if domain in ("world", "antilles"):
        render_domain(all_fields, run_dt, ANTILLES,
                      os.path.join(base, "ifs_antilles", "maps"),
                      "ECMWF IFS 0.25° Arc Antillais", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, ANTILLES))
    if domain in ("world", "etats_unis"):
        render_domain(all_fields, run_dt, ETATS_UNIS,
                      os.path.join(base, "ifs_etats_unis", "maps"),
                      "ECMWF IFS 0.25° États-Unis", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, ETATS_UNIS))
    if domain in ("world", "pacifique_est"):
        render_domain(all_fields, run_dt, PACIFIQUE_EST,
                      os.path.join(base, "ifs_pacifique_est", "maps"),
                      "ECMWF IFS 0.25° Pacifique Est", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, PACIFIQUE_EST))
    if domain in ("world", "pacifique_ouest"):
        render_domain(all_fields, run_dt, PACIFIQUE_OUEST,
                      os.path.join(base, "ifs_pacifique_ouest", "maps"),
                      "ECMWF IFS 0.25° Pacifique Ouest", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, PACIFIQUE_OUEST))
    if domain in ("world", "ocean_indien_nord"):
        render_domain(all_fields, run_dt, OCEAN_INDIEN_NORD,
                      os.path.join(base, "ifs_ocean_indien_nord", "maps"),
                      "ECMWF IFS 0.25° Océan Indien Nord", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, OCEAN_INDIEN_NORD))
    if domain in ("world", "ocean_indien"):
        render_domain(all_fields, run_dt, OCEAN_INDIEN,
                      os.path.join(base, "ifs_ocean_indien", "maps"),
                      "ECMWF IFS 0.25° Océan Indien", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, OCEAN_INDIEN))
    if domain in ("world", "pacifique_sud"):
        render_domain(all_fields, run_dt, PACIFIQUE_SUD,
                      os.path.join(base, "ifs_pacifique_sud", "maps"),
                      "ECMWF IFS 0.25° Pacifique Sud", "0.25° (~25 km)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=make_init_state(prior_field, PACIFIQUE_SUD))
    print("[IFS] Pipeline terminé avec succès.", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Pipeline ECMWF IFS 0.25°")
    ap.add_argument("--max-hours", type=int, default=MAX_LEAD,
                    help="Échéance max en heures (défaut 360)")
    ap.add_argument("--domain", choices=["both", "europe", "france",
                                          "antilles", "etats_unis", "ocean_indien",
                                          "pacifique_ouest", "pacifique_sud", "pacifique_est",
                                          "ocean_indien_nord", "cyclones", "world"],
                    default="europe", help="Domaine(s) à générer")
    ap.add_argument("--lead-min", type=int, default=0)
    ap.add_argument("--lead-max", type=int, default=None)
    args = ap.parse_args()
    run_all(max_hours=args.max_hours, domain=args.domain,
            lead_min=args.lead_min, lead_max=args.lead_max)


if __name__ == "__main__":
    main()
