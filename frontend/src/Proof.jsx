import React, { useEffect, useState } from "react";
import { get, q } from "./api.js";
import { CompareChart } from "./charts.jsx";
import { band } from "./aqi.js";

const NAMES = { "AirWard model": "AeroSage", "Last week's reading": "Last week's reading", "Global CAMS model (Open-Meteo)": "Global satellite model", "Average of past Diwalis": "Average of past Diwalis" };

export default function Proof({ meta }) {
  const [d, setD] = useState(null), [sc, setSc] = useState(null), [err, setErr] = useState(null), [hi, setHi] = useState(null);
  const [st, setSt] = useState("Anand Vihar"), [rp, setRp] = useState(null);
  useEffect(() => { get("/delhi/diwali").then(setD).catch((e) => setErr(e.message)); get("/delhi/scorecard").then(setSc).catch(() => {}); }, []);
  useEffect(() => { get(`/delhi/replay?${q({ station: st, hour: "2025-10-20T19" })}`).then(setRp).catch(() => setRp(null)); }, [st]);
  if (err) return <main className="page"><p className="err">Could not load this page: {err}</p></main>;
  if (!d) return <main className="page"><p className="muted">Loading…</p></main>;
  const m = d.backtest.metrics, rows = Object.entries(m).map(([k, v]) => ({ name: NAMES[k] || k, mae: v.mae, us: k === "AirWard model" })).sort((a, b) => a.mae - b.mae);
  const mx = Math.max(...rows.map((r) => r.mae)), us = m["AirWard model"], wk = m["Last week's reading"];
  const better = Math.round((1 - us.mae / wk.mae) * 100);
  const ph = d.phases, years = Object.keys(d.past);
  const avg = (k) => Math.round(years.reduce((a, y) => a + ph[y][k], 0) / years.length);
  return (
    <main className="page">
      <header className="pagehead">
        <h1>How far you can trust it</h1>
        <p className="lead">We tested AeroSage on a Diwali it had never seen, and we are saving this year's forecast before the festival so it can be checked afterwards.</p>
      </header>

      <section className="card">
        <h2>Tested on Diwali 2025, without letting the model see it</h2>
        <p className="muted">Average miss in PM2.5 (µg/m³) across {m["AirWard model"].n.toLocaleString("en-IN")} hourly forecasts. Lower is better.</p>
        <ul className="hbars">
          {rows.map((r) => (<li key={r.name} className={r.us ? "us" : ""}><span>{r.name}</span><div className="bar"><i style={{ width: `${(r.mae / mx) * 100}%` }} /></div><b>{r.mae.toFixed(0)}</b></li>))}
        </ul>
        <div className="facts">
          <div><b>{better}%</b><span>closer than repeating last week's reading</span></div>
          <div><b>{d.backtest.category_accuracy ?? us.category_accuracy}%</b><span>right AQI band exactly; {Math.round(d.backtest.category_within_one)}% within one band</span></div>
          <div><b>{Math.round(d.backtest.coverage_p10_p90)}%</b><span>of real readings fell inside our low–high range</span></div>
        </div>
        <p className="muted small">Tested with recorded weather rather than a day-ahead weather forecast, so real use will be somewhat less accurate. Use the forecast for planning and trends.</p>
      </section>

      <section className="card">
        <h2>Nine Diwali weeks and this year's forecast</h2>
        <p className="muted">Delhi's average PM2.5 each day, from 7 days before to 7 days after Diwali.</p>
        <CompareChart past={d.past} fc={d.forecast_2026} hi={hi} />
        <div className="chips">
          <span className="key"><i className="k2026" />2026 forecast</span>
          {years.map((y) => (<button key={y} className={"chip" + (hi === y ? " on" : "")} onMouseEnter={() => setHi(y)} onMouseLeave={() => setHi(null)} onFocus={() => setHi(y)} onBlur={() => setHi(null)}>{y}</button>))}
        </div>
        <div className="facts">
          {[["before", "Week before"], ["night", "Diwali night"], ["after", "Week after"]].map(([k, l]) => (
            <div key={k}><b>{avg(k)}</b><span>{l}: average of 2017–2025 measured (µg/m³)</span></div>
          ))}
        </div>
        <p className="muted small">Past peaks look lower than they were in 2020–21, because monitors stop counting at AQI 500.</p>
      </section>

      <section className="card">
        <h2>Next few hours, replayed</h2>
        <p className="muted">This replays 20 October 2025, 7 pm, as Diwali night began. There is no live data feed yet, so this is not live.</p>
        <select value={st} onChange={(e) => setSt(e.target.value)} aria-label="Station">{meta.stations.map((s) => (<option key={s.name}>{s.name}</option>))}</select>
        {rp && (
          <table className="tbl">
            <thead><tr><th>Ahead</th><th>Forecast</th><th>What happened</th><th>“Same as now”</th><th>Typical miss</th></tr></thead>
            <tbody>
              {["1h", "3h", "6h", "24h"].map((h) => { const x = rp.horizons[h]; return (
                <tr key={h}><td>{h.replace("h", " hour")}</td><td>{x.forecast ?? "–"}</td><td>{x.actual ?? "–"}</td><td>{x.same_as_now}</td><td>±{rp.typical_error_mae[h]}</td></tr>); })}
            </tbody>
          </table>
        )}
        <p className="muted small">PM2.5 in µg/m³ at {rp ? rp.now_hour.replace("T", ", ") + ":00" : ""}. A dash means the monitor recorded no reading at that hour.</p>
      </section>

      {sc && (
        <section className="card">
          <h2>Our public forecast for Diwali week</h2>
          <p className="muted">Issued {sc.issued_at}, before the festival. Real averages will be filled in after 9 November.</p>
          <table className="tbl">
            <thead><tr><th>Day</th><th>Forecast</th><th>Likely range (PM2.5)</th><th>Measured</th></tr></thead>
            <tbody>
              {sc.rows.map((r) => (<tr key={r.date}><td>{new Date(r.date).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · {r.label}</td>
                <td><span className="pill" style={{ background: band(r.forecast_city_avg.aqi).color, color: band(r.forecast_city_avg.aqi).ink }}>{r.forecast_city_avg.aqi}</span> {r.forecast_city_avg.category}</td>
                <td>{r.approx_range_pm25[0]}–{r.approx_range_pm25[1]}</td><td>{r.actual_city_avg_pm25 ?? "To be filled"}</td></tr>))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}
