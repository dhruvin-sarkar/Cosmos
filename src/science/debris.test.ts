import { describe, expect, it } from 'vitest';
import {
  atmosphericDensityKgM3, characteristicLengthToAreaM2, collisionCrossSectionM2, collisionFragmentCount, collisionRatePerYear,
  explosionFragmentCount, isCatastrophicCollision, orbitalLifetime, shellVolumeM3,
} from './debris';

describe('debris', () => {
  it('atmospheric density falls monotonically and rises with solar activity', () => {
    let prev = Infinity;
    for (let h = 200e3; h <= 1000e3; h += 50e3) { const r = atmosphericDensityKgM3(h); expect(r).toBeLessThan(prev); prev = r; }
    expect(atmosphericDensityKgM3(400e3, 2.8)).toBeGreaterThan(atmosphericDensityKgM3(400e3, 1));
    expect(atmosphericDensityKgM3(400e3, 0)).toBeNaN();
  });
  it('lifetime ordering: higher is longer, higher A/m is shorter', () => {
    const l = (h: number, am: number): number => orbitalLifetime({ altitudeM: h, areaToMassM2Kg: am }).lifetimeYears;
    expect(l(800e3, 0.01)).toBeGreaterThan(l(500e3, 0.01));
    expect(l(500e3, 0.1)).toBeLessThan(l(500e3, 0.01));
    expect(l(400e3, 0.01)).toBeGreaterThan(0.05);
    expect(l(400e3, 0.01)).toBeLessThan(5);
    expect(orbitalLifetime({ altitudeM: 50e3, areaToMassM2Kg: 0.01 }).lifetimeS).toBe(0);
    expect(orbitalLifetime({ altitudeM: -1, areaToMassM2Kg: 0.01 }).lifetimeS).toBeNaN();
  });
  it('catastrophic threshold is 40 J/g', () => {
    expect(isCatastrophicCollision({ projectileMassKg: 1, targetMassKg: 1000, impactSpeedMS: 10000 })).toBe(true);
    expect(isCatastrophicCollision({ projectileMassKg: 1, targetMassKg: 1000, impactSpeedMS: 5000 })).toBe(false);
  });
  it('fragment counts follow the NASA SBM power laws', () => {
    expect(explosionFragmentCount(1)).toBe(6);
    expect(explosionFragmentCount(0.1)).toBeCloseTo(6 * Math.pow(0.1, -1.6), 8);
    const c = { projectileMassKg: 10, targetMassKg: 1000, impactSpeedMS: 10000 };
    expect(isCatastrophicCollision(c)).toBe(true);
    expect(collisionFragmentCount(0.1, c)).toBeCloseTo(0.1 * Math.pow(1010, 0.75) * Math.pow(0.1, -1.71), 6);
    expect(collisionFragmentCount(-1, c)).toBeNaN();
  });
  it('geometry and rates', () => {
    expect(characteristicLengthToAreaM2(1)).toBeCloseTo(0.556945, 6);
    expect(collisionCrossSectionM2(1, 1)).toBeCloseTo(4 * Math.PI, 12);
    expect(shellVolumeM3(500e3, 400e3)).toBeNaN();
    expect(shellVolumeM3(400e3, 500e3)).toBeGreaterThan(0);
    expect(collisionRatePerYear(1e-9, 10, 1e4)).toBeCloseTo(1e-9 * 10 * 1e4 * 365.25 * 86400, 6);
    expect(collisionRatePerYear(-1, 1, 1)).toBeNaN();
  });
});
