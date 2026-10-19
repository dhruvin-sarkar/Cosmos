#!/usr/bin/env node
/**
 * Phobos shape model: Gaskell Phobos Shape Model V1.0 (PDS4 urn:nasa:pds:gaskell.phobos.shape-model::1.0), vertex-facet
 * version phobos_ver128q.tab (99,846 vertices, 196,608 facets; stereophotoclinometry from Viking Orbiter 1 + Phobos 2 images).
 * Citation: Gaskell, R., "Gaskell Phobos Shape Model V1.0", VO1-SA-VISA/VISB-5-PHOBOSSHAPE-V1.0, NASA PDS Small Bodies Node, 2011.
 * Licence: NASA PDS data, public domain / free to use with citation.
 *
 * Usage: node scripts/data/moons/build-phobos-shape.mjs <phobos_ver128q.tab> [out=public/data/moons/phobos.shape.bin]
 *   curl -O https://sbnarchive.psi.edu/pds4/non_mission/gaskell.phobos.shape-model/data/phobos_ver128q.tab
 *
 * Output (little-endian): "SHP1" | u32 nVerts | u32 nFaces | f32 maxRadiusKm | i16[3*nVerts] (±32767 ↔ ±maxRadiusKm) | u32[3*nFaces] (0-based).
 * Unused (duplicate edge/corner) vertices are dropped; quantisation error < 0.4 m. Frame: Gaskell body-fixed, +z north, +x prime meridian.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [src, out = 'public/data/moons/phobos.shape.bin'] = process.argv.slice(2);
if (!src) { console.error('usage: build-phobos-shape.mjs <phobos_ver128q.tab> [out]'); process.exit(1); }
const lines = readFileSync(src, 'utf8').split('\n');
const [nv, nf] = lines[0].trim().split(/\s+/).map(Number);
const verts = new Float64Array(nv * 3);
for (let i = 0; i < nv; i++) {
  const p = lines[1 + i].trim().split(/\s+/).map(Number);
  verts.set([p[1], p[2], p[3]], i * 3);
}
const faces = [];
const used = new Uint8Array(nv);
for (let i = 0; i < nf; i++) {
  const p = lines[1 + nv + i].trim().split(/\s+/).map(Number);
  faces.push(p[1] - 1, p[2] - 1, p[3] - 1);
  used[p[1] - 1] = used[p[2] - 1] = used[p[3] - 1] = 1;
}
const remap = new Int32Array(nv).fill(-1);
let n = 0;
let maxR = 0;
for (let i = 0; i < nv; i++) if (used[i]) { remap[i] = n++; maxR = Math.max(maxR, Math.hypot(verts[3 * i], verts[3 * i + 1], verts[3 * i + 2])); }
const maxRadiusKm = Math.ceil(maxR * 100) / 100;
const buf = Buffer.alloc(16 + n * 6 + nf * 12);
buf.write('SHP1', 0, 'ascii');
buf.writeUInt32LE(n, 4);
buf.writeUInt32LE(nf, 8);
buf.writeFloatLE(maxRadiusKm, 12);
let o = 16;
for (let i = 0; i < nv; i++) {
  if (!used[i]) continue;
  for (let k = 0; k < 3; k++) { buf.writeInt16LE(Math.round((verts[3 * i + k] / maxRadiusKm) * 32767), o); o += 2; }
}
for (let i = 0; i < nf * 3; i++) { buf.writeUInt32LE(remap[faces[i]], o); o += 4; }
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, buf);
console.log(`phobos: ${n} vertices, ${nf} facets, maxR ${maxRadiusKm} km -> ${out} (${(buf.length / 1e6).toFixed(2)} MB)`);
