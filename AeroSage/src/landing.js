// Landing page: still Earth, a Diwali sky that turns with scroll, smoke that rises as the story reaches Diwali night.
const LOGO = `<svg width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#fff" fill-opacity=".14"/><path d="M7 12h13a3 3 0 1 0-3-3M7 17h17a3 3 0 1 1-3 3M7 22h9" stroke="#fff" stroke-width="2" fill="none" stroke-linecap="round"/></svg>`;

export function landingHTML() {
  return `<div class="landing">
  <div class="ld-stage" aria-hidden="true"><div class="ld-sky" id="lSky"></div><div class="ld-smoke" id="lSmoke"></div><div class="ld-veil"></div>
    <div class="ld-earth"><img src="/landing/earth.webp" alt=""><span class="ld-delhi"><i></i><b>Delhi</b></span></div></div>
  <header class="ltop"><a class="lbrand" href="#home">${LOGO}<span>AeroSage</span></a>
    <nav aria-label="Main"><a href="#map">Map</a><a href="#act">Act</a><a href="#proof">Proof</a><a href="#about">About</a></nav>
    <a class="lbtn" href="#map">Open the map</a></header>
  <main class="ld-story">
    <section class="ld-chapter ld-hero ld-in"><h1>Diwali air, forecast street by street.</h1>
      <p>AeroSage forecasts the air for every 1.5 km of Delhi, hour by hour, from a week before Diwali to a week after.</p>
      <div class="ld-cta"><a class="lbtn solid" href="#map">Open the Delhi map</a><a class="lbtn" href="#proof">See how accurate it is</a></div>
      <span class="ld-hint">Scroll to see how it works</span></section>
    <section class="ld-chapter"><h2>Delhi has 39 air monitors for about 3 crore people.</h2>
      <p>Most streets have no reading at all. And the reading you can get is for right now, not for tonight or tomorrow.</p></section>
    <section class="ld-chapter"><h2>On Diwali night, the air turns within hours.</h2>
      <ul class="ld-causes"><li><b>Crackers</b> add smoke after dark.</li><li><b>Cold, still air</b> keeps that smoke near the ground.</li><li><b>Crop-burning season</b> adds smoke from outside the city.</li></ul></section>
    <section class="ld-chapter"><h2>A forecast you can read, question and test.</h2>
      <ul class="ld-four"><li><b>See it on a map.</b> Slide through the Diwali week and watch your area change.</li><li><b>Know how sure we are.</b> Every forecast is a range, not one exact number.</li><li><b>Understand why.</b> Crackers, weather, farm smoke, traffic or the local area.</li><li><b>Try a what-if.</b> Cut crackers or traffic and see the estimated change.</li></ul></section>
    <section class="ld-chapter"><h2>Tested on a Diwali it had never seen.</h2>
      <p>We hid Diwali 2025 from the model, asked it to forecast those weeks, then compared with what the monitors measured.</p>
      <div class="ld-nums" id="lNums"></div></section>
    <section class="ld-chapter ld-last"><h2>Diwali is on 8 November. See your area before it arrives.</h2>
      <div class="ld-cta"><a class="lbtn solid" href="#map">Open the Delhi map</a><a class="lbtn" href="#act">Test what-if ideas</a></div>
      <p class="ld-fine" id="lFine">Forecasts are model estimates, not live sensor readings. Team NexByte, Lovely Professional University.</p></section>
  </main></div>`;
}

let io = null, raf = 0, bound = false;
function onScroll() {
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(() => {
    const sky = document.getElementById('lSky'), smoke = document.getElementById('lSmoke');
    if (!sky) return;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const max = document.documentElement.scrollHeight - innerHeight || 1, p = Math.min(1, Math.max(0, scrollY / max));
    const a0 = 40, a1 = innerWidth < 700 ? -80 : -25;
    sky.style.transform = `translate(-50%, -50%) rotate(${still ? a0 : a0 + (a1 - a0) * p}deg)`;
    const o = still ? 0 : Math.min(1, Math.max(0, (p - 0.2) / 0.5));
    smoke.style.opacity = o.toFixed(3);
    smoke.style.transform = `translateY(${((1 - o) * 38).toFixed(1)}vh)`;
    sky.style.opacity = (1 - 0.55 * o).toFixed(3);
  });
}

export function initLanding() {
  if (!bound) { addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); bound = true; }
  io?.disconnect();
  io = new IntersectionObserver(es => es.forEach(e => e.isIntersecting && e.target.classList.add('ld-in')), { threshold: 0.35 });
  document.querySelectorAll('.landing .ld-chapter').forEach(el => io.observe(el));
  onScroll();
}
export function leaveLanding() { io?.disconnect(); io = null; }

// live numbers for the "tested" chapter, from /api/delhi/diwali
export function fillLandingNumbers(d) {
  const box = document.getElementById('lNums'); if (!box || !d?.backtest?.metrics) return;
  const m = d.backtest.metrics, us = m['AirWard model'], wk = m["Last week's reading"];
  if (!us || !wk) return;
  box.innerHTML = `<div><b>${Math.round(us.mae)}</b><span>AeroSage's average miss (PM2.5, µg/m³)</span></div><div><b>${Math.round(wk.mae)}</b><span>Miss if you repeat last week's reading</span></div><div><b>${Math.round(d.backtest.category_within_one)}%</b><span>Within one AQI band of what was measured</span></div>`;
  const f = document.getElementById('lFine');
  if (f && d.issued_at) f.textContent = `Forecasts are model estimates, not live sensor readings. Forecast issued ${d.issued_at}. Team NexByte, Lovely Professional University.`;
}
