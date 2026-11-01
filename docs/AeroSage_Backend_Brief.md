# AeroSage backend: technical brief for the team

The project folder is `AirWard`. The product name is AeroSage. Backend = Python 3, FastAPI, LightGBM, pandas.
All numbers below come from the current `backend/app_data/delhi/results.json` (retrained 1 Nov 2026).

## 1. Big picture

```
RAW DATA (data/raw)            PREPARE (ml/prepare_data.py)        TRAIN (ml/train.py)                 SERVE (backend/main.py)
CPCB/DPCC station files   -->  data/processed/*.parquet       -->  models/*.txt  (LightGBM boosters)  -->  FastAPI reads saved JSON/parquet
Open-Meteo weather bundle      delhi_hourly, weather_delhi,        backend/app_data/delhi/*.json            + a few models, answers /api/...
                               cams_delhi                          panel_2026.parquet                       + serves frontend/dist
```

Key idea: **training is offline, serving is a cache.** `train.py` writes the whole 1-15 Nov 2026 forecast to JSON. The API loads
that JSON into memory at start-up and pre-computes every map hour, so Diwali-night traffic only reads memory.
Only `/nowcast` runs a model live.

## 2. Folder / file map

| Path | What it is |
|---|---|
| `configs/cities.json` | The single config: Diwali dates 2017-2026, `alias_keys` (station name fixes), per city: name, centre, `bbox`, `cell_step` (0.015 deg = 1.5 km), `mask_km` (6.5), `has_ground_stations`, `weather_point`, 39 stations (`name,key,lat,lon`). New city = new entry here + `python ml/train.py <city>` |
| `data/raw/` | `airward_delhi_hourly_aqi_2017_2023.txt` (hourly AQI), `airward_delhi_15min_hourly_2024_2025_part1/2.txt` (measured PM2.5), `airward_openmeteo_bundle.json` (ERA5 archive + forecast + CAMS PM2.5) |
| `data/processed/` | `delhi_hourly.parquet` (time, station, pm25), `weather_delhi.parquet`, `cams_delhi.parquet`, `quality_report.json` |
| `ml/common.py` | Shared by training AND API: CPCB AQI maths, Diwali/calendar features, weather features, feature groups, `Interpolator` |
| `ml/prepare_data.py` | Parses the raw text files, cleans (values >= 900 ug/m3 treated as sensor saturation), writes `data/processed/` |
| `ml/train.py` | Builds features, runs backtests, trains and saves models, exports forecast files |
| `ml/interp_eval.py` | Leave-one-station-out test of the neighbourhood interpolation, writes `app_data/delhi/interp.json` |
| `scripts/refresh_forecast.py` | Re-runs the SAVED models on a new weather forecast (no retraining), rewrites forecast files with a new `issued_at` |
| `models/` | `delhi_outlook_q10/50/90.txt`, `delhi_short_{1,3,6,24}h.txt` (live), `delhi_short_{h}h_test.txt` (trained only before Oct 2025, used for the replay) |
| `backend/main.py` | The FastAPI app (411 lines) |
| `backend/app_data/delhi/` | `forecast_diwali2026.json` (P10/P50/P90 + weather per station per hour), `contrib_diwali2026.json` (cause contributions), `results.json` (all accuracy numbers), `shortterm_replay.json`, `panel_2026.parquet` (features for the nowcast), `interp.json` |
| `tests/test_api.py` | pytest tests for the endpoints |
| `frontend/` | React app; `frontend/dist` is served by the backend |

Run: `pip install -r requirements.txt` then `python -m uvicorn backend.main:app --port 8000` (docs at `/docs`).
Retrain: `python ml/train.py delhi` (about 10+ minutes).

## 3. Data and variables

**Target:** `pm25` (ug/m3), hourly, per station. 2017-2023 values are derived from hourly AQI (24 h averaged, capped at 500). 2024-2025 are measured hourly PM2.5. Training rows: 821,181, period 2017-01-01 to 2025-12-31 (September onwards each year only).

**Weather (Open-Meteo, one point for Delhi):** raw `temperature_2m, relative_humidity_2m, wind_speed_10m (km/h), wind_direction_10m, precipitation, boundary_layer_height`. Derived in `derive_weather()`:
`ws, blh, temp, rh, wd, vent` (= ws/3.6 x blh, the ventilation index), `blh_min24`, `ws_mean24`, `rain48`, `wd_sin, wd_cos`, `temp_drop24`.

**Calendar (`calendar_feats`, needs no data, works for any future date):** `since_diwali_h`, `days_from_diwali` (-30..30), `diwali_evening_hours` (hours since Diwali 19:00, clipped -48..96), `diwali_night` (0-11 h after 19:00), `stubble` (a bell curve peaking around 4 Nov, a seasonal proxy, NOT live fire counts), `doy_sin/cos`, `hour_sin/cos`, `dow`, `is_weekend`, `offset_h`.

**Place and priors (leakage-safe):** `station_code` (categorical), `lat`, `lon`, `station_prior` (that station's mean Sept+ level in earlier years), `prev_diwali_offset` (that station's smoothed level at the same hour offset from Diwali in earlier years), `city_prev_offset` (same, city mean). For a target year Y the priors use only years < Y.

**Short-term only (nowcast):** `pm_now, lag1,2,3,6,12,24, roll6, roll24` (recent readings). The outlook model deliberately uses NO recent readings, so it works days ahead.

**Cause groups (`GROUPS` in common.py)**, used by Why box and What-if: Diwali crackers, Weather trap, Farm-fire smoke season (seasonal proxy), Traffic and daily routine (time-of-day proxy), Local area.

**AQI:** `pm25_to_aqi()` is the CPCB PM2.5 piece-wise sub-index (0-30 to 0-50, ... 250-380 to 400-500, capped at 500). `cat_idx()` gives the 6 categories (Good ... Severe).

## 4. The models and how they communicate

There is no model-to-model chain at serving time. Everything is a **hand-off through files**:

1. **Outlook model** (LightGBM quantile regression, three boosters, alpha = 0.1/0.5/0.9). Features = weather + calendar + place + priors. Output P10/P50/P90 per station per hour for 1-15 Nov. Hyper-parameters `OUT_PARAMS`: 300 trees, lr 0.05, 15 leaves, `min_child_samples` 400.
   - **Diwali weighting:** `diwali_weight()` gives 5x sample weight to hours -6..+36 around Diwali 19:00 (the cracker peak is rare, so an unweighted model smooths it away).
   - **Band widening:** `band_scale = 1.3` multiplies the P10/P90 distance from P50. It is fitted on Diwali 2024, then only reported on 2025.
2. **Cause split:** the same P50 booster is called with `pred_contrib=True` (SHAP-style), and the per-feature contributions are summed into the 5 groups (`group_contrib`). Saved in `contrib_diwali2026.json` as `contrib[5][T]` and `bias` per station.
3. **Short-term models** (1/3/6/24 h): predict the CHANGE from the latest reading (`y_delta`), then `pred = now + delta`. Compared with persistence (same as now).
4. **Interpolation (not ML):** `Interpolator` in common.py. Wind-aware inverse-distance weighting between the 39 stations, upwind stations boosted by `1 + k * min(ws,15)/15 * cos(bearing - wind_from)`. `k` and `power` come from `interp.json` (power 1.5, 1.5 km cells, 626 Delhi cells kept within 6.5 km of a monitor). Confidence per cell: 2 = within 2.5 km, 1 = 2.5-5 km, 0 = further.
5. **What-if:** `/simulate` subtracts `cut x max(contribution, 0)` for the cracker, traffic and fire groups from P50, re-interpolates the map. It is a scenario estimate from the model's own breakdown, weather never changes.

Flow at runtime: `City` class loads `forecast_diwali2026.json`, `contrib_diwali2026.json`, `results.json`, `interp.json`, `panel_2026.parquet` into numpy arrays. Map cells are cached per hour with `lru_cache`.

## 5. API reference (base `/api`)

| Endpoint | Input | Returns |
|---|---|---|
| `GET /health` | none | status, cities, model name, `issued_at` |
| `GET /cities` | none | list of cities |
| `GET /{city}/meta` | none | stations, hours (`times`), bbox, importance, backtest, labels, cell count |
| `GET /{city}/map` | `hour=2026-11-08T21` | cells `[lat, lon, p50, confidence, p10, p90]`, stations, city mean, weather |
| `GET /{city}/map/all` | none | all 360 hours of cell p50 in one call (for the slider) |
| `GET /{city}/forecast` | `station` | P10/P50/P90 + weather series for 360 h |
| `GET /{city}/nearest` | `lat, lon` | nearest station and distance (km) |
| `GET /{city}/explain` | `station, hour` | 5 causes in ug/m3 and share %, baseline |
| `GET /{city}/simulate` | `hour, crackers, traffic, fires` (0-1) | before/after map and per-station table |
| `GET /{city}/rank` | `hour, top` | worst stations with suggested action |
| `GET /{city}/diwali` | none | past Diwalis, 2026 forecast, backtest, phases, importance |
| `GET /{city}/replay` | `station, hour` | short-term forecasts vs actual inside the Diwali 2025 test |
| `POST /{city}/nowcast` | `{station, now, readings[>=25]}` | 1/3/6/24 h forecasts from live readings you send |
| `GET/POST /{city}/scorecard` | POST `{actuals:{date:pm25}}` | forecast vs reality for 7-11 Nov |
| `POST /reload` | header `x-admin-token` | re-reads app_data (off unless env `AIRWARD_ADMIN_TOKEN` is set) |

Time format is IST, `YYYY-MM-DDTHH`. Forecast window 2026-11-01T00 to 2026-11-15T23 (360 hours). Responses are gzip-compressed with `Cache-Control: max-age=300`, CORS open. Errors are plain 404/422 with a readable `detail`.

## 6. How accuracy is measured

**Blind test, Diwali 2025:** the test model never sees data on or after 2025-10-01. Test window 2025-10-10 to 2025-10-31 (Diwali 20 Oct), 19,913 station-hours. Metrics (`metrics()` in train.py): MAE, RMSE, category accuracy (exact CPCB category), within-one-category.

| Model (same test window) | MAE (ug/m3) | Category accuracy |
|---|---|---|
| AeroSage (AirWard model) | **49.0** | **45.5%** |
| Global CAMS model (Open-Meteo) | 60.8 | 27.9% |
| Last week's reading | 68.0 | 27.4% |
| Average of past Diwalis | 85.5 | 33.9% |

Within one category: 85.1%. RMSE 73.0.

**Band (P10-P90):** `calibrate_scale()` searches 1.0-4.0 for the scale that gives 80% coverage on Diwali 2024 (result 1.3, gives 80.2% there). On the blind test it covers **74.7%** (raw un-widened 63.0%). So the band is slightly too narrow, say so honestly.

**Short-term vs persistence (test window):** 1 h MAE 16.1 vs 18.1; 3 h 28.4 vs 36.7; 6 h 34.9 vs 52.8; 24 h 42.7 (persistence higher).

**Other checks:**
- Leave-one-Diwali-year-out (folds 2019, 2021-2024, data < 2025-10) is the model-selection tool: chose seasonal terms (MAE 63.4 vs 71.6 without) and the Diwali weighting (peak bias -16.5 to -6.6 ug/m3, overall flat).
- Leave-one-station-out (`ml/interp_eval.py`): hide a station, estimate it from the others, error 28.7 ug/m3. Chosen on 2024, reported on 2025.
- Per-station MAE is in `results.json -> backtest.per_station_mae`.

**Leakage rules** (enforced in code): train cut-off before the test window; priors use earlier years only; band calibrated on a different year than the test.

## 7. Known limits (tell judges before they ask)

1. Test weather is ERA5 reanalysis, not a day-ahead forecast, so real accuracy will be somewhat lower.
2. No live feed: the forecast is a saved file (`issued_at` = 1 Nov 2026 04:06 IST). `/nowcast` accepts readings only if somebody POSTs them.
3. Farm fires and traffic are proxies (season curve, time of day), not FIRMS counts or traffic data.
4. The Diwali peak is still forecast a little low.
5. Band coverage is 74.7%, below the 80% target.
6. The map only covers about 6.5 km around monitors. Station coordinates are approximate (+-1-2 km). 2017-2023 labels are derived from AQI.
7. The Why box for a clicked box comes from the nearest monitor, not from the box itself.
8. Patiala exists in the backend (city-level model copying CAMS, no ground stations) but is hidden on the site.

## 8. Handy commands

```
python ml/prepare_data.py            # raw -> data/processed
python ml/interp_eval.py             # re-tune interpolation
python ml/train.py delhi             # retrain + backtest + export forecast files
python scripts/refresh_forecast.py   # new weather forecast, no retraining
curl -X POST -H "x-admin-token: $AIRWARD_ADMIN_TOKEN" localhost:8000/api/reload
pytest tests                          # API tests
```
