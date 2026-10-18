import { describe, expect, it } from 'vitest';
import { AU_M, L_SUN_W, LY_M, PC_M, R_SUN_M, T_SUN_EFF_K } from '../core/units';
import {
  absoluteBolometricMagnitude,
  absoluteMagnitude,
  absoluteMagnitudeFromParallax,
  apparentMagnitude,
  blackbodyLinearSrgb,
  bvToTeffK,
  createBlackbodyColorLut,
  distanceFromModulusPc,
  distanceModulus,
  fluxRatio,
  luminosityFromTeffRadiusW,
  magnitudeDifference,
  radiusFromLuminosityTeffM,
  sampleBlackbodyColorLut,
  teffFromLuminosityRadiusK,
} from './photometry';

describe('distance units (IAU definitions)', () => {
  it('1 pc = 206264.806 AU and 1 ly = 63241.077 AU', () => {
    expect(PC_M / AU_M).toBeCloseTo(206_264.806, 3);
    expect(LY_M / AU_M).toBeCloseTo(63_241.077, 3);
  });
});

describe('magnitudes', () => {
  it('distance modulus is zero at 10 pc and 5 per decade', () => {
    expect(distanceModulus(10)).toBe(0);
    expect(distanceModulus(100)).toBeCloseTo(5, 12);
    expect(distanceFromModulusPc(distanceModulus(1234.5))).toBeCloseTo(1234.5, 8);
    expect(distanceModulus(0)).toBeNaN();
  });

  it('Sun: M_V = 4.83 seen from 1 AU is m ≈ −26.74', () => {
    const dPc = AU_M / PC_M;
    expect(apparentMagnitude(4.83, dPc)).toBeCloseTo(-26.74, 1);
    expect(absoluteMagnitude(-26.74, dPc)).toBeCloseTo(4.83, 1);
  });

  it('parallax: Sirius (m = −1.46, ϖ = 379.21 mas) has M ≈ 1.43', () => {
    expect(absoluteMagnitudeFromParallax(-1.46, 379.21)).toBeCloseTo(1.43, 2);
    expect(absoluteMagnitudeFromParallax(1, 0)).toBeNaN();
  });

  it('5 magnitudes = factor 100 in flux', () => {
    expect(fluxRatio(0, 5)).toBeCloseTo(100, 10);
    expect(magnitudeDifference(100)).toBeCloseTo(-5, 12);
  });

  it('IAU bolometric scale: nominal Sun has M_bol = 4.74', () => {
    expect(absoluteBolometricMagnitude(L_SUN_W)).toBeCloseTo(4.74, 2);
  });
});

describe('B−V → Teff (Ballesteros 2012)', () => {
  it('Sun B−V = 0.65 → ≈ 5780 K', () => {
    expect(bvToTeffK(0.65)).toBeGreaterThan(5700);
    expect(bvToTeffK(0.65)).toBeLessThan(5850);
  });
  it('Vega-like B−V = 0 → ≈ 10,000 K; monotonically decreasing', () => {
    expect(bvToTeffK(0)).toBeGreaterThan(9000);
    expect(bvToTeffK(0)).toBeLessThan(10_500);
    expect(bvToTeffK(1.5)).toBeLessThan(bvToTeffK(1.0));
  });
  it('outside the validity range → NaN', () => {
    expect(bvToTeffK(3)).toBeNaN();
    expect(bvToTeffK(Number.NaN)).toBeNaN();
  });
});

describe('blackbody colour', () => {
  it('~6500 K is close to neutral white under D65', () => {
    const c = blackbodyLinearSrgb(6504);
    expect(Math.min(c[0], c[1], c[2])).toBeGreaterThan(0.9);
  });
  it('cool stars are red (R > G > B), hot stars are blue (B > R)', () => {
    const cool = blackbodyLinearSrgb(3000);
    expect(cool[0]).toBe(1);
    expect(cool[1]).toBeLessThan(cool[0]);
    expect(cool[2]).toBeLessThan(cool[1]);
    const hot = blackbodyLinearSrgb(20_000);
    expect(hot[2]).toBe(1);
    expect(hot[0]).toBeLessThan(hot[2]);
  });
  it('the Sun is warm white (R ≥ G ≥ B, B > 0.75)', () => {
    const s = blackbodyLinearSrgb(T_SUN_EFF_K);
    expect(s[0]).toBeGreaterThanOrEqual(s[1]);
    expect(s[1]).toBeGreaterThanOrEqual(s[2]);
    expect(s[2]).toBeGreaterThan(0.75);
  });
  it('invalid temperature writes NaN', () => {
    expect(blackbodyLinearSrgb(-5)[0]).toBeNaN();
  });
  it('LUT lookup matches direct evaluation', () => {
    const lut = createBlackbodyColorLut(1000, 40_000, 512);
    const out = new Float32Array(3);
    sampleBlackbodyColorLut(lut, 4500, out);
    const direct = blackbodyLinearSrgb(4500);
    for (let c = 0; c < 3; c++) expect(out[c]).toBeCloseTo(direct[c], 2);
  });
});

describe('Stefan–Boltzmann', () => {
  it('nominal Sun: 4πR²σT⁴ reproduces L☉ = 3.828e26 W within 0.1%', () => {
    expect(luminosityFromTeffRadiusW(T_SUN_EFF_K, R_SUN_M) / L_SUN_W).toBeCloseTo(1, 3);
  });
  it('round trips R ↔ L ↔ T', () => {
    const L = luminosityFromTeffRadiusW(3500, 0.4 * R_SUN_M);
    expect(radiusFromLuminosityTeffM(L, 3500) / R_SUN_M).toBeCloseTo(0.4, 12);
    expect(teffFromLuminosityRadiusK(L, 0.4 * R_SUN_M)).toBeCloseTo(3500, 8);
    expect(luminosityFromTeffRadiusW(0, R_SUN_M)).toBeNaN();
  });
});
