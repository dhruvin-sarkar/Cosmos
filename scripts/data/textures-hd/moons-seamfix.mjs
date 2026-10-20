// tex-moons: detect and repair antimeridian edge-column artefacts (dark/bright 1-3 px columns left by mosaicking or
// non-wrapping resampling). Edge columns whose mean |difference| to their inner neighbour is an outlier vs. typical
// adjacent-column differences are replaced by a linear blend across the wrap. --fix rewrites the JPEG (q92 4:4:4).
//   node scripts/data/textures-hd/moons-seamfix.mjs [--fix] file ...
import fs from 'node:fs';
import { sharp } from './lib.mjs';
const fix = process.argv.includes('--fix');
for (const f of process.argv.slice(2).filter((a) => a !== '--fix')) {
  const { data, info } = await sharp(f, { limitInputPixels: false }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height, C = info.channels;
  const colDiff = (a, b) => { let s = 0; for (let y = 0; y < H; y++) for (let c = 0; c < C; c++) s += Math.abs(data[(y * W + a) * C + c] - data[(y * W + b) * C + c]); return s / (H * C); };
  let typ = 0; for (const x of [W / 4, W / 2, (3 * W) / 4].map(Math.floor)) typ += colDiff(x, x + 1) / 3;
  // how many edge columns are bad on each side
  const badL = [], badR = [];
  for (let k = 0; k < 4; k++) { if (colDiff(k, k + 1) > 2.2 * typ + 1) badL.push(k); if (colDiff(W - 1 - k, W - 2 - k) > 2.2 * typ + 1) badR.push(k); }
  const nl = badL.length ? Math.max(...badL) + 1 : 0, nr = badR.length ? Math.max(...badR) + 1 : 0;
  console.log(f, `${W}x${H}`, 'typ', typ.toFixed(2), 'L', [0, 1, 2].map((k) => colDiff(k, k + 1).toFixed(1)).join('/'), 'R', [0, 1, 2].map((k) => colDiff(W - 1 - k, W - 2 - k).toFixed(1)).join('/'), 'wrap', colDiff(0, W - 1).toFixed(1), '-> replace', nl, nr);
  if (!fix || (!nl && !nr)) continue;
  const a = nr, b = nl; // replace columns W-nr..W-1 and 0..nl-1 by blending good column W-1-nr and nl
  const span = a + b + 1;
  for (let y = 0; y < H; y++) for (let c = 0; c < C; c++) {
    const v0 = data[(y * W + (W - 1 - a)) * C + c], v1 = data[(y * W + b) * C + c];
    for (let j = 1; j < span; j++) {
      const x = (W - 1 - a + j) % W, t = j / span;
      data[(y * W + x) * C + c] = Math.round(v0 * (1 - t) + v1 * t);
    }
  }
  const tmp = f + '.tmp';
  await sharp(data, { raw: { width: W, height: H, channels: C } }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(tmp);
  fs.renameSync(tmp, f);
  console.log('  fixed', f, fs.statSync(f).size);
}
