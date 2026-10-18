// SBDB Query API -> public/data/solar/asteroids.bin + asteroids.json (numbered asteroids with H < H_MAX)
import fs from 'node:fs';
import { fetchCached, qs, writeBinary, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, OUT_DIR, RAW_DIR, log, assert, num } from './lib.mjs';

const H_MAX = 15;
const URL_ = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
const params = { fields: 'spkid,a,e,i,om,w,ma,epoch,H,class,pha,neo', 'sb-kind': 'a', 'sb-ns': 'n', 'sb-cdata': JSON.stringify({ AND: [`H|LT|${H_MAX}`] }) };
const url = `${URL_}?${qs(params)}`;
const r = await fetchCached(url, { cache: `asteroids/query-H${H_MAX}.json`, timeoutMs: 600000 });
const j = JSON.parse(r.text);
const f = j.fields; const idx = Object.fromEntries(f.map((k, i) => [k, i]));
log('query count', j.count, 'fields', f.join(','), 'rows', j.data.length);
assert(j.data.length > 20000, 'too few asteroids');

const CODES = ['MBA', 'IMB', 'OMB', 'MCA', 'APO', 'ATE', 'AMO', 'IEO', 'HUN', 'PHO', 'TJN', 'CEN', 'TNO', 'AST', 'PAA', 'HYA'];
const classCode = (c) => { const i = CODES.indexOf(c); if (i < 0) { CODES.push(c); return CODES.length - 1; } return i; };
const rows = [];
for (const d of j.data) {
  const v = ['a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H'].map((k) => num(d[idx[k]]));
  if (v.some((x) => x === null)) continue; // drop incomplete (never invent)
  rows.push([...v, classCode(d[idx.class])]);
}
// epochBase = most common epoch (rounded to .5)
const cnt = new Map(); for (const x of rows) cnt.set(x[6], (cnt.get(x[6]) ?? 0) + 1);
const epochBaseJD = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
rows.sort((x, y) => x[7] - y[7]); // brightest first
const STRIDE = 9;
const buf = Buffer.alloc(rows.length * STRIDE * 4);
let o = 0;
for (const x of rows) {
  const out = [x[0], x[1], x[2], x[3], x[4], x[5], x[6] - epochBaseJD, x[7], x[8]];
  for (const val of out) { assert(Number.isFinite(val), 'non-finite value'); buf.writeFloatLE(val, o); o += 4; }
}
const binP = `${OUT_DIR}/asteroids.bin`;
await writeBinary(binP, buf);
const fields = [
  { name: 'aAU', unit: 'AU' }, { name: 'e', unit: '' }, { name: 'iDeg', unit: 'deg' }, { name: 'nodeDeg', unit: 'deg' }, { name: 'argPeriDeg', unit: 'deg' },
  { name: 'meanAnomalyDeg', unit: 'deg' }, { name: 'epochOffsetDays', unit: 'd (TDB JD minus epochBaseJD)' }, { name: 'H', unit: 'mag' }, { name: 'classCode', unit: 'index into classCodes' },
];
const usedCodes = {}; CODES.forEach((c, i) => { usedCodes[c] = i; });
const counts = {}; for (const x of rows) counts[CODES[x[8]]] = (counts[CODES[x[8]]] ?? 0) + 1;
const hdr = {
  schemaVersion: 1, generated: new Date().toISOString(), file: 'asteroids.bin', dtype: 'float32', endianness: 'little',
  count: rows.length, stride: STRIDE, strideBytes: STRIDE * 4, byteLength: buf.length, fields, epochBaseJD, hMax: H_MAX,
  frame: 'heliocentric ecliptic J2000, osculating elements', angleUnit: 'deg', order: 'sorted by H ascending (brightest first)',
  classCodes: usedCodes, classCounts: counts,
  selection: `numbered asteroids (sb-ns=n) with H < ${H_MAX}, from SBDB Query API; rows with any missing element dropped`,
  note: 'Float32 holds ~7 digits: epochOffsetDays keeps epoch precise; each body has its own osculating epoch (JD TDB = epochBaseJD + epochOffsetDays).',
};
const hp = `${OUT_DIR}/asteroids.json`;
await writeJSON(hp, hdr);
log('asteroids:', rows.length, 'epochBase', epochBaseJD, 'classes', JSON.stringify(counts), 'bytes', buf.length);
await upsertManifest([{
  id: 'jpl-sbdb-numbered-asteroids', name: 'JPL SBDB numbered asteroids (H < 15)', organization: 'NASA JPL SSD',
  purpose: 'Asteroid belt / NEO / Trojan point cloud rendering', mechanism: 'SBDB Query API -> JSON -> Float32 binary', endpoint: URL_,
  query: decodeURIComponent(qs(params)), version: 'live archive state at retrieval', retrieved: r.retrieved,
  license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics, Small-Body Database Query API.',
  rateLimits: JPL_RATE, fieldsUsed: ['spkid', 'a', 'e', 'i', 'om', 'w', 'ma', 'epoch', 'H', 'class'],
  updateCadence: 'continuous', cachePolicy: 'versioned offline snapshot; optional online refresh', normalization: 'scripts/data/solar/fetch-asteroids.mjs',
  fallback: 'Render a procedural belt only if the file is missing, labelled illustrative.',
  files: [await fileEntry(binP, rows.length), await fileEntry(hp, 1)],
  limitations: 'Brightness-limited sample (H<16, roughly D > 1-2 km depending on albedo), not complete; osculating elements at per-body epochs; positions beyond a few years from epoch drift. No names/diameters in the point cloud.',
  provenanceClass: 'observed',
}]);
