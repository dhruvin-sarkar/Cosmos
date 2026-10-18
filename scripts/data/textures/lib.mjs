// Shared helpers for the "textures" data domain (Cosmos / AstroNexus).
// - polite, throttled, cached HTTP downloads (User-Agent, >=1 s per host, retries)
// - disk-space and raw-budget guards (C: is tight; other domains share the disk)
// - OGC WMS / WMTS helpers
// Node >= 22 ESM; no third-party packages except the project's own `sharp`.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..').replace(/\\/g, '/');
export const RAW_DIR = `${ROOT}/data-raw/textures`;
export const PUBLIC_DIR = `${ROOT}/public`;
export const TEX_DIR = `${PUBLIC_DIR}/textures`;
export const DATA_DIR = `${PUBLIC_DIR}/data/textures`;
export const MODELS_DIR = `${PUBLIC_DIR}/models`;

export const UA = 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)';
export const RAW_BUDGET_BYTES = 1.5 * 2 ** 30; // domain raw-download budget
export const OUTPUT_BUDGET_BYTES = 220 * 2 ** 20; // domain output budget (public/textures + models)
export const MIN_FREE_BYTES = 3.5 * 2 ** 30; // never let C: drop below this

const require = createRequire(`${ROOT}/package.json`);
export const sharp = require('sharp');
sharp.cache(false); // avoid libvips holding big images between steps
sharp.concurrency(Math.max(1, Math.min(4, (await import('node:os')).cpus().length)));

export function log(...a) { console.log(`[textures ${new Date().toISOString().slice(11, 19)}]`, ...a); }
export function fail(msg) { const e = new Error(`[textures] ${msg}`); e.isFatal = true; throw e; }
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export function mkdirp(d) { fs.mkdirSync(d, { recursive: true }); }
export function fmtBytes(n) { return n == null ? 'unknown' : n > 2 ** 30 ? `${(n / 2 ** 30).toFixed(2)} GB` : n > 2 ** 20 ? `${(n / 2 ** 20).toFixed(1)} MB` : `${(n / 1024).toFixed(1)} KB`; }

// ---------------------------------------------------------------- disk guards
export function freeBytes(dir = ROOT) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}
export function dirBytes(dir) {
  if (!fs.existsSync(dir)) return 0;
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = `${dir}/${e.name}`;
    n += e.isDirectory() ? dirBytes(p) : fs.statSync(p).size;
  }
  return n;
}
/** Throws if downloading `plannedBytes` would breach the free-space floor or the raw budget. */
export function assertSpaceFor(plannedBytes, what) {
  const planned = plannedBytes ?? 50 * 2 ** 20; // unknown size: assume 50 MB
  const free = freeBytes();
  if (free - planned < MIN_FREE_BYTES) {
    fail(`refusing to download ${what} (${fmtBytes(planned)}): free space ${fmtBytes(free)} would drop below ${fmtBytes(MIN_FREE_BYTES)}`);
  }
  const used = dirBytes(RAW_DIR);
  if (used + planned > RAW_BUDGET_BYTES) {
    fail(`refusing to download ${what} (${fmtBytes(planned)}): raw budget exceeded (${fmtBytes(used)} used of ${fmtBytes(RAW_BUDGET_BYTES)})`);
  }
  if (planned > 100 * 2 ** 20) log(`large download ${what}: ${fmtBytes(planned)} (free ${fmtBytes(free)}, raw used ${fmtBytes(used)})`);
}

// ---------------------------------------------------------------- HTTP
const lastHit = new Map(); // host -> timestamp of last request start
const HOST_MIN_INTERVAL_MS = { default: 1000 };
async function throttle(url) {
  const host = new URL(url).host;
  const min = HOST_MIN_INTERVAL_MS[host] ?? HOST_MIN_INTERVAL_MS.default;
  const wait = (lastHit.get(host) ?? 0) + min - Date.now();
  if (wait > 0) await sleep(wait);
  lastHit.set(host, Date.now());
}

async function fetchWithRetry(url, opts = {}, { retries = 4, timeoutMs = 180_000, label = url } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    await throttle(url);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(new Error(`timeout after ${timeoutMs} ms`)), timeoutMs);
    try {
      const res = await fetch(url, { ...opts, headers: { 'User-Agent': UA, ...(opts.headers || {}) }, signal: ctrl.signal, redirect: 'follow' });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new Error(`HTTP ${res.status} for ${label}`);
        await res.body?.cancel();
      } else {
        return { res, timer };
      }
    } catch (e) {
      lastErr = e;
    }
    clearTimeout(timer);
    if (attempt < retries) {
      const backoff = Math.min(120_000, 5000 * 3 ** attempt);
      log(`  retry ${attempt + 1}/${retries} for ${label} in ${backoff / 1000}s (${lastErr?.cause?.code || lastErr?.message})`);
      await sleep(backoff);
    }
  }
  fail(`network failure for ${label}: ${lastErr?.cause?.code || ''} ${lastErr?.message}`);
}

export async function head(url) {
  const { res, timer } = await fetchWithRetry(url, { method: 'HEAD' }, { retries: 2, timeoutMs: 60_000 });
  clearTimeout(timer);
  const len = res.headers.get('content-length');
  return { status: res.status, ok: res.ok, bytes: len == null ? null : Number(len), type: res.headers.get('content-type'), lastModified: res.headers.get('last-modified'), finalUrl: res.url };
}

/** GET into memory (small responses: capabilities, JSON, tiles). */
export async function getBuffer(url, { expectType, label, timeoutMs } = {}) {
  const { res, timer } = await fetchWithRetry(url, {}, { label, timeoutMs });
  try {
    if (!res.ok) fail(`HTTP ${res.status} for ${label || url}`);
    const buf = Buffer.from(await res.arrayBuffer());
    const type = res.headers.get('content-type') || '';
    if (expectType && !expectType.test(type)) fail(`unexpected content-type "${type}" for ${label || url}: ${buf.toString('utf8', 0, 300).replace(/\s+/g, ' ')}`);
    return { buf, type, lastModified: res.headers.get('last-modified') };
  } finally { clearTimeout(timer); }
}

function sidecarPath(p) { return `${p}.meta.json`; }
export function readSidecar(p) { try { return JSON.parse(fs.readFileSync(sidecarPath(p), 'utf8')); } catch { return null; } }

/**
 * Download `url` to `dest` (cached). Skips if `dest` + sidecar exist for the same URL.
 * Streams to `<dest>.part`, validates content-type / size, then renames atomically.
 * Returns the sidecar metadata {url, retrieved, bytes, contentType, lastModified}.
 */
export async function download(url, dest, { expectType, minBytes = 1, label, skipHead = false, timeoutMs = 900_000 } = {}) {
  label ||= path.basename(dest);
  const side = readSidecar(dest);
  if (fs.existsSync(dest) && side && side.url === url && fs.statSync(dest).size === side.bytes) {
    log(`cached  ${label} (${fmtBytes(side.bytes)})`);
    return side;
  }
  mkdirp(path.dirname(dest));
  let planned = null;
  if (!skipHead) {
    try { const h = await head(url); if (h.ok) planned = h.bytes; } catch { /* some servers reject HEAD */ }
  }
  assertSpaceFor(planned, label);
  log(`fetch   ${label} ${planned ? `(${fmtBytes(planned)})` : ''} <- ${url}`);
  const { res, timer } = await fetchWithRetry(url, {}, { label, timeoutMs });
  const part = `${dest}.part`;
  try {
    if (!res.ok) fail(`HTTP ${res.status} for ${label} (${url})`);
    const type = res.headers.get('content-type') || '';
    if (expectType && !expectType.test(type)) {
      const txt = Buffer.from(await res.arrayBuffer()).toString('utf8', 0, 400).replace(/\s+/g, ' ');
      fail(`unexpected content-type "${type}" for ${label}: ${txt}`);
    }
    const out = fs.createWriteStream(part);
    let bytes = 0;
    for await (const chunk of res.body) {
      bytes += chunk.length;
      if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
    }
    await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    if (bytes < minBytes) fail(`download too small for ${label}: ${bytes} bytes`);
    if (planned != null && bytes !== planned) fail(`size mismatch for ${label}: got ${bytes}, Content-Length said ${planned}`);
    fs.renameSync(part, dest);
    const meta = { url, retrieved: new Date().toISOString(), bytes, contentType: type, lastModified: res.headers.get('last-modified') };
    fs.writeFileSync(sidecarPath(dest), JSON.stringify(meta, null, 1));
    return meta;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch { /* ignore */ }
    throw e;
  } finally { clearTimeout(timer); }
}

/** Write a buffer as a cached raw file with sidecar (used for assembled WMS/WMTS mosaics). */
export function writeCached(dest, buf, meta) {
  mkdirp(path.dirname(dest));
  fs.writeFileSync(dest, buf);
  const m = { ...meta, retrieved: meta.retrieved || new Date().toISOString(), bytes: buf.length };
  fs.writeFileSync(sidecarPath(dest), JSON.stringify(m, null, 1));
  return m;
}

// ---------------------------------------------------------------- OGC WMS (USGS Astrogeology planetary WMS)
export const USGS_WMS = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv';
export function wmsGetMapUrl({ mapfile, layer, width, height, format = 'image/png', bbox = [-180, -90, 180, 90], transparent = false, service = USGS_WMS }) {
  // WMS 1.1.1 + EPSG:4326 => BBOX axis order is lon,lat (minx,miny,maxx,maxy); no 1.3.0 axis-swap ambiguity.
  const q = new URLSearchParams({ map: mapfile, SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer, STYLES: '', SRS: 'EPSG:4326', BBOX: bbox.join(','), WIDTH: String(width), HEIGHT: String(height), FORMAT: format, TRANSPARENT: transparent ? 'TRUE' : 'FALSE' });
  return `${service}?${q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',')}`;
}
export function wmsCapabilitiesUrl(mapfile, service = USGS_WMS) {
  return `${service}?map=${mapfile}&SERVICE=WMS&VERSION=1.3.0&REQUEST=GetCapabilities`;
}
/** Returns {title, abstract} of a layer from a WMS 1.3.0 capabilities document. */
export function wmsLayerInfo(capsXml, layer) {
  const re = new RegExp(`<Name>${layer}</Name>\\s*<Title>([^<]*)</Title>\\s*(?:<Abstract>([\\s\\S]*?)</Abstract>)?`);
  const m = capsXml.match(re);
  if (!m) return null;
  const dec = (s) => (s || '').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
  return { title: dec(m[1]), abstract: dec(m[2]) };
}

// ---------------------------------------------------------------- OGC WMTS (NASA Solar System Treks)
/** Fetch all tiles of one TileMatrix level and assemble into a single raw RGB(A) image buffer. */
export async function wmtsMosaic({ template, level, cols, rows, tileSize = 256, label, cacheDir }) {
  mkdirp(cacheDir);
  const tiles = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const url = template.replace('{TileMatrix}', level).replace('{TileRow}', r).replace('{TileCol}', c);
      const ext = url.split('.').pop();
      const p = `${cacheDir}/${level}_${r}_${c}.${ext}`;
      if (!fs.existsSync(p) || fs.statSync(p).size === 0) {
        const { buf } = await getBuffer(url, { expectType: /^image\//, label: `${label} tile ${level}/${r}/${c}` });
        fs.writeFileSync(p, buf);
      }
      tiles.push({ input: p, left: c * tileSize, top: r * tileSize });
    }
    log(`  ${label}: row ${r + 1}/${rows} done`);
  }
  return sharp({ create: { width: cols * tileSize, height: rows * tileSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(tiles).png().toBuffer();
}

// ---------------------------------------------------------------- image helpers
export async function imageStats(input) {
  const s = await sharp(input).stats();
  return s.channels.map((c) => ({ min: c.min, max: c.max, mean: +c.mean.toFixed(2), stdev: +c.stdev.toFixed(2) }));
}
/** Mean RGB(A) of a lon/lat box sampled from an equirectangular image (x=0 at 180W, y=0 at 90N). */
export async function sampleBox(input, { lon0, lon1, lat0, lat1 }) {
  const m = await sharp(input).metadata();
  const W = m.width, H = m.height;
  const x0 = Math.max(0, Math.floor(((lon0 + 180) / 360) * W)), x1 = Math.min(W, Math.ceil(((lon1 + 180) / 360) * W));
  const y0 = Math.max(0, Math.floor(((90 - lat1) / 180) * H)), y1 = Math.min(H, Math.ceil(((90 - lat0) / 180) * H));
  const { data, info } = await sharp(input).extract({ left: x0, top: y0, width: Math.max(1, x1 - x0), height: Math.max(1, y1 - y0) }).raw().toBuffer({ resolveWithObject: true });
  const ch = info.channels, n = data.length / ch, sum = new Array(ch).fill(0);
  for (let i = 0; i < data.length; i++) sum[i % ch] += data[i];
  return sum.map((s) => +(s / n).toFixed(1));
}
export function fileBytes(p) { return fs.statSync(p).size; }
export function relPublic(p) { return p.replace(/\\/g, '/').replace(`${PUBLIC_DIR}/`, ''); }
