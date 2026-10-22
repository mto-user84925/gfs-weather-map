#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
icon_open_data.py — Pipeline ICON-EU 7 km (DWD, open data)
============================================================
  - Source : https://opendata.dwd.de/weather/nwp/icon-eu/grib/{run_hh}/{param}/
    fichiers réguliers lat-lon PAR VARIABLE, compressés bz2 (grille 2D -> regrid).
  - Runs 00/06/12/18Z (maturité ~3 h), échéances H+00 → H+120
    (pas 1 h jusqu'à H+48 puis 3 h — défaut 120 h).
  - Domaines : Europe (Lambert) + France (Mercator) — --domain both/europe/france.
  - Couches : température, ressentie, point de rosée, humidex, vent, rafales,
    nébulosité, nuages bas/moyens/élevés, humidité, MUCAPE, pression, pression
    surface, pluie cumulée + horaire (différence), neige au sol, T850 et Z500
    (fichiers pressure-level, repli gracieux si indisponibles).
"""
import os
import re
import sys
import bz2
import time
import uuid
import datetime
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor

import requests
import numpy as np

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))

from domains import EUROPE, FRANCE  # noqa: E402
from render import (  # noqa: E402
    save_webp, write_hkv, write_places, write_manifest,
    render_z500_with_isobars, render_pression_with_isobars,
    render_temperature850_with_isotherms, ensure_dir,
    dew_point_c, heat_index_c, wind_chill_c, humidex_c,
)

HEADERS = {"User-Agent": "gfs-weather-map/2.0 (Monsieur Meteo)"}
BASE_URL = "https://opendata.dwd.de/weather/nwp/icon-eu/grib"
RUN_MATURITY = 10800  # 3 h
MAX_LEAD = 120

# Variables single-level : (nom URL DWD, clé canonique, facteur)
SFC_VARS = [
    ("t_2m", "T2M", 1.0),
    ("td_2m", "DPT", 1.0),
    ("u_10m", "U10", 1.0),
    ("v_10m", "V10", 1.0),
    ("vmax_10m", "GUST", 1.0),
    ("tot_prec", "APCP", 1.0),
    ("clct", "TCDC", 1.0),
    ("clcl", "LCC", 1.0),
    ("clcm", "MCC", 1.0),
    ("clch", "HCC", 1.0),
    ("cape_con", "CAPE", 1.0),
    ("h_snow", "SNOD", 1.0),
    ("pmsl", "PRMSL", 1.0),
    ("ps", "PRES", 1.0),
    ("relhum_2m", "RH", 1.0),
]
# Pressure-level : (nom URL DWD, clé canonique, niveau).
# DWD nomme le géopotentiel 'fi' (pas 'z') : fichier par niveau ex. 500_FI.
PL_VARS = [("t", "T850", 850), ("fi", "HGT", 500)]


def log(msg):
    print("[ICON] " + msg, flush=True)


def latest_run(now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    run_h = (now.hour // 6) * 6
    run_dt = now.replace(hour=run_h, minute=0, second=0, microsecond=0)
    if (now - run_dt).total_seconds() < RUN_MATURITY:
        run_dt -= datetime.timedelta(hours=6)
    return run_dt


def compute_leads(max_hours=MAX_LEAD):
    max_h = max(3, min(int(max_hours), MAX_LEAD))
    leads = list(range(0, min(max_h, 49), 1))
    leads.extend(range(51, max_h + 1, 3))
    return sorted(set(leads))


def _fetch(url, retries=3):
    """Télécharge un GRIB DWD.

    Piège : le serveur DWD renvoie parfois HTTP 200 avec une PAGE D'ERREUR
    HTML de ~198 octets (et non un GRIB) — typiquement pour une échéance pas
    encore publiée. Le test `len(r.content) > 500` laissait passer les
    fichiers bz2 valides (petits) tout en acceptant ces pages d'erreur.
    On valide donc explicitement la signature bz2 ('BZh') / GRIB ('GRIB').
    """
    last = None
    for attempt in range(1, retries + 1):
        try:
            r = requests.get(url, headers=HEADERS, timeout=60, verify=True)
            if r.status_code == 200 and len(r.content) > 500:
                try:
                    payload = bz2.decompress(r.content)
                except Exception:
                    payload = r.content
                # Un GRIB2 commence par "GRIB" ; sinon c'est une page d'erreur.
                if payload[:4] == b"GRIB":
                    return payload
                last = "contenu non-GRIB (%d o)" % len(payload)
            else:
                last = "HTTP %s" % r.status_code
        except Exception as e:
            last = "%s" % e
        time.sleep(2 * attempt)
    raise RuntimeError("Téléchargement %s impossible (%s)" % (url, last))


# ── Verrou de décodage ───────────────────────────────────────────────────────
# La bibliothèque C ecCodes (via cfgrib) n'est PAS sûre en décodage concurrent
# dans le même process : deux threads qui ouvrent un GRIB en parallèle font
# planter l'interpréteur (violation d'accès 0xC0000005 / assertion
# « boot.def » dans grib_context.cc), SANS exception Python attrapable.
# Reproduit sur Windows : 8 threads → crash ; séquentiel → OK.
# Le TÉLÉCHARGEMENT reste parallèle (8 workers), seul le décodage est
# sérialisé : le réseau reste le goulot d'étranglement, l'impact est minime.
_DECODE_LOCK = threading.Lock()


def _decode_grib(grib_bytes, want_var=None, want_level=None):
    """Décode un GRIB ICON (1 variable) → (values 2D, lat 1D, lon 1D) ou None."""
    import cfgrib
    tmp = os.path.join(tempfile.gettempdir(),
                       "icon_tmp_%s.grib2" % uuid.uuid4().hex[:12])
    with open(tmp, "wb") as f:
        f.write(grib_bytes)
    ds = None
    try:
        # Section critique : un seul décodage eccodes à la fois.
        with _DECODE_LOCK:
            ds = cfgrib.open_dataset(tmp)
            v = list(ds.data_vars)[0]
            # isobaricInhPa DIMENSION = fichier multi-niveaux → slicer le niveau voulu.
            # Coordonnée scalaire (fichier par niveau, ex. 850_T) = déjà 2D.
            if want_level is not None and "isobaricInhPa" in ds[v].dims:
                levs = np.atleast_1d(ds[v].isobaricInhPa.values)
                idx = np.argmin(np.abs(levs - want_level))
                values = ds[v].values[idx].astype(np.float32)
            else:
                values = ds[v].values.astype(np.float32)
            lats = ds.latitude.values.copy()
            lons = ds.longitude.values.copy()
        return (values, lats, lons)
    except Exception:
        return None
    finally:
        # Ferme le dataset AVANT de supprimer le fichier : sinon les descripteurs
        # restent ouverts (le fichier .idx est recréé/supprimé par cfgrib) et
        # on accumule des handles sur les runners de CI.
        if ds is not None:
            try:
                ds.close()
            except Exception:
                pass
        try:
            os.remove(tmp)
        except OSError:
            pass
        # cfgrib laisse un index à côté du fichier temporaire.
        try:
            os.remove(tmp + ".5b7b6.idx")
        except OSError:
            pass


def collect_lead(run_dt, lead, light=False, fields_cache=None):
    """Télécharge et décode TOUTES les variables d'une échéance → dict canonique.

    light=True : uniquement GUST (vmax_10m) + APCP (tot_prec) — échauffement
    des couches cumulatives sans télécharger les 16 autres variables.

    fields_cache : dict optionnel {lead: champs complets déjà téléchargés}.
    Permet de rendre le domaine Europe PUIS France en ne téléchargeant les
    GRIB qu'une seule fois (chaque échéance fait ~18 requêtes HTTP).
    """
    if fields_cache is not None and lead in fields_cache and not light:
        return fields_cache[lead]
    day = run_dt.strftime("%Y%m%d%H")
    hh = "%02d" % run_dt.hour
    lead3 = "%03d" % lead
    out = {}
    jobs = []

    def get_sfc(var, key):
        url = ("%s/%s/%s/icon-eu_europe_regular-lat-lon_single-level_%s_%s_%s"
               ".grib2.bz2" % (BASE_URL, hh, var, day, lead3, var.upper()))
        try:
            data = _fetch(url)
            res = _decode_grib(data)
            if res is not None:
                out[key] = res
        except Exception:
            pass

    def get_pl(var, key, level):
        # Deux patterns : fichier par niveau (_850_t) ou fichier tous niveaux (_t)
        patterns = [
            "%s/%s/%s/icon-eu_europe_regular-lat-lon_pressure-level_%s_%s_%d_%s"
            ".grib2.bz2" % (BASE_URL, hh, var, day, lead3, level, var.upper()),
            "%s/%s/%s/icon-eu_europe_regular-lat-lon_pressure-level_%s_%s_%s"
            ".grib2.bz2" % (BASE_URL, hh, var, day, lead3, var.upper()),
        ]
        for url in patterns:
            try:
                data = _fetch(url)
                res = _decode_grib(data, want_level=level)
                if res is not None:
                    out[key] = res
                    return
            except Exception:
                continue

    if light:
        # Échauffement : seulement la rafale et la pluie cumulée
        for var, key in (("vmax_10m", "GUST"), ("tot_prec", "APCP")):
            jobs.append((get_sfc, (var, key)))
    else:
        for var, key, _ in SFC_VARS:
            jobs.append((get_sfc, (var, key)))
        for var, key, level in PL_VARS:
            jobs.append((get_pl, (var, key, level)))

    with ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(fn, *args) for fn, args in jobs]
        for f in futures:
            try:
                f.result()
            except Exception:
                pass
    return out


def warmup_from_cached(cached, domain, state):
    gust = cached.get("GUST")
    apcp = cached.get("APCP")
    if gust is not None:
        val, lat, lon = gust
        g = domain.regrid(val * 3.6, lat, lon)
        if g is not None:
            state["max_gust"] = (g.copy() if state["max_gust"] is None
                                 else np.maximum(state["max_gust"], g))
    if apcp is not None:
        val, lat, lon = apcp
        a = domain.regrid(val, lat, lon)
        if a is not None:
            state["cum_precip"] = a  # tot_prec ICON = cumul depuis le début du run
    return state


def render_lead_par(fields, lead, run_dt, domain, out_dir):
    """Rend les couches d'une échéance ICON-EU (sauf cumulatifs/horaires)."""
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
        try:
            return domain.regrid(val, lat, lon)
        except MemoryError:
            # MemoryError hérite de Exception mais PAS de RuntimeError : sans
            # ce garde-fou il remontait jusqu'à run_all et tuait le rendu du
            # second domaine (Europe rendu, France jamais produit).
            log("!! regrid(%s) : mémoire insuffisante — couche ignorée" % domain.name)
            return None

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
    prmsl = fields.get("PRMSL")
    if hgt is not None and prmsl is not None:
        z_raw = regrid(hgt)
        p_hpa = regrid(prmsl, lambda v: v / 100.0)
        if z_raw is not None and p_hpa is not None:
            # DWD 'z' : m²/s² (> 20000) ou déjà en m (≈ 5600) → dam
            if float(np.nanmax(z_raw)) > 20000:
                z = z_raw / 98.0665
            else:
                z = z_raw / 10.0
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
    rh = fields.get("RH")
    dpt = fields.get("DPT")
    u10 = fields.get("U10")
    v10 = fields.get("V10")

    if t2m is not None:
        t_c = regrid(t2m, lambda v: v - 273.15)
        save("temperature", t_c)
        td_c = None
        if rh is not None:
            rh_g = regrid(rh)
            if rh_g is not None:
                td_c = dew_point_c(t_c, rh_g)
                save("point_rosee", td_c)
                save("humidex", humidex_c(t_c, td_c))
        if u10 is not None and v10 is not None:
            spd = np.sqrt(u10[0].astype(np.float32) ** 2
                          + v10[0].astype(np.float32) ** 2) * 3.6
            wind_kmh = domain.regrid(spd, u10[1], u10[2])
            if wind_kmh is not None:
                if rh is not None and td_c is not None:
                    felt = heat_index_c(t_c, rh_g)
                    felt = wind_chill_c(felt, wind_kmh)
                else:
                    felt = wind_chill_c(t_c, wind_kmh)
                save("temperature_ressentie", felt)

    if rh is not None:
        save("humidite", regrid(rh))

    if u10 is not None and v10 is not None:
        spd = np.sqrt(u10[0].astype(np.float32) ** 2
                      + v10[0].astype(np.float32) ** 2) * 3.6
        save("vent", domain.regrid(spd, u10[1], u10[2]))

    gust = fields.get("GUST")
    if gust is not None:
        g = regrid(gust, lambda v: v * 3.6)
        save("rafales", g)
        gust_g = g

    for ck, layer in (("LCC", "nuages_bas"),
                      ("MCC", "nuages_moyens"),
                      ("HCC", "nuages_eleves")):
        f = fields.get(ck)
        if f is not None:
            g = regrid(f)
            if g is not None:
                save(layer, g)
    if fields.get("TCDC") is not None:
        save("nebulosite", regrid(fields["TCDC"]))

    cape = fields.get("CAPE")
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

    apcp = fields.get("APCP")
    if apcp is not None:
        a = regrid(apcp)  # tot_prec = cumul depuis le début du run
        if a is not None:
            apcp_g = a

    snod = fields.get("SNOD")
    if snod is not None:
        save("neige_au_sol", regrid(snod, lambda v: v * 100.0))

    return step, gust_g, apcp_g


def _save_cumulative(out_dir, name, data, lead, step):
    dst = os.path.join(out_dir, name, "%03d.webp" % lead)
    save_webp(data, name, dst)
    step["files"][name] = "maps/%s/%03d.webp" % (name, lead)
    write_hkv(data, os.path.join(out_dir, "values", name,
                                 "%03d.hkv.gz" % lead))
    step["probes"][name] = "maps/values/%s/%03d.hkv.gz" % (name, lead)


def _apply_cumulative(state, out_dir, lead, step, gust_g, apcp_g):
    if gust_g is not None:
        if state.get("max_gust") is None:
            state["max_gust"] = gust_g.copy()
        else:
            state["max_gust"] = np.maximum(state["max_gust"], gust_g)
        _save_cumulative(out_dir, "rafales_cumul", state["max_gust"], lead, step)
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
        zero_p = np.zeros((FRANCE.height, FRANCE.width), dtype=np.float32)
        _save_cumulative(out_dir, "pluie_1h", zero_p, lead, step)
        _save_cumulative(out_dir, "pluie_cumul", zero_p, lead, step)
        state["tp_prev"] = zero_p
    for name in step["files"]:
        state["counts"][name] = state["counts"].get(name, 0) + 1


def render_domain(all_fields, run_dt, domain, out_dir, model_label, resolution,
                  lead_min=0, lead_max=None, init_state=None):
    """Rend toutes les échéances d'un domaine depuis les champs collectés."""
    os.makedirs(out_dir, exist_ok=True)
    leads = sorted([lh for lh in all_fields
                    if lh >= lead_min and (lead_max is None or lh <= lead_max)])
    if not leads:
        log("Aucune échéance dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return 0

    state = {"counts": {}, "max_gust": None, "tp_prev": None}
    if init_state:
        # État d'échauffement (cumulés des échéances antérieures au chunk)
        if init_state.get("max_gust") is not None:
            state["max_gust"] = init_state["max_gust"]
        if init_state.get("cum_precip") is not None:
            state["tp_prev"] = init_state["cum_precip"]
    steps = []
    n_ok = 0
    for lh in leads:
        step, gust_g, apcp_g = render_lead_par(all_fields[lh], lh, run_dt,
                                               domain, out_dir)
        _apply_cumulative(state, out_dir, lh, step, gust_g, apcp_g)
        steps.append(step)
        n_ok += 1
        log("  H+%03d OK (%d couches)" % (lh, len(step["files"])))

    if n_ok == 0:
        raise RuntimeError("Aucune échéance rendue pour ICON-EU (%s)" % out_dir)
    write_places(domain, out_dir)
    write_manifest(out_dir, steps,
                   {"model_name": model_label,
                    "provider": "DWD — open data (opendata.dwd.de)",
                    "resolution": resolution,
                    "run_time": run_dt.isoformat()},
                   domain)
    log("Terminé : %d échéances, couches %s" % (
        n_ok, ", ".join("%s=%d" % kv for kv in
                        sorted(state["counts"].items()))))
    return n_ok


def run_all(max_hours=MAX_LEAD, domain="europe", lead_min=0, lead_max=None):
    max_lead = max(3, min(int(max_hours), MAX_LEAD))
    run_dt = latest_run()
    log("Run ICON-EU sélectionné : %s" % run_dt.isoformat())
    all_leads = compute_leads(max_lead)
    chunk_leads = [lh for lh in all_leads
                   if lh >= lead_min and (lead_max is None or lh <= lead_max)]
    if not chunk_leads:
        log("Aucune échéance dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return

    # Échauffement cumulatif : échéances antérieures (GUST + tot_prec UNIQUEMENT,
    # mode léger — pas les 16 autres variables, sinon coût énorme en re-téléchargements)
    state_warm = {"max_gust": None, "cum_precip": None}
    prior = [lh for lh in all_leads if lh < lead_min]
    target_domain = FRANCE if domain == "france" else EUROPE
    for lh in prior:
        try:
            fields = collect_lead(run_dt, lh, light=True)
            warmup_from_cached(fields, target_domain, state_warm)
        except Exception:
            pass

    all_fields = {}
    for lh in chunk_leads:
        try:
            all_fields[lh] = collect_lead(run_dt, lh, fields_cache=all_fields)
            log("  H+%03d : %d champs" % (lh, len(all_fields[lh])))
        except Exception as e:
            log("!! H+%03d ignoré (%s)" % (lh, e))

    base = os.path.join(BASE_DIR, "output")
    # --domain both : les GRIB ne sont téléchargés qu'une fois (fields_cache
    # = all_fields alimenté au fil de l'eau ci-dessus), puis reprojetés sur
    # les deux grilles. C'est ce mode qui est requis par le workflow ICON-EU :
    # l'interface expose « ICON-EU Europe » ET « ICON-EU France ».
    #
    # ⚠️ Chaque domaine a SA PROPRE étape d'échauffement (state_warm) : cet
    # état contient des champs DÉJÀ reprojetés sur la grille du domaine
    # (max_gust, cum_precip). Le partager entre Europe et France mélangeait
    # deux grilles 2200×1640 différentes → cumuls faux sur le 2e domaine.
    for dom_key, dom_name, dom_obj, dom_label in (
        ("europe", "icon_eu", EUROPE, "ICON-EU 7 km Europe"),
        ("france", "icon_eu_france", FRANCE, "ICON-EU 7 km France"),
    ):
        if domain not in ("both", dom_key):
            continue
        state_warm = {"max_gust": None, "cum_precip": None}
        for lh in prior:
            try:
                fields = collect_lead(run_dt, lh, light=True, fields_cache=all_fields)
                warmup_from_cached(fields, dom_obj, state_warm)
            except Exception:
                pass
        render_domain(all_fields, run_dt, dom_obj,
                      os.path.join(base, dom_name, "maps"),
                      dom_label, "7 km (~0.0625°)",
                      lead_min=lead_min, lead_max=lead_max,
                      init_state=state_warm)
        # Libère la mémoire entre les deux domaines (les tableaux reprojetés
        # 2200×1640 des 73 échéances ne servent qu'à un domaine).
        import gc
        gc.collect()
    print("[ICON] Pipeline terminé avec succès.", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Pipeline ICON-EU 7 km (DWD)")
    ap.add_argument("--max-hours", type=int, default=MAX_LEAD,
                    help="Échéance max en heures (défaut 120)")
    ap.add_argument("--domain", choices=["both", "europe", "france"],
                    default="europe", help="Domaine(s) à générer")
    ap.add_argument("--lead-min", type=int, default=0)
    ap.add_argument("--lead-max", type=int, default=None)
    args = ap.parse_args()
    run_all(max_hours=args.max_hours, domain=args.domain,
            lead_min=args.lead_min, lead_max=args.lead_max)


if __name__ == "__main__":
    main()
