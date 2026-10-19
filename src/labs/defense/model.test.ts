import { describe, expect, it } from 'vitest';
import { DART_CALIBRATION, kineticImpactMonteCarlo } from '../../science/impact';
import {
  DART_ALONG_TRACK_FACTOR, DART_REAL, EARTH_DEFAULT, EARTH_RADIUS_M, MIN_S, YEAR_S, dartModified, dartScenario,
  displacementPerUnitDeltaV, earthMonteCarloInput, earthScenario, outcomeOf,
} from './model';

describe('DART replay (Cheng et al. 2023; Thomas et al. 2023, Nature 616)', () => {
  const r = dartScenario(DART_REAL);

  it('reproduces the published along-track Δv −2.70 ± 0.10 mm/s', () => {
    expect(r.alongTrackDeltaVMS).toBeCloseTo(DART_CALIBRATION.alongTrackDeltaVMS, 6);
    expect(DART_ALONG_TRACK_FACTOR).toBeGreaterThan(0.85);
    expect(DART_ALONG_TRACK_FACTOR).toBeLessThan(0.95);
  });

  it('lands within the measured period change −33.0 ± 1.0 min (3σ) once the model uncertainty is included', () => {
    const measured = DART_CALIBRATION.measuredDeltaPeriodS;
    // First-order relation ΔP ≈ 3 P Δv_T / v: inside the published 3σ interval.
    expect(Math.abs(r.deltaPeriodLinearS - measured) / MIN_S).toBeLessThanOrEqual(1.0);
    // Exact point-mass vis-viva (−31.8 min): the replay's ±1σ band (β uncertainty, Cheng et al. 2023) brackets the measurement,
    // and the residual is within 1σ of the combined model + measurement uncertainty.
    const band = r.band!;
    expect(band.p16).toBeLessThan(measured);
    expect(band.p84).toBeGreaterThan(measured);
    const sigma = Math.hypot((band.p84 - band.p16) / 2, DART_CALIBRATION.measuredDeltaPeriodSigmaS);
    expect(Math.abs(r.deltaPeriodS - measured)).toBeLessThan(sigma);
    // Headline band (same trials, first-order relation) brackets the measurement too.
    expect(r.bandLinear!.p16).toBeLessThan(measured);
    expect(r.bandLinear!.p84).toBeGreaterThan(measured);
    expect(r.bandLinear!.p50 / r.deltaPeriodLinearS).toBeCloseTo(1, 2);
    expect(r.periodAfterS).toBeLessThan(r.periodBeforeS);
    expect(r.semiMajorAxisAfterM).toBeLessThan(DART_CALIBRATION.separationM);
  });

  it('flags modified inputs and scales with β', () => {
    expect(dartModified(DART_REAL)).toBe(false);
    const more = dartScenario({ ...DART_REAL, beta: 5 }, 0);
    expect(dartModified({ ...DART_REAL, beta: 5 })).toBe(true);
    expect(more.deltaPeriodS).toBeLessThan(r.deltaPeriodS);
    const noEjecta = dartScenario({ ...DART_REAL, beta: 1 }, 0);
    expect(noEjecta.deltaPeriodS / r.deltaPeriodS).toBeCloseTo(1 / DART_REAL.beta, 1);
  });
});

describe('Defend Earth', () => {
  it('CW drift: ≈ Δv t for short times and ≈ 3 Δv t after whole orbits', () => {
    const day = 86400;
    expect(displacementPerUnitDeltaV(10 * day) / (10 * day)).toBeCloseTo(1, 1);
    expect(displacementPerUnitDeltaV(10 * 365.25636 * day) / (10 * 365.25636 * day)).toBeCloseTo(3, 3);
  });

  it('default scenario: 10 years of warning succeeds far more often than 1 year', () => {
    const ten = earthScenario(EARTH_DEFAULT);
    const one = earthScenario({ ...EARTH_DEFAULT, warningYears: 1 });
    expect(ten.captureRadiusM).toBeGreaterThan(EARTH_RADIUS_M);
    expect(ten.successProbability).toBeGreaterThan(0.5);
    expect(one.successProbability).toBeLessThan(0.05);
    expect(ten.missM).toBeGreaterThan(one.missM * 5);
  });

  it('success probability is monotonic in impactor mass and Δv need falls with warning', () => {
    const ps = [200, 600, 2000, 6000].map(m => earthScenario({ ...EARTH_DEFAULT, impactorMassKg: m }, 1500).successProbability);
    for (let i = 1; i < ps.length; i++) expect(ps[i]).toBeGreaterThanOrEqual(ps[i - 1]);
    const a = earthScenario({ ...EARTH_DEFAULT, warningYears: 2 }, 10);
    const b = earthScenario({ ...EARTH_DEFAULT, warningYears: 20 }, 10);
    expect(b.requiredDeltaVMS).toBeLessThan(a.requiredDeltaVMS);
  });

  it('re-drawn trials match kineticImpactMonteCarlo exactly (same seed and sampling order)', () => {
    const r = earthScenario(EARTH_DEFAULT, 800);
    const mc = kineticImpactMonteCarlo(earthMonteCarloInput(EARTH_DEFAULT, 800));
    expect(r.deltaVBand.p50).toBe(mc.deltaVMS.p50);
    // miss = Δv × along × g(t); with along ∈ [0.85, 1] the miss median sits between those multiples of the Δv median.
    const g = displacementPerUnitDeltaV(EARTH_DEFAULT.warningYears * YEAR_S);
    expect(r.missBand.p50).toBeLessThan(mc.deltaVMS.p50 * g * 1.0001);
    expect(r.missBand.p50).toBeGreaterThan(mc.deltaVMS.p50 * g * 0.8);
  });

  it('outcome thresholds', () => {
    expect(outcomeOf(1)).toBe('deflected');
    expect(outcomeOf(0.95)).toBe('likely');
    expect(outcomeOf(0.5)).toBe('uncertain');
    expect(outcomeOf(0.01)).toBe('fails');
  });
});
