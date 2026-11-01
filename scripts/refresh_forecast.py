"""Hourly refresh: new weather forecast -> re-run the SAVED models -> rewrite forecast files with a fresh `issued_at`.  No retraining.

    python scripts/refresh_forecast.py                 # all cities, downloads the latest Open-Meteo forecast (needs internet)
    python scripts/refresh_forecast.py --city delhi
    python scripts/refresh_forecast.py --forecast-json saved.json   # offline: {city: {time:[], temperature_2m:[], ...}}  (a forecast part of a bundle)
Then:  curl -X POST -H "x-admin-token: $AIRWARD_ADMIN_TOKEN" http://localhost:8000/api/reload     (API re-reads the files)
Schedule it with cron / GitHub Actions (`0 * * * *`).  The forecast window stays 1-15 Nov 2026 (Open-Meteo reaches 16 days ahead)."""
import argparse, json, sys, urllib.parse, urllib.request
from pathlib import Path
import numpy as np, pandas as pd, lightgbm as lgb

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
sys.argv, _argv = ["train", "delhi"], sys.argv   # train.py reads the city from argv at import; we only use its helper functions
import train as T                                  # noqa: E402
sys.argv = _argv
from common import *                               # noqa: E402

VARS = "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,boundary_layer_height"
WCOLS = ["ws", "blh", "vent", "blh_min24", "ws_mean24", "temp", "rh", "rain48", "wd_sin", "wd_cos", "temp_drop24"]


def download(city):
    lat, lon = CFG["cities"][city]["weather_point"]
    q = "https://api.open-meteo.com/v1/forecast?" + urllib.parse.urlencode(dict(latitude=lat, longitude=lon, hourly=VARS, past_days=60, forecast_days=16,
        timezone="Asia/Kolkata", wind_speed_unit="kmh"), safe=",")
    with urllib.request.urlopen(q, timeout=60) as r:
        return json.load(r)["hourly"]


def refresh(city, fc_hourly, issued=None):
    cfgc = CFG["cities"][city]
    wp = ROOT / "data" / "processed" / f"weather_{city}.parquet"
    w = pd.read_parquet(wp)
    new = pd.DataFrame(fc_hourly); new["time"] = pd.to_datetime(new["time"]); new = new.set_index("time")
    w = pd.concat([w[~w.index.isin(new.index)], new]).sort_index()
    w = w.reindex(pd.date_range(w.index.min(), w.index.max(), freq="h")); w.index.name = "time"
    w.to_parquet(wp)
    wd = derive_weather(w)
    app = ROOT / "backend" / "app_data" / city
    res = json.load(open(app / "results.json")); scale = res["backtest"]["band_scale"]
    models = {a: lgb.Booster(model_file=str(ROOT / "models" / f"{city}_outlook_q{int(a*100)}.txt")) for a in (0.1, 0.5, 0.9)}
    feats = models[0.5].feature_name()
    H = T.HOURS_FC
    wf = wd.reindex(H)
    if cfgc["has_ground_stations"]:
        pan = pd.read_parquet(app / "panel_2026.parquet")
        for c in WCOLS:
            pan[c] = pan["time"].map(wf[c]).values
        pan["wd"] = pan["time"].map(wf["wd"]).values
    else:
        pan = pd.concat([wf, calendar_feats(H)], axis=1); pan["station"] = cfgc["stations"][0]["name"]; pan["time"] = H
    lo, p50, hi = T.predict_q(models, pan, feats, scale)
    gc, bias = T.group_contrib(models[0.5], pan, feats)
    issued = issued or pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M IST")
    fc = {"issued_at": issued, "times": [x.strftime("%Y-%m-%dT%H") for x in H], "stations": {}}
    cj = {"cause_names": CAUSE_NAMES, "bias": {}, "stations": {}}
    pan = pan.reset_index(drop=True); pan["p10"], pan["p50"], pan["p90"] = lo, p50, hi
    for gi in range(5): pan[f"c{gi}"] = gc[:, gi]
    pan["bias"] = bias
    for st in cfgc["stations"]:
        P = pan[pan["station"] == st["name"]]
        fc["stations"][st["name"]] = {"lat": st["lat"], "lon": st["lon"], "p10": [int(round(v)) for v in P.p10], "p50": [int(round(v)) for v in P.p50], "p90": [int(round(v)) for v in P.p90],
            "ws": [round(float(v), 1) for v in P.ws], "blh": [int(round(v)) for v in P.blh], "temp": [round(float(v), 1) for v in P.temp], "wd": [int(round(v)) for v in P.wd]}
        cj["stations"][st["name"]] = {"contrib": [[round(float(v), 1) for v in P[f"c{gi}"]] for gi in range(5)], "bias": round(float(P.bias.mean()), 1)}
    if cfgc["has_ground_stations"]:
        pan.to_parquet(app / "panel_2026.parquet", index=False)
    json.dump(fc, open(app / "forecast_diwali2026.json", "w")); json.dump(cj, open(app / "contrib_diwali2026.json", "w"))
    return issued, float(np.mean(p50))


if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--city"); ap.add_argument("--forecast-json"); ap.add_argument("--issued-at", help="override the timestamp, e.g. the time the weather was really downloaded")
    a = ap.parse_args()
    saved = json.load(open(a.forecast_json)) if a.forecast_json else None
    for city in ([a.city] if a.city else [c for c in CFG["cities"] if (ROOT / "backend" / "app_data" / c / "results.json").exists()]):
        issued, m = refresh(city, saved[city] if saved else download(city), a.issued_at)
        print(f"{city}: refreshed, issued {issued}, mean P50 {m:.0f} ug/m3")
