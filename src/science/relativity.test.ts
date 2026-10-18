import { describe, expect, it } from 'vitest';
import { ARCSEC, GM_SUN, M_SUN_KG, R_SUN_M } from '../core/units';
import {
  ProperTimeClock,
  circularOrbitTimeDilation,
  einsteinRadiusRad,
  gravitationalRedshift,
  iscoRadiusM,
  lightDeflectionRad,
  photonSphereRadiusM,
  schwarzschildRadiusFromMuM,
  schwarzschildRadiusM,
  shadowRadiusM,
  staticObserverTimeDilation,
  tidalStretchAccelerationMS2,
} from './relativity';

const SGR_A_MASS_KG = 4.297e6 * M_SUN_KG;

describe('Schwarzschild radius', () => {
  it('Sun ≈ 2.953 km', () => {
    expect(schwarzschildRadiusFromMuM(GM_SUN)).toBeCloseTo(2953.25, 1);
    expect(schwarzschildRadiusM(M_SUN_KG)).toBeCloseTo(2953.25, 1);
  });
  it('Sgr A* (4.297e6 M☉) ≈ 1.27e10 m', () => {
    expect(schwarzschildRadiusM(SGR_A_MASS_KG) / 1e10).toBeCloseTo(1.269, 3);
  });
  it('characteristic radii', () => {
    expect(photonSphereRadiusM(2)).toBe(3);
    expect(iscoRadiusM(2)).toBe(6);
    expect(shadowRadiusM(1)).toBeCloseTo(2.598, 3);
    expect(schwarzschildRadiusM(-1)).toBeNaN();
  });
});

describe('time dilation', () => {
  it('static observer: √(1 − r_s/r), NaN at/inside the horizon', () => {
    expect(staticObserverTimeDilation(4, 1)).toBeCloseTo(Math.sqrt(0.75), 15);
    expect(staticObserverTimeDilation(1, 1)).toBeNaN();
    expect(staticObserverTimeDilation(0.5, 1)).toBeNaN();
  });
  it('circular orbit at the ISCO: √(1/2)', () => {
    expect(circularOrbitTimeDilation(3, 1)).toBeCloseTo(Math.SQRT1_2, 15);
    expect(circularOrbitTimeDilation(1.5, 1)).toBeNaN();
  });
  it('GPS-like check: Earth surface vs infinity ≈ 7e-10 fractional', () => {
    const rs = schwarzschildRadiusFromMuM(3.986004e14);
    expect(1 - staticObserverTimeDilation(6.371e6, rs)).toBeCloseTo(6.96e-10, 11);
  });
  it('redshift at r = 4 r_s', () => {
    expect(gravitationalRedshift(4, 1)).toBeCloseTo(1 / Math.sqrt(0.75) - 1, 14);
  });
});

describe('light deflection and lensing', () => {
  it('Sun limb deflection = 1.75″', () => {
    expect(lightDeflectionRad(M_SUN_KG, R_SUN_M) / ARCSEC).toBeCloseTo(1.75, 2);
  });
  it('Einstein radius of a 1 M☉ lens halfway to a source 8 kpc away ≈ 1 mas', () => {
    const kpc = 3.0857e19;
    const theta = einsteinRadiusRad(M_SUN_KG, 4 * kpc, 8 * kpc);
    expect(theta / (ARCSEC / 1000)).toBeGreaterThan(0.95);
    expect(theta / (ARCSEC / 1000)).toBeLessThan(1.05);
    expect(einsteinRadiusRad(M_SUN_KG, 8 * kpc, 4 * kpc)).toBeNaN();
  });
});

describe('tidal stretching', () => {
  it('2 m person at the horizon of Sgr A* feels a tiny stretch (< 1e-3 g)', () => {
    const rs = schwarzschildRadiusM(SGR_A_MASS_KG);
    expect(tidalStretchAccelerationMS2(SGR_A_MASS_KG, rs, 2)).toBeLessThan(9.81e-3);
  });
  it('at a 10 M☉ black hole horizon it is enormous (> 1e8 m/s²)', () => {
    const m = 10 * M_SUN_KG;
    expect(tidalStretchAccelerationMS2(m, schwarzschildRadiusM(m), 2)).toBeGreaterThan(1e8);
  });
});

describe('ProperTimeClock', () => {
  it('accumulates τ = t √(1 − r_s/r) at fixed r and reports the lag', () => {
    const clock = new ProperTimeClock(1, 'static');
    for (let i = 0; i < 1000; i++) clock.advance(0.01, 4);
    expect(clock.coordinateTimeS).toBeCloseTo(10, 10);
    expect(clock.properTimeS).toBeCloseTo(10 * Math.sqrt(0.75), 10);
    expect(clock.lagS).toBeCloseTo(10 * (1 - Math.sqrt(0.75)), 10);
  });
  it('stops (valid = false) when crossing the horizon, totals stay finite', () => {
    const clock = new ProperTimeClock(1, 'circular');
    clock.advance(1, 10);
    clock.advance(1, 1.2);
    expect(clock.valid).toBe(false);
    expect(Number.isFinite(clock.properTimeS)).toBe(true);
    clock.reset();
    expect(clock.valid).toBe(true);
    expect(clock.properTimeS).toBe(0);
  });
});
