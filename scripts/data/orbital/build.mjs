#!/usr/bin/env node
// Orbital domain - step 2: normalize cached raw data (data-raw/orbital/) into the offline
// exhibition snapshot (public/data/orbital/). No network access.
//
//   node scripts/data/orbital/build.mjs
//
// Outputs
//   public/data/orbital/catalog.json        every tracked on-orbit (Earth-centred) object, one row each
//   public/data/orbital/summary.json        population statistics (class, regime, 50-km shells), notable objects
//   public/data/orbital/lookups.json        code tables (owners, launch sites, status codes, group tags, regimes)
//   public/data/orbital/manifest.part.json  provenance records for the shared data manifest

import { existsSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import {
  OUT_DIR, csvRecords, num, str, normNorad, shapeFromGp, round, readJson, writeFileAtomic, WGS72, isoNow,
} from './lib.mjs';
import {
  SATCAT_REQUEST, LOOKUP_REQUESTS, gpRequests, gpNameRequests, GP_GROUPS, GP_SPECIALS, GP_NAME_QUERIES,
  DERIVED_TAGS, GP_REQUIRED_COLUMNS, SATCAT_REQUIRED_COLUMNS, GP_ENDPOINT, SATCAT_URL, CELESTRAK,
} from './datasets.mjs';

import { EXTRA_FIELDS, CATALOG_FIELDS, FIELD_UNITS } from './schema.mjs';

const ACTIVE_CODES = new Set(['+', 'P', 'B', 'S', 'X']);
const CLASS_FROM_SATCAT = { PAY: 'payload', 'R/B': 'rocket-body', DEB: 'debris', UNK: 'unknown' };
const CLASSES = ['payload', 'rocket-body', 'debris', 'unknown'];

const R_EARTH = WGS72.radiusKm;
const GEO_ALT = 35786;
const BIN_START = 200;
const BIN_END = 2000;
const BIN_WIDTH = 50;

const EPOCH_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/;

// ---------------------------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------------------------
function parseElements(r) {
  const raw = str(r.EPOCH);
  if (!raw) return null;
  const e = raw.endsWith('Z') ? raw.slice(0, -1) : raw;
  if (!EPOCH_RE.test(e)) return null;
  const epochUTC = `${e}Z`;
  const epochMs = Date.parse(epochUTC);
  const n = num(r.MEAN_MOTION);
  const ecc = num(r.ECCENTRICITY);
  const inc = num(r.INCLINATION);
  const raan = num(r.RA_OF_ASC_NODE);
  const argp = num(r.ARG_OF_PERICENTER);
  const ma = num(r.MEAN_ANOMALY);
  const angleOk = (x) => x != null && x >= 0 && x <= 360;
  if (!Number.isFinite(epochMs) || !(n > 0 && n < 20) || ecc == null || !(ecc >= 0 && ecc < 1)
    || inc == null || !(inc >= 0 && inc <= 180) || !angleOk(raan) || !angleOk(argp) || !angleOk(ma)) return null;
  return {
    epochUTC, epochMs, n, ecc, inc, raan, argp, ma,
    bstar: num(r.BSTAR), ndot: num(r.MEAN_MOTION_DOT), nddot: num(r.MEAN_MOTION_DDOT),
    ephemerisType: str(r.EPHEMERIS_TYPE), classification: str(r.CLASSIFICATION_TYPE),
  };
}

function rcsCategory(m2) {
  if (m2 == null || !(m2 > 0)) return null; // 0 / negative would be a placeholder, not a size
  if (m2 < 0.1) return 'SMALL';
  if (m2 < 1.0) return 'MEDIUM';
  return 'LARGE';
}

const HTML_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', mdash: '—', ndash: '–',
  reg: '®', copy: '©', uuml: 'ü', Uuml: 'Ü', ouml: 'ö', Ouml: 'Ö',
  auml: 'ä', Auml: 'Ä', eacute: 'é', Eacute: 'É', egrave: 'è', aacute: 'á',
  iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', ccedil: 'ç',
  oslash: 'ø', Oslash: 'Ø', aring: 'å', Aring: 'Å', atilde: 'ã', otilde: 'õ',
  acirc: 'â', ecirc: 'ê', ocirc: 'ô', szlig: 'ß',
};
function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name) => HTML_ENTITIES[name] ?? m);
}
function htmlCellText(s) {
  return decodeEntities(s.replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim().normalize('NFC');
}
/** Two-column HTML code table (code | description) -> {code: description}. */
function parseCodeTable(html) {
  const body = html.split(/<tbody[^>]*>/i)[1] ?? html;
  const out = {};
  for (const m of body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((c) => htmlCellText(c[1]));
    if (cells.length >= 2 && cells[0] && /^[A-Z0-9/&.-]{1,8}$/i.test(cells[0])) out[cells[0]] = cells[1] || null;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Orbit statistics helpers
// ---------------------------------------------------------------------------------------------
/** Regime from mean apsis altitudes (km). Definitions are documented in docs/data/orbital.md. */
export function regimeOf(perigeeKm, apogeeKm) {
  if (perigeeKm == null || apogeeKm == null) return 'UNKNOWN';
  const hp = Math.min(perigeeKm, apogeeKm);
  const ha = Math.max(perigeeKm, apogeeKm);
  const a = R_EARTH + (hp + ha) / 2;
  const e = (ha - hp) / (2 * a);
  const hm = a - R_EARTH;
  if (Math.abs(hm - GEO_ALT) <= 200 && e < 0.01) return 'GEO';
  if (ha < 2000) return 'LEO';
  if (hp >= 2000 && ha <= 31570) return 'MEO';
  return 'HEO_OTHER';
}

/** Finer breakdown of the HEO_OTHER bucket (ESA-like orbit classes). */
export function heoSubclass(perigeeKm, apogeeKm) {
  const hp = Math.min(perigeeKm, apogeeKm);
  const ha = Math.max(perigeeKm, apogeeKm);
  if (hp < 2000 && ha >= 2000 && ha <= 31570) return 'LEO-MEO-crossing';
  if (hp < 2000 && ha > 31570 && ha <= 40002) return 'GTO-like';
  if (hp < 31570 && ha > 40002) return 'HEO (apogee beyond GEO)';
  if (hp >= 2000 && hp < 31570 && ha > 31570) return 'MEO-GEO-crossing';
  if (hp >= 31570) return 'near-GEO-not-GEO (drifting, graveyard, super-GEO)';
  return 'other';
}

/** Fraction of an orbital period spent at radius <= r (two-body ellipse, radii in km). */
function timeFractionBelow(r, rp, ra) {
  if (r <= rp) return 0;
  if (r >= ra) return 1;
  const a = (rp + ra) / 2;
  const e = (ra - rp) / (ra + rp);
  const cosE = Math.max(-1, Math.min(1, (1 - r / a) / e));
  const E = Math.acos(cosE);
  return (E - e * Math.sin(E)) / Math.PI;
}

const sig = (x, n = 4) => (x === 0 ? 0 : Number(x.toPrecision(n)));

// ---------------------------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------------------------
async function loadGp() {
  const reqs = [...gpRequests(), ...gpNameRequests()];
  const byId = new Map(); // norad -> {rec, el, sources:Set}
  const tags = new Map(); // norad -> Set(tag)
  const perSource = [];
  const problems = { invalidRecords: 0, invalidSamples: [], epochConflicts: 0, missingOptionalFiles: [] };
  for (const q of reqs) {
    if (!existsSync(q.file) || !existsSync(`${q.file}.meta.json`)) {
      if (q.required) throw new Error(`Required raw file missing: ${q.file}\n  -> run: node scripts/data/orbital/fetch.mjs`);
      problems.missingOptionalFiles.push(q.id);
      perSource.push({ id: q.id, query: q.query, present: false });
      continue;
    }
    const meta = await readJson(`${q.file}.meta.json`);
    const text = await readFile(q.file, 'utf8');
    const records = meta.empty || /^\s*no gp data found/i.test(text) ? [] : csvRecords(text, GP_REQUIRED_COLUMNS, q.id).records;
    let accepted = 0;
    for (const r of records) {
      const id = normNorad(r.NORAD_CAT_ID);
      const el = parseElements(r);
      if (!id || !el) {
        problems.invalidRecords += 1;
        if (problems.invalidSamples.length < 20) problems.invalidSamples.push(`${q.id}: ${r.NORAD_CAT_ID} ${r.OBJECT_NAME}`);
        continue;
      }
      accepted += 1;
      const prev = byId.get(id);
      if (!prev) byId.set(id, { rec: r, el, sources: new Set([q.id]) });
      else {
        prev.sources.add(q.id);
        if (el.epochMs !== prev.el.epochMs) {
          problems.epochConflicts += 1;
          if (el.epochMs > prev.el.epochMs) { prev.rec = r; prev.el = el; }
        }
      }
      if (q.tag) {
        if (!tags.has(id)) tags.set(id, new Set());
        tags.get(id).add(q.tag);
      }
    }
    perSource.push({
      id: q.id, query: q.query, url: q.url, tag: q.tag, retrieved: meta.retrieved, bytes: meta.bytes,
      sha256: meta.sha256, records: records.length, accepted, present: true,
    });
  }
  return { byId, tags, perSource, problems };
}

async function loadSatcat() {
  if (!existsSync(SATCAT_REQUEST.file)) throw new Error(`Required raw file missing: ${SATCAT_REQUEST.file}\n  -> run: node scripts/data/orbital/fetch.mjs`);
  const meta = await readJson(`${SATCAT_REQUEST.file}.meta.json`);
  const { records } = csvRecords(await readFile(SATCAT_REQUEST.file, 'utf8'), SATCAT_REQUIRED_COLUMNS, 'satcat.csv');
  const byId = new Map();
  let invalidIds = 0;
  let duplicateIds = 0;
  for (const r of records) {
    const id = normNorad(r.NORAD_CAT_ID);
    if (!id) { invalidIds += 1; continue; }
    if (byId.has(id)) duplicateIds += 1;
    byId.set(id, r);
  }
  return { meta, records, byId, invalidIds, duplicateIds };
}

async function loadLookups() {
  const out = { ownerCodes: {}, launchSiteCodes: {}, retrieved: {} };
  for (const q of LOOKUP_REQUESTS) {
    if (!existsSync(q.file)) { console.warn(`  WARN lookup page missing (${q.id}); lookups.json will lack it`); continue; }
    const meta = await readJson(`${q.file}.meta.json`);
    const table = parseCodeTable(await readFile(q.file, 'utf8'));
    if (Object.keys(table).length < 20) { console.warn(`  WARN ${q.id}: parsed only ${Object.keys(table).length} codes - page layout changed? ignoring`); continue; }
    if (q.id === 'lookup-sources') out.ownerCodes = table;
    if (q.id === 'lookup-launchsites') out.launchSiteCodes = table;
    out.retrieved[q.id] = { url: q.url, retrieved: meta.retrieved, codes: Object.keys(table).length };
  }
  return out;
}

function quantiles(sorted, ps) {
  if (!sorted.length) return ps.map(() => null);
  return ps.map((p) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))]);
}

async function main() {
  const t0 = Date.now();
  console.log('[orbital/build] reading cached raw data ...');
  const satcat = await loadSatcat();
  const gp = await loadGp();
  const lookups = await loadLookups();
  const generated = isoNow();

  const satById = satcat.byId;
  const isEarthOnOrbit = (r) => {
    if (str(r.DECAY_DATE)) return false;
    const c = str(r.ORBIT_CENTER);
    if (c === 'EA') return true;
    if (c && /^\d+$/.test(c)) {
      const host = satById.get(normNorad(c));
      return !!host && !str(host.DECAY_DATE) && str(host.ORBIT_CENTER) === 'EA';
    }
    return false;
  };

  // ---- decide the row set -----------------------------------------------------------------
  const ids = new Set();
  const excluded = { satcatDecayed: 0, satcatNonEarthOnOrbit: 0, gpButDecayedInSatcat: [], gpButNonEarth: [] };
  for (const [id, r] of satById) {
    if (str(r.DECAY_DATE)) { excluded.satcatDecayed += 1; continue; }
    if (!isEarthOnOrbit(r)) { excluded.satcatNonEarthOnOrbit += 1; continue; }
    ids.add(id);
  }
  for (const id of gp.byId.keys()) {
    const s = satById.get(id);
    if (!s) { ids.add(id); continue; } // analyst objects / not-yet-catalogued
    if (str(s.DECAY_DATE)) excluded.gpButDecayedInSatcat.push(id);
    else if (!isEarthOnOrbit(s)) excluded.gpButNonEarth.push(id);
  }

  const retrievalMs = Math.max(...gp.perSource.filter((p) => p.present).map((p) => Date.parse(p.retrieved)));
  const activeConflicts = { satcatInactiveButInActiveGroup: 0, satcatActiveButNotInActiveGroup: 0 };
  const rows = [];
  const dockedMap = {}; // norad -> host norad (SATCAT ORBIT_TYPE DOC / numeric ORBIT_CENTER)
  const statRows = []; // parallel info for statistics
  for (const id of [...ids].sort((a, b) => Number(a) - Number(b))) {
    const s = satById.get(id) ?? null;
    const g = gp.byId.get(id) ?? null;
    const tagSet = new Set(gp.tags.get(id) ?? []);
    const name = str(s?.OBJECT_NAME) ?? str(g?.rec.OBJECT_NAME);
    const intlDes = str(s?.OBJECT_ID) ?? str(g?.rec.OBJECT_ID);

    let objectClass = s ? (CLASS_FROM_SATCAT[str(s.OBJECT_TYPE)] ?? 'unknown') : null;
    if (!objectClass) {
      if (tagSet.has('active')) objectClass = 'payload';
      else if (name && /\bDEB\b/.test(name)) objectClass = 'debris';
      else if (name && /\bR\/B\b/.test(name)) objectClass = 'rocket-body';
      else objectClass = 'unknown';
    }

    const ops = str(s?.OPS_STATUS_CODE);
    const inActive = tagSet.has('active');
    let isActive;
    if (ops && ACTIVE_CODES.has(ops)) isActive = true;
    else if (ops === '-' || ops === 'D') isActive = false;
    else if (inActive) isActive = true;
    else if (objectClass === 'debris' || objectClass === 'rocket-body') isActive = false;
    else isActive = null;
    if (ops === '-' && inActive) activeConflicts.satcatInactiveButInActiveGroup += 1;
    if (ops && ACTIVE_CODES.has(ops) && !inActive && g) activeConflicts.satcatActiveButNotInActiveGroup += 1;

    if (name && /^STARLINK/i.test(name) && objectClass === 'payload') tagSet.add('starlink');
    const orbitCenter = str(s?.ORBIT_CENTER);
    const dockedTo = orbitCenter && /^\d+$/.test(orbitCenter) ? normNorad(orbitCenter) : null;
    if (str(s?.ORBIT_TYPE) === 'DOC') tagSet.add('docked');

    const rcsM2 = num(s?.RCS);
    let hasElements = false;
    let elementSource = null;
    let el = null;
    let apogeeKm = null;
    let perigeeKm = null;
    let periodMin = null;
    let inclinationDeg = null;
    if (g) {
      el = g.el;
      hasElements = true;
      elementSource = 'celestrak-gp';
      const shp = shapeFromGp(el.n, el.ecc, el.inc);
      apogeeKm = round(shp.apogeeKm, 1);
      perigeeKm = round(shp.perigeeKm, 1);
      periodMin = round(shp.periodMin, 3);
      inclinationDeg = el.inc;
    } else if (s) {
      apogeeKm = num(s.APOGEE);
      perigeeKm = num(s.PERIGEE);
      periodMin = num(s.PERIOD);
      inclinationDeg = num(s.INCLINATION);
      if (apogeeKm != null && perigeeKm != null && inclinationDeg != null) elementSource = 'satcat-shape';
    }

    const row = [
      id, name, intlDes, objectClass, isActive, str(s?.OWNER), str(s?.LAUNCH_DATE), rcsCategory(rcsM2),
      [...tagSet].sort(), hasElements,
      el ? el.epochUTC : null,
      el ? el.n : null, el ? el.ecc : null, inclinationDeg, el ? el.raan : null, el ? el.argp : null,
      el ? el.ma : null, el ? el.bstar : null, el ? el.ndot : null, el ? el.nddot : null,
      apogeeKm, perigeeKm, periodMin, elementSource,
      str(s?.LAUNCH_SITE), ops, rcsM2,
    ];
    if (dockedTo) dockedMap[id] = dockedTo;
    if (row.length !== CATALOG_FIELDS.length) throw new Error('internal: row/field length mismatch');
    for (const v of row) {
      if (typeof v === 'number' && !Number.isFinite(v)) throw new Error(`internal: non-finite number in row ${id}`);
    }
    rows.push(row);
    statRows.push({
      id, name, objectClass, isActive, hasElements, elementSource, perigeeKm, apogeeKm, inclinationDeg, periodMin,
      epochMs: el ? el.epochMs : null, inSatcat: !!s, tags: tagSet,
    });
  }

  // ---- statistics ---------------------------------------------------------------------------
  const zeroClassMap = () => Object.fromEntries(CLASSES.map((c) => [c, 0]));
  const counts = {
    total: rows.length,
    withElements: 0,
    satcatShapeOnly: 0,
    noOrbitData: 0,
    inSatcat: 0,
    notInSatcat: 0,
    analyst: 0,
    active: 0,
    activeUnknown: 0,
    docked: 0,
    byClass: zeroClassMap(),
    byClassWithElements: zeroClassMap(),
    activePayloads: 0,
  };
  const regimes = ['LEO', 'MEO', 'GEO', 'HEO_OTHER', 'UNKNOWN'];
  const byRegime = Object.fromEntries(regimes.map((r) => [r, 0]));
  const byRegimeAndClass = Object.fromEntries(regimes.map((r) => [r, zeroClassMap()]));
  const heoBreakdown = {};
  const nBins = (BIN_END - BIN_START) / BIN_WIDTH;
  const edgesKm = Array.from({ length: nBins + 1 }, (_, i) => BIN_START + i * BIN_WIDTH);
  const series = [...CLASSES, 'total', 'activePayload'];
  const meanAltCounts = Object.fromEntries(series.map((s) => [s, new Array(nBins).fill(0)]));
  const timeWeighted = Object.fromEntries(series.map((s) => [s, new Array(nBins).fill(0)]));
  const epochAgesDays = [];
  const groupCounts = {};
  let shapeAnomalies = 0;

  for (const r of statRows) {
    counts.byClass[r.objectClass] += 1;
    if (r.hasElements) { counts.withElements += 1; counts.byClassWithElements[r.objectClass] += 1; }
    else if (r.elementSource === 'satcat-shape') counts.satcatShapeOnly += 1;
    else counts.noOrbitData += 1;
    if (r.inSatcat) counts.inSatcat += 1; else counts.notInSatcat += 1;
    if (r.tags.has('analyst')) counts.analyst += 1;
    if (r.tags.has('docked')) counts.docked += 1;
    if (r.isActive === true) counts.active += 1;
    if (r.isActive === null) counts.activeUnknown += 1;
    if (r.isActive === true && r.objectClass === 'payload') counts.activePayloads += 1;
    for (const t of r.tags) groupCounts[t] = (groupCounts[t] ?? 0) + 1;
    if (r.epochMs != null) epochAgesDays.push((retrievalMs - r.epochMs) / 86400000);

    const reg = regimeOf(r.perigeeKm, r.apogeeKm);
    byRegime[reg] += 1;
    byRegimeAndClass[reg][r.objectClass] += 1;
    if (reg === 'HEO_OTHER') {
      const sub = heoSubclass(r.perigeeKm, r.apogeeKm);
      heoBreakdown[sub] = (heoBreakdown[sub] ?? 0) + 1;
    }
    if (r.perigeeKm == null || r.apogeeKm == null) continue;
    if (r.apogeeKm < r.perigeeKm) shapeAnomalies += 1;
    const hp = Math.min(r.perigeeKm, r.apogeeKm);
    const ha = Math.max(r.perigeeKm, r.apogeeKm);
    const keys = [r.objectClass, 'total'];
    if (r.objectClass === 'payload' && r.isActive === true) keys.push('activePayload');
    const hm = (hp + ha) / 2;
    if (hm >= BIN_START && hm < BIN_END) {
      const b = Math.floor((hm - BIN_START) / BIN_WIDTH);
      for (const k of keys) meanAltCounts[k][b] += 1;
    }
    if (hp < BIN_END && ha >= BIN_START) {
      const rp = R_EARTH + hp;
      const ra = R_EARTH + ha;
      for (let b = 0; b < nBins; b += 1) {
        let w;
        if (ra - rp < 1e-6) {
          w = hm >= edgesKm[b] && hm < edgesKm[b + 1] ? 1 : 0;
        } else {
          w = timeFractionBelow(R_EARTH + edgesKm[b + 1], rp, ra) - timeFractionBelow(R_EARTH + edgesKm[b], rp, ra);
        }
        if (w > 0) for (const k of keys) timeWeighted[k][b] += w;
      }
    }
  }
  const shellVolumesKm3 = edgesKm.slice(0, -1).map((h, i) => (4 / 3) * Math.PI * ((R_EARTH + edgesKm[i + 1]) ** 3 - (R_EARTH + h) ** 3));
  const spatialDensity = Object.fromEntries(series.map((s) => [s, timeWeighted[s].map((w, i) => sig(w / shellVolumesKm3[i], 4))]));
  const timeWeightedRounded = Object.fromEntries(series.map((s) => [s, timeWeighted[s].map((w) => round(w, 2))]));
  epochAgesDays.sort((a, b) => a - b);
  const [ageMin, ageP50, ageP90, ageP95, ageP99, ageMax] = quantiles(epochAgesDays, [0, 0.5, 0.9, 0.95, 0.99, 1]);

  // catalog-number facts (five-digit exhaustion check)
  const satIdsNum = satcat.records.map((r) => Number(r.NORAD_CAT_ID)).filter(Number.isFinite);
  const maxSatcat = Math.max(...satIdsNum);
  const max5 = Math.max(...satIdsNum.filter((n) => n < 100000));
  const sixDigit = satcat.records.filter((r) => Number(r.NORAD_CAT_ID) >= 100000)
    .sort((a, b) => Number(a.NORAD_CAT_ID) - Number(b.NORAD_CAT_ID));
  const last5 = satcat.records.filter((r) => Number(r.NORAD_CAT_ID) >= 69990 && Number(r.NORAD_CAT_ID) < 70000)
    .sort((a, b) => Number(a.NORAD_CAT_ID) - Number(b.NORAD_CAT_ID));
  const rowIdsNum = rows.map((r) => Number(r[0]));
  const catalogNumbers = {
    note: 'CelesTrak (banner on celestrak.org, checked 2026-10-16): "We ran out of 5-digit catalog numbers on 2026-07-11" and "All newly cataloged objects have 6-digit catalog numbers of 100000+"; TLE format cannot carry them. The 5-digit ceiling for normal catalog entries is 69999 (not 99999): 70000-99999 are not used for SATCAT entries (80000-89999 is the 18 SDS analyst range). Cosmos stores NORAD ids as strings and never uses TLE fixed-width fields.',
    satcatMaxNorad: String(maxSatcat),
    satcatMaxFiveDigitNorad: String(max5),
    satcatCountInRange70000to99999: satIdsNum.filter((n) => n >= 70000 && n < 100000).length,
    satcatSixDigitCount: sixDigit.length,
    firstSixDigitEntries: sixDigit.slice(0, 3).map((r) => ({ norad: r.NORAD_CAT_ID, name: r.OBJECT_NAME, intlDes: r.OBJECT_ID, launchDate: r.LAUNCH_DATE })),
    lastFiveDigitEntries: last5.slice(-4).map((r) => ({ norad: r.NORAD_CAT_ID, name: r.OBJECT_NAME, intlDes: r.OBJECT_ID, launchDate: r.LAUNCH_DATE })),
    catalogRowsWithSixOrMoreDigits: rowIdsNum.filter((n) => n >= 100000).length,
    analystNoradRanges: (() => {
      const a = statRows.filter((r) => r.tags.has('analyst')).map((r) => Number(r.id));
      return { count: a.length, min: a.length ? String(Math.min(...a)) : null, max: a.length ? String(Math.max(...a)) : null, fiveDigit: a.filter((n) => n < 100000).length, sixPlusDigit: a.filter((n) => n >= 100000).length };
    })(),
  };

  // notable objects
  const NOTABLE = [
    ['25544', 'International Space Station (ZARYA module carries the ISS catalog number); crewed'],
    ['48274', "Tiangong / China Space Station core module Tianhe; crewed"],
    ['20580', 'Hubble Space Telescope (launched 1990-04-24)'],
    ['5', 'Vanguard 1 (launched 1958-03-17): oldest human-made object still in orbit'],
    ['25730', 'Fengyun-1C: target of the 2007-01-11 Chinese ASAT test, the largest single debris-generating event'],
    ['22675', 'Cosmos 2251: collided with Iridium 33 on 2009-02-10 (first accidental hypervelocity collision of two intact satellites)'],
    ['24946', 'Iridium 33: collision partner of Cosmos 2251'],
    ['27386', 'Envisat: ~8 t defunct ESA satellite at ~770 km, a frequently cited debris-removal candidate'],
    ['22220', 'SL-16 (Zenit-2) upper stage: one of the ~9 t rocket bodies clustered near 840 km, a major collision-risk population'],
    ['43013', 'NOAA-20 (JPSS-1): polar-orbiting, sun-synchronous weather satellite'],
    ['49260', 'Landsat 9: sun-synchronous Earth-observation satellite'],
    ['8820', 'LAGEOS-1: passive laser-ranging geodetic sphere in MEO (~5,900 km)'],
    ['25867', 'Chandra X-ray Observatory: highly elliptical orbit reaching ~1/3 of the way to the Moon'],
    ['60133', 'GOES-19: NOAA geostationary weather satellite'],
  ];
  const rowById = new Map(statRows.map((r) => [r.id, r]));
  // newest group member with a fresh (< 3 d old) element set, optionally within a mean-altitude window
  const pickFromGroup = (tag, why, minAltKm = -Infinity, maxAltKm = Infinity) => {
    const cands = statRows
      .filter((r) => r.tags.has(tag) && r.hasElements && (retrievalMs - r.epochMs) / 86400000 < 3)
      .filter((r) => { const hm = (r.perigeeKm + r.apogeeKm) / 2; return hm >= minAltKm && hm <= maxAltKm; })
      .sort((a, b) => Number(b.id) - Number(a.id));
    return cands.length ? [cands[0].id, why] : null;
  };
  const dyn = [
    pickFromGroup('gps-ops', 'Most recently catalogued operational GPS satellite with a fresh element set (semi-synchronous MEO, ~2 rev/day)'),
    pickFromGroup('galileo', 'Most recently catalogued Galileo satellite with a fresh element set (MEO ~23,200 km)'),
    pickFromGroup('starlink', 'Most recently catalogued Starlink satellite already in an operational shell (mega-constellation, LEO)', 450, 600),
  ].filter(Boolean);
  const notableObjects = [...NOTABLE, ...dyn].map(([id, why]) => {
    const r = rowById.get(id);
    if (!r) return { norad: id, why, present: false };
    return {
      norad: id, name: r.name, why, present: true, objectClass: r.objectClass, isActive: r.isActive,
      regime: regimeOf(r.perigeeKm, r.apogeeKm), hasElements: r.hasElements, elementSource: r.elementSource,
      inclinationDeg: r.inclinationDeg, perigeeKm: r.perigeeKm, apogeeKm: r.apogeeKm, periodMin: r.periodMin,
      epochUTC: r.epochMs != null ? rows.find((row) => row[0] === id)[10] : null,
    };
  });

  const gpPresent = gp.perSource.filter((p) => p.present);
  const gpRetrievedFrom = new Date(Math.min(...gpPresent.map((p) => Date.parse(p.retrieved)))).toISOString();
  const gpRetrievedTo = new Date(retrievalMs).toISOString();

  const regimeDefinitions = {
    altitudeReference: `Altitudes are mean apsis altitudes above a spherical Earth of radius ${R_EARTH} km (WGS-72, the SGP4 constant). For GP rows they are derived from the mean elements exactly as SGP4 initialises (Kozai->Brouwer mean motion); for satcat-shape rows they are the SATCAT APOGEE/PERIGEE values.`,
    GEO: 'Geosynchronous: mean altitude (a - R) within 35786 +/- 200 km AND eccentricity < 0.01 (any inclination).',
    LEO: 'Low Earth orbit: apogee altitude < 2000 km (hence perigee < 2000 km too).',
    MEO: 'Medium Earth orbit: perigee >= 2000 km AND apogee <= 31570 km (ESA MEO bounds).',
    HEO_OTHER: 'Everything else with a known orbit: highly elliptical (GTO-like, Molniya/Tundra-like, HEO science), LEO-MEO crossers, near-GEO objects that fail the GEO test (drifting, graveyard/super-GEO). See heoOtherBreakdown.',
    UNKNOWN: 'No orbit information at all (no GP elements and no SATCAT apogee/perigee).',
    precedence: 'Tests are applied in the order GEO, LEO, MEO, else HEO_OTHER.',
  };

  const summary = {
    schemaVersion: 1,
    generated,
    snapshot: {
      gpRetrievedFromUTC: gpRetrievedFrom,
      gpRetrievedToUTC: gpRetrievedTo,
      satcatRetrievedUTC: satcat.meta.retrieved,
      satcatLastModifiedUTC: satcat.meta.headers?.['last-modified'] ? new Date(satcat.meta.headers['last-modified']).toISOString() : null,
      gpEpochAgeDaysAtRetrieval: {
        min: round(ageMin, 3), median: round(ageP50, 3), p90: round(ageP90, 3), p95: round(ageP95, 3), p99: round(ageP99, 3), max: round(ageMax, 3),
        olderThan7d: epochAgesDays.filter((d) => d > 7).length,
        olderThan30d: epochAgesDays.filter((d) => d > 30).length,
      },
      source: 'CelesTrak GP (OMM CSV) + SATCAT; see manifest.part.json',
    },
    definitions: {
      objectClass: 'From SATCAT OBJECT_TYPE (PAY->payload, R/B->rocket-body, DEB->debris, UNK->unknown); objects absent from SATCAT: payload if in CelesTrak active group, else debris/rocket-body if the name contains DEB / R/B, else unknown.',
      isActive: 'true if SATCAT OPS_STATUS_CODE in {+,P,B,S,X} (operational, partial, backup, spare, extended mission), or (status blank/unknown and in CelesTrak active group); false if status - (nonoperational) or the object is debris/rocket-body; else null (unknown).',
      regimes: regimeDefinitions,
    },
    counts: {
      ...counts,
      byRegime,
      byRegimeAndClass,
      heoOtherBreakdown: heoBreakdown,
      byElementSource: { 'celestrak-gp': counts.withElements, 'satcat-shape': counts.satcatShapeOnly, none: counts.noOrbitData },
      byGroupTag: Object.fromEntries(Object.entries(groupCounts).sort((a, b) => b[1] - a[1])),
      excluded: {
        satcatDecayed: excluded.satcatDecayed,
        satcatOnOrbitButNotEarthCentred: excluded.satcatNonEarthOnOrbit,
        gpRecordsDroppedBecauseSatcatSaysDecayed: excluded.gpButDecayedInSatcat.length,
        gpRecordsDroppedBecauseNotEarthCentred: excluded.gpButNonEarth.length,
        invalidGpRecords: gp.problems.invalidRecords,
      },
    },
    altitudeShells: {
      description: '50-km altitude shells from 200 to 2000 km. countsByMeanAltitude: integer number of objects whose mean altitude (perigee+apogee)/2 falls in the shell. timeWeightedObjects: each object contributes the fraction of its orbital period spent inside the shell (two-body ellipse from mean apsides), so eccentric objects are spread over the shells they cross; sums are object-equivalents. spatialDensityPerKm3: timeWeightedObjects / shell volume (objects per km^3). Series "activePayload" is a SUBSET of "payload" (not additive); "total" = payload + rocket-body + debris + unknown.',
      altitudeReference: regimeDefinitions.altitudeReference,
      edgesKm,
      binWidthKm: BIN_WIDTH,
      series,
      countsByMeanAltitude: meanAltCounts,
      timeWeightedObjects: timeWeightedRounded,
      spatialDensityPerKm3: spatialDensity,
      shellVolumesKm3: shellVolumesKm3.map((v) => sig(v, 6)),
    },
    notableObjects,
    catalogNumbers,
    referenceFigures: {
      note: 'Context figures quoted from external sources for comparison (not computed from this snapshot). The tracked public catalogue is only a small fraction of the real debris population.',
      celestrakBoxscore: {
        url: `${CELESTRAK}/satcat/boxscore.php`, asOf: '2026-10-15',
        onOrbitTotal: 35360, onOrbitPayloads: 20327, onOrbitRocketBodiesAndDebris: 15033, activePayloads: 17324,
        note: 'Includes ~300 objects not in Earth orbit (heliocentric, lunar, Lagrange-point); excludes analyst objects.',
      },
      esaSpaceDebrisByTheNumbers: {
        url: 'https://sdup.esoc.esa.int/discosweb/statistics/', lastUpdate: '2026-10-14',
        regularlyTrackedAndCatalogued: 47080, satellitesStillInSpace: 19440, satellitesStillFunctioning: 15900,
        masterModelObjectsLargerThan10cm: 68450, masterModelObjects1to10cm: 1500000, masterModelObjects1mmTo1cm: 230000000,
        totalMassInOrbitTonnes: 17400,
        note: 'ESA MASTER-8 reference population 02/2026; ESA counts include objects tracked by networks that are not in the public SATCAT.',
      },
    },
    qualityNotes: {
      gpEpochConflictsResolved: gp.problems.epochConflicts,
      invalidGpRecordSamples: gp.problems.invalidSamples,
      missingOptionalGpFiles: gp.problems.missingOptionalFiles,
      activeStatusConflicts: activeConflicts,
      apogeeBelowPerigeeRows: shapeAnomalies,
      satcatInvalidIds: satcat.invalidIds,
      satcatDuplicateIds: satcat.duplicateIds,
    },
  };

  // ---- catalog.json -------------------------------------------------------------------------
  const epochNote = `Each row carries its own GP epoch (epochUTC, ISO-8601 UTC); there is no common epoch. GP rows (elementSource "celestrak-gp") are SGP4/SDP4 mean elements in the TEME frame and must be propagated with SGP4 (e.g. satellite.js json2satrec + propagate) from epochUTC to the display time; never use them as osculating Keplerian elements. Snapshot downloaded ${gpRetrievedFrom} to ${gpRetrievedTo} (SATCAT ${summary.snapshot.satcatLastModifiedUTC ?? satcat.meta.retrieved}); median element age at retrieval ${round(ageP50, 2)} d, 95th percentile ${round(ageP95, 2)} d. SGP4 position error is ~1 km at epoch and typically grows by a few km per day in LEO (faster for low, high-drag objects); more than ~2 weeks from the epochs, positions should be presented as illustrative, and objects may have manoeuvred or re-entered since the snapshot. Rows with elementSource "satcat-shape" have no epoch: only perigee/apogee/inclination/period from SATCAT (render as reconstructed orbit shape with illustrative RAAN, argument of perigee and phase). Rows with elementSource null have no orbit information.`;

  const catalogHeader = {
    schemaVersion: 1,
    generated,
    epochNote,
    source: 'Orbital data: CelesTrak (celestrak.org) GP element sets and SATCAT, from U.S. Space Force 18th/19th SDS data via Space-Track.org.',
    counts: {
      total: counts.total,
      withElements: counts.withElements,
      satcatShapeOnly: counts.satcatShapeOnly,
      noOrbitData: counts.noOrbitData,
      byClass: counts.byClass,
      active: counts.active,
      activePayloads: counts.activePayloads,
      analyst: counts.analyst,
      notInSatcat: counts.notInSatcat,
      docked: counts.docked,
    },
    units: FIELD_UNITS,
    extensionFields: EXTRA_FIELDS,
    dockedTo: dockedMap,
    fields: CATALOG_FIELDS,
  };
  const headerJson = JSON.stringify(catalogHeader);
  const catalogJson = `${headerJson.slice(0, -1)},"rows":[\n${rows.map((r) => JSON.stringify(r)).join(',\n')}\n]}\n`;

  // ---- lookups.json -------------------------------------------------------------------------
  const groupTags = {};
  for (const [group, tag, label, section] of GP_GROUPS) groupTags[tag] = { label, section, source: `CelesTrak gp.php?GROUP=${group}` };
  for (const [special, tag, label] of GP_SPECIALS) groupTags[tag] = { label, section: 'Special data sets', source: `CelesTrak gp.php?SPECIAL=${special}` };
  for (const [tag, label] of Object.entries(DERIVED_TAGS)) groupTags[tag] = { label, section: 'Derived locally', source: 'derived' };
  const lookupsJson = {
    schemaVersion: 1,
    generated,
    objectClasses: {
      payload: 'SATCAT OBJECT_TYPE PAY (payload)', 'rocket-body': 'SATCAT OBJECT_TYPE R/B (rocket body)',
      debris: 'SATCAT OBJECT_TYPE DEB (other debris)', unknown: 'SATCAT OBJECT_TYPE UNK, or object absent from SATCAT and not classifiable',
    },
    opsStatusCodes: {
      '+': 'Operational', '-': 'Nonoperational', P: 'Partially Operational', B: 'Backup/Standby',
      S: 'Spare', X: 'Extended Mission', D: 'Decayed/Deorbited', '?': 'Unknown',
    },
    rcsSizeClasses: { SMALL: 'RCS < 0.1 m^2', MEDIUM: '0.1 m^2 <= RCS < 1.0 m^2', LARGE: 'RCS >= 1.0 m^2' },
    elementSources: {
      'celestrak-gp': 'CelesTrak GP mean elements (observed); propagate with SGP4',
      'satcat-shape': 'Only SATCAT apogee/perigee/inclination/period (reconstructed shape; phase/RAAN/arg. perigee illustrative)',
    },
    regimes: regimeDefinitions,
    groupTags,
    ownerCodes: lookups.ownerCodes,
    launchSiteCodes: lookups.launchSiteCodes,
    sources: {
      ownerCodes: lookups.retrieved['lookup-sources'] ?? null,
      launchSiteCodes: lookups.retrieved['lookup-launchsites'] ?? null,
      note: 'Owner and launch-site code tables are parsed from the HTML pages celestrak.org/satcat/sources.php and launchsites.php (no structured version exists). Text kept as published.',
    },
  };

  // ---- write --------------------------------------------------------------------------------
  const files = {
    catalog: `${OUT_DIR}/catalog.json`,
    summary: `${OUT_DIR}/summary.json`,
    lookups: `${OUT_DIR}/lookups.json`,
  };
  await writeFileAtomic(files.catalog, catalogJson);
  await writeFileAtomic(files.summary, `${JSON.stringify(summary)}\n`);
  await writeFileAtomic(files.lookups, `${JSON.stringify(lookupsJson)}\n`);
  const sizes = {};
  for (const [k, f] of Object.entries(files)) sizes[k] = (await stat(f)).size;

  // ---- manifest.part.json -------------------------------------------------------------------
  const groupList = GP_GROUPS.map(([g]) => g).join(',');
  const LICENSE = 'No formal open-data licence. CelesTrak makes the data freely available to all users subject to its usage policy (https://celestrak.org/usage-policy.php). The GP/OMM element sets and SATCAT are "basic SSA data" originating from USSPACECOM (U.S. Space Force 18th/19th Space Defense Squadrons) via Space-Track.org, for which USSPACECOM grants "express blanket approval for transfer/redistribution of basic SSA data ... conditioned on appropriate citation" (Space-Track User Agreement, section "Redistribution of Basic SSA Information").';
  const CITATION = 'Orbital data: CelesTrak (Dr T.S. Kelso, https://celestrak.org) - GP element sets and SATCAT; source data: U.S. Space Force 18th & 19th Space Defense Squadrons / USSPACECOM via Space-Track.org.';
  const RATE = 'CelesTrak usage policy (2026-05-22): download each data set at most once per update (GP every 2 h, SupGP 2 h, SATCAT 1-2x per day); since 2026-03-26 a repeat request for GP Active/Starlink before the next update returns HTTP 403; stop querying on any non-200 (301/403/404/5xx); >50 HTTP errors in 2 h or >100 MB/day may get the IP firewalled; directory/query pages at most once per hour. No per-second limit documented (this pipeline waits 2.5 s between requests).';
  const manifest = {
    domain: 'orbital',
    datasets: [
      {
        id: 'celestrak-gp-omm',
        name: 'CelesTrak GP mean element sets (CCSDS OMM keywords, CSV): published groups, special data sets and NAME searches',
        organization: 'CelesTrak (T.S. Kelso); data from U.S. Space Force 18th/19th Space Defense Squadrons via Space-Track.org',
        purpose: 'SGP4 mean elements for every tracked on-orbit object rendered and propagated in the Earth orbital-environment layer; CelesTrak group memberships for filters (stations, constellations, GNSS, GEO, debris clouds, ...).',
        mechanism: 'HTTPS GET gp.php?{GROUP|SPECIAL|NAME}=...&FORMAT=CSV (OMM keywords, 9-digit-safe) -> merged by NORAD_CAT_ID (latest EPOCH wins, group tags unioned) -> catalog.json rows with elementSource="celestrak-gp".',
        endpoint: GP_ENDPOINT,
        query: `GROUP={${groupList}}&FORMAT=CSV (46 requests); SPECIAL={GPZ,GPZ-PLUS,DECAYING}&FORMAT=CSV; NAME=DEB&FORMAT=CSV; NAME=R/B&FORMAT=CSV. Starlink group intentionally not downloaded (subset of active per CelesTrak).`,
        version: `live archive state at retrieval (GP downloads ${gpRetrievedFrom} .. ${gpRetrievedTo}; CelesTrak GP update cycle current as of 2026-10-16 18:05:42 UTC)`,
        retrieved: gpRetrievedTo,
        license: LICENSE,
        licenseUrl: 'https://celestrak.org/usage-policy.php',
        citation: CITATION,
        rateLimits: RATE,
        fieldsUsed: [...GP_REQUIRED_COLUMNS, 'EPHEMERIS_TYPE', 'CLASSIFICATION_TYPE'],
        updateCadence: 'Upstream refresh every 2 h. Cosmos snapshot refreshed manually: node scripts/data/orbital/fetch.mjs --refresh && node scripts/data/orbital/build.mjs (never more than once per upstream update).',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/orbital/build.mjs',
        fallback: 'If catalog.json is missing or fails to parse, hide the orbital-object layer and show "orbital catalog unavailable" (never synthesize objects). Per object: hasElements=false -> render from SATCAT shape with illustrative phase and label it reconstructed; elementSource=null -> list only, do not render.',
        files: [{ path: 'data/orbital/catalog.json', bytes: sizes.catalog, records: rows.length }],
        limitations: `GP elements are SGP4 mean elements (TEME, UTC epochs) with ~1 km accuracy at epoch degrading by km/day; ages differ per object (median ${round(ageP50, 2)} d at retrieval). ${counts.satcatShapeOnly + counts.noOrbitData} of ${counts.total} on-orbit objects have no public GP in the downloaded sets (no group covers inactive payloads; ~800 objects are NEA "no elements available", e.g. classified; others have no current GP at CelesTrak) and fall back to SATCAT shape. ${counts.analyst} analyst objects (uncorrelated tracks, numbers 8xxxx / 2xxxxx) are included as class "unknown". The tracked catalogue (~10 cm LEO / ~1 m GEO detection limits) is a small fraction of the real debris population (ESA MASTER-8: ~1.5 million objects 1-10 cm).`,
        provenanceClass: 'observed',
      },
      {
        id: 'celestrak-satcat',
        name: 'CelesTrak Satellite Catalog (SATCAT), full CSV',
        organization: 'CelesTrak (T.S. Kelso); catalog maintained by U.S. Space Force 18th SDS, with CelesTrak corrections',
        purpose: 'Authoritative list of on-orbit objects (no decay date, Earth-centred): object class, owner, launch date/site, RCS, operational status, docking; orbit shape (apogee/perigee/inclination/period) for objects without GP elements; population statistics by class/regime/altitude shell.',
        mechanism: 'HTTPS GET of the static full-catalog CSV -> filter DECAY_DATE empty and ORBIT_CENTER = EA (or docked to an Earth-orbiting host) -> joined with GP by NORAD_CAT_ID.',
        endpoint: SATCAT_URL,
        query: null,
        version: `SATCAT file Last-Modified ${summary.snapshot.satcatLastModifiedUTC ?? 'unknown'} (${satcat.records.length} records incl. decayed; official catalog then at 101074)`,
        retrieved: satcat.meta.retrieved,
        license: LICENSE,
        licenseUrl: 'https://celestrak.org/usage-policy.php',
        citation: CITATION,
        rateLimits: RATE,
        fieldsUsed: SATCAT_REQUIRED_COLUMNS,
        updateCadence: 'Upstream updated manually 1-2x per day; Cosmos snapshot refreshed manually with the GP data.',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/orbital/build.mjs',
        fallback: 'Without SATCAT the app cannot show owner/class/launch metadata; render GP objects with class from name heuristics only and flag metadata as unavailable.',
        files: [
          { path: 'data/orbital/catalog.json', bytes: sizes.catalog, records: rows.length },
          { path: 'data/orbital/summary.json', bytes: sizes.summary, records: null },
        ],
        limitations: 'SATCAT apogee/perigee/period/inclination are rounded (km, 0.01 deg/min) and can be stale for objects without current elements. RCS (m^2) is missing for ~58% of on-orbit objects (rcsSize null). OWNER is the SATCAT source code (country/organisation), not necessarily the operator. Analyst objects are not in SATCAT.',
        provenanceClass: 'observed',
      },
      {
        id: 'celestrak-satcat-code-tables',
        name: 'CelesTrak SATCAT source (owner) and launch-site code tables',
        organization: 'CelesTrak (T.S. Kelso)',
        purpose: 'Human-readable names for SATCAT OWNER and LAUNCH_SITE codes in the inspector and filters.',
        mechanism: 'HTTPS GET of two HTML pages (no structured version exists) -> two-column table parse -> lookups.json (with locally defined status/class/regime/group-tag tables).',
        endpoint: `${CELESTRAK}/satcat/sources.php`,
        query: `${CELESTRAK}/satcat/sources.php ; ${CELESTRAK}/satcat/launchsites.php`,
        version: 'live page state at retrieval',
        retrieved: lookups.retrieved['lookup-sources']?.retrieved ?? generated,
        license: LICENSE,
        licenseUrl: 'https://celestrak.org/usage-policy.php',
        citation: CITATION,
        rateLimits: RATE,
        fieldsUsed: ['Source Code', 'Source Description', 'Launch Site Code', 'Launch Site Description'],
        updateCadence: 'Rarely changes; refresh at most weekly.',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/orbital/build.mjs',
        fallback: 'Show the raw code (e.g. "PRC", "AFETR") when a name is missing.',
        files: [{ path: 'data/orbital/lookups.json', bytes: sizes.lookups, records: Object.keys(lookups.ownerCodes).length + Object.keys(lookups.launchSiteCodes).length }],
        limitations: 'Parsed from HTML; text kept as published (including CelesTrak spelling). Some codes used in SATCAT may be absent from the tables.',
        provenanceClass: 'observed',
      },
      {
        id: 'orbital-population-statistics',
        name: 'Derived on-orbit population statistics (class, regime, 50-km shells, spatial density, notable objects)',
        organization: 'Cosmos / AstroNexus (derived from CelesTrak GP + SATCAT)',
        purpose: 'Kessler / debris laboratory: real-catalog shell populations and spatial densities; HUD counts; notable-object shortcuts.',
        mechanism: 'Computed locally by build.mjs from the catalog rows (no separate download): regime classification, mean-altitude histogram, residence-time-weighted shell occupancy and spatial density; external reference figures (ESA, CelesTrak boxscore) quoted for context.',
        endpoint: SATCAT_URL,
        query: null,
        version: `derived from the snapshot of ${gpRetrievedTo}`,
        retrieved: gpRetrievedTo,
        license: `${LICENSE} Derived statistics: cite as below.`,
        licenseUrl: 'https://celestrak.org/usage-policy.php',
        citation: `${CITATION} Statistics computed by the Cosmos/AstroNexus project. Context figures: ESA Space Debris Office (sdup.esoc.esa.int/discosweb/statistics, 2026-10-14) and CelesTrak SATCAT boxscore (2026-10-15).`,
        rateLimits: 'not applicable (local computation)',
        fieldsUsed: ['objectClass', 'isActive', 'perigeeKm', 'apogeeKm', 'inclinationDeg', 'groups'],
        updateCadence: 'Regenerated with every build.',
        cachePolicy: 'versioned offline snapshot; optional online refresh',
        normalization: 'scripts/data/orbital/build.mjs',
        fallback: 'If summary.json is missing, the app may recompute counts from catalog.json; hide shell-density charts otherwise.',
        files: [{ path: 'data/orbital/summary.json', bytes: sizes.summary, records: null }],
        limitations: 'Shell statistics use mean (not osculating) apsides and a two-body residence-time model; satcat-shape rows use rounded SATCAT apsides. Only the tracked public catalogue is counted (objects >~10 cm in LEO); real densities including untracked debris are far higher.',
        provenanceClass: 'derived',
      },
    ],
  };
  await writeFileAtomic(`${OUT_DIR}/manifest.part.json`, `${JSON.stringify(manifest, null, 2)}\n`);

  console.log(`[orbital/build] rows=${rows.length} withElements=${counts.withElements} satcatShapeOnly=${counts.satcatShapeOnly} noOrbit=${counts.noOrbitData} analyst=${counts.analyst}`);
  console.log(`  byClass ${JSON.stringify(counts.byClass)}  byRegime ${JSON.stringify(byRegime)}`);
  console.log(`  sizes: catalog ${sizes.catalog} B, summary ${sizes.summary} B, lookups ${sizes.lookups} B`);
  console.log(`  excluded: ${JSON.stringify(summary.counts.excluded)}  epochConflicts=${gp.problems.epochConflicts}`);
  console.log(`  epoch age (d): median ${round(ageP50, 2)}, p95 ${round(ageP95, 2)}, max ${round(ageMax, 1)}`);
  console.log(`[orbital/build] done in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

main().catch((err) => {
  console.error(`[orbital/build] FAILED: ${err.stack ?? err.message}`);
  process.exit(1);
});
