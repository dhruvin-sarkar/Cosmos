// Round 2: relief normal maps from USGS global DEM/DTM GeoTIFFs (public domain). Heights are area-resampled by libvips to 4096x2048,
// rolled to x=0 at 180W where the source starts at 0E, then differentiated (OpenGL +Y up tangent space, see lib.mjs normalFromHeights).
//   node scripts/data/textures-hd/build-normals2.mjs <pluto|charon|ceres|vesta ...>     raws in data-raw/textures-hd/dem2/
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { RAW, TEX, rel, log, sharp, downsample, normalFromHeights, writeNormalPng } from './lib.mjs';

const B = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/';
const SRC = {
  pluto: { file: 'Pluto_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif', roll: true, nodata: 0, radiusM: 1188300, ex: 3, name: 'New Horizons LORRI/MVIC stereo+photoclinometry global DEM of Pluto, 300 m/px (Schenk et al. 2018, Icarus 314; USGS Astrogeology)' },
  charon: { file: 'Charon_NewHorizons_Global_DEM_300m_Jul2017_16bit.tif', roll: false, nodata: 0, radiusM: 606000, ex: 3, name: 'New Horizons stereo global DEM of Charon, 300 m/px (Schenk et al. 2018; USGS Astrogeology)' },
  ceres: { file: 'Ceres_Dawn_FC_HAMO_DTM_DLR_Global_60ppd_Oct2016.tif', roll: true, detrend: true, radiusM: 470000, ex: 3, name: 'Dawn FC HAMO stereo global DTM of Ceres, 60 px/deg (~135 m/px; Preusker et al. 2016, DLR; USGS Astrogeology)' },
  vesta: { file: 'Vesta_Dawn_HAMO_DTM_DLR_Global_48ppd.tif', roll: false, detrend: true, radiusM: 255000, ex: 2, name: 'Dawn FC HAMO stereo global DTM of Vesta, 48 px/deg (DLR; Preusker et al. 2016; USGS Astrogeology)' },
};
const W = 4096, H = 2048;
for (const body of process.argv.slice(2)) {
  const c = SRC[body];
  const f = path.join(RAW, 'dem2', c.file);
  const f32 = path.join(RAW, 'dem2', `${body}_4k.f32`);
  if (!fs.existsSync(f32)) execFileSync('python', [path.join(import.meta.dirname, 'tiff_dem.py'), f, f32, String(W), String(H), ...(c.nodata !== undefined ? [String(c.nodata)] : [])], { stdio: 'inherit' }); // area-averaged float32 grid
  const fb = fs.readFileSync(f32);
  let h = new Float32Array(fb.buffer, fb.byteOffset, W * H);
  const vm = fs.existsSync(f32 + '.valid') ? fs.readFileSync(f32 + '.valid') : null;
  let bad = 0, mn = Infinity, mx = -Infinity;
  const ok = (i) => h[i] > -30000 && h[i] < 3e5 && (!vm || vm[i] === 1);
  for (let i = 0; i < h.length; i++) { if (!ok(i)) { bad++; continue; } if (h[i] < mn) mn = h[i]; if (h[i] > mx) mx = h[i]; }
  log(body, 'height range', mn, mx, 'unobserved px', bad, (100 * (1 - bad / h.length)).toFixed(1) + '% observed');
  const valid = new Uint8Array(W * H); const fill = (mn + mx) / 2; // fill unobserved with a constant (-> no slope), later forced flat
  h = Float32Array.from(h, (v, i) => { valid[i] = ok(i) ? 1 : 0; return valid[i] ? v : fill; });
  if (c.roll) {
    const o = new Float32Array(h.length), ov = new Uint8Array(h.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const j = y * W + (x + W / 2) % W; o[j] = h[y * W + x]; ov[j] = valid[y * W + x]; }
    h = o; valid.set(ov);
  }
  if (c.detrend) { // heights are relative to a sphere, so the oblate/triaxial figure is a huge tilt: remove a least-squares quadric (1, x2, y2, z2, xy, xz, yz) of the radial height
    const P = 7, A = new Float64Array(P * P), bv = new Float64Array(P), basis = new Float64Array(P);
    const nm = (i) => { const x = i % W, y = Math.floor(i / W); const lon = ((-180 + (360 * (x + 0.5)) / W) * Math.PI) / 180, lat = ((90 - (180 * (y + 0.5)) / H) * Math.PI) / 180; return [Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat), Math.cos(lat)]; };
    const bs = (n) => { basis[0] = 1; basis[1] = n[0] * n[0]; basis[2] = n[1] * n[1]; basis[3] = n[2] * n[2]; basis[4] = n[0] * n[1]; basis[5] = n[0] * n[2]; basis[6] = n[1] * n[2]; };
    for (let i = 0; i < h.length; i += 7) { if (!valid[i]) continue; const n = nm(i); bs(n); const w = n[3]; for (let a = 0; a < P; a++) { bv[a] += w * basis[a] * h[i]; for (let b2 = 0; b2 < P; b2++) A[a * P + b2] += w * basis[a] * basis[b2]; } }
    for (let a = 0; a < P; a++) A[a * P + a] += 1e-9; // tiny ridge (the quadric basis is rank 6 on the sphere: x2+y2+z2 = 1 duplicates the constant)
    for (let a = 0; a < P; a++) A[a * P + a] += 1e-6 * A[0];
    const x = new Float64Array(P); // Gaussian elimination
    const M = Array.from({ length: P }, (_, r) => [...A.slice(r * P, r * P + P), bv[r]]);
    for (let col = 0; col < P; col++) { let piv = col; for (let r = col + 1; r < P; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r; [M[col], M[piv]] = [M[piv], M[col]]; for (let r = 0; r < P; r++) if (r !== col) { const f2 = M[r][col] / M[col][col]; for (let k = col; k <= P; k++) M[r][k] -= f2 * M[col][k]; } }
    for (let r = 0; r < P; r++) x[r] = M[r][P] / M[r][r];
    let m2 = Infinity, mx2 = -Infinity;
    for (let i = 0; i < h.length; i++) { const n = nm(i); bs(n); let t = 0; for (let a = 0; a < P; a++) t += x[a] * basis[a]; h[i] -= t; if (valid[i]) { if (h[i] < m2) m2 = h[i]; if (h[i] > mx2) mx2 = h[i]; } }
    log(body, 'detrended quadric coeffs', Array.from(x, (v) => Math.round(v)).join(','), 'residual range', Math.round(m2), Math.round(mx2));
    mn = m2; mx = mx2;
  }
  let imn = 0, imx = 0; for (let i = 0; i < h.length; i++) { if (h[i] < h[imn]) imn = i; if (h[i] > h[imx]) imx = i; }
  const ll = (i) => `lon ${(-180 + (360 * ((i % W) + 0.5)) / W).toFixed(1)} lat ${(90 - (180 * (Math.floor(i / W) + 0.5)) / H).toFixed(1)}`;
  log(body, 'min at', ll(imn), 'max at', ll(imx));
  const files = {}, frags = [];
  for (const [w, tag] of [[4096, '4k'], [2048, '2k']]) {
    const hs = w === W ? h : downsample(h, W, H, w, w / 2);
    const { data: nd, maxSlope } = normalFromHeights(hs, w, w / 2, { radiusM: c.radiusM, exaggeration: c.ex });
    if (bad) { // force unobserved areas (and a 3 px rim, where the fill makes a false cliff) to a flat normal
      const wh = w / 2, sc = W / w, r = 3, flat = [128, 128, 255];
      const vs = (x, y) => valid[Math.min(H - 1, Math.floor(y * sc)) * W + (Math.floor(x * sc) % W)];
      const inv = new Uint8Array(w * wh);
      for (let y = 0; y < wh; y++) for (let x = 0; x < w; x++) if (!vs(x, y)) inv[y * w + x] = 1;
      for (let y = 0; y < wh; y++) for (let x = 0; x < w; x++) {
        let near = false;
        for (let dy = -r; dy <= r && !near; dy++) { const yy = y + dy; if (yy < 0 || yy >= wh) continue; for (let dx = -r; dx <= r; dx++) if (inv[yy * w + ((x + dx + w) % w)]) { near = true; break; } }
        if (near) { const o = (y * w + x) * 3; nd[o] = flat[0]; nd[o + 1] = flat[1]; nd[o + 2] = flat[2]; }
      }
    }
    const file = path.join(TEX, body, `normal_hd_${tag}.png`);
    const size = await writeNormalPng(nd, w, w / 2, file);
    log(body, tag, size, 'bytes, max raw slope deg', ((Math.atan(maxSlope / c.ex) * 180) / Math.PI).toFixed(1));
    files[tag] = { path: rel(file), bytes: size };
    if (tag === '4k') frags.push({ body, map: 'normal', tier: '4k', path: rel(file), bytes: size,
      source: { name: c.name, url: B + c.file, license: 'public domain (NASA/USGS)', retrieved: '2026-10-19' },
      note: `Tangent-space normal map (OpenGL +Y up) from the DEM resampled to 4096x2048; relief exaggerated x${c.ex} (app can undo with normalScale=1/${c.ex}); height range ${Math.round(mn)}..${Math.round(mx)} m; observed fraction ${(1 - bad / h.length).toFixed(3)} flattened; unobserved areas (and a 3 px rim) are forced flat`,
      extra: { normalExaggeration: c.ex } });
  }
  fs.writeFileSync(path.join(RAW, `hd2.${body}.normal.json`), JSON.stringify(frags, null, 1));
}
