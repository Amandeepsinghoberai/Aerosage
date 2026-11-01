import React, { useEffect, useMemo, useState } from "react";
import { get, q } from "./api.js";
import { ForecastChart } from "./charts.jsx";
import { pm25ToAqi, band, fmtHour, isNight } from "./aqi.js";
import { PERSONS, advice } from "./health.js";

const short = (s) => s.replace(" (low wind / low mixing layer)", "");

export default function AreaPanel({ meta, all, nowIdx, detail, sel, hour, setHour, onClose, goAct }) {
  const t = meta.times[hour];
  // nearest station for a clicked box (names come with the station list in meta)
  const station = useMemo(() => {
    if (sel.name) return sel.name;
    let best = null, bd = 1e9;
    meta.stations.forEach((s) => { const d = (s.lat - sel.lat) ** 2 + ((s.lon - sel.lon) * 0.88) ** 2; if (d < bd) { bd = d; best = s; } });
    return best.name;
  }, [sel, meta]);
  const isStation = !!sel.name;
  const isNow = hour === nowIdx;
  const near = useMemo(() => meta.stations.map((s) => ({ name: s.name, km: Math.sqrt(((s.lat - sel.lat) * 111) ** 2 + ((s.lon - sel.lon) * 98) ** 2) })).sort((a, b) => a.km - b.km).slice(0, 3), [sel, meta]);
  const [fc, setFc] = useState(null), [why, setWhy] = useState(null), [err, setErr] = useState(null), [person, setPerson] = useState(PERSONS[0]);
  useEffect(() => { setFc(null); setErr(null); get(`/delhi/forecast?${q({ station })}`).then(setFc).catch((e) => setErr(e.message)); }, [station]);
  useEffect(() => { let on = true; get(`/delhi/explain?${q({ station, hour: t })}`).then((x) => on && setWhy(x)).catch(() => on && setWhy(null)); return () => { on = false; }; }, [station, t]);

  // headline value: the clicked box if we have its detail, else the station forecast
  let p50, p10, p90, label;
  if (!isStation && sel.i != null) {
    p50 = all.pm25_p50[hour][sel.i];
    const c = detail && detail.cells[sel.i]; p10 = c ? c[4] : null; p90 = c ? c[5] : null;
    label = "Estimated between monitors";
  } else if (fc) { p50 = fc.p50[hour]; p10 = fc.p10[hour]; p90 = fc.p90[hour]; label = "Station forecast"; }
  const aqi = pm25ToAqi(p50), b = aqi != null ? band(aqi) : null;
  const trap = useMemo(() => (fc ? fc.weather.ws.map((w, i) => (w < 7 && fc.weather.blh[i] < 250 && isNight(meta.times[i]))) : []), [fc, meta]);
  const trapNow = trap[hour];

  return (
    <aside className="sheet" aria-label="Selected area">
      <button className="x" onClick={onClose} aria-label="Close panel">×</button>
      <header>
        <p className="muted">{isStation ? `${station} station` : `Near ${station}`}</p>
        <div className="head">
          <span className="num" style={{ color: b ? b.color : undefined }}>{aqi ?? "–"}</span>
          <div><strong>{b ? b.name : ""}</strong><span className="muted small">{p10 != null && p90 != null ? `Likely range AQI ${pm25ToAqi(p10)}–${pm25ToAqi(p90)}` : ""}</span></div>
        </div>
        <p className="muted small">{isNow ? "Now · " : ""}{fmtHour(t)} · <span className="tag">{label || "Forecast"}</span> <span className="tag">{isNow ? "Forecast for this hour, not a live reading" : "Forecast, model estimate"}</span></p>
      </header>

      {err && <p className="err">Could not load this area: {err}</p>}
      {fc && (
        <section>
          <h3>Forecast for the whole week</h3>
          <ForecastChart p10={fc.p10} p50={fc.p50} p90={fc.p90} idx={hour} onPick={setHour} trap={trap} />
          <p className="muted small">The line is the likely value. The soft band is the low–high range. Drag to change the hour.</p>
        </section>
      )}

      {trapNow && (
        <div className="trap-note"><b>Smoke is likely to stay near the ground.</b> Wind is light and the air is not mixing upward. In past years, nights like this ran about 19% higher.</div>
      )}

      {why && (
        <section>
          <h3>Why is the air like this?</h3>
          <p className="muted small">Typical level here is about AQI {pm25ToAqi(why.typical_baseline_pm25)}. These reasons push it up from there.</p>
          <ul className="why">
            {why.causes.map((c) => {
              const mx = Math.max(...why.causes.map((x) => Math.abs(x.ug_m3)));
              return (
                <li key={c.cause} title={c.help}>
                  <div className="whyrow"><span>{short(c.cause)}</span><span>{c.direction === "raises" ? "+" : "−"}{Math.abs(c.ug_m3).toFixed(0)} µg/m³</span></div>
                  <div className="bar"><i className={c.direction === "raises" ? "up" : "down"} style={{ width: `${(Math.abs(c.ug_m3) / mx) * 100}%` }} /></div>
                  <span className="muted small">{c.help}</span>
                </li>
              );
            })}
          </ul>
          <p className="muted small">This shows what the model relied on. It is not a measured split of sources.</p>
        </section>
      )}

      {b && (
        <section>
          <h3>What should I do?</h3>
          <div className="chips">{PERSONS.map((p) => (<button key={p} className={"chip" + (p === person ? " on" : "")} onClick={() => setPerson(p)}>{p}</button>))}</div>
          <p className="advice" style={{ borderColor: b.color }}>{advice(b.name, person)}</p>
          <p className="muted small">General guidance, not medical advice.</p>
        </section>
      )}
      <section>
        <h3>Where this number comes from</h3>
        <ol className="how">
          <li><b>Real history.</b> The model learned from nine years of readings at the 39 monitors, 2017 to 2025.</li>
          <li><b>Weather for this hour.</b> {fc ? `Wind ${fc.weather.ws[hour]} km/h, mixing height ${fc.weather.blh[hour] < 50 ? "under 50" : fc.weather.blh[hour]} m, ${fc.weather.temp[hour]}°C (Open-Meteo forecast).` : "Loading…"}</li>
          <li><b>Forecast for the monitor.</b> The model combines the weather, the date relative to Diwali, the time of day and the monitor's usual level.</li>
          {isStation
            ? <li><b>This dot.</b> It is the {station} monitor, so the number is the model's forecast for that exact place.</li>
            : <li><b>This box.</b> It blends the forecasts of the nearest monitors: {near.map((n) => `${n.name} (${n.km.toFixed(1)} km)`).join(", ")}. Nearer monitors count more.</li>}
        </ol>
      </section>
      <button className="primary" onClick={() => goAct(hour)}>Test what-if ideas for this hour</button>
    </aside>
  );
}
