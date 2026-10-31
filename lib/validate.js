// Input validation. Everything that reaches upstream URLs or cache keys goes through here,
// so strangers can't blow up the cache or smuggle odd strings into upstream requests.
const PROVIDERS = ['RKL', 'RPG', 'RKN', 'RKL-PUTRAJAYA'];

function provider(v) {
  const p = String(v || 'RKL').trim().toUpperCase();
  return PROVIDERS.includes(p) ? p : null;
}
/** Route *name* as the buses feed reports it, e.g. "750", "T350", "BRT SUNWAY LINE". Empty string = all routes. */
function routeName(v) {
  const r = String(v == null ? '' : v).trim();
  if (r === '') return '';
  return /^[\w .()&\-]{1,40}$/.test(r) ? r : null;
}
/** Kiosk route *id* (numeric). */
function routeId(v) {
  const r = String(v == null ? '' : v).trim();
  return /^\d{1,10}$/.test(r) ? r : null;
}
module.exports = { PROVIDERS, provider, routeName, routeId };
