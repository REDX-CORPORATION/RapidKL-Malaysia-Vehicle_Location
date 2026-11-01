const enc = encodeURIComponent;

function withTimeout(signal, ms) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(new DOMException('timeout', 'TimeoutError')), ms);
  if (signal) {
    if (signal.aborted) c.abort(signal.reason);
    else signal.addEventListener('abort', () => c.abort(signal.reason), { once: true });
  }
  return { signal: c.signal, done: () => clearTimeout(t) };
}

async function getJSON(url, { signal, timeout = 9000 } = {}) {
  const k = withTimeout(signal, timeout);
  try {
    const r = await fetch(url, { signal: k.signal, headers: { accept: 'application/json' } });
    if (!r.ok) throw Object.assign(new Error('HTTP ' + r.status), { status: r.status });
    return await r.json();
  } finally { k.done(); }
}

// ---- live (serverless functions) ----
export const buses = (provider, route, signal) =>
  getJSON(`/api/buses?provider=${enc(provider)}&route=${enc(route || '')}`, { signal, timeout: 8000 });
export const kioskRoutes = (provider) => getJSON(`/api/routes?provider=${enc(provider)}`, { timeout: 10000 });
export const kioskShapes = (provider, id) => getJSON(`/api/shapes?provider=${enc(provider)}&route=${enc(id)}`, { timeout: 12000 });

// ---- static, CDN-cached snapshot of the published GTFS stop sequences ----
let indexPromise = null;
export function routeIndex() {
  if (!indexPromise) indexPromise = getJSON('/data/index.json').catch((e) => { indexPromise = null; throw e; });
  return indexPromise;
}
const metaCache = new Map();
export function routeMeta(slug) {
  if (!metaCache.has(slug)) {
    metaCache.set(slug, getJSON(`/data/routes/${enc(slug)}.json`).catch((e) => { metaCache.delete(slug); throw e; }));
  }
  return metaCache.get(slug);
}

// ---- road-following lines ----
/** One chunk of a traced line. src = { slug } or { provider, id }. */
export function line(src, dir, part, signal) {
  const q = src.slug ? `slug=${enc(src.slug)}` : `provider=${enc(src.provider)}&id=${enc(src.id)}`;
  return getJSON(`/api/line?${q}&dir=${dir}&part=${part}`, { signal, timeout: 12000 });
}
/** Pre-computed lines (npm run lines). */
export const staticLine = (slug) => getJSON(`/data/lines/${enc(slug)}.json`);
