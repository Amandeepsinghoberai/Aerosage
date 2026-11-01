import React, { useEffect, useMemo, useRef, useState } from "react";
import MapView from "./MapView.jsx";
import AreaPanel from "./AreaPanel.jsx";
import { get, q } from "./api.js";
import { pm25ToAqi, band, aqiColor, fmtHour, dayOffset, dayLabel, BANDS } from "./aqi.js";

export default function MapScreen({ meta, all, nowIdx, hour, setHour, goAct }) {
  const times = meta.times, t = times[hour];
  const [detail, setDetail] = useState(null);
  const [sel, setSel] = useState(null);
  const [notice, setNotice] = useState(null);
  const [play, setPlay] = useState(false);

  // city average per hour (colours the slider: the track is the forecast)
  const cityAqi = useMemo(() => all.pm25_p50.map((row) => pm25ToAqi(row.reduce((a, b) => a + b, 0) / row.length)), [all]);
  const strip = useMemo(() => `linear-gradient(90deg, ${cityAqi.map((a, i) => `${aqiColor(a)} ${((i + 0.5) / cityAqi.length * 100).toFixed(2)}%`).join(",")})`, [cityAqi]);

  useEffect(() => { let on = true; get(`/delhi/map?${q({ hour: t })}`).then((d) => on && setDetail(d)).catch(() => {}); return () => { on = false; }; }, [t]);
  useEffect(() => {
    if (!play) return;
    const id = setInterval(() => setHour((h) => (h >= times.length - 1 ? (setPlay(false), h) : h + 1)), 140);
    return () => clearInterval(id);
  }, [play]);
  useEffect(() => { if (!notice) return; const id = setTimeout(() => setNotice(null), 5200); return () => clearTimeout(id); }, [notice]);

  const values = all.pm25_p50[hour];
  const d = detail && detail.hour === t ? detail : null;
  const mean = d ? d.city_mean : { aqi: cityAqi[hour], category: band(cityAqi[hour]).name };
  const b = band(mean.aqi);
  const off = dayOffset(hour), hh = t.slice(11, 13);
  const tag = hour === nowIdx ? "Now" : off === 0 && +hh >= 19 ? "Diwali night" : null;

  const pick = (lat, lon, i, name) => { setNotice(null); setSel({ lat, lon, i, name }); };
  const noData = (lat, lon) => { setSel(null); setNotice({ lat, lon }); };
  const jump = () => { setHour(7 * 24 + 21); };

  return (
    <div className="mapscreen">
      <MapView meta={meta} cells={all.cells} values={values} stations={d ? d.stations : null} selected={sel} onPick={pick} onNoData={noData} />
      <div className="legend" aria-label="AQI colour scale">
        {BANDS.map((x) => (<span key={x.name}><i style={{ background: x.color }} />{x.name}</span>))}
        <em>Fainter boxes are further from a monitor.</em>
      </div>
      {notice && (
        <div className="toast" role="alert">
          <b>No data here</b>
          <span>AeroSage covers Delhi only for now. Pick a coloured box inside the city.</span>
          <button onClick={() => setNotice(null)} aria-label="Dismiss">×</button>
        </div>
      )}
      {sel && <AreaPanel meta={meta} all={all} nowIdx={nowIdx} detail={d} sel={sel} hour={hour} setHour={setHour} onClose={() => setSel(null)} goAct={goAct} />}

      <section className="dock">
        <div className="readout">
          <div className="big" style={{ color: b.color }}>{mean.aqi}</div>
          <div className="rd">
            <strong>{b.name}</strong>
            <span>Delhi average, forecast</span>
            <span className="when">{fmtHour(t)}{tag ? ` · ${tag}` : ""}</span>
          </div>
        </div>
        <div className="scrub">
          <div className="scrubtop">
            <div className="btns">
              <button className="ghost" onClick={() => setPlay((p) => !p)} aria-label={play ? "Pause" : "Play through the week"}>{play ? "Pause" : "Play"}</button>
              <button className="ghost" onClick={() => setHour(nowIdx)}>Now</button>
              <button className="ghost" onClick={jump}>Diwali night</button>
            </div>
            {d && <span className="wx">Wind {d.weather.wind_kmh} km/h · mixing height {d.weather.mixing_height_m < 50 ? "under 50 m" : d.weather.mixing_height_m + " m"} · {d.weather.temp_c}°C</span>}
          </div>
          <div className="track" style={{ "--strip": strip }}>
            <div className="strip" />
            <input type="range" min="0" max={times.length - 1} value={hour} onChange={(e) => { setPlay(false); setHour(+e.target.value); }} aria-label="Forecast hour, 7 days before to 7 days after Diwali" />
          </div>
          <div className="ticks">
            {Array.from({ length: 15 }, (_, i) => (
              <button key={i} className={"tick" + (i === 7 ? " d0" : "") + (Math.floor(hour / 24) === i ? " now" : "")} onClick={() => setHour(i * 24 + (hour % 24))}>{dayLabel(i - 7)}</button>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
