#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
arpege_open_data.py — Pipeline ARPEGE Europe 0.1° & France (Météo-France)
==========================================================================
  - Données : https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/{run}/arpege/01/
    paquets SP1 (surface), SP2 (nuages/CAPE), IP1 (géopotentiel Z500).
  - Produit 01 = ARPEGE Europe 0,1° (~11 km) — le plus fin publié par
    Météo-France pour ARPEGE (le 0,025°/2,5 km n'existe qu'en AROME, pas ARPEGE).
  - ARPEGE France = même produit 01 re-projeté sur le domaine Mercator France
    (vue France + régions, ~2,5× plus net que GFS France 0,25°).
  - Téléchargement direct accéléré (1 requête GET par bloc) puis décodage local.
  - Runs 00/06/12/18Z (maturité ≥ 4 h 30), échéances H+00 → H+102 pas 3 h.
  - Couche maîtresse : GÉOPOTENTIEL 500 hPa + isobares pression au sol (Europe).
  - --domain both : un seul téléchargement, rendu Europe + France (18 groupes CI).
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

from domains import EUROPE, FRANCE  # noqa: E402
import gribscan  # noqa: E402
from render import (  # noqa: E402
    save_webp, write_hkv, write_places, write_manifest,
    render_z500_with_isobars, render_pression_with_isobars,
    render_temperature850_with_isotherms, ensure_dir,
    dew_point_c, heat_index_c, wind_chill_c, humidex_c,
)

HEADERS = {"User-Agent": "gfs-weather-map/2.0 (Monsieur Meteo)"}
# Configuration des produits ARPEGE Météo-France :
# - Europe : produit GLOB025 (0.25° mondial, 360°) couvrant 100% de l'Europe et de l'Atlantique sans triangle
# - France : produit EURAT01 (0.1° haute résolution 11 km) avec vraie T2M à 2 mètres
GRIB_CONFIG = {
    "europe": {
        "product": "025",
        "label": "ARPEGE Europe 0.25°",
        "resolution": "0.25° (~25 km)",
        "blocks": ["000H024H", "025H048H", "049H072H", "073H102H"],
        "domain": EUROPE,
        "out_dir_name": "arpege",
    },
    "france": {
        "product": "01",
        "label": "ARPEGE France 0.1°",
        "resolution": "0.1° (~11 km)",
        "blocks": ["000H012H", "013H024H", "025H036H", "037H048H", "049H060H", "061H072H", "073H084H", "085H096H", "097H102H"],
        "domain": FRANCE,
        "out_dir_name": "arpege_france",
    }
}
PKGS = ["SP1", "SP2", "IP1"]
RUN_MATURITY = 16200  # 4 h 30
MAX_LEAD = 102


def grib_url(run, pkg, block, product="01"):
    """URL S3 Météo-France d'un bloc GRIB2 ARPEGE (produit 01 EURAT01)."""
    return ("https://meteofrance-pnt.s3.rbx.io.cloud.ovh.net/pnt/{run}/arpege/{prod}/"
            "{pkg}/arpege__{prod}__{pkg}__{block}__{run}.grib2"
            .format(run=run, prod=product, pkg=pkg, block=block))


def log(msg):
    print("[ARPEGE] " + msg, flush=True)


_dbg_v = {}  # diagnostic valeurs brutes (une seule fois par clé)


def run_str(run_dt):
    return run_dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def latest_run(now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    run_h = (now.hour // 6) * 6
    run_dt = now.replace(hour=run_h, minute=0, second=0, microsecond=0)
    if (now - run_dt).total_seconds() < RUN_MATURITY:
        run_dt -= datetime.timedelta(hours=6)
    return run_dt


def _head(session, url):
    r = session.head(url, headers=HEADERS, timeout=30, verify=True)
    if r.status_code != 200:
        return None
    cl = r.headers.get("Content-Length")
    return int(cl) if cl else None


def select_run(now=None, session=None, product="01"):
    """Dernier run ARPEGE réellement disponible et 100% COMPLET."""
    s = session or requests.Session()
    if not isinstance(now, datetime.datetime):
        now = datetime.datetime.now(datetime.timezone.utc)
    for _ in range(4):
        run_dt = latest_run(now)
        # Vérification sur le DERNIER bloc du run (garantit que Météo-France a terminé le transfert)
        last_block = "073H102H" if product == "025" else "097H102H"
        url = grib_url(run_str(run_dt), "SP1", last_block, product)
        if _head(s, url):
            return run_dt
        log("Run %s encore en cours de téléversement (bloc %s absent), repli sur le run précédent complet" % (run_str(run_dt), last_block))
        now = run_dt - datetime.timedelta(hours=6)
    raise RuntimeError("Aucun run ARPEGE complet disponible sur le S3 Météo-France")


def fetch_block_full(session, url, max_lead, logf, lead_min=0):
    """Repli : téléchargement complet du bloc puis décodage sélectif local."""
    logf("  téléchargement direct du bloc GRIB…")
    r = session.get(url, headers=HEADERS, timeout=600, verify=True)
    r.raise_for_status()
    if len(r.content) < 1000:
        raise IOError("Bloc vide: %s" % url)
    tmp = os.path.join(tempfile.gettempdir(), "arpege_block_%d.grib2" % os.getpid())
    with open(tmp, "wb") as f:
        f.write(r.content)
    out = {}
    with open(tmp, "rb") as f:
        from eccodes import (codes_grib_new_from_file, codes_get,
                             codes_get_array, codes_release)
        while True:
            gid = codes_grib_new_from_file(f)
            if gid is None:
                break
            try:
                # Métadonnées du message courant (décodage local complet)
                cat = int(codes_get(gid, "parameterCategory"))
                num = int(codes_get(gid, "parameterNumber"))
                level = int(codes_get(gid, "level"))
                key = gribscan.key_of(cat, num, level)
                if key is None:
                    continue
                step = int(codes_get(gid, "step"))
                end = int(codes_get(gid, "endStep"))
                lead = end if step != end else step
                if not (lead_min <= lead <= max_lead and lead % 3 == 0):
                    continue
                # Diagnostic : table des paramètres réels (shortName/unités)
                try:
                    sn = codes_get(gid, "shortName")
                    un = codes_get(gid, "units")
                    if key == "GUST" or "gust" in str(sn).lower() or \
                            (cat == 2 and num in (22, 23, 24)) or lead == 0:
                        _dbg_key = (cat, num, level)
                        if _dbg_key not in _dbg_v:
                            _dbg_v[_dbg_key] = True
                            log("  [PARAM] cat=%d num=%d lev=%d -> %s (shortName=%s, units=%s)"
                                % (cat, num, level, key, sn, un))
                except Exception:
                    pass
                vals = codes_get_array(gid, "values")
                Ni = int(codes_get(gid, "Ni"))
                Nj = int(codes_get(gid, "Nj"))
                grid = vals.reshape((Nj, Ni))
                lats = codes_get_array(gid, "distinctLatitudes")
                lons = codes_get_array(gid, "distinctLongitudes")
                # GUST fallback diagnostic
                if key == "GUST" and lead == 0 and ("GUST", 0) not in _dbg_v:
                    _dbg_v[("GUST", 0)] = True
                    log("  [VALEURS] GUST : min %.2f max %.2f (m/s) | units=%s"
                        % (float(vals.min()), float(vals.max()), un))
                out.setdefault(lead, {})[key] = (grid, lats, lons)
            except Exception as e:
                logf("  !! message ignoré (%s)" % e)
            finally:
                codes_release(gid)
    try:
        os.remove(tmp)
    except OSError:
        pass
    return out


def _block_range(block):
    """'025H036H' → (25, 36)."""
    m = re.match(r"(\d+)H(\d+)H", block)
    if not m:
        return (0, 0)
    return (int(m.group(1)), int(m.group(2)))


def collect_fields(session, run_dt, max_lead, product="025", blocks=None, lead_min=0, lead_max=None):
    """Télécharge/extrait tous les champs → {lead: {KEY: (vals, lat, lon)}}."""
    all_fields = {}
    rs = run_str(run_dt)
    n_full_mb = 0
    n_blocks = 0
    eff_max = min(max_lead, lead_max) if lead_max is not None else max_lead
    block_list = blocks if blocks is not None else GRIB_CONFIG["europe"]["blocks"]
    for pkg in PKGS:
        # Pour SP1 (cumuls APCP et rafales GUST), inclure l'échéance précédente
        # (lead_min - 3) afin d'initialiser tp_prev aux frontières de chunks (H+24, H+48, H+72).
        pkg_lead_min = max(0, lead_min - 3) if (pkg == "SP1" and lead_min > 0) else lead_min
        for block in block_list:
            b0, b1 = _block_range(block)
            if b0 > eff_max or b1 < pkg_lead_min:
                continue  # bloc entièrement hors de la portée demandée
            url = grib_url(rs, pkg, block, product)
            size = _head(session, url)
            if size is None:
                log("!! %s %s (%s) introuvable" % (pkg, block, product))
                continue
            t0 = time.time()
            try:
                if pkg == "IP1" and size > 300 * 1024 * 1024:
                    fields = gribscan.fetch_block(session, url, size, eff_max, log=log)
                    mode = "scan sélectif (Range)"
                else:
                    fields = fetch_block_full(session, url, eff_max, log, lead_min=pkg_lead_min)
                    mode = "direct (rapide)"
                n_full_mb += size // (1024 * 1024)
            except Exception as e:
                log("!! %s %s (%s) : extraction échouée (%s)" % (pkg, block, product, e))
                continue
            n_blocks += 1
            for lead, flds in fields.items():
                all_fields.setdefault(lead, {}).update(flds)
            log("  %s %s (%s) : %d échéances (%s, %.1f s)" % (
                pkg, block, product, len(fields), mode, time.time() - t0))
    log("Blocs traités (%s) : %d, dont %d Mo téléchargés"
        % (product, n_blocks, n_full_mb))
    return all_fields


def render_lead(fields, lead, run_dt, domain, out_dir, state):
    """Rend toutes les couches d'une échéance ARPEGE (Z500 en priorité)."""
    step = {"lead_hour": lead,
            "valid_time": (run_dt + datetime.timedelta(hours=lead)).isoformat(),
            "files": {},
            "probes": {}}

    def regrid(field, convert=None):
        if field is None:
            return None
        try:
            val, lat, lon = field
            if convert is not None:
                val = convert(val)
            return domain.regrid(val, lat, lon)
        except MemoryError:
            log("  !! MemoryError lors du regrid ARPEGE (H+%03d)" % lead)
            return None

    def save(name, data):
        dst = os.path.join(out_dir, name, "%03d.webp" % lead)
        save_webp(data, name, dst)
        step["files"][name] = "maps/%s/%03d.webp" % (name, lead)
        write_hkv(data, os.path.join(out_dir, "values", name,
                                     "%03d.hkv.gz" % lead))
        step["probes"][name] = "maps/values/%s/%03d.hkv.gz" % (name, lead)
        state["counts"][name] = state["counts"].get(name, 0) + 1

    # ★ Couche maîtresse : Z500 (m²/s² → dam) + isobares (Europe ET France)
    hgt = fields.get("HGT")
    prmsl = fields.get("PRMSL")
    if hgt is not None and prmsl is not None:
        z = regrid(hgt, lambda v: v / 98.0665)
        p_hpa = regrid(prmsl, lambda v: v / 100.0)
        if z is not None and p_hpa is not None:
            # Style synoptique (défaut, esprit Météociel) : bandes Z500 4 dam + isobares 5 hPa
            dst = os.path.join(out_dir, "geopotentiel_500", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst, style="synoptique")
            step["files"]["geopotentiel_500"] = \
                "maps/geopotentiel_500/%03d.webp" % lead
            state["counts"]["geopotentiel_500"] = \
                state["counts"].get("geopotentiel_500", 0) + 1
            # Style détaillé (option UI)
            dst2 = os.path.join(out_dir, "geopotentiel_500_meteociel", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst2, style="detail")
            step["files"]["geopotentiel_500_meteociel"] = \
                "maps/geopotentiel_500_meteociel/%03d.webp" % lead
            state["counts"]["geopotentiel_500_meteociel"] = \
                state["counts"].get("geopotentiel_500_meteociel", 0) + 1

    t2m = fields.get("T2M") or fields.get("TSFC")
    dpt = fields.get("DPT")
    rh = fields.get("RH")
    u10 = fields.get("U10")
    v10 = fields.get("V10")

    if t2m is not None:
        t_c = regrid(t2m, lambda v: v - 273.15)
        save("temperature", t_c)
        td_c = None
        if dpt is not None:
            td_c = regrid(dpt, lambda v: v - 273.15)
            save("point_rosee", td_c)
            save("humidex", humidex_c(t_c, td_c))
        elif rh is not None:
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
                felt = wind_chill_c(t_c, wind_kmh)
                save("temperature_ressentie", felt)

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
            state["counts"]["temperature_850"] = state["counts"].get("temperature_850", 0) + 1

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
        if state.get("max_gust") is None:
            state["max_gust"] = g.copy()
        else:
            state["max_gust"] = np.maximum(state["max_gust"], g)
        save("rafales_cumul", state["max_gust"])

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
    if clouds:
        save("nebulosite", np.maximum.reduce(clouds))

    cape = fields.get("CAPE")
    if cape is not None:
        val, _, _ = cape
        if np.isfinite(val).any() and float(np.nanmax(val)) > 1.0:
            save("mucape", regrid(cape))
        else:
            log("  CAPE H+%03d incohérent (max=%s), couche ignorée"
                % (lead, float(np.nanmax(val))))

    if prmsl is not None:
        p = regrid(prmsl, lambda v: v / 100.0)
        dst_p = os.path.join(out_dir, "pression", "%03d.webp" % lead)
        render_pression_with_isobars(p, dst_p)
        step["files"]["pression"] = "maps/pression/%03d.webp" % lead
        write_hkv(p, os.path.join(out_dir, "values", "pression", "%03d.hkv.gz" % lead))
        state["counts"]["pression"] = state["counts"].get("pression", 0) + 1

    apcp = fields.get("APCP")
    if apcp is not None:
        a = regrid(apcp)  # cumul depuis le début du run (mm)
        if a is not None:
            prev = state.get("tp_prev")
            if prev is not None:
                # np.isfinite().all() toujours False à cause des NaN de bord → utiliser np.where
                diff = np.where(np.isfinite(a) & np.isfinite(prev), a - prev, np.nan)
                save("pluie_1h", np.clip(diff, 0, None))
            else:
                save("pluie_1h", np.zeros_like(a))
            state["tp_prev"] = a
            save("pluie_cumul", a)
    elif lead == 0:
        zero_p = np.zeros((domain.height, domain.width), dtype=np.float32)
        save("pluie_1h", zero_p)
        save("pluie_cumul", zero_p)
        state["tp_prev"] = zero_p

    snod = fields.get("SNOD")
    if snod is not None:
        save("neige_au_sol", regrid(snod, lambda v: v * 100.0))

    return step


def render_domain(all_fields, run_dt, domain, out_dir, model_label, resolution,
                  lead_min=0, lead_max=None):
    """Rend toutes les échéances d'un domaine depuis des champs déjà collectés."""
    os.makedirs(out_dir, exist_ok=True)
    leads = sorted([lh for lh in all_fields
                    if lh >= lead_min and (lead_max is None or lh <= lead_max)])
    if not leads:
        log("Aucune échéance dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return 0

    steps = []
    state = {"counts": {}, "max_gust": None, "tp_prev": None}
    # Warmup des états cumulatifs (tp_prev, max_gust) depuis les échéances < lead_min
    for w_lh in sorted(lh for lh in all_fields if lh < lead_min):
        w_flds = all_fields[w_lh]
        if "APCP" in w_flds and w_flds["APCP"] is not None:
            w_val, w_lat, w_lon = w_flds["APCP"]
            state["tp_prev"] = domain.regrid(w_val, w_lat, w_lon)
        if "GUST" in w_flds and w_flds["GUST"] is not None:
            w_val, w_lat, w_lon = w_flds["GUST"]
            w_g = domain.regrid(w_val * 3.6, w_lat, w_lon)
            if w_g is not None:
                state["max_gust"] = w_g if state["max_gust"] is None else np.fmax(state["max_gust"], w_g)
    n_ok = 0
    for lh in leads:
        step = render_lead(all_fields[lh], lh, run_dt, domain, out_dir, state)
        steps.append(step)
        n_ok += 1
        log("  H+%03d OK (%d couches)" % (lh, len(step["files"])))

    if n_ok == 0:
        raise RuntimeError("Aucune échéance rendue pour ARPEGE (%s)" % out_dir)
    write_places(domain, out_dir)
    write_manifest(out_dir, steps,
                   {"model_name": model_label,
                    "provider": "Météo-France — open data (data.gouv.fr)",
                    "resolution": resolution,
                    "run_time": run_dt.isoformat()},
                   domain)
    log("Terminé : %d échéances, couches %s" % (
        n_ok, ", ".join("%s=%d" % kv for kv in
                        sorted(state["counts"].items()))))
    return n_ok


def run_all(max_hours=MAX_LEAD, domain="both", lead_min=0, lead_max=None, run_time=None):
    max_lead = max(3, min(int(max_hours), MAX_LEAD))
    if run_time:
        try:
            run_dt = datetime.datetime.fromisoformat(run_time)
        except Exception:
            run_dt = datetime.datetime.strptime(run_time, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    else:
        prod_check = "01" if domain == "france" else "025"
        run_dt = select_run(product=prod_check)
    log("Run ARPEGE sélectionné : %s" % run_str(run_dt))
    base = os.path.join(BASE_DIR, "output")
    session = requests.Session()
    session.headers.update(HEADERS)

    targets = []
    if domain in ("both", "europe"):
        targets.append("europe")
    if domain in ("both", "france"):
        targets.append("france")

    for dom_key in targets:
        cfg = GRIB_CONFIG[dom_key]
        log("Traitement domaine %s (%s, produit %s)..." % (dom_key, cfg["label"], cfg["product"]))
        fields = collect_fields(session, run_dt, max_lead,
                                product=cfg["product"],
                                blocks=cfg["blocks"],
                                lead_min=lead_min, lead_max=lead_max)
        render_domain(fields, run_dt, cfg["domain"],
                      os.path.join(base, cfg["out_dir_name"], "maps"),
                      cfg["label"], cfg["resolution"],
                      lead_min=lead_min, lead_max=lead_max)

    print("[ARPEGE] Pipeline terminé avec succès.", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser(
        description="Pipeline ARPEGE Europe & France (produit GLOB025)")
    ap.add_argument("--max-hours", type=int, default=MAX_LEAD,
                    help="Échéance max ARPEGE en heures (défaut 102)")
    ap.add_argument("--domain", choices=["both", "europe", "france"],
                    default="both",
                    help="Domaine(s) à générer : both (défaut), europe, france")
    ap.add_argument("--lead-min", type=int, default=0,
                    help="Échéance de début")
    ap.add_argument("--lead-max", type=int, default=None,
                    help="Échéance de fin")
    ap.add_argument("--run-time", type=str, default=None,
                    help="Timestamp ISO du run fixé (ex: 2026-08-27T18:00:00Z)")
    args = ap.parse_args()
    run_all(max_hours=args.max_hours, domain=args.domain,
            lead_min=args.lead_min, lead_max=args.lead_max,
            run_time=args.run_time)


if __name__ == "__main__":
    main()
