// SBDB Query API -> public/data/outer/tnos.bin + tnos.json + manifest.part.json  (trans-Neptunian objects)
// Usage: node scripts/data/outer/fetch-tnos.mjs [--refresh]
// Source note: the MPC distant-object list is the same orbit data JPL SBDB carries; SBDB has a documented public JSON API and
// stated reuse terms (see lib.mjs JPL_SSD_LICENSE), so it is used instead of scraping MPC pages.
import { fetchCached, qs, writeBinary, writeJSON, fileEntry, num, log, assert, REPO_ROOT, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE } from '../solar/lib.mjs';
import { mkdir, writeFile } from 'node:fs/promises';

const OUT = `${REPO_ROOT}/public/data/outer`;
const URL_ = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
const params = { fields: 'full_name,pdes,name,a,e,i,om,w,ma,epoch,H,diameter,class', 'sb-kind': 'a', 'sb-class': 'TNO' };
const r = await fetchCached(`${URL_}?${qs(params)}`, { cache: 'outer/tno-query.json', timeoutMs: 300000 });
const j = JSON.parse(r.text);
const idx = Object.fromEntries(j.fields.map((k, i) => [k, i]));
log('rows', j.data.length);
assert(j.data.length > 1500, 'too few TNOs');

/** Dynamical class codes (heuristic, standard Gladman/Elliot-style boxes on osculating a, e, i; labelled derived). */
const CLASSES = ['cold-classical', 'hot-classical', 'plutino', 'twotino', 'other-resonant', 'scattered', 'detached', 'other'];
function classify(a, e, inc) {
  const q = a * (1 - e);
  if (a > 150 && q > 50) return 6; // sednoid-like detached
  if (a > 39.0 && a < 39.9 && e > 0.05) return 2; // 3:2 plutino (a ~ 39.4)
  if (a > 47.3 && a < 48.3 && e > 0.1) return 3; // 2:1 twotino (a ~ 47.8)
  for (const r of [34.9, 36.4, 42.3, 43.7, 55.4, 62.6, 69.5]) if (Math.abs(a - r) < 0.25 && e > 0.05) return 4; // 5:4 4:3 5:3 7:4 5:2 3:1 7:2
  if (a > 36 && a < 50 && e < 0.25 && q > 35) return inc < 5 ? 0 : 1; // classical belt (cold: low inclination)
  if (q > 40) return 6; // detached
  if (a > 48) return 5; // scattered disk
  return 7; // inner / Neptune-interacting (a < ~39)
}

const rows = [];
for (const d of j.data) {
  const v = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch'].map((k) => num(d[idx[k]]));
  if (v.some((x) => x === null) || v[0] <= 0 || v[1] >= 1) continue;
  const H = num(d[idx.H]);
  rows.push({ v, H: H ?? 99, name: d[idx.name], pdes: d[idx.pdes], full: d[idx.full_name], diam: num(d[idx.diameter]), cls: classify(v[0], v[1], v[2]) });
}
rows.sort((x, y) => x.H - y.H); // brightest first (a prefix is a valid LOD subset)
const cnt = new Map(); for (const x of rows) cnt.set(x.v[6], (cnt.get(x.v[6]) ?? 0) + 1);
const epochBaseJD = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
const STRIDE = 9;
const buf = Buffer.alloc(rows.length * STRIDE * 4);
let o = 0;
for (const x of rows) {
  const out = [x.v[0], x.v[1], x.v[2], x.v[3], x.v[4], x.v[5], x.v[6] - epochBaseJD, Math.min(x.H, 30), x.cls];
  for (const val of out) { assert(Number.isFinite(val), 'non-finite'); buf.writeFloatLE(val, o); o += 4; }
}
await mkdir(OUT, { recursive: true });
await writeBinary(`${OUT}/tnos.bin`, buf);
const counts = {}; for (const x of rows) counts[CLASSES[x.cls]] = (counts[CLASSES[x.cls]] ?? 0) + 1;
const named = [];
rows.forEach((x, i) => { if (x.name && named.length < 120) named.push({ i, name: x.name, pdes: x.pdes, H: x.H, diameterKm: x.diam, cls: CLASSES[x.cls], aAU: x.v[0], e: x.v[1] }); });
const hdr = {
  schemaVersion: 1, generated: new Date().toISOString(), file: 'tnos.bin', dtype: 'float32', endianness: 'little',
  count: rows.length, stride: STRIDE, strideBytes: STRIDE * 4, byteLength: buf.length, epochBaseJD,
  fields: [{ name: 'aAU', unit: 'AU' }, { name: 'e', unit: '' }, { name: 'iDeg', unit: 'deg' }, { name: 'nodeDeg', unit: 'deg' }, { name: 'argPeriDeg', unit: 'deg' }, { name: 'meanAnomalyDeg', unit: 'deg' }, { name: 'epochOffsetDays', unit: 'd (JD TDB minus epochBaseJD)' }, { name: 'H', unit: 'mag' }, { name: 'classCode', unit: 'index into classes' }],
  classes: CLASSES, classCounts: counts, frame: 'heliocentric ecliptic J2000, osculating elements', order: 'H ascending (brightest first)',
  classification: 'Heuristic boxes on osculating a, e, i (derived, not a formal dynamical classification).',
  named,
};
await writeJSON(`${OUT}/tnos.json`, hdr);
const manifest = {
  domain: 'outer',
  datasets: [{
    id: 'jpl-sbdb-tnos', name: 'JPL SBDB trans-Neptunian objects (all catalogued)', organization: 'NASA JPL SSD (orbits derived from Minor Planet Center astrometry)',
    purpose: 'Kuiper belt / scattered disk / detached-object point cloud', mechanism: 'SBDB Query API (sb-class=TNO) -> JSON -> Float32 binary', endpoint: URL_,
    query: decodeURIComponent(qs(params)), version: 'live archive state at retrieval', retrieved: r.retrieved, license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL,
    citation: 'NASA/JPL Solar System Dynamics, Small-Body Database Query API; orbits fitted to Minor Planet Center observations.', rateLimits: JPL_RATE,
    fieldsUsed: ['full_name', 'pdes', 'name', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'diameter', 'class'],
    updateCadence: 'continuous', cachePolicy: 'versioned offline snapshot', normalization: 'scripts/data/outer/fetch-tnos.mjs',
    fallback: 'No TNO cloud is drawn if the file is missing; named dwarf planets still render from the solar domain.',
    files: [await fileEntry(`${OUT}/tnos.bin`, rows.length), await fileEntry(`${OUT}/tnos.json`, 1)],
    limitations: 'Observational census, heavily biased towards bright, near-ecliptic, near-perihelion objects; osculating elements drift beyond a few decades from epoch; dynamical class is a heuristic box. Not a model of the true population.',
    provenanceClass: 'observed',
  }, {
    id: 'outer-literature', name: 'Heliosphere boundary crossings and outer-system constants (published values)', organization: 'Published literature (NASA Voyager and IBEX teams)',
    purpose: 'Voyager termination-shock / heliopause crossings, interstellar-flow direction, Oort-cloud extents, shell-fit anchors', mechanism: 'Transcribed by hand from publications; no network access',
    endpoint: 'n/a', query: null, version: 'Stone 2005, 2008, 2013, 2019; Gurnett 2013; Bzowski 2015; Oort 1950; Hills 1981; Dones 2015', retrieved: new Date().toISOString(), license: 'Facts and measured values cited from peer-reviewed papers; no text or figures reproduced.', licenseUrl: null,
    citation: 'Stone et al. 2005 Science 309, 2017; Stone et al. 2008 Nature 454, 71; Stone et al. 2013 Science 341, 150; Gurnett et al. 2013 Science 341, 1489; Stone et al. 2019 Nature Astron. 3, 1013; Bzowski et al. 2015 ApJS 220, 28; Oort 1950 BAN 11, 91; Hills 1981 AJ 86, 1730; Dones et al. 2015 Space Sci. Rev. 197, 191.',
    rateLimits: 'n/a', fieldsUsed: ['crossing dates', 'crossing heliocentric distances', 'interstellar flow ecliptic longitude/latitude/speed', 'Oort cloud radial extents'],
    updateCadence: 'static', cachePolicy: 'in-repo constants (src/domains/outer/model.ts)', normalization: 'src/domains/outer/model.ts (CROSSINGS, NOSE_*, OORT_*)',
    fallback: 'n/a', files: [],
    limitations: 'Heliosphere shell shapes between the four crossings are reconstructed (a smooth fitted model), the tail is unconstrained, and the Oort cloud is hypothesised: it is rendered as an illustrative random sample.',
    provenanceClass: 'reconstructed',
  }],
};
await writeFile(`${OUT}/manifest.part.json`, JSON.stringify(manifest, null, 2) + '\n');
log('tnos', rows.length, JSON.stringify(counts), 'bytes', buf.length, 'named', named.length);

const doc = `# Outer Solar System data (domain \`outer\`)

Generated by \`node scripts/data/outer/fetch-tnos.mjs\` (retrieved ${r.retrieved}).

## Trans-Neptunian objects: \`public/data/outer/tnos.bin\` + \`tnos.json\`

- **Source:** JPL Small-Body Database Query API, \`sb-class=TNO\` (orbits fitted to Minor Planet Center astrometry). SBDB is used instead of scraping the MPC distant-object pages: same orbit data, documented JSON API, stated reuse terms. Terms: ${JPL_SSD_LICENSE}
- **Rows:** ${rows.length} objects, brightest (smallest H) first, so a prefix is a valid brightness-limited subset. Float32 x 9: a [au], e, i, node, argPeri, M0 [deg], epoch offset [d from epochBaseJD ${epochBaseJD}], H [mag], class code.
- **Class counts:** ${JSON.stringify(counts)}. The class is a heuristic box on osculating a, e, i (3:2 plutinos, 2:1 twotinos, other resonances, cold/hot classical split at i = 5 deg, scattered, detached) and is labelled *derived* in the app.
- **Limitations:** observational census (bright, near-ecliptic, near-perihelion bias); two-body propagation from per-object osculating elements.

## Literature constants (\`outer-literature\`, in \`src/domains/outer/model.ts\`)

| Quantity | Value | Reference |
| --- | --- | --- |
| Voyager 1 termination shock | 94.0 au, 2004-12-16 | Stone et al. 2005, Science 309, 2017 |
| Voyager 2 termination shock | 83.7 au, 2007-08-30 | Stone et al. 2008, Nature 454, 71 |
| Voyager 1 heliopause | 121.6 au, 2012-08-25 | Stone et al. 2013, Science 341, 150; Gurnett et al. 2013, Science 341, 1489 |
| Voyager 2 heliopause | 119 au, 2018-11-05 | Stone et al. 2019, Nature Astronomy 3, 1013 |
| Interstellar inflow direction | ecliptic lon 255.7, lat +5.1 deg; 25.4 km/s | Bzowski et al. 2015, ApJS 220, 28 |
| Oort cloud | inner 2,000-20,000 au, outer to ~100,000 au | Oort 1950; Hills 1981; Dones et al. 2015 |

## Provenance of the visuals

- TNO points: **observed** orbits (class colour and point size are visual cues).
- Heliosphere shells: **reconstructed**. A smooth surface r = R (1 + k s^p)(1 + a n.north) with s = (1 - cos theta)/2 about the nose; R and a are fitted so the surface passes through the four Voyager crossings, k and p (flank/tail elongation) are assumed. The tail is open, unconstrained and fades out.
- Voyager crossing markers: published distance along each craft's current heliocentric direction (the shipped Horizons trajectories cover only 2025-2030, and both craft move almost radially).
- Oort cloud: **illustrative** seeded random sample; no object is real.
- Light-hour / light-day / light-year rings: **derived** (c x time).
`;
await writeFile(`${REPO_ROOT}/docs/data/outer.md`, doc);
