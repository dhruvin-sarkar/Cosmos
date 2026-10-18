import { describe, expect, it } from 'vitest';
import { C_M_PER_S, GPC_M, MPC_M } from '../core/units';
import {
  PLANCK18,
  Z_LAST_SCATTERING,
  ageS,
  angularDiameterDistanceM,
  cmbTemperatureK,
  comovingDistanceM,
  densityParameters,
  h0ToSI,
  hubbleE,
  lookbackTimeS,
  luminosityDistanceM,
  particleHorizonComovingM,
  redshiftFromComovingDistance,
  secondsToGyr,
  type CosmologyParams,
} from './cosmology';

/**
 * Independent reference integrator: 20-point Gauss–Legendre on many sub-intervals of ln(1+z), directly in z
 * (a different variable and quadrature from the implementation's Simpson-in-√a).
 */
const GL_X = [
  -0.9931285991850949, -0.9639719272779138, -0.912234428251326, -0.8391169718222188, -0.7463319064601508,
  -0.636053680726515, -0.5108670019508271, -0.37370608871541955, -0.2277858511416451, -0.07652652113349734,
  0.07652652113349734, 0.2277858511416451, 0.37370608871541955, 0.5108670019508271, 0.636053680726515,
  0.7463319064601508, 0.8391169718222188, 0.912234428251326, 0.9639719272779138, 0.9931285991850949,
];
const GL_W = [
  0.017614007139152118, 0.04060142980038694, 0.06267204833410907, 0.08327674157670475, 0.10193011981724044,
  0.11819453196151841, 0.13168863844917664, 0.14209610931838204, 0.14917298647260374, 0.15275338713072584,
  0.15275338713072584, 0.14917298647260374, 0.14209610931838204, 0.13168863844917664, 0.11819453196151841,
  0.10193011981724044, 0.08327674157670475, 0.06267204833410907, 0.04060142980038694, 0.017614007139152118,
];

function refIntegral(z: number, kind: 'chi' | 'time', p: CosmologyParams = PLANCK18): number {
  const { omegaM, omegaR, omegaL } = densityParameters(p);
  const E = (zz: number) => Math.sqrt(omegaR * (1 + zz) ** 4 + omegaM * (1 + zz) ** 3 + omegaL);
  // substitute u = ln(1+z): dz = (1+z) du
  const U = Math.log1p(z);
  const parts = 400;
  let sum = 0;
  for (let k = 0; k < parts; k++) {
    const u0 = (U * k) / parts, u1 = (U * (k + 1)) / parts;
    const half = 0.5 * (u1 - u0), mid = 0.5 * (u0 + u1);
    for (let i = 0; i < 20; i++) {
      const zz = Math.expm1(mid + half * GL_X[i]);
      const integrand = kind === 'chi' ? (1 + zz) / E(zz) : 1 / E(zz);
      sum += GL_W[i] * half * integrand;
    }
  }
  return sum;
}

describe('flat ΛCDM (Planck 2018)', () => {
  const H0 = h0ToSI(PLANCK18.h0KmSMpc);

  it('density parameters: Ω_r ≈ 9.1e-5, flat sum = 1', () => {
    const d = densityParameters();
    expect(d.omegaR).toBeGreaterThan(8.5e-5);
    expect(d.omegaR).toBeLessThan(9.5e-5);
    expect(d.omegaM + d.omegaR + d.omegaL).toBeCloseTo(1, 14);
    expect(hubbleE(0)).toBeCloseTo(1, 14);
  });

  it('age today ≈ 13.787 Gyr (Planck 2018: 13.787 ± 0.020)', () => {
    expect(secondsToGyr(ageS(0))).toBeCloseTo(13.787, 1);
    expect(Math.abs(secondsToGyr(ageS(0)) - 13.787)).toBeLessThan(0.02);
  });

  it('comoving distance and lookback time agree with an independent Gauss–Legendre integration', () => {
    for (const z of [0.01, 0.5, 1, 3, 10, Z_LAST_SCATTERING]) {
      const chiRef = (C_M_PER_S / H0) * refIntegral(z, 'chi');
      expect(comovingDistanceM(z) / chiRef).toBeCloseTo(1, 9);
      const tRef = refIntegral(z, 'time') / H0;
      expect(lookbackTimeS(z) / tRef).toBeCloseTo(1, 9);
    }
  });

  it('age(z) + lookback(z) = age today', () => {
    for (const z of [0.3, 2, 20, 1000]) expect((ageS(z) + lookbackTimeS(z)) / ageS(0)).toBeCloseTo(1, 10);
  });

  it('sanity values: χ(1) ≈ 3.4 Gpc, t_L(1) ≈ 7.9 Gyr, D_A peaks near z ≈ 1.6', () => {
    expect(comovingDistanceM(1) / GPC_M).toBeGreaterThan(3.35);
    expect(comovingDistanceM(1) / GPC_M).toBeLessThan(3.45);
    expect(secondsToGyr(lookbackTimeS(1))).toBeGreaterThan(7.8);
    expect(secondsToGyr(lookbackTimeS(1))).toBeLessThan(8.0);
    expect(angularDiameterDistanceM(1.6)).toBeGreaterThan(angularDiameterDistanceM(0.8));
    expect(angularDiameterDistanceM(1.6)).toBeGreaterThan(angularDiameterDistanceM(4));
    expect(luminosityDistanceM(1)).toBeCloseTo(4 * angularDiameterDistanceM(1), 0);
  });

  it('low-z Hubble law: χ ≈ cz/H0', () => {
    const z = 1e-4;
    expect(comovingDistanceM(z) / ((C_M_PER_S * z) / H0)).toBeCloseTo(1, 4);
  });

  it('particle horizon ≈ 14.2–14.4 Gpc (≈ 46 billion ly); CMB last-scattering shell slightly inside', () => {
    const ph = particleHorizonComovingM();
    expect(ph / GPC_M).toBeGreaterThan(14.1);
    expect(ph / GPC_M).toBeLessThan(14.5);
    expect(comovingDistanceM(Z_LAST_SCATTERING)).toBeLessThan(ph);
    expect(comovingDistanceM(Z_LAST_SCATTERING) / MPC_M).toBeGreaterThan(13_800);
  });

  it('z(χ) inverts χ(z)', () => {
    for (const z of [0.001, 0.7, 5, 1089.8]) expect(redshiftFromComovingDistance(comovingDistanceM(z)) / z).toBeCloseTo(1, 7);
    expect(redshiftFromComovingDistance(particleHorizonComovingM() * 1.01)).toBe(Infinity);
    expect(redshiftFromComovingDistance(-1)).toBeNaN();
  });

  it('CMB temperature scales as 1+z (≈ 2973 K at last scattering)', () => {
    expect(cmbTemperatureK(0)).toBe(2.7255);
    expect(cmbTemperatureK(Z_LAST_SCATTERING)).toBeCloseTo(2.7255 * 1090.8, 6);
  });

  it('invalid z → NaN', () => {
    expect(comovingDistanceM(-0.5)).toBeNaN();
    expect(lookbackTimeS(Number.NaN)).toBeNaN();
  });
});
