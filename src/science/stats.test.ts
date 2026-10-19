import { describe, expect, it } from 'vitest';
import type { Rng } from './rng';
import { quantileSorted, runMonteCarlo, summarizeSamples } from './stats';

describe('stats', () => {
  it('quantile uses type-7 interpolation (numpy default)', () => {
    expect(quantileSorted([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantileSorted([1, 2, 3, 4], 0.25)).toBeCloseTo(1.75, 12);
    expect(quantileSorted([5], 0.9)).toBe(5);
    expect(quantileSorted([], 0.5)).toBeNaN();
    expect(quantileSorted([1, 2], 1.5)).toBeNaN();
  });
  it('summary of 1..5', () => {
    const s = summarizeSamples([5, 1, 3, 2, 4]);
    expect(s.mean).toBe(3);
    expect(s.std).toBeCloseTo(Math.sqrt(2.5), 12);
    expect([s.min, s.p50, s.max, s.count, s.invalid]).toEqual([1, 3, 5, 5, 0]);
  });
  it('excludes non-finite samples and counts them', () => {
    const s = summarizeSamples([1, NaN, 3, Infinity]);
    expect([s.count, s.invalid, s.mean]).toEqual([2, 2, 2]);
    expect(summarizeSamples([]).mean).toBeNaN();
  });
  it('runMonteCarlo is reproducible and recovers a normal', () => {
    const f = (r: Rng): number => r.normal(10, 1);
    const a = runMonteCarlo(20000, 'seed', f), b = runMonteCarlo(20000, 'seed', f);
    expect(Array.from(a.samples.subarray(0, 5))).toEqual(Array.from(b.samples.subarray(0, 5)));
    expect(a.summary.mean).toBeCloseTo(10, 1);
    expect(a.summary.p84 - a.summary.p16).toBeCloseTo(2, 1);
  });
});
