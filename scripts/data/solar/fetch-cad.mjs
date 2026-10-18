// CNEOS CAD API -> public/data/solar/close-approaches.json
import { fetchJSON, qs, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, OUT_DIR, log, assert, num, round } from './lib.mjs';

const BASE = 'https://ssd-api.jpl.nasa.gov/cad.api';
const main = { 'date-min': '2026-10-16', 'date-max': '2036-10-16', 'dist-max': '0.05', body: 'Earth', sort: 'date', diameter: 'true', fullname: 'true' };
const apo = { des: '99942', 'date-min': '2029-01-01', 'date-max': '2029-12-31', 'dist-max': '0.05', body: 'Earth', diameter: 'true', fullname: 'true' };

const a = await fetchJSON(`${BASE}?${qs(main)}`, { cache: 'cad/main.json' });
const b = await fetchJSON(`${BASE}?${qs(apo)}`, { cache: 'cad/apophis.json' });
for (const r of [a, b]) assert(Array.isArray(r.json.data), 'CAD response lacks data');
const f = a.json.fields;
const want = ['des', 'fullname', 'cd', 'jd', 'dist', 'dist_min', 'dist_max', 'v_rel', 'h', 'diameter', 'diameter_sigma', 't_sigma_f'];
const idx = Object.fromEntries(want.map((k) => [k, f.indexOf(k)]));
for (const k of want) assert(idx[k] >= 0, `CAD field ${k} missing: ${f}`);

const fields = ['des', 'fullname', 'cdTDB', 'jdTDB', 'distAU', 'distMinAU', 'distMaxAU', 'vRelKms', 'hMag', 'diameterKm', 'diameterSigmaKm', 'timeSigma'];
const conv = (row) => [row[idx.des], String(row[idx.fullname]).trim(), row[idx.cd], num(row[idx.jd]), num(row[idx.dist]), num(row[idx.dist_min]), num(row[idx.dist_max]), num(row[idx.v_rel]), num(row[idx.h]), num(row[idx.diameter]), num(row[idx.diameter_sigma]), row[idx.t_sigma_f]];
const rows = a.json.data.map(conv);
const seen = new Set(rows.map((r) => `${r[0]}|${r[2]}`));
let extra = 0;
for (const r of b.json.data.map(conv)) if (!seen.has(`${r[0]}|${r[2]}`)) { rows.push(r); extra++; }
rows.sort((x, y) => x[3] - y[3]);
const apophis = rows.find((r) => r[0] === '99942' && r[2].startsWith('2029-Apr-13'));
assert(apophis, 'Apophis 2029-Apr-13 approach not found');
// Apophis expected: 2029-Apr-13 ~21:46 TDB, nominal 0.000254 AU (~38,000 km from centre, ~0.00025 AU), v_rel ~7.42 km/s
log('Apophis:', JSON.stringify(apophis));
assert(Math.abs(apophis[4] - 0.000254) < 0.00002, 'Apophis distance off');
assert(Math.abs(apophis[7] - 7.42) < 0.1, 'Apophis vrel off');

const out = {
  schemaVersion: 1, generated: new Date().toISOString(), source: 'JPL CNEOS CAD API', retrieved: a.retrieved,
  window: { from: '2026-10-16', to: '2036-10-16', maxDistAU: 0.05, body: 'Earth' },
  notes: 'cdTDB = "YYYY-Mon-DD HH:MM" TDB; jdTDB Julian Date TDB; distAU = nominal geocentric (centre-to-centre) distance; distMin/Max = 3-sigma min/max; timeSigma = 3-sigma time uncertainty string from CAD (t_sigma_f); null = unknown. 99942 Apophis 2029-Apr-13 included explicitly.',
  fields, rows,
};
const p = `${OUT_DIR}/close-approaches.json`;
await writeJSON(p, out);
log(`close-approaches: ${rows.length} rows (+${extra} from Apophis query)`);
await upsertManifest([{
  id: 'cneos-cad-close-approaches', name: 'CNEOS Close-Approach Data (CAD) 2026-2036', organization: 'NASA JPL CNEOS / SSD',
  purpose: 'Planetary-defense lab: upcoming asteroid/comet close approaches to Earth within 0.05 AU',
  mechanism: 'REST API (JSON) -> compact table', endpoint: BASE,
  query: `${qs(main)} ; plus ${qs(apo)}`, version: 'live archive state at retrieval', retrieved: a.retrieved,
  license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL,
  citation: 'NASA/JPL-Caltech Center for Near Earth Object Studies (CNEOS), SSD/CNEOS Close-Approach Data API.',
  rateLimits: JPL_RATE, fieldsUsed: ['des', 'fullname', 'cd', 'jd', 'dist', 'dist_min', 'dist_max', 'v_rel', 'h', 'diameter', 'diameter_sigma', 't_sigma_f'],
  updateCadence: 'continuously updated as orbits are refined', cachePolicy: 'versioned offline snapshot; optional online refresh',
  normalization: 'scripts/data/solar/fetch-cad.mjs', fallback: 'Hide the close-approach list; Apophis 2029 record is also embedded in smallbodies.json notes.',
  files: [await fileEntry(p, rows.length)],
  limitations: 'Predicted approaches change as orbits are refined; poorly observed objects have large distMin/distMax spread; diameter is measured only for a minority, otherwise null (H-based estimates are in neos.json).',
  provenanceClass: 'derived',
}]);
