# jomnaik · live bus tracker

**Built by Red-X Corporation (jitu)**

Type a bus number → see where every bus on that route is right now, the route line, and every stop.
Live **RapidKL** (Klang Valley, Putrajaya), **Rapid Penang** and **Rapid Kuantan** buses on a free OpenStreetMap-based map.

> *Jom naik* = "let's board".

---

## Deploy to Vercel (direct upload, no Git needed)

```bash
npm i -g vercel          # once
cd jomnaik-vercel        # this folder
vercel login             # once
vercel --prod            # uploads the folder and deploys
```

That's it. There is **no build step**: `public/` is served as static files, `api/*.js` become serverless functions.
Settings are already in `vercel.json` (Singapore region `sin1`, security headers, CSP, caching) and `package.json` (`node 24.x`).

**Right after the first deploy, open `https://YOUR-APP.vercel.app/api/health`.** It tells you whether Vercel's servers can reach:

| field          | means                                                   |
| -------------- | ------------------------------------------------------- |
| `liveBuses`    | the Prasarana live-bus socket (needed for bus positions) |
| `kioskRoutes`  | the myRapid kiosk page (route ids + road-following lines) |

If `kioskRoutes` fails (the kiosk uses bot protection and may block datacenter IPs) the app **still works**: it falls back to the bundled route list, stop sequences and a stop-to-stop line. Only the road-accurate line is lost.
If `liveBuses` fails, try another region by editing `"regions"` in `vercel.json` (e.g. `"hkg1"`), then redeploy.

## Run locally

```bash
npm install
npm run dev              # http://localhost:4040
```

## What's in the box

```
public/                 static site (served by Vercel's CDN)
  index.html            accessible shell + credits dialog
  css/app.css           design tokens, LED board, panel / bottom sheet, dark mode
  js/main.js            state, polling, URL sync, orchestration
  js/map.js             Leaflet: tiles, live dots, route line, gliding bus markers
  js/ui.js              search combobox, lists, LED board, menus
  js/sheet.js           draggable bottom sheet (phones)
  js/buses.js           age / moving / "near <stop>" derivation
  data/                 228 RapidKL routes + stop sequences (static JSON)
  vendor/ fonts/        Leaflet, Figtree, Doto: self-hosted, no third-party CDN
api/
  buses.js              GET /api/buses?provider=RKL&route=750   (route optional)
  routes.js             GET /api/routes?provider=RKL
  shapes.js             GET /api/shapes?provider=RKL&route=<kiosk id>
  health.js             GET /api/health
lib/                    upstream socket client, kiosk scraper, cache, validation
scripts/build-data.mjs  regenerates public/data from the GTFS JSON
```

## Features

- **Network view**: opens on every live bus in the city; tap a dot → "Track route".
- **Search by number or place** (`750`, `t35`, `pasar seni`), keyboard friendly, recent routes remembered.
- **LED destination board** for the selected route, plus a buses tab and a **stops timeline with live bus pips** at the nearest stop.
- **Buses glide** between GPS fixes; tap a bus to follow it. "Near *stop*" shown for each bus.
- **Closest stop to you** (location only requested when you tap the locate button).
- **Shareable links**: `/?r=750` (and `&p=RPG` for Penang). Native share sheet on phones.
- Light / dark / OpenStreetMap-standard map styles. Phone bottom sheet + desktop side panel.
- Pauses polling while the tab is hidden; backs off when the feed fails; serves a stale snapshot for up to 90 s if upstream hiccups.

## Changes from the v2 demo

- Every request is validated (provider whitelist, route patterns) so the cache can't be flooded.
- **One upstream socket per provider per 4 s**, shared by every viewer and route (the demo opened one per route).
- Errors are never cached by the CDN (the demo could cache a failed shapes call for an hour).
- `captain_id` (driver identifier) is no longer sent to browsers; `trip_rev_kind` is dropped because its meaning isn't documented. Re-add in `api/buses.js` → `pick()` if you need them.
- The kiosk's `latlngs` polygons aren't drawn (their meaning isn't documented).
- `engines.node` pinned to `24.x` (Node 20 was disabled on Vercel on 1 Oct 2026).

## Refresh the stop data

```bash
npm run data             # fetches the latest GTFS-derived JSON and rewrites public/data
```

## Map tiles: please read

Default light/dark tiles are CARTO basemaps (built on OpenStreetMap data), with the standard OSM tile server as an option in the map-style menu. Both are free but **neither is meant for unlimited commercial traffic**; see the
[OSM tile usage policy](https://operations.osmfoundation.org/policies/tiles/) and [CARTO's terms](https://carto.com/attributions). If the site gets popular, switch `TILES` in `public/js/config.js` (and the `img-src` in `vercel.json`) to a hosted provider such as MapTiler or Stadia, or self-host tiles.

## About the data

Live positions come from the same public feed the myRapid bus kiosk uses. It is **unofficial and undocumented**: it can change or block you without notice. Keep polling modest (the defaults are), and don't present this as an official Prasarana service.

## Credits

See [CREDITS.md](CREDITS.md), also available in the app (ⓘ button).
