#!/usr/bin/env node
// Cosmos — "sky" domain: HiPS discovery via the CDS MocServer.
// Queries the MocServer for candidate all-sky HiPS per wavelength band and prints a compact table
// (ID, title, regime, em range, sky fraction, tile formats, copyright) so the choice of HiPS in
// bands.config.mjs is reproducible and reviewable. Raw responses are cached in data-raw/sky/mocserver-search/.
//
// Usage: node scripts/data/sky/discover.mjs [--refresh] [pattern ...]
//   pattern: MocServer ID wildcard, e.g. "*RASS*" (default: the built-in list below)

import fs from 'node:fs';
import { cachedDownload, CDS_HOSTS, MOCSERVER_PATH, RAW_DIR, safeName, log } from './lib.mjs';

const FIELDS = [
  'ID', 'obs_title', 'obs_regime', 'em_min', 'em_max', 'moc_sky_fraction', 'hips_tile_format', 'hips_order',
  'hips_frame', 'hips_pixel_bitpix', 'obs_copyright', 'obs_copyright_url', 'hips_copyright', 'hips_creator',
  'hips_release_date', 'hips_status', 'dataproduct_type', 'hips_service_url',
].join(',');

const DEFAULT_PATTERNS = [
  '*gaiadr3*', '*DSS2/color*', '*Mellinger*', '*Finkbeiner*', '*2MASS/color*', '*AllWISE/color*', '*unWISE/color*',
  '*IRIS*', '*AKARI/FIS*', '*GALEX*color*', '*RASS*', '*erosita*', '*Fermi*', '*PLANCK/R3*', '*PLANCK/R2*',
  '*Haslam*', '*HI4PI*', '*CMB*', '*SFD*', '*WMAP*', '*EGRET*', '*NVSS*', '*Halpha*',
];

const args = process.argv.slice(2);
const refresh = args.includes('--refresh');
const patterns = args.filter((a) => !a.startsWith('--'));

async function search(pattern) {
  const expr = `ID=${pattern}`;
  const q = `?expr=${encodeURIComponent(expr)}&get=record&fmt=json&fields=${FIELDS}`;
  const dest = `${RAW_DIR}/mocserver-search/${safeName(pattern)}.json`;
  await cachedDownload(CDS_HOSTS.map((h) => h + MOCSERVER_PATH + q), dest, {
    expectTypes: ['application/json', 'text/plain', 'text/json'],
    refresh,
    what: `MocServer search ${pattern}`,
  });
  return JSON.parse(fs.readFileSync(dest, 'utf8'));
}

const short = (v, n = 60) => (v == null ? '' : String(Array.isArray(v) ? v.join('|') : v).slice(0, n));

for (const p of patterns.length ? patterns : DEFAULT_PATTERNS) {
  const recs = await search(p);
  log(`--- ${p}: ${recs.length} record(s)`);
  for (const r of recs) {
    if (r.dataproduct_type && !String(r.dataproduct_type).includes('image')) continue;
    console.log(
      [
        short(r.ID, 48).padEnd(48),
        short(r.obs_regime, 12).padEnd(12),
        `sky=${short(r.moc_sky_fraction, 6)}`.padEnd(11),
        `ord=${short(r.hips_order, 2)}`.padEnd(6),
        short(r.hips_tile_format, 22).padEnd(22),
        short(r.obs_title, 70),
      ].join(' '),
    );
    console.log(`      (c) ${short(r.obs_copyright, 110)} | url ${short(r.obs_copyright_url, 90)} | hips(c) ${short(r.hips_copyright, 50)} | rel ${short(r.hips_release_date, 20)} | status ${short(r.hips_status, 30)}`);
  }
}
