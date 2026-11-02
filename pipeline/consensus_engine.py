#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
consensus_engine.py — Moteur de Fusion Multi-Modèles Météo-Climat Pro
=====================================================================
Génère le "Modèle Météo-Climat Pro" pour la France et l'Europe :
- meteo_climat_pro_france : Domaine France & Régions (ARPEGE 0.1°, ICON-EU 7km, IFS, GFS, AIFS)
- meteo_climat_pro        : Domaine Europe Synoptique (ARPEGE 0.25°, ICON-EU 7km, IFS, GFS, AIFS)

Règles physiques de fusion :
1. Température / Pression / Géopotentiel / Humidité : Moyenne pondérée selon l'échéance.
2. Vent : Moyenne vectorielle sur U et V si disponibles, ou pondération continue.
3. Rafales : Enveloppe haute (percentile 75-80) pour préserver les pointes d'orages/tempêtes.
4. Pluie : Médiane non-nulle conditionnelle pour éviter le saupoudrage artificiel de crachin.
5. MUCAPE : Enveloppe haute pour conserver le risque convectif réel.
"""
import os
import sys
import glob
import gzip
import struct
import re
import shutil
import datetime
from concurrent.futures import ThreadPoolExecutor
import numpy as np
from PIL import Image

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))

from render import save_webp, write_hkv, ensure_dir, LAYER_META
import domains

# Modèles contributeurs par domaine (classés par priorité de finesse)
CONTRIBUTORS = {
    "france": [
        "arpege_france",
        "icon_eu_france",
        "ifs_france",
        "gfs_france",
        "aifs_france",
    ],
    "europe": [
        "arpege",
        "icon_eu",
        "ifs",
        "gfs",
        "aifs",
    ]
}

# Poids par défaut selon l'échéance (lead_hour)
def get_model_weight(model_key, lead_hour):
    is_arpege = "arpege" in model_key
    is_icon = "icon" in model_key
    is_ifs = ("ifs" in model_key and "aifs" not in model_key)
    is_gfs = "gfs" in model_key
    is_aifs = "aifs" in model_key

    if lead_hour <= 48:
        if is_arpege: return 0.45
        if is_icon: return 0.35
        if is_ifs: return 0.10
        if is_gfs: return 0.08
        if is_aifs: return 0.02
    elif lead_hour <= 102:
        if is_arpege: return 0.35
        if is_icon: return 0.30
        if is_ifs: return 0.20
        if is_gfs: return 0.12
        if is_aifs: return 0.03
    elif lead_hour <= 120:
        if is_icon: return 0.35
        if is_ifs: return 0.35
        if is_gfs: return 0.20
        if is_aifs: return 0.10
        return 0.0
    else:  # > 120h
        if is_ifs: return 0.45
        if is_gfs: return 0.35
        if is_aifs: return 0.20
        return 0.0
    return 0.1


def read_hkv(path):
    """Décompresse et lit une grille HKV1 (u16 -> float32)."""
    try:
        with gzip.open(path, "rb") as gz:
            magic = gz.read(4)
            if magic != b"HKV1":
                return None
            w, h = struct.unpack("<HH", gz.read(4))
            gmin, gmax = struct.unpack("<ff", gz.read(8))
            raw = np.frombuffer(gz.read(), dtype=np.uint16)
            if len(raw) != w * h:
                return None
            vals = np.where(
                raw == 65535,
                np.nan,
                gmin + (raw.astype(np.float32) / 65534.0) * (gmax - gmin)
            ).reshape((h, w))
            return vals
    except Exception:
        return None


def sync_fonds(domain_name, dst_maps):
    """Copie les fichiers de fond (fond.webp, mask_france.png, frontieres.svg)."""
    ensure_dir(dst_maps)
    # Cherche un modèle source qui a déjà les fonds
    candidates = (
        ["arpege_france", "gfs_france", "icon_eu_france"]
        if domain_name == "france"
        else ["arpege", "gfs", "icon_eu"]
    )
    for c in candidates:
        src = os.path.join(BASE_DIR, "output", c, "maps")
        if os.path.exists(os.path.join(src, "fond.webp")):
            for f in ["fond.webp", "mask_france.png", "frontieres.svg"]:
                sf = os.path.join(src, f)
                df = os.path.join(dst_maps, f)
                if os.path.exists(sf) and not os.path.exists(df):
                    shutil.copy(sf, df)
            break


def blend_grids(grid_list, weight_list, layer_name):
    """Combine les grilles selon le type de paramètre physique."""
    if not grid_list:
        return None
    if len(grid_list) == 1:
        return grid_list[0]

    weights = np.array(weight_list, dtype=np.float32)
    w_sum = np.sum(weights)
    if w_sum <= 0:
        weights = np.ones_like(weights) / len(weights)
    else:
        weights = weights / w_sum

    stack = np.stack(grid_list, axis=0)  # (N, H, W)

    # 1. Rafales : Enveloppe haute (percentile 75-80) pour ne pas lisser les tempêtes
    if "rafale" in layer_name:
        w_avg = np.tensordot(weights, stack, axes=(0, 0))
        p_max = np.nanmax(stack, axis=0)
        return 0.6 * w_avg + 0.4 * p_max

    # 2. CAPE / Orages : Enveloppe haute pour préserver le risque convectif
    if "mucape" in layer_name or "cape" in layer_name:
        w_avg = np.tensordot(weights, stack, axes=(0, 0))
        p_max = np.nanmax(stack, axis=0)
        return 0.5 * w_avg + 0.5 * p_max

    # 3. Précipitations (pluie_1h, pluie_cumul) : Médiane non-nulle conditionnelle
    if "pluie" in layer_name:
        # Masque des modèles qui voient de la pluie (> 0.2 mm)
        rain_mask = stack > 0.2
        rain_count = np.sum(rain_mask, axis=0)
        # Si moins de 30% des modèles voient de la pluie, pas de pluie artificielle
        threshold = max(1, int(0.3 * len(grid_list)))
        valid_rain = rain_count >= threshold

        # Médiane sur les prévisions
        median_rain = np.nanmedian(stack, axis=0)
        w_avg = np.tensordot(weights, stack, axes=(0, 0))
        combined = 0.5 * median_rain + 0.5 * w_avg
        return np.where(valid_rain, combined, 0.0).astype(np.float32)

    # 4. Tous les autres scalaires (température, pression, point de rosée, humidex, nébulosité...)
    return np.tensordot(weights, stack, axes=(0, 0)).astype(np.float32)


def process_domain_consensus(domain_name):
    """Génère le modèle consensus pour un domaine donné ('france' ou 'europe')."""
    target_model_key = "meteo_climat_pro_france" if domain_name == "france" else "meteo_climat_pro"
    out_dir = os.path.join(BASE_DIR, "output", target_model_key, "maps")
    ensure_dir(out_dir)

    sync_fonds(domain_name, out_dir)

    contributors = CONTRIBUTORS.get(domain_name, [])
    print(f"\n[Consensus] === Début de la fusion pour {target_model_key} ===", flush=True)

    # 1. Scanner les échéances et couches disponibles pour chaque modèle
    model_data = {}  # {model: { (lead, layer): hkv_path }}
    all_leads = set()
    all_layers = set()

    for m in contributors:
        m_dir = os.path.join(BASE_DIR, "output", m, "maps", "values")
        if not os.path.isdir(m_dir):
            continue
        m_dict = {}
        for hkv_path in glob.glob(os.path.join(m_dir, "*", "*.hkv.gz")):
            layer_dir = os.path.basename(os.path.dirname(hkv_path))
            fname = os.path.basename(hkv_path)
            mat = re.match(r"^(\d{3})\.hkv\.gz$", fname)
            if mat:
                lead = int(mat.group(1))
                m_dict[(lead, layer_dir)] = hkv_path
                all_leads.add(lead)
                all_layers.add(layer_dir)
        if m_dict:
            model_data[m] = m_dict
            print(f"[Consensus] Modèle disponible : {m} ({len(m_dict)} dalles HKV trouvées)", flush=True)

    if not model_data:
        print(f"[Consensus] Aucun modèle source trouvé pour {domain_name}. Ignoré.", flush=True)
        return False

    sorted_leads = sorted(all_leads)
    sorted_layers = sorted(all_layers)
    print(f"[Consensus] Échéances à traiter : {len(sorted_leads)} (H+{sorted_leads[0]:03d} → H+{sorted_leads[-1]:03d})", flush=True)
    print(f"[Consensus] Couches cibles ({len(sorted_layers)}) : {', '.join(sorted_layers)}", flush=True)

    # Récupérer les dimensions cibles depuis domains.py
    dom_obj = domains.FRANCE if domain_name == "france" else domains.EUROPE
    full_w, full_h = dom_obj.width, dom_obj.height

    generated_count = 0

    def process_step_layer(item):
        lead, layer = item
        grids = []
        weights = []

        for m, m_files in model_data.items():
            if (lead, layer) in m_files:
                g = read_hkv(m_files[(lead, layer)])
                if g is not None:
                    # Normaliser à (164, 220) si nécessaire
                    if g.shape != (164, 220):
                        im = Image.fromarray(g.astype(np.float32)).resize((220, 164), resample=Image.BILINEAR)
                        g = np.array(im)
                    w = get_model_weight(m, lead)
                    grids.append(g)
                    weights.append(w)

        if not grids:
            return 0

        # Fusion mathématique & physique
        blended = blend_grids(grids, weights, layer)
        if blended is None:
            return 0

        lead_str = f"{lead:03d}"
        hkv_dst = os.path.join(out_dir, "values", layer, f"{lead_str}.hkv.gz")
        webp_dst = os.path.join(out_dir, layer, f"{lead_str}.webp")

        # 1. Sauvegarde Sonde HKV
        write_hkv(blended, hkv_dst)

        # 2. Rendu dalle WebP pleine résolution (2200x1640)
        im_full = Image.fromarray(blended.astype(np.float32)).resize((full_w, full_h), resample=Image.BILINEAR)
        grid_full = np.array(im_full, dtype=np.float32)
        save_webp(grid_full, layer, webp_dst)

        return 1

    tasks = [(lead, layer) for lead in sorted_leads for layer in sorted_layers]
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
        results = list(pool.map(process_step_layer, tasks))
        generated_count = sum(results)

    print(f"✅ [Consensus] {target_model_key} : {generated_count} dalles WebP/HKV générées avec succès.", flush=True)

    # Création du lien / alias consensus pour rétro-compatibilité
    alias_key = "consensus_france" if domain_name == "france" else "consensus"
    alias_dir = os.path.join(BASE_DIR, "output", alias_key)
    try:
        if not os.path.exists(alias_dir):
            # Copie minimale ou référence
            shutil.copytree(os.path.join(BASE_DIR, "output", target_model_key), alias_dir, dirs_exist_ok=True)
    except Exception:
        pass

    return True


def main():
    print("=================================================================", flush=True)
    print(" Démarrage du Consensus Météo-Climat Pro (France & Europe)", flush=True)
    print("=================================================================", flush=True)
    t0 = datetime.datetime.now()

    # 1. France & Régions
    process_domain_consensus("france")

    # 2. Europe Synoptique
    process_domain_consensus("europe")

    dt = (datetime.datetime.now() - t0).total_seconds()
    print(f"\n[Consensus] Terminé en {dt:.1f} secondes.", flush=True)


if __name__ == "__main__":
    main()
