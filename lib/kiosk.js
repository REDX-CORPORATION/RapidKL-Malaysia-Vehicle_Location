const KIOSK = process.env.KIOSK_BASE || 'https://myrapidbus.prasarana.com.my/kiosk';
const UA = 'jomnaik-tracker/2.0 (+https://github.com/mohdsyahid/rapidkl-malaysia)';

async function fetchKiosk(url) {
  const r = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'accept-language': 'en-MY,en;q=0.9',
      referer: 'https://myrapidbus.prasarana.com.my/',
    },
  });
  if (!r.ok) throw new Error('kiosk responded ' + r.status);
  const html = await r.text();
  // Bot-protection interstitials come back as 200 + a tiny HTML page. Say so, instead of "no routes".
  if (/_Incapsula_Resource|Incapsula incident|hcaptcha|Request unsuccessful/i.test(html) && html.length < 20000) {
    throw new Error('kiosk bot protection blocked this server');
  }
  return html;
}

function parseRouteOptions(html) {
  const out = [];
  const re = /<option value="(\d+)">([^<]+)<\/option>/g;
  let m;
  while ((m = re.exec(html))) { if (m[1]) out.push({ id: m[1], name: m[2].trim() }); }
  const seen = new Set();
  return out.filter((rt) => !seen.has(rt.name) && seen.add(rt.name));
}

function extractGrouped(pattern, html, group = 1) {
  const m = html.match(new RegExp(pattern, 's'));
  return m ? m[group] : null;
}

function safeParse(s) { try { return JSON.parse(s); } catch { return null; } }

async function fetchRoutes(provider) {
  const params = new URLSearchParams();
  if (provider === 'RKL-PUTRAJAYA') params.set('provider', 'RKL-PUTRAJAYA');
  const url = KIOSK + (params.toString() ? '?' + params : '');
  const routes = parseRouteOptions(await fetchKiosk(url));
  if (!routes.length) throw new Error('kiosk returned no routes (layout changed or request blocked)');
  return routes;
}

async function fetchShapes(provider, routeId) {
  const url = KIOSK + '?route=' + encodeURIComponent(routeId) + '&provider=' + encodeURIComponent(provider);
  const html = await fetchKiosk(url);
  const shapesRaw = extractGrouped('\\$\\.parseJSON\\(`(.*?)`\\)', html);
  const latlngsRaw = extractGrouped('var latlngs = \\$\\.parseJSON\\(`(.*?)`\\)', html);
  const bstpRaw = extractGrouped('var bstp = (\\[.*?\\]);', html);
  return {
    shapes: shapesRaw ? safeParse(shapesRaw) || {} : {},
    latlngs: latlngsRaw ? safeParse(latlngsRaw) || {} : {},
    stops: bstpRaw ? safeParse(bstpRaw) || [] : [],
  };
}

module.exports = { fetchRoutes, fetchShapes, KIOSK };
