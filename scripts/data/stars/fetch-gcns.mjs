#!/usr/bin/env node
// Stretch dataset: Gaia EDR3 "Gaia Catalogue of Nearby Stars" (GCNS; Gaia Collaboration, Smart et al. 2021,
// A&A 649, A6) from the ESA Gaia Archive TAP service (table external.gaiaedr3_gcns_main_1).
//
// Uses the IVOA TAP *asynchronous* (UWS) protocol: anonymous synchronous queries are limited to 30 s,
// while async jobs may return up to 3,000,000 rows (Gaia Archive help). Only the needed columns are
// selected (~50 MB CSV instead of the 252 MB full table on CDS).
//
//   node scripts/data/stars/fetch-gcns.mjs           # reuse cache when the cached query matches
//   node scripts/data/stars/fetch-gcns.mjs --refresh # force a new TAP job

import fs from 'node:fs';
import { politeFetch, log, fail, sleep, runMain, RAW_DIR, ensureDir, sha256OfBuffer, readMeta, writeMeta, assertDiskSpace } from './lib.mjs';
import { PINS, RAW, GCNS_QUERY } from './sources.mjs';

const POLL_MS = 3000;
const MAX_WAIT_MS = 30 * 60 * 1000;

async function tapAsync(query) {
  const tap = PINS.gcns.tap;
  const body = new URLSearchParams({ REQUEST: 'doQuery', LANG: 'ADQL', FORMAT: 'csv', PHASE: 'RUN', QUERY: query });
  const res = await politeFetch(`${tap}/async`, {
    method: 'POST',
    body,
    redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  }, { label: 'TAP async job creation' });
  let jobUrl = res.headers.get('location');
  if (!(res.status === 303 || res.status === 302 || res.status === 201 || res.status === 200)) {
    fail(`TAP async job creation failed: HTTP ${res.status} ${(await res.text()).slice(0, 500)}`);
  }
  if (!jobUrl) {
    // Some services return the job document directly; extract <uws:jobId>.
    const xml = await res.text();
    const id = /<uws:jobId>([^<]+)<\/uws:jobId>/.exec(xml)?.[1];
    if (!id) fail(`TAP async: no job Location header or jobId in response: ${xml.slice(0, 300)}`);
    jobUrl = `${tap}/async/${id}`;
  } else {
    await res.arrayBuffer().catch(() => {});
  }
  log(`  TAP job: ${jobUrl}`);

  const t0 = Date.now();
  let phase = 'PENDING';
  while (Date.now() - t0 < MAX_WAIT_MS) {
    await sleep(POLL_MS);
    const pr = await politeFetch(`${jobUrl}/phase`, {}, { label: 'TAP job phase' });
    phase = (await pr.text()).trim();
    if (phase === 'COMPLETED') break;
    if (phase === 'ERROR' || phase === 'ABORTED') {
      const er = await politeFetch(`${jobUrl}/error`, {}, { label: 'TAP job error' });
      fail(`TAP job ${phase}: ${(await er.text()).slice(0, 1000)}`);
    }
    log(`  phase=${phase} (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  }
  if (phase !== 'COMPLETED') fail(`TAP job did not complete within ${MAX_WAIT_MS / 60000} min (last phase ${phase}).`);

  const rr = await politeFetch(`${jobUrl}/results/result`, { redirect: 'follow' }, { label: 'TAP job result' });
  if (!rr.ok) fail(`TAP result download failed: HTTP ${rr.status}`);
  const buf = Buffer.from(await rr.arrayBuffer());

  // Good citizenship: delete the finished job (anonymous jobs otherwise linger for days). Ignore failures.
  try {
    await politeFetch(jobUrl, { method: 'POST', body: new URLSearchParams({ ACTION: 'DELETE' }), redirect: 'manual', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, { label: 'TAP job delete', retries: 0 });
  } catch { /* ignore */ }
  return { buf, jobUrl };
}

export async function fetchGcns({ refresh = process.argv.includes('--refresh') } = {}) {
  ensureDir(RAW_DIR);
  const file = `${RAW_DIR}/${RAW.gcnsCsv}`;
  const meta = readMeta(file);
  if (!refresh && fs.existsSync(file) && meta && meta.query === GCNS_QUERY && fs.statSync(file).size === meta.bytes) {
    log(`cache hit  ${RAW.gcnsCsv} (${(meta.bytes / 1e6).toFixed(1)} MB, ${meta.rows} rows, retrieved ${meta.retrieved})`);
    return { file, meta, cached: true };
  }
  // ~331k rows x ~150 B = ~50 MB; check the disk floor before starting.
  assertDiskSpace(80e6, RAW.gcnsCsv);
  log(`TAP async query on ${PINS.gcns.tap}:\n  ${GCNS_QUERY}`);
  const retrieved = new Date().toISOString();
  const { buf, jobUrl } = await tapAsync(GCNS_QUERY);
  const text = buf.toString('utf8');
  const firstLine = text.slice(0, text.indexOf('\n'));
  if (!firstLine.includes('source_id') || !firstLine.includes('dist_50')) {
    fail(`GCNS result does not look like the expected CSV. First bytes: ${text.slice(0, 300)}`);
  }
  let rows = 0;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) rows++;
  if (!text.endsWith('\n')) rows++;
  rows -= 1; // header
  if (rows !== PINS.gcns.expectedRows) {
    fail(`GCNS: expected ${PINS.gcns.expectedRows} rows, got ${rows}. (Truncated result or upstream change.)`);
  }
  fs.writeFileSync(`${file}.part`, buf);
  fs.renameSync(`${file}.part`, file);
  const newMeta = {
    name: RAW.gcnsCsv,
    url: `${PINS.gcns.tap}/async`,
    endpoint: PINS.gcns.tap,
    protocol: 'IVOA TAP 1.1 async (UWS), LANG=ADQL, FORMAT=csv',
    query: GCNS_QUERY,
    jobUrl,
    retrieved,
    bytes: buf.length,
    sha256: sha256OfBuffer(buf),
    rows,
    dataset: 'gaia-edr3-gcns',
  };
  writeMeta(file, newMeta);
  log(`  saved ${RAW.gcnsCsv}: ${(buf.length / 1e6).toFixed(1)} MB, ${rows} rows`);
  return { file, meta: newMeta, cached: false };
}

runMain(import.meta.url, () => fetchGcns(), 'FETCH-GCNS');
