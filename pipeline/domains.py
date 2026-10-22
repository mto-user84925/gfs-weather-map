#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
domains.py — SOURCE UNIQUE des domaines géographiques et grilles Mercator.
===========================================================================
Tous les modèles (GFS Europe, GFS France, ARPEGE Europe) et le générateur de
fonds utilisent ces domaines. Un seul endroit à modifier.
"""
import numpy as np

# Domaine Europe : projection conique conforme de Lambert (style officiel Météociel GFS/ARPEGE Europe)
# Domaine France : projection Mercator identique au site AROME (métropole + Corse + pays voisins)
DOMAINS = {
    "europe": {
        "projection": "lambert",
        "lat1": 30.0, "lat2": 60.0, "lat0": 50.0, "lon0": -5.0,
        "x_min": -0.5902, "x_max": 0.5902,
        "y_min": -0.4200, "y_max": 0.4600,
        "south": 18.0, "west": -60.0, "north": 75.0, "east": 50.0,
        "width": 2200, "height": 1640,
        "label": "Europe",
    },

    "france": {
        "projection": "mercator",
        "south": 39.5, "west": -8.5, "north": 52.5, "east": 13.5,
        "width": 2200, "height": 1640,
        "label": "France",
    },

    # ── Domaines mondiaux (GFS / ECMWF AIFS uniquement) ─────────────────────
    "antilles": {
        "projection": "mercator",
        "south": 7.0, "west": -75.0, "north": 32.0, "east": -30.0,
        "width": 2200, "height": 1320,
        "label": "Arc Antillais & Atlantique Tropical",
    },
    "etats_unis": {
        "projection": "mercator",
        "south": 23.0, "west": -128.0, "north": 51.85, "east": -66.0,
        "width": 2200, "height": 1320,
        "label": "États-Unis (CONUS)",
    },
    "ocean_indien": {
        "projection": "mercator",
        "south": -28.5, "west": 38.0, "north": -8.5, "east": 74.0,
        "width": 2200, "height": 1320,
        "label": "Océan Indien Sud-Ouest (Madagascar • Réunion • Maurice)",
    },
    "pacifique_ouest": {
        "projection": "mercator",
        "south": 0.0, "west": 100.0, "north": 48.0, "east": 155.0,
        "width": 2200, "height": 1320,
        "label": "Asie de l'Est & Typhons (Chine • Japon • Corée • Taïwan • Philippines)",
    },
    "pacifique_sud": {
        "projection": "mercator",
        "south": -36.0, "west": 130.0, "north": -8.5, "east": 180.0,
        "width": 2200, "height": 1320,
        "label": "Pacifique Sud-Ouest (Nouvelle-Calédonie • Vanuatu • Fidji • Australie)",
    },
    "pacifique_est": {
        "projection": "mercator",
        "south": 2.0, "west": -170.0, "north": 40.0, "east": -100.0,
        "width": 2200, "height": 1320,
        "label": "Pacifique Nord-Est (Ouragans • Mexique • Hawaï)",
    },
    "ocean_indien_nord": {
        "projection": "mercator",
        "south": 2.0, "west": 60.0, "north": 36.0, "east": 98.0,
        "width": 2200, "height": 1320,
        "label": "Asie du Sud & Cyclones (Inde • Sri Lanka • Golfe du Bengale • Mer d'Arabie)",
    },
}


def mercator_y(lat):
    """Y de Mercator (radians) pour une latitude en degrés (bornée ±85°)."""
    lat = np.clip(np.asarray(lat, dtype=np.float64), -85.0, 85.0)
    return np.log(np.tan(np.pi / 4.0 + np.radians(lat) / 2.0))


def inverse_mercator_y(y):
    """Latitude (degrés) depuis un Y de Mercator (radians)."""
    return np.degrees(2.0 * np.arctan(np.exp(y)) - np.pi / 2.0)


def lambert_conformal_direct(lats, lons, lat1=30.0, lat2=60.0, lat0=50.0, lon0=-5.0):
    r_lat1 = np.radians(lat1)
    r_lat2 = np.radians(lat2)
    r_lat0 = np.radians(lat0)
    r_lon0 = np.radians(lon0)
    n = np.log(np.cos(r_lat1) / np.cos(r_lat2)) / np.log(
        np.tan(np.pi / 4.0 + r_lat2 / 2.0) / np.tan(np.pi / 4.0 + r_lat1 / 2.0)
    )
    F = (np.cos(r_lat1) * (np.tan(np.pi / 4.0 + r_lat1 / 2.0) ** n)) / n
    rho0 = F / (np.tan(np.pi / 4.0 + r_lat0 / 2.0) ** n)
    
    r_lats = np.radians(lats)
    r_lons = np.radians(lons)
    rho = F / (np.tan(np.pi / 4.0 + r_lats / 2.0) ** n)
    theta = n * (r_lons - r_lon0)
    x = rho * np.sin(theta)
    y = rho0 - rho * np.cos(theta)
    return x, y


def lambert_conformal_inverse(x, y, lat1=30.0, lat2=60.0, lat0=50.0, lon0=-5.0):
    r_lat1 = np.radians(lat1)
    r_lat2 = np.radians(lat2)
    r_lat0 = np.radians(lat0)
    r_lon0 = np.radians(lon0)
    n = np.log(np.cos(r_lat1) / np.cos(r_lat2)) / np.log(
        np.tan(np.pi / 4.0 + r_lat2 / 2.0) / np.tan(np.pi / 4.0 + r_lat1 / 2.0)
    )
    F = (np.cos(r_lat1) * (np.tan(np.pi / 4.0 + r_lat1 / 2.0) ** n)) / n
    rho0 = F / (np.tan(np.pi / 4.0 + r_lat0 / 2.0) ** n)
    
    rho = np.hypot(x, rho0 - y)
    theta = np.arctan2(x, rho0 - y)
    lons = np.degrees(r_lon0 + theta / n)
    lats = np.degrees(2.0 * np.arctan((F / rho) ** (1.0 / n)) - np.pi / 2.0)
    return lats, lons


class Domain:
    """Grille (2200×1640) précalculée pour un domaine."""

    def __init__(self, name):
        if name not in DOMAINS:
            raise ValueError("Domaine inconnu: %s" % name)
        d = DOMAINS[name]
        self.name = name
        self.projection = d.get("projection", "mercator")
        self.width, self.height = d["width"], d["height"]
        self.south, self.west = d["south"], d["west"]
        self.north, self.east = d["north"], d["east"]
        self.bounds = {"south": self.south, "west": self.west,
                       "north": self.north, "east": self.east,
                       "projection": self.projection}

        if self.projection == "lambert":
            self.lat1, self.lat2 = d["lat1"], d["lat2"]
            self.lat0, self.lon0 = d["lat0"], d["lon0"]
            self.x_min, self.x_max = d["x_min"], d["x_max"]
            self.y_min, self.y_max = d["y_min"], d["y_max"]
            self.bounds.update({
                "lat1": self.lat1, "lat2": self.lat2,
                "lat0": self.lat0, "lon0": self.lon0,
                "x_min": self.x_min, "x_max": self.x_max,
                "y_min": self.y_min, "y_max": self.y_max
            })
            xs = np.linspace(self.x_min, self.x_max, self.width, dtype=np.float64)
            ys = np.linspace(self.y_max, self.y_min, self.height, dtype=np.float64)
            XX, YY = np.meshgrid(xs, ys)
            self.lats, self.lons = lambert_conformal_inverse(
                XX, YY, self.lat1, self.lat2, self.lat0, self.lon0
            )
        else:
            n_y = mercator_y(self.north)
            s_y = mercator_y(self.south)
            lons = np.linspace(self.west, self.east, self.width, dtype=np.float32)
            ys = np.linspace(n_y, s_y, self.height, dtype=np.float32)
            lats = inverse_mercator_y(ys).astype(np.float32)
            self.lons, self.lats = np.meshgrid(lons, lats)

    def project(self, lon, lat):
        """Projette (lon, lat) en pixels (x, y) sur le canvas (2200×1640)."""
        if self.projection == "lambert":
            x, y = lambert_conformal_direct(
                lat, lon, self.lat1, self.lat2, self.lat0, self.lon0
            )
            u = (x - self.x_min) / (self.x_max - self.x_min)
            v = (self.y_max - y) / (self.y_max - self.y_min)
        else:
            ny = mercator_y(self.north)
            sy = mercator_y(self.south)
            u = (lon - self.west) / (self.east - self.west)
            v = (ny - mercator_y(lat)) / (ny - sy)
        return (u * (self.width - 1), v * (self.height - 1))

    def regrid(self, data, src_lats, src_lons, row_chunk=192):
        """Ré-échantillonne un champ natif (lat/lon) sur la grille du domaine.

        Le calcul est fait PAR BLOCS DE LIGNES. scipy.regular_grid_interpolator
        consomme ~6 copies temporaires de la grille complète (2200×1640 =
        3,6 M points → ~22 Mo/série) ; en interpolant les 9+ variables d'une
        échéance simultanément l'empreinte atteignait plusieurs centaines de
        Mo et provoquait des numpy._core._exceptions._ArrayMemoryError sur les
        runners limités en RAM. Le découpage en bandes réduit cette empreinte
        à quelques Mo sans changer le résultat (interpolation exacte, identique).
        """
        from scipy.interpolate import RegularGridInterpolator

        data = np.asarray(data, dtype=np.float32)
        src_lats = np.asarray(src_lats, dtype=np.float64)
        src_lons = np.asarray(src_lons, dtype=np.float64)
        if src_lats[0] > src_lats[-1]:
            src_lats = src_lats[::-1]
            data = data[::-1, :]
        # ponytail: conversion auto 0..360 -> -180..180 et tri strict pour grilles globales
        if src_lons.max() > 180.0:
            src_lons = np.where(src_lons > 180.0, src_lons - 360.0, src_lons)
        diffs = np.diff(src_lons)
        if not (np.all(diffs > 0) or np.all(diffs < 0)):
            order = np.argsort(src_lons)
            src_lons = src_lons[order]
            data = data[:, order]
        if src_lons[0] > src_lons[-1]:
            src_lons = src_lons[::-1]
            data = data[:, ::-1]

        # Si la grille source est globale (GFS/AIFS), clamping pour éviter les bords gris ; si régionale (EURAT01/ICON), NaN hors domaine
        is_global = (src_lons.min() <= -170.0 and src_lons.max() >= 170.0)
        fill_val = None if is_global else np.nan

        interp = RegularGridInterpolator(
            (src_lats, src_lons), data, method="linear",
            bounds_error=False, fill_value=fill_val)

        out = np.empty((self.height, self.width), dtype=np.float32)
        for y0 in range(0, self.height, row_chunk):
            y1 = min(y0 + row_chunk, self.height)
            if is_global:
                pts_lat = np.clip(self.lats[y0:y1], src_lats[0], src_lats[-1])
                pts_lon = np.clip(self.lons[y0:y1], src_lons[0], src_lons[-1])
            else:
                pts_lat = self.lats[y0:y1]
                pts_lon = self.lons[y0:y1]
            pts = np.column_stack((pts_lat.ravel(), pts_lon.ravel()))
            out[y0:y1] = interp(pts).reshape(y1 - y0, self.width)
            del pts
        return out


# Instances partagées
EUROPE = Domain("europe")
FRANCE = Domain("france")
ANTILLES   = Domain("antilles")
ETATS_UNIS = Domain("etats_unis")
OCEAN_INDIEN = Domain("ocean_indien")
PACIFIQUE_OUEST   = Domain("pacifique_ouest")
PACIFIQUE_SUD     = Domain("pacifique_sud")
PACIFIQUE_EST     = Domain("pacifique_est")
OCEAN_INDIEN_NORD = Domain("ocean_indien_nord")

