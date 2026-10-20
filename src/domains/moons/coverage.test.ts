import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { fillFractionOfLitDisc, hasPartialCoverage, imagedSinLatLimit, southPoleDirection, subSolarLatDeg } from './coverage';
import { fallbackParentPosition, moonRotation, recordOf } from './ephemeris';

const T2026 = Date.UTC(2026, 9, 18, 12);

/** Sun direction from the moon in the moon's body frame (z = north). */
function sunBody(id: string, tMs: number): Vector3 {
  const rec = recordOf(id);
  const u = fallbackParentPosition('uranus', tMs, new Vector3());
  const toSun = u.negate().normalize();
  const r = moonRotation(rec, tMs, new Float64Array(9));
  // body = R^T * world (R is body -> world, rows r[0..2], r[3..5], r[6..8])
  return new Vector3(
    r[0] * toSun.x + r[3] * toSun.y + r[6] * toSun.z,
    r[1] * toSun.x + r[4] * toSun.y + r[7] * toSun.z,
    r[2] * toSun.x + r[5] * toSun.y + r[8] * toSun.z,
  );
}

describe('Uranian moon imagery coverage', () => {
  it('flags the five Voyager-2-limited moons only', () => {
    for (const id of ['miranda', 'ariel', 'umbriel', 'titania', 'oberon']) expect(hasPartialCoverage(id)).toBe(true);
    expect(hasPartialCoverage('io')).toBe(false);
  });
  it('the imaged cap is the southern ~30 %', () => {
    expect(imagedSinLatLimit('titania')).toBeCloseTo(-0.4, 5);
  });
  it('the Sun is over the north in 2026 and over the south in 1986 (Voyager 2)', () => {
    expect(subSolarLatDeg(sunBody('titania', T2026))).toBeGreaterThan(40);
    expect(subSolarLatDeg(sunBody('titania', Date.UTC(1986, 0, 24)))).toBeLessThan(-60);
  });
  it('the lit disc seen today is almost entirely fill; in 1986 it was imaged', () => {
    const s = sunBody('titania', T2026);
    expect(fillFractionOfLitDisc('titania', s, s.clone().applyAxisAngle(new Vector3(1, 0, 0), 1))).toBeGreaterThan(0.9);
    const s86 = sunBody('titania', Date.UTC(1986, 0, 24));
    expect(fillFractionOfLitDisc('titania', s86, s86)).toBeLessThan(0.5);
  });
  it('the south approach direction is a unit vector', () => {
    const d = southPoleDirection(recordOf('titania'));
    expect(Math.hypot(...d)).toBeCloseTo(1, 6);
  });
});
