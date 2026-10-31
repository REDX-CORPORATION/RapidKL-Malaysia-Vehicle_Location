import { parseGps } from './time.js';
import { haversine } from './geo.js';
import { MOVING_KMH, SIGNAL_STALE_S } from './config.js';

const H = 3600e3;
let shiftMs = 0; // set to 8h if the feed turns out to be UTC rather than Malaysia time

/** Median-age check so a wrong timezone guess can never show "8 h ago" on every bus. */
function calibrate(times, now) {
  const ages = times.filter((t) => t != null).map((t) => now - t).sort((a, b) => a - b);
  if (ages.length < 3) return true;
  const med = ages[ages.length >> 1];
  if (med > 7.2 * H && med < 8.8 * H) shiftMs = 8 * H;
  else if (med > -0.5 * H && med < 6 * H) shiftMs = 0;
  const adj = med - shiftMs;
  return adj > -300e3 && adj < 3 * H; // otherwise: don't show ages at all
}

/**
 * Adds derived fields to raw API buses:
 *  age (s) | moving | stale | near { stop, dist, key }   (near only when `stops` given)
 *  stops: [{ lat, lng, name, key }]
 */
export function enrich(list, stops = []) {
  const now = Date.now();
  const times = list.map((b) => parseGps(b.gps));
  const trusted = calibrate(times, now);
  return list.map((b, i) => {
    let age = trusted && times[i] != null ? (now - times[i] - shiftMs) / 1000 : null;
    if (age != null && age < 0) age = 0;
    const moving = b.speed != null && b.speed >= MOVING_KMH;
    const stale = age != null && age > SIGNAL_STALE_S;
    let near = null;
    if (stops.length) {
      let best = null;
      for (const s of stops) {
        const d = haversine(b.lat, b.lng, s.lat, s.lng);
        if (!best || d < best.d) best = { stop: s, d };
      }
      if (best && best.d < 900) near = { stop: best.stop, dist: best.d, key: best.stop.key };
    }
    return { ...b, age, moving, stale, near };
  });
}
