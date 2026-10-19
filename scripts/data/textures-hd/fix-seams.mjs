// Polish round 1: repair antimeridian-seam defects found by scanning every equirect colour map's edge columns.
//   node scripts/data/textures-hd/fix-seams.mjs
// - Ceres/Vesta colour_4k/1k had 2-3 black edge columns (dark pole-to-pole seam): rebuilt by area-downsampling the clean 8k map.
// - Mercury colour_8k and Venus surface_4k had 1-2 bad edge columns: replaced by interpolation across the wrap (x=W-1 -> x=0).
import { sharp, TEX, readRgb, log } from './lib.mjs';
import path from 'node:path';

const jpg = (raw, W, H, file) => sharp(raw, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);

for (const body of ['ceres', 'vesta']) {
  for (const [W, tag] of [[4096, '4k'], [1024, '1k']]) {
    const { data } = await sharp(path.join(TEX, body, 'color_8k.jpg'), { limitInputPixels: false }).resize(W, W / 2, { kernel: 'lanczos3' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    const info = await jpg(data, W, W / 2, path.join(TEX, body, `color_${tag}.jpg`));
    log(body, tag, info.size);
  }
}

async function heal(file, bad) { // bad = column indices (wrap-aware); fill by linear interpolation between nearest good columns
  const img = await readRgb(file), { data, width: W, height: H } = img;
  const set = new Set(bad.map((x) => (x + W) % W));
  let lo = (Math.min(...bad) + W - 1) % W; while (set.has(lo)) lo = (lo + W - 1) % W;
  const run = bad.map((x) => (x + W) % W);
  // order along the wrap: columns ascending from the start of the bad run
  const start = run.find((x) => !set.has((x + W - 1) % W));
  const order = []; for (let x = start; set.has(x); x = (x + 1) % W) order.push(x);
  const a = (start + W - 1) % W, b = (order[order.length - 1] + 1) % W, n = order.length + 1;
  order.forEach((x, k) => {
    const t = (k + 1) / n;
    for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) data[(y * W + x) * 3 + c] = Math.round(data[(y * W + a) * 3 + c] * (1 - t) + data[(y * W + b) * 3 + c] * t);
  });
  const info = await jpg(data, W, H, file);
  log(path.basename(file), 'healed cols', bad.join(','), info.size);
}
await heal(path.join(TEX, 'mercury', 'color_8k.jpg'), [8190, 8191]);
await heal(path.join(TEX, 'venus', 'surface_4k.jpg'), [4095, 0]);
