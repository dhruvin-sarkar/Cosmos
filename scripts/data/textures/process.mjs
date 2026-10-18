// Image-processing helpers for the textures domain (sharp + typed arrays).
// Output convention for every map (see docs/data/textures.md):
//   equirectangular 2:1, x = 0 at longitude -180 (180W), x increasing EASTWARD, x = W/2 at 0 deg,
//   y = 0 at +90 latitude. Pixel centres: lon = -180 + 360*(x+0.5)/W, lat = 90 - 180*(y+0.5)/H.
import fs from 'node:fs';
import path from 'node:path';
import { sharp, mkdirp, log, fail } from './lib.mjs';

export const JPEG_OPTS = { quality: 86, mozjpeg: true, chromaSubsampling: '4:2:0' };
export const PNG_OPTS = { compressionLevel: 9, adaptiveFiltering: true, effort: 10 };

/** Decode any input to raw interleaved 8-bit pixels (optionally forcing channel count). */
export async function toRaw(input, { channels } = {}) {
  let s = sharp(input, { limitInputPixels: false });
  if (channels === 1) s = s.toColourspace('b-w');
  else if (channels === 3) s = s.toColourspace('srgb').removeAlpha();
  else if (channels === 4) s = s.toColourspace('srgb').ensureAlpha();
  const { data, info } = await s.raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height, channels: info.channels };
}
export function rawToSharp({ data, width, height, channels }) {
  return sharp(data, { raw: { width, height, channels }, limitInputPixels: false });
}

/**
 * Shift an equirectangular image horizontally by `shiftPx` pixels (wrap-around).
 * Used to convert maps whose left edge is at 0 deg (0..360) to the -180..180 convention:
 * shiftPx = W/2. Positive shift moves content to the right.
 */
export function rollX(img, shiftPx) {
  const { data, width, height, channels } = img;
  const s = ((Math.round(shiftPx) % width) + width) % width;
  if (s === 0) return img;
  const out = Buffer.allocUnsafe(data.length);
  const row = width * channels;
  for (let y = 0; y < height; y++) {
    const o = y * row;
    data.copy(out, o + s * channels, o, o + (width - s) * channels);
    data.copy(out, o, o + (width - s) * channels, o + row);
  }
  return { data: out, width, height, channels };
}
/** Mirror horizontally (for west-positive maps drawn with longitude increasing to the right). */
export function flipX(img) {
  const { data, width, height, channels } = img;
  const out = Buffer.allocUnsafe(data.length);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const a = (y * width + x) * channels, b = (y * width + (width - 1 - x)) * channels;
    for (let c = 0; c < channels; c++) out[b + c] = data[a + c];
  }
  return { data: out, width, height, channels };
}

/**
 * Encode one image to several sizes. `variants`: [{file, width, height, format:'jpeg'|'png'|'webp', grey?:bool, lossless?:bool}]
 * Returns [{file, width, height, bytes}].
 */
export async function writeVariants(src, variants) {
  const out = [];
  for (const v of variants) {
    mkdirp(path.dirname(v.file));
    let s = (src.data ? rawToSharp(src) : sharp(src, { limitInputPixels: false }));
    s = s.resize(v.width, v.height, { fit: 'fill', kernel: 'lanczos3' });
    if (v.grey) s = s.toColourspace('b-w');
    else if (v.format === 'jpeg') s = s.toColourspace('srgb');
    if (v.format === 'jpeg') s = s.removeAlpha().jpeg(JPEG_OPTS);
    else if (v.format === 'png') s = s.png(PNG_OPTS);
    else if (v.format === 'webp') s = s.webp(v.lossless ? { lossless: true, effort: 6 } : { quality: 86, effort: 6 });
    else fail(`unknown format ${v.format}`);
    await s.toFile(v.file);
    const m = await sharp(v.file).metadata();
    if (m.width !== v.width || m.height !== v.height) fail(`size mismatch writing ${v.file}: ${m.width}x${m.height}`);
    const bytes = fs.statSync(v.file).size;
    out.push({ file: v.file, width: v.width, height: v.height, bytes, channels: m.channels, format: m.format });
    log(`  wrote ${path.basename(path.dirname(v.file))}/${path.basename(v.file)} ${v.width}x${v.height} ${(bytes / 2 ** 20).toFixed(2)} MB`);
  }
  return out;
}

// ---------------------------------------------------------------- no-data fill (pull-push)
/**
 * Fill pixels whose alpha < 128 by pull-push (mip-pyramid) interpolation with horizontal wrap.
 * Returns {img: RGB raw, coverage: Uint8Array(1 = observed), observedFraction}.
 * The filled area is smooth and featureless by construction (documented as illustrative fill).
 */
export function pullPushFill(rgba) {
  const { data, width: W, height: H } = rgba;
  if (rgba.channels !== 4) fail('pullPushFill needs RGBA input');
  const levels = [];
  let w = W, h = H;
  let C = new Float32Array(W * H * 3), Wt = new Float32Array(W * H);
  const coverage = new Uint8Array(W * H);
  let observed = 0;
  for (let i = 0; i < W * H; i++) {
    const a = data[i * 4 + 3] >= 128 ? 1 : 0;
    coverage[i] = a; observed += a;
    Wt[i] = a;
    for (let c = 0; c < 3; c++) C[i * 3 + c] = data[i * 4 + c] * a;
  }
  levels.push({ w, h, C, Wt });
  // pull: build pyramid of premultiplied colour / weight
  while (w > 1 || h > 1) {
    const nw = Math.max(1, Math.ceil(w / 2)), nh = Math.max(1, Math.ceil(h / 2));
    const nC = new Float32Array(nw * nh * 3), nW = new Float32Array(nw * nh);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      let sw = 0; const sc = [0, 0, 0];
      for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
        const sx = Math.min(w - 1, 2 * x + dx), sy = Math.min(h - 1, 2 * y + dy), si = sy * w + sx;
        sw += Wt[si]; sc[0] += C[si * 3]; sc[1] += C[si * 3 + 1]; sc[2] += C[si * 3 + 2];
      }
      const di = y * nw + x;
      // keep premultiplied colour normalised so that weight is capped at 1
      if (sw > 0) { const k = Math.min(1, sw) / sw; nC[di * 3] = sc[0] * k; nC[di * 3 + 1] = sc[1] * k; nC[di * 3 + 2] = sc[2] * k; }
      nW[di] = Math.min(1, sw);
    }
    w = nw; h = nh; C = nC; Wt = nW;
    levels.push({ w, h, C, Wt });
  }
  // push: fill from coarse to fine (bilinear upsample, horizontal wrap)
  for (let k = levels.length - 2; k >= 0; k--) {
    const L = levels[k], U = levels[k + 1];
    for (let y = 0; y < L.h; y++) {
      const fy = Math.min(U.h - 1, Math.max(0, (y + 0.5) / 2 - 0.5));
      const y0 = Math.floor(fy), y1 = Math.min(U.h - 1, y0 + 1), ty = fy - y0;
      for (let x = 0; x < L.w; x++) {
        const i = y * L.w + x, wt = L.Wt[i];
        if (wt >= 1) continue;
        let fx = (x + 0.5) / 2 - 0.5;
        const x0r = Math.floor(fx), tx = fx - x0r;
        const x0 = ((x0r % U.w) + U.w) % U.w, x1 = (x0 + 1) % U.w;
        for (let c = 0; c < 3; c++) {
          // U.C is premultiplied with U.Wt (which is 1 after its own push)
          const v00 = U.C[(y0 * U.w + x0) * 3 + c], v01 = U.C[(y0 * U.w + x1) * 3 + c];
          const v10 = U.C[(y1 * U.w + x0) * 3 + c], v11 = U.C[(y1 * U.w + x1) * 3 + c];
          const up = (v00 * (1 - tx) + v01 * tx) * (1 - ty) + (v10 * (1 - tx) + v11 * tx) * ty;
          L.C[i * 3 + c] = L.C[i * 3 + c] + (1 - wt) * up;
        }
        L.Wt[i] = 1;
      }
    }
  }
  const out = Buffer.allocUnsafe(W * H * 3);
  const C0 = levels[0].C;
  for (let i = 0; i < W * H * 3; i++) out[i] = Math.max(0, Math.min(255, Math.round(C0[i])));
  return { img: { data: out, width: W, height: H, channels: 3 }, coverage, observedFraction: observed / (W * H) };
}

// ---------------------------------------------------------------- normal maps from elevation
/**
 * Tangent-space normal map (OpenGL / three.js convention: R = +east (+u), G = +north (+v up), B = up)
 * from an elevation grid in metres on a sphere of radius `radiusM`.
 * `exaggeration` multiplies slopes before normalisation (documented; app can undo with normalScale = 1/exaggeration).
 * `flatMask` (optional Float32Array 0..1): 1 = force flat (e.g. water surface).
 */
export function normalMapFromHeights(heights, W, H, { radiusM, exaggeration = 1, flatMask = null }) {
  const out = Buffer.allocUnsafe(W * H * 3);
  const dLon = (2 * Math.PI) / W, dLat = Math.PI / H;
  let maxSlope = 0;
  for (let y = 0; y < H; y++) {
    const lat = Math.PI / 2 - (y + 0.5) * dLat;
    const cosLat = Math.max(0.01, Math.cos(lat));
    const dxM = 2 * radiusM * cosLat * dLon, dyM = 2 * radiusM * dLat;
    const yN = Math.max(0, y - 1), yS = Math.min(H - 1, y + 1);
    const dyEff = dyM * ((yS - yN) / 2);
    for (let x = 0; x < W; x++) {
      const xE = (x + 1) % W, xW = (x - 1 + W) % W;
      const i = y * W + x;
      let sx = (heights[y * W + xE] - heights[y * W + xW]) / dxM; // dh/d(east)
      let sy = (heights[yN * W + x] - heights[yS * W + x]) / dyEff; // dh/d(north)
      if (flatMask) { const f = 1 - flatMask[i]; sx *= f; sy *= f; }
      sx *= exaggeration; sy *= exaggeration;
      const m = Math.hypot(sx, sy); if (m > maxSlope) maxSlope = m;
      const inv = 1 / Math.sqrt(sx * sx + sy * sy + 1);
      out[i * 3] = Math.round((-sx * inv * 0.5 + 0.5) * 255);
      out[i * 3 + 1] = Math.round((-sy * inv * 0.5 + 0.5) * 255);
      out[i * 3 + 2] = Math.round((inv * 0.5 + 0.5) * 255);
    }
  }
  return { img: { data: out, width: W, height: H, channels: 3 }, maxSlope };
}

/** Read a single-band DEM (uint16 or float32 TIFF) resampled to W x H; returns Float32Array (raw units). */
export async function readDem(file, W, H, { kind }) {
  let s = sharp(file, { limitInputPixels: false, unlimited: true });
  if (kind === 'uint16') {
    const { data, info } = await s.resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).toColourspace('grey16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) fail(`DEM ${file} decoded with ${info.channels} channels`);
    const u = new Uint16Array(data.buffer, data.byteOffset, data.length / 2);
    return Float32Array.from(u);
  }
  if (kind === 'float32') {
    const { data, info } = await s.extractChannel(0).resize(W, H, { fit: 'fill', kernel: 'lanczos3' }).raw({ depth: 'float' }).toBuffer({ resolveWithObject: true });
    if (info.channels !== 1) fail(`DEM ${file} decoded with ${info.channels} channels`);
    return new Float32Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
  }
  fail(`unknown DEM kind ${kind}`);
}

// ---------------------------------------------------------------- polygon rasterisation (GeoJSON lon/lat -> mask)
/**
 * Rasterise GeoJSON (Multi)Polygons into a Uint8Array mask (value `val`) using the even-odd rule per polygon
 * with an active-edge scanline fill. Grid: W x H equirectangular, pixel centres as in the module header.
 * mode: 'set' (OR) or 'clear' (AND NOT).
 */
export function rasterizeGeoJSON(geojson, mask, W, H, { mode = 'set' } = {}) {
  const feats = geojson.type === 'FeatureCollection' ? geojson.features : [geojson];
  let polys = 0;
  for (const f of feats) {
    const g = f.geometry || f;
    if (!g) continue;
    const parts = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    for (const rings of parts) { fillPolygon(rings, mask, W, H, mode); polys++; }
  }
  return polys;
}
function fillPolygon(rings, mask, W, H, mode) {
  const edges = []; // [ymin, ymax, xAtYmin, dxdy] in pixel units
  for (const ring of rings) {
    for (let i = 0, n = ring.length; i < n; i++) {
      const a = ring[i], b = ring[(i + 1) % n];
      const x0 = ((a[0] + 180) / 360) * W, y0 = ((90 - a[1]) / 180) * H;
      const x1 = ((b[0] + 180) / 360) * W, y1 = ((90 - b[1]) / 180) * H;
      if (y0 === y1) continue;
      const [ya, yb, xa, xb] = y0 < y1 ? [y0, y1, x0, x1] : [y1, y0, x1, x0];
      edges.push([ya, yb, xa, (xb - xa) / (yb - ya)]);
    }
  }
  if (!edges.length) return;
  edges.sort((p, q) => p[0] - q[0]);
  let ei = 0; const active = [];
  const yStart = Math.max(0, Math.floor(edges[0][0] - 0.5));
  for (let y = yStart; y < H; y++) {
    const yc = y + 0.5;
    while (ei < edges.length && edges[ei][0] <= yc) active.push(edges[ei++]);
    if (!active.length && ei >= edges.length) break;
    const xs = [];
    for (let k = active.length - 1; k >= 0; k--) {
      const e = active[k];
      if (e[1] <= yc) { active.splice(k, 1); continue; }
      if (e[0] <= yc) xs.push(e[2] + (yc - e[0]) * e[3]);
    }
    if (xs.length < 2) continue;
    xs.sort((p, q) => p - q);
    const row = y * W;
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5)), xb = Math.min(W - 1, Math.floor(xs[k + 1] - 0.5));
      // spans from one polygon (all rings together) are disjoint under even-odd pairing -> plain set/clear (OR / AND NOT across polygons)
      const v = mode === 'set' ? 1 : 0;
      for (let x = xa; x <= xb; x++) mask[row + x] = v;
    }
  }
}
