import React, { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { pm25ToAqi, aqiColor, band } from "./aqi.js";

// Draws the 1.5 km boxes. `cells` = [[lat, lon, confidence], ...]; `values` = PM2.5 per cell (same order).
// A click on a box calls onPick(lat, lon, cellIndex); a click anywhere without data calls onNoData(lat, lon).
export default function MapView({ meta, cells, values, stations, selected, onPick, onNoData, interactive = true, showStations = true, height }) {
  const el = useRef(null), st = useRef({}), [tip, setTip] = useState(null);
  const step = meta.cell_step, [la0, lo0] = [meta.bbox[0], meta.bbox[1]];
  const key = (lat, lon) => Math.floor((lat - la0) / step) + "_" + Math.floor((lon - lo0) / step);

  useEffect(() => {
    const [s, w, n, e] = meta.bbox;
    const map = L.map(el.current, {
      center: meta.center, zoom: interactive ? meta.zoom : 10, zoomControl: false, attributionControl: true,
      minZoom: interactive ? 10 : 9, maxZoom: 15, preferCanvas: true, zoomSnap: 0.25,
      maxBounds: [[s - 0.25, w - 0.3], [n + 0.25, e + 0.3]], maxBoundsViscosity: 0.9,
      dragging: interactive, scrollWheelZoom: interactive, doubleClickZoom: interactive, touchZoom: interactive, boxZoom: false, keyboard: interactive,
    });
    // fit the covered area; leave room for the top legend and the bottom dock
    const la = cells.map((c) => c[0]), lo = cells.map((c) => c[1]);
    const cover = [[Math.min(...la) - step, Math.min(...lo) - step], [Math.max(...la) + step, Math.max(...lo) + step]];
    if (interactive) map.fitBounds(cover, { paddingTopLeft: [24, 90], paddingBottomRight: [24, window.innerWidth > 900 ? 190 : 250] });
    else map.fitBounds(cover, { padding: [6, 6] });
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: '&copy; OpenStreetMap contributors', maxZoom: 19, className: "basetiles",
    }).addTo(map);
    if (interactive) L.control.zoom({ position: "bottomleft" }).addTo(map);
    const canvas = L.canvas({ padding: 0.3 });
    const index = new Map();
    const rects = cells.map((c, i) => {
      const h = step / 2;
      index.set(key(c[0], c[1]), i);
      return L.rectangle([[c[0] - h, c[1] - h], [c[0] + h, c[1] + h]], { renderer: canvas, stroke: false, fillOpacity: 0.5, fillColor: "#ccc", interactive: false }).addTo(map);
    });
    const dots = L.layerGroup().addTo(map);
    const ring = L.circleMarker([0, 0], { radius: 11, color: "#14212B", weight: 1.5, fill: false, opacity: 0, interactive: false }).addTo(map);
    st.current = { map, rects, dots, ring, index };
    map.on("click", (ev) => {
      if (!interactive) return;
      const { lat, lng } = ev.latlng, i = index.get(key(lat, lng));
      if (i === undefined) onNoData && onNoData(lat, lng); else onPick && onPick(cells[i][0], cells[i][1], i);
    });
    map.on("mousemove", (ev) => {
      if (!interactive) return;
      const i = index.get(key(ev.latlng.lat, ev.latlng.lng));
      setTip(i === undefined ? { x: ev.containerPoint.x, y: ev.containerPoint.y, none: true } : { x: ev.containerPoint.x, y: ev.containerPoint.y, i });
    });
    map.on("mouseout", () => setTip(null));
    setTimeout(() => map.invalidateSize(), 60);
    return () => map.remove();
    // eslint-disable-next-line
  }, []);

  // repaint boxes when the hour (values) changes
  useEffect(() => {
    const { rects } = st.current; if (!rects) return;
    rects.forEach((r, i) => {
      const aqi = pm25ToAqi(values[i]), conf = cells[i][2];
      r.setStyle({ fillColor: aqiColor(aqi), fillOpacity: conf === 2 ? 0.74 : conf === 1 ? 0.58 : 0.4 });
    });
  }, [values, cells]);

  // station dots
  useEffect(() => {
    const { dots, map } = st.current; if (!dots) return;
    dots.clearLayers();
    if (!showStations || !stations) return;
    stations.forEach((s) => {
      const m = L.circleMarker([s.lat, s.lon], { radius: 4.5, color: "#fff", weight: 1.6, fillColor: aqiColor(s.aqi), fillOpacity: 1, bubblingMouseEvents: false, interactive });
      if (interactive) {
        m.on("click", () => onPick && onPick(s.lat, s.lon, null, s.name));
        m.bindTooltip(`${s.name} · AQI ${s.aqi}`, { direction: "top", offset: [0, -4], className: "tt" });
      }
      m.addTo(dots);
    });
  }, [stations, showStations]);

  useEffect(() => {
    const { ring, map } = st.current; if (!ring) return;
    if (selected) { ring.setLatLng([selected.lat, selected.lon]); ring.setStyle({ opacity: 1 }); } else ring.setStyle({ opacity: 0 });
  }, [selected]);

  useEffect(() => {
    const { map } = st.current; if (!map || !selected || !interactive) return;
    map.panTo([selected.lat, selected.lon - (window.innerWidth > 900 ? 0.03 : 0)], { animate: true, duration: 0.5 });
    // eslint-disable-next-line
  }, [selected && selected.lat, selected && selected.lon]);

  let tipText = null;
  if (tip) {
    if (tip.none) tipText = "No data here";
    else { const aqi = pm25ToAqi(values[tip.i]); tipText = `AQI ${aqi} · ${band(aqi).name}`; }
  }
  return (
    <div className="mapwrap" style={height ? { height } : null}>
      <div ref={el} className="map" />
      {tip && tipText && <div className={"maptip" + (tip.none ? " none" : "")} style={{ left: tip.x + 14, top: tip.y + 14 }}>{tipText}</div>}
    </div>
  );
}
