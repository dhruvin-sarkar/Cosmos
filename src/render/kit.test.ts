import { describe, expect, it } from 'vitest';
import { psfErf, psfPixelGauss, psfSprite } from './glsl/psf';
import {
  blackbodyChroma,
  blackbodyLinearSrgb,
  bvToTeffK,
  countBelow,
  distanceForPixelDiameter,
  keplerPosition,
  lodBlend,
  lodLevel,
  pixelDiameter,
  pixelsPerRadian,
  solveKeplerElliptic,
  solveKeplerGpuMirror,
  splitOctree,
  sphereSegmentsForPixels,
  wrapPi,
} from './index';

describe('kepler', () => {
  it('satisfies Kepler\'s equation for a grid of (M, e)', () => {
    for (const e of [0, 0.1, 0.5, 0.9, 0.967, 0.99])
      for (let k = -8; k <= 8; k++) {
        const M = (k * Math.PI) / 4 + 0.123;
        const E = solveKeplerElliptic(M, e);
        expect(E - e * Math.sin(E) - wrapPi(M)).toBeCloseTo(0, 10);
      }
  });
  it('GPU mirror (3 iterations) agrees with the converged solver to 1e-5 rad for e <= 0.9', () => {
    for (const e of [0, 0.2, 0.5, 0.9])
      for (let k = 0; k < 64; k++) {
        const M = -Math.PI + (k * 2 * Math.PI) / 64;
        expect(Math.abs(solveKeplerGpuMirror(M, e) - solveKeplerElliptic(M, e))).toBeLessThan(1e-5);
      }
  });
  it('circular orbit: radius = a, periapsis at +x for zero angles', () => {
    const p = keplerPosition(2, 0, 0, 0, 0, 0, { x: 0, y: 0, z: 0 });
    expect(p).toEqual({ x: 2, y: 0, z: 0 });
    const q = keplerPosition(2, 0, 0, 0, 0, Math.PI / 2, { x: 0, y: 0, z: 0 });
    expect(q.y).toBeCloseTo(2, 12);
  });
  it('Earth-like orbit keeps |r| between perihelion and aphelion', () => {
    const a = 1.495978707e11, e = 0.0167;
    for (let k = 0; k < 20; k++) {
      const p = keplerPosition(a, e, 0.1, 1, 2, k, { x: 0, y: 0, z: 0 });
      const r = Math.hypot(p.x, p.y, p.z);
      expect(r).toBeGreaterThan(a * (1 - e) - 1);
      expect(r).toBeLessThan(a * (1 + e) + 1);
    }
  });
});

describe('blackbody', () => {
  it('has unit luminance and Sun is near white', () => {
    const c = blackbodyLinearSrgb(5772);
    expect(0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b).toBeCloseTo(1, 2);
    expect(Math.abs(c.r - c.b)).toBeLessThan(0.25);
  });
  it('is monotonic cool→hot (red falls relative to blue)', () => {
    const ratio = (t: number) => { const c = blackbodyChroma(t); return c.b / c.r; };
    expect(ratio(3000)).toBeLessThan(ratio(5800));
    expect(ratio(5800)).toBeLessThan(ratio(10000));
    expect(ratio(10000)).toBeLessThan(ratio(25000));
    expect(blackbodyChroma(3000).r).toBeCloseTo(1, 12);
  });
  it('B-V to Teff: Sun 0.65 -> ~5778 K, null on missing', () => {
    expect(bvToTeffK(0.65)).toBeGreaterThan(5700);
    expect(bvToTeffK(0.65)).toBeLessThan(5850);
    expect(bvToTeffK(null)).toBeNull();
    expect(bvToTeffK(NaN)).toBeNull();
  });
});

describe('lod', () => {
  const ppr = pixelsPerRadian(1080, (50 * Math.PI) / 180);
  it('pixelsPerRadian matches the pinhole formula', () => {
    expect(ppr).toBeCloseTo(1080 / (2 * Math.tan((25 * Math.PI) / 180)), 9);
  });
  it('pixelDiameter and distanceForPixelDiameter are inverses', () => {
    const r = 6.371e6;
    for (const px of [1, 10, 300, 900]) {
      const d = distanceForPixelDiameter(r, px, ppr);
      expect(pixelDiameter(r, d, ppr)).toBeCloseTo(px, 6);
    }
  });
  it('guards invalid input and camera-inside-sphere', () => {
    expect(pixelDiameter(0, 10, ppr)).toBe(0);
    expect(pixelDiameter(1, -5, ppr)).toBe(0);
    expect(pixelDiameter(10, 5, ppr)).toBe(Infinity);
  });
  it('levels increase with size and blends stay in [0,1]', () => {
    const order = ['point', 'point-sphere', 'low', 'full', 'extras'];
    let prev = -1;
    for (const px of [0.1, 2, 8, 100, 1000]) {
      const i = order.indexOf(lodLevel(px));
      expect(i).toBeGreaterThanOrEqual(prev);
      prev = i;
      const b = lodBlend(px);
      for (const v of [b.point, b.sphere, b.detail, b.extras]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
    expect(lodBlend(0.1).point).toBe(1);
  });
  it('sphere segments grow with size', () => {
    expect(sphereSegmentsForPixels(500)).toBeGreaterThan(sphereSegmentsForPixels(20));
  });
});

describe('chunking helpers', () => {
  it('countBelow is a binary-search lower bound', () => {
    const a = new Uint32Array([1, 3, 3, 7, 9]);
    expect(countBelow(a, 0)).toBe(0);
    expect(countBelow(a, 3)).toBe(1);
    expect(countBelow(a, 4)).toBe(3);
    expect(countBelow(a, 100)).toBe(5);
    expect(countBelow(a, Infinity)).toBe(5);
  });
  it('splitOctree partitions every index exactly once, leaves <= target, catalogue order kept', () => {
    const n = 5000;
    const pos = new Float64Array(3 * n);
    let s = 12345;
    const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let i = 0; i < 3 * n; i++) pos[i] = rnd() * 1e20;
    const idx = new Uint32Array(n).map((_, i) => i);
    const out: Uint32Array[] = [];
    splitOctree(pos, idx, 300, 0, out);
    const seen = new Uint8Array(n);
    for (const leaf of out) {
      expect(leaf.length).toBeLessThanOrEqual(300);
      for (let k = 0; k < leaf.length; k++) {
        seen[leaf[k]]++;
        if (k > 0) expect(leaf[k]).toBeGreaterThan(leaf[k - 1]);
      }
    }
    expect(seen.every((v) => v === 1)).toBe(true);
  });
  it('chunk-relative float32 keeps metre precision where absolute float32 cannot', () => {
    const chunk = 1e20, local = 1e6 + 5;
    expect(Math.fround(local) - 1e6).toBe(5);
    expect(Math.fround(chunk + local) - chunk).not.toBe(local);
  });
});


describe('pixel-integrated PSF', () => {
  it('erf approximation matches reference values (A&S table 7.1)', () => {
    expect(psfErf(0.5)).toBeCloseTo(0.5204999, 3);
    expect(psfErf(1)).toBeCloseTo(0.8427008, 3);
    expect(psfErf(-2)).toBeCloseTo(-0.9953223, 3);
  });
  it('conserves flux at any sub-pixel offset (no sampling twinkle)', () => {
    const sigma = 0.6;
    const total = (ox: number, oy: number): number => {
      let s = 0;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) s += psfPixelGauss(x - ox, y - oy, sigma, 0.5);
      return s;
    };
    const ref = 2 * Math.PI * sigma * sigma;
    for (const [ox, oy] of [[0, 0], [0.5, 0], [0.25, 0.4], [0.5, 0.5]]) expect(total(ox, oy) / ref).toBeCloseTo(1, 2);
  });
});

describe('padded PSF sprite', () => {
  // Rasterise a sprite of gl_PointSize = (size + 2)·dpr at a sub-pixel position: the summed flux (CSS px² units) must be
  // ~1 and nearly independent of the position (no twinkle), for 1–2.5 px dots at DPR 1 and 2.
  const flux = (size: number, dpr: number, fx: number, fy: number): number => {
    const sigma = 0.35 + 0.15 * size;
    const n = (size + 2) * dpr; // sprite edge in device px
    const x0 = fx - n / 2, y0 = fy - n / 2; // sprite origin relative to the pixel grid
    let sum = 0;
    for (let py = Math.floor(y0); py <= Math.ceil(y0 + n); py++)
      for (let px = Math.floor(x0); px <= Math.ceil(x0 + n); px++) {
        const cx = px + 0.5, cy = py + 0.5;
        const u = (cx - x0) / n, v = (cy - y0) / n;
        if (u < 0 || u > 1 || v < 0 || v > 1) continue;
        sum += psfSprite(u, v, size, sigma, dpr) / (dpr * dpr);
      }
    return sum;
  };
  it.each([[1, 1], [2.5, 1], [1, 1.25], [1, 1.5], [1, 2]])('size %s px at DPR %s', (size, dpr) => {
    const f: number[] = [];
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) f.push(flux(size, dpr, i / 8, j / 8));
    const lo = Math.min(...f), hi = Math.max(...f);
    expect(lo).toBeGreaterThan(0.9);
    expect(hi).toBeLessThan(1.05);
    expect((hi - lo) / hi).toBeLessThan(0.04);
  });
});
