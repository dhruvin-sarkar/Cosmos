/**
 * Habitability lab model (pure): a star (Teff, luminosity) and a planet (distance, radius, mass, Bond albedo,
 * greenhouse warming) → insolation, equilibrium and surface temperature, habitable-zone position (Kopparapu et al.
 * 2013/2014), Earth Similarity Index (Schulze-Makuch et al. 2011), a tidal-locking hint (Gladman et al. 1996) and a
 * plain-language verdict. Every number is a simple, documented model, not a climate simulation.
 */
import { AU_M, L_SUN_W, M_EARTH_KG, M_SUN_KG, R_EARTH_MEAN_M, R_SUN_M, SIGMA_SB } from '../../core/units';
import {
  earthSimilarityIndex, equilibriumTemperatureK, habitableZone, hzPosition, type EsiResult, type HabitableZone, type HzPosition,
} from '../../science/exoplanets';
import { tidalLockTimescaleYr } from '../../domains/exoplanets/physics';

export type Redistribution = 'full' | 'dayside';

export interface HabInputs {
  starTeffK: number;
  /** L / L☉. */
  starLum: number;
  /** M / M☉; null = estimate from the main-sequence mass–luminosity relation. */
  starMass: number | null;
  /** Orbital distance, AU. */
  distanceAu: number;
  radiusE: number;
  massE: number;
  /** Bond albedo 0–0.95. */
  albedo: number;
  /** Greenhouse warming added to the equilibrium temperature, K (Earth ≈ 33 K, Venus ≈ 500 K). */
  greenhouseK: number;
  redistribution: Redistribution;
}

export interface HabResult {
  insolation: number;
  starRadiusM: number;
  starMassSun: number;
  starMassEstimated: boolean;
  teqK: number;
  surfaceK: number;
  hz: HabitableZone;
  hzPos: HzPosition;
  esi: EsiResult;
  densityGcc: number;
  gravityG: number;
  escapeKms: number;
  tidalLockYr: number;
  likelyLocked: boolean;
  /** Probably not rocky (thick H/He envelope). */
  gaseous: boolean;
  water: 'boiling' | 'liquid' | 'frozen';
  verdict: string;
  notes: string[];
}

/** Main-sequence mass from luminosity (inverse of L ∝ M^a; Duric 2004 piecewise exponents). */
export function massFromLuminosity(lSun: number): number {
  if (!(lSun > 0)) return NaN;
  // L = 0.23 M^2.3 (M < 0.43), L = M^4 (0.43–2), L = 1.4 M^3.5 (2–55).
  const m1 = Math.pow(lSun / 0.23, 1 / 2.3);
  if (m1 < 0.43) return m1;
  const m2 = Math.pow(lSun, 1 / 4);
  if (m2 < 2) return m2;
  return Math.pow(lSun / 1.4, 1 / 3.5);
}

/** Stellar radius from L and Teff (Stefan–Boltzmann), m. */
export function starRadiusM(teffK: number, lSun: number): number {
  return Math.sqrt((lSun * L_SUN_W) / (4 * Math.PI * SIGMA_SB * teffK ** 4));
}

const EARTH_DENSITY = 5.514;

export function evaluateHabitability(i: HabInputs): HabResult {
  const notes: string[] = [];
  const rStar = starRadiusM(i.starTeffK, i.starLum);
  const mStarEst = !(i.starMass && i.starMass > 0);
  const mStar = mStarEst ? massFromLuminosity(i.starLum) : (i.starMass as number);
  const aM = i.distanceAu * AU_M;
  const S = i.starLum / (i.distanceAu * i.distanceAu);
  const teq = equilibriumTemperatureK({
    starTeffK: i.starTeffK, starRadiusM: rStar, semiMajorAxisM: aM, bondAlbedo: Math.min(Math.max(i.albedo, 0), 0.95), redistribution: i.redistribution,
  });
  const surface = teq + Math.max(0, i.greenhouseK);
  const hz = habitableZone(i.starTeffK, i.starLum * L_SUN_W);
  const pos = hzPosition(S, i.starTeffK);
  const density = (i.massE / (i.radiusE ** 3)) * EARTH_DENSITY;
  const gravity = i.massE / (i.radiusE * i.radiusE);
  const escape = 11.186 * Math.sqrt(i.massE / i.radiusE);
  const gaseous = i.radiusE > 1.8 || (i.massE > 10 && density < 3);
  const esi = earthSimilarityIndex({
    radiusEarth: i.radiusE, densityEarth: density / EARTH_DENSITY, escapeVelocityEarth: escape / 11.186, surfaceTempK: surface,
  });
  const tl = tidalLockTimescaleYr({ semiMajorAxisM: aM, planetMassKg: i.massE * M_EARTH_KG, planetRadiusM: i.radiusE * R_EARTH_MEAN_M, starMassKg: mStar * M_SUN_KG });
  const locked = tl > 0 && tl < 1e9;
  const water: HabResult['water'] = surface >= 373.15 ? 'boiling' : surface >= 273.15 ? 'liquid' : 'frozen';

  // Plain-language verdict.
  let verdict: string;
  if (gaseous) {
    verdict = 'Probably a gas-rich world with no solid surface: not habitable in the way Earth is, whatever its temperature.';
  } else if (pos === 'too-hot') {
    verdict = 'Too close to its star: like Venus, any oceans would boil away in a runaway greenhouse.';
  } else if (pos === 'too-cold') {
    verdict = 'Too far from its star: even a thick carbon-dioxide atmosphere could not keep water liquid.';
  } else if (water === 'liquid') {
    verdict = pos === 'conservative'
      ? 'In the habitable zone and, with these settings, warm enough for liquid water: a promising world, if it has an atmosphere and water.'
      : 'At the edge of the habitable zone; with these settings liquid water is possible, but the planet would need the right atmosphere.';
  } else if (water === 'frozen') {
    verdict = 'In the habitable zone but frozen with these settings: a stronger greenhouse effect could warm it enough for liquid water.';
  } else {
    verdict = 'In the habitable zone but too hot with these settings: less greenhouse warming or brighter clouds would cool it.';
  }
  if (locked) notes.push('Probably tidally locked: one side always faces the star, the other is in permanent night. An atmosphere or ocean could carry heat to the night side.');
  if (i.starTeffK < 3900) notes.push('Red dwarfs flare often and strongly when young; X-rays and stellar wind may strip a close planet\'s atmosphere.');
  if (!hz.valid) notes.push('The star is outside 2600–7200 K, where the habitable-zone formulas are calibrated: its limits are extrapolated.');
  if (i.radiusE > 1.5 && i.radiusE <= 1.8) notes.push('Between 1.5 and 1.8 Earth radii many planets keep a thick hydrogen envelope; this one may or may not be rocky.');
  if (mStarEst) notes.push('Star mass estimated from its luminosity with the main-sequence mass–luminosity relation.');
  return {
    insolation: S, starRadiusM: rStar, starMassSun: mStar, starMassEstimated: mStarEst,
    teqK: teq, surfaceK: surface, hz, hzPos: pos, esi, densityGcc: density, gravityG: gravity, escapeKms: escape,
    tidalLockYr: tl, likelyLocked: locked, gaseous, water, verdict, notes,
  };
}

// ── Presets ─────────────────────────────────────────────────────────────────────────────────

export interface StarPreset {
  id: string;
  label: string;
  teffK: number;
  lum: number;
  mass: number | null;
  note: string;
}

/** Spectral-type presets (Pecaut & Mamajek 2013 main-sequence table, "Modern Mean Dwarf Stellar Color and Effective Temperature Sequence"). */
export const STAR_PRESETS: readonly StarPreset[] = [
  { id: 'M8V', label: 'Ultracool red dwarf (M8 V)', teffK: 2570, lum: 0.00055, mass: 0.09, note: 'Like TRAPPIST-1' },
  { id: 'M5V', label: 'Red dwarf (M5 V)', teffK: 3060, lum: 0.0029, mass: 0.16, note: 'Like Proxima Centauri' },
  { id: 'M0V', label: 'Red dwarf (M0 V)', teffK: 3850, lum: 0.069, mass: 0.57, note: '' },
  { id: 'K2V', label: 'Orange dwarf (K2 V)', teffK: 5040, lum: 0.31, mass: 0.79, note: 'Like Epsilon Eridani' },
  { id: 'G2V', label: 'Sun-like star (G2 V)', teffK: 5772, lum: 1, mass: 1, note: 'The Sun' },
  { id: 'F5V', label: 'Yellow-white star (F5 V)', teffK: 6510, lum: 2.98, mass: 1.33, note: '' },
  { id: 'A0V', label: 'White star (A0 V)', teffK: 9700, lum: 38, mass: 2.18, note: 'Like Vega; outside the HZ calibration' },
];

export interface PlanetPreset {
  id: string;
  label: string;
  /** Archive planet name to refresh values from the catalogue ('' = Solar System preset). */
  archiveName: string;
  inputs: HabInputs;
  source: string;
}

const earthLike = { albedo: 0.3, greenhouseK: 33, redistribution: 'full' as Redistribution };

/** Real planets. Solar System values: NASA Planetary Fact Sheets (Williams 2024). Exoplanets: NASA Exoplanet Archive. */
export const PLANET_PRESETS: readonly PlanetPreset[] = [
  {
    id: 'earth', label: 'Earth', archiveName: '', source: 'NASA Earth Fact Sheet: A = 0.306, Tsurf = 288 K',
    inputs: { starTeffK: 5772, starLum: 1, starMass: 1, distanceAu: 1, radiusE: 1, massE: 1, albedo: 0.306, greenhouseK: 33, redistribution: 'full' },
  },
  {
    id: 'venus', label: 'Venus', archiveName: '', source: 'NASA Venus Fact Sheet: A = 0.76, Tsurf = 737 K',
    inputs: { starTeffK: 5772, starLum: 1, starMass: 1, distanceAu: 0.723, radiusE: 0.949, massE: 0.815, albedo: 0.76, greenhouseK: 510, redistribution: 'full' },
  },
  {
    id: 'mars', label: 'Mars', archiveName: '', source: 'NASA Mars Fact Sheet: A = 0.25, Tsurf ≈ 210 K',
    inputs: { starTeffK: 5772, starLum: 1, starMass: 1, distanceAu: 1.524, radiusE: 0.532, massE: 0.107, albedo: 0.25, greenhouseK: 0, redistribution: 'full' },
  },
  {
    id: 'trappist-1e', label: 'TRAPPIST-1 e', archiveName: 'TRAPPIST-1 e', source: 'Agol et al. 2021 via the NASA Exoplanet Archive',
    inputs: { starTeffK: 2566, starLum: 0.000553, starMass: 0.0898, distanceAu: 0.02925, radiusE: 0.92, massE: 0.692, ...earthLike },
  },
  {
    id: 'proxima-b', label: 'Proxima Centauri b', archiveName: 'Proxima Cen b', source: 'NASA Exoplanet Archive (radius unmeasured: Chen & Kipping estimate from M sin i)',
    inputs: { starTeffK: 2900, starLum: 0.00155, starMass: 0.12, distanceAu: 0.04856, radiusE: 1.03, massE: 1.07, ...earthLike },
  },
  {
    id: 'kepler-186f', label: 'Kepler-186 f', archiveName: 'Kepler-186 f', source: 'NASA Exoplanet Archive (mass from the M–R relation)',
    inputs: { starTeffK: 3755, starLum: 0.055, starMass: 0.54, distanceAu: 0.432, radiusE: 1.17, massE: 1.71, ...earthLike },
  },
  {
    id: 'kepler-452b', label: 'Kepler-452 b', archiveName: 'Kepler-452 b', source: 'NASA Exoplanet Archive (mass from the M–R relation)',
    inputs: { starTeffK: 5757, starLum: 1.2, starMass: 1.04, distanceAu: 1.046, radiusE: 1.63, massE: 3.29, ...earthLike },
  },
  {
    id: 'toi-700d', label: 'TOI-700 d', archiveName: 'TOI-700 d', source: 'NASA Exoplanet Archive',
    inputs: { starTeffK: 3459, starLum: 0.0233, starMass: 0.415, distanceAu: 0.1633, radiusE: 1.144, massE: 1.72, ...earthLike },
  },
  {
    id: 'lhs-1140b', label: 'LHS 1140 b', archiveName: 'LHS 1140 b', source: 'NASA Exoplanet Archive (Cadieux et al. 2024)',
    inputs: { starTeffK: 3096, starLum: 0.0038, starMass: 0.184, distanceAu: 0.0946, radiusE: 1.73, massE: 5.6, ...earthLike },
  },
];

/** Human words for an HZ position. */
export const HZ_WORDS: Record<HzPosition, string> = {
  'too-hot': 'Inside the inner edge (too hot)',
  'optimistic-inner': 'Optimistic habitable zone (inner)',
  conservative: 'Conservative habitable zone',
  'optimistic-outer': 'Optimistic habitable zone (outer)',
  'too-cold': 'Beyond the outer edge (too cold)',
  unknown: 'Unknown',
};

export function inputsEqual(a: HabInputs, b: HabInputs): boolean {
  const k = Object.keys(a) as (keyof HabInputs)[];
  return k.every((x) => (typeof a[x] === 'number' ? Math.abs((a[x] as number) - (b[x] as number)) <= 1e-9 * Math.max(1, Math.abs(a[x] as number)) : a[x] === b[x]));
}

export { R_SUN_M };
