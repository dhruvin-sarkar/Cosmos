// SBDB Query API -> public/data/solar/neos.json (all PHAs + NEOs with H < 18 + notable NEOs)
import fs from 'node:fs';
import { fetchCached, qs, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, OUT_DIR, log, assert, num, sig } from './lib.mjs';

const URL_ = 'https://ssd-api.jpl.nasa.gov/sbdb_query.api';
const FIELDS = 'spkid,full_name,pdes,a,e,i,om,w,ma,epoch,tp,per,q,H,diameter,diameter_sigma,albedo,rot_per,moid,class,pha,condition_code,data_arc,n_obs_used,sigma_a,sigma_e,sigma_i,sigma_om,sigma_w,sigma_ma';
const q1 = { fields: FIELDS, 'sb-kind': 'a', 'sb-group': 'pha' };
const q2 = { fields: FIELDS, 'sb-kind': 'a', 'sb-group': 'neo', 'sb-cdata': JSON.stringify({ AND: ['H|LT|18'] }) };
const A = await fetchCached(`${URL_}?${qs(q1)}`, { cache: 'neos/pha.json', timeoutMs: 300000 });
const B = await fetchCached(`${URL_}?${qs(q2)}`, { cache: 'neos/neo-H18.json', timeoutMs: 300000 });
const ja = JSON.parse(A.text), jb = JSON.parse(B.text);
log('PHAs', ja.count, 'NEOs H<18', jb.count);
assert(ja.count > 1500, 'too few PHAs');
const sb = JSON.parse(fs.readFileSync(`${OUT_DIR}/smallbodies.json`, 'utf8')).bodies.filter((b) => b.neo && b.elements);

const fields = ['spkid', 'fullname', 'designation', 'orbitClass', 'pha', 'H', 'diameterKm', 'diameterSigmaKm', 'diameterEstKm', 'albedo', 'rotationPeriodH', 'moidAU',
  'epochJD', 'aAU', 'e', 'iDeg', 'nodeDeg', 'argPeriDeg', 'meanAnomalyDeg', 'tpJD', 'periodDays', 'sigmaAAU', 'sigmaE', 'sigmaIDeg', 'sigmaNodeDeg', 'sigmaArgPeriDeg', 'sigmaMeanAnomalyDeg',
  'conditionCode', 'dataArcDays', 'nObsUsed'];
// derived diameter: D(km) = 1329 / sqrt(p) * 10^(-H/5), assumed geometric albedo p = 0.14
const estD = (H) => (H === null ? null : sig(1329 / Math.sqrt(0.14) * 10 ** (-H / 5), 4));
const byId = new Map();
const add = (j) => {
  const ix = Object.fromEntries(j.fields.map((k, i) => [k, i]));
  for (const d of j.data) {
    const g = (k) => d[ix[k]];
    const H = num(g('H'));
    const row = [num(g('spkid')), String(g('full_name')).trim(), g('pdes'), g('class'), g('pha') === 'Y', H, num(g('diameter')), num(g('diameter_sigma')), estD(H), num(g('albedo')), num(g('rot_per')), num(g('moid')),
      num(g('epoch')), num(g('a')), num(g('e')), num(g('i')), num(g('om')), num(g('w')), num(g('ma')), num(g('tp')), num(g('per')),
      num(g('sigma_a')), num(g('sigma_e')), num(g('sigma_i')), num(g('sigma_om')), num(g('sigma_w')), num(g('sigma_ma')),
      g('condition_code') === null ? null : num(g('condition_code')), num(g('data_arc')), num(g('n_obs_used'))];
    byId.set(row[0], row);
  }
};
add(ja); add(jb);
// notable NEOs from smallbodies.json not yet present
let extra = 0;
for (const b of sb) {
  const spk = String(b.spkid);
  const key = Number(spk);
  if (byId.has(key) || b.kind !== 'asteroid') continue;
  const e = b.elements, s = b.sigmas;
  byId.set(key, [key, b.fullname, b.designation, b.orbitClass, b.pha, b.H, b.diameterKm, b.diameterSigmaKm, estD(b.H), b.albedo, b.rotationPeriodH, b.moidAU,
    e.epochJD, e.aAU, e.e, e.iDeg, e.nodeDeg, e.argPeriDeg, e.meanAnomalyDeg, e.tpJD, e.periodDays, s.aAU, s.e, s.iDeg, s.nodeDeg, s.argPeriDeg, s.meanAnomalyDeg,
    b.conditionCode === null ? null : Number(b.conditionCode), b.dataArcDays, b.nObsUsed]);
  extra++;
}
const rows = [...byId.values()].sort((x, y) => (x[5] ?? 99) - (y[5] ?? 99));
for (const r of rows) for (const v of r) assert(!(typeof v === 'number') || Number.isFinite(v), 'non-finite');
const ap = rows.find((r) => r[2] === '99942');
assert(ap && ap[4] === true && Math.abs(ap[13] - 0.9223) < 0.002, 'Apophis check');
const pha = rows.filter((r) => r[4]).length;
log('neos rows', rows.length, 'PHA', pha, 'extra notable', extra);
const doc = {
  schemaVersion: 1, generated: new Date().toISOString(), retrieved: A.retrieved,
  notes: 'Selection: all potentially hazardous asteroids (SBDB sb-group=pha) + all NEAs with H<18 + notable NEOs from smallbodies.json. Elements osculating, heliocentric ecliptic J2000, epochJD/tpJD in TDB, angles deg. diameterKm is measured/SBDB-adopted (null if unknown); diameterEstKm is DERIVED from H assuming geometric albedo 0.14: D = 1329/sqrt(0.14) * 10^(-H/5) km (factor-of-2 uncertainty typical). sigma* are 1-sigma formal. Sorted by H ascending (largest first). pha = SBDB PHA flag (MOID<=0.05 AU and H<=22).',
  assumedAlbedoForEstimate: 0.14, fields, rows,
};
const p = `${OUT_DIR}/neos.json`;
await writeJSON(p, doc);
await upsertManifest([{
  id: 'jpl-sbdb-neos-phas', name: 'JPL SBDB near-Earth objects and PHAs', organization: 'NASA JPL SSD / CNEOS',
  purpose: 'Planetary-defense lab: orbits, sizes and MOIDs of potentially hazardous asteroids and the larger NEAs', mechanism: 'SBDB Query API (two queries) -> JSON',
  endpoint: URL_, query: `${decodeURIComponent(qs(q1))}  +  ${decodeURIComponent(qs(q2))}`, version: 'live archive state at retrieval', retrieved: A.retrieved,
  license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics and CNEOS, Small-Body Database Query API.',
  rateLimits: JPL_RATE, fieldsUsed: FIELDS.split(','), updateCadence: 'continuous (new discoveries daily)', cachePolicy: 'versioned offline snapshot; optional online refresh',
  normalization: 'scripts/data/solar/fetch-neos.mjs', fallback: 'Hide the NEO table; keep notable bodies from smallbodies.json.',
  files: [await fileEntry(p, rows.length)],
  limitations: 'diameterEstKm is a rough H-based estimate (real albedos span ~0.03-0.5, so diameters are uncertain by about a factor of 2); only a minority have measured diameters. Osculating elements; not a complete NEO catalog (H<18 plus PHAs).',
  provenanceClass: 'observed',
}]);
