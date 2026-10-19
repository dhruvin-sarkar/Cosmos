import { describe, expect, it } from 'vitest';
import { createRng, createRngFromState, distributionCenter, hashSeed, sampleDistribution, sampleUnitSphere } from './rng';

describe('rng', () => {
  it('matches the xoshiro128** reference first output for state (1,2,3,4)', () => {
    // result = rotl(s1*5, 7) * 9 = rotl(10, 7) * 9 = 1280 * 9 (Blackman & Vigna reference C code)
    expect(createRngFromState([1, 2, 3, 4]).nextUint32()).toBe(11520);
  });
  it('is deterministic per seed and differs across seeds', () => {
    const a = createRng('dart'), b = createRng('dart'), c = createRng('other');
    const xa = [a.next(), a.next(), a.next()];
    expect([b.next(), b.next(), b.next()]).toEqual(xa);
    expect(c.next()).not.toBe(xa[0]);
    expect(hashSeed('dart')).toBe(hashSeed('dart'));
  });
  it('uniform floats stay in [0,1) with mean ~0.5', () => {
    const r = createRng(7);
    let s = 0;
    for (let i = 0; i < 20000; i++) { const x = r.next(); expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThan(1); s += x; }
    expect(s / 20000).toBeCloseTo(0.5, 1);
  });
  it('normal has requested mean and sigma', () => {
    const r = createRng(11);
    const n = 40000; let s = 0, ss = 0;
    for (let i = 0; i < n; i++) { const x = r.normal(3, 2); s += x; ss += x * x; }
    const m = s / n;
    expect(m).toBeCloseTo(3, 1);
    expect(Math.sqrt(ss / n - m * m)).toBeCloseTo(2, 1);
  });
  it('int and logUniform respect their ranges', () => {
    const r = createRng(3);
    for (let i = 0; i < 2000; i++) {
      const k = r.int(6); expect(Number.isInteger(k) && k >= 0 && k < 6).toBe(true);
      const l = r.logUniform(1e-3, 1e3); expect(l).toBeGreaterThanOrEqual(1e-3); expect(l).toBeLessThan(1e3);
    }
  });
  it('state save/restore and clone replay exactly', () => {
    const r = createRng(5); r.normal(); const st = r.getState(); const cl = r.clone();
    const seq = [r.normal(), r.next(), r.normal()];
    r.setState(st);
    expect([r.normal(), r.next(), r.normal()]).toEqual(seq);
    expect([cl.normal(), cl.next(), cl.normal()]).toEqual(seq);
  });
  it('distributions sample within support and report centres', () => {
    const r = createRng(9);
    expect(sampleDistribution(r, { kind: 'fixed', value: 4 })).toBe(4);
    for (let i = 0; i < 500; i++) {
      const x = sampleDistribution(r, { kind: 'normal', mean: 0, sigma: 5, min: -1, max: 1 });
      expect(Math.abs(x)).toBeLessThanOrEqual(1);
    }
    expect(distributionCenter({ kind: 'loguniform', min: 1, max: 100 })).toBeCloseTo(10, 12);
    expect(distributionCenter({ kind: 'lognormal', log10Mean: -1, log10Sigma: 0.3 })).toBeCloseTo(0.1, 12);
    expect(distributionCenter({ kind: 'uniform', min: 2, max: 4 })).toBe(3);
  });
  it('sampleUnitSphere yields unit vectors with ~zero mean', () => {
    const r = createRng(1); const v = [0, 0, 0]; const m = [0, 0, 0]; const n = 5000;
    for (let i = 0; i < n; i++) { sampleUnitSphere(r, v); expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12); for (let k = 0; k < 3; k++) m[k] += v[k] / n; }
    for (const x of m) expect(Math.abs(x)).toBeLessThan(0.05);
  });
});
