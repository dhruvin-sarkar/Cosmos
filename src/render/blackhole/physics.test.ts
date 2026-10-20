import { describe, expect, it } from 'vitest';
import {
  AU_M, PC_M, R_SUN_M, approachReadout, binarySeparationM, dopplerFactor, eddingtonLuminosityW, einsteinRadiusRad,
  gravitationalRedshift, horizonRadiusM, iscoRadiusM, photonOrbitRadiusM, radiativeEfficiency, rocheLobeFraction,
  schwarzschildRadiusM, shadowDiameterMicroarcsec, solveKepler, staticTimeRate, thinDiscProfile, THIN_DISC_PROFILE_PEAK,
  weakDeflectionRad,
} from './physics';
import { criticalImpactParameter, traceRay } from './trace';

const ARCSEC = Math.PI / 180 / 3600;

describe('black-hole physics helpers', () => {
  it('Schwarzschild radius: 2953 m per solar mass (2GM☉/c², IAU nominal GM☉)', () => {
    expect(schwarzschildRadiusM(1)).toBeCloseTo(2953.25, 1);
    expect(schwarzschildRadiusM(6.5e9) / AU_M).toBeCloseTo(128.3, 0); // M87*: ~128 AU
  });

  it('Kerr horizon, ISCO and photon orbit (Bardeen, Press & Teukolsky 1972), units of GM/c²', () => {
    expect(horizonRadiusM(0)).toBeCloseTo(2, 10);
    expect(iscoRadiusM(0)).toBeCloseTo(6, 10);
    expect(iscoRadiusM(0.998)).toBeCloseTo(1.237, 2); // Thorne 1974 spin limit
    expect(iscoRadiusM(-0.9999)).toBeCloseTo(9, 1); // retrograde
    expect(photonOrbitRadiusM(0)).toBeCloseTo(3, 10);
    expect(photonOrbitRadiusM(0.9999)).toBeLessThan(1.05);
  });

  it('radiative efficiency 5.7 % at a = 0 and 32 % at a = 0.998', () => {
    expect(radiativeEfficiency(0)).toBeCloseTo(0.0572, 3);
    expect(radiativeEfficiency(0.998)).toBeCloseTo(0.32, 2);
  });

  it('M87* shadow ≈ 40 μas (EHT 2019 Paper VI: ring 42 ± 3 μas)', () => {
    const d = shadowDiameterMicroarcsec(6.5e9, 16.8e6 * PC_M);
    expect(d).toBeGreaterThan(37);
    expect(d).toBeLessThan(42);
  });

  it('light grazing the Sun is bent by 1.75″ (Eddington 1919)', () => {
    expect(weakDeflectionRad(1, R_SUN_M) / ARCSEC).toBeCloseTo(1.75, 2);
  });

  it('Einstein radius of a 1 M☉ lens at 4 kpc with a distant source ≈ 2 mas', () => {
    const th = einsteinRadiusRad(1, 4000 * PC_M, 8000 * PC_M) / ARCSEC;
    expect(th * 1000).toBeGreaterThan(1.0);
    expect(th * 1000).toBeLessThan(1.2);
  });

  it('Eddington luminosity 1.26e31 W per solar mass', () => {
    expect(eddingtonLuminosityW(1) / 1.26e31).toBeCloseTo(1, 1);
  });

  it('thin-disc profile peaks at r = (49/36) r_in and vanishes at the ISCO', () => {
    expect(thinDiscProfile(1)).toBe(0);
    expect(thinDiscProfile(49 / 36)).toBe(THIN_DISC_PROFILE_PEAK);
    expect(thinDiscProfile(1.3)).toBeLessThan(THIN_DISC_PROFILE_PEAK);
    expect(thinDiscProfile(1.45)).toBeLessThan(THIN_DISC_PROFILE_PEAK);
  });

  it('static clocks and gravitational redshift: at r = 2 r_s, rate 1/√2 and z = √2 − 1', () => {
    expect(staticTimeRate(2)).toBeCloseTo(Math.SQRT1_2, 12);
    expect(gravitationalRedshift(2)).toBeCloseTo(Math.SQRT2 - 1, 12);
    expect(staticTimeRate(1)).toBe(0);
    const r = approachReadout(10, 10 * schwarzschildRadiusM(10));
    expect(r.rOverRs).toBeCloseTo(10, 10);
    expect(r.farSecondsPerSecond).toBeCloseTo(1 / Math.sqrt(0.9), 10);
    expect(r.inside).toBe(false);
  });

  it('relativistic Doppler factor: head-on β = 0.6 gives δ = 2', () => {
    expect(dopplerFactor(0.6, 1)).toBeCloseTo(2, 12);
    expect(dopplerFactor(0.6, -1)).toBeCloseTo(0.5, 12);
  });

  it('Roche lobe (Eggleton 1983): 0.379 a for q = 1', () => {
    expect(rocheLobeFraction(1)).toBeCloseTo(0.3789, 3);
  });

  it("Kepler's third law: 1 M☉ and one sidereal year give 1 AU", () => {
    expect(binarySeparationM(1, 365.256363) / AU_M).toBeCloseTo(1, 3);
  });

  it('Kepler solver satisfies E − e sin E = M', () => {
    for (const e of [0, 0.3, 0.45, 0.73, 0.95]) {
      for (const m of [0.1, 1, 3, 5.5]) {
        const E = solveKepler(m, e);
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 9);
      }
    }
  });
});

describe('photon integrator (CPU twin of the lens shader)', () => {
  it('Schwarzschild critical impact parameter = (3√3/2) r_s = 2.598 r_s (shadow 5.2 r_s across)', () => {
    expect(criticalImpactParameter(0, 1)).toBeCloseTo(2.598, 2);
  });

  it('captures inside and escapes outside the critical impact parameter', () => {
    expect(traceRay([-300, 2.5, 0], [1, 0, 0]).captured).toBe(true);
    expect(traceRay([-300, 2.7, 0], [1, 0, 0]).captured).toBe(false);
  });

  it('weak-field deflection → 2 r_s / b far from the hole', () => {
    const b = 100;
    const res = traceRay([-3000, b, 0], [1, 0, 0], 0, [0, 0, 1], 3600);
    expect(res.captured).toBe(false);
    expect(res.deflection / (2 / b)).toBeGreaterThan(0.95);
    expect(res.deflection / (2 / b)).toBeLessThan(1.1);
  });

  it('spin makes the shadow asymmetric (prograde photons get closer)', () => {
    const pro = criticalImpactParameter(0.9, 1);
    const retro = criticalImpactParameter(0.9, -1);
    expect(Math.abs(pro - retro)).toBeGreaterThan(0.1);
  });
});
