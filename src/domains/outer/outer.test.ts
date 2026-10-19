import { describe, expect, it } from 'vitest';
import { raDecDistToIcrs } from '../../core/frames';
import {
  CRAFT_FALLBACK_RADEC, CROSSINGS, HELIOPAUSE, NOSE_ICRS, OORT_INNER_AU, OORT_OUTER_AU, SCALE_RINGS, TERMINATION_SHOCK,
  angleFromNoseDeg, generateOortCloud, shellRadiusAU,
} from './model';
import { cleanName, tnoEntityId, tnoSlug } from './data';

const dirOf = (craft: 'voyager-1' | 'voyager-2') => raDecDistToIcrs(CRAFT_FALLBACK_RADEC[craft].raDeg, CRAFT_FALLBACK_RADEC[craft].decDeg, 1, { x: 0, y: 0, z: 0 });

describe('heliosphere model', () => {
  it('nose direction is a unit vector toward ecliptic longitude 255.7°', () => {
    expect(Math.hypot(NOSE_ICRS.x, NOSE_ICRS.y, NOSE_ICRS.z)).toBeCloseTo(1, 12);
    // Ophiuchus: RA ≈ 17h, Dec ≈ −17° for (λ, β) = (255.7°, +5.1°).
    const ra = ((Math.atan2(NOSE_ICRS.y, NOSE_ICRS.x) * 180) / Math.PI + 360) % 360;
    expect(ra).toBeGreaterThan(250);
    expect(ra).toBeLessThan(262);
  });

  it('shells pass through the four Voyager crossings (≤ 1.5 % radial error)', () => {
    for (const c of CROSSINGS) {
      const shell = c.shell === 'heliopause' ? HELIOPAUSE : TERMINATION_SHOCK;
      const r = shellRadiusAU(shell, dirOf(c.craftId));
      expect(Math.abs(r - c.distanceAU) / c.distanceAU).toBeLessThan(0.015);
    }
  });

  it('heliopause encloses the termination shock everywhere', () => {
    for (let lon = 0; lon < 360; lon += 30) {
      for (let lat = -90; lat <= 90; lat += 30) {
        const d = raDecDistToIcrs(lon, lat, 1, { x: 0, y: 0, z: 0 });
        if (angleFromNoseDeg(d) > TERMINATION_SHOCK.thetaMaxDeg) continue;
        expect(shellRadiusAU(HELIOPAUSE, d)).toBeGreaterThan(shellRadiusAU(TERMINATION_SHOCK, d));
      }
    }
  });

  it('is elongated downwind (tail longer than nose)', () => {
    const tail = { x: -NOSE_ICRS.x, y: -NOSE_ICRS.y, z: -NOSE_ICRS.z };
    expect(shellRadiusAU(HELIOPAUSE, tail)).toBeGreaterThan(2 * shellRadiusAU(HELIOPAUSE, NOSE_ICRS));
  });
});

describe('scale rings', () => {
  it('light-hour, light-day and light-year in au (c × time)', () => {
    const au = Object.fromEntries(SCALE_RINGS.map((r) => [r.id, r.radiusAU]));
    expect(au['light-hour']).toBeCloseTo(7.2, 1);
    expect(au['light-day']).toBeCloseTo(173.14, 1);
    expect(au['light-year']).toBeCloseTo(63241, -1);
  });
});

describe('oort cloud', () => {
  const cloud = generateOortCloud(6000, 7);
  it('is deterministic and stays inside 2,000–100,000 au', () => {
    const again = generateOortCloud(6000, 7);
    expect(again.positions[1234]).toBe(cloud.positions[1234]);
    let min = Infinity, max = 0;
    for (let i = 0; i < cloud.count; i++) {
      const r = Math.hypot(cloud.positions[3 * i], cloud.positions[3 * i + 1], cloud.positions[3 * i + 2]);
      min = Math.min(min, r);
      max = Math.max(max, r);
    }
    expect(min).toBeGreaterThanOrEqual(OORT_INNER_AU * 0.999);
    expect(max).toBeLessThanOrEqual(OORT_OUTER_AU * 1.001);
  });
});

describe('oort density profile', () => {
  it('thins outward (r^-3.5): far fewer points in the outer half of the radial range than the inner', () => {
    const c = generateOortCloud(8000, 11);
    let near = 0, far = 0;
    for (let i = 0; i < c.count; i++) {
      const r = Math.hypot(c.positions[3 * i]!, c.positions[3 * i + 1]!, c.positions[3 * i + 2]!);
      if (r < 20_000) near++; else if (r > 60_000) far++;
    }
    expect(near).toBeGreaterThan(far * 2);
  });
});

describe('named TNO ids', () => {
  it('links existing entities and slugs the rest', () => {
    expect(tnoEntityId('Pluto')).toBe('sol:pluto');
    expect(tnoEntityId('Sedna')).toBe('sb:sedna');
    expect(tnoEntityId('Orcus')).toBe('sb:orcus');
    expect(tnoSlug("G!kun||'homdima")).toBe('g-kun-homdima');
    expect(cleanName('|=Kagara')).toBe('Kagara');
  });
});
