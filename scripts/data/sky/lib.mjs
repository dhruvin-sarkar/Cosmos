// Shared helpers for the "sky" data domain (all-sky multi-wavelength imagery).
// - polite HTTP (User-Agent, >=1.1 s per-host throttle, retries, mirror fallback)
// - raw download cache under data-raw/sky with .meta.json sidecars (provenance)
// - minimal FITS reader (primary HDU, BITPIX 8/16/32/-32/-64)
// - 16-bit grayscale PNG encoder (zlib, tEXt chunks)
// - colormaps (explicit sRGB stops) + stretch functions
// No third-party dependencies except "sharp" (already in package.json).

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharpModule from 'sharp';

export const sharp = sharpModule;
sharp.cache(false);

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '../../..').replace(/\\/g, '/');
export const RAW_DIR = `${ROOT}/data-raw/sky`;
export const OUT_DIR = `${ROOT}/public/data/sky`;
export const UA = 'Cosmos/0.1 (educational SCI-FORGE 2026 project)';

// Two independent CDS endpoints (documented on the hips2fits page). We prefer the primary and fall back to the mirror.
export const CDS_HOSTS = ['https://alasky.cds.unistra.fr', 'https://alaskybis.cds.unistra.fr'];
export const HIPS2FITS_PATH = '/hips-image-services/hips2fits';
export const MOCSERVER_PATH = '/MocServer/query';

export const MIN_FREE_BYTES = 3.5 * 1024 ** 3; // never let C: drop below 3.5 GB
export const MIN_INTERVAL_MS = 1100; // >= 1 s between requests to the same host

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const log = (...a) => console.log(`[sky ${new Date().toISOString().slice(11, 19)}]`, ...a);

export function fail(msg) {
  const e = new Error(`[sky] ${msg}`);
  e.fatal = true;
  throw e;
}

export function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

export function freeBytes(p = ROOT) {
  const s = fs.statfsSync(p);
  return Number(s.bavail) * Number(s.bsize);
}

export function assertDiskSpace(expectedBytes, what) {
  const free = freeBytes();
  if (free - expectedBytes < MIN_FREE_BYTES) {
    fail(`Refusing to download ${what}: free space ${(free / 1e9).toFixed(2)} GB minus expected ${(expectedBytes / 1e6).toFixed(0)} MB would drop below 3.5 GB.`);
  }
}

// ---------------------------------------------------------------- HTTP
const lastHit = new Map();

/**
 * fetch() with User-Agent, per-host throttle, timeout and retries on network errors / 429 / 5xx.
 * `urls` may be a single URL or an array of equivalent mirror URLs (tried round-robin on failure).
 */
export async function politeFetch(urls, { method = 'GET', timeoutMs = 600000, retries = 5, accept } = {}) {
  const list = Array.isArray(urls) ? urls : [urls];
  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const url = list[attempt % list.length];
    const host = new URL(url).host;
    const wait = (lastHit.get(host) ?? 0) + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait);
    lastHit.set(host, Date.now());
    try {
      const headers = { 'User-Agent': UA };
      if (accept) headers.Accept = accept;
      const r = await fetch(url, { method, headers, signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      if (r.status === 429 || r.status >= 500) {
        const body = (await r.text().catch(() => '')).slice(0, 300);
        throw new Error(`HTTP ${r.status} from ${host}: ${body}`);
      }
      return r;
    } catch (e) {
      lastErr = e;
      const backoff = Math.min(120000, 5000 * 3 ** attempt);
      if (attempt < retries) {
        log(`  request failed (${e.cause?.code || e.name}: ${String(e.message).slice(0, 160)}); retry ${attempt + 1}/${retries} in ${backoff / 1000}s`);
        await sleep(backoff);
      }
    }
  }
  fail(`Giving up on ${list[0]} after ${retries + 1} attempts: ${lastErr?.cause?.code || ''} ${lastErr?.message}`);
}

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

/**
 * Download to `dest` unless it is already cached (with its .meta.json sidecar).
 * Validates the HTTP status and content-type (avoids caching HTML/JSON error pages).
 * Returns the sidecar metadata {url, retrieved, bytes, contentType, sha256, cached}.
 */
export async function cachedDownload(urls, dest, { expectTypes, expectBytes = 0, refresh = false, what = dest } = {}) {
  const metaPath = `${dest}.meta.json`;
  if (!refresh && fs.existsSync(dest) && fs.existsSync(metaPath) && fs.statSync(dest).size > 0) {
    const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    return { ...meta, cached: true };
  }
  ensureDir(path.dirname(dest));
  if (expectBytes > 100e6) assertDiskSpace(expectBytes, what);
  else assertDiskSpace(expectBytes, what);
  const t0 = Date.now();
  const r = await politeFetch(urls);
  const ctype = (r.headers.get('content-type') || '').split(';')[0].trim();
  const buf = Buffer.from(await r.arrayBuffer());
  if (r.status !== 200) fail(`HTTP ${r.status} for ${what}: ${buf.toString('utf8').slice(0, 500)}`);
  if (expectTypes && !expectTypes.includes(ctype)) {
    fail(`Unexpected content-type "${ctype}" for ${what} (expected ${expectTypes.join(' or ')}): ${buf.toString('utf8').slice(0, 300)}`);
  }
  if (buf.length === 0) fail(`Empty response for ${what}`);
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, dest);
  const meta = {
    url: r.url || (Array.isArray(urls) ? urls[0] : urls),
    retrieved: new Date().toISOString(),
    bytes: buf.length,
    contentType: ctype,
    sha256: sha256(buf),
    seconds: +((Date.now() - t0) / 1000).toFixed(1),
  };
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 1));
  log(`  downloaded ${path.basename(dest)} (${(buf.length / 1e6).toFixed(2)} MB, ${meta.seconds}s)`);
  return { ...meta, cached: false };
}

// ---------------------------------------------------------------- CDS services
export function safeName(id) {
  return id.replace(/[^A-Za-z0-9._-]+/g, '_');
}

/** MocServer record for one HiPS ID (cached JSON). */
export async function mocRecord(hipsId, { refresh = false } = {}) {
  const dest = `${RAW_DIR}/mocserver/${safeName(hipsId)}.json`;
  const q = `?expr=${encodeURIComponent(`ID=${hipsId}`)}&get=record&fmt=json`;
  const meta = await cachedDownload(CDS_HOSTS.map((h) => h + MOCSERVER_PATH + q), dest, {
    expectTypes: ['application/json', 'text/plain', 'text/json'],
    refresh,
    what: `MocServer record ${hipsId}`,
  });
  const arr = JSON.parse(fs.readFileSync(dest, 'utf8'));
  if (!Array.isArray(arr) || arr.length !== 1) fail(`MocServer returned ${Array.isArray(arr) ? arr.length : 'non-array'} records for ${hipsId}`);
  return { record: arr[0], meta, query: CDS_HOSTS[0] + MOCSERVER_PATH + q };
}

/**
 * WCS for the Cosmos all-sky convention: plate carree (CAR), ICRS, W = 2H,
 * pixel column x (0-based) centre -> RA = 360*(x+0.5)/W (RA increases to the right, RA=0 at left edge),
 * row y (0-based from top) centre -> Dec = 90 - 180*(y+0.5)/H.
 * In FITS terms: CRPIX = (W/2+0.5, H/2+0.5), CRVAL = (180, 0), CDELT1 = +360/W (positive!), CDELT2 = +180/H.
 */
export function cosmosWcs(width) {
  const height = width / 2;
  return {
    NAXIS: 2,
    NAXIS1: width,
    NAXIS2: height,
    CTYPE1: 'RA---CAR',
    CTYPE2: 'DEC--CAR',
    CRPIX1: width / 2 + 0.5,
    CRPIX2: height / 2 + 0.5,
    CRVAL1: 180,
    CRVAL2: 0,
    CDELT1: 360 / width,
    CDELT2: 180 / height,
    CUNIT1: 'deg',
    CUNIT2: 'deg',
    RADESYS: 'ICRS',
  };
}

export function hips2fitsParams(hipsId, width, format, extra = {}) {
  const p = new URLSearchParams({ hips: hipsId, wcs: JSON.stringify(cosmosWcs(width)), format });
  for (const [k, v] of Object.entries(extra)) p.set(k, String(v));
  return p.toString();
}

export function hips2fitsUrls(hipsId, width, format, extra) {
  const qs = hips2fitsParams(hipsId, width, format, extra);
  return CDS_HOSTS.map((h) => `${h}${HIPS2FITS_PATH}?${qs}`);
}

const TYPES = { jpg: ['image/jpeg'], png: ['image/png'], fits: ['application/fits', 'image/fits', 'application/octet-stream'] };

/** Render (or reuse cached) an all-sky CAR image through hips2fits. */
export async function hips2fits(hipsId, width, format, { dir, name, extra, refresh } = {}) {
  const dest = `${RAW_DIR}/hips2fits/${dir}/${name}_${width}x${width / 2}.${format}`;
  const expectBytes = format === 'fits' ? width * (width / 2) * 4 : width * (width / 2) * 1.5;
  const meta = await cachedDownload(hips2fitsUrls(hipsId, width, format, extra), dest, {
    expectTypes: TYPES[format],
    expectBytes,
    refresh,
    what: `hips2fits ${hipsId} ${width}px ${format}`,
  });
  return { path: dest, meta, query: hips2fitsParams(hipsId, width, format, extra) };
}

// ---------------------------------------------------------------- FITS
/** Minimal FITS primary-HDU reader. Returns {header, width, height, depth, data: Float32Array} (FITS order: row 0 = bottom). */
export function readFits(file) {
  const buf = fs.readFileSync(file);
  const header = {};
  let off = 0;
  let ended = false;
  while (off + 80 <= buf.length) {
    const card = buf.subarray(off, off + 80).toString('latin1');
    off += 80;
    const key = card.slice(0, 8).trim();
    if (key === 'END') {
      ended = true;
      break;
    }
    if (card[8] === '=' && card[9] === ' ') {
      let raw = card.slice(10);
      let val;
      if (raw.trimStart().startsWith("'")) {
        const m = raw.match(/'((?:[^']|'')*)'/);
        val = m ? m[1].replace(/''/g, "'").trimEnd() : raw.trim();
      } else {
        raw = raw.split('/')[0].trim();
        if (raw === 'T' || raw === 'F') val = raw === 'T';
        else val = Number(raw);
      }
      header[key] = val;
    }
  }
  if (!ended || header.SIMPLE !== true) fail(`${file}: not a valid FITS primary HDU`);
  const dataStart = Math.ceil(off / 2880) * 2880;
  const bitpix = header.BITPIX;
  const w = header.NAXIS1;
  const h = header.NAXIS2;
  const d = header.NAXIS >= 3 ? header.NAXIS3 : 1;
  const n = w * h * d;
  const bs = header.BSCALE ?? 1;
  const bz = header.BZERO ?? 0;
  const blank = header.BLANK;
  const bpp = Math.abs(bitpix) / 8;
  if (buf.length < dataStart + n * bpp) fail(`${file}: truncated FITS data (${buf.length} < ${dataStart + n * bpp})`);
  const out = new Float32Array(n);
  const dv = new DataView(buf.buffer, buf.byteOffset + dataStart, n * bpp);
  for (let i = 0; i < n; i++) {
    let v;
    switch (bitpix) {
      case 8: v = dv.getUint8(i); break;
      case 16: v = dv.getInt16(i * 2, false); break;
      case 32: v = dv.getInt32(i * 4, false); break;
      case -32: v = dv.getFloat32(i * 4, false); break;
      case -64: v = dv.getFloat64(i * 8, false); break;
      default: fail(`${file}: unsupported BITPIX ${bitpix}`);
    }
    if (bitpix > 0 && blank !== undefined && v === blank) out[i] = NaN;
    else out[i] = v * bs + bz;
  }
  return { header, width: w, height: h, depth: d, data: out };
}

/** Statistics on finite values (sampled for speed). */
export function stats(arr, step = 7) {
  const vals = [];
  let nan = 0;
  let inf = 0;
  for (let i = 0; i < arr.length; i += step) {
    const v = arr[i];
    if (Number.isNaN(v)) nan++;
    else if (!Number.isFinite(v)) inf++;
    else vals.push(v);
  }
  vals.sort((a, b) => a - b);
  const q = (p) => (vals.length ? vals[Math.min(vals.length - 1, Math.floor(p * (vals.length - 1)))] : null);
  let fullNaN = 0;
  let fullInf = 0;
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    if (Number.isNaN(v)) fullNaN++;
    else if (!Number.isFinite(v)) fullInf++;
  }
  return { n: arr.length, nan: fullNaN, inf: fullInf, min: q(0), p001: q(0.001), p01: q(0.01), p05: q(0.05), p50: q(0.5), p95: q(0.95), p99: q(0.99), p999: q(0.999), max: q(1) };
}

// ---------------------------------------------------------------- colour
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

/**
 * Colormaps used by Cosmos, defined EXACTLY by evenly spaced sRGB stops with piecewise-linear interpolation in sRGB.
 * (The 'inferno11'/'magma11' stops approximate matplotlib's perceptually uniform maps; 'rdbu11r' is ColorBrewer RdBu-11 reversed.)
 */
export const COLORMAPS = {
  // black -> deep red -> red -> orange -> pale yellow-white (H-alpha 656.3 nm is red light)
  halpha: ['#000000', '#1c0000', '#420000', '#6e0500', '#9c1004', '#c9260c', '#ec4b1c', '#fd7d3c', '#ffb173', '#ffdcb4', '#fff7ec'],
  // approximates matplotlib "inferno" (11 stops)
  inferno11: ['#000004', '#160b39', '#420a68', '#6a176e', '#932667', '#bc3754', '#dd513a', '#f37819', '#fca50a', '#f6d746', '#fcffa4'],
  // approximates matplotlib "magma" (11 stops)
  magma11: ['#000004', '#140e36', '#3b0f70', '#641a80', '#8c2981', '#b73779', '#de4968', '#f7705c', '#fe9f6d', '#fecf92', '#fcfdbf'],
  // black -> navy -> blue -> cyan -> white (neutral hydrogen 21 cm)
  ice: ['#000000', '#020c1f', '#061b3d', '#0b2f63', '#11478c', '#1b63b3', '#3383d0', '#5ea6e2', '#93c8ee', '#c9e6f7', '#ffffff'],
  // ColorBrewer RdBu (11 classes) reversed: cold = blue, hot = red (CMB)
  rdbu11r: ['#053061', '#2166ac', '#4393c3', '#92c5de', '#d1e5f0', '#f7f7f7', '#fddbc7', '#f4a582', '#d6604d', '#b2182b', '#67001f'],
};

export function buildLut(stops, size = 4096) {
  const rgb = stops.map(hexToRgb);
  const lut = new Uint8Array(size * 3);
  const segs = rgb.length - 1;
  for (let i = 0; i < size; i++) {
    const t = i / (size - 1);
    const s = Math.min(segs - 1, Math.floor(t * segs));
    const f = t * segs - s;
    for (let c = 0; c < 3; c++) lut[i * 3 + c] = Math.round(rgb[s][c] + (rgb[s + 1][c] - rgb[s][c]) * f);
  }
  return lut;
}

/** Stretch: maps a physical value to t in [0,1] (unclipped; caller clips). Exact formulas are documented in docs/data/sky.md. */
export function makeStretch({ stretch, min, max, softening }) {
  switch (stretch) {
    case 'linear':
      return (v) => (v - min) / (max - min);
    case 'log10': {
      if (!(min > 0)) fail('log10 stretch needs min > 0');
      const l0 = Math.log10(min);
      const dl = Math.log10(max) - l0;
      return (v) => (v > 0 ? (Math.log10(v) - l0) / dl : -1);
    }
    case 'asinh': {
      const s = softening;
      const den = Math.asinh((max - min) / s);
      return (v) => Math.asinh((v - min) / s) / den;
    }
    case 'sqrt':
      return (v) => (v <= min ? 0 : Math.sqrt((v - min) / (max - min)));
    default:
      fail(`unknown stretch ${stretch}`);
  }
}

/**
 * Render a FITS (row 0 = bottom) scalar map into a top-down RGB buffer using a stretch + colormap.
 * NaN -> noData colour (black) and alpha mask 0.
 */
export function renderScalar(fits, { stretch, min, max, softening, colormap }) {
  const { width: w, height: h, data } = fits;
  const f = makeStretch({ stretch, min, max, softening });
  const lut = buildLut(COLORMAPS[colormap]);
  const L = lut.length / 3 - 1;
  const rgb = Buffer.alloc(w * h * 3);
  const mask = Buffer.alloc(w * h);
  let nan = 0;
  let clipLo = 0;
  let clipHi = 0;
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w; // flip: FITS row 0 is the bottom (south)
    for (let x = 0; x < w; x++) {
      const v = data[srcRow + x];
      const o = y * w + x;
      if (!Number.isFinite(v)) {
        nan++;
        continue; // black, mask 0
      }
      let t = f(v);
      if (t < 0) { t = 0; clipLo++; } else if (t > 1) { t = 1; clipHi++; }
      const k = Math.round(t * L) * 3;
      rgb[o * 3] = lut[k];
      rgb[o * 3 + 1] = lut[k + 1];
      rgb[o * 3 + 2] = lut[k + 2];
      mask[o] = 255;
    }
  }
  return { rgb, mask, width: w, height: h, nan, clipLo, clipHi };
}

/** Top-down Float32 copy of a FITS image (row 0 = north). */
export function topDown(fits) {
  const { width: w, height: h, data } = fits;
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) out.set(data.subarray((h - 1 - y) * w, (h - y) * w), y * w);
  return out;
}

// ---------------------------------------------------------------- PNG (16-bit grey)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** Encode a Uint16Array (top-down, row-major) as a 16-bit grayscale PNG with optional tEXt key/values. */
export function encodePng16(u16, width, height, text = {}) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 16; // bit depth
  ihdr[9] = 0; // colour type: greyscale
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const stride = width * 2 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const o = y * stride;
    raw[o] = 2; // filter "Up" (good for smooth maps)
    for (let x = 0; x < width; x++) {
      const v = u16[y * width + x];
      const up = y > 0 ? u16[(y - 1) * width + x] : 0;
      // PNG filters operate on bytes: big-endian hi, lo
      raw[o + 1 + x * 2] = ((v >> 8) - (up >> 8)) & 0xff;
      raw[o + 2 + x * 2] = ((v & 0xff) - (up & 0xff)) & 0xff;
    }
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  const texts = Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    ...texts,
    chunk('IDAT', idat),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Decode our own 16-bit grey PNG (filter types 0-4 supported) -> Uint16Array (for validation). */
export function decodePng16(buf) {
  let off = 8;
  let w = 0;
  let h = 0;
  const idats = [];
  const text = {};
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
      if (data[8] !== 16 || data[9] !== 0) fail('decodePng16: not 16-bit greyscale');
    } else if (type === 'IDAT') idats.push(data);
    else if (type === 'tEXt') {
      const z = data.indexOf(0);
      text[data.toString('latin1', 0, z)] = data.toString('latin1', z + 1);
    }
    off += 12 + len;
  }
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const stride = w * 2;
  const out = new Uint16Array(w * h);
  const prev = Buffer.alloc(stride);
  const cur = Buffer.alloc(stride);
  for (let y = 0; y < h; y++) {
    const ft = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 2 ? cur[i - 2] : 0;
      const b = prev[i];
      const c = i >= 2 ? prev[i - 2] : 0;
      let p;
      switch (ft) {
        case 0: p = 0; break;
        case 1: p = a; break;
        case 2: p = b; break;
        case 3: p = (a + b) >> 1; break;
        case 4: {
          const pa = Math.abs(b - c);
          const pb = Math.abs(a - c);
          const pc = Math.abs(a + b - 2 * c);
          p = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
        default: fail(`decodePng16: bad filter ${ft}`);
      }
      cur[i] = (line[i] + p) & 0xff;
    }
    for (let x = 0; x < w; x++) out[y * w + x] = (cur[x * 2] << 8) | cur[x * 2 + 1];
    cur.copy(prev);
  }
  return { width: w, height: h, data: out, text };
}

// ---------------------------------------------------------------- image output helpers
export async function writeJpeg(input, rawInfo, dest, { quality = 88, resizeTo } = {}) {
  ensureDir(path.dirname(dest));
  let img = rawInfo ? sharp(input, { raw: rawInfo, limitInputPixels: false }) : sharp(input, { limitInputPixels: false });
  if (resizeTo) img = img.resize(resizeTo, resizeTo / 2, { kernel: 'lanczos3', fit: 'fill' });
  await img.removeAlpha().jpeg({ quality, mozjpeg: true, chromaSubsampling: '4:2:0' }).toFile(dest);
  return fs.statSync(dest).size;
}

export async function writeMaskPng(maskBuf, width, height, dest, resizeTo) {
  ensureDir(path.dirname(dest));
  let img = sharp(maskBuf, { raw: { width, height, channels: 1 }, limitInputPixels: false });
  if (resizeTo) img = img.resize(resizeTo, resizeTo / 2, { kernel: 'nearest', fit: 'fill' });
  // threshold after resampling so the mask stays binary (0 = no data, 255 = data)
  await img.threshold(128).png({ compressionLevel: 9, palette: false }).toFile(dest);
  return fs.statSync(dest).size;
}

/** Convention helpers (used by validation and docs). */
export const pixelToRaDec = (x, y, W, H) => [(360 * (x + 0.5)) / W, 90 - (180 * (y + 0.5)) / H];
export const raDecToPixel = (ra, dec, W, H) => [(((ra % 360) + 360) % 360) / 360 * W - 0.5, ((90 - dec) / 180) * H - 0.5];
