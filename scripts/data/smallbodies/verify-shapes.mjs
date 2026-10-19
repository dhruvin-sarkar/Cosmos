#!/usr/bin/env node
// Numeric sanity check of public/data/smallbodies/shapes/*.bin: parses each SBSH file the way the
// renderer will, checks header/bounds/manifoldness/orientation and compares the volume-equivalent
// radius to published values. Usage: node scripts/data/smallbodies/verify-shapes.mjs
import { readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = resolve(here, '..', '..', '..', 'public', 'data', 'smallbodies', 'shapes');
const index = JSON.parse(await readFile(join(dir, 'index.json'), 'utf8'));

// Published volume-equivalent radii (km) and tolerance.
const expected = {
  bennu: [0.2450, 0.03], ryugu: [0.448, 0.03], eros: [8.40, 0.04], itokawa: [0.165, 0.04],
  didymos: [0.365, 0.04] /* v003: 730 m vol-equiv. diameter (v002/2023 Nature: ~761 m) */, dimorphos: [0.075, 0.08], arrokoth: [9.0, 0.08], '67p': [1.67, 0.05],
};

let fail = 0;
for (const [id, meta] of Object.entries(index.shapes)) {
  const path = join(dir, `${id}.bin`);
  const buf = await readFile(path);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = buf.subarray(0, 4).toString('ascii');
  const version = dv.getUint32(4, true), nV = dv.getUint32(8, true), nT = dv.getUint32(12, true);
  const scale = dv.getFloat32(16, true), flags = dv.getUint32(20, true);
  const posBytes = nV * 6, idxOff = 24 + posBytes + ((4 - (posBytes % 4)) % 4);
  const big = (flags & 1) === 1;
  const expectLen = idxOff + nT * 3 * (big ? 4 : 2);
  const errs = [];
  if (magic !== 'SBSH' || version !== 1) errs.push('bad header');
  if (buf.length !== expectLen) errs.push(`length ${buf.length} != ${expectLen}`);
  const P = new Float64Array(nV * 3);
  let maxAbs = 0;
  for (let i = 0; i < nV * 3; i++) {
    const q = dv.getInt16(24 + i * 2, true);
    P[i] = (q / 32767) * scale;
    maxAbs = Math.max(maxAbs, Math.abs(q));
  }
  if (maxAbs !== 32767) errs.push(`max |q| ${maxAbs} (scale not tight)`);
  const I = big ? new Uint32Array(buf.buffer.slice(buf.byteOffset + idxOff, buf.byteOffset + expectLen))
    : new Uint16Array(buf.buffer.slice(buf.byteOffset + idxOff, buf.byteOffset + expectLen));
  let v6 = 0, cx = 0, cy = 0, cz = 0, badIdx = 0;
  const edges = new Map();
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3], b = I[t * 3 + 1], c = I[t * 3 + 2];
    if (a >= nV || b >= nV || c >= nV) { badIdx++; continue; }
    const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
    const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
    const qx = P[c * 3], qy = P[c * 3 + 1], qz = P[c * 3 + 2];
    const d = ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
    v6 += d; cx += (ax + bx + qx) * d; cy += (ay + by + qy) * d; cz += (az + bz + qz) * d;
    for (const [u, w] of [[a, b], [b, c], [c, a]]) {
      const k = u < w ? u * nV + w : w * nV + u; // directed-consistency: +1 for u<w, -1 otherwise
      edges.set(k, (edges.get(k) ?? 0) + (u < w ? 1 : -1) * 1000 + 1);
    }
  }
  let open = 0, inconsistent = 0;
  for (const val of edges.values()) {
    const count = ((val % 1000) + 1000) % 1000, dir = Math.round((val - count) / 1000);
    if (count !== 2) open++; else if (dir !== 0) inconsistent++;
  }
  const vol = v6 / 6, R = Math.cbrt((3 * vol) / (4 * Math.PI));
  const cen = [cx, cy, cz].map((s) => s / (24 * vol));
  if (badIdx) errs.push(`${badIdx} bad indices`);
  if (vol <= 0) errs.push('negative volume (inward winding)');
  if (open) errs.push(`${open} open/non-manifold edges`);
  if (inconsistent) errs.push(`${inconsistent} inconsistently wound edges`);
  if (Math.abs(R - meta.meanRadiusKm) > 1e-3 * R) errs.push(`R ${R} != index ${meta.meanRadiusKm}`);
  const exp = expected[id];
  const rel = exp ? (R - exp[0]) / exp[0] : 0;
  if (exp && Math.abs(rel) > exp[1]) errs.push(`R off published ${exp[0]} by ${(rel * 100).toFixed(1)}%`);
  const size = (await stat(path)).size;
  if (size > 400 * 1024) errs.push(`size ${size} > 400 KB`);
  const cOff = Math.hypot(...cen);
  console.log(`${errs.length ? 'FAIL' : 'ok  '} ${id.padEnd(9)} v=${nV} t=${nT} ${(size / 1024).toFixed(0)}KB ` +
    `R=${R.toFixed(4)}km (pub ${exp?.[0]}, ${(rel * 100).toFixed(1)}%) centroid ${(cOff * 1000).toFixed(1)} m ` +
    `extent ${meta.extentKm.map((x) => x.toFixed(3)).join('x')}${errs.length ? ' :: ' + errs.join('; ') : ''}`);
  if (errs.length) fail++;
}
process.exitCode = fail ? 1 : 0;
