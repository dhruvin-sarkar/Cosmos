import { describe, expect, it } from 'vitest';
import { apparentMag, bolometricCorrectionV, luminosityLsun, skyExposureForScale, stellarRadiusRsun } from './photometry';
import { normalizeBoundary, normalizeGl } from './catalog';

describe('stars photometry', () => {
  it('bolometric correction matches Torres (2010) reference values', () => {
    // Torres 2010 §2: BC_V,sun = −0.068 (with M_bol,sun = 4.73). Flower 1996 Table 3: 10 000 K ≈ −0.3; 3 600 K ≈ −1.6.
    expect(bolometricCorrectionV(5772)).toBeCloseTo(-0.07, 1);
    expect(bolometricCorrectionV(10_000)).toBeGreaterThan(-0.5);
    expect(bolometricCorrectionV(10_000)).toBeLessThan(-0.15);
    expect(bolometricCorrectionV(3_600)).toBeLessThan(-1.0);
    expect(bolometricCorrectionV(3_600)).toBeGreaterThan(-2.2);
  });

  it('derives the Sun at ~1 L☉, ~1 R☉', () => {
    expect(luminosityLsun(4.83, 5772)).toBeCloseTo(1, 1);
    expect(stellarRadiusRsun(4.83, 5772)).toBeCloseTo(1, 1);
  });

  it('derives plausible radii for well-measured stars', () => {
    // Sirius A: M_V = 1.42, Teff 9 940 K, R = 1.71 R☉ (Liebert et al. 2005; Kervella et al. 2003 interferometry).
    const sirius = stellarRadiusRsun(1.42, 9940);
    expect(sirius).toBeGreaterThan(1.4);
    expect(sirius).toBeLessThan(2.1);
    // α Cen A: M_V = 4.38, Teff 5 790 K, R = 1.22 R☉ (Kervella et al. 2017, A&A 597, A137).
    const acenA = stellarRadiusRsun(4.38, 5790);
    expect(acenA).toBeGreaterThan(1.1);
    expect(acenA).toBeLessThan(1.35);
  });

  it('apparent magnitude follows the distance modulus', () => {
    expect(apparentMag(4.83, 10)).toBeCloseTo(4.83, 6);
    expect(apparentMag(4.83, 1 / 206_264.806)).toBeCloseTo(-26.74, 1);
  });

  it('keeps a dark-site sky near the Sun and fades at galactic scales', () => {
    const e = skyExposureForScale(12, { refMag: 0, exposure: 0, limitMag: 0, limitSoftness: 0, opacity: 0 });
    expect(e.limitMag).toBeCloseTo(7, 6);
    expect(e.opacity).toBe(1);
    skyExposureForScale(21.5, e);
    expect(e.opacity).toBe(0);
    expect(normalizeGl('Gl 559A')).toBe('559A');
  });
});

describe('constellation boundary decoding', () => {
  it('groups one-vertex entries into rings by boundaryParts', () => {
    const rings = normalizeBoundary([[[1, 2]], [[3, 4]], [[5, 6]], [[7, 8]]], ['A', 'A', 'B', 'B']);
    expect(rings).toEqual([[[1, 2], [3, 4]], [[5, 6], [7, 8]]]);
    expect(normalizeBoundary([[[1, 2], [3, 4], [5, 6]]])).toEqual([[[1, 2], [3, 4], [5, 6]]]);
  });
});
