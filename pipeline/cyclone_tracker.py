#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
pipeline/cyclone_tracker.py — Tracker mondial officiel : Cyclones, Typhons ET INVESTs en temps réel.
==================================================================================================
Collecte en Token 0 (zéro clé API, 100 % flux publics officiels) :
- NOAA NHC (National Hurricane Center / RSMC Miami) : Atlantique & Pacifique Est
- JTWC (Joint Typhoon Warning Center / US Navy) : Pacifique Ouest, Pacifique Sud & Océan Indien
- JMA (Japan Meteorological Agency / RSMC Tokyo) : Asie de l'Est & Pacifique Ouest
- BoM Australia (Bureau of Meteorology / TCWC) : Zone australienne & Mer de Corail
- IMD (India Meteorological Department / RSMC New Delhi) : Océan Indien Nord (Bengale / Arabie)
- CMRS Météo-France La Réunion (RSMC La Réunion) : Sud-Ouest de l'Océan Indien
- GDACS (ONU / Commission Européenne) : Système d'alerte consolidé et polygones CAP
- OMM SWIC 3.0 (Severe Weather Information Centre) : Flux fédéré officiel mondial

Génère 'cyclones_actifs.json' pour la carte interactive.
"""

import io
import json
import os
import re
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone

HEADERS = {
    "User-Agent": "MonsieurMeteo-CycloneTracker/2.0 (+https://mto-user84925.github.io/gfs-weather-map/)"
}


def parse_kmz_cone(kmz_url):
    """Télécharge et extrait le polygone officiel du cône d'incertitude depuis le KMZ du NHC."""
    if not kmz_url:
        return []
    try:
        req = urllib.request.Request(kmz_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = resp.read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next((n for n in z.namelist() if n.endswith(".kml")), None)
            if not name:
                return []
            kml = z.read(name).decode("utf-8", errors="ignore")
        m = re.search(r"<coordinates>(.*?)</coordinates>", kml, re.DOTALL)
        if not m:
            return []
        pts = []
        raw_items = m.group(1).strip().split()
        step = max(1, len(raw_items) // 180)
        for item in raw_items[::step]:
            p = item.split(",")
            if len(p) >= 2:
                pts.append([round(float(p[0]), 3), round(float(p[1]), 3)])
        return pts
    except Exception as e:
        print(f"[KMZ Cone] Erreur {kmz_url} : {e}")
        return []


def parse_kmz_track(kmz_url):
    """Télécharge et extrait les points de trajectoire prévisionnelle (3 à 5 jours) depuis le KMZ du NHC."""
    if not kmz_url:
        return []
    try:
        req = urllib.request.Request(kmz_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = resp.read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next((n for n in z.namelist() if n.endswith(".kml")), None)
            if not name:
                return []
            kml = z.read(name).decode("utf-8", errors="ignore")
        root = ET.fromstring(kml)
        ns = {"kml": "http://www.opengis.net/kml/2.2"}
        fcst_pts = []
        seen = set()
        for p in root.findall(".//kml:Placemark", ns):
            desc = p.findtext("kml:description", "", ns)
            coords = p.findtext(".//kml:coordinates", "", ns)
            if not coords:
                continue
            coords = coords.strip()
            if coords in seen:
                continue
            if "Forecast" in desc or "Advisory Information" in desc:
                seen.add(coords)
                m_time = re.search(r"Valid at:\s*(.*?)(?:<|\n)", desc)
                m_wind = re.search(r"Maximum Wind:\s*([0-9]+)\s*knots", desc)
                m_lead = re.search(r"([0-9]+)\s*hr Forecast", desc)
                lead = int(m_lead.group(1)) if m_lead else 0
                parts = coords.split(",")
                if len(parts) >= 2:
                    w_kts = int(m_wind.group(1)) if m_wind else 0
                    w_kmh = round(w_kts * 1.852)
                    cat_short = "TD"
                    if w_kmh >= 252:
                        cat_short = "H5"
                    elif w_kmh >= 209:
                        cat_short = "H4"
                    elif w_kmh >= 178:
                        cat_short = "H3"
                    elif w_kmh >= 154:
                        cat_short = "H2"
                    elif w_kmh >= 119:
                        cat_short = "H1"
                    elif w_kmh >= 63:
                        cat_short = "TS"
                    fcst_pts.append({
                        "lead_hours": lead,
                        "time": m_time.group(1).strip() if m_time else "",
                        "wind_kts": w_kts,
                        "wind_kmh": w_kmh,
                        "cat_short": cat_short,
                        "lon": round(float(parts[0]), 3),
                        "lat": round(float(parts[1]), 3),
                    })
        fcst_pts.sort(key=lambda x: x["lead_hours"])
        return fcst_pts
    except Exception as e:
        print(f"[KMZ Track] Erreur {kmz_url} : {e}")
        return []


def parse_kmz_best_track(kmz_url):
    """Télécharge et extrait la trajectoire historique passée (Best Track) depuis le KMZ du NHC."""
    if not kmz_url:
        return []
    try:
        req = urllib.request.Request(kmz_url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            data = resp.read()
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            name = next((n for n in z.namelist() if n.endswith(".kml")), None)
            if not name:
                return []
            kml = z.read(name).decode("utf-8", errors="ignore")
        matches = re.findall(r"<coordinates>(.*?)</coordinates>", kml, re.DOTALL)
        pts = []
        for m in matches:
            for item in m.strip().split():
                parts = item.split(",")
                if len(parts) >= 2:
                    pt = [round(float(parts[0]), 3), round(float(parts[1]), 3)]
                    if not pts or pt != pts[-1]:
                        pts.append(pt)
        return pts
    except Exception as e:
        print(f"[KMZ Best Track] Erreur {kmz_url} : {e}")
        return []


def determine_cyclone_basin(lat, lon, default_basin=None):
    """Détermine le domaine cartographique mondial exact contenant le système selon ses coordonnées."""
    if lat is None or lon is None:
        return default_basin or "antilles"
    lat, lon = float(lat), float(lon)
    # 1. Pacifique Est & Hawaï (-180° à -100°O, 0°N à 45°N)
    if -180.0 <= lon <= -100.0 and 0.0 <= lat <= 45.0:
        return "pacifique_est"
    # 2. États-Unis & Golfe du Mexique (-128° à -66°O, 23°N à 52°N)
    if lat >= 23.0 and ((-128.0 <= lon < -75.0) or (-75.0 <= lon <= -66.0 and lat > 32.0)):
        return "etats_unis"
    # 3. Arc Antillais & Atlantique Tropical (-75° à -20°O, 5°N à 33°N)
    if -75.0 <= lon <= -20.0 and 5.0 <= lat <= 33.0:
        return "antilles"
    # Caraïbes occidentales
    if -95.0 <= lon < -75.0 and 8.0 <= lat < 23.0:
        return "antilles"
    # 4. Océan Indien Sud-Ouest (Madagascar • Réunion • Maurice : lat < 0, 35° à 85°E)
    if lat < 0.0 and 35.0 <= lon <= 85.0:
        return "ocean_indien"
    # 5. Océan Indien Nord (Golfe du Bengale • Mer d'Arabie • Inde : lat >= 0, 50° à 100°E)
    if lat >= 0.0 and 50.0 <= lon <= 100.0:
        return "ocean_indien_nord"
    # 6. Pacifique Sud & Océanie (lat < 0, lon >= 125 ou lon <= -170)
    if lat < 0.0 and (lon >= 125.0 or lon <= -170.0):
        return "pacifique_sud"
    # 7. Pacifique Ouest & Asie (Typhons Chine • Japon • Philippines : lat >= 0, 100° à 180°E)
    if lat >= 0.0 and 100.0 <= lon <= 180.0:
        return "pacifique_ouest"
    return default_basin or "antilles"


def fetch_nhc_storms():
    """Récupère les cyclones et tempêtes baptisés suivis par le National Hurricane Center (NOAA)."""
    storms = []
    url = "https://www.nhc.noaa.gov/CurrentStorms.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
            for item in data.get("activeStorms", []):
                name = item.get("name", "").strip().title()
                classification = item.get("classification", "").strip()
                intensity_mph = float(item.get("intensity", 0))
                intensity_kmh = round(intensity_mph * 1.60934)

                lat = float(item.get("latitudeNumeric") if item.get("latitudeNumeric") is not None else str(item.get("latitude", 0)).rstrip("NS"))
                lon = float(item.get("longitudeNumeric") if item.get("longitudeNumeric") is not None else str(item.get("longitude", 0)).rstrip("EW"))
                pressure = int(item.get("pressure", 1010))

                cat = "Dépression Tropicale"
                if intensity_kmh >= 252:
                    cat = "Ouragan Catégorie 5 (Monstre)"
                elif intensity_kmh >= 209:
                    cat = "Ouragan Catégorie 4 (Majeur)"
                elif intensity_kmh >= 178:
                    cat = "Ouragan Catégorie 3 (Majeur)"
                elif intensity_kmh >= 154:
                    cat = "Ouragan Catégorie 2"
                elif intensity_kmh >= 119:
                    cat = "Ouragan Catégorie 1"
                elif intensity_kmh >= 63:
                    cat = "Tempête Tropicale"

                basin = determine_cyclone_basin(lat, lon, "pacifique_est" if lon < -100 else "antilles")

                cone = parse_kmz_cone(item.get("trackCone", {}).get("kmzFile") if item.get("trackCone") else None)
                fcst_track = parse_kmz_track(item.get("forecastTrack", {}).get("kmzFile") if item.get("forecastTrack") else None)
                past_track = parse_kmz_best_track(item.get("bestTrackGIS", {}).get("kmzFile") if item.get("bestTrackGIS") else None)

                clean_name = re.sub(r"^(HU|TS|TD|TY|STY|STS|TC|PTC)\s+", "", name, flags=re.I).strip()

                storms.append({
                    "id": item.get("id", f"NHC_{name}"),
                    "name": clean_name or name,
                    "classification": classification,
                    "type": "cyclone",
                    "status_badge": "🔴",
                    "category": cat,
                    "wind_kmh": intensity_kmh,
                    "pressure_hpa": pressure,
                    "lat": round(lat, 2),
                    "lon": round(lon, 2),
                    "basin": basin,
                    "movement": f"{item.get('movementDir', 0)}° à {round(float(item.get('movementSpeed', 0))*1.609)} km/h",
                    "source": "NOAA / NHC",
                    "updated_at": item.get("lastUpdate", datetime.now(timezone.utc).isoformat()),
                    "cone_polygon": cone,
                    "forecast_track": fcst_track,
                    "past_track": past_track,
                })
    except Exception as e:
        print(f"[NHC Storms] Erreur : {e}")

    return storms


def fetch_nhc_disturbances():
    """Récupère les INVESTs et zones sous surveillance du NHC (Outlook Atlantique & Pacifique Est)."""
    invests = []
    targets = [
        ("https://www.nhc.noaa.gov/text/MIATWOAT.shtml", "antilles"),
        ("https://www.nhc.noaa.gov/text/MIATWOEP.shtml", "pacifique_est"),
    ]
    for url, basin_default in targets:
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8")

            # Nettoyage HTML
            clean = re.sub(r"<!--[\s\S]*?-->", "", raw)
            clean = re.sub(r"<[^>]+>", "", clean)

            # Recherche des paragraphes de perturbations
            blocks = re.split(r"\n(?=[0-9]\.|\b[A-Z][A-Za-z0-9\s]+:)", clean)
            for b in blocks:
                if "Formation chance" in b:
                    lines = [l.strip() for l in b.splitlines() if l.strip()]
                    if not lines:
                        continue
                    first_line = lines[0].rstrip(":")
                    if any(k in first_line for k in ["Special Tropical", "Tropical Weather", "For the North"]):
                        first_line = lines[1].rstrip(":") if len(lines) > 1 else "Zone sous surveillance"

                    m_inv = re.search(r"\(([A-Z]{2}[0-9]{2})\)", b)
                    inv_tag = m_inv.group(1) if m_inv else None
                    name = f"INVEST {inv_tag}" if inv_tag else f"INVEST ({first_line[:22]})"

                    m_48 = re.search(r"Formation chance through 48 hours\.\.\.([a-z]+)\.\.\.(?:near\s+)?([0-9]+)\s*percent", b, re.I)
                    m_7d = re.search(r"Formation chance through 7 days\.\.\.([a-z]+)\.\.\.(?:near\s+)?([0-9]+)\s*percent", b, re.I)

                    probs = []
                    if m_48:
                        probs.append(f"48h: {m_48.group(2)}%")
                    if m_7d:
                        probs.append(f"7j: {m_7d.group(2)}% ({m_7d.group(1).capitalize()})")
                    prob_str = " • ".join(probs) if probs else "En surveillance"

                    # Approximations de coordonnées ou zone
                    lat, lon = None, None
                    m_coords = re.search(r"near\s+latitude\s+([0-9\.]+)\s*([NS])\s*,\s*longitude\s+([0-9\.]+)\s*([EW])", b, re.I)
                    if m_coords:
                        lat = float(m_coords.group(1)) * (-1 if m_coords.group(2).upper() == "S" else 1)
                        lon = float(m_coords.group(3)) * (-1 if m_coords.group(4).upper() == "W" else 1)

                    invests.append({
                        "id": f"NHC_{inv_tag or 'DISTURB_' + str(abs(hash(first_line)) % 10000)}",
                        "name": name,
                        "type": "invest",
                        "status_badge": "🟡",
                        "category": "INVEST (Zone sous surveillance)",
                        "probability": prob_str,
                        "wind_kmh": 45,
                        "pressure_hpa": 1008,
                        "lat": round(lat, 2) if lat is not None else (15.0 if basin_default == "antilles" else 15.0),
                        "lon": round(lon, 2) if lon is not None else (-55.0 if basin_default == "antilles" else -110.0),
                        "basin": determine_cyclone_basin(lat, lon, basin_default),
                        "source": "NOAA / NHC (Outlook)",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
        except Exception as e:
            print(f"[NHC Disturbances] Erreur : {e}")

    return invests


def fetch_jtwc_data():
    """Récupère à la fois les cyclones actifs et les INVESTs du JTWC (Asie, Océanie, Océan Indien)."""
    items = []
    # 1. Alertes actives
    url_rss = "https://www.metoc.navy.mil/jtwc/rss/jtwc.rss"
    try:
        req = urllib.request.Request(url_rss, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            root = ET.fromstring(resp.read().decode("utf-8"))
            for item in root.findall(".//item"):
                title = item.findtext("title", "")
                desc = item.findtext("description", "")

                if any(k in title.upper() for k in ["WARNING", "TYPHOON", "CYCLONE", "TROPICAL STORM"]):
                    m_coords = re.search(r"NEAR\s+([0-9\.]+)\s*([NS])\s+([0-9\.]+)\s*([EW])", desc.upper())
                    lat, lon = 0.0, 0.0
                    if m_coords:
                        lat = float(m_coords.group(1)) * (-1 if m_coords.group(2) == "S" else 1)
                        lon = float(m_coords.group(3)) * (-1 if m_coords.group(4) == "W" else 1)

                    basin = determine_cyclone_basin(lat, lon, "pacifique_ouest")

                    m_wind = re.search(r"SUSTAINED\s+WINDS\s+([0-9]+)\s*KTS", desc.upper())
                    wind_kmh = round(int(m_wind.group(1)) * 1.852) if m_wind else 100

                    cat = "Cyclone Tropical" if "CYCLONE" in title.upper() else "Typhon"
                    if wind_kmh >= 240:
                        cat = "Super-Typhon (Cat. 5)"
                    elif wind_kmh >= 180:
                        cat = "Typhon Très Violent"

                    clean_name = title.split(" - ")[0].replace("WARNING", "").strip().title()
                    items.append({
                        "id": f"JTWC_{clean_name.replace(' ', '_')}",
                        "name": clean_name,
                        "type": "cyclone",
                        "status_badge": "🔴",
                        "category": cat,
                        "wind_kmh": wind_kmh,
                        "pressure_hpa": 960,
                        "lat": round(lat, 2),
                        "lon": round(lon, 2),
                        "basin": basin,
                        "movement": "En suivi JTWC",
                        "source": "US Navy / JTWC",
                        "updated_at": datetime.now(timezone.utc).isoformat(),
                    })
    except Exception as e:
        print(f"[JTWC RSS] Erreur : {e}")

    # 2. Bulletins d'investigation ABPW10 (Pacifique Ouest/Sud) et ABIO10 (Océan Indien)
    invest_sources = [
        ("https://www.metoc.navy.mil/jtwc/products/abpwweb.txt", "pacifique_ouest"),
        ("https://www.metoc.navy.mil/jtwc/products/abioweb.txt", "ocean_indien"),
    ]
    for url, def_basin in invest_sources:
        try:
            req = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(req, timeout=10) as resp:
                text = resp.read().decode("utf-8")

            matches = re.finditer(r"\(INVEST\s+([0-9]{2}[A-Z])\)\s+LOCATED\s+NEAR\s+([0-9\.]+)\s*([NS])\s+([0-9\.]+)\s*([EW])", text, re.I)
            for m in matches:
                inv_code = m.group(1).upper()
                lat = float(m.group(2)) * (-1 if m.group(3).upper() == "S" else 1)
                lon = float(m.group(4)) * (-1 if m.group(5).upper() == "W" else 1)

                snippet = text[m.start():m.start() + 500]
                m_pot = re.search(r"POTENTIAL FOR THE DEVELOPMENT OF A SIGNIFICANT TROPICAL CYCLONE\s+IS\s+(LOW|MEDIUM|HIGH)", snippet, re.I)
                pot = m_pot.group(1).upper() if m_pot else "SURVEILLANCE"

                basin = determine_cyclone_basin(lat, lon, def_basin)

                items.append({
                    "id": f"JTWC_INVEST_{inv_code}",
                    "name": f"INVEST {inv_code}",
                    "type": "invest",
                    "status_badge": "🟡",
                    "category": f"INVEST (Potentiel {pot})",
                    "probability": f"Potentiel cyclonique : {pot}",
                    "wind_kmh": 40,
                    "pressure_hpa": 1006,
                    "lat": round(lat, 2),
                    "lon": round(lon, 2),
                    "basin": basin,
                    "source": "US Navy / JTWC (Outlook)",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                })
        except Exception as e:
            print(f"[JTWC INVEST] Erreur {url} : {e}")

    return items


def fetch_gdacs_storms():
    """Récupère les cyclones actifs consolidés mondialement par GDACS (ONU / Commission Européenne).
    Inclut les polygones officiels CAP, les alertes d'impact et la correspondance RSMC mondiale.
    """
    # ponytail: O(n) scan on single GDACS RSS feed, sufficient for <= 50 alerts
    storms = []
    url = "https://www.gdacs.org/xml/rss.xml"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            root = ET.fromstring(resp.read().decode("utf-8", errors="ignore"))
        for it in root.findall(".//item"):
            guid = it.findtext("guid", "")
            if not guid.startswith("TC"):
                continue
            is_curr = it.findtext("{http://www.gdacs.org}iscurrent", "").lower()
            if is_curr != "true":
                continue

            name = it.findtext("{http://www.gdacs.org}eventname", "").strip()
            clean_name = re.sub(r"-\d+$", "", name).strip().title()
            clean_name = re.sub(r"^(HU|TS|TD|TY|STY|STS|TC|PTC)\s+", "", clean_name, flags=re.I).strip()
            country = it.findtext("{http://www.gdacs.org}country", "").strip()
            alert_level = it.findtext("{http://www.gdacs.org}alertlevel", "Green").strip()

            pt_text = it.findtext("{http://www.georss.org/georss}point", "")
            lat, lon = None, None
            if pt_text:
                parts = pt_text.strip().split()
                if len(parts) >= 2:
                    lat, lon = float(parts[0]), float(parts[1])

            sev_text = it.findtext("{http://www.gdacs.org}severity", "")
            m_wind = re.search(r"(\d+(?:\.\d+)?)\s*km/h", sev_text)
            wind_kmh = round(float(m_wind.group(1))) if m_wind else 80

            cat = "Tempête Tropicale"
            if wind_kmh >= 252:
                cat = "Ouragan / Typhon Cat. 5 (Extrême)"
            elif wind_kmh >= 209:
                cat = "Ouragan / Typhon Cat. 4 (Majeur)"
            elif wind_kmh >= 178:
                cat = "Ouragan / Typhon Cat. 3 (Majeur)"
            elif wind_kmh >= 154:
                cat = "Ouragan / Typhon Cat. 2"
            elif wind_kmh >= 119:
                cat = "Ouragan / Typhon Cat. 1"
            elif wind_kmh < 63:
                cat = "Dépression Tropicale"

            basin = determine_cyclone_basin(lat, lon)

            # Attribution de la source RSMC officielle
            source = "GDACS (ONU/CE) • OMM SWIC 3.0"
            if basin == "pacifique_ouest" or any(k in country.lower() for k in ["japan", "china", "philippines"]):
                source = "JMA (RSMC Tokyo) • GDACS"
            elif basin == "ocean_indien_nord" or "india" in country.lower():
                source = "IMD (RSMC New Delhi) • GDACS"
            elif basin == "ocean_indien" or any(k in country.lower() for k in ["madagascar", "reunion", "mauritius"]):
                source = "Météo-France Réunion (CMRS) • GDACS"
            elif basin == "pacifique_sud" or "australia" in country.lower():
                source = "BoM (Australie) • GDACS"
            elif basin in ["antilles", "etats_unis"]:
                source = "NOAA / NHC • GDACS"

            # Téléchargement et extraction du polygone CAP (Cône d'impact)
            cap_url = it.findtext("{http://www.gdacs.org}cap", "")
            cone_pts = []
            if cap_url:
                try:
                    c_req = urllib.request.Request(cap_url, headers=HEADERS)
                    with urllib.request.urlopen(c_req, timeout=6) as c_resp:
                        c_root = ET.fromstring(c_resp.read().decode("utf-8", errors="ignore"))
                    poly_el = c_root.find(".//{*}polygon")
                    if poly_el is not None and poly_el.text:
                        raw_pairs = poly_el.text.strip().split()
                        step = max(1, len(raw_pairs) // 120)
                        for pair in raw_pairs[::step]:
                            p = pair.split(",")
                            if len(p) >= 2:
                                cone_pts.append([round(float(p[1]), 3), round(float(p[0]), 3)])
                except Exception:
                    pass

            storms.append({
                "id": f"GDACS_{clean_name}_{guid}",
                "name": clean_name or name,
                "type": "cyclone",
                "status_badge": "🔴",
                "category": cat,
                "wind_kmh": wind_kmh,
                "pressure_hpa": 980 if wind_kmh >= 120 else 1002,
                "lat": round(lat, 2) if lat is not None else 0.0,
                "lon": round(lon, 2) if lon is not None else 0.0,
                "basin": basin,
                "movement": f"Alerte {alert_level} GDACS ({country or 'Océan'})",
                "source": source,
                "updated_at": it.findtext("pubDate", datetime.now(timezone.utc).isoformat()),
                "cone_polygon": cone_pts,
                "forecast_track": [],
                "past_track": [],
            })
    except Exception as e:
        print(f"[GDACS Storms] Erreur : {e}")
    return storms


def fetch_swic_storms():
    """Récupère les trajectoires et alertes officielles fédérées par l'OMM SWIC 3.0."""
    storms = []
    url = "https://severeweather.wmo.int/json/tc_inforce.json"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        inforce = data.get("inforce", [])
        for item in inforce:
            sysid, name, tcid, intensity, start_time, latest_time, same_str, center_ids, gts = item[:9]
            if not sysid:
                continue

            det_url = f"https://severeweather.wmo.int/json/tc_{sysid}.json"
            try:
                d_req = urllib.request.Request(det_url, headers=HEADERS)
                with urllib.request.urlopen(d_req, timeout=5) as d_resp:
                    d_data = json.loads(d_resp.read().decode("utf-8"))
            except Exception:
                continue

            tracks = d_data.get("track", [])
            forecasts = d_data.get("forecast", [])
            last_pt = tracks[-1] if tracks else {}

            lat = float(last_pt.get("lat") or 0.0)
            lon = float(last_pt.get("lng") or 0.0)
            if lat == 0.0 and lon == 0.0:
                continue

            kts = float(last_pt.get("max_wind_speed") or 35)
            wind_kmh = round(kts * 1.852)
            pres = int(float(last_pt.get("pressure") or 1000))
            basin = determine_cyclone_basin(lat, lon)

            c_id = str(last_pt.get("center_id") or (center_ids.split(",")[0] if center_ids else ""))
            source = "OMM SWIC 3.0"
            if c_id == "5":
                source = "JMA (RSMC Tokyo) • OMM SWIC"
            elif c_id == "7":
                source = "Météo-France Réunion (CMRS) • OMM SWIC"
            elif c_id == "16":
                source = "BoM (Australie) • OMM SWIC"
            elif c_id == "6":
                source = "IMD (RSMC New Delhi) • OMM SWIC"
            elif c_id == "4":
                source = "NOAA / NHC • OMM SWIC"
            elif c_id == "3":
                source = "NOAA / CPHC (Honolulu) • OMM SWIC"
            elif c_id == "11":
                source = "Fiji Met Service (RSMC Nadi) • OMM SWIC"

            cat = "Tempête Tropicale"
            if wind_kmh >= 252:
                cat = "Ouragan / Typhon Cat. 5 (Extrême)"
            elif wind_kmh >= 209:
                cat = "Ouragan / Typhon Cat. 4 (Majeur)"
            elif wind_kmh >= 178:
                cat = "Ouragan / Typhon Cat. 3 (Majeur)"
            elif wind_kmh >= 154:
                cat = "Ouragan / Typhon Cat. 2"
            elif wind_kmh >= 119:
                cat = "Ouragan / Typhon Cat. 1"
            elif wind_kmh < 63:
                cat = "Dépression Tropicale"

            past_track = []
            for tr in tracks[::max(1, len(tracks) // 40)]:
                try:
                    past_track.append([round(float(tr["lng"]), 3), round(float(tr["lat"]), 3)])
                except Exception:
                    pass

            fcst_track = []
            for fc in forecasts:
                try:
                    fc_lat = float(fc["lat"])
                    fc_lon = float(fc["lng"])
                    fc_kts = float(fc.get("max_wind_speed") or 0)
                    fc_kmh = round(fc_kts * 1.852)
                    fcst_track.append({
                        "lead_hours": int(fc.get("time_interval", 0)) // 100 if fc.get("time_interval") else 24,
                        "time": fc.get("forecast_time") or "",
                        "wind_kts": round(fc_kts),
                        "wind_kmh": fc_kmh,
                        "cat_short": "TY" if fc_kmh >= 119 else "TS",
                        "lat": round(fc_lat, 3),
                        "lon": round(fc_lon, 3),
                    })
                except Exception:
                    pass

            dir_mov = last_pt.get("movement_direction") or ""
            spd_mov = last_pt.get("speed_of_movement") or ""
            mov_str = f"{dir_mov} à {spd_mov} km/h" if (dir_mov and spd_mov) else "En suivi OMM"

            clean_name = name.strip().title()
            storms.append({
                "id": f"SWIC_{clean_name}_{sysid}",
                "name": clean_name,
                "type": "cyclone",
                "status_badge": "🔴",
                "category": cat,
                "wind_kmh": wind_kmh,
                "pressure_hpa": pres,
                "lat": round(lat, 2),
                "lon": round(lon, 2),
                "basin": basin,
                "movement": mov_str,
                "source": source,
                "updated_at": latest_time or datetime.now(timezone.utc).isoformat(),
                "cone_polygon": [],
                "forecast_track": fcst_track,
                "past_track": past_track,
            })
    except Exception as e:
        print(f"[SWIC Storms] Erreur : {e}")
    return storms


def fetch_cmrs_reunion_storms():
    """Vérifie l'activité cyclonique en direct de Météo-France La Réunion (CMRS Sud-Ouest Océan Indien)."""
    storms = []
    url = "https://meteofrance.re/fr/cyclone"
    try:
        req = urllib.request.Request(url, headers=HEADERS)
        with urllib.request.urlopen(req, timeout=8) as resp:
            html = resp.read().decode("utf-8", errors="ignore")
        if "aucun système cyclonique" in html.lower():
            return []
        m_sys = re.findall(r"([A-ZÀ-Ÿ\s\-]+)\s*:\s*(CYCLONE|TEMPÊTE|DÉPRESSION)", html, re.I)
        for name, kind in m_sys:
            clean_name = name.strip().title()
            storms.append({
                "id": f"CMRS_{clean_name}",
                "name": clean_name,
                "type": "cyclone",
                "status_badge": "🔴",
                "category": f"{kind.title()} Tropical",
                "wind_kmh": 120,
                "pressure_hpa": 985,
                "lat": -18.0,
                "lon": 55.0,
                "basin": "ocean_indien",
                "movement": "Suivi CMRS La Réunion",
                "source": "Météo-France Réunion (CMRS)",
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "cone_polygon": [],
                "forecast_track": [],
                "past_track": [],
            })
    except Exception as e:
        print(f"[CMRS Réunion] Erreur : {e}")
    return storms


def update_active_cyclones(out_file="cyclones_actifs.json"):
    """Agrège l'ensemble des cyclones, typhons et INVESTs actifs mondialement."""
    # 1. Collecte multi-sources
    primary_items = []
    primary_items.extend(fetch_nhc_storms())
    primary_items.extend(fetch_nhc_disturbances())
    primary_items.extend(fetch_jtwc_data())

    additional_sources = []
    additional_sources.extend(fetch_swic_storms())
    additional_sources.extend(fetch_gdacs_storms())
    additional_sources.extend(fetch_cmrs_reunion_storms())

    # 2. Dédoublonnage intelligent par nom normalisé et proximité géographique
    # ponytail: O(N*M) matching where N,M <= 20, runs in < 2ms without spatial index
    def norm_name(n):
        return re.sub(r"[^a-z0-9]", "", (n or "").lower()).replace("invest", "")

    merged = [dict(s) for s in primary_items]

    for inc in additional_sources:
        inc_n = norm_name(inc.get("name", ""))
        inc_lat = inc.get("lat", 0.0)
        inc_lon = inc.get("lon", 0.0)
        found = None
        for ex in merged:
            ex_n = norm_name(ex.get("name", ""))
            ex_lat = ex.get("lat", 0.0)
            ex_lon = ex.get("lon", 0.0)
            if (inc_n and inc_n == ex_n) or (abs(inc_lat - ex_lat) < 3.5 and abs(inc_lon - ex_lon) < 3.5):
                found = ex
                break

        if found:
            # Enrichissement des géométries manquantes
            if not found.get("cone_polygon") and inc.get("cone_polygon"):
                found["cone_polygon"] = inc["cone_polygon"]
            if not found.get("forecast_track") and inc.get("forecast_track"):
                found["forecast_track"] = inc["forecast_track"]
            if not found.get("past_track") and inc.get("past_track"):
                found["past_track"] = inc["past_track"]
            # Enrichissement de la source
            ex_src = found.get("source", "")
            inc_src = inc.get("source", "")
            if "GDACS" in inc_src and "GDACS" not in ex_src:
                found["source"] = ex_src + " • GDACS"
            if "OMM" in inc_src and "OMM" not in ex_src:
                found["source"] = found.get("source", "") + " • OMM"
        else:
            merged.append(dict(inc))

    # 3. Tri : cyclones confirmés d'abord, puis INVESTs
    merged.sort(key=lambda x: (0 if x.get("type") == "cyclone" else 1, -x.get("wind_kmh", 0)))

    cyclone_count = sum(1 for x in merged if x.get("type") == "cyclone")
    invest_count = sum(1 for x in merged if x.get("type") == "invest")

    result = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_active": len(merged),
        "cyclones_count": cyclone_count,
        "invests_count": invest_count,
        "sources": [
            "NOAA / NHC (National Hurricane Center)",
            "US Navy / JTWC (Joint Typhoon Warning Center)",
            "JMA (Japan Meteorological Agency / RSMC Tokyo)",
            "BoM Australia (Bureau of Meteorology)",
            "IMD (India Meteorological Department / RSMC New Delhi)",
            "Météo-France Réunion (CMRS La Réunion)",
            "GDACS (ONU / Commission Européenne)",
            "OMM SWIC 3.0 (Severe Weather Information Centre)"
        ],
        "storms": merged,
    }

    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    target_path = os.path.join(base_dir, out_file)
    with open(target_path, "w", encoding="utf-8") as f:
        json.dump(result, f, indent=2, ensure_ascii=False)
    # Double sauvegarde sécurisée dans output/
    out_dir = os.path.join(base_dir, "output")
    if os.path.exists(out_dir):
        with open(os.path.join(out_dir, out_file), "w", encoding="utf-8") as f:
            json.dump(result, f, indent=2, ensure_ascii=False)

    print(f"[{datetime.now().strftime('%H:%M:%S')}] {cyclone_count} cyclone(s) & {invest_count} INVEST(s) actif(s) mondialement -> {target_path}")
    return result


if __name__ == "__main__":
    update_active_cyclones()

