import { describe, expect, it } from 'vitest';
import { AU_M, GM_EARTH, GM_SUN, JULIAN_YEAR_S, R_EARTH_MEAN_M } from '../core/units';
import {
  DART_CALIBRATION,
  alongTrackDriftM,
  binaryPeriodChange,
  closestApproachLinear,
  cwAlongTrackImpulse,
  flybyPeriapsisM,
  gravitationalFocusingRadiusM,
  kineticImpactDeltaV,
  kineticImpactMonteCarlo,
  propagateDeflection,
  requiredAlongTrackDeltaVMS,
  sphereMassKg,
} from './impact';

describe('kinetic impact Δv', () => {
  it('textbook form: Δv = β m U / M along U', () => {
    const r = kineticImpactDeltaV({ impactorMassKg: 500, asteroidMassKg: 5e9, relativeVelocityMS: [-6000, 0, 0], beta: 3 });
    expect(r.deltaVMS[0]).toBeCloseTo(-1.8e-3, 12);
    expect(r.deltaVMS[1]).toBe(0);
    expect(r.deltaVMagnitudeMS).toBeCloseTo(1.8e-3, 12);
  });
  it('head-on surface normal reproduces the textbook result (either normal sign)', () => {
    const base = { impactorMassKg: 500, asteroidMassKg: 5e9, relativeVelocityMS: [0, -6000, 0] as const, beta: 3 };
    const t = kineticImpactDeltaV(base).deltaVMS;
    const nOut = kineticImpactDeltaV({ ...base, surfaceNormal: [0, 1, 0] }).deltaVMS;
    const nIn = kineticImpactDeltaV({ ...base, surfaceNormal: [0, -1, 0] }).deltaVMS;
    for (let i = 0; i < 3; i++) {
      expect(nOut[i]).toBeCloseTo(t[i], 15);
      expect(nIn[i]).toBeCloseTo(t[i], 15);
    }
  });
  it('oblique impact: ejecta recoil only along the normal', () => {
    const r = kineticImpactDeltaV({ impactorMassKg: 1, asteroidMassKg: 1, relativeVelocityMS: [1, -1, 0], beta: 3, surfaceNormal: [0, 1, 0] });
    expect(r.deltaVMS[0]).toBeCloseTo(1, 15);
    expect(r.deltaVMS[1]).toBeCloseTo(-3, 15);
  });
  it('invalid input → NaN', () => {
    expect(kineticImpactDeltaV({ impactorMassKg: 0, asteroidMassKg: 1, relativeVelocityMS: [1, 0, 0], beta: 1 }).deltaVMagnitudeMS).toBeNaN();
  });
});

describe('DART calibration (Didymos–Dimorphos)', () => {
  const d = DART_CALIBRATION;
  const res = binaryPeriodChange({ separationM: d.separationM, periodS: d.periodBeforeS, alongTrackDeltaVMS: d.alongTrackDeltaVMS });

  it('pre-impact orbit: v ≈ 17.4 cm/s, system mass ≈ 5.4e11 kg', () => {
    expect(res.orbitalSpeedMS).toBeCloseTo(0.174, 3);
    expect(res.muM3S2 / 6.6743e-11 / 1e11).toBeCloseTo(5.4, 1);
  });
  it('published Δv_T = −2.70 ± 0.10 mm/s reproduces the measured −33.0 ± 1.0 min period change within uncertainty', () => {
    // Point-mass vis-viva gives −31.8 min (second-order term +9(Δv/v)² included); the linear form gives −33.3 min.
    // The ±1σ Δv_T band must bracket the measurement, and the residual must be within the combined uncertainty.
    const dpMin = res.deltaPeriodS / 60;
    const at = (dv: number) => binaryPeriodChange({ separationM: d.separationM, periodS: d.periodBeforeS, alongTrackDeltaVMS: dv }).deltaPeriodS / 60;
    const lo = at(d.alongTrackDeltaVMS - d.alongTrackDeltaVSigmaMS);
    const hi = at(d.alongTrackDeltaVMS + d.alongTrackDeltaVSigmaMS);
    const measured = d.measuredDeltaPeriodS / 60;
    expect(lo - d.measuredDeltaPeriodSigmaS / 60).toBeLessThan(measured);
    expect(hi + d.measuredDeltaPeriodSigmaS / 60).toBeGreaterThan(measured);
    const sigmaModel = Math.abs(hi - lo) / 2;
    expect(Math.abs(dpMin - measured)).toBeLessThan(Math.hypot(sigmaModel, d.measuredDeltaPeriodSigmaS / 60) * 1.5);
    expect(Math.abs(res.deltaPeriodLinearS / 60 - measured)).toBeLessThan(1.0);
    expect(res.eccentricityAfter).toBeGreaterThan(0.01);
    expect(res.eccentricityAfter).toBeCloseTo(2 * Math.abs(d.alongTrackDeltaVMS / res.orbitalSpeedMS), 3);
  });
  it('the β model with published DART masses gives |Δv| of the measured order (2.7–3.1 mm/s)', () => {
    const r = kineticImpactDeltaV({
      impactorMassKg: d.impactorMassKg,
      asteroidMassKg: d.dimorphosMassKg,
      relativeVelocityMS: [d.impactSpeedMS, 0, 0],
      beta: d.beta,
    });
    expect(r.deltaVMagnitudeMS).toBeGreaterThan(2.7e-3);
    expect(r.deltaVMagnitudeMS).toBeLessThan(3.1e-3);
  });
  it('zero Δv → zero period change; escape → NaN period', () => {
    expect(binaryPeriodChange({ separationM: 1000, periodS: 40_000, alongTrackDeltaVMS: 0 }).deltaPeriodS).toBeCloseTo(0, 6);
    expect(binaryPeriodChange({ separationM: 1000, periodS: 40_000, alongTrackDeltaVMS: 1 }).periodAfterS).toBeNaN();
  });
});

describe('deflection drift', () => {
  it('linear drift −3 Δv t and full CW secular term agree after many orbits', () => {
    const n = (2 * Math.PI) / JULIAN_YEAR_S;
    const t = 10 * JULIAN_YEAR_S;
    expect(alongTrackDriftM(1e-3, t)).toBeCloseTo(-3e-3 * t, 6);
    const xy = cwAlongTrackImpulse(1e-3, n, t);
    expect(xy[1]).toBeCloseTo(alongTrackDriftM(1e-3, t), -2); // sin term vanishes at whole orbits
    expect(xy[0]).toBeCloseTo(0, 0);
  });
  it('exact two-body propagation matches 3 Δv t to ~1% for a 1 AU circular orbit', () => {
    const v = Math.sqrt(GM_SUN / AU_M);
    const state = new Float64Array([AU_M, 0, 0, 0, v, 0]);
    const r = propagateDeflection(state, GM_SUN, [0, 1e-3, 0], 5 * JULIAN_YEAR_S);
    expect(r.displacementMagnitudeM / r.linearEstimateM).toBeGreaterThan(0.98);
    expect(r.displacementMagnitudeM / r.linearEstimateM).toBeLessThan(1.02);
  });
  it('required Δv for one Earth radius in 10 years ≈ 6.7 mm/s', () => {
    expect(requiredAlongTrackDeltaVMS(R_EARTH_MEAN_M, 10 * JULIAN_YEAR_S)).toBeCloseTo(6.73e-3, 4);
  });
});

describe('encounter geometry', () => {
  it('Earth focusing at v∞ = 11.19 km/s gives √2 R', () => {
    expect(gravitationalFocusingRadiusM(R_EARTH_MEAN_M, 11_186, 11_186) / R_EARTH_MEAN_M).toBeCloseTo(Math.SQRT2, 12);
  });
  it('flyby with b = capture radius grazes the surface', () => {
    const vInf = 15_000;
    const vEsc = Math.sqrt((2 * GM_EARTH) / R_EARTH_MEAN_M);
    const b = gravitationalFocusingRadiusM(R_EARTH_MEAN_M, vEsc, vInf);
    expect(flybyPeriapsisM(b, vInf, GM_EARTH) / R_EARTH_MEAN_M).toBeCloseTo(1, 9);
  });
  it('linear closest approach', () => {
    const c = closestApproachLinear([10, 5, 0], [-1, 0, 0]);
    expect(c.timeS).toBeCloseTo(10, 12);
    expect(c.distanceM).toBeCloseTo(5, 12);
  });
});

describe('Monte Carlo', () => {
  const input = {
    impactorMassKg: { kind: 'fixed', value: 579.4 },
    impactSpeedMS: { kind: 'fixed', value: 6144.9 },
    beta: { kind: 'uniform', min: 2, max: 5 },
    asteroidDiameterM: { kind: 'normal', mean: 151, sigma: 5 },
    densityKgM3: { kind: 'uniform', min: 1500, max: 3300 },
    binary: { separationM: 1189, periodS: 11.921 * 3600 },
    count: 2000,
    seed: 'dart',
  } as const;
  it('is reproducible for a given seed and brackets the nominal value', () => {
    const a = kineticImpactMonteCarlo(input);
    const b = kineticImpactMonteCarlo(input);
    expect(a.deltaVMS).toEqual(b.deltaVMS);
    expect(a.deltaVMS.p05).toBeLessThan(a.nominalDeltaVMS);
    expect(a.deltaVMS.p95).toBeGreaterThan(a.nominalDeltaVMS);
    expect(a.deltaPeriodS!.p50).toBeLessThan(0);
    expect(a.deltaVMS.invalid).toBe(0);
  });
  it('sphere mass', () => {
    expect(sphereMassKg(2, 3000)).toBeCloseTo(4000 * Math.PI, 8);
  });
});
