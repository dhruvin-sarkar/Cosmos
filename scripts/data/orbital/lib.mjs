// Shared helpers for the "orbital" data domain (Cosmos, SCI-FORGE 2026).
//
// - polite HTTP client: fixed User-Agent, per-host throttle, no silent redirects,
//   stop-on-any-non-200 (CelesTrak usage policy), Content-Length budget check
// - raw-download cache with sidecar *.meta.json provenance files
// - RFC-4180 CSV parser (quoted fields, embedded commas/quotes/newlines, BOM)
// - SGP4-consistent (WGS-72) orbit-shape helpers
//
// Node >= 22 ESM, no third-party dependencies.

import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER_AGENT = 'Cosmos/0.1 (educational SCI-FORGE 2026 project)';

const toPosix = (p) => p.replace(/\\/g, '/');
const HERE = toPosix(path.dirname(fileURLToPath(import.meta.url)));
export const ROOT = toPosix(path.resolve(HERE, '..', '..', '..'));
export const RAW_DIR = `${ROOT}/data-raw/orbital`;
export const OUT_DIR = `${ROOT}/public/data/orbital`;
export const DOCS_FILE = `${ROOT}/docs/data/orbital.md`;
export const BLOCK_MARKER = `${RAW_DIR}/.celestrak-blocked.json`;

// CelesTrak documents "download once per update" (GP every 2 h, SATCAT 1-2x per day) and
// asks clients to stop on any non-200. It documents no per-second limit; we still keep a
// generous gap between consecutive requests to the same host.
export const MIN_REQUEST_INTERVAL_MS = 2500;

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class HttpError extends Error {
  constructor(message, { status, url, bodySnippet }) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.url = url;
    this.bodySnippet = bodySnippet;
  }
}

const lastRequestAt = new Map();

/**
 * GET a URL as text, politely.
 * - throttles to >= MIN_REQUEST_INTERVAL_MS between requests to the same host
 * - redirect: 'manual' -> any 3xx is reported as an error (CelesTrak counts 301s as errors)
 * - any status other than 200 throws HttpError (caller must stop querying)
 * - refuses bodies larger than maxBytes (checks Content-Length first, then actual size)
 */
export async function politeGetText(url, { maxBytes = 60_000_000, minIntervalMs = MIN_REQUEST_INTERVAL_MS } = {}) {
  const host = new URL(url).host;
  const wait = (lastRequestAt.get(host) ?? 0) + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
  let res;
  try {
    res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/csv, text/plain, text/html, application/json;q=0.9, */*;q=0.5' },
      redirect: 'manual',
      signal: AbortSignal.timeout(240_000),
    });
  } catch (err) {
    lastRequestAt.set(host, Date.now());
    throw new Error(`Network error while fetching ${url}: ${err?.cause?.message ?? err.message}`);
  }
  if (res.status !== 200) {
    let snippet = '';
    try { snippet = (await res.text()).slice(0, 400); } catch { /* ignore */ }
    lastRequestAt.set(host, Date.now());
    const loc = res.headers.get('location');
    throw new HttpError(
      `HTTP ${res.status} ${res.statusText} for ${url}${loc ? ` (redirect to ${loc})` : ''}`,
      { status: res.status, url, bodySnippet: snippet },
    );
  }
  const declared = Number(res.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    try { await res.body?.cancel(); } catch { /* ignore */ }
    throw new Error(`Refusing download of ${url}: Content-Length ${declared} B exceeds budget ${maxBytes} B`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  lastRequestAt.set(host, Date.now());
  if (buf.length > maxBytes) throw new Error(`Downloaded ${buf.length} B from ${url}, exceeds budget ${maxBytes} B`);
  const headers = {};
  for (const h of ['date', 'last-modified', 'etag', 'content-type', 'content-length', 'content-encoding', 'cache-control']) {
    const v = res.headers.get(h);
    if (v != null) headers[h] = v;
  }
  return {
    status: res.status,
    text: buf.toString('utf8'),
    bytes: buf.length,
    sha256: createHash('sha256').update(buf).digest('hex'),
    headers,
  };
}

export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'));
}

export async function writeFileAtomic(file, data) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.part`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

/**
 * Download `url` into `file` unless a cached copy exists.
 * With refresh=true a cached copy is only replaced when older than maxAgeMs
 * (CelesTrak: never re-download a data set more than once per update).
 * `validate(text)` must return {ok:boolean, reason?:string, extra?:object}.
 * Writes `${file}.meta.json` with provenance (url, retrieval time, size, sha256, HTTP headers).
 */
export async function cachedDownload({ url, file, maxAgeMs, refresh = false, maxBytes, validate, log = console.log }) {
  const metaFile = `${file}.meta.json`;
  if (existsSync(file) && existsSync(metaFile)) {
    const meta = await readJson(metaFile);
    const ageMs = Date.now() - Date.parse(meta.retrieved);
    if (!refresh || ageMs < maxAgeMs) {
      log(`  cache  ${path.basename(file)}  (retrieved ${meta.retrieved}, ${(ageMs / 3.6e6).toFixed(1)} h old)`);
      return { cached: true, meta };
    }
  }
  const r = await politeGetText(url, { maxBytes });
  const check = validate ? validate(r.text) : { ok: true };
  if (!check.ok) {
    // keep the unexpected body for diagnosis, but never as the cache file
    await writeFileAtomic(`${file}.rejected.txt`, r.text.slice(0, 20000));
    throw new Error(`Unexpected content from ${url}: ${check.reason} (first bytes saved to ${file}.rejected.txt)`);
  }
  await writeFileAtomic(file, r.text);
  const meta = {
    url,
    retrieved: new Date().toISOString(),
    httpStatus: r.status,
    bytes: r.bytes,
    sha256: r.sha256,
    headers: r.headers,
    ...(check.extra ?? {}),
  };
  await writeFileAtomic(metaFile, `${JSON.stringify(meta, null, 2)}\n`);
  log(`  fetch  ${path.basename(file)}  ${r.bytes} B${check.extra?.records != null ? `, ${check.extra.records} records` : ''}${check.extra?.empty ? ' (EMPTY)' : ''}`);
  return { cached: false, meta };
}

/** RFC-4180 CSV -> array of rows (array of strings). Handles quotes, "" escapes, CRLF, BOM. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += c; i += 1; continue;
    }
    if (c === '"') { inQuotes = true; i += 1; continue; }
    if (c === ',') { row.push(field); field = ''; i += 1; continue; }
    if (c === '\r') { i += 1; continue; }
    if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; i += 1; continue; }
    field += c; i += 1;
  }
  if (inQuotes) throw new Error('CSV parse error: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** CSV text -> {header, records:[{col:value}]}; throws if required columns are missing. */
export function csvRecords(text, requiredColumns = [], label = 'CSV') {
  const rows = parseCsv(text).filter((r) => !(r.length === 1 && r[0].trim() === ''));
  if (!rows.length) return { header: [], records: [] };
  const header = rows[0].map((h) => h.trim());
  const missing = requiredColumns.filter((c) => !header.includes(c));
  if (missing.length) throw new Error(`${label}: missing required column(s) ${missing.join(', ')}; header = ${header.join(',')}`);
  const records = [];
  for (let r = 1; r < rows.length; r += 1) {
    const cells = rows[r];
    if (cells.length !== header.length) {
      throw new Error(`${label}: row ${r + 1} has ${cells.length} cells, header has ${header.length}: ${cells.join(',')}`);
    }
    const o = {};
    for (let c = 0; c < header.length; c += 1) o[header[c]] = cells[c].trim();
    records.push(o);
  }
  return { header, records };
}

/** '' / whitespace -> null; otherwise finite Number or null (never 0 for missing). */
export function num(v) {
  if (v == null) return null;
  const s = String(v).trim();
  if (s === '') return null;
  const x = Number(s);
  return Number.isFinite(x) ? x : null;
}

export function str(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/** NORAD catalog number -> canonical decimal string (no leading zeros); null if invalid. */
export function normNorad(v) {
  const s = str(v);
  if (s == null || !/^\d{1,9}$/.test(s)) return null;
  return s.replace(/^0+(?=\d)/, '');
}

// ---------------------------------------------------------------------------
// Orbit-shape helpers (WGS-72 constants, as used by SGP4 / GP element sets)
// ---------------------------------------------------------------------------
export const WGS72 = Object.freeze({
  muKm3s2: 398600.8,
  radiusKm: 6378.135,
  j2: 0.001082616,
});
const XKE = 60 / Math.sqrt((WGS72.radiusKm ** 3) / WGS72.muKm3s2); // sqrt(mu) in ER^1.5/min

/**
 * Mean apsis altitudes from a GP mean-element set, exactly as SGP4's initialiser does it:
 * Kozai mean motion (rev/day) -> Brouwer ("un-Kozai") mean motion -> mean semi-major axis.
 * Returns {aKm, perigeeKm, apogeeKm, periodMin, brouwerPeriodMin}.
 * periodMin = 1440 / n (the conventional period quoted from TLE/OMM mean motion).
 */
export function shapeFromGp(meanMotionRevPerDay, ecc, inclDeg) {
  if (!(meanMotionRevPerDay > 0) || !(ecc >= 0 && ecc < 1) || !Number.isFinite(inclDeg)) return null;
  const noKozai = (meanMotionRevPerDay * 2 * Math.PI) / 1440; // rad/min
  const cosio = Math.cos((inclDeg * Math.PI) / 180);
  const betao2 = 1 - ecc * ecc;
  const betao = Math.sqrt(betao2);
  const ak = (XKE / noKozai) ** (2 / 3);
  const d1 = (0.75 * WGS72.j2 * (3 * cosio * cosio - 1)) / (betao * betao2);
  let del = d1 / (ak * ak);
  const adel = ak * (1 - del * del - del * (1 / 3 + (134 * del * del) / 81));
  del = d1 / (adel * adel);
  const noUnkozai = noKozai / (1 + del);
  const aER = (XKE / noUnkozai) ** (2 / 3);
  const aKm = aER * WGS72.radiusKm;
  return {
    aKm,
    perigeeKm: aKm * (1 - ecc) - WGS72.radiusKm,
    apogeeKm: aKm * (1 + ecc) - WGS72.radiusKm,
    periodMin: 1440 / meanMotionRevPerDay,
    brouwerPeriodMin: (2 * Math.PI) / noUnkozai,
  };
}

/** Simple two-body variant from Kozai mean motion (for comparison with SATCAT values). */
export function shapeFromGpKepler(meanMotionRevPerDay, ecc) {
  if (!(meanMotionRevPerDay > 0) || !(ecc >= 0 && ecc < 1)) return null;
  const nRadS = (meanMotionRevPerDay * 2 * Math.PI) / 86400;
  const aKm = Math.cbrt(WGS72.muKm3s2 / (nRadS * nRadS));
  return { aKm, perigeeKm: aKm * (1 - ecc) - WGS72.radiusKm, apogeeKm: aKm * (1 + ecc) - WGS72.radiusKm };
}

export const round = (x, d) => (x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d)));

export function isoNow() {
  return new Date().toISOString();
}
