// Shared helpers for the "stars" data domain (Cosmos / AstroNexus, SCI-FORGE 2026).
//
// - polite HTTP (fixed User-Agent, >=1.1 s between requests to the same host,
//   retry with back-off on 429/5xx, honours Retry-After)
// - raw-download cache under data-raw/stars/ with sidecar <file>.meta.json
//   (url, retrieval time, sha256, bytes, HTTP validators)
// - disk-space guard (never let C: drop below 3.5 GB free)
// - small CSV / HTML-entity helpers (no third-party packages)
//
// Every function fails loudly (throws Error with a clear message).

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const UA = 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)';

/** True when the module with this import.meta.url is the script node was started with. */
export function isMain(metaUrl) {
  if (!process.argv[1]) return false;
  return pathToFileURL(path.resolve(process.argv[1])).href.toLowerCase() === metaUrl.toLowerCase();
}

/** Run an async main() and exit non-zero with a clear message on failure. */
export function runMain(metaUrl, main, label) {
  if (!isMain(metaUrl)) return;
  main().catch((e) => {
    console.error(`\n[stars] ${label} FAILED: ${e.message}\n`);
    if (process.env.STARS_DEBUG) console.error(e.stack);
    process.exit(1);
  });
}

const here = path.dirname(fileURLToPath(import.meta.url));
/** Repository root (C:/Projects/Cosmos), with forward slashes. */
export const ROOT = path.resolve(here, '../../..').replace(/\\/g, '/');
export const RAW_DIR = `${ROOT}/data-raw/stars`;
export const OUT_DIR = `${ROOT}/public/data/stars`;
export const DOC_PATH = `${ROOT}/docs/data/stars.md`;

export const MIN_FREE_BYTES = 3.5 * 1024 ** 3; // hard floor required by the project
export const BIG_DOWNLOAD_BYTES = 100 * 1024 ** 2; // check free space above this size

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function log(...args) {
  console.log('[stars]', ...args);
}

export function fail(message) {
  const err = new Error(message);
  err.name = 'StarsPipelineError';
  throw err;
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function sha256OfBuffer(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

export function sha256OfFile(file) {
  return sha256OfBuffer(fs.readFileSync(file));
}

/** Free bytes on the volume that holds `dir` (fs.statfs works on Windows too). */
export function freeBytes(dir = ROOT) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export function assertDiskSpace(expectedBytes, label) {
  const free = freeBytes(ROOT);
  const after = free - (expectedBytes || 0);
  if (after < MIN_FREE_BYTES) {
    fail(
      `Refusing to download ${label}: ${(expectedBytes / 1e6).toFixed(1)} MB would leave ` +
        `${(after / 1024 ** 3).toFixed(2)} GB free (< 3.5 GB floor). Free some space first.`,
    );
  }
  return free;
}

// ---------------------------------------------------------------- HTTP ----

const lastRequestAt = new Map();

/** Wait so that requests to the same host are >= minIntervalMs apart. */
export async function throttle(url, minIntervalMs = 1100) {
  const host = new URL(url).host;
  const last = lastRequestAt.get(host) ?? 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt.set(host, Date.now());
}

/**
 * fetch() with UA, per-host throttle and retries.
 * Retries on network errors, 429 and 5xx (exponential back-off, honours Retry-After).
 */
export async function politeFetch(url, init = {}, { retries = 4, minIntervalMs = 1100, label = url } = {}) {
  let attempt = 0;
  for (;;) {
    await throttle(url, minIntervalMs);
    let res;
    try {
      res = await fetch(url, {
        ...init,
        headers: { 'User-Agent': UA, ...(init.headers || {}) },
      });
    } catch (e) {
      if (attempt >= retries) fail(`Network error fetching ${label}: ${e.message}`);
      attempt++;
      const backoff = 2000 * 2 ** attempt;
      log(`  network error (${e.message}); retry ${attempt}/${retries} in ${backoff / 1000}s`);
      await sleep(backoff);
      continue;
    }
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) {
        const body = await res.text().catch(() => '');
        fail(`HTTP ${res.status} fetching ${label} after ${retries} retries: ${body.slice(0, 300)}`);
      }
      attempt++;
      const ra = Number(res.headers.get('retry-after'));
      const backoff = Number.isFinite(ra) && ra > 0 ? ra * 1000 : 3000 * 2 ** attempt;
      log(`  HTTP ${res.status}; retry ${attempt}/${retries} in ${(backoff / 1000).toFixed(0)}s`);
      await res.arrayBuffer().catch(() => {});
      await sleep(backoff);
      continue;
    }
    return res;
  }
}

// ---------------------------------------------------------- raw cache ----

export function metaPathFor(file) {
  return `${file}.meta.json`;
}

export function readMeta(file) {
  const p = metaPathFor(file);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function writeMeta(file, meta) {
  fs.writeFileSync(metaPathFor(file), JSON.stringify(meta, null, 2) + '\n');
}

/**
 * Download `url` into data-raw/stars/<name> unless a valid cached copy exists.
 * Options:
 *   expectedSha256 / expectedBytes : verify integrity (fail loudly on mismatch)
 *   refresh                        : ignore cache (for live sources)
 *   extraMeta                      : merged into the sidecar meta file
 */
export async function downloadToCache({ name, url, expectedSha256 = null, expectedBytes = null, refresh = false, extraMeta = {}, minIntervalMs }) {
  ensureDir(RAW_DIR);
  const file = `${RAW_DIR}/${name}`;
  const meta = readMeta(file);
  if (!refresh && fs.existsSync(file) && meta) {
    const st = fs.statSync(file);
    const okSize = st.size === meta.bytes && (expectedBytes == null || st.size === expectedBytes);
    const okHash = expectedSha256 == null || meta.sha256 === expectedSha256;
    if (okSize && okHash) {
      log(`cache hit  ${name} (${(st.size / 1e6).toFixed(2)} MB, retrieved ${meta.retrieved})`);
      return { file, meta, cached: true };
    }
    log(`cache invalid for ${name} (size/hash mismatch) - re-downloading`);
  }

  // HEAD first: learn Content-Length for the disk guard.
  let contentLength = expectedBytes;
  try {
    const head = await politeFetch(url, { method: 'HEAD', redirect: 'follow' }, { label: `HEAD ${name}`, minIntervalMs });
    if (head.ok) {
      const cl = Number(head.headers.get('content-length'));
      if (Number.isFinite(cl) && cl > 0) contentLength = cl;
    }
  } catch (e) {
    log(`  HEAD failed for ${name} (${e.message}); continuing with GET`);
  }
  if (contentLength && contentLength > BIG_DOWNLOAD_BYTES) {
    const free = assertDiskSpace(contentLength, name);
    log(`  large download ${name}: ${(contentLength / 1e6).toFixed(1)} MB; free ${(free / 1024 ** 3).toFixed(2)} GB`);
  } else {
    assertDiskSpace(contentLength || 0, name);
  }

  log(`download   ${name} <- ${url}`);
  const res = await politeFetch(url, { redirect: 'follow' }, { label: name, minIntervalMs });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    fail(`HTTP ${res.status} ${res.statusText} downloading ${name} from ${url}: ${body.slice(0, 300)}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (expectedBytes != null && buf.length !== expectedBytes) {
    fail(`${name}: expected ${expectedBytes} bytes, got ${buf.length}. Upstream changed or transfer truncated.`);
  }
  const sha256 = sha256OfBuffer(buf);
  if (expectedSha256 && sha256 !== expectedSha256) {
    fail(`${name}: SHA-256 mismatch. expected ${expectedSha256}, got ${sha256}. Refusing to use it.`);
  }
  const tmp = `${file}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, file);
  const newMeta = {
    name,
    url,
    finalUrl: res.url,
    retrieved: new Date().toISOString(),
    bytes: buf.length,
    sha256,
    httpStatus: res.status,
    etag: res.headers.get('etag'),
    lastModified: res.headers.get('last-modified'),
    contentType: res.headers.get('content-type'),
    ...extraMeta,
  };
  writeMeta(file, newMeta);
  log(`  saved ${name}: ${(buf.length / 1e6).toFixed(2)} MB sha256=${sha256.slice(0, 16)}...`);
  return { file, meta: newMeta, cached: false };
}

export function readMaybeGz(file) {
  const buf = fs.readFileSync(file);
  if (buf[0] === 0x1f && buf[1] === 0x8b) return zlib.gunzipSync(buf);
  return buf;
}

// ---------------------------------------------------------------- CSV ----

/**
 * Minimal RFC-4180 CSV parser (handles quotes, escaped quotes, CRLF).
 * Returns { header: string[], rows: string[][] }.
 */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = text.length;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // BOM
  for (; i < n; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (c === '\r') {
      // ignore (CRLF)
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const header = rows.shift();
  return { header, rows: rows.filter((r) => !(r.length === 1 && r[0] === '')) };
}

// --------------------------------------------------------------- HTML ----

const NAMED_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : m;
    }
    return NAMED_ENTITIES[e] ?? m;
  });
}

export function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
}

// ------------------------------------------------------------ numbers ----

/** Parse a numeric CSV field; '' / non-finite -> null (never 0). */
export function num(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function int(s) {
  const v = num(s);
  return v == null ? null : Math.trunc(v);
}

export function str(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

/** Round to `d` decimals for compact JSON (null-safe). */
export function round(v, d) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}

export function writeJsonCompact(file, obj) {
  fs.writeFileSync(file, JSON.stringify(obj));
  return fs.statSync(file).size;
}

export async function readJson(file) {
  return JSON.parse(await fsp.readFile(file, 'utf8'));
}

export const DEG = Math.PI / 180;
