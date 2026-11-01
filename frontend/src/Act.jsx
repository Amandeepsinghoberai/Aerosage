import React, { useEffect, useMemo, useState } from "react";
import MapView from "./MapView.jsx";
import { get, q } from "./api.js";
import { band, pm25ToAqi, fmtHour } from "./aqi.js";

const PRESETS = [
  { name: "Green crackers only", v: { crackers: 1, traffic: 0, fires: 0 } },
  { name: "Less traffic", v: { crackers: 0, traffic: 0.3, fires: 0 } },
  { name: "All three", v: { crackers: 1, traffic: 0.3, fires: 0.5 } },
  { name: "Reset", v: { crackers: 0, traffic: 0, fires: 0 } },
];

export default function Act({ meta, all, hour, setHour }) {
  const t = meta.times[hour];
  const [s, setS] = useState({ crackers: 1, traffic: 0.3, fires: 0.5 });
  const [sim, setSim] = useState(null), [rank, setRank] = useState(null), [err, setErr] = useState(null);
  useEffect(() => {
    let on = true; setErr(null);
    const id = setTimeout(() => get(`/delhi/simulate?${q({ hour: t, ...s })}`).then((x) => on && setSim(x)).catch((e) => on && setErr(e.message)), 120);
    return () => { on = false; clearTimeout(id); };
  }, [t, s]);
  useEffect(() => { get(`/delhi/rank?${q({ hour: t, top: 10 })}`).then(setRank).catch(() => setRank(null)); }, [t]);

  const after = useMemo(() => (sim ? sim.cells.map((c) => c[2]) : all.pm25_p50[hour]), [sim, all, hour]);
  const afterBy = useMemo(() => Object.fromEntries((sim ? sim.stations : []).map((r) => [r.station, r.after])), [sim]);
  const bb = sim && band(sim.before_city.aqi), ba = sim && band(sim.after_city.aqi);
  const drop = sim ? sim.before_city.aqi - sim.after_city.aqi : 0;
  const Slider = ({ k, label, hint }) => (
    <label className="slide">
      <span className="srow"><span>{label}</span><b>{Math.round(s[k] * 100)}%</b></span>
      <input type="range" min="0" max="100" value={Math.round(s[k] * 100)} onChange={(e) => setS({ ...s, [k]: +e.target.value / 100 })} />
      <span className="muted small">{hint}</span>
    </label>
  );
  return (
    <main className="page wide">
      <header className="pagehead">
        <h1>Test what could make Delhi's air better</h1>
        <p className="lead">Reduce a cause and see how the forecast changes. Weather cannot be changed, so it stays as forecast.</p>
      </header>
      <div className="actgrid">
        <section className="card controls">
          <h2>Choose the hour</h2>
          <select value={hour} onChange={(e) => setHour(+e.target.value)} aria-label="Forecast hour">
            {meta.times.map((x, i) => (i % 3 === 0 ? <option key={x} value={i}>{fmtHour(x)}</option> : null))}
          </select>
          <button className="ghost" onClick={() => setHour(7 * 24 + 21)}>Diwali night, 9 pm</button>
          <h2>Reduce by</h2>
          <Slider k="crackers" label="Firecrackers" hint="For example, only green crackers." />
          <Slider k="traffic" label="Traffic" hint="For example, fewer vehicles on the road." />
          <Slider k="fires" label="Farm-fire smoke" hint="Smoke drifting in from crop burning." />
          <div className="chips">{PRESETS.map((p) => (<button key={p.name} className="chip" onClick={() => setS(p.v)}>{p.name}</button>))}</div>
        </section>
        <section className="card result">
          {err && <p className="err">{err}</p>}
          {sim && (
            <>
              <div className="shift">
                <div><span className="muted small">Before</span><div className="big" style={{ color: bb.color }}>{sim.before_city.aqi}</div><strong>{bb.name}</strong></div>
                <div className="arrow" aria-hidden>→</div>
                <div><span className="muted small">After</span><div className="big" style={{ color: ba.color }}>{sim.after_city.aqi}</div><strong>{ba.name}</strong></div>
              </div>
              <p className="verdict">{drop > 0 ? `Delhi's average falls by ${drop} AQI points${bb.name !== ba.name ? `, from ${bb.name.toLowerCase()} to ${ba.name.toLowerCase()}` : ""}.` : "Move a slider to see the change."}</p>
              <p className="muted small"><span className="tag">Scenario estimate</span> Based on what the model learned. It is not a measured result of any policy.</p>
            </>
          )}
          <div className="twomaps">
            <figure><MapView meta={meta} cells={all.cells} values={all.pm25_p50[hour]} stations={null} interactive={false} showStations={false} height={240} /><figcaption>Before</figcaption></figure>
            <figure><MapView meta={meta} cells={all.cells} values={after} stations={null} interactive={false} showStations={false} height={240} /><figcaption>After</figcaption></figure>
          </div>
        </section>
      </div>
      <section className="card">
        <h2>Where to act first</h2>
        <p className="muted small">Areas that are usually the worst. Use this as a starting list, not a precise ranking.</p>
        {rank && (
          <table className="tbl">
            <thead><tr><th>#</th><th>Area</th><th>Before</th><th>After</th><th>Suggested action</th></tr></thead>
            <tbody>
              {rank.ranking.map((r) => { const a = afterBy[r.station]; return (
                <tr key={r.station}>
                  <td>{r.rank}</td><td>{r.station}</td>
                  <td><span className="pill" style={{ background: band(r.aqi).color, color: band(r.aqi).ink }}>{r.aqi}</span></td>
                  <td>{a ? <span className="pill" style={{ background: band(a.aqi).color, color: band(a.aqi).ink }}>{a.aqi}</span> : "–"}</td>
                  <td>{r.action}</td>
                </tr>); })}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
