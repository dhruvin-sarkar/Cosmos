import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { driftDegPerDay, WindClock, zonalWind } from './winds';

describe('zonal wind profiles', () => {
  it('matches the cited jets', () => {
    // Jupiter: 23.7° N jet ≈ 165 m/s, SEB retrograde jet ≈ −60 m/s (Porco et al. 2003; Tollefson et al. 2017).
    expect(zonalWind('jupiter', 23.7)).toBeCloseTo(165, 0);
    expect(zonalWind('jupiter', -19.5)).toBeCloseTo(-60, 0);
    // Saturn: equatorial super-rotation ≈ 440 m/s (Sánchez-Lavega et al. 2000).
    expect(zonalWind('saturn', 0)).toBeCloseTo(440, 0);
    // Uranus: retrograde equator ≈ −80 m/s, prograde ≈ 250 m/s at 60° (Sromovsky et al. 2015).
    expect(zonalWind('uranus', 0)).toBeCloseTo(-80, 0);
    expect(zonalWind('uranus', 60)).toBeCloseTo(250, 0);
    // Neptune: u(0) = −398 m/s (Sromovsky et al. 1993 polynomial).
    expect(zonalWind('neptune', 0)).toBeCloseTo(-398, 0);
  });

  it('converts to angular drift on the ellipsoid', () => {
    // Saturn equator: 440 m/s over a = 60 268 km → ≈ 36 °/day prograde.
    const d = driftDegPerDay('saturn', 0, 60_268e3, 54_364e3, 1);
    expect(d).toBeCloseTo(((440 / 60_268e3) * 180 * 86_400) / Math.PI, 3);
    expect(driftDegPerDay('saturn', 0, 60_268e3, 54_364e3, -1)).toBeCloseTo(-d, 6);
  });
});

describe('WindClock', () => {
  it('blend weights sum to one and the cycle wraps', () => {
    const c = new WindClock(36, 2);
    const v = new THREE.Vector4();
    for (let i = 0; i < 50; i++) {
      c.advanceDays(c.periodDays / 37);
      c.phases(v);
      expect(v.z + v.w).toBeCloseTo(1, 6);
      expect(Math.abs(v.x)).toBeLessThanOrEqual(c.periodDays);
    }
  });

  it('caps time-lapse at the per-body rate', () => {
    const c = new WindClock(36, 2, 3);
    const v0 = c.phases(new THREE.Vector4()).clone();
    c.advance(1e12, 1 / 60); // absurd sim step in one frame: limited to capDaysPerSec / 60
    const v1 = c.phases(new THREE.Vector4());
    expect(Math.abs(v1.x - v0.x)).toBeCloseTo(c.capDaysPerSec / 60, 6);
  });
});
