const { fetchBuses } = require('../lib/upstream');
const { remember } = require('../lib/cache');
const v = require('../lib/validate');

const TTL_MS = 4000;      // one upstream socket per provider per 4s, no matter how many viewers
const STALE_MS = 90000;   // if upstream hiccups, keep serving the last good snapshot for up to 90s
const OTHER_PROVIDERS = new Set(v.PROVIDERS.filter((p) => p !== 'RKL'));

/**
 * Does this bus belong to the provider being viewed?
 * Exact match, or no tag at all. For RKL we also accept tags we don't recognise: feeder / shuttle fleets
 * (T-routes) are shown by the kiosk under RapidKL but may carry their own tag in the feed.
 */
function belongs(b, provider) {
  const p = b.provider == null ? '' : String(b.provider);
  if (!p || p === provider) return true;
  return provider === 'RKL' && !OTHER_PROVIDERS.has(p);
}

// Only what the app needs. (Driver/captain IDs are intentionally not forwarded.)
function pick(k, b) {
  const lat = Number(b.latitude), lng = Number(b.longitude);
  if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) return null;
  return {
    id: String(b.bus_no || k),
    route: b.route == null ? '' : String(b.route),
    dir: b.dir == null ? null : b.dir,
    lat: Math.round(lat * 1e5) / 1e5,
    lng: Math.round(lng * 1e5) / 1e5,
    speed: b.speed == null ? null : Number(b.speed),
    gps: b.dt_gps || null,
    acc: !!b.accessibility,
  };
}
function pickAll(raw, provider) {
  const list = [];
  for (const k in raw) {
    const b = raw[k];
    if (!b || typeof b !== 'object' || !belongs(b, provider)) continue;
    const p = pick(k, b);
    if (p) list.push(p);
  }
  return list;
}

/**
 * Fallback for a route the global feed shows nothing for: ask the feed for that route directly,
 * the way the myRapid kiosk does (its `bus=t568` parameter). Cached briefly, including "nothing".
 */
async function askForRoute(provider, route) {
  const want = v.normRoute(route);
  const { value } = await remember(`rq:${provider}:${want}`, 10000, async () => {
    for (const r of [...new Set([route, want.toLowerCase()])]) {
      const raw = await fetchBuses(provider, 3000, r);
      if (!raw) continue;
      const list = pickAll(raw, provider).filter((b) => v.normRoute(b.route) === want);
      if (list.length) return list;
    }
    return [];
  });
  return value;
}

module.exports = async function handler(req, res) {
  const provider = v.provider(req.query.provider);
  const route = v.routeName(req.query.route);
  if (!provider) return res.status(400).json({ error: 'unknown provider' });
  if (route === null) return res.status(400).json({ error: 'invalid route' });

  let snap;
  try {
    snap = await remember('buses:' + provider, TTL_MS, async () => {
      const raw = await fetchBuses(provider);
      if (!raw) throw new Error('upstream did not respond');
      return { ts: Date.now(), list: pickAll(raw, provider) };
    }, STALE_MS);
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: e.message });
  }

  const { ts, list } = snap.value;
  const want = v.normRoute(route);
  let buses = route ? list.filter((b) => v.normRoute(b.route) === want) : list;
  let via = 'feed';
  if (route && !buses.length && !snap.stale) {
    try { const extra = await askForRoute(provider, route); if (extra.length) { buses = extra; via = 'route'; } } catch (_) { /* keep empty */ }
  }
  res.setHeader('cache-control', snap.stale ? 'no-store' : 'public, s-maxage=4, stale-while-revalidate=8');
  res.status(200).json({ ts, provider, route, count: buses.length, stale: snap.stale, via, buses });
};
