// Shared helpers for the Cosmos "solar" data domain ingestion scripts.
//
// - Polite, cached, sequential HTTP fetching (one request at a time, >= 1 s between
//   requests to the same host, application-specific User-Agent), as required by the
//   JPL SSD/CNEOS API Fair Use Policy (https://ssd-api.jpl.nasa.gov/).
// - Raw responses are cached under data-raw/solar/ (gitignored) with a sidecar
//   *.meta.json recording URL, HTTP status and retrieval time (ISO-8601 UTC).
//   Cached files are reused unless the script is run with --refresh.
// - Compact JSON writers, manifest-fragment merge helper, assertion helpers.
//
// Node >= 22 (built-in fetch). No third-party dependencies.

import { mkdir, readFile, writeFile, stat, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export const USER_AGENT = 'Cosmos/0.1 (educational SCI-FORGE 2026 project)';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '..', '..', '..').replace(/\\/g, '/');
export const RAW_DIR = `${REPO_ROOT}/data-raw/solar`;
export const OUT_DIR = `${REPO_ROOT}/public/data/solar`;
export const PUBLIC_DIR = `${REPO_ROOT}/public`;
export const DOC_PATH = `${REPO_ROOT}/docs/data/solar.md`;
export const MANIFEST_PATH = `${OUT_DIR}/manifest.part.json`;

export const ARGV = new Set(process.argv.slice(2));
export const REFRESH = ARGV.has('--refresh');

// ---------------------------------------------------------------- constants
/** IAU 2012 Resolution B2 astronomical unit, km (exact). */
export const AU_KM = 149597870.7;
/** CODATA 2018 Newtonian constant of gravitation, m^3 kg^-1 s^-2 (used by JPL SSD to derive masses). */
export const G_SI = 6.6743e-11;
/** J2000.0 epoch as Julian Date (TDB). */
export const J2000_JD = 2451545.0;
/** Seconds per day. */
export const DAY_S = 86400;

// ---------------------------------------------------------------- logging / assertions
export function log(...args) {
  console.log(`[solar ${new Date().toISOString().slice(11, 19)}]`, ...args);
}

export class DataError extends Error {}

/** Throw a loud, descriptive error when a condition fails. */
export function assert(cond, msg) {
  if (!cond) throw new DataError(`ASSERTION FAILED: ${msg}`);
}

/** Assert |actual-expected| <= tol (absolute) and log the comparison. */
export function checkClose(label, actual, expected, tol, source) {
  const ok = typeof actual === 'number' && Number.isFinite(actual) && Math.abs(actual - expected) <= tol;
  const line = `${ok ? 'OK  ' : 'FAIL'} ${label}: got ${actual}, expected ${expected} +/- ${tol}${source ? ` (${source})` : ''}`;
  if (!ok) throw new DataError(`SPOT-CHECK ${line}`);
  log(line);
  return line;
}

// ---------------------------------------------------------------- HTTP
const lastRequestByHost = new Map();
const MIN_GAP_MS = 1100; // >= 1 s between requests to the same host

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Fetch a URL with caching.
 * @param {string} url
 * @param {object} opts
 * @param {string} opts.cache  cache path relative to data-raw/solar/ (e.g. 'ref/pck00011.tpc')
 * @param {number[]} [opts.okStatus=[200]]  HTTP statuses accepted as a valid (cacheable) response
 * @param {number} [opts.timeoutMs=180000]
 * @param {boolean} [opts.refresh=REFRESH]  ignore cache
 * @returns {Promise<{text:string, status:number, retrieved:string, url:string, fromCache:boolean, path:string}>}
 */
export async function fetchCached(url, opts) {
  const { cache, okStatus = [200], timeoutMs = 180000, refresh = REFRESH } = opts;
  assert(cache, 'fetchCached requires a cache path');
  const path = `${RAW_DIR}/${cache}`;
  const metaPath = `${path}.meta.json`;
  if (!refresh && existsSync(path) && existsSync(metaPath)) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    const text = await readFile(path, 'utf8');
    return { text, status: meta.status, retrieved: meta.retrieved, url: meta.url, fromCache: true, path };
  }
  const host = new URL(url).host;
  let attempt = 0;
  const backoff = [5000, 20000, 60000];
  for (;;) {
    const last = lastRequestByHost.get(host) ?? 0;
    const wait = last + MIN_GAP_MS - Date.now();
    if (wait > 0) await sleep(wait);
    let res;
    let text;
    let netErr = null;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: '*/*' },
        signal: AbortSignal.timeout(timeoutMs),
        redirect: 'follow',
      });
      text = await res.text();
    } catch (e) {
      netErr = e;
    } finally {
      lastRequestByHost.set(host, Date.now());
    }
    const retriable = netErr || [429, 500, 502, 503, 504].includes(res.status);
    if (!netErr && okStatus.includes(res.status)) {
      const retrieved = new Date().toISOString();
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, text);
      await writeFile(metaPath, JSON.stringify({ url, status: res.status, retrieved, bytes: Buffer.byteLength(text) }));
      log(`GET ${res.status} ${shortUrl(url)} -> ${relative(REPO_ROOT, path).replace(/\\/g, '/')} (${fmtBytes(Buffer.byteLength(text))})`);
      return { text, status: res.status, retrieved, url, fromCache: false, path };
    }
    if (retriable && attempt < backoff.length) {
      const why = netErr ? `network error ${netErr.name}: ${netErr.message}` : `HTTP ${res.status}`;
      log(`WARN ${why} for ${shortUrl(url)}; backing off ${backoff[attempt] / 1000}s (attempt ${attempt + 1}/${backoff.length})`);
      await sleep(backoff[attempt]);
      attempt++;
      continue;
    }
    const detail = netErr ? `${netErr.name}: ${netErr.message}` : `HTTP ${res.status}: ${String(text).slice(0, 600)}`;
    throw new DataError(`FETCH FAILED ${url}\n  ${detail}`);
  }
}

/** fetchCached + JSON.parse with a clear error. */
export async function fetchJSON(url, opts) {
  const r = await fetchCached(url, opts);
  try {
    return { ...r, json: JSON.parse(r.text) };
  } catch (e) {
    throw new DataError(`Invalid JSON from ${url} (cached at ${r.path}): ${e.message}\n${r.text.slice(0, 400)}`);
  }
}

/** HEAD request (not cached) returning content-length or null. */
export async function headContentLength(url) {
  const host = new URL(url).host;
  const last = lastRequestByHost.get(host) ?? 0;
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await sleep(wait);
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(60000) });
    const len = res.headers.get('content-length');
    return len == null ? null : Number(len);
  } finally {
    lastRequestByHost.set(host, Date.now());
  }
}

function shortUrl(u) {
  return u.length > 140 ? `${u.slice(0, 137)}...` : u;
}

export function fmtBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`;
  return `${(n / 1024 / 1024).toFixed(2)} MiB`;
}

/** Build a query string; values are encoded with encodeURIComponent. */
export function qs(params) {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
}

/** Safe file-name fragment for cache keys. */
export function slug(s) {
  return String(s).replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 120);
}

// ---------------------------------------------------------------- numbers
/** Parse a numeric string; returns null for '', null, undefined, non-numeric. Never returns NaN. */
export function num(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/−/g, '-');
  if (s === '' || /^(n\/a|na|null|nan|-+|\?+)$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Round to n significant digits (keeps null). */
export function sig(v, n = 10) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  if (v === 0) return 0;
  return Number(v.toPrecision(n));
}

/** Round to d decimal places (keeps null). */
export function round(v, d) {
  if (v === null || v === undefined || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

/** Normalize an angle to [0, 360). */
export function norm360(x) {
  if (x === null || x === undefined) return null;
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}

/** Recursively verify that an object tree contains no NaN/Infinity. Throws with the offending path. */
export function assertFiniteTree(obj, path = '$') {
  if (typeof obj === 'number') {
    if (!Number.isFinite(obj)) throw new DataError(`Non-finite number at ${path}: ${obj}`);
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) assertFiniteTree(obj[i], `${path}[${i}]`);
    return;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) assertFiniteTree(v, `${path}.${k}`);
  }
}

// ---------------------------------------------------------------- time
/** Julian Date (UTC-based, no leap seconds) from a JS Date. */
export function dateToJD(d) {
  return d.getTime() / 86400000 + 2440587.5;
}

/** ISO date (YYYY-MM-DD) from a JD (calendar conversion, Gregorian; time scale is caller's responsibility). */
export function jdToISO(jd) {
  return new Date((jd - 2440587.5) * 86400000).toISOString();
}

// ---------------------------------------------------------------- output writers
/** Write compact JSON (no indentation) atomically. Returns bytes written. */
export async function writeJSON(path, obj) {
  assertFiniteTree(obj);
  const text = JSON.stringify(obj);
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, text);
  await rename(tmp, path);
  return Buffer.byteLength(text);
}

/** Write a binary buffer atomically. */
export async function writeBinary(path, buf) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  await writeFile(tmp, buf);
  await rename(tmp, path);
  return buf.byteLength;
}

export async function fileBytes(path) {
  return (await stat(path)).size;
}

/** {path (relative to public/), bytes, records} for the manifest. */
export async function fileEntry(absPath, records) {
  return {
    path: relative(PUBLIC_DIR, absPath).replace(/\\/g, '/'),
    bytes: await fileBytes(absPath),
    records,
  };
}

// ---------------------------------------------------------------- manifest fragment
/**
 * Merge dataset records into public/data/solar/manifest.part.json (by id), keeping
 * records written by other solar steps. Records are kept sorted by id.
 */
export async function upsertManifest(records) {
  let manifest = { domain: 'solar', datasets: [] };
  if (existsSync(MANIFEST_PATH)) {
    manifest = JSON.parse(await readFile(MANIFEST_PATH, 'utf8'));
    assert(manifest.domain === 'solar', 'manifest.part.json domain mismatch');
  }
  const byId = new Map(manifest.datasets.map((d) => [d.id, d]));
  for (const r of records) {
    validateRecord(r);
    byId.set(r.id, r);
  }
  manifest.datasets = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  // Manifest is small: pretty-print it for human review (it is not a "giant" JSON).
  await mkdir(dirname(MANIFEST_PATH), { recursive: true });
  await writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  log(`manifest.part.json updated (${records.map((r) => r.id).join(', ')})`);
}

const RECORD_KEYS = [
  'id', 'name', 'organization', 'purpose', 'mechanism', 'endpoint', 'query', 'version', 'retrieved',
  'license', 'licenseUrl', 'citation', 'rateLimits', 'fieldsUsed', 'updateCadence', 'cachePolicy',
  'normalization', 'fallback', 'files', 'limitations', 'provenanceClass',
];

export function validateRecord(r) {
  for (const k of RECORD_KEYS) assert(k in r, `DatasetRecord ${r.id ?? '?'} missing key "${k}"`);
  assert(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(r.id), `DatasetRecord id not kebab-case: ${r.id}`);
  assert(['observed', 'derived', 'reconstructed', 'illustrative'].includes(r.provenanceClass), `bad provenanceClass in ${r.id}`);
  assert(Array.isArray(r.files), `files must be an array in ${r.id}`);
  for (const f of r.files) assert(typeof f.path === 'string' && Number.isInteger(f.bytes), `bad file entry in ${r.id}`);
}

// ---------------------------------------------------------------- shared license / policy text
export const JPL_SSD_LICENSE =
  'U.S. Government (NASA/JPL-Caltech) public data service; no license or reuse restrictions are stated by JPL SSD/CNEOS. ' +
  'Use is governed by the JPL SSD/CNEOS API Fair Use Policy (one request at a time, application-specific User-Agent, cache results, ' +
  'no embedding of the APIs in websites per NASA CORS policy). Do not imply NASA/JPL endorsement.';
export const JPL_SSD_LICENSE_URL = 'https://ssd-api.jpl.nasa.gov/';
export const JPL_RATE =
  'JPL SSD/CNEOS API Fair Use Policy: no numeric limit published; only one request at a time (no simultaneous requests); back off on errors; ' +
  'JPL may throttle or block unreasonable load. Scripts use sequential requests with >= 1.1 s spacing.';
export const NAIF_LICENSE =
  'NAIF SPICE rules: kernels on the NAIF server may be downloaded and used by anyone; redistribution of unmodified kernels is permitted; ' +
  'no fees or licensing required (acknowledgement encouraged).';
export const NAIF_LICENSE_URL = 'https://naif.jpl.nasa.gov/naif/rules.html';
export const NASA_LICENSE =
  'NASA-produced content is generally not subject to U.S. copyright (17 U.S.C. 105) and may be used for educational purposes; ' +
  'credit NASA as the source and do not imply endorsement (NASA Media Usage Guidelines).';
export const NASA_LICENSE_URL = 'https://www.nasa.gov/nasa-brand-center/images-and-media/';
