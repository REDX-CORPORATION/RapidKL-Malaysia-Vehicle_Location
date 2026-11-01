// Open /api/health after deploying to see which upstreams this Vercel region can actually reach.
// Add ?route=T568 to see how that route appears in the live feed (handy when a bus shows on the kiosk but not here).
const { fetchBuses } = require('../lib/upstream');
const { fetchRoutes } = require('../lib/kiosk');
const { remember } = require('../lib/cache');
const v = require('../lib/validate');

const count = (arr) => arr.reduce((m, k) => (m.set(k, (m.get(k) || 0) + 1), m), new Map());
const top = (m, n) => Object.fromEntries([...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n));

async function probe(route) {
  const t0 = Date.now();
  const out = { time: new Date().toISOString(), region: process.env.VERCEL_REGION || 'local', node: process.version };
  try {
    const raw = await fetchBuses('RKL', 5000);
    if (!raw) out.liveBuses = { ok: false, error: 'no data (timeout or blocked)' };
    else {
      const buses = Object.values(raw).filter((b) => b && typeof b === 'object');
      out.liveBuses = {
        ok: true, count: buses.length,
        providers: top(count(buses.map((b) => String(b.provider))), 10),
        routeValues: Object.keys(top(count(buses.map((b) => String(b.route))), 400)).length,
        fields: buses[0] ? Object.keys(buses[0]) : [],
      };
      if (route) {
        const want = v.normRoute(route);
        const core = want.replace(/[^A-Z0-9]/g, '').replace(/^[A-Z]+/, '') || want; // "T568" -> "568"
        const similar = buses.filter((b) => String(b.route).toUpperCase().includes(core));
        const exact = buses.filter((b) => v.normRoute(b.route) === want);
        out.routeCheck = {
          asked: route, normalised: want, exactMatches: exact.length,
          similarRouteValues: top(count(similar.map((b) => JSON.stringify(String(b.route)) + ' / provider ' + JSON.stringify(String(b.provider)))), 15),
        };
        try {
          const rq = await fetchBuses('RKL', 4000, route);
          out.routeCheck.routeQuery = rq ? { returned: Object.keys(rq).length, matching: Object.values(rq).filter((b) => b && v.normRoute(b.route) === want).length } : 'no data';
        } catch (e) { out.routeCheck.routeQuery = e.message; }
      }
    }
  } catch (e) { out.liveBuses = { ok: false, error: e.message }; }
  try {
    const r = await fetchRoutes('RKL');
    out.kioskRoutes = { ok: true, count: r.length, hasRoute: route ? r.some((x) => v.normRoute(x.name) === v.normRoute(route)) : undefined };
  } catch (e) { out.kioskRoutes = { ok: false, error: e.message }; }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = async function handler(req, res) {
  const route = v.routeName(req.query.route);
  if (route === null) return res.status(400).json({ error: 'invalid route' });
  const { value } = await remember('health:' + v.normRoute(route), 30000, () => probe(route));
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(value);
};
