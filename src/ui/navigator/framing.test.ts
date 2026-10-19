import { describe, expect, it } from 'vitest';
import { discFraction, distanceForProjectedFraction, FOV_Y_RAD } from './framing';
import { pillLabel } from './tree';

describe('inspect framing', () => {
  it('fills 0.80 of the band between the top bar and the moon strip, inside the band', () => {
    // 1600×900: top bar ends at 56 px, moon strip starts at 768 px.
    const band = { height: 900, top: 56, bottom: 768 };
    const f = discFraction(band);
    expect(f * 900).toBeCloseTo(0.8 * (768 - 56), 6);
    // Centred disc stays clear of the strip.
    expect(450 + (f * 900) / 2).toBeLessThan(768);
    expect(450 - (f * 900) / 2).toBeGreaterThan(56);
  });

  it('shrinks to the room left by an asymmetric band', () => {
    const f = discFraction({ height: 900, top: 56, bottom: 600 }, 0.8);
    expect(f * 900).toBeCloseTo(2 * (600 - 450) - 16, 6);
  });

  it('distance gives the requested projected disc height', () => {
    const r = 1.5608e6; // Europa mean radius (m)
    const d = distanceForProjectedFraction(r, FOV_Y_RAD, 0.63);
    const projected = Math.tan(Math.asin(r / d)) / Math.tan(FOV_Y_RAD / 2);
    expect(projected).toBeCloseTo(0.63, 9);
    expect(d).toBeGreaterThan(r);
  });
});

describe('pillLabel', () => {
  it('keeps short names and abbreviates long ones via an alias', () => {
    expect(pillLabel({ name: 'Europa', aliases: ['Jupiter II'] })).toBe('Europa');
    expect(pillLabel({ name: 'International Space Station', aliases: ['ISS (ZARYA)', 'ISS'] })).toBe('ISS');
    expect(pillLabel({ name: 'Tiangong space station', aliases: ['CSS'] })).toBe('Tiangong');
    expect(pillLabel({ name: 'Hubble Space Telescope', aliases: ['HST'] })).toBe('Hubble');
    expect(pillLabel({ name: 'James Webb Space Telescope', aliases: ['jwst'] })).toBe('James Webb');
    expect(pillLabel({ name: 'Very Long Unabbreviated Name', aliases: [] })).toBe('Very Long Unabbreviated Name');
  });
});
