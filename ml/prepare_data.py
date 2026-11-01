"""Clean + merge raw files into data/processed/.

Inputs  (data/raw/):
  airward_delhi_hourly_aqi_2017_2023.txt          39 stations, hourly CPCB AQI, month blocks of day-rows x 24 hours
  airward_delhi_15min_hourly_2024_2025_part*.txt  39 stations, hourly rows: time,pm25,pm10,no2,temp,rh,ws,wd
  airward_openmeteo_bundle.json                    weather (ERA5 archive + forecast) and CAMS PM2.5 for each city
Outputs (data/processed/):
  delhi_hourly.parquet      station,time,pm25,pm10,no2,measured,capped
  weather_<city>.parquet    hourly weather (IST), archive + forecast merged
  cams_<city>.parquet       hourly CAMS PM2.5
  quality_report.json       what was dropped / capped, coverage per station-year
"""
import json, re, calendar
import numpy as np, pandas as pd
from common import ROOT, CFG, aqi_to_pm25

RAW = ROOT / "data" / "raw"
OUT = ROOT / "data" / "processed"
OUT.mkdir(parents=True, exist_ok=True)
ALIAS = CFG["alias_keys"]
KEYS = {s["key"]: s["name"] for s in CFG["cities"]["delhi"]["stations"]}
MONTHS = {m: i for i, m in enumerate(calendar.month_name) if m}
PM_SENSOR_LIMIT = 900.0  # CPCB analysers saturate at 1000 ug/m3; values >= 900 treated as invalid


def station_key(raw):
    s = re.sub(r"\s+(15 minute AQI Data for 2024-25|AQI Data 2017-2023)$", "", raw.strip())
    k = re.sub(r"[^a-z0-9]", "", s.lower())
    k = re.sub(r"(dpcc|cpcb)$", "", k)
    return ALIAS.get(k, k)


def parse_2017_2023():
    rows = []
    st = None; yr = None; mon = None
    for line in open(RAW / "airward_delhi_hourly_aqi_2017_2023.txt", errors="ignore"):
        line = line.rstrip("\r\n")
        if line.startswith("#STATION"):
            st = station_key(line[8:]); yr = mon = None; continue
        if line.startswith("Year,"):
            yr = int(line.split(",")[1]); continue
        m = re.match(r"^([A-Za-z]+)-(\d{4}),00:00:00", line)
        if m:
            mon = MONTHS[m.group(1)]; yr = int(m.group(2)); continue
        m = re.match(r"^(\d{1,2}),(.*)$", line)
        if m and st and yr and mon:
            day = int(m.group(1))
            if day > calendar.monthrange(yr, mon)[1]:
                continue
            vals = m.group(2).split(",")[:24]
            base = pd.Timestamp(yr, mon, day)
            for h, v in enumerate(vals):
                if v.strip() != "":
                    rows.append((st, base + pd.Timedelta(hours=h), float(v)))
    d = pd.DataFrame(rows, columns=["key", "time", "aqi"])
    return d


def parse_2024_2025():
    rows = []
    for f in sorted(RAW.glob("airward_delhi_15min_hourly_2024_2025_part*.txt")):
        st = None
        for line in open(f, errors="ignore"):
            line = line.strip()
            if line.startswith("#STATION"):
                st = station_key(line[8:]); continue
            if not line or st is None:
                continue
            p = line.split(",")
            rows.append((st, p[0], p[1], p[2], p[3]))
    d = pd.DataFrame(rows, columns=["key", "time", "pm25", "pm10", "no2"])
    d["time"] = pd.to_datetime(d["time"], format="%Y-%m-%dT%H")
    for c in ("pm25", "pm10", "no2"):
        d[c] = pd.to_numeric(d[c], errors="coerce")
    return d


def process_bundle(bundle, rep=None):
    """Write weather_<city>.parquet and cams_<city>.parquet for every city in an Open-Meteo bundle {city:{archive,forecast,cams}}."""
    rep = {} if rep is None else rep
    for city, x in bundle.items():
        if city in ("fetched_at", "tz", "units"):
            continue
        arch = pd.DataFrame(x["archive"]); fc = pd.DataFrame(x["forecast"])
        for fr in (arch, fc):
            fr["time"] = pd.to_datetime(fr["time"])
        arch = arch.set_index("time"); fc = fc.set_index("time")
        w = pd.concat([arch, fc[fc.index > arch.index.max()]]).sort_index()
        w = w[~w.index.duplicated(keep="last")]
        w = w.reindex(pd.date_range(w.index.min(), w.index.max(), freq="h"))
        w.index.name = "time"
        w.to_parquet(OUT / f"weather_{city}.parquet")
        cams = pd.DataFrame(x["cams"]); cams["time"] = pd.to_datetime(cams["time"])
        cams = cams.rename(columns={"pm2_5": "pm25"}).set_index("time")
        cams.to_parquet(OUT / f"cams_{city}.parquet")
        rep[f"weather_{city}"] = {"from": str(w.index.min()), "to": str(w.index.max()), "boundary_layer_null_pct": round(float(w.boundary_layer_height.isna().mean() * 100), 1)}
    return rep


def main():
    rep = {}
    a = parse_2017_2023()
    unknown = set(a.key) - set(KEYS)
    assert not unknown, f"unmapped stations 2017-23: {unknown}"
    rep["rows_2017_2023_raw"] = len(a)
    a["capped"] = a["aqi"] >= 500
    a = a[(a["aqi"] > 0) & (a["aqi"] <= 500)].copy()
    a["pm25"] = aqi_to_pm25(a["aqi"])
    a["pm10"] = np.nan; a["no2"] = np.nan; a["measured"] = False
    b = parse_2024_2025()
    unknown = set(b.key) - set(KEYS)
    assert not unknown, f"unmapped stations 2024-25: {unknown}"
    rep["rows_2024_2025_raw"] = len(b)
    bad = (b["pm25"] >= PM_SENSOR_LIMIT) | (b["pm25"] <= 0)
    rep["pm25_dropped_sensor_limit_or_zero_2024_25"] = int(bad.sum())
    b.loc[bad, "pm25"] = np.nan
    # PM2.5 can't exceed PM10 (physically); drop clear violations
    viol = b["pm25"] > b["pm10"] * 1.2 + 10
    rep["pm25_dropped_gt_pm10_2024_25"] = int(viol.sum())
    b.loc[viol, "pm25"] = np.nan
    b = b.dropna(subset=["pm25"]).copy()
    b["measured"] = True; b["capped"] = False
    cols = ["key", "time", "pm25", "pm10", "no2", "measured", "capped"]
    d = pd.concat([a[cols], b[cols]], ignore_index=True)
    # 2024 is measured -> use as is.  Remove accidental duplicates
    d = d.drop_duplicates(["key", "time"], keep="last")
    d["station"] = d["key"].map(KEYS)
    d = d.sort_values(["station", "time"]).reset_index(drop=True)
    d.to_parquet(OUT / "delhi_hourly.parquet", index=False)
    rep["rows_clean"] = len(d)
    rep["capped_aqi500_rows"] = int(d["capped"].sum())
    rep["coverage_pct_by_year"] = {int(y): round(float(g.groupby("station").size().mean() / (8760 if y not in (2020, 2024) else 8784) * 100), 1) for y, g in d.groupby(d.time.dt.year)}
    rep["stations"] = int(d.station.nunique())

    # --- weather + CAMS (main bundle + any openmeteo_<city>.json written by scripts/add_city.py)
    for bf in [RAW / "airward_openmeteo_bundle.json", *sorted(RAW.glob("openmeteo_*.json"))]:
        if bf.exists():
            process_bundle(json.load(open(bf)), rep)
    json.dump(rep, open(OUT / "quality_report.json", "w"), indent=1)
    print(json.dumps(rep, indent=1))


if __name__ == "__main__":
    main()
