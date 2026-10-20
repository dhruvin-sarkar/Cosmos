// tex-moons: remove an antimeridian (x=0 / x=W-1) step left by mosaicking. Per row the step D(y) = v(0) - v(W-1) is
// smoothed vertically (+-S rows) and split across both sides with a linear ramp over B columns (low-frequency
// correction, no ghosting); then a narrow cross-dissolve over N columns hides the residual fine-texture break.
// Originals are copied to data-raw/big/tex-moons/orig/ first.   node moons-wrapfeather.mjs file ...
import fs from 'node:fs';
import path from 'node:path';
import { sharp } from './lib.mjs';
const BAK = path.resolve('data-raw/big/tex-moons/orig');
fs.mkdirSync(BAK, { recursive: true });
for (const f of process.argv.slice(2)) {
  const bak = path.join(BAK, f.replace(/[\/:]/g, '_'));
  if (!fs.existsSync(bak)) fs.copyFileSync(f, bak);
  const { data, info } = await sharp(bak, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const B = Math.round(W / 128), S = Math.max(2, Math.round(W / 1024)), N = Math.max(2, Math.round(W / 2048));
  const px = (x, y, c) => data[(y * W + x) * C + c];
  const out = Buffer.from(data);
  for (let c = 0; c < C; c++) {
    const D = new Float32Array(H);
    for (let y = 0; y < H; y++) { let s = 0; for (let k = 0; k < 3; k++) s += px(k, y, c) - px(W - 1 - k, y, c); D[y] = s / 3; }
    const Ds = new Float32Array(H);
    for (let y = 0; y < H; y++) { let s = 0, n = 0; for (let d = -S; d <= S; d++) { const yy = y + d; if (yy >= 0 && yy < H) { s += D[yy]; n++; } } Ds[y] = s / n; }
    for (let y = 0; y < H; y++) for (let j = 0; j < B; j++) {
      const w = (1 - (j + 0.5) / B) * 0.5 * Ds[y];
      const iL = (y * W + j) * C + c, iR = (y * W + (W - 1 - j)) * C + c;
      out[iL] = Math.max(0, Math.min(255, Math.round(data[iL] - w)));
      out[iR] = Math.max(0, Math.min(255, Math.round(data[iR] + w)));
    }
  }
  // cross-dissolve: each side blends towards the mirrored column on the other side, 50% at the seam -> 0 at N
  const tmp = Buffer.from(out);
  for (let y = 0; y < H; y++) for (let j = 0; j < N; j++) {
    const t = 0.5 * (1 - j / N);
    for (let c = 0; c < C; c++) {
      const iL = (y * W + j) * C + c, iR = (y * W + (W - 1 - j)) * C + c;
      out[iL] = Math.round(tmp[iL] * (1 - t) + tmp[iR] * t);
      out[iR] = Math.round(tmp[iR] * (1 - t) + tmp[iL] * t);
    }
  }
  const t2 = f + '.tmp';
  await sharp(out, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(t2);
  try { fs.renameSync(t2, f); } catch { fs.copyFileSync(t2, f); fs.rmSync(t2); }
  console.log('feathered', f, `${W}x${H}`, 'B', B, 'S', S, 'N', N);
}
