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
    assert "amfm-cyclones-wrap" in html, "Conteneur dropdown amfm-cyclones-wrap absent de index.html."
    assert "amfm-cyclones-dropdown" in html, "Menu déroulant amfm-cyclones-dropdown absent de index.html."
    assert "btn-cyclones-dd-master-toggle" in html, "Interrupteur maître dropdown absent de index.html."
    assert "btn-cyclones-dd-show-all" in html, "Bouton tout cocher absent de index.html."
    assert "btn-cyclones-dd-hide-all" in html, "Bouton tout masquer absent de index.html."
    assert "chk-cyclones-dd-cone" in html, "Case à cocher cône absente de index.html."
    assert "chk-cyclones-dd-tracks" in html, "Case à cocher trajectoires absente de index.html."
    assert ".amfm-cyclones-dd-item" in html, "CSS .amfm-cyclones-dd-item manquant dans index.html."
    assert ".cyclone-pill-eye" in html, "CSS .cyclone-pill-eye manquant dans index.html."
    assert ".amfm-btn-storm-eye" in html, "CSS .amfm-btn-storm-eye manquant dans index.html."
    print("✓ index.html valide : Menu déroulant navbar, contrôles rapides et styles présents.")

def check_js_logic():
    js_path = os.path.join(BASE_DIR, "js", "arome-map.js")
    with open(js_path, "r", encoding="utf-8") as f:
        js = f.read()
    
    assert "var hiddenStorms = new Set();" in js, "hiddenStorms Set manquant dans js/arome-map.js."
    assert "function isStormVisible(" in js, "Fonction isStormVisible manquante dans js/arome-map.js."
    assert "function syncCycloneVisibilityUI(" in js, "Fonction syncCycloneVisibilityUI manquante dans js/arome-map.js."
    assert "function renderCyclonesDropdown(" in js, "Fonction renderCyclonesDropdown manquante dans js/arome-map.js."
    assert "if (!isStormVisible(storm)) continue;" in js, "Filtre isStormVisible manquant dans drawCycloneOverlays."
    assert "if (!isStormVisible(s)) continue;" in js, "Filtre isStormVisible manquant dans hasAnyVisibleStorm."
    assert "btn-cyclones-dd-master-toggle" in js, "Wiring master toggle dropdown manquant dans js/arome-map.js."
    assert "btn-cyclones-dd-show-all" in js, "Wiring show all dropdown manquant dans js/arome-map.js."
    assert "btn-cyclones-dd-hide-all" in js, "Wiring hide all dropdown manquant dans js/arome-map.js."
    print("✓ js/arome-map.js valide : Menu déroulant, renderCyclonesDropdown, gestion hiddenStorms et synchronisation UI confirmés.")

if __name__ == "__main__":
    check_cyclone_json()
    check_index_html()
    check_js_logic()
    print(">>> TOUTES LES VÉRIFICATIONS SONT PASSÉES AVEC SUCCÈS. <<<")
