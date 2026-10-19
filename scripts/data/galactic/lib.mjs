// Shared helpers for the "galactic" data domain of Cosmos / AstroNexus.
// Node >= 22 ESM, no third-party dependencies (astronomy-engine is used only by build-messier.mjs).
//
// Responsibilities:
//  * polite HTTP (User-Agent, per-host throttling, retries with backoff, loud failures)
//  * raw-download cache under data-raw/galactic/ (idempotent: cached files are never re-downloaded)
//  * disk-space guard (never let C: drop below 3.5 GB free)
//  * small parsers: SIMBAD/VizieR TAP JSON, VizieR ASU-TSV, CDS fixed-width ReadMe tables, arXiv e-print sources
//  * compact JSON writer that refuses NaN / Infinity

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const UA = 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)';
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../..').replace(/\\/g, '/');
export const RAW = `${ROOT}/data-raw/galactic`;
export const OUT = `${ROOT}/public/data/galactic`;
export const DOC = `${ROOT}/docs/data/galactic.md`;
export const SCRIPT_DIR = 'scripts/data/galactic';

export const SIMBAD_TAP = 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync';
export const VIZIER_ASU = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';
export const CDSARC = 'https://cdsarc.cds.unistra.fr/ftp';
export const ARXIV_SRC = 'https://export.arxiv.org/src';
export const ARXIV_API = 'https://export.arxiv.org/api/query';

const MIN_FREE_BYTES = 3.5e9; // hard floor required by the project
const DEFAULT_INTERVAL_MS = 1100; // >= 1 s between requests to the same host
const HOST_INTERVAL_MS = {
  'export.arxiv.org': 3500, // arXiv API ToU: no more than one request every three seconds
  'arxiv.org': 3500,
  'simbad.cds.unistra.fr': 1100, // CDS: max 6 queries/s per IP; we stay far below
};

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function ensureDir(d) { fs.mkdirSync(d, { recursive: true }); return d; }
export function nowIso() { return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'); }
export function log(...a) { console.log('[galactic]', ...a); }
export function fail(msg) { const e = new Error(`[galactic] ${msg}`); e.isGalacticFail = true; throw e; }

// ---------------------------------------------------------------- disk guard
export function freeBytes(dir = ROOT) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
export function assertDiskHeadroom(extraBytes = 0, what = 'download') {
  const free = freeBytes();
  if (free - extraBytes < MIN_FREE_BYTES) {
    fail(`refusing ${what}: free=${(free / 1e9).toFixed(2)} GB, needs ${(extraBytes / 1e6).toFixed(1)} MB, floor=3.5 GB`);
  }
}

// ---------------------------------------------------------------- HTTP
const lastHit = new Map();
async function throttle(host) {
  const gap = HOST_INTERVAL_MS[host] ?? DEFAULT_INTERVAL_MS;
  const last = lastHit.get(host) ?? 0;
  const wait = last + gap - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

/** Fetch with throttling + retries. Returns {status, headers, buf}. Throws loudly on failure. */
export async function http(url, { method = 'GET', body = undefined, headers = {}, retries = 4, timeoutMs = 180000, okStatuses = [200] } = {}) {
  const host = new URL(url).host;
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(host);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { method, body, headers: { 'User-Agent': UA, ...headers }, signal: ctl.signal, redirect: 'follow' });
      const buf = Buffer.from(await res.arrayBuffer());
      clearTimeout(timer);
      if (okStatuses.includes(res.status)) return { status: res.status, headers: res.headers, buf };
      lastErr = new Error(`HTTP ${res.status} for ${method} ${url} :: ${buf.toString('utf8', 0, 300).replace(/\s+/g, ' ')}`);
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) break;
      const ra = Number(res.headers.get('retry-after'));
      // arXiv (shared IP with other ingestion jobs) answers 429 "Rate exceeded." -> back off generously.
      const base = res.status === 429 && /arxiv\.org$/.test(host) ? 20000 : 2000;
      const wait = Number.isFinite(ra) && ra > 0 ? ra * 1000 : base * 2 ** attempt;
      log(`HTTP ${res.status} from ${host}; retry ${attempt + 1}/${retries} in ${(wait / 1000).toFixed(0)} s`);
      await sleep(wait);
    } catch (e) {
      clearTimeout(timer);
      lastErr = e;
      await sleep(2000 * 2 ** attempt);
    }
  }
  fail(`request failed after retries: ${lastErr?.message ?? lastErr}`);
}

export async function headInfo(url) {
  const r = await http(url, { method: 'HEAD', okStatuses: [200, 301, 302] });
  return { status: r.status, length: Number(r.headers.get('content-length') ?? NaN), type: r.headers.get('content-type') };
}

// ---------------------------------------------------------------- raw cache
function metaPath(file) { return `${file}.meta.json`; }
export function readMeta(file) {
  try { return JSON.parse(fs.readFileSync(metaPath(file), 'utf8')); } catch { return null; }
}
function writeMeta(file, meta) { fs.writeFileSync(metaPath(file), JSON.stringify(meta, null, 1)); }

/**
 * Download `url` once into data-raw/galactic/<rel>; afterwards always served from cache.
 * Returns {text|buf, file, meta} where meta = {url, retrieved, bytes, sha256, method, query}.
 */
export async function cached(rel, url, { method = 'GET', body = undefined, headers = {}, binary = false, query = null, expectBytesMax = 100e6 } = {}) {
  const file = `${RAW}/${rel}`;
  ensureDir(path.dirname(file));
  if (fs.existsSync(file) && fs.statSync(file).size > 0) {
    const buf = fs.readFileSync(file);
    const meta = readMeta(file) ?? { url, retrieved: null, bytes: buf.length };
    return binary ? { buf, file, meta } : { text: buf.toString('utf8'), file, meta };
  }
  assertDiskHeadroom(expectBytesMax > 100e6 ? expectBytesMax : 0, `download of ${url}`);
  log(`GET ${url}${query ? ' [query]' : ''}`);
  const r = await http(url, { method, body, headers });
  fs.writeFileSync(file, r.buf);
  const meta = { url, method, query, retrieved: nowIso(), bytes: r.buf.length, sha256: crypto.createHash('sha256').update(r.buf).digest('hex') };
  writeMeta(file, meta);
  return binary ? { buf: r.buf, file, meta } : { text: r.buf.toString('utf8'), file, meta };
}

// ---------------------------------------------------------------- TAP (SIMBAD)
/** Synchronous ADQL query returning {fields:[name], rows:[[...]], meta}. JSON output format. */
export async function tapQuery(endpoint, adql, rel) {
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'json', QUERY: adql });
  const { text, meta } = await cached(rel, endpoint, { method: 'POST', body, headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, query: adql });
  let j;
  try { j = JSON.parse(text); } catch (e) { fail(`TAP response for ${rel} is not JSON: ${text.slice(0, 200)}`); }
  if (!Array.isArray(j.data) || !Array.isArray(j.metadata)) fail(`TAP response for ${rel} lacks data/metadata`);
  return { fields: j.metadata.map((m) => m.name), units: j.metadata.map((m) => m.unit ?? null), rows: j.data, meta };
}
export function rowsToObjects({ fields, rows }) {
  return rows.map((r) => Object.fromEntries(fields.map((f, i) => [f, r[i]])));
}
export function adqlStr(s) { return `'${String(s).replace(/'/g, "''")}'`; }

// ---------------------------------------------------------------- VizieR ASU-TSV
/** VizieR ASU tab-separated query. params: object of ASU params, e.g. {'-source':'J/ApJ/837/30/table3','-out.all':''}. */
export async function vizierTsv(params, rel) {
  const qs = Object.entries({ '-out.max': 'unlimited', ...params })
    .map(([k, v]) => (v === '' ? encodeURIComponent(k) : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)).join('&');
  const url = `${VIZIER_ASU}?${qs}`;
  const { text, meta } = await cached(rel, url, { query: qs });
  return { ...parseAsuTsv(text, rel), meta };
}
export function parseAsuTsv(text, label = 'asu') {
  const lines = text.split(/\r?\n/);
  const err = lines.find((l) => l.startsWith('#INFO\tError=') || l.startsWith('#++++'));
  if (err) fail(`VizieR error in ${label}: ${err}`);
  const data = lines.filter((l) => l.length && !l.startsWith('#'));
  if (data.length < 3) return { columns: [], units: [], rows: [] };
  const columns = data[0].split('\t').map((s) => s.trim());
  const units = data[1].split('\t').map((s) => s.trim());
  // data[2] is the dashes line
  const rows = data.slice(3).map((l) => {
    const cells = l.split('\t');
    return Object.fromEntries(columns.map((c, i) => [c, (cells[i] ?? '').trim()]));
  });
  return { columns, units, rows };
}

// ---------------------------------------------------------------- CDS fixed-width tables
/** spec: [[name, startByte, endByte, 'A'|'I'|'F']] with 1-indexed inclusive byte ranges (as in CDS ReadMe files). */
export function parseFixedWidth(text, spec, { skipBlank = true } = {}) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (skipBlank && !line.trim()) continue;
    const o = {};
    for (const [name, a, b, t] of spec) {
      const raw = line.substring(a - 1, b).trim();
      if (raw === '') { o[name] = null; continue; }
      if (t === 'A') o[name] = raw;
      else {
        const v = Number(raw);
        if (!Number.isFinite(v)) fail(`fixed-width parse: column ${name} value "${raw}" not numeric in line: ${line}`);
        o[name] = v;
      }
    }
    out.push(o);
  }
  return out;
}

// ---------------------------------------------------------------- arXiv
/** Fetch the exact abstract text of arXiv papers via the arXiv API (Atom). One request for many ids. */
export async function arxivAbstracts(ids, rel = 'arxiv/abstracts.atom.xml') {
  const url = `${ARXIV_API}?id_list=${ids.join(',')}&max_results=${ids.length}`;
  const { text, meta } = await cached(rel, url, { query: `id_list=${ids.join(',')}` });
  const entries = {};
  for (const m of text.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const e = m[1];
    const id = (e.match(/<id>https?:\/\/arxiv\.org\/abs\/([^<]+?)(v\d+)?<\/id>/) ?? [])[1];
    if (!id) continue;
    const pick = (tag) => (e.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)) ?? [])[1]?.replace(/\s+/g, ' ').trim() ?? null;
    entries[id] = { title: pick('title'), summary: pick('summary'), journalRef: pick('arxiv:journal_ref'), doi: pick('arxiv:doi'), published: pick('published') };
  }
  return { entries, meta };
}

/**
 * Download an arXiv e-print source once, extract only TeX files to data-raw/galactic/arxiv/<id>/ and delete the tarball
 * (keeps the raw footprint tiny). Returns {dir, files, text (all .tex concatenated), meta}.
 * Stored for research use only (arXiv ToU); never served — only extracted numeric facts are published, with citation.
 */
export async function arxivSource(id) {
  const dir = `${RAW}/arxiv/${id}`;
  const metaFile = `${dir}/_source.meta.json`;
  const listTex = () => (fs.existsSync(dir) ? walk(dir).filter((f) => /\.(tex|bbl)$/i.test(f)) : []);
  if (listTex().length && fs.existsSync(metaFile)) {
    const files = listTex();
    return { dir, files, text: files.filter((f) => f.endsWith('.tex')).map((f) => fs.readFileSync(f, 'utf8')).join('\n%%%% FILE BREAK\n'), meta: JSON.parse(fs.readFileSync(metaFile, 'utf8')) };
  }
  ensureDir(dir);
  const url = `${ARXIV_SRC}/${id}`;
  const h = await headInfo(url);
  if (Number.isFinite(h.length) && h.length > 60e6) fail(`arXiv source ${id} is ${(h.length / 1e6).toFixed(1)} MB (> 60 MB budget for one file)`);
  assertDiskHeadroom(Number.isFinite(h.length) ? h.length * 3 : 50e6, `arXiv source ${id}`);
  log(`GET ${url} (${Number.isFinite(h.length) ? (h.length / 1e6).toFixed(1) + ' MB' : 'size unknown'})`);
  const r = await http(url, { timeoutMs: 600000 });
  const sha = crypto.createHash('sha256').update(r.buf).digest('hex');
  const tmp = `${RAW}/arxiv/${id}.download`;
  fs.writeFileSync(tmp, r.buf);
  let kind = 'unknown';
  try {
    const head = r.buf.subarray(0, 2);
    if (head[0] === 0x1f && head[1] === 0x8b) {
      const unz = zlib.gunzipSync(r.buf);
      // tar archives have "ustar" at offset 257
      if (unz.length > 262 && unz.toString('latin1', 257, 262) === 'ustar') {
        kind = 'tar.gz';
        execFileSync('tar', ['--force-local', '-xzf', tmp, '-C', dir], { stdio: 'pipe' });
      } else {
        kind = 'gz-single';
        fs.writeFileSync(`${dir}/main.tex`, unz);
      }
    } else if (r.buf.toString('latin1', 257, 262) === 'ustar') {
      kind = 'tar';
      execFileSync('tar', ['--force-local', '-xf', tmp, '-C', dir], { stdio: 'pipe' });
    } else if (/\\document|\\begin\{/.test(r.buf.toString('latin1', 0, 5000))) {
      kind = 'tex';
      fs.writeFileSync(`${dir}/main.tex`, r.buf);
    } else {
      fail(`arXiv source ${id}: unrecognised payload (PDF-only submission?)`);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  // keep only TeX/BBL files
  for (const f of walk(dir)) if (!/\.(tex|bbl)$/i.test(f)) fs.rmSync(f, { force: true });
  pruneEmptyDirs(dir);
  const meta = { url, retrieved: nowIso(), bytes: r.buf.length, sha256: sha, kind, keptFiles: listTex().map((f) => path.relative(dir, f).replace(/\\/g, '/')) };
  fs.writeFileSync(metaFile, JSON.stringify(meta, null, 1));
  const files = listTex();
  if (!files.length) fail(`arXiv source ${id}: no .tex files found`);
  return { dir, files, text: files.filter((f) => f.endsWith('.tex')).map((f) => fs.readFileSync(f, 'utf8')).join('\n%%%% FILE BREAK\n'), meta };
}

export function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...walk(p)); else out.push(p);
  }
  return out;
}
function pruneEmptyDirs(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      const p = `${dir}/${e.name}`;
      pruneEmptyDirs(p);
      if (!fs.readdirSync(p).length) fs.rmdirSync(p);
    }
  }
}

/** Normalise TeX for robust substring checks (collapse whitespace, drop $ and braces, unify minus signs). */
export function normTex(s) {
  return s.replace(/%[^\n]*\n/g, '\n').replace(/\\,|\\;|\\!|~/g, ' ').replace(/[{}$]/g, '').replace(/−/g, '-').replace(/\s+/g, ' ');
}
/** Assert that every literal in `needles` occurs in the (normalised) TeX source; returns list of found needles. */
export function assertInSource(texNorm, needles, label) {
  const missing = needles.filter((n) => !texNorm.includes(normTex(n)));
  if (missing.length) fail(`${label}: literal(s) not found in arXiv source: ${missing.join(' | ')}`);
  return needles;
}

/**
 * Whitespace-insensitive variant: TeX spacing ("8275.9\pm 8.6" vs "8275.9 \pm8.6") and $ / braces are ignored on both
 * sides. Use table-row snippets such as "125.058&0.041" so that a value is only accepted next to its own uncertainty.
 */
export function squash(s) {
  return normTex(String(s)).replace(/\\mathrm|\\rm|\\text|\\left|\\right|\\displaystyle/g, '').replace(/\s+/g, '');
}
export function makeVerifier(sourceText, label) {
  const hay = squash(sourceText);
  const checked = [];
  return {
    /** throws if any snippet is missing; returns the snippets (stored in the output as evidence). */
    has(...snippets) {
      const missing = snippets.filter((n) => !hay.includes(squash(n)));
      if (missing.length) fail(`${label}: snippet(s) not found in source: ${missing.map((m) => JSON.stringify(m)).join(' | ')}`);
      checked.push(...snippets);
      return snippets;
    },
    contains(snippet) { return hay.includes(squash(snippet)); },
    get checked() { return checked.slice(); },
    label,
  };
}

// ---------------------------------------------------------------- output
export function assertFiniteDeep(obj, where = '$') {
  if (typeof obj === 'number') { if (!Number.isFinite(obj)) fail(`non-finite number at ${where}`); return; }
  if (Array.isArray(obj)) { obj.forEach((v, i) => assertFiniteDeep(v, `${where}[${i}]`)); return; }
  if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) assertFiniteDeep(v, `${where}.${k}`);
}
/** Write compact JSON to public/data/galactic/<name>. Returns {path (relative to public/), bytes}. */
export function writeOut(name, obj) {
  assertFiniteDeep(obj, name);
  ensureDir(OUT);
  const s = JSON.stringify(obj);
  fs.writeFileSync(`${OUT}/${name}`, s);
  return { path: `data/galactic/${name}`, bytes: Buffer.byteLength(s) };
}

/** Round to n significant digits (keeps output compact without losing published precision when n is generous). */
export function sig(x, n = 10) {
  if (x === null || x === undefined) return null;
  if (!Number.isFinite(x)) fail(`sig(): non-finite ${x}`);
  if (x === 0) return 0;
  return Number(x.toPrecision(n));
}
export function round(x, d) { if (x === null || x === undefined) return null; const f = 10 ** d; return Math.round(x * f) / f; }

// ---------------------------------------------------------------- astronomy helpers
export const DEG = Math.PI / 180;
/** ICRS -> Galactic rotation matrix, Hipparcos 1997 (ESA SP-1200, Vol. 1, Sec. 1.5.3, Eq. 1.5.11), rows map ICRS xyz to Galactic xyz. */
export const ICRS_TO_GAL = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [+0.4941094279, -0.4448296300, +0.7469822445],
  [-0.8676661490, -0.1980763734, +0.4559837762],
];
export function radecToUnit(raDeg, decDeg) {
  const a = raDeg * DEG, d = decDeg * DEG;
  return [Math.cos(d) * Math.cos(a), Math.cos(d) * Math.sin(a), Math.sin(d)];
}
export function matVec(m, v) { return m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]); }
/** returns {l, b} in degrees, l in [0,360) */
export function icrsToGalactic(raDeg, decDeg) {
  const [x, y, z] = matVec(ICRS_TO_GAL, radecToUnit(raDeg, decDeg));
  let l = Math.atan2(y, x) / DEG; if (l < 0) l += 360;
  const b = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
  return { l, b };
}
/** Heliocentric Galactic Cartesian (pc): x toward GC (l=0,b=0), y toward l=90 deg, z toward NGP. */
export function helioGalXYZ(raDeg, decDeg, distPc) {
  if (distPc === null || distPc === undefined) return [null, null, null];
  const [x, y, z] = matVec(ICRS_TO_GAL, radecToUnit(raDeg, decDeg));
  return [x * distPc, y * distPc, z * distPc];
}
export function sexaToDeg(h, m, s, isRA) {
  const v = Math.abs(h) + m / 60 + s / 3600;
  return isRA ? v * 15 : v;
}
