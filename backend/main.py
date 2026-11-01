"""AirWard API.  Reads the saved forecast files (cache) so heavy traffic on Diwali night only reads memory.
Run:  python -m uvicorn backend.main:app --port 8000        Docs: http://localhost:8000/docs
New city = one entry in configs/cities.json + `python ml/train.py <city>` (the API discovers backend/app_data/<city>/)."""
import json, sys, functools, re
from pathlib import Path
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
from common import CFG, CAUSE_NAMES, CRACKER, TRAFFIC, FIRE, CATS, Interpolator, aqi_info, km_xy, FIRE_MODELLED  # noqa: E402

APP_DATA = ROOT / "backend" / "app_data"
MODEL_NAME = "LightGBM quantile (P10/P50/P90) + SHAP-style cause groups; AirWard v1"
CAUSE_HELP = {
    "Diwali crackers": "Extra pollution around Diwali timing",
    "Weather trap (low wind / low mixing layer)": "Low wind and a low mixing layer keep smoke near the ground",
    "Farm-fire smoke season": "Late Oct-mid Nov crop-burning season (a seasonal curve, not live fire counts)",
    "Traffic & daily routine": "Rush hours and time of day (a time-of-day proxy, not traffic counts)",
    "Local area": "This neighbourhood's usual level",
}
ACTION = {"Severe": "Water sprinklers + traffic diversion", "Very Poor": "Patrol for cracker use", "Poor": "Public advisory"}


class City:
    def __init__(self, key):
        self.key = key
        self.cfg = CFG["cities"][key]
        d = APP_DATA / key
        self.res = json.load(open(d / "results.json"))
        self.fc = json.load(open(d / "forecast_diwali2026.json"))
        self.contrib = json.load(open(d / "contrib_diwali2026.json"))
        self.times = self.fc["times"]
        self.tindex = {t: i for i, t in enumerate(self.times)}
        self.names = list(self.fc["stations"].keys())
        S = self.fc["stations"]
        self.lat = np.array([S[n]["lat"] for n in self.names]); self.lon = np.array([S[n]["lon"] for n in self.names])
        self.P = {q: np.array([S[n][q] for n in self.names], float) for q in ("p10", "p50", "p90")}  # (S,T)
        self.W = {q: np.array([S[n][q] for n in self.names], float) for q in ("ws", "blh", "temp", "wd")}
        self.C = np.array([self.contrib["stations"][n]["contrib"] for n in self.names], float)  # (S,5,T)
        self.bias = np.array([self.contrib["stations"][n]["bias"] for n in self.names], float)
        # Crackers are only burnt around Diwali. The cracker group also carries calendar/season patterns the model learned, so outside
        # the cracker window (2 days before to 3 days after Diwali 19:00) its share is moved to 'Local area'. Totals stay the same.
        since = (pd.to_datetime([t + ":00" for t in self.times]) - pd.Timestamp(CFG["diwali_dates"]["2026"] + " 19:00")) / pd.Timedelta(hours=1)
        off = ~((np.asarray(since) >= -48) & (np.asarray(since) <= 72))
        ci, li = CAUSE_NAMES.index(CRACKER), CAUSE_NAMES.index("Local area")
        self.C[:, li, off] += self.C[:, ci, off]
        self.C[:, ci, off] = 0.0
        self.has_gs = self.cfg["has_ground_stations"]
        # grid of cells
        south, west, north, east = self.cfg["bbox"]; step = self.cfg["cell_step"]
        la = np.arange(south + step / 2, north, step); lo = np.arange(west + step / 2, east, step)
        LA, LO = np.meshgrid(la, lo, indexing="ij"); LA, LO = LA.ravel(), LO.ravel()
        near = np.hypot(*(km_xy(LA, LO)[:, None, :] - km_xy(self.lat, self.lon)[None, :, :]).transpose(2, 0, 1)).min(1)
        keep = near <= self.cfg["mask_km"]
        self.cla, self.clo, self.near = LA[keep], LO[keep], near[keep]
        self.step = step
        ip = d / "interp.json"
        self.interp_info = json.load(open(ip)) if ip.exists() else {"k": 0.6, "note": "default"}
        self.k = float(self.interp_info.get("k", 0.6))
        self.I = Interpolator(self.cla, self.clo, self.lat, self.lon, power=float(self.interp_info.get("power", 2.0)))
        self.conf = np.full(len(self.cla), 1) if not self.has_gs else np.where(self.near <= 2.5, 2, np.where(self.near <= 5.0, 1, 0))
        self.widen = 1 + 0.06 * self.near
        rp = d / "shortterm_replay.json"
        self.replay = json.load(open(rp)) if rp.exists() else None
        pp = d / "panel_2026.parquet"
        self.panel = pd.read_parquet(pp) if pp.exists() else None
        self._models = {}

    # ---- helpers
    def hi(self, hour):
        h = hour.strip()[:13]
        if h not in self.tindex:
            raise HTTPException(404, f"hour '{hour}' is outside the forecast window {self.times[0]} .. {self.times[-1]} (format 2026-11-08T21)")
        return self.tindex[h]

    def si(self, station):
        if station not in self.names:
            raise HTTPException(404, f"unknown station '{station}' for {self.key}; try one of {self.names[:5]}...")
        return self.names.index(station)

    def cells(self, p50_st, p10_st, p90_st, i):
        W = self.I.weights(self.W["wd"][0, i], self.W["ws"][0, i], self.k)
        c50 = self.I.apply(W, p50_st)
        if not self.has_gs:
            c50 = np.full(len(self.cla), p50_st[0]); c10 = np.full(len(self.cla), p10_st[0]); c90 = np.full(len(self.cla), p90_st[0]); wd = np.ones(len(self.cla))
        else:
            c10 = self.I.apply(W, p10_st); c90 = self.I.apply(W, p90_st); wd = self.widen
        lo = np.clip(c50 - (c50 - c10) * wd, 5, None); hi = c50 + (c90 - c50) * wd
        return c50, lo, hi

    def cell_rows(self, c50, lo, hi):
        return [[round(float(a), 4), round(float(b), 4), int(round(float(c))), int(k), int(round(float(l))), int(round(float(h)))]
                for a, b, c, k, l, h in zip(self.cla, self.clo, c50, self.conf, lo, hi)]

    def weather(self, i):
        return {"wind_kmh": round(float(self.W["ws"][0, i]), 1), "wind_dir_deg": int(round(float(self.W["wd"][0, i]))),
                "mixing_height_m": int(round(float(self.W["blh"][0, i]))), "temp_c": round(float(self.W["temp"][0, i]), 1)}

    def model(self, h):
        import lightgbm as lgb
        if h not in self._models:
            self._models[h] = lgb.Booster(model_file=str(ROOT / "models" / f"{self.key}_short_{h}h.txt"))
        return self._models[h]


CITIES = {}
for k in CFG["cities"]:
    if (APP_DATA / k / "forecast_diwali2026.json").exists():
        CITIES[k] = City(k)

app = FastAPI(title="AirWard API", version="1.0", description="Neighbourhood-level Diwali air-pollution forecasts. All values are model forecasts, not live readings.")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
app.add_middleware(GZipMiddleware, minimum_size=1500)


@app.middleware("http")
async def cache_headers(request: Request, call_next):
    resp = await call_next(request)
    if request.method == "GET" and request.url.path.startswith("/api/") and resp.status_code == 200:
        resp.headers["Cache-Control"] = "public, max-age=300"
    return resp


def city_or_404(c):
    c = c.lower()
    if c not in CITIES:
        raise HTTPException(404, f"unknown city '{c}'. Available: {list(CITIES)}")
    return CITIES[c]


def issued(c=None):
    return (c or next(iter(CITIES.values()))).fc["issued_at"]


LABELS = {"station": "Station forecast (model)", "cell": "Interpolated estimate (between stations)",
          "confidence": {"2": "High: within 2.5 km of a station", "1": "Medium: 2.5-5 km from a station", "0": "Low: far from any station"},
          "observed": "Observed = past readings from CPCB/DPCC stations (only in the backtest and Diwali history)",
          "cache": "Cached: a saved forecast, not live data"}


# --------------------------------------------------------------------------------- endpoints
@app.get("/api/health")
def health():
    return {"status": "ok", "cities": list(CITIES), "model": MODEL_NAME, "forecast_issued_at": issued(), "data_status": "forecast (saved, not live)"}


@app.get("/api/cities")
def cities():
    return [{"key": k, "name": c.cfg["name"], "center": c.cfg["center"], "zoom": c.cfg["zoom"], "stations": len(c.names) if c.has_gs else 0,
             "has_ground_stations": c.has_gs, "data_source": c.cfg["data_source"]} for k, c in CITIES.items()]


@app.get("/api/{city}/meta")
def meta(city: str):
    c = city_or_404(city)
    return {"name": c.cfg["name"], "center": c.cfg["center"], "zoom": c.cfg["zoom"], "bbox": c.cfg["bbox"], "has_ground_stations": c.has_gs,
            "data_source": c.cfg["data_source"], "times": c.times, "diwali": "2026-11-08", "issued_at": c.fc["issued_at"],
            "stations": [{"name": n, "lat": float(c.lat[i]), "lon": float(c.lon[i])} for i, n in enumerate(c.names)],
            "importance": c.res["importance"], "backtest": c.res["backtest"], "train_period": c.res["train_period"], "train_rows": c.res["train_rows"],
            "cause_names": CAUSE_NAMES, "cause_help": CAUSE_HELP, "labels": LABELS, "cell_step": c.step, "cells": int(len(c.cla)),
            "interpolation": c.interp_info,
            "banner": None if c.has_gs else "City-level estimate only, no ground stations yet. Add stations or sensors to unlock neighbourhood detail.",
            "status": "Forecast (model estimate)"}


@functools.lru_cache(maxsize=4096)
def _map_cached(city, i):
    c = CITIES[city]
    c50, lo, hi = c.cells(c.P["p50"][:, i], c.P["p10"][:, i], c.P["p90"][:, i], i)
    return c.cell_rows(c50, lo, hi)


@app.get("/api/{city}/map")
def map_(city: str, hour: str = Query("2026-11-08T21", description="IST hour like 2026-11-08T21")):
    c = city_or_404(city); i = c.hi(hour)
    st = []
    for j, n in enumerate(c.names):
        info = aqi_info(c.P["p50"][j, i])
        st.append({"name": n, "lat": float(c.lat[j]), "lon": float(c.lon[j]), "p10": int(c.P["p10"][j, i]), "p50": int(c.P["p50"][j, i]),
                   "p90": int(c.P["p90"][j, i]), "pm25": info["pm25"], "aqi": info["aqi"], "category": info["category"], "kind": "station_forecast", "label": LABELS["station"]})
    return {"hour": c.times[i], "cell_step": c.step, "cells": _map_cached(c.key, i),
            "cells_format": "[lat_centre, lon_centre, pm25_p50, confidence, pm25_p10, pm25_p90]  confidence: 2=high (near a station), 1=medium, 0=low (far from any station). Draw a square of size cell_step degrees around the centre.",
            "stations": st, "city_mean": aqi_info(c.P["p50"][:, i].mean()), "weather": c.weather(i),
            "status": "Forecast (model estimate)", "neighbourhood_detail": c.has_gs, "labels": LABELS,
            "cache": {"state": "cached", "issued_at": c.fc["issued_at"], "note": LABELS["cache"]}, "interpolation": {"method": "wind-aware IDW" if c.k else "IDW", "k": c.k}}


@app.get("/api/{city}/map/all")
def map_all(city: str):
    """All 360 hours of cell p50 values in one call (speed-up for the slider)."""
    c = city_or_404(city)
    return {"hours": c.times, "cell_step": c.step, "cells": [[round(float(a), 4), round(float(b), 4), int(k)] for a, b, k in zip(c.cla, c.clo, c.conf)],
            "pm25_p50": [[r[2] for r in _map_cached(c.key, i)] for i in range(len(c.times))], "status": "Forecast (model estimate)"}


@app.get("/api/{city}/forecast")
def forecast(city: str, station: str):
    c = city_or_404(city); j = c.si(station)
    return {"station": station, "lat": float(c.lat[j]), "lon": float(c.lon[j]), "time": c.times,
            "p10": c.fc["stations"][station]["p10"], "p50": c.fc["stations"][station]["p50"], "p90": c.fc["stations"][station]["p90"],
            "issued_at": c.fc["issued_at"], "diwali": "2026-11-08",
            "weather": {k: c.fc["stations"][station][k] for k in ("ws", "blh", "temp", "wd")},
            "status": "Forecast (model estimate)", "kind": "station_forecast", "label": LABELS["station"] if c.has_gs else "City-level model estimate"}


@app.get("/api/{city}/nearest")
def nearest(city: str, lat: float, lon: float):
    c = city_or_404(city)
    d = np.hypot(*(km_xy(lat, lon) - km_xy(c.lat, c.lon)).T)
    j = int(np.argmin(d))
    return {"station": c.names[j], "distance_km": round(float(d[j]), 1)}


@app.get("/api/{city}/explain")
def explain(city: str, station: str, hour: str = "2026-11-08T22"):
    c = city_or_404(city); j = c.si(station); i = c.hi(hour)
    vals = c.C[j, :, i]
    pos = np.clip(vals, 0, None); tot = pos.sum() or 1.0
    causes = [{"cause": n, "ug_m3": round(float(v), 1), "share_pct": int(round(float(p) / tot * 100)), "direction": "raises" if v > 0 else ("lowers" if v < 0 else "none"),
               "help": CAUSE_HELP[n], "modelled": (FIRE_MODELLED or n != FIRE)} for n, v, p in zip(CAUSE_NAMES, vals, pos)]
    causes.sort(key=lambda x: -x["ug_m3"])
    return {"station": station, "hour": c.times[i], "predicted_pm25": int(c.P["p50"][j, i]), "typical_baseline_pm25": int(round(float(c.bias[j]))),
            "causes": causes, "cause_names": CAUSE_NAMES,
            "note": "Shows what the model relied on for this hour. It is not a measured source split."}


def _after(c, i, crackers, traffic, fires):
    cut = {CRACKER: crackers, TRAFFIC: traffic, FIRE: fires}
    red = np.zeros(len(c.names))
    for gi, n in enumerate(CAUSE_NAMES):
        if n in cut:
            red += cut[n] * np.clip(c.C[:, gi, i], 0, None)
    p50 = c.P["p50"][:, i]
    after = np.maximum(p50 - red, np.minimum(p50, 10.0))
    shift = after - p50
    return p50, after, np.clip(c.P["p10"][:, i] + shift, 5, None), c.P["p90"][:, i] + shift


@app.get("/api/{city}/simulate")
def simulate(city: str, hour: str = "2026-11-08T22", crackers: float = 0.0, traffic: float = 0.0, fires: float = 0.0):
    c = city_or_404(city); i = c.hi(hour)
    cr, tr, fi = (float(np.clip(x, 0, 1)) for x in (crackers, traffic, fires))
    before, after, a10, a90 = _after(c, i, cr, tr, fi)
    c50, lo, hi = c.cells(after, a10, a90, i)
    rows = []
    for j, n in enumerate(c.names):
        b, a = aqi_info(before[j]), aqi_info(after[j])
        rows.append({"station": n, "before": b, "after": a, "saved_pm25": int(round(float(before[j] - after[j]))),
                     "suggested_action": ACTION.get(b["category"], "No special action")})
    rows.sort(key=lambda r: -r["before"]["pm25"])
    return {"hour": c.times[i], "cells": c.cell_rows(c50, lo, hi), "cell_step": c.step,
            "before_city": aqi_info(before.mean()), "after_city": aqi_info(after.mean()), "stations": rows, "stations_sorted": [r["station"] for r in rows],
            "settings": {"crackers_cut": cr, "traffic_cut": tr, "farm_fires_cut": fi},
            "fires_modelled": FIRE_MODELLED,
            "note": "Scenario estimate from the model's cause breakdown, not a measured result. Weather is never changed."
                    + ("" if FIRE_MODELLED else " Farm-fire effect is not modelled yet (needs NASA FIRMS data), so the farm-fire slider changes nothing.")}


@app.get("/api/{city}/rank")
def rank(city: str, hour: str = "2026-11-08T22", top: int = 10):
    """Where to act first: stations ranked worst first with a suggested action."""
    c = city_or_404(city); i = c.hi(hour)
    order = np.argsort(-c.P["p50"][:, i])[:top]
    return {"hour": c.times[i], "ranking": [{"rank": r + 1, "station": c.names[j], **aqi_info(c.P["p50"][j, i]),
            "range": [int(c.P["p10"][j, i]), int(c.P["p90"][j, i])], "action": ACTION.get(aqi_info(c.P["p50"][j, i])["category"], "No special action")} for r, j in enumerate(order)],
            "status": "Forecast (model estimate)"}


@app.get("/api/{city}/diwali")
def diwali(city: str):
    c = city_or_404(city); r = c.res
    bt = dict(r["backtest"]); bt["labels"] = {"actual": LABELS["observed"]}
    return {"diwali_2026": "2026-11-08", "forecast_2026": r["forecast_2026"], "past": r["past"], "phases": r.get("phases", {}), "stations_reporting": r.get("stations_reporting", {}),
            "backtest": bt, "short_term": r.get("short_term", {}), "train_period": r["train_period"], "importance": r["importance"], "issued_at": c.fc["issued_at"],
            "train_rows": r["train_rows"], "data_source": c.cfg["data_source"],
            "caption": "City-average PM2.5. Past years are derived/measured station data, 2026 is a model forecast."}


@app.get("/api/{city}/replay")
def replay(city: str, station: str, hour: str):
    """Short-term (1/3/6/24 h) forecasts made at `hour` inside the Diwali-2025 test window, next to what really happened."""
    c = city_or_404(city)
    if not c.replay:
        raise HTTPException(404, f"no short-term replay for {city}")
    h = hour.strip()[:13]
    if h not in c.replay["hours"]:
        raise HTTPException(404, f"hour outside replay window {c.replay['hours'][0]} .. {c.replay['hours'][-1]}")
    if station not in c.replay["stations"]:
        raise HTTPException(404, f"unknown station '{station}'")
    k = c.replay["hours"].index(h); e = c.replay["stations"][station]
    out = {"station": station, "now_hour": h, "now_pm25": e["now"][k], "horizons": {}, "status": "Backtest replay on Diwali 2025 (not live)"}
    for hz in (1, 3, 6, 24):
        out["horizons"][f"{hz}h"] = {"forecast": e[f"pred_{hz}h"][k], "actual": e[f"actual_{hz}h"][k], "same_as_now": e["now"][k]}
    out["typical_error_mae"] = {k_: v["AirWard model"]["mae"] for k_, v in c.res["short_term"].items()}
    return out


class NowcastIn(BaseModel):
    station: str
    now: str = Field(..., description="IST hour of the latest reading, e.g. 2026-11-08T18")
    readings: list[float | None] = Field(..., min_length=25, description="Hourly PM2.5, oldest first, last value = hour `now` (at least 25 values)")


@app.post("/api/{city}/nowcast")
def nowcast(city: str, body: NowcastIn):
    """Bring-your-own live feed: POST the latest hourly readings, get 1/3/6/24 h forecasts (change-from-now models)."""
    c = city_or_404(city)
    if c.panel is None:
        raise HTTPException(404, f"short-term models are not available for {city}")
    j = c.si(body.station); i = c.hi(body.now)
    r = np.array([np.nan if v is None else v for v in body.readings], float)
    if np.isnan(r[-1]):
        raise HTTPException(422, "the last reading (hour `now`) must not be missing")
    cur = r[-1]
    lag = lambda k: r[-1 - k] if len(r) > k else np.nan
    base = {"pm_now": cur, "lag1": lag(1), "lag2": lag(2), "lag3": lag(3), "lag6": lag(6), "lag12": lag(12), "lag24": lag(24),
            "roll6": np.nanmean(r[-6:]), "roll24": np.nanmean(r[-24:])}
    out = {"station": body.station, "now": c.times[i], "now_pm25": int(round(cur)), "horizons": {}, "status": "Model estimate from the readings you supplied"}
    for hz in (1, 3, 6, 24):
        t = i + hz
        if t >= len(c.times):
            out["horizons"][f"{hz}h"] = None; continue
        row = c.panel[(c.panel["station"] == body.station) & (c.panel["time"] == pd.Timestamp(c.times[t]))].iloc[0].to_dict()
        m = c.model(hz)
        x = pd.DataFrame([{**row, **base}])[m.feature_name()].astype(float)
        pred = max(5.0, cur + float(m.predict(x)[0]))
        mae_h = c.res["short_term"][f"{hz}h"]["AirWard model"]["mae"]
        out["horizons"][f"{hz}h"] = {"time": c.times[t], **aqi_info(pred), "typical_error_mae": mae_h, "likely_range": [int(max(5, pred - 1.28 * mae_h * 1.25)), int(pred + 1.28 * mae_h * 1.25)]}
    return out


# --------------------------------------------------------------------------------- scorecard (public forecast vs reality)
SCORE_DATES = ["2026-11-07", "2026-11-08", "2026-11-09", "2026-11-10", "2026-11-11"]


def _score_rows(c, actuals=None):
    rows = []
    for d in SCORE_DATES:
        idx = [i for i, t in enumerate(c.times) if t.startswith(d)]
        p50 = float(c.P["p50"][:, idx].mean()); lo = float(c.P["p10"][:, idx].mean()); hi = float(c.P["p90"][:, idx].mean())
        pk = int(np.argmax(c.P["p50"][:, idx].mean(0)))
        r = {"date": d, "label": {"2026-11-08": "Diwali day"}.get(d, "D%+d" % (int(d[-2:]) - 8)), "forecast_city_avg": aqi_info(p50),
             "approx_range_pm25": [int(round(lo)), int(round(hi))], "forecast_peak_hour": c.times[idx[pk]], "actual_city_avg_pm25": None}
        a = (actuals or {}).get(d)
        if a is not None:
            ai = aqi_info(a)
            r.update({"actual_city_avg_pm25": ai["pm25"], "actual_category": ai["category"], "error_pm25": int(round(p50 - a)), "abs_pct_error": round(abs(p50 - a) / max(a, 1) * 100, 1),
                      "inside_range": bool(lo <= a <= hi), "category_match": ai["category"] == r["forecast_city_avg"]["category"]})
        rows.append(r)
    return rows


class ScoreIn(BaseModel):
    actuals: dict[str, float] = Field(..., description="Measured city-average PM2.5 per date, e.g. {\"2026-11-08\": 270}")


@app.get("/api/{city}/scorecard")
def scorecard(city: str):
    """The public Diwali-2026 forecast (city average per day), frozen at issued_at, with empty 'actual' fields to fill after 9 Nov."""
    c = city_or_404(city)
    return {"issued_at": c.fc["issued_at"], "rows": _score_rows(c), "status": "Forecast (model estimate) - fill actuals after 9 Nov",
            "how_to_score": "POST the measured city-average PM2.5 per date to this URL as {\"actuals\": {\"2026-11-08\": 270}}. Compare like with like: average of the stations' 24 hourly values."}


@app.post("/api/{city}/scorecard")
def scorecard_scored(city: str, body: ScoreIn):
    c = city_or_404(city)
    bad = [d for d in body.actuals if d not in SCORE_DATES]
    if bad:
        raise HTTPException(422, f"dates must be among {SCORE_DATES}; got {bad}")
    rows = _score_rows(c, body.actuals)
    sc = [r for r in rows if r["actual_city_avg_pm25"] is not None]
    return {"issued_at": c.fc["issued_at"], "rows": rows, "summary": {"days_scored": len(sc),
            "mean_abs_error_pm25": round(float(np.mean([abs(r["error_pm25"]) for r in sc])), 1) if sc else None,
            "inside_range": f"{sum(r['inside_range'] for r in sc)}/{len(sc)}", "category_match": f"{sum(r['category_match'] for r in sc)}/{len(sc)}"}}


# --------------------------------------------------------------------------------- reload (after scripts/refresh_forecast.py)
import os  # noqa: E402


@app.post("/api/reload")
def reload_data(request: Request):
    """Re-read backend/app_data without restarting.  Disabled unless env AIRWARD_ADMIN_TOKEN is set; send it as header x-admin-token."""
    tok = os.environ.get("AIRWARD_ADMIN_TOKEN")
    if not tok:
        raise HTTPException(403, "reload is disabled (set AIRWARD_ADMIN_TOKEN on the server to enable it)")
    if request.headers.get("x-admin-token") != tok:
        raise HTTPException(401, "bad token")
    new = {k: City(k) for k in CFG["cities"] if (APP_DATA / k / "forecast_diwali2026.json").exists()}
    CITIES.clear(); CITIES.update(new); _map_cached.cache_clear()
    return {"reloaded": list(CITIES), "forecast_issued_at": issued()}


@app.on_event("startup")
def warm():
    """Pre-compute every map hour and load the short-term models so no visitor pays the first-call cost."""
    for k, c in CITIES.items():
        for i in range(len(c.times)):
            _map_cached(k, i)
        if c.panel is not None:
            for h in (1, 3, 6, 24):
                try:
                    c.model(h)
                except Exception:
                    pass


# browser push notifications (Level 2 alerts) - registered before the website mount so /api/push/* is reachable
def _nearest_station(c, lat, lon):
    d = np.hypot(*(km_xy(lat, lon) - km_xy(c.lat, c.lon)).T)
    return c.names[int(np.argmin(d))]


from backend import push as _push  # noqa: E402
app.include_router(_push.make_router(CITIES, _nearest_station))


@app.on_event("startup")
def start_push_checks():
    _push.start_background(CITIES)


# serve the website when it has been built (frontend/dist) -> one process serves everything
DIST = ROOT / "AeroSage" / "dist"          # the team frontend (landing + map + act + proof + about)
if not DIST.exists():
    DIST = ROOT / "frontend" / "dist"       # older React build, kept as a fallback
if DIST.exists():
    app.mount("/", StaticFiles(directory=str(DIST), html=True), name="site")
