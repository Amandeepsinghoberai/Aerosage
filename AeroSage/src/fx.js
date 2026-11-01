// Map page extras wired to the AirWard API: forecast chart with range, reasons, nearby monitors, health guidance.
export function createFx(c) {
  const { S, $, esc, fmt, n, get, CPCB, pill, value, timeAt, labelTime, aqiFromPm, render, setHour } = c;
  let simSeq = 0;
  const path = () => `/${S.city}`;
  const col = a => a == null ? '#8d8982' : (CPCB.find(x => a <= x[1]) || CPCB[5])[2];
  const cat = a => (CPCB.find(x => a <= x[1]) || CPCB[5])[0];
  const NAMES = { 'AirWard model': 'AeroSage', "Last week's reading": "Last week's reading", 'Global CAMS model (Open-Meteo)': 'Global satellite model', 'Average of past Diwalis': 'Average of past Diwalis' };
  const PERSONS = ['General', 'Child', 'Older adult', 'Asthma or heart condition', 'Outdoor worker'];
  const EXTRA = { Child: 'Keep play indoors when the air is Poor or worse.', 'Older adult': 'Avoid morning and late-evening walks when the air is Poor or worse.', 'Asthma or heart condition': 'Keep reliever medicine close; an N95 mask helps outdoors.', 'Outdoor worker': 'Take breaks indoors and wear an N95 mask on Diwali night.' };
  const nowIdx = () => { const t = S.meta?.times || []; if (!t.length) return 0; const k = new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 13).replace(' ', 'T'); const i = t.indexOf(k); return i >= 0 ? i : k < t[0] ? 0 : t.length - 1; };
  const km = (a, b, c2, d) => { const r = Math.PI / 180, x = Math.sin((c2 - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c2 * r) * Math.sin((d - b) * r / 2) ** 2; return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)); };

  // ------------------------------------------------------------------ forecast chart (low-high range, likely line, AQI bands, Diwali night)
  function fchart(p10, p50, p90, idx) {
    const W = 420, H = 200, PL = 34, PR = 10, PT = 12, PB = 26, N = p50.length, MAX = 500;
    const X = i => PL + i / (N - 1) * (W - PL - PR), Y = a => PT + (1 - a / MAX) * (H - PT - PB);
    const A = arr => arr.map(v => aqiFromPm(v)), lo = A(p10), mid = A(p50), hi = A(p90);
    const P = arr => arr.map((v, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join('');
    const area = `${P(hi)}L${[...lo].reverse().map((v, k) => `${X(N - 1 - k).toFixed(1)},${Y(v).toFixed(1)}`).join('L')}Z`;
    const bands = CPCB.map((b, k) => { const y0 = Y(b[1]), y1 = Y(k ? CPCB[k - 1][1] : 0); return `<rect x="${PL}" y="${y0}" width="${W - PL - PR}" height="${y1 - y0}" fill="${b[2]}" opacity=".09"/>`; }).join('');
    const grid = [0, 100, 200, 300, 400, 500].map(v => `<line x1="${PL}" x2="${W - PR}" y1="${Y(v)}" y2="${Y(v)}" class="fx-grid"/><text x="${PL - 6}" y="${Y(v) + 3}" class="fx-ax" text-anchor="end">${v}</text>`).join('');
    const days = Array.from({ length: 15 }, (_, d) => d).filter(d => d % 2 === 1 || d === 7).map(d => `<text x="${X(d * 24 + 12)}" y="${H - 8}" class="fx-ax" text-anchor="middle" ${d === 7 ? 'font-weight="700"' : ''}>${d === 7 ? 'Diwali' : d < 7 ? 'D' + (d - 7) : 'D+' + (d - 7)}</text>`).join('');
    return `<svg id="fchart" viewBox="0 0 ${W} ${H}" class="fx-chart" role="img" aria-label="Forecast range for the selected area. Click to move the hour.">${bands}${grid}<rect x="${X(187)}" y="${PT}" width="${X(216) - X(187)}" height="${H - PT - PB}" class="fx-night"/>${days}<path d="${area}" class="fx-range"/><path d="${P(mid)}" class="fx-mid"/><line x1="${X(idx)}" x2="${X(idx)}" y1="${PT}" y2="${H - PB}" class="fx-cursor"/><circle cx="${X(idx)}" cy="${Y(mid[idx])}" r="4.5" fill="${col(mid[idx])}" stroke="#fff" stroke-width="2"/></svg>
    <small class="fx-note">Line = likely, shaded = low–high range (AQI). The darker strip is Diwali night. Click the chart to move the hour.</small>`;
  }

  // ------------------------------------------------------------------ area panel


  // ------------------------------------------------------------------ browser push (level 2 alerts)
  const PK = 'aero_push_ep';
  const pushOn = () => { try { return !!localStorage.getItem(PK) } catch { return false } };
  const u8 = b64 => { const p = '='.repeat((4 - b64.length % 4) % 4), r = atob((b64 + p).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from([...r].map(ch => ch.charCodeAt(0))) };
  const say = t => { const e = $('#pushMsg'); if (e) e.textContent = t };
  const spot = () => { const m = S.map || {}, st = (m.stations || []).find(x => x.name === S.station) || m.stations?.[0] || {}; return S.pick || { lat: st.lat, lon: st.lon } };
  async function pushPost(sub) {
    const p = spot(), r = await fetch('/api/push/subscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscription: sub.toJSON(), city: S.city, lat: p.lat, lon: p.lon, level: alvl() }) });
    const j = await r.json(); if (!r.ok) throw Error(j.detail || r.status); return j;
  }
  async function pushEnable() {
    try {
      if (!('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window)) return say('This browser does not support push notifications. On iPhone, add the site to your Home Screen first.');
      if (!window.isSecureContext) return say('Notifications need a secure (https) site, or localhost.');
      say('Asking your browser for permission…');
      if (await Notification.requestPermission() !== 'granted') return say('Notifications were blocked. Allow them for this site in your browser settings, then try again.');
      const reg = await navigator.serviceWorker.register('/sw.js'); await navigator.serviceWorker.ready;
      const key = (await (await fetch('/api/push/key')).json()).publicKey;
      const sub = await reg.pushManager.getSubscription() || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: u8(key) });
      const r = await pushPost(sub); try { localStorage.setItem(PK, sub.endpoint) } catch { }
      say(`Alerts are on for the area near ${r.station} (${r.level} or worse). We check the saved forecast about every 10 minutes and send one notification per event.`); refreshPush();
    } catch (e) { say('Could not turn alerts on: ' + (e.message || e) + (navigator.brave ? ' Brave blocks push by default: open brave://settings/privacy, turn on "Use Google services for push messaging", restart Brave, and try again.' : '')); }
  }
  async function pushSync() { // the person changed the alert level while alerts are on
    if (!pushOn()) return;
    try { const reg = await navigator.serviceWorker.getRegistration('/sw.js'), sub = await reg?.pushManager.getSubscription(); if (sub) { const r = await pushPost(sub); say(`Alert level updated: ${r.level} or worse near ${r.station}.`); } } catch { }
  }
  async function pushOff() {
    try { const reg = await navigator.serviceWorker.getRegistration('/sw.js'), sub = await reg?.pushManager.getSubscription(); if (sub) { await fetch('/api/push/unsubscribe', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: sub.endpoint }) }); await sub.unsubscribe(); } try { localStorage.removeItem(PK) } catch { } say('Alerts are off for this device.'); refreshPush(); } catch (e) { say('Could not turn alerts off: ' + (e.message || e)); }
  }
  async function pushTest() {
    try { const ep = localStorage.getItem(PK); if (!ep) return say('Turn alerts on first.'); const r = await fetch('/api/push/test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ endpoint: ep }) }); const j = await r.json(); say(j.ok ? 'Test sent. It should appear in a moment. If nothing shows, check your Mac notification settings (System Settings > Notifications) and that Focus mode is off.' : 'The test could not be delivered: ' + (j.detail || 'the push service refused it') + (j.status === 404 || j.status === 410 ? ' This subscription has expired, so press Turn off and then Notify me again.' : '')); } catch (e) { say('Test failed: ' + (e.message || e)); }
  }
  function pushBlock() {
    const on = pushOn();
    return `<div class="fx-push"><div class="fx-form"><button class="fx-btn" id="pushOn" ${on ? 'disabled' : ''}>${on ? 'Notifications on' : 'Notify me on this device'}</button>${on ? '<button class="fx-ghost" id="pushTest">Send a test</button><button class="fx-ghost" id="pushOff">Turn off</button>' : ''}</div>
      <small class="fx-note" id="pushMsg">${on ? 'Notifications are on for this device.' : 'Get a pop-up when the forecast says this level is coming, even if the site is closed. Needs the server to be running.'}</small></div>`;
  }
  function refreshPush() { const e = $('.fx-push'); if (!e) return; const t = $('#pushMsg')?.textContent; e.outerHTML = pushBlock(); if (t) say(t); }

  // ------------------------------------------------------------------ alerts (in-app)
  const ALEVELS = [['Poor', 201], ['Very Poor', 301], ['Severe', 401]];
  const alvl = () => { if (S.alertLvl) return S.alertLvl; let v = 301; try { v = Number(localStorage.getItem('aero_alert_lvl')) || 301 } catch { } return (S.alertLvl = ALEVELS.some(x => x[1] === v) ? v : 301); };
  function setAlertLvl(v) { S.alertLvl = v; try { localStorage.setItem('aero_alert_lvl', String(v)) } catch { } }
  function alertBody() {
    const f = S.forecast, lvl = alvl(), name = ALEVELS.find(x => x[1] === lvl)[0];
    if (!f?.p50?.length) return '<p class="fx-note">Alerts need the hourly forecast, which is unavailable right now.</p>';
    const start = nowIdx(), end = Math.min(f.p50.length - 1, start + 72), aq = i => aqiFromPm(f.p50[i]), hi = i => aqiFromPm(f.p90[i]), lo = i => aqiFromPm(f.p10[i]);
    const eps = []; let cur = null;
    for (let i = start; i <= end; i++) {
      if (aq(i) >= lvl) { if (!cur) { cur = { a: i, b: i, pk: i }; eps.push(cur); } cur.b = i; if (aq(i) > aq(cur.pk)) cur.pk = i; } else cur = null;
    }
    const worst = Array.from({ length: end - start + 1 }, (_, k) => start + k).reduce((m, i) => aq(i) > aq(m) ? i : m, start);
    const when = i => esc(labelTime(i));
    let out = '';
    if (eps.length) {
      const e0 = eps[0], active = e0.a === start;
      out += `<div class="fx-alert ${aq(e0.pk) >= 401 ? 'sev' : ''}"><b>${active ? `${name} or worse air is expected now` : `${name} or worse air expected`}</b><span>${active ? `until ${when(Math.min(e0.b + 1, 359))}` : `from ${when(e0.a)} to ${when(Math.min(e0.b + 1, 359))}`}</span><small>Peak around ${when(e0.pk)}: forecast AQI ${fmt(aq(e0.pk))} (likely range ${fmt(lo(e0.pk))}–${fmt(hi(e0.pk))}).</small><small>${esc(healthText(aq(e0.pk), S.person))}</small></div>`;
      if (eps.length > 1) out += `<ul class="fx-list">${eps.slice(1, 4).map(e => `<li>${when(e.a)} to ${when(Math.min(e.b + 1, 359))}, peak AQI ${fmt(aq(e.pk))}</li>`).join('')}</ul>`;
    } else {
      const maybe = Array.from({ length: end - start + 1 }, (_, k) => start + k).find(i => hi(i) >= lvl);
      out += `<div class="fx-alert ok"><b>No ${name} window expected in the next 72 hours</b><small>Worst hour: ${when(worst)}, forecast AQI ${fmt(aq(worst))}.${maybe != null ? ` The high end of the range reaches AQI ${fmt(hi(maybe))} around ${when(maybe)}, so it is possible but not the most likely outcome.` : ''}</small></div>`;
    }
    return out + '<small class="fx-note">Based on the forecast for the nearest monitor, not a live reading. It is checked each time you open the page.</small>';
  }
  function alertCard() {
    const lvl = alvl();
    return `<div class="as-panel-card"><b>Alerts for this area</b><small class="fx-note" style="display:block">Alert me when the air is expected to be at least:</small>
      <div class="fx-chips">${ALEVELS.map(([t, v]) => `<button class="fx-chip ${lvl === v ? 'on' : ''}" data-alvl="${v}">${t}</button>`).join('')}</div><div id="alertBody">${alertBody()}</div>${pushBlock()}</div>`;
  }

  function healthText(a, person) {
    if (a === null) return 'AQI-based advice will appear with the forecast.';
    const adv = { Good: 'Normal outdoor activity.', Satisfactory: 'Normal activity; sensitive groups may take it easy outdoors.', Moderate: 'Sensitive groups should reduce prolonged outdoor exertion.', Poor: 'Avoid prolonged outdoor activity; sensitive groups should stay indoors.', 'Very Poor': 'Avoid outdoor activity and keep windows closed where possible.', Severe: 'Stay indoors; seek medical help for breathing difficulty.' };
    const c0 = cat(a);
    return `${adv[c0]}${EXTRA[person] && ['Poor', 'Very Poor', 'Severe'].includes(c0) ? ' ' + EXTRA[person] : ''}`;
  }
  function areaPanel() {
    const m = S.map || {}, st = (m.stations || []).find(x => x.name === S.station) || S.nearestStation || m.stations?.[0];
    const w = m.weather || {};
    const pk = S.pick, cell = pk && m.cells?.length ? m.cells.reduce((b, r) => { const d = (r[0] - pk.lat) ** 2 + (r[1] - pk.lon) ** 2; return !b || d < b.d ? { r, d } : b; }, null) : null;
    const useCell = cell && cell.d < 0.02 ** 2 * 2, cr = useCell ? cell.r : null;
    const pm = cr ? cr[2] : c.pmOf(st || {}), a = cr ? c.aqiFromPm(cr[2]) : c.aqiOf(st || {}), lo = cr ? cr[4] : value(st, 'p10'), hi = cr ? cr[5] : value(st, 'p90');
    S.healthAqi = a;
    const wind = n(value(w, 'wind_kmh')), mix = n(value(w, 'mixing_height_m'));
    const hh = Number(timeAt(S.hour).slice(11, 13)), night = hh >= 20 || hh < 8, trap = night && wind !== null && mix !== null && wind < 7 && mix < 250;
    const isNow = S.hour === nowIdx();
    const p = S.pick || (st ? { lat: st.lat, lon: st.lon } : null);
    const near = p ? (m.stations || []).map(s => ({ ...s, d: km(p.lat, p.lon, s.lat, s.lon) })).sort((x, y) => x.d - y.d).slice(0, 3) : [];
    const causes = S.explain?.causes || [];
    const help = S.meta?.cause_help || {};
    const f = S.forecast;
    return `<div class="as-panel-head"><small>DELHI · SELECTED AREA</small><h2>${esc(S.selectedLocation || st?.name || 'Locating area…')}</h2>
      ${st?.name && st.name !== S.selectedLocation ? `<p>Nearest monitor: ${esc(st.name)}${S.areaDistance != null ? ` · ${fmt(S.areaDistance, 1)} km away` : ''}</p>` : ''}
      <div class="as-reading-row"><strong>${a === null ? '—' : fmt(a)} <small>AQI</small></strong>${a === null ? '' : pill(cat(a))}${isNow ? pill('Now', 'fx-now') : ''}</div>
      <p>${pill(cr ? (cr[3] >= 2 ? 'Forecast at this spot (near a monitor)' : 'Estimate at this spot, blended from nearby monitors') : 'Station forecast (model)')} <span class="fx-sub">${esc(labelTime(S.hour))}</span></p>
      <p class="fx-sub">A forecast for this hour, not a live reading.</p>
      <div class="as-value-grid"><div><small>PM2.5 likely</small><b>${fmt(pm, 1)} <i>µg/m³</i></b></div><div><small>Likely range</small><b>${fmt(lo)}–${fmt(hi)} <i>µg/m³</i></b></div></div></div>
    ${S.areaLoading ? '<div class="as-panel-card as-loading">Loading selected-area readings…</div>' : ''}
    <div class="as-panel-card"><b>Forecast for the next 15 days</b><small class="fx-note" style="display:block">Shown for the nearest monitor${st?.name ? `, ${esc(st.name)}` : ''}.</small>${f ? fchart(f.p10, f.p50, f.p90, S.hour) : '<p>Hourly forecast and range are unavailable from the API.</p>'}</div>
    ${alertCard()}
    ${trap ? `<div class="as-panel-card as-smoke-alert"><b>Smoke-trap conditions</b><p>Low wind (${fmt(wind)} km/h) and a low mixing layer (${fmt(mix)} m) may keep smoke near the ground tonight.</p></div>` : ''}
    <div class="as-panel-card"><b>Why is it like this?</b><small>What the model relied on for this hour at the nearest monitor${st?.name ? `, ${esc(st.name)}` : ''}. Not a measured source split.</small>
      ${causes.length ? causes.map(x => { const nm = value(x, 'cause', 'name'), sh = Math.max(0, n(value(x, 'share_pct')) || 0); return `<div class="fx-cause"><div class="fx-crow"><span>${esc(nm)}</span><b>${fmt(value(x, 'ug_m3'))} µg/m³</b></div><div class="fx-bar"><i style="width:${sh}%"></i></div><small>${esc(help[nm] || value(x, 'help') || '')}${x.modelled === false ? ' (not modelled)' : ''}</small></div>`; }).join('') : '<p>Explanation unavailable from the API.</p>'}
      ${S.explain?.typical_baseline_pm25 != null ? `<small>Typical level here: ${fmt(S.explain.typical_baseline_pm25)} µg/m³.</small>` : ''}</div>
    <div class="as-panel-card"><b>Where this number comes from</b>
      ${near.length ? `<div class="fx-near">${near.map(s => `<div><span>${esc(s.name)}</span><small>${fmt(s.d, 1)} km</small><b style="color:${col(c.aqiOf(s))}">AQI ${fmt(c.aqiOf(s))}</b></div>`).join('')}</div><small>The number at the top is this spot's own estimate: a blend of nearby monitors, so closer ones count more. Each monitor above shows its own forecast, so they can differ from the spot.</small>` : '<p>Monitor data unavailable.</p>'}</div>
    <div class="as-panel-card"><b>Weather at this hour</b><div class="as-reading-grid"><span>Wind<b>${wind === null ? '—' : `${fmt(wind)} km/h`}</b></span><span>Direction<b>${fmt(value(w, 'wind_dir_deg'))}°</b></span><span>Mixing height<b>${mix === null ? '—' : mix < 50 ? 'under 50 m' : `${fmt(mix)} m`}</b></span><span>Temperature<b>${fmt(value(w, 'temp_c'))}°C</b></span></div></div>
    <div class="as-panel-card"><b>Health guidance</b><div class="fx-chips">${PERSONS.map(x => `<button class="fx-chip ${S.person === x ? 'on' : ''}" data-person="${esc(x)}">${esc(x)}</button>`).join('')}</div><p id="healthTxt">${esc(healthText(a, S.person))}</p><small>General guidance only, not medical advice.</small></div>
    <button class="as-primary" id="panelAct">Try a what-if for this city →</button>`;
  }


  // ------------------------------------------------------------------ act (what-if)
  const PRESETS = { green: { crackers: 100, traffic: 0, fires: 0 }, traffic: { crackers: 0, traffic: 30, fires: 0 }, all: { crackers: 100, traffic: 30, fires: 50 }, reset: { crackers: 0, traffic: 0, fires: 0 } };
  function actPage() {
    if (!S.actInit) { S.actInit = true; S.values = { ...PRESETS.reset }; }
    const times = S.meta?.times || [];
    const hint = { crackers: 'For example, only green crackers.', traffic: 'For example, fewer vehicles on the road.', fires: 'Smoke drifting in from crop burning.' };
    return `<main class="as-page fx-act"><div class="as-page-title"><small>ACT · SCENARIO PLANNING</small><h1>What could make Delhi's air better?</h1><p>Reduce a cause and see how the forecast changes. Weather cannot be changed, so it stays as forecast.</p></div>
    <div class="fx-actgrid"><section class="as-card fx-controls"><h2>Choose the hour</h2>
      <select id="actHour" class="fx-select" aria-label="Forecast hour">${times.map((t, i) => i % 3 === 0 ? `<option value="${i}" ${i === S.hour ? 'selected' : ''}>${esc(labelTime(i))}</option>` : '').join('')}</select>
      <button class="fx-ghost" id="actDiwali">Diwali night, 9 pm</button>
      <h2 style="margin-top:22px">How much to cut</h2><small class="fx-note">0% = no cuts, so After is the same as the forecast. Slide right to cut that source.</small>
      ${[['crackers', 'Firecrackers'], ['traffic', 'Traffic'], ['fires', 'Farm-fire smoke']].map(([k, l]) => `<label class="fx-slider"><span class="fx-srow"><span>${l}</span><b id="v-${k}">${S.values[k]}%</b></span><input data-fsim="${k}" type="range" min="0" max="100" value="${S.values[k]}"><small>${hint[k]}</small></label>`).join('')}
      <div class="fx-chips"><button class="fx-chip" data-fpreset="green">Green crackers only</button><button class="fx-chip" data-fpreset="traffic">Less traffic</button><button class="fx-chip" data-fpreset="all">All three</button><button class="fx-chip" data-fpreset="reset">Reset</button></div>
      <small class="fx-note">Estimated from what the model learned about each cause. Not a measured policy result. Crackers only matter around Diwali, so on other days that slider changes nothing.</small></section>
    <section class="as-card" id="actResult"></section>
    <section class="as-card fx-maps"><div><small>BEFORE · forecast</small><div id="mapBefore" class="fx-mini"></div></div><div><small>AFTER · scenario estimate</small><div id="mapAfter" class="fx-mini"></div></div></section>
    <section class="as-card fx-rank" id="actRank"></section></div></main>`;
  }
  function miniMap(id, rows) {
    const el = $('#' + id); if (!el || !rows?.length || !window.L) return;
    const L = window.L, map = L.map(el, { zoomControl: false, dragging: false, scrollWheelZoom: false, doubleClickZoom: false, boxZoom: false, keyboard: false, touchZoom: false, attributionControl: false });
    (window.actMaps ||= []).push(map);
    L.tileLayer(c.tileUrl(), { maxZoom: 19, className: c.tileClass() }).addTo(map);
    const b = [];
    rows.forEach(r => { const [lat, lon, pm, conf] = r, color = col(aqiFromPm(pm)); b.push([lat, lon]);
      L.rectangle([[lat - .0075, lon - .0075], [lat + .0075, lon + .0075]], { color, weight: .3, fillColor: color, fillOpacity: [.4, .6, .8][Math.max(0, Math.min(2, Number(conf) || 0))], interactive: false }).addTo(map); });
    map.fitBounds(b, { padding: [4, 4] });
  }
  const crackerHour = h => h >= 189 - 48 && h <= 189 + 72;
  function paintAct() {
    if (S.page !== 'act') return;
    (window.actMaps || []).forEach(m => m.remove()); window.actMaps = [];
    const d = S.simData, box = $('#actResult'), rk = $('#actRank'); if (!box) return;
    if (!d) box.innerHTML = `<h2>City impact</h2><div class="as-no-data">${S.simError ? 'Scenario results unavailable.' : 'Calculating…'}</div>`;
    else {
      const b = d.before_city, a = d.after_city, drop = n(b.pm25) - n(a.pm25);
      box.innerHTML = `<h2>City impact · ${esc(labelTime(S.hour))}</h2><div class="fx-shift"><div><small>Before</small><b style="color:${col(b.aqi)}">${fmt(b.aqi)}</b><span>${esc(b.category)}</span></div><i>→</i><div><small>After</small><b style="color:${col(a.aqi)}">${fmt(a.aqi)}</b><span>${esc(a.category)}</span></div></div>
      <p>${drop > 0.5 ? `Estimated PM2.5 drop: about ${fmt(drop, 0)} µg/m³ citywide (${fmt(b.pm25)} → ${fmt(a.pm25)}).` : 'No cuts chosen yet, so After equals the forecast. Slide a source to the right, or press a preset, to see how much it would help.'}</p>${S.values.crackers > 0 && !crackerHour(S.hour) ? `<p class="fx-note">Crackers only add pollution from about two days before to three days after Diwali night, so cutting them changes nothing at this hour. <a href="#act" id="toDiwali" style="color:#e6c98e">Jump to Diwali night</a>.</p>` : ''}${S.values.crackers >= 1 && crackerHour(S.hour) ? `<p class="fx-note">Even with no crackers at all, smoke from farm fires, traffic and trapped weather remains, so the air improves noticeably but the city will not turn green.</p>` : ''}<p>${pill('Scenario estimate')} <small class="fx-note">${esc(d.note || '')}</small></p>`;
      $('#toDiwali')?.addEventListener('click', e => { e.preventDefault(); setHour(189); });
      miniMap('mapBefore', S.map?.cells); miniMap('mapAfter', d.cells);
    }
    const sim = Object.fromEntries((d?.stations || []).map(r => [r.station, r]));
    const rows = S.rank || [];
    rk.innerHTML = `<h2>Where to act first</h2><small class="fx-note">Monitors with the highest forecast at this hour, worst first.</small>
      ${rows.length ? `<div class="fx-tbl"><div class="fx-th"><span>#</span><span>Area (monitor)</span><span>Forecast AQI</span><span>After scenario</span><span>Likely range (PM2.5)</span><span>Suggested action</span></div>${rows.map(r => { const s = sim[r.station]; return `<div class="fx-tr"><span>${r.rank}</span><span>${esc(r.station)}</span><span><i class="fx-dot" style="background:${col(r.aqi)}"></i>${fmt(r.aqi)} ${esc(r.category)}</span><span>${s ? `<i class="fx-dot" style="background:${col(s.after.aqi)}"></i>${fmt(s.after.aqi)}` : '—'}</span><span>${fmt(r.range?.[0])}–${fmt(r.range?.[1])}</span><span>${esc(r.action)}</span></div>`; }).join('')}</div>` : '<div class="as-no-data">Ranking unavailable from the API.</div>'}`;
  }
  async function loadAct() {
    S.simError = false; const v = S.values, at = encodeURIComponent(timeAt(S.hour));
    const my = ++simSeq, sim = get(`${path()}/simulate?hour=${at}&crackers=${v.crackers / 100}&traffic=${v.traffic / 100}&fires=${v.fires / 100}`, 8000).then(x => { if (my === simSeq) S.simData = x }).catch(() => { if (my === simSeq) { S.simData = null; S.simError = true } });
    const rk = get(`${path()}/rank?hour=${at}&top=10`).then(x => { S.rank = x.ranking || [] }).catch(() => { S.rank = null });
    await Promise.all([sim, rk]); paintAct();
  }
  async function loadSim() { // sliders only: no page rebuild, so dragging is not interrupted
    S.simError = false; const v = S.values, at = encodeURIComponent(timeAt(S.hour)), my = ++simSeq;
    let r = null, err = false;
    try { r = await get(`${path()}/simulate?hour=${at}&crackers=${v.crackers / 100}&traffic=${v.traffic / 100}&fires=${v.fires / 100}`, 8000) } catch { err = true }
    if (my !== simSeq) return; // a newer slider move is in flight: ignore this stale answer
    S.simData = r; S.simError = err;
    paintAct();
  }
  function bindAct() {
    $('#actHour')?.addEventListener('change', e => setHour(Number(e.target.value)));
    $('#actDiwali')?.addEventListener('click', () => setHour(189));
    document.querySelectorAll('[data-fsim]').forEach(i => i.addEventListener('input', () => { S.values[i.dataset.fsim] = Number(i.value); $('#v-' + i.dataset.fsim).textContent = i.value + '%'; clearTimeout(window.simDebounce); window.simDebounce = setTimeout(loadSim, 160); }));
    document.querySelectorAll('[data-fpreset]').forEach(b => b.addEventListener('click', () => { S.values = { ...PRESETS[b.dataset.fpreset] }; if (S.values.crackers > 0 && !crackerHour(S.hour)) { setHour(189); return; } document.querySelectorAll('[data-fsim]').forEach(i => { i.value = S.values[i.dataset.fsim]; $('#v-' + i.dataset.fsim).textContent = i.value + '%'; }); loadSim(); }));
    paintAct();
  }


  // ------------------------------------------------------------------ proof
  const TABS = [['compare', 'Diwali compare'], ['test', 'Hidden-answer test'], ['short', 'Short-term replay'], ['score', '2026 scorecard'], ['live', 'Use your own readings']];
  const dshort = x => new Date(x + 'T00:00:00Z').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  function bars(rows, max) { return `<div class="fx-hbars">${rows.map(r => `<div class="${r.us ? 'us' : ''}"><span>${esc(r.name)}</span><div><i style="width:${Math.max(2, r.v / max * 100)}%"></i></div><b>${fmt(r.v, r.dec ?? 0)}</b></div>`).join('')}</div>`; }
  function compareChart(past, fc) {
    const W = 640, H = 230, PL = 40, PR = 12, PT = 12, PB = 28, offs = Array.from({ length: 15 }, (_, i) => i - 7), years = Object.keys(past);
    const max = Math.ceil(Math.max(...years.flatMap(y => offs.map(o => past[y][o] ?? 0)), ...offs.map(o => fc[o] ?? 0)) / 50) * 50;
    const xs = i => PL + i / 14 * (W - PL - PR), ys = v => PT + (1 - v / max) * (H - PT - PB);
    const Pth = g => offs.map((o, i) => `${i ? 'L' : 'M'}${xs(i).toFixed(1)},${ys(g(o)).toFixed(1)}`).join('');
    let grid = ''; for (let v = 0; v <= max; v += 50) grid += `<line x1="${PL}" x2="${W - PR}" y1="${ys(v)}" y2="${ys(v)}" class="fx-grid"/><text x="${PL - 6}" y="${ys(v) + 3}" class="fx-ax" text-anchor="end">${v}</text>`;
    return `<svg id="cmp" viewBox="0 0 ${W} ${H}" class="fx-chart wide" role="img" aria-label="City average PM2.5 around Diwali 2017 to 2025 and the 2026 forecast">${grid}<line x1="${xs(7)}" x2="${xs(7)}" y1="${PT}" y2="${H - PB}" class="fx-cursor"/>
      ${offs.filter(o => o % 2 === 0).map(o => `<text x="${xs(o + 7)}" y="${H - 8}" class="fx-ax" text-anchor="middle" ${o === 0 ? 'font-weight="700"' : ''}>${o === 0 ? 'Diwali' : o < 0 ? 'D' + o : 'D+' + o}</text>`).join('')}
      ${years.map(y => `<path d="${Pth(o => past[y][o])}" class="fx-past" data-y="${y}"/>`).join('')}<path d="${Pth(o => fc[o])}" class="fx-fc"/>${offs.map((o, i) => `<circle cx="${xs(i)}" cy="${ys(fc[o])}" r="3" class="fx-fcdot"/>`).join('')}</svg>`;
  }
  function tabCompare(d) {
    const years = Object.keys(d.past), ph = d.phases, avg = k => Math.round(years.reduce((t, y) => t + ph[y][k], 0) / years.length);
    return `<p class="fx-lead">Delhi's average PM2.5 each day, from 7 days before to 7 days after Diwali. Grey = 2017–2025 measured; gold = our 2026 forecast.</p>${compareChart(d.past, d.forecast_2026)}
    <div class="fx-chips"><span class="fx-key"><i></i>2026 forecast</span>${years.map(y => `<button class="fx-chip" data-hy="${y}">${y}</button>`).join('')}</div>
    <div class="fx-facts">${[['before', 'Week before'], ['night', 'Diwali night'], ['after', 'Week after']].map(([k, l]) => `<div><b>${avg(k)}</b><span>${l}: average of 2017–2025 measured (µg/m³)</span></div>`).join('')}</div>
    <div class="as-proof-footnote">Past peaks look lower than they were in 2020–21 because monitors stop counting at AQI 500. Older years are derived from AQI; 2024–2025 are measured PM2.5.</div>`;
  }
  function tabTest(d) {
    const b = d.backtest, m = b.metrics, us = m['AirWard model'], wk = m["Last week's reading"];
    const rows = Object.entries(m).map(([k, v]) => ({ name: NAMES[k] || k, v: v.mae, us: k === 'AirWard model' })).sort((x, y) => x.v - y.v), mx = Math.max(...rows.map(r => r.v));
    const st = Object.entries(b.per_station_mae || {}).map(([k, v]) => ({ name: k, v, dec: 1 })).sort((x, y) => x.v - y.v), smx = Math.max(...st.map(r => r.v));
    const imp = Object.entries(d.importance || {}).map(([k, v]) => ({ name: k, v, dec: 0 })).sort((x, y) => y.v - x.v);
    return `<p class="fx-lead">We hid Diwali 2025 from the model, asked it to forecast 10–31 October 2025, then compared with what the monitors measured. Average miss in PM2.5 (µg/m³) across ${fmt(us.n)} hourly forecasts. Lower is better.</p>${bars(rows, mx)}
    <div class="fx-facts"><div><b>${Math.round((1 - us.mae / wk.mae) * 100)}%</b><span>closer than repeating last week's reading</span></div><div><b>${fmt(us.category_accuracy, 0)}%</b><span>right AQI band exactly; ${Math.round(b.category_within_one)}% within one band</span></div><div><b>${fmt(b.coverage_p10_p90, 0)}%</b><span>of real readings inside our low–high range (aimed at 80%; the range was set on Diwali 2024, which reached ${fmt(b.coverage_on_calibration_window, 0)}%)</span></div></div>
    <h3 class="fx-h3">Where it is stronger and weaker</h3><small class="fx-note">Average miss by monitor, µg/m³.</small><div class="fx-scroll">${bars(st, smx)}</div>
    <h3 class="fx-h3">What the model leans on most</h3>${bars(imp, Math.max(...imp.map(x => x.v)))}<small class="fx-note">Share of the model's splits. Describes the model, not proven causes.</small>
    <h3 class="fx-h3">Limits we state up front</h3><ul class="fx-list">${(b.limitations || []).map(x => `<li>${esc(x)}</li>`).join('')}<li>No live data feed yet: the forecast is a saved file, issued ${esc(d.issued_at)}.</li><li>Farm-fire and traffic effects are seasonal and time-of-day proxies, not live fire counts or traffic data.</li></ul>`;
  }
  function tabShort(d) {
    const st = d.short_term || {}, rows = Object.entries(st), r = S.rp, stations = S.meta?.stations || [];
    const days = Array.from({ length: 22 }, (_, i) => `2025-10-${String(10 + i).padStart(2, '0')}`);
    const ST = S.rpStation || 'Anand Vihar', DAY = S.rpDay || '2025-10-20', HR = S.rpHour ?? 19;
    return `<p class="fx-lead">Short-term models forecast 1, 3, 6 and 24 hours ahead from the latest reading. Here is how they did against simply repeating the latest reading, across the Diwali 2025 test.</p>
    <div class="fx-tbl"><div class="fx-th c5"><span>Ahead</span><span>AeroSage miss</span><span>"Same as now" miss</span><span>AeroSage band right</span><span>"Same as now" band right</span></div>${rows.map(([h, v]) => `<div class="fx-tr c5"><span>${h.replace('h', ' hour')}</span><span><b>${fmt(v['AirWard model'].mae, 1)}</b></span><span>${fmt(v['Persistence (same as now)'].mae, 1)}</span><span>${fmt(v['AirWard model'].category_accuracy, 0)}%</span><span>${fmt(v['Persistence (same as now)'].category_accuracy, 0)}%</span></div>`).join('')}</div>
    <h3 class="fx-h3">Replay one moment</h3><small class="fx-note">Pick a monitor and a moment in the Diwali 2025 test window. There is no live feed yet, so this is not live.</small>
    <div class="fx-form"><select id="rpStation" class="fx-select">${stations.map(s => `<option ${s.name === ST ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select><select id="rpDay" class="fx-select">${days.map(x => `<option value="${x}" ${x === DAY ? 'selected' : ''}>${dshort(x)}${x === '2025-10-20' ? ' · Diwali' : ''}</option>`).join('')}</select><select id="rpHour" class="fx-select">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === HR ? 'selected' : ''}>${((h + 11) % 12) + 1} ${h < 12 ? 'am' : 'pm'}</option>`).join('')}</select></div>
    ${r === undefined ? '<p class="fx-note">Loading…</p>' : r === null ? '<div class="as-no-data">No replay for that moment.</div>' : `<div class="fx-tbl"><div class="fx-th c5"><span>Ahead</span><span>Forecast</span><span>What happened</span><span>"Same as now"</span><span>Typical miss</span></div>${['1h', '3h', '6h', '24h'].map(h => { const x = r.horizons[h]; return `<div class="fx-tr c5"><span>${h.replace('h', ' hour')}</span><span><b>${x.forecast ?? '–'}</b></span><span>${x.actual ?? '–'}</span><span>${x.same_as_now ?? '–'}</span><span>±${r.typical_error_mae[h]}</span></div>`; }).join('')}</div><small class="fx-note">PM2.5 µg/m³ at ${esc(r.now_hour.replace('T', ' '))}:00, reading then ${r.now_pm25 ?? '–'}. A dash means the monitor recorded no reading at that hour. ${pill('Replay of Diwali 2025')}</small>`}`;
  }
  function tabScore() {
    const sc = S.scorecard, res = S.scored;
    if (!sc?.rows) return '<div class="as-no-data">Scorecard unavailable from the API.</div>';
    const rows = res?.rows || sc.rows, dates = sc.rows.map(r => r.date);
    return `<p class="fx-lead">This is our public forecast for Diwali week, saved on ${esc(sc.issued_at)} before the festival. After 9 November, enter the measured city-average PM2.5 for each day and the page scores us.</p>
    <div class="fx-tbl"><div class="fx-th c5"><span>Day</span><span>Forecast</span><span>Likely range (PM2.5)</span><span>Measured</span><span>Result</span></div>${rows.map(r => `<div class="fx-tr c5"><span>${dshort(r.date)} · ${esc(r.label)}</span><span><i class="fx-dot" style="background:${col(r.forecast_city_avg.aqi)}"></i>${fmt(r.forecast_city_avg.aqi)} ${esc(r.forecast_city_avg.category)}</span><span>${r.approx_range_pm25[0]}–${r.approx_range_pm25[1]}</span><span>${r.actual_city_avg_pm25 ?? 'To be filled'}</span><span>${r.actual_city_avg_pm25 == null ? '—' : `${r.inside_range ? 'inside range' : 'outside range'}, ${r.category_match ? 'band right' : 'band off'} (${r.error_pm25 > 0 ? '+' : ''}${r.error_pm25})`}</span></div>`).join('')}</div>
    <h3 class="fx-h3">Score us after the festival</h3><small class="fx-note">Enter measured city-average PM2.5 (µg/m³): the average of the monitors' 24 hourly values. Leave a day empty to skip it.</small>
    <div class="fx-form wrap">${dates.map(x => `<label class="fx-field"><span>${dshort(x)}</span><input type="number" min="0" data-act="${x}" value="${esc(S.actuals?.[x] ?? '')}"></label>`).join('')}<button class="fx-btn" id="scoreGo">Score the forecast</button></div>
    ${S.scoreErr ? `<p class="fx-err">${esc(S.scoreErr)}</p>` : ''}${res?.summary ? `<div class="fx-facts"><div><b>${res.summary.mean_abs_error_pm25 ?? '—'}</b><span>average miss, µg/m³ (${res.summary.days_scored} days)</span></div><div><b>${esc(res.summary.inside_range)}</b><span>days inside the likely range</span></div><div><b>${esc(res.summary.category_match)}</b><span>days with the right AQI band</span></div></div>` : ''}`;
  }
  function tabLive() {
    const stations = S.meta?.stations || [], times = S.meta?.times || [], nc = S.nc || (S.nc = { station: stations[0]?.name || '', now: times[nowIdx()] || times[0], text: '', res: null, err: '', busy: false });
    const r = nc.res;
    return `<p class="fx-lead">The short-term models work with any live feed. Paste at least 25 hourly PM2.5 readings for one monitor (oldest first, the last value is the hour you pick) and get the next 1, 3, 6 and 24 hours. AeroSage does not collect live readings by itself yet.</p>
    <div class="fx-form wrap"><label class="fx-field"><span>Monitor</span><select id="ncStation" class="fx-select">${stations.map(s => `<option ${s.name === nc.station ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
    <label class="fx-field"><span>Hour of the last reading (IST)</span><select id="ncNow" class="fx-select">${times.map((t, i) => i % 3 === 0 || t === nc.now ? `<option value="${t}" ${t === nc.now ? 'selected' : ''}>${esc(labelTime(i))}</option>` : '').join('')}</select></label></div>
    <textarea id="ncText" class="fx-text" rows="4" placeholder="e.g. 142, 150, 161, ... (25 or more numbers, comma or space separated)">${esc(nc.text)}</textarea>
    <div class="fx-form"><button class="fx-btn" id="ncGo" ${nc.busy ? 'disabled' : ''}>${nc.busy ? 'Working…' : 'Forecast the next hours'}</button><button class="fx-ghost" id="ncDemo">Fill with demo numbers</button></div>
    ${nc.err ? `<p class="fx-err">${esc(nc.err)}</p>` : ''}
    ${r ? `<div class="fx-tbl"><div class="fx-th c5"><span>Ahead</span><span>Time</span><span>Forecast AQI</span><span>PM2.5</span><span>Likely range</span></div>${['1h', '3h', '6h', '24h'].map(h => { const x = r.horizons[h]; return x ? `<div class="fx-tr c5"><span>${h.replace('h', ' hour')}</span><span>${esc(x.time.replace('T', ' '))}:00</span><span><i class="fx-dot" style="background:${col(x.aqi)}"></i>${fmt(x.aqi)} ${esc(x.category)}</span><span>${fmt(x.pm25)}</span><span>${x.likely_range[0]}–${x.likely_range[1]} (typical miss ±${x.typical_error_mae})</span></div>` : `<div class="fx-tr c5"><span>${h}</span><span>beyond the forecast window</span><span></span><span></span><span></span></div>`; }).join('')}</div><small class="fx-note">Latest reading ${r.now_pm25} µg/m³ at ${esc(r.now.replace('T', ' '))}:00. ${pill('Model estimate from the readings you supplied')}</small>` : ''}
    <small class="fx-note">The demo numbers are made-up and only show how the form works.</small>`;
  }
  function proofPage() {
    const d = S.diwali, body = !d ? '<div class="as-no-data">Loading evidence from the API…</div>' : S.proofTab === 'compare' ? tabCompare(d) : S.proofTab === 'test' ? tabTest(d) : S.proofTab === 'short' ? tabShort(d) : S.proofTab === 'score' ? tabScore() : tabLive();
    const ttl = { compare: 'Diwali comparison', test: 'Hidden-answer test', short: 'Short-term replay', score: '2026 public scorecard', live: 'Use your own readings' }[S.proofTab] || 'Diwali comparison';
    return `<main class="as-page as-proof-page fx-proof"><div class="as-page-title"><small>PROOF · EVIDENCE &amp; LIMITS</small><h1>How far you can trust it</h1><p>We tested AeroSage on a Diwali it had never seen, and we saved this year's forecast before the festival so it can be checked afterwards.</p></div>
    <div class="as-proof-principles"><div><b>Observed</b><span>Historical monitor readings</span></div><div><b>Forecast</b><span>Model estimate with a range</span></div><div><b>Scenario</b><span>Modelled possibility, not a measured result</span></div></div>
    <div class="as-tabs">${TABS.map(([k, t]) => `<button data-ptab="${k}" class="${S.proofTab === k ? 'active' : ''}">${t}</button>`).join('')}</div>
    <section class="as-card as-proof-card"><div class="as-proof-section-heading"><div><small>VERIFICATION</small><h2>${ttl}</h2></div></div>${body}</section></main>`;
  }
  async function loadReplay() {
    S.rp = undefined; if (S.page === 'proof' && S.proofTab === 'short') render();
    const st = S.rpStation || 'Anand Vihar', hr = `${S.rpDay || '2025-10-20'}T${String(S.rpHour ?? 19).padStart(2, '0')}`;
    try { S.rp = await get(`${path()}/replay?station=${encodeURIComponent(st)}&hour=${hr}`) } catch { S.rp = null }
    if (S.page === 'proof') render();
  }
  function bindProof() {
    document.querySelectorAll('[data-ptab]').forEach(b => b.addEventListener('click', () => { S.proofTab = b.dataset.ptab; if (S.proofTab === 'short' && S.rp === undefined) loadReplay(); else render(); }));
    document.querySelectorAll('[data-hy]').forEach(b => { const on = () => document.querySelectorAll('#cmp .fx-past').forEach(p => p.classList.toggle('dim', p.dataset.y !== b.dataset.hy)), off = () => document.querySelectorAll('#cmp .fx-past').forEach(p => p.classList.remove('dim')); b.addEventListener('mouseenter', on); b.addEventListener('mouseleave', off); b.addEventListener('focus', on); b.addEventListener('blur', off); });
    $('#rpStation')?.addEventListener('change', e => { S.rpStation = e.target.value; loadReplay(); });
    $('#rpDay')?.addEventListener('change', e => { S.rpDay = e.target.value; loadReplay(); });
    $('#rpHour')?.addEventListener('change', e => { S.rpHour = Number(e.target.value); loadReplay(); });
    $('#scoreGo')?.addEventListener('click', async () => {
      const actuals = {}; document.querySelectorAll('[data-act]').forEach(i => { if (i.value !== '') actuals[i.dataset.act] = Number(i.value); }); S.actuals = actuals; S.scoreErr = '';
      if (!Object.keys(actuals).length) { S.scoreErr = 'Enter at least one measured value.'; render(); return; }
      try { const r = await fetch(`/api${path()}/scorecard`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ actuals }) }); if (!r.ok) throw Error((await r.json()).detail || r.status); S.scored = await r.json() } catch (e) { S.scoreErr = 'Could not score: ' + e.message; }
      render();
    });
    const nc = S.nc || {};
    $('#ncStation')?.addEventListener('change', e => { nc.station = e.target.value; });
    $('#ncNow')?.addEventListener('change', e => { nc.now = e.target.value; });
    $('#ncText')?.addEventListener('input', e => { nc.text = e.target.value; });
    $('#ncDemo')?.addEventListener('click', () => { nc.text = Array.from({ length: 30 }, (_, i) => Math.round(150 + 2.5 * i + 12 * Math.sin(i / 3))).join(', '); render(); });
    $('#ncGo')?.addEventListener('click', async () => {
      const vals = (nc.text.match(/-?\d+(\.\d+)?/g) || []).map(Number); nc.err = '';
      if (vals.length < 25) { nc.err = `Please give at least 25 hourly readings (you gave ${vals.length}).`; render(); return; }
      nc.busy = true; render();
      try { const r = await fetch(`/api${path()}/nowcast`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ station: nc.station, now: nc.now, readings: vals }) }); const j = await r.json(); if (!r.ok) throw Error(typeof j.detail === 'string' ? j.detail : 'check the inputs'); nc.res = j } catch (e) { nc.err = 'Could not forecast: ' + e.message; nc.res = null; }
      nc.busy = false; render();
    });
  }

  // ------------------------------------------------------------------ about

  function hardwarePage() {
    const H = '/assets/hardware/';
    const parts = [
      ['PM sensor (PMS5003)', 'Counts airborne particles and reports PM1.0, PM2.5 and PM10. PM2.5 is the number AeroSage forecasts.'],
      ['Weather sensor (BME280)', 'Temperature and humidity, kept under a louvered shield on top so sun and rain do not skew it.'],
      ['Gas sensors (optional)', 'CO, NO₂ and SO₂ modules can be added. The block diagram also lists O₃.'],
      ['ESP32 controller', 'Reads every sensor and sends the readings over Wi-Fi to the AirWard server.'],
      ['Battery and solar panel', 'A small solar panel recharges the battery, so the node needs no mains wiring.'],
      ['Sealed enclosure', 'A pole-mounted case with vent slots and a green status LED on the front.']];
    const steps = [
      ['01', 'Air comes in', 'Outside air enters at the top, through the louvered inlet above the PM sensor.'],
      ['02', 'Sensors measure', 'The PM sensor reports PM1.0, PM2.5 and PM10. The weather sensor adds temperature and humidity.'],
      ['03', 'ESP32 collects', 'The controller gathers the readings and prepares them to send.'],
      ['04', 'Wi-Fi to server', 'Readings travel over Wi-Fi to the AirWard server.'],
      ['05', 'Feeds the forecast', 'Real PM2.5 from the street can correct and sharpen the AeroSage forecast for that neighbourhood.'],
      ['06', 'Runs on its own', 'The solar panel keeps the battery topped up between readings.']];
    return `<main class="as-page fx-about fx-hw"><div class="as-page-title"><small>THE HARDWARE</small><h1>The AirWard node: air measured where people live</h1><p>AeroSage forecasts from monitors and weather. A low-cost, solar-powered node would add a live reading from the street itself.</p></div>
    <section class="as-card fx-sec fx-hw-hero"><div class="fx-hw-video"><video src="${H}node-demo.mp4" poster="${H}node-poster.jpg" autoplay muted loop playsinline controls preload="metadata" aria-label="The AirWard node opening to show its electronics"></video><span>The node opens to show the sensors, controller and battery inside.</span></div>
    <div class="fx-hw-side"><h2>Why build a node</h2><p>The model has no live pollutant input today. Between CPCB monitors, it estimates. A node placed in a lane, school or market measures the air there and reports it.</p><div class="fx-hw-facts"><div><b>3</b><span>particle sizes: PM1.0, PM2.5, PM10</span></div><div><b>Solar</b><span>powered, no mains wiring</span></div><div><b>Wi-Fi</b><span>readings sent to the server</span></div></div></div></section>
    <section class="as-card fx-sec"><h2>What is inside</h2><div class="fx-hw-figs"><figure><img src="${H}node-outdoor.jpg" alt="The AirWard node mounted on a pole outdoors" loading="lazy"><figcaption>Pole-mounted outdoors, with solar panel and louvered shield.</figcaption></figure><figure><img src="${H}node-inside.jpg" alt="Cut-away view of the AirWard node with each module labelled" loading="lazy"><figcaption>Cut-away view with each module labelled.</figcaption></figure></div>
    <div class="fx-steps">${parts.map(([t, p]) => `<div><b>${t}</b><p>${p}</p></div>`).join('')}</div></section>
    <section class="as-card fx-sec"><h2>How it works</h2><figure class="fx-hw-diagram"><img src="${H}node-diagram.jpg" alt="Block diagram of the AirWard node: air inlet, PM sensor, ESP32, gas and weather sensors, battery and solar panel, data to server" loading="lazy"><figcaption>Block diagram. Solid arrows are airflow and power, the dashed arrow is data.</figcaption></figure><div class="fx-steps">${steps.map(([k, t, p]) => `<div><small>${k}</small><b>${t}</b><p>${p}</p></div>`).join('')}</div></section>
    <section class="as-card as-limits"><h2>Honest limits</h2><ul class="fx-list"><li>This page shows the node design. It is a concept in our plan, not yet a deployed network, and no readings from it appear anywhere on this site.</li><li>The forecasts you see here come from past monitor data and weather. They do not use the node.</li><li>Still to confirm: which gas sensors are fitted, battery and solar sizing, calibration against a reference monitor, and enclosure rating for rain and dust.</li></ul></section></main>`;
  }

  function aboutPage() {
    const d = S.diwali, us = d?.backtest?.metrics?.['AirWard model'], wk = d?.backtest?.metrics?.["Last week's reading"];
    const steps = [
      ['01', 'Data', 'Hourly PM2.5 from 39 CPCB/DPCC monitors in Delhi (2017–2025), plus weather from Open-Meteo and the Diwali calendar.'],
      ['02', 'Outlook model', 'A gradient-boosted model (LightGBM) forecasts low, likely and high PM2.5 for every monitor, hour by hour, for 1–15 November. It does not need yesterday’s readings, so it works days ahead.'],
      ['03', 'Short-term models', 'Four more models forecast 1, 3, 6 and 24 hours ahead from the latest reading. They beat "same as now" at every horizon in our test.'],
      ['04', 'Between monitors', 'Distance-weighted blending fills Delhi in 1.5 km boxes within about 6.5 km of a monitor. Fainter boxes are farther from a monitor and less certain.'],
      ['05', 'Why', 'The same model reports how much each of five groups (crackers, weather trap, farm-fire season, traffic and daily routine, local area) pushed the forecast up or down.'],
      ['06', 'What-if', 'Remove part of a group’s push and re-draw the map. A scenario estimate, not a measured result.']];
    const eps = ['/map', '/map/all', '/forecast', '/nearest', '/explain', '/simulate', '/rank', '/diwali', '/replay', '/nowcast', '/scorecard', '/meta'];
    return `<main class="as-page fx-about"><div class="as-page-title"><small>ABOUT AEROSAGE</small><h1>See it. Trust it. Understand it. Act on it.</h1><p>A neighbourhood-scale view of Diwali air quality and the choices that can improve it.</p></div>
    <div class="as-about-grid"><article class="as-card"><small>01 · SEE</small><h2>Street-by-street forecasts</h2><p>Map boxes estimate PM2.5 between monitoring stations. Fainter boxes mean lower confidence.</p></article><article class="as-card"><small>02 · TRUST</small><h2>Ranges, sources, and proof</h2><p>Forecast estimates are kept apart from observed readings. The low–high range is always shown.</p></article><article class="as-card"><small>03 · UNDERSTAND</small><h2>Weather and contributing factors</h2><p>See what the model relied on for each place and hour. Not proof of causation.</p></article><article class="as-card"><small>04 · ACT</small><h2>Compare possible actions</h2><p>Scenario results estimate possible outcomes. They are not measured policy effects.</p></article></div>
    <section class="as-card fx-sec"><h2>How AeroSage works</h2><div class="fx-steps">${steps.map(([k, t, p]) => `<div><small>${k}</small><b>${t}</b><p>${p}</p></div>`).join('')}</div></section>
    ${us ? `<section class="as-card fx-sec"><h2>The test in one line</h2><p>Hiding Diwali 2025 from the model, AeroSage missed by ${fmt(us.mae, 0)} µg/m³ on average, against ${fmt(wk.mae, 0)} for repeating last week's reading. It named the right AQI band ${fmt(us.category_accuracy, 0)}% of the time and was within one band ${fmt(d.backtest.category_within_one, 0)}% of the time. See the Proof page for the full test.</p></section>` : ''}
    <section class="as-card fx-sec"><h2>What the API offers</h2><div class="fx-chips">${eps.map(x => `<span class="fx-chip static">/api/delhi${x}</span>`).join('')}</div><p>Everything on this site is read from these endpoints. Interactive docs are at /docs. More cities need only a config entry and a training run.</p></section>
    <section class="as-card as-limits"><h2>Data and honest limits</h2><ul class="fx-list"><li>Sources: CPCB/DPCC via OpenCity, Open-Meteo and CAMS. Forecasts are model estimates, not live sensor readings.</li><li>The test used recorded weather, not a day-ahead weather forecast, so real use will be somewhat less accurate.</li><li>Farm-fire and traffic influence are a seasonal curve and a time-of-day proxy, not live fire counts or traffic data.</li><li>Between monitors the map is an estimate. Station positions are approximate (±1–2 km).</li><li>The Diwali peak can still be forecast a little low.</li><li>Air-quality information is not medical advice.</li></ul><p>Team NexByte · Lovely Professional University · Paryavaran Welfare Society</p></section></main>`;
  }

  return { pushEnable, pushOff, pushTest, pushSync, alertBody, setAlertLvl, areaPanel, healthText, nowIdx, actPage, bindAct, loadAct, loadSim, paintAct, proofPage, bindProof, loadReplay, hardwarePage, aboutPage };
}
