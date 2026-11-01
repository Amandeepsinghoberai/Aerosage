# AirWard — neighbourhood-level Diwali air-pollution forecasts

Delhi (39 CPCB/DPCC stations) + Patiala (city-level estimate), 1–15 Nov 2026 (D-7 … D+7 around Diwali, 8 Nov).
Backend + model are in this repo; the React site (frontend team) is served by the same process once built.

## Run
```bash
pip install -r requirements.txt
python -m uvicorn backend.main:app --port 8000        # API docs: http://localhost:8000/docs
# website (when frontend/ is ready):  cd frontend && npm install && npm run build   -> backend serves frontend/dist at /
python -m pytest -q tests                              # endpoint tests
```
Retrain everything from the raw files (about 8 minutes):
```bash
python ml/prepare_data.py      # data/raw -> data/processed
python ml/train.py delhi       # models/, backend/app_data/delhi/
python ml/train.py patiala     # city-level model (CAMS-emulation)
python ml/interp_eval.py       # leave-one-station-out test, picks the wind weighting
```

## Pipeline
`data/raw` → `ml/prepare_data.py` → `ml/train.py` → `backend/app_data/<city>/*.json` (the cache) → `backend/main.py` (FastAPI) → website.
A new city is one command: `python scripts/add_city.py "Ludhiana" --lat 30.90 --lon 75.85` (needs internet; adds the config entry, downloads Open-Meteo data, trains, done).
`python scripts/refresh_forecast.py` re-runs the saved models on a fresh weather forecast (hourly job, no retraining); `POST /api/reload` makes the API re-read the files.
Deploy: `Dockerfile` / `render.yaml` (build the website first: `cd frontend && npm run build`). Frontend team: read `docs/API_CHANGES.md`.

## What the model is
* **Outlook model** (days ahead): LightGBM quantile regression (P10/P50/P90) from weather (wind, mixing height, ventilation,
  temperature, humidity, rain, 24 h changes), Diwali timing, season, hour/weekday, station place and *leakage-safe priors*
  (same station, same hours-from-Diwali, **previous years only**). No recent readings are needed, so it works for Diwali 2026.
* **Short-term models** (1, 3, 6, 24 h): predict the *change* from the latest reading. `POST /api/{city}/nowcast` accepts any live feed.
* **Why box**: LightGBM `pred_contrib` (SHAP-style) summed into 5 groups. **What-if**: each cause's positive contribution is scaled by the cut.
* **Neighbourhood cells**: 1.5 km grid, inverse-distance weighting (power 1.5) between station forecasts. A wind-aware variant (upwind stations count more)
  was tested by leave-one-station-out and gave no gain, so it is off (`app_data/delhi/interp.json` has the numbers).
* **AQI** = official CPCB PM2.5 sub-index formula (`ml/common.py: pm25_to_aqi`), shown as "AQI (from PM2.5)".

## Honesty notes (also returned by the API)
* All numbers are saved model forecasts, not live readings. `issued_at` is on every response.
* Backtest: model never saw data from 1 Oct 2025; P10–P90 widening was calibrated on **Diwali 2024** and only *reported* on Diwali 2025.
* Test-window weather is ERA5 reanalysis, not a day-ahead forecast, so real-world accuracy will be somewhat lower.
* 2017–2023 PM2.5 is derived from hourly AQI (inverse CPCB breakpoints; AQI 500 is a cap → 380 µg/m³); 2024–2025 is measured PM2.5.
  Up to ~20% of Diwali-window hours in 2020–21 sit at the cap, so past Diwali peaks are understated.
* Traffic is a time-of-day proxy; farm fires are a seasonal curve (no live FIRMS counts). "Why" shares are model reliance, not proven causes.
* Station coordinates are approximate (±1–2 km). Patiala has no ground stations: its "backtest" only measures how well we reproduce CAMS.

## Website (frontend/)
React + Vite + Leaflet, Delhi only. `cd frontend && npm install && npm run build` -> `frontend/dist`, served by the backend at `/`.
Dev: `npm run dev` (proxies /api to :8000). Screens: Map (slider, area panel, why box, health), Act (what-if, where to act first),
Proof (blind test, Diwali compare, replay, scorecard), About. Clicking outside the covered area shows "No data here".
# Aerosage
