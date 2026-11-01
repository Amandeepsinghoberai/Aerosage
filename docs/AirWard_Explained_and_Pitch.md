# AirWard in plain words — what it is, how it works, how to pitch it

(Numbers are from the saved results of the final model run. Quote them from the API `/api/delhi/diwali`, not from memory.)

## 1. The idea in one breath
Delhi has 39 official air-quality stations for about 3 crore people. Most streets have no reading. AirWard forecasts the air for every 1.5 km box of Delhi,
hour by hour, from 7 days before to 7 days after Diwali 2026, tells you WHY it will be bad, and lets officials test "what if we cut crackers / traffic?".

## 2. How it works (layman)
**Think of a weather forecast for pollution.**
1. **Learn from history.** We gave the computer 9 years of hourly readings from all 39 stations (2017-2025) plus the weather of each hour (wind, how high the air mixes, temperature, humidity, rain).
2. **Learn the pattern.** Example: "when wind is below 7 km/h and the air is trapped under a low lid, smoke stays near the ground and PM2.5 rises". Also: "the night of Diwali is always much worse", "evenings are worse than afternoons".
3. **Forecast.** Open-Meteo gives the weather forecast for 1-15 Nov 2026. We feed it in and the model says what each station will read.
4. **Give a range, not one number.** Like "likely between 180 and 340" (the P10-P90 range), because nobody can be exact.
5. **Fill the gaps between stations.** A street 2 km from a station gets a weighted average of nearby stations (closer = more weight). These boxes are marked "estimate", and faded when far from any station.
6. **Explain.** The "Why" box splits the forecast into five reasons (crackers, weather trap, farm-fire season, traffic/daily routine, local area), like splitting a restaurant bill.
7. **What-if.** Officials slide "cut crackers 70%" and the map is recomputed by removing that reason's share of the bill.
8. **Save results.** Everything is computed once and saved, so thousands of visitors on Diwali night just read saved files and the site stays fast.

**Three kinds of forecast, simply**
* *Days ahead (outlook):* needs only weather + calendar. This is what the public Diwali 2026 forecast uses.
* *Next few hours (1, 3, 6, 24 h):* uses the last readings; "it is 300 now, it will probably be 340 in 3 hours".
* *Between stations:* the colour of every box on the map.

## 3. What we built (backend + model side)
* Cleaned data for 39 stations, 2017-2025, and weather for Delhi and Patiala. CPCB AQI formula implemented exactly.
* Models: days-ahead model with low/middle/high range; 1/3/6/24-hour models; the "why" breakdown.
* Delhi (39 stations) and Patiala (city-level) forecasts for 1-15 Nov 2026, saved.
* API: map by hour (1000+ boxes), station forecast, why, what-if, rank "where to act first", Diwali compare + proof numbers, short-term replay, live-feed nowcast, public scorecard.
* Honesty labels in every response (forecast not live, issued time, estimate vs station, confidence 0/1/2).
* Add a new city with one command; hourly refresh script; Docker/Render files; 16 automatic tests; every endpoint answers in under 35 ms (after warm-up).

## 4. What is NOT done
* The website (frontend team). Health advice and the sky-photo check (frontend / stretch). Sky photo: not built at all.
* Road-density adjustment (needs OpenStreetMap download; unlikely to help with 39 stations).
* Real farm-fire satellite counts (needs a free NASA key). Farm fires and traffic are PROXIES.
* Live station feed (the short-term models are ready; they need a data feed). GNN: future slide only.
* Not yet run on your Mac; a live check of the API there is still to do.

## 5. Accuracy — honest, in simple words
Test = "exam with hidden answers": the model was trained only on data before 1 Oct 2025, then asked about Diwali 2025 (10-31 Oct 2025).

| Method (Delhi, Diwali 2025) | Average miss (µg/m3 PM2.5) | Right AQI category |
|---|---|---|
| **AirWard** | **54.6** | **43.7%** (83% within one category) |
| Global satellite model (CAMS) | 60.8 | 27.9% |
| "Same as last week" | 68.0 | 27.4% |
| "Average of past Diwalis" | 85.5 | 33.9% |

* In plain words: AirWard misses by about 55 on average, 20% better than "same as last week" and 10% better than the global model. It picks the exact AQI colour about 4 times in 10, and is within one colour 8 times in 10. **Use it for trends and planning, not exact hour-by-hour.**
* The "80% range" actually held 74% of the time (we set it on 2024 data and did NOT tune it on the test). Say "about three-quarters".
* Next-hours models beat "same as now" at every horizon: 1 h error 16 vs 18, 3 h 28 vs 37, 6 h 35 vs 53, 24 h 43 vs 48.
* Guess between stations (hiding one station and estimating it from the others): off by about 29 on average.
* The test used reanalysis weather, not a real day-ahead weather forecast, so real accuracy will be somewhat lower.
* Patiala has no ground sensors: its check only shows we reproduce the CAMS model (error 16); it is NOT proof of real accuracy.

**Diwali 2026 forecast (Delhi):** city average about 262 on Diwali day and 273 on 9 Nov (Severe level); Diwali night about 329 on average, worst around Rohini / Vivek Vihar / Mundka (~385).
Note: measured Diwali nights in 2024 and 2025 averaged 371 and 395, so our night forecast is on the cautious side. We will score it on 9 Nov.

## 6. Plan vs plan, final status
| Topic | Final pick | Status |
|---|---|---|
| City | Delhi first, Patiala second | Done (both live; new city = 1 command) |
| Model | 1/3/6/24 h guesses | Done, beats "same as now" at all four |
| Area guess | grid + nearby stations (+ wind, + roads) | Grid + nearby stations done. Wind tested, no gain, so OFF. Roads not done |
| AQI number | official CPCB formula | Done (PM2.5 part only; label "AQI from PM2.5") |
| Honesty labels | Observed / Estimate / Cached + confidence | Done in API; colours are for the frontend. "Observed" is used only for past readings |
| Diwali view | slider + compare chart | Data done (D-7..D+7, past 9 years, before/night/after) |
| Why box | keep | Done (farm-fire and traffic are proxies) |
| What-if sliders | yours stands out | Done in API |
| Diwali 2026 public forecast | stands out | Done + scorecard to fill after 9 Nov |
| Health advice | small but useful | Text table exists; frontend task |
| Sky photo | only if time | Not built |
| GNN / Transformer | future slide | Slide only |

## 7. The 3-minute pitch (say it like this)
1. **Hook (20 s):** "Delhi has 39 air stations for 3 crore people. On Diwali night, your street probably has no reading at all."
2. **What it is (20 s):** "AirWard forecasts the air for every 1.5 km box, hour by hour, a week before and after Diwali, and explains why."
3. **Proof (40 s):** "We hid Diwali 2025 from the model and asked it to predict. It missed by 55 on average. 'Same as last week' missed by 68, the global satellite model by 61. It names the right AQI colour about 4 times in 10 and is within one colour 8 times in 10. We tell you exactly where it is weak."
4. **Live demo (60 s):** Drag the slider to Diwali night, click Rohini, show the range and the Why box. Then the what-if: "green crackers only + less traffic" and watch the average drop and the 'Where to act first' list.
5. **Public promise (15 s):** "Our Diwali 2026 forecast is saved with a timestamp. Check it on 9 November."
6. **Scale (25 s):** "Switch to Patiala: new city is one command, same code. Results are saved, so Diwali-night traffic only reads files. One API serves the website, officials' dashboards and apps. Next: live sensors, real farm-fire satellite data, a graph AI between stations."

**Simple examples to use on stage**
* *Range:* "Not 'it will be 300' but 'between 250 and 350', like a rain forecast of 70% chance."
* *Why box:* "Like splitting a restaurant bill into starters, mains and dessert."
* *Weather trap:* "Smoke is like steam in a bathroom with the window shut."
* *Blind test:* "An exam where the answers were hidden."

## 8. Questions judges may ask, and honest answers
* **Is it live data?** No. It is a saved forecast issued at the time shown. A live feed plugs into the next-hours models.
* **How can you know my street?** We don't measure it. We estimate it from nearby stations, and fade the colour when the nearest station is far. Hiding a station and estimating it from the others is off by about 29 on average.
* **Is traffic / farm fire real?** Not yet. Traffic = time-of-day pattern, farm fire = seasonal curve. Real fire satellite counts are next. The Why box shows what the model relied on, not proven causes.
* **How accurate?** Numbers in section 5. Not great at the exact hour, good at trends. Real-world will be a bit lower because the test used real weather instead of forecast weather.
* **Why not deep learning?** With hourly table data, boosted trees are fast, accurate and explainable; a graph AI between stations is our roadmap.
* **Why is Diwali night lower than the last two years?** The model smooths the sharp firecracker spike; treat it as cautious and judge it on 9 Nov.
