#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assemble.py — Assemble les dalles et génère index.json après parallélisation en 15 groupes.
========================================================================================
Scanne output/gfs/maps, output/gfs_france/maps, output/arpege/maps :
1. Découvre tous les fichiers .webp et .hkv.gz
2. Reconstruit la liste ordonnée des steps (H+00 à H+384) avec valid_time calculé
3. Génère index.json et communes.json pour chaque modèle
"""
import os
import re
import sys
import glob
import json
import datetime

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))

from domains import EUROPE, FRANCE, ANTILLES, ETATS_UNIS, PACIFIQUE_EST, PACIFIQUE_OUEST, PACIFIQUE_SUD, OCEAN_INDIEN, OCEAN_INDIEN_NORD
from render import LAYER_META, write_manifest, write_places
import gfs_open_data
import arpege_open_data
import icon_open_data
import aifs_open_data

_FAMILY_RUN_CACHE = {}


def assemble_model(model_key, domain, meta):
    out_dir = os.path.join(BASE_DIR, "output", model_key, "maps")
    if not os.path.exists(out_dir):
        print("[assemble] Dossier introuvable : %s" % out_dir, flush=True)
        return False

    # ponytail: Cache par famille de modèle et conservation du run_time existant
    # pour garantir la cohérence absolue entre domaines (ex: ifs et ifs_france)
    # et éviter d'écraser un modèle non ciblé par le workflow actif.
    family = "ifs" if ("ifs" in model_key and "aifs" not in model_key) else (
        "aifs" if "aifs" in model_key else (
            "gfs" if "gfs" in model_key else (
                "icon" if "icon" in model_key else "arpege"
            )
        )
    )

    run_dt = None
    if family in _FAMILY_RUN_CACHE:
        run_dt = _FAMILY_RUN_CACHE[family]
    else:
        existing_index = os.path.join(out_dir, "index.json")
        if os.path.exists(existing_index):
            try:
                with open(existing_index, "r", encoding="utf-8") as f:
                    old_meta = json.load(f)
                    if old_meta.get("run_time"):
                        run_dt = datetime.datetime.fromisoformat(old_meta["run_time"])
            except Exception:
                pass

        if run_dt is None:
            if family == "gfs":
                run_dt = gfs_open_data.latest_run()
            elif family == "icon":
                run_dt = icon_open_data.latest_run()
            elif family == "aifs":
                run_dt = aifs_open_data.latest_run()
            elif family == "ifs":
                import ifs_open_data
                run_dt = ifs_open_data.latest_run()
            else:
                run_dt = arpege_open_data.latest_run()

        _FAMILY_RUN_CACHE[family] = run_dt

    meta["run_time"] = run_dt.isoformat()

    # Découvrir toutes les échéances et couches rendues
    # Structure : maps/<layer>/<lead:03d>.webp
    leads = set()
    layer_files = {}  # {lead: {layer: rel_path}}
    probe_files = {}  # {lead: {layer: rel_path}}

    for webp_path in glob.glob(os.path.join(out_dir, "*", "*.webp")):
        layer_dir = os.path.basename(os.path.dirname(webp_path))
        if layer_dir in ("fond", "values") or not os.path.isdir(os.path.dirname(webp_path)):
            continue
        fname = os.path.basename(webp_path)
        m = re.match(r"^(\d{3})\.webp$", fname)
        if not m:
            continue
        lh = int(m.group(1))
        leads.add(lh)
        rel = "maps/%s/%s" % (layer_dir, fname)
        layer_files.setdefault(lh, {})[layer_dir] = rel

    for hkv_path in glob.glob(os.path.join(out_dir, "values", "*", "*.hkv.gz")):
        layer_dir = os.path.basename(os.path.dirname(hkv_path))
        fname = os.path.basename(hkv_path)
        m = re.match(r"^(\d{3})\.hkv\.gz$", fname)
        if not m:
            continue
        lh = int(m.group(1))
        rel = "maps/values/%s/%s" % (layer_dir, fname)
        probe_files.setdefault(lh, {})[layer_dir] = rel

    if not leads:
        print("[assemble] Aucune dalle trouvée dans %s" % out_dir, flush=True)
        return False

    sorted_leads = sorted(leads)
    steps = []
    for lh in sorted_leads:
        valid_dt = run_dt + datetime.timedelta(hours=lh)
        steps.append({
            "lead_hour": lh,
            "valid_time": valid_dt.isoformat(),
            "files": layer_files.get(lh, {}),
            "probes": probe_files.get(lh, {}),
        })

    write_places(domain, out_dir)
    write_manifest(out_dir, steps, meta, domain)
    print("✅ [assemble] %s : %d échéances (H+%03d → H+%03d) assemblées dans %s"
          % (model_key, len(steps), sorted_leads[0], sorted_leads[-1], out_dir),
          flush=True)
    return True


def main():
    print("[assemble] Début de l'assemblage multi-modèles...", flush=True)

    # Calcul des températures minimales (Tn) et maximales (Tx) 24h pour les modèles France
    try:
        import daily_min_max
        daily_min_max.main()
    except Exception as e:
        print("[assemble] Note : daily_min_max non exécuté : %s" % e, flush=True)

    assemble_model("gfs", EUROPE, {
        "model_name": "GFS 0.25° Europe",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_france", FRANCE, {
        "model_name": "GFS 0.25° France",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("arpege", EUROPE, {
        "model_name": "ARPEGE Europe 0.25°",
        "provider": "Météo-France — Open Data (Licence Etalab)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("arpege_france", FRANCE, {
        "model_name": "ARPEGE France 0.1°",
        "provider": "Météo-France — Open Data (Licence Etalab)",
        "resolution": "0.1° (~10 km) • Grille 721×541",
    })
    assemble_model("icon_eu", EUROPE, {
        "model_name": "ICON-EU 7 km Europe",
        "provider": "DWD — open data (opendata.dwd.de)",
        "resolution": "7 km (~0.0625°)",
    })
    assemble_model("icon_eu_france", FRANCE, {
        "model_name": "ICON-EU 7 km France",
        "provider": "DWD — open data (opendata.dwd.de)",
        "resolution": "7 km (~0.0625°)",
    })
    assemble_model("ifs", EUROPE, {
        "model_name": "ECMWF IFS 0.25° Europe",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_france", FRANCE, {
        "model_name": "ECMWF IFS 0.25° France",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs", EUROPE, {
        "model_name": "ECMWF AIFS 0.25° Europe",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_france", FRANCE, {
        "model_name": "ECMWF AIFS 0.25° France",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })

    # ── domaines mondiaux (GFS + IFS + AIFS) ────────────────────────────
    assemble_model("gfs_antilles", ANTILLES, {
        "model_name": "GFS 0.25° Arc Antillais",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_etats_unis", ETATS_UNIS, {
        "model_name": "GFS 0.25° États-Unis",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_antilles", ANTILLES, {
        "model_name": "ECMWF IFS 0.25° Arc Antillais",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_etats_unis", ETATS_UNIS, {
        "model_name": "ECMWF IFS 0.25° États-Unis",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_antilles", ANTILLES, {
        "model_name": "ECMWF AIFS 0.25° Arc Antillais",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_etats_unis", ETATS_UNIS, {
        "model_name": "ECMWF AIFS 0.25° États-Unis",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_pacifique_est", PACIFIQUE_EST, {
        "model_name": "GFS 0.25° Pacifique Est & Hawaï",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_pacifique_est", PACIFIQUE_EST, {
        "model_name": "ECMWF AIFS 0.25° Pacifique Est",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_pacifique_est", PACIFIQUE_EST, {
        "model_name": "ECMWF IFS 0.25° Pacifique Est & Hawaï",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_pacifique_ouest", PACIFIQUE_OUEST, {
        "model_name": "GFS 0.25° Asie de l'Est & Typhons",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_pacifique_ouest", PACIFIQUE_OUEST, {
        "model_name": "ECMWF IFS 0.25° Asie de l'Est / Typhons",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_pacifique_ouest", PACIFIQUE_OUEST, {
        "model_name": "ECMWF AIFS 0.25° Asie de l'Est",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_ocean_indien_nord", OCEAN_INDIEN_NORD, {
        "model_name": "GFS 0.25° Asie du Sud & Inde",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_ocean_indien_nord", OCEAN_INDIEN_NORD, {
        "model_name": "ECMWF IFS 0.25° Asie du Sud & Inde",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_ocean_indien_nord", OCEAN_INDIEN_NORD, {
        "model_name": "ECMWF AIFS 0.25° Asie du Sud & Inde",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_ocean_indien", OCEAN_INDIEN, {
        "model_name": "GFS 0.25° Océan Indien / Mascareignes",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_ocean_indien", OCEAN_INDIEN, {
        "model_name": "ECMWF IFS 0.25° Océan Indien",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_ocean_indien", OCEAN_INDIEN, {
        "model_name": "ECMWF AIFS 0.25° Océan Indien",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("gfs_pacifique_sud", PACIFIQUE_SUD, {
        "model_name": "GFS 0.25° Pacifique Sud & Océanie",
        "provider": "NOAA (NOMADS) — open data",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("ifs_pacifique_sud", PACIFIQUE_SUD, {
        "model_name": "ECMWF IFS 0.25° Pacifique Sud & Océanie",
        "provider": "ECMWF — open data IFS (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })
    assemble_model("aifs_pacifique_sud", PACIFIQUE_SUD, {
        "model_name": "ECMWF AIFS 0.25° Pacifique Sud & Océanie",
        "provider": "ECMWF — open data (data.ecmwf.int)",
        "resolution": "0.25° (~25 km)",
    })

    # Détection précoce mondiale des phénomènes extrêmes J+1 à J+16
    try:
        import detect_extremes_world
        detect_extremes_world.run_world_extreme_detector()
    except Exception as e:
        print("[assemble] Note : detect_extremes_world non exécuté : %s" % e, flush=True)

    # Nettoyage automatique des dalles orphelines pour maintenir l'archive ultra-légère (< 200 Mo)
    prune_stale_files()

    print("[assemble] Assemblage terminé avec succès.", flush=True)


def prune_stale_files():
    """Supprime les anciennes dalles orphelines pour maintenir l'archive ultra-légère (< 200 Mo)."""
    keep_files = set()
    for index_path in glob.glob(os.path.join(BASE_DIR, "output", "*", "maps", "index.json")):
        try:
            with open(index_path, "r", encoding="utf-8") as f:
                data = json.load(f)
            model_root = os.path.dirname(os.path.dirname(index_path))
            for step in data.get("steps", []):
                for rel in step.get("files", {}).values():
                    keep_files.add(os.path.normpath(os.path.join(model_root, rel)))
                for rel in step.get("probes", {}).values():
                    keep_files.add(os.path.normpath(os.path.join(model_root, rel)))
        except Exception:
            pass

    deleted_count = 0
    for p in glob.glob(os.path.join(BASE_DIR, "output", "*", "maps", "**", "*"), recursive=True):
        if os.path.isfile(p):
            fname = os.path.basename(p)
            if fname.endswith((".webp", ".hkv.gz")) and not fname.startswith("fond"):
                if os.path.normpath(p) not in keep_files:
                    try:
                        os.remove(p)
                        deleted_count += 1
                    except Exception:
                        pass
    if deleted_count > 0:
        print("[assemble] Nettoyage : %d dalles orphelines supprimées" % deleted_count, flush=True)


if __name__ == "__main__":
    main()
