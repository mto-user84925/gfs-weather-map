#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gfs_open_data.py — Pipeline GFS 0.25° (NOAA / NOMADS), open data sans clé
==========================================================================
  - Téléchargement sous-région Europe via filter_gfs_0p25.pl (TLS vérifié,
    timeouts + 3 tentatives, log des erreurs — plus jamais d'échec silencieux).
  - Échéances : H+00 → H+120 pas de 3 h (limite réelle des fichiers 0p25).
  - Rendus : domaine Europe (output/gfs/maps) ET domaine France
    (output/gfs_france/maps) — le téléchargement couvre les deux.
  - Couches physiquement honnêtes : cumuls réels, formules ressentie/humidex,
    humidité & neige au sol décodées correctement (noms cfgrib GFS).
"""
import os
import sys
import json
import time
import tempfile
import datetime
import warnings

import requests
import numpy as np

warnings.filterwarnings("ignore")  # bruit cfgrib/xarray dans les logs CI

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))

from domains import (  # noqa: E402
    EUROPE, FRANCE, ANTILLES, ETATS_UNIS,
    PACIFIQUE_EST, PACIFIQUE_OUEST, PACIFIQUE_SUD,
    OCEAN_INDIEN, OCEAN_INDIEN_NORD,
)
from render import (  # noqa: E402
    LAYER_ORDER, save_webp, write_hkv, write_places, write_manifest,
    render_z500_with_isobars, render_pression_with_isobars,
    render_temperature850_with_isotherms,
    render_vagues_with_wind_arrows,
    render_periode_vagues_with_swell_arrows,
    wind_chill_c, heat_index_c, humidex_c,
)

HEADERS = {"User-Agent": "gfs-weather-map/2.0 (Monsieur Meteo)"}
NOMADS = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfs_0p25.pl"
GFS_REQ_VARS = ["TMP", "DPT", "UGRD", "VGRD", "GUST", "APCP", "CAPE",
                "SNOD", "PRMSL", "PRES", "RH", "TCDC", "LCDC", "MCDC", "HCDC", "HGT"]
# Niveaux demandés au filtre NOMADS
GFS_LEVS = {
    "lev_2_m_above_ground": "on",
    "lev_10_m_above_ground": "on",
    "lev_surface": "on",
    "lev_mean_sea_level": "on",
    "lev_entire_atmosphere": "on",
    "lev_low_cloud_layer": "on",
    "lev_middle_cloud_layer": "on",
    "lev_high_cloud_layer": "on",
    "lev_500_mb": "on",
    "lev_850_mb": "on",
}

# Alias cfgrib GFS → clés canoniques
ALIASES = {
    "t2m": "T2M", "2t": "T2M",
    "d2m": "DPT", "2d": "DPT",
    "r2": "RH", "2r": "RH",
    "u10": "U10", "10u": "U10",
    "v10": "V10", "10v": "V10",
    "gust": "GUST",
    "tp": "APCP", "apcp": "APCP", "prate": "APCP", "cprat": "APCP", "total_precipitation": "APCP",
    "cape": "CAPE", "mcape": "MUCAPE",
    "sde": "SNOD",
    "msl": "PRMSL", "prmsl": "PRMSL",
    "sp": "PRES",
    "tcc": "TCDC",
    "lcc": "LCC", "lcdc": "LCC",
    "mcc": "MCC", "mcdc": "MCC",
    "hcc": "HCC", "hcdc": "HCC",
    "gh": "HGT", "hgt": "HGT", "z": "HGT", "gp": "HGT",
}


def log(msg):
    print("[GFS] " + msg, flush=True)


def latest_run(now=None, need_lead=384):
    """Dernier run GFS (00/06/12/18Z) mature ET dont l'échéance need_lead
    est réellement publiée sur NOMADS (GFS publie par vagues : les échéances
    longues f192-f384 n'arrivent que ~5-6 h après le run — un run mature mais
    incomplet rendrait les chunks 150-384 vides).

    Repli automatique sur le run précédent (comme ARPEGE select_run).
    """
    now = now or datetime.datetime.now(datetime.timezone.utc)
    for _ in range(3):  # au plus 3 runs en arrière (18 h)
        run_h = (now.hour // 6) * 6
        run_dt = now.replace(hour=run_h, minute=0, second=0, microsecond=0)
        if (now - run_dt).total_seconds() < 13500:  # 3 h 45 de maturité min
            run_dt -= datetime.timedelta(hours=6)
        if _lead_available(run_dt, need_lead):
            return run_dt
        log("Run %s incomplet (f%03d indisponible), repli sur le précédent"
            % (run_dt.strftime("%Y-%m-%dT%H:%M:%SZ"), need_lead))
        now = run_dt - datetime.timedelta(seconds=1)  # décale d'un cycle de 6 h
    raise RuntimeError("Aucun run GFS avec f%03d disponible sur NOMADS"
                       % need_lead)


def _lead_available(run_dt, lead, timeout=30):
    """HEAD NOMADS : l'échéance lead du run existe-t-elle (fichier présent) ?"""
    day = run_dt.strftime("%Y%m%d")
    hh = "%02d" % run_dt.hour
    url = ("%s?dir=/gfs.%s/%s/atmos&file=gfs.t%sz.pgrb2.0p25.f%03d"
           "&var_GUST=on&var_APCP=on&lev_10_m_above_ground=on&lev_surface=on"
           % (NOMADS, day, hh, hh, lead))
    try:
        r = requests.head(url, headers=HEADERS, timeout=timeout, verify=True)
        return r.status_code == 200
    except Exception:
        return False


def download_lead(run_dt, lead, light=False):
    """Télécharge le GRIB filtré d'une échéance (3 tentatives, TLS vérifié).

    light=True : uniquement GUST + APCP (échauffement des couches cumulatives).
    """
    day = run_dt.strftime("%Y%m%d")
    hh = "%02d" % run_dt.hour
    # Grille 100% GLOBALE mondiale (360°) : aucun découpage ni bordure sur toute la projection Europe/Lambert
    params = {
        "dir": "/gfs.%s/%s/atmos" % (day, hh),
        "file": "gfs.t%sz.pgrb2.0p25.f%03d" % (hh, lead),
    }
    if light:
        params["var_GUST"] = "on"
        params["var_APCP"] = "on"
        params["lev_10_m_above_ground"] = "on"
        params["lev_surface"] = "on"
    else:
        for v in GFS_REQ_VARS:
            params["var_" + v] = "on"
        params.update(GFS_LEVS)

    last_err = None
    for attempt in range(1, 4):
        try:
            r = requests.get(NOMADS, params=params, headers=HEADERS,
                             timeout=120, verify=True)
            if r.status_code == 200 and len(r.content) > 1000:
                return r.content
            last_err = "HTTP %s (%d octets)" % (r.status_code, len(r.content))
        except Exception as e:  # réseau / TLS
            last_err = "%s" % e
        log("  H+%03d tentative %d/3 échouée : %s" % (lead, attempt, last_err))
        time.sleep(5 * attempt)
    raise RuntimeError("H+%03d : téléchargement impossible (%s)" % (lead, last_err))


def decode_grib(grib_bytes):
    """Décode un GRIB GFS avec eccodes direct → {clé canonique: (values 2D, lat, lon)}."""
    from eccodes import (codes_grib_new_from_file, codes_get,
                         codes_get_array, codes_release)
    cached = {}
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
        tf.write(grib_bytes)
        tmp = tf.name
    try:
        with open(tmp, "rb") as f:
            while True:
                gid = codes_grib_new_from_file(f)
                if gid is None:
                    break
                try:
                    short = codes_get(gid, "shortName").lower()
                    try:
                        levType = codes_get(gid, "typeOfLevel")
                    except Exception:
                        levType = ""
                    try:
                        level = int(codes_get(gid, "level"))
                    except Exception:
                        level = 0

                    ni = int(codes_get(gid, "Ni"))
                    nj = int(codes_get(gid, "Nj"))
                    vals = np.asarray(codes_get_array(gid, "values"), dtype=np.float32)
                    lat2 = np.asarray(codes_get_array(gid, "latitudes"), dtype=np.float64).reshape(nj, ni)
                    lon2 = np.asarray(codes_get_array(gid, "longitudes"), dtype=np.float64).reshape(nj, ni)
                    lat = lat2[:, 0]
                    lon = lon2[0, :]

                    # Température : discrimination stricte 2m / 850 hPa / surface
                    if short in ("t", "tmp"):
                        if levType == "isobaricInhPa" and level == 850:
                            cached["T850"] = (vals.reshape(nj, ni), lat, lon)
                        elif levType == "heightAboveGround" and level == 2:
                            cached["T2M"] = (vals.reshape(nj, ni), lat, lon)
                        elif levType == "surface":
                            cached["TSFC"] = (vals.reshape(nj, ni), lat, lon)
                        continue
                    elif short in ("2t", "t2m"):
                        cached["T2M"] = (vals.reshape(nj, ni), lat, lon)
                        continue

                    # Géopotentiel Z500
                    if short in ("gh", "hgt", "z", "gp"):
                        if levType == "isobaricInhPa" and level == 500:
                            cached["HGT"] = (vals.reshape(nj, ni), lat, lon)
                        continue

                    # Nébulosité totale (colonne entière)
                    if short == "tcc":
                        if levType in ("atmosphere", "entireAtmosphere"):
                            cached["TCDC"] = (vals.reshape(nj, ni), lat, lon)
                        continue

                    key = ALIASES.get(short)
                    if key and key not in cached:
                        cached[key] = (vals.reshape(nj, ni), lat, lon)
                except Exception:
                    pass
                finally:
                    codes_release(gid)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass
    return cached


def layer_field(key, cached):
    """Extrait (values, lat, lon) pour une clé, ou None."""
    return cached.get(key)


_WAVE_CACHE = {}


def download_wave_lead(run_dt, lead):
    """Télécharge le GRIB GFS Wave (HTSGW, UGRD, VGRD surface) pour une échéance."""
    day = run_dt.strftime("%Y%m%d")
    hh = "%02d" % run_dt.hour
    url = "https://nomads.ncep.noaa.gov/cgi-bin/filter_gfswave.pl"
    params = {
        "dir": "/gfs.%s/%s/wave/gridded" % (day, hh),
        "file": "gfswave.t%sz.global.0p25.f%03d.grib2" % (hh, lead),
        "var_HTSGW": "on",
        "var_PERPW": "on",
        "var_DIRPW": "on",
        "var_UGRD": "on",
        "var_VGRD": "on",
        "lev_surface": "on",
    }
    for attempt in range(1, 4):
        try:
            r = requests.get(url, params=params, headers=HEADERS, timeout=60, verify=True)
            if r.status_code == 200 and len(r.content) > 1000:
                return r.content
        except Exception:
            pass
        time.sleep(3 * attempt)
    return None


def infill_coastal_nans(grid_2d, max_dist=4):
    """Extrapolation côtière morphologique : propage les valeurs marines sur les NaN littoraux.
    Limite l'extension à max_dist mailles (~100 km) pour ne JAMAIS envahir l'intérieur des terres.
    """
    if grid_2d is None:
        return None
    grid_2d = np.asarray(grid_2d, dtype=np.float32)
    mask = np.isnan(grid_2d)
    if not np.any(mask) or np.all(mask):
        return grid_2d
    from scipy.ndimage import distance_transform_edt
    dists, indices = distance_transform_edt(mask, return_distances=True, return_indices=True)
    coastal_strip = mask & (dists <= max_dist)
    res = grid_2d.copy()
    res[coastal_strip] = grid_2d[tuple(indices)][coastal_strip]
    return res


_LAND_MASK_CACHE = {}


def get_domain_land_mask(domain, out_dir=None):
    """Retourne un masque booléen (True sur terre, False sur mer) pour le domaine.
    Garantit une frontière terre/mer au pixel près sans jamais laisser déborder la houle sur terre.
    """
    dom_key = getattr(domain, "name", str(domain))
    if dom_key in _LAND_MASK_CACHE:
        return _LAND_MASK_CACHE[dom_key]

    candidates = []
    if out_dir:
        candidates.extend([
            os.path.join(out_dir, "mask_france.png"),
            os.path.join(os.path.dirname(out_dir), "maps", "mask_france.png"),
        ])
    base_output = os.path.join(BASE_DIR, "output")
    for sub in ("gfs_france", "arpege_france", "gfs", "arpege"):
        candidates.append(os.path.join(base_output, sub, "maps", "mask_france.png"))

    from PIL import Image, ImageDraw
    for p in candidates:
        if os.path.exists(p):
            try:
                im = np.asarray(Image.open(p).convert("L"))
                if im.shape == (domain.height, domain.width):
                    mask = (im > 128)
                    _LAND_MASK_CACHE[dom_key] = mask
                    return mask
            except Exception:
                pass

    # Génération autonome et rapide depuis countries-50m.geojson
    countries_file = os.path.join(BASE_DIR, "config", "countries-50m.geojson")
    if os.path.exists(countries_file):
        try:
            W, H = domain.width, domain.height
            mask_img = Image.new("L", (W, H), 0)
            mask_draw = ImageDraw.Draw(mask_img)
            with open(countries_file, encoding="utf-8") as f:
                data = json.load(f)
            for feat in data.get("features", []):
                geom = feat.get("geometry")
                if not geom:
                    continue
                gtype = geom.get("type")
                coords = geom.get("coordinates", [])
                rings = []
                if gtype == "Polygon":
                    rings = coords
                elif gtype == "MultiPolygon":
                    for poly in coords:
                        rings.extend(poly)
                for ring in rings:
                    pts = [domain.project(pt[0], pt[1]) for pt in ring]
                    if len(pts) >= 3:
                        mask_draw.polygon(pts, fill=255)

            lakes_file = os.path.join(BASE_DIR, "config", "lakes-50m.geojson")
            if os.path.exists(lakes_file):
                try:
                    with open(lakes_file, encoding="utf-8") as lf:
                        lakes_data = json.load(lf)
                    for feat in lakes_data.get("features", []):
                        geom = feat.get("geometry")
                        if not geom:
                            continue
                        gtype = geom.get("type")
                        coords = geom.get("coordinates", [])
                        rings = coords if gtype == "Polygon" else [r for poly in coords for r in poly]
                        for ring in rings:
                            pts = [domain.project(pt[0], pt[1]) for pt in ring]
                            if len(pts) >= 3:
                                mask_draw.polygon(pts, fill=0)
                except Exception:
                    pass

            mask = (np.asarray(mask_img) > 128)
            _LAND_MASK_CACHE[dom_key] = mask
            return mask
        except Exception as e:
            log("WARNING: masque terre non généré pour %s (%s)" % (dom_key, e))

    return None


def decode_wave_grib(grib_bytes):
    """Décode les champs GFS Wave (swh, perpw, dirpw, u, v) avec eccodes."""
    if not grib_bytes:
        return None
    from eccodes import (codes_grib_new_from_file, codes_get,
                         codes_get_array, codes_release)
    cached = {}
    with tempfile.NamedTemporaryFile(suffix=".grib2", delete=False) as tf:
        tf.write(grib_bytes)
        tmp = tf.name
    try:
        with open(tmp, "rb") as f:
            while True:
                gid = codes_grib_new_from_file(f)
                if gid is None:
                    break
                try:
                    short = codes_get(gid, "shortName").lower()
                    if short not in ("swh", "u", "v", "perpw", "dirpw"):
                        continue
                    ni = int(codes_get(gid, "Ni"))
                    nj = int(codes_get(gid, "Nj"))
                    vals = np.asarray(codes_get_array(gid, "values"), dtype=np.float32)
                    vals = np.where(vals > 9000, np.nan, vals)
                    lat2 = np.asarray(codes_get_array(gid, "latitudes"), dtype=np.float64).reshape(nj, ni)
                    lon2 = np.asarray(codes_get_array(gid, "longitudes"), dtype=np.float64).reshape(nj, ni)
                    cached[short] = (vals.reshape(nj, ni), lat2[:, 0], lon2[0, :])
                except Exception:
                    pass
                finally:
                    codes_release(gid)
    finally:
        try:
            os.remove(tmp)
        except OSError:
            pass

    if "swh" in cached:
        # Infill littoral continu sur la grille globale pour tous les domaines du monde
        for k in list(cached.keys()):
            val, lat, lon = cached[k]
            cached[k] = (infill_coastal_nans(val), lat, lon)
        return cached
    return None


def get_wave_data(run_dt, lead):
    """Récupère les données de vagues (téléchargement + décodage avec cache mémoire)."""
    if lead not in _WAVE_CACHE:
        try:
            grib_bytes = download_wave_lead(run_dt, lead)
            _WAVE_CACHE[lead] = decode_wave_grib(grib_bytes)
        except Exception as e:
            log("  H+%03d GFS Wave non disponible (%s)" % (lead, e))
            _WAVE_CACHE[lead] = None
    return _WAVE_CACHE.get(lead)


def render_lead(cached, lead, run_dt, domain, out_dir, steps, state):
    """Rend toutes les couches d'une échéance pour un domaine."""
    step = {"lead_hour": lead,
            "valid_time": (run_dt + datetime.timedelta(hours=lead)).isoformat(),
            "files": {},
            "probes": {}}
    t2m = layer_field("T2M", cached)
    t850 = layer_field("T850", cached)
    dpt = layer_field("DPT", cached)
    rh = layer_field("RH", cached)
    u10 = layer_field("U10", cached)
    v10 = layer_field("V10", cached)
    gust = layer_field("GUST", cached)
    apcp = layer_field("APCP", cached)
    cape = layer_field("MUCAPE", cached) or layer_field("CAPE", cached)
    snod = layer_field("SNOD", cached)
    prmsl = layer_field("PRMSL", cached)
    pres = layer_field("PRES", cached)
    tcdc = layer_field("TCDC", cached)
    hgt = layer_field("HGT", cached)

    def save(name, data, extra_hkv=True):
        dst = os.path.join(out_dir, name, "%03d.webp" % lead)
        save_webp(data, name, dst)
        step["files"][name] = "maps/%s/%03d.webp" % (name, lead)
        if extra_hkv:
            write_hkv(data, os.path.join(out_dir, "values", name,
                                         "%03d.hkv.gz" % lead))
            step["probes"][name] = "maps/values/%s/%03d.hkv.gz" % (name, lead)
        state["counts"][name] = state["counts"].get(name, 0) + 1

    def regrid(field, convert=None):
        if field is None:
            return None
        try:
            val, lat, lon = field
            if convert is not None:
                val = convert(val)
            return domain.regrid(val, lat, lon)
        except MemoryError:
            log("  !! MemoryError lors du regrid GFS (H+%03d)" % lead)
            return None

    if t2m is not None:
        t_c = regrid(t2m, lambda v: v - 273.15)
        save("temperature", t_c)
        # Ressentie & humidex (ont besoin du vent / point de rosée)
        wind_kmh = None
        if u10 is not None and v10 is not None:
            spd = np.sqrt(u10[0].astype(np.float32) ** 2
                          + v10[0].astype(np.float32) ** 2) * 3.6
            wind_kmh = domain.regrid(spd, u10[1], u10[2])
        if wind_kmh is not None:
            rh_g = regrid(rh) if rh is not None else None
            felt = t_c.copy()
            if rh_g is not None:
                felt = heat_index_c(t_c, rh_g)
                felt = wind_chill_c(felt, wind_kmh)
            save("temperature_ressentie", felt)
        if dpt is not None:
            td_c = regrid(dpt, lambda v: v - 273.15)
            save("point_rosee", td_c)
            save("humidex", humidex_c(t_c, td_c))

    if t850 is not None:
        t850_c = regrid(t850, lambda v: v - 273.15)
        if t850_c is not None:
            dst_t850 = os.path.join(out_dir, "temperature_850", "%03d.webp" % lead)
            os.makedirs(os.path.dirname(dst_t850), exist_ok=True)
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

    if gust is not None:
        g = regrid(gust, lambda v: v * 3.6)
        save("rafales", g)
        if state.get("max_gust") is None:
            state["max_gust"] = g.copy()
        else:
            state["max_gust"] = np.maximum(state["max_gust"], g)
        save("rafales_cumul", state["max_gust"])

    if tcdc is not None:
        # TCDC GFS déjà exprimé en % (0-100)
        save("nebulosite", regrid(tcdc))

    lcc = cached.get("LCC")
    if lcc is not None:
        save("nuages_bas", regrid(lcc))

    mcc = cached.get("MCC")
    if mcc is not None:
        save("nuages_moyens", regrid(mcc))

    hcc = cached.get("HCC")
    if hcc is not None:
        save("nuages_eleves", regrid(hcc))

    if cape is not None:
        save("mucape", regrid(cape))

    if prmsl is not None:
        p = regrid(prmsl, lambda v: v / 100.0)
        dst_p = os.path.join(out_dir, "pression", "%03d.webp" % lead)
        render_pression_with_isobars(p, dst_p)
        step["files"]["pression"] = "maps/pression/%03d.webp" % lead
        write_hkv(p, os.path.join(out_dir, "values", "pression", "%03d.hkv.gz" % lead))
        state["counts"]["pression"] = state["counts"].get("pression", 0) + 1

    if pres is not None:
        save("pression_surface", regrid(pres, lambda v: v / 100.0))

    if hgt is not None and prmsl is not None:
        z = regrid(hgt, lambda v: v / 10.0)
        p_hpa = regrid(prmsl, lambda v: v / 100.0)
        if z is not None and p_hpa is not None:
            # Style synoptique (défaut, esprit Météociel) : bandes Z500 4 dam + isobares 5 hPa
            dst = os.path.join(out_dir, "geopotentiel_500", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst, style="synoptique")
            step["files"]["geopotentiel_500"] = "maps/geopotentiel_500/%03d.webp" % lead
            state["counts"]["geopotentiel_500"] = state["counts"].get("geopotentiel_500", 0) + 1
            # Style détaillé (option UI) : isobares 1 hPa fins + 5 hPa épais
            dst2 = os.path.join(out_dir, "geopotentiel_500_meteociel", "%03d.webp" % lead)
            render_z500_with_isobars(z, p_hpa, dst2, style="detail")
            step["files"]["geopotentiel_500_meteociel"] = "maps/geopotentiel_500_meteociel/%03d.webp" % lead
            state["counts"]["geopotentiel_500_meteociel"] = state["counts"].get("geopotentiel_500_meteociel", 0) + 1

    if apcp is not None:
        a = regrid(apcp)  # mm sur 3 h
        if a is not None:
            save("pluie_1h", a)
            if state.get("cum_precip") is None:
                state["cum_precip"] = a.copy()
            else:
                state["cum_precip"] = state["cum_precip"] + a
            save("pluie_cumul", state["cum_precip"])
    elif lead == 0:
        zero_p = np.zeros((domain.height, domain.width), dtype=np.float32)
        save("pluie_1h", zero_p)
        save("pluie_cumul", zero_p)
        state["cum_precip"] = zero_p.copy()

    if snod is not None:
        save("neige_au_sol", regrid(snod, lambda v: v * 100.0))

    # Vagues & Vents marins (Style Météociel HD avec infill littoral et flèches fines)
    wave_data = get_wave_data(run_dt, lead)
    if wave_data is not None and "swh" in wave_data:
        is_land = get_domain_land_mask(domain, out_dir)

        try:
            swh_f = wave_data["swh"]
            dirpw_f = wave_data.get("dirpw")
            u_f = wave_data.get("u")
            v_f = wave_data.get("v")

            swh_g = domain.regrid(swh_f[0], swh_f[1], swh_f[2])
            dirpw_g = domain.regrid(dirpw_f[0], dirpw_f[1], dirpw_f[2]) if dirpw_f else None
            u_g = domain.regrid(u_f[0], u_f[1], u_f[2]) if u_f else None
            v_g = domain.regrid(v_f[0], v_f[1], v_f[2]) if v_f else None

            if swh_g is not None and not np.all(np.isnan(swh_g)):
                dst_w = os.path.join(out_dir, "vagues", "%03d.webp" % lead)
                render_vagues_with_wind_arrows(swh_g, dirpw_g, u_g, v_g, dst_w, domain=domain, is_land=is_land)
                step["files"]["vagues"] = "maps/vagues/%03d.webp" % lead

                # Sonde au survol : masquage des terres pour que la sonde disparaisse à l'intérieur
                swh_hkv = swh_g.copy()
                if is_land is not None:
                    swh_hkv[is_land] = np.nan
                write_hkv(swh_hkv, os.path.join(out_dir, "values", "vagues", "%03d.hkv.gz" % lead))
                step["probes"]["vagues"] = "maps/values/vagues/%03d.hkv.gz" % lead
                state["counts"]["vagues"] = state["counts"].get("vagues", 0) + 1
        except Exception as e:
            log("  H+%03d rendu vagues échoué : %s" % (lead, e))

        try:
            if "perpw" in wave_data:
                perpw_f = wave_data["perpw"]
                perpw_g = domain.regrid(perpw_f[0], perpw_f[1], perpw_f[2])
                if perpw_g is not None and not np.all(np.isnan(perpw_g)):
                    dst_p = os.path.join(out_dir, "periode_vagues", "%03d.webp" % lead)
                    # Champ de couleur pur (style Météociel officiel, sans flèches statiques)
                    render_periode_vagues_with_swell_arrows(perpw_g, None, dst_p, domain=domain, is_land=is_land)
                    step["files"]["periode_vagues"] = "maps/periode_vagues/%03d.webp" % lead

                    perpw_hkv = perpw_g.copy()
                    if is_land is not None:
                        perpw_hkv[is_land] = np.nan
                    write_hkv(perpw_hkv, os.path.join(out_dir, "values", "periode_vagues", "%03d.hkv.gz" % lead))
                    step["probes"]["periode_vagues"] = "maps/values/periode_vagues/%03d.hkv.gz" % lead
                    state["counts"]["periode_vagues"] = state["counts"].get("periode_vagues", 0) + 1
        except Exception as e:
            log("  H+%03d rendu période vagues échoué : %s" % (lead, e))

    return step


def warmup_from_cached(cached, domain, state):
    """Applique une échéance antérieure (GUST/APCP) à l'état cumulatif."""
    gust = layer_field("GUST", cached)
    apcp = layer_field("APCP", cached)
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
            state["cum_precip"] = (a.copy() if state["cum_precip"] is None
                                   else state["cum_precip"] + a)
    return state


def warmup_cumulative(run_dt, prior_leads, domain):
    """État cumulatif réel (max_gust, cum_precip) avant le premier lead du lot."""
    state = {"max_gust": None, "cum_precip": None}
    for lh in prior_leads:
        try:
            grib = download_lead(run_dt, lh, light=True)
            cached = decode_grib(grib)
        except Exception as e:
            log("  échauffement H+%03d ignoré (%s)" % (lh, e))
            continue
        warmup_from_cached(cached, domain, state)
    if state["max_gust"] is not None or state["cum_precip"] is not None:
        log("  échauffement cumulatif : %d échéances antérieures traitées"
            % len(prior_leads))
    return state


def run_model(run_dt, domain, out_dir, max_hours, leads, lead_min=0):
    """Exécute le rendu complet d'un modèle (un domaine).

    lead_min > 0 : échauffement du cumul (rafales_cumul / pluie_cumul) avec les
    échéances antérieures (téléchargement léger GUST+APCP), pour que les couches
    cumulatives restent correctes malgré le découpage en chunks parallèles.
    """
    ensure = os.makedirs
    ensure(out_dir, exist_ok=True)
    steps = []
    state = {"counts": {}, "max_gust": None, "cum_precip": None}
    n_ok = 0
    if int(lead_min) > 0:
        prior_leads = [lh for lh in compute_leads(max_hours) if lh < int(lead_min)]
        if prior_leads:
            state = warmup_cumulative(run_dt, prior_leads, domain)
            state["counts"] = {}
    for lh in leads:
        try:
            grib = download_lead(run_dt, lh)
        except Exception as e:
            log("!! H+%03d ignoré (%s)" % (lh, e))
            continue
        try:
            cached = decode_grib(grib)
        except Exception as e:
            log("!! H+%03d : décodage échoué (%s)" % (lh, e))
            continue
        if not cached:
            log("!! H+%03d : aucun champ décodé" % lh)
            continue
        step = render_lead(cached, lh, run_dt, domain, out_dir, steps, state)
        steps.append(step)
        n_ok += 1
        log("  H+%03d OK (%d couches)" % (lh, len(step["files"])))

    if n_ok == 0:
        raise RuntimeError("Aucune échéance rendue pour %s" % out_dir)
    write_places(domain, out_dir)
    write_manifest(out_dir, steps,
                   {"model_name": "GFS 0.25° " + domain.name,
                    "provider": "NOAA (NOMADS) — open data",
                    "resolution": "0.25° (~25 km)",
                    "run_time": run_dt.isoformat()},
                   domain)
    log("Terminé : %d échéances, couches %s" % (
        n_ok, ", ".join("%s=%d" % kv for kv in sorted(state["counts"].items()))))
    return n_ok


def compute_leads(max_hours=384, lead_min=0, lead_max=None):
    """Génère la liste des échéances GFS officielles jusqu'à 384 h (16 jours).
    - 0 → 120 h  : pas fin de 3 h (court terme)
    - 126 → 240 h : pas de 6 h (moyen terme)
    - 252 → 384 h : pas de 12 h (long terme)
    """
    max_h = max(3, min(int(max_hours), 384))
    leads = list(range(0, min(max_h, 120) + 1, 3))
    if max_h > 120:
        h_mid = min(max_h, 240)
        leads.extend(range(126, h_mid + 1, 6))
    if max_h > 240:
        leads.extend(range(252, max_h + 1, 12))

    if lead_min is not None:
        leads = [lh for lh in leads if lh >= int(lead_min)]
    if lead_max is not None:
        leads = [lh for lh in leads if lh <= int(lead_max)]
    return sorted(list(set(leads)))


def run_all(max_hours=384, domain="both", lead_min=0, lead_max=None, run_time=None):
    leads = compute_leads(max_hours, lead_min=lead_min, lead_max=lead_max)
    if not leads:
        log("Aucune échéance à traiter dans l'intervalle [%s, %s]" % (lead_min, lead_max))
        return

    log("Échéances : H+%03d → H+%03d (%d pas)" % (leads[0], leads[-1], len(leads)))

    if run_time:
        try:
            run_dt = datetime.datetime.fromisoformat(run_time)
        except Exception:
            run_dt = datetime.datetime.strptime(run_time, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=datetime.timezone.utc)
    else:
        run_dt = latest_run(need_lead=max_hours)
    log("Run GFS sélectionné : %s" % run_dt.isoformat())

    base = os.path.join(BASE_DIR, "output")
    if domain in ("both", "europe"):
        run_model(run_dt, EUROPE, os.path.join(base, "gfs", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("both", "france"):
        run_model(run_dt, FRANCE, os.path.join(base, "gfs_france", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    # ── domaines mondiaux (ajout pur, sans modifier europe/france) ───────────
    if domain in ("world", "antilles"):
        run_model(run_dt, ANTILLES, os.path.join(base, "gfs_antilles", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "etats_unis"):
        run_model(run_dt, ETATS_UNIS, os.path.join(base, "gfs_etats_unis", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "pacifique_est"):
        run_model(run_dt, PACIFIQUE_EST, os.path.join(base, "gfs_pacifique_est", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "pacifique_ouest"):
        run_model(run_dt, PACIFIQUE_OUEST, os.path.join(base, "gfs_pacifique_ouest", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "ocean_indien_nord"):
        run_model(run_dt, OCEAN_INDIEN_NORD, os.path.join(base, "gfs_ocean_indien_nord", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "ocean_indien"):
        run_model(run_dt, OCEAN_INDIEN, os.path.join(base, "gfs_ocean_indien", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    if domain in ("world", "pacifique_sud"):
        run_model(run_dt, PACIFIQUE_SUD, os.path.join(base, "gfs_pacifique_sud", "maps"),
                  leads[-1], leads, lead_min=lead_min)
    print("[GFS] Pipeline terminé avec succès.", flush=True)


def main():
    import argparse
    ap = argparse.ArgumentParser(description="Pipeline GFS 0.25° Europe & France")
    ap.add_argument("--max-hours", type=int, default=384,
                    help="Échéance max GFS en heures (24-384, défaut 384)")
    ap.add_argument("--domain", choices=["both", "europe", "france",
                                          "antilles", "etats_unis", "ocean_indien", "pacifique_ouest", "pacifique_sud", "pacifique_est", "ocean_indien_nord", "cyclones", "world"],
                    default="both",
                    help="Domaine à générer : both (défaut), europe, france, antilles, etats_unis, world")
    ap.add_argument("--lead-min", type=int, default=0,
                    help="Échéance de début (ex: 0, 39, 75...)")
    ap.add_argument("--lead-max", type=int, default=None,
                    help="Échéance de fin (ex: 36, 72, 108...)")
    ap.add_argument("--run-time", type=str, default=None,
                    help="Timestamp ISO du run fixé (ex: 2026-08-27T18:00:00Z)")
    args = ap.parse_args()
    run_all(max_hours=args.max_hours, domain=args.domain,
            lead_min=args.lead_min, lead_max=args.lead_max,
            run_time=args.run_time)


if __name__ == "__main__":
    main()
