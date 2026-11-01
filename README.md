# jomnaik · live bus tracker

**Built by Red-X Corporation (jitu)**

Type a bus number → see where every bus on that route is right now, the route drawn along the real roads, and every stop.
Live **RapidKL** (Klang Valley, Putrajaya), **Rapid Penang** and **Rapid Kuantan** buses on **OpenStreetMap**. No API keys anywhere.

> *Jom naik* = "let's board".

---

## Deploy to Vercel (direct upload, no Git needed)

```bash
npm i -g vercel          # once
cd jomnaik-vercel        # this folder
vercel login             # once
vercel --prod            # uploads the folder and deploys
```

No build step: `public/` is served as static files, `api/*.js` become serverless functions.
`vercel.json` already sets the Singapore region (`sin1`), security headers, CSP and caching; `package.json` pins `node 24.x`.

### Right after deploying, open `/api/health`

It shows whether Vercel's servers can reach each upstream:

| field         | means                                                              |
| ------------- | ------------------------------------------------------------------ |
| `liveBuses`   | the Prasarana live-bus socket, plus which `provider` tags and fields it really uses |
| `kioskRoutes` | the myRapid kiosk page (its bot protection is flaky from server IPs) |

**A bus shows on the kiosk but not here?** Open `/api/health?route=T568` (use your route). It reports how that route
appears in the live feed (exact matches, similar route values and their provider tags, and what a direct route query returns).
That tells you in one look whether the feed names it differently.

## Run locally

```bash
npm install
npm run dev              # http://localhost:4040
```

## How route lines work (no more straight lines)

Priority order, per route:

1. **Official shape from the myRapid kiosk**, when it answers (retried automatically; its bot protection is flaky).
2. **A pre-computed road line** in `public/data/lines/` (see below), served as a static file.
3. **Traced on demand** by `/api/line`: the bundled stop sequence is routed along OpenStreetMap roads with
   [OSRM](https://project-osrm.org), in small chunks, drawn as they arrive and cached at the CDN for 30 days.
4. **Straight between stops**, only if all of the above fail (the app says so in the Stops tab). Short recent bus trails are drawn instead when there's no line at all.

### Pre-compute the lines once (recommended for production)

OSRM's public demo server is meant for light use (about 1 request/second). Tracing on demand is fine for a small site, but the
right production setup is to bake the lines into static files once, from your own computer:

```bash
npm install
npm run lines            # ~10-15 min for all 228 routes; resumable
vercel --prod
```

`npm run lines -- --only 750,T350` does a few routes; `OSRM_URL=https://your-osrm npm run lines` uses your own OSRM server.
Tracing follows the *driving* road network between consecutive stops, so a section on a dual carriageway can occasionally pick the
wrong side or a small detour. Chunks that look implausible are rejected and drawn straight instead.

## Routes and buses

- The route list merges **three sources**: the myRapid kiosk, the bundled GTFS data, and **whatever is broadcasting right now**, so a route is never missing just because one source is down. Kiosk names like `750 (OS)` are matched as `750`.
- Search by **bus number, place, or vehicle plate** (like the kiosk's "Bus" tab). The "Live" filter lists only routes with buses running.
- Buses are matched tolerantly (case-insensitive, `(OS)` suffix ignored, unrecognised provider tags accepted for RapidKL). If the global feed shows nothing for a route, the API asks the feed for that route directly, as the kiosk does. If it's still empty, the screen links to the same route on the official kiosk.

## What's in the box

```
public/                 static site (served by Vercel's CDN)
  index.html            accessible shell + credits dialog
  css/app.css           design tokens, LED board, panel / bottom sheet, dark mode
  js/main.js            state, polling, route merging, road-line loading, URL sync
  js/map.js             Leaflet: OSM tiles, live dots, route line, gliding bus markers, trails
  js/ui.js              search combobox (routes + vehicles), lists, LED board, menus
  js/sheet.js           draggable bottom sheet (phones)
  js/buses.js           age / moving / "near <stop>" derivation
  data/                 228 RapidKL routes + stop sequences (static JSON); data/lines/ after `npm run lines`
  vendor/ fonts/        Leaflet, Figtree, Doto: self-hosted, no third-party CDN
api/
  buses.js              GET /api/buses?provider=RKL&route=750   (route optional)
  routes.js             GET /api/routes?provider=RKL
  shapes.js             GET /api/shapes?provider=RKL&route=<kiosk id>
  line.js               GET /api/line?slug=750&dir=0&part=0     (road tracing, one chunk)
  health.js             GET /api/health[?route=T568]
lib/                    upstream socket client, kiosk scraper, OSRM tracing, cache, validation
scripts/build-data.mjs  regenerates public/data from the GTFS JSON
scripts/build-lines.mjs pre-computes road lines (npm run lines)
```

## Features

- **Network view**: opens on every live bus in the city; tap a dot → "Track route".
- **LED destination board** for the selected route, a buses tab and a **stops timeline with live bus pips** at the nearest stop.
- **Buses glide** between GPS fixes; tap a bus to follow it. "Near *stop*" shown for each bus.
- **Closest stop to you** (location only requested when you tap the locate button).
- **Shareable links**: `/?r=750` (and `&p=RPG` for Penang). Native share sheet on phones.
- Light / dark appearance (dark dims the OpenStreetMap tiles). Phone bottom sheet + desktop side panel.
- Pauses polling while the tab is hidden; backs off when the feed fails; serves a stale snapshot for up to 90 s if upstream hiccups.

## Map tiles: please read

Tiles come straight from OpenStreetMap's own server (`tile.openstreetmap.org`): free, no key. It is run by volunteers, and its
[tile usage policy](https://operations.osmfoundation.org/policies/tiles/) allows light use but **not heavy or commercial-scale traffic**.
That's fine for a community project. If the site gets popular, change `TILES` in `public/js/config.js` (and `img-src` in `vercel.json`)
to a tile host you pay for or run yourself; OpenStreetMap data itself stays free.

## About the data

Live positions come from the same public feed the myRapid bus kiosk uses. It is **unofficial and undocumented**: it can change or block
you without notice. Keep polling modest (the defaults are), and don't present this as an official Prasarana service.

## Refresh the stop data

```bash
npm run data             # fetches the latest GTFS-derived JSON and rewrites public/data (keeps road-line flags)
```

## Credits

See [CREDITS.md](CREDITS.md), also available in the app (ⓘ button).
