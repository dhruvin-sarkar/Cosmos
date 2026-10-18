/**
 * Exoplanet habitability science: equilibrium temperature, insolation, the Kopparapu et al. (2014) habitable
 * zone, the Earth Similarity Index, size classes and an explicitly ILLUSTRATIVE climate-state heuristic for the
 * planet shader.
 *
 * These are kept deliberately separate (docs/ARCHITECTURE.md §Labs): Teq is a radiative-balance number, the HZ is
 * a property of the star, ESI is a similarity score — none of them demonstrates habitability.
 * Units: SI (K, m, W). Insolation is in Earth units (S⊕ = flux at 1 AU from the nominal Sun). Missing inputs → NaN
 * (scalar fns) or null (object results); nothing throws.
 */
import { AU_M, L_SUN_W, R_SUN_M, SIGMA_SB } from '../core/units';
import type { ModelInfo } from './models';

export const MODEL_TEQ = 'teq-blackbody@1';
export const MODEL_INSOLATION = 'insolation@1';
export const MODEL_HZ = 'hz-kopparapu2014@1';
export const MODEL_ESI = 'esi-schulze-makuch2011@1';
export const MODEL_SIZE_CLASS = 'planet-size-class@1';
export const MODEL_CLIMATE_STATE = 'illustrative-climate-state@1';

/** Mean solar irradiance at 1 AU implied by the nominal solar luminosity, W/m² (≈ 1361). */
export const S_EARTH_W_M2 = L_SUN_W / (4 * Math.PI * AU_M * AU_M);

// ── Equilibrium temperature ───────────────────────────────────────────────────────────────

/**
 * Heat-redistribution factor f in T_eq⁴ = f (1 − A) T★⁴ (R★/a)²:
 *  - 'full'    f = 1/4  (absorbed flux re-radiated from the whole sphere; fast rotator / thick atmosphere)
 *  - 'dayside' f = 1/2  (re-radiated from the day hemisphere only; tidally locked, no transport)
 *  - number    f itself, physically 1/4 ≤ f ≤ 2/3 (2/3 = no redistribution, substellar-weighted dayside;
 *              Seager 2010 / Cowan & Agol 2011 convention).
 */
export type Redistribution = 'full' | 'dayside' | number;

export function redistributionFactor(r: Redistribution): number {
  if (r === 'full') return 0.25;
  if (r === 'dayside') return 0.5;
  return typeof r === 'number' && r > 0 && r <= 2 / 3 + 1e-12 ? r : NaN;
}

export interface EquilibriumTemperatureInput {
  starTeffK: number;
  starRadiusM: number;
  semiMajorAxisM: number;
  /** Bond albedo A ∈ [0, 1). */
  bondAlbedo: number;
  redistribution: Redistribution;
}

/**
 * Planetary equilibrium temperature (model 'teq-blackbody@1'):
 *   T_eq = T★ (R★/a)^½ [f (1 − A)]^¼ ;  full redistribution (f = ¼): T_eq = T★ √(R★/2a) (1 − A)^¼.
 * Assumes a circular orbit (a = orbit-averaged distance), blackbody star and planet, no internal heat and no
 * greenhouse effect — Earth gives ≈ 255 K, 33 K below its real mean surface temperature.
 */
export function equilibriumTemperatureK(input: EquilibriumTemperatureInput): number {
  const { starTeffK, starRadiusM, semiMajorAxisM, bondAlbedo } = input;
  const f = redistributionFactor(input.redistribution);
  if (!(starTeffK > 0) || !(starRadiusM > 0) || !(semiMajorAxisM > 0) || !(bondAlbedo >= 0 && bondAlbedo < 1) || !(f > 0)) {
    return NaN;
  }
  return starTeffK * Math.sqrt(starRadiusM / semiMajorAxisM) * Math.pow(f * (1 - bondAlbedo), 0.25);
}

/** Equilibrium temperature from insolation in Earth units: T_eq = [f (1 − A) S S⊕ / σ]^¼. */
export function equilibriumTemperatureFromInsolationK(insolationEarth: number, bondAlbedo: number, redistribution: Redistribution = 'full'): number {
  const f = redistributionFactor(redistribution);
  if (!(insolationEarth >= 0) || !(bondAlbedo >= 0 && bondAlbedo < 1) || !(f > 0)) return NaN;
  return Math.pow((f * (1 - bondAlbedo) * insolationEarth * S_EARTH_W_M2) / SIGMA_SB, 0.25);
}

// ── Insolation ────────────────────────────────────────────────────────────────────────────

/** Insolation relative to Earth: S/S⊕ = (L/L☉) / (d/AU)². */
export function insolationEarth(starLuminosityW: number, distanceM: number): number {
  if (!(starLuminosityW > 0) || !(distanceM > 0)) return NaN;
  const dAu = distanceM / AU_M;
  return starLuminosityW / L_SUN_W / (dAu * dAu);
}

/** Insolation relative to Earth from stellar Teff and radius: S/S⊕ = (R★/R☉)² (T★/5772 K)⁴ / (d/AU)². */
export function insolationFromStarEarth(starTeffK: number, starRadiusM: number, distanceM: number): number {
  if (!(starTeffK > 0) || !(starRadiusM > 0)) return NaN;
  const L = 4 * Math.PI * starRadiusM * starRadiusM * SIGMA_SB * starTeffK ** 4;
  return insolationEarth(L, distanceM);
}

// ── Habitable zone (Kopparapu et al. 2014) ────────────────────────────────────────────────

export type HzLimitId = 'recentVenus' | 'runawayGreenhouse' | 'maximumGreenhouse' | 'earlyMars' | 'runawayGreenhouse5Me' | 'runawayGreenhouse01Me';

/**
 * S_eff = S_eff☉ + a T + b T² + c T³ + d T⁴, T = T_eff − 5780 K (Kopparapu et al. 2014, ApJL 787, L29, Table 1;
 * the 1 M⊕ limits are those of Kopparapu et al. 2013 with the 2013 erratum applied).
 */
export const HZ_COEFFICIENTS: Readonly<Record<HzLimitId, readonly [number, number, number, number, number]>> = {
  recentVenus: [1.776, 2.136e-4, 2.533e-8, -1.332e-11, -3.097e-15],
  runawayGreenhouse: [1.107, 1.332e-4, 1.58e-8, -8.308e-12, -1.931e-15],
  maximumGreenhouse: [0.356, 6.171e-5, 1.698e-9, -3.198e-12, -5.575e-16],
  earlyMars: [0.32, 5.547e-5, 1.526e-9, -2.874e-12, -5.011e-16],
  runawayGreenhouse5Me: [1.188, 1.433e-4, 1.707e-8, -8.968e-12, -2.084e-15],
  runawayGreenhouse01Me: [0.99, 1.209e-4, 1.404e-8, -7.418e-12, -1.713e-15],
};

/** Stellar Teff range over which the Kopparapu parameterisation was fitted. */
export const HZ_TEFF_VALID_RANGE_K: readonly [number, number] = [2600, 7200];

/** Effective stellar flux (S⊕ units) at a habitable-zone limit for a star of temperature T_eff. */
export function hzEffectiveFlux(starTeffK: number, limit: HzLimitId): number {
  if (!(starTeffK > 0)) return NaN;
  const [s0, a, b, c, d] = HZ_COEFFICIENTS[limit];
  const t = starTeffK - 5780;
  return s0 + t * (a + t * (b + t * (c + t * d)));
}

export interface HabitableZoneLimit {
  /** Effective flux at the limit, S⊕. */
  seff: number;
  /** Orbital distance of the limit, m: d = √((L/L☉)/S_eff) AU. */
  distanceM: number;
}

export interface HabitableZone {
  /** Optimistic inner edge. */
  recentVenus: HabitableZoneLimit;
  /** Conservative inner edge (1 M⊕). */
  runawayGreenhouse: HabitableZoneLimit;
  /** Conservative outer edge. */
  maximumGreenhouse: HabitableZoneLimit;
  /** Optimistic outer edge. */
  earlyMars: HabitableZoneLimit;
  /** Inner edge for a 5 M⊕ planet (closer in) and a 0.1 M⊕ planet (further out). */
  runawayGreenhouse5Me: HabitableZoneLimit;
  runawayGreenhouse01Me: HabitableZoneLimit;
  /** False when T_eff is outside 2600–7200 K: values are extrapolations and must be flagged in the UI. */
  valid: boolean;
  model: typeof MODEL_HZ;
}

/**
 * Habitable-zone boundaries for a star (model 'hz-kopparapu2014@1'). `starLuminosityW` may be computed from
 * Teff and radius with Stefan–Boltzmann. The HZ is where a rocky planet with an Earth-like CO₂/H₂O atmosphere could
 * keep surface liquid water — a property of the star, not a statement about any planet.
 */
export function habitableZone(starTeffK: number, starLuminosityW: number): HabitableZone {
  const lSun = starLuminosityW / L_SUN_W;
  const limit = (id: HzLimitId): HabitableZoneLimit => {
    const seff = hzEffectiveFlux(starTeffK, id);
    return { seff, distanceM: seff > 0 && lSun > 0 ? Math.sqrt(lSun / seff) * AU_M : NaN };
  };
  return {
    recentVenus: limit('recentVenus'),
    runawayGreenhouse: limit('runawayGreenhouse'),
    maximumGreenhouse: limit('maximumGreenhouse'),
    earlyMars: limit('earlyMars'),
    runawayGreenhouse5Me: limit('runawayGreenhouse5Me'),
    runawayGreenhouse01Me: limit('runawayGreenhouse01Me'),
    valid: starTeffK >= HZ_TEFF_VALID_RANGE_K[0] && starTeffK <= HZ_TEFF_VALID_RANGE_K[1],
    model: MODEL_HZ,
  };
}

export type HzPosition = 'too-hot' | 'optimistic-inner' | 'conservative' | 'optimistic-outer' | 'too-cold' | 'unknown';

/** Where a planet with insolation S (S⊕) sits relative to the HZ limits of its star. */
export function hzPosition(insolation: number, starTeffK: number): HzPosition {
  if (!(insolation >= 0) || !(starTeffK > 0)) return 'unknown';
  if (insolation > hzEffectiveFlux(starTeffK, 'recentVenus')) return 'too-hot';
  if (insolation > hzEffectiveFlux(starTeffK, 'runawayGreenhouse')) return 'optimistic-inner';
  if (insolation >= hzEffectiveFlux(starTeffK, 'maximumGreenhouse')) return 'conservative';
  if (insolation >= hzEffectiveFlux(starTeffK, 'earlyMars')) return 'optimistic-outer';
  return 'too-cold';
}

// ── Earth Similarity Index ────────────────────────────────────────────────────────────────

export const ESI_DISCLAIMER =
  'Earth Similarity Index estimates physical similarity to Earth. A high value does not demonstrate habitability or life.';

/** Earth reference values and weight exponents (Schulze-Makuch et al. 2011, Astrobiology 11, 1041, Table 1). */
export const ESI_PARAMETERS = {
  radiusEarth: { ref: 1, weight: 0.57 },
  densityEarth: { ref: 1, weight: 1.07 },
  escapeVelocityEarth: { ref: 1, weight: 0.7 },
  surfaceTempK: { ref: 288, weight: 5.58 },
} as const;

export type EsiParameter = keyof typeof ESI_PARAMETERS;

export interface EsiInput {
  /** Planet radius in Earth radii. */
  radiusEarth?: number | null;
  /** Bulk density in Earth densities (5.51 g/cm³ = 1). */
  densityEarth?: number | null;
  /** Escape velocity in Earth units (11.19 km/s = 1). */
  escapeVelocityEarth?: number | null;
  /** Mean surface temperature, K (Earth 288 K). */
  surfaceTempK?: number | null;
  /** Insolation in Earth units (radius + insolation variant). */
  insolationEarth?: number | null;
}

export type EsiVariant = 'full' | 'radius-insolation' | 'partial';

export interface EsiResult {
  /** ESI ∈ [0, 1], or null when not computable. */
  value: number | null;
  variant: EsiVariant | null;
  /** Per-parameter similarity factors that entered the result. */
  components: Partial<Record<EsiParameter | 'insolationEarth', number>>;
  /** Parameters of the full four-parameter index that were not available. */
  missing: EsiParameter[];
  model: typeof MODEL_ESI;
  disclaimer: string;
}

const present = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

/** Similarity term 1 − |x − x0| / (x + x0) ∈ (0, 1]. */
function similarity(x: number, x0: number): number {
  return 1 - Math.abs(x - x0) / (x + x0);
}

/**
 * Earth Similarity Index (model 'esi-schulze-makuch2011@1').
 *  - 'full' (all four of radius, density, escape velocity, surface temperature):
 *      ESI = Π_i (1 − |x_i − x_i⊕| / (x_i + x_i⊕))^(w_i / n), n = 4.
 *  - 'radius-insolation' (when temperature/density/escape velocity are not all known but radius and insolation
 *    are — the usual case for exoplanets; Planetary Habitability Laboratory form):
 *      ESI = 1 − √(½ [((S − S⊕)/(S + S⊕))² + ((R − R⊕)/(R + R⊕))²]).
 *  - 'partial': the product form over whichever of the four parameters exist (n = number present); less
 *    comparable between planets, and flagged as such.
 */
export function earthSimilarityIndex(input: EsiInput): EsiResult {
  const keys = Object.keys(ESI_PARAMETERS) as EsiParameter[];
  const have = keys.filter((k) => present(input[k]));
  const missing = keys.filter((k) => !present(input[k]));
  const base = { model: MODEL_ESI, disclaimer: ESI_DISCLAIMER } as const;

  const productForm = (params: EsiParameter[]): { value: number; components: EsiResult['components'] } => {
    const n = params.length;
    let value = 1;
    const components: EsiResult['components'] = {};
    for (const k of params) {
      const x = input[k] as number;
      const s = similarity(x, ESI_PARAMETERS[k].ref);
      components[k] = s;
      value *= Math.pow(s, ESI_PARAMETERS[k].weight / n);
    }
    return { value, components };
  };

  if (have.length === 4) return { ...base, variant: 'full', missing: [], ...productForm(have) };

  if (present(input.radiusEarth) && present(input.insolationEarth)) {
    const sr = (input.radiusEarth - 1) / (input.radiusEarth + 1);
    const ss = (input.insolationEarth - 1) / (input.insolationEarth + 1);
    return {
      ...base,
      variant: 'radius-insolation',
      value: 1 - Math.sqrt(0.5 * (sr * sr + ss * ss)),
      components: { radiusEarth: 1 - Math.abs(sr), insolationEarth: 1 - Math.abs(ss) },
      missing,
    };
  }

  if (have.length > 0) return { ...base, variant: 'partial', missing, ...productForm(have) };
  return { ...base, variant: null, value: null, components: {}, missing };
}

// ── Size class ────────────────────────────────────────────────────────────────────────────

export type PlanetSizeClass = 'sub-earth' | 'earth-size' | 'super-earth' | 'sub-neptune' | 'neptune-like' | 'gas-giant' | 'unknown';

/**
 * Radius-based class (Earth radii): sub-Earth < 0.8 ≤ Earth-size < 1.25 ≤ super-Earth < 2 ≤ sub-Neptune < 4
 * ≤ Neptune-like < 8 ≤ gas giant. Boundaries follow common Kepler-era usage (Borucki et al. 2011; the 1.5–2 R⊕
 * radius valley of Fulton et al. 2017 separates mostly-rocky from gas-enveloped planets). Composition is NOT
 * implied by radius alone.
 */
export function planetSizeClass(radiusEarth: number | null | undefined): PlanetSizeClass {
  if (!present(radiusEarth)) return 'unknown';
  if (radiusEarth < 0.8) return 'sub-earth';
  if (radiusEarth < 1.25) return 'earth-size';
  if (radiusEarth < 2) return 'super-earth';
  if (radiusEarth < 4) return 'sub-neptune';
  if (radiusEarth < 8) return 'neptune-like';
  return 'gas-giant';
}

const isGaseous = (c: PlanetSizeClass): boolean => c === 'sub-neptune' || c === 'neptune-like' || c === 'gas-giant';

// ── Illustrative climate state (visualisation heuristic) ──────────────────────────────────

export type ClimateState =
  | 'frozen'
  | 'temperate'
  | 'hot'
  | 'runaway-greenhouse'
  | 'gas-giant-ammonia'
  | 'gas-giant-water'
  | 'gas-giant-clear'
  | 'gas-giant-alkali'
  | 'gas-giant-silicate'
  | 'unknown';

export interface ClimateStateInput {
  /** Equilibrium temperature (K) — used for gaseous planets and as an insolation fallback. */
  teqK?: number | null;
  /** Insolation, S⊕. */
  insolation?: number | null;
  sizeClass: PlanetSizeClass;
  /** Host-star Teff (K), to place rocky planets against that star's HZ limits; Sun-like if omitted. */
  starTeffK?: number | null;
}

export interface ClimateStateResult {
  state: ClimateState;
  /** 0–1 fraction of surface shown as ice (rocky). */
  iceCover: number;
  /** 0–1 fraction shown as open water (rocky). */
  oceanCover: number;
  /** 0–1 cloud coverage. */
  cloudCover: number;
  /** 0–1 photochemical haze / thick-atmosphere opacity. */
  hazeAmount: number;
  /** Always 'illustrative': the shader output must carry the Illustrative provenance label. */
  provenance: 'illustrative';
  model: typeof MODEL_CLIMATE_STATE;
}

const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
const smoothstep = (e0: number, e1: number, x: number): number => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};

/** Earth T_eq for A = 0.3 and full redistribution, used to convert T_eq ↔ insolation when one is missing. */
const TEQ_EARTH_REF_K = 254.6;

/**
 * Picks an appearance class + continuous shader parameters (model 'illustrative-climate-state@1').
 * THIS IS A VISUALISATION HEURISTIC, NOT A CLIMATE PREDICTION: real climates depend on atmosphere, rotation,
 * water inventory and history that are unknown for almost every exoplanet.
 *  - Rocky (≤ 2 R⊕): insolation against the star's HZ limits — below early-Mars → frozen; within the HZ → temperate
 *    (ice fading out towards the inner edge); between runaway-greenhouse and ~2.5× that flux → runaway greenhouse
 *    (Venus-like haze); beyond → hot (desiccated / lava surface).
 *  - Gaseous (> 2 R⊕): Sudarsky et al. (2000) cloud classes by T_eq — I ammonia (< 150 K), II water (< 350 K),
 *    III cloud-free (< 900 K), IV alkali (< 1400 K), V silicate clouds (≥ 1400 K).
 */
export function illustrativeClimateState(input: ClimateStateInput): ClimateStateResult {
  const base = { provenance: 'illustrative', model: MODEL_CLIMATE_STATE } as const;
  let s = present(input.insolation) ? input.insolation : NaN;
  let teq = present(input.teqK) ? input.teqK : NaN;
  if (!Number.isFinite(s) && Number.isFinite(teq)) s = (teq / TEQ_EARTH_REF_K) ** 4;
  if (!Number.isFinite(teq) && Number.isFinite(s)) teq = TEQ_EARTH_REF_K * Math.pow(s, 0.25);

  if (input.sizeClass === 'unknown' || !Number.isFinite(s)) {
    return { ...base, state: 'unknown', iceCover: 0, oceanCover: 0, cloudCover: 0.3, hazeAmount: 0 };
  }

  if (isGaseous(input.sizeClass)) {
    let state: ClimateState;
    if (teq < 150) state = 'gas-giant-ammonia';
    else if (teq < 350) state = 'gas-giant-water';
    else if (teq < 900) state = 'gas-giant-clear';
    else if (teq < 1400) state = 'gas-giant-alkali';
    else state = 'gas-giant-silicate';
    const cloudCover = state === 'gas-giant-clear' ? 0.25 : state === 'gas-giant-alkali' ? 0.45 : 0.85;
    return { ...base, state, iceCover: 0, oceanCover: 0, cloudCover, hazeAmount: smoothstep(600, 1600, teq) * 0.6 };
  }

  const tStar = present(input.starTeffK) ? Math.min(7200, Math.max(2600, input.starTeffK)) : 5780;
  const sMaxGh = hzEffectiveFlux(tStar, 'maximumGreenhouse');
  const sEarlyMars = hzEffectiveFlux(tStar, 'earlyMars');
  const sRunaway = hzEffectiveFlux(tStar, 'runawayGreenhouse');
  const sHot = 2.5 * sRunaway;

  // Continuous parameters vary smoothly across class boundaries so slider-driven changes never pop.
  const warmth = smoothstep(sEarlyMars, sRunaway, s); // 0 at outer HZ edge → 1 at inner edge
  const iceCover = clamp01(1 - smoothstep(sMaxGh * 0.8, sRunaway * 0.9, s) * 0.95);
  const greenhouse = smoothstep(sRunaway * 0.95, sRunaway * 1.4, s);
  const scorched = smoothstep(sRunaway * 1.6, sHot, s);
  const oceanCover = clamp01((1 - iceCover) * 0.85 * (1 - greenhouse));
  const cloudCover = clamp01(0.25 + 0.4 * warmth + 0.35 * greenhouse - 0.6 * scorched);
  const hazeAmount = clamp01(greenhouse * (1 - scorched) + 0.15 * scorched);

  let state: ClimateState;
  if (s > sHot) state = 'hot';
  else if (s > sRunaway) state = 'runaway-greenhouse';
  else if (s >= sEarlyMars) state = 'temperate';
  else state = 'frozen';
  return { ...base, state, iceCover, oceanCover, cloudCover, hazeAmount };
}

/** Earth radius / mass helpers for the lab's "Earth units" displays. */
export const solarRadiusToM = (rSun: number): number => rSun * R_SUN_M;

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const EXOPLANET_MODELS: readonly ModelInfo[] = [
  {
    id: 'teq-blackbody',
    version: 1,
    title: 'Planetary equilibrium temperature',
    summary:
      'The temperature a planet would have if it simply balanced absorbed starlight with its own thermal glow — ' +
      'no greenhouse effect, no internal heat.',
    latex: String.raw`T_{\mathrm{eq}} = T_\star\sqrt{\frac{R_\star}{a}}\,\bigl[f\,(1-A)\bigr]^{1/4}`,
    extraLatex: [String.raw`f = \tfrac14 \;\Rightarrow\; T_{\mathrm{eq}} = T_\star\sqrt{\frac{R_\star}{2a}}\,(1-A)^{1/4}`],
    variables: [
      { symbol: String.raw`T_\star`, meaning: 'Stellar effective temperature', unit: 'K' },
      { symbol: String.raw`R_\star`, meaning: 'Stellar radius', unit: 'm' },
      { symbol: 'a', meaning: 'Orbital distance (semi-major axis)', unit: 'm' },
      { symbol: 'A', meaning: 'Bond albedo (fraction of light reflected)', unit: '' },
      { symbol: 'f', meaning: 'Heat redistribution factor: ¼ whole planet, ½ dayside only, ⅔ no redistribution', unit: '' },
    ],
    assumptions: [
      'Star and planet radiate as blackbodies.',
      'Circular orbit; no internal heat; no greenhouse warming.',
      'Albedo is assumed, not measured, for almost every exoplanet.',
    ],
    validity: 'Any star–planet pair; it is not the surface temperature (Earth: 255 K vs 288 K actual).',
    kind: 'derived',
    references: [
      { citation: 'Seager, S. (2010), Exoplanet Atmospheres, Princeton University Press, §3.1' },
      { citation: 'Cowan, N. B. & Agol, E. (2011), ApJ 729, 54', bibcode: '2011ApJ...729...54C' },
    ],
  },
  {
    id: 'insolation',
    version: 1,
    title: 'Insolation (stellar flux received)',
    summary: 'How much starlight a planet receives compared with Earth.',
    latex: String.raw`\frac{S}{S_\oplus} = \frac{L_\star / L_\odot}{(d / 1\,\mathrm{AU})^{2}}`,
    variables: [
      { symbol: 'S', meaning: 'Incident stellar flux', unit: 'S_earth' },
      { symbol: String.raw`L_\star`, meaning: 'Stellar luminosity', unit: 'L_sun' },
      { symbol: 'd', meaning: 'Star–planet distance', unit: 'AU' },
    ],
    assumptions: ['Inverse-square law; orbit-averaged distance for eccentric orbits is approximated by a.'],
    validity: 'All planets.',
    kind: 'derived',
    references: [{ citation: 'IAU 2015 Resolution B3 (nominal solar luminosity 3.828×10²⁶ W)' }],
  },
  {
    id: 'hz-kopparapu2014',
    version: 1,
    title: 'Habitable zone (Kopparapu et al. 2014)',
    summary:
      'The range of distances from a star where a rocky planet with an Earth-like atmosphere could keep liquid water ' +
      'on its surface. It describes the star, not whether any planet is habitable.',
    latex: String.raw`S_{\mathrm{eff}} = S_{\mathrm{eff}\odot} + aT_\star + bT_\star^{2} + cT_\star^{3} + dT_\star^{4},\quad T_\star = T_{\mathrm{eff}} - 5780\,\mathrm{K}`,
    extraLatex: [String.raw`d = \sqrt{\frac{L/L_\odot}{S_{\mathrm{eff}}}}\ \mathrm{AU}`],
    variables: [
      { symbol: String.raw`S_{\mathrm{eff}}`, meaning: 'Effective stellar flux at the HZ limit', unit: 'S_earth' },
      { symbol: String.raw`T_{\mathrm{eff}}`, meaning: 'Stellar effective temperature', unit: 'K' },
      { symbol: 'L', meaning: 'Stellar luminosity', unit: 'L_sun' },
      { symbol: 'd', meaning: 'Distance of the limit from the star', unit: 'AU' },
    ],
    assumptions: [
      '1-D cloud-free climate model of a planet with an H₂O/CO₂/N₂ atmosphere.',
      'Conservative limits: runaway greenhouse (inner) and maximum greenhouse (outer); optimistic: recent Venus / early Mars.',
      'Inner edge depends on planet mass (0.1, 1, 5 M⊕ variants).',
    ],
    validity: 'Stellar Teff 2600–7200 K; outside this range values are extrapolated and flagged.',
    kind: 'derived',
    references: [
      { citation: 'Kopparapu, R. K. et al. (2014), Habitable Zones around Main-sequence Stars: Dependence on Planetary Mass, ApJL 787, L29', doi: '10.1088/2041-8205/787/2/L29' },
      { citation: 'Kopparapu, R. K. et al. (2013), ApJ 765, 131 (and erratum ApJ 770, 82)', doi: '10.1088/0004-637X/765/2/131' },
    ],
  },
  {
    id: 'esi-schulze-makuch2011',
    version: 1,
    title: 'Earth Similarity Index',
    summary: ESI_DISCLAIMER,
    latex: String.raw`\mathrm{ESI} = \prod_{i=1}^{n}\left(1 - \left|\frac{x_i - x_{i\oplus}}{x_i + x_{i\oplus}}\right|\right)^{w_i/n}`,
    extraLatex: [
      String.raw`\mathrm{ESI}_{R,S} = 1 - \sqrt{\tfrac12\left[\left(\frac{S - S_\oplus}{S + S_\oplus}\right)^{2} + \left(\frac{R - R_\oplus}{R + R_\oplus}\right)^{2}\right]}`,
    ],
    variables: [
      { symbol: 'x_i', meaning: 'Planet property: radius, bulk density, escape velocity, surface temperature', unit: '' },
      { symbol: String.raw`x_{i\oplus}`, meaning: 'Earth value (1 R⊕, 1 ρ⊕, 1 v_esc⊕, 288 K)', unit: '' },
      { symbol: 'w_i', meaning: 'Weight exponent: 0.57, 1.07, 0.70, 5.58', unit: '' },
      { symbol: 'n', meaning: 'Number of properties used', unit: '' },
      { symbol: 'S', meaning: 'Insolation', unit: 'S_earth' },
      { symbol: 'R', meaning: 'Radius', unit: 'R_earth' },
    ],
    assumptions: [
      'Similarity is measured only in the listed physical properties.',
      'Surface temperature is rarely known for exoplanets; the radius + insolation form is then used.',
      'Says nothing about atmosphere, water, magnetic field or life.',
    ],
    validity: 'Comparisons between planets are meaningful only within the same variant.',
    kind: 'derived',
    references: [
      { citation: 'Schulze-Makuch, D. et al. (2011), A Two-Tiered Approach to Assessing the Habitability of Exoplanets, Astrobiology 11, 1041', doi: '10.1089/ast.2010.0592' },
      { citation: 'Planetary Habitability Laboratory, UPR Arecibo — Earth Similarity Index (radius–flux form)', url: 'https://phl.upr.edu/projects/earth-similarity-index-esi' },
    ],
  },
  {
    id: 'planet-size-class',
    version: 1,
    title: 'Planet size class',
    summary: 'A coarse label from radius alone. Radius does not determine composition.',
    latex: String.raw`0.8 < 1.25 < 2 < 4 < 8\ R_\oplus`,
    variables: [{ symbol: 'R', meaning: 'Planet radius', unit: 'R_earth' }],
    assumptions: ['Boundaries are conventions; the 1.5–2 R⊕ radius valley roughly separates rocky planets from those with gas envelopes.'],
    validity: 'Planets with a measured radius.',
    kind: 'derived',
    references: [
      { citation: 'Borucki, W. J. et al. (2011), ApJ 736, 19', bibcode: '2011ApJ...736...19B' },
      { citation: 'Fulton, B. J. et al. (2017), AJ 154, 109', bibcode: '2017AJ....154..109F' },
    ],
  },
  {
    id: 'illustrative-climate-state',
    version: 1,
    title: 'Illustrative planet appearance',
    summary:
      'Chooses how an exoplanet is DRAWN (ice, oceans, clouds, haze) from its insolation and size. This is a ' +
      'visualisation heuristic, not a prediction of the real climate, which is unknown.',
    latex: String.raw`\text{state} = \mathcal{H}\bigl(S / S_{\mathrm{HZ}}(T_\star),\ T_{\mathrm{eq}},\ \text{size class}\bigr)`,
    variables: [
      { symbol: 'S', meaning: 'Insolation', unit: 'S_earth' },
      { symbol: String.raw`S_{\mathrm{HZ}}`, meaning: 'Habitable-zone limit fluxes of the host star', unit: 'S_earth' },
      { symbol: String.raw`T_{\mathrm{eq}}`, meaning: 'Equilibrium temperature', unit: 'K' },
    ],
    assumptions: [
      'Rocky planets are assumed to have water and an Earth-like atmosphere purely for illustration.',
      'Giant-planet cloud classes follow Sudarsky et al. (2000) by equilibrium temperature.',
      'Rotation, tidal locking, atmosphere mass and composition are ignored.',
    ],
    validity: 'Illustration only. Must always be labelled "Illustrative".',
    kind: 'illustrative',
    references: [
      { citation: 'Sudarsky, D., Burrows, A. & Pinto, P. (2000), Albedo and Reflection Spectra of Extrasolar Giant Planets, ApJ 538, 885', bibcode: '2000ApJ...538..885S' },
      { citation: 'Kopparapu, R. K. et al. (2014), ApJL 787, L29' },
    ],
  },
];
