# AeroSage frontend

AeroSage is a neighbourhood-level Diwali air-quality forecast interface for Delhi and Patiala. This folder contains the complete frontend for the project.

## Run locally

1. Open a terminal in this folder.
2. Run `npm install` once.
3. Run `npm run dev` and open the local address printed by Vite.

Vite proxies `/api` requests to `http://localhost:8000`. Start the FastAPI service on port 8000 to load saved forecasts, area details, explanations, scenario results and Diwali backtests. If the API is unavailable, the site remains navigable in **Preview mode** and labels its illustrative values accordingly.

## Build

Run `npm run build`. Vite writes the static site to `dist/`. The handoff describes serving this directory from the FastAPI app so the frontend and `/api` endpoints share one origin.

## Pages

- **Story** — scroll-led explanation of the sensor gap, Diwali pollution period, forecast ranges and response planning.
- **Explore map** — Delhi/Patiala switcher, 360-hour timeline, estimated grid, station markers, AQI categories, weather and stagnation context.
- **Area forecast** — P10/P50/P90 chart, grouped model explanation and the limits of short-term forecasts without a live station feed.
- **What-if** — cracker, traffic and farm-fire sliders, before/after map, scenario estimate and suggested priority areas.
- **Compare** — past Diwali measurements beside the 2026 forecast when the API is connected; in preview, only the published three-day forecast values are shown.
- **Proof** — held-out Diwali 2025 metrics, baselines, coverage, limitations and a local scorecard for observed values after 9 November.
- **Health** — plain-language guidance by person type and forecast category.
- **Scale** — data-to-website pipeline, city configuration pattern and API surface.

## Data honesty

- Forecasts are saved model estimates, not live readings. The issue time appears on every page.
- AQI is shown as the CPCB PM2.5 sub-index only.
- Map cells between stations are estimates. Faded cells indicate lower confidence.
- Model contribution bars describe signals used by the model. They are not measured source shares or proof of physical causation.
- Delhi traffic is a time-of-day proxy; farm-fire influence is a seasonal curve in this release.
- Patiala has no ground stations and is labelled as a city-level estimate.
- Preview map and scenario values are illustrative. They are visibly labelled when the API is disconnected.
- The landing page asks for browser location only after the visitor selects **Use my location**. Coordinates stay in memory for the request and are not saved.
- Current-location AQI and PM2.5 are approximate CAMS-based model estimates from Open-Meteo, not a nearby sensor reading. The page credits Open-Meteo/CAMS; see [the Air Quality API documentation](https://open-meteo.com/en/docs/air-quality-api).

## Expected API

The frontend uses the `/api` routes in `AirWard_Team_Handoff.json`: `/health`, `/cities`, `/{city}/meta`, `/{city}/map`, `/{city}/forecast`, `/{city}/nearest`, `/{city}/explain`, `/{city}/simulate` and `/{city}/diwali`.
