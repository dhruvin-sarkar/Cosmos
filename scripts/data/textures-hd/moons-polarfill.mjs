// tex-moons: fill unimaged (no-data, near-black) polar areas of a mosaic with an albedo-matched, featureless fill
// interpolated from the surrounding imaged terrain (push-pull pyramid inpainting, wrap-aware in longitude).
// No detail is invented: the fill carries only the low-frequency albedo of the imaged border. Only pixels poleward
// of |lat| >= minLat are candidates, so genuinely dark terrain elsewhere is untouched. Originals -> data-raw/big/tex-moons/orig/.
// Writes <dir>/coverage_1k.png (white = imaged) next to the first file given.
//   node moons-polarfill.mjs minLat thr file ...   (minLat < 0 -> southern cap only)
import fs from 'node:fs';
import path from 'node:path';
import { sharp } from './lib.mjs';
const [minLat, thr, ...files] = process.argv.slice(2);
const BAK = path.resolve('data-raw/big/tex-moons/orig');
fs.mkdirSync(BAK, { recursive: true });

function pushPull(val, wt, W, H, C) {
  if (W <= 8 || H <= 4) { // coarsest: fill with weighted mean
    const m = new Float32Array(C); let s = 0;
    for (let i = 0; i < W * H; i++) { s += wt[i]; for (let c = 0; c < C; c++) m[c] += val[i * C + c] * wt[i]; }
    for (let i = 0; i < W * H; i++) if (wt[i] < 1) for (let c = 0; c < C; c++) val[i * C + c] = val[i * C + c] * wt[i] + (m[c] / Math.max(s, 1e-6)) * (1 - wt[i]);
    return;
  }
  const w2 = W >> 1, h2 = H >> 1, v2 = new Float32Array(w2 * h2 * C), t2 = new Float32Array(w2 * h2);
  for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) {
    let s = 0; const o = (y * w2 + x);
    for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) { const i = (2 * y + dy) * W + 2 * x + dx; s += wt[i]; for (let c = 0; c < C; c++) v2[o * C + c] += val[i * C + c] * wt[i]; }
    if (s > 0) for (let c = 0; c < C; c++) v2[o * C + c] /= s;
    t2[o] = Math.min(1, s);
  }
  pushPull(v2, t2, w2, h2, C);
  // pull: bilinear upsample (wrap in x) into the holes
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (wt[i] >= 1) continue;
    const fx = (x + 0.5) / 2 - 0.5, fy = Math.min(Math.max((y + 0.5) / 2 - 0.5, 0), h2 - 1);
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0, y1 = Math.min(y0 + 1, h2 - 1);
    const xa = (x0 + w2) % w2, xb = (x0 + 1) % w2;
    for (let c = 0; c < C; c++) {
      const u = (v2[(y0 * w2 + xa) * C + c] * (1 - ax) + v2[(y0 * w2 + xb) * C + c] * ax) * (1 - ay) + (v2[(y1 * w2 + xa) * C + c] * (1 - ax) + v2[(y1 * w2 + xb) * C + c] * ax) * ay;
      val[i * C + c] = val[i * C + c] * wt[i] + u * (1 - wt[i]);
    }
  }
}

let first = true;
for (const f of files) {
  const bak = path.join(BAK, f.replace(/[\/:]/g, '_'));
  if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);
  const { data, info } = await sharp(bak, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  // work at <= 2048 wide for the fill, then upsample the fill back (it is low-frequency anyway)
  const k = Math.max(1, W / 2048), w = W / k, h = H / k;
  const mask = new Uint8Array(W * H); // 1 = no data
  // minLat < 0: southern cap only; minLat > 0: both caps
  const yLim2 = H - Math.floor(((90 - Math.abs(+minLat)) / 180) * H), yLim = +minLat < 0 ? -1 : H - yLim2;
  for (let y = 0; y < H; y++) { if (y > yLim && y < yLim2) continue; for (let x = 0; x < W; x++) { const i = (y * W + x) * C; if (data[i] + data[i + 1] + data[i + 2] <= 3 * +thr) mask[y * W + x] = 1; } }
  // dilate by ~0.15 deg to drop the resampling fringe
  const R = Math.max(1, Math.round(W / 2400));
  const dil = new Uint8Array(mask);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const yy = y + dy; if (yy >= 0 && yy < H) dil[yy * W + ((x + dx + W) % W)] = 1; }
  // downsampled working copy
  const val = new Float32Array(w * h * C), wt = new Float32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0; const acc = [0, 0, 0];
    for (let yy = y * k; yy < (y + 1) * k; yy++) for (let xx = x * k; xx < (x + 1) * k; xx++) { if (dil[yy * W + xx]) continue; s++; for (let c = 0; c < C; c++) acc[c] += data[(yy * W + xx) * C + c]; }
    wt[y * w + x] = s / (k * k) > 0.999 ? 1 : 0;
    for (let c = 0; c < C; c++) val[(y * w + x) * C + c] = s ? acc[c] / s : 0;
  }
  pushPull(val, wt, w, h, C);
  // smooth the fill along longitude with a window that widens toward the pole (constant ground distance ~20 deg at the
  // equator), then relax it toward the hemisphere's imaged polar-band mean as |lat| -> 90, so the cap reads as one neutral
  // albedo instead of the vertically extruded border (shadowed rims, limb streaks).
  const capMean = (north) => { const m = [0, 0, 0]; let n = 0; for (let y = 0; y < h; y++) { const lat = 90 - ((y + 0.5) / h) * 180; if ((north ? lat : -lat) < Math.abs(+minLat)) continue; for (let x = 0; x < w; x++) if (wt[y * w + x] >= 1) { n++; for (let c = 0; c < C; c++) m[c] += val[(y * w + x) * C + c]; } } return m.map((v) => v / Math.max(n, 1)); };
  const caps = [capMean(true), capMean(false)];
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180; let any = false; for (let x = 0; x < w; x++) if (wt[y * w + x] < 1) { any = true; break; } if (!any) continue;
    const r = Math.min(w >> 1, Math.round((w * 20) / 360 / Math.max(Math.cos((lat * Math.PI) / 180), 0.02)));
    const row = val.slice(y * w * C, (y + 1) * w * C), acc = [0, 0, 0];
    for (let d = -r; d <= r; d++) for (let c = 0; c < C; c++) acc[c] += row[((d + w) % w) * C + c];
    for (let x = 0; x < w; x++) {
      if (wt[y * w + x] < 1) for (let c = 0; c < C; c++) val[(y * w + x) * C + c] = acc[c] / (2 * r + 1);
      for (let c = 0; c < C; c++) acc[c] += row[((x + r + 1) % w) * C + c] - row[((x - r + w) % w) * C + c];
    }
  }
  for (let y = 0; y < h; y++) {
    const lat = 90 - ((y + 0.5) / h) * 180, t = Math.max(0, (Math.abs(lat) - 80) / 10) ** 1.5, m = caps[lat > 0 ? 0 : 1];
    for (let x = 0; x < w; x++) if (wt[y * w + x] < 1) for (let c = 0; c < C; c++) val[(y * w + x) * C + c] = val[(y * w + x) * C + c] * (1 - t) + m[c] * t;
  }
  // blur the fill a little so the pyramid's block structure never shows
  const out = Buffer.from(data);
  // soft feather width (px, full res) around the hole edge via distance-ish: use a box-blurred copy of dil
  const F = Math.max(2, Math.round(W / 1024));
  const soft = new Float32Array(W * H);
  for (let y = 0; y < H; y++) { let s = 0; for (let x = -F; x <= F; x++) s += dil[y * W + ((x + W) % W)]; for (let x = 0; x < W; x++) { soft[y * W + x] = s / (2 * F + 1); s += dil[y * W + ((x + F + 1) % W)] - dil[y * W + ((x - F + W) % W)]; } }
  const soft2 = new Float32Array(W * H);
  for (let x = 0; x < W; x++) { let s = 0, n = 0; for (let y = 0; y <= F && y < H; y++) { s += soft[y * W + x]; n++; } for (let y = 0; y < H; y++) { soft2[y * W + x] = s / n; if (y + F + 1 < H) { s += soft[(y + F + 1) * W + x]; n++; } if (y - F >= 0) { s -= soft[(y - F) * W + x]; n--; } } }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const a = Math.max(soft2[y * W + x], dil[y * W + x]); if (a <= 0) continue;
    const fx = Math.min((x + 0.5) / k - 0.5, w - 1), fy = Math.min(Math.max((y + 0.5) / k - 0.5, 0), h - 1);
    const x0 = Math.floor(fx), y0 = Math.max(0, Math.floor(fy)), ax = fx - x0, ay = fy - y0, x1 = (x0 + 1) % w, y1 = Math.min(y0 + 1, h - 1), xa = (x0 + w) % w;
    for (let c = 0; c < C; c++) {
      const u = (val[(y0 * w + xa) * C + c] * (1 - ax) + val[(y0 * w + x1) * C + c] * ax) * (1 - ay) + (val[(y1 * w + xa) * C + c] * (1 - ax) + val[(y1 * w + x1) * C + c] * ax) * ay;
      const i = (y * W + x) * C + c; out[i] = Math.round(data[i] * (1 - a) + u * a);
    }
  }
  const t2 = f + '.tmp';
  await sharp(out, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(t2);
  try { fs.renameSync(t2, f); } catch { fs.copyFileSync(t2, f); fs.rmSync(t2); }
  let n = 0; for (let i = 0; i < W * H; i++) n += dil[i];
  console.log('filled', f, `${W}x${H}`, `${((100 * n) / (W * H)).toFixed(2)}% of pixels`);
  if (first) {
    first = false;
    const cov = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) cov[i] = dil[i] ? 0 : 255;
    await sharp(cov, { raw: { width: W, height: H, channels: 1 } }).resize(1024, 512, { kernel: 'cubic' }).png().toFile(path.join(path.dirname(f), 'coverage_1k.png'));
  }
}
