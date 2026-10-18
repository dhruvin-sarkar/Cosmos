#!/usr/bin/env node
// Orbital domain - step 1: download raw upstream data into data-raw/orbital/ (gitignored).
//
//   node scripts/data/orbital/fetch.mjs [--refresh] [--no-extended] [--no-lookups] [--dry-run] [--force]
//
//   (default)      use cached files whenever they exist (no network for cached items)
//   --refresh      re-download items whose cache is older than the upstream update cadence
//                  (GP: 2 h, SATCAT: 12 h, lookup pages: 7 days) - never more often
//   --no-extended  skip the extended-coverage gp.php?NAME= searches (DEB, R/B)
//   --no-lookups   skip the owner / launch-site code pages
//   --dry-run      print the request plan and exit
//   --force        ignore a recent HTTP 403 block marker (do not use casually)
//
// CelesTrak usage policy (https://celestrak.org/usage-policy.php, 2026-05-22) followed here:
//   * download each data set at most once per update; cache locally
//   * stop querying immediately on ANY non-200 response and report to a human
//   * avoid redirects (301 counts as an error) -> canonical https://celestrak.org URLs only
//   * >50 HTTP errors in 2 h, or >100 MB/day, can get an IP firewalled
// This script makes ~55 requests (~25-35 MB) on a cold cache and 0 requests on a warm cache.

import { existsSync } from 'node:fs';
import { appendFile, mkdir } from 'node:fs/promises';
import {
  RAW_DIR, BLOCK_MARKER, HttpError, cachedDownload, readJson, writeFileAtomic, isoNow,
} from './lib.mjs';
import {
  SATCAT_REQUEST, LOOKUP_REQUESTS, gpRequests, gpNameRequests, GP_REQUIRED_COLUMNS, SATCAT_REQUIRED_COLUMNS,
} from './datasets.mjs';

const args = new Set(process.argv.slice(2));
const REFRESH = args.has('--refresh');
const DRY = args.has('--dry-run');
const FORCE = args.has('--force');
const EXTENDED = !args.has('--no-extended');
const LOOKUPS = !args.has('--no-lookups');

const MB = 1_000_000;

function validateGpCsv(text) {
  const t = text.trimStart();
  if (/^no gp data found/i.test(t.trim())) return { ok: true, extra: { records: 0, empty: true } };
  const firstLine = t.split(/\r?\n/, 1)[0] ?? '';
  const cols = firstLine.split(',').map((s) => s.trim());
  const missing = GP_REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) return { ok: false, reason: `not an OMM CSV (missing ${missing.join(', ')}); first line: ${firstLine.slice(0, 160)}` };
  const records = t.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
  return { ok: true, extra: { records, empty: records === 0 } };
}

function validateSatcatCsv(text) {
  const firstLine = text.replace(/^﻿/, '').split(/\r?\n/, 1)[0] ?? '';
  const cols = firstLine.split(',').map((s) => s.trim());
  const missing = SATCAT_REQUIRED_COLUMNS.filter((c) => !cols.includes(c));
  if (missing.length) return { ok: false, reason: `not a SATCAT CSV (missing ${missing.join(', ')}); first line: ${firstLine.slice(0, 160)}` };
  const records = text.split(/\r?\n/).filter((l) => l.trim() !== '').length - 1;
  if (records < 50000) return { ok: false, reason: `SATCAT unexpectedly small (${records} rows)` };
  return { ok: true, extra: { records } };
}

function validateHtml(text) {
  if (!/<table/i.test(text)) return { ok: false, reason: 'no <table> in HTML page' };
  return { ok: true, extra: {} };
}

const VALIDATORS = { gp: validateGpCsv, satcat: validateSatcatCsv, html: validateHtml };
const BUDGET = { gp: 40 * MB, satcat: 60 * MB, html: 5 * MB };

async function main() {
  await mkdir(RAW_DIR, { recursive: true });

  if (existsSync(BLOCK_MARKER) && !FORCE) {
    const m = await readJson(BLOCK_MARKER);
    const ageH = (Date.now() - Date.parse(m.at)) / 3.6e6;
    if (ageH < 2) {
      console.error(`ABORT: CelesTrak returned HTTP ${m.status} ${ageH.toFixed(2)} h ago for ${m.url}.`);
      console.error('Per the CelesTrak usage policy, wait for the next 2-hour update window before retrying.');
      console.error(`(Marker: ${BLOCK_MARKER}; use --force only after a human has checked.)`);
      process.exit(2);
    }
  }

  const plan = [SATCAT_REQUEST, ...gpRequests()];
  if (EXTENDED) plan.push(...gpNameRequests());
  if (LOOKUPS) plan.push(...LOOKUP_REQUESTS);

  const toFetch = plan.filter((p) => !existsSync(p.file) || !existsSync(`${p.file}.meta.json`) || REFRESH);
  console.log(`[orbital/fetch] ${plan.length} data sets in plan; ${plan.length - toFetch.length} cached, up to ${toFetch.length} may be requested${REFRESH ? ' (refresh mode: only if older than upstream cadence)' : ''}.`);
  if (DRY) {
    for (const p of plan) console.log(`  ${existsSync(p.file) ? 'cached ' : 'GET    '} ${p.url}`);
    return;
  }

  const logFile = `${RAW_DIR}/fetch-log.jsonl`;
  let fetched = 0;
  let cached = 0;
  for (const p of plan) {
    try {
      const r = await cachedDownload({
        url: p.url,
        file: p.file,
        maxAgeMs: p.maxAgeMs,
        refresh: REFRESH,
        maxBytes: BUDGET[p.kind],
        validate: VALIDATORS[p.kind],
      });
      if (r.cached) cached += 1;
      else {
        fetched += 1;
        await appendFile(logFile, `${JSON.stringify({ at: isoNow(), id: p.id, url: p.url, bytes: r.meta.bytes, records: r.meta.records ?? null })}\n`);
      }
    } catch (err) {
      await appendFile(logFile, `${JSON.stringify({ at: isoNow(), id: p.id, url: p.url, error: err.message, status: err.status ?? null })}\n`);
      console.error(`\n[orbital/fetch] STOPPED at ${p.id}: ${err.message}`);
      if (err instanceof HttpError) {
        if (err.bodySnippet) console.error(`  server said: ${err.bodySnippet.replace(/\s+/g, ' ').slice(0, 300)}`);
        if (err.status === 403 || err.status === 429 || err.status >= 500) {
          await writeFileAtomic(BLOCK_MARKER, `${JSON.stringify({ at: isoNow(), url: p.url, status: err.status, body: err.bodySnippet }, null, 2)}\n`);
          console.error('  CelesTrak policy: do not retry before the next update window (2 h). A block marker was written.');
        }
      }
      console.error(`  ${fetched} fetched, ${cached} cached before stopping. Already-cached files are intact; build.mjs can run if required files exist.`);
      process.exit(1);
    }
  }
  console.log(`[orbital/fetch] done: ${fetched} downloaded, ${cached} from cache.`);
}

main().catch((err) => {
  console.error(`[orbital/fetch] FATAL: ${err.stack ?? err.message}`);
  process.exit(1);
});
