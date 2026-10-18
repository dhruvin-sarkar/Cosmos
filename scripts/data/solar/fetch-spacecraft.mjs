// JPL Horizons API -> public/data/solar/spacecraft.json (position tracks, ICRF/J2000 equatorial, km)
import { fetchCached, qs, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, OUT_DIR, log, assert, num, DataError } from './lib.mjs';

const URL_ = 'https://ssd.jpl.nasa.gov/api/horizons.api';
const START = '2025-01-01', STOP = '2030-12-31';
// [id, name, naifId, center, stepDays, mission]
const CRAFT = [
  ['voyager-1', 'Voyager 1', -31, 'sun', 5, { agency: 'NASA', launchDateUTC: '1977-09-05', status: 'Operating in interstellar space (crossed the heliopause 2012)', summary: 'Farthest human-made object; Grand Tour flybys of Jupiter (1979) and Saturn (1980).' }],
  ['voyager-2', 'Voyager 2', -32, 'sun', 5, { agency: 'NASA', launchDateUTC: '1977-08-20', status: 'Operating in interstellar space (crossed the heliopause 2018)', summary: 'Only spacecraft to visit Uranus (1986) and Neptune (1989).' }],
  ['new-horizons', 'New Horizons', -98, 'sun', 5, { agency: 'NASA', launchDateUTC: '2006-01-19', status: 'Extended mission in the Kuiper Belt', summary: 'Pluto flyby July 2015, Arrokoth flyby January 2019.' }],
  ['parker-solar-probe', 'Parker Solar Probe', -96, 'sun', 1, { agency: 'NASA', launchDateUTC: '2018-08-12', status: 'Operating; perihelia at about 9.86 solar radii', summary: 'Repeated close passes through the solar corona using Venus gravity assists.' }],
  ['juno', 'Juno', -61, 'sun', 1, { agency: 'NASA', launchDateUTC: '2011-08-05', status: 'Jupiter orbiter; check ephemeris end date (extended mission was planned through September 2025)', summary: 'Polar orbits of Jupiter since July 2016: gravity, magnetosphere and atmosphere.' }],
  ['europa-clipper', 'Europa Clipper', -159, 'sun', 1, { agency: 'NASA', launchDateUTC: '2024-10-14', status: 'Cruise to Jupiter (Earth gravity assist Dec 2026; arrival 2030 planned)', summary: 'Will make repeated flybys of Europa to assess habitability.' }],
  ['psyche', 'Psyche', -255, 'sun', 1, { agency: 'NASA', launchDateUTC: '2023-10-13', status: 'Cruise to (16) Psyche (Mars gravity assist May 2025; arrival 2029 planned)', summary: 'Will orbit the metal-rich asteroid (16) Psyche.' }],
  ['lucy', 'Lucy', -49, 'sun', 1, { agency: 'NASA', launchDateUTC: '2021-10-16', status: 'Cruise to the Jupiter Trojans (Donaldjohanson flyby Apr 2025; Trojan flybys from 2027)', summary: 'First mission to multiple Jupiter Trojan asteroids.' }],
  ['hera', 'Hera', -91, 'sun', 1, { agency: 'ESA', launchDateUTC: '2024-10-07', status: 'Cruise to Didymos; arrival planned November 2026 (ESA, announced Oct 2025)', summary: 'Will survey the DART impact outcome at Dimorphos and measure its mass.' }],
  ['juice', 'JUICE', -28, 'sun', 1, { agency: 'ESA', launchDateUTC: '2023-04-14', status: 'Cruise to Jupiter (arrival 2031 planned)', summary: 'Will study Ganymede, Europa and Callisto.' }],
  ['bepicolombo', 'BepiColombo', -121, 'sun', 1, { agency: 'ESA/JAXA', launchDateUTC: '2018-10-20', status: 'Cruise to Mercury; orbit insertion planned November 2026', summary: 'Two orbiters (MPO and Mio) to study Mercury.' }],
  ['jwst', 'James Webb Space Telescope', -170, 'earth', 1, { agency: 'NASA/ESA/CSA', launchDateUTC: '2021-12-25', status: 'Operating on a halo orbit around Sun-Earth L2', summary: 'Infrared space observatory; track is geocentric.' }],
];
const MON = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (s, n) => iso(new Date(Date.parse(s + 'T00:00:00Z') + n * 86400000));

async function query(cmd, center, start, stop, step, tag) {
  const params = { format: 'json', COMMAND: `'${cmd}'`, OBJ_DATA: 'NO', MAKE_EPHEM: 'YES', EPHEM_TYPE: 'VECTORS', CENTER: `'${center}'`, START_TIME: `'${start}'`, STOP_TIME: `'${stop}'`,
    STEP_SIZE: `'${step} d'`, VEC_TABLE: '1', REF_SYSTEM: 'ICRF', REF_PLANE: 'FRAME', OUT_UNITS: 'KM-S', VEC_LABELS: 'NO', CSV_FORMAT: 'YES', TIME_TYPE: 'TDB' };
  const r = await fetchCached(`${URL_}?${qs(params)}`, { cache: `horizons/${tag}-${start}-${stop}.json`, timeoutMs: 300000 });
  return { j: JSON.parse(r.text), retrieved: r.retrieved, url: r.url };
}

const results = [];
let retrieved = null;
for (const [id, name, naif, center, step, mission] of CRAFT) {
  const cen = center === 'earth' ? '500@399' : '500@10';
  let start = START, stop = STOP, res = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const q = await query(naif, cen, start, stop, step, id);
    retrieved = q.retrieved;
    const text = q.j.result ?? '';
    if (text.includes('$$SOE')) { res = { text, q }; break; }
    const msg = (q.j.error ?? text).toString();
    const m1 = msg.match(/prior to A\.D\. (\d{4})-([A-Z]{3})-(\d{2})/i);
    const m2 = msg.match(/after A\.D\. (\d{4})-([A-Z]{3})-(\d{2})/i);
    log(`${id}: coverage problem: ${msg.replace(/\s+/g, ' ').slice(0, 300)}`);
    if (!m1 && !m2) throw new DataError(`Horizons failed for ${id}: ${msg.slice(0, 400)}`);
    if (m1) start = addDays(`${m1[1]}-${String(MON[m1[2].toUpperCase()]).padStart(2, '0')}-${m1[3]}`, 2);
    if (m2) stop = addDays(`${m2[1]}-${String(MON[m2[2].toUpperCase()]).padStart(2, '0')}-${m2[3]}`, -2);
  }
  assert(res, `no ephemeris for ${id}`);
  const body = res.text.split('$$SOE')[1].split('$$EOE')[0].trim().split('\n');
  const samples = []; let startJD = null; let prev = null;
  for (const line of body) {
    const c = line.split(',').map((s) => s.trim());
    const jd = num(c[0]); const xyz = [num(c[2]), num(c[3]), num(c[4])];
    assert(jd !== null && xyz.every((v) => v !== null), `${id}: bad row ${line.slice(0, 100)}`);
    if (startJD === null) startJD = jd;
    if (prev !== null) assert(Math.abs(jd - prev - step) < 1e-6, `${id}: non-uniform step`);
    prev = jd; samples.push(...xyz);
  }
  const n = samples.length / 3;
  assert(n >= 2 && n <= 2500, `${id}: sample count ${n}`);
  const trimmed = start !== START || stop !== STOP;
  const r0 = Math.hypot(samples[0], samples[1], samples[2]) / 149597870.7;
  log(`${id}: ${n} samples, step ${step} d, startJD ${startJD}, ${start}..${stop}${trimmed ? ' (TRIMMED)' : ''}, |r0|=${r0.toFixed(3)} AU`);
  results.push({
    id, name, naifId: naif, centerId: center, frame: 'ICRF', units: 'km', timeScale: 'TDB (JD)', startJD, stepDays: step, count: n,
    coverage: { requested: [START, STOP], delivered: [start, stop], trimmed },
    samples, mission, source: `JPL Horizons API, COMMAND=${naif}, CENTER=${cen}, EPHEM_TYPE=VECTORS, REF_SYSTEM=ICRF, REF_PLANE=FRAME`, retrieved: res.q.retrieved,
  });
}
// sanity: Voyager 1 ~ 165-170 AU from Sun in 2025; Voyager 2 ~ 140 AU; Parker < 0.8 AU always
const rr = (id, k) => { const s = results.find((x) => x.id === id).samples; return Math.hypot(s[k * 3], s[k * 3 + 1], s[k * 3 + 2]) / 149597870.7; };
const v1 = rr('voyager-1', 0), v2 = rr('voyager-2', 0);
log('Voyager 1 r(2025-01-01) =', v1.toFixed(1), 'AU (expected ~165); Voyager 2 =', v2.toFixed(1), 'AU (expected ~139)');
assert(v1 > 160 && v1 < 175 && v2 > 130 && v2 < 150, 'Voyager distances implausible');
const psp = results.find((x) => x.id === 'parker-solar-probe').samples;
let minR = 1e9; for (let i = 0; i < psp.length; i += 3) minR = Math.min(minR, Math.hypot(psp[i], psp[i + 1], psp[i + 2]));
log('PSP min r =', (minR / 695700).toFixed(2), 'solar radii (expected ~9.9 at perihelion; 1-d sampling may miss exact minimum)');
assert(minR / 695700 < 14, 'PSP never gets close to Sun?');

const doc = { schemaVersion: 1, generated: new Date().toISOString(), retrieved,
  notes: 'samples = flat [x,y,z,x,y,z,...] in km, ICRF (equatorial J2000 axes). centerId "sun" = Sun body centre (500@10), "earth" = Earth centre (500@399). Sample i is at JD(TDB) = startJD + i*stepDays. Interpolate between samples (cubic Hermite/Catmull-Rom is adequate except around fast perihelion passes of Parker Solar Probe). coverage.trimmed=true means Horizons has no ephemeris for the whole requested span.',
  craft: results };
const p = `${OUT_DIR}/spacecraft.json`;
await writeJSON(p, doc);
await upsertManifest([{
  id: 'jpl-horizons-spacecraft', name: 'JPL Horizons spacecraft position tracks 2025-2030', organization: 'NASA JPL SSD',
  purpose: 'Spacecraft search and trajectories (Voyagers, New Horizons, Parker, Juno, Europa Clipper, Psyche, Lucy, Hera, JUICE, BepiColombo, JWST)',
  mechanism: 'Horizons API EPHEM_TYPE=VECTORS CSV (position only)', endpoint: URL_,
  query: "COMMAND=<naif>&CENTER=500@10 (JWST 500@399)&START_TIME=2025-01-01&STOP_TIME=2030-12-31&STEP_SIZE=<1|5> d&VEC_TABLE=1&REF_SYSTEM=ICRF&REF_PLANE=FRAME&OUT_UNITS=KM-S&TIME_TYPE=TDB&CSV_FORMAT=YES",
  version: 'Horizons live state (latest spacecraft SPK kernels) at retrieval', retrieved, license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL,
  citation: 'NASA/JPL Horizons On-Line Ephemeris System (https://ssd.jpl.nasa.gov/horizons/). Spacecraft trajectories from mission navigation teams via NAIF SPK kernels.',
  rateLimits: JPL_RATE, fieldsUsed: ['JDTDB', 'X', 'Y', 'Z'], updateCadence: 'predicts are updated by flight dynamics teams after trajectory correction maneuvers',
  cachePolicy: 'versioned offline snapshot; optional online refresh', normalization: 'scripts/data/solar/fetch-spacecraft.mjs',
  fallback: 'Hide spacecraft whose track is missing; never extrapolate.',
  files: [await fileEntry(p, results.length)],
  limitations: 'Future portions are navigation predictions that shift after maneuvers; coarse steps for outer probes (5 d); Parker Solar Probe 1-day samples undersample perihelion passes. Mission status text is editorial and dated 2026-10; verify before presenting as current.',
  provenanceClass: 'derived',
}]);
