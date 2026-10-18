/**
 * Planetary defence: kinetic-impactor momentum transfer (β), the resulting change of a binary asteroid's orbital
 * period (DART calibration case), heliocentric drift after a deflection, gravitational focusing, miss-distance
 * helpers and seeded Monte Carlo uncertainty bands.
 *
 * Units: SI (kg, m, s). Vectors are [x, y, z] tuples or Float64Array. Domain errors → NaN; nothing throws.
 */
import { G_SI } from '../core/units';
import type { ModelInfo } from './models';
import { propagateKepler } from './orbits';
import { createRng, distributionCenter, sampleDistribution, type Distribution } from './rng';
import { summarizeSamples, type SampleSummary } from './stats';

export const MODEL_KINETIC_IMPACT = 'kinetic-impact-beta@1';
export const MODEL_BINARY_PERIOD = 'binary-period-change@1';
export const MODEL_DEFLECTION_DRIFT = 'deflection-drift@1';
export const MODEL_GRAV_FOCUSING = 'gravitational-focusing@1';

export type Vec3 = readonly [number, number, number] | Float64Array;

// ── Momentum transfer ─────────────────────────────────────────────────────────────────────

export interface KineticImpactInput {
  impactorMassKg: number;
  /** Target mass M (the body whose velocity changes). */
  asteroidMassKg: number;
  /** Impactor velocity relative to the target, U (m/s). */
  relativeVelocityMS: Vec3;
  /** Momentum enhancement factor β ≥ 1 (1 = no ejecta; DART measured ≈ 3.6). */
  beta: number;
  /**
   * Optional surface normal at the impact site (either sign; the formula is quadratic in n̂). When given, the
   * ejecta recoil acts along the normal (Cheng et al. 2023): M Δv = m U + (β − 1) m (n̂·U) n̂.
   * Omitted → textbook simplification Δv = β (m/M) U (ejecta recoil along U).
   */
  surfaceNormal?: Vec3;
}

export interface KineticImpactResult {
  deltaVMS: [number, number, number];
  deltaVMagnitudeMS: number;
}

/**
 * Velocity change of an asteroid hit by a kinetic impactor (model 'kinetic-impact-beta@1'):
 *   Δv = β (m / M) U   (textbook form; momentum enhanced by ejecta thrown back along the impact direction).
 * With a surface normal n̂: M Δv = m U + (β − 1) m (n̂·U) n̂ — the ejecta recoil is along the normal.
 */
export function kineticImpactDeltaV(input: KineticImpactInput): KineticImpactResult {
  const { impactorMassKg: m, asteroidMassKg: M, relativeVelocityMS: U, beta } = input;
  const bad: KineticImpactResult = { deltaVMS: [NaN, NaN, NaN], deltaVMagnitudeMS: NaN };
  if (!(m > 0) || !(M > 0) || !(beta >= 0)) return bad;
  const k = m / M;
  let dx: number, dy: number, dz: number;
  if (input.surfaceNormal) {
    const n = input.surfaceNormal;
    const nl = Math.hypot(n[0], n[1], n[2]);
    if (!(nl > 0)) return bad;
    const nx = n[0] / nl, ny = n[1] / nl, nz = n[2] / nl;
    const nu = nx * U[0] + ny * U[1] + nz * U[2];
    dx = k * (U[0] + (beta - 1) * nu * nx);
    dy = k * (U[1] + (beta - 1) * nu * ny);
    dz = k * (U[2] + (beta - 1) * nu * nz);
  } else {
    dx = beta * k * U[0];
    dy = beta * k * U[1];
    dz = beta * k * U[2];
  }
  return { deltaVMS: [dx, dy, dz], deltaVMagnitudeMS: Math.hypot(dx, dy, dz) };
}

/** Mass of a homogeneous sphere: M = ρ (π/6) D³. */
export function sphereMassKg(diameterM: number, densityKgM3: number): number {
  return diameterM > 0 && densityKgM3 > 0 ? (densityKgM3 * Math.PI * diameterM ** 3) / 6 : NaN;
}

// ── Binary period change (DART) ───────────────────────────────────────────────────────────

export interface BinaryPeriodInput {
  /** Pre-impact separation (circular mutual orbit radius), m. */
  separationM: number;
  /** Either the pre-impact orbital period (preferred, it defines μ) … */
  periodS?: number;
  /** … or the total system mass M₁ + M₂, kg. */
  systemMassKg?: number;
  /** Δv along the secondary's orbital velocity (negative = against the motion, as for DART), m/s. */
  alongTrackDeltaVMS: number;
  /** Optional radial Δv (outward positive), m/s. */
  radialDeltaVMS?: number;
}

export interface BinaryPeriodResult {
  muM3S2: number;
  orbitalSpeedMS: number;
  periodBeforeS: number;
  periodAfterS: number;
  deltaPeriodS: number;
  semiMajorAxisAfterM: number;
  eccentricityAfter: number;
  /** First-order estimate ΔP ≈ 3 P Δv_T / v, for the "show calculation" panel. */
  deltaPeriodLinearS: number;
}

/**
 * Orbital-period change of a binary asteroid's secondary after an impulsive Δv, from vis-viva
 * (model 'binary-period-change@1'): the circular orbit at radius r becomes an ellipse with
 *   1/a′ = 2/r − |v + Δv|²/μ,  P′ = 2π √(a′³/μ).
 * Treats the pair as a two-body problem with the impulse applied to the relative orbit (the primary's recoil and
 * the change in system mass are negligible); ignores the secondary's shape/spin coupling and ejecta torques.
 */
export function binaryPeriodChange(input: BinaryPeriodInput): BinaryPeriodResult {
  const r = input.separationM;
  let mu = NaN;
  if (input.periodS && input.periodS > 0) mu = (4 * Math.PI * Math.PI * r ** 3) / (input.periodS * input.periodS);
  else if (input.systemMassKg && input.systemMassKg > 0) mu = G_SI * input.systemMassKg;
  const nan: BinaryPeriodResult = {
    muM3S2: NaN, orbitalSpeedMS: NaN, periodBeforeS: NaN, periodAfterS: NaN, deltaPeriodS: NaN,
    semiMajorAxisAfterM: NaN, eccentricityAfter: NaN, deltaPeriodLinearS: NaN,
  };
  if (!(r > 0) || !(mu > 0) || !Number.isFinite(input.alongTrackDeltaVMS)) return nan;
  const v = Math.sqrt(mu / r);
  const P = 2 * Math.PI * Math.sqrt(r ** 3 / mu);
  const vt = v + input.alongTrackDeltaVMS;
  const vr = input.radialDeltaVMS ?? 0;
  const v2 = vt * vt + vr * vr;
  const invA = 2 / r - v2 / mu;
  if (!(invA > 0)) return { ...nan, muM3S2: mu, orbitalSpeedMS: v, periodBeforeS: P }; // escaped
  const a = 1 / invA;
  const h = r * vt; // specific angular momentum
  const e = Math.sqrt(Math.max(0, 1 - (h * h) / (mu * a)));
  const P2 = 2 * Math.PI * Math.sqrt(a ** 3 / mu);
  return {
    muM3S2: mu,
    orbitalSpeedMS: v,
    periodBeforeS: P,
    periodAfterS: P2,
    deltaPeriodS: P2 - P,
    semiMajorAxisAfterM: a,
    eccentricityAfter: e,
    deltaPeriodLinearS: (3 * P * input.alongTrackDeltaVMS) / v,
  };
}

/**
 * DART / Didymos–Dimorphos calibration inputs (pre-impact), used by the lab preset and the tests.
 * Values from the DART Investigation Team papers (see references in BINARY model docs). The measured period
 * change (Thomas et al. 2023) is −33.0 ± 1.0 min (3σ).
 */
export const DART_CALIBRATION = {
  /** Pre-impact orbital period 11.921 h (Thomas et al. 2023). */
  periodBeforeS: 11.921 * 3600,
  /** Pre-impact separation 1.189 km (Thomas et al. 2023). */
  separationM: 1189,
  /** Along-track Δv −2.70 ± 0.10 mm/s (Cheng et al. 2023). */
  alongTrackDeltaVMS: -2.7e-3,
  alongTrackDeltaVSigmaMS: 0.1e-3,
  /** Measured period change and 1σ (Thomas et al. 2023: −33.0 ± 1.0 min, 3σ). */
  measuredDeltaPeriodS: -33.0 * 60,
  measuredDeltaPeriodSigmaS: (1.0 / 3) * 60,
  /** DART spacecraft mass at impact (kg) and impact speed (m/s) (Cheng et al. 2023; Daly et al. 2023). */
  impactorMassKg: 579.4,
  impactSpeedMS: 6144.9,
  /** Dimorphos mass for a bulk density of 2400 kg/m³ (Cheng et al. 2023; Daly et al. 2023 volume). */
  dimorphosMassKg: 4.3e9,
  /** Momentum enhancement inferred for ρ = 2400 kg/m³: β = 3.61 (+0.19, −0.25) 1σ (Cheng et al. 2023). */
  beta: 3.61,
} as const;

// ── Heliocentric drift after deflection ───────────────────────────────────────────────────

/**
 * Secular along-track displacement after an along-track Δv on a near-circular orbit: Δs ≈ −3 Δv_T t
 * (Hill/Clohessy–Wiltshire; a prograde push raises the orbit, which then lags behind). Valid for t ≫ P/2π and small
 * Δv/v; ignores perturbations and orbit eccentricity.
 */
export function alongTrackDriftM(alongTrackDeltaVMS: number, elapsedS: number): number {
  return -3 * alongTrackDeltaVMS * elapsedS;
}

/**
 * Full Clohessy–Wiltshire relative motion after an along-track impulse on a circular orbit of mean motion n:
 * radial x = (2Δv/n)(1 − cos nt), along-track y = (4Δv/n) sin nt − 3Δv t. Writes [x, y] into `out`.
 */
export function cwAlongTrackImpulse(alongTrackDeltaVMS: number, meanMotionRadS: number, elapsedS: number, out: Float64Array | number[] = [0, 0]): Float64Array | number[] {
  const dv = alongTrackDeltaVMS;
  const n = meanMotionRadS;
  if (!(n > 0)) {
    out[0] = out[1] = NaN;
    return out;
  }
  const nt = n * elapsedS;
  out[0] = ((2 * dv) / n) * (1 - Math.cos(nt));
  out[1] = ((4 * dv) / n) * Math.sin(nt) - 3 * dv * elapsedS;
  return out;
}

/** Along-track Δv needed to shift arrival by `missDistanceM` with `leadTimeS` of warning (linear estimate). */
export function requiredAlongTrackDeltaVMS(missDistanceM: number, leadTimeS: number): number {
  return missDistanceM >= 0 && leadTimeS > 0 ? missDistanceM / (3 * leadTimeS) : NaN;
}

export interface DeflectionPropagation {
  /** Deflected minus nominal position after `elapsedS`, m. */
  displacementM: [number, number, number];
  displacementMagnitudeM: number;
  /** Linear estimate 3|Δv_T| t for comparison. */
  linearEstimateM: number;
}

const DEF_S0 = new Float64Array(6);
const DEF_S1 = new Float64Array(6);
const DEF_OUT0 = new Float64Array(6);
const DEF_OUT1 = new Float64Array(6);

/**
 * Exact two-body comparison of a nominal and a deflected heliocentric orbit (model 'deflection-drift@1'):
 * both states are propagated with universal-variable Kepler propagation and differenced.
 * NEGLECTED: planetary perturbations and close-approach focusing, Yarkovsky/YORP, solar radiation pressure,
 * relativistic precession, non-impulsive momentum transfer.
 */
export function propagateDeflection(state0: ArrayLike<number>, muM3S2: number, deltaVMS: Vec3, elapsedS: number): DeflectionPropagation {
  for (let i = 0; i < 6; i++) DEF_S0[i] = DEF_S1[i] = state0[i];
  DEF_S1[3] += deltaVMS[0];
  DEF_S1[4] += deltaVMS[1];
  DEF_S1[5] += deltaVMS[2];
  propagateKepler(DEF_S0, muM3S2, elapsedS, DEF_OUT0);
  propagateKepler(DEF_S1, muM3S2, elapsedS, DEF_OUT1);
  const dx = DEF_OUT1[0] - DEF_OUT0[0];
  const dy = DEF_OUT1[1] - DEF_OUT0[1];
  const dz = DEF_OUT1[2] - DEF_OUT0[2];
  const vx = DEF_S0[3], vy = DEF_S0[4], vz = DEF_S0[5];
  const vl = Math.hypot(vx, vy, vz);
  const dvT = vl > 0 ? (deltaVMS[0] * vx + deltaVMS[1] * vy + deltaVMS[2] * vz) / vl : NaN;
  return { displacementM: [dx, dy, dz], displacementMagnitudeM: Math.hypot(dx, dy, dz), linearEstimateM: Math.abs(3 * dvT * elapsedS) };
}

// ── Encounter geometry ────────────────────────────────────────────────────────────────────

/**
 * Gravitational-focusing capture radius b = R √(1 + v_esc²/v_∞²): an incoming body with impact parameter
 * below b hits the planet (hyperbolic two-body encounter). Earth: R = 6371 km, v_esc = 11.19 km/s.
 */
export function gravitationalFocusingRadiusM(planetRadiusM: number, escapeSpeedMS: number, vInfinityMS: number): number {
  if (!(planetRadiusM > 0) || !(escapeSpeedMS >= 0) || !(vInfinityMS > 0)) return NaN;
  return planetRadiusM * Math.sqrt(1 + (escapeSpeedMS * escapeSpeedMS) / (vInfinityMS * vInfinityMS));
}

/** Closest periapsis distance of a hyperbolic flyby with impact parameter b: r_p = (μ/v∞²)(√(1 + (b v∞²/μ)²) − 1). */
export function flybyPeriapsisM(impactParameterM: number, vInfinityMS: number, muM3S2: number): number {
  if (!(impactParameterM >= 0) || !(vInfinityMS > 0) || !(muM3S2 > 0)) return NaN;
  const k = muM3S2 / (vInfinityMS * vInfinityMS);
  return k * (Math.sqrt(1 + (impactParameterM / k) ** 2) - 1);
}

export interface ClosestApproach {
  /** Time of closest approach from now (negative = already past), s. */
  timeS: number;
  distanceM: number;
}

/** Straight-line closest approach for relative position r and relative velocity v (no gravity). */
export function closestApproachLinear(relPosM: Vec3, relVelMS: Vec3): ClosestApproach {
  const v2 = relVelMS[0] ** 2 + relVelMS[1] ** 2 + relVelMS[2] ** 2;
  if (!(v2 > 0)) return { timeS: NaN, distanceM: Math.hypot(relPosM[0], relPosM[1], relPosM[2]) };
  const t = -(relPosM[0] * relVelMS[0] + relPosM[1] * relVelMS[1] + relPosM[2] * relVelMS[2]) / v2;
  const x = relPosM[0] + relVelMS[0] * t, y = relPosM[1] + relVelMS[1] * t, z = relPosM[2] + relVelMS[2] * t;
  return { timeS: t, distanceM: Math.hypot(x, y, z) };
}

// ── Monte Carlo ───────────────────────────────────────────────────────────────────────────

export interface KineticImpactMonteCarloInput {
  impactorMassKg: Distribution;
  impactSpeedMS: Distribution;
  beta: Distribution;
  /** Target: either a mass distribution, or diameter + density (sphere). */
  asteroidMassKg?: Distribution;
  asteroidDiameterM?: Distribution;
  densityKgM3?: Distribution;
  /** Fraction of |Δv| that is along-track (cosine of the impact-to-orbit angle); default 1. */
  alongTrackFraction?: Distribution;
  /** If given, also sample the binary period change (Δv applied against the motion when alongTrackFraction > 0). */
  binary?: { separationM: number; periodS: number };
  count: number;
  seed: number | string;
}

export interface KineticImpactMonteCarloResult {
  deltaVMS: SampleSummary;
  deltaPeriodS: SampleSummary | null;
  /** Deterministic central-value result for the "Real" column. */
  nominalDeltaVMS: number;
  nominalDeltaPeriodS: number | null;
  seed: number | string;
  count: number;
}

/**
 * Seeded Monte Carlo over impactor, target and β uncertainties → summary bands (5/16/50/84/95 %) for |Δv| and,
 * optionally, the binary period change. Same seed + inputs ⇒ identical output.
 */
export function kineticImpactMonteCarlo(input: KineticImpactMonteCarloInput): KineticImpactMonteCarloResult {
  const n = Math.max(1, Math.floor(input.count));
  const rng = createRng(input.seed);
  const dv = new Float64Array(n);
  const dp = input.binary ? new Float64Array(n) : null;
  const one: Distribution = { kind: 'fixed', value: 1 };

  const trial = (pick: (d: Distribution) => number): [number, number] => {
    const m = pick(input.impactorMassKg);
    const U = pick(input.impactSpeedMS);
    const beta = pick(input.beta);
    const M = input.asteroidMassKg
      ? pick(input.asteroidMassKg)
      : sphereMassKg(pick(input.asteroidDiameterM ?? { kind: 'fixed', value: NaN }), pick(input.densityKgM3 ?? { kind: 'fixed', value: NaN }));
    const along = pick(input.alongTrackFraction ?? one);
    const mag = m > 0 && M > 0 && beta >= 0 ? (beta * m * U) / M : NaN;
    let period = NaN;
    if (input.binary && Number.isFinite(mag)) {
      period = binaryPeriodChange({ separationM: input.binary.separationM, periodS: input.binary.periodS, alongTrackDeltaVMS: -mag * along }).deltaPeriodS;
    }
    return [mag, period];
  };

  for (let i = 0; i < n; i++) {
    const [a, b] = trial((d) => sampleDistribution(rng, d));
    dv[i] = a;
    if (dp) dp[i] = b;
  }
  const [nomDv, nomDp] = trial(distributionCenter);
  return {
    deltaVMS: summarizeSamples(dv),
    deltaPeriodS: dp ? summarizeSamples(dp) : null,
    nominalDeltaVMS: nomDv,
    nominalDeltaPeriodS: input.binary ? nomDp : null,
    seed: input.seed,
    count: n,
  };
}

// ── Model documentation ───────────────────────────────────────────────────────────────────

const DART_REFS = [
  { citation: 'Cheng, A. F. et al. (2023), Momentum transfer from the DART mission kinetic impact on asteroid Dimorphos, Nature 616, 457', doi: '10.1038/s41586-023-05878-z' },
  { citation: 'Thomas, C. A. et al. (2023), Orbital period change of Dimorphos due to the DART kinetic impact, Nature 616, 448', doi: '10.1038/s41586-023-05805-2' },
  { citation: 'Daly, R. T. et al. (2023), Successful kinetic impact into an asteroid for planetary defence, Nature 616, 443', doi: '10.1038/s41586-023-05810-5' },
];

export const IMPACT_MODELS: readonly ModelInfo[] = [
  {
    id: 'kinetic-impact-beta',
    version: 1,
    title: 'Kinetic impactor momentum transfer',
    summary:
      'A spacecraft hitting an asteroid pushes it with its own momentum, multiplied by β because the crater ejecta ' +
      'fly off backwards like a rocket exhaust.',
    latex: String.raw`\Delta\vec v = \beta\,\frac{m}{M}\,\vec U`,
    extraLatex: [String.raw`M\,\Delta\vec v = m\vec U + (\beta - 1)\,m\,(\hat n\cdot\vec U)\,\hat n \quad(\hat n:\ \text{surface normal})`],
    variables: [
      { symbol: String.raw`\Delta\vec v`, meaning: 'Velocity change of the asteroid', unit: 'm/s' },
      { symbol: String.raw`\beta`, meaning: 'Momentum enhancement factor (1 = no ejecta; DART ≈ 3.6)', unit: '' },
      { symbol: 'm', meaning: 'Impactor mass', unit: 'kg' },
      { symbol: 'M', meaning: 'Asteroid mass', unit: 'kg' },
      { symbol: String.raw`\vec U`, meaning: 'Impact velocity relative to the asteroid', unit: 'm/s' },
    ],
    assumptions: [
      'Textbook form: ejecta momentum along the impact direction (exact form uses the surface normal).',
      'Impulsive, central impact; asteroid rotation and shape effects ignored.',
      'β depends on target strength and porosity and is uncertain before an impact.',
    ],
    validity: 'Small Δv compared with orbital speed; any impactor much lighter than the target.',
    kind: 'derived',
    references: [
      ...DART_REFS,
      { citation: 'Rivkin, A. S. et al. (2021), The Double Asteroid Redirection Test (DART): Planetary Defense Investigations and Requirements, PSJ 2, 173', doi: '10.3847/PSJ/ac063e' },
    ],
  },
  {
    id: 'binary-period-change',
    version: 1,
    title: 'Binary asteroid period change',
    summary:
      'Slowing Dimorphos in its orbit around Didymos makes the orbit smaller and faster — DART shortened it by about 33 minutes.',
    latex: String.raw`\frac{1}{a'} = \frac{2}{r} - \frac{(v + \Delta v_T)^{2}}{\mu},\qquad P' = 2\pi\sqrt{\frac{a'^{3}}{\mu}}`,
    extraLatex: [String.raw`\frac{\Delta P}{P} \approx 3\,\frac{\Delta v_T}{v}`, String.raw`\mu = \frac{4\pi^{2} r^{3}}{P^{2}}`],
    variables: [
      { symbol: 'r', meaning: 'Pre-impact separation (circular orbit)', unit: 'm' },
      { symbol: 'v', meaning: 'Pre-impact orbital speed', unit: 'm/s' },
      { symbol: String.raw`\Delta v_T`, meaning: 'Along-track velocity change', unit: 'm/s' },
      { symbol: "a'", meaning: 'New semi-major axis', unit: 'm' },
      { symbol: 'P', meaning: 'Orbital period', unit: 's' },
      { symbol: String.raw`\mu`, meaning: 'G (M_Didymos + M_Dimorphos)', unit: 'm3/s2' },
    ],
    assumptions: [
      'Point-mass two-body orbit, circular before the impact.',
      'Impulse applied instantaneously to the relative orbit; primary recoil negligible.',
      'Shape-induced (non-Keplerian) effects and post-impact reshaping ignored.',
    ],
    validity: '|Δv| ≪ v (DART: 2.7 mm/s vs 17 cm/s).',
    accuracy: 'Reproduces the measured DART period change within its uncertainty given the published Δv_T.',
    kind: 'derived',
    references: DART_REFS,
  },
  {
    id: 'deflection-drift',
    version: 1,
    title: 'Deflection drift over time',
    summary: 'A tiny push years in advance grows into a large shift in where the asteroid is when it would have met Earth.',
    latex: String.raw`\Delta s(t) \approx -3\,\Delta v_T\,t`,
    extraLatex: [String.raw`y(t) = \frac{4\Delta v_T}{n}\sin nt - 3\Delta v_T\,t,\quad x(t) = \frac{2\Delta v_T}{n}(1-\cos nt)`],
    variables: [
      { symbol: String.raw`\Delta s`, meaning: 'Along-track displacement', unit: 'm' },
      { symbol: String.raw`\Delta v_T`, meaning: 'Along-track velocity change', unit: 'm/s' },
      { symbol: 't', meaning: 'Time since deflection', unit: 's' },
      { symbol: 'n', meaning: 'Mean motion', unit: 'rad/s' },
    ],
    assumptions: [
      'Linear estimate: near-circular orbit, small Δv (Clohessy–Wiltshire/Hill).',
      'Exact two-body propagation neglects planetary perturbations, Yarkovsky, radiation pressure and relativity.',
    ],
    validity: 'Years to decades of lead time; close planetary encounters in between invalidate it.',
    kind: 'derived',
    references: [
      { citation: 'Clohessy, W. H. & Wiltshire, R. S. (1960), J. Aerospace Sci. 27, 653' },
      { citation: 'Ahrens, T. J. & Harris, A. W. (1992), Deflection and fragmentation of near-Earth asteroids, Nature 360, 429', doi: '10.1038/360429a0' },
    ],
  },
  {
    id: 'gravitational-focusing',
    version: 1,
    title: 'Gravitational focusing',
    summary: 'Earth\'s gravity pulls in passing objects, so its effective target size is larger than its physical size.',
    latex: String.raw`b = R\sqrt{1 + \frac{v_{\mathrm{esc}}^{2}}{v_\infty^{2}}}`,
    variables: [
      { symbol: 'b', meaning: 'Capture impact parameter', unit: 'm' },
      { symbol: 'R', meaning: 'Planet radius', unit: 'm' },
      { symbol: String.raw`v_{\mathrm{esc}}`, meaning: 'Surface escape speed', unit: 'm/s' },
      { symbol: String.raw`v_\infty`, meaning: 'Approach speed far from the planet', unit: 'm/s' },
    ],
    assumptions: ['Two-body hyperbolic encounter; no atmosphere; planet treated as a point mass outside R.'],
    validity: 'All encounters where the Sun\'s tide is negligible within the planet\'s Hill sphere.',
    kind: 'derived',
    references: [{ citation: 'Opik, E. J. (1951), Proc. R. Irish Acad. 54A, 165' }],
  },
];
