import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { CraftTrack, type CraftData } from './spacecraft';
import { AU_M } from '../../core/units';

const stub = (samples: number[], step = 2): CraftData => ({
  id: 't', name: 't', naifId: 0, centerId: 'sun', startJD: 1000, stepDays: step, count: samples.length / 3,
  coverage: { requested: ['', ''], delivered: ['', ''], trimmed: false }, samples,
  mission: { agency: '', launchDateUTC: '', status: '', summary: '' }, source: '', retrieved: '',
});

describe('CraftTrack (cubic Hermite)', () => {
  // x(t) = 100 t² km, with t in days from the start: Hermite with central-difference tangents is exact for quadratics' interior values within tolerance.
  const pts: number[] = [];
  for (let i = 0; i < 8; i++) pts.push(100 * (2 * i) ** 2, 50 * 2 * i, 0);
  const tr = new CraftTrack(stub(pts));
  it('reproduces sample points exactly', () => {
    const out = new Vector3();
    tr.positionM(1000 + 6, out);
    expect(out.x).toBeCloseTo(100 * 36 * 1000, 3);
    expect(out.y).toBeCloseTo(50 * 6 * 1000, 3);
  });
  it('interpolates a mid-step value close to the true curve', () => {
    const out = new Vector3();
    tr.positionM(1000 + 7, out);
    expect(Math.abs(out.x / 1000 - 100 * 49)).toBeLessThan(40); // < 1 % of 4900 km·ish
  });
  it('holds the end point outside coverage', () => {
    const a = new Vector3(), b = new Vector3();
    tr.positionM(tr.endJD, a);
    tr.positionM(tr.endJD + 500, b);
    expect(b.distanceTo(a)).toBe(0);
    expect(tr.covers(tr.endJD + 1)).toBe(false);
  });
  it('velocity matches the derivative of the track', () => {
    const v = new Vector3();
    tr.velocityMs(1000 + 6, v);
    expect(v.y).toBeCloseTo((50 * 1000) / 86400, 3);
  });
});

describe('spacecraft.json (Horizons)', () => {
  const j = JSON.parse(readFileSync('public/data/solar/spacecraft.json', 'utf8')) as { craft: CraftData[] };
  it('puts Voyager 1 at ~165–175 au from the Sun in Oct 2026 (JPL: ≈ 170 au)', () => {
    const d = j.craft.find((c) => c.id === 'voyager-1')!;
    const tr = new CraftTrack(d);
    const jd = 2461331.0; // 2026-10-18
    const p = tr.positionM(jd, new Vector3());
    expect(p.length() / AU_M).toBeGreaterThan(165);
    expect(p.length() / AU_M).toBeLessThan(176);
  });
});
