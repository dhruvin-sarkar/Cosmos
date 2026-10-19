#!/usr/bin/env node
/**
 * Spacecraft trajectories from the JPL Horizons API (https://ssd-api.jpl.nasa.gov/doc/horizons.html), whole missions.
 *
 *   node scripts/data/smallbodies/craft-tracks.mjs [--only id,id]
 *
 * For every craft: geometric state vectors (position + velocity, ICRF axes, km and km/s, JD TDB) relative to a centre body
 * chosen so the interpolation is accurate where it matters (Juno around Jupiter, Cassini around Saturn, DART around Didymos,
 * JWST around Earth, the rest around the Sun). Pipeline:
 *   1. coarse pass at a fixed step (chunked under the API's 90k-line limit; coverage trimmed to what Horizons has);
 *   2. refinement: every coarse interval whose velocity vector turns by more than REFINE_RAD (planet flybys, perijoves,
 *      perihelia) is re-fetched at a fine step;
 *   3. greedy decimation: keep the fewest samples such that cubic Hermite interpolation with the true velocities reproduces
 *      every dropped sample within the craft's tolerance (km).
 * Output: public/data/smallbodies/craft-tracks.json (state vectors) and src/domains/smallbodies/craft.generated.json
 * (bundled mission metadata, no vectors).
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT_TRACKS = resolve(ROOT, 'public/data/smallbodies/craft-tracks.json');
const OUT_META = resolve(ROOT, 'src/domains/smallbodies/craft.generated.json');
const API = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const MAX_LINES = 80000;
const REFINE_RAD = 0.12;
const FINE_TURN_RAD = 0.02;
/** Non-solar velocity change (km/s) per coarse step that triggers refinement of heliocentric tracks. */
const RESID_KMS = 0.03;
const GM_SUN = 1.32712440018e11;

/** Horizons centre codes. */
const CENTERS = { sun: '500@10', earth: '500@399', jupiter: '500@599', saturn: '500@699', didymos: '500@20065803' };
/** Hermite tolerance per centre, km. */
const TOL = { sun: 20, earth: 2, jupiter: 5, saturn: 5, didymos: 0.005 };

const CRAFT = [
  { id: 'voyager-1', name: 'Voyager 1', naif: -31, center: 'sun', start: '1977-09-06', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / JPL', launchDateUTC: '1977-09-05', status: 'Operating in interstellar space (crossed the heliopause 2012)', summary: 'Farthest human-made object; flybys of Jupiter (March 1979) and Saturn and Titan (November 1980).' } },
  { id: 'voyager-2', name: 'Voyager 2', naif: -32, center: 'sun', start: '1977-08-21', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / JPL', launchDateUTC: '1977-08-20', status: 'Operating in interstellar space (crossed the heliopause 2018)', summary: 'The only spacecraft to visit all four giant planets: Jupiter 1979, Saturn 1981, Uranus 1986, Neptune 1989.' } },
  { id: 'new-horizons', name: 'New Horizons', naif: -98, center: 'sun', start: '2006-01-20', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / JHU-APL', launchDateUTC: '2006-01-19', status: 'Extended mission in the Kuiper Belt', summary: 'First flyby of Pluto and Charon (14 July 2015) and of the Kuiper-belt object Arrokoth (1 January 2019).' } },
  { id: 'parker-solar-probe', name: 'Parker Solar Probe', naif: -96, center: 'sun', start: '2018-08-13', stop: '2030-12-31', stepH: 1,
    mission: { agency: 'NASA / JHU-APL', launchDateUTC: '2018-08-12', status: 'Operating; perihelia at about 9.86 solar radii', summary: 'Flies through the Sun’s outer corona; the fastest human-made object (~190 km/s at perihelion).' } },
  { id: 'juno', name: 'Juno', naif: -61, center: 'jupiter', start: '2011-08-06', stop: '2030-12-31', stepH: 2,
    mission: { agency: 'NASA / JPL', launchDateUTC: '2011-08-05', status: 'Jupiter polar orbiter (extended mission)', summary: 'Solar-powered polar orbiter of Jupiter since 4 July 2016, mapping its gravity, magnetic field, aurorae and deep atmosphere; close flybys of Ganymede, Europa and Io.' } },
  { id: 'europa-clipper', name: 'Europa Clipper', naif: -159, center: 'sun', start: '2024-10-15', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / JPL', launchDateUTC: '2024-10-14', status: 'Cruise to Jupiter (Mars flyby March 2025, Earth flyby December 2026; arrival April 2030)', summary: 'Will make about 50 close flybys of Jupiter’s moon Europa to assess whether its ocean could support life.' } },
  { id: 'psyche', name: 'Psyche', naif: -255, center: 'sun', start: '2023-10-14', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / JPL', launchDateUTC: '2023-10-13', status: 'Cruise to (16) Psyche (Mars gravity assist May 2026; arrival 2029)', summary: 'First mission to a metal-rich asteroid, using solar-electric Hall-effect thrusters.' } },
  { id: 'lucy', name: 'Lucy', naif: -49, center: 'sun', start: '2021-10-17', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'NASA / SwRI', launchDateUTC: '2021-10-16', status: 'Cruise to the Jupiter Trojans (Donaldjohanson flyby April 2025)', summary: 'Twelve-year tour of eight asteroids, most of them Jupiter Trojans.' } },
  { id: 'hera', name: 'Hera', naif: -91, center: 'sun', start: '2024-10-08', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'ESA', launchDateUTC: '2024-10-07', status: 'Arriving at Didymos (planned late 2026)', summary: 'Planetary-defence follow-up to DART: measures Dimorphos’ mass and the crater DART left.' } },
  { id: 'juice', name: 'JUICE', naif: -28, center: 'sun', start: '2023-04-15', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'ESA', launchDateUTC: '2023-04-14', status: 'Cruise to Jupiter (arrival July 2031)', summary: 'JUpiter ICy moons Explorer: Europa, Callisto and Ganymede flybys, then orbit Ganymede.' } },
  { id: 'bepicolombo', name: 'BepiColombo', naif: -121, center: 'sun', start: '2018-10-21', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'ESA / JAXA', launchDateUTC: '2018-10-20', status: 'Arriving at Mercury (orbit insertion planned November 2026)', summary: 'Two orbiters (ESA’s MPO and JAXA’s Mio) travelling together on the Mercury Transfer Module.' } },
  { id: 'solar-orbiter', name: 'Solar Orbiter', naif: -144, center: 'sun', start: '2020-02-11', stop: '2030-12-31', stepH: 6,
    mission: { agency: 'ESA / NASA', launchDateUTC: '2020-02-10', status: 'Operating; Venus flybys tilt its orbit to view the Sun’s poles', summary: 'Close-up images of the Sun from as near as 0.28 au and the first views of its polar regions.' } },
  { id: 'jwst', name: 'James Webb Space Telescope', naif: -170, center: 'earth', start: '2021-12-26', stop: '2030-12-31', stepH: 12,
    mission: { agency: 'NASA / ESA / CSA', launchDateUTC: '2021-12-25', status: 'Operating on a halo orbit around Sun–Earth L2', summary: 'The largest infrared space telescope: a 6.5 m segmented gold-coated beryllium mirror behind a five-layer sunshield.' } },
  { id: 'cassini', name: 'Cassini', naif: -82, center: 'saturn', start: '1997-10-16', stop: '2017-09-15 10:30', stepH: 6, historic: true,
    mission: { agency: 'NASA / ESA / ASI', launchDateUTC: '1997-10-15', status: 'Mission ended 15 September 2017 (deliberate plunge into Saturn)', summary: 'Thirteen years in orbit around Saturn (2004–2017); released ESA’s Huygens probe, which landed on Titan in January 2005.' } },
  { id: 'dart', name: 'DART', naif: -135, center: 'didymos', start: '2021-11-24 08:00', stop: '2022-09-26 23:15:33', stepH: 6, historic: true,
    mission: { agency: 'NASA / JHU-APL', launchDateUTC: '2021-11-24', status: 'Mission ended 26 September 2022 23:14 UTC (impact on Dimorphos)', summary: 'The first planetary-defence test: a 580 kg spacecraft struck Dimorphos at 6.1 km/s and shortened its orbit around Didymos by 33 minutes.' } },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };

function jdOf(iso) {
  const [d, t = '00:00'] = iso.trim().split(/[ T]/);
  const [y, m, dd] = d.split('-').map(Number);
  const [hh, mm, ss = 0] = t.split(':').map(Number);
  return Date.UTC(y, m - 1, dd, hh, mm, 0) / 86400000 + 2440587.5 + ss / 86400;
}
function isoOfJd(jd) {
  return new Date((jd - 2440587.5) * 86400000).toISOString().replace('T', ' ').slice(0, 19);
}

async function horizons(params) {
  const q = new URLSearchParams({ format: 'json', EPHEM_TYPE: 'VECTORS', VEC_TABLE: '2', OUT_UNITS: 'KM-S', REF_PLANE: 'FRAME', REF_SYSTEM: 'ICRF', VEC_CORR: 'NONE', CSV_FORMAT: 'YES', OBJ_DATA: 'NO', ...params });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const r = await fetch(`${API}?${q}`);
      if (r.status === 503 || r.status === 429) { await sleep(3000 * (attempt + 1)); continue; }
      const j = await r.json();
      return j.result ?? j.error ?? '';
    } catch (e) {
      if (attempt === 3) throw e;
      await sleep(2000);
    }
  }
  return '';
}

/** Rows {jd, p:[3], v:[3]} or {limit: {kind, jd}} when the request leaves the ephemeris coverage. */
function parse(text) {
  const a = text.indexOf('$$SOE'), b = text.indexOf('$$EOE');
  if (a < 0 || b < 0) {
    const m = /(prior to|after) A\.D\. (\d{4})-(\w{3})-(\d{2}) (\d{2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?/.exec(text);
    if (m) {
      const iso = `${m[2]}-${String(MONTHS[m[3].toUpperCase()]).padStart(2, '0')}-${m[4]} ${m[5]}:${m[6]}:${m[7] ?? '00'}`;
      return { limit: { kind: m[1] === 'after' ? 'end' : 'start', jd: jdOf(iso) } };
    }
    throw new Error(`Horizons: ${text.slice(0, 600)}`);
  }
  const rows = [];
  for (const line of text.slice(a + 5, b).split('\n')) {
    const c = line.split(',').map((s) => s.trim());
    if (c.length < 8 || !c[0]) continue;
    const n = [c[0], c[2], c[3], c[4], c[5], c[6], c[7]].map(Number);
    if (n.some((x) => !Number.isFinite(x))) continue;
    rows.push({ jd: n[0], p: [n[1], n[2], n[3]], v: [n[4], n[5], n[6]] });
  }
  return { rows };
}

/** Fetch [jd0, jd1] at `stepMin` minutes, chunked; trims the window to the ephemeris coverage. */
async function fetchRange(c, jd0, jd1, stepMin) {
  const out = [];
  let s = jd0;
  const chunk = (MAX_LINES * stepMin) / 1440;
  let guard = 0;
  while (s < jd1 - 1e-9 && guard++ < 200) {
    const e = Math.min(s + chunk, jd1);
    const res = parse(await horizons({ COMMAND: `'${c.naif}'`, CENTER: `'${CENTERS[c.center]}'`, START_TIME: `'JD ${s.toFixed(6)}'`, STOP_TIME: `'JD ${e.toFixed(6)}'`, STEP_SIZE: `'${stepMin} m'` }));
    if (res.limit) {
      if (res.limit.kind === 'start') { s = res.limit.jd + 1 / 1440; continue; }
      if (res.limit.jd <= s) break;
      jd1 = Math.min(jd1, res.limit.jd - 1 / 86400);
      continue;
    }
    for (const r of res.rows) out.push(r);
    s = e;
  }
  return out;
}

const angle = (a, b) => {
  const d = Math.hypot(...a) * Math.hypot(...b);
  return d > 0 ? Math.acos(Math.min(Math.max((a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / d, -1), 1)) : 0;
};

function hermite(r0, r1, jd) {
  const h = (r1.jd - r0.jd) * 86400;
  const t = (jd - r0.jd) / (r1.jd - r0.jd);
  const t2 = t * t, t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
  return [0, 1, 2].map((k) => h00 * r0.p[k] + h10 * h * r0.v[k] + h01 * r1.p[k] + h11 * h * r1.v[k]);
}

function decimate(rows, tol) {
  const keep = [0];
  let i = 0;
  const ok = (a, b) => {
    for (let k = a + 1; k < b; k++) {
      const q = hermite(rows[a], rows[b], rows[k].jd);
      if (Math.hypot(q[0] - rows[k].p[0], q[1] - rows[k].p[1], q[2] - rows[k].p[2]) > tol) return false;
    }
    return true;
  };
  while (i < rows.length - 1) {
    let lo = i + 1, step = 1;
    // Exponential search, then binary search for the farthest acceptable j.
    while (lo + step < rows.length && ok(i, lo + step)) { lo += step; step *= 2; }
    let hi = Math.min(lo + step, rows.length - 1);
    if (hi > lo && ok(i, hi)) lo = hi;
    else {
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        if (ok(i, mid)) lo = mid; else hi = mid;
      }
    }
    keep.push(lo);
    i = lo;
  }
  return keep.map((k) => rows[k]);
}

async function build(c) {
  const t0 = Date.now();
  let jd0 = jdOf(c.start), jd1 = jdOf(c.stop);
  const coarse = await fetchRange(c, jd0, jd1, c.stepH * 60);
  if (coarse.length < 2) throw new Error(`${c.id}: no data`);
  // Close the coarse grid exactly at the requested (or delivered) end.
  const tail = await fetchRange(c, Math.max(coarse[coarse.length - 1].jd + 1 / 1440, jd1 - 2 / 1440), jd1, 1);
  coarse.push(...tail.filter((r) => r.jd > coarse[coarse.length - 1].jd + 1e-7));
  // Refinement windows.
  const windows = [];
  for (let i = 0; i < coarse.length - 1; i++) {
    const span = coarse[i + 1].jd - coarse[i].jd;
    let stepMin;
    if (c.center === 'sun') {
      // Heliocentric: refine where the velocity change departs from solar gravity alone (planet flybys).
      const r0 = coarse[i], r1 = coarse[i + 1];
      const m = [0, 1, 2].map((k) => (r0.p[k] + r1.p[k]) / 2);
      const rm = Math.hypot(...m), dt = span * 86400;
      const resid = Math.hypot(...[0, 1, 2].map((k) => r1.v[k] - r0.v[k] + (GM_SUN * m[k] * dt) / (rm * rm * rm)));
      const turn = angle(r0.v, r1.v);
      if (resid < RESID_KMS && turn < REFINE_RAD) continue;
      stepMin = Math.max(1, Math.floor(Math.min((span * 1440 * RESID_KMS * 0.5) / Math.max(resid, 1e-9), (span * 1440 * FINE_TURN_RAD) / Math.max(turn, 1e-9))));
    } else {
      const turn = angle(coarse[i].v, coarse[i + 1].v);
      if (turn < REFINE_RAD) continue;
      stepMin = Math.max(1, Math.floor(((span * 1440) * FINE_TURN_RAD) / turn));
    }
    if (stepMin >= span * 1440) continue;
    const last = windows[windows.length - 1];
    if (last && coarse[i].jd - last.b < 1e-6) { last.b = coarse[i + 1].jd; last.step = Math.min(last.step, stepMin); }
    else windows.push({ a: coarse[i].jd, b: coarse[i + 1].jd, step: stepMin });
  }
  let fineCount = 0;
  const fine = [];
  const POOL = 4;
  for (let w = 0; w < windows.length; w += POOL) {
    const batch = windows.slice(w, w + POOL).filter((x) => (fineCount += ((x.b - x.a) * 1440) / x.step) < 400000);
    const res = await Promise.all(batch.map((x) => fetchRange(c, x.a, x.b, x.step)));
    for (const r of res) for (const x of r) fine.push(x);
  }
  const all = [...coarse, ...fine].sort((a, b) => a.jd - b.jd).filter((r, i, arr) => i === 0 || r.jd - arr[i - 1].jd > 1e-7);
  const kept = decimate(all, TOL[c.center]);
  const first = kept[0].jd, lastJd = kept[kept.length - 1].jd;
  const round = c.center === 'didymos' ? 1e5 : c.center === 'sun' ? 10 : 100;
  const rv = 1e6;
  console.log(`${c.id}: coarse ${coarse.length}, windows ${windows.length}, fine ${fine.length}, kept ${kept.length} (${((Date.now() - t0) / 1000).toFixed(0)} s) ${isoOfJd(first)} → ${isoOfJd(lastJd)}`);
  return {
    track: {
      id: c.id, naifId: c.naif, centerId: c.center, t0: first,
      t: kept.map((r) => Math.round((r.jd - first) * 1e8) / 1e8),
      p: kept.flatMap((r) => r.p.map((x) => Math.round(x * round) / round)),
      v: kept.flatMap((r) => r.v.map((x) => Math.round(x * rv) / rv)),
    },
    meta: {
      id: c.id, name: c.name, naifId: c.naif, centerId: c.center, frame: 'ICRF', units: 'km', timeScale: 'TDB (JD)',
      startJD: first, endJD: lastJd, samples: kept.length, historic: !!c.historic,
      coverage: { requested: [c.start, c.stop], delivered: [isoOfJd(first).slice(0, 16), isoOfJd(lastJd).slice(0, 16)], trimmed: lastJd < jd1 - 0.01 },
      mission: c.mission,
      source: `JPL Horizons API, COMMAND=${c.naif}, CENTER=${CENTERS[c.center]}, EPHEM_TYPE=VECTORS, VEC_TABLE=2, REF_SYSTEM=ICRF, REF_PLANE=FRAME`,
      retrieved: new Date().toISOString(),
    },
  };
}

const onlyArg = process.argv.indexOf('--only');
const only = onlyArg > 0 ? new Set(process.argv[onlyArg + 1].split(',')) : null;
let prevTracks = { craft: [] }, prevMeta = { craft: [] };
try { prevTracks = JSON.parse(readFileSync(OUT_TRACKS, 'utf8')); } catch { /* first run */ }
try { prevMeta = JSON.parse(readFileSync(OUT_META, 'utf8')); } catch { /* first run */ }
const tracks = new Map(prevTracks.craft.map((t) => [t.id, t]));
const metas = new Map(prevMeta.craft.filter((m) => m.endJD !== undefined).map((m) => [m.id, m]));
for (const c of CRAFT) {
  if (only && !only.has(c.id)) continue;
  try {
    const r = await build(c);
    tracks.set(c.id, r.track);
    metas.set(c.id, r.meta);
  } catch (e) {
    console.error(`${c.id}: FAILED ${e.message}`);
  }
}
const order = CRAFT.map((c) => c.id);
const sortById = (a, b) => order.indexOf(a.id) - order.indexOf(b.id);
const retrieved = new Date().toISOString();
mkdirSync(dirname(OUT_TRACKS), { recursive: true });
writeFileSync(OUT_TRACKS, JSON.stringify({
  schemaVersion: 2, generated: retrieved, source: 'JPL Horizons API (ssd.jpl.nasa.gov/api/horizons.api)',
  notes: 'Per craft: t = JD(TDB) offsets in days from t0; p = flat [x,y,z,...] km; v = flat [vx,vy,vz,...] km/s; ICRF axes, relative to centerId (sun 500@10, earth 500@399, jupiter 500@599, saturn 500@699, didymos 500@20065803). Non-uniform samples kept by greedy decimation so cubic Hermite interpolation with these velocities reproduces the Horizons states within a per-centre tolerance (sun 20 km, earth 2 km, jupiter/saturn 5 km, didymos 5 m).',
  craft: [...tracks.values()].sort(sortById),
}));
writeFileSync(OUT_META, JSON.stringify({ retrieved, craft: [...metas.values()].sort(sortById) }, null, 1) + '\n');
console.log('wrote', OUT_TRACKS, OUT_META);
