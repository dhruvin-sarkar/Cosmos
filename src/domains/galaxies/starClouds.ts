/**
 * Hero-galaxy star clouds: up close (within a few disc radii) the image impostor of M31, M33, the LMC and the SMC
 * hands over to a 3-D particle disc built from the same observed image. Image pixels are importance-sampled by
 * luminance and each sample is placed where its sight line from Earth meets the catalogued disc plane, so from
 * Earth the cloud reproduces the photograph; from elsewhere it shows the disc's real orientation, thickness and a
 * bulge. Each particle carries an equal share of the image's light, calibrated so the cloud's surface brightness
 * matches the impostor it replaces (constant surface brightness: per-particle flux ∝ 1/d²).
 * Vertical structure (disc scale height, bulge) is a model — disclosed as 'reconstructed' in the FactSheet text.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import type { V3 } from './math';

export interface CloudSampleInput {
  /** Linear-light RGB, row 0 at the top (north up, east left), width × height. */
  rgb: Float32Array;
  width: number;
  height: number;
  /** Galaxy centre (Mpc from the Sun), disc normal (unit), disc half-extent (Mpc), image full width (rad). */
  center: V3;
  normal: V3;
  radiusMpc: number;
  fovRad: number;
  count: number;
  /** Deterministic RNG in [0, 1). */
  rand: () => number;
}

export interface CloudSamples {
  /** xyz (Mpc) per particle. */
  positions: Float32Array;
  /** Chromaticity (rgb / luminance, capped) per particle. */
  colors: Float32Array;
  /** Sum of image luminance (the cloud's total light, in image units). */
  sumLum: number;
  count: number;
}

const LUM = [0.2126, 0.7152, 0.0722] as const;

/** Pure sampler (tested): pixel CDF by luminance → sight line → disc plane, plus a Gaussian vertical offset. */
export function sampleCloud(inp: CloudSampleInput): CloudSamples {
  const { rgb, width: W, height: H, center: C, normal: N, radiusMpc: R, fovRad, count, rand } = inp;
  const n = W * H;
  const cdf = new Float64Array(n);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, rgb[i * 3] * LUM[0] + rgb[i * 3 + 1] * LUM[1] + rgb[i * 3 + 2] * LUM[2]);
  // Residual sky noise below ~2% of the peak would scatter lone particles across the window: drop it (its light is
  // a few per cent of the total and stays in sumLum's calibration below).
  const floor = 0.02 * peak;
  let acc = 0, total = 0;
  for (let i = 0; i < n; i++) {
    const L = rgb[i * 3] * LUM[0] + rgb[i * 3 + 1] * LUM[1] + rgb[i * 3 + 2] * LUM[2];
    total += Math.max(0, L);
    acc += Math.max(0, L - floor);
    cdf[i] = acc;
  }
  const cl = Math.hypot(C.x, C.y, C.z);
  const c = { x: C.x / cl, y: C.y / cl, z: C.z / cl };
  // Sky basis at the centre, as in ImpostorMaterial: e = normalize(z × c), n = c × e.
  const el = Math.hypot(c.y, c.x);
  const e = { x: -c.y / el, y: c.x / el, z: 0 };
  const nn = { x: c.y * e.z - c.z * e.y, y: c.z * e.x - c.x * e.z, z: c.x * e.y - c.y * e.x };
  const cn = C.x * N.x + C.y * N.y + C.z * N.z;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  let k = 0;
  for (let tries = 0; k < count && tries < count * 4; tries++) {
    const t = rand() * acc;
    let lo = 0, hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < t) lo = mid + 1; else hi = mid;
    }
    const px = (lo % W) + rand(), py = Math.floor(lo / W) + rand();
    // TAN plane coordinates (rad): east to the left, north up.
    const tx = (0.5 - px / W) * fovRad, ty = (0.5 - py / H) * fovRad;
    const sx = c.x + tx * e.x + ty * nn.x, sy = c.y + tx * e.y + ty * nn.y, sz = c.z + tx * e.z + ty * nn.z;
    const sn = sx * N.x + sy * N.y + sz * N.z;
    if (Math.abs(sn) < 1e-9) continue;
    const s = cn / sn;
    let x = sx * s, y = sy * s, z = sz * s;
    const r = Math.hypot(x - C.x, y - C.y, z - C.z);
    if (!(r < R * 1.15)) continue;
    // Vertical structure (model): thin disc ~1.2% of the window radius, thickening into a bulge near the centre.
    const h = R * (0.012 + 0.07 * Math.exp(-((r / (0.09 * R)) ** 2)));
    const g = Math.sqrt(-2 * Math.log(Math.max(rand(), 1e-12))) * Math.cos(2 * Math.PI * rand()) * h;
    x += N.x * g; y += N.y * g; z += N.z * g;
    positions[k * 3] = x; positions[k * 3 + 1] = y; positions[k * 3 + 2] = z;
    const r0 = rgb[lo * 3], g0 = rgb[lo * 3 + 1], b0 = rgb[lo * 3 + 2];
    const L = Math.max(r0 * LUM[0] + g0 * LUM[1] + b0 * LUM[2], 1e-6);
    // Faint pixels have noisy colour: blend them towards neutral.
    const sat = Math.min(1, L / (0.15 * peak));
    colors[k * 3] = 1 + (Math.min(r0 / L, 2.5) - 1) * sat;
    colors[k * 3 + 1] = 1 + (Math.min(g0 / L, 2.5) - 1) * sat;
    colors[k * 3 + 2] = 1 + (Math.min(b0 / L, 2.5) - 1) * sat;
    k++;
  }
  return { positions, colors, sumLum: total, count: k };
}

/** Footprint integral of exp(−4 r²) over a sprite of size S px (r ≤ 1 ↔ S/2 px): 0.771 (S/2)². */
const FOOTPRINT = 0.771 / 4;

export class StarCloudMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uCamMpc: { value: THREE.Vector3 };
    uScale: { value: number };
    uPxPerRad: { value: number };
    uPixelRatio: { value: number };
    /** Flux constant: per-particle flux (radiance · px²) = uK · pxPerRad² / d². */
    uK: { value: number };
    uOpacity: { value: number };
    /** Particle world diameter, Mpc. */
    uSizeMpc: { value: number };
  };

  constructor() {
    super({
      uniforms: {
        uCamMpc: { value: new THREE.Vector3() },
        uScale: { value: 1 },
        uPxPerRad: { value: 1000 },
        uPixelRatio: { value: 1 },
        uK: { value: 0 },
        uOpacity: { value: 0 },
        uSizeMpc: { value: 0.0002 },
      },
      vertexShader: /* glsl */ `
        ${VERTEX_PRELUDE}
        attribute vec3 aColor;
        uniform vec3 uCamMpc;
        uniform float uScale, uPxPerRad, uPixelRatio, uK, uOpacity, uSizeMpc;
        varying vec3 vColor;
        void main() {
          vec3 rel = position - uCamMpc;
          float d = max(length(rel), 1e-7);
          float size = clamp(uSizeMpc / d * uPxPerRad, 1.6, 14.0);
          float flux = uK * uPxPerRad * uPxPerRad / (d * d);
          float amp = flux / (${FOOTPRINT.toFixed(6)} * size * size) * uOpacity;
          vColor = aColor * amp;
          gl_PointSize = size * uPixelRatio;
          gl_Position = projectionMatrix * (viewMatrix * vec4(rel * uScale, 1.0));
          if (amp < 1e-6) gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          ${LOGDEPTH_VERTEX}
        }`,
      fragmentShader: /* glsl */ `
        ${FRAGMENT_PRELUDE}
        varying vec3 vColor;
        void main() {
          ${LOGDEPTH_FRAGMENT}
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float r2 = dot(p, p);
          if (r2 > 1.0) discard;
          gl_FragColor = vec4(vColor * exp(-4.0 * r2), 1.0);
        }`,
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: THREE.AdditiveBlending,
    });
  }
}

/** Decode an image URL to linear RGB floats (row 0 at the top). Browser only. */
export async function loadLinearImage(url: string, maxSize = 512): Promise<{ rgb: Float32Array; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const bmp = await createImageBitmap(await res.blob(), { resizeWidth: maxSize, resizeHeight: maxSize, resizeQuality: 'high' });
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('no 2d context');
  g.drawImage(bmp, 0, 0);
  bmp.close();
  const px = g.getImageData(0, 0, canvas.width, canvas.height).data;
  const lut = new Float32Array(256);
  for (let i = 0; i < 256; i++) { const v = i / 255; lut[i] = v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
  const n = canvas.width * canvas.height;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { rgb[i * 3] = lut[px[i * 4]]; rgb[i * 3 + 1] = lut[px[i * 4 + 1]]; rgb[i * 3 + 2] = lut[px[i * 4 + 2]]; }
  return { rgb, width: canvas.width, height: canvas.height };
}

/** Small deterministic PRNG (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
