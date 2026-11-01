"""Train AirWard models, run the honest backtests and export forecast files.

Delhi  : station-level LightGBM quantile 'outlook' model (weather + Diwali calendar + place + leakage-safe priors,
         NO recent readings -> works days ahead) + short-term models (1/3/6/24 h) that predict the CHANGE from the latest reading.
Patiala: city-level model emulating Open-Meteo CAMS PM2.5 (no ground stations) -> labelled 'city-level model estimate'.

Honesty rules enforced in code
  * backtest model never sees data >= 2025-10-01; test window = 2025-10-10 .. 2025-10-31 (Diwali 2025-10-20)
  * P10/P90 band widening is CALIBRATED ON DIWALI 2024 (model trained < 2024-10-01) and only REPORTED on 2025
  * priors (previous-Diwali value etc.) for year Y use years < Y only
  * test-window weather is ERA5 reanalysis (not a real forecast) -> reported as a limitation
"""
import json, sys, time, warnings
import numpy as np, pandas as pd, lightgbm as lgb
from common import *

warnings.filterwarnings("ignore")
OUTM = ROOT / "models"; OUTM.mkdir(exist_ok=True)
CITY = sys.argv[1] if len(sys.argv) > 1 else "delhi"
APP = ROOT / "backend" / "app_data" / CITY; APP.mkdir(parents=True, exist_ok=True)
PROC = ROOT / "data" / "processed"
T0 = time.time()
def log(*a): print(f"[{time.time()-T0:6.0f}s]", *a, flush=True)

CITYCFG = CFG["cities"][CITY]
ST = CITYCFG["stations"]
HOURS_FC = pd.date_range("2026-11-01", "2026-11-15 23:00", freq="h")
TEST0, TEST1 = pd.Timestamp("2025-10-10"), pd.Timestamp("2025-10-31 23:00")
CAL0, CAL1 = pd.Timestamp("2024-10-10"), pd.Timestamp("2024-11-10 23:00")
SPLIT_TEST, SPLIT_CAL = pd.Timestamp("2025-10-01"), pd.Timestamp("2024-10-01")
OUT_PARAMS = dict(n_estimators=300, learning_rate=0.05, num_leaves=15, min_child_samples=400, subsample=0.7, subsample_freq=1,
                  colsample_bytree=0.7, reg_lambda=2.0, max_bin=127, n_jobs=2, verbose=-1)  # chosen on the Diwali-2024 validation window only
PARAMS = dict(n_estimators=350, learning_rate=0.06, num_leaves=63, min_child_samples=60, subsample=0.7, subsample_freq=1,
              colsample_bytree=0.8, reg_lambda=2.0, max_bin=127, n_jobs=2, verbose=-1)


def mae(a, b): return float(np.nanmean(np.abs(a - b)))
def rmse(a, b): return float(np.sqrt(np.nanmean((a - b) ** 2)))
def catacc(a, b): return float(np.mean(cat_idx(a) == cat_idx(b)) * 100)
def metrics(act, pred):
    m = ~(np.isnan(act) | np.isnan(pred))
    return {"mae": round(mae(act[m], pred[m]), 1), "rmse": round(rmse(act[m], pred[m]), 1),
            "category_accuracy": round(catacc(act[m], pred[m]), 1), "n": int(m.sum())}


# =====================================================================================================
#  DELHI
# =====================================================================================================
def build_priors(V, idx, cal):
    """V: time x station wide pm25.  Returns functions giving leakage-safe priors for any year."""
    off = cal["offset_h"].values; yr = idx.year.values
    OFFMAX = 1100
    years = list(range(2017, 2026))
    T = np.full((V.shape[1], len(years), 2 * OFFMAX + 1), np.nan)
    for yi, y in enumerate(years):
        m = (yr == y) & (np.abs(off) <= OFFMAX)
        T[:, yi, off[m] + OFFMAX] = V.values[m].T
    # nan-aware smoothing along offset (window 9h)
    k = np.ones(9)
    def smooth(a):
        z = np.nan_to_num(a); c = (~np.isnan(a)).astype(float)
        num = np.apply_along_axis(lambda r: np.convolve(r, k, "same"), -1, z)
        den = np.apply_along_axis(lambda r: np.convolve(r, k, "same"), -1, c)
        return np.where(den > 0, num / np.where(den > 0, den, 1), np.nan)
    Ts = smooth(T)
    Cs = np.nanmean(Ts, axis=0)  # years x offsets (city-level)
    season = (idx.month >= 9)
    sp = np.full((V.shape[1], len(years)), np.nan)
    for yi, y in enumerate(years):
        sp[:, yi] = np.nanmean(V.values[(yr == y) & season], axis=0)

    def prior(Y):
        """arrays for target year Y using years < Y only"""
        yk = [i for i, y in enumerate(years) if y < Y]
        with np.errstate(all="ignore"):
            pst = np.nanmean(Ts[:, yk, :], axis=1) if yk else np.full((V.shape[1], 2 * OFFMAX + 1), np.nan)
            pct = np.nanmean(Cs[yk, :], axis=0) if yk else np.full(2 * OFFMAX + 1, np.nan)
            spr = np.nanmean(sp[:, yk], axis=1) if yk else np.full(V.shape[1], np.nan)
        return pst, pct, spr
    return prior, OFFMAX


def delhi_frames():
    d = pd.read_parquet(PROC / "delhi_hourly.parquet")
    names = [s["name"] for s in ST]
    idx = pd.date_range("2017-01-01", "2025-12-31 23:00", freq="h")
    V = d.pivot(index="time", columns="station", values="pm25").reindex(idx)[names]
    w = derive_weather(pd.read_parquet(PROC / f"weather_{CITY}.parquet"))
    return d, names, idx, V, w


def station_feature_frame(Vcol, si, st, times, cal, w, pst, pct, spr_val, OFFMAX, yrs):
    """Outlook features for one station over `times` (priors by year of each row)."""
    F = pd.DataFrame(index=times)
    ww = w.reindex(times)
    for c in ["ws", "blh", "vent", "blh_min24", "ws_mean24", "temp", "rh", "rain48", "wd_sin", "wd_cos", "temp_drop24"]:
        F[c] = ww[c].values
    for c in ["days_from_diwali", "diwali_night", "diwali_evening_hours", "stubble", "doy_sin", "doy_cos", "hour_sin", "hour_cos", "dow", "is_weekend"]:
        F[c] = cal[c].values
    off = cal["offset_h"].values
    ok = np.abs(off) <= OFFMAX
    pv = np.full(len(times), np.nan); cv = np.full(len(times), np.nan); sv = np.full(len(times), np.nan)
    for y in np.unique(yrs):
        m = yrs == y
        P, C, S = pst[y]
        mm = m & ok
        pv[mm] = P[si, off[mm] + OFFMAX]; cv[mm] = C[off[mm] + OFFMAX]; sv[m] = S[si]
    F["prev_diwali_offset"] = pv; F["city_prev_offset"] = cv; F["station_prior"] = sv
    F["station_code"] = si; F["lat"] = st["lat"]; F["lon"] = st["lon"]
    return F


def build_delhi():
    d, names, idx, V, w = delhi_frames()
    cal = calendar_feats(idx)
    log("priors ...")
    prior, OFFMAX = build_priors(V, idx, cal)
    pst = {y: prior(y) for y in range(2017, 2027)}
    yrs_all = idx.year.values
    season = idx.month.values >= 9
    # neighbours not used (so the nowcast endpoint only needs the station's own readings)
    outl, short = [], {h: [] for h in (1, 3, 6, 24)}
    for si, st in enumerate(ST):
        s = V[st["name"]]
        F = station_feature_frame(s, si, st, idx, cal, w, pst, None, None, OFFMAX, yrs_all)
        F["pm25"] = s.values
        outl.append(F[season].assign(station=st["name"], time=idx[season]))
        L = pd.DataFrame(index=idx)
        L["pm_now"] = s.values
        for k in (1, 2, 3, 6, 12, 24): L[f"lag{k}"] = s.shift(k).values
        L["roll6"] = s.rolling(6, min_periods=3).mean().values
        L["roll24"] = s.rolling(24, min_periods=12).mean().values
        for h in short:
            Fh = F.drop(columns=["pm25"]).shift(-h)  # features of the TARGET hour t+h, aligned on t
            X = pd.concat([L, Fh], axis=1)
            X["y_delta"] = s.shift(-h).values - s.values
            X["target_time"] = idx + pd.Timedelta(hours=h)
            X["station"] = st["name"]; X["time"] = idx
            sel = season & X["y_delta"].notna().values & ((idx + pd.Timedelta(hours=h)).month.values >= 9)
            short[h].append(X[sel].astype({c: "float32" for c in X.columns if X[c].dtype == "float64"}))
    outl = pd.concat(outl, ignore_index=True)
    short = {h: pd.concat(v, ignore_index=True) for h, v in short.items()}
    # forecast panel 2026
    calf = calendar_feats(HOURS_FC)
    yrs_f = HOURS_FC.year.values
    pan = []
    for si, st in enumerate(ST):
        F = station_feature_frame(None, si, st, HOURS_FC, calf, w, pst, None, None, OFFMAX, yrs_f)
        F["station"] = st["name"]; F["time"] = HOURS_FC; F["wd"] = w.reindex(HOURS_FC)["wd"].values
        pan.append(F)
    pan = pd.concat(pan, ignore_index=True)
    return d, names, idx, V, w, outl, short, pan


def diwali_weight(X, k=4):
    """Extra weight (x5) for Diwali evening to the next night: the sharp cracker peak is rare, so an unweighted model smooths it away.
    Chosen with leave-one-Diwali-out tests (peak under-forecast -16.5 -> -6.6 ug/m3, overall error unchanged)."""
    ev = X["diwali_evening_hours"].values
    return 1.0 + k * ((ev >= -6) & (ev <= 36))


def fit_q(X, y, alphas=(0.1, 0.5, 0.9), feats=None, seed=1, params=None, weight=None):
    ms = {}
    for a in alphas:
        m = lgb.LGBMRegressor(objective="quantile", alpha=a, random_state=seed, **(params or OUT_PARAMS))
        m.fit(X[feats], y, sample_weight=weight, categorical_feature=["station_code"] if "station_code" in feats else "auto")
        ms[a] = m
    return ms


def predict_q(ms, X, feats, scale=1.0):
    p10 = ms[0.1].predict(X[feats]); p50 = ms[0.5].predict(X[feats]); p90 = ms[0.9].predict(X[feats])
    p10, p90 = np.minimum(p10, p50), np.maximum(p90, p50)
    lo = np.clip(p50 - scale * (p50 - p10), 5, None); hi = p50 + scale * (p90 - p50)
    return np.clip(lo, 5, None), np.clip(p50, 5, None), hi


def calibrate_scale(act, p10, p50, p90, target=0.8):
    best, bs = 9, 1.0
    for s in np.arange(1.0, 4.01, 0.05):
        lo = np.clip(p50 - s * (p50 - p10), 0, None); hi = p50 + s * (p90 - p50)
        c = np.mean((act >= lo) & (act <= hi))
        if abs(c - target) < best: best, bs = abs(c - target), s
    return float(round(bs, 2))


def coverage(act, lo, hi): return float(np.mean((act >= lo) & (act <= hi)) * 100)


def group_contrib(model, X, feats):
    """LightGBM pred_contrib (SHAP-style) summed into the 5 cause groups. Returns (n,5) and bias (n,)."""
    c = model.predict(X[feats], pred_contrib=True)
    base = c[:, -1]; c = c[:, :-1]
    out = np.zeros((len(X), len(CAUSE_NAMES)))
    for gi, g in enumerate(CAUSE_NAMES):
        cols = [i for i, f in enumerate(feats) if f in GROUPS[g]]
        out[:, gi] = c[:, cols].sum(1)
    return out, base


def delhi_main():
    log("building panels")
    d, names, idx, V, w, outl, short, pan = build_delhi()
    log("outlook rows", len(outl), " short rows", {h: len(v) for h, v in short.items()})
    feats = [f for f in OUTLOOK_FEATS if f in outl.columns]
    t = outl["time"]; y = outl["pm25"].values
    ok = ~np.isnan(y)

    # ---- stage A: calibrate band on Diwali 2024 (model never saw >= 2024-10-01)
    trA = ok & (t < SPLIT_CAL).values
    log("stage A train", trA.sum())
    mA = fit_q(outl[trA], y[trA], feats=feats, weight=diwali_weight(outl[trA]))
    cal_m = ok & (t >= CAL0).values & (t <= CAL1).values
    lo, p50, hi = predict_q(mA, outl[cal_m], feats)
    scale = calibrate_scale(y[cal_m], lo, p50, hi)
    lo_s, _, hi_s = predict_q(mA, outl[cal_m], feats, scale)
    cov_cal = round(coverage(y[cal_m], lo_s, hi_s), 1)
    log("band_scale", scale, "coverage on Diwali-2024 calibration window", cov_cal)

    # ---- stage B: blind test model (nothing >= 2025-10-01)
    trB = ok & (t < SPLIT_TEST).values
    log("stage B train", trB.sum())
    mB = fit_q(outl[trB], y[trB], feats=feats, weight=diwali_weight(outl[trB]))
    te = ok & (t >= TEST0).values & (t <= TEST1).values
    Xte = outl[te]; yte = y[te]
    lo, p50, hi = predict_q(mB, Xte, feats, scale)
    raw_lo, raw_p50, raw_hi = predict_q(mB, Xte, feats, 1.0)
    cov_test = coverage(yte, lo, hi)
    log("TEST MAE", round(mae(yte, p50), 1), "coverage", round(cov_test, 1), "raw coverage", round(coverage(yte, raw_lo, raw_hi), 1))

    # baselines on the same station-hours
    key = pd.Series(yte, index=pd.MultiIndex.from_arrays([Xte["station"].values, Xte["time"].values]))
    last_week = np.array([V[s].get(tm - pd.Timedelta(days=7), np.nan) for s, tm in zip(Xte["station"], Xte["time"])]) if False else None
    Vst = V  # time x station
    lw = Vst.shift(168)  # same hour previous week (observed before the target -> legitimate baseline)
    lw_vals = lw.stack(future_stack=True) if False else None
    ti = pd.DatetimeIndex(Xte["time"].values)
    lastw = np.array([lw.at[a, b] for a, b in zip(ti, Xte["station"].values)])
    avg_prev = Xte["prev_diwali_offset"].values
    cams = pd.read_parquet(PROC / f"cams_{CITY}.parquet")["pm25"]
    cams_v = cams.reindex(ti).values
    base = {"AirWard model": metrics(yte, p50), "Last week's reading": metrics(yte, lastw),
            "Average of past Diwalis": metrics(yte, avg_prev), "Global CAMS model (Open-Meteo)": metrics(yte, cams_v)}
    for k, v in base.items(): log("  ", k, v)
    # curve (city mean over stations that have a reading)
    dfc = pd.DataFrame({"time": ti, "actual": yte, "p10": lo, "p50": p50, "p90": hi, "last_week": lastw})
    g = dfc.groupby("time").mean(numeric_only=True)
    curve = {"time": [x.strftime("%Y-%m-%dT%H") for x in g.index]}
    for c in ["actual", "p10", "p50", "p90", "last_week"]:
        curve[c] = [None if np.isnan(v) else int(round(v)) for v in g[c].values]
    # global importance on the test rows (group mean |contribution|)
    sm = Xte.sample(min(15000, len(Xte)), random_state=0)
    gc, _ = group_contrib(mB.get(0.5) if isinstance(mB, dict) else mB[0.5], sm, feats)
    imp = np.abs(gc).mean(0); imp = (imp / imp.sum() * 100).round(1)
    importance = {n: float(v) for n, v in zip(CAUSE_NAMES, imp)}
    log("importance", importance)
    # per-station test MAE (for transparency)
    per_st = pd.DataFrame({"s": Xte["station"].values, "e": np.abs(yte - p50)}).groupby("s").e.mean().round(1).to_dict()
    # also: category accuracy within +-1 category (useful honest extra)
    within1 = float(np.mean(np.abs(cat_idx(yte) - cat_idx(p50)) <= 1) * 100)

    # ---- short-term models (test stage: trained < 2025-10-01) + persistence baseline
    sfeats_all = None
    short_res, replay = {}, {}
    sfe = ["pm_now", "lag1", "lag2", "lag3", "lag6", "lag12", "lag24", "roll6", "roll24"] + feats
    sfe = list(dict.fromkeys(sfe))
    SP = dict(PARAMS); SP.update(n_estimators=300)
    sm_models_test, sm_models_final = {}, {}
    for h, X in short.items():
        tt = X["target_time"]
        trn = (tt < SPLIT_TEST).values
        tst = ((tt >= TEST0) & (tt <= TEST1)).values
        m = lgb.LGBMRegressor(objective="huber", alpha=25.0, random_state=1, **SP)
        m.fit(X.loc[trn, sfe], X.loc[trn, "y_delta"], categorical_feature=["station_code"])
        pred = np.clip(X.loc[tst, "pm_now"].values + m.predict(X.loc[tst, sfe]), 5, None)
        act = X.loc[tst, "pm_now"].values + X.loc[tst, "y_delta"].values
        pers = X.loc[tst, "pm_now"].values
        short_res[f"{h}h"] = {"AirWard model": metrics(act, pred), "Persistence (same as now)": metrics(act, pers)}
        log(f"short {h}h", short_res[f"{h}h"])
        m.booster_.save_model(str(OUTM / f"{CITY}_short_{h}h_test.txt"))
        sm_models_test[h] = m
        rp = pd.DataFrame({"s": X.loc[tst, "station"].values, "t": X.loc[tst, "time"].values, "now": X.loc[tst, "pm_now"].values, "pred": pred, "act": act})
        replay[h] = rp
    # replay json: for each station, for each hour in test window: now + {h: pred, actual}
    rep = {"hours": [x.strftime("%Y-%m-%dT%H") for x in pd.date_range(TEST0, TEST1, freq="h")], "stations": {}}
    hr = pd.date_range(TEST0, TEST1, freq="h")
    for s in names:
        e = {"now": [None] * len(hr)}
        for h in (1, 3, 6, 24):
            e[f"pred_{h}h"] = [None] * len(hr); e[f"actual_{h}h"] = [None] * len(hr)
        rows = {}
        for h, rp in replay.items():
            q = rp[rp.s == s].set_index("t")
            q = q.reindex(hr)
            e[f"pred_{h}h"] = [None if np.isnan(v) else int(round(v)) for v in q["pred"].values]
            e[f"actual_{h}h"] = [None if np.isnan(v) else int(round(v)) for v in q["act"].values]
            if h == 1: e["now"] = [None if np.isnan(v) else int(round(v)) for v in q["now"].values]
        rep["stations"][s] = e
    json.dump(rep, open(APP / "shortterm_replay.json", "w"))

    # ---- stage C: final models (all data to 2025-12-31) -> Diwali 2026
    log("final training")
    trC = ok
    mC = fit_q(outl[trC], y[trC], feats=feats, weight=diwali_weight(outl[trC]))
    for a, m in mC.items(): m.booster_.save_model(str(OUTM / f"{CITY}_outlook_q{int(a*100)}.txt"))
    for h, X in short.items():
        m = lgb.LGBMRegressor(objective="huber", alpha=25.0, random_state=1, **SP)
        m.fit(X[sfe], X["y_delta"], categorical_feature=["station_code"])
        m.booster_.save_model(str(OUTM / f"{CITY}_short_{h}h.txt"))
        sm_models_final[h] = m
    # forecast 2026
    lo, p50, hi = predict_q(mC, pan, feats, scale)
    gc, bias = group_contrib(mC[0.5], pan, feats)
    pan_out = pan.copy(); pan_out["p10"], pan_out["p50"], pan_out["p90"] = lo, p50, hi
    for gi, n in enumerate(CAUSE_NAMES): pan_out[f"c{gi}"] = gc[:, gi]
    pan_out["bias"] = bias
    pan_out.to_parquet(APP / "panel_2026.parquet", index=False)
    times = [x.strftime("%Y-%m-%dT%H") for x in HOURS_FC]
    fc = {"issued_at": pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M IST"), "times": times, "stations": {}}
    cj = {"cause_names": CAUSE_NAMES, "bias": {}, "stations": {}}
    for si, st in enumerate(ST):
        m = (pan_out["station"] == st["name"]).values
        P = pan_out[m]
        fc["stations"][st["name"]] = {"lat": st["lat"], "lon": st["lon"],
            "p10": [int(round(v)) for v in P.p10], "p50": [int(round(v)) for v in P.p50], "p90": [int(round(v)) for v in P.p90],
            "ws": [round(float(v), 1) for v in P.ws], "blh": [int(round(v)) for v in P.blh], "temp": [round(float(v), 1) for v in P.temp], "wd": [int(round(v)) for v in P.wd]}
        cj["stations"][st["name"]] = {"contrib": [[round(float(v), 1) for v in P[f"c{gi}"]] for gi in range(5)], "bias": round(float(P.bias.mean()), 1)}
    json.dump(fc, open(APP / "forecast_diwali2026.json", "w")); json.dump(cj, open(APP / "contrib_diwali2026.json", "w"))
    log("exported forecast; city mean by day:")
    P = pan_out.assign(day=pan_out.time.dt.strftime("%b %d")).groupby("day", sort=False).p50.mean().round()
    log(P.to_dict())

    # ---- Diwali compare: city-average daily PM2.5 by offset for each past year (+ phases)
    def daily_by_offset(Vw, year):
        dd = DIWALI[year]; out = {}
        for o in range(-7, 8):
            day = dd + pd.Timedelta(days=o)
            x = Vw.loc[day:day + pd.Timedelta(hours=23)]
            if x.notna().sum().sum() > 0:
                out[str(o)] = int(round(float(np.nanmean(x.values))))
        return out
    past = {str(y): daily_by_offset(V, y) for y in range(2017, 2026)}
    fcD = {}
    for o in range(-7, 8):
        day = DIWALI[2026] + pd.Timedelta(days=o)
        m = (pan_out.time >= day) & (pan_out.time < day + pd.Timedelta(days=1))
        fcD[str(o)] = int(round(pan_out.loc[m, "p50"].mean()))
    def phases(series_fn):
        pass
    ph = {}
    for yv in range(2017, 2026):
        dd = DIWALI[yv]
        b = V.loc[dd - pd.Timedelta(days=7):dd - pd.Timedelta(hours=1)]
        n = V.loc[dd + pd.Timedelta(hours=19):dd + pd.Timedelta(hours=30)]
        a = V.loc[dd + pd.Timedelta(days=1, hours=7):dd + pd.Timedelta(days=7, hours=23)]
        ph[str(yv)] = {k: int(round(float(np.nanmean(v.values)))) for k, v in (("before", b), ("night", n), ("after", a))}
    dd = DIWALI[2026]
    def pm(a, b):
        m = (pan_out.time >= a) & (pan_out.time <= b); return int(round(pan_out.loc[m, "p50"].mean()))
    ph["2026"] = {"before": pm(dd - pd.Timedelta(days=7), dd - pd.Timedelta(hours=1)), "night": pm(dd + pd.Timedelta(hours=19), dd + pd.Timedelta(hours=30)),
                  "after": pm(dd + pd.Timedelta(days=1, hours=7), dd + pd.Timedelta(days=7, hours=23))}
    nst = {str(y): int(V.loc[DIWALI[y] - pd.Timedelta(days=7):DIWALI[y] + pd.Timedelta(days=7)].notna().any().sum()) for y in range(2017, 2026)}

    meta = {"backtest": {"metrics": base, "coverage_p10_p90": round(cov_test, 1), "band_scale": scale,
                         "band_calibrated_on": "Diwali 2024 (model trained before 2024-10-01); reported on Diwali 2025 blind test",
                         "coverage_on_calibration_window": cov_cal,
                         "raw_unwidened_coverage": round(coverage(yte, raw_lo, raw_hi), 1),
                         "category_within_one": round(within1, 1), "per_station_mae": per_st, "independent_ground_truth": True,
                         "test_window": ["2025-10-10", "2025-10-31"], "curve": curve,
                         "limitations": ["Test-window weather is ERA5 reanalysis, not a day-ahead weather forecast: real-world accuracy will be somewhat lower.",
                                         "Labels 2017-2023 are derived from hourly AQI (24h-averaged, capped at 500); 2024-2025 are measured hourly PM2.5.",
                                         "Station values are forecasts; cells between stations are interpolated estimates."]},
            "short_term": short_res, "importance": importance, "train_period": ["2017-01-01", "2025-12-31"], "train_rows": int(trC.sum()),
            "past": past, "forecast_2026": fcD, "phases": ph, "stations_reporting": nst}
    json.dump(meta, open(APP / "results.json", "w"))
    log("DONE delhi")


# =====================================================================================================
#  CITY-LEVEL (no ground stations): emulate CAMS PM2.5 from weather + calendar
# =====================================================================================================
def city_main():
    CP = dict(OUT_PARAMS, min_child_samples=60)
    cams = pd.read_parquet(PROC / f"cams_{CITY}.parquet")["pm25"]
    w = derive_weather(pd.read_parquet(PROC / f"weather_{CITY}.parquet"))
    idx = cams.index
    cal = calendar_feats(idx)
    F = pd.concat([w.reindex(idx), cal], axis=1)
    F["pm25"] = cams.values
    F["time"] = idx
    feats = [f for f in OUTLOOK_FEATS if f in F.columns]
    sea = (idx.month >= 9)
    ok = sea & F["pm25"].notna().values
    y = F["pm25"].values
    # calibration on Diwali 2024 (train < 2024-10-01), test 2025 (train < 2025-10-01) - NOT independent: labels are CAMS itself
    CAL0_, CAL1_ = CAL0, CAL1
    tA = ok & (idx < SPLIT_CAL); mA = fit_q(F[tA], y[tA], feats=feats, params=CP)
    cm = ok & (idx >= CAL0_) & (idx <= CAL1_)
    lo, p50, hi = predict_q(mA, F[cm], feats); scale = calibrate_scale(y[cm], lo, p50, hi)
    tB = ok & (idx < SPLIT_TEST); mB = fit_q(F[tB], y[tB], feats=feats, params=CP)
    te = ok & (idx >= TEST0) & (idx <= TEST1)
    lo, p50b, hi = predict_q(mB, F[te], feats, scale)
    mt = metrics(y[te], p50b)
    log("emulation fidelity vs CAMS (not ground truth):", mt, "coverage", round(coverage(y[te], lo, hi), 1))
    tC = ok & (idx <= pd.Timestamp("2026-10-31 23:00"))
    mC = fit_q(F[tC], y[tC], feats=feats, params=CP)
    for a, m in mC.items(): m.booster_.save_model(str(OUTM / f"{CITY}_outlook_q{int(a*100)}.txt"))
    wf = w.reindex(HOURS_FC); calf = calendar_feats(HOURS_FC)
    P = pd.concat([wf, calf], axis=1)
    lo, p50, hi = predict_q(mC, P, feats, scale)
    gc, bias = group_contrib(mC[0.5], P, feats)
    st = ST[0]
    times = [x.strftime("%Y-%m-%dT%H") for x in HOURS_FC]
    fc = {"issued_at": pd.Timestamp.now(tz="Asia/Kolkata").strftime("%Y-%m-%d %H:%M IST"), "times": times, "stations": {st["name"]: {"lat": st["lat"], "lon": st["lon"],
          "p10": [int(round(v)) for v in lo], "p50": [int(round(v)) for v in p50], "p90": [int(round(v)) for v in hi],
          "ws": [round(float(v), 1) for v in wf.ws], "blh": [int(round(v)) for v in wf.blh], "temp": [round(float(v), 1) for v in wf.temp], "wd": [int(round(v)) for v in wf.wd]}}}
    cj = {"cause_names": CAUSE_NAMES, "bias": {}, "stations": {st["name"]: {"contrib": [[round(float(v), 1) for v in gc[:, gi]] for gi in range(5)], "bias": round(float(bias.mean()), 1)}}}
    json.dump(fc, open(APP / "forecast_diwali2026.json", "w")); json.dump(cj, open(APP / "contrib_diwali2026.json", "w"))
    imp = np.abs(gc).mean(0); imp = (imp / imp.sum() * 100).round(1)
    # past Diwali daily series from CAMS (2022-2025)
    past = {}
    for yv in range(2022, 2026):
        dd = DIWALI[yv]; o_ = {}
        for o in range(-7, 8):
            day = dd + pd.Timedelta(days=o); x = cams.loc[day:day + pd.Timedelta(hours=23)]
            if len(x): o_[str(o)] = int(round(float(x.mean())))
        past[str(yv)] = o_
    fcD = {str(o): int(round(p50[(HOURS_FC >= DIWALI[2026] + pd.Timedelta(days=o)) & (HOURS_FC < DIWALI[2026] + pd.Timedelta(days=o + 1))].mean())) for o in range(-7, 8)}
    meta = {"backtest": {"metrics": {"AirWard model (vs CAMS labels)": mt}, "coverage_p10_p90": round(coverage(y[te], lo if False else predict_q(mB, F[te], feats, scale)[0], predict_q(mB, F[te], feats, scale)[2]), 1),
                         "band_scale": scale, "independent_ground_truth": False,
                         "note": "Patiala has no ground stations: labels are the Open-Meteo CAMS model itself, so this measures how well AirWard reproduces CAMS from weather, not accuracy against real sensors.",
                         "curve": {}}, "short_term": {}, "importance": {n: float(v) for n, v in zip(CAUSE_NAMES, imp)}, "train_period": ["2022-08-01", "2026-10-31"],
            "train_rows": int(tC.sum()), "past": past, "forecast_2026": fcD, "phases": {}}
    json.dump(meta, open(APP / "results.json", "w"))
    log("DONE", CITY, "forecast day means", {k: v for k, v in list(fcD.items())[5:10]})


if __name__ == "__main__":
    (delhi_main if CITYCFG["has_ground_stations"] else city_main)()
