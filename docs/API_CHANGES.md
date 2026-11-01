# API changes vs AirWard_Team_Handoff.json (for the frontend team)

The handoff contract still holds: every endpoint and field in it exists with the same shape. Everything below is **additive**.

## Extra fields (safe to ignore, useful to show)
* `/map` -> `cells[i]` now has 6 numbers: `[lat, lon, pm25_p50, confidence, pm25_p10, pm25_p90]` (use p10/p90 for the confidence colour/tooltip).
  Stations carry `kind: "station_forecast"` and `label`; the response has `labels` (honesty wording), `cache` (`state: "cached"`, `issued_at`) and `interpolation`.
* `/meta` -> `cause_help`, `labels`, `banner` (Patiala banner text, null for Delhi), `cells`, `interpolation`, `backtest.limitations`.
* `/explain` -> each cause has `direction` (raises/lowers/none), `help` text and `modelled` (true = seasonal proxy, see below).
* `/simulate` -> each station row has `suggested_action`; response has `stations_sorted` (names, worst first) and `fires_modelled`.
* `/diwali` -> `phases` (`before` / `night` / `after` average PM2.5 for 2017-2025 and 2026), `stations_reporting` (how many stations had data each year),
  `backtest.labels.actual` ("Observed ..." wording), `backtest.limitations`, `backtest.per_station_mae`, `backtest.category_within_one`.

## New endpoints
| Endpoint | Use |
|---|---|
| `GET /api/{city}/map/all` | all 360 hours of cell p50 in one call (cells given once) - smooth slider scrubbing |
| `GET /api/{city}/rank?hour=&top=10` | "Where to act first" list with suggested action |
| `GET /api/{city}/replay?station=&hour=2025-10-20T21` | short-term 1/3/6/24 h forecasts made at that hour in the Diwali-2025 test, next to what really happened |
| `POST /api/{city}/nowcast` | body `{station, now, readings:[>=25 hourly PM2.5]}` -> 1/3/6/24 h forecasts for any live feed |
| `GET/POST /api/{city}/scorecard` | the frozen Diwali-2026 forecast per day (7-11 Nov); POST actuals after 9 Nov to score it |
| `POST /api/reload` | operators only; needs header `x-admin-token` |

## Things the UI must say (they are true of the data)
* **Farm-fire cause is a seasonal proxy**, not fire counts. Say "Farm-fire smoke season (seasonal proxy)", never "farm fires caused X%".
* **Traffic is a time-of-day proxy.** Cells between stations are interpolated estimates; `confidence` 0/1/2 says how far from a station.
* **Wind-aware interpolation did not beat plain distance weighting** in the leave-one-station-out test, so the map uses plain IDW (power 1.5). Do not claim wind-aware cells.
* **Numbers to quote** (Delhi, Diwali 2025 blind test, from `/diwali`): read them from the API, do not hard-code. Band coverage is below 80% - show `coverage_p10_p90` as returned.
* Patiala: accuracy is vs the CAMS model, not ground sensors (`backtest.independent_ground_truth` is false).
* Past-Diwali lines for 2020-21 are understated: about 20% of those hours sit at the CPCB AQI cap of 500.
