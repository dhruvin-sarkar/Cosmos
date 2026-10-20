// Triton: feather the unimaged fill into the Voyager 2 mosaic (3-5 deg) and write a soft coverage mask.
// Idempotent: always reads the pristine originals from data-raw/big/tex-moons/orig/triton/.
import fs from 'node:fs';
import path from 'node:path';
import { sharp, ROOT, readRgb, log } from './lib.mjs';

const TEX = path.join(ROOT, 'public', 'textures', 'triton');
const ORIG = path.join(ROOT, 'data-raw', 'big', 'tex-moons', 'orig', 'triton');
fs.mkdirSync(ORIG, { recursive: true });
const keep = (name) => {
  const o = path.join(ORIG, name);
  if (!fs.existsSync(o)) fs.copyFileSync(path.join(TEX, name), o);
  return o;
};
const SIGMA_DEG = 3.0;   // gaussian sigma -> feather width ~ 3 sigma ~ 6.6 deg total, visible ramp ~4 deg

/** Soft coverage weight (0 unimaged .. 1 imaged) at W x H, from the binary 2k mask; longitude-wrapped blur. */
async function softMask(W, H) {
  const bin = await sharp(keep('coverage_2k.png')).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const bw = bin.info.width, bh = bin.info.height;
  // tile 3x horizontally so the blur wraps in longitude
  const tiled = Buffer.alloc(bw * 3 * bh);
  for (let y = 0; y < bh; y++) for (let k = 0; k < 3; k++) bin.data.copy(tiled, y * bw * 3 + k * bw, y * bw, (y + 1) * bw);
  const sigma = (SIGMA_DEG / 360) * bw;
  const r = await sharp(tiled, { raw: { width: bw * 3, height: bh, channels: 1 } }).blur(sigma).raw().toBuffer({ resolveWithObject: true });
  const bt = r.data, ch = r.info.channels;
  const blurred = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++) for (let x = 0; x < bw; x++) blurred[y * bw + x] = bt[(y * bw * 3 + bw + x) * ch];
  const w = new Float32Array(bw * bh);
  for (let i = 0; i < w.length; i++) {
    const t = Math.min(1, Math.max(0, (blurred[i] / 255 - 0.5) / 0.5));     // 0 at the old edge, 1 one ~sigma inside
    w[i] = t * t * (3 - 2 * t);
  }
  const b8 = Buffer.alloc(w.length);
  for (let i = 0; i < w.length; i++) b8[i] = Math.round(w[i] * 255);
  const o = await sharp(b8, { raw: { width: bw, height: bh, channels: 1 } }).resize(W, H, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(W * H);
  for (let i = 0; i < out.length; i++) out[i] = o.data[i * o.info.channels];
  return out;
}

/** Seamless 3-D value noise on the sphere (4 octaves, freq 2.5..20), 0..1, as 8-bit at W x H. Gives the unimaged fill a faint mottled albedo. */
function hash3(x, y, z, seed) { let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967295; }
function vnoise(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z), fx = x - xi, fy = y - yi, fz = z - zi;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy), w = fz * fz * (3 - 2 * fz);
  let r = 0;
  for (let dz = 0; dz < 2; dz++) for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++)
    r += hash3(xi + dx, yi + dy, zi + dz, seed) * (dx ? u : 1 - u) * (dy ? v : 1 - v) * (dz ? w : 1 - w);
  return r;
}
async function sphereNoise(W, H) {
  const bw = 1024, bh = 512, g = Buffer.alloc(bw * bh);
  for (let y = 0; y < bh; y++) {
    const lat = Math.PI / 2 - ((y + 0.5) / bh) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
    for (let x = 0; x < bw; x++) {
      const lon = ((x + 0.5) / bw) * 2 * Math.PI - Math.PI;
      const dx = cl * Math.cos(lon), dy = cl * Math.sin(lon), dz = sl;
      let n = 0, a = 0.5, fr = 2.5, tot = 0;
      for (let o = 0; o < 4; o++) { n += a * vnoise(dx * fr + 11, dy * fr + 7, dz * fr + 3, 5 + o); tot += a; a *= 0.55; fr *= 2.1; }
      g[y * bw + x] = Math.round(Math.min(1, Math.max(0, (n / tot - 0.5) * 2.4 + 0.5)) * 255);
    }
  }
  const o = await sharp(g, { raw: { width: bw, height: bh, channels: 1 } }).resize(W, H, { kernel: 'cubic' }).raw().toBuffer({ resolveWithObject: true });
  const out = Buffer.alloc(W * H); for (let i = 0; i < out.length; i++) out[i] = o.data[i * o.info.channels]; return out;
}

/** Smooth continuation of the observed colours into the unimaged area (normalised blur, sigma EXT_DEG), as RGB at W x H. */
const EXT_DEG = 14;
async function extension(src, W, H, mean) {
  const bw = 1024, bh = 512;
  const mk = await sharp(keep('coverage_2k.png')).removeAlpha().greyscale().resize(bw, bh, { kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  const m1 = Buffer.alloc(bw * bh); for (let i = 0; i < m1.length; i++) m1[i] = mk.data[i * mk.info.channels];
  const im = await sharp(src.data, { raw: { width: src.width, height: src.height, channels: 3 } }).resize(bw, bh, { kernel: 'lanczos3' }).raw().toBuffer();
  const N = bw * bh;
  // premultiplied rgb + mask as float, blurred separably with wrap (box approximations via 3 passes, done directly in JS)
  const planes = [new Float32Array(N), new Float32Array(N), new Float32Array(N), new Float32Array(N)];
  for (let i = 0; i < N; i++) { const m = m1[i] > 127 ? 1 : 0; planes[0][i] = im[3 * i] * m; planes[1][i] = im[3 * i + 1] * m; planes[2][i] = im[3 * i + 2] * m; planes[3][i] = m; }
  const sigma = (EXT_DEG / 360) * bw, r = Math.max(2, Math.round(sigma * 0.9));
  const tmp = new Float32Array(N);
  const boxX = (a) => { for (let y = 0; y < bh; y++) { const row = y * bw; let acc = 0; for (let k = -r; k <= r; k++) acc += a[row + ((k % bw) + bw) % bw]; for (let x = 0; x < bw; x++) { tmp[row + x] = acc / (2 * r + 1); acc += a[row + ((x + r + 1) % bw)] - a[row + ((x - r + bw * 4) % bw)]; } } a.set(tmp); };
  const boxY = (a) => { for (let x = 0; x < bw; x++) { for (let y = 0; y < bh; y++) { let acc = 0; for (let k = -r; k <= r; k++) acc += a[Math.min(bh - 1, Math.max(0, y + k)) * bw + x]; tmp[y * bw + x] = acc / (2 * r + 1); } } a.set(tmp); };
  for (const p of planes) for (let it = 0; it < 3; it++) { boxX(p); boxY(p); }
  const ext = Buffer.alloc(N * 3);
  const eps = 0.04;
  for (let i = 0; i < N; i++) {
    const wgt = planes[3][i];
    for (let c = 0; c < 3; c++) ext[3 * i + c] = Math.round((planes[c][i] + mean[c] * eps) / (wgt + eps));
  }
  return sharp(ext, { raw: { width: bw, height: bh, channels: 3 } }).resize(W, H, { kernel: 'cubic' }).raw().toBuffer();
}

async function rebuildColor(name) {
  const src = await readRgb(keep(name));
  const w8 = await softMask(src.width, src.height);
  const d = src.data;
  // flat fill colour = the unimaged pole region of the original (top rows)
  let fr = 0, fg = 0, fb = 0, n = 0;
  for (let y = 4; y < 24; y++) for (let x = 0; x < src.width; x += 7) { const i = (y * src.width + x) * 3; fr += d[i]; fg += d[i + 1]; fb += d[i + 2]; n++; }
  fr /= n; fg /= n; fb /= n;
  const ext = await extension(src, src.width, src.height, [fr, fg, fb]);
  const nz = await sphereNoise(src.width, src.height);
  const out = Buffer.alloc(d.length);
  for (let p = 0; p < src.width * src.height; p++) {
    const w = w8[p] / 255, i = p * 3;
    const mot = 1 + 0.16 * (nz[p] / 255 - 0.5) * 2 * (1 - w);   // faint mottled albedo in the unimaged fill only
    out[i] = d[i] * w + ext[i] * mot * (1 - w);
    out[i + 1] = d[i + 1] * w + ext[i + 1] * mot * (1 - w);
    out[i + 2] = d[i + 2] * w + ext[i + 2] * mot * (1 - w);
  }
  await sharp(out, { raw: { width: src.width, height: src.height, channels: 3 } }).jpeg({ quality: name.includes('8k') ? 90 : 92, chromaSubsampling: '4:4:4', mozjpeg: true }).toFile(path.join(TEX, name + '.tmp'));
  fs.copyFileSync(path.join(TEX, name + ".tmp"), path.join(TEX, name)); fs.unlinkSync(path.join(TEX, name + ".tmp"));
  log(name, src.width + 'x' + src.height, 'fill', [fr, fg, fb].map(Math.round).join(','));
}

for (const f of ['color_8k.jpg', 'color_4k.jpg', 'color_1k.jpg']) await rebuildColor(f);
// soft coverage masks (8-bit, linear)
for (const [f, W, H] of [['coverage_2k.png', 2048, 1024], ['coverage_1k.png', 1024, 512]]) {
  const m = await softMask(W, H);
  await sharp(m, { raw: { width: W, height: H, channels: 1 } }).png().toFile(path.join(TEX, f + '.tmp'));
  fs.copyFileSync(path.join(TEX, f + ".tmp"), path.join(TEX, f)); fs.unlinkSync(path.join(TEX, f + ".tmp"));
  log(f);
}
