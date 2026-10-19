// Shared helpers for the textures-hd build (raw I/O, sRGB maths, DEM -> normal map).
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const sharp = require('sharp');
export const ROOT = path.resolve(import.meta.dirname, '..', '..', '..');
export const RAW = path.join(ROOT, 'data-raw', 'textures-hd');
export const TEX = path.join(ROOT, 'public', 'textures');
export const rel = (p) => path.relative(path.join(ROOT, 'public'), p).split(path.sep).join('/');
export const log = (...a) => console.log(...a);

const S2L = new Float32Array(256);
for (let i = 0; i < 256; i++) { const c = i / 255; S2L[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
export const srgbToLinearLut = S2L;
const L2S_N = 16384;
const L2S = new Uint8Array(L2S_N + 1);
for (let i = 0; i <= L2S_N; i++) { const l = i / L2S_N; const c = l <= 0.0031308 ? 12.92 * l : 1.055 * l ** (1 / 2.4) - 0.055; L2S[i] = Math.round(Math.max(0, Math.min(1, c)) * 255); }
export const linearToSrgb8 = (l) => L2S[Math.max(0, Math.min(L2S_N, Math.round(l * L2S_N)))];

/** Decode any image to raw 8-bit RGB. */
export async function readRgb(file) {
  const { data, info } = await sharp(file, { limitInputPixels: false }).removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Mean linear Rec.709 luminance over latitudes |lat| <= maxLat (equal-area weights by cos(lat)). */
export function meanLinearLuma(img, maxLat = 60, minLat = 0) {
  const { data, width: W, height: H } = img;
  let sum = 0, wsum = 0;
  for (let y = 0; y < H; y++) {
    const lat = 90 - (180 * (y + 0.5)) / H;
    if (Math.abs(lat) > maxLat || Math.abs(lat) < minLat) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    let rs = 0;
    for (let x = 0; x < W; x++) { const i = (y * W + x) * 3; rs += 0.2126 * S2L[data[i]] + 0.7152 * S2L[data[i + 1]] + 0.0722 * S2L[data[i + 2]]; }
    sum += (rs / W) * w; wsum += w;
  }
  return sum / wsum;
}

/** In-place: desaturate in sRGB-encoded space (s<1 pulls toward luma), then scale linear light by gain. */
export function adjustRgb(img, { saturation = 1, gain = 1 }) {
  const d = img.data;
  for (let i = 0; i < d.length; i += 3) {
    let r = d[i], g = d[i + 1], b = d[i + 2];
    if (saturation !== 1) { const l = 0.2126 * r + 0.7152 * g + 0.0722 * b; r = l + saturation * (r - l); g = l + saturation * (g - l); b = l + saturation * (b - l); }
    const ri = Math.max(0, Math.min(255, Math.round(r))), gi = Math.max(0, Math.min(255, Math.round(g))), bi = Math.max(0, Math.min(255, Math.round(b)));
    d[i] = linearToSrgb8(S2L[ri] * gain); d[i + 1] = linearToSrgb8(S2L[gi] * gain); d[i + 2] = linearToSrgb8(S2L[bi] * gain);
  }
}

export async function writeJpeg(img, file, quality = 90) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } })
    .jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: '4:2:0' }).toFile(file);
  return fs.statSync(file).size;
}

/** Area-average downsample of a Float32 height grid (W0xH0 -> W1xH1), integer-ish box filter. */
export function downsample(h, W0, H0, W1, H1) {
  const out = new Float32Array(W1 * H1);
  for (let y = 0; y < H1; y++) {
    const y0 = Math.floor((y * H0) / H1), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * H0) / H1));
    for (let x = 0; x < W1; x++) {
      const x0 = Math.floor((x * W0) / W1), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * W0) / W1));
      let s = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) { const row = yy * W0; for (let xx = x0; xx < x1; xx++) { s += h[row + xx]; n++; } }
      out[y * W1 + x] = s / n;
    }
  }
  return out;
}

/**
 * Height (metres, equirectangular, x=0 at 180W, y=0 at 90N) -> tangent-space normal map (OpenGL: R=+east, G=+north, B=up).
 * Pixel spacing: east-west = R*cos(lat)*2pi/W (clamped near the poles), north-south = R*pi/H.
 * `exaggeration` multiplies slopes; per-pixel slope is soft-limited to maxSlope (tan) to avoid pole spikes.
 */
export function normalFromHeights(h, W, H, { radiusM, exaggeration = 1, maxSlope = 3 }) {
  const out = Buffer.alloc(W * H * 3);
  const dyM = (radiusM * Math.PI) / H;
  let maxS = 0;
  for (let y = 0; y < H; y++) {
    const lat = ((90 - (180 * (y + 0.5)) / H) * Math.PI) / 180;
    const dxM = Math.max((radiusM * Math.cos(lat) * 2 * Math.PI) / W, dyM * 0.15);
    const ym = Math.max(0, y - 1), yp = Math.min(H - 1, y + 1);
    for (let x = 0; x < W; x++) {
      const xm = (x - 1 + W) % W, xp = (x + 1) % W;
      let gx = ((h[y * W + xp] - h[y * W + xm]) / (2 * dxM)) * exaggeration;
      let gy = ((h[ym * W + x] - h[yp * W + x]) / ((yp - ym) * dyM)) * exaggeration; // + toward north
      const m = Math.hypot(gx, gy);
      if (m > maxS) maxS = m;
      if (m > maxSlope) { gx *= maxSlope / m; gy *= maxSlope / m; }
      let nx = -gx, ny = -gy, nz = 1;
      const inv = 1 / Math.hypot(nx, ny, nz);
      const o = (y * W + x) * 3;
      out[o] = Math.round((nx * inv * 0.5 + 0.5) * 255); out[o + 1] = Math.round((ny * inv * 0.5 + 0.5) * 255); out[o + 2] = Math.round((nz * inv * 0.5 + 0.5) * 255);
    }
  }
  return { data: out, maxSlope: maxS };
}

export async function writeNormalPng(data, W, H, file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await sharp(data, { raw: { width: W, height: H, channels: 3 } }).png({ compressionLevel: 9, effort: 10 }).toFile(file);
  return fs.statSync(file).size;
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Blend `fill` into `base` poleward of lat0..lat1 (feathered). `fill` is gain-matched to `base` over a reference band first. */
export function blendPoles(base, fill, { lat0 = 63, lat1 = 71, refBand = [48, 60], fillSaturation = 1 } = {}) {
  if (fillSaturation !== 1) adjustRgb(fill, { saturation: fillSaturation, gain: 1 });
  const gain = meanLinearLuma(base, refBand[1], refBand[0]) / meanLinearLuma(fill, refBand[1], refBand[0]);
  adjustRgb(fill, { saturation: 1, gain });
  const { data: b, width: W, height: H } = base, f = fill.data;
  for (let y = 0; y < H; y++) {
    const lat = Math.abs(90 - (180 * (y + 0.5)) / H);
    const w = smooth(lat0, lat1, lat);
    if (w === 0) continue;
    for (let i = y * W * 3, e = i + W * 3; i < e; i++) b[i] = Math.round(b[i] * (1 - w) + f[i] * w);
  }
  return gain;
}
