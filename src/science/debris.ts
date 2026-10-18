/**
 * Orbital debris / Kessler-syndrome science (EDUCATIONAL APPROXIMATIONS — every output of this module must be
 * presented as such): exponential atmosphere, drag decay and orbital lifetime of circular orbits, a simplified
 * NASA Standard Breakup Model, kinetic-gas collision rates, a deterministic multi-shell source–sink population model
 * with mitigation policies, and metadata on mitigation concepts with their maturity.
 *
 * Units: SI (m, kg, s) internally; the population model's clock is in years (names say so).
 * Domain errors → NaN; nothing throws.
 */
import { GM_EARTH, JULIAN_YEAR_S, R_EARTH_EQ_M } from '../core/units';
import type { ModelInfo, ModelReference } from './models';
import { createRng, type Rng } from './rng';

export const MODEL_ATMOSPHERE = 'exponential-atmosphere@1';
export const MODEL_DRAG_LIFETIME = 'drag-lifetime-circular@1';
export const MODEL_BREAKUP = 'nasa-sbm-simplified@1';
export const MODEL_SHELL = 'debris-shell-source-sink@1';

// ── Atmosphere ────────────────────────────────────────────────────────────────────────────

export interface AtmosphereLayer {
  baseAltitudeKm: number;
  densityKgM3: number;
  scaleHeightKm: number;
}

/**
 * Piecewise exponential atmosphere, Vallado (2013) Table 8-4 (U.S. Standard Atmosphere 1976 below 25 km,
 * CIRA-72 above, moderate solar activity): ρ(h) = ρ0 exp(−(h − h0)/H) within each layer.
 */
export const EXPONENTIAL_ATMOSPHERE: readonly AtmosphereLayer[] = [
  { baseAltitudeKm: 0, densityKgM3: 1.225, scaleHeightKm: 7.249 },
  { baseAltitudeKm: 25, densityKgM3: 3.899e-2, scaleHeightKm: 6.349 },
  { baseAltitudeKm: 30, densityKgM3: 1.774e-2, scaleHeightKm: 6.682 },
  { baseAltitudeKm: 40, densityKgM3: 3.972e-3, scaleHeightKm: 7.554 },
  { baseAltitudeKm: 50, densityKgM3: 1.057e-3, scaleHeightKm: 8.382 },
  { baseAltitudeKm: 60, densityKgM3: 3.206e-4, scaleHeightKm: 7.714 },
  { baseAltitudeKm: 70, densityKgM3: 8.77e-5, scaleHeightKm: 6.549 },
  { baseAltitudeKm: 80, densityKgM3: 1.905e-5, scaleHeightKm: 5.799 },
  { baseAltitudeKm: 90, densityKgM3: 3.396e-6, scaleHeightKm: 5.382 },
  { baseAltitudeKm: 100, densityKgM3: 5.297e-7, scaleHeightKm: 5.877 },
  { baseAltitudeKm: 110, densityKgM3: 9.661e-8, scaleHeightKm: 7.263 },
  { baseAltitudeKm: 120, densityKgM3: 2.438e-8, scaleHeightKm: 9.473 },
  { baseAltitudeKm: 130, densityKgM3: 8.484e-9, scaleHeightKm: 12.636 },
  { baseAltitudeKm: 140, densityKgM3: 3.845e-9, scaleHeightKm: 16.149 },
  { baseAltitudeKm: 150, densityKgM3: 2.07e-9, scaleHeightKm: 22.523 },
  { baseAltitudeKm: 180, densityKgM3: 5.464e-10, scaleHeightKm: 29.74 },
  { baseAltitudeKm: 200, densityKgM3: 2.789e-10, scaleHeightKm: 37.105 },
  { baseAltitudeKm: 250, densityKgM3: 7.248e-11, scaleHeightKm: 45.546 },
  { baseAltitudeKm: 300, densityKgM3: 2.418e-11, scaleHeightKm: 53.628 },
  { baseAltitudeKm: 350, densityKgM3: 9.518e-12, scaleHeightKm: 53.298 },
  { baseAltitudeKm: 400, densityKgM3: 3.725e-12, scaleHeightKm: 58.515 },
  { baseAltitudeKm: 450, densityKgM3: 1.585e-12, scaleHeightKm: 60.828 },
  { baseAltitudeKm: 500, densityKgM3: 6.967e-13, scaleHeightKm: 63.822 },
  { baseAltitudeKm: 600, densityKgM3: 1.454e-13, scaleHeightKm: 71.835 },
  { baseAltitudeKm: 700, densityKgM3: 3.614e-14, scaleHeightKm: 88.667 },
  { baseAltitudeKm: 800, densityKgM3: 1.17e-14, scaleHeightKm: 124.64 },
  { baseAltitudeKm: 900, densityKgM3: 5.245e-15, scaleHeightKm: 181.05 },
  { baseAltitudeKm: 1000, densityKgM3: 3.019e-15, scaleHeightKm: 268.0 },
];

/**
 * Multipliers on the moderate-activity density for the thermosphere. Real density at 400–600 km varies by
 * roughly an order of magnitude over the 11-year solar cycle; these round factors reproduce that spread
 * (approximation, not a solar-flux-driven model such as NRLMSISE-00 or JB2008).
 */
export const SOLAR_ACTIVITY_FACTOR = { low: 0.35, moderate: 1, high: 2.8 } as const;

/**
 * Atmospheric density at geometric altitude h (m). `solarActivityFactor` scales the density, phased in between
 * 100 km (no effect) and 250 km (full effect) because solar EUV heating acts on the thermosphere.
 */
export function atmosphericDensityKgM3(altitudeM: number, solarActivityFactor = 1): number {
  if (!Number.isFinite(altitudeM) || !(solarActivityFactor > 0)) return NaN;
  const hKm = Math.max(0, altitudeM / 1000);
  let i = EXPONENTIAL_ATMOSPHERE.length - 1;
  while (i > 0 && EXPONENTIAL_ATMOSPHERE[i].baseAltitudeKm > hKm) i--;
  const L = EXPONENTIAL_ATMOSPHERE[i];
  const rho = L.densityKgM3 * Math.exp(-(hKm - L.baseAltitudeKm) / L.scaleHeightKm);
  if (solarActivityFactor === 1) return rho;
  const w = Math.min(1, Math.max(0, (hKm - 100) / 150));
  return rho * Math.pow(solarActivityFactor, w);
}

// ── Drag decay ────────────────────────────────────────────────────────────────────────────

export const DEFAULT_DRAG_COEFFICIENT = 2.2;
/** Altitude treated as re-entry for lifetime estimates (decay below it takes hours to days). */
export const REENTRY_ALTITUDE_M = 100e3;

/**
 * Semi-major-axis decay rate of a circular orbit, da/dt = −ρ (C_D A/m) √(μ a) (m/s, negative).
 * From the drag acceleration ½ρv²C_D A/m acting on v = √(μ/a) (King-Hele 1987).
 */
export function circularDecayRateMS(altitudeM: number, areaToMassM2Kg: number, cd = DEFAULT_DRAG_COEFFICIENT, solarActivityFactor = 1): number {
  if (!(areaToMassM2Kg > 0) || !(cd > 0)) return NaN;
  const a = R_EARTH_EQ_M + altitudeM;
  return -atmosphericDensityKgM3(altitudeM, solarActivityFactor) * cd * areaToMassM2Kg * Math.sqrt(GM_EARTH * a);
}

export interface LifetimeInput {
  altitudeM: number;
  /** Area-to-mass ratio A/m, m²/kg (≈ 0.005–0.02 for intact satellites, 0.05–1 for fragments). */
  areaToMassM2Kg: number;
  cd?: number;
  solarActivityFactor?: number;
  /** Stop integrating beyond this many years (lifetime reported as Infinity). Default 10 000. */
  maxYears?: number;
}

export interface LifetimeResult {
  /** Time to decay from `altitudeM` to 100 km, s; Infinity if beyond `maxYears`. */
  lifetimeS: number;
  lifetimeYears: number;
  exceedsCap: boolean;
  model: typeof MODEL_DRAG_LIFETIME;
}

/**
 * Orbital lifetime of a circular orbit under drag (model 'drag-lifetime-circular@1'):
 *   t = ∫_{a_reentry}^{a0} da / (ρ(a) C_D (A/m) √(μ a)),
 * integrated with Simpson's rule in 0.5 km steps. Assumes constant attitude-averaged A/m, a static (time-
 * independent) atmosphere for the chosen activity level and an orbit that stays circular. Real lifetimes vary by
 * a factor of ~2–3 with the solar cycle and A/m knowledge.
 */
export function orbitalLifetime(input: LifetimeInput): LifetimeResult {
  const cd = input.cd ?? DEFAULT_DRAG_COEFFICIENT;
  const f = input.solarActivityFactor ?? 1;
  const capS = (input.maxYears ?? 10_000) * JULIAN_YEAR_S;
  const out = (s: number, exceeds: boolean): LifetimeResult => ({
    lifetimeS: s, lifetimeYears: s / JULIAN_YEAR_S, exceedsCap: exceeds, model: MODEL_DRAG_LIFETIME,
  });
  if (!(input.altitudeM >= 0) || !(input.areaToMassM2Kg > 0) || !(cd > 0) || !(f > 0)) return out(NaN, false);
  if (input.altitudeM <= REENTRY_ALTITUDE_M) return out(0, false);
  const integrand = (h: number): number => -1 / circularDecayRateMS(h, input.areaToMassM2Kg, cd, f);
  const step = 500;
  let t = 0;
  for (let h = REENTRY_ALTITUDE_M; h < input.altitudeM; h += step) {
    const h1 = Math.min(input.altitudeM, h + step);
    t += ((h1 - h) / 6) * (integrand(h) + 4 * integrand(0.5 * (h + h1)) + integrand(h1));
    if (t > capS) return out(Infinity, true);
  }
  return out(t, false);
}

// ── NASA Standard Breakup Model (simplified) ─────────────────────────────────────────────

/** Specific energy threshold for a catastrophic collision, J/kg (40 J/g; Johnson et al. 2001). */
export const CATASTROPHIC_ENERGY_J_PER_KG = 40_000;

export interface CollisionPair {
  projectileMassKg: number;
  targetMassKg: number;
  impactSpeedMS: number;
}

/** E* = ½ m_p v² / m_t ≥ 40 J/g ⇒ catastrophic (both objects fragment completely). */
export function isCatastrophicCollision(c: CollisionPair): boolean {
  const mp = Math.min(c.projectileMassKg, c.targetMassKg);
  const mt = Math.max(c.projectileMassKg, c.targetMassKg);
  return (0.5 * mp * c.impactSpeedMS * c.impactSpeedMS) / mt >= CATASTROPHIC_ENERGY_J_PER_KG;
}

/**
 * Number of collision fragments larger than characteristic length Lc (m): N(Lc) = 0.1 M^0.75 Lc^−1.71, with
 * M = m_t + m_p (kg) for catastrophic collisions, M = m_p v² (kg, v in km/s) otherwise (Johnson et al. 2001).
 */
export function collisionFragmentCount(lcM: number, c: CollisionPair): number {
  if (!(lcM > 0) || !(c.projectileMassKg > 0) || !(c.targetMassKg > 0) || !(c.impactSpeedMS > 0)) return NaN;
  const mp = Math.min(c.projectileMassKg, c.targetMassKg);
  const vKmS = c.impactSpeedMS / 1000;
  const M = isCatastrophicCollision(c) ? c.projectileMassKg + c.targetMassKg : mp * vKmS * vKmS;
  return 0.1 * Math.pow(M, 0.75) * Math.pow(lcM, -1.71);
}

/** Explosion fragments larger than Lc: N(Lc) = 6 S Lc^−1.6 (S: dimensionless type factor, 1 for typical upper stages). */
export function explosionFragmentCount(lcM: number, s = 1): number {
  return lcM > 0 && s > 0 ? 6 * s * Math.pow(lcM, -1.6) : NaN;
}

/** Average cross-sectional area from characteristic length (SBM): A = 0.540424 Lc² (Lc < 1.67 mm) else 0.556945 Lc^2.0047077. */
export function characteristicLengthToAreaM2(lcM: number): number {
  if (!(lcM > 0)) return NaN;
  return lcM < 0.001_67 ? 0.540_424 * lcM * lcM : 0.556_945 * Math.pow(lcM, 2.004_707_7);
}

export interface AreaToMassDistribution {
  /** Weight of the first normal component in log10(A/m). */
  alpha: number;
  mu1: number;
  sigma1: number;
  mu2: number;
  sigma2: number;
  /**
   * Set only for 8 cm < Lc < 11 cm: the SBM bridges the small- and large-fragment laws linearly — draw from
   * `large` with probability `weightLarge`, else from `small` (the top-level fields then describe `small`).
   */
  bridge?: { weightLarge: number; small: AreaToMassDistribution; large: AreaToMassDistribution };
}

const ramp = (x: number, x0: number, x1: number, y0: number, y1: number): number =>
  x <= x0 ? y0 : x >= x1 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);

/**
 * Distribution of log10(A/m) [m²/kg] for spacecraft fragments of characteristic length Lc (Johnson et al. 2001):
 * a bimodal normal for Lc > 11 cm, a single normal for Lc < 8 cm, linearly bridged between.
 */
export function areaToMassDistribution(lcM: number): AreaToMassDistribution {
  const l = Math.log10(lcM);
  // Small fragments (< 8 cm): single mode.
  const muS = l <= -1.75 ? -0.3 : l < -1.25 ? -0.3 - 1.4 * (l + 1.75) : -1.0;
  const sgS = l <= -3.5 ? 0.2 : 0.2 + 0.1333 * (l + 3.5);
  // Large spacecraft fragments (> 11 cm): two modes.
  const big: AreaToMassDistribution = {
    alpha: l <= -1.95 ? 0 : l < 0.55 ? 0.3 + 0.4 * (l + 1.2) : 1,
    mu1: ramp(l, -1.1, 0, -0.6, -0.95),
    sigma1: ramp(l, -1.3, -0.3, 0.1, 0.3),
    mu2: ramp(l, -0.7, -0.1, -1.2, -2.0),
    sigma2: ramp(l, -0.5, -0.3, 0.5, 0.3),
  };
  if (lcM >= 0.11) return big;
  const small: AreaToMassDistribution = { alpha: 1, mu1: muS, sigma1: sgS, mu2: muS, sigma2: sgS };
  if (lcM <= 0.08) return small;
  return { ...small, bridge: { weightLarge: (lcM - 0.08) / 0.03, small, large: big } };
}

/** Distribution of log10(Δv [m/s]) given χ = log10(A/m): collision μ = 0.9χ + 2.9, explosion μ = 0.2χ + 1.85, σ = 0.4. */
export function deltaVDistribution(log10AreaToMass: number, kind: 'collision' | 'explosion'): { mu: number; sigma: number } {
  return kind === 'collision' ? { mu: 0.9 * log10AreaToMass + 2.9, sigma: 0.4 } : { mu: 0.2 * log10AreaToMass + 1.85, sigma: 0.4 };
}

export interface BreakupInput {
  kind: 'collision' | 'explosion';
  /** Smallest characteristic length to generate, m (default 0.1). */
  lcMinM?: number;
  /** Largest characteristic length, m (default 1). */
  lcMaxM?: number;
  /** Collision participants (kind 'collision'). */
  collision?: CollisionPair;
  /** Explosion scaling S (kind 'explosion'). */
  explosionScale?: number;
  /** Cap on sampled fragments (the true count is still reported). Default 5000. */
  maxFragments?: number;
  seed: number | string;
}

export interface BreakupFragments {
  /** Expected number of fragments ≥ lcMin from the power law. */
  expectedCount: number;
  /** Number of fragments sampled into the arrays (≤ maxFragments). */
  sampledCount: number;
  characteristicLengthM: Float64Array;
  areaToMassM2Kg: Float64Array;
  massKg: Float64Array;
  /** Ejection speed relative to the parent, m/s (direction isotropic — sample with rng.sampleUnitSphere). */
  deltaVMS: Float64Array;
  model: typeof MODEL_BREAKUP;
}

function sampleLog10AreaToMass(rng: Rng, lcM: number): number {
  const d0 = areaToMassDistribution(lcM);
  const d = d0.bridge ? (rng.next() < d0.bridge.weightLarge ? d0.bridge.large : d0.bridge.small) : d0;
  return rng.next() < d.alpha ? rng.normal(d.mu1, d.sigma1) : rng.normal(d.mu2, d.sigma2);
}

/**
 * Seeded fragment cloud from the simplified NASA SBM (model 'nasa-sbm-simplified@1'): sizes from the power law by
 * inverse-CDF sampling between lcMin and lcMax, A/m from the spacecraft distribution, mass = A/(A/m), Δv from the
 * log-normal ejection law. Mass is NOT renormalised to the parent mass (a known SBM simplification).
 */
export function sampleBreakupFragments(input: BreakupInput): BreakupFragments {
  const lcMin = input.lcMinM ?? 0.1;
  const lcMax = Math.max(lcMin * 1.0001, input.lcMaxM ?? 1);
  const exponent = input.kind === 'collision' ? 1.71 : 1.6;
  const nAt = (lc: number): number =>
    input.kind === 'collision'
      ? input.collision ? collisionFragmentCount(lc, input.collision) : NaN
      : explosionFragmentCount(lc, input.explosionScale ?? 1);
  const expected = nAt(lcMin) - nAt(lcMax);
  const n = Number.isFinite(expected) ? Math.max(0, Math.min(input.maxFragments ?? 5000, Math.round(expected))) : 0;
  const rng = createRng(input.seed);
  const lc = new Float64Array(n), am = new Float64Array(n), mass = new Float64Array(n), dv = new Float64Array(n);
  const ratio = Math.pow(lcMin / lcMax, exponent);
  for (let i = 0; i < n; i++) {
    const u = rng.next();
    const L = lcMin * Math.pow(1 - u * (1 - ratio), -1 / exponent);
    const chi = sampleLog10AreaToMass(rng, L);
    const dvd = deltaVDistribution(chi, input.kind);
    lc[i] = L;
    am[i] = Math.pow(10, chi);
    mass[i] = characteristicLengthToAreaM2(L) / am[i];
    dv[i] = Math.pow(10, rng.normal(dvd.mu, dvd.sigma));
  }
  return { expectedCount: Number.isFinite(expected) ? expected : NaN, sampledCount: n, characteristicLengthM: lc, areaToMassM2Kg: am, massKg: mass, deltaVMS: dv, model: MODEL_BREAKUP };
}

// ── Collision rates ───────────────────────────────────────────────────────────────────────

/** Volume of a spherical shell between two altitudes, m³. */
export function shellVolumeM3(innerAltitudeM: number, outerAltitudeM: number): number {
  const r1 = R_EARTH_EQ_M + innerAltitudeM;
  const r2 = R_EARTH_EQ_M + outerAltitudeM;
  return r2 > r1 ? ((4 * Math.PI) / 3) * (r2 ** 3 - r1 ** 3) : NaN;
}

/**
 * Kinetic-gas collision rate for one object moving through a population of spatial density n:
 * rate = n σ v_rel (per second); returned per year. σ = π (r₁ + r₂)² (Kessler & Cour-Palais 1978).
 */
export function collisionRatePerYear(spatialDensityPerM3: number, crossSectionM2: number, relativeSpeedMS: number): number {
  if (!(spatialDensityPerM3 >= 0) || !(crossSectionM2 >= 0) || !(relativeSpeedMS >= 0)) return NaN;
  return spatialDensityPerM3 * crossSectionM2 * relativeSpeedMS * JULIAN_YEAR_S;
}

/** Collision cross-section of two spheres, σ = π (r₁ + r₂)². */
export const collisionCrossSectionM2 = (radius1M: number, radius2M: number): number => Math.PI * (radius1M + radius2M) ** 2;

// ── Multi-shell source–sink model ─────────────────────────────────────────────────────────

export interface PopulationTriple<T> {
  active: T;
  derelict: T;
  debris: T;
}

export interface ShellModelParams {
  /** Shell boundaries, m (length = shells + 1, ascending). */
  shellEdgesAltitudeM: readonly number[];
  /** Initial counts per shell. */
  initial: PopulationTriple<readonly number[]>;
  /** New active satellites per year per shell. */
  launchRatePerYear: readonly number[];
  /** Operational lifetime of active satellites, years. */
  missionLifetimeYears: number;
  /** Fraction of satellites that perform post-mission disposal successfully (0–1). */
  pmdCompliance: number;
  /** Compliant disposals leave the shell within this mean time, years (25-year rule, 5-year rule, 0 = immediate). */
  disposalLifetimeYears: number;
  /** Derelicts removed per year by active debris removal (distributed in proportion to derelict counts). */
  adrRemovalsPerYear: number;
  /** Fraction of potential collisions avoided by manoeuvring active satellites. */
  avoidance: { vsTracked: number; vsDebris: number };
  /** Mean relative impact speed in LEO, m/s (≈ 10 km/s). */
  relativeSpeedMS: number;
  /** Representative object radius, m. */
  radiusM: PopulationTriple<number>;
  /** Representative object mass, kg. */
  massKg: PopulationTriple<number>;
  /** Area-to-mass ratio, m²/kg (active satellites station-keep and do not decay). */
  areaToMassM2Kg: { derelict: number; debris: number };
  cd: number;
  solarActivityFactor: number;
  /** Fragments are counted down to this characteristic length, m (0.1 = the ~10 cm trackable limit). */
  fragmentLcMinM: number;
  /** Fraction of fragments deposited in the same shell; the rest is split between the neighbours. Default 0.5. */
  fragmentLocalFraction?: number;
}

export interface ShellModelResult {
  timesYears: Float64Array;
  totals: PopulationTriple<Float64Array>;
  /** Collisions per year (all pair types) at each output time. */
  collisionRatePerYear: Float64Array;
  /** Cumulative collisions since t = 0. */
  cumulativeCollisions: Float64Array;
  /** Final per-shell counts. */
  final: PopulationTriple<Float64Array>;
  shellCentersAltitudeM: Float64Array;
  model: typeof MODEL_SHELL;
}

/** Internal state layout: [S_0..S_{n-1}, D_0.., P_0.., N_0..] (P = derelicts on a compliant disposal trajectory). */
const POPS = 4;

interface ShellCoefficients {
  n: number;
  /** Pair collision coefficient φ = σ v / V per year for each shell and pair type. */
  phiSS: Float64Array; phiSD: Float64Array; phiSN: Float64Array; phiDD: Float64Array; phiDN: Float64Array; phiNN: Float64Array;
  /** Drag residence rates 1/τ (per year) for derelicts and debris. */
  dragD: Float64Array; dragN: Float64Array;
  /** Fragments ≥ Lc per collision type. */
  fragSD: number; fragSN: number; fragSS: number; fragDD: number; fragDN: number; fragNN: number;
}

function coefficients(p: ShellModelParams): ShellCoefficients {
  const n = p.shellEdgesAltitudeM.length - 1;
  const mk = () => new Float64Array(n);
  const c: ShellCoefficients = {
    n, phiSS: mk(), phiSD: mk(), phiSN: mk(), phiDD: mk(), phiDN: mk(), phiNN: mk(), dragD: mk(), dragN: mk(),
    fragSD: 0, fragSN: 0, fragSS: 0, fragDD: 0, fragDN: 0, fragNN: 0,
  };
  const v = p.relativeSpeedMS;
  const r = p.radiusM;
  for (let i = 0; i < n; i++) {
    const h0 = p.shellEdgesAltitudeM[i], h1 = p.shellEdgesAltitudeM[i + 1];
    const k = (v * JULIAN_YEAR_S) / shellVolumeM3(h0, h1);
    c.phiSS[i] = k * collisionCrossSectionM2(r.active, r.active);
    c.phiSD[i] = k * collisionCrossSectionM2(r.active, r.derelict);
    c.phiSN[i] = k * collisionCrossSectionM2(r.active, r.debris);
    c.phiDD[i] = k * collisionCrossSectionM2(r.derelict, r.derelict);
    c.phiDN[i] = k * collisionCrossSectionM2(r.derelict, r.debris);
    c.phiNN[i] = k * collisionCrossSectionM2(r.debris, r.debris);
    const hc = 0.5 * (h0 + h1);
    const dh = h1 - h0;
    const rate = (am: number): number => (-circularDecayRateMS(hc, am, p.cd, p.solarActivityFactor) * JULIAN_YEAR_S) / dh;
    c.dragD[i] = rate(p.areaToMassM2Kg.derelict);
    c.dragN[i] = rate(p.areaToMassM2Kg.debris);
  }
  const frag = (m1: number, m2: number): number =>
    collisionFragmentCount(p.fragmentLcMinM, { projectileMassKg: m1, targetMassKg: m2, impactSpeedMS: v });
  const m = p.massKg;
  c.fragSS = frag(m.active, m.active);
  c.fragSD = frag(m.active, m.derelict);
  c.fragSN = frag(m.debris, m.active);
  c.fragDD = frag(m.derelict, m.derelict);
  c.fragDN = frag(m.debris, m.derelict);
  c.fragNN = frag(m.debris, m.debris);
  return c;
}

/** Writes dX/dt into `dx` and returns the total collision rate (per year). */
function shellDerivative(p: ShellModelParams, c: ShellCoefficients, x: Float64Array, dx: Float64Array, fragScratch: Float64Array): number {
  const n = c.n;
  const aT = 1 - p.avoidance.vsTracked;
  const aN = 1 - p.avoidance.vsDebris;
  const pmd = p.pmdCompliance;
  const eol = 1 / p.missionLifetimeYears;
  const dispRate = p.disposalLifetimeYears > 0 ? 1 / p.disposalLifetimeYears : Infinity;
  let dTotal = 0;
  for (let i = 0; i < n; i++) dTotal += x[n + i] + x[2 * n + i];
  let total = 0;
  fragScratch.fill(0);

  for (let i = 0; i < n; i++) {
    const S = x[i], D = x[n + i], P = x[2 * n + i], N = x[3 * n + i];
    const DP = D + P;
    // Pair collision rates (per year). Same-population pairs carry ½ to avoid double counting.
    const cSS = 0.5 * aT * c.phiSS[i] * S * S;
    const cSD = aT * c.phiSD[i] * S * DP;
    const cSN = aN * c.phiSN[i] * S * N;
    const cDD = 0.5 * c.phiDD[i] * DP * DP;
    const cDN = c.phiDN[i] * DP * N;
    const cNN = 0.5 * c.phiNN[i] * N * N;
    total += cSS + cSD + cSN + cDD + cDN + cNN;
    fragScratch[i] = cSS * c.fragSS + cSD * c.fragSD + cSN * c.fragSN + cDD * c.fragDD + cDN * c.fragDN + cNN * c.fragNN;

    const shareD = DP > 0 ? D / DP : 0;
    const shareP = DP > 0 ? P / DP : 0;
    const dpLoss = cSD + 2 * cDD + cDN; // derelict-class objects destroyed
    const adr = dTotal > 0 ? (p.adrRemovalsPerYear * DP) / (dTotal + 1) : 0;

    dx[i] = p.launchRatePerYear[i] - eol * S - 2 * cSS - cSD - cSN;
    const toDisposal = Number.isFinite(dispRate) ? pmd * eol * S : 0;
    dx[n + i] = (1 - pmd) * eol * S - c.dragD[i] * D - shareD * (dpLoss + adr);
    dx[2 * n + i] = toDisposal - (c.dragD[i] + (Number.isFinite(dispRate) ? dispRate : 0)) * P - shareP * (dpLoss + adr);
    dx[3 * n + i] = -c.dragN[i] * N - cSN - cDN - 2 * cNN;
    // Drag inflow from the shell above.
    if (i + 1 < n) {
      dx[n + i] += c.dragD[i + 1] * x[n + i + 1];
      dx[2 * n + i] += c.dragD[i + 1] * x[2 * n + i + 1];
      dx[3 * n + i] += c.dragN[i + 1] * x[3 * n + i + 1];
    }
  }
  // Fragment deposition: local fraction in the same shell, the remainder split evenly up/down (lost at the edges).
  const local = p.fragmentLocalFraction ?? 0.5;
  const side = 0.5 * (1 - local);
  for (let i = 0; i < n; i++) {
    const f = fragScratch[i];
    if (f === 0) continue;
    dx[3 * n + i] += local * f;
    if (i > 0) dx[3 * n + i - 1] += side * f;
    if (i + 1 < n) dx[3 * n + i + 1] += side * f;
  }
  return total;
}

/**
 * Deterministic multi-shell source–sink debris model integrated with classical RK4
 * (model 'debris-shell-source-sink@1'). Populations per altitude shell: active satellites (launched, retired after
 * their mission), derelicts (failed post-mission disposal), compliant disposals (decaying within the disposal
 * rule) and debris ≥ Lc. Sinks: drag (cascading to the shell below), disposal, active debris removal and
 * collisions; sources: launches and collision fragments (NASA SBM counts). An EDUCATIONAL APPROXIMATION in the
 * spirit of MIT MOCAT-SSEM — not a forecast.
 */
export function simulateShellModel(params: ShellModelParams, years: number, dtYears: number): ShellModelResult {
  const c = coefficients(params);
  const n = c.n;
  const steps = Math.max(1, Math.ceil(years / dtYears));
  const dt = years / steps;
  const size = POPS * n;
  const x = new Float64Array(size);
  for (let i = 0; i < n; i++) {
    x[i] = params.initial.active[i] ?? 0;
    x[n + i] = params.initial.derelict[i] ?? 0;
    x[3 * n + i] = params.initial.debris[i] ?? 0;
  }
  const k1 = new Float64Array(size), k2 = new Float64Array(size), k3 = new Float64Array(size), k4 = new Float64Array(size);
  const tmp = new Float64Array(size);
  const frag = new Float64Array(n);

  const times = new Float64Array(steps + 1);
  const totS = new Float64Array(steps + 1), totD = new Float64Array(steps + 1), totN = new Float64Array(steps + 1);
  const rate = new Float64Array(steps + 1), cum = new Float64Array(steps + 1);
  const record = (j: number, r: number): void => {
    let s = 0, d = 0, nn = 0;
    for (let i = 0; i < n; i++) {
      s += x[i];
      d += x[n + i] + x[2 * n + i];
      nn += x[3 * n + i];
    }
    times[j] = j * dt;
    totS[j] = s;
    totD[j] = d;
    totN[j] = nn;
    rate[j] = r;
  };
  record(0, shellDerivative(params, c, x, k1, frag));

  for (let j = 1; j <= steps; j++) {
    const r1 = shellDerivative(params, c, x, k1, frag);
    for (let i = 0; i < size; i++) tmp[i] = Math.max(0, x[i] + 0.5 * dt * k1[i]);
    const r2 = shellDerivative(params, c, tmp, k2, frag);
    for (let i = 0; i < size; i++) tmp[i] = Math.max(0, x[i] + 0.5 * dt * k2[i]);
    const r3 = shellDerivative(params, c, tmp, k3, frag);
    for (let i = 0; i < size; i++) tmp[i] = Math.max(0, x[i] + dt * k3[i]);
    const r4 = shellDerivative(params, c, tmp, k4, frag);
    for (let i = 0; i < size; i++) x[i] = Math.max(0, x[i] + (dt / 6) * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]));
    cum[j] = cum[j - 1] + (dt / 6) * (r1 + 2 * r2 + 2 * r3 + r4);
    record(j, shellDerivative(params, c, x, k1, frag));
  }

  const centers = new Float64Array(n);
  const fS = new Float64Array(n), fD = new Float64Array(n), fN = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    centers[i] = 0.5 * (params.shellEdgesAltitudeM[i] + params.shellEdgesAltitudeM[i + 1]);
    fS[i] = x[i];
    fD[i] = x[n + i] + x[2 * n + i];
    fN[i] = x[3 * n + i];
  }
  return {
    timesYears: times,
    totals: { active: totS, derelict: totD, debris: totN },
    collisionRatePerYear: rate,
    cumulativeCollisions: cum,
    final: { active: fS, derelict: fD, debris: fN },
    shellCentersAltitudeM: centers,
    model: MODEL_SHELL,
  };
}

// ── Presets ───────────────────────────────────────────────────────────────────────────────

export type ShellScenarioId = 'business-as-usual' | 'pmd-90' | 'five-year-rule' | 'adr' | 'launch-stop';

/** Default shells: 200–2000 km in 50 km steps (36 shells). */
export function defaultShellEdgesM(minKm = 200, maxKm = 2000, stepKm = 50): number[] {
  const edges: number[] = [];
  for (let h = minKm; h <= maxKm + 1e-9; h += stepKm) edges.push(h * 1000);
  return edges;
}

const gaussianProfile = (edgesM: readonly number[], peaks: readonly { km: number; widthKm: number; count: number }[]): number[] => {
  const n = edgesM.length - 1;
  const out = new Array<number>(n).fill(0);
  for (const pk of peaks) {
    let norm = 0;
    const w = new Array<number>(n);
    for (let i = 0; i < n; i++) {
      const hKm = (edgesM[i] + edgesM[i + 1]) / 2000;
      w[i] = Math.exp(-0.5 * ((hKm - pk.km) / pk.widthKm) ** 2);
      norm += w[i];
    }
    for (let i = 0; i < n; i++) out[i] += norm > 0 ? (pk.count * w[i]) / norm : 0;
  }
  return out;
};

/**
 * ILLUSTRATIVE initial LEO population shaped like the mid-2020s catalogue (orders of magnitude from the ESA Space
 * Environment Report 2025: ~10⁴ active payloads concentrated at 500–600 km, a few thousand intact derelicts
 * peaking at 700–1000 km, a few ×10⁴ tracked fragments ≥ 10 cm peaking at 750–900 km). Labs should replace this
 * with counts binned from the catalogue snapshot when available.
 */
export function illustrativeInitialPopulation(edgesM: readonly number[] = defaultShellEdgesM()): PopulationTriple<number[]> {
  return {
    active: gaussianProfile(edgesM, [
      { km: 550, widthKm: 30, count: 8000 },
      { km: 1200, widthKm: 25, count: 700 },
      { km: 750, widthKm: 120, count: 1300 },
    ]),
    derelict: gaussianProfile(edgesM, [
      { km: 800, widthKm: 120, count: 2000 },
      { km: 1450, widthKm: 120, count: 800 },
    ]),
    debris: gaussianProfile(edgesM, [
      { km: 820, widthKm: 110, count: 17_000 },
      { km: 550, widthKm: 120, count: 5000 },
      { km: 1450, widthKm: 150, count: 4000 },
    ]),
  };
}

/** Parameters for a named policy scenario (overridable). `adrPerYear` applies to the 'adr' preset. */
export function shellScenarioParams(id: ShellScenarioId, overrides: Partial<ShellModelParams> & { adrPerYear?: number } = {}): ShellModelParams {
  const edges = overrides.shellEdgesAltitudeM ?? defaultShellEdgesM();
  const launches = gaussianProfile(edges, [
    { km: 550, widthKm: 40, count: 1800 },
    { km: 1150, widthKm: 50, count: 150 },
    { km: 700, widthKm: 120, count: 250 },
  ]);
  const base: ShellModelParams = {
    shellEdgesAltitudeM: edges,
    initial: illustrativeInitialPopulation(edges),
    launchRatePerYear: launches,
    missionLifetimeYears: 8,
    pmdCompliance: 0.6,
    disposalLifetimeYears: 25,
    adrRemovalsPerYear: 0,
    avoidance: { vsTracked: 0.95, vsDebris: 0.8 },
    relativeSpeedMS: 10_000,
    radiusM: { active: 1.5, derelict: 2, debris: 0.05 },
    massKg: { active: 500, derelict: 1000, debris: 0.5 },
    areaToMassM2Kg: { derelict: 0.01, debris: 0.1 },
    cd: DEFAULT_DRAG_COEFFICIENT,
    solarActivityFactor: 1,
    fragmentLcMinM: 0.1,
    fragmentLocalFraction: 0.5,
  };
  const preset: Partial<ShellModelParams> =
    id === 'pmd-90' ? { pmdCompliance: 0.9 }
    : id === 'five-year-rule' ? { pmdCompliance: 0.9, disposalLifetimeYears: 5 }
    : id === 'adr' ? { pmdCompliance: 0.9, adrRemovalsPerYear: overrides.adrPerYear ?? 5 }
    : id === 'launch-stop' ? { launchRatePerYear: launches.map(() => 0) }
    : {};
  const { adrPerYear: _ignored, ...rest } = overrides;
  return { ...base, ...preset, ...rest };
}

export const SHELL_SCENARIOS: readonly { id: ShellScenarioId; title: string; description: string }[] = [
  { id: 'business-as-usual', title: 'Business as usual', description: 'Current launch rates; 60% of satellites dispose of themselves within 25 years.' },
  { id: 'pmd-90', title: '90% disposal', description: 'Same launches, but 90% of satellites deorbit within 25 years.' },
  { id: 'five-year-rule', title: '5-year rule', description: '90% disposal within 5 years (as required for new US-licensed satellites since 2024).' },
  { id: 'adr', title: 'Active debris removal', description: '90% disposal plus removal of the largest derelicts every year.' },
  { id: 'launch-stop', title: 'All launches stop', description: 'Kessler\'s question: does the debris keep growing on its own?' },
];

// ── Mitigation concepts ───────────────────────────────────────────────────────────────────

export type MitigationMaturity = 'operational' | 'demonstrated' | 'experimental' | 'conceptual';

export const MATURITY_DESCRIPTION: Record<MitigationMaturity, string> = {
  operational: 'Used routinely on real missions.',
  demonstrated: 'Shown to work in orbit, but not yet in routine use.',
  experimental: 'Tested in orbit with partial or mixed results.',
  conceptual: 'Studied on paper or in the lab; never flown for this purpose.',
};

export interface MitigationConcept {
  id: string;
  title: string;
  summary: string;
  maturity: MitigationMaturity;
  /** Plain-text evidence for the maturity label (missions, years). */
  evidence: string;
  /** Shell-model parameter the concept acts on, if any (for the lab's "apply" controls). */
  modelLever?: 'pmdCompliance' | 'disposalLifetimeYears' | 'adrRemovalsPerYear' | 'avoidance';
  references: ModelReference[];
}

export const MITIGATION_CONCEPTS: readonly MitigationConcept[] = [
  {
    id: 'controlled-deorbit',
    title: 'Controlled deorbit',
    summary: 'A spacecraft fires its engine at end of life to re-enter over an empty ocean area.',
    maturity: 'operational',
    evidence: 'Routine for cargo vehicles and many upper stages (e.g. ESA ATV 2008–2015, SpaceX Dragon trunks and Falcon 9 second stages).',
    modelLever: 'disposalLifetimeYears',
    references: [{ citation: 'ESA Space Environment Report 2025', url: 'https://www.esa.int/Space_Safety/Space_Debris/ESA_Space_Environment_Report_2025' }],
  },
  {
    id: 'collision-avoidance',
    title: 'Collision-avoidance manoeuvres',
    summary: 'Operators move satellites when tracking predicts a close approach.',
    maturity: 'operational',
    evidence: 'The ISS has manoeuvred around debris more than 30 times since 1999; large constellations perform thousands of avoidance manoeuvres per year.',
    modelLever: 'avoidance',
    references: [{ citation: 'NASA Orbital Debris Program Office, Orbital Debris Quarterly News', url: 'https://orbitaldebris.jsc.nasa.gov/quarterly-news/' }],
  },
  {
    id: 'drag-augmentation',
    title: 'Drag sails',
    summary: 'A deployable sail increases area-to-mass ratio so the satellite falls back faster.',
    maturity: 'demonstrated',
    evidence: 'CanX-7 (launched 2016) and InflateSail (2017) deorbited faster with sails; the ESA-funded ADEO sail was deployed from a D-Orbit ION carrier in 2022.',
    modelLever: 'disposalLifetimeYears',
    references: [{ citation: 'Underwood, C. et al. (2019), InflateSail de-orbit flight demonstration results, Acta Astronautica 162, 344', doi: '10.1016/j.actaastro.2019.05.054' }],
  },
  {
    id: 'active-debris-removal',
    title: 'Active debris removal',
    summary: 'A servicer captures a derelict (net, harpoon, robotic arm or magnet) and drags it down.',
    maturity: 'demonstrated',
    evidence: 'RemoveDEBRIS (2018) netted and harpooned its own released targets; ELSA-d (2021) magnetically captured its own client; ADRAS-J (2024) approached a real H-IIA upper stage to about 15 m. Capture of an uncooperative real debris object has not yet been achieved.',
    modelLever: 'adrRemovalsPerYear',
    references: [
      { citation: 'Aglietti, G. S. et al. (2020), The active space debris removal mission RemoveDebris, Acta Astronautica 168, 310', doi: '10.1016/j.actaastro.2019.09.001' },
      { citation: 'JAXA Commercial Removal of Debris Demonstration (CRD2), ADRAS-J mission' },
    ],
  },
  {
    id: 'electrodynamic-tether',
    title: 'Electrodynamic tethers',
    summary: 'A long conducting tether interacts with Earth\'s magnetic field to produce drag without propellant.',
    maturity: 'experimental',
    evidence: 'Tether physics was tested on TSS-1R (1996) and other flights, but JAXA\'s KITE experiment on HTV-6 (2017) failed to deploy its tether; no satellite has yet been deorbited by one.',
    modelLever: 'disposalLifetimeYears',
    references: [{ citation: 'Ohkawa, Y. et al. (2020), Review of KITE – Electrodynamic tether experiment on the H-II Transfer Vehicle, Acta Astronautica 177, 750', doi: '10.1016/j.actaastro.2020.03.014' }],
  },
  {
    id: 'laser-nudging',
    title: 'Laser nudging',
    summary: 'Ground- or space-based lasers push small debris by photon pressure or surface ablation to avoid collisions.',
    maturity: 'conceptual',
    evidence: 'Studied since NASA\'s Project ORION (1996) and in later photon-pressure studies; satellite laser ranging of debris exists, but no debris object has been moved by a laser.',
    modelLever: 'avoidance',
    references: [
      { citation: 'Phipps, C. R. et al. (1996), ORION: Clearing near-Earth space debris using a 20-kW, 530-nm, Earth-based, repetitively pulsed laser, Laser and Particle Beams 14, 1', doi: '10.1017/S0263034600009733' },
      { citation: 'Mason, J. et al. (2011), Orbital debris–debris collision avoidance, Advances in Space Research 48, 1643', doi: '10.1016/j.asr.2011.08.005' },
    ],
  },
];

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const DEBRIS_MODELS: readonly ModelInfo[] = [
  {
    id: 'exponential-atmosphere',
    version: 1,
    title: 'Exponential atmosphere',
    summary: 'Air density falls roughly exponentially with altitude; even at 400 km the thin air slowly drags satellites down.',
    latex: String.raw`\rho(h) = \rho_0\,e^{-(h - h_0)/H}`,
    variables: [
      { symbol: String.raw`\rho`, meaning: 'Air density', unit: 'kg/m3' },
      { symbol: 'h_0, \\rho_0', meaning: 'Base altitude and density of the layer', unit: 'm' },
      { symbol: 'H', meaning: 'Scale height of the layer', unit: 'm' },
    ],
    assumptions: [
      'Static, spherically symmetric atmosphere; no day/night or seasonal variation.',
      'Solar activity represented by a single multiplier (≈ ×0.35 low to ×2.8 high above 250 km).',
    ],
    validity: '0–1000 km (extrapolated above with the last scale height).',
    accuracy: 'Factor ~2 versus empirical models (NRLMSISE-00, JB2008) at a given date.',
    kind: 'derived',
    references: [
      { citation: 'Vallado, D. A. (2013), Fundamentals of Astrodynamics and Applications, 4th ed., Table 8-4' },
      { citation: 'COSPAR International Reference Atmosphere (CIRA-72), Akademie-Verlag 1972' },
    ],
  },
  {
    id: 'drag-lifetime-circular',
    version: 1,
    title: 'Orbital decay by atmospheric drag',
    summary: 'How long a satellite in a circular orbit takes to spiral down and re-enter.',
    latex: String.raw`\frac{da}{dt} = -\rho\,\frac{C_D A}{m}\sqrt{\mu a},\qquad t_{\mathrm{life}} = \int_{a_{\mathrm{re}}}^{a_0}\frac{da}{\rho\,(C_D A/m)\sqrt{\mu a}}`,
    variables: [
      { symbol: 'a', meaning: 'Orbit radius', unit: 'm' },
      { symbol: 'C_D', meaning: 'Drag coefficient (2.2)', unit: '' },
      { symbol: 'A/m', meaning: 'Area-to-mass ratio', unit: 'm2/kg' },
      { symbol: String.raw`\mu`, meaning: 'Earth gravitational parameter', unit: 'm3/s2' },
    ],
    assumptions: ['Orbit stays circular; constant A/m and C_D; atmosphere fixed at the chosen solar activity; re-entry at 100 km.'],
    validity: 'Circular LEO orbits, 150–1000 km.',
    accuracy: 'Typically within a factor of 2–3 of operational predictions.',
    kind: 'derived',
    references: [{ citation: 'King-Hele, D. (1987), Satellite Orbits in an Atmosphere: Theory and Applications, Blackie' }],
  },
  {
    id: 'nasa-sbm-simplified',
    version: 1,
    title: 'NASA Standard Breakup Model (simplified)',
    summary: 'How many fragments a collision or explosion creates, how big they are, and how fast they fly apart.',
    latex: String.raw`N(L_c) = 0.1\,M^{0.75}L_c^{-1.71}\ \text{(collision)},\qquad N(L_c) = 6\,S\,L_c^{-1.6}\ \text{(explosion)}`,
    extraLatex: [
      String.raw`E^* = \frac{m_p v^{2}}{2 m_t} \ge 40\ \mathrm{J/g}\ \Rightarrow\ \text{catastrophic},\ M = m_p + m_t;\ \text{else}\ M = m_p v_{\mathrm{km/s}}^{2}`,
      String.raw`\log_{10}\Delta v \sim \mathcal N(0.9\chi + 2.9,\ 0.4),\quad \chi = \log_{10}(A/m)`,
    ],
    variables: [
      { symbol: 'N', meaning: 'Number of fragments larger than L_c', unit: '' },
      { symbol: 'L_c', meaning: 'Characteristic length (fragment size)', unit: 'm' },
      { symbol: 'M', meaning: 'Mass parameter', unit: 'kg' },
      { symbol: 'E^*', meaning: 'Specific impact energy', unit: 'J/kg' },
    ],
    assumptions: ['Spacecraft area-to-mass coefficients only (rocket bodies differ).', 'Fragment masses are not renormalised to the parent mass.'],
    validity: 'Fragments 1 mm – 1 m; impact speeds of several km/s.',
    kind: 'derived',
    references: [
      { citation: 'Johnson, N. L., Krisko, P. H., Liou, J.-C. & Anz-Meador, P. D. (2001), NASA\'s new breakup model of EVOLVE 4.0, Advances in Space Research 28, 1377', doi: '10.1016/S0273-1177(01)00423-9' },
    ],
  },
  {
    id: 'debris-shell-source-sink',
    version: 1,
    title: 'Debris population model (educational)',
    summary:
      'Tracks satellites, derelicts and debris in altitude shells over decades. Collisions create fragments that can ' +
      'cause more collisions — the Kessler syndrome. An educational approximation, not a forecast.',
    latex: String.raw`\dot N_i = \sum_{XY} F_{XY}\,\phi_{XY,i}\,X_iY_i - \frac{N_i}{\tau_i} + \frac{N_{i+1}}{\tau_{i+1}} - \ldots,\qquad \phi = \frac{\sigma\,v_{\mathrm{rel}}}{V_i}`,
    extraLatex: [
      String.raw`\dot S_i = \lambda_i - \frac{S_i}{T_{\mathrm{op}}} - \text{collisions}`,
      String.raw`\dot D_i = (1 - P_{\mathrm{PMD}})\frac{S_i}{T_{\mathrm{op}}} - \frac{D_i}{\tau_i} + \frac{D_{i+1}}{\tau_{i+1}} - \text{ADR} - \text{collisions}`,
    ],
    variables: [
      { symbol: 'S, D, N', meaning: 'Active satellites, derelicts, debris ≥ 10 cm in shell i', unit: '' },
      { symbol: String.raw`\lambda`, meaning: 'Launch rate', unit: '1/yr' },
      { symbol: 'T_{op}', meaning: 'Mission lifetime', unit: 'yr' },
      { symbol: 'P_{PMD}', meaning: 'Post-mission disposal success rate', unit: '' },
      { symbol: String.raw`\tau`, meaning: 'Drag residence time in a shell', unit: 'yr' },
      { symbol: String.raw`\sigma`, meaning: 'Collision cross-section π(r₁+r₂)²', unit: 'm2' },
      { symbol: 'F', meaning: 'Fragments per collision (NASA SBM)', unit: '' },
    ],
    assumptions: [
      'Objects in a shell are uniformly mixed (kinetic-gas collision theory) with one mean impact speed.',
      'Representative sizes and masses per population; fragments spread to the same and neighbouring shells only.',
      'Initial population and launch profile are illustrative unless replaced by catalogue counts.',
      'Static atmosphere at one solar-activity level; no explosions; no inclination structure.',
    ],
    validity: 'Qualitative trends over decades (which policy grows or shrinks the debris population).',
    kind: 'derived',
    references: [
      { citation: 'Kessler, D. J. & Cour-Palais, B. G. (1978), Collision frequency of artificial satellites: the creation of a debris belt, JGR 83, 2637', doi: '10.1029/JA083iA06p02637' },
      { citation: 'Liou, J.-C. & Johnson, N. L. (2006), Risks in space from orbiting debris, Science 311, 340', doi: '10.1126/science.1121337' },
      { citation: 'D\'Ambrosio, A., Lifson, M. & Linares, R. (2022), The Capacity of Low Earth Orbit Computed using Source-sink Modeling (MOCAT-SSEM), arXiv:2206.05345' },
    ],
  },
];
