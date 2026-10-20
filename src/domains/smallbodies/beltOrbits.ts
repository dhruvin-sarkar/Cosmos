/**
 * Belt-rock orbit table: per-row Kepler elements and class/size, precomputed once from data/solar/asteroids.bin.
 * Pure (no three.js) so it can run in beltOrbits.worker.ts (a ~130 ms main-thread task on the first belt approach).
 */
import { DEG } from '../../core/units';

export const GAUSS_K = 0.01720209895;

/** Geometric albedo (V) and linear reflectance colour per illustrative class. Sources: DeMeo & Carry 2013/2014; Mainzer et al. 2011 (NEOWISE). */
export const CLASS_COLOR: Record<'C' | 'S' | 'X' | 'V' | 'D' | 'B', { pV: number; rgb: [number, number, number] }> = {
  C: { pV: 0.06, rgb: [0.058, 0.055, 0.051] },
  S: { pV: 0.25, rgb: [0.27, 0.225, 0.17] },
  X: { pV: 0.16, rgb: [0.16, 0.152, 0.145] },
  V: { pV: 0.38, rgb: [0.42, 0.39, 0.33] },
  D: { pV: 0.06, rgb: [0.074, 0.056, 0.044] },
  B: { pV: 0.07, rgb: [0.066, 0.07, 0.078] },
};
export type RockClass = keyof typeof CLASS_COLOR;
export const CLASS_NAMES = Object.keys(CLASS_COLOR) as RockClass[];

/** Taxonomic mix (by mass/number of bright objects) as a function of semi-major axis — DeMeo & Carry 2014, Fig. 4 (simplified). */
export function classFor(aAU: number, u: number): RockClass {
  const pick = (t: [RockClass, number][]): RockClass => {
    let acc = 0;
    for (const [c, p] of t) { acc += p; if (u < acc) return c; }
    return t[t.length - 1][0];
  };
  if (aAU < 2.5) return pick([['S', 0.58], ['V', 0.1], ['X', 0.14], ['C', 0.18]]);
  if (aAU < 2.82) return pick([['S', 0.4], ['C', 0.36], ['X', 0.19], ['B', 0.05]]);
  if (aAU < 3.3) return pick([['C', 0.56], ['S', 0.18], ['X', 0.16], ['B', 0.1]]);
  if (aAU < 4.6) return pick([['D', 0.42], ['C', 0.38], ['X', 0.2]]);
  return pick([['D', 0.72], ['C', 0.18], ['X', 0.1]]);
}

export function hashU(i: number, salt: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(salt + 0x27d4eb2f, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

export interface Orbits {
  n: number;
  a: Float64Array;
  e: Float64Array;
  mm: Float64Array; // mean motion rad/day
  m0: Float64Array;
  ep: Float64Array; // epoch offset, days
  pq: Float64Array; // P (3) and Q·b/a (3), ICRS
  qA: Float32Array; // perihelion AU
  varpi: Float32Array; // ecliptic longitude of perihelion Ω+ω, rad (mean longitude = varpi + M)
  lonTol: Float32Array; // bound on |true ecliptic longitude − mean longitude|, rad (> π: no longitude prefilter)
  QA: Float32Array; // aphelion AU
  zA: Float32Array; // max |ecliptic z|, AU
  rM: Float32Array; // radius from H, m
  cls: Uint8Array;
}

export function buildOrbits(f: Float32Array, count: number, stride: number): Orbits {
  const o: Orbits = {
    n: count, a: new Float64Array(count), e: new Float64Array(count), mm: new Float64Array(count), m0: new Float64Array(count),
    ep: new Float64Array(count), pq: new Float64Array(count * 6), qA: new Float32Array(count),
    varpi: new Float32Array(count), lonTol: new Float32Array(count), QA: new Float32Array(count), zA: new Float32Array(count),
    rM: new Float32Array(count), cls: new Uint8Array(count),
  };
  const eps = 23.4392911 * DEG, ce = Math.cos(eps), se = Math.sin(eps);
  for (let i = 0; i < count; i++) {
    const r = i * stride;
    const a = f[r], e = Math.min(f[r + 1], 0.97), inc = f[r + 2] * DEG, node = f[r + 3] * DEG, w = f[r + 4] * DEG;
    o.a[i] = a; o.e[i] = e;
    o.mm[i] = GAUSS_K / (a * Math.sqrt(a));
    o.m0[i] = f[r + 5] * DEG;
    o.ep[i] = f[r + 6];
    const cO = Math.cos(node), sO = Math.sin(node), cw = Math.cos(w), sw = Math.sin(w), ci = Math.cos(inc), si = Math.sin(inc);
    // Perifocal → ecliptic.
    const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
    const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
    const b = Math.sqrt(1 - e * e);
    const k = i * 6;
    // Ecliptic → ICRS (rotate about x by +ε).
    o.pq[k] = px; o.pq[k + 1] = ce * py - se * pz; o.pq[k + 2] = se * py + ce * pz;
    o.pq[k + 3] = qx * b; o.pq[k + 4] = (ce * qy - se * qz) * b; o.pq[k + 5] = (se * qy + ce * qz) * b;
    o.qA[i] = a * (1 - e);
    o.varpi[i] = node + w;
    // Equation of centre (≤ 2e + 1.5e², a safe over-bound for e < 0.4) + inclination reduction (≤ tan²(i/2)) + margin.
    const ti = Math.tan(inc / 2);
    o.lonTol[i] = e < 0.4 && inc < 1.2 ? 2 * e + 1.5 * e * e + ti * ti * 1.05 + 0.01 : 10;
    o.QA[i] = a * (1 + e);
    o.zA[i] = a * (1 + e) * si;
    const c = classFor(a, hashU(i, 7));
    o.cls[i] = CLASS_NAMES.indexOf(c);
    const H = f[r + 7];
    o.rM[i] = ((1329 / Math.sqrt(CLASS_COLOR[c].pV)) * Math.pow(10, -H / 5) * 1000) / 2;
  }
  return o;
}
const orbitBuffers = (o: Orbits): ArrayBuffer[] =>
  [o.a, o.e, o.mm, o.m0, o.ep, o.pq, o.qA, o.varpi, o.lonTol, o.QA, o.zA, o.rM, o.cls].map(x => x.buffer as ArrayBuffer);

/** Worker entry (beltOrbits.worker.ts): build and transfer the table back. */
export function handleOrbitsMessage(e: MessageEvent<{ f: Float32Array; count: number; stride: number }>): void {
  const o = buildOrbits(e.data.f, e.data.count, e.data.stride);
  (self as unknown as Worker).postMessage(o, orbitBuffers(o));
}

/** buildOrbits in a worker (the row data is copied, not transferred); main-thread fallback without workers. */
export function buildOrbitsAsync(f: Float32Array, count: number, stride: number): Promise<Orbits> {
  const fallback = (): Promise<Orbits> => new Promise(r => setTimeout(() => r(buildOrbits(f, count, stride)), 0));
  let w: Worker;
  try {
    w = new Worker(new URL('./beltOrbits.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return fallback();
  }
  return new Promise((resolve) => {
    w.onmessage = (e: MessageEvent<Orbits>) => {
      w.terminate();
      resolve(e.data);
    };
    w.onerror = () => {
      w.terminate();
      void fallback().then(resolve);
    };
    w.postMessage({ f, count, stride });
  });
}
