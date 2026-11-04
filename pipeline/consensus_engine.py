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
4. Précipitations cumulées : Monotonicité physique stricte (non-décroissance garantie).
5. Précipitations horaires : Taux horaire exact (mm/h) dérivé de la pluie cumulée lissée.
6. MUCAPE : Enveloppe haute pour conserver le risque convectif réel.
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


def nan_weighted_average(stack, weights):
    """Calcule la moyenne pondérée en ignorant les NaN par pixel (renormalisation dynamique)."""
    valid = np.isfinite(stack)
    w_mat = weights[:, None, None] * valid
    w_sum = np.sum(w_mat, axis=0)
    safe_stack = np.where(valid, stack, 0.0)
    w_avg = np.sum(w_mat * safe_stack, axis=0)
    return np.where(w_sum > 0, w_avg / np.where(w_sum > 0, w_sum, 1.0), np.nan).astype(np.float32)


def blend_grids(grid_list, weight_list, layer_name):
    """Combine les grilles selon le type de paramètre physique (résistant aux NaN et limites de domaines)."""
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
    w_avg = nan_weighted_average(stack, weights)

    # 1. Rafales : Enveloppe haute (percentile 75-80) pour ne pas lisser les tempêtes
    if "rafale" in layer_name:
        with np.errstate(all='ignore'):
            p_max = np.nanmax(stack, axis=0)
        return np.where(np.isfinite(w_avg), 0.6 * w_avg + 0.4 * p_max, p_max).astype(np.float32)

    # 2. CAPE / Orages : Enveloppe haute pour préserver le risque convectif
    if "mucape" in layer_name or "cape" in layer_name:
        with np.errstate(all='ignore'):
            p_max = np.nanmax(stack, axis=0)
        return np.where(np.isfinite(w_avg), 0.5 * w_avg + 0.5 * p_max, p_max).astype(np.float32)

    # 3. Précipitations cumulées (pluie_cumul, pluie_24h) : fusion continue sans seuil destructeur
    if layer_name in ("pluie_cumul", "pluie_24h"):
        return w_avg.astype(np.float32)

    # 4. Précipitations instantanées (pluie_1h) : filtre de probabilité pondérée (>=20% de confiance)
    if "pluie" in layer_name:
        valid = np.isfinite(stack)
        w_mat = weights[:, None, None] * valid
        w_sum = np.sum(w_mat, axis=0)
        safe_w = np.where(w_sum > 0, w_mat / np.where(w_sum > 0, w_sum, 1.0), 0.0)
        rain_prob = np.sum(np.where(stack > 0.1, safe_w, 0.0), axis=0)
        with np.errstate(all='ignore'):
            p_max = np.nanmax(stack, axis=0)
        rain_val = np.where(np.isfinite(w_avg), 0.7 * w_avg + 0.3 * p_max, w_avg)
        valid_count = np.sum(valid, axis=0)
        res = np.where(rain_prob >= 0.20, rain_val, 0.0)
        return np.where(valid_count > 0, res, np.nan).astype(np.float32)

    # 5. Tous les autres scalaires (température, pression, point de rosée, humidex, nébulosité...)
    return w_avg.astype(np.float32)


def process_domain_consensus(domain_name, force=False):
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
    all_source_mtimes = []

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
                all_source_mtimes.append(os.path.getmtime(hkv_path))
        if m_dict:
            model_data[m] = m_dict
            print(f"[Consensus] Modèle disponible : {m} ({len(m_dict)} dalles HKV trouvées)", flush=True)

    if not model_data:
        print(f"[Consensus] Aucun modèle source trouvé pour {domain_name}. Ignoré.", flush=True)
        return False

    latest_source_mtime = max(all_source_mtimes) if all_source_mtimes else 0.0

    sorted_leads = sorted(all_leads)
    sorted_layers = sorted(all_layers)
    print(f"[Consensus] Échéances à traiter : {len(sorted_leads)} (H+{sorted_leads[0]:03d} → H+{sorted_leads[-1]:03d})", flush=True)
    print(f"[Consensus] Couches cibles ({len(sorted_layers)}) : {', '.join(sorted_layers)}", flush=True)

    # Récupérer les dimensions cibles depuis domains.py
    dom_obj = domains.FRANCE if domain_name == "france" else domains.EUROPE
    full_w, full_h = dom_obj.width, dom_obj.height

    # Indexation des pas par modèle et couche pour l'interpolation temporelle (comblement 3h -> 1h)
    m_leads_by_layer = {}
    for m, m_dict in model_data.items():
        for (l, lay) in m_dict.keys():
            m_leads_by_layer.setdefault((m, lay), []).append(l)
    for k in m_leads_by_layer:
        m_leads_by_layer[k].sort()

    grid_cache = {}

    def get_grid_normalized(path):
        if path not in grid_cache:
            g = read_hkv(path)
            if g is not None and g.shape != (164, 220):
                im = Image.fromarray(g.astype(np.float32)).resize((220, 164), resample=Image.BILINEAR)
                g = np.array(im)
            grid_cache[path] = g
        return grid_cache[path]

    def get_model_grid(m, lead, layer):
        m_files = model_data.get(m, {})
        if (lead, layer) in m_files:
            return get_grid_normalized(m_files[(lead, layer)])

        # Interpolation temporelle (ex: ARPEGE, GFS, IFS sur les heures 1h d'ICON)
        leads_avail = m_leads_by_layer.get((m, layer), [])
        if not leads_avail:
            return None
        p_leads = [l for l in leads_avail if l < lead]
        n_leads = [l for l in leads_avail if l > lead]
        if not p_leads or not n_leads:
            return None
        p = p_leads[-1]
        n = n_leads[0]
        if (n - p) > 6:
            return None

        gp = get_grid_normalized(m_files[(p, layer)])
        gn = get_grid_normalized(m_files[(n, layer)])
        if gp is None or gn is None:
            return None

        t = (lead - p) / float(n - p)
        return (1.0 - t) * gp + t * gn

    generated_count = 0

    # ── A. TRAITEMENT SÉQUENTIEL DES PRÉCIPITATIONS CUMULÉES & HORAIRES ──
    # Garantit la monotonicité physique absolue (aucune baisse possible)
    # et la cohérence exacte : pluie_1h = cumul(t) - cumul(t-1).
    if "pluie_cumul" in sorted_layers:
        print("[Consensus] Traitement séquentiel de pluie_cumul (garantie de monotonicité)...", flush=True)
        prev_cumul = None
        prev_lead = 0
        for lead in sorted_leads:
            lead_str = f"{lead:03d}"
            hkv_cumul = os.path.join(out_dir, "values", "pluie_cumul", f"{lead_str}.hkv.gz")
            webp_cumul = os.path.join(out_dir, "pluie_cumul", f"{lead_str}.webp")
            hkv_1h = os.path.join(out_dir, "values", "pluie_1h", f"{lead_str}.hkv.gz")
            webp_1h = os.path.join(out_dir, "pluie_1h", f"{lead_str}.webp")

            need_recalc = (
                force or
                not os.path.exists(hkv_cumul) or
                not os.path.exists(webp_cumul) or
                os.path.getmtime(hkv_cumul) < latest_source_mtime
            )

            if not need_recalc:
                prev_cumul = read_hkv(hkv_cumul)
                prev_lead = lead
                continue

            grids = []
            weights = []
            for m in model_data.keys():
                g = get_model_grid(m, lead, "pluie_cumul")
                if g is not None:
                    w = get_model_weight(m, lead)
                    grids.append(g)
                    weights.append(w)

            if grids:
                blended_cumul = blend_grids(grids, weights, "pluie_cumul")
                if blended_cumul is not None:
                    # Enforce strict physical monotonicity
                    if prev_cumul is not None:
                        blended_cumul = np.maximum(prev_cumul, blended_cumul)
                    else:
                        blended_cumul = np.maximum(0.0, blended_cumul)

                    # 1. Sauvegarde pluie_cumul
                    write_hkv(blended_cumul, hkv_cumul)
                    im_full = Image.fromarray(blended_cumul.astype(np.float32)).resize((full_w, full_h), resample=Image.BILINEAR)
                    grid_full = np.array(im_full, dtype=np.float32)
                    save_webp(grid_full, "pluie_cumul", webp_cumul)
                    generated_count += 1

                    # 2. Dérivation stricte de pluie_1h (taux horaire exact en mm/h)
                    dt = max(1, lead - prev_lead)
                    if prev_cumul is not None:
                        hourly_rain = np.maximum(0.0, (blended_cumul - prev_cumul) / float(dt))
                    else:
                        hourly_rain = np.zeros_like(blended_cumul)

                    write_hkv(hourly_rain, hkv_1h)
                    im_1h_full = Image.fromarray(hourly_rain.astype(np.float32)).resize((full_w, full_h), resample=Image.BILINEAR)
                    save_webp(np.array(im_1h_full, dtype=np.float32), "pluie_1h", webp_1h)
                    generated_count += 1

                    prev_cumul = blended_cumul.copy()
                    prev_lead = lead

    # ── B. TRAITEMENT PARALLÈLE DE TOUTES LES AUTRES COUCHES ──
    other_layers = [lay for lay in sorted_layers if lay not in ("pluie_cumul", "pluie_1h")]

    def process_step_layer(item):
        lead, layer = item
        lead_str = f"{lead:03d}"
        hkv_dst = os.path.join(out_dir, "values", layer, f"{lead_str}.hkv.gz")
        webp_dst = os.path.join(out_dir, layer, f"{lead_str}.webp")

        # Skip intelligent basé sur mtime
        if not force and os.path.exists(hkv_dst) and os.path.exists(webp_dst):
            if os.path.getmtime(hkv_dst) >= latest_source_mtime:
                return 0

        grids = []
        weights = []

        for m in model_data.keys():
            g = get_model_grid(m, lead, layer)
            if g is not None:
                w = get_model_weight(m, lead)
                grids.append(g)
                weights.append(w)

        if not grids:
            return 0

        # Fusion mathématique & physique
        blended = blend_grids(grids, weights, layer)
        if blended is None:
            return 0

        # 1. Sauvegarde Sonde HKV
        write_hkv(blended, hkv_dst)

        # 2. Rendu dalle WebP pleine résolution (2200x1640)
        im_full = Image.fromarray(blended.astype(np.float32)).resize((full_w, full_h), resample=Image.BILINEAR)
        grid_full = np.array(im_full, dtype=np.float32)
        save_webp(grid_full, layer, webp_dst)

        return 1

    tasks = [(lead, layer) for lead in sorted_leads for layer in other_layers]
    with ThreadPoolExecutor(max_workers=os.cpu_count() or 4) as pool:
        results = list(pool.map(process_step_layer, tasks))
        generated_count += sum(results)

    print(f"✅ [Consensus] {target_model_key} : {generated_count} dalles WebP/HKV générées avec succès.", flush=True)

    # Création du lien / alias consensus pour rétro-compatibilité
    alias_key = "consensus_france" if domain_name == "france" else "consensus"
    alias_dir = os.path.join(BASE_DIR, "output", alias_key)
    try:
        if force and os.path.exists(alias_dir):
            shutil.rmtree(alias_dir, ignore_errors=True)
        if not os.path.exists(alias_dir):
            shutil.copytree(os.path.join(BASE_DIR, "output", target_model_key), alias_dir, dirs_exist_ok=True)
    except Exception:
        pass

    return True


def main():
    force = "--force" in sys.argv
    print("=================================================================", flush=True)
    print(f" Démarrage du Consensus Météo-Climat Pro (France & Europe) {'[FORCE]' if force else ''}", flush=True)
    print("=================================================================", flush=True)
    t0 = datetime.datetime.now()

    # 1. France & Régions
    process_domain_consensus("france", force=force)

    # 2. Europe Synoptique
    process_domain_consensus("europe", force=force)

    dt = (datetime.datetime.now() - t0).total_seconds()
    print(f"\n[Consensus] Terminé en {dt:.1f} secondes.", flush=True)


if __name__ == "__main__":
    main()
