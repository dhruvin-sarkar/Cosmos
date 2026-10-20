// tex-moons: relief normal maps for moons from low-resolution global topography grids (float32 GeoTIFF, 0..360 E).
// Normals are differentiated at the source resolution (no invented detail), then lanczos-resampled to the output tiers.
// Heights relative to a sphere carry the triaxial figure, which is removed with a least-squares quadric first.
//   node scripts/data/textures-hd/build-moon-normals.mjs enceladus
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, TEX, rel, log, sharp, normalFromHeights } from './lib.mjs';

const RAWDIR = path.join(ROOT, 'data-raw', 'big', 'tex-moons', 'dem');
const FRAG = path.join(ROOT, 'data-raw', 'textures-hd');
const SRC = {
  enceladus: {
    url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Enceladus/enceladus_cassini_iss_shapemodel_bland_2019/enceladus_2019pm_topography.tif',
    radiusM: 251500, ex: 3, tiers: [['2k', 2048], ['1k', 1024]],
    name: 'Cassini ISS stereo-photogrammetric global shape model of Enceladus, topography grid 0.5 deg/px (~2.2 km; Bland et al. 2019; USGS Astrogeology)',
  },
};

for (const body of process.argv.slice(2)) {
  const c = SRC[body];
  fs.mkdirSync(RAWDIR, { recursive: true });
  const tif = path.join(RAWDIR, `${body}_topo.tif`), f32 = path.join(RAWDIR, `${body}_topo.f32`);
  if (!fs.existsSync(tif)) { const r = await fetch(c.url); if (!r.ok) throw new Error(`HTTP ${r.status}`); fs.writeFileSync(tif, Buffer.from(await r.arrayBuffer())); }
  const dims = execFileSync('python', ['-P', '-c', `import sys,numpy as np\nfrom PIL import Image\na=np.array(Image.open(sys.argv[1]),dtype='<f4')\na.tofile(sys.argv[2])\nprint(a.shape[1],a.shape[0])`, tif, f32]).toString().trim().split(' ').map(Number);
  const [W, H] = dims;
  const buf = fs.readFileSync(f32);
  const src = new Float32Array(buf.buffer, buf.byteOffset, W * H);
  // Roll 0..360E -> x=0 at 180W.
  let h = new Float32Array(W * H); const valid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const v = src[y * W + x], j = y * W + ((x + W / 2) % W);
    valid[j] = v > -1e5 && v < 1e5 ? 1 : 0; h[j] = valid[j] ? v : 0;
  }
  // Least-squares quadric of the radial height (removes the triaxial figure).
  const P = 7, A = new Float64Array(P * P), bv = new Float64Array(P), bs = new Float64Array(P);
  const basis = (x, y) => {
    const lon = ((-180 + (360 * (x + 0.5)) / W) * Math.PI) / 180, lat = ((90 - (180 * (y + 0.5)) / H) * Math.PI) / 180;
    const nx = Math.cos(lat) * Math.cos(lon), ny = Math.cos(lat) * Math.sin(lon), nz = Math.sin(lat);
    bs[0] = 1; bs[1] = nx * nx; bs[2] = ny * ny; bs[3] = nz * nz; bs[4] = nx * ny; bs[5] = nx * nz; bs[6] = ny * nz;
    return Math.cos(lat);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!valid[i]) continue;
    const w = basis(x, y);
    for (let a = 0; a < P; a++) { bv[a] += w * bs[a] * h[i]; for (let b = 0; b < P; b++) A[a * P + b] += w * bs[a] * bs[b]; }
  }
  for (let a = 0; a < P; a++) A[a * P + a] += 1e-6 * A[0];
  const M = Array.from({ length: P }, (_, r) => [...A.slice(r * P, r * P + P), bv[r]]);
  for (let col = 0; col < P; col++) {
    let piv = col; for (let r = col + 1; r < P; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < P; r++) if (r !== col) { const f = M[r][col] / M[col][col]; for (let k = col; k <= P; k++) M[r][k] -= f * M[col][k]; }
  }
  const coef = M.map((row, r) => row[P] / row[r]);
  let mn = Infinity, mx = -Infinity, nValid = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; basis(x, y);
    let t = 0; for (let a = 0; a < P; a++) t += coef[a] * bs[a];
    h[i] -= t;
    if (valid[i]) { nValid++; if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; }
  }
  for (let i = 0; i < W * H; i++) if (!valid[i]) h[i] = 0; // residual mean ~0 -> flat
  const { data: nd } = normalFromHeights(h, W, H, { radiusM: c.radiusM, exaggeration: c.ex });
  // Force unobserved cells and a 1-cell rim flat.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let near = false;
    for (let dy = -1; dy <= 1 && !near; dy++) for (let dx = -1; dx <= 1; dx++) { const yy = Math.min(H - 1, Math.max(0, y + dy)); if (!valid[yy * W + ((x + dx + W) % W)]) { near = true; break; } }
    if (near) { const o = (y * W + x) * 3; nd[o] = 128; nd[o + 1] = 128; nd[o + 2] = 255; }
  }
  const observed = nValid / (W * H);
  log(body, `${W}x${H}`, 'residual height range', Math.round(mn), Math.round(mx), 'observed', observed.toFixed(3));
  const frags = [];
  for (const [tag, w] of c.tiers) {
    const file = path.join(TEX, body, `normal_hd_${tag}.png`);
    // Pad one column on each side so lanczos wraps cleanly across the antimeridian, then crop.
    const pad = 4, padded = Buffer.alloc((W + 2 * pad) * H * 3);
    for (let y = 0; y < H; y++) for (let x = -pad; x < W + pad; x++) nd.copy(padded, (y * (W + 2 * pad) + x + pad) * 3, (y * W + ((x + W) % W)) * 3, (y * W + ((x + W) % W)) * 3 + 3);
    const sx = w / W, padOut = Math.round(pad * sx);
    await sharp(padded, { raw: { width: W + 2 * pad, height: H, channels: 3 } })
      .resize(w + 2 * padOut, w / 2, { kernel: 'lanczos3', fit: 'fill' })
      .extract({ left: padOut, top: 0, width: w, height: w / 2 })
      .png({ compressionLevel: 9, effort: 10 }).toFile(file);
    const bytes = fs.statSync(file).size;
    frags.push({ body, map: 'normal', tier: tag, path: rel(file), bytes,
      source: { name: c.name, url: c.url, license: 'public domain (NASA/USGS)', retrieved: '2026-10-19' },
      note: `Tangent-space normal map (OpenGL +Y up: R=+east, G=+north) differentiated on the native ${W}x${H} grid and lanczos-resampled (no added detail); triaxial figure removed (quadric fit); relief exaggerated x${c.ex}; residual height range ${Math.round(mn)}..${Math.round(mx)} m; observed fraction ${observed.toFixed(3)}; unobserved cells (mostly the north polar cap) forced flat`,
      extra: { normalExaggeration: c.ex } });
    log(body, tag, bytes, 'bytes');
  }
  fs.writeFileSync(path.join(FRAG, `hd2.moons-${body}.normal.json`), JSON.stringify(frags, null, 1));
}
