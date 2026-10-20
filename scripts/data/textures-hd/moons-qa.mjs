// tex-moons QA: antimeridian seam, pole cleanliness and orientation (vs the independently built 1k map) of moon/dwarf maps.
//   node scripts/data/textures-hd/moons-qa.mjs [body ...]
import fs from 'node:fs';
import path from 'node:path';
import { TEX, sharp, srgbToLinearLut as S2L } from './lib.mjs';

const BODIES = process.argv.length > 2 ? process.argv.slice(2) : fs.readdirSync(TEX).filter((b) => fs.existsSync(path.join(TEX, b, 'color_1k.jpg')));
const W = 2048, H = 1024;
for (const b of BODIES) {
  const best = ['color_16k.jpg', 'color_8k.jpg', 'color_4k.jpg', 'color_2k.jpg'].map((n) => path.join(TEX, b, n)).find((p) => fs.existsSync(p));
  if (!best) continue;
  const meta = await sharp(best, { limitInputPixels: false }).metadata();
  const { data } = await sharp(best, { limitInputPixels: false }).resize(W, H, { fit: 'fill', kernel: 'cubic' }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  const L = (x, y) => { const i = (y * W + x) * 3; return 0.2126 * S2L[data[i]] + 0.7152 * S2L[data[i + 1]] + 0.0722 * S2L[data[i + 2]]; };
  let seam = 0, adj = 0;
  for (let y = 0; y < H; y++) { seam += Math.abs(L(0, y) - L(W - 1, y)); adj += Math.abs(L(W / 2, y) - L(W / 2 - 1, y)); }
  const poleStd = (y) => { let s = 0, s2 = 0; for (let x = 0; x < W; x++) { const v = L(x, y); s += v; s2 += v * v; } const m = s / W; return Math.sqrt(Math.max(0, s2 / W - m * m)) / Math.max(m, 1e-3); };
  let r = 0, g = 0, bl = 0, n = 0;
  for (let y = H / 6; y < (5 * H) / 6; y++) for (let x = 0; x < W; x += 2) { const i = (y * W + x) * 3; r += S2L[data[i]]; g += S2L[data[i + 1]]; bl += S2L[data[i + 2]]; n++; }
  // orientation vs 1k (identity should win clearly)
  const A = await sharp(path.join(TEX, b, 'color_1k.jpg')).greyscale().resize(360, 180, { fit: 'fill' }).raw().toBuffer();
  const B = await sharp(best, { limitInputPixels: false }).greyscale().resize(360, 180, { fit: 'fill' }).raw().toBuffer();
  const corr = (f) => { let sa = 0, sb = 0, saa = 0, sbb = 0, sab = 0, k = 0; for (let y = 20; y < 160; y++) for (let x = 0; x < 360; x++) { const va = A[y * 360 + x], vb = B[y * 360 + f(x)]; sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb; k++; } return (sab / k - (sa / k) * (sb / k)) / Math.sqrt((saa / k - (sa / k) ** 2) * (sbb / k - (sb / k) ** 2)); };
  const cid = corr((x) => x), csh = corr((x) => (x + 180) % 360), cmi = corr((x) => 359 - x);
  console.log(`${b.padEnd(10)} ${path.basename(best).padEnd(14)} ${meta.width}x${meta.height} seam/adj ${(seam / adj).toFixed(2)} poleCV N ${poleStd(1).toFixed(3)} S ${poleStd(H - 2).toFixed(3)} rgbLin ${(r / n).toFixed(3)},${(g / n).toFixed(3)},${(bl / n).toFixed(3)} corr id ${cid.toFixed(2)} sh ${csh.toFixed(2)} mir ${cmi.toFixed(2)}`);
}
