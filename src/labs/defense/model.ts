/**
 * Asteroid deflection lab: pure scenario maths on top of src/science/impact.ts (no React, no three.js).
 *
 * Part 1 (DART replay): the DART kinetic impact on Dimorphos, 26 Sep 2022 23:14:24 UTC, through
 *   kineticImpactDeltaV → along-track Δv → binaryPeriodChange → ΔP, with a seeded Monte Carlo band.
 * Part 2 (Defend Earth): a hypothetical impactor on a collision course; a kinetic impactor's along-track Δv grows into a
 *   B-plane offset (Clohessy–Wiltshire drift on an Earth-like 1 AU orbit), compared with Earth's gravitational-focusing
 *   capture radius; the Monte Carlo success probability uses the same seeded sampling as kineticImpactMonteCarlo.
 *
 * Units: SI. Everything is allocation-light and deterministic (same inputs + seed ⇒ same output).
 */
import {
  DART_CALIBRATION, MODEL_BINARY_PERIOD, MODEL_DEFLECTION_DRIFT, MODEL_GRAV_FOCUSING, MODEL_KINETIC_IMPACT,
  alongTrackDriftM, binaryPeriodChange, cwAlongTrackImpulse, gravitationalFocusingRadiusM, kineticImpactDeltaV,
  kineticImpactMonteCarlo, requiredAlongTrackDeltaVMS, sphereMassKg, type KineticImpactMonteCarloInput,
} from '../../science/impact';
import { createRng, sampleDistribution, type Distribution } from '../../science/rng';
import { summarizeSamples, type SampleSummary } from '../../science/stats';

export const MODELS_USED = { kinetic: MODEL_KINETIC_IMPACT, binary: MODEL_BINARY_PERIOD, drift: MODEL_DEFLECTION_DRIFT, focusing: MODEL_GRAV_FOCUSING } as const;

export const YEAR_S = 365.25 * 86400;
export const MIN_S = 60;

// ── Reference values ─────────────────────────────────────────────────────────────────────────────────

/** DART impact epoch (Daly et al. 2023, Nature 616, 443: 2022-09-26 23:14:24.183 UTC). */
export const DART_IMPACT_UTC = '2022-09-26T23:14:24Z';
export const DART_IMPACT_MS = Date.UTC(2022, 8, 26, 23, 14, 24);

/** Dimorphos bulk density assumed by Cheng et al. 2023 for β = 3.61 (kg/m³). */
export const DIMORPHOS_DENSITY_KGM3 = 2400;
/** Dimorphos volume-equivalent mass for that density (DART_CALIBRATION.dimorphosMassKg). */
export const DIMORPHOS_VOLUME_M3 = DART_CALIBRATION.dimorphosMassKg / DIMORPHOS_DENSITY_KGM3;

/** β 1σ interval published by Cheng et al. 2023 (+0.19 / −0.25); the Monte Carlo uses the mean half-width. */
export const DART_BETA_SIGMA = 0.22;

/**
 * Effective along-track fraction of the textbook |Δv| = β m U / M for the DART geometry: DART's velocity and the ejecta
 * recoil were not exactly anti-parallel to Dimorphos's orbital motion. Calibrated so that the published m, U, M and β
 * reproduce the published along-track Δv_T = −2.70 mm/s (Cheng et al. 2023): f = |Δv_T| / (β m U / M) ≈ 0.90.
 */
export const DART_ALONG_TRACK_FACTOR =
  Math.abs(DART_CALIBRATION.alongTrackDeltaVMS) /
  ((DART_CALIBRATION.beta * DART_CALIBRATION.impactorMassKg * DART_CALIBRATION.impactSpeedMS) / DART_CALIBRATION.dimorphosMassKg);

/** Earth: IUGG mean radius and surface escape speed. */
export const EARTH_RADIUS_M = 6_371_000;
export const EARTH_ESCAPE_MS = 11_186;
/** Mean Earth–Moon distance (m), for B-plane scale comparisons. */
export const LUNAR_DISTANCE_M = 384_400_000;
/** Mean motion of an Earth-like 1 AU circular heliocentric orbit (sidereal year 365.25636 d). */
export const EARTH_LIKE_MEAN_MOTION_RAD_S = (2 * Math.PI) / (365.25636 * 86400);

// ── Part 1: DART replay ──────────────────────────────────────────────────────────────────────────────

export interface DartInputs {
  impactorMassKg: number;
  impactSpeedMS: number;
  beta: number;
  /** Dimorphos bulk density (kg/m³); mass = density × volume (Daly et al. 2023 shape). */
  densityKgM3: number;
}

export const DART_REAL: DartInputs = {
  impactorMassKg: DART_CALIBRATION.impactorMassKg,
  impactSpeedMS: DART_CALIBRATION.impactSpeedMS,
  beta: DART_CALIBRATION.beta,
  densityKgM3: DIMORPHOS_DENSITY_KGM3,
};

export interface DartResult {
  dimorphosMassKg: number;
  /** Textbook |Δv| = β m U / M (m/s). */
  deltaVMagnitudeMS: number;
  /** Along-track Δv (negative = against the orbital motion), m/s. */
  alongTrackDeltaVMS: number;
  periodBeforeS: number;
  periodAfterS: number;
  deltaPeriodS: number;
  deltaPeriodLinearS: number;
  semiMajorAxisAfterM: number;
  eccentricityAfter: number;
  orbitalSpeedMS: number;
  /** Monte Carlo band of ΔP (β uncertainty, exact vis-viva), s. */
  band: SampleSummary | null;
  /** Same trials through the first-order relation ΔP ≈ 3 P Δv_T / v (the replay headline), s. */
  bandLinear: SampleSummary | null;
  /** Momentum delivered by the spacecraft alone, m U (kg m/s). */
  momentumKgMS: number;
}

export function dartScenario(inp: DartInputs, mcCount = 2000): DartResult {
  const M = inp.densityKgM3 * DIMORPHOS_VOLUME_M3;
  const k = kineticImpactDeltaV({ impactorMassKg: inp.impactorMassKg, asteroidMassKg: M, relativeVelocityMS: [inp.impactSpeedMS, 0, 0], beta: inp.beta });
  const dvT = -k.deltaVMagnitudeMS * DART_ALONG_TRACK_FACTOR;
  const b = binaryPeriodChange({ separationM: DART_CALIBRATION.separationM, periodS: DART_CALIBRATION.periodBeforeS, alongTrackDeltaVMS: dvT });
  let band: SampleSummary | null = null;
  let bandLinear: SampleSummary | null = null;
  if (mcCount > 0) {
    const mc = kineticImpactMonteCarlo({
      impactorMassKg: { kind: 'fixed', value: inp.impactorMassKg },
      impactSpeedMS: { kind: 'fixed', value: inp.impactSpeedMS },
      beta: { kind: 'normal', mean: inp.beta, sigma: DART_BETA_SIGMA, min: 1 },
      asteroidMassKg: { kind: 'fixed', value: M },
      alongTrackFraction: { kind: 'fixed', value: DART_ALONG_TRACK_FACTOR },
      binary: { separationM: DART_CALIBRATION.separationM, periodS: DART_CALIBRATION.periodBeforeS },
      count: mcCount,
      seed: 'defense-dart',
    });
    band = mc.deltaPeriodS;
    bandLinear = scaleSummary(mc.deltaVMS, (-3 * b.periodBeforeS * DART_ALONG_TRACK_FACTOR) / b.orbitalSpeedMS);
  }
  return {
    dimorphosMassKg: M,
    deltaVMagnitudeMS: k.deltaVMagnitudeMS,
    alongTrackDeltaVMS: dvT,
    periodBeforeS: b.periodBeforeS,
    periodAfterS: b.periodAfterS,
    deltaPeriodS: b.deltaPeriodS,
    deltaPeriodLinearS: b.deltaPeriodLinearS,
    semiMajorAxisAfterM: b.semiMajorAxisAfterM,
    eccentricityAfter: b.eccentricityAfter,
    orbitalSpeedMS: b.orbitalSpeedMS,
    band,
    bandLinear,
    momentumKgMS: inp.impactorMassKg * inp.impactSpeedMS,
  };
}

/** Summary of k·x from the summary of x (percentiles swap when k < 0). */
function scaleSummary(x: SampleSummary, k: number): SampleSummary {
  const lo = k < 0;
  return {
    count: x.count, invalid: x.invalid, mean: x.mean * k, std: x.std * Math.abs(k),
    min: (lo ? x.max : x.min) * k, max: (lo ? x.min : x.max) * k,
    p05: (lo ? x.p95 : x.p05) * k, p16: (lo ? x.p84 : x.p16) * k, p50: x.p50 * k,
    p84: (lo ? x.p16 : x.p84) * k, p95: (lo ? x.p05 : x.p95) * k,
  };
}

export function dartModified(inp: DartInputs): boolean {
  return (Object.keys(DART_REAL) as (keyof DartInputs)[]).some(k => Math.abs(inp[k] - DART_REAL[k]) > 1e-9 * Math.max(1, Math.abs(DART_REAL[k])));
}

// ── Part 2: defend Earth ─────────────────────────────────────────────────────────────────────────────

export interface EarthInputs {
  diameterM: number;
  densityKgM3: number;
  warningYears: number;
  impactorMassKg: number;
  impactSpeedMS: number;
  beta: number;
  /** Asteroid approach speed relative to Earth far from it, v∞ (m/s). */
  vInfinityMS: number;
}

/** Default hypothetical scenario: a 100 m stony asteroid on a collision course, a DART-class spacecraft, 10 years of warning. */
export const EARTH_DEFAULT: EarthInputs = {
  diameterM: 100,
  densityKgM3: 2000,
  warningYears: 10,
  impactorMassKg: 580,
  impactSpeedMS: 6100,
  beta: 3.6,
  vInfinityMS: 12_000,
};

/** Uncertainty model for the success probability (assumptions shown in the lab). */
export const EARTH_UNCERTAINTY = {
  impactorMassRel: 0.01,
  impactSpeedRel: 0.02,
  betaSigma: 0.5,
  diameterRel: 0.1,
  densityRel: 0.25,
  alongTrackMin: 0.85,
  alongTrackMax: 1.0,
} as const;

export const EARTH_MC_SEED = 'defense-earth';

export function earthMonteCarloInput(inp: EarthInputs, count: number): KineticImpactMonteCarloInput {
  const u = EARTH_UNCERTAINTY;
  return {
    impactorMassKg: { kind: 'normal', mean: inp.impactorMassKg, sigma: u.impactorMassRel * inp.impactorMassKg, min: 0 },
    impactSpeedMS: { kind: 'normal', mean: inp.impactSpeedMS, sigma: u.impactSpeedRel * inp.impactSpeedMS, min: 0 },
    beta: { kind: 'normal', mean: inp.beta, sigma: u.betaSigma, min: 1 },
    asteroidDiameterM: { kind: 'normal', mean: inp.diameterM, sigma: u.diameterRel * inp.diameterM, min: 0.2 * inp.diameterM },
    densityKgM3: { kind: 'normal', mean: inp.densityKgM3, sigma: u.densityRel * inp.densityKgM3, min: 500 },
    alongTrackFraction: { kind: 'uniform', min: u.alongTrackMin, max: u.alongTrackMax },
    count,
    seed: EARTH_MC_SEED,
  };
}

/** B-plane displacement per unit along-track Δv after `elapsedS` on an Earth-like orbit (Clohessy–Wiltshire), m per m/s. */
const CW_TMP = [0, 0];
export function displacementPerUnitDeltaV(elapsedS: number): number {
  cwAlongTrackImpulse(1, EARTH_LIKE_MEAN_MOTION_RAD_S, elapsedS, CW_TMP);
  return Math.hypot(CW_TMP[0], CW_TMP[1]);
}

export interface EarthResult {
  asteroidMassKg: number;
  /** Nominal |Δv| (m/s), along-track fraction 1. */
  deltaVMS: number;
  /** Nominal B-plane miss distance from Earth's centre (m). */
  missM: number;
  /** Linear secular estimate 3 Δv t (m), for the explanation. */
  missLinearM: number;
  captureRadiusM: number;
  /** Along-track Δv needed to clear the capture radius with this warning (CW model), m/s. */
  requiredDeltaVMS: number;
  /** Linear rule of thumb b / (3 t), m/s. */
  requiredDeltaVLinearMS: number;
  /** Warning time needed with this spacecraft (linear estimate), years. */
  requiredWarningYears: number;
  /** Fraction of Monte Carlo trials that clear the capture radius. */
  successProbability: number;
  /** Miss-distance samples summary (m). */
  missBand: SampleSummary;
  /** Δv summary from kineticImpactMonteCarlo (m/s). */
  deltaVBand: SampleSummary;
  /** First `rugCount` miss samples for the B-plane rug (m). */
  rug: Float64Array;
  /** Kinetic energy of the undeflected impact (J) and in megatons TNT. */
  impactEnergyJ: number;
  impactEnergyMt: number;
  /** Impact speed at Earth's surface √(v∞² + v_esc²), m/s. */
  impactSurfaceSpeedMS: number;
}

const MT_TNT_J = 4.184e15;

/**
 * Hypothetical defence scenario. Δv samples are drawn exactly as kineticImpactMonteCarlo draws them (same seed and
 * sampling order), so the success probability and the summary bands describe the same trials.
 */
export function earthScenario(inp: EarthInputs, count = 2000, rugCount = 240): EarthResult {
  const t = inp.warningYears * YEAR_S;
  const M = sphereMassKg(inp.diameterM, inp.densityKgM3);
  const dv = M > 0 ? (inp.beta * inp.impactorMassKg * inp.impactSpeedMS) / M : NaN;
  const g = displacementPerUnitDeltaV(t);
  const b = gravitationalFocusingRadiusM(EARTH_RADIUS_M, EARTH_ESCAPE_MS, inp.vInfinityMS);
  const mcIn = earthMonteCarloInput(inp, count);
  const mc = kineticImpactMonteCarlo(mcIn);

  // Re-draw the same trials (identical order to kineticImpactMonteCarlo's trial()) to classify each one.
  const rng = createRng(mcIn.seed);
  const n = mc.count;
  const miss = new Float64Array(n);
  const pick = (d: Distribution): number => sampleDistribution(rng, d);
  let ok = 0;
  for (let i = 0; i < n; i++) {
    const m = pick(mcIn.impactorMassKg);
    const U = pick(mcIn.impactSpeedMS);
    const beta = pick(mcIn.beta);
    const Ms = sphereMassKg(pick(mcIn.asteroidDiameterM!), pick(mcIn.densityKgM3!));
    const along = pick(mcIn.alongTrackFraction!);
    const mag = m > 0 && Ms > 0 && beta >= 0 ? (beta * m * U) / Ms : NaN;
    const d = mag * along * g;
    miss[i] = d;
    if (d > b) ok++;
  }
  const v2 = inp.vInfinityMS ** 2 + EARTH_ESCAPE_MS ** 2;
  const energy = 0.5 * M * v2;
  const req = requiredAlongTrackDeltaVMS(b, t);
  return {
    asteroidMassKg: M,
    deltaVMS: dv,
    missM: dv * g,
    missLinearM: Math.abs(alongTrackDriftM(dv, t)),
    captureRadiusM: b,
    requiredDeltaVMS: g > 0 ? b / g : NaN,
    requiredDeltaVLinearMS: req,
    requiredWarningYears: dv > 0 ? b / (3 * dv) / YEAR_S : NaN,
    successProbability: n > 0 ? ok / n : NaN,
    missBand: summarizeSamples(miss),
    deltaVBand: mc.deltaVMS,
    rug: miss.slice(0, Math.min(rugCount, n)),
    impactEnergyJ: energy,
    impactEnergyMt: energy / MT_TNT_J,
    impactSurfaceSpeedMS: Math.sqrt(v2),
  };
}

export function earthModifiedFromDefault(inp: EarthInputs): boolean {
  return (Object.keys(EARTH_DEFAULT) as (keyof EarthInputs)[]).some(k => Math.abs(inp[k] - EARTH_DEFAULT[k]) > 1e-9 * Math.max(1, Math.abs(EARTH_DEFAULT[k])));
}

/** Nominal miss distance (m) for a given warning time (years), the rest of the inputs fixed — for the warning-time chart. */
export function missForWarning(years: number, deltaVMS: number): number {
  return deltaVMS * displacementPerUnitDeltaV(years * YEAR_S);
}

export type Outcome = 'deflected' | 'likely' | 'uncertain' | 'fails';

export function outcomeOf(p: number): Outcome {
  if (!(p >= 0)) return 'fails';
  if (p >= 0.99) return 'deflected';
  if (p >= 0.9) return 'likely';
  if (p >= 0.1) return 'uncertain';
  return 'fails';
}
