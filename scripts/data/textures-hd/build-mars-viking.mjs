// tex-planets: Mars 8k colour map from the USGS Viking Orbiter global colour mosaic (public domain), re-graded to true colour.
//   source: USGS Astrogeology "Mars Viking Colorized Mosaic Global 925 m" (Mars_Viking_ClrMosaic_global_925m.tif, 23059 x 11530,
//   simple cylindrical, x = 0 at 180 W like the app convention - verified against Olympus Mons 134 W and Syrtis Major 70 E).
// The Viking colour product is a stretched three-filter composite with a violet cast in dark terrain. We keep its measured
// brightness (albedo) and its redness (dust cover) and replace the absolute colour with the true-colour dark-basalt -> bright-dust
// ramp seen in HST/MER colour data. Poleward of ~78 deg (mosaic gaps/streaks) the previous Solar System Scope map is blended in.
//   node scripts/data/textures-hd/build-mars-viking.mjs [--stats]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, RAW, TEX, rel, log, sharp, readRgb, meanLinearLuma, adjustRgb, writeJpeg, blendPoles, srgbToLinearLut as S2L, linearToSrgb8 } from './lib.mjs';

const SRC = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'mars', 'Mars_Viking_ClrMosaic_global_925m.tif');
const SSS_BACKUP = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'mars', 'color_8k_sss.jpg');
const OUT = path.join(TEX, 'mars', 'color_8k.jpg');
const W = 8192, H = 4096;
const TARGET = 0.18; // Mars mean albedo away from caps (Mallama 2007), as in build-color.mjs

if (!fs.existsSync(SSS_BACKUP)) fs.copyFileSync(OUT, SSS_BACKUP); // keep the previous map once (it is the pole fill)

const { data: raw } = await sharp(SRC, { limitInputPixels: false }).removeAlpha().resize(W, H, { kernel: 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
const N = W * H;
// per-pixel luminance + redness from Viking (linear)
const Y = new Float32Array(N), R = new Float32Array(N);
for (let p = 0, i = 0; p < N; p++, i += 3) {
  const r = S2L[raw[i]], g = S2L[raw[i + 1]], b = S2L[raw[i + 2]];
  Y[p] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  R[p] = r / Math.max(1e-4, g * 0.5 + b * 0.5); // red over blue-green mean
}
// percentiles over the non-polar band
const sample = (a) => { const s = []; for (let y = Math.floor(H * 0.2); y < Math.floor(H * 0.8); y += 4) for (let x = 0; x < W; x += 4) s.push(a[y * W + x]); s.sort((m, n) => m - n); return (q) => s[Math.floor(q * (s.length - 1))]; };
const qY = sample(Y), qR = sample(R);
log('Y p2/p10/p50/p90/p98', [0.02, 0.1, 0.5, 0.9, 0.98].map((q) => qY(q).toFixed(4)).join(' '), ' R', [0.02, 0.1, 0.5, 0.9, 0.98].map((q) => qR(q).toFixed(3)).join(' '));
if (process.argv.includes('--stats')) process.exit(0);

const y0 = qY(0.04), y1 = qY(0.96), r0 = qR(0.04), r1 = qR(0.96);
const sm = (t) => { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2 * t); };
// true-colour chroma ramp (linear RGB, normalised to luminance 1): dark basalt (grey-brown) -> bright dust (butterscotch-orange)
const DARK = [1.52, 0.90, 0.64], BRIGHT = [1.86, 0.80, 0.33];
const norm = (c) => { const l = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; return c.map((v) => v / l); };
const ymed = qY(0.5);
const D = norm(DARK), B = norm(BRIGHT);
// gamma on the luminance so the dark maria keep detail without crushing (Viking stretch is slightly flat)
const out = Buffer.alloc(N * 3);
for (let p = 0, i = 0; p < N; p++, i += 3) {
  const s = 0.55 * sm((Y[p] - y0) / (y1 - y0)) + 0.45 * sm((R[p] - r0) / (r1 - r0));
  const y = ymed * (Y[p] / ymed) ** 1.2; // mild contrast stretch around the median (Viking stretch is flat)
  out[i] = linearToSrgb8(y * (D[0] + (B[0] - D[0]) * s));
  out[i + 1] = linearToSrgb8(y * (D[1] + (B[1] - D[1]) * s));
  out[i + 2] = linearToSrgb8(y * (D[2] + (B[2] - D[2]) * s));
}
const img = { data: out, width: W, height: H };
// poles: previous map (desaturated to match) beyond ~78 deg
const fill = await readRgb(SSS_BACKUP);
log('pole fill gain', blendPoles(img, fill, { lat0: 76, lat1: 82, refBand: [55, 70], fillSaturation: 0.5 }).toFixed(3));
const before = meanLinearLuma(img);
const gain = TARGET / before;
adjustRgb(img, { saturation: 1, gain });
const after = meanLinearLuma(img);
const bytes = await writeJpeg(img, OUT, 92);
log('mars viking', JSON.stringify({ bytes, before: +before.toFixed(3), gain: +gain.toFixed(3), after: +after.toFixed(3) }));
await sharp(OUT).resize(1024, 512).png().toFile(path.join(ROOT, '.work', 'shots', 'tex-planets', 'mars_viking_new.png'));
