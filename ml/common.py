"""Shared helpers: paths, CPCB AQI maths, Diwali/weather features.  Used by training AND the API."""
import json, re
from pathlib import Path
import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CFG = json.load(open(ROOT / "configs" / "cities.json"))
DIWALI = {int(y): pd.Timestamp(d) for y, d in CFG["diwali_dates"].items()}

# ---------------------------------------------------------------- CPCB AQI (PM2.5 sub-index) --------------
# (pm_lo, pm_hi, aqi_lo, aqi_hi)  CPCB National AQI, 24h PM2.5
BP = [(0, 30, 0, 50), (30, 60, 50, 100), (60, 90, 100, 200), (90, 120, 200, 300), (120, 250, 300, 400), (250, 380, 400, 500)]
CATS = [("Good", 50, "#00B050"), ("Satisfactory", 100, "#92D050"), ("Moderate", 200, "#F2C500"),
        ("Poor", 300, "#FF8C00"), ("Very Poor", 400, "#E53935"), ("Severe", 500, "#7E0023")]
PM_CAT_EDGES = np.array([30, 60, 90, 120, 250])  # category index = searchsorted(edges, pm, 'right') -> 0..5


def pm25_to_aqi(pm):
    """CPCB PM2.5 sub-index (official piece-wise linear formula). Capped at 500 like the CPCB bulletin."""
    pm = np.asarray(pm, dtype=float)
    out = np.full(pm.shape, np.nan)
    for lo, hi, alo, ahi in BP:
        m = (pm >= lo) & (pm <= hi) if hi != 380 else (pm >= lo)
        v = alo + (pm - lo) * (ahi - alo) / (hi - lo)
        out = np.where(m & np.isnan(out), v, out)
    out = np.where(pm > 380, 500, out)
    return np.clip(out, 0, 500)


def aqi_to_pm25(aqi):
    """Invert the PM2.5 sub-index. AQI 500 is a CAPPED value (true PM2.5 may be higher) -> 380."""
    a = np.asarray(aqi, dtype=float)
    out = np.full(a.shape, np.nan)
    for lo, hi, alo, ahi in BP:
        m = (a >= alo) & (a <= ahi)
        v = lo + (a - alo) * (hi - lo) / (ahi - alo)
        out = np.where(m & np.isnan(out), v, out)
    return out


def cat_idx(pm):
    return np.searchsorted(PM_CAT_EDGES, np.asarray(pm, dtype=float), side="right")


def aqi_info(pm):
    pm = float(pm)
    a = int(round(float(pm25_to_aqi(pm))))
    c = CATS[int(cat_idx(pm))]
    return {"pm25": int(round(pm)), "aqi": a, "category": c[0]}


# ---------------------------------------------------------------- geography -----------------------------------
def km_xy(lat, lon, lat0=28.6):
    """Equirectangular km coordinates (fine at city scale)."""
    lat = np.asarray(lat, float); lon = np.asarray(lon, float)
    return np.stack([(lon - 77.0) * 111.32 * np.cos(np.radians(lat0)), (lat - lat0) * 110.57], axis=-1)


def bearing_deg(dx, dy):
    """Compass bearing (0=N, 90=E) of a vector given in km east (dx) / north (dy)."""
    return (np.degrees(np.arctan2(dx, dy)) + 360) % 360


# ---------------------------------------------------------------- features --------------------------------------
STUBBLE_PEAK_DOY = 308  # ~4 Nov : seasonal proxy, NOT live fire counts

GROUPS = {
    "Diwali crackers": ["days_from_diwali", "diwali_night", "diwali_evening_hours", "prev_diwali_offset", "city_prev_offset"],
    "Weather trap (low wind / low mixing layer)": ["ws", "blh", "vent", "blh_min24", "ws_mean24", "temp", "rh", "rain48", "wd_sin", "wd_cos", "temp_drop24"],
    "Farm-fire smoke season": ["stubble", "doy_sin", "doy_cos"],
    "Traffic & daily routine": ["hour_sin", "hour_cos", "dow", "is_weekend"],
    "Local area": ["station_code", "lat", "lon", "station_prior"],
}
CAUSE_NAMES = list(GROUPS.keys())
CRACKER, TRAFFIC, FIRE = CAUSE_NAMES[0], CAUSE_NAMES[3], CAUSE_NAMES[2]

# Season-of-year terms (day-of-year, stubble curve) stand in for the farm-fire / cold-season build-up. Leave-one-Diwali-year-out testing
# (folds 2019, 2021-2024, data < 2025-10 only) gave MAE 63.4 WITH them vs 71.6 without, so they stay.  They are a seasonal PROXY,
# not live fire counts, and the API labels the cause that way.
SEASON_PROXIES = {"stubble", "doy_sin", "doy_cos"}
FIRE_MODELLED = True   # as a seasonal proxy (see above); real FIRMS counts would replace it
OUTLOOK_FEATS = [f for g in GROUPS.values() for f in g]


def load_weather(city):
    """Continuous hourly weather frame (IST) for a city: archive (ERA5) + latest forecast, with derived features."""
    w = pd.read_parquet(ROOT / "data" / "processed" / f"weather_{city}.parquet")
    return w


def derive_weather(raw):
    """raw: index=hour, cols temperature_2m, relative_humidity_2m, wind_speed_10m(km/h), wind_direction_10m, precipitation, boundary_layer_height."""
    d = pd.DataFrame(index=raw.index)
    d["ws"] = raw["wind_speed_10m"]
    d["blh"] = raw["boundary_layer_height"]
    d["temp"] = raw["temperature_2m"]
    d["rh"] = raw["relative_humidity_2m"]
    d["wd"] = raw["wind_direction_10m"]
    d["vent"] = d["ws"] / 3.6 * d["blh"]  # m2/s ventilation index
    d["blh_min24"] = d["blh"].rolling(24, min_periods=12).min()
    d["ws_mean24"] = d["ws"].rolling(24, min_periods=12).mean()
    d["rain48"] = raw["precipitation"].rolling(48, min_periods=12).sum()
    d["wd_sin"] = np.sin(np.radians(d["wd"]))
    d["wd_cos"] = np.cos(np.radians(d["wd"]))
    d["temp_drop24"] = d["temp"].shift(24) - d["temp"]
    return d


def calendar_feats(times):
    """Calendar + Diwali features from a DatetimeIndex (no data needed -> usable for any future date)."""
    t = pd.DatetimeIndex(times)
    f = pd.DataFrame(index=t)
    yrs = t.year
    dd = np.array([DIWALI[y] for y in yrs], dtype="datetime64[ns]")
    # nearest Diwali of this season (a date in Jan-Feb still uses its own year's date -> far away -> clipped)
    since = (t.values - (dd + np.timedelta64(19, "h"))) / np.timedelta64(1, "h")  # hours since Diwali 19:00
    f["since_diwali_h"] = since
    f["days_from_diwali"] = np.floor((t.values - dd) / np.timedelta64(1, "D")).clip(-30, 30)
    f["diwali_evening_hours"] = np.clip(since, -48, 96)
    f["diwali_night"] = ((since >= 0) & (since <= 11)).astype(int)
    doy = t.dayofyear.values
    f["stubble"] = np.exp(-0.5 * ((doy - STUBBLE_PEAK_DOY) / 14.0) ** 2)
    f["doy_sin"] = np.sin(2 * np.pi * doy / 365.25)
    f["doy_cos"] = np.cos(2 * np.pi * doy / 365.25)
    f["hour_sin"] = np.sin(2 * np.pi * t.hour / 24)
    f["hour_cos"] = np.cos(2 * np.pi * t.hour / 24)
    f["dow"] = t.dayofweek
    f["is_weekend"] = (t.dayofweek >= 5).astype(int)
    f["offset_h"] = np.round(since).astype(int)
    return f


# ---------------------------------------------------------------- wind-aware spatial interpolation ----------
class Interpolator:
    """Inverse-distance weighting between stations, boosted for UPWIND stations (smoke drifts downwind).
    weight(cell,station) = d^-power * clip(1 + k * min(ws,15)/15 * cos(bearing(cell->station) - wind_from), 0.2, inf)
    k=0 is plain IDW.  `wd` is the direction the wind comes FROM (0-360), `ws` km/h."""

    def __init__(self, cell_lat, cell_lon, st_lat, st_lon, power=2.0, min_d=0.7):
        c = km_xy(cell_lat, cell_lon); s = km_xy(st_lat, st_lon)
        dx = s[None, :, 0] - c[:, None, 0]; dy = s[None, :, 1] - c[:, None, 1]
        self.d = np.maximum(np.hypot(dx, dy), min_d)
        self.dist = np.hypot(dx, dy)
        b = np.radians(bearing_deg(dx, dy))
        self.sinb, self.cosb = np.sin(b), np.cos(b)
        self.base = self.d ** (-power)

    def weights(self, wd=0.0, ws=0.0, k=0.6, exclude_self=False):
        if k and wd is not None and not np.isnan(wd):
            w_rad = np.radians(wd)
            align = self.cosb * np.cos(w_rad) + self.sinb * np.sin(w_rad)
            f = np.clip(1 + k * min(float(ws), 15.0) / 15.0 * align, 0.2, None)
            W = self.base * f
        else:
            W = self.base.copy()
        if exclude_self:  # leave-one-station-out: cell i is station i
            np.fill_diagonal(W, 0.0)
        return W

    def apply(self, W, vals):
        """vals (S,) -> (C,) ; NaN values are ignored."""
        vals = np.asarray(vals, float)
        ok = ~np.isnan(vals)
        Wm = W * ok[None, :]
        den = Wm.sum(1)
        num = (Wm * np.nan_to_num(vals)[None, :]).sum(1)
        return np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
