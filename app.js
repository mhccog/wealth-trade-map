/* The Wealth Trade Map — plain JS, no build step. Data: data.json (shipped) → saved copy on the sync Worker → localStorage fallback. */
'use strict';
const SYNC_URL = 'https://wealth-trade-map-sync.carplay.workers.dev'; // not secret; writes need the passphrase
const LS = { local: 'wtm:local', key: 'wtm:key', dev: 'wtm:device', skip: 'wtm:skipunlock' };
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const mobile = () => matchMedia('(max-width:820px)').matches;

let S = null;               // the whole editable document
let REV = 0, DIRTY = false; // server revision this copy is based on; unsynced local edits?
const U = { tab: (matchMedia('(max-width:820px)').matches ? 'map' : 'list'), towns: new Set(), cats: new Set(), q: '', tq: '', editing: false, globe: false, sel: null, connectFrom: null };
let map = null, mapReady = false, popup = null;
const device = localStorage.getItem(LS.dev) || (() => { const d = (mobile() ? 'phone-' : 'computer-') + uid(); localStorage.setItem(LS.dev, d); return d; })();

/* ---------------- helpers on data ---------------- */
const L = k => (S.labels && S.labels[k] != null ? S.labels[k] : k);
const cat = id => S.categories.find(c => c.id === id) || { id, name: id || 'Other', color: '#888', bullets: [] };
const bizBy = id => S.businesses.find(b => b.id === id);
function getPath(p) { return p.split('.').reduce((o, k) => (o == null ? o : o[k]), S); }
function setPath(p, v) { const ks = p.split('.'); const last = ks.pop(); const o = ks.reduce((o, k) => o[k], S); o[last] = v; }
function visible() {
  const q = U.q.trim().toLowerCase();
  return S.businesses.filter(b => (!U.towns.size || U.towns.has(b.town)) && (!U.cats.size || U.cats.has(b.cat)) &&
    (!q || [b.name, b.sub, b.town, b.note, b.address].join(' ').toLowerCase().includes(q)));
}
function linksOf(id) { return S.connections.filter(c => c.a === id || c.b === id); }
function toast(t) { const el = $('#toast'); el.textContent = t; el.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (el.hidden = true), 2400); }

/* ---------------- saving ---------------- */
function saveLocal() { try { localStorage.setItem(LS.local, JSON.stringify({ data: S, rev: REV, dirty: DIRTY })); } catch (e) { } }
function setStatus(kind, text) { const el = $('#savestate'); el.className = 'savestate ' + (kind || ''); el.textContent = text || ''; }
let pushTimer = null, pushing = false;
function commit(opts = {}) {           // call after ANY change
  DIRTY = true; saveLocal();
  if (!opts.quiet) render(opts.keepFocus);
  schedulePush();
}
function schedulePush(delay = 1200) {
  if (!localStorage.getItem(LS.key)) { setStatus('warn', L('offline')); return; }
  setStatus('', L('saving')); clearTimeout(pushTimer); pushTimer = setTimeout(push, delay);
}
async function push() {
  const key = localStorage.getItem(LS.key); if (!key || !DIRTY) return;
  if (pushing) { schedulePush(800); return; }
  pushing = true; const snapshot = JSON.stringify({ data: S, device });
  try {
    const r = await fetch(SYNC_URL + '/data', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-App-Key': key }, body: snapshot });
    if (r.status === 401) { localStorage.removeItem(LS.key); setStatus('warn', L('offline')); askUnlock('That passphrase didn’t work. Please enter it again.'); return; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json(); REV = j.rev;
    if (JSON.stringify({ data: S, device }) === snapshot) DIRTY = false; // nothing changed while sending
    saveLocal(); setStatus('ok', DIRTY ? L('saving') : L('saved') + ' ✓');
    if (DIRTY) schedulePush(600);
  } catch (e) { setStatus('warn', L('offline') + ' · will sync'); clearTimeout(pushTimer); pushTimer = setTimeout(push, 20000); }
  finally { pushing = false; }
}
async function pull(initial) {          // load the latest saved copy from the server
  const key = localStorage.getItem(LS.key); if (!key) return false;
  try {
    const r = await fetch(SYNC_URL + '/data', { headers: { 'X-App-Key': key }, cache: 'no-store' });
    if (r.status === 401) { localStorage.removeItem(LS.key); askUnlock('That passphrase didn’t work. Please enter it again.'); return false; }
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const j = await r.json();
    if (!j.data) { DIRTY = true; await push(); return true; }      // first ever save: seed the server with this copy
    if (DIRTY && j.rev <= REV) { await push(); return true; }       // our offline edits are newer
    if (j.rev !== REV || initial) {
      if (DIRTY && j.rev > REV) toast('Loaded newer edits from another device');
      S = normalise(j.data); REV = j.rev; DIRTY = false; saveLocal(); render();
    }
    setStatus('ok', L('saved') + ' ✓'); return true;
  } catch (e) { setStatus('warn', L('offline')); return false; }
}
async function tryKey(k) {
  const r = await fetch(SYNC_URL + '/check', { headers: { 'X-App-Key': k } }).catch(() => null);
  return r && r.ok;
}
function askUnlock(msg) {
  dialog(`<h2>Save everywhere</h2><p>${esc(msg || 'Enter your passphrase once on this device. After that every edit saves automatically and shows up on your other devices.')}</p>
   <label>Passphrase</label><input name="k" autocomplete="current-password" type="password" required>
   <p class="hint">It's on your private Notion page. You only need it once per device.</p>
   <div class="btns"><button value="cancel" class="btn ghost" formnovalidate>Not now</button><button value="ok" class="btn primary">Unlock</button></div>`,
    async f => {
      const k = f.k.value.trim(); if (!(await tryKey(k))) { toast('That passphrase didn’t work'); return false; }
      localStorage.setItem(LS.key, k); localStorage.removeItem(LS.skip); toast('Unlocked. Edits now save everywhere.'); await pull(true); return true;
    }, () => localStorage.setItem(LS.skip, '1'));
}

/* ---------------- load ---------------- */
function normalise(d) {
  d.labels = d.labels || {}; d.meta = d.meta || {}; d.categories = d.categories || []; d.towns = d.towns || []; d.businesses = d.businesses || []; d.connections = d.connections || [];
  for (const b of d.businesses) if (!b.id) b.id = uid();
  for (const b of d.businesses) if (!d.towns.some(t => t.name === b.town)) d.towns.push({ name: b.town, lat: b.lat, lng: b.lng });
  return d;
}
async function boot() {
  let shipped = null;
  try { shipped = await (await fetch('data.json', { cache: 'no-store' })).json(); } catch (e) { }
  const local = JSON.parse(localStorage.getItem(LS.local) || 'null');
  if (local && local.data) { S = normalise(local.data); REV = local.rev || 0; DIRTY = !!local.dirty; } else S = normalise(shipped);
  render(); fitMapBox(); initMap(); setTimeout(fitMapBox, 300);
  if (localStorage.getItem(LS.key)) await pull(true);
  else { setStatus('warn', L('offline')); if (!localStorage.getItem(LS.skip)) askUnlock(); }
  addEventListener('online', () => DIRTY ? schedulePush(200) : pull());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && !document.activeElement?.isContentEditable) pull(); });
}

/* ---------------- rendering ---------------- */
function render(keepFocus) {
  if (keepFocus && document.activeElement && document.activeElement.isContentEditable) { renderMap(); renderCounts(); return; }
  document.title = S.meta.title || 'The Wealth Trade Map';
  $$('[data-label]').forEach(el => { el.textContent = L(el.dataset.label); });
  $$('header [data-path]').forEach(el => { el.textContent = getPath(el.dataset.path) ?? ''; });
  $('#tq').placeholder = L('townSearch');
  $('#btn-edit').setAttribute('aria-pressed', U.editing); $('#btn-edit [data-label]').textContent = U.editing ? L('done') : L('edit');
  $('#btn-edit [data-label]').dataset.label = U.editing ? 'done' : 'edit';
  document.body.classList.toggle('editing', U.editing);
  renderTowns(); renderCats(); renderList(); renderAbout(); renderLinks(); renderCounts(); applyEditable(); addRelabels(); renderMap(); renderConnectBar();
  $('.main').dataset.tab = U.tab; $$('.bottomnav button').forEach(b => b.classList.toggle('on', b.dataset.tab === U.tab));
}
function renderCounts() { $('#count').textContent = visible().length; $('#lcount').textContent = S.connections.length || ''; }
function renderTowns() {
  const counts = {}; for (const b of S.businesses) counts[b.town] = (counts[b.town] || 0) + 1;
  const tq = U.tq.trim().toLowerCase();
  const list = S.towns.filter(t => !tq || t.name.toLowerCase().includes(tq)).sort((a, b) => (counts[b.name] || 0) - (counts[a.name] || 0) || a.name.localeCompare(b.name));
  $('#towns').innerHTML = `<button class="chip" data-town="" aria-pressed="${!U.towns.size}"><span data-label="allTowns">${esc(L('allTowns'))}</span></button>` +
    list.map(t => `<button class="chip" data-town="${esc(t.name)}" aria-pressed="${U.towns.has(t.name)}">${esc(t.name)}<span class="n">${counts[t.name] || 0}</span></button>`).join('') +
    `<button class="chip ed" data-act="addtown"><span data-label="addTown">${esc(L('addTown'))}</span></button>`;
}
function renderCats() {
  const counts = {}; for (const b of S.businesses) counts[b.cat] = (counts[b.cat] || 0) + 1;
  $('#cats').innerHTML = `<button class="chip" data-cat="" aria-pressed="${!U.cats.size}"><span data-label="allCats">${esc(L('allCats'))}</span></button>` +
    S.categories.map(c => `<button class="chip" style="--c:${c.color}" data-cat="${esc(c.id)}" aria-pressed="${U.cats.has(c.id)}"><i style="background:${c.color}"></i>${esc(c.name)}<span class="n">${counts[c.id] || 0}</span></button>`).join('') +
    `<button class="chip ed" data-act="addcat"><span data-label="addCat">${esc(L('addCat'))}</span></button>`;
}
function bizCard(b) {
  const i = S.businesses.indexOf(b), c = cat(b.cat), P = `businesses.${i}`;
  const links = linksOf(b.id);
  const dir = 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(b.name + ', ' + b.address);
  return `<article class="card ${U.sel === b.id ? 'sel' : ''}" style="--c:${c.color}" data-id="${esc(b.id)}">
    <h3 data-path="${P}.name">${esc(b.name)}</h3>
    <div class="meta"><span data-path="${P}.sub">${esc(b.sub)}</span> · ${esc(c.name)} · ${esc(b.town)}</div>
    <p class="note" data-path="${P}.note">${esc(b.note)}</p>
    <div class="addr" data-path="${P}.address">${esc(b.address)}</div>
    <div class="ed" style="flex-direction:column">
      <div class="field"><b>Phone</b><span data-path="${P}.phone">${esc(b.phone)}</span></div>
      <div class="field"><b>Website</b><span data-path="${P}.url">${esc(b.url)}</span></div>
      <div class="field"><b>Category</b><select data-bizcat="${esc(b.id)}">${S.categories.map(x => `<option value="${esc(x.id)}" ${x.id === b.cat ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></div>
      <div class="field"><b>Town</b><select data-biztown="${esc(b.id)}">${S.towns.map(t => `<option ${t.name === b.town ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}<option value="__new">+ New town…</option></select></div>
      <div class="row"><button class="mini" data-act="relocate" data-id="${esc(b.id)}">📍 Re-find pin from address</button><button class="mini danger" data-act="delbiz" data-id="${esc(b.id)}">Delete business</button></div>
    </div>
    <div class="row">
      ${b.url ? `<a class="mini go" href="${esc(b.url)}" target="_blank" rel="noopener"><span data-label="website">${esc(L('website'))}</span></a>` : ''}
      ${b.phone ? `<a class="mini" href="tel:${esc(b.phone.replace(/[^+\d]/g, ''))}"><span data-label="call">${esc(L('call'))}</span></a>` : ''}
      <a class="mini" href="${dir}" target="_blank" rel="noopener"><span data-label="directions">${esc(L('directions'))}</span></a>
      <button class="mini" data-act="show" data-id="${esc(b.id)}"><span data-label="showOnMap">${esc(L('showOnMap'))}</span></button>
      <button class="mini" data-act="connect" data-id="${esc(b.id)}">↔ <span data-label="connect">${esc(L('connect'))}</span></button>
    </div>
    ${links.length ? `<ul class="links">${links.map(l => { const o = bizBy(l.a === b.id ? l.b : l.a); const li = S.connections.indexOf(l); return `<li>↔ <b>${esc(o ? o.name : '?')}</b> <span data-path="connections.${li}.note">${esc(l.note || '')}</span><button class="x" title="Remove connection" data-act="dellink" data-link="${esc(l.id)}">×</button></li>`; }).join('')}</ul>` : ''}
  </article>`;
}
function renderList() {
  const v = visible();
  $('#pane-list').innerHTML = `<div class="editbar">Editing: tap any text to change it. The little ✎ on a button renames it. Everything saves by itself.</div>
    <div class="row" style="margin-bottom:10px"><button class="btn" data-act="addbiz"><span data-label="addBiz">${esc(L('addBiz'))}</span></button></div>` +
    (v.length ? v.map(bizCard).join('') : `<div class="empty">No businesses match these filters.</div>`);
}
function bulletList(path, arr) {
  return `<ul>${(arr || []).map((t, j) => `<li class="bl"><span data-path="${path}.${j}">${esc(t)}</span><button class="del ed" title="Delete point" data-act="delbullet" data-path2="${path}" data-j="${j}">×</button></li>`).join('')}
    <li class="ed" style="list-style:none;margin-left:-20px"><button class="mini" data-act="addbullet" data-path2="${path}"><span data-label="addBullet">${esc(L('addBullet'))}</span></button></li></ul>`;
}
function renderAbout() {
  const m = S.meta, counts = {}; for (const b of S.businesses) counts[b.cat] = (counts[b.cat] || 0) + 1;
  const group = g => S.categories.map((c, i) => [c, i]).filter(([c]) => (c.group || 'Products') === g).map(([c, i]) => `
    <div class="catbox" style="--c:${c.color}"><h3><span data-path="categories.${i}.name">${esc(c.name)}</span><span class="n">${counts[c.id] || 0} businesses</span></h3>
    ${bulletList(`categories.${i}.bullets`, c.bullets)}
    <div class="row"><button class="mini" data-act="filtercat" data-cat="${esc(c.id)}">Show these</button><button class="mini ed" data-act="editcat" data-cat="${esc(c.id)}">Colour, group or delete…</button></div></div>`).join('');
  $('#pane-about').innerHTML = `<div class="about">
    <p class="line" data-path="meta.line">${esc(m.line)}</p>
    <h2 data-path="meta.insightTitle">${esc(m.insightTitle)}</h2>${bulletList('meta.insight', m.insight)}
    <h2 data-path="meta.goalTitle">${esc(m.goalTitle)}</h2>${bulletList('meta.goal', m.goal)}
    <h2 data-path="meta.productsTitle">${esc(m.productsTitle)}</h2>${group('Products')}
    <h2 data-path="meta.servicesTitle">${esc(m.servicesTitle)}</h2>${group('Services')}
    ${S.categories.some(c => !['Products', 'Services'].includes(c.group || 'Products')) ? `<h2>Other</h2>${S.categories.map((c, i) => [c, i]).filter(([c]) => !['Products', 'Services'].includes(c.group)).map(([c, i]) => `<div class="catbox" style="--c:${c.color}"><h3 data-path="categories.${i}.name">${esc(c.name)}</h3>${bulletList(`categories.${i}.bullets`, c.bullets)}</div>`).join('')}` : ''}
    <div class="row ed" style="margin-top:10px"><button class="btn" data-act="addcat"><span data-label="addCat">${esc(L('addCat'))}</span></button></div>
    <p class="foot" data-path="meta.footer">${esc(m.footer)}</p></div>`;
}
function renderLinks() {
  $('#pane-links').innerHTML = S.connections.length ? S.connections.map((l, i) => {
    const a = bizBy(l.a), b = bizBy(l.b);
    return `<div class="linkcard"><div class="ab">${esc(a ? a.name : '?')} ↔ ${esc(b ? b.name : '?')}</div>
      <div class="meta" style="color:var(--muted);font-size:13px">${esc(a ? a.town : '')} · ${esc(b ? b.town : '')}</div>
      <div data-path="connections.${i}.note">${esc(l.note || '')}</div>
      <div class="row" style="margin-top:6px"><button class="mini" data-act="editlink" data-link="${esc(l.id)}">Edit note</button><button class="mini" data-act="showlink" data-link="${esc(l.id)}">Show on map</button><button class="mini danger" data-act="dellink" data-link="${esc(l.id)}">Remove</button></div></div>`;
  }).join('') : `<div class="empty" data-path="labels.noLinks">${esc(L('noLinks'))}</div>`;
}
function applyEditable() { $$('[data-path]').forEach(el => { el.contentEditable = U.editing ? 'true' : 'false'; if (U.editing) el.spellcheck = true; }); }
function addRelabels() {
  $$('.relabel').forEach(e => e.remove());
  if (!U.editing) return;
  $$('button [data-label], a [data-label]').forEach(sp => { const host = sp.closest('button,a'); if (host.querySelector(':scope > .relabel')) return; const i = document.createElement('i'); i.className = 'relabel'; i.dataset.relabel = sp.dataset.label; i.textContent = '✎'; i.title = 'Rename this button'; host.appendChild(i); });
}
function renderConnectBar() {
  $('.connectbar')?.remove(); if (!U.connectFrom) return;
  const a = bizBy(U.connectFrom); const d = document.createElement('div'); d.className = 'connectbar';
  d.innerHTML = `<span>Connect <b>${esc(a ? a.name : '')}</b> with… tap another business</span><button data-act="cancelconnect">Cancel</button>`; document.body.appendChild(d);
}

/* ---------------- map & globe ---------------- */
const MAX_ZOOM = 19; // street level; vector tiles stop at z14 and are over-zoomed, so nothing goes blank
// Lowest zoom = whole world (map) or whole globe with a margin (globe), worked out from the map's size.
function setZoomLimits() {
  if (!map) return; const c = map.getContainer(); const m = Math.max(120, Math.min(c.clientWidth, c.clientHeight));
  const min = U.globe ? Math.log2(0.8 * m * Math.PI / 512) : Math.log2(Math.max(c.clientWidth, 256) / 512);
  map.setMinZoom(Math.max(-2, +min.toFixed(2))); map.setMaxZoom(MAX_ZOOM);
}
function initMap() {
  if (!window.maplibregl) { $('#mapfail').hidden = false; return; }
  try {
    map = new maplibregl.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron', bounds: [[-8.2, 49.9], [1.8, 58.7]], fitBoundsOptions: { padding: 30 }, attributionControl: { compact: true }, dragRotate: false, maxPitch: 0, minZoom: 0, maxZoom: MAX_ZOOM, renderWorldCopies: true });
    map.on('resize', setZoomLimits); setZoomLimits();
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
    map.touchZoomRotate.disableRotation();
    map.on('style.load', () => {
      tint();
      map.addSource('biz', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addSource('links', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({ id: 'links', type: 'line', source: 'links', paint: { 'line-color': '#8b2e2a', 'line-width': 2.2, 'line-opacity': .75, 'line-dasharray': [2, 1.5] } });
      map.addLayer({ id: 'biz-halo', type: 'circle', source: 'biz', paint: { 'circle-radius': ['case', ['get', 'sel'], 13, 0], 'circle-color': ['get', 'color'], 'circle-opacity': .25 } });
      map.addLayer({ id: 'biz', type: 'circle', source: 'biz', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 3.5, 6, 5.5, 12, 8], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#fffaf0', 'circle-stroke-width': 1.5 } });
      mapReady = true; if (U.globe) map.setProjection({ type: 'globe' }); setZoomLimits(); renderMap();
    });
    map.on('click', 'biz', e => { const f = e.features[0]; if (f) pick(f.properties.id, true); });
    map.on('mouseenter', 'biz', () => (map.getCanvas().style.cursor = 'pointer'));
    map.on('mouseleave', 'biz', () => (map.getCanvas().style.cursor = ''));
    map.on('error', e => { if (!mapReady && /style|fetch/i.test(String(e?.error?.message || ''))) $('#mapfail').hidden = false; });
  } catch (e) { $('#mapfail').hidden = false; }
}
function tint() {
  for (const l of map.getStyle().layers) try {
    if (l.type === 'background') map.setPaintProperty(l.id, 'background-color', '#efe8d8');
    else if (/water/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#cfdcd6');
    else if (/park|wood|landcover/.test(l.id) && l.type === 'fill') map.setPaintProperty(l.id, 'fill-color', '#e4dfc4');
  } catch (e) { }
}
function renderMap() {
  if (!mapReady) return;
  const v = visible();
  map.getSource('biz').setData({ type: 'FeatureCollection', features: v.map(b => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [b.lng, b.lat] }, properties: { id: b.id, color: cat(b.cat).color, sel: U.sel === b.id } })) });
  map.getSource('links').setData({ type: 'FeatureCollection', features: S.connections.map(l => { const a = bizBy(l.a), b = bizBy(l.b); return a && b ? { type: 'Feature', geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] }, properties: {} } : null; }).filter(Boolean) });
}
function fitVisible() {
  if (!mapReady) return; const v = visible(); if (!v.length) return;
  if (U.globe && !U.towns.size) { map.flyTo({ center: [-3, 54.5], zoom: 2.2, duration: 1200 }); return; }
  const b = new maplibregl.LngLatBounds(); v.forEach(x => b.extend([x.lng, x.lat]));
  map.fitBounds(b, { padding: 50, maxZoom: 14, duration: 900 });
}
function setGlobe(on) {
  U.globe = on; $('#btn-globe').setAttribute('aria-pressed', on); $('#btn-map').setAttribute('aria-pressed', !on);
  if (mobile() && U.tab !== 'map') setTab('map');
  if (!mapReady) return;
  setZoomLimits();
  if (on) { map.setProjection({ type: 'globe' }); map.flyTo({ center: [-3, 52], zoom: 1.6, duration: 1500 }); }
  else { map.setProjection({ type: 'mercator' }); U.towns.size ? fitVisible() : map.fitBounds([[-8.2, 49.9], [1.8, 58.7]], { padding: 30, duration: 900 }); }
}
function pick(id, fromMap) {
  if (U.connectFrom) { finishConnect(id); return; }
  U.sel = id; const b = bizBy(id); if (!b) return; renderMap();
  $$('.card.sel').forEach(c => c.classList.remove('sel')); const card = $(`.card[data-id="${CSS.escape(id)}"]`); if (card) card.classList.add('sel');
  if (mapReady) {
    popup?.remove();
    popup = new maplibregl.Popup({ offset: 10, maxWidth: '260px' }).setLngLat([b.lng, b.lat]).setHTML(`<h3>${esc(b.name)}</h3><div class="meta">${esc(b.sub)} · ${esc(b.town)}</div><div style="display:flex;gap:6px;flex-wrap:wrap"><button class="mini" data-act="open" data-id="${esc(b.id)}">Open card</button><button class="mini" data-act="connect" data-id="${esc(b.id)}">↔ ${esc(L('connect'))}</button>${b.url ? `<a class="mini go" href="${esc(b.url)}" target="_blank" rel="noopener">${esc(L('website'))}</a>` : ''}</div>`).addTo(map);
    if (!fromMap) map.flyTo({ center: [b.lng, b.lat], zoom: Math.max(map.getZoom(), 12), duration: 900 });
  }
  if (!fromMap && card && !mobile()) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}
function fitMapBox() { const w = $('.mapwrap'); if (!mobile()) { w.style.height = ''; return; } const top = w.getBoundingClientRect().top + scrollY; const nav = $('.bottomnav').offsetHeight || 60; w.style.height = Math.max(300, innerHeight - top - nav) + 'px'; map && map.resize(); }
addEventListener('resize', () => setTimeout(fitMapBox, 50));
function setTab(t) { U.tab = t; scrollTo(0, 0); setTimeout(fitMapBox, 10); $('.main').dataset.tab = t; $$('.bottomnav button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); if (map) setTimeout(() => map.resize(), 30); }

/* ---------------- connections ---------------- */
function startConnect(id) { U.connectFrom = id; popup?.remove(); renderConnectBar(); toast('Now tap the second business, on the map or in the list'); }
function finishConnect(id) {
  const a = U.connectFrom; U.connectFrom = null; renderConnectBar();
  if (!id || id === a) return;
  if (S.connections.some(c => (c.a === a && c.b === id) || (c.a === id && c.b === a))) { toast('Those two are already connected'); return; }
  const A = bizBy(a), B = bizBy(id);
  dialog(`<h2>Connect</h2><p><b>${esc(A.name)}</b> ↔ <b>${esc(B.name)}</b></p><label>Why connect them? (optional)</label><textarea name="note" rows="3" placeholder="e.g. Their clients need what the other makes"></textarea>
    <div class="btns"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Connect</button></div>`,
    f => { S.connections.push({ id: uid(), a, b: id, note: f.note.value.trim(), created: new Date().toISOString().slice(0, 10) }); commit(); toast('Connected'); return true; });
}

/* ---------------- dialogs ---------------- */
// Every delete/remove/reset goes through askConfirm(); no native browser dialogs.
function askConfirm(title, detail, okLabel) {
  return new Promise(resolve => {
    const d = $('#cfm');
    d.innerHTML = `<form method="dialog" class="cfmform"><h2>${esc(title)}</h2>${detail ? `<p>${esc(detail)}</p>` : ''}<div class="btns"><button type="button" value="cancel" class="btn ghost">Cancel</button><button type="button" value="ok" class="btn del">${esc(okLabel || 'Delete')}</button></div></form>`;
    let done = false;
    const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); finish(false); } else if (e.key === 'Enter') { e.preventDefault(); finish(true); } };
    const finish = v => { if (done) return; done = true; d.removeEventListener('keydown', onKey); d.onclick = null; d.oncancel = null; if (d.open) d.close(); resolve(v); };
    d.addEventListener('keydown', onKey);
    d.oncancel = e => { e.preventDefault(); finish(false); };
    d.onclick = e => { if (e.target === d) { finish(false); return; } const b = e.target.closest('button'); if (b) finish(b.value === 'ok'); };
    d.showModal(); d.querySelector('button[value=cancel]').focus();
  });
}
function dialog(html, onOk, onCancel) {
  const d = $('#dlg'), f = $('#dlgform'); f.innerHTML = html;
  f.onsubmit = async e => { e.preventDefault(); const v = e.submitter && e.submitter.value; if (v === 'cancel') { d.close(); onCancel && onCancel(); return; } const ok = await onOk(f, v); if (ok !== false) d.close(); };
  d.showModal(); const first = f.querySelector('input,textarea,select'); first && first.focus();
}
async function geocode(address, town) {
  const m = String(address).toUpperCase().match(/([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})/);
  if (m) { try { const r = await (await fetch('https://api.postcodes.io/postcodes/' + m[1] + m[2])).json(); if (r.result) return [r.result.latitude, r.result.longitude]; } catch (e) { } }
  try { const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=' + encodeURIComponent(address + ', ' + (town || '')))).json(); if (r[0]) return [+r[0].lat, +r[0].lon]; } catch (e) { }
  const t = S.towns.find(t => t.name === town); return t ? [t.lat, t.lng] : null;
}
async function townCoords(name) {
  try { const r = await (await fetch('https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=gb&q=' + encodeURIComponent(name))).json(); if (r[0]) return [+r[0].lat, +r[0].lon]; } catch (e) { }
  return null;
}
function addBusiness() {
  dialog(`<h2>${esc(L('addBiz').replace(/^\+\s*/, ''))}</h2>
    <label>Name</label><input name="name" required>
    <label>Category</label><select name="cat">${S.categories.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select>
    <label>Type (e.g. Gunmaker)</label><input name="sub">
    <label>Town or city</label><input name="town" list="townlist" required><datalist id="townlist">${S.towns.map(t => `<option>${esc(t.name)}</option>`).join('')}</datalist>
    <label>Address with postcode</label><input name="address">
    <label>Phone</label><input name="phone" type="tel">
    <label>Website</label><input name="url" type="url" placeholder="https://">
    <label>One-line note</label><input name="note">
    <div class="btns"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Add</button></div>`,
    async f => {
      const town = f.town.value.trim(); const ll = await geocode(f.address.value, town) || await townCoords(town);
      if (!ll) { toast('Couldn’t find that place. Add a postcode.'); return false; }
      if (!S.towns.some(t => t.name === town)) S.towns.push({ name: town, lat: ll[0], lng: ll[1] });
      const b = { id: uid(), name: f.name.value.trim(), cat: f.cat.value, sub: f.sub.value.trim(), town, address: f.address.value.trim(), phone: f.phone.value.trim(), url: f.url.value.trim(), note: f.note.value.trim(), lat: +ll[0].toFixed(5), lng: +ll[1].toFixed(5) };
      S.businesses.push(b); commit(); pick(b.id); toast('Added'); return true;
    });
}
function addTown() {
  dialog(`<h2>Add a town</h2><label>Town or city name</label><input name="t" required><div class="btns"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Add</button></div>`,
    async f => { const n = f.t.value.trim(); if (S.towns.some(t => t.name.toLowerCase() === n.toLowerCase())) { toast('Already there'); return true; } const ll = await townCoords(n); if (!ll) { toast('Couldn’t find that town'); return false; } S.towns.push({ name: n, lat: ll[0], lng: ll[1] }); commit(); return true; });
}
function editTown(name) {
  const n = S.businesses.filter(b => b.town === name).length;
  dialog(`<h2>${esc(name)}</h2><label>Rename</label><input name="t" value="${esc(name)}" required>
    <div class="btns"><button value="del" class="btn danger" formnovalidate>Delete town${n ? ` and its ${n} business${n > 1 ? 'es' : ''}` : ''}</button><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Save</button></div>`,
    async (f, v) => {
      if (v === 'del') { if (!await askConfirm(`Delete "${name}"?`, n ? `This also deletes its ${n} business${n > 1 ? 'es' : ''} and their connections.` : '')) return false; const ids = new Set(S.businesses.filter(b => b.town === name).map(b => b.id)); S.businesses = S.businesses.filter(b => !ids.has(b.id)); S.connections = S.connections.filter(c => !ids.has(c.a) && !ids.has(c.b)); S.towns = S.towns.filter(t => t.name !== name); U.towns.delete(name); commit(); return true; }
      const nn = f.t.value.trim(); if (!nn || nn === name) return true; S.towns.find(t => t.name === name).name = nn; S.businesses.forEach(b => { if (b.town === name) b.town = nn; }); if (U.towns.delete(name)) U.towns.add(nn); commit(); return true;
    });
}
function editCat(id) {
  const c = id ? cat(id) : { id: '', name: '', color: '#7a5c3e', group: 'Products', bullets: [] }; const n = S.businesses.filter(b => b.cat === id).length;
  dialog(`<h2>${id ? 'Edit category' : 'New category'}</h2><label>Name</label><input name="name" value="${esc(c.name)}" required>
    <label>Group</label><select name="group">${['Products', 'Services'].map(g => `<option ${c.group === g ? 'selected' : ''}>${g}</option>`).join('')}</select>
    <label>Colour</label><input name="color" type="color" value="${esc(c.color)}">
    <div class="btns">${id ? `<button value="del" class="btn danger" formnovalidate>Delete</button>` : ''}<button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Save</button></div>
    ${id && n ? `<p class="hint">Deleting moves its ${n} businesses to “Other”.</p>` : ''}`,
    async (f, v) => {
      if (v === 'del') {
        if (!await askConfirm(`Delete "${c.name}"?`, n ? `Its ${n} business${n > 1 ? 'es' : ''} will move to “Other”.` : '')) return false;
        if (n) { if (!S.categories.some(x => x.id === 'other')) S.categories.push({ id: 'other', name: 'Other', group: 'Services', color: '#8a8178', bullets: [] }); S.businesses.forEach(b => { if (b.cat === id) b.cat = 'other'; }); }
        S.categories = S.categories.filter(x => x.id !== id || id === 'other' && n); U.cats.delete(id); commit(); return true;
      }
      if (id) { Object.assign(c, { name: f.name.value.trim(), group: f.group.value, color: f.color.value }); }
      else S.categories.push({ id: f.name.value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uid().slice(0, 3), name: f.name.value.trim(), group: f.group.value, color: f.color.value, bullets: [] });
      commit(); return true;
    });
}
function syncDialog() {
  const has = !!localStorage.getItem(LS.key);
  dialog(`<h2>Saving</h2><p>${has ? 'This device is unlocked. Every edit saves automatically to your private save server and appears on your other devices.' : 'This device is not unlocked yet, so edits only save on this device.'}</p>
    <p class="hint">Last saved version: ${REV || '—'}${DIRTY ? ' · some edits are waiting to sync' : ''}</p>
    <div class="btns">${has ? `<button value="lock" class="btn ghost" formnovalidate>Forget passphrase on this device</button><button value="pull" class="btn" formnovalidate>Reload latest</button>` : `<button value="unlock" class="btn primary" formnovalidate>Enter passphrase</button>`}<button value="cancel" class="btn ghost" formnovalidate>Close</button></div>`,
    async (f, v) => { if (v === 'lock') { localStorage.removeItem(LS.key); setStatus('warn', L('offline')); } if (v === 'pull') await pull(true); if (v === 'unlock') setTimeout(() => askUnlock(), 50); return true; });
}

/* ---------------- events ---------------- */
document.addEventListener('click', e => {
  const rl = e.target.closest('[data-relabel]');
  if (rl) { e.preventDefault(); e.stopPropagation(); const k = rl.dataset.relabel; const v = prompt('Button text', L(k)); if (v != null && v.trim()) { S.labels[k] = v.trim(); commit(); } return; }
  if (U.editing && e.target.closest('[contenteditable=true]') && !e.target.closest('a[href]')) return;
  if (U.editing && e.target.closest('a [contenteditable=true]')) { e.preventDefault(); return; }
  const t = e.target.closest('[data-town]'); if (t) { const n = t.dataset.town; if (U.editing && n) { editTown(n); return; } if (!n) U.towns.clear(); else U.towns.has(n) ? U.towns.delete(n) : U.towns.add(n); render(); fitVisible(); return; }
  const c = e.target.closest('[data-cat]:not([data-act])'); if (c) { const id = c.dataset.cat; if (U.editing && id) { editCat(id); return; } if (!id) U.cats.clear(); else U.cats.has(id) ? U.cats.delete(id) : U.cats.add(id); render(); fitVisible(); return; }
  const tb = e.target.closest('[data-tab]'); if (tb && !tb.classList.contains('main')) { setTab(tb.dataset.tab); return; }
  const card = e.target.closest('.card'); const a = e.target.closest('[data-act]');
  if (!a) { if (card && !e.target.closest('a,select,button')) pick(card.dataset.id); if (!e.target.closest('.menuwrap')) $('#menu').hidden = true; return; }
  const act = a.dataset.act, id = a.dataset.id;
  if (a.closest('#menu')) $('#menu').hidden = true;
  switch (act) {
    case 'show': if (mobile()) setTab('map'); setTimeout(() => pick(id), 60); break;
    case 'open': setTab('list'); U.sel = id; render(); setTimeout(() => $(`.card[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60); break;
    case 'connect': U.connectFrom ? finishConnect(id) : startConnect(id); break;
    case 'cancelconnect': U.connectFrom = null; renderConnectBar(); break;
    case 'dellink': { const lid = a.dataset.link, l = S.connections.find(x => x.id === lid); const A = l && bizBy(l.a), B = l && bizBy(l.b); askConfirm(`Delete "${A ? A.name : '?'} ↔ ${B ? B.name : '?'}"?`, 'This removes the connection between them.').then(ok => { if (ok) { S.connections = S.connections.filter(x => x.id !== lid); commit(); } }); break; }
    case 'editlink': { const l = S.connections.find(x => x.id === a.dataset.link); dialog(`<h2>Connection note</h2><textarea name="n" rows="3">${esc(l.note || '')}</textarea><div class="btns"><button value="cancel" class="btn ghost" formnovalidate>Cancel</button><button value="ok" class="btn primary">Save</button></div>`, f => { l.note = f.n.value.trim(); commit(); return true; }); break; }
    case 'showlink': { const l = S.connections.find(x => x.id === a.dataset.link); const A = bizBy(l.a), B = bizBy(l.b); if (mobile()) setTab('map'); if (mapReady && A && B) map.fitBounds([[Math.min(A.lng, B.lng), Math.min(A.lat, B.lat)], [Math.max(A.lng, B.lng), Math.max(A.lat, B.lat)]], { padding: 80, maxZoom: 12 }); break; }
    case 'addbiz': addBusiness(); break;
    case 'delbiz': { const b = bizBy(id); askConfirm(`Delete "${b.name}"?`, 'Its connections are removed too.').then(ok => { if (!ok) return; S.businesses = S.businesses.filter(x => x.id !== id); S.connections = S.connections.filter(l => l.a !== id && l.b !== id); commit(); }); break; }
    case 'relocate': { const b = bizBy(id); geocode(b.address, b.town).then(ll => { if (ll) { b.lat = +ll[0].toFixed(5); b.lng = +ll[1].toFixed(5); commit(); pick(id); toast('Pin moved'); } else toast('Couldn’t find that address'); }); break; }
    case 'addbullet': { const arr = getPath(a.dataset.path2) || []; arr.push('New point'); setPath(a.dataset.path2, arr); commit(); const els = $$(`[data-path^="${a.dataset.path2}."]`); const last = els[els.length - 1]; if (last) { last.focus(); document.getSelection().selectAllChildren(last); } break; }
    case 'delbullet': { const p2 = a.dataset.path2, j = +a.dataset.j, arr = getPath(p2); askConfirm(`Delete "${String(arr[j]).slice(0, 80)}"?`, '').then(ok => { if (ok) { getPath(p2).splice(j, 1); commit(); } }); break; }
    case 'filtercat': U.cats = new Set([a.dataset.cat]); setTab(mobile() ? 'map' : 'list'); render(); fitVisible(); break;
    case 'editcat': editCat(a.dataset.cat); break;
    case 'addcat': editCat(null); break;
    case 'addtown': addTown(); break;
    case 'export': { const blob = new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }); const u = URL.createObjectURL(blob); const x = document.createElement('a'); x.href = u; x.download = `wealth-trade-map-${new Date().toISOString().slice(0, 10)}.json`; document.body.appendChild(x); x.click(); x.remove(); setTimeout(() => URL.revokeObjectURL(u), 2000); break; }
    case 'import': $('#file').click(); break;
    case 'sync': syncDialog(); break;
    case 'reset': askConfirm('Reset to original?', 'All your edits and connections will be replaced with the original list, on every device.', 'Reset').then(ok => ok && fetch('data.original.json', { cache: 'no-store' }).then(r => r.json()).then(d => { S = normalise(d); U.towns.clear(); U.cats.clear(); U.sel = null; commit(); toast('Reset to original'); })); break;
  }
}, true);
document.addEventListener('input', e => {
  const el = e.target;
  if (el.dataset && el.dataset.path && el.isContentEditable) { setPath(el.dataset.path, el.innerText.replace(/\n+$/, '')); commit({ quiet: true }); if (el.closest('header')) document.title = S.meta.title; renderCounts(); }
});
document.addEventListener('keydown', e => { const el = e.target; if (el.isContentEditable && e.key === 'Enter' && !el.classList.contains('note')) { e.preventDefault(); el.blur(); } });
document.addEventListener('focusout', e => { if (e.target.isContentEditable) { setTimeout(() => { if (!document.activeElement?.isContentEditable) render(); }, 150); } });
document.addEventListener('paste', e => { if (e.target.isContentEditable) { e.preventDefault(); document.execCommand('insertText', false, (e.clipboardData || window.clipboardData).getData('text/plain')); } });
document.addEventListener('change', e => {
  const s = e.target;
  if (s.dataset.bizcat) { bizBy(s.dataset.bizcat).cat = s.value; commit(); }
  if (s.dataset.biztown) { const b = bizBy(s.dataset.biztown); if (s.value === '__new') { const n = prompt('New town name'); if (n && n.trim()) { townCoords(n.trim()).then(ll => { if (!S.towns.some(t => t.name === n.trim())) S.towns.push({ name: n.trim(), lat: ll ? ll[0] : b.lat, lng: ll ? ll[1] : b.lng }); b.town = n.trim(); commit(); }); } else render(); } else { b.town = s.value; commit(); } }
  if (s.id === 'file' && s.files[0]) { s.files[0].text().then(t => { try { const d = JSON.parse(t); if (!Array.isArray(d.businesses)) throw 0; askConfirm('Replace everything with this file?', 'Your current businesses and connections will be replaced by the imported ones.', 'Replace').then(ok => { if (ok) { S = normalise(d); commit(); toast('Imported'); } }); } catch (err) { toast('That file isn’t a Wealth Trade Map export'); } s.value = ''; }); }
});
$('#q').addEventListener('input', e => { U.q = e.target.value; renderList(); renderCounts(); applyEditable(); addRelabels(); renderMap(); });
$('#tq').addEventListener('input', e => { U.tq = e.target.value; renderTowns(); addRelabels(); });
$('#btn-map').onclick = () => setGlobe(false);
$('#btn-globe').onclick = () => setGlobe(true);
$('#btn-edit').onclick = () => { U.editing = !U.editing; if (!U.editing) document.activeElement?.blur(); render(); if (U.editing) toast('Edit mode: tap any text to change it'); };
$('#btn-menu').onclick = () => { $('#menu').hidden = !$('#menu').hidden; };
addEventListener('keydown', e => { if (e.key === 'Escape' && U.connectFrom) { U.connectFrom = null; renderConnectBar(); } });
boot();
