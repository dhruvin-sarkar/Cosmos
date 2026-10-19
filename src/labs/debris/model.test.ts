import { describe, expect, it } from 'vitest';
import { GM_EARTH } from '../../core/units';
import {
  BREAKUP_EVENTS, CATALOG, REAL_INPUTS, SHELL_COUNT, buildBreakupCloud, catalogInitialPopulation, cloudSpread, fragmentPosition,
  gmstRad, inputsModified, orbitThroughPoint, parentPeriodS, realStateSummary, runScenario, shellDensityPerKm3, shellsAtYear, summarize, shellGlowLevel,
} from './model';

describe('debris lab: real state', () => {
  it('bins the catalogue into 36 shells that add up to the LEO count', () => {
    expect(SHELL_COUNT).toBe(36);
    const s = realStateSummary();
    const binned = s.activePayloadsLeo + s.deadPayloadsLeo + s.rocketBodiesLeo + s.debrisLeo + s.unknownLeo;
    expect(binned + CATALOG.leoBelowMinShell).toBe(CATALOG.leoCount);
    // The busiest shell today is the Starlink layer around 500–600 km.
    expect(s.busiestShellKm).toBeGreaterThan(450);
    expect(s.busiestShellKm).toBeLessThan(650);
  });

  it('maps catalogue classes onto model populations', () => {
    const p = catalogInitialPopulation();
    expect(p.active.length).toBe(SHELL_COUNT);
    const tot = (a: number[]) => a.reduce((x, y) => x + y, 0);
    expect(tot(p.active) + tot(p.derelict) + tot(p.debris)).toBe(CATALOG.leoCount - CATALOG.leoBelowMinShell);
  });

  it('computes shell densities in objects per km³ of the right order (ESA: ~1e-8–1e-7 per km³ at peak)', () => {
    const p = catalogInitialPopulation();
    const all = p.active.map((v, i) => v + p.derelict[i] + p.debris[i]);
    const d = shellDensityPerKm3(all, new Float64Array(SHELL_COUNT));
    const peak = Math.max(...d);
    expect(peak).toBeGreaterThan(1e-8);
    expect(peak).toBeLessThan(1e-5);
  });
});

describe('debris lab: scenarios', () => {
  it('runs every scenario quickly and ranks the policies sensibly', () => {
    const t0 = performance.now();
    const base = summarize(runScenario({ ...REAL_INPUTS, horizonYears: 200 }));
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(1500);
    const pmd = summarize(runScenario({ ...REAL_INPUTS, scenario: 'pmd-90', horizonYears: 200 }, false));
    const five = summarize(runScenario({ ...REAL_INPUTS, scenario: 'five-year-rule', horizonYears: 200 }, false));
    const adr = summarize(runScenario({ ...REAL_INPUTS, scenario: 'adr', adrPerYear: 20, horizonYears: 200 }, false));
    expect(base.totalStart).toBeCloseTo(CATALOG.leoCount - CATALOG.leoBelowMinShell, 6);
    expect(pmd.debrisEnd).toBeLessThan(base.debrisEnd);
    expect(five.debrisEnd).toBeLessThanOrEqual(pmd.debrisEnd * 1.0001);
    expect(adr.debrisEnd).toBeLessThan(pmd.debrisEnd);
    expect(base.cumulativeCollisions).toBeGreaterThan(0);
    expect(base.netDebrisChange).toBeGreaterThan(0);
  });

  it('high solar activity cleans low shells faster than low activity', () => {
    const lo = summarize(runScenario({ ...REAL_INPUTS, scenario: 'launch-stop', solar: 'low' }, false));
    const hi = summarize(runScenario({ ...REAL_INPUTS, scenario: 'launch-stop', solar: 'high' }, false));
    expect(hi.totalEnd).toBeLessThan(lo.totalEnd);
  });

  it('interpolates per-shell snapshots', () => {
    const run = runScenario(REAL_INPUTS);
    expect(run.snapshotYears[0]).toBe(0);
    expect(run.snapshotYears[run.snapshotYears.length - 1]).toBe(100);
    const a = shellsAtYear(run, 0, 'total', new Float64Array(SHELL_COUNT));
    expect(a.reduce((x, y) => x + y, 0)).toBeCloseTo(run.total[0], 6);
    const mid = shellsAtYear(run, 7.5, 'debris', new Float64Array(SHELL_COUNT));
    const s5 = run.shellDebris[1], s10 = run.shellDebris[2];
    for (let i = 0; i < SHELL_COUNT; i++) expect(mid[i]).toBeCloseTo(0.5 * (s5[i] + s10[i]), 6);
  });

  it('knows when inputs differ from the real case', () => {
    expect(inputsModified(REAL_INPUTS)).toBe(false);
    expect(inputsModified({ ...REAL_INPUTS, adrPerYear: 30 })).toBe(false); // ADR rate matters only for the ADR scenario
    expect(inputsModified({ ...REAL_INPUTS, solar: 'high' })).toBe(true);
    expect(inputsModified({ ...REAL_INPUTS, horizonYears: 200 })).toBe(false);
  });
});

describe('debris lab: breakups', () => {
  it('GMST matches the J2000 reference (280.46° at 2000-01-01 12:00 UT)', () => {
    expect((gmstRad(Date.UTC(2000, 0, 1, 12)) * 180) / Math.PI).toBeCloseTo(280.4606, 3);
  });

  it('puts both Iridium–Cosmos parents through the collision point at ~11.7 km/s relative speed', () => {
    const ev = BREAKUP_EVENTS[0];
    const dec = (ev.latDeg * Math.PI) / 180, ra = 1.234;
    const a = orbitThroughPoint(ev.parents[0], dec, ra).state.slice();
    const b = orbitThroughPoint(ev.parents[1], dec, ra).state.slice();
    for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1);
    const rel = Math.hypot(a[3] - b[3], a[4] - b[4], a[5] - b[5]);
    // ODQN 13(2): 11.7 km/s. Circular orbits at 789 km with the published inclinations give ≈ 11.6 km/s.
    expect(rel).toBeGreaterThan(11_300);
    expect(rel).toBeLessThan(12_000);
    expect(Math.hypot(a[0], a[1], a[2])).toBeCloseTo(6_378_135 + 789e3, -1);
  });

  it('builds a deterministic fragment cloud of the expected size', () => {
    const c1 = buildBreakupCloud('iridium-cosmos-2009');
    const c2 = buildBreakupCloud('iridium-cosmos-2009');
    expect(c1.count).toBe(c2.count);
    expect(c1.elements[5]).toBe(c2.elements[5]);
    // SBM: N(≥10 cm) = 0.1·(560+900)^0.75·0.1^-1.71 − N(≥1 m) ≈ 1190.
    expect(c1.expectedCount).toBeGreaterThan(1100);
    expect(c1.expectedCount).toBeLessThan(1300);
    expect(c1.count + c1.reenteredCount).toBe(Math.round(c1.expectedCount));
    expect(c1.count).toBeGreaterThan(0.8 * c1.expectedCount);
    expect(c1.medianDeltaVMS).toBeGreaterThan(10);
    expect(c1.medianDeltaVMS).toBeLessThan(1000);
  });

  it('all fragments start at the breakup point and spread along the orbit over hours to days', () => {
    const c = buildBreakupCloud('fengyun-1c-2007');
    const p = new Float64Array(3);
    for (let i = 0; i < Math.min(c.count, 50); i++) {
      fragmentPosition(c, i, 0, p);
      expect(Math.hypot(p[0] - c.point[0], p[1] - c.point[1], p[2] - c.point[2])).toBeLessThan(1);
    }
    const s0 = cloudSpread(c, 60);
    const sHours = cloudSpread(c, 6 * 3600);
    const sDays = cloudSpread(c, 5 * 86400);
    expect(s0.clumpedFraction).toBeGreaterThan(0.95);
    expect(sHours.arc90Deg).toBeGreaterThan(s0.arc90Deg);
    expect(sDays.arc90Deg).toBeGreaterThan(300); // wrapped round the Earth within days
    expect(parentPeriodS(c)).toBeCloseTo(2 * Math.PI * Math.sqrt((6_378_135 + 865e3) ** 3 / GM_EARTH), 3);
  });
});

describe('debris lab: numerical stability', () => {
  it('totals change smoothly from one step to the next (no RK4 step oscillation)', () => {
    const run = runScenario({ ...REAL_INPUTS, horizonYears: 50 }, false);
    for (let j = 2; j < run.total.length; j++) {
      const a = run.total[j - 2], b = run.total[j - 1], c = run.total[j];
      // Second difference small relative to the value: a zig-zag would make it comparable to the value itself.
      expect(Math.abs(a - 2 * b + c) / b).toBeLessThan(0.01);
    }
  });
});

describe('shellGlowLevel', () => {
  it('is 0 for empty shells, monotonic, and bounded at 1', () => {
    expect(shellGlowLevel(0)).toBe(0);
    expect(shellGlowLevel(Number.NaN)).toBe(0);
    expect(shellGlowLevel(1)).toBeGreaterThan(shellGlowLevel(0.1));
    expect(shellGlowLevel(20)).toBeGreaterThan(shellGlowLevel(1));
    expect(shellGlowLevel(1e6)).toBe(1);
  });
});
