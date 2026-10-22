#!/usr/bin/env node
// Cosmos — exoplanets domain: offline validation of the published files.
//
// Hard failures (exit code 1): structural/type errors, NaN/Infinity, count mismatches, broken
// indices, coordinate inconsistencies, failed spot checks against published values, budget overrun.
// Warnings: catalogue oddities that are passed through unchanged (e.g. undocumented limit-flag values).
// Writes data-raw/exoplanets/validation-report.json and refreshes the GENERATED:VALIDATION block
// in docs/data/exoplanets.md.
//
// Usage: node scripts/data/exoplanets/validate.mjs

import { readFile, writeFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as C from './config.mjs';
import { loadRaw } from './lib.mjs';

const failures = [];
const warnings = [];
const notes = [];
const F = (m) => { failures.push(m); console.error('[exoplanets/validate] FAIL:', m); };
const W = (m) => { warnings.push(m); console.warn('[exoplanets/validate] WARN:', m); };
const N = (m) => { notes.push(m); console.log('[exoplanets/validate]', m); };

async function loadJson(name) {
  const p = `${C.OUT_DIR}/${name}`;
  if (!existsSync(p)) { F(`missing output ${p}`); return null; }
  const text = await readFile(p, 'utf8');
  try { return { json: JSON.parse(text), bytes: Buffer.byteLength(text), text }; } catch (e) { F(`${name} is not valid JSON: ${e.message}`); return null; }
}

function objRows(t) {
  const idx = Object.fromEntries(t.fields.map((f, i) => [f, i]));
  return { idx, get: (row, f) => row[idx[f]] };
}

const R_SUN_KM = 695700; // IAU 2015 nominal solar radius
const AU_KM = 149597870.7; // IAU 2012
const T_SUN = 5772; // IAU 2015 nominal solar effective temperature
const RJ_OVER_RE = 71492 / 6378.1; // IAU 2015 nominal equatorial radii
const MJ_OVER_ME = 1.2668653e17 / 3.986004e14; // IAU 2015 nominal GM ratio

function stats(arr) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
  return { n: s.length, min: s[0], p50: q(0.5), p95: q(0.95), max: s[s.length - 1] };
}

async function main() {
  const P = await loadJson('planets.json');
  const S = await loadJson('systems.json');
  const Rf = await loadJson('references.json');
  const M = await loadJson('manifest.part.json');
  if (!P || !S || !Rf || !M) return finish();
  const planets = P.json, systems = S.json, refs = Rf.json, manifest = M.json;

  // ---------------- structure & types ----------------
  for (const [name, t] of [['planets.json', planets], ['systems.json', systems], ['references.json', refs]]) {
    if (t.schemaVersion !== 1) F(`${name}: schemaVersion ${t.schemaVersion}`);
    if (!Array.isArray(t.fields) || !Array.isArray(t.rows)) { F(`${name}: missing fields/rows`); continue; }
    if (t.count !== t.rows.length) F(`${name}: count ${t.count} != rows ${t.rows.length}`);
    for (const k of ['generated', 'retrieved']) if (Number.isNaN(Date.parse(t[k]))) F(`${name}: ${k} is not an ISO timestamp`);
    for (const f of t.fields) if (!(f in t.units) || !(f in t.types) || !(f in t.descriptions)) F(`${name}: field ${f} lacks units/types/descriptions entry`);
    let typeErr = 0;
    t.rows.forEach((row, ri) => {
      if (row.length !== t.fields.length) { F(`${name}: row ${ri} has ${row.length} values, expected ${t.fields.length}`); return; }
      row.forEach((v, i) => {
        const ty = t.types[t.fields[i]];
        const ok = ty === 'int[]' ? Array.isArray(v) && v.every(Number.isInteger)
          : ty === 'string[]' ? Array.isArray(v) && v.every((x) => typeof x === 'string')
          : v === null ? true
          : ty === 'string' || ty === 'date' ? typeof v === 'string' && v.length > 0
          : ty === 'number' ? typeof v === 'number' && Number.isFinite(v)
          : ty === 'int' || ty === 'refIdx' ? Number.isInteger(v)
          : false;
        if (!ok && typeErr++ < 10) F(`${name}: row ${ri} field ${t.fields[i]} (${ty}) has bad value ${JSON.stringify(v)}`);
      });
    });
    if (/\bNaN\b|\bInfinity\b/.test(JSON.stringify(t.rows).replace(/"(?:[^"\\]|\\.)*"/g, '""'))) F(`${name}: NaN/Infinity present`);
  }
  if (failures.length) return finish();

  const p = objRows(planets), s = objRows(systems);
  const nP = planets.rows.length, nS = systems.rows.length, nR = refs.rows.length;
  N(`planets ${nP}, systems ${nS}, references ${nR}`);

  // ---------------- counts ----------------
  if (planets.count !== planets.confirmedCountCheck) F(`planets count ${planets.count} != confirmedCountCheck ${planets.confirmedCountCheck}`);
  const cc = planets.countChecks || {};
  if (cc.pscompparsRows !== nP) F(`countChecks.pscompparsRows ${cc.pscompparsRows} != ${nP}`);
  if (cc.psDefaultDistinctPlName !== nP) F(`countChecks.psDefaultDistinctPlName ${cc.psDefaultDistinctPlName} != ${nP}`);
  const soltypeSum = Object.values(cc.psDefaultBySoltype || {}).reduce((a, b) => a + b, 0);
  if (soltypeSum !== nP) F(`sum of default-set soltypes ${soltypeSum} != ${nP}`);
  N(`confirmed planets: ${nP} (PSCompPars rows) = ${planets.confirmedCountCheck} (count(*) from ps where default_flag=1); brief cited 6,445 on 2026-10-08`);

  // ---------------- keys & joins ----------------
  const names = new Set(planets.rows.map((r) => p.get(r, 'pl_name')));
  if (names.size !== nP) F(`duplicate pl_name values (${nP - names.size})`);
  const hosts = new Set(systems.rows.map((r) => s.get(r, 'hostname')));
  if (hosts.size !== nS) F('duplicate hostnames in systems.json');
  const seen = new Uint8Array(nP);
  let nSum = 0;
  systems.rows.forEach((r, si) => {
    const pr = s.get(r, 'planetRows');
    if (pr.length !== s.get(r, 'nPlanets')) F(`system ${s.get(r, 'hostname')}: nPlanets != planetRows.length`);
    nSum += pr.length;
    pr.forEach((pi, k) => {
      if (pi < 0 || pi >= nP) { F(`system ${si}: planet index ${pi} out of range`); return; }
      if (seen[pi]++) F(`planet row ${pi} referenced by more than one system`);
      if (k && pr[k - 1] + 1 !== pi) F(`system ${s.get(r, 'hostname')}: planetRows not contiguous`);
      const prow = planets.rows[pi];
      if (p.get(prow, 'hostname') !== s.get(r, 'hostname')) F(`planet ${p.get(prow, 'pl_name')} hostname mismatch with its system`);
      if (p.get(prow, 'sysIdx') !== si) F(`planet ${p.get(prow, 'pl_name')} sysIdx ${p.get(prow, 'sysIdx')} != ${si}`);
      if (p.get(prow, 'ra') !== s.get(r, 'raDeg') || p.get(prow, 'dec') !== s.get(r, 'decDeg')) F(`planet ${p.get(prow, 'pl_name')} position differs from its host record`);
      if (p.get(prow, 'sy_dist') !== s.get(r, 'distPc')) F(`planet ${p.get(prow, 'pl_name')} distance differs from its host record`);
    });
  });
  if (nSum !== nP) F(`sum of nPlanets ${nSum} != planets ${nP}`);
  if (seen.some((x) => x === 0)) F('some planet rows are not referenced by any system');

  // ---------------- references ----------------
  const refIdxFieldsP = planets.fields.filter((f) => planets.types[f] === 'refIdx');
  const refIdxFieldsS = systems.fields.filter((f) => systems.types[f] === 'refIdx');
  let badRef = 0;
  for (const [t, o, fields] of [[planets, p, refIdxFieldsP], [systems, s, refIdxFieldsS]]) {
    for (const r of t.rows) for (const f of fields) { const v = o.get(r, f); if (v !== null && (v < 0 || v >= nR)) badRef++; }
  }
  if (badRef) F(`${badRef} refIdx values out of range`);
  const used = new Uint8Array(nR);
  for (const r of planets.rows) for (const f of refIdxFieldsP) { const v = p.get(r, f); if (v !== null) used[v] = 1; }
  for (const r of systems.rows) for (const f of refIdxFieldsS) { const v = s.get(r, f); if (v !== null) used[v] = 1; }
  if (used.some((x) => !x)) W(`${used.filter((x) => !x).length} references are not used by any published field`);
  for (const [i, r] of refs.rows.entries()) {
    const [refstr, label, url, kind] = r;
    if (!label) F(`reference ${i} has empty label`);
    if (url !== null && !/^https?:\/\//.test(url)) F(`reference ${i} url not absolute: ${url}`);
    if (!['reference', 'calculated'].includes(kind)) F(`reference ${i} has kind ${kind}`);
    if (/&[A-Za-z]+;|&#\d+;|&#x[0-9a-f]+;/i.test(label)) W(`reference ${i} label still contains an HTML entity: ${label}`);
  }
  const calc = planets.calculatedRefIdx;
  if (!(calc >= 0 && refs.rows[calc][3] === 'calculated' && refs.rows[calc][0] === 'CALCULATED_VALUE')) F(`calculatedRefIdx ${calc} does not point at the CALCULATED_VALUE reference`);

  // ---------------- value sanity (warnings: passed through unchanged) ----------------
  const limFields = planets.fields.filter((f) => f.endsWith('lim'));
  for (const f of limFields) {
    const odd = planets.rows.filter((r) => { const v = p.get(r, f); return v !== null && ![-1, 0, 1].includes(v); });
    if (odd.length) W(`${f}: ${odd.length} row(s) with undocumented limit value(s) ${[...new Set(odd.map((r) => p.get(r, f)))].join(',')} (${odd.slice(0, 3).map((r) => p.get(r, 'pl_name')).join(', ')})`);
    const base = f.slice(0, -3);
    const nullValFlag = planets.rows.filter((r) => p.get(r, base) === null && p.get(r, f) !== null && p.get(r, f) !== 0).length;
    if (nullValFlag) W(`${f}: ${nullValFlag} rows have a non-zero limit flag but a null value`);
  }
  const errSign = {};
  for (const f of planets.fields.filter((x) => x.endsWith('err1'))) {
    const base = f.slice(0, -4);
    const bad1 = planets.rows.filter((r) => (p.get(r, f) ?? 0) < 0).length;
    const bad2 = planets.rows.filter((r) => (p.get(r, `${base}err2`) ?? 0) > 0).length;
    if (bad1 || bad2) errSign[base] = { negativeErr1: bad1, positiveErr2: bad2 };
  }
  if (Object.keys(errSign).length) W(`uncertainty sign anomalies (passed through): ${JSON.stringify(errSign)}`);
  const ranges = {
    pl_orbper: [0, Infinity, true], pl_orbsmax: [0, Infinity, true], pl_orbeccen: [0, 1, false], pl_orbincl: [0, 180, false],
    pl_rade: [0, Infinity, true], pl_bmasse: [0, Infinity, true], pl_dens: [0, Infinity, true], pl_insol: [0, Infinity, true],
    pl_eqt: [0, Infinity, true], st_teff: [0, 100000, true], st_rad: [0, Infinity, true], st_mass: [0, Infinity, true],
    st_age: [0, 20, false], st_logg: [-1, 10, false], sy_dist: [0, Infinity, true], ra: [0, 360, false], dec: [-90, 90, false],
  };
  const outOfRange = {};
  for (const [f, [lo, hi, openLo]] of Object.entries(ranges)) {
    const bad = planets.rows.filter((r) => { const v = p.get(r, f); return v !== null && (openLo ? v <= lo : v < lo) || (v !== null && v > hi); });
    if (bad.length) outOfRange[f] = { n: bad.length, examples: bad.slice(0, 3).map((r) => `${p.get(r, 'pl_name')}=${p.get(r, f)}`) };
  }
  if (outOfRange.ra || outOfRange.dec) F(`coordinates out of range: ${JSON.stringify({ ra: outOfRange.ra, dec: outOfRange.dec })}`);
  if (outOfRange.sy_dist) F(`non-positive distances: ${JSON.stringify(outOfRange.sy_dist)}`);
  if (outOfRange.pl_orbper) F(`non-positive periods: ${JSON.stringify(outOfRange.pl_orbper)}`);
  const softRange = Object.fromEntries(Object.entries(outOfRange).filter(([k]) => !['ra', 'dec', 'sy_dist', 'pl_orbper'].includes(k)));
  if (Object.keys(softRange).length) W(`physically odd values passed through unchanged: ${JSON.stringify(softRange)}`);
  else N('physical range checks: no out-of-range values');
  const eccOne = planets.rows.filter((r) => p.get(r, 'pl_orbeccen') !== null && p.get(r, 'pl_orbeccen') >= 1).length;
  if (eccOne) W(`${eccOne} planets with eccentricity >= 1`);

  // ---------------- coordinate consistency (derived xyz) ----------------
  let xyzBad = 0, xyzNull = 0, maxDr = 0, maxDang = 0;
  for (const r of systems.rows) {
    const d = s.get(r, 'distPc'), ra = s.get(r, 'raDeg'), de = s.get(r, 'decDeg');
    const x = s.get(r, 'xPc'), y = s.get(r, 'yPc'), z = s.get(r, 'zPc');
    if (d === null) { if (x !== null || y !== null || z !== null) F(`${s.get(r, 'hostname')}: xyz without distance`); xyzNull++; continue; }
    if (x === null || y === null || z === null) { F(`${s.get(r, 'hostname')}: distance without xyz`); continue; }
    const rr = Math.hypot(x, y, z);
    const dr = Math.abs(rr - d);
    maxDr = Math.max(maxDr, dr);
    if (dr > 2e-6 + 1e-12 * d) xyzBad++;
    if (d >= 0.5) {
      let ra2 = (Math.atan2(y, x) * 180) / Math.PI; if (ra2 < 0) ra2 += 360;
      const de2 = (Math.asin(Math.max(-1, Math.min(1, z / rr))) * 180) / Math.PI;
      let dra = Math.abs(ra2 - ra); if (dra > 180) dra = 360 - dra;
      const dang = Math.max(dra * Math.cos((de * Math.PI) / 180), Math.abs(de2 - de));
      maxDang = Math.max(maxDang, dang);
      if (dang > 1e-3) xyzBad++;
    }
  }
  if (xyzBad) F(`${xyzBad} hosts with xyz inconsistent with ra/dec/dist`);
  N(`xyz check: max |r - distPc| = ${maxDr.toExponential(2)} pc, max angular error = ${maxDang.toExponential(2)} deg; ${xyzNull} hosts without distance (null xyz)`);

  // ---------------- spot checks against published values ----------------
  const byName = new Map(planets.rows.map((r) => [p.get(r, 'pl_name'), r]));
  const sysOf = (r) => systems.rows[p.get(r, 'sysIdx')];
  const spot = [];
  const check = (label, actual, expected, tol, source) => {
    const ok = actual !== null && actual !== undefined && (typeof expected === 'number' ? Math.abs(actual - expected) <= tol : actual === expected);
    spot.push({ check: label, actual, expected, tolerance: typeof expected === 'number' ? tol : null, source, ok });
    if (!ok) F(`spot check failed: ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}${typeof expected === 'number' ? ` +/- ${tol}` : ''} (${source})`);
  };
  // TRAPPIST-1 — Agol et al. 2021, PSJ 2, 1 (transit-timing periods, days)
  const agol = { b: 1.510826, c: 2.421937, d: 4.049219, e: 6.101013, f: 9.20754, g: 12.352446, h: 18.772866 };
  const t1 = planets.rows.filter((r) => p.get(r, 'hostname') === 'TRAPPIST-1');
  check('TRAPPIST-1 planet count', t1.length, 7, 0, 'Gillon et al. 2017; Agol et al. 2021');
  for (const [l, per] of Object.entries(agol)) {
    const r = byName.get(`TRAPPIST-1 ${l}`);
    check(`TRAPPIST-1 ${l} period [d]`, r ? p.get(r, 'pl_orbper') : null, per, 0.001, 'Agol et al. 2021, PSJ 2, 1');
  }
  const t1s = systems.rows.find((r) => s.get(r, 'hostname') === 'TRAPPIST-1');
  check('TRAPPIST-1 nPlanets (systems.json)', t1s ? s.get(t1s, 'nPlanets') : null, 7, 0, 'systems.json');
  check('TRAPPIST-1 distance [pc]', t1s ? s.get(t1s, 'distPc') : null, 12.43, 0.2, 'Gaia DR2 parallax 80.45 mas (Gaia Collaboration 2018)');
  check('TRAPPIST-1 Teff [K]', t1s ? s.get(t1s, 'st_teff') : null, 2566, 150, 'Agol et al. 2021 (2566 +/- 26 K)');
  // Proxima Cen b — Anglada-Escude et al. 2016 (P = 11.186 d); Faria et al. 2022 (11.18418 d); Suarez Mascareno et al. 2025
  const prox = byName.get('Proxima Cen b');
  check('Proxima Cen b present', !!prox, true, 0, 'Anglada-Escude et al. 2016, Nature 536, 437');
  if (prox) {
    check('Proxima Cen b period [d]', p.get(prox, 'pl_orbper'), 11.1846, 0.005, 'Faria et al. 2022 (11.18418 d) / Suarez Mascareno et al. 2025 (11.18465 d)');
    check('Proxima Cen b discovery year', p.get(prox, 'disc_year'), 2016, 0, 'Anglada-Escude et al. 2016');
    check('Proxima Cen b discovery method', p.get(prox, 'discoverymethod'), 'Radial Velocity', 0, 'Anglada-Escude et al. 2016');
    check('Proxima Cen b M*sin(i) [M_earth]', p.get(prox, 'pl_bmasse'), 1.07, 0.2, 'Faria et al. 2022 (1.07 +/- 0.06)');
    const ps = sysOf(prox);
    check('Proxima Cen distance [pc]', s.get(ps, 'distPc'), 1.302, 0.005, 'Gaia DR3 parallax 768.07 mas -> 1.302 pc');
    check('Proxima Cen RA [deg]', s.get(ps, 'raDeg'), 217.42894, 0.05, 'SIMBAD ICRS J2000 14h29m42.95s (pm moves it ~1 arcmin by J2015.5)');
    check('Proxima Cen Dec [deg]', s.get(ps, 'decDeg'), -62.67949, 0.05, 'SIMBAD ICRS J2000 -62d40m46.2s');
  }
  // Kepler-186 f — Quintana et al. 2014, Science 344, 277: P = 129.9444 d, Rp = 1.11 +/- 0.14 R_earth
  const k186 = byName.get('Kepler-186 f');
  check('Kepler-186 f present', !!k186, true, 0, 'Quintana et al. 2014');
  if (k186) {
    check('Kepler-186 f period [d]', p.get(k186, 'pl_orbper'), 129.9444, 0.01, 'Quintana et al. 2014 (129.9444 +/- 0.0007 d)');
    check('Kepler-186 f radius [R_earth]', p.get(k186, 'pl_rade'), 1.15, 0.25, 'Quintana et al. 2014 (1.11 +/- 0.14); Torres et al. 2015 (1.17 +/- 0.08)');
    check('Kepler-186 f discovery year', p.get(k186, 'disc_year'), 2014, 0, 'Quintana et al. 2014');
    check('Kepler-186 nPlanets', s.get(sysOf(k186), 'nPlanets'), 5, 0, 'Quintana et al. 2014 (five planets)');
  }
  // TOI-700 d — Gilbert et al. 2020 (P = 37.4260 d, Rp = 1.19); Gilbert et al. 2023 (37.42396 d, 1.073 R_earth)
  const toi = byName.get('TOI-700 d');
  check('TOI-700 d present', !!toi, true, 0, 'Gilbert et al. 2020, AJ 160, 116');
  if (toi) {
    check('TOI-700 d period [d]', p.get(toi, 'pl_orbper'), 37.424, 0.01, 'Gilbert et al. 2020 (37.4260 d) / 2023 (37.42396 d)');
    check('TOI-700 d radius [R_earth]', p.get(toi, 'pl_rade'), 1.13, 0.2, 'Gilbert et al. 2020 (1.19 +/- 0.11) / 2023 (1.073 +/- 0.059)');
    check('TOI-700 distance [pc]', s.get(sysOf(toi), 'distPc'), 31.1, 0.5, 'Gaia DR2 (31.13 pc), Gilbert et al. 2020');
    check('TOI-700 d discovery year', p.get(toi, 'disc_year'), 2020, 0, 'Gilbert et al. 2020');
  }
  // 51 Peg b — Mayor & Queloz 1995 (P = 4.2293 d); Butler et al. 2006 (P = 4.230785 d, M sin i = 0.472 M_J = 150 M_earth)
  const peg = byName.get('51 Peg b');
  check('51 Peg b present', !!peg, true, 0, 'Mayor & Queloz 1995, Nature 378, 355');
  if (peg) {
    check('51 Peg b period [d]', p.get(peg, 'pl_orbper'), 4.2308, 0.002, 'Butler et al. 2006 (4.230785 d)');
    { const m = p.get(peg, 'pl_bmasse'), inc = p.get(peg, 'pl_orbincl'); check('51 Peg b M sin i [M_earth] (= mass*sin(i); archive default is now the true mass with i)', m != null && inc != null ? m * Math.sin(inc * Math.PI / 180) : m, 148, 20, 'Butler et al. 2006 M sin i = 0.472 M_J = 150 M_earth'); }
    check('51 Peg b discovery year', p.get(peg, 'disc_year'), 1995, 0, 'Mayor & Queloz 1995');
    check('51 Peg b discovery method', p.get(peg, 'discoverymethod'), 'Radial Velocity', 0, 'Mayor & Queloz 1995');
    const ps = sysOf(peg);
    check('51 Peg distance [pc]', s.get(ps, 'distPc'), 15.4, 0.3, 'Gaia DR2/DR3 parallax 64.6-65.1 mas');
    check('51 Peg RA [deg]', s.get(ps, 'raDeg'), 344.36659, 0.05, 'SIMBAD ICRS J2000 22h57m27.98s');
    check('51 Peg Dec [deg]', s.get(ps, 'decDeg'), 20.76883, 0.05, 'SIMBAD ICRS J2000 +20d46m07.8s');
    const x = s.get(ps, 'xPc'), y = s.get(ps, 'yPc'), z = s.get(ps, 'zPc'), d = s.get(ps, 'distPc');
    const a = (344.36659 * Math.PI) / 180, de = (20.76883 * Math.PI) / 180;
    check('51 Peg xPc vs independent calc [pc]', x, d * Math.cos(de) * Math.cos(a), 0.001, 'x = d cos(dec) cos(ra) from SIMBAD position');
    check('51 Peg yPc vs independent calc [pc]', y, d * Math.cos(de) * Math.sin(a), 0.001, 'y = d cos(dec) sin(ra)');
    check('51 Peg zPc vs independent calc [pc]', z, d * Math.sin(de), 0.001, 'z = d sin(dec)');
  }
  N(`spot checks: ${spot.filter((x) => x.ok).length}/${spot.length} passed`);

  // ---------------- archive-calculated values: reproduce with the archive's formulas ----------------
  const isCalc = (r, f) => p.get(r, `${f}_refIdx`) === calc;
  const rel = (a, b) => Math.abs(a - b) / Math.abs(b);
  const reproduce = {};
  const teq = [], lum = [], ins = [], den = [];
  for (const r of planets.rows) {
    const T = p.get(r, 'st_teff'), Rs = p.get(r, 'st_rad'), a = p.get(r, 'pl_orbsmax'), L = p.get(r, 'st_lum');
    if (isCalc(r, 'pl_eqt') && T && Rs && a) teq.push(rel(T * Math.sqrt((Rs * R_SUN_KM) / (2 * a * AU_KM)), p.get(r, 'pl_eqt')));
    if (isCalc(r, 'st_lum') && T && Rs) lum.push(Math.abs(Math.log10(Rs * Rs * (T / T_SUN) ** 4) - L));
    if (isCalc(r, 'pl_insol') && L !== null && a) ins.push(rel(10 ** L / (a * a), p.get(r, 'pl_insol')));
    const m = p.get(r, 'pl_bmasse'), rp = p.get(r, 'pl_rade');
    if (isCalc(r, 'pl_dens') && m && rp) den.push(rel((5.9722e27 * m * 3) / (4 * Math.PI * (6.3781e8 * rp) ** 3), p.get(r, 'pl_dens')));
  }
  const frac = (arr, tol) => arr.length ? +(arr.filter((x) => x <= tol).length / arr.length).toFixed(4) : null;
  reproduce.pl_eqt = { formula: 'Teq = Teff * sqrt(R*/(2a)) (zero albedo, full redistribution), R_sun = 695700 km, au = 149597870.7 km', relDiff: stats(teq), fractionWithin1pct: frac(teq, 0.01) };
  reproduce.st_lum = { formula: 'log10(L/Lsun) = log10((R/Rsun)^2 (Teff/5772 K)^4)', absDiffDex: stats(lum), fractionWithin0p01dex: frac(lum, 0.01) };
  reproduce.pl_insol = { formula: 'S/S_earth = (L/Lsun) / (a/au)^2', relDiff: stats(ins), fractionWithin1pct: frac(ins, 0.01) };
  reproduce.pl_dens = { formula: 'rho = 3M/(4 pi R^3), M_earth = 5.9722e27 g, R_earth = 6.3781e8 cm', relDiff: stats(den), fractionWithin1pct: frac(den, 0.01) };
  N(`calculated-value reproduction: Teq ${reproduce.pl_eqt.fractionWithin1pct} within 1% (n=${teq.length}); L ${reproduce.st_lum.fractionWithin0p01dex} within 0.01 dex (n=${lum.length}); S ${reproduce.pl_insol.fractionWithin1pct} within 1% (n=${ins.length}); rho ${reproduce.pl_dens.fractionWithin1pct} within 1% (n=${den.length})`);

  // ---------------- raw-snapshot cross-checks (unpublished columns) ----------------
  const rawChecks = {};
  try {
    const raw = await loadRaw('pscomppars');
    const rj = raw.filter((r) => r.pl_rade != null && r.pl_radj != null && r.pl_radj >= 0.1).map((r) => rel(r.pl_rade / r.pl_radj, RJ_OVER_RE));
    const mj = raw.filter((r) => r.pl_bmasse != null && r.pl_bmassj != null && r.pl_bmassj >= 0.1).map((r) => rel(r.pl_bmasse / r.pl_bmassj, MJ_OVER_ME));
    const pm = raw.filter((r) => r.sy_pm != null && r.sy_pmra != null && r.sy_pmdec != null).map((r) => Math.abs(Math.hypot(r.sy_pmra, r.sy_pmdec) - r.sy_pm));
    const plx = raw.filter((r) => r.sy_plx > 0 && r.sy_dist > 0 && /TICv8/.test(r.sy_dist_reflink || '')).map((r) => (r.sy_dist * r.sy_plx) / 1000);
    rawChecks.pl_radj_is_unit_conversion = { ratioExpected: RJ_OVER_RE, relDiff: stats(rj) };
    rawChecks.pl_bmassj_is_unit_conversion = { ratioExpected: MJ_OVER_ME, relDiff: stats(mj) };
    rawChecks.pmra_includes_cosdec = { absDiffMasPerYr: stats(pm) };
    rawChecks.dist_times_plx_over_1000_TICv8 = stats(plx);
    if ((rawChecks.pl_radj_is_unit_conversion.relDiff?.p95 ?? 1) > 0.01) W('pl_radj is not a pure conversion of pl_rade for >5% of rows');
    if ((rawChecks.pmra_includes_cosdec.absDiffMasPerYr?.max ?? 1) > 0.1) W('sy_pm != hypot(sy_pmra, sy_pmdec) for some rows');
    N(`raw cross-checks: pl_rade/pl_radj median rel. diff from ${RJ_OVER_RE.toFixed(4)} = ${rawChecks.pl_radj_is_unit_conversion.relDiff?.p50?.toExponential(1)}; |hypot(pmra,pmdec)-pm| max ${rawChecks.pmra_includes_cosdec.absDiffMasPerYr?.max?.toFixed(3)} mas/yr; TICv8 dist*plx/1000 median ${rawChecks.dist_times_plx_over_1000_TICv8?.p50?.toFixed(4)}`);
  } catch (e) {
    W(`raw snapshot cross-checks skipped: ${e.message}`);
  }

  // ---------------- coverage (for app planning) ----------------
  const cov = {};
  for (const f of ['pl_orbper', 'pl_orbsmax', 'pl_orbeccen', 'pl_orbincl', 'pl_orblper', 'pl_tranmid', 'pl_rade', 'pl_bmasse', 'pl_dens', 'pl_insol', 'pl_eqt', 'st_spectype', 'st_teff', 'st_rad', 'st_mass', 'st_lum', 'st_met', 'st_age', 'st_logg', 'sy_dist', 'sy_vmag', 'sy_kmag']) {
    cov[f] = planets.rows.filter((r) => p.get(r, f) !== null).length;
  }
  const countBy = (f) => { const m = {}; for (const r of planets.rows) { const v = p.get(r, f) ?? 'null'; m[v] = (m[v] || 0) + 1; } return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1])); };
  const eqtRef = {};
  for (const r of planets.rows) { const i = p.get(r, 'pl_eqt_refIdx'); const k = i === null ? 'null' : refs.rows[i][1]; eqtRef[k] = (eqtRef[k] || 0) + 1; }
  const eqtTop = Object.fromEntries(Object.entries(eqtRef).sort((a, b) => b[1] - a[1]).slice(0, 6));
  const calcCounts = {};
  for (const f of refIdxFieldsP) { const n = planets.rows.filter((r) => p.get(r, f) === calc).length; if (n) calcCounts[f.replace('_refIdx', '')] = n; }
  const labReady = planets.rows.filter((r) => p.get(r, 'st_teff') !== null && p.get(r, 'st_rad') !== null && p.get(r, 'pl_orbsmax') !== null).length;
  const measuredRM = planets.rows.filter((r) => p.get(r, 'pl_rade') !== null && p.get(r, 'pl_rade_refIdx') !== calc && p.get(r, 'pl_bmasse') !== null && p.get(r, 'pl_bmassprov') === 'Mass').length;
  const multiplicity = {};
  for (const r of systems.rows) { const n = s.get(r, 'nPlanets'); multiplicity[n] = (multiplicity[n] || 0) + 1; }
  const posEpoch = { 'J2015.5 (TIC v8)': systems.rows.filter((r) => s.get(r, 'posEpochJyr') === 2015.5).length, 'not stated': systems.rows.filter((r) => s.get(r, 'posEpochJyr') === null).length };
  const dists = systems.rows.map((r) => s.get(r, 'distPc')).filter((d) => d !== null);
  const coverage = {
    nonNullCounts: cov,
    discoverymethod: countBy('discoverymethod'),
    pl_bmassprov: countBy('pl_bmassprov'),
    pl_tranmid_systemref: countBy('pl_tranmid_systemref'),
    ps_soltype: countBy('ps_soltype'),
    pl_eqt_topReferences: eqtTop,
    archiveCalculatedValueCounts: calcCounts,
    controversialPlanets: planets.rows.filter((r) => p.get(r, 'pl_controv_flag') === 1).length,
    circumbinaryPlanets: planets.rows.filter((r) => p.get(r, 'cb_flag') === 1).length,
    planetsWithTeffRstarA: labReady,
    planetsWithMeasuredRadiusAndTrueMass: measuredRM,
    systemMultiplicity: multiplicity,
    hostsWithVaryingParams: systems.rows.filter((r) => s.get(r, 'stVarying').length).length,
    hostPositionEpoch: posEpoch,
    hostDistancePc: stats(dists),
    hostsWithin10pc: dists.filter((d) => d <= 10).length,
    hostsWithin100pc: dists.filter((d) => d <= 100).length,
    discYearRange: [Math.min(...planets.rows.map((r) => p.get(r, 'disc_year'))), Math.max(...planets.rows.map((r) => p.get(r, 'disc_year')))],
  };
  N(`coverage: Teq-lab inputs (Teff, R*, a) for ${labReady}/${nP} planets; measured radius + true mass for ${measuredRM}; ${coverage.hostsWithin10pc} hosts within 10 pc`);

  // ---------------- budget ----------------
  const files = ['planets.json', 'systems.json', 'references.json', 'manifest.part.json'];
  let total = 0;
  for (const f of files) total += (await stat(`${C.OUT_DIR}/${f}`)).size;
  if (total > C.OUTPUT_BUDGET_BYTES) F(`output ${total} bytes exceeds budget ${C.OUTPUT_BUDGET_BYTES}`);
  N(`output size ${total} bytes (${((100 * total) / C.OUTPUT_BUDGET_BYTES).toFixed(1)}% of ${C.OUTPUT_BUDGET_BYTES})`);
  // manifest files must match disk
  for (const ds of manifest.datasets) for (const f of ds.files) {
    const st = await stat(`${C.REPO_ROOT}/public/${f.path}`).catch(() => null);
    if (!st) F(`manifest file missing: ${f.path}`);
    else if (st.size !== f.bytes) F(`manifest bytes for ${f.path} (${f.bytes}) != disk (${st.size})`);
  }
  const required = ['id', 'name', 'organization', 'purpose', 'mechanism', 'endpoint', 'query', 'version', 'retrieved', 'license', 'licenseUrl', 'citation', 'rateLimits', 'fieldsUsed', 'updateCadence', 'cachePolicy', 'normalization', 'fallback', 'files', 'limitations', 'provenanceClass'];
  for (const ds of manifest.datasets) for (const k of required) if (!(k in ds)) F(`manifest dataset ${ds.id} lacks ${k}`);

  return finish({ spot, reproduce, rawChecks, coverage, total });
}

async function finish(extra = {}) {
  const report = { generated: new Date().toISOString(), ok: failures.length === 0, failures, warnings, notes, ...extra };
  try {
    await writeFile(`${C.RAW_DIR}/validation-report.json`, JSON.stringify(report, null, 1));
  } catch { /* raw dir may not exist on a fresh clone; report is printed anyway */ }
  if (extra.spot) await writeDocsValidation(report).catch((e) => console.warn('[exoplanets/validate] could not update docs:', e.message));
  console.log(`[exoplanets/validate] ${failures.length ? 'FAILED' : 'OK'}: ${failures.length} failure(s), ${warnings.length} warning(s)`);
  process.exit(failures.length ? 1 : 0);
}

async function writeDocsValidation(report) {
  const BEGIN = '<!-- BEGIN GENERATED:VALIDATION (scripts/data/exoplanets/validate.mjs) -->';
  const END = '<!-- END GENERATED:VALIDATION -->';
  const fmt = (v) => (typeof v === 'number' ? String(+v.toPrecision(8)) : JSON.stringify(v));
  const lines = [
    BEGIN, '',
    `_Generated ${report.generated}. Result: **${report.ok ? 'PASS' : 'FAIL'}** (${report.failures.length} failures, ${report.warnings.length} warnings)._`, '',
    '#### Spot checks against published values', '',
    '| check | actual | expected | tolerance | source | ok |', '|---|---|---|---|---|---|',
    ...report.spot.map((x) => `| ${x.check} | ${fmt(x.actual)} | ${fmt(x.expected)} | ${x.tolerance ?? '—'} | ${x.source} | ${x.ok ? 'yes' : '**NO**'} |`),
    '', '#### Archive-calculated values reproduced with the archive formulas', '',
    '| quantity | formula | n | median | 95th pct | max | fraction within tolerance |', '|---|---|---|---|---|---|---|',
    ...Object.entries(report.reproduce).map(([k, v]) => {
      const st = v.relDiff || v.absDiffDex;
      const fr = v.fractionWithin1pct ?? v.fractionWithin0p01dex;
      return `| ${k} | ${v.formula} | ${st?.n ?? 0} | ${st ? st.p50.toExponential(2) : '—'} | ${st ? st.p95.toExponential(2) : '—'} | ${st ? st.max.toExponential(2) : '—'} | ${fr ?? '—'} (${v.fractionWithin1pct !== undefined ? '1%' : '0.01 dex'}) |`;
    }),
    '', '#### Notes', '', ...report.notes.map((n) => `- ${n}`),
    '', '#### Warnings (catalogue oddities passed through unchanged)', '', ...(report.warnings.length ? report.warnings.map((w) => `- ${w}`) : ['- none']),
    '', '#### Coverage summary', '', '```json', JSON.stringify(report.coverage, null, 1), '```', '',
    END,
  ];
  const block = lines.join('\n');
  let doc = existsSync(C.DOC_PATH) ? await readFile(C.DOC_PATH, 'utf8') : '# Exoplanets data domain\n';
  const a = doc.indexOf(BEGIN), b = doc.indexOf(END);
  doc = a < 0 || b < a ? `${doc.trimEnd()}\n\n${block}\n` : doc.slice(0, a) + block + doc.slice(b + END.length);
  await writeFile(C.DOC_PATH, doc);
}

main().catch((e) => { F(e.stack || String(e)); finish(); });
