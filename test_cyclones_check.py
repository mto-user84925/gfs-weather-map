#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
test_cyclones_check.py — Ponytail self-check for official worldwide cyclone sources and UI toggles.
"""

import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def check_cyclone_json():
    json_path = os.path.join(BASE_DIR, "cyclones_actifs.json")
    assert os.path.exists(json_path), f"Fichier {json_path} inexistant."
    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)
    
    assert data.get("total_active", 0) > 0, "Aucun phénomène actif dans cyclones_actifs.json."
    assert "sources" in data, "Clé sources manquante dans cyclones_actifs.json."
    
    sources_str = " ".join(data["sources"])
    for expected in ["NHC", "JTWC", "JMA", "BoM", "IMD", "CMRS", "GDACS", "OMM"]:
        assert expected in sources_str, f"Source attendue '{expected}' absente des sources officielles."
    
    for s in data.get("storms", []):
        assert "id" in s and s["id"], f"ID manquant pour le système {s}."
        assert "name" in s and s["name"], f"Nom manquant pour le système {s}."
        assert "lat" in s and "lon" in s, f"Coordonnées manquantes pour {s['name']}."
        assert "source" in s and s["source"], f"Source manquante pour {s['name']}."
        assert s.get("type") in ["cyclone", "invest"], f"Type invalide pour {s['name']}."

    print(f"✓ cyclones_actifs.json valide : {data['total_active']} systèmes actifs (Sources OMM, GDACS, JMA, IMD, CMRS, NHC, JTWC).")

def check_index_html():
    html_path = os.path.join(BASE_DIR, "index.html")
    with open(html_path, "r", encoding="utf-8") as f:
        html = f.read()
    
    assert "data-amfm-toggle-cyclones" in html, "Bouton global data-amfm-toggle-cyclones absent de index.html."
    assert ".cyclone-pill-eye" in html, "CSS .cyclone-pill-eye manquant dans index.html."
    assert ".amfm-btn-storm-eye" in html, "CSS .amfm-btn-storm-eye manquant dans index.html."
    assert ".amfm-btn-cyclones-toggle-all" in html, "CSS .amfm-btn-cyclones-toggle-all manquant dans index.html."
    print("✓ index.html valide : Bouton global barre d outils et styles de masquage individuel présents.")

def check_js_logic():
    js_path = os.path.join(BASE_DIR, "js", "arome-map.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    
    assert "var hiddenStorms = new Set();" in js, "hiddenStorms Set manquant dans js/arome-map.js."
    assert "function isStormVisible(" in js, "Fonction isStormVisible manquante dans js/arome-map.js."
    assert "function syncCycloneVisibilityUI(" in js, "Fonction syncCycloneVisibilityUI manquante dans js/arome-map.js."
    assert "if (!isStormVisible(storm)) continue;" in js, "Filtre isStormVisible manquant dans drawCycloneOverlays."
    assert "if (!isStormVisible(s)) continue;" in js, "Filtre isStormVisible manquant dans hasAnyVisibleStorm."
    print("✓ js/arome-map.js valide : Gestion hiddenStorms, filtres drawCycloneOverlays et synchronisation UI confirmés.")

if __name__ == "__main__":
    check_cyclone_json()
    check_index_html()
    check_js_logic()
    print(">>> TOUTES LES VÉRIFICATIONS SONT PASSÉES AVEC SUCCÈS. <<<")
