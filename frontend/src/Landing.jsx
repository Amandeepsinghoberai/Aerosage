import React, { useEffect, useRef, useState } from "react";
import { get } from "./api.js";

// Scroll story. The Earth stays still; the Diwali sky behind it turns as you scroll.
export default function Landing() {
  const sky = useRef(null);
  const smoke = useRef(null);
  const [n, setN] = useState(null);

  useEffect(() => {
    document.body.classList.add("dark");
    return () => document.body.classList.remove("dark");
  }, []);

  useEffect(() => {
    get("/delhi/diwali").then((d) => {
      const m = d.backtest.metrics, us = m["AirWard model"], wk = m["Last week's reading"];
      setN({ us: Math.round(us.mae), wk: Math.round(wk.mae), better: Math.round((1 - us.mae / wk.mae) * 100),
             exact: Math.round(us.category_accuracy), one: Math.round(d.backtest.category_within_one), issued: d.issued_at });
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const on = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const max = document.documentElement.scrollHeight - innerHeight || 1;
        const p = scrollY / max;
        if (sky.current) {
          // starts on the Diwali fireworks, ends with the smoke swung into view
          const a0 = 40, a1 = innerWidth < 700 ? -80 : -25;
          sky.current.style.transform = `translate(-50%, -50%) rotate(${still ? a0 : a0 + (a1 - a0) * p}deg)`;
        }
        if (smoke.current) {
          // the polluted sky rises from below once the story reaches the Diwali night
          const o = still ? 0 : Math.min(1, Math.max(0, (p - 0.2) / 0.5));
          smoke.current.style.opacity = o.toFixed(3);
          smoke.current.style.transform = `translateY(${((1 - o) * 38).toFixed(1)}vh)`;
          if (sky.current) sky.current.style.opacity = (1 - 0.55 * o).toFixed(3);
        }
        document.documentElement.style.setProperty("--p", p.toFixed(3));
      });
    };
    on(); addEventListener("scroll", on, { passive: true }); addEventListener("resize", on);
    // reveal each chapter once it is mostly on screen
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && e.target.classList.add("in")), { threshold: 0.35 });
    document.querySelectorAll(".chapter").forEach((el) => io.observe(el));
    return () => { removeEventListener("scroll", on); removeEventListener("resize", on); io.disconnect(); };
  }, []);

  return (
    <div className="landing">
      <div className="stage" aria-hidden>
        <div className="sky" ref={sky} />
        <div className="smoke" ref={smoke} />
        <div className="veil" />
        <div className="earth">
          <img src="/landing/earth.webp" alt="" />
          <span className="delhi"><i /><b>Delhi</b></span>
        </div>
      </div>

      <header className="ltop">
        <a className="brand light" href="#/">
          <svg width="26" height="26" viewBox="0 0 32 32" aria-hidden><rect width="32" height="32" rx="8" fill="#fff" fillOpacity=".14" /><path d="M7 12h13a3 3 0 1 0-3-3M7 17h17a3 3 0 1 1-3 3M7 22h9" stroke="#fff" strokeWidth="2" fill="none" strokeLinecap="round" /></svg>
          <span>AeroSage</span>
        </a>
        <nav aria-label="Main"><a href="#/map">Map</a><a href="#/act">Act</a><a href="#/proof">Proof</a><a href="#/about">About</a></nav>
        <a className="lbtn" href="#/map">Open the map</a>
      </header>

      <main className="story">
        <section className="chapter hero in">
          <h1>Diwali air, forecast street by street.</h1>
          <p>AeroSage forecasts the air for every 1.5 km of Delhi, hour by hour, from a week before Diwali to a week after.</p>
          <div className="cta"><a className="lbtn solid" href="#/map">Open the Delhi map</a><a className="lbtn" href="#/proof">See how accurate it is</a></div>
          <span className="hint">Scroll to see how it works</span>
        </section>

        <section className="chapter">
          <h2>Delhi has 39 air monitors for about 3 crore people.</h2>
          <p>Most streets have no reading at all. And the reading you can get is for right now, not for tonight or tomorrow.</p>
        </section>

        <section className="chapter">
          <h2>On Diwali night, the air turns within hours.</h2>
          <ul className="causes">
            <li><b>Crackers</b> add smoke after dark.</li>
            <li><b>Cold, still air</b> keeps that smoke near the ground.</li>
            <li><b>Crop-burning season</b> adds smoke from outside the city.</li>
          </ul>
        </section>

        <section className="chapter">
          <h2>A forecast you can read, question and test.</h2>
          <ul className="four">
            <li><b>See it on a map.</b> Slide through the Diwali week and watch your area change.</li>
            <li><b>Know how sure we are.</b> Every forecast is a range, not one exact number.</li>
            <li><b>Understand why.</b> Crackers, weather, farm smoke, traffic or the local area.</li>
            <li><b>Try a what-if.</b> Cut crackers or traffic and see the estimated change.</li>
          </ul>
        </section>

        <section className="chapter">
          <h2>Tested on a Diwali it had never seen.</h2>
          <p>We hid Diwali 2025 from the model, asked it to forecast those weeks, then compared with what the monitors measured.</p>
          {n && (
            <div className="nums">
              <div><b>{n.us}</b><span>AeroSage's average miss (PM2.5, µg/m³)</span></div>
              <div><b>{n.wk}</b><span>Miss if you repeat last week's reading</span></div>
              <div><b>{n.one}%</b><span>Within one AQI band of what was measured</span></div>
            </div>
          )}
        </section>

        <section className="chapter last">
          <h2>Diwali is on 8 November. See your area before it arrives.</h2>
          <div className="cta"><a className="lbtn solid" href="#/map">Open the Delhi map</a><a className="lbtn" href="#/act">Test what-if ideas</a></div>
          <p className="fine">Forecasts are model estimates, not live sensor readings.{n ? ` Forecast issued ${n.issued}.` : ""} Team NexByte, Lovely Professional University.</p>
        </section>
      </main>
    </div>
  );
}
