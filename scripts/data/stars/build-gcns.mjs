#!/usr/bin/env node
// Builds public/data/stars/gaia-gcns.bin + gaia-gcns.json from the cached GCNS CSV (see fetch-gcns.mjs).
import fs from 'node:fs';
import { RAW_DIR, OUT_DIR, ensureDir, log, fail, runMain, readMeta, parseCsv } from './lib.mjs';
import { RAW, GCNS_CITATION } from './sources.mjs';

async function main() {
  const file = `${RAW_DIR}/${RAW.gcnsCsv}`;
  if (!fs.existsSync(file)) fail('Run fetch-gcns.mjs first.');
  const meta = readMeta(file);
  const text = fs.readFileSync(file, 'utf8');
  const { header: head, rows: rows0 } = parseCsv(text);
  const rows = rows0.filter((r) => r.length === head.length);
  const get = (r, k) => r[head.indexOf(k)];
  const d2r = Math.PI / 180;
  const recs = [];
  let noDist = 0, noG = 0, noColor = 0;
  for (const r of rows) {
    const ra = parseFloat(get(r, 'ra')), dec = parseFloat(get(r, 'dec'));
    const g = parseFloat(get(r, 'phot_g_mean_mag'));
    const bp = parseFloat(get(r, 'phot_bp_mean_mag')), rp = parseFloat(get(r, 'phot_rp_mean_mag'));
    let dPc = parseFloat(get(r, 'dist_50')) * 1000; // kpc -> pc
    if (!(dPc > 0)) { const plx = parseFloat(get(r, 'parallax')); dPc = plx > 0 ? 1000 / plx : NaN; }
    if (!(dPc > 0)) { noDist++; continue; }
    if (!Number.isFinite(g)) { noG++; continue; }
    const c = bp - rp;
    if (!Number.isFinite(c)) noColor++;
    const cd = Math.cos(dec * d2r);
    recs.push({ g, x: dPc * cd * Math.cos(ra * d2r), y: dPc * cd * Math.sin(ra * d2r), z: dPc * Math.sin(dec * d2r), M: g - 5 * Math.log10(dPc / 10), c: Number.isFinite(c) ? c : NaN, d: dPc });
  }
  recs.sort((a, b) => a.g - b.g);
  const buf = new Float32Array(recs.length * 5);
  recs.forEach((r, i) => { buf.set([r.x, r.y, r.z, r.M, r.c], i * 5); });
  for (const v of buf) if (v === Infinity || v === -Infinity) fail('Infinity in output');
  ensureDir(OUT_DIR);
  fs.writeFileSync(`${OUT_DIR}/gaia-gcns.bin`, Buffer.from(buf.buffer));
  const hdr = {
    schemaVersion: 1, generated: new Date().toISOString(), dataset: 'gaia-edr3-gcns', file: 'gaia-gcns.bin',
    byteLength: buf.byteLength, count: recs.length, dtype: 'float32', endianness: 'little', stride: 5, strideBytes: 20,
    fields: ['xPc', 'yPc', 'zPc', 'absMagG', 'bpRp'],
    units: { xPc: 'pc', yPc: 'pc', zPc: 'pc', absMagG: 'mag (absolute Gaia G)', bpRp: 'mag (Gaia BP-RP; NaN if BP or RP missing)' },
    frame: 'Heliocentric equatorial Cartesian, ICRS, Gaia EDR3 epoch J2016.0 positions (not propagated to J2000). Sun at origin.',
    sortOrder: 'apparent Gaia G ascending (brightest first)',
    distance: 'GCNS median Bayesian distance dist_50 (kpc in archive, converted to pc); fallback 1000/parallax(mas) if absent.',
    absMagG: 'G - 5 log10(d/10 pc); no extinction correction (within 100 pc negligible).',
    nan: { bpRp: noColor }, excluded: { noDistance: noDist, noGmag: noG },
    stats: recs.reduce((a, r) => ({ maxDistPc: Math.max(a.maxDistPc, r.d), minDistPc: Math.min(a.minDistPc, r.d) }), { maxDistPc: 0, minDistPc: Infinity }),
    source: { id: 'gaia-edr3-gcns', raw: RAW.gcnsCsv, retrieved: meta?.retrieved, sha256: meta?.sha256, query: meta?.query,
      license: 'ESA Gaia data: CC BY-NC 3.0 IGO (non-commercial; credit ESA/Gaia/DPAC)', citation: GCNS_CITATION },
    notes: ['Gaia EDR3 (2021) based; Gaia DR4 is due 2026-12-02 and is NOT used.', 'GCNS includes a 100 pc completeness-limited sample; includes white dwarfs and faint M/L/T dwarfs (G up to ~21).'],
  };
  fs.writeFileSync(`${OUT_DIR}/gaia-gcns.json`, JSON.stringify(hdr));
  log(`gaia-gcns: ${recs.length} stars, ${(buf.byteLength / 1e6).toFixed(1)} MB, noColor ${noColor}, noDist ${noDist}, noG ${noG}`);
}
runMain(import.meta.url, main, 'BUILD-GCNS');
