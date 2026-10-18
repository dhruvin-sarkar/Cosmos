#!/usr/bin/env node
// Build the core "stars" outputs in public/data/stars/ from the cached raw sources in data-raw/stars/.
//
//   node scripts/data/stars/build.mjs
//
// Outputs (schemas: docs/data/stars.md):
//   stars.bin + stars.json      Float32 LE star field [xPc,yPc,zPc,absMagV,colorIndexBV,teffK], brightest first
//   stars-named.json            searchable named / designated / naked-eye stars (+ IAU WGSN cross-check)
//   hip-index.json              {"<HIP>": index into stars.bin}
//   star-systems.json           multiple-star systems from HYG's Gliese component fields
//   constellations.json         88 IAU constellations: names, stick-figure lines, label point, J2000 boundaries

import fs from 'node:fs';
import { log, fail, runMain, RAW_DIR, OUT_DIR, ensureDir, readMeta, readMaybeGz, parseCsv, num, int, str, round, writeJsonCompact } from './lib.mjs';
import { RAW, OUT, PINS, HYG_CITATION, STELLARIUM_CITATION, VI49_CITATION, WGSN_CITATION, IAU_NAMES_CITATION } from './sources.mjs';
import { IAU_CONSTELLATIONS, canonicalAbbr, IAU_CONSTELLATIONS_URL } from './constellation-names.mjs';
import { parseWgsnHtml, parseWgsnLegacyTxt, designationKeys } from './wgsn.mjs';
import { DEG, teffBallesteros, BV_MIN, BV_MAX, unitVec, raDecOf, angleDeg, meanDirection, SphericalRing, bayerFlamsteedDisplay, nameKey } from './astro.mjs';

export const DIST_SENTINEL_PC = 100000; // HYG: dist >= 100000 means missing/dubious parallax
export const NAMED_MAG_LIMIT = 6.5;
export const MAG_LIMITS = [0, 1, 2, 3, 4, 5, 6, 6.5, 7, 7.5, 8, 9, 10, 11, 12];

const FRAME_TEXT =
  'Heliocentric equatorial Cartesian, ICRS-aligned (Hipparcos reference frame), equinox J2000.0, positions at epoch J2000.0 ' +
  '(as propagated by HYG). +X toward RA=0h Dec=0, +Y toward RA=6h Dec=0, +Z toward the north celestial pole. Sun at the origin.';

// ------------------------------------------------------------------ HYG ----

const HYG_REQUIRED = ['id', 'hip', 'hd', 'hr', 'gl', 'bf', 'proper', 'ra', 'dec', 'dist', 'mag', 'absmag', 'spect', 'ci', 'x', 'y', 'z', 'bayer', 'flam', 'con', 'comp', 'comp_primary', 'base', 'lum', 'var'];

export function loadHyg() {
  const file = `${RAW_DIR}/${RAW.hyg}`;
  if (!fs.existsSync(file)) fail(`Missing raw file ${file}. Run: node scripts/data/stars/fetch.mjs`);
  const meta = readMeta(file);
  if (!meta || meta.sha256 !== PINS.hyg.lfsSha256) fail(`${RAW.hyg}: checksum metadata missing or not the pinned HYG v4.4 object.`);
  const { header, rows } = parseCsv(readMaybeGz(file).toString('utf8'));
  const missing = HYG_REQUIRED.filter((k) => !header.includes(k));
  if (missing.length) fail(`HYG CSV is missing columns [${missing.join(', ')}]; header = ${header.join(',')}`);
  const ix = Object.fromEntries(header.map((h, i) => [h, i]));
  const catId = (s) => {
    const v = int(s);
    return v != null && v > 0 ? v : null; // catalogue numbers start at 1; 0/'' = none
  };
  const stars = rows.map((r) => ({
    id: int(r[ix.id]),
    hip: catId(r[ix.hip]),
    hd: catId(r[ix.hd]),
    hr: catId(r[ix.hr]),
    gl: str(r[ix.gl]),
    bf: str(r[ix.bf]),
    proper: str(r[ix.proper]),
    raH: num(r[ix.ra]),
    dec: num(r[ix.dec]),
    dist: num(r[ix.dist]),
    mag: num(r[ix.mag]),
    absmag: num(r[ix.absmag]),
    spect: str(r[ix.spect]),
    ci: num(r[ix.ci]),
    x: num(r[ix.x]),
    y: num(r[ix.y]),
    z: num(r[ix.z]),
    bayer: str(r[ix.bayer]),
    flam: catId(r[ix.flam]),
    con: str(r[ix.con]),
    comp: int(r[ix.comp]),
    compPrimary: int(r[ix.comp_primary]),
    base: str(r[ix.base]),
    lum: num(r[ix.lum]),
    variable: str(r[ix.var]),
  }));
  for (const s of stars) {
    if (s.id == null) fail('HYG row without id');
    s.raDeg = s.raH == null ? null : (((s.raH * 15) % 360) + 360) % 360;
  }
  return { stars, header, meta };
}

const isSun = (s) => s.id === 0 || s.proper === 'Sol';
const hasValidDistance = (s) => s.dist != null && s.dist > 0 && s.dist < DIST_SENTINEL_PC;

// ------------------------------------------------------- WGSN cross-check ----

export function loadWgsn() {
  const htmlFile = `${RAW_DIR}/${RAW.wgsnHtml}`;
  const txtFile = `${RAW_DIR}/${RAW.wgsnLegacyTxt}`;
  try {
    if (!fs.existsSync(htmlFile)) throw new Error('current IAU-CSN page not cached');
    const entries = parseWgsnHtml(fs.readFileSync(htmlFile, 'utf8'));
    return { entries, edition: 'current (live table)', meta: readMeta(htmlFile) };
  } catch (e) {
    log(`WARNING: current IAU-CSN table unusable (${e.message}); falling back to the 2022-04-04 text edition.`);
    if (!fs.existsSync(txtFile)) fail('No usable IAU-CSN source (neither the current page nor the legacy text file is cached).');
    return { entries: parseWgsnLegacyTxt(fs.readFileSync(txtFile, 'utf8')), edition: 'legacy text edition 2022-04-04', meta: readMeta(txtFile) };
  }
}

function glKey(gl) {
  if (!gl) return null;
  const m = /^(?:Gl|GJ|NN|Wo)\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Z]*)/i.exec(gl.trim());
  return m ? `${m[1]}${m[2] || ''}`.toUpperCase() : null;
}

function brightest(list) {
  if (!list || !list.length) return null;
  return list.reduce((a, b) => ((b.mag ?? 99) < (a.mag ?? 99) ? b : a));
}

export function crossMatchWgsn(stars, wgsn) {
  const byHip = new Map();
  const byHr = new Map();
  const byHd = new Map();
  const byGl = new Map();
  const add = (m, k, s) => {
    if (k == null) return;
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(s);
  };
  const candidates = stars.filter((s) => !isSun(s));
  for (const s of candidates) {
    add(byHip, s.hip, s);
    add(byHr, s.hr, s);
    add(byHd, s.hd, s);
    add(byGl, glKey(s.gl), s);
  }
  // Unit vectors for positional matching (only used for entries without catalogue keys).
  const vecs = candidates.map((s) => (s.raDeg == null || s.dec == null ? null : unitVec(s.raDeg, s.dec)));
  const MATCH_RADIUS_ARCSEC = 30;
  const cosR = Math.cos((MATCH_RADIUS_ARCSEC / 3600) * DEG);

  const assigned = new Map(); // HYG id -> { entry, method }
  const methods = { hip: 0, hr: 0, hd: 0, gj: 0, position: 0 };
  const unmatched = [];
  const conflicts = [];
  for (const e of wgsn.entries) {
    const k = designationKeys(e.designation);
    let s = null;
    let method = null;
    const hip = e.hip ?? k.hip;
    if (hip && byHip.has(hip)) [s, method] = [brightest(byHip.get(hip)), 'hip'];
    else if (k.hr && byHr.has(k.hr)) [s, method] = [brightest(byHr.get(k.hr)), 'hr'];
    else if (k.hd && byHd.has(k.hd)) [s, method] = [brightest(byHd.get(k.hd)), 'hd'];
    else if (k.gj && byGl.has(k.gj)) [s, method] = [brightest(byGl.get(k.gj)), 'gj'];
    else if (e.raDeg != null && e.decDeg != null) {
      const p = unitVec(e.raDeg, e.decDeg);
      let best = null;
      let bestCos = cosR;
      for (let i = 0; i < candidates.length; i++) {
        const v = vecs[i];
        if (!v) continue;
        const c = v[0] * p[0] + v[1] * p[1] + v[2] * p[2];
        if (c < bestCos) continue;
        const cs = candidates[i];
        const vband = e.band == null || e.band === 'V';
        if (vband && e.mag != null && cs.mag != null && Math.abs(e.mag - cs.mag) > 2) continue;
        best = cs;
        bestCos = c;
      }
      if (best) [s, method] = [best, 'position'];
    }
    if (!s) {
      unmatched.push({ name: e.name, designation: e.designation, mag: e.mag });
      continue;
    }
    methods[method]++;
    const prev = assigned.get(s.id);
    if (prev) {
      // Two IAU names for one HYG entry (e.g. both components of an unresolved pair share a HIP number):
      // keep the earliest adopted name (normally the primary's).
      const keepPrev = (prev.entry.adopted || '9999') <= (e.adopted || '9999');
      conflicts.push({ hygId: s.id, hip: s.hip, kept: keepPrev ? prev.entry.name : e.name, alsoNamed: keepPrev ? e.name : prev.entry.name });
      if (!keepPrev) assigned.set(s.id, { entry: e, method });
    } else assigned.set(s.id, { entry: e, method });
  }

  const stats = { agree: 0, spellingUpdated: 0, replaced: 0, addedFromWgsn: 0, hygOnly: 0 };
  const replaced = [];
  const spelling = [];
  const added = [];
  const hygOnly = [];
  for (const s of candidates) {
    const a = assigned.get(s.id);
    if (a) {
      const iau = a.entry.name;
      s.properName = iau;
      s.properNameSource = 'iau-wgsn';
      s.wgsnAdopted = a.entry.adopted;
      if (!s.proper) {
        stats.addedFromWgsn++;
        added.push({ hygId: s.id, hip: s.hip, iau, adopted: a.entry.adopted });
      } else if (s.proper === iau) stats.agree++;
      else if (nameKey(s.proper) === nameKey(iau)) {
        stats.spellingUpdated++;
        spelling.push({ hygId: s.id, hip: s.hip, hyg: s.proper, iau });
      } else {
        stats.replaced++;
        replaced.push({ hygId: s.id, hip: s.hip, hyg: s.proper, iau });
      }
    } else if (s.proper) {
      s.properName = s.proper;
      s.properNameSource = 'hyg';
      stats.hygOnly++;
      hygOnly.push({ hygId: s.id, hip: s.hip, hyg: s.proper });
    } else {
      s.properName = null;
      s.properNameSource = null;
    }
  }
  return {
    edition: wgsn.edition,
    wgsnEntries: wgsn.entries.length,
    matched: wgsn.entries.length - unmatched.length,
    matchedBy: methods,
    unmatchedCount: unmatched.length,
    unmatched,
    conflicts,
    ...stats,
    replacedList: replaced,
    spellingList: spelling,
    addedList: added,
    hygOnlyList: hygOnly,
  };
}

// ------------------------------------------------------------ star field ----

export function selectStarField(stars) {
  const excluded = { sun: 0, distanceSentinel: 0, nonPositiveOrMissingDistance: 0, missingApparentMag: 0, missingPosition: 0 };
  const field = [];
  for (const s of stars) {
    if (isSun(s)) excluded.sun++;
    else if (s.raDeg == null || s.dec == null) excluded.missingPosition++;
    else if (s.mag == null) excluded.missingApparentMag++;
    else if (s.dist != null && s.dist >= DIST_SENTINEL_PC) excluded.distanceSentinel++;
    else if (!hasValidDistance(s)) excluded.nonPositiveOrMissingDistance++;
    else field.push(s);
  }
  field.sort((a, b) => a.mag - b.mag || a.id - b.id);
  field.forEach((s, i) => (s.index = i));
  return { field, excluded, excludedCount: Object.values(excluded).reduce((a, b) => a + b, 0) };
}

function writeStarsBin(field, hygMeta) {
  const STRIDE = 6;
  const buf = Buffer.alloc(field.length * STRIDE * 4);
  let teffClamped = 0;
  let nanBV = 0;
  let maxXyzDiff = 0;
  let maxAbsMagDiff = 0;
  for (let i = 0; i < field.length; i++) {
    const s = field[i];
    const [ux, uy, uz] = unitVec(s.raDeg, s.dec);
    const x = s.dist * ux;
    const y = s.dist * uy;
    const z = s.dist * uz;
    if (s.x != null) maxXyzDiff = Math.max(maxXyzDiff, Math.abs(x - s.x), Math.abs(y - s.y), Math.abs(z - s.z));
    const absMag = s.mag - 5 * Math.log10(s.dist / 10);
    s.absMagCalc = absMag;
    if (s.absmag != null) maxAbsMagDiff = Math.max(maxAbsMagDiff, Math.abs(absMag - s.absmag));
    const bv = s.ci;
    if (bv == null) nanBV++;
    else if (bv < BV_MIN || bv > BV_MAX) teffClamped++;
    const teff = teffBallesteros(bv);
    const o = i * STRIDE * 4;
    buf.writeFloatLE(x, o);
    buf.writeFloatLE(y, o + 4);
    buf.writeFloatLE(z, o + 8);
    buf.writeFloatLE(absMag, o + 12);
    buf.writeFloatLE(bv == null ? NaN : bv, o + 16);
    buf.writeFloatLE(teff, o + 20);
  }
  const binPath = `${OUT_DIR}/${OUT.starsBin}`;
  fs.writeFileSync(binPath, buf);

  const dists = field.map((s) => s.dist).sort((a, b) => a - b);
  const magnitudeLimits = MAG_LIMITS.map((lim) => {
    let n = 0;
    while (n < field.length && field[n].mag <= lim) n++;
    return { maxApparentMagV: lim, count: n };
  });
  return { binPath, bytes: buf.length, stride: STRIDE, teffClamped, nanBV, maxXyzDiff, maxAbsMagDiff, magnitudeLimits, dists };
}

// --------------------------------------------------------- named stars ----

const NAMED_FIELDS = [
  'index', 'hip', 'hd', 'hr', 'gl', 'bayerFlamsteed', 'properName', 'constellation', 'spectralType',
  'apparentMag', 'absMag', 'distPc', 'raDeg', 'decDeg', 'colorIndexBV', 'luminositySolar', 'variableName',
  'hygId', 'properNameSource',
];

function sig(v, digits) {
  if (v == null || !Number.isFinite(v)) return null;
  return Number(v.toPrecision(digits));
}

export function buildNamed(stars) {
  const rows = [];
  const reasons = { properName: 0, bayerFlamsteed: 0, gliese: 0, nakedEye: 0 };
  const sel = stars.filter((s) => {
    if (isSun(s)) return false;
    const bfd = bayerFlamsteedDisplay(s.flam, s.bayer, s.con);
    s.bayerFlamsteed = bfd;
    const r = { properName: !!s.properName, bayerFlamsteed: !!bfd, gliese: !!s.gl, nakedEye: s.mag != null && s.mag < NAMED_MAG_LIMIT };
    let any = false;
    for (const k of Object.keys(r)) if (r[k]) {
      reasons[k]++;
      any = true;
    }
    return any;
  });
  sel.sort((a, b) => (a.mag ?? 99) - (b.mag ?? 99) || a.id - b.id);
  let noIndex = 0;
  for (const s of sel) {
    const inField = s.index != null;
    if (!inField) noIndex++;
    rows.push([
      inField ? s.index : null,
      s.hip,
      s.hd,
      s.hr,
      s.gl,
      s.bayerFlamsteed,
      s.properName,
      s.con,
      s.spect,
      round(s.mag, 3),
      inField ? round(s.absMagCalc, 3) : null,
      inField ? round(s.dist, 4) : null,
      round(s.raDeg, 6),
      round(s.dec, 6),
      round(s.ci, 3),
      inField ? sig(s.lum, 4) : null,
      s.variable,
      s.id,
      s.properNameSource,
    ]);
  }
  return { rows, reasons, noIndex };
}

// ------------------------------------------------------------ systems ----

/**
 * Multiple-star systems from HYG's component fields (populated for Gliese stars):
 * comp = component number, comp_primary = HYG id of the system primary, base = system catalogue id.
 */
export function buildSystems(stars) {
  const byId = new Map(stars.map((s) => [s.id, s]));
  const groups = new Map();
  for (const s of stars) {
    if (isSun(s) || s.compPrimary == null) continue;
    const key = s.compPrimary;
    if (!groups.has(key)) groups.set(key, new Set());
    groups.get(key).add(s.id);
    if (byId.has(key)) groups.get(key).add(key);
  }
  const systems = [];
  for (const [primaryId, idSet] of groups) {
    if (idSet.size < 2) continue;
    const members = [...idSet].map((id) => byId.get(id)).filter(Boolean);
    members.sort((a, b) => (a.id === primaryId ? -1 : b.id === primaryId ? 1 : (a.comp ?? 99) - (b.comp ?? 99) || (a.mag ?? 99) - (b.mag ?? 99)));
    const primary = byId.get(primaryId) ?? members[0];
    const d = members.map((m) => (hasValidDistance(m) ? m.dist : null)).filter((v) => v != null);
    systems.push({
      base: primary.base ?? members.find((m) => m.base)?.base ?? null,
      primaryHygId: primaryId,
      distPc: hasValidDistance(primary) ? round(primary.dist, 4) : d.length ? round(Math.min(...d), 4) : null,
      members: members.map((m) => [m.index ?? null, m.id, m.properName ?? null, m.gl ?? null, m.comp ?? null, round(m.mag, 3)]),
    });
  }
  systems.sort((a, b) => (a.distPc ?? 1e9) - (b.distPc ?? 1e9) || a.primaryHygId - b.primaryHygId);
  return systems;
}

// ------------------------------------------------------- constellations ----

export function loadStellarium() {
  const file = `${RAW_DIR}/${RAW.stellariumIndex}`;
  const dfile = `${RAW_DIR}/${RAW.stellariumDescription}`;
  if (!fs.existsSync(file) || !fs.existsSync(dfile)) fail('Stellarium modern_iau files missing - run fetch.mjs first.');
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const descr = fs.readFileSync(dfile, 'utf8');
  const lic = /##\s*License\s*\r?\n+\s*([^\r\n]+)/i.exec(descr)?.[1]?.trim();
  if (!lic || !/CC BY-SA 4\.0/i.test(lic)) {
    fail(`Stellarium modern_iau licence text is "${lic}" (expected CC BY-SA 4.0). Re-check licence compatibility before use.`);
  }
  const byAbbr = new Map();
  const unknownTokens = new Set();
  for (const c of j.constellations || []) {
    const rawAbbr = c.iau || String(c.id || '').split(/\s+/).pop();
    const abbr = canonicalAbbr(rawAbbr);
    if (!abbr) fail(`Stellarium: unrecognised constellation id "${c.id}"`);
    const segs = byAbbr.get(abbr) ?? [];
    const seen = new Set(segs.map(([a, b]) => (a < b ? `${a}-${b}` : `${b}-${a}`)));
    for (const path of c.lines || []) {
      const hips = [];
      for (const t of path) {
        if (typeof t === 'number') hips.push(t);
        else if (t !== 'thin' && t !== 'bold') unknownTokens.add(String(t));
      }
      for (let i = 0; i + 1 < hips.length; i++) {
        const [a, b] = [hips[i], hips[i + 1]];
        if (a === b) continue;
        const key = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push([a, b]);
      }
    }
    byAbbr.set(abbr, segs);
  }
  if (unknownTokens.size) fail(`Stellarium lines contain non-HIP tokens: ${[...unknownTokens].slice(0, 10).join(', ')}`);
  return { byAbbr, license: lic, cultureId: j.id ?? PINS.stellarium.culture, meta: readMeta(file) };
}

/**
 * VizieR VI/49 bound_20.dat: RAdeg(1-11) DEdeg(13-23) cst(25-28) type(30); contiguous records per
 * constellation; the last point joins the first. Serpens is split into SER1 (Caput) / SER2 (Cauda).
 * Points exactly at a celestial pole are plotting helpers ("traverse" points), not boundary vertices:
 * they are removed so 3-D renderers do not draw spurious segments to the pole.
 */
export function loadVi49() {
  const file = `${RAW_DIR}/${RAW.vi49Bound20}`;
  if (!fs.existsSync(file)) fail('VI/49 bound_20.dat.gz missing - run fetch.mjs first.');
  const text = readMaybeGz(file).toString('latin1');
  const groups = [];
  let cur = null;
  let records = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const ra = Number(line.slice(0, 11));
    const dec = Number(line.slice(12, 23));
    const cst = line.slice(24, 28).trim();
    const type = line.slice(29, 30).trim();
    if (!Number.isFinite(ra) || !Number.isFinite(dec) || !cst) fail(`VI/49: malformed record "${line}"`);
    if (ra < 0 || ra > 360 || dec < -90 || dec > 90) fail(`VI/49: out-of-range record "${line}"`);
    records++;
    if (!cur || cur.cst !== cst) {
      cur = { cst, pts: [] };
      groups.push(cur);
    }
    cur.pts.push([ra, dec, type]);
  }
  const rings = new Map(); // abbr -> [{ part, points:[[ra,dec],...], removedPolePoints }]
  let removedPolePoints = 0;
  for (const g of groups) {
    const abbr = canonicalAbbr(g.cst.replace(/[12]$/, ''));
    if (!abbr) fail(`VI/49: unknown constellation code "${g.cst}"`);
    const pts = [];
    for (const [ra, dec] of g.pts) {
      if (Math.abs(dec) >= 89.9999) {
        removedPolePoints++;
        continue;
      }
      const raN = ra >= 360 ? ra - 360 : ra;
      const last = pts[pts.length - 1];
      if (last && Math.abs(last[0] - raN) < 1e-9 && Math.abs(last[1] - dec) < 1e-9) continue; // duplicate
      pts.push([raN, dec]);
    }
    // drop closing duplicate
    if (pts.length > 1) {
      const [a, b] = [pts[0], pts[pts.length - 1]];
      if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) pts.pop();
    }
    if (!rings.has(abbr)) rings.set(abbr, []);
    rings.get(abbr).push({ part: g.cst, points: pts });
  }
  return { rings, records, groups: groups.length, removedPolePoints, meta: readMeta(file) };
}

function vi49Version() {
  const f = `${RAW_DIR}/${RAW.vi49ReadMe}`;
  if (!fs.existsSync(f)) return 'VI/49 (version history unavailable)';
  const t = fs.readFileSync(f, 'latin1');
  const hist = [...t.matchAll(/^\s*\*\s*(\d{2}-[A-Za-z]{3}-\d{4}):\s*(.+)$/gm)];
  const last = hist[hist.length - 1];
  return last ? `VizieR VI/49, CDS ReadMe history last entry ${last[1]} (${last[2].trim()})` : 'VizieR VI/49';
}

export function buildConstellations(stars, stell, vi49) {
  const byHip = new Map();
  for (const s of stars) {
    if (isSun(s) || s.hip == null) continue;
    const prev = byHip.get(s.hip);
    if (!prev || (s.mag ?? 99) < (prev.mag ?? 99)) byHip.set(s.hip, s);
  }
  const lineStarHips = new Set();
  const out = [];
  const problems = [];
  for (const c of IAU_CONSTELLATIONS) {
    const lines = stell.byAbbr.get(c.abbr) ?? [];
    if (!lines.length) problems.push(`${c.abbr}: no stick-figure lines`);
    for (const [a, b] of lines) {
      lineStarHips.add(a);
      lineStarHips.add(b);
    }
    const parts = vi49.rings.get(c.abbr);
    if (!parts || !parts.length) fail(`VI/49 has no boundary for ${c.abbr}`);
    const ringObjs = parts.map((p) => new SphericalRing(p.points));
    // Label: mean direction of the figure's stars that lie inside the largest boundary ring
    // (Serpens -> Caput); falls back to all figure stars, then to the ring centre.
    let largest = 0;
    ringObjs.forEach((r, i) => {
      if (Math.abs(r.areaSr()) > Math.abs(ringObjs[largest].areaSr())) largest = i;
    });
    const figStars = [...new Set(lines.flat())].map((h) => byHip.get(h)).filter((s) => s && s.raDeg != null);
    const figVecs = figStars.map((s) => unitVec(s.raDeg, s.dec));
    let sel = figVecs.filter((v) => ringObjs[largest].contains(v));
    if (!sel.length) sel = figVecs;
    let label = sel.length ? meanDirection(sel) : ringObjs[largest].center;
    let labelMethod = sel.length ? 'mean of figure stars inside largest boundary ring' : 'boundary ring centre';
    if (!ringObjs.some((r) => r.contains(label))) {
      // concave outline: use the figure star closest to the mean direction
      if (sel.length) {
        let best = sel[0];
        for (const v of sel) if (angleDeg(v, label) < angleDeg(best, label)) best = v;
        label = best;
        labelMethod = 'figure star nearest the mean direction (mean fell outside the outline)';
      }
    }
    const [lra, ldec] = raDecOf(label);
    out.push({
      abbr: c.abbr,
      name: c.name,
      genitive: c.genitive,
      englishName: c.englishName,
      lines,
      labelRaDeg: round(lra, 4),
      labelDecDeg: round(ldec, 4),
      labelMethod,
      areaDeg2: round(ringObjs.reduce((a, r) => a + Math.abs(r.areaSr()), 0) / (DEG * DEG), 2),
      boundary: parts.map((p) => p.points.map(([ra, dec]) => [round(ra, 4), round(dec, 4)])),
      boundaryParts: parts.map((p) => p.part),
    });
  }
  const lineStars = [];
  const missingLineStars = [];
  for (const hip of [...lineStarHips].sort((a, b) => a - b)) {
    const s = byHip.get(hip);
    if (!s) {
      missingLineStars.push(hip);
      lineStars.push([hip, null, null, null, null, null]);
      continue;
    }
    lineStars.push([hip, s.index ?? null, round(s.raDeg, 6), round(s.dec, 6), s.index != null ? round(s.dist, 4) : null, round(s.mag, 3)]);
  }
  return { constellations: out, lineStars, missingLineStars, problems };
}

// --------------------------------------------------------------- main ----

export async function buildCore() {
  ensureDir(OUT_DIR);
  const generated = new Date().toISOString();
  log('loading HYG v4.4 ...');
  const { stars, meta: hygMeta } = loadHyg();
  log(`  ${stars.length} HYG rows`);

  log('cross-checking proper names against the IAU WGSN catalogue ...');
  const wgsn = loadWgsn();
  const xm = crossMatchWgsn(stars, wgsn);
  log(`  WGSN ${xm.wgsnEntries} names (${xm.edition}); matched ${xm.matched} (hip ${xm.matchedBy.hip}, hr ${xm.matchedBy.hr}, hd ${xm.matchedBy.hd}, gj ${xm.matchedBy.gj}, pos ${xm.matchedBy.position}); unmatched ${xm.unmatchedCount}`);
  log(`  agree ${xm.agree}, spelling ${xm.spellingUpdated}, replaced ${xm.replaced}, added ${xm.addedFromWgsn}, HYG-only ${xm.hygOnly}, conflicts ${xm.conflicts.length}`);

  log('building star field ...');
  const { field, excluded, excludedCount } = selectStarField(stars);
  const bin = writeStarsBin(field, hygMeta);
  log(`  stars.bin: ${field.length} stars, ${bin.bytes} bytes; excluded ${excludedCount} ${JSON.stringify(excluded)}`);
  log(`  max |xyz - HYG xyz| = ${bin.maxXyzDiff.toExponential(2)} pc; max |absMag - HYG absmag| = ${bin.maxAbsMagDiff.toFixed(4)}`);

  const source = {
    id: 'hyg-v44',
    name: 'HYG Database v4.4',
    url: `${PINS.hyg.repo}/src/commit/${PINS.hyg.commit}/${PINS.hyg.path}`,
    commit: PINS.hyg.commit,
    sha256: hygMeta.sha256,
    retrieved: hygMeta.retrieved,
    license: 'CC BY-SA 4.0',
    licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citation: HYG_CITATION,
  };

  const starsHeader = {
    schemaVersion: 1,
    generated,
    dataset: 'stars-hyg-v44-field',
    source,
    file: OUT.starsBin,
    byteLength: bin.bytes,
    count: field.length,
    dtype: 'float32',
    endianness: 'little',
    stride: bin.stride,
    strideBytes: bin.stride * 4,
    fields: ['xPc', 'yPc', 'zPc', 'absMagV', 'colorIndexBV', 'teffK'],
    units: { xPc: 'pc', yPc: 'pc', zPc: 'pc', absMagV: 'mag (absolute, Johnson V)', colorIndexBV: 'mag (Johnson B-V)', teffK: 'K' },
    provenance: {
      xPc: 'derived: HYG dist * unit vector(HYG ra, dec); dist = 1/parallax (Hipparcos 2007 reduction, else YBSC/Gliese)',
      yPc: 'derived (as xPc)',
      zPc: 'derived (as xPc)',
      absMagV: 'derived: HYG mag - 5 log10(dist / 10 pc); no extinction correction',
      colorIndexBV: 'observed: HYG ci (B-V); NaN when unknown',
      teffK: `derived: Ballesteros (2012) black-body formula T = 4600 K [1/(0.92(B-V)+1.7) + 1/(0.92(B-V)+0.62)], B-V clamped to [${BV_MIN}, ${BV_MAX}]; NaN when B-V unknown. Rendering aid, not a measured temperature.`,
    },
    frame: FRAME_TEXT,
    epoch: 'J2000.0',
    equinox: 'J2000.0',
    sortOrder: 'apparent V magnitude ascending (brightest first), ties by HYG id; every prefix [0, n) is a valid magnitude-limited LOD subset. Apparent magnitude = absMagV + 5 log10(r / 10 pc), r = |(x,y,z)|.',
    magnitudeLimits: bin.magnitudeLimits,
    nan: {
      policy: 'Only colorIndexBV and teffK may be NaN (B-V unknown in HYG). Positions and absMagV are always finite.',
      colorIndexBV: bin.nanBV,
      teffK: bin.nanBV,
    },
    teffModel: {
      reference: 'Ballesteros, F. J. 2012, EPL 97, 34008 (arXiv:1201.1809)',
      formula: 'T = 4600 K * (1/(0.92*BV + 1.7) + 1/(0.92*BV + 0.62))',
      bvClampRange: [BV_MIN, BV_MAX],
      clampedCount: bin.teffClamped,
    },
    excludedCount,
    excluded,
    exclusionRules: {
      sun: 'HYG id 0 ("Sol") is excluded; the Sun is provided by the solar-system domain.',
      distanceSentinel: `HYG dist >= ${DIST_SENTINEL_PC} pc = missing or negative Hipparcos parallax (HYG placeholder).`,
      nonPositiveOrMissingDistance: 'dist <= 0 or empty.',
      missingApparentMag: 'mag empty.',
      missingPosition: 'ra/dec empty.',
    },
    stats: {
      minDistPc: round(bin.dists[0], 4),
      medianDistPc: round(bin.dists[Math.floor(bin.dists.length / 2)], 3),
      maxDistPc: round(bin.dists[bin.dists.length - 1], 1),
      within10Pc: bin.dists.filter((d) => d <= 10).length,
      within100Pc: bin.dists.filter((d) => d <= 100).length,
      beyond1000Pc: bin.dists.filter((d) => d > 1000).length,
      maxDeviationFromHygXyzPc: Number(bin.maxXyzDiff.toExponential(3)),
      maxDeviationFromHygAbsMag: round(bin.maxAbsMagDiff, 5),
    },
    notes: [
      'Distances come from parallaxes; for stars beyond a few hundred pc Hipparcos parallax errors are large and some HYG distances (up to tens of kpc) are unreliable. HYG does not carry parallax uncertainties.',
      'Hipparcos-era data; Gaia DR3 distances for most of these stars exist (see AT-HYG). Gaia DR4 is scheduled for 2026-12-02 and is NOT used.',
      'Index i of a star in this file is the "index" used by stars-named.json, hip-index.json, star-systems.json and constellations.json; byte offset = i * 24.',
    ],
  };
  writeJsonCompact(`${OUT_DIR}/${OUT.starsHeader}`, starsHeader);

  log('building named-star table ...');
  const named = buildNamed(stars);
  const namedOut = {
    schemaVersion: 1,
    generated,
    source: { id: 'hyg-v44', nameCrossCheck: 'iau-wgsn-csn', citation: `${HYG_CITATION} ${WGSN_CITATION}` },
    selection: `All HYG stars except the Sun having a proper name, a Bayer and/or Flamsteed designation, a Gliese/GJ number, or apparent V magnitude < ${NAMED_MAG_LIMIT}. Rows sorted by apparent magnitude (brightest first). Stars without a usable distance are included with index/absMag/distPc/luminositySolar = null.`,
    fields: NAMED_FIELDS,
    units: {
      apparentMag: 'mag (Johnson V)',
      absMag: 'mag (absolute V; = apparentMag - 5 log10(distPc/10))',
      distPc: 'pc',
      raDeg: 'deg (ICRS/J2000, epoch J2000)',
      decDeg: 'deg (ICRS/J2000, epoch J2000)',
      colorIndexBV: 'mag (B-V)',
      luminositySolar: 'L_sun in the V band, HYG value 10^(0.4 (4.85 - M_V)); not bolometric',
    },
    nullPolicy: 'null = not available in the source (never 0).',
    selectionCounts: named.reasons,
    rowsWithoutStarFieldIndex: named.noIndex,
    nameCrossCheck: {
      catalogue: 'IAU Catalog of Star Names (WGSN)',
      edition: xm.edition,
      retrieved: wgsn.meta?.retrieved ?? null,
      wgsnEntries: xm.wgsnEntries,
      matchedToHyg: xm.matched,
      matchedBy: xm.matchedBy,
      unmatched: xm.unmatchedCount,
      hygNameAgrees: xm.agree,
      hygNameSpellingUpdated: xm.spellingUpdated,
      hygNameReplacedByIau: xm.replaced,
      iauNameAddedToHyg: xm.addedFromWgsn,
      hygOnlyNames: xm.hygOnly,
      sharedHipConflicts: xm.conflicts,
      replaced: xm.replacedList,
      spellingUpdated: xm.spellingList,
      added: xm.addedList,
      rule: 'properName = IAU WGSN name when the star is matched (HIP, then HR, HD, GJ, then position <= 30"); otherwise the HYG proper name. properNameSource says which.',
    },
    count: named.rows.length,
    rows: named.rows,
  };
  writeJsonCompact(`${OUT_DIR}/${OUT.named}`, namedOut);
  log(`  stars-named.json: ${named.rows.length} rows (${named.noIndex} without star-field index)`);

  log('building HIP index ...');
  const hipIndex = {};
  let dupHip = 0;
  for (const s of field) {
    if (s.hip == null) continue;
    if (hipIndex[s.hip] != null) {
      dupHip++;
      continue;
    }
    hipIndex[s.hip] = s.index;
  }
  writeJsonCompact(`${OUT_DIR}/${OUT.hipIndex}`, hipIndex);
  log(`  hip-index.json: ${Object.keys(hipIndex).length} HIP numbers (${dupHip} duplicate HIP rows skipped)`);

  log('building star systems ...');
  const systems = buildSystems(stars);
  writeJsonCompact(`${OUT_DIR}/${OUT.systems}`, {
    schemaVersion: 1,
    generated,
    source: { id: 'hyg-v44', citation: HYG_CITATION },
    description: 'Multiple-star systems as grouped by HYG (fields comp / comp_primary / base, populated for Gliese-catalogue stars). Sorted by distance.',
    fields: ['base', 'primaryHygId', 'distPc', 'members'],
    memberFields: ['index', 'hygId', 'properName', 'gl', 'comp', 'apparentMag'],
    count: systems.length,
    rows: systems.map((s) => [s.base, s.primaryHygId, s.distPc, s.members]),
  });
  log(`  star-systems.json: ${systems.length} systems`);

  log('building constellations ...');
  const stell = loadStellarium();
  const vi49 = loadVi49();
  const cons = buildConstellations(stars, stell, vi49);
  if (cons.problems.length) log(`  WARNING: ${cons.problems.join('; ')}`);
  if (cons.missingLineStars.length) log(`  WARNING: line stars not in HYG: ${cons.missingLineStars.join(', ')}`);
  const consOut = {
    schemaVersion: 1,
    generated,
    source: {
      names: { id: 'iau-constellation-names', url: IAU_CONSTELLATIONS_URL, citation: IAU_NAMES_CITATION },
      lines: {
        id: 'stellarium-modern-iau-lines',
        url: `${PINS.stellarium.repo}/blob/${PINS.stellarium.commit}/skycultures/${PINS.stellarium.culture}/index.json`,
        commit: PINS.stellarium.commit,
        license: stell.license,
        citation: STELLARIUM_CITATION,
      },
      boundaries: {
        id: 'vizier-vi-49-boundaries',
        url: `${PINS.vi49.base}bound_20.dat.gz`,
        version: vi49Version(),
        records: vi49.records,
        removedPolePoints: vi49.removedPolePoints,
        citation: VI49_CITATION,
      },
      starPositions: { id: 'hyg-v44' },
    },
    conventions: {
      frame: 'ICRS/J2000 equatorial; RA in degrees [0,360), Dec in degrees.',
      lines: '[hipA, hipB] = one straight segment between two Hipparcos stars (deduplicated, undirected). Resolve 3-D positions with hip-index.json -> stars.bin, or sky positions with lineStars.',
      boundary: 'Array of rings; each ring = array of [raDeg, decDeg] vertices (J2000), implicitly closed (last vertex joins the first; first vertex not repeated). Vertices are <= ~1 deg apart (Davenhall & Leggett interpolation), so straight chords on the unit sphere are accurate. Rings may cross RA 0/360; Ursa Minor and Octans rings encircle the celestial poles. Serpens has two rings (boundaryParts SER1 = Caput, SER2 = Cauda).',
      label: 'labelRaDeg/labelDecDeg: derived anchor for the constellation name (see labelMethod), J2000.',
      areaDeg2: 'Derived solid angle of the boundary rings in square degrees (IAU values sum to 41253 deg^2).',
    },
    lineStars: { fields: ['hip', 'index', 'raDeg', 'decDeg', 'distPc', 'apparentMag'], rows: cons.lineStars, note: 'index/distPc null = star has no usable HYG distance (cannot be placed in 3-D).' },
    constellations: cons.constellations,
  };
  writeJsonCompact(`${OUT_DIR}/${OUT.constellations}`, consOut);
  const totalArea = cons.constellations.reduce((a, c) => a + c.areaDeg2, 0);
  log(`  constellations.json: ${cons.constellations.length} constellations, ${cons.lineStars.length} line stars, total area ${totalArea.toFixed(1)} deg^2`);

  return { generated, field, xm, excluded, excludedCount, named, systems, cons, totalArea };
}

runMain(import.meta.url, () => buildCore(), 'BUILD');
