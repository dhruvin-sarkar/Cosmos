#!/usr/bin/env node
// Cosmos — exoplanets domain: Gaia DR3 cross-check download (VALIDATION ONLY).
//
// For every host in the cached PSCompPars snapshot that carries a Gaia DR3 designation, downloads the
// Gaia DR3 astrometry (position at ref_epoch J2016.0, proper motion, parallax, G magnitude) from the
// ESA Gaia Archive TAP service. build.mjs uses it to determine empirically the epoch of the archive's
// ra/dec (systems.json posEpochJyr); validate.mjs uses it for position and distance cross-checks.
// No Gaia value is copied into the published files.
//
// Idempotent: skipped when the cache was made for exactly the same ID list (use --refresh to force).
// Requests: ceil(nIds / GAIA_CHUNK) synchronous POSTs (~9), >= 1.5 s apart, with User-Agent.
//
// Usage: node scripts/data/exoplanets/fetch-gaia.mjs [--refresh]

import { writeFile, rename, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  RAW_DIR, USER_AGENT, GAIA_TAP_SYNC, GAIA_COLUMNS, GAIA_CHUNK, GAIA_MIN_REQUEST_INTERVAL_MS, GAIA_RAW_FILE,
  GAIA_META_FILE, GAIA_QUERY_TEMPLATE, GAIA_TABLE, gaiaQuery, REQUEST_TIMEOUT_MS,
} from './config.mjs';
import { loadRaw, loadSnapshot, gaiaSourceId } from './lib.mjs';

const REFRESH = process.argv.includes('--refresh');
const log = (...a) => console.log('[exoplanets/fetch-gaia]', ...a);
function fail(msg) {
  console.error(`\n[exoplanets/fetch-gaia] FATAL: ${msg}\n`);
  process.exit(1);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let lastRequestAt = 0;
async function throttle() {
  const wait = lastRequestAt + GAIA_MIN_REQUEST_INTERVAL_MS - Date.now();
  if (wait > 0) await sleep(wait);
  lastRequestAt = Date.now();
}

async function gaiaRequest(label, ids) {
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', QUERY: gaiaQuery(ids) });
  for (let attempt = 1; attempt <= 3; attempt++) {
    await throttle();
    let res, text;
    try {
      res = await fetch(GAIA_TAP_SYNC, {
        method: 'POST',
        body,
        headers: { 'User-Agent': USER_AGENT, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'text/csv' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      text = await res.text();
    } catch (e) {
      if (attempt < 3) { log(`  ${label}: network error (${e.message}); retry after backoff`); await sleep(5000 * attempt * attempt); continue; }
      fail(`${label}: network error contacting ${GAIA_TAP_SYNC}: ${e.message}`);
    }
    if (res.status >= 500 && attempt < 3) { log(`  ${label}: HTTP ${res.status}; retry after backoff`); await sleep(5000 * attempt * attempt); continue; }
    if (res.status !== 200) fail(`${label}: HTTP ${res.status}: ${text.slice(0, 400).replace(/\s+/g, ' ')}`);
    if (text.trimStart().startsWith('<')) fail(`${label}: Gaia TAP returned XML instead of CSV (error?): ${text.slice(0, 400).replace(/\s+/g, ' ')}`);
    const lines = text.split(/\r?\n/).filter((l) => l.length);
    if (lines[0] !== GAIA_COLUMNS.join(',')) fail(`${label}: unexpected CSV header "${lines[0]}"`);
    return { lines: lines.slice(1), date: res.headers.get('date'), bytes: Buffer.byteLength(text) };
  }
  fail(`${label}: exhausted retries`);
}

async function main() {
  const snap = await loadSnapshot();
  const cp = await loadRaw('pscomppars');
  const ids = [...new Set(cp.map((r) => gaiaSourceId(r.gaia_dr3_id)).filter(Boolean))].sort();
  const badDesignations = cp.filter((r) => r.gaia_dr3_id != null && !gaiaSourceId(r.gaia_dr3_id)).map((r) => r.gaia_dr3_id);
  if (badDesignations.length) fail(`unparseable gaia_dr3_id values: ${[...new Set(badDesignations)].slice(0, 5).join(', ')}`);
  const idsSha256 = createHash('sha256').update(ids.join('\n')).digest('hex');
  log(`${ids.length} distinct Gaia DR3 source_ids in the PSCompPars snapshot retrieved ${snap.retrievedEnd}`);

  const metaPath = `${RAW_DIR}/${GAIA_META_FILE}`;
  if (!REFRESH && existsSync(metaPath) && existsSync(`${RAW_DIR}/${GAIA_RAW_FILE}`)) {
    const meta = JSON.parse(await readFile(metaPath, 'utf8'));
    if (meta.idsSha256 === idsSha256) {
      log(`cached Gaia DR3 cross-check matches the current ID list (retrieved ${meta.retrievedStart}); skipping. Use --refresh to re-fetch.`);
      return;
    }
    log('cached Gaia cross-check was made for a different ID list; re-fetching');
  }

  const out = [];
  let bytes = 0;
  const t0 = new Date().toISOString();
  let serverDate = null;
  for (let i = 0; i < ids.length; i += GAIA_CHUNK) {
    const chunk = ids.slice(i, i + GAIA_CHUNK);
    const label = `chunk ${i / GAIA_CHUNK + 1}/${Math.ceil(ids.length / GAIA_CHUNK)}`;
    const r = await gaiaRequest(label, chunk);
    const want = new Set(chunk);
    for (const line of r.lines) {
      const id = line.slice(0, line.indexOf(','));
      if (!want.has(id)) fail(`${label}: unexpected source_id ${id} in response`);
    }
    out.push(...r.lines);
    bytes += r.bytes;
    serverDate = r.date;
    log(`  ${label}: ${r.lines.length}/${chunk.length} rows`);
  }
  const t1 = new Date().toISOString();
  out.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const got = new Set(out.map((l) => l.slice(0, l.indexOf(','))));
  if (got.size !== out.length) fail('duplicate source_ids in Gaia response');
  const missing = ids.filter((id) => !got.has(id));
  const csv = `${GAIA_COLUMNS.join(',')}\n${out.join('\n')}\n`;
  const gz = gzipSync(Buffer.from(csv), { level: 9 });
  await writeFile(`${RAW_DIR}/${GAIA_RAW_FILE}.tmp`, gz);
  await rename(`${RAW_DIR}/${GAIA_RAW_FILE}.tmp`, `${RAW_DIR}/${GAIA_RAW_FILE}`);
  const meta = {
    purpose: 'Validation only: empirical epoch of the NASA Exoplanet Archive host positions and position/distance cross-checks. Not redistributed.',
    service: 'ESA Gaia Archive TAP (synchronous, POST, FORMAT=csv)',
    endpoint: GAIA_TAP_SYNC,
    table: GAIA_TABLE,
    queryTemplate: GAIA_QUERY_TEMPLATE,
    userAgent: USER_AGENT,
    retrievedStart: t0,
    retrievedEnd: t1,
    serverDate,
    archiveSnapshotRetrieved: snap.retrievedEnd,
    idsRequested: ids.length,
    idsSha256,
    rowsReturned: out.length,
    missingIds: missing,
    bytesResponseTotal: bytes,
    bytesStored: gz.length,
    sha256Csv: createHash('sha256').update(csv).digest('hex'),
  };
  await writeFile(metaPath, JSON.stringify(meta, null, 1));
  log(`stored ${out.length} rows (${missing.length} source_ids not found in ${GAIA_TABLE}) -> ${RAW_DIR}/${GAIA_RAW_FILE} (${(gz.length / 1024).toFixed(1)} KiB)`);
}

main().catch((e) => fail(e.stack || String(e)));
