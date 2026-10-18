#!/usr/bin/env node
// Cosmos / AstroNexus — exoplanets domain: download phase.
//
// Downloads a consistent snapshot of the NASA Exoplanet Archive PSCompPars table (selected
// columns), the PS default-parameter-set provenance columns, confirmed-planet counts and the
// TAP_SCHEMA column metadata, via the archive's TAP sync endpoint (format=json).
//
// Idempotent: if data-raw/exoplanets/snapshot.json and every raw file exist, nothing is
// downloaded. Use --refresh to force a new snapshot (all files are re-fetched together so the
// counts and the table always describe the same archive state).
//
// Usage: node scripts/data/exoplanets/fetch.mjs [--refresh]

import { mkdir, writeFile, rename, stat, readFile } from 'node:fs/promises';
import { existsSync, statfsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  RAW_DIR, RAW_FILES, SNAPSHOT_FILE, USER_AGENT, TAP_SYNC, MIN_REQUEST_INTERVAL_MS, REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES, RAW_BUDGET_BYTES, MIN_FREE_DISK_BYTES, FREE_DISK_MARGIN_BYTES, PSCOMPPARS_COLUMNS,
  PS_DEFAULT_COLUMNS, tapUrl, REPO_ROOT,
} from './config.mjs';

const REFRESH = process.argv.includes('--refresh');

function fail(msg) {
  console.error(`\n[exoplanets/fetch] FATAL: ${msg}\n`);
  process.exit(1);
}
const log = (...a) => console.log('[exoplanets/fetch]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function freeDiskBytes(p) {
  try {
    const s = statfsSync(p);
    return Number(s.bavail) * Number(s.bsize);
  } catch (e) {
    return null;
  }
}

function checkDisk(expectedBytes) {
  const free = freeDiskBytes(REPO_ROOT);
  if (free == null) {
    log('WARN: could not determine free disk space (statfs unavailable); expected download is small, continuing.');
    return;
  }
  const gb = (b) => (b / 1024 ** 3).toFixed(2) + ' GB';
  log(`free disk space: ${gb(free)}`);
  if (free - expectedBytes < MIN_FREE_DISK_BYTES + FREE_DISK_MARGIN_BYTES) {
    fail(`not enough free disk space: ${gb(free)} free, need >= ${gb(MIN_FREE_DISK_BYTES + FREE_DISK_MARGIN_BYTES + expectedBytes)}.`);
  }
}

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

function extractTapError(text) {
  // TAP errors come back as a VOTable with <INFO name="QUERY_STATUS" value="ERROR">message</INFO>
  const m = text.match(/<INFO[^>]*QUERY_STATUS[^>]*ERROR[^>]*>([\s\S]*?)<\/INFO>/i);
  if (m) return m[1].trim().replace(/\s+/g, ' ');
  return text.slice(0, 500).replace(/\s+/g, ' ');
}

async function tapRequest(name, query) {
  const url = tapUrl(query, 'json');
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await throttle();
    const t0 = Date.now();
    let res;
    try {
      res = await fetch(url, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (e) {
      if (attempt < maxAttempts) {
        log(`  ${name}: network error (${e.message}); retry ${attempt}/${maxAttempts - 1} after backoff`);
        await sleep(5000 * attempt * attempt);
        continue;
      }
      fail(`${name}: network error contacting ${TAP_SYNC}: ${e.message}`);
    }
    // Stream with a hard byte cap.
    const reader = res.body.getReader();
    const chunks = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        fail(`${name}: response exceeded ${MAX_RESPONSE_BYTES} bytes; aborting (check the query).`);
      }
      chunks.push(value);
    }
    const buf = Buffer.concat(chunks);
    const text = buf.toString('utf8');
    const retrieved = new Date().toISOString();
    if (res.status >= 500 && attempt < maxAttempts) {
      log(`  ${name}: HTTP ${res.status}; retry ${attempt}/${maxAttempts - 1} after backoff`);
      await sleep(5000 * attempt * attempt);
      continue;
    }
    if (res.status !== 200) fail(`${name}: HTTP ${res.status} from TAP: ${extractTapError(text)}\nURL: ${url}`);
    const ctype = res.headers.get('content-type') || '';
    if (!/json/i.test(ctype) || text.trimStart().startsWith('<')) {
      fail(`${name}: TAP did not return JSON (content-type "${ctype}"): ${extractTapError(text)}\nURL: ${url}`);
    }
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      fail(`${name}: response is not valid JSON (${e.message}). First bytes: ${text.slice(0, 200)}`);
    }
    if (!Array.isArray(parsed)) fail(`${name}: expected a JSON array of rows, got ${typeof parsed}`);
    log(`  ${name}: ${parsed.length} rows, ${(buf.length / 1024).toFixed(1)} KiB in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    return {
      buf, parsed, retrieved, url,
      httpStatus: res.status,
      contentType: ctype,
      serverDate: res.headers.get('date'),
    };
  }
  fail(`${name}: exhausted retries`);
}

async function writeAtomic(file, data) {
  const tmp = `${file}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}

async function snapshotComplete() {
  if (!existsSync(`${RAW_DIR}/${SNAPSHOT_FILE}`)) return false;
  for (const { file } of Object.values(RAW_FILES)) if (!existsSync(`${RAW_DIR}/${file}`)) return false;
  return true;
}

async function main() {
  await mkdir(RAW_DIR, { recursive: true });
  if (!REFRESH && (await snapshotComplete())) {
    const snap = JSON.parse(await readFile(`${RAW_DIR}/${SNAPSHOT_FILE}`, 'utf8'));
    log(`cached snapshot found (retrieved ${snap.retrievedStart} .. ${snap.retrievedEnd}); skipping download. Use --refresh to re-fetch.`);
    return;
  }
  log(REFRESH ? 'refresh requested: downloading a new snapshot' : 'no complete cached snapshot: downloading');
  checkDisk(60 * 1024 * 1024);

  const results = {};
  const order = ['schema', 'countPscomppars', 'countPsDefault', 'countPsDefaultDistinct', 'countPsDefaultBySoltype', 'countPsDefaultHosts', 'pscomppars', 'psDefault'];
  for (const name of order) {
    const { query } = RAW_FILES[name];
    log(`request ${name}`);
    results[name] = await tapRequest(name, query);

    if (name === 'schema') {
      // Fail loudly (before the big download) if the archive renamed/removed any column we need.
      const have = new Map();
      for (const r of results.schema.parsed) {
        const t = String(r.table_name).toLowerCase();
        if (!have.has(t)) have.set(t, new Set());
        have.get(t).add(String(r.column_name).toLowerCase());
      }
      const missing = [];
      for (const c of PSCOMPPARS_COLUMNS) if (!have.get('pscomppars')?.has(c)) missing.push(`pscomppars.${c}`);
      for (const c of PS_DEFAULT_COLUMNS) if (!have.get('ps')?.has(c)) missing.push(`ps.${c}`);
      if (missing.length) fail(`archive schema no longer has required column(s): ${missing.join(', ')}. Update config.mjs.`);
      log(`  schema OK: all ${PSCOMPPARS_COLUMNS.length} pscomppars + ${PS_DEFAULT_COLUMNS.length} ps columns exist`);
    }
  }

  // Persist (only after every request succeeded, so the snapshot is internally consistent).
  const files = {};
  let storedTotal = 0;
  for (const name of order) {
    const r = results[name];
    const { file, query } = RAW_FILES[name];
    const data = file.endsWith('.gz') ? gzipSync(r.buf, { level: 9 }) : r.buf;
    await writeAtomic(`${RAW_DIR}/${file}`, data);
    storedTotal += data.length;
    files[name] = {
      file, query, url: r.url, retrieved: r.retrieved, serverDate: r.serverDate,
      httpStatus: r.httpStatus, contentType: r.contentType, rows: r.parsed.length,
      bytesResponse: r.buf.length, bytesStored: data.length,
      sha256Response: createHash('sha256').update(r.buf).digest('hex'),
      compression: file.endsWith('.gz') ? 'gzip' : 'none',
    };
  }
  if (storedTotal > RAW_BUDGET_BYTES) fail(`raw snapshot is ${storedTotal} bytes, over the ${RAW_BUDGET_BYTES}-byte budget.`);
  const snapshot = {
    domain: 'exoplanets',
    source: 'NASA Exoplanet Archive TAP sync (https://exoplanetarchive.ipac.caltech.edu/TAP/sync), format=json',
    userAgent: USER_AGENT,
    retrievedStart: files.schema.retrieved,
    retrievedEnd: files.psDefault.retrieved,
    bytesStoredTotal: storedTotal,
    files,
  };
  await writeAtomic(`${RAW_DIR}/${SNAPSHOT_FILE}`, JSON.stringify(snapshot, null, 2));
  log(`snapshot written: ${Object.keys(files).length} files, ${(storedTotal / 1024).toFixed(1)} KiB stored in ${RAW_DIR}`);
  for (const [name, f] of Object.entries(files)) {
    const st = await stat(`${RAW_DIR}/${f.file}`);
    log(`  ${f.file.padEnd(34)} ${String(st.size).padStart(10)} B  (${f.rows} rows${f.compression === 'gzip' ? `, ${f.bytesResponse} B uncompressed` : ''})`);
  }
}

main().catch((e) => fail(e.stack || String(e)));
