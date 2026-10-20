/**
 * Pure pixel processing of the SDO browse images for sunImagery.ts (no DOM, no three.js), shared by the main
 * thread fallback and sunImagery.worker.ts.
 */
import { agxInverse, agxToneMap, type Rgb3 } from '../../render/tonemap';

export type Rgb = [number, number, number];

/** Relative-intensity map from an HMI continuum image (R8, row 0 = image bottom; mean = sRGB 0-1). */
export function processHmi(px: Uint8ClampedArray, w: number, h: number, rPxGuess: number): { data: Uint8Array; rPx: number; mean: Rgb } {
  const cx = w / 2, cy = h / 2;
  const nb = Math.ceil(Math.hypot(cx, cy)) + 1;
  const lum = new Float32Array(w * h);
  const sum = new Float64Array(nb), cnt = new Float64Array(nb);
  let mr = 0, mg = 0, mb = 0, mn = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const l = 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2];
      lum[y * w + x] = l;
      const r = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
      const b = Math.floor(r);
      sum[b] += l;
      cnt[b]++;
      if (r < rPxGuess * 0.5) { mr += px[i]; mg += px[i + 1]; mb += px[i + 2]; mn++; }
    }
  }
  // Two passes: plain mean, then a mean that ignores spots (< 85 % of the first estimate).
  const prof = new Float32Array(nb);
  for (let b = 0; b < nb; b++) prof[b] = cnt[b] ? sum[b] / cnt[b] : 0;
  sum.fill(0); cnt.fill(0);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const b = Math.floor(Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2));
    const l = lum[y * w + x];
    if (l > 0.85 * prof[b]) { sum[b] += l; cnt[b]++; }
  }
  for (let b = 0; b < nb; b++) if (cnt[b]) prof[b] = sum[b] / cnt[b];
  // Smooth the profile (3-bin box) and find the limb: last radius above 20 % of the centre level.
  const sm = new Float32Array(nb);
  for (let b = 0; b < nb; b++) sm[b] = (prof[Math.max(0, b - 1)] + prof[b] + prof[Math.min(nb - 1, b + 1)]) / 3;
  const centre = sm[2] || 1;
  let rPx = rPxGuess;
  for (let b = 10; b < nb; b++) if (sm[b] < 0.2 * centre) { rPx = b; break; }
  if (Math.abs(rPx - rPxGuess) > 0.08 * rPxGuess) rPx = rPxGuess;
  const data = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2);
    let rel = 1;
    if (r < rPx * 0.985) {
      const b = Math.floor(r);
      rel = lum[y * w + x] / Math.max(sm[b], 1);
    }
    // Store rel/1.5 so faculae (> 1) survive; flip so row 0 is the image bottom (texture v = 0).
    data[(h - 1 - y) * w + x] = Math.max(0, Math.min(255, Math.round((rel / 1.5) * 255)));
  }
  const mean: Rgb = [mr / mn / 255, mg / mn / 255, mb / mn / 255];
  return { data, rPx, mean };
}

/**
 * Scene-linear colour that AgX (exposure 1) maps to display-linear `t`. Starts from agxInverse and then lets the
 * two minor channels go slightly negative (a wide-gamut input; AgX's inset matrix keeps the working values
 * positive), because AgX's desaturating inset cannot reach saturated oranges/golds from non-negative input.
 */
export function agxInverseWide(t: Rgb3): Rgb3 {
  const v0 = agxInverse(t);
  const r0 = Math.max(v0.r, v0.g, v0.b, 1e-6);
  const p = [Math.log(r0), v0.r / r0, v0.g / r0, v0.b / r0];
  // Parameters: log scale m and the three channel fractions; the largest channel stays 1.
  const k = v0.r >= v0.g && v0.r >= v0.b ? 1 : v0.g >= v0.b ? 2 : 3;
  const free = [0, 1, 2, 3].filter((i) => i !== k);
  // Residuals in a gamma-encoded space, so dark channels (and AgX's clamp at 0) weigh as they do on screen.
  const g = (x: number): number => Math.pow(Math.max(x, 0), 1 / 2.2);
  const tg = [g(t.r), g(t.g), g(t.b)];
  const res = (q: number[]): number[] => {
    const m = Math.exp(q[0]);
    const o = agxToneMap({ r: m * q[1], g: m * q[2], b: m * q[3] });
    // A channel clamped at 0 has no gradient: keep the search out of that region when the target is not black.
    const z = (x: number, tc: number): number => (x <= 0 && tc > 1e-3 ? 1 : 0);
    return [g(o.r) - tg[0] - z(o.r, t.r), g(o.g) - tg[1] - z(o.g, t.g), g(o.b) - tg[2] - z(o.b, t.b)];
  };
  let lambda = 1e-3;
  let rr = res(p);
  let err = rr[0] ** 2 + rr[1] ** 2 + rr[2] ** 2;
  for (let iter = 0; iter < 60 && err > 1e-10; iter++) {
    const J = free.map((j) => {
      const q = p.slice();
      q[j] += 1e-5;
      const rp = res(q);
      return [(rp[0] - rr[0]) / 1e-5, (rp[1] - rr[1]) / 1e-5, (rp[2] - rr[2]) / 1e-5];
    });
    // 3×3 normal equations (JᵀJ + λ diag) d = −Jᵀr, solved by Cramer's rule.
    const A = [0, 1, 2].map((a) => [0, 1, 2].map((b) => J[a][0] * J[b][0] + J[a][1] * J[b][1] + J[a][2] * J[b][2]));
    for (let a = 0; a < 3; a++) A[a][a] *= 1 + lambda;
    const gr = [0, 1, 2].map((a) => -(J[a][0] * rr[0] + J[a][1] * rr[1] + J[a][2] * rr[2]));
    const det = (M: number[][]): number =>
      M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) - M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) + M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
    const D = det(A);
    if (!(Math.abs(D) > 1e-30)) break;
    const q = p.slice();
    for (let c = 0; c < 3; c++) {
      const Mc = A.map((row, a) => row.map((x, b) => (b === c ? gr[a] : x)));
      q[free[c]] += det(Mc) / D;
    }
    for (let c = 1; c < 4; c++) if (c !== k) q[c] = Math.min(1, Math.max(-0.35, q[c]));
    const rq = res(q);
    const eq = rq[0] ** 2 + rq[1] ** 2 + rq[2] ** 2;
    if (eq < err) {
      for (let i = 0; i < 4; i++) p[i] = q[i];
      rr = rq;
      err = eq;
      lambda *= 0.3;
    } else lambda *= 10;
  }
  const m = Math.exp(p[0]);
  return { r: m * p[1], g: m * p[2], b: m * p[3] };
}

const srgbToLinear = (c: number): number => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/**
 * AIA browse image → R8 index map (encoded luma, row 0 = image bottom) + colour LUT. The quick-look colourmaps are
 * one-dimensional, so binning pixels by luma recovers the colourmap; each level is then inverted through AgX.
 */
export function processAia(px: Uint8ClampedArray, w: number, h: number, rPx: number, captionRows: number): { data: Uint8Array; lut: Float32Array; mean: Rgb } {
  const cx = w / 2, cy = h / 2;
  const n = w * h;
  const idx = new Uint8Array(n);
  const sr = new Float64Array(256), sg = new Float64Array(256), sb = new Float64Array(256), sc = new Float64Array(256);
  const nb = Math.ceil(Math.hypot(cx, cy)) + 1;
  const ps = new Float64Array(nb), pc = new Float64Array(nb);
  const yCap = h - captionRows;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x, k = i * 4;
      const l = Math.round(0.2126 * px[k] + 0.7152 * px[k + 1] + 0.0722 * px[k + 2]);
      idx[i] = l;
      if (y >= yCap) continue;
      sr[l] += px[k]; sg[l] += px[k + 1]; sb[l] += px[k + 2]; sc[l]++;
      const b = Math.floor(Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2));
      ps[b] += l; pc[b]++;
    }
  }
  // Caption strip → the azimuthal mean at that radius (continuous with the surrounding off-limb glow).
  for (let y = yCap; y < h; y++) for (let x = 0; x < w; x++) {
    const b = Math.floor(Math.sqrt((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2));
    idx[y * w + x] = pc[b] ? Math.round(ps[b] / pc[b]) : 0;
  }
  // Colourmap per luma level; empty levels interpolated from their neighbours.
  const cm = new Float32Array(256 * 3);
  let last = -1;
  for (let l = 0; l < 256; l++) {
    if (sc[l] < 1) continue;
    cm[l * 3] = sr[l] / sc[l]; cm[l * 3 + 1] = sg[l] / sc[l]; cm[l * 3 + 2] = sb[l] / sc[l];
    for (let j = last + 1; j < l; j++) {
      const t = last < 0 ? 1 : (j - last) / (l - last);
      for (let c = 0; c < 3; c++) cm[j * 3 + c] = last < 0 ? (cm[l * 3 + c] * j) / Math.max(l, 1) : cm[last * 3 + c] * (1 - t) + cm[l * 3 + c] * t;
    }
    last = l;
  }
  for (let j = Math.max(last, 0) + 1; j < 256; j++) for (let c = 0; c < 3; c++) cm[j * 3 + c] = last < 0 ? j : cm[last * 3 + c];
  const lutF = new Float32Array(256 * 4);
  for (let l = 0; l < 256; l++) {
    const t = { r: srgbToLinear(cm[l * 3] / 255), g: srgbToLinear(cm[l * 3 + 1] / 255), b: srgbToLinear(cm[l * 3 + 2] / 255) };
    // Stay inside AgX's invertible range (pure white / black are clipped plateaus).
    const s = { r: Math.min(Math.max(t.r, 1e-5), 0.95), g: Math.min(Math.max(t.g, 1e-5), 0.95), b: Math.min(Math.max(t.b, 1e-5), 0.95) };
    const v = l === 0 ? { r: 0, g: 0, b: 0 } : agxInverseWide(s);
    lutF[l * 4] = v.r; lutF[l * 4 + 1] = v.g; lutF[l * 4 + 2] = v.b; lutF[l * 4 + 3] = 1;
  }
  // Flip (row 0 = image bottom) and take the mean LUT colour over the central disc.
  const data = new Uint8Array(n);
  let mr = 0, mg = 0, mb = 0, mn = 0;
  const r2 = (rPx * 0.7) ** 2;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const l = idx[y * w + x];
    data[(h - 1 - y) * w + x] = l;
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < r2) { mr += lutF[l * 4]; mg += lutF[l * 4 + 1]; mb += lutF[l * 4 + 2]; mn++; }
  }
  mn = Math.max(mn, 1);
  return { data, lut: lutF, mean: [mr / mn, mg / mn, mb / mn] };
}

