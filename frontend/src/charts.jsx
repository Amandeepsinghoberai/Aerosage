import React, { useRef } from "react";
import { pm25ToAqi, BANDS, aqiColor } from "./aqi.js";

const W = 640, H = 210, PL = 34, PR = 10, PT = 12, PB = 26;
const X = (i, n) => PL + (i / (n - 1)) * (W - PL - PR);
const Y = (a, max) => PT + (1 - a / max) * (H - PT - PB);

// Forecast range for one place: soft band = low..high, line = likely. Click or drag to move the hour.
export function ForecastChart({ p10, p50, p90, idx, onPick, trap = [] }) {
  const ref = useRef(null), n = p50.length, MAX = 500;
  const W = 420, H = 200, X = (i, n) => PL + (i / (n - 1)) * (W - PL - PR), Y = (a, max) => PT + (1 - a / max) * (H - PT - PB);
  const a = (arr) => arr.map(pm25ToAqi);
  const lo = a(p10), mid = a(p50), hi = a(p90);
  const path = (arr) => arr.map((v, i) => `${i ? "L" : "M"}${X(i, n).toFixed(1)},${Y(v, MAX).toFixed(1)}`).join("");
  const area = `${path(hi)}L${[...lo].reverse().map((v, k) => `${X(n - 1 - k, n).toFixed(1)},${Y(v, MAX).toFixed(1)}`).join("L")}Z`;
  const pick = (e) => {
    const r = ref.current.getBoundingClientRect(), x = ((e.clientX - r.left) / r.width) * W;
    onPick(Math.max(0, Math.min(n - 1, Math.round(((x - PL) / (W - PL - PR)) * (n - 1)))));
  };
  const drag = (e) => { if (e.buttons === 1) pick(e); };
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className="chart small" onClick={pick} onMouseMove={drag} role="img" aria-label="Forecast range for the selected area">
      {BANDS.map((b, k) => { const y0 = Y(b.max, MAX), y1 = Y(k ? BANDS[k - 1].max : 0, MAX); return <rect key={k} x={PL} y={y0} width={W - PL - PR} height={y1 - y0} fill={b.color} opacity="0.07" />; })}
      {[0, 100, 200, 300, 400, 500].map((v) => (<g key={v}><line x1={PL} x2={W - PR} y1={Y(v, MAX)} y2={Y(v, MAX)} className="grid" /><text x={PL - 6} y={Y(v, MAX) + 3} className="ax" textAnchor="end">{v}</text></g>))}
      <rect x={X(187, n)} y={PT} width={X(216, n) - X(187, n)} height={H - PT - PB} className="nightband" />
      {Array.from({ length: 15 }, (_, d) => d).filter((d) => d % 2 === 1 || d === 7).map((d) => (<text key={d} x={X(d * 24 + 12, n)} y={H - 8} className="ax" textAnchor="middle" fontWeight={d === 7 ? 700 : 400}>{d === 7 ? "Diwali" : d < 7 ? `D${d - 7}` : `D+${d - 7}`}</text>))}
      <path d={area} className="rangearea" />
      <path d={path(mid)} className="midline" />
      {trap.map((t, i) => (t ? <rect key={i} x={X(i, n) - 1} y={H - PB - 4} width="2.2" height="4" className="trap" /> : null))}
      <line x1={X(idx, n)} x2={X(idx, n)} y1={PT} y2={H - PB} className="cursor" />
      <circle cx={X(idx, n)} cy={Y(mid[idx], MAX)} r="4.5" fill={aqiColor(mid[idx])} stroke="#fff" strokeWidth="2" />
    </svg>
  );
}

// Nine past Diwali weeks (grey) against the 2026 forecast (blue). Values are city-average PM2.5.
export function CompareChart({ past, fc, hi }) {
  const offs = Array.from({ length: 15 }, (_, i) => i - 7), years = Object.keys(past);
  const max = Math.ceil(Math.max(...years.flatMap((y) => offs.map((o) => past[y][o])), ...offs.map((o) => fc[o])) / 50) * 50;
  const xs = (i) => PL + (i / 14) * (W - PL - PR), ys = (v) => PT + (1 - v / max) * (H - PT - PB);
  const P = (get) => offs.map((o, i) => `${i ? "L" : "M"}${xs(i).toFixed(1)},${ys(get(o)).toFixed(1)}`).join("");
  const grid = []; for (let v = 0; v <= max; v += 50) grid.push(v);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="City average PM2.5 around Diwali, 2017 to 2025 and the 2026 forecast">
      {grid.map((v) => (<g key={v}><line x1={PL} x2={W - PR} y1={ys(v)} y2={ys(v)} className="grid" /><text x={PL - 6} y={ys(v) + 3} className="ax" textAnchor="end">{v}</text></g>))}
      <line x1={xs(7)} x2={xs(7)} y1={PT} y2={H - PB} className="cursor" />
      {offs.filter((o) => o % 2 === 0 || o === 0).map((o) => (<text key={o} x={xs(o + 7)} y={H - 8} className="ax" textAnchor="middle" fontWeight={o === 0 ? 700 : 400}>{o === 0 ? "Diwali" : o < 0 ? `D${o}` : `D+${o}`}</text>))}
      {years.map((y) => (<path key={y} d={P((o) => past[y][o])} className={"pastline" + (hi === y ? " on" : hi ? " dim" : "")} />))}
      <path d={P((o) => fc[o])} className="fcline" />
      {offs.map((o, i) => (<circle key={o} cx={xs(i)} cy={ys(fc[o])} r="3" className="fcdot" />))}
    </svg>
  );
}
