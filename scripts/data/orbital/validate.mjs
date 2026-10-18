#!/usr/bin/env node
// Orbital domain - step 3: validate public/data/orbital/* (no network).
//
//   node scripts/data/orbital/validate.mjs
//
// Checks: schema/types/ranges of every row, NaN/Infinity, uniqueness, internal consistency,
// spot checks of well-known objects against published values, SGP4 propagation of every element
// set with satellite.js (project dependency), GP-derived vs SATCAT apsides, summary/manifest
// consistency and output budget. Writes data-raw/orbital/validation-report.json; exit 1 on failure.

import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as satellite from 'satellite.js';
import { OUT_DIR, RAW_DIR, ROOT, csvRecords, normNorad, num, shapeFromGp, shapeFromGpKepler, writeFileAtomic, isoNow } from './lib.mjs';
import { SATCAT_REQUEST } from './datasets.mjs';
import { CATALOG_FIELDS } from './schema.mjs';

const failures = [];
const warnings = [];
const info = {};
const fail = (m) => { failures.push(m); console.log(`  FAIL ${m}`); };
const warn = (m) => { warnings.push(m); console.log(`  WARN ${m}`); };
const ok = (m) => console.log(`  ok   ${m}`);
const check = (cond, m) => (cond ? ok(m) : fail(m));

const readJ = async (f) => JSON.parse(await readFile(f, 'utf8'));

async function main() {
  console.log('[orbital/validate]');
  const catalog = await readJ(`${OUT_DIR}/catalog.json`);
  const summary = await readJ(`${OUT_DIR}/summary.json`);
  const lookups = await readJ(`${OUT_DIR}/lookups.json`);
  const manifest = await readJ(`${OUT_DIR}/manifest.part.json`);

  // ---- 1. schema --------------------------------------------------------------------------
  console.log('1. schema & types');
  check(catalog.schemaVersion === 1, 'catalog.schemaVersion === 1');
  check(JSON.stringify(catalog.fields) === JSON.stringify(CATALOG_FIELDS), `fields match expected list (${CATALOG_FIELDS.length})`);
  const F = Object.fromEntries(catalog.fields.map((f, i) => [f, i]));
  const rows = catalog.rows;
  check(Array.isArray(rows) && rows.length === catalog.counts.total, `rows.length (${rows.length}) === counts.total`);
  const knownTags = new Set(Object.keys(lookups.groupTags));
  const ISO_EPOCH = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const INTDES = /^\d{4}-\d{3}[A-Z]{1,3}$/;
  const ELEMENT_FIELDS = ['epochUTC', 'meanMotionRevPerDay', 'eccentricity', 'raanDeg', 'argPerigeeDeg', 'meanAnomalyDeg', 'bstar', 'meanMotionDot', 'meanMotionDdot'];
  const seen = new Set();
  let typeErrors = 0;
  let nonFinite = 0;
  let intdesOdd = 0;
  const err = (m) => { typeErrors += 1; if (typeErrors <= 15) fail(m); };
  for (const r of rows) {
    if (r.length !== catalog.fields.length) { err(`row length ${r.length} for ${r[0]}`); continue; }
    for (const v of r) if (typeof v === 'number' && !Number.isFinite(v)) nonFinite += 1;
    const id = r[F.norad];
    if (typeof id !== 'string' || !/^[1-9]\d{0,8}$/.test(id)) err(`bad norad ${JSON.stringify(id)}`);
    if (seen.has(id)) err(`duplicate norad ${id}`);
    seen.add(id);
    if (r[F.name] !== null && typeof r[F.name] !== 'string') err(`name type ${id}`);
    if (r[F.intlDes] !== null && !INTDES.test(r[F.intlDes])) intdesOdd += 1;
    if (!['payload', 'rocket-body', 'debris', 'unknown'].includes(r[F.objectClass])) err(`objectClass ${id}`);
    if (![true, false, null].includes(r[F.isActive])) err(`isActive ${id}`);
    if (r[F.launchDate] !== null && !DATE.test(r[F.launchDate])) err(`launchDate ${id} ${r[F.launchDate]}`);
    if (![null, 'SMALL', 'MEDIUM', 'LARGE'].includes(r[F.rcsSize])) err(`rcsSize ${id}`);
    if (!Array.isArray(r[F.groups]) || r[F.groups].some((t) => !knownTags.has(t))) err(`groups ${id} ${JSON.stringify(r[F.groups])}`);
    const has = r[F.hasElements];
    if (typeof has !== 'boolean') err(`hasElements ${id}`);
    if (has) {
      if (r[F.elementSource] !== 'celestrak-gp') err(`elementSource for GP row ${id}`);
      for (const f of ELEMENT_FIELDS) if (r[F[f]] === null) err(`GP row ${id} missing ${f}`);
      if (!ISO_EPOCH.test(r[F.epochUTC]) || !Number.isFinite(Date.parse(r[F.epochUTC]))) err(`epochUTC ${id} ${r[F.epochUTC]}`);
      const n = r[F.meanMotionRevPerDay];
      const e = r[F.eccentricity];
      if (!(n > 0 && n < 20)) err(`meanMotion ${id} ${n}`);
      if (!(e >= 0 && e < 1)) err(`ecc ${id} ${e}`);
      for (const f of ['raanDeg', 'argPerigeeDeg', 'meanAnomalyDeg']) if (!(r[F[f]] >= 0 && r[F[f]] <= 360)) err(`${f} ${id}`);
    } else {
      if (!['satcat-shape', null].includes(r[F.elementSource])) err(`elementSource for non-GP row ${id}`);
      for (const f of ELEMENT_FIELDS) if (r[F[f]] !== null) err(`non-GP row ${id} has ${f}`);
      if (r[F.elementSource] === 'satcat-shape' && (r[F.apogeeKm] === null || r[F.perigeeKm] === null || r[F.inclinationDeg] === null)) err(`satcat-shape row ${id} lacks shape`);
    }
    const inc = r[F.inclinationDeg];
    if (inc !== null && !(inc >= 0 && inc <= 180)) err(`inclination ${id} ${inc}`);
    const hp = r[F.perigeeKm];
    const ha = r[F.apogeeKm];
    if (hp !== null && ha !== null && ha < hp) err(`apogee < perigee ${id}`);
    if (hp !== null && hp < 50) err(`perigee < 50 km for ${id} (${hp})`);
    if (r[F.periodMin] !== null && !(r[F.periodMin] > 80)) err(`period ${id} ${r[F.periodMin]}`);
    if (r[F.rcsM2] !== null && !(r[F.rcsM2] > 0)) err(`rcsM2 ${id} ${r[F.rcsM2]}`);
  }
  check(typeErrors === 0, `no type/range errors in ${rows.length} rows (errors: ${typeErrors})`);
  check(nonFinite === 0, 'no NaN/Infinity values');
  if (intdesOdd) warn(`${intdesOdd} rows with intlDes not matching YYYY-NNNA (analyst objects have null)`);
  info.rows = rows.length;

  // ---- 2. internal consistency ---------------------------------------------------------------
  console.log('2. internal consistency');
  const byClass = {};
  for (const r of rows) byClass[r[F.objectClass]] = (byClass[r[F.objectClass]] ?? 0) + 1;
  check(JSON.stringify(byClass) === JSON.stringify(Object.fromEntries(Object.keys(catalog.counts.byClass).filter((k) => catalog.counts.byClass[k]).map((k) => [k, catalog.counts.byClass[k]]))) || Object.keys(byClass).every((k) => byClass[k] === catalog.counts.byClass[k]), 'catalog.counts.byClass matches rows');
  const sumReg = Object.values(summary.counts.byRegime).reduce((a, b) => a + b, 0);
  check(sumReg === rows.length, `sum(byRegime) ${sumReg} === rows`);
  const S = summary.altitudeShells;
  const nb = S.edgesKm.length - 1;
  let shellOk = true;
  for (let b = 0; b < nb; b += 1) {
    const sum = ['payload', 'rocket-body', 'debris', 'unknown'].reduce((a, k) => a + S.countsByMeanAltitude[k][b], 0);
    if (sum !== S.countsByMeanAltitude.total[b]) shellOk = false;
    if (S.countsByMeanAltitude.activePayload[b] > S.countsByMeanAltitude.payload[b]) shellOk = false;
    for (const k of S.series) if (!Number.isFinite(S.spatialDensityPerKm3[k][b])) shellOk = false;
  }
  check(shellOk && nb === 36, 'altitude shells: 36 bins, class series sum to total, activePayload <= payload, densities finite');
  check(Object.keys(catalog.dockedTo).every((k) => seen.has(k) && seen.has(catalog.dockedTo[k])), `dockedTo map (${Object.keys(catalog.dockedTo).length}) references rows that exist`);
  const gpRows = rows.filter((r) => r[F.hasElements]);
  check(gpRows.length === catalog.counts.withElements, `withElements count ${gpRows.length}`);

  // ---- 3. spot checks against published values -------------------------------------------------
  console.log('3. spot checks (expected values and sources in docs/data/orbital.md)');
  const row = (id) => rows.find((r) => r[F.norad] === id);
  const get = (id) => { const r = row(id); return r ? Object.fromEntries(catalog.fields.map((f, i) => [f, r[i]])) : null; };
  const near = (x, lo, hi) => x !== null && x >= lo && x <= hi;
  const spot = [];
  const spotCheck = (id, label, conds) => {
    const o = get(id);
    if (!o) { fail(`${label} (${id}) missing`); return; }
    const res = conds.map(([desc, pass]) => ({ desc, pass: pass(o) }));
    const allOk = res.every((x) => x.pass);
    spot.push({ norad: id, label, ok: allOk, values: { incl: o.inclinationDeg, n: o.meanMotionRevPerDay, perigeeKm: o.perigeeKm, apogeeKm: o.apogeeKm, periodMin: o.periodMin, epochUTC: o.epochUTC } });
    check(allOk, `${label} ${id}: i=${o.inclinationDeg} n=${o.meanMotionRevPerDay} hp=${o.perigeeKm} ha=${o.apogeeKm} P=${o.periodMin} ${res.filter((x) => !x.pass).map((x) => `[${x.desc} FAILED]`).join(' ')}`);
  };
  spotCheck('25544', 'ISS', [['incl 51.64+/-0.1 (NASA)', (o) => near(o.inclinationDeg, 51.54, 51.74)], ['n 15.4-15.6 rev/d', (o) => near(o.meanMotionRevPerDay, 15.4, 15.6)], ['alt 400-430 km', (o) => near(o.perigeeKm, 400, 430) && near(o.apogeeKm, 400, 430)], ['payload, active, stations', (o) => o.objectClass === 'payload' && o.isActive === true && o.groups.includes('stations')]]);
  spotCheck('48274', 'CSS Tianhe', [['incl 41.47+/-0.1 (CMSA)', (o) => near(o.inclinationDeg, 41.37, 41.57)], ['alt 370-400 km', (o) => near(o.perigeeKm, 370, 400) && near(o.apogeeKm, 370, 400)]]);
  spotCheck('20580', 'HST', [['incl 28.47+/-0.05 (NASA)', (o) => near(o.inclinationDeg, 28.42, 28.52)], ['alt 450-540 km', (o) => near(o.perigeeKm, 450, 540)], ['period 93.5-95.5 min', (o) => near(o.periodMin, 93.5, 95.5)]]);
  spotCheck('8820', 'LAGEOS-1', [['incl 109.84+/-0.2 (NASA CDDIS)', (o) => near(o.inclinationDeg, 109.6, 110.0)], ['alt 5800-6000 km', (o) => near(o.perigeeKm, 5800, 6000) && near(o.apogeeKm, 5800, 6000)], ['period ~225 min', (o) => near(o.periodMin, 224, 227)]]);
  spotCheck('5', 'Vanguard 1', [['incl 34.25+/-0.1', (o) => near(o.inclinationDeg, 34.1, 34.4)], ['perigee ~650 km', (o) => near(o.perigeeKm, 600, 700)], ['apogee ~3800 km', (o) => near(o.apogeeKm, 3700, 4000)]]);
  spotCheck('49260', 'Landsat 9', [['incl 98.2+/-0.1 (USGS)', (o) => near(o.inclinationDeg, 98.1, 98.3)], ['alt 700-710 km nominal 705', (o) => near((o.perigeeKm + o.apogeeKm) / 2, 690, 715)]]);
  spotCheck('43013', 'NOAA-20', [['incl 98.7+/-0.1', (o) => near(o.inclinationDeg, 98.6, 98.9)], ['alt ~824 km', (o) => near((o.perigeeKm + o.apogeeKm) / 2, 815, 835)]]);
  spotCheck('60133', 'GOES-19', [['GEO n 1.0027+/-0.001', (o) => near(o.meanMotionRevPerDay, 1.0017, 1.0037)], ['incl < 0.5', (o) => near(o.inclinationDeg, 0, 0.5)]]);
  spotCheck('27386', 'Envisat', [['incl 98.4+/-0.2', (o) => near(o.inclinationDeg, 98.2, 98.6)], ['alt 740-780 km', (o) => near((o.perigeeKm + o.apogeeKm) / 2, 740, 780)]]);

  // constellation-level checks
  const groupRows = (tag) => gpRows.filter((r) => r[F.groups].includes(tag));
  const frac = (arr, pred) => (arr.length ? arr.filter(pred).length / arr.length : 0);
  const gps = groupRows('gps-ops');
  check(gps.length >= 24 && frac(gps, (r) => near(r[F.meanMotionRevPerDay], 2.0, 2.012)) === 1 && frac(gps, (r) => near(r[F.inclinationDeg], 53, 57.5)) >= 0.95,
    `GPS (${gps.length}): all n in 2.000-2.012 rev/d (semi-synchronous 2.0056), >=95% incl 53-57.5 deg`);
  const geo = groupRows('geo');
  check(geo.length > 300 && frac(geo, (r) => near(r[F.meanMotionRevPerDay], 0.99, 1.01)) >= 0.97,
    `GEO group (${geo.length}): >=97% n within 1.0027+/-0.01 rev/d (${(100 * frac(geo, (r) => near(r[F.meanMotionRevPerDay], 0.99, 1.01))).toFixed(1)}%)`);
  const gal = groupRows('galileo');
  check(gal.length >= 20 && frac(gal, (r) => near(r[F.meanMotionRevPerDay], 1.70, 1.72)) >= 0.9, `Galileo (${gal.length}): >=90% n ~1.705 rev/d (14 h 05 min)`);
  const glo = groupRows('glo-ops');
  check(glo.length >= 20 && frac(glo, (r) => near(r[F.meanMotionRevPerDay], 2.12, 2.14)) >= 0.9 && frac(glo, (r) => near(r[F.inclinationDeg], 63.5, 66.5)) >= 0.9, `GLONASS (${glo.length}): >=90% n ~2.13 rev/d and incl ~64.8`);
  const sl = rows.filter((r) => r[F.groups].includes('starlink'));
  const slAlt = sl.filter((r) => r[F.perigeeKm] !== null).map((r) => (r[F.perigeeKm] + r[F.apogeeKm]) / 2).sort((a, b) => a - b);
  info.starlinkMeanAltitudeKm = { count: sl.length, p10: slAlt[Math.floor(slAlt.length * 0.1)], median: slAlt[Math.floor(slAlt.length / 2)], p90: slAlt[Math.floor(slAlt.length * 0.9)] };
  check(sl.length > 5000 && info.starlinkMeanAltitudeKm.median > 300 && info.starlinkMeanAltitudeKm.median < 600, `Starlink (${sl.length}): median mean altitude ${info.starlinkMeanAltitudeKm.median?.toFixed(0)} km (p10 ${info.starlinkMeanAltitudeKm.p10?.toFixed(0)}, p90 ${info.starlinkMeanAltitudeKm.p90?.toFixed(0)})`);
  const fy = rows.filter((r) => r[F.groups].includes('fengyun-1c-debris'));
  check(fy.length > 1000 && frac(fy, (r) => near(r[F.inclinationDeg], 97, 101)) > 0.95, `Fengyun-1C debris (${fy.length}): >95% incl 97-101 deg (parent 98.8)`);

  // ---- 4. SGP4 propagation -------------------------------------------------------------------
  console.log('4. SGP4 propagation of every GP row (satellite.js)');
  const tRef = new Date(summary.snapshot.gpRetrievedToUTC);
  const tPlus7 = new Date(tRef.getTime() + 7 * 86400000);
  const prop = { ok: 0, failAtRef: 0, failAtPlus7: 0, altMinKm: Infinity, altMaxKm: -Infinity, failedSamples: [] };
  const radiusOf = {};
  for (const r of gpRows) {
    const omm = {
      OBJECT_NAME: r[F.name] ?? 'UNKNOWN', OBJECT_ID: r[F.intlDes] ?? '', EPOCH: r[F.epochUTC],
      MEAN_MOTION: r[F.meanMotionRevPerDay], ECCENTRICITY: r[F.eccentricity], INCLINATION: r[F.inclinationDeg],
      RA_OF_ASC_NODE: r[F.raanDeg], ARG_OF_PERICENTER: r[F.argPerigeeDeg], MEAN_ANOMALY: r[F.meanAnomalyDeg],
      NORAD_CAT_ID: r[F.norad], BSTAR: r[F.bstar], MEAN_MOTION_DOT: r[F.meanMotionDot], MEAN_MOTION_DDOT: r[F.meanMotionDdot],
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
    };
    let satrec;
    try { satrec = satellite.json2satrec(omm); } catch (e) { prop.failAtRef += 1; continue; }
    const pv = satellite.propagate(satrec, tRef);
    if (!pv || !pv.position || !Number.isFinite(pv.position.x)) {
      prop.failAtRef += 1;
      if (prop.failedSamples.length < 10) prop.failedSamples.push(`${r[F.norad]} ${r[F.name]} hp=${r[F.perigeeKm]} n=${r[F.meanMotionRevPerDay]}`);
      continue;
    }
    const { x, y, z } = pv.position;
    const rad = Math.sqrt(x * x + y * y + z * z);
    const alt = rad - 6378.135;
    prop.ok += 1;
    prop.altMinKm = Math.min(prop.altMinKm, alt);
    prop.altMaxKm = Math.max(prop.altMaxKm, alt);
    radiusOf[r[F.norad]] = rad;
    const pv7 = satellite.propagate(satrec, tPlus7);
    if (!pv7 || !pv7.position || !Number.isFinite(pv7.position.x)) prop.failAtPlus7 += 1;
  }
  info.sgp4 = { ...prop, altMinKm: Number(prop.altMinKm.toFixed(1)), altMaxKm: Number(prop.altMaxKm.toFixed(1)), referenceTimeUTC: tRef.toISOString() };
  check(prop.failAtRef <= Math.max(10, gpRows.length * 0.002), `SGP4 at snapshot time: ${prop.ok} ok, ${prop.failAtRef} failed (decayed-in-model) ${prop.failedSamples.slice(0, 3).join('; ')}`);
  ok(`SGP4 at snapshot+7 d: ${prop.failAtPlus7} additional failures (expected: low decaying objects)`);
  const issR = radiusOf['25544'] - 6378.135;
  check(issR > 395 && issR < 440, `ISS propagated altitude ${issR.toFixed(1)} km (expected ~410-425)`);
  const gpsR = gps.map((r) => radiusOf[r[F.norad]]).filter(Boolean);
  check(gpsR.every((x) => x > 25900 && x < 27200), `GPS propagated radii ${Math.min(...gpsR).toFixed(0)}-${Math.max(...gpsR).toFixed(0)} km (a = 26,560 km)`);
  const geoR = geo.map((r) => radiusOf[r[F.norad]]).filter(Boolean);
  check(frac(geoR, (x) => x > 41900 && x < 42450) >= 0.97, `GEO propagated radii within 41,900-42,450 km for ${(100 * frac(geoR, (x) => x > 41900 && x < 42450)).toFixed(1)}% (a = 42,164 km)`);

  // ---- 5. apsis method vs SATCAT -----------------------------------------------------------------
  console.log('5. GP-derived apsides vs SATCAT APOGEE/PERIGEE');
  if (existsSync(SATCAT_REQUEST.file)) {
    const sat = new Map(csvRecords(await readFile(SATCAT_REQUEST.file, 'utf8'), [], 'satcat').records.map((r) => [normNorad(r.NORAD_CAT_ID), r]));
    const dB = [];
    const dK = [];
    const dP = [];
    for (const r of gpRows) {
      const s = sat.get(r[F.norad]);
      if (!s || num(s.APOGEE) === null || num(s.PERIGEE) === null) continue;
      const b = shapeFromGp(r[F.meanMotionRevPerDay], r[F.eccentricity], r[F.inclinationDeg]);
      const k = shapeFromGpKepler(r[F.meanMotionRevPerDay], r[F.eccentricity]);
      if ((b.apogeeKm + b.perigeeKm) / 2 > 2000) continue; // compare in LEO where the method difference matters most
      dB.push(Math.abs(b.perigeeKm - num(s.PERIGEE)) + Math.abs(b.apogeeKm - num(s.APOGEE)));
      dK.push(Math.abs(k.perigeeKm - num(s.PERIGEE)) + Math.abs(k.apogeeKm - num(s.APOGEE)));
      if (num(s.PERIOD) !== null) dP.push(Math.abs(r[F.periodMin] - num(s.PERIOD)));
    }
    const med = (a) => { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    info.apsisMethodCheck = {
      comparedLeoObjects: dB.length,
      medianAbsDiffSumKm_brouwerSgp4: Number(med(dB).toFixed(2)),
      medianAbsDiffSumKm_keplerKozai: Number(med(dK).toFixed(2)),
      medianAbsPeriodDiffMin: Number(med(dP).toFixed(3)),
      note: 'sum |dPerigee|+|dApogee| vs SATCAT (integer km, possibly older element set)',
    };
    ok(`LEO objects compared: ${dB.length}; median |dhp|+|dha| Brouwer(SGP4) ${info.apsisMethodCheck.medianAbsDiffSumKm_brouwerSgp4} km vs Kepler(Kozai n) ${info.apsisMethodCheck.medianAbsDiffSumKm_keplerKozai} km; median |dP| ${info.apsisMethodCheck.medianAbsPeriodDiffMin} min`);
    check(med(dB) < 10, 'GP-derived apsides agree with SATCAT to < 10 km (median)');
  } else warn('raw SATCAT not cached; skipped apsis method check');

  // ---- 6. counts plausibility --------------------------------------------------------------------
  console.log('6. counts vs reference figures');
  const ref = summary.referenceFigures.celestrakBoxscore;
  const inSat = summary.counts.inSatcat;
  check(inSat + summary.counts.excluded.satcatOnOrbitButNotEarthCentred === ref.onOrbitTotal,
    `SATCAT Earth-orbit rows ${inSat} + non-Earth ${summary.counts.excluded.satcatOnOrbitButNotEarthCentred} === CelesTrak boxscore on-orbit ${ref.onOrbitTotal}`);
  check(Math.abs(summary.counts.activePayloads - ref.activePayloads) / ref.activePayloads < 0.02,
    `active payloads ${summary.counts.activePayloads} within 2% of boxscore ${ref.activePayloads} (boxscore includes deep-space payloads)`);
  const esa = summary.referenceFigures.esaSpaceDebrisByTheNumbers;
  check(rows.length < esa.regularlyTrackedAndCatalogued && rows.length > 0.6 * esa.regularlyTrackedAndCatalogued,
    `catalog rows ${rows.length} are 60-100% of ESA "regularly tracked" ${esa.regularlyTrackedAndCatalogued} (ESA includes non-public objects)`);
  info.counts = { rows: rows.length, withElements: catalog.counts.withElements, satcatShapeOnly: catalog.counts.satcatShapeOnly, noOrbitData: catalog.counts.noOrbitData, byClass: catalog.counts.byClass };

  // ---- 7. manifest + budget ----------------------------------------------------------------------
  console.log('7. manifest & output budget');
  const REQUIRED = ['id', 'name', 'organization', 'purpose', 'mechanism', 'endpoint', 'query', 'version', 'retrieved', 'license', 'licenseUrl', 'citation', 'rateLimits', 'fieldsUsed', 'updateCadence', 'cachePolicy', 'normalization', 'fallback', 'files', 'limitations', 'provenanceClass'];
  check(manifest.domain === 'orbital' && Array.isArray(manifest.datasets) && manifest.datasets.length >= 1, 'manifest domain/datasets');
  for (const d of manifest.datasets) {
    const missing = REQUIRED.filter((k) => !(k in d));
    check(missing.length === 0 && /^[a-z0-9]+(-[a-z0-9]+)*$/.test(d.id) && ['observed', 'derived', 'reconstructed', 'illustrative'].includes(d.provenanceClass) && !Number.isNaN(Date.parse(d.retrieved)), `dataset ${d.id}: all keys present${missing.length ? ` (missing ${missing})` : ''}`);
    for (const f of d.files) {
      const p = `${ROOT}/public/${f.path}`;
      const sz = existsSync(p) ? (await stat(p)).size : -1;
      check(sz === f.bytes, `  file ${f.path} exists with bytes ${f.bytes}`);
    }
    if (!existsSync(`${ROOT}/${d.normalization}`)) fail(`normalization script ${d.normalization} missing`);
  }
  let total = 0;
  for (const f of ['catalog.json', 'summary.json', 'lookups.json', 'manifest.part.json']) total += (await stat(`${OUT_DIR}/${f}`)).size;
  info.outputBytes = total;
  check(total <= 10_000_000, `output total ${(total / 1e6).toFixed(2)} MB <= 10 MB budget`);

  const report = { generated: isoNow(), passed: failures.length === 0, failures, warnings, spotChecks: spot, info };
  await writeFileAtomic(`${RAW_DIR}/validation-report.json`, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`[orbital/validate] ${failures.length ? 'FAILED' : 'PASSED'}: ${failures.length} failures, ${warnings.length} warnings (report: data-raw/orbital/validation-report.json)`);
  if (failures.length) process.exit(1);
}

main().catch((err) => {
  console.error(`[orbital/validate] ERROR: ${err.stack ?? err.message}`);
  process.exit(1);
});
