"""Add a new city in one command.

    python scripts/add_city.py "Ludhiana" --lat 30.90 --lon 75.85
    python scripts/add_city.py "Lucknow" --lat 26.85 --lon 80.95 --zoom 11 --bbox 26.75 80.85 26.95 81.05

What it does (the code of the website/API never changes):
  1. adds the city to configs/cities.json  (name, centre, map box, one city-level 'station')
  2. downloads Open-Meteo weather (2017-2025 archive + 16-day forecast) and CAMS PM2.5 for that point
  3. cleans them (ml/prepare_data.process_bundle) and trains the city-level model (ml/train.py <key>)
  4. the API picks backend/app_data/<key>/ up on restart
A city with real ground stations: add them under "stations" in cities.json and provide hourly data like ml/prepare_data.py expects.
Needs internet access to open-meteo.com (run it on your laptop). `--bundle file.json` uses a saved download instead (offline test).
"""
import argparse, json, re, subprocess, sys, urllib.parse, urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "ml"))
VARS = "temperature_2m,relative_humidity_2m,wind_speed_10m,wind_direction_10m,precipitation,boundary_layer_height"


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


def fetch_bundle(lat, lon):
    q = lambda base, **kw: base + "?" + urllib.parse.urlencode(kw, safe=",")
    arch = get(q("https://archive-api.open-meteo.com/v1/archive", latitude=lat, longitude=lon, start_date="2017-01-01", end_date="2025-12-31",
                 hourly=VARS, timezone="Asia/Kolkata", wind_speed_unit="kmh"))["hourly"]
    fc = get(q("https://api.open-meteo.com/v1/forecast", latitude=lat, longitude=lon, hourly=VARS, past_days=60, forecast_days=16,
               timezone="Asia/Kolkata", wind_speed_unit="kmh"))["hourly"]
    cams = get(q("https://air-quality-api.open-meteo.com/v1/air-quality", latitude=lat, longitude=lon, hourly="pm2_5",
                 start_date="2022-08-01", end_date="2026-10-31", timezone="Asia/Kolkata"))["hourly"]
    return {"archive": arch, "forecast": fc, "cams": cams}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("name"); ap.add_argument("--lat", type=float, required=True); ap.add_argument("--lon", type=float, required=True)
    ap.add_argument("--zoom", type=int, default=12); ap.add_argument("--bbox", type=float, nargs=4, metavar=("S", "W", "N", "E"))
    ap.add_argument("--bundle", help="saved Open-Meteo bundle json instead of downloading")
    ap.add_argument("--bundle-city", help="city key inside --bundle to use (offline tests only)")
    ap.add_argument("--root", default=str(ROOT), help="project root (default: this project)")
    a = ap.parse_args()
    root = Path(a.root)
    key = re.sub(r"[^a-z0-9]", "", a.name.lower())
    cfgp = root / "configs" / "cities.json"
    cfg = json.load(open(cfgp))
    if key in cfg["cities"]:
        sys.exit(f"'{key}' already exists in configs/cities.json")
    bbox = a.bbox or [round(a.lat - 0.06, 4), round(a.lon - 0.08, 4), round(a.lat + 0.06, 4), round(a.lon + 0.08, 4)]
    cfg["cities"][key] = {"name": a.name, "center": [a.lat, a.lon], "zoom": a.zoom, "bbox": bbox, "weather_point": [a.lat, a.lon], "cell_step": 0.015, "mask_km": 99,
        "has_ground_stations": False, "data_source": "Open-Meteo CAMS PM2.5 (satellite-assimilated model, not ground sensors); weather Open-Meteo",
        "stations": [{"name": f"{a.name} (city estimate)", "key": f"{key}city", "lat": a.lat, "lon": a.lon}]}
    if a.bundle:
        b = json.load(open(a.bundle)); b = b[a.bundle_city or key]
    else:
        print("downloading Open-Meteo data ..."); b = fetch_bundle(a.lat, a.lon)
    (root / "data" / "raw").mkdir(parents=True, exist_ok=True)
    json.dump({key: b}, open(root / "data" / "raw" / f"openmeteo_{key}.json", "w"))
    json.dump(cfg, open(cfgp, "w"), indent=1)
    import importlib; pd_mod = importlib.import_module("prepare_data")
    pd_mod.OUT = root / "data" / "processed"; pd_mod.OUT.mkdir(parents=True, exist_ok=True)
    pd_mod.process_bundle({key: b})
    print("training city-level model ...")
    subprocess.run([sys.executable, str(root / "ml" / "train.py"), key], check=True, cwd=str(root / "ml"))
    print(f"\nDone. Restart the API; GET /api/{key}/meta is now live. Label: city-level estimate only (no ground stations).")


if __name__ == "__main__":
    main()
