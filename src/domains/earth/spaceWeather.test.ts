import { describe, expect, it } from 'vitest';
import { QUIET_KP, dipoleAxis, kpAt, ovalEquatorwardMlatDeg, parseStorms } from './spaceWeather';
import { mergeTextureTables, maxTierFor } from './textures';

// NASA CCMC DONKI GST list entry format (public/data/solar/space-weather.json), e.g. the 2026-10-10 storm.
const json = {
  geomagneticStorms: [
    { startTimeUTC: '2026-10-10T15:00Z', maxKp: 7, maxKpTimeUTC: '2026-10-10T18:00Z', nKpSamples: 2 },
    { startTimeUTC: 'not a date', maxKp: 6, maxKpTimeUTC: null },
    { startTimeUTC: '2026-10-04T18:00Z', maxKp: null, maxKpTimeUTC: null },
  ],
};

describe('space weather → Kp', () => {
  const storms = parseStorms(json);
  it('keeps only valid storms', () => {
    expect(storms).toHaveLength(1);
  });
  it('reaches the observed maximum at the listed peak time', () => {
    const r = kpAt(storms, Date.parse('2026-10-10T18:00Z'));
    expect(r.kp).toBeCloseTo(7, 6);
    expect(r.basis).toBe('observed');
    expect(r.stormMaxKp).toBe(7);
  });
  it('falls back to the quiet baseline outside storms', () => {
    const r = kpAt(storms, Date.parse('2026-10-20T00:00Z'));
    expect(r.kp).toBe(QUIET_KP);
    expect(r.basis).toBe('typical');
    expect(kpAt(parseStorms(null), 0).kp).toBe(QUIET_KP);
  });
  it('ramps continuously before and after the peak', () => {
    const before = kpAt(storms, Date.parse('2026-10-10T14:00Z')).kp;
    const after = kpAt(storms, Date.parse('2026-10-11T03:00Z')).kp;
    expect(before).toBeGreaterThan(QUIET_KP);
    expect(before).toBeLessThan(7);
    expect(after).toBeGreaterThan(QUIET_KP);
    expect(after).toBeLessThan(7);
  });
});

describe('geomagnetic geometry', () => {
  it('dipole axis points to the IGRF-14 geomagnetic north pole (80.8° N, 72.6° W)', () => {
    const d = dipoleAxis({ x: 0, y: 0, z: 0 });
    expect(Math.hypot(d.x, d.y, d.z)).toBeCloseTo(1, 12);
    expect((Math.asin(d.z) * 180) / Math.PI).toBeCloseTo(80.8, 6);
    expect((Math.atan2(d.y, d.x) * 180) / Math.PI).toBeCloseTo(-72.6, 6);
  });
  it('oval moves equatorward with Kp (Starkov 1994: ~66° quiet, ~49° at Kp 9)', () => {
    expect(ovalEquatorwardMlatDeg(0)).toBeCloseTo(66, 6);
    expect(ovalEquatorwardMlatDeg(9)).toBeCloseTo(48.9, 6);
    expect(ovalEquatorwardMlatDeg(20)).toBe(ovalEquatorwardMlatDeg(9));
  });
});

describe('texture table', () => {
  it("maps hd.json's 16K Earth 'color' map to the 'max' day tier, served only on Ultra", () => {
    const t = mergeTextureTables(null, { version: 1, bodies: { earth: { color: { '16k': 'textures/earth/day_16k.jpg' } } } });
    expect(t.earth!.day!.max).toBe('textures/earth/day_16k.jpg');
    expect(t.earth!.day!.ultra).toBe('textures/earth/day_8k.jpg');
    expect(maxTierFor('ultra')).toBe('max');
    expect(maxTierFor('high')).toBe('high');
  });
});
