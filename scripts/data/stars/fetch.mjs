#!/usr/bin/env node
// Fetch the core raw "stars" sources into data-raw/stars/ (idempotent; cached files are reused).
//
//   node scripts/data/stars/fetch.mjs            # use cache where valid
//   node scripts/data/stars/fetch.mjs --refresh  # re-download the *live* sources (WGSN list, VI/49)
//
// Pinned (immutable) sources are verified by SHA-256 / commit; live sources record the
// retrieval timestamp in their .meta.json sidecar. The Gaia GCNS stretch dataset has its own
// script (fetch-gcns.mjs).

import { downloadToCache, log, runMain, RAW_DIR } from './lib.mjs';
import { PINS, RAW } from './sources.mjs';

export async function fetchCore({ refresh = process.argv.includes('--refresh') } = {}) {
  log(`raw cache: ${RAW_DIR}${refresh ? '  (refresh live sources)' : ''}`);

  // 1. HYG v4.4: Git LFS object served by Forgejo /media/, pinned by commit, verified by the LFS oid.
  const h = PINS.hyg;
  await downloadToCache({
    name: RAW.hyg,
    url: `${h.repo}/media/commit/${h.commit}/${h.path}`,
    expectedSha256: h.lfsSha256,
    expectedBytes: h.bytes,
    extraMeta: { dataset: 'hyg-v44', version: h.version, commit: h.commit, lfsOid: `sha256:${h.lfsSha256}` },
  });

  // 2. Stellarium "modern_iau" sky culture (IAU / Sky & Telescope figures), pinned commit.
  const s = PINS.stellarium;
  const rawBase = `https://raw.githubusercontent.com/Stellarium/stellarium/${s.commit}/skycultures/${s.culture}`;
  await downloadToCache({
    name: RAW.stellariumIndex,
    url: `${rawBase}/index.json`,
    extraMeta: { dataset: 'stellarium-modern-iau-lines', commit: s.commit },
  });
  await downloadToCache({
    name: RAW.stellariumDescription,
    url: `${rawBase}/description.md`,
    extraMeta: { dataset: 'stellarium-modern-iau-lines', commit: s.commit, role: 'licence/credits text' },
  });

  // 3. VizieR VI/49 (Davenhall & Leggett 1989) constellation boundaries: J2000 file + ReadMe.
  await downloadToCache({
    name: RAW.vi49ReadMe,
    url: `${PINS.vi49.base}ReadMe`,
    refresh,
    extraMeta: { dataset: 'vizier-vi-49-boundaries', role: 'ReadMe (version history)' },
  });
  await downloadToCache({
    name: RAW.vi49Bound20,
    url: `${PINS.vi49.base}bound_20.dat.gz`,
    refresh,
    extraMeta: { dataset: 'vizier-vi-49-boundaries' },
  });

  // 4. IAU WGSN Catalog of Star Names: current list (IAU-designated page, server-rendered table)
  //    + the last machine-readable text edition (2022-04-04) as a fallback.
  await downloadToCache({
    name: RAW.wgsnHtml,
    url: PINS.wgsn.current,
    refresh,
    minIntervalMs: 2000,
    extraMeta: { dataset: 'iau-wgsn-csn', role: 'current IAU-CSN table (HTML; the only published form of the live list)' },
  });
  await downloadToCache({
    name: RAW.wgsnLegacyTxt,
    url: PINS.wgsn.legacyTxt,
    refresh,
    extraMeta: { dataset: 'iau-wgsn-csn', role: 'legacy machine-readable edition, last updated 2022-04-04 (fallback only)' },
  });

  log('core fetch complete.');
}

runMain(import.meta.url, () => fetchCore(), 'FETCH');
