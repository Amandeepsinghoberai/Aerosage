import React, { useEffect, useState } from "react";
import { get } from "./api.js";
import { nowIndex } from "./aqi.js";
import MapScreen from "./MapScreen.jsx";
import Act from "./Act.jsx";
import Proof from "./Proof.jsx";
import About from "./About.jsx";
import Landing from "./Landing.jsx";

const TABS = [["map", "Map"], ["act", "Act"], ["proof", "Proof"], ["about", "About"]];
const fromHash = () => { const h = location.hash.replace(/^#\/?/, ""); return TABS.some(([k]) => k === h) ? h : "home"; };

export default function App() {
  const [tab, setTab] = useState(fromHash());
  const [meta, setMeta] = useState(null), [all, setAll] = useState(null), [err, setErr] = useState(null);
  const [hour, setHour] = useState(0); // set to the current hour (IST) once the forecast loads
  useEffect(() => { window.scrollTo(0, 0); }, [tab]);
  useEffect(() => { const f = () => setTab(fromHash()); addEventListener("hashchange", f); return () => removeEventListener("hashchange", f); }, []);
  useEffect(() => { Promise.all([get("/delhi/meta"), get("/delhi/map/all")]).then(([m, a]) => { setMeta(m); setAll(a); setHour(nowIndex(m.times)); }).catch((e) => setErr(e.message)); }, []);
  const go = (k) => { location.hash = "/" + k; window.scrollTo(0, 0); };

  if (tab === "home") return <Landing />;
  return (
    <>
      <header className="top">
        <a className="brand" href="#/" aria-label="AeroSage home">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#23627A" /><path d="M7 12h13a3 3 0 1 0-3-3M7 17h17a3 3 0 1 1-3 3M7 22h9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          <span>AeroSage</span>
        </a>
        <nav aria-label="Main">{TABS.map(([k, l]) => (<a key={k} href={`#/${k}`} className={tab === k ? "on" : ""} aria-current={tab === k ? "page" : undefined}>{l}</a>))}</nav>
        <div className="status"><span className="city">Delhi</span><span className="issued">{meta ? `Forecast issued ${meta.issued_at}` : ""}</span></div>
      </header>
      {err && (
        <main className="page"><div className="card"><h2>The forecast server is not reachable</h2><p className="muted">{err}. Check that the backend is running, then reload this page.</p></div></main>
      )}
      {!err && !meta && <main className="page"><p className="muted">Loading the forecast…</p></main>}
      {meta && all && (
        <>
          {tab === "map" && <MapScreen meta={meta} all={all} nowIdx={nowIndex(meta.times)} hour={hour} setHour={setHour} goAct={(h) => { setHour(h); go("act"); }} />}
          {tab === "act" && <Act meta={meta} all={all} hour={hour} setHour={setHour} />}
          {tab === "proof" && <Proof meta={meta} />}
          {tab === "about" && <About meta={meta} />}
        </>
      )}
    </>
  );
}
