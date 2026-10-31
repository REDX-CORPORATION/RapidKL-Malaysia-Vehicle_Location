// Open /api/health after deploying to see which upstreams this Vercel region can actually reach.
const { fetchBuses } = require('../lib/upstream');
const { fetchRoutes } = require('../lib/kiosk');
const { remember } = require('../lib/cache');

async function probe() {
  const t0 = Date.now();
  const out = { time: new Date().toISOString(), region: process.env.VERCEL_REGION || 'local', node: process.version };
  try {
    const raw = await fetchBuses('RKL', 5000);
    out.liveBuses = raw ? { ok: true, count: Object.keys(raw).length } : { ok: false, error: 'no data (timeout or blocked)' };
  } catch (e) { out.liveBuses = { ok: false, error: e.message }; }
  try {
    const r = await fetchRoutes('RKL');
    out.kioskRoutes = { ok: true, count: r.length };
  } catch (e) { out.kioskRoutes = { ok: false, error: e.message }; }
  out.ms = Date.now() - t0;
  return out;
}

module.exports = async function handler(req, res) {
  const { value } = await remember('health', 30000, probe);
  res.setHeader('cache-control', 'no-store');
  res.status(200).json(value);
};
