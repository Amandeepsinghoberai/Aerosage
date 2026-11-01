"""Leave-one-station-out test of the neighbourhood estimate.
Hide each station in turn, estimate it from the OTHER stations' observed values, compare with what it really read.
  plain IDW (k=0)  vs  wind-aware IDW (upwind stations count more).
k is chosen on Oct 10 - Nov 10 2024 and REPORTED on the Diwali-2025 window (Oct 10-31 2025).  Writes backend/app_data/delhi/interp.json"""
import json
import numpy as np, pandas as pd
from common import *

city = "delhi"
ST = CFG["cities"][city]["stations"]; names = [s["name"] for s in ST]
d = pd.read_parquet(ROOT / "data" / "processed" / "delhi_hourly.parquet")
idx = pd.date_range("2017-01-01", "2025-12-31 23:00", freq="h")
V = d.pivot(index="time", columns="station", values="pm25").reindex(idx)[names]
w = derive_weather(pd.read_parquet(ROOT / "data" / "processed" / f"weather_{city}.parquet"))
lat = np.array([s["lat"] for s in ST]); lon = np.array([s["lon"] for s in ST])
II = {p: Interpolator(lat, lon, lat, lon, power=p) for p in (1.0, 1.5, 2.0, 3.0)}


def loso(t0, t1, k, power=2.0):
    I = II[power]
    X = V.loc[t0:t1]; ww = w.loc[X.index]
    errs = []; rel = []
    for t, row in X.iterrows():
        v = row.values
        if np.isfinite(v).sum() < 25:
            continue
        W = I.weights(ww.at[t, "wd"], ww.at[t, "ws"], k, exclude_self=True)
        est = I.apply(W, v)
        m = np.isfinite(v)
        errs.append(np.abs(est[m] - v[m]))
    e = np.concatenate(errs)
    return float(np.mean(e)), int(len(e))


val = ("2024-10-10", "2024-11-10 23:00"); test = ("2025-10-10", "2025-10-31 23:00")
ks = [0.0, 0.3, 0.6, 1.0, 1.5]
res_val = {(k, p): loso(*val, k, p)[0] for k in ks for p in (1.0, 1.5, 2.0, 3.0)}
best, bp = min(res_val, key=res_val.get)
m_idw, n = loso(*test, 0.0, 2.0); m_w, _ = loso(*test, best, bp)
wind_gain = round(min(v for (k, p), v in res_val.items() if k == 0.0) - res_val[(best, bp)], 2)
out = {"k": best, "power": bp, "method": "wind-aware IDW" if best else "IDW (wind-weighting tested: no gain)", "wind_weighting_gain_ugm3": wind_gain,
       "loso": {"selected_on": "2024-10-10..2024-11-10", "mae_by_k_power_validation": {f"k={k},power={p}": round(v, 2) for (k, p), v in res_val.items()},
                "reported_on": "2025-10-10..2025-10-31 (Diwali 2025)", "mae_plain_idw_power2": round(m_idw, 1), "mae_selected": round(m_w, 1), "n": n,
                "meaning": "Average error (ug/m3) when a station's value is estimated from the other stations only. This is the accuracy of the between-stations estimate on observed values, not of the forecast."}}
json.dump(out, open(ROOT / "backend" / "app_data" / city / "interp.json", "w"), indent=1)
print(json.dumps(out, indent=1))
