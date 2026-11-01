# AirWard — every feature: what it does, how it works, how it is validated, how to show judges

## A. Where the data comes from (and how we clean it)
| Data | Source | How we got it | What we did to it |
|---|---|---|---|
| Station PM2.5/AQI, 39 Delhi stations | CPCB / DPCC via OpenCity | Downloaded files in `nexbyte`: 2017-2023 hourly AQI; 2024-2025 15-minute readings already averaged to hourly | 2017-23: AQI converted back to PM2.5 with the official CPCB table. Dropped 171 impossible values (zero or ≥900, the analyser limit) and 641 where PM2.5 > PM10 (physically wrong). 36,724 hours sit at the AQI cap of 500 (treated as 380 µg/m3). Station names matched across the two files. Result: 2.37 million clean station-hours (`docs/data_quality_report.json`) |
| Weather (wind, direction, mixing height, temperature, humidity, rain) | Open-Meteo: ERA5 history 2017-2025 and the 16-day forecast | The cloud could not reach it, so it was downloaded through your laptop's browser | Built features: ventilation (wind x mixing height), 24 h lows/means, 48 h rain, temperature drop |
| Satellite-model PM2.5 (CAMS) | Open-Meteo air-quality API | Same browser route | Used as a baseline for Delhi and as the training label for Patiala |
| Diwali dates 2017-2026 | Calendar | In `configs/cities.json` | Features: days from Diwali, Diwali night flag, hours since 7 PM on Diwali |
Known weak spots: Delhi 2017 had only ~17 stations reporting; 2020-21 Diwali peaks are understated by the 500 cap; station coordinates are approximate (1-2 km).

## B. The test everything rests on (the "hidden-answer exam")
Train only on data before 1 Oct 2025 -> forecast 10-31 Oct 2025 (Diwali 20 Oct) -> compare with what stations really read, against three simple rivals. The widening of the low/high range was set on Diwali 2024, never on the test. Show judges `/api/delhi/diwali` (backtest + curve).
Result: AirWard misses by 54.6 µg/m3; CAMS satellite model 60.8; last week's reading 68.0; average of past Diwalis 85.5. Right AQI category 43.7% (83% within one category). 80% range held 73.9%. Caveat: test weather was real recorded weather, not a day-ahead forecast.
Model choices were checked by leave-one-Diwali-year-out testing (2019, 2021-2024): with season features error 63.4, without 71.6.

## C. Feature by feature
**1. Neighbourhood map (626 boxes in Delhi, 72 in Patiala)**
* Does: colours every 1.5 km box by forecast PM2.5/AQI, with a confidence level (2 = near a station, 1 = medium, 0 = far).
* How: the model forecasts at 39 stations; each box takes a distance-weighted average of nearby stations (power 1.5).
* Validated: hide one station, estimate it from the other 38 on Diwali-2025 hours -> off by 28.7 µg/m3 on average. Wind-aware weighting was tested and did NOT help (so it is off; say so).
* Show judges: the "hide a station" test number; faded boxes; the label "Interpolated estimate".
* Be honest: this is the accuracy of the between-stations guess on observed values; it does not prove street-level accuracy, because we have no street sensors.

**2. Diwali slider (D-7 to D+7, 360 hours)**
* Does: moves the map through time. How: 360 saved forecast hours, served from memory (10 ms; one call returns all hours).
* Validated: it is the outlook model's accuracy (section B); speed tested (all endpoints < 35 ms after warm-up).

**3. Area forecast chart with range**
* Does: low / middle / high (P10 / P50 / P90) per hour for one station. How: three LightGBM models trained to predict the 10th, 50th and 90th percentile.
* Validated: section B. Range held 73.9% (target 80%). Per-station error: best Lodhi Road IITM 34, Chandni Chowk 40; worst Shadipur 74, NSIT Dwarka 73, Punjabi Bagh 67.
* Show judges: the blind-test chart (actual vs forecast with the band).

**4. "Why is the air bad?" box**
* Does: splits the forecast into five reasons. How: the model's own SHAP-style breakdown, summed into groups.
* Validated: it adds up exactly (causes + baseline = forecast, difference 0.0000). Sanity: crackers contribute +13 µg/m3 on 3 Nov afternoon but +83 on Diwali night 22:00.
* Be honest: shows what the MODEL relied on, not proven causes. Farm-fire = a seasonal curve (proxy), traffic = time-of-day pattern. Never say "crackers caused 30%".

**5. What-if sliders**
* Does: re-computes the map if crackers / traffic / farm fires are cut. How: each reason's positive share is reduced by the cut percentage; weather is never changed.
* Validated: automatic tests (0% cut = no change; more cut = lower PM2.5; works at every hour).
* Be honest: a scenario estimate, NOT validated against a real ban or policy. The farm-fire slider moves a seasonal proxy.

**6. Public Diwali 2026 forecast + scorecard**
* Does: freezes the forecast with the time the weather was downloaded (31 Oct 23:56 IST). After 9 Nov, POST the real city averages to `/scorecard` to get error, inside-range and category match.
* Validated: by the future. That is the point: it cannot be faked. Delhi city average: Diwali day ~262, 9 Nov ~273; Diwali night ~329.

**7. Proof of accuracy**: section B.

**8. Short-term forecasts (1/3/6/24 h)**
* How: models predict the CHANGE from the latest reading, using the last 24 h of readings plus weather/calendar of the target hour.
* Validated on Diwali 2025 against "same as now": 1 h 16.1 vs 18.1; 3 h 28.4 vs 36.7; 6 h 34.9 vs 52.8; 24 h 42.7 vs 47.8. Right category at 1 h: 76%.
* Be honest: no live station feed is connected. Show it with the replay (`/replay`) or by posting readings (`/nowcast`).

**9. Diwali compare chart**
* Does: city-average PM2.5 from D-7 to D+7 for 2017-2025 and the 2026 forecast, plus before / night / after averages. How: averages of the real station data per day.
* Be honest: 2017 has fewer stations; 2020-21 are understated by the cap. 2026 night forecast (329) is lower than measured 2024 (371) and 2025 (395) -> say "cautious".

**10. Smoke-trap alert** (wind < 7 km/h and mixing height < 250 m)
* Validated on 9 seasons of real data: PM2.5 is 31% higher in trap hours (175 vs 134). At night it is 19% higher (178 vs 150); in the afternoon there is no difference (118 vs 121).
* Say: "a warning at night and early morning". Suggest the frontend shows it mainly for evening-morning hours.

**11. Wind view**: arrows from the same Open-Meteo wind data. It informs people, but wind-based weighting did not improve our estimates.

**12. Health advice**: a fixed table by AQI colour and person type (general guidance, not medical advice). Not model-based, so there is no accuracy to claim.

**13. Where to act first (ranking)**
* Does: stations sorted by forecast. Validated: the station order is only weakly consistent with real Diwali nights (rank correlation 0.38 vs 2025, 0.20 vs 2024).
* Say: "areas that are usually worst", not a precise street order. Where crackers burn changes every year. Do not oversell this one.

**14. City switcher / scalability**
* Does: Delhi <-> Patiala; a new city is one command. Tested: a new city was created and served offline in seconds.
* Patiala has no ground stations: its forecast mimics the CAMS model (error 16 vs CAMS). Not independent accuracy.

**15. Sky photo check**: not built.

## D. Why this stands out against other teams
1. A real blind test with three baselines, and the weaknesses stated openly (most teams show one flattering number).
2. Uncertainty ranges on everything, plus confidence on the map.
3. Explainable and auditable: the breakdown adds up; every claim has a test behind it.
4. A promise that can be checked: the Diwali 2026 forecast + scorecard on 9 Nov.
5. Scales: new city in one command; saved results make Diwali-night traffic cheap; one API for web, dashboards, apps; hourly refresh script; Docker/Render files.
6. Scale of data: 2.4 million station-hours, 39 stations, 9 Diwalis.
7. We tested ideas that failed and said so (wind-aware weighting, no season features).

## E. Likely judge challenges and the honest reply
* "Your Diwali night forecast is lower than recent years." -> Cautious by design; we will score it on 9 Nov.
* "80% range, but you got 74%?" -> Yes; we report it as measured.
* "Is traffic or crop burning measured?" -> No; proxies; real fire counts and traffic data are the next step.
* "Why trust street-level?" -> We don't claim that: stations are forecasts, boxes are labelled estimates with a confidence level.
