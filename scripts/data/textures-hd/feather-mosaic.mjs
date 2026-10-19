// Polish round 2: remove mosaic-boundary artefacts from the Europa and Io 8k colour maps.
//   node scripts/data/textures-hd/feather-mosaic.mjs [europa|io ...] [--dry]
// Source is the unmodified USGS build, kept at data-raw/textures-hd/src/<body>_color_8k_orig.jpg (so the script is idempotent).
// Europa: (1) column 4096 (stitch of the two WMS half-globe tiles) was half-dark -> interpolated from its neighbours;
//         (2) the Galileo (sharp) / Voyager (soft) resolution boundaries were hard vertical edges -> local detail is faded
//             out smoothly (sigma ~80 px = ~3.5 deg of longitude, ~±8 deg full transition) approaching soft-data regions.
// Io:     the polar caps are unobserved/smeared and carry a hard colour step -> blended to a heavily low-passed copy poleward of ~55 deg.
import fs from 'node:fs';
import path from 'node:path';
import { sharp, RAW, TEX, log } from './lib.mjs';

const W = 8192, H = 4096;
const SRC = path.join(RAW, 'src'); fs.mkdirSync(SRC, { recursive: true });
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const raw = (file, ch = 3) => sharp(file, { limitInputPixels: false }).removeAlpha().raw().toBuffer();
const blur = (buf, ch, sigma) => sharp(buf, { raw: { width: W, height: H, channels: ch } }).blur(sigma).raw().toBuffer();
const save = (buf, file) => sharp(buf, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);

async function loadSrc(body) {
  const file = path.join(TEX, body, 'color_8k.jpg'), bak = path.join(SRC, `${body}_color_8k_orig.jpg`);
  if (!fs.existsSync(bak)) fs.copyFileSync(file, bak);
  return { file, data: await raw(bak) };
}

async function europa() {
  const { file, data } = await loadSrc('europa');
  for (let y = 0; y < H; y++) for (let c = 0; c < 3; c++) // stitch column
    data[(y * W + 4096) * 3 + c] = Math.round((data[(y * W + 4095) * 3 + c] + data[(y * W + 4097) * 3 + c]) / 2);
  const low = await blur(data, 3, 2.5);
  const n = W * H, e = Buffer.alloc(n);
  for (let i = 0; i < n; i++) e[i] = Math.min(255, Math.abs(data[i * 3 + 1] - low[i * 3 + 1]) * 12); // high-pass energy (green)
  const E = await blur(e, 1, 6);
  const hist = new Uint32Array(256); for (let i = 0; i < n; i += 7) hist[E[i]]++;
  let acc = 0, tot = 0; hist.forEach((v) => (tot += v)); const pct = {};
  for (let v = 0; v < 256; v++) { acc += hist[v]; for (const p of [10, 25, 50, 75, 90]) if (pct[p] === undefined && acc >= tot * p / 100) pct[p] = v; }
  log('europa detail-energy percentiles', JSON.stringify(pct));
  const thr = Number(process.env.THR ?? 0), T = thr || Math.round(pct[25]); // below T = "soft" data
  const soft = Buffer.alloc(n); for (let i = 0; i < n; i++) soft[i] = E[i] < T ? 255 : 0;
  const f = await blur(soft, 1, Number(process.env.SIG ?? 80));
  const out = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const k = smooth(0.12, 0.7, f[i] / 255); // 0 = deep in sharp data, 1 = soft data
    for (let c = 0; c < 3; c++) { const j = i * 3 + c; out[j] = Math.max(0, Math.min(255, Math.round(low[j] + (data[j] - low[j]) * (1 - k)))); }
  }
  if (process.argv.includes('--dry')) return;
  log('europa', (await save(out, file)).size);
}

async function io() {
  const { file, data } = await loadSrc('io');
  const low = await blur(data, 3, Number(process.env.POLESIG ?? 45));
  const out = Buffer.from(data);
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(90 - (180 * (y + 0.5)) / H), w = smooth(50, 68, lat);
    if (w === 0) continue;
    for (let x = 0; x < W * 3; x++) { const j = y * W * 3 + x; out[j] = Math.round(data[j] * (1 - w) + low[j] * w); }
  }
  if (process.argv.includes('--dry')) return;
  log('io', (await save(out, file)).size);
}

const want = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!want.length || want.includes('europa')) await europa();
if (!want.length || want.includes('io')) await io();
