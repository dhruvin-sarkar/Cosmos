import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { temperatureRange, wedgeHalfAngles } from './cutaway';
import { findBody, type InteriorsData } from './data';

const data = JSON.parse(readFileSync(resolve(__dirname, '../../../public/data/interiors/interiors.json'), 'utf8')) as InteriorsData;

describe('temperatureRange', () => {
  it('spans whole decades around the bodies on screen', () => {
    expect(temperatureRange([findBody(data, 'earth')])).toEqual([2, 4]); // 288 K .. 6500 K
    expect(temperatureRange([findBody(data, 'sun')])).toEqual([3, 8]); // 4400 K .. 15.7 MK
    const [a, b] = temperatureRange([findBody(data, 'jupiter'), findBody(data, 'earth')]);
    expect(a).toBe(2);
    expect(b).toBe(5);
  });
  it('is at least two decades wide and falls back without data', () => {
    for (const body of data.bodies) {
      const [a, b] = temperatureRange([body]);
      expect(b - a).toBeGreaterThanOrEqual(2);
    }
    expect(temperatureRange([null])[1]).toBeGreaterThan(temperatureRange([null])[0]);
  });
});

describe('wedgeHalfAngles', () => {
  it('opens the surface 45 deg each side and keeps the innermost layer whole', () => {
    const h = wedgeHalfAngles(5);
    expect(h[4]).toBeCloseTo(Math.PI / 4, 9);
    expect(h[0]).toBe(0);
    for (let i = 2; i < h.length; i++) expect(h[i]).toBeGreaterThan(h[i - 1]);
  });
});
