const { fetchBuses } = require('../lib/upstream');
const { remember } = require('../lib/cache');
const v = require('../lib/validate');

const TTL_MS = 4000;      // one upstream socket per provider per 4s, no matter how many viewers
const STALE_MS = 90000;   // if upstream hiccups, keep serving the last good snapshot for up to 90s

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
      const list = [];
      for (const k in raw) {
        const b = raw[k];
        if (!b || b.provider !== provider) continue;
        const p = pick(k, b);
        if (p) list.push(p);
      }
      return { ts: Date.now(), list };
    }, STALE_MS);
  } catch (e) {
    res.setHeader('cache-control', 'no-store');
    return res.status(502).json({ error: e.message });
  }

  const { ts, list } = snap.value;
  const buses = route ? list.filter((b) => b.route === route) : list;
  res.setHeader('cache-control', snap.stale ? 'no-store' : 'public, s-maxage=4, stale-while-revalidate=8');
  res.status(200).json({ ts, provider, route, count: buses.length, stale: snap.stale, buses });
};
