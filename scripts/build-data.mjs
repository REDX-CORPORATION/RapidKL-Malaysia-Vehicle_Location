#!/usr/bin/env node
/**
 * Builds the static route index + per-route stop sequences that ship in /public/data.
 *
 * Source: RapidKL GTFS static (Prasarana, via data.gov.my), pre-joined by
 *         github.com/mohdsyahid/rapidkl-malaysia (MIT).
 *
 *   node scripts/build-data.mjs                 # fetch latest from the repo's GitHub Pages
 *   node scripts/build-data.mjs --from ./dir    # use local copies of bus-kl.json / bus-mrtfeeder.json
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { titleCase, splitStopName, slugify, compareRoutes } from '../public/js/format.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, '..', 'public', 'data');
const REMOTE = process.env.GTFS_JSON_BASE || 'https://mohdsyahid.github.io/rapidkl-malaysia/data';
const fromIdx = process.argv.indexOf('--from');
const FROM = fromIdx > -1 ? process.argv[fromIdx + 1] : null;

async function load(file) {
  if (FROM) return JSON.parse(await readFile(join(FROM, file), 'utf8'));
  const r = await fetch(`${REMOTE}/${file}`, { headers: { 'user-agent': 'jomnaik-build/1.0' } });
  if (!r.ok) throw new Error(`${file}: HTTP ${r.status}`);
  return r.json();
}

const r5 = (n) => Math.round(Number(n) * 1e5) / 1e5;

function convert(route, kind) {
  const name = String(route.shortName || route.longName || '').trim();
  if (!name) return null;
  const dirs = (route.directions || [])
    .filter((d) => d.stops && d.stops.length > 1)
    .map((d) => ({
      h: d.headsign ? titleCase(d.headsign) : null,
      s: d.stops
        .filter((s) => isFinite(s.lat) && isFinite(s.lon))
        .map((s) => {
          const { code, name: nm } = splitStopName(s.name);
          return [code, nm, r5(s.lat), r5(s.lon), s.stopId];
        }),
    }));
  if (!dirs.length) return null;
  let label = route.longName && route.longName.trim() !== name ? route.longName.trim() : '';
  if (!label && dirs[0].h) label = dirs[0].h;
  return { name, label: titleCase(label), kind, dirs };
}

const [kl, feeder] = await Promise.all([load('bus-kl.json'), load('bus-mrtfeeder.json')]);
const all = [
  ...kl.routes.map((r) => convert(r, /^B\d|LINE$/i.test(r.routeId + r.shortName) ? 'brt' : 'city')),
  ...feeder.routes.map((r) => convert(r, 'feeder')),
].filter(Boolean);

const seen = new Map();
const slugs = new Set();
for (const r of all) {
  if (seen.has(r.name)) { console.warn('duplicate route name skipped:', r.name); continue; }
  let slug = slugify(r.name), i = 2;
  while (slugs.has(slug)) slug = slugify(r.name) + '-' + i++;
  slugs.add(slug);
  r.slug = slug;
  seen.set(r.name, r);
}

await rm(join(OUT, 'routes'), { recursive: true, force: true });
await mkdir(join(OUT, 'routes'), { recursive: true });

const routes = [...seen.values()].sort((a, b) => compareRoutes(a.name, b.name));
for (const r of routes) {
  await writeFile(join(OUT, 'routes', r.slug + '.json'), JSON.stringify({ n: r.name, l: r.label, d: r.dirs }));
}
const index = {
  v: 1,
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: kl.generatedAt || null,
  source: 'RapidKL GTFS static (Prasarana) via data.gov.my; pre-joined by mohdsyahid/rapidkl-malaysia (MIT)',
  routes: routes.map((r) => ({ n: r.name, l: r.label, k: r.kind, f: r.slug, s: r.dirs.reduce((a, d) => Math.max(a, d.s.length), 0) })),
};
await writeFile(join(OUT, 'index.json'), JSON.stringify(index));
console.log(`wrote ${routes.length} routes (city+brt: ${routes.filter((r) => r.kind !== 'feeder').length}, feeder: ${routes.filter((r) => r.kind === 'feeder').length})`);
