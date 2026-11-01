#!/usr/bin/env node
/**
 * Pre-computes road-following lines for every bundled route, so production serves static files
 * and never has to call a routing server at runtime.
 *
 *   npm run lines                       # all routes (takes ~10-15 min: OSRM's demo server wants <= 1 request/s)
 *   npm run lines -- --only 750,T350    # just these
 *   npm run lines -- --force            # redo routes that already have a line file
 *   OSRM_URL=https://your-osrm npm run lines      # use your own OSRM server (then it's fast)
 *
 * Routing: OSRM (project-osrm.org) over OpenStreetMap data © OpenStreetMap contributors (ODbL).
 */
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const roads = require('../lib/roads.js');
const __dirname = dirname(fileURLToPath(import.meta.url));
const PUB = join(__dirname, '..', 'public', 'data');
const args = process.argv.slice(2);
const force = args.includes('--force');
const onlyIdx = args.indexOf('--only');
const only = onlyIdx > -1 ? new Set(args[onlyIdx + 1].split(',').map((s) => s.trim().toUpperCase())) : null;
const exists = (f) => access(f).then(() => true, () => false);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function snapRetry(pts) {
  for (let i = 0; i < 4; i++) {
    try { return await roads.snap(pts); }
    catch (e) { if (i === 3) { console.warn('   ! giving up on one chunk:', e.message); return undefined; } await sleep(1500 * (i + 1)); }
  }
}

const index = JSON.parse(await readFile(join(PUB, 'index.json'), 'utf8'));
await mkdir(join(PUB, 'lines'), { recursive: true });
let done = 0, skipped = 0, partial = 0;
const todo = index.routes.filter((r) => !only || only.has(r.n.toUpperCase()));
console.log(`${todo.length} routes. OSRM: ${process.env.OSRM_URL || 'https://router.project-osrm.org'}`);

for (const [i, r] of todo.entries()) {
  const out = join(PUB, 'lines', r.f + '.json');
  if (!force && (await exists(out))) { r.ln = 1; skipped++; continue; }
  const meta = JSON.parse(await readFile(join(PUB, 'routes', r.f + '.json'), 'utf8'));
  const dirs = [];
  let bad = 0;
  for (const d of meta.d) {
    const stops = d.s.map((s) => [s[2], s[3]]);
    let line = [];
    for (let p = 0; p < roads.partCount(stops.length); p++) {
      const pts = roads.partStops(stops, p);
      const seg = await snapRetry(pts);
      if (!seg) bad++;
      const use = seg || pts; // straight chunk if tracing failed or looked wrong
      line = line.concat(line.length ? use.slice(1) : use);
    }
    dirs.push(line);
  }
  await writeFile(out, JSON.stringify({ d: dirs }));
  if (bad) partial++; else r.ln = 1; // only flag fully traced routes; partial ones fall back to live tracing
  done++;
  console.log(`[${i + 1}/${todo.length}] ${r.n}: ${dirs.map((l) => l.length + ' pts').join(' + ')}${bad ? `  (${bad} chunk(s) kept straight)` : ''}`);
}
await writeFile(join(PUB, 'index.json'), JSON.stringify(index));
console.log(`\ndone: ${done} new, ${skipped} already present, ${partial} partially traced. Now deploy: vercel --prod`);
