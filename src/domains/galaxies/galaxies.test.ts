import { describe, expect, it } from 'vitest';
import { MPC_M } from '../../core/units';
import { deepWebOpacity, localGalaxiesOpacity, nearbyWebOpacity, structureLabelOpacity } from './fade';
import { discAxes, dot, skyBasis } from './math';
import { mulberry32, sampleCloud } from './starClouds';

describe('galaxy disc geometry', () => {
  // M31: RA 10.68542°, Dec 41.26917°, PA 38°, i = 77° (famous.json; RC3 / de Vaucouleurs 1958).
  const m31 = discAxes(10.68542, 41.26917, 38, 77);
  const sky = skyBasis(10.68542, 41.26917);

  it('builds an orthonormal disc frame', () => {
    expect(dot(m31.a, m31.a)).toBeCloseTo(1, 12);
    expect(dot(m31.b, m31.b)).toBeCloseTo(1, 12);
    expect(dot(m31.a, m31.b)).toBeCloseTo(0, 12);
    expect(dot(m31.normal, m31.a)).toBeCloseTo(0, 12);
  });

  it('puts the major axis on the sky at the catalogued position angle (N through E)', () => {
    expect(dot(m31.a, sky.c)).toBeCloseTo(0, 12);
    const pa = (Math.atan2(dot(m31.a, sky.e), dot(m31.a, sky.n)) * 180) / Math.PI;
    expect(pa).toBeCloseTo(38, 9);
  });

  it('projects the disc with axis ratio cos(i) seen from Earth', () => {
    const bSky = Math.hypot(dot(m31.b, sky.e), dot(m31.b, sky.n));
    expect(bSky).toBeCloseTo(Math.cos((77 * Math.PI) / 180), 9);
    expect(Math.abs(dot(m31.normal, sky.c))).toBeCloseTo(Math.cos((77 * Math.PI) / 180), 9);
  });
});

describe('scale-band fades', () => {
  const LSS = 13880.21 * MPC_M;

  it('local galaxies appear outside the Milky Way and leave at Gpc fields', () => {
    expect(localGalaxiesOpacity(19, 0)).toBe(0);
    expect(localGalaxiesOpacity(22.5, 0)).toBe(1);
    expect(localGalaxiesOpacity(26.5, 0)).toBe(0);
  });

  it('surveys fade in with the field and vanish once the camera is outside the CMB sphere', () => {
    expect(nearbyWebOpacity(22, 0)).toBe(0);
    expect(nearbyWebOpacity(25, 0)).toBe(1);
    expect(deepWebOpacity(25.5, 0)).toBe(1);
    expect(deepWebOpacity(26, 0.5 * LSS)).toBeGreaterThan(0.5);
    expect(deepWebOpacity(27, 1.3 * LSS)).toBe(0);
    expect(nearbyWebOpacity(27, 1.3 * LSS)).toBe(0);
  });

  it('structure labels: groups before superclusters', () => {
    expect(structureLabelOpacity('group', 23)).toBe(1);
    expect(structureLabelOpacity('supercluster', 23)).toBe(0);
    expect(structureLabelOpacity('supercluster', 25)).toBe(1);
  });
});

describe('star-cloud sampler', () => {
  // Synthetic 64×64 image of a galaxy at 1 Mpc seen face-on (disc normal along the line of sight).
  const W = 64;
  const C = { x: 1, y: 0, z: 0 };
  const N = { x: 1, y: 0, z: 0 };
  const fov = 0.02; // rad
  const R = 0.5 * fov * 1.0; // window half-width at 1 Mpc
  const img = (fill: (i: number, j: number) => number): Float32Array => {
    const a = new Float32Array(W * W * 3);
    for (let j = 0; j < W; j++) for (let i = 0; i < W; i++) a.fill(fill(i, j), (j * W + i) * 3, (j * W + i) * 3 + 3);
    return a;
  };

  it('puts a single bright pixel at the disc centre', () => {
    const rgb = img((i, j) => (i === 32 && j === 32 ? 1 : 0));
    const s = sampleCloud({ rgb, width: W, height: W, center: C, normal: N, radiusMpc: R, fovRad: fov, count: 200, rand: mulberry32(1) });
    expect(s.count).toBe(200);
    for (let k = 0; k < s.count; k++) {
      const dy = s.positions[k * 3 + 1], dz = s.positions[k * 3 + 2];
      expect(Math.hypot(dy, dz)).toBeLessThan(2 * fov / W);
    }
    expect(s.sumLum).toBeCloseTo(1, 6);
  });

  it('keeps a uniform disc inside the window and thin (|Δx| ≪ R away from the bulge)', () => {
    const rgb = img((i, j) => (Math.hypot(i - 31.5, j - 31.5) < 28 ? 0.5 : 0));
    const s = sampleCloud({ rgb, width: W, height: W, center: C, normal: N, radiusMpc: R, fovRad: fov, count: 2000, rand: mulberry32(2) });
    let thick = 0;
    for (let k = 0; k < s.count; k++) {
      const x = s.positions[k * 3] - 1, r = Math.hypot(s.positions[k * 3 + 1], s.positions[k * 3 + 2]);
      expect(r).toBeLessThan(R * 1.15);
      if (r > 0.3 * R) thick = Math.max(thick, Math.abs(x));
    }
    expect(thick).toBeLessThan(0.08 * R);
  });
});
