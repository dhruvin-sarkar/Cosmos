#!/usr/bin/env node
// Cosmos / AstroNexus — exoplanets domain: offline normalisation phase.
//
// Reads the raw TAP snapshot in data-raw/exoplanets/ (written by fetch.mjs) and writes:
//   public/data/exoplanets/planets.json     one row per confirmed planet (PSCompPars + PS default provenance)
//   public/data/exoplanets/systems.json     one row per host star (derived: 3D ICRS position, host stellar params)
//   public/data/exoplanets/references.json  de-duplicated literature/catalogue references (rows indexed by *_refIdx)
//   public/data/exoplanets/manifest.part.json
// and refreshes the generated schema block in docs/data/exoplanets.md.
//
// No network access. Values are copied from the archive unchanged (numbers re-serialised by
// JSON.stringify, i.e. the shortest round-trip decimal of the archive's value); nothing is invented:
// missing values stay null.
//
// Usage: node scripts/data/exoplanets/build.mjs

import { mkdir, writeFile, readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as C from './config.mjs';
import {
  fail as libFail, loadSnapshot, loadRaw, parseReflink, unknownEntities, nonAnchorRefs, isoDate, isoMonthOrDate, cmpStr,
} from './lib.mjs';

const fail = (m) => libFail('build', m);
const log = (...a) => console.log('[exoplanets/build]', ...a);
const warnings = [];
const warn = (m) => { warnings.push(m); console.warn('[exoplanets/build] WARN:', m); };

const OUT_REL = 'data/exoplanets'; // paths relative to public/
const XYZ_DECIMALS = 6; // derived Cartesian coordinates rounded to 1e-6 pc
const TICV8_POSITION_EPOCH = 2015.5; // see docs: TIC v8 positions in the archive are Gaia DR2-epoch (J2015.5)

// -------------------------------------------------------------------------------------------------
// Field specifications
// -------------------------------------------------------------------------------------------------
const DESC = {
  pl_name: 'Planet name (most commonly used in the literature); unique key',
  pl_letter: 'Planet letter (b, c, ...)',
  hostname: 'Host star name; key into systems.json (hostname field)',
  sy_snum: 'Number of stars in the planetary system',
  sy_pnum: 'Number of confirmed planets in the system (counts planets of all stars of a multiple system, so it can exceed the number of rows with this hostname)',
  sy_mnum: 'Number of moons in the system',
  cb_flag: 'Circumbinary flag: 1 = planet orbits a binary star system, 0 = no',
  pl_controv_flag: 'Controversial flag: 1 = confirmation status has been questioned in the literature, 0 = no',
  discoverymethod: 'Method by which the planet was first identified (e.g. Transit, Radial Velocity, Microlensing, Imaging)',
  disc_year: 'Year of discovery (calendar year)',
  disc_facility: 'Facility (observatory / mission) of the discovery observations',
  disc_refIdx: 'Discovery publication',
  pl_orbper: 'Orbital period',
  pl_orbsmax: 'Orbit semi-major axis (for microlensing and imaging planets often the projected separation)',
  pl_orbeccen: 'Orbital eccentricity',
  pl_orbincl: 'Orbital inclination relative to the plane of the sky (90 deg = edge-on)',
  pl_orblper: 'Argument of periastron (sign/reference conventions vary between references)',
  pl_tranmid: 'Time of conjunction / transit midpoint, as a Julian Date in the time standard given by pl_tranmid_systemref',
  pl_tranmid_systemref: "Time standard of pl_tranmid as given by the archive: 'BJD-TDB', 'BJD', 'BJD-UTC', 'BJD-TT', 'HJD', 'HJD-UTC', 'HJD-TDB', 'JD' or null",
  pl_rade: 'Planet radius',
  pl_bmasse: "Best available planet mass: true mass, minimum mass M*sin(i), or archive estimate from the mass-radius relation (see pl_bmassprov)",
  pl_bmassprov: "Provenance of pl_bmasse: 'Mass' (true mass), 'Msini' (minimum mass), 'Msin(i)/sin(i)' (M*sin(i) divided by a measured sin(i)), 'M-R relationship' (archive estimate from pl_rade using Chen & Kipping 2017; not a measurement)",
  pl_dens: 'Planet bulk density',
  pl_insol: 'Insolation flux relative to the solar flux received by Earth',
  pl_eqt: 'Equilibrium temperature; albedo / heat-redistribution assumptions are those of the cited reference (archive-calculated values assume zero albedo and full redistribution; see docs)',
  st_spectype: 'Host star spectral type (MK classification) as published',
  st_teff: 'Stellar effective temperature',
  st_rad: 'Stellar radius',
  st_mass: 'Stellar mass',
  st_lum: 'Stellar luminosity as log10(L/L_sun)',
  st_met: 'Stellar metallicity',
  st_metratio: "Metallicity ratio used for st_met: '[Fe/H]', '[M/H]' or '[m/H]' (as given by the archive)",
  st_age: 'Stellar age',
  st_logg: 'Stellar surface gravity as log10(g / (cm s^-2))',
  ra: 'Right ascension, ICRS, decimal degrees. Epoch is that of the position source (ra_refIdx): J2015.5 for TIC v8 (about 95% of rows); not propagated to J2000',
  dec: 'Declination, ICRS, decimal degrees (same epoch convention as ra)',
  ra_refIdx: 'Position reference (applies to ra and dec)',
  sy_dist: 'Distance to the planetary system',
  sy_plx: 'Parallax',
  sy_vmag: 'Johnson V magnitude of the system',
  sy_kmag: '2MASS Ks magnitude of the system',
  sy_gaiamag: 'Gaia G magnitude of the system',
  sy_pmra: 'Proper motion in right ascension, mu_alpha* = mu_alpha cos(dec) (verified: hypot(sy_pmra, sy_pmdec) equals the archive total proper motion)',
  sy_pmdec: 'Proper motion in declination',
  ps_pl_refIdx: "Reference of the planet's default parameter set (PS table row with default_flag=1); composite values may come from other references, see the per-parameter *_refIdx",
  ps_st_refIdx: 'Stellar-parameter reference of the default parameter set (PS table, default_flag=1)',
  ps_sy_refIdx: 'System-parameter reference of the default parameter set (PS table, default_flag=1)',
  ps_soltype: "Solution type of the default parameter set: 'Published Confirmed', 'Kepler Project Candidate (q1_q17_dr25_koi)' or 'TESS Project Candidate' (the planet itself is confirmed in all cases)",
  ps_pl_pubdate: 'Publication date of the default reference, ISO-8601 year-month (YYYY-MM) or calendar date (YYYY-MM-DD)',
  ps_releasedate: 'Date the default parameter set was released by the archive, ISO-8601 calendar date (YYYY-MM-DD)',
  ps_rowupdate: 'Date the default parameter set was last updated in the archive, ISO-8601 calendar date (YYYY-MM-DD)',
  sysIdx: 'Row index (0-based) of this planet\'s host in systems.json rows',
};
const STRING_COLS = new Set(['pl_name', 'pl_letter', 'hostname', 'discoverymethod', 'disc_facility', 'pl_tranmid_systemref', 'pl_bmassprov', 'st_spectype', 'st_metratio', 'hd_name', 'hip_name', 'tic_id', 'gaia_dr3_id']);
const INT_COLS = new Set(['sy_snum', 'sy_pnum', 'sy_mnum', 'cb_flag', 'pl_controv_flag', 'disc_year']);

// refIdx resolution is set up after the reference registry is built.
let refIndexOf = null;
const refKey = (p) => `${p.refstr}\u0001${p.label}\u0001${p.url}`;

function planetSpecs() {
  const S = [];
  const arch = (name, extra = {}) => {
    const type = STRING_COLS.has(name) ? 'string' : INT_COLS.has(name) || name.endsWith('lim') ? 'int' : 'number';
    S.push({ name, src: name, type, unit: extra.unit ?? (type === 'string' ? null : C.BASE_UNITS[name] ?? null), desc: extra.desc ?? DESC[name], get: (r) => r[name] });
  };
  const ref = (name, srcCol, desc) => S.push({ name, src: srcCol, type: 'refIdx', unit: C.REF_UNIT, desc, get: (r) => refIndexOf(r[srcCol]) });
  const param = ([col, hasErr, hasLim, refCol]) => {
    arch(col);
    if (hasErr) {
      arch(`${col}err1`, { unit: C.BASE_UNITS[col], desc: `Upper (+) uncertainty of ${col}, same unit (>= 0; null if not given)` });
      arch(`${col}err2`, { unit: C.BASE_UNITS[col], desc: `Lower (-) uncertainty of ${col}, same unit (<= 0; null if not given)` });
    }
    if (hasLim) arch(`${col}lim`, { unit: C.LIM_UNIT, desc: `Limit flag of ${col}` });
    if (refCol) ref(`${col}_refIdx`, refCol, `Reference for ${col} (value, uncertainties and limit flag)`);
  };
  const byName = Object.fromEntries(C.ALL_PARAMS.map((p) => [p[0], p]));
  for (const c of ['pl_name', 'pl_letter', 'hostname', 'sy_snum', 'sy_pnum', 'sy_mnum', 'cb_flag', 'pl_controv_flag', 'discoverymethod', 'disc_year', 'disc_facility']) arch(c);
  ref('disc_refIdx', 'disc_refname', DESC.disc_refIdx);
  for (const p of C.ORBIT_PARAMS) param(p);
  arch('pl_tranmid_systemref');
  param(byName.pl_rade);
  param(byName.pl_bmasse);
  arch('pl_bmassprov');
  for (const c of ['pl_dens', 'pl_insol', 'pl_eqt']) param(byName[c]);
  arch('st_spectype');
  ref('st_spectype_refIdx', 'st_spectype_reflink', 'Reference for st_spectype');
  for (const c of ['st_teff', 'st_rad', 'st_mass', 'st_lum', 'st_met']) param(byName[c]);
  arch('st_metratio');
  for (const c of ['st_age', 'st_logg']) param(byName[c]);
  arch('ra');
  arch('dec');
  ref('ra_refIdx', 'ra_reflink', DESC.ra_refIdx);
  for (const c of C.PLANET_ROW_SYSTEM_PARAMS) param(byName[c]);
  // PS default-parameter-set provenance (joined on pl_name)
  S.push({ name: 'ps_pl_refIdx', src: 'ps.pl_refname', type: 'refIdx', unit: C.REF_UNIT, desc: DESC.ps_pl_refIdx, get: (r, ps) => refIndexOf(ps.pl_refname) });
  S.push({ name: 'ps_st_refIdx', src: 'ps.st_refname', type: 'refIdx', unit: C.REF_UNIT, desc: DESC.ps_st_refIdx, get: (r, ps) => refIndexOf(ps.st_refname) });
  S.push({ name: 'ps_sy_refIdx', src: 'ps.sy_refname', type: 'refIdx', unit: C.REF_UNIT, desc: DESC.ps_sy_refIdx, get: (r, ps) => refIndexOf(ps.sy_refname) });
  S.push({ name: 'ps_soltype', src: 'ps.soltype', type: 'string', unit: null, desc: DESC.ps_soltype, get: (r, ps) => ps.soltype });
  S.push({ name: 'ps_pl_pubdate', src: 'ps.pl_pubdate', type: 'date', unit: 'ISO-8601 date (YYYY-MM or YYYY-MM-DD)', desc: DESC.ps_pl_pubdate, get: (r, ps) => isoMonthOrDate(ps.pl_pubdate) });
  S.push({ name: 'ps_releasedate', src: 'ps.releasedate', type: 'date', unit: 'ISO-8601 date (YYYY-MM-DD)', desc: DESC.ps_releasedate, get: (r, ps) => isoDate(ps.releasedate) });
  S.push({ name: 'ps_rowupdate', src: 'ps.rowupdate', type: 'date', unit: 'ISO-8601 date (YYYY-MM-DD)', desc: DESC.ps_rowupdate, get: (r, ps) => isoDate(ps.rowupdate) });
  S.push({ name: 'sysIdx', src: '(derived)', type: 'int', unit: 'integer row index into systems.json rows', desc: DESC.sysIdx, get: null });
  return S;
}

// systems.json: one record per hostname.
function systemSpecs() {
  const S = [];
  const add = (name, type, unit, desc) => S.push({ name, type, unit, desc });
  add('hostname', 'string', null, 'Host star name (archive hostname); unique key; matches planets.json hostname');
  add('raDeg', 'number', 'deg (ICRS)', 'Right ascension (archive ra), ICRS. Epoch: posEpochJyr');
  add('decDeg', 'number', 'deg (ICRS)', 'Declination (archive dec), ICRS. Epoch: posEpochJyr');
  add('posEpochJyr', 'number', 'Julian year', 'Epoch of raDeg/decDeg: 2015.5 when the position source is TIC v8 (Gaia DR2-based); null = epoch not stated by the source (literature positions, mostly microlensing hosts; proper motions negligible)');
  add('distPc', 'number', 'pc', 'Distance (archive sy_dist)');
  add('distPcErr1', 'number', 'pc', 'Upper (+) uncertainty of distPc (archive sy_disterr1)');
  add('distPcErr2', 'number', 'pc', 'Lower (-) uncertainty of distPc (archive sy_disterr2, <= 0)');
  add('xPc', 'number', 'pc', 'DERIVED ICRS Cartesian x = distPc*cos(dec)*cos(ra) (toward RA=0h, Dec=0); rounded to 1e-6 pc; null if distPc is null');
  add('yPc', 'number', 'pc', 'DERIVED ICRS Cartesian y = distPc*cos(dec)*sin(ra) (toward RA=6h, Dec=0); rounded to 1e-6 pc; null if distPc is null');
  add('zPc', 'number', 'pc', 'DERIVED ICRS Cartesian z = distPc*sin(dec) (toward the north celestial pole); rounded to 1e-6 pc; null if distPc is null');
  add('nPlanets', 'int', 'count', 'Number of planets.json rows with this hostname');
  add('planetRows', 'int[]', 'row indices', 'Indices (0-based) of this host\'s planets in planets.json rows, ordered by orbital period (nulls last); always contiguous and ascending');
  add('sy_snum', 'int', 'count', DESC.sy_snum);
  add('sy_pnum', 'int', 'count', DESC.sy_pnum);
  add('sy_mnum', 'int', 'count', DESC.sy_mnum);
  add('st_spectype', 'string', null, DESC.st_spectype);
  add('st_spectype_refIdx', 'refIdx', C.REF_UNIT, 'Reference for st_spectype');
  for (const [col] of C.STELLAR_PARAMS) {
    add(col, 'number', C.BASE_UNITS[col], DESC[col]);
    add(`${col}err1`, 'number', C.BASE_UNITS[col], `Upper (+) uncertainty of ${col}`);
    add(`${col}err2`, 'number', C.BASE_UNITS[col], `Lower (-) uncertainty of ${col} (<= 0)`);
    add(`${col}lim`, 'int', C.LIM_UNIT, `Limit flag of ${col}`);
    add(`${col}_refIdx`, 'refIdx', C.REF_UNIT, `Reference for ${col}`);
    if (col === 'st_met') add('st_metratio', 'string', null, DESC.st_metratio);
  }
  add('ra_refIdx', 'refIdx', C.REF_UNIT, 'Position reference (raDeg/decDeg)');
  add('sy_dist_refIdx', 'refIdx', C.REF_UNIT, 'Distance reference (distPc)');
  for (const base of ['sy_vmag', 'sy_kmag']) {
    add(base, 'number', C.BASE_UNITS[base], DESC[base]);
    add(`${base}err1`, 'number', C.BASE_UNITS[base], `Upper (+) uncertainty of ${base}`);
    add(`${base}err2`, 'number', C.BASE_UNITS[base], `Lower (-) uncertainty of ${base}`);
    add(`${base}_refIdx`, 'refIdx', C.REF_UNIT, `Reference for ${base}`);
  }
  add('hd_name', 'string', null, "Henry Draper designation, e.g. 'HD 209458' (cross-match key)");
  add('hip_name', 'string', null, "Hipparcos designation, e.g. 'HIP 70890' (cross-match key)");
  add('gaia_dr3_id', 'string', null, "Gaia DR3 designation, e.g. 'Gaia DR3 5853498713190525696' (string: the source_id exceeds 2^53)");
  add('stVarying', 'string[]', null, 'Names of host-level parameters whose central values differ between this host\'s planet rows in PSCompPars (composite table); the value shown is the most frequent one (see docs). Empty array = consistent');
  return S;
}

// -------------------------------------------------------------------------------------------------
function assertType(spec, v, ctx) {
  if (v === null || v === undefined) return null;
  switch (spec.type) {
    case 'string':
      if (typeof v !== 'string') fail(`${ctx}: ${spec.name} expected string, got ${typeof v} (${JSON.stringify(v)})`);
      return v.trim() === '' ? null : v.trim();
    case 'number':
      if (typeof v !== 'number' || !Number.isFinite(v)) fail(`${ctx}: ${spec.name} expected finite number, got ${JSON.stringify(v)}`);
      return v;
    case 'int': case 'refIdx':
      if (typeof v !== 'number' || !Number.isInteger(v)) fail(`${ctx}: ${spec.name} expected integer, got ${JSON.stringify(v)}`);
      return v;
    case 'date':
      if (typeof v !== 'string') fail(`${ctx}: ${spec.name} expected ISO date string`);
      return v;
    default:
      return v;
  }
}

function roundTo(v, d) {
  const f = 10 ** d;
  const r = Math.round(v * f) / f;
  return Object.is(r, -0) ? 0 : r;
}

function relErr(t) {
  const [v, e1, e2] = t;
  if (typeof v !== 'number' || v === 0 || e1 == null || e2 == null) return Infinity;
  return (Math.abs(e1) + Math.abs(e2)) / 2 / Math.abs(v);
}

// Pick the most frequent complete tuple (value, err1, err2, lim, ref[, extra]) among a host's planet rows.
function pickTuple(hostRows, getters) {
  const groups = new Map();
  hostRows.forEach((r, i) => {
    const t = getters.map((g) => g(r));
    if (t[0] == null) return;
    const k = JSON.stringify(t);
    const g = groups.get(k);
    if (g) g.count++;
    else groups.set(k, { t, count: 1, first: i });
  });
  if (!groups.size) return { t: getters.map(() => null), varying: false };
  const arr = [...groups.values()].sort((a, b) => b.count - a.count || relErr(a.t) - relErr(b.t) || a.first - b.first);
  const distinct = new Set([...groups.values()].map((g) => JSON.stringify(g.t[0])));
  return { t: arr[0].t, varying: distinct.size > 1 };
}

function serializeTable(header, rows) {
  if ('rows' in header) throw new Error('header must not contain rows');
  const head = JSON.stringify(header);
  return `${head.slice(0, -1)},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;
}

// -------------------------------------------------------------------------------------------------
async function main() {
  const snap = await loadSnapshot();
  const raw = {};
  for (const name of Object.keys(C.RAW_FILES)) raw[name] = await loadRaw(name);
  const retrieved = snap.files.pscomppars.retrieved;
  const generated = new Date().toISOString();
  log(`snapshot retrieved ${snap.retrievedStart} .. ${snap.retrievedEnd}`);
  // Provenance guard: the cached snapshot must have been made with exactly the queries in config.mjs.
  for (const [name, spec] of Object.entries(C.RAW_FILES)) {
    const used = snap.files?.[name]?.query;
    if (used !== spec.query) fail(`raw snapshot file ${spec.file} was fetched with a different query than config.mjs now defines.\n  snapshot: ${used}\n  config:   ${spec.query}\nRun: node scripts/data/exoplanets/fetch.mjs --refresh`);
  }

  // ---- counts ----
  const one = (name) => {
    const r = raw[name];
    if (r.length !== 1 || typeof r[0].n !== 'number') fail(`${name}: unexpected count response ${JSON.stringify(r)}`);
    return r[0].n;
  };
  const counts = {
    pscompparsRows: one('countPscomppars'),
    psDefaultRows: one('countPsDefault'),
    psDefaultDistinctPlName: one('countPsDefaultDistinct'),
    psDefaultDistinctHostname: one('countPsDefaultHosts'),
    psDefaultBySoltype: Object.fromEntries(raw.countPsDefaultBySoltype.map((r) => [r.soltype, r.n])),
  };
  const cp = raw.pscomppars;
  const psRows = raw.psDefault;
  if (cp.length !== counts.pscompparsRows) fail(`PSCompPars response has ${cp.length} rows but count(*) says ${counts.pscompparsRows} (truncated response?)`);
  if (psRows.length !== counts.psDefaultRows) fail(`PS default response has ${psRows.length} rows but count(*) says ${counts.psDefaultRows}`);
  if (counts.psDefaultRows !== counts.psDefaultDistinctPlName) fail(`PS default rows (${counts.psDefaultRows}) != distinct pl_name (${counts.psDefaultDistinctPlName})`);
  if (cp.length !== counts.psDefaultRows) fail(`PSCompPars rows (${cp.length}) != confirmed count from ps default_flag=1 (${counts.psDefaultRows})`);
  log(`confirmed planets: PSCompPars ${cp.length} = PS default_flag=1 ${counts.psDefaultRows} (distinct names ${counts.psDefaultDistinctPlName})`);

  // ---- schema drift check (units) ----
  const schemaUnits = new Map();
  for (const r of raw.schema) if (String(r.table_name).toLowerCase() === 'pscomppars') schemaUnits.set(String(r.column_name).toLowerCase(), r.unit ?? null);
  for (const [col, aliases] of Object.entries(C.ARCHIVE_UNIT_ALIASES)) {
    const u = schemaUnits.get(col);
    if (!aliases.includes(u ?? null)) warn(`archive unit for ${col} is now ${JSON.stringify(u)} (expected one of ${JSON.stringify(aliases)}); check BASE_UNITS in config.mjs`);
  }

  // ---- key checks ----
  const names = new Set();
  for (const r of cp) {
    for (const c of C.PSCOMPPARS_COLUMNS) if (!(c in r)) fail(`PSCompPars row ${r.pl_name}: missing column ${c}`);
    if (!r.pl_name || !r.hostname) fail(`PSCompPars row without pl_name/hostname: ${JSON.stringify(r).slice(0, 200)}`);
    if (names.has(r.pl_name)) fail(`duplicate pl_name in PSCompPars: ${r.pl_name}`);
    names.add(r.pl_name);
  }
  const psByName = new Map();
  for (const r of psRows) {
    if (r.default_flag !== 1) fail(`PS row ${r.pl_name} has default_flag=${r.default_flag}`);
    if (psByName.has(r.pl_name)) fail(`duplicate default PS row for ${r.pl_name}`);
    psByName.set(r.pl_name, r);
  }
  const missingPs = cp.filter((r) => !psByName.has(r.pl_name)).map((r) => r.pl_name);
  if (missingPs.length) fail(`${missingPs.length} PSCompPars planets have no PS default row: ${missingPs.slice(0, 10).join(', ')}`);
  const hostMismatch = cp.filter((r) => psByName.get(r.pl_name).hostname !== r.hostname).map((r) => r.pl_name);
  if (hostMismatch.length) warn(`${hostMismatch.length} planets have a different hostname in PS default vs PSCompPars: ${hostMismatch.slice(0, 5).join(', ')}`);

  // ---- reference registry ----
  // Only reference columns that are published are registered. Rows are ordered by descending
  // usage count (frequent references get short indices -> smaller files), ties by label.
  const refMap = new Map();
  const register = (html) => {
    const p = parseReflink(html);
    if (!p) return;
    const k = refKey(p);
    const e = refMap.get(k);
    if (e) e.uses++;
    else refMap.set(k, { ...p, kind: p.refstr === 'CALCULATED_VALUE' ? 'calculated' : 'reference', uses: 1 });
  };
  const publishedParams = C.ALL_PARAMS.filter(([col]) => !C.VALIDATION_ONLY_COLUMNS.includes(col));
  const refCols = [C.DISC_REF_COLUMN, 'st_spectype_reflink', 'ra_reflink', ...publishedParams.map((p) => p[3]).filter(Boolean)];
  for (const r of cp) for (const c of refCols) register(r[c]);
  for (const r of psRows) for (const c of ['pl_refname', 'st_refname', 'sy_refname']) register(r[c]);
  const refs = [...refMap.values()].sort((a, b) => b.uses - a.uses || cmpStr(a.label.toLowerCase(), b.label.toLowerCase()) || cmpStr(a.label, b.label) || cmpStr(String(a.refstr), String(b.refstr)) || cmpStr(String(a.url), String(b.url)));
  const refIdxByKey = new Map(refs.map((r, i) => [refKey(r), i]));
  refIndexOf = (html) => {
    const p = parseReflink(html);
    if (!p) return null;
    const i = refIdxByKey.get(refKey(p));
    if (i === undefined) throw new Error(`reference not registered: ${html}`);
    return i;
  };
  const calculatedRefIdx = refs.findIndex((r) => r.kind === 'calculated');
  if (unknownEntities.size) warn(`unknown HTML entities left undecoded in reference labels: ${[...unknownEntities.keys()].join(', ')}`);
  if (nonAnchorRefs.size) warn(`${nonAnchorRefs.size} reference values were not HTML anchors (kept as plain labels without URL): ${[...nonAnchorRefs.keys()].slice(0, 3).join(' | ')}`);
  log(`references: ${refs.length} distinct (calculated-value ref index ${calculatedRefIdx})`);

  // ---- planets ----
  const PS = planetSpecs();
  // hostname (code-point order), then period ascending (nulls last), then semi-major axis, then name.
  const sorted = [...cp].sort((a, b) => {
    const h = cmpStr(a.hostname, b.hostname);
    if (h) return h;
    for (const k of ['pl_orbper', 'pl_orbsmax']) {
      const av = a[k], bv = b[k];
      if (av == null && bv == null) continue;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) return av - bv;
    }
    return cmpStr(a.pl_name, b.pl_name);
  });

  const hostOrder = [];
  const hostIdx = new Map();
  for (const r of sorted) if (!hostIdx.has(r.hostname)) { hostIdx.set(r.hostname, hostOrder.length); hostOrder.push(r.hostname); }

  const planetRows = sorted.map((r) => {
    const ps = psByName.get(r.pl_name);
    return PS.map((spec) => {
      if (spec.name === 'sysIdx') return hostIdx.get(r.hostname);
      let v;
      try { v = spec.get(r, ps); } catch (e) { fail(`${r.pl_name}: ${spec.name}: ${e.message}`); }
      return assertType(spec, v, r.pl_name);
    });
  });
  const pIdx = Object.fromEntries(PS.map((s, i) => [s.name, i]));

  // ---- systems ----
  const SS = systemSpecs();
  const byHost = new Map();
  sorted.forEach((r, i) => {
    if (!byHost.has(r.hostname)) byHost.set(r.hostname, { rows: [], idx: [] });
    byHost.get(r.hostname).rows.push(r);
    byHost.get(r.hostname).idx.push(i);
  });
  const refG = (col) => (r) => refIndexOf(r[col]);
  const colG = (col) => (r) => r[col];
  const posSrcTic = (r) => {
    const p = parseReflink(r.ra_reflink);
    return p && p.refstr === 'STASSUN_ET_AL__2019' && /^TICv8$/i.test(p.label);
  };
  let varyingHosts = 0;
  const varyingCounts = {};
  const systemRows = hostOrder.map((h) => {
    const { rows: hr, idx } = byHost.get(h);
    const varying = [];
    const pick = (label, getters) => {
      const res = pickTuple(hr, getters);
      if (res.varying) { varying.push(label); varyingCounts[label] = (varyingCounts[label] || 0) + 1; }
      return res.t;
    };
    const [ra, dec, raRef] = pick('ra/dec', [colG('ra'), colG('dec'), refG('ra_reflink')]);
    const [dist, de1, de2, distRef] = pick('sy_dist', [colG('sy_dist'), colG('sy_disterr1'), colG('sy_disterr2'), refG('sy_dist_reflink')]);
    let x = null, y = null, z = null;
    if (dist != null && ra != null && dec != null) {
      const a = (ra * Math.PI) / 180, d = (dec * Math.PI) / 180;
      x = roundTo(dist * Math.cos(d) * Math.cos(a), XYZ_DECIMALS);
      y = roundTo(dist * Math.cos(d) * Math.sin(a), XYZ_DECIMALS);
      z = roundTo(dist * Math.sin(d), XYZ_DECIMALS);
    }
    const posEpoch = ra == null ? null : (() => {
      const src = hr.find((r) => r.ra === ra && r.dec === dec);
      return src && posSrcTic(src) ? TICV8_POSITION_EPOCH : null;
    })();
    const [snum] = pick('sy_snum', [colG('sy_snum')]);
    const [pnum] = pick('sy_pnum', [colG('sy_pnum')]);
    const [mnum] = pick('sy_mnum', [colG('sy_mnum')]);
    const spec = pick('st_spectype', [colG('st_spectype'), refG('st_spectype_reflink')]);
    const stellar = [];
    for (const [col] of C.STELLAR_PARAMS) {
      const getters = [colG(col), colG(`${col}err1`), colG(`${col}err2`), colG(`${col}lim`), refG(`${col}_reflink`)];
      if (col === 'st_met') getters.push(colG('st_metratio'));
      stellar.push(...pick(col, getters));
    }
    const mags = [];
    for (const b of ['sy_vmag', 'sy_kmag']) mags.push(...pick(b, [colG(b), colG(`${b}err1`), colG(`${b}err2`), refG(`${b}_reflink`)]));
    const ids = ['hd_name', 'hip_name', 'gaia_dr3_id'].map((c) => pick(c, [colG(c)])[0]);
    if (varying.length) varyingHosts++;
    const row = [
      h, ra, dec, posEpoch, dist, de1, de2, x, y, z, idx.length, idx, snum, pnum, mnum,
      ...spec, ...stellar, raRef, distRef, ...mags, ...ids, varying,
    ];
    if (row.length !== SS.length) fail(`internal: systems row length ${row.length} != ${SS.length}`);
    return row.map((v, i) => (SS[i].type === 'int[]' || SS[i].type === 'string[]' ? v : assertType(SS[i], v, h)));
  });
  for (const [h, i] of hostIdx) if (systemRows[i][0] !== h) fail('internal: host index mismatch');
  log(`systems: ${systemRows.length} hosts; ${varyingHosts} hosts have parameters that differ between their planet rows (${JSON.stringify(varyingCounts)})`);

  // ---- references table ----
  const refRows = refs.map((r) => [r.refstr, r.label, r.url, r.kind]);

  // ---- write outputs ----
  await mkdir(C.OUT_DIR, { recursive: true });
  const latestRelease = psRows.map((r) => isoDate(r.releasedate)).filter(Boolean).sort().at(-1);
  const common = {
    schemaVersion: 1,
    domain: C.DOMAIN,
    generated,
    retrieved,
    source: 'NASA Exoplanet Archive (Caltech/IPAC-NExScI, NASA Exoplanet Exploration Program) via IVOA TAP',
    endpoint: C.TAP_SYNC,
    acknowledgement: C.ACKNOWLEDGEMENT,
    citation: `${C.CITATION_PAPER}; PSCompPars table doi:${C.DOI_PSCOMPPARS}; PS table doi:${C.DOI_PS}`,
  };
  const conventions = {
    nulls: 'null = value not available in the archive (never 0, never invented)',
    uncertainties: '<col>err1 = upper (+) uncertainty (>= 0), <col>err2 = lower (-) uncertainty (<= 0), same unit as <col>; null when not reported (archive-calculated values never carry uncertainties)',
    limitFlags: C.LIM_UNIT,
    references: 'Every *_refIdx is a 0-based row index into references.json rows ([refstr, label, url, kind]); kind "calculated" = value computed by the archive (see https://exoplanetarchive.ipac.caltech.edu/docs/pscp_calc.html)',
    dates: 'ISO-8601 calendar dates (UTC date, no time of day); archive time-of-day components (no time zone given) are dropped',
    coordinates: 'ra/dec ICRS decimal degrees; epoch per position source (J2015.5 for TIC v8); not propagated',
    rowOrder: 'rows sorted by hostname (code-point order), then orbital period ascending (nulls last), then semi-major axis, then pl_name; a host\'s planets are contiguous',
    composite: 'PSCompPars values for one planet can come from different references and need not be mutually self-consistent (see docs)',
  };
  const planetsHeader = {
    ...common,
    dataset: 'exoplanets-pscomppars',
    table: 'pscomppars (+ ps where default_flag=1 for ps_* provenance columns)',
    query: C.ADQL.pscomppars,
    psQuery: C.ADQL.psDefault,
    countQuery: C.ADQL.countPsDefault,
    count: planetRows.length,
    confirmedCountCheck: counts.psDefaultRows,
    countChecks: counts,
    latestReleaseDate: latestRelease,
    provenanceClass: 'observed',
    referencesFile: `${OUT_REL}/references.json`,
    systemsFile: `${OUT_REL}/systems.json`,
    calculatedRefIdx,
    conventions,
    fields: PS.map((s) => s.name),
    types: Object.fromEntries(PS.map((s) => [s.name, s.type])),
    units: Object.fromEntries(PS.map((s) => [s.name, s.unit ?? null])),
    descriptions: Object.fromEntries(PS.map((s) => [s.name, s.desc ?? null])),
    sourceColumns: Object.fromEntries(PS.map((s) => [s.name, s.src])),
  };
  const systemsHeader = {
    ...common,
    dataset: 'exoplanets-host-systems',
    derivedFrom: `${OUT_REL}/planets.json`,
    count: systemRows.length,
    provenanceClass: 'derived',
    referencesFile: `${OUT_REL}/references.json`,
    planetsFile: `${OUT_REL}/planets.json`,
    frame: 'ICRS; Cartesian axes: +x toward (RA=0h, Dec=0), +y toward (RA=6h, Dec=0), +z toward the north celestial pole; unit pc; origin = Solar System barycentre (archive distances are heliocentric, difference negligible)',
    selectionRule: 'Host-level values are copied from the host\'s planet rows. If rows disagree (composite table), the most frequent (value, err1, err2, lim, ref) tuple wins; ties -> smaller mean relative uncertainty -> first planet in row order. Disagreeing parameters are listed in stVarying.',
    conventions,
    fields: SS.map((s) => s.name),
    types: Object.fromEntries(SS.map((s) => [s.name, s.type])),
    units: Object.fromEntries(SS.map((s) => [s.name, s.unit ?? null])),
    descriptions: Object.fromEntries(SS.map((s) => [s.name, s.desc ?? null])),
  };
  const refsHeader = {
    ...common,
    dataset: 'exoplanets-references',
    count: refRows.length,
    calculatedRefIdx,
    description: 'De-duplicated references parsed from the archive\'s HTML reference anchors (PSCompPars *_reflink, disc_refname; PS pl_refname/st_refname/sy_refname). Labels are HTML-entity-decoded; relative archive links made absolute. Rows are ordered by descending number of uses in the published files (ties: case-insensitive label); indices are only stable within one snapshot.',
    fields: ['refstr', 'label', 'url', 'kind'],
    types: { refstr: 'string', label: 'string', url: 'string', kind: 'string' },
    units: { refstr: null, label: null, url: null, kind: null },
    descriptions: {
      refstr: "Archive reference key (e.g. 'AGOL_ET_AL__2021', 'STASSUN_ET_AL__2019', 'CALCULATED_VALUE'); not unique on its own (same key can carry different labels, e.g. 'TICv8')",
      label: "Display label (e.g. 'Agol et al. 2021', 'TICv8', 'Q1-Q17 DR25 KOI Table', 'Calculated Value')",
      url: 'Link to the reference (mostly NASA ADS abstract pages); null if none',
      kind: "'reference' (published value: paper or catalogue) or 'calculated' (computed by the archive, no uncertainties)",
    },
  };
  const files = {
    planets: { name: 'planets.json', text: serializeTable(planetsHeader, planetRows), records: planetRows.length },
    systems: { name: 'systems.json', text: serializeTable(systemsHeader, systemRows), records: systemRows.length },
    references: { name: 'references.json', text: serializeTable(refsHeader, refRows), records: refRows.length },
  };
  let total = 0;
  for (const f of Object.values(files)) {
    if (/NaN|Infinity/.test(f.text.replace(/"[^"\n]*"/g, '""'))) fail(`${f.name}: contains NaN/Infinity tokens`);
    JSON.parse(f.text); // must round-trip
    await writeFile(`${C.OUT_DIR}/${f.name}`, f.text);
    f.bytes = Buffer.byteLength(f.text);
    total += f.bytes;
    log(`wrote ${OUT_REL}/${f.name}: ${f.records} records, ${(f.bytes / 1024).toFixed(1)} KiB`);
  }

  // ---- manifest fragment ----
  const nCalcEqt = planetRows.filter((r) => r[pIdx.pl_eqt_refIdx] === calculatedRefIdx).length;
  const nMR = planetRows.filter((r) => r[pIdx.pl_bmassprov] === 'M-R relationship').length;
  const nNoDist = systemRows.filter((r) => r[4] == null).length;
  // Columns fetched only for validation (plx/pm/Gaia G/pl_radj/pl_bmassj/tic_id) are not listed.
  const rawFieldsUsed = [...new Set([...C.PSCOMPPARS_COLUMNS.filter((c) => !C.VALIDATION_ONLY_COLUMNS.includes(c)).map((c) => `pscomppars.${c}`), ...C.PS_DEFAULT_COLUMNS.map((c) => `ps.${c}`)])];
  const citation = `${C.ACKNOWLEDGEMENT} Please cite ${C.CITATION_PAPER}; PSCompPars doi:${C.DOI_PSCOMPPARS}; PS doi:${C.DOI_PS}; and credit the original literature references listed in references.json.`;
  const rateLimits = 'Not documented by the archive (TAP documentation states no limit). This pipeline makes 8 TAP sync requests per refresh, >= 1.5 s apart, with User-Agent identification.';
  const manifest = {
    domain: C.DOMAIN,
    datasets: [
      {
        id: 'exoplanets-pscomppars',
        name: 'NASA Exoplanet Archive: Planetary Systems Composite Parameters (PSCompPars), all confirmed planets, with default-parameter-set provenance from the Planetary Systems (PS) table',
        organization: 'NASA Exoplanet Archive, operated by Caltech/IPAC (NExScI) for the NASA Exoplanet Exploration Program',
        purpose: 'Exoplanet layer, planet/system info panels and habitability-lab inputs: one row per confirmed planet with orbit, radius, mass, density, insolation, equilibrium temperature, host-star parameters, discovery data, uncertainties, limit flags and per-parameter literature references.',
        mechanism: 'IVOA TAP sync, ADQL -> JSON (format=json); raw responses cached gzip-compressed in data-raw/exoplanets; normalised to compact {fields, rows} JSON',
        endpoint: C.TAP_SYNC,
        query: `${C.ADQL.pscomppars} ;; ${C.ADQL.psDefault} ;; ${C.ADQL.countPsDefault}`,
        version: `live archive state at retrieval (latest PS default-row release date ${latestRelease}; ${planetRows.length} confirmed planets = count(*) from ps where default_flag=1)`,
        retrieved,
        license: C.LICENSE_TEXT,
        licenseUrl: C.LICENSE_URL,
        citation,
        rateLimits,
        fieldsUsed: rawFieldsUsed,
        updateCadence: 'Archive is updated weekly (Thursday news/update cycle); this snapshot is refreshed on demand with `node scripts/data/exoplanets/run.mjs --refresh`',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/exoplanets/build.mjs',
        fallback: 'If planets.json is missing or invalid: hide the exoplanet layer and catalogue presets of the habitability lab and show "exoplanet catalogue unavailable"; the lab may still run on user-entered parameters labelled illustrative. Never substitute invented values.',
        files: [
          { path: `${OUT_REL}/planets.json`, bytes: files.planets.bytes, records: files.planets.records },
          { path: `${OUT_REL}/references.json`, bytes: files.references.bytes, records: files.references.records },
        ],
        limitations: `Composite table: a planet's parameters may come from different references and need not be self-consistent (use the PS table for a single consistent solution). pl_eqt assumptions (Bond albedo, heat redistribution) differ by reference: ${nCalcEqt} values were calculated by the archive (zero albedo, full redistribution, no uncertainties), others come from papers or catalogues such as the Kepler DR25 KOI table. ${nMR} masses (pl_bmassprov = 'M-R relationship') are archive estimates from the Chen & Kipping (2017) mass-radius relation, not measurements; pl_bmasse may be a minimum mass (Msini). Archive-calculated values carry no uncertainties. Positions are ICRS at the source epoch (J2015.5 for TIC v8), not propagated. pl_tranmid time standards vary (see pl_tranmid_systemref). Limit-flag semantics (1 = upper limit, -1 = lower limit) were verified empirically (archive docs do not state them); one row carries an undocumented pl_denslim value of 9.`,
        provenanceClass: 'observed',
      },
      {
        id: 'exoplanets-host-systems',
        name: 'Exoplanet host systems (one record per host star) derived from the PSCompPars snapshot',
        organization: 'Derived by the Cosmos/AstroNexus project from NASA Exoplanet Archive data (Caltech/IPAC)',
        purpose: 'Place exoplanet host stars in the 3D star field (ICRS Cartesian parsecs), host-level stellar parameters for system views and the habitability lab, and the index of each host\'s planets in planets.json.',
        mechanism: 'Offline aggregation of the PSCompPars snapshot by hostname + spherical-to-Cartesian conversion (x = d cos(dec) cos(ra), y = d cos(dec) sin(ra), z = d sin(dec))',
        endpoint: C.TAP_SYNC,
        query: C.ADQL.pscomppars,
        version: `derived from the PSCompPars snapshot retrieved ${retrieved}`,
        retrieved,
        license: C.LICENSE_TEXT,
        licenseUrl: C.LICENSE_URL,
        citation,
        rateLimits,
        fieldsUsed: ['pscomppars.hostname', 'pscomppars.ra', 'pscomppars.dec', 'pscomppars.ra_reflink', 'pscomppars.sy_dist', 'pscomppars.sy_disterr1', 'pscomppars.sy_disterr2', 'pscomppars.sy_dist_reflink', 'pscomppars.sy_vmag', 'pscomppars.sy_vmagerr1', 'pscomppars.sy_vmagerr2', 'pscomppars.sy_vmag_reflink', 'pscomppars.sy_kmag', 'pscomppars.sy_kmagerr1', 'pscomppars.sy_kmagerr2', 'pscomppars.sy_kmag_reflink', 'pscomppars.st_spectype', 'pscomppars.st_spectype_reflink', ...C.STELLAR_PARAMS.flatMap(([c]) => [c, `${c}err1`, `${c}err2`, `${c}lim`, `${c}_reflink`].map((x) => `pscomppars.${x}`)), 'pscomppars.st_metratio', 'pscomppars.hd_name', 'pscomppars.hip_name', 'pscomppars.gaia_dr3_id', 'pscomppars.sy_snum', 'pscomppars.sy_pnum', 'pscomppars.sy_mnum'],
        updateCadence: 'Regenerated whenever planets.json is rebuilt',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/exoplanets/build.mjs',
        fallback: 'If systems.json is missing: hosts can be rebuilt client-side by grouping planets.json rows on hostname and converting ra/dec/sy_dist; if both files are missing hide the exoplanet layer.',
        files: [{ path: `${OUT_REL}/systems.json`, bytes: files.systems.bytes, records: files.systems.records }],
        limitations: `xPc/yPc/zPc are derived (not observed) and inherit the archive distance uncertainties; ${nNoDist} hosts have no distance (null coordinates). Host stellar values follow a documented selection rule because composite rows of the same host can disagree (${varyingHosts} hosts; listed per host in stVarying). Positions are at the source epoch (posEpochJyr), not propagated. Distances for microlensing hosts are model-dependent with large uncertainties.`,
        provenanceClass: 'derived',
      },
    ],
  };
  const manifestText = JSON.stringify(manifest, null, 1) + '\n';
  await writeFile(`${C.OUT_DIR}/manifest.part.json`, manifestText);
  total += Buffer.byteLength(manifestText);
  log(`wrote ${OUT_REL}/manifest.part.json; total output ${total} bytes = ${(total / 1e6).toFixed(2)} MB (budget ${(C.OUTPUT_BUDGET_BYTES / 1e6).toFixed(1)} MB, ${((100 * total) / C.OUTPUT_BUDGET_BYTES).toFixed(0)}% used)`);
  if (total > C.OUTPUT_BUDGET_BYTES) fail(`total output ${total} bytes exceeds the ${C.OUTPUT_BUDGET_BYTES}-byte budget`);

  // ---- docs: regenerate schema block ----
  await writeDocsSchema(PS, SS, refsHeader, files, counts, retrieved, latestRelease);
  if (warnings.length) log(`${warnings.length} warning(s):\n  - ${warnings.join('\n  - ')}`);
  log('done');
}

function mdEscape(s) {
  return String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}
function tsType(t) {
  return { string: 'string | null', number: 'number | null', int: 'number | null (integer)', refIdx: 'number | null (integer)', date: 'string | null', 'int[]': 'number[]', 'string[]': 'string[]' }[t] || t;
}
function fieldTable(specs) {
  const lines = ['| # | field | TS type | unit | description |', '|---|---|---|---|---|'];
  specs.forEach((s, i) => lines.push(`| ${i} | \`${s.name}\` | ${tsType(s.type)} | ${mdEscape(s.unit ?? '—')} | ${mdEscape(s.desc)} |`));
  return lines.join('\n');
}

async function writeDocsSchema(PS, SS, refsHeader, files, counts, retrieved, latestRelease) {
  const BEGIN = '<!-- BEGIN GENERATED:SCHEMA (scripts/data/exoplanets/build.mjs) -->';
  const END = '<!-- END GENERATED:SCHEMA -->';
  const refSpecs = refsHeader.fields.map((f) => ({ name: f, type: f === 'url' || f === 'refstr' ? 'string' : 'string', unit: null, desc: refsHeader.descriptions[f] }));
  refSpecs[1].type = 'string';
  const block = [
    BEGIN,
    '',
    `_Generated ${new Date().toISOString()} from the snapshot retrieved ${retrieved} (latest PS default-row release date ${latestRelease})._`,
    '',
    '| file | records | bytes |',
    '|---|---|---|',
    ...Object.values(files).map((f) => `| \`public/data/exoplanets/${f.name}\` | ${f.records} | ${f.bytes} |`),
    '',
    `Count checks: PSCompPars rows = ${counts.pscompparsRows}; \`count(*) from ps where default_flag=1\` = ${counts.psDefaultRows}; distinct pl_name in PS default = ${counts.psDefaultDistinctPlName}; distinct hostname in PS default = ${counts.psDefaultDistinctHostname}; default-set solution types: ${Object.entries(counts.psDefaultBySoltype).map(([k, v]) => `${k} = ${v}`).join(', ')}.`,
    '',
    `### planets.json fields (${PS.length} columns per row, in this order)`,
    '',
    fieldTable(PS),
    '',
    `### systems.json fields (${SS.length} columns per row, in this order)`,
    '',
    fieldTable(SS),
    '',
    `### references.json fields (${refSpecs.length} columns per row)`,
    '',
    fieldTable(refSpecs),
    '',
    END,
  ].join('\n');
  let doc = existsSync(C.DOC_PATH) ? await readFile(C.DOC_PATH, 'utf8') : `# Exoplanets data domain\n\n${BEGIN}\n${END}\n`;
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  if (a < 0 || b < 0 || b < a) {
    doc = `${doc.trimEnd()}\n\n${block}\n`;
  } else {
    doc = doc.slice(0, a) + block + doc.slice(b + END.length);
  }
  await mkdir(C.DOC_PATH.slice(0, C.DOC_PATH.lastIndexOf('/')), { recursive: true });
  await writeFile(C.DOC_PATH, doc);
  log(`docs schema block refreshed in ${C.DOC_PATH}`);
}

main().catch((e) => fail(e.stack || String(e)));
