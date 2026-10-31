/*
 * jomnaik · Built by Red-X Corporation (jitu)
 * Orchestrates: data (api.js) -> state -> map (map.js) + panel (ui.js) + sheet (sheet.js)
 */
import { PROVIDERS, HAS_STATIC, POLL_NETWORK_MS, POLL_ROUTE_MS } from './config.js';
import * as api from './api.js';
import { createMap } from './map.js';
import { createUI } from './ui.js';
import { createSheet } from './sheet.js';
import { enrich } from './buses.js';
import { compareRoutes, splitStopName } from './format.js';
import { haversine, nearest } from './geo.js';
import { ago } from './time.js';
import { $ } from './dom.js';

console.info('%cjomnaik%c Built by Red-X Corporation (jitu)', 'background:#17110a;color:#ffb21a;padding:2px 8px;border-radius:4px;font-weight:800', 'color:inherit');

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem('jomnaik:' + k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('jomnaik:' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const S = {
  provider: 'RKL',
  routes: [], byName: new Map(), staticMeta: new Map(),
  route: null, detail: null, activeDir: 0,
  buses: [], netCount: null, selectedId: null, following: null,
  lastTs: 0, stale: false, failures: 0,
  styleKey: 'auto', user: null,
};

// ─────────────────────────── wiring ───────────────────────────
const panel = $('#panel');
let sheet, mc, ui;

sheet = createSheet(panel, {
  grab: $('#grab'), dragZones: [$('#grab'), $('#head-home'), $('#head-route')],
  anchor: () => $('#led'),
});

mc = createMap($('#map'), {
  getInsets: () => {
    if (sheet.isDesktop()) return { left: Math.round(panel.getBoundingClientRect().right) + 12, top: 64, right: 70, bottom: 30 };
    return { left: 12, right: 64, top: 64, bottom: sheet.visible };
  },
  onBusTap: (id) => pickBus(id),
  onStopTap: (s) => { mc.focusStop(s); if (ui.tab === 'stops') ui.scrollToStop(s.key); },
  onTrackRoute: (name) => selectRoute(S.byName.get(name) || { name }),
  onFollowEnd: () => { S.following = null; renderBusPane(); },
});

ui = createUI({
  onPick: (r) => selectRoute(r),
  onBack: () => leaveRoute(),
  onShare: share,
  onRegion: (code) => setProvider(code),
  onStyle: (k) => applyStyle(k),
  onLocate: locate,
  onZoom: (d) => (d > 0 ? mc.zoomIn() : mc.zoomOut()),
  onBusPick: (id) => pickBus(id),
  onStopPick: (s) => { mc.focusStop(s); },
  onDir: (i) => { S.activeDir = i; renderStopsPane(); },
  onTab: (t) => { if (t === 'stops') renderStopsPane(); },
  onSearchFocus: () => { if (!sheet.isDesktop()) sheet.snap('full'); },
  onSearchBlur: (hasQuery) => { if (!sheet.isDesktop() && !hasQuery) sheet.snap(S.route ? 'half' : 'peek'); },
  onMenuOpen: () => { if (!sheet.isDesktop() && sheet.state === 'peek') sheet.snap('half'); },
});

// ─────────────────────────── theme / basemap ───────────────────────────
const darkQuery = matchMedia('(prefers-color-scheme: dark)');
function applyStyle(key, { persist = true } = {}) {
  S.styleKey = key;
  ui.setStyleKey(key);
  const dark = key === 'dark' || ((key === 'auto' || key === 'osm') && darkQuery.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.style = key;
  mc.setBase(key === 'osm' ? 'osm' : dark ? 'dark' : 'light');
  mc.restyle();
  if (persist) { try { localStorage.setItem('jomnaik:style', key); } catch { /* private mode */ } }
}
darkQuery.addEventListener('change', () => { if (S.styleKey !== 'light' && S.styleKey !== 'dark') applyStyle(S.styleKey, { persist: false }); });

// ─────────────────────────── home LED ───────────────────────────
function setHomeLed() {
  const n = S.netCount;
  const region = PROVIDERS[S.provider].name.toUpperCase();
  const down = n == null && S.failures >= 2;
  ui.setLed({
    no: n == null ? '--' : String(n),
    text: down ? 'LIVE DATA UNAVAILABLE - RETRYING' : n == null ? 'CONNECTING TO LIVE BUSES' : `${n === 1 ? 'BUS' : 'BUSES'} LIVE IN ${region} - TYPE A BUS NUMBER TO TRACK IT`,
    label: down ? 'Live data unavailable' : n == null ? 'Connecting to live buses' : `${n} buses live in ${PROVIDERS[S.provider].name}`,
    off: n === 0,
  });
}

// ─────────────────────────── routes list ───────────────────────────
let routesToken = 0;
async function loadRoutes(code) {
  const token = ++routesToken;
  ui.setRoutesLoading();
  const statP = HAS_STATIC.has(code) ? api.routeIndex().catch(() => null) : Promise.resolve(null);
  const kioskP = api.kioskRoutes(code).catch(() => null);

  // The bundled index is fast (CDN). Apply it first so a shared link shows its stops immediately.
  statP.then((idx) => {
    if (token !== routesToken || !idx) return;
    S.staticMeta = new Map(idx.routes.map((m) => [m.n, m]));
    upgradeRoute();
  });

  const [idx, kio] = await Promise.all([statP, kioskP]);
  if (token !== routesToken) return;
  S.staticMeta = new Map(idx ? idx.routes.map((m) => [m.n, m]) : []);

  const kioskList = kio && kio.routes ? kio.routes : [];
  let list;
  let note = '';
  if (kioskList.length) {
    list = kioskList.map((k) => fromMeta({ name: k.name, id: k.id }));
  } else if (S.staticMeta.size) {
    list = [...S.staticMeta.keys()].map((n) => fromMeta({ name: n }));
    note = 'Showing the published route list. Live route lines may be unavailable right now.';
  } else {
    list = [];
    note = 'Couldn’t load the route list. You can still type a bus number and press Enter.';
  }
  list.sort((a, b) => compareRoutes(a.name, b.name));
  S.routes = list;
  S.byName = new Map(list.map((r) => [r.name, r]));
  ui.setRoutes(list, { note });
  renderRecent();
  upgradeRoute();
}

/** A route opened from a shared link starts as just {name}. Fill in label / stops / kiosk id as they arrive. */
function upgradeRoute() {
  if (!S.route) return;
  const merged = fromMeta(S.byName.get(S.route.name) || S.route);
  const changed = merged.id !== S.route.id || merged.slug !== S.route.slug;
  S.route = merged;
  if (!changed) return;
  ui.setRouteHeader(merged, { dest: destOf(merged, S.detail), buses: S.buses.length || null, stopCount: headerStops(S.detail) });
  loadDetail(merged, routeToken);
}
function fromMeta(r) {
  const m = S.staticMeta.get(r.name);
  return { ...r, label: m ? m.l : '', kind: m ? m.k : undefined, slug: m ? m.f : undefined, s: m ? m.s : undefined };
}

function renderRecent() {
  const items = store.get('recent', []).filter((x) => x.p === S.provider).map((x) => S.byName.get(x.n) || { name: x.n });
  ui.renderRecent(items);
}
function remember(r) {
  const next = [{ p: S.provider, n: r.name }, ...store.get('recent', []).filter((x) => !(x.p === S.provider && x.n === r.name))].slice(0, 12);
  store.set('recent', next);
  renderRecent();
}

// ─────────────────────────── provider ───────────────────────────
async function setProvider(code, { fly = true, push = true } = {}) {
  if (!PROVIDERS[code]) code = 'RKL';
  S.provider = code;
  S.netCount = null;
  ui.setRegion(code);
  resetRouteState();
  ui.setMode(false);
  setHomeLed();
  if (fly) mc.goTo(PROVIDERS[code].center, PROVIDERS[code].zoom);
  if (!sheet.isDesktop()) sheet.snap('peek');
  startPolling();
  if (push) replaceURL();
  await loadRoutes(code);
}

function resetRouteState() {
  S.route = null; S.detail = null; S.buses = []; S.selectedId = null; S.following = null; S.activeDir = 0; S.lastTs = 0; S.fitted = false;
  mc.clearRoute(); mc.clearBuses(); mc.clearNetwork(); mc.stopFollow();
  ui.clearBuses();
}

// ─────────────────────────── route selection ───────────────────────────
let routeToken = 0;
async function selectRoute(r0, { push = true } = {}) {
  let r = S.byName.get(r0.name) || r0;
  if (!r.slug && S.staticMeta.has(r.name)) r = fromMeta(r);
  const token = ++routeToken;

  resetRouteState();
  S.route = r;
  ui.setMode(true);
  ui.setRouteHeader(r, { dest: destOf(r, null), buses: null, stopCount: null });
  ui.setTab('buses');
  ui.setCounts({ buses: 0, stops: 0 });
  ui.showBusEmpty('loading', r.name);
  ui.renderStops([], 0, { note: 'Loading stops…' });
  ui.setNearYou(null);
  if (!sheet.isDesktop()) sheet.snap('half');
  remember(r);
  if (push) pushURL();
  startPolling();
  loadDetail(r, token);
}

function leaveRoute({ push = true } = {}) {
  resetRouteState();
  ui.setMode(false);
  setHomeLed();
  mc.goTo(PROVIDERS[S.provider].center, PROVIDERS[S.provider].zoom);
  if (!sheet.isDesktop()) sheet.snap('peek');
  startPolling();
  if (push) pushURL();
}

async function loadDetail(r, token) {
  const [meta, kiosk] = await Promise.allSettled([
    r.slug ? api.routeMeta(r.slug) : Promise.reject(new Error('no bundled stops')),
    r.id ? api.kioskShapes(S.provider, r.id) : Promise.reject(new Error('no kiosk id')),
  ]);
  if (token !== routeToken) return;
  const detail = buildDetail(meta.status === 'fulfilled' ? meta.value : null, kiosk.status === 'fulfilled' ? kiosk.value : null);
  S.detail = detail;

  if (detail.lines.length || detail.mapStops.length) {
    const bounds = mc.showRoute({ lines: detail.lines, stops: detail.mapStops });
    if (!S.fitted) { mc.fit(bounds); S.fitted = true; }
  }
  ui.setCounts({ stops: detail.dirs[0] ? detail.dirs[0].stops.length : r.s || 0 });
  ui.setRouteHeader(r, { dest: destOf(r, detail), buses: S.buses.length, stopCount: headerStops(detail) });
  renderStopsPane();
  if (S.buses.length) onBuses(S.buses.map(stripDerived), null); // re-derive "near …" now that stops exist
}
const headerStops = (d) => (d && d.dirs.length === 1 ? d.dirs[0].stops.length : null);
const stripDerived = ({ age, moving, stale, near, ...b }) => b;

function destOf(r, detail) {
  const head = detail && detail.dirs[0] && detail.dirs[0].h;
  if (head) return head;
  if (r.label) { const p = r.label.split('~'); return p[p.length - 1].trim(); }
  return '';
}

// ── build a unified route detail from whatever data we managed to get ──
function toLine(arr) {
  const pts = [];
  for (const p of arr) {
    let lat, lng;
    if (Array.isArray(p)) { lat = +p[0]; lng = +p[1]; }
    else if (p && typeof p === 'object') { lat = +(p.lat ?? p.latitude); lng = +(p.lng ?? p.lon ?? p.longitude); }
    if (isFinite(lat) && isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) pts.push([lat, lng]);
  }
  return pts.length > 1 ? pts : null;
}
function looksLikePoints(a) {
  const p = a[0];
  if (Array.isArray(p)) return p.length >= 2 && !Array.isArray(p[0]) && typeof p[0] !== 'object';
  return !!p && typeof p === 'object' && ('lat' in p || 'latitude' in p);
}
function collectLines(v, out = []) {
  if (!v) return out;
  if (Array.isArray(v)) {
    if (v.length && looksLikePoints(v)) { const l = toLine(v); if (l) out.push(l); }
    else v.forEach((x) => collectLines(x, out));
  } else if (typeof v === 'object') Object.values(v).forEach((x) => collectLines(x, out));
  return out;
}
function kioskStops(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((s) => {
    const lat = +(s.lat ?? s.latitude), lng = +(s.lng ?? s.lon ?? s.longitude);
    if (!isFinite(lat) || !isFinite(lng)) return null;
    const { code, name } = splitStopName(s.stop_name || s.name || '');
    return { name: name || 'Bus stop', code, lat, lng, dr: s.dr == null ? '' : String(s.dr) };
  }).filter(Boolean);
}

function buildDetail(meta, kiosk) {
  const dirs = [];
  if (meta && meta.d) {
    meta.d.forEach((d, i) => dirs.push({
      h: d.h, label: d.h ? `To ${d.h}` : meta.d.length > 1 ? `Direction ${i + 1}` : 'Stops',
      stops: d.s.map((s, j) => ({ code: s[0], name: s[1], lat: s[2], lng: s[3], key: `${i}:${j}` })),
    }));
  }
  const ks = kioskStops(kiosk && kiosk.stops);
  let note = '';
  if (!dirs.length && ks.length) {
    const groups = new Map();
    ks.forEach((s) => { if (!groups.has(s.dr)) groups.set(s.dr, []); groups.get(s.dr).push(s); });
    [...groups.entries()].forEach(([dr, arr], i) => dirs.push({
      h: null, label: groups.size > 1 ? `Direction ${dr || i + 1}` : 'Stops',
      stops: arr.map((s, j) => ({ ...s, key: `${i}:${j}` })),
    }));
    note = 'Stops as reported by the myRapid kiosk.';
  } else if (dirs.length) {
    note = dirs.length === 1 ? 'Stop sequence from published timetable data. Some routes use different stops on the return trip.' : 'Stop sequences from published timetable data.';
  }

  const lines = collectLines(kiosk && kiosk.shapes);
  if (!lines.length) dirs.forEach((d) => { const l = toLine(d.stops.map((s) => [s.lat, s.lng])); if (l) lines.push(l); });

  const mapStops = [];
  dirs.forEach((d) => d.stops.forEach((s, i) => mapStops.push({ ...s, end: i === 0 || i === d.stops.length - 1 })));
  // opposite-direction stops the kiosk knows about but the bundled sequence doesn't
  if (meta && ks.length) {
    const own = dirs.flatMap((d) => d.stops);
    ks.forEach((k) => { if (!own.some((s) => haversine(s.lat, s.lng, k.lat, k.lng) < 30)) mapStops.push({ ...k, key: 'x:' + mapStops.length, extra: true }); });
  }
  const flat = dirs.flatMap((d) => d.stops);
  return { dirs, lines, mapStops, flat, note };
}

// ─────────────────────────── panes ───────────────────────────
function renderStopsPane() {
  const d = S.detail;
  if (!d) return;
  ui.renderStops(d.dirs, S.activeDir, { note: d.dirs.length ? d.note : 'The stop list isn’t available for this route right now.' });
  ui.setCounts({ stops: d.dirs[S.activeDir] ? d.dirs[S.activeDir].stops.length : 0 });
  updatePips();
  updateNearYou();
}
function renderBusPane() {
  if (!S.route) return;
  ui.renderBuses(S.buses, { selectedId: S.selectedId, following: S.following });
}
function updatePips() {
  const byKey = new Map();
  for (const b of S.buses) if (b.near) { if (!byKey.has(b.near.key)) byKey.set(b.near.key, []); byKey.get(b.near.key).push(b); }
  ui.updatePips(byKey);
}
function updateNearYou() {
  const d = S.detail;
  if (!S.user || !d || !d.dirs[S.activeDir]) return ui.setNearYou(null);
  const stops = d.dirs[S.activeDir].stops;
  const n = nearest(stops, S.user.lat, S.user.lng);
  ui.setNearYou(n && n.d < 4000 ? { stop: stops[n.i], dist: n.d } : null);
}

// ─────────────────────────── buses ───────────────────────────
function onBuses(raw, meta) {
  if (meta) { S.lastTs = meta.ts; S.stale = !!meta.stale; }
  const list = enrich(raw, S.route && S.detail ? S.detail.flat : []);
  S.buses = list;
  if (S.route) {
    mc.updateBuses(list);
    if (S.selectedId && !list.some((b) => b.id === S.selectedId)) { S.selectedId = null; S.following = null; mc.setSelected(null); }
    renderBusPane();
    ui.showBusEmpty(list.length ? null : 'none', S.route.name);
    ui.setCounts({ buses: list.length });
    ui.setRouteHeader(S.route, { dest: destOf(S.route, S.detail), buses: list.length, stopCount: headerStops(S.detail) });
    updatePips();
    if (!S.detail && list.length && !mc.map.getBounds().contains(L.latLng(list[0].lat, list[0].lng))) {
      mc.fit(L.latLngBounds(list.map((b) => [b.lat, b.lng])));
    }
  } else {
    S.netCount = list.length;
    mc.setNetwork(list);
    setHomeLed();
  }
  refreshStatus();
}

function pickBus(id) {
  if (!S.route) return;
  if (S.selectedId === id) { // second tap: let go
    S.selectedId = null; S.following = null; mc.setSelected(null); mc.stopFollow(); renderBusPane(); return;
  }
  S.selectedId = id; S.following = id;
  ui.setTab('buses');
  if (!sheet.isDesktop() && sheet.state === 'full') sheet.snap('half');
  mc.flyToBus(id, { follow: true });
  renderBusPane();
}

// ─────────────────────────── polling ───────────────────────────
let gen = 0, timer = 0, ctrl = null;
function startPolling() {
  gen++;
  if (ctrl) ctrl.abort();
  clearTimeout(timer);
  S.failures = 0;
  if (document.hidden) { refreshStatus(); return; }
  tick();
}
async function tick() {
  const g = gen;
  ctrl = new AbortController();
  try {
    const data = await api.buses(S.provider, S.route ? S.route.name : '', ctrl.signal);
    if (g !== gen) return;
    S.failures = 0;
    onBuses(data.buses || [], data);
  } catch (e) {
    if (g !== gen) return;
    S.failures++;
    if (S.route && !S.buses.length) ui.showBusEmpty('error', S.route.name);
    if (!S.route) setHomeLed();
    refreshStatus();
  }
  if (g === gen) {
    const base = S.route ? POLL_ROUTE_MS : POLL_NETWORK_MS;
    timer = setTimeout(tick, S.failures ? Math.min(30000, 3000 * 2 ** S.failures) : base);
  }
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { gen++; if (ctrl) ctrl.abort(); clearTimeout(timer); refreshStatus(); }
  else startPolling();
});

function refreshStatus() {
  if (document.hidden) return ui.setStatus('paused', 'Paused while this tab is in the background');
  if (S.failures >= 2) return ui.setStatus('offline', 'Can’t reach live data · retrying');
  if (!S.lastTs) return ui.setStatus('loading', 'Connecting…');
  const n = S.route ? S.buses.length : S.netCount;
  const age = Math.max(0, (Date.now() - S.lastTs) / 1000);
  if (S.stale || age > 90) return ui.setStatus('offline', `Live data delayed · updated ${ago(age)}`);
  const count = n == null ? '' : `${n.toLocaleString('en-MY')} ${n === 1 ? 'bus' : 'buses'} · `;
  ui.setStatus('live', `${count}updated ${age < 10 ? 'just now' : ago(age)}`);
}
setInterval(refreshStatus, 1000);

// ─────────────────────────── share / locate ───────────────────────────
async function share() {
  if (!S.route) return;
  const url = location.href;
  if (navigator.share) {
    try { await navigator.share({ title: `Route ${S.route.name} on jomnaik`, text: `Where’s the ${S.route.name}? Live on jomnaik.`, url }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); ui.toast('Link copied'); } catch { ui.toast(url); }
}

async function locate() {
  try {
    ui.toast('Finding you…');
    const me = await mc.locate();
    S.user = me;
    mc.goTo([me.lat, me.lng], 15);
    updateNearYou();
    ui.toast('You are here');
  } catch (e) {
    ui.toast(e && e.code === 1 ? 'Location is blocked. Allow it in your browser settings to find nearby stops.' : 'Couldn’t get your location. Try again outdoors.');
  }
}

// ─────────────────────────── URL state ───────────────────────────
function urlFor() {
  const p = new URLSearchParams();
  if (S.provider !== 'RKL') p.set('p', S.provider);
  if (S.route) p.set('r', S.route.name);
  const q = p.toString();
  return location.pathname + (q ? '?' + q : '');
}
const pushURL = () => { if (urlFor() !== location.pathname + location.search) history.pushState(null, '', urlFor()); };
const replaceURL = () => history.replaceState(null, '', urlFor());

async function applyURL({ first = false } = {}) {
  const q = new URLSearchParams(location.search);
  const p = (q.get('p') || 'RKL').toUpperCase();
  const r = (q.get('r') || '').trim();
  let pending = null;
  if (first || p !== S.provider) pending = setProvider(PROVIDERS[p] ? p : 'RKL', { fly: !r, push: false });
  if (r && r.length <= 40 && /^[\w .()&-]+$/.test(r) && (!S.route || S.route.name !== r)) selectRoute(S.byName.get(r) || { name: r }, { push: false });
  else if (!r && S.route) leaveRoute({ push: false });
  if (pending) await pending;
}
addEventListener('popstate', () => applyURL());

// ─────────────────────────── boot ───────────────────────────
let savedStyle = 'auto';
try { savedStyle = localStorage.getItem('jomnaik:style') || 'auto'; } catch { /* private mode */ }
applyStyle(['auto', 'light', 'dark', 'osm'].includes(savedStyle) ? savedStyle : 'auto', { persist: false });
sheet.snap('peek', { silent: true });
document.fonts?.ready.then(() => sheet.refresh());
setHomeLed();
applyURL({ first: true }).then(() => {
  mc.map.invalidateSize();
});
