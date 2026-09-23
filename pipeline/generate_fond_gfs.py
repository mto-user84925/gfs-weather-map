#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
generate_fond_gfs.py — Fonds de carte, masque et frontières (par domaine)
==========================================================================
Utilise la SOURCE UNIQUE des domaines (pipeline/domains.py) : les fonds sont
donc parfaitement alignés avec les dalles météo (fini le décalage de ~170 px).
Usage : python pipeline/generate_fond_gfs.py --domain europe|france
"""
import os
import sys
import json
import math
import argparse

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE_DIR, "pipeline"))
from domains import DOMAINS, Domain, mercator_y  # noqa: E402


def project(domain_obj, lon, lat):
    return domain_obj.project(lon, lat)


def iter_rings(geom):
    t = geom["type"]
    if t == "Polygon":
        for ring in geom["coordinates"]:
            yield ring
    elif t == "MultiPolygon":
        for poly in geom["coordinates"]:
            for ring in poly:
                yield ring


def polygon_path(rings, d):
    parts = []
    for ring in rings:
        pts = [project(d, p[0], p[1]) for p in ring]
        if len(pts) < 3:
            continue
        d_ = "M%.1f %.1f " % pts[0] + "L" + \
            " ".join("%.1f %.1f" % p for p in pts[1:]) + "Z"
        parts.append(d_)
    return " ".join(parts)


def line_to_svg(geom, d):
    if geom is None or geom.is_empty:
        return ""
    if geom.geom_type == "LineString":
        pts = [project(d, p[0], p[1]) for p in geom.coords]
        if len(pts) < 2:
            return ""
        return "M%.1f %.1f L%s" % (pts[0][0], pts[0][1],
                                   " ".join("%.1f %.1f" % p for p in pts[1:]))
    if geom.geom_type == "MultiLineString":
        return " ".join(line_to_svg(g, d) for g in geom.geoms if not g.is_empty)
    return ""


def load_json(name):
    with open(os.path.join(BASE_DIR, "config", name), encoding="utf-8") as f:
        return json.load(f)


import shapely.geometry  # noqa: E402
from shapely.ops import unary_union  # noqa: E402
from PIL import Image, ImageDraw  # noqa: E402

OCEAN = (143, 163, 184)
LAND = (237, 234, 226)
BORDER = (160, 165, 170)
NATURAL = "#0b1220"   # côtes / frontières nationales (noir franc)
DEPT = "#7a828e"      # départements (gris fin)
LAND_FRANCE = (232, 228, 218)  # France légèrement distincte


def generate(domain):
    dom = Domain(domain)
    W, H = dom.width, dom.height
    if domain == "europe":
        out_dirs = [
            os.path.join(BASE_DIR, "output", m, "maps")
            for m in ("gfs", "arpege", "aifs", "icon_eu", "ifs")
        ]
    elif domain == "antilles":
        out_dirs = [
            os.path.join(BASE_DIR, "output", m, "maps")
            for m in ("gfs_antilles", "aifs_antilles", "ifs_antilles")
        ]
    elif domain == "etats_unis":
        out_dirs = [
            os.path.join(BASE_DIR, "output", m, "maps")
            for m in ("gfs_etats_unis", "aifs_etats_unis", "ifs_etats_unis")
        ]
    elif domain == "ocean_indien":
        out_dirs = [
            os.path.join(BASE_DIR, "output", m, "maps")
            for m in ("gfs_ocean_indien", "aifs_ocean_indien", "ifs_ocean_indien")
        ]
    elif domain in ("pacifique_ouest", "pacifique_sud", "pacifique_est", "ocean_indien_nord"):
        out_dirs = [
            os.path.join(BASE_DIR, "output", f"gfs_{domain}", "maps"),
            os.path.join(BASE_DIR, "output", f"aifs_{domain}", "maps"),
            os.path.join(BASE_DIR, "output", f"ifs_{domain}", "maps")
        ]
    else:
        out_dirs = [
            os.path.join(BASE_DIR, "output", m, "maps")
            for m in ("gfs_france", "arpege_france", "aifs_france", "icon_eu_france", "ifs_france")
        ]
    for d in out_dirs:
        os.makedirs(d, exist_ok=True)
    out_dir = out_dirs[0]
    print("Fond %s : %s (lon %g..%g, lat %g..%g, %dx%d, proj: %s)"
          % (domain, dom.name, dom.west, dom.east, dom.south,
             dom.north, W, H, dom.projection), flush=True)

    countries = load_json("countries-50m.geojson")
    boundaries = load_json("international-boundaries.geojson")
    coastlines = load_json("coastlines.geojson")
    depts = load_json("departements.geojson")

    # 1) fond.webp + mask_france.png (masque des TERRES)
    img = Image.new("RGB", (W, H), OCEAN)
    draw = ImageDraw.Draw(img)
    mask_img = Image.new("L", (W, H), 0)
    mask_draw = ImageDraw.Draw(mask_img)
    france_names = {"France", "French Guiana"}
    for feat in countries.get("features", []):
        props = feat.get("properties", {})
        name = props.get("NAME") or props.get("ADMIN") or props.get("name") or ""
        geom = feat.get("geometry")
        if not geom:
            continue
        fill = LAND_FRANCE if (name in france_names and domain == "france") else LAND
        for ring in iter_rings(geom):
            pts = [project(dom, p[0], p[1]) for p in ring]
            if len(pts) >= 3:
                draw.polygon(pts, fill=fill)
                mask_draw.polygon(pts, fill=255)

    # Intégration des lacs intérieurs (Grands Lacs américains, Léman, etc.)
    lakes_path = os.path.join(BASE_DIR, "config", "lakes-50m.geojson")
    lakes_d = []
    if os.path.exists(lakes_path):
        lakes = load_json("lakes-50m.geojson")
        for feat in lakes.get("features", []):
            geom = feat.get("geometry")
            if not geom:
                continue
            for ring in iter_rings(geom):
                pts = [project(dom, p[0], p[1]) for p in ring]
                if len(pts) >= 3:
                    draw.polygon(pts, fill=OCEAN)
                    mask_draw.polygon(pts, fill=0)
            lakes_d.append(polygon_path(iter_rings(geom), dom))

    for d in out_dirs:
        img.save(os.path.join(d, "fond.webp"), "WEBP", quality=90)
        mask_img.save(os.path.join(d, "mask_france.png"), "PNG")

    # 2) frontieres.svg (nationales noires + départements gris)
    bounds_box = shapely.geometry.box(dom.west - 0.5, dom.south - 0.5,
                                      dom.east + 0.5, dom.north + 0.5)
    france_shapes = []
    depts_d = []
    if domain == "etats_unis":
        us_states_path = os.path.join(BASE_DIR, "config", "us-states.json")
        if os.path.exists(us_states_path):
            with open(us_states_path, encoding="utf-8") as f:
                us_states = json.load(f)
            state_boundaries = []
            for feat in us_states.get("features", []):
                geom = feat.get("geometry")
                if not geom:
                    continue
                s = shapely.geometry.shape(geom)
                if s.intersects(bounds_box):
                    state_boundaries.append(s.boundary)
            if state_boundaries:
                union_borders = unary_union(state_boundaries)
                depts_d.append(line_to_svg(union_borders, dom))
    else:
        for feat in depts.get("features", []):
            geom = feat.get("geometry")
            if not geom:
                continue
            s = shapely.geometry.shape(geom)
            if not s.intersects(bounds_box):
                continue
            france_shapes.append(s)
            depts_d.append(polygon_path(iter_rings(geom), dom))
    france_union = unary_union(france_shapes) if france_shapes else shapely.geometry.Polygon()
    france_mask = france_union.buffer(0.015) if not france_union.is_empty else shapely.geometry.Polygon()

    def extract_lines(collection):
        out = []
        for feat in collection.get("features", []):
            geom = feat.get("geometry")
            if not geom:
                continue
            s = shapely.geometry.shape(geom)
            if not s.intersects(bounds_box):
                continue
            cleaned = s.intersection(bounds_box).difference(france_mask)
            if cleaned.is_empty:
                continue
            if cleaned.geom_type == "LineString":
                d_ = line_to_svg(cleaned, dom)
                if d_:
                    out.append(d_)
            elif cleaned.geom_type == "MultiLineString":
                for ls in cleaned.geoms:
                    d_ = line_to_svg(ls, dom)
                    if d_:
                        out.append(d_)
        return " ".join(p for p in out if p)

    foreign_boundaries_d = extract_lines(boundaries)
    foreign_coastlines_d = extract_lines(coastlines)
    france_border_d = line_to_svg(france_union.boundary, dom)
    lakes_combined = " ".join(lakes_d).strip()
    national_lines = (foreign_boundaries_d + " " + foreign_coastlines_d
                      + " " + france_border_d + " " + lakes_combined).strip()
    depts_combined = " ".join(depts_d)

    if domain == "france":
        # Style France : frontières et départements noirs nets (style officiel AROME HD)
        nat_stroke = "#000000"
        nat_width = "2.4"
        dept_stroke = "#000000"
        dept_width = "1.2"
        dept_opacity = "0.95"
    elif domain == "etats_unis":
        # Style États-Unis : côtes/frontières nationales noires, frontières des 50 États nettes sans doublons
        nat_stroke = "#000000"
        nat_width = "2.2"
        dept_stroke = "#334155"
        dept_width = "1.2"
        dept_opacity = "0.90"
    else:
        # Style Europe & Monde : lisibilité synoptique d'origine Météociel inchangée
        nat_stroke = NATURAL
        nat_width = "1.8"
        dept_stroke = DEPT
        dept_width = "0.8"
        dept_opacity = "0.85"

    svg = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 %d %d" '
        'width="%d" height="%d">\n'
        '<!-- Côtes, lacs et frontières nationales -->\n'
        '<path d="%s" fill="none" stroke="%s" stroke-width="%s" '
        'stroke-linejoin="round" stroke-linecap="round"/>\n'
        '<!-- Subdivisions / États / Départements -->\n'
        '<path d="%s" fill="none" stroke="%s" stroke-width="%s" '
        'stroke-opacity="%s" stroke-linejoin="round" '
        'stroke-linecap="round"/>\n'
        '</svg>\n' % (W, H, W, H, national_lines, nat_stroke, nat_width,
                      depts_combined, dept_stroke, dept_width, dept_opacity)
    )
    for d in out_dirs:
        with open(os.path.join(d, "frontieres.svg"), "w",
                  encoding="utf-8") as f:
            f.write(svg)
        print("✅ %s : fond.webp, mask_france.png, frontieres.svg générés dans %s"
              % (domain, d), flush=True)


def main():
    ap = argparse.ArgumentParser(description="Fonds de carte par domaine")
    ap.add_argument("--domain", choices=list(DOMAINS) + ["all"], default="europe")
    args = ap.parse_args()
    if args.domain == "all":
        for d in DOMAINS:
            generate(d)
    else:
        generate(args.domain)


if __name__ == "__main__":
    main()
