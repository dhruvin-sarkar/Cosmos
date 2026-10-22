// Shared helpers for the "galaxies" data domain (Cosmos, SCI-FORGE 2026).
// Pure Node (>=22) ESM, no third-party packages.
//
//  - polite HTTP (User-Agent, per-host throttle >= 1 s, retries, loud failures)
//  - on-disk raw cache under data-raw/galaxies/ with retrieval-time sidecars
//  - streaming large-file download with Content-Length + free-disk guard
//  - VizieR ASU-TSV parser, minimal VOTable writer (for TAP uploads)
//  - minimal FITS BINTABLE reader (header + streaming row iterator)
//  - flat LambdaCDM comoving distance (Planck 2018), CMB-dipole frame change
//  - deterministic PRNG for reproducible random down-sampling
//
// All paths use forward slashes; Node on Windows accepts them.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

export const UA = 'Cosmos/0.1 (educational SCI-FORGE 2026 project)';

const HERE = fileURLToPath(new URL('.', import.meta.url)).replace(/\\/g, '/').replace(/\/$/, '');
export const ROOT = HERE.replace(/\/scripts\/data\/galaxies$/, '');
export const RAW_DIR = `${ROOT}/data-raw/galaxies`;
export const OUT_DIR = `${ROOT}/public/data/galaxies`;
export const META_DIR = `${RAW_DIR}/_meta`;
export const DOC_PATH = `${ROOT}/docs/data/galaxies.md`;

// Disk-space policy from the project brief: never let C: drop below 3.5 GB free.
export const MIN_FREE_BYTES = 3.5 * 1024 ** 3;

export function log(...args) {
  const t = new Date().toISOString().slice(11, 19);
  console.log(`[galaxies ${t}]`, ...args);
}

export function fail(msg) {
  const e = new Error(`[galaxies] ${msg}`);
  e.isDomainFailure = true;
  throw e;
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function freeBytes(dir = ROOT) {
  const s = fs.statfsSync(dir);
  return Number(s.bavail) * Number(s.bsize);
}

export function fmtBytes(n) {
  if (n == null) return 'unknown';
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i ? 2 : 0)} ${u[i]}`;
}

export function sha256File(path) {
  const h = crypto.createHash('sha256');
  const fd = fs.openSync(path, 'r');
  const buf = Buffer.allocUnsafe(1 << 20);
  try {
    let n;
    while ((n = fs.readSync(fd, buf, 0, buf.length, null)) > 0) h.update(buf.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return h.digest('hex');
}

export function sha1(s) {
  return crypto.createHash('sha1').update(s).digest('hex');
}

// ---------------------------------------------------------------------------
// HTTP with per-host throttle + retries
// ---------------------------------------------------------------------------
const lastHitByHost = new Map();

async function throttleHost(url, minIntervalMs) {
  const host = new URL(url).host;
  const last = lastHitByHost.get(host) || 0;
  const wait = last + minIntervalMs - Date.now();
  if (wait > 0) await sleep(wait);
  lastHitByHost.set(host, Date.now());
}

/**
 * fetch() wrapper: sends the project User-Agent, throttles to >= minIntervalMs per host,
 * retries transient failures (network, 429, 5xx) with backoff, and throws a clear error otherwise.
 */
export async function httpFetch(url, { method = 'GET', headers = {}, body, minIntervalMs = 1100,
  retries = 4, timeoutMs = 300000, expectOk = true } = {}) {
  let attempt = 0;
  for (;;) {
    attempt++;
    await throttleHost(url, minIntervalMs);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method, body, signal: ctrl.signal, redirect: 'follow',
        headers: { 'User-Agent': UA, ...headers },
      });
      if (!expectOk || res.ok || res.status === 206) { clearTimeout(timer); return res; }
      const snippet = (await res.text().catch(() => '')).slice(0, 400).replace(/\s+/g, ' ');
      clearTimeout(timer);
      const transient = res.status === 429 || res.status >= 500;
      if (transient && attempt <= retries) {
        const backoff = Math.min(60000, 2000 * 2 ** (attempt - 1));
        log(`HTTP ${res.status} from ${new URL(url).host}; retry ${attempt}/${retries} in ${backoff / 1000}s`);
        await sleep(backoff);
        continue;
      }
      fail(`HTTP ${res.status} ${res.statusText} for ${method} ${url}\n  body: ${snippet}`);
    } catch (err) {
      clearTimeout(timer);
      if (err.isDomainFailure) throw err;
      if (attempt <= retries) {
        const backoff = Math.min(60000, 2000 * 2 ** (attempt - 1));
        log(`network error (${err.name}: ${err.message}) for ${new URL(url).host}; retry ${attempt}/${retries} in ${backoff / 1000}s`);
        await sleep(backoff);
        continue;
      }
      fail(`network failure for ${method} ${url}: ${err.message}`);
    }
  }
}

/** Sidecar metadata for cached raw files: {url, retrieved, bytes, sha256, request?} */
function sidecarPath(p) { return `${p}.meta.json`; }

export function readSidecar(p) {
  try { return JSON.parse(fs.readFileSync(sidecarPath(p), 'utf8')); } catch { return null; }
}

function writeSidecar(p, meta) {
  fs.writeFileSync(sidecarPath(p), JSON.stringify(meta, null, 1));
}

function writeAtomic(p, data) {
  const tmp = `${p}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, p);
}

/**
 * GET/POST a text resource with an on-disk cache (relative to RAW_DIR).
 * Returns {text, meta, fromCache}. Use --refresh on the CLI to bypass caches.
 */
export async function fetchTextCached(url, cacheRel, opts = {}) {
  const p = `${RAW_DIR}/${cacheRel}`;
  ensureDir(p.slice(0, p.lastIndexOf('/')));
  const refresh = process.argv.includes('--refresh');
  if (!refresh && fs.existsSync(p) && fs.statSync(p).size > 0) {
    return { text: fs.readFileSync(p, 'utf8'), meta: readSidecar(p), fromCache: true };
  }
  log(`fetch ${opts.method || 'GET'} ${url.length > 160 ? url.slice(0, 160) + '…' : url}`);
  const res = await httpFetch(url, opts);
  const text = await res.text();
  if (opts.validate) opts.validate(text);
  writeAtomic(p, text);
  const meta = {
    url, method: opts.method || 'GET', request: opts.describeBody || null,
    retrieved: new Date().toISOString(), bytes: Buffer.byteLength(text),
    sha256: crypto.createHash('sha256').update(text).digest('hex'),
  };
  writeSidecar(p, meta);
  return { text, meta, fromCache: false };
}

/** HEAD request → Content-Length (number|null) and headers. */
export async function headInfo(url) {
  const res = await httpFetch(url, { method: 'HEAD' });
  const len = res.headers.get('content-length');
  return {
    bytes: len == null ? null : Number(len),
    lastModified: res.headers.get('last-modified'),
    etag: res.headers.get('etag'),
    acceptRanges: res.headers.get('accept-ranges'),
  };
}

/**
 * Stream a (possibly large) file to disk. Checks Content-Length via HEAD first and
 * refuses to start if free space would fall below MIN_FREE_BYTES (+ a margin).
 * Skips the download if a complete cached copy (size == Content-Length) exists.
 */
export async function downloadFile(url, destPath, { budgetBytes = Infinity } = {}) {
  ensureDir(destPath.slice(0, destPath.lastIndexOf('/')));
  const head = await headInfo(url);
  if (fs.existsSync(destPath) && head.bytes != null && fs.statSync(destPath).size === head.bytes) {
    log(`cached: ${destPath.replace(ROOT + '/', '')} (${fmtBytes(head.bytes)})`);
    return { path: destPath, bytes: head.bytes, head, meta: readSidecar(destPath), fromCache: true };
  }
  if (head.bytes == null) fail(`no Content-Length for ${url}; refusing blind large download`);
  if (head.bytes > budgetBytes) fail(`${url} is ${fmtBytes(head.bytes)} > budget ${fmtBytes(budgetBytes)}`);
  const free = freeBytes(ROOT);
  const margin = 256 * 1024 ** 2;
  if (free - head.bytes < MIN_FREE_BYTES + margin) {
    fail(`not enough disk: free ${fmtBytes(free)}, need ${fmtBytes(head.bytes)} + keep ${fmtBytes(MIN_FREE_BYTES)} free`);
  }
  log(`download ${url}\n    -> ${destPath.replace(ROOT + '/', '')} (${fmtBytes(head.bytes)}; free disk ${fmtBytes(free)})`);
  // Resumable streamed download: on a stall (no bytes for STALL_MS) or a dropped connection we
  // re-request the remainder with an HTTP Range header (server advertises Accept-Ranges: bytes).
  const tmp = `${destPath}.part`;
  const STALL_MS = 120000;
  const t0 = Date.now();
  let lastLog = Date.now();
  for (let attempt = 1; ; attempt++) {
    const have = fs.existsSync(tmp) ? fs.statSync(tmp).size : 0;
    if (have === head.bytes) break;
    if (have > head.bytes) { fs.rmSync(tmp, { force: true }); fail(`partial file larger than remote for ${url}`); }
    const ranged = have > 0 && head.acceptRanges === 'bytes';
    const ctrl = new AbortController();
    let stallTimer = setTimeout(() => ctrl.abort(), STALL_MS);
    try {
      await throttleHost(url, 1100);
      const res = await fetch(url, { headers: { 'User-Agent': UA, ...(ranged ? { Range: `bytes=${have}-` } : {}) }, signal: ctrl.signal, redirect: 'follow' });
      if (ranged ? res.status !== 206 : !res.ok) fail(`HTTP ${res.status} for ${url}${ranged ? ` (Range from ${have})` : ''}`);
      const out = fs.createWriteStream(tmp, { flags: ranged ? 'a' : 'w' });
      let got = ranged ? have : 0;
      for await (const chunk of Readable.fromWeb(res.body)) {
        clearTimeout(stallTimer);
        stallTimer = setTimeout(() => ctrl.abort(), STALL_MS);
        got += chunk.length;
        if (!out.write(chunk)) await new Promise((r) => out.once('drain', r));
        if (Date.now() - lastLog > 15000) {
          lastLog = Date.now();
          const mbps = (got - have) / 1024 ** 2 / ((Date.now() - t0) / 1000);
          log(`  ${fmtBytes(got)} / ${fmtBytes(head.bytes)} (${(100 * got / head.bytes).toFixed(1)}%, ${mbps.toFixed(1)} MB/s)`);
        }
      }
      clearTimeout(stallTimer);
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())));
    } catch (err) {
      clearTimeout(stallTimer);
      if (err.isDomainFailure) throw err;
      if (attempt >= 8) fail(`download of ${url} failed after ${attempt} attempts: ${err.message}`);
      log(`  download interrupted (${err.name}: ${err.message}); resuming (attempt ${attempt + 1})`);
      await sleep(Math.min(60000, 3000 * attempt));
    }
  }
  const got = fs.statSync(tmp).size;
  if (got !== head.bytes) { fs.rmSync(tmp, { force: true }); fail(`truncated download of ${url}: ${got} of ${head.bytes} bytes`); }
  fs.renameSync(tmp, destPath);
  const meta = { url, retrieved: new Date().toISOString(), bytes: got, lastModified: head.lastModified, etag: head.etag };
  writeSidecar(destPath, meta);
  log(`  done in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  return { path: destPath, bytes: got, head, meta, fromCache: false };
}

// ---------------------------------------------------------------------------
// VizieR ASU-TSV
// ---------------------------------------------------------------------------
/**
 * Parse VizieR ASU-TSV output. Returns {columns, units, rows:[{col:string}]}; values are raw
 * strings trimmed of padding ('' means empty/missing). Fails loudly on #INFO Error lines.
 */
export function parseVizierTsv(text, label = 'VizieR') {
  const lines = text.split(/\r?\n/);
  const err = lines.find((l) => /^#INFO\s+Error=/.test(l));
  if (err) fail(`${label}: ${err}`);
  const body = lines.filter((l) => l.length && !l.startsWith('#'));
  if (body.length < 3) fail(`${label}: no table in response (got ${body.length} non-comment lines)`);
  const columns = body[0].split('\t');
  const units = body[1].split('\t');
  // third line must be the dashes separator ("-----\t---\t...")
  if (!/^-/.test(body[2])) fail(`${label}: unexpected TSV layout (3rd line: ${body[2].slice(0, 60)})`);
  const rows = [];
  for (let i = 3; i < body.length; i++) {
    const parts = body[i].split('\t');
    if (parts.length < columns.length) continue; // blank trailer etc.
    const o = {};
    for (let c = 0; c < columns.length; c++) o[columns[c]] = (parts[c] ?? '').trim();
    rows.push(o);
  }
  return { columns, units, rows };
}

/**
 * Build a VizieR ASU-TSV URL. Positions in VizieR tables are often only exposed through the computed
 * columns _RAJ2000/_DEJ2000 (the original RAdeg/DEdeg or sexagesimal columns are dropped from -out),
 * so `withRaDe` adds them in decimal degrees (-out.add=_RAJ,_DEJ -oc.form=d; J2000/ICRS-compatible FK5).
 */
export function vizierAsuUrl(source, cols, { withRaDe = true, extra = '' } = {}) {
  const add = withRaDe ? '&-out.add=_RAJ,_DEJ&-oc.form=d' : '';
  return `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=${source}${add}&-out=${cols.join(',')}&-out.max=unlimited${extra}`;
}

/** number or null (never 0 for missing). */
export function num(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '' || t === '---' || /^nan$/i.test(t)) return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

export function str(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' ? null : t;
}

// ---------------------------------------------------------------------------
// TAP helpers (sync, with optional inline VOTable upload)
// ---------------------------------------------------------------------------
function xmlEsc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Minimal VOTable 1.3 TABLEDATA writer. cols: [{name, datatype:'char'|'double'|'int'}] */
export function toVOTable(cols, rows, tableName = 't') {
  const fields = cols.map((c) => `<FIELD name="${xmlEsc(c.name)}" datatype="${c.datatype}"${c.datatype === 'char' ? ' arraysize="*"' : ''}/>`).join('');
  const trs = rows.map((r) => `<TR>${cols.map((c) => `<TD>${r[c.name] == null ? '' : xmlEsc(r[c.name])}</TD>`).join('')}</TR>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<VOTABLE version="1.3" xmlns="http://www.ivoa.net/xml/VOTable/v1.3"><RESOURCE><TABLE name="${tableName}">${fields}<DATA><TABLEDATA>\n${trs}\n</TABLEDATA></DATA></TABLE></RESOURCE></VOTABLE>\n`;
}

/** Minimal RFC-4180 CSV parser (TAP FORMAT=csv). Returns array of objects keyed by header. */
export function parseCsv(text) {
  const out = [];
  let i = 0;
  const n = text.length;
  const rows = [];
  let row = [];
  let field = '';
  let inQ = false;
  while (i < n) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQ = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQ = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (!rows.length) return out;
  const hdr = rows[0];
  for (let r = 1; r < rows.length; r++) {
    if (rows[r].length === 1 && rows[r][0] === '') continue;
    const o = {};
    hdr.forEach((h, k) => { o[h] = rows[r][k]; });
    out.push(o);
  }
  return out;
}

/**
 * Run a synchronous ADQL query against a TAP service (POST), cached on disk by query hash.
 * upload: optional {name, votable} for TAP_UPLOAD.<name>.
 */
export async function tapQuery(serviceUrl, adql, { cacheRel, upload, maxrec = 2000000, label = 'TAP' } = {}) {
  const key = sha1(serviceUrl + '\n' + adql + '\n' + (upload ? sha1(upload.votable) : ''));
  const rel = cacheRel || `tap/${key}.csv`;
  const fd = new FormData();
  fd.append('REQUEST', 'doQuery');
  fd.append('LANG', 'ADQL');
  fd.append('FORMAT', 'csv');
  fd.append('MAXREC', String(maxrec));
  fd.append('QUERY', adql);
  if (upload) {
    fd.append('UPLOAD', `${upload.name},param:${upload.name}`);
    fd.append(upload.name, new Blob([upload.votable], { type: 'application/x-votable+xml' }), `${upload.name}.xml`);
  }
  const { text, meta, fromCache } = await fetchTextCached(`${serviceUrl.replace(/\/$/, '')}/sync`, rel, {
    method: 'POST', body: fd, describeBody: { adql, upload: upload ? { name: upload.name, rows: upload.rows } : null },
    validate: (t) => {
      if (/^\s*<\?xml/.test(t) || /QUERY_STATUS"\s+value="ERROR"/.test(t)) {
        const m = t.match(/<INFO name="QUERY_STATUS" value="ERROR">([\s\S]*?)<\/INFO>/);
        fail(`${label} query error: ${(m ? m[1] : t.slice(0, 500)).trim()}\nADQL: ${adql.slice(0, 600)}`);
      }
    },
  });
  return { rows: parseCsv(text), meta, fromCache };
}

// ---------------------------------------------------------------------------
// FITS BINTABLE (minimal; big-endian data per FITS standard)
// ---------------------------------------------------------------------------
const TFORM_SIZE = { L: 1, X: 1 / 8, B: 1, I: 2, J: 4, K: 8, A: 1, E: 4, D: 8, C: 8, M: 16, P: 8, Q: 16 };

function parseCards(buf) {
  const cards = [];
  for (let off = 0; off + 80 <= buf.length; off += 80) cards.push(buf.toString('latin1', off, off + 80));
  return cards;
}

function cardValue(card) {
  const t0 = card.slice(10).trimStart();
  if (t0.startsWith("'")) {
    const m = t0.match(/^'((?:[^']|'')*)'/);
    return m ? m[1].replace(/''/g, "'").trimEnd() : '';
  }
  const t = t0.split('/')[0].trim();
  if (t === 'T') return true;
  if (t === 'F') return false;
  const n = Number(t);
  return Number.isFinite(n) ? n : t;
}

/** Read the HDU headers of a FITS file and describe the first BINTABLE extension. */
export function readFitsBintableHeader(path) {
  const fd = fs.openSync(path, 'r');
  try {
    let offset = 0;
    const hdus = [];
    for (let h = 0; h < 4; h++) {
      const kv = {};
      const order = [];
      let ended = false;
      let hdrBytes = 0;
      while (!ended) {
        const block = Buffer.alloc(2880);
        const n = fs.readSync(fd, block, 0, 2880, offset + hdrBytes);
        if (n !== 2880) fail(`FITS ${path}: truncated header`);
        hdrBytes += 2880;
        for (const card of parseCards(block)) {
          const key = card.slice(0, 8).trim();
          if (key === 'END') { ended = true; break; }
          if (card[8] === '=') { kv[key] = cardValue(card); order.push(key); }
        }
      }
      const naxis = kv.NAXIS || 0;
      let dataBytes = 0;
      if (naxis > 0) {
        dataBytes = Math.abs(kv.BITPIX) / 8;
        for (let a = 1; a <= naxis; a++) dataBytes *= kv[`NAXIS${a}`];
        dataBytes = (dataBytes * (kv.GCOUNT || 1)) + (kv.PCOUNT || 0);
      }
      const hdu = { kv, headerOffset: offset, dataOffset: offset + hdrBytes, dataBytes };
      hdus.push(hdu);
      if (kv.XTENSION === 'BINTABLE') {
        const cols = [];
        let colOff = 0;
        for (let c = 1; c <= kv.TFIELDS; c++) {
          const form = String(kv[`TFORM${c}`]).trim();
          const m = form.match(/^(\d*)([LXBIJKAEDCMPQ])/);
          if (!m) fail(`FITS ${path}: unsupported TFORM${c}=${form}`);
          const repeat = m[1] === '' ? 1 : Number(m[1]);
          const code = m[2];
          const size = code === 'X' ? Math.ceil(repeat / 8) : repeat * TFORM_SIZE[code];
          cols.push({ index: c, name: String(kv[`TTYPE${c}`]).trim(), form, code, repeat, offset: colOff, size, unit: kv[`TUNIT${c}`] ?? null });
          colOff += size;
        }
        if (colOff !== kv.NAXIS1) fail(`FITS ${path}: column widths sum ${colOff} != NAXIS1 ${kv.NAXIS1}`);
        return { path, rowBytes: kv.NAXIS1, nRows: kv.NAXIS2, cols, dataOffset: hdu.dataOffset, header: kv, hdus };
      }
      offset = hdu.dataOffset + Math.ceil(dataBytes / 2880) * 2880;
    }
    fail(`FITS ${path}: no BINTABLE extension in first HDUs`);
  } finally { fs.closeSync(fd); }
}

/**
 * Stream all rows of a BINTABLE. onRow(buf, rowOffsetInBuf, rowIndex) is called per row
 * (read values with buf.readDoubleBE/readFloatBE/readBigInt64BE at col.offset).
 */
export async function forEachFitsRow(desc, onRow, { chunkRows = 65536 } = {}) {
  const { rowBytes, nRows, dataOffset } = desc;
  const fd = await fsp.open(desc.path, 'r');
  try {
    const buf = Buffer.allocUnsafe(rowBytes * chunkRows);
    let row = 0;
    while (row < nRows) {
      const take = Math.min(chunkRows, nRows - row);
      const want = take * rowBytes;
      const { bytesRead } = await fd.read(buf, 0, want, dataOffset + row * rowBytes);
      if (bytesRead !== want) fail(`FITS ${desc.path}: short read at row ${row} (${bytesRead}/${want})`);
      for (let k = 0; k < take; k++) onRow(buf, k * rowBytes, row + k);
      row += take;
    }
  } finally { await fd.close(); }
}

// ---------------------------------------------------------------------------
// Astronomy: frames, cosmology
// ---------------------------------------------------------------------------
export const DEG = Math.PI / 180;
export const C_KMS = 299792.458;

// ICRS -> Galactic rotation matrix A_G (ESA 1997, Hipparcos Vol. 1, Sect. 1.5.3; adopted by IAU for ICRS).
const A_G = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
];

export function unitVector(lonDeg, latDeg) {
  const l = lonDeg * DEG;
  const b = latDeg * DEG;
  return [Math.cos(b) * Math.cos(l), Math.cos(b) * Math.sin(l), Math.sin(b)];
}

function vecToLonLat(v) {
  let lon = Math.atan2(v[1], v[0]) / DEG;
  if (lon < 0) lon += 360;
  const lat = Math.asin(Math.max(-1, Math.min(1, v[2]))) / DEG;
  return [lon, lat];
}

export function icrsToGalactic(raDeg, decDeg) {
  const r = unitVector(raDeg, decDeg);
  const g = A_G.map((row) => row[0] * r[0] + row[1] * r[1] + row[2] * r[2]);
  return vecToLonLat(g);
}

export function galacticToIcrs(lDeg, bDeg) {
  const g = unitVector(lDeg, bDeg);
  const r = [0, 1, 2].map((j) => A_G[0][j] * g[0] + A_G[1][j] * g[1] + A_G[2][j] * g[2]);
  return vecToLonLat(r);
}

// Solar-system barycentre velocity w.r.t. the CMB: Planck 2018 results I (A&A 641, A1, 2020), Sect. 5.3 / Table 3:
// v = 369.82 +/- 0.11 km/s towards (l, b) = (264.021 +/- 0.011, 48.253 +/- 0.005) deg.
export const CMB_DIPOLE = {
  vKms: 369.82, lDeg: 264.021, bDeg: 48.253,
  ref: 'Planck Collaboration 2020, A&A 641, A1 (Planck 2018 results I), Sect. 5.3',
};
const CMB_APEX_ICRS = galacticToIcrs(CMB_DIPOLE.lDeg, CMB_DIPOLE.bDeg);
const CMB_APEX_VEC = unitVector(CMB_APEX_ICRS[0], CMB_APEX_ICRS[1]);
export const CMB_APEX_RADEC = CMB_APEX_ICRS;

/**
 * Heliocentric (barycentric) redshift -> CMB-frame redshift (exact special-relativistic Doppler for the
 * observer's motion): 1 + z_cmb = (1 + z_hel) * gamma * (1 + beta * cos(theta)),
 * theta = angle between the galaxy direction and the CMB-dipole apex.
 */
const BETA = CMB_DIPOLE.vKms / C_KMS;
const GAMMA = 1 / Math.sqrt(1 - BETA * BETA);
export function zHelioToCmb(zHel, raDeg, decDeg) {
  const u = unitVector(raDeg, decDeg);
  const cosT = u[0] * CMB_APEX_VEC[0] + u[1] * CMB_APEX_VEC[1] + u[2] * CMB_APEX_VEC[2];
  return (1 + zHel) * GAMMA * (1 + BETA * cosT) - 1;
}

// Flat LambdaCDM, Planck 2018 (TT,TE,EE+lowE+lensing+BAO; Planck Collaboration 2020, A&A 641, A6, Table 2 last column)
export const COSMO = {
  H0: 67.66, Om: 0.3111, OL: 1 - 0.3111, Or: 0,
  name: 'flat LambdaCDM, Planck 2018 TT,TE,EE+lowE+lensing+BAO (H0=67.66 km/s/Mpc, Omega_m=0.3111, Omega_Lambda=1-Omega_m, radiation neglected)',
  ref: 'Planck Collaboration 2020, A&A 641, A6, Table 2 (last column)',
};
export const HUBBLE_DISTANCE_MPC = C_KMS / COSMO.H0;

function invE(z) {
  const a = 1 + z;
  return 1 / Math.sqrt(COSMO.Om * a * a * a + COSMO.Or * a * a * a * a + COSMO.OL);
}

/** Direct composite-Simpson integral D_C(z) = (c/H0) * int_0^z dz'/E(z') with n (even) panels. */
export function comovingDistanceSimpson(z, n = 20000) {
  if (z === 0) return 0;
  const sign = Math.sign(z);
  const zz = Math.abs(z);
  const h = zz / n;
  let s = invE(0) + invE(zz);
  for (let i = 1; i < n; i++) s += (i % 2 ? 4 : 2) * invE(i * h);
  return sign * HUBBLE_DISTANCE_MPC * (s * h / 3);
}

/**
 * Tabulated D_C on a uniform grid (step dz) built by cumulative Simpson over each [z_i, z_i+dz]
 * (midpoint included), queried with linear interpolation. With dz = 1e-5 the interpolation error
 * is < 1e-6 Mpc for z < 3.
 */
export function makeComovingTable(zMax = 3, dz = 1e-5) {
  const n = Math.ceil(zMax / dz) + 1;
  const tab = new Float64Array(n);
  let acc = 0;
  for (let i = 1; i < n; i++) {
    const z0 = (i - 1) * dz;
    const z1 = i * dz;
    acc += (dz / 6) * (invE(z0) + 4 * invE((z0 + z1) / 2) + invE(z1));
    tab[i] = acc * HUBBLE_DISTANCE_MPC;
  }
  return {
    zMax: (n - 1) * dz, dz,
    dc(z) {
      if (!(z >= 0)) return NaN;
      const x = z / dz;
      const i = Math.floor(x);
      if (i >= n - 1) return NaN;
      const f = x - i;
      return tab[i] * (1 - f) + tab[i + 1] * f;
    },
  };
}

// ---------------------------------------------------------------------------
// Deterministic PRNG (mulberry32) + helpers
// ---------------------------------------------------------------------------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** In-place Fisher–Yates shuffle of a typed/array index list. */
export function shuffleInPlace(arr, rand) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------
/** Compact JSON; table "rows" arrays are emitted one row per line for diff-ability (still compact). */
export function stringifyTableJson(obj) {
  const { rows, ...rest } = obj;
  const head = JSON.stringify(rest);
  if (!rows) return head + '\n';
  const body = rows.map((r) => JSON.stringify(r)).join(',\n');
  return `${head.slice(0, -1)},"rows":[\n${body}\n]}\n`;
}

export function writeOut(relName, content) {
  ensureDir(OUT_DIR);
  const p = `${OUT_DIR}/${relName}`;
  writeAtomic(p, content);
  return { path: p, rel: `data/galaxies/${relName}`, bytes: fs.statSync(p).size };
}

export function writeMeta(id, obj) {
  ensureDir(META_DIR);
  fs.writeFileSync(`${META_DIR}/${id}.json`, JSON.stringify(obj, null, 1));
}

export function readMeta(id) {
  try { return JSON.parse(fs.readFileSync(`${META_DIR}/${id}.json`, 'utf8')); } catch { return null; }
}

/** Throw if any number in a flat numeric array/typed array is non-finite (except allowed fields). */
export function assertFinite(arr, label) {
  for (let i = 0; i < arr.length; i++) {
    if (!Number.isFinite(arr[i])) fail(`${label}: non-finite value at index ${i}: ${arr[i]}`);
  }
}

export function isoNow() { return new Date().toISOString(); }

export function round(v, d) {
  if (v == null || !Number.isFinite(v)) return null;
  const f = 10 ** d;
  return Math.round(v * f) / f;
}
