#!/usr/bin/env node
// Spot-check validation of public/data/stars/* against published values.
import fs from 'node:fs';
import { OUT_DIR, runMain, fail, log } from './lib.mjs';

const J = (f) => JSON.parse(fs.readFileSync(`${OUT_DIR}/${f}`, 'utf8'));
async function main() {
  const h = J('stars.json'), named = J('stars-named.json'), hip = J('hip-index.json'), con = J('constellations.json');
  const b = fs.readFileSync(`${OUT_DIR}/stars.bin`);
  const f = new Float32Array(b.buffer, b.byteOffset, b.length / 4);
  let errs = 0;
  const check = (name, ok, msg) => { log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${msg}`); if (!ok) errs++; };
  check('count*stride', f.length === h.count * h.stride, `${h.count} stars`);
  let nonfinite = 0;
  for (let i = 0; i < h.count; i++) for (let k = 0; k < 4; k++) if (!Number.isFinite(f[i * 6 + k])) nonfinite++;
  check('finite xyz/absMag', nonfinite === 0, `${nonfinite} non-finite`);
  let sorted = true, prev = -99;
  for (let i = 0; i < h.count; i++) {
    const r = Math.hypot(f[i * 6], f[i * 6 + 1], f[i * 6 + 2]);
    const m = f[i * 6 + 3] + 5 * Math.log10(r / 10);
    if (m < prev - 1e-3) { sorted = false; break; }
    prev = m;
  }
  check('sorted by apparent mag', sorted, 'monotone');
  const col = named.fields; const ix = (n) => col.indexOf(n);
  const star = (hipNo) => { const i = hip[hipNo]; if (i === undefined) return null; const row = named.rows.find((r) => r[0] === i); return { i, row, d: Math.hypot(f[i * 6], f[i * 6 + 1], f[i * 6 + 2]), M: f[i * 6 + 3] }; };
  const cases = [
    ['Sirius', 32349, { d: [2.63, 2.65], M: [1.40, 1.51], mag: [-1.5, -1.4] }],   // Hipparcos 2007: 379.21 mas -> 2.637 pc; V=-1.44
    ['Vega', 91262, { d: [7.67, 7.80], M: [0.55, 0.65], mag: [0.0, 0.05] }],      // 130.23 mas -> 7.68 pc; V=0.03
    ['Betelgeuse', 27989, { d: [150, 260], M: [-6.5, -4.0], mag: [0.3, 0.7] }],   // ~168-222 pc, V~0.45 (variable)
    ['Polaris', 11767, { d: [130, 140], M: [-3.9, -3.5], mag: [1.9, 2.1] }],      // Hip2007 7.54 mas -> 132.6 pc; V~1.98
    ['Proxima? (HIP 70890)', 70890, { d: [1.29, 1.31], M: [15.4, 15.6], mag: [11.0, 11.2] }], // 768.07 mas -> 1.302 pc; V=11.13
  ];
  for (const [n, id, e] of cases) {
    const s = star(id);
    if (!s) { check(n, false, `HIP ${id} missing`); continue; }
    const mag = s.row ? s.row[ix('apparentMag')] : null;
    check(n, s.d >= e.d[0] && s.d <= e.d[1] && s.M >= e.M[0] && s.M <= e.M[1] && mag >= e.mag[0] && mag <= e.mag[1],
      `d=${s.d.toFixed(3)} pc, absMagV=${s.M.toFixed(2)}, V=${mag}, name=${s.row?.[ix('properName')]}`);
  }
  check('constellations', con.constellations.length === 88, `${con.constellations.length}`);
  const sumArea = con.constellations.reduce((a, c) => a + c.areaDeg2, 0);
  check('boundary area sum', Math.abs(sumArea - 41253) < 5, sumArea.toFixed(1));
  const ls = new Map(con.lineStars.rows.map((r) => [r[0], r]));
  let nLines = 0, noIdx = 0, noPos = 0;
  for (const c of con.constellations) for (const [a, bb] of c.lines) { nLines++; for (const x of [a, bb]) { if (hip[x] === undefined) { noIdx++; if (!ls.get(x) || ls.get(x)[2] == null) noPos++; } } }
  check('line HIPs resolve', noPos <= 2, nLines + ' segments, ' + noIdx + ' endpoints without 3-D index (no usable parallax), ' + noPos + ' without any position (HIP 55203 absent from HYG)');
  check('every constellation has lines + boundary', con.constellations.every((c) => c.lines.length > 0 && c.boundary.length > 0), 'ok');
  const names = named.rows.filter((r) => r[ix('properName')]).length;
  check('named stars', names > 400, `${names} with proper names, ${named.rows.length} rows`);
  if (errs) fail(`${errs} validation check(s) failed`);
  log('VALIDATION PASSED');
}
runMain(import.meta.url, main, 'VALIDATE');
