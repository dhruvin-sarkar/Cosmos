import { describe, expect, it } from 'vitest';
import { idmSafeUrl } from './idmSafeFetch';

describe('idmSafeUrl', () => {
  it('rewrites .bin paths to .cbin, keeping query and hash', () => {
    expect(idmSafeUrl('data/stars/stars.bin')).toBe('data/stars/stars.cbin');
    expect(idmSafeUrl('/data/solar/asteroids.bin?v=3')).toBe('/data/solar/asteroids.cbin?v=3');
    expect(idmSafeUrl('http://localhost:5173/data/x.BIN#frag')).toBe('http://localhost:5173/data/x.cbin#frag');
  });

  it('leaves other URLs alone', () => {
    expect(idmSafeUrl('data/stars/stars.json')).toBe('data/stars/stars.json');
    expect(idmSafeUrl('data/binary/readme.md')).toBe('data/binary/readme.md');
    expect(idmSafeUrl('data/x.bin.json')).toBe('data/x.bin.json');
    expect(idmSafeUrl('textures/earth/day_8k.jpg')).toBe('textures/earth/day_8k.jpg');
  });
});
