/**
 * Pure physics of an exoplanet system as Cosmos draws it: stellar fallbacks, the Chen & Kipping (2017) mass–radius
 * relation, the sky-plane orbit frame, Keplerian positions (real transit/conjunction phases where the archive has them),
 * the visual planet class, a tidal-locking estimate and exhibition-scale clearances. No THREE, no DOM (unit-tested).
 *
 * Orbit frame (visual-binary / Winn 2010 convention): X = projected celestial north at the star, Y = east, Z = toward
 * the observer (Sun). Elements (a, e, i, ω, Ω) are standard in that frame; a transit (inferior conjunction) happens at
 * true anomaly f = π/2 − ω, where the planet is closest to us. Ω is never measured for these planets: it is
 * illustrative (one value per system so the planets stay coplanar).
 */
import { AU_M, G_SI, JD_UNIX_EPOCH, L_SUN_W, M_EARTH_KG, M_SUN_KG, PC_M, R_EARTH_MEAN_M, R_SUN_M, SIGMA_SB, T_SUN_EFF_K } from '../../core/units';
import {
  habitableZone, hzEffectiveFlux, illustrativeClimateState, planetSizeClass, type ClimateStateResult, type HabitableZone,
} from '../../science/exoplanets';
import { eccentricToTrueAnomaly, solveKeplerElliptic, trueToMeanAnomaly } from '../../science/orbits';
import { hostPlanetRange, type ExoCatalog } from './catalog';

export const MODEL_MASS_RADIUS = 'mass-radius-chen-kipping2017@1';
export const MODEL_TIDAL_LOCK = 'tidal-lock-gladman1996@1';
export const M_JUP_EARTH = 317.83;

// ── Mass–radius (Chen & Kipping 2017, ApJ 834, 17; "Forecaster" mean relation) ───────────────────────────

/** Mean radius (R⊕) for a mass (M⊕): Terran R ∝ M^0.279 (< 2.04 M⊕), Neptunian ∝ M^0.589 (< 0.414 M_J), Jovian ∝ M^−0.044. */
export function radiusFromMassEarth(massE: number): number {
  if (!(massE > 0)) return NaN;
  if (massE < 2.04) return 1.008 * Math.pow(massE, 0.279);
  if (massE < 0.414 * M_JUP_EARTH) return 0.80811 * Math.pow(massE, 0.589);
  if (massE < 0.08 * 332_946) return 17.739 * Math.pow(massE, -0.044);
  return NaN; // stellar regime
}

/** Inverse of the Terran / Neptunian branches; NaN for R ≳ 14 R⊕ (the Jovian branch is degenerate in radius). */
export function massFromRadiusEarth(radiusE: number): number {
  if (!(radiusE > 0)) return NaN;
  if (radiusE < 1.23) return Math.pow(radiusE / 1.008, 1 / 0.279);
  if (radiusE < 14.2) return Math.pow(radiusE / 0.80811, 1 / 0.589);
  return NaN;
}

// ── Small helpers ─────────────────────────────────────────────────────────────────────────────

/** Deterministic hash of a string → [0, 1) (FNV-1a), for illustrative phases and orientations. */
export function hash01(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

export const unixMsToJd = (ms: number): number => ms / 86_400_000 + JD_UNIX_EPOCH;

const fin = (x: number): boolean => Number.isFinite(x);

// ── Star ──────────────────────────────────────────────────────────────────────────────────────

export interface StarModel {
  name: string;
  teffK: number;
  radiusM: number;
  massKg: number;
  luminosityW: number;
  /** Which values were filled in (shown as estimates): 1 teff, 2 radius, 4 mass, 8 luminosity. */
  estimated: number;
}

/** Host star with documented fallbacks: R from M (R ∝ M^0.8), M from R, L = 4πR²σT⁴ when log L is missing. */
export function starModel(c: ExoCatalog, host: number): StarModel {
  const h = c.hosts;
  let est = 0;
  let teff = h.teffK[host];
  let rSun = h.radiusSun[host];
  let mSun = h.massSun[host];
  if (!(teff > 0)) {
    teff = 5000;
    est |= 1;
  }
  if (!(rSun > 0)) {
    rSun = mSun > 0 ? Math.pow(mSun, 0.8) : 1;
    est |= 2;
  }
  if (!(mSun > 0)) {
    mSun = Math.pow(rSun, 1.25);
    est |= 4;
  }
  const radiusM = rSun * R_SUN_M;
  let lum = fin(h.logLum[host]) ? Math.pow(10, h.logLum[host]) * L_SUN_W : NaN;
  if (!(lum > 0)) {
    lum = 4 * Math.PI * radiusM * radiusM * SIGMA_SB * teff ** 4;
    est |= 8;
  }
  return { name: h.name[host], teffK: teff, radiusM, massKg: mSun * M_SUN_KG, luminosityW: lum, estimated: est };
}

// ── Sky-plane frame ───────────────────────────────────────────────────────────────────────────

/**
 * Column-major 3×3 rotation (orbit frame → ICRS) for a star at ICRS position (x, y, z): columns north, east, toward
 * the observer. Writes into `out` (length 9).
 */
export function skyPlaneFrame(x: number, y: number, z: number, out: Float64Array | number[]): Float64Array | number[] {
  const r = Math.hypot(x, y, z) || 1;
  const sx = x / r, sy = y / r, sz = z / r;
  // east = ẑ × s, normalised (degenerate at the poles → use +y).
  let ex = -sy, ey = sx, ez = 0;
  let el = Math.hypot(ex, ey, ez);
  if (el < 1e-9) {
    ex = 0; ey = 1; ez = 0; el = 1;
  }
  ex /= el; ey /= el; ez /= el;
  // toward observer o = −s; north = e × o... (N × E = O ⇒ N = E × O)
  const ox = -sx, oy = -sy, oz = -sz;
  const nx = ey * oz - ez * oy, ny = ez * ox - ex * oz, nz = ex * oy - ey * ox;
  out[0] = nx; out[1] = ny; out[2] = nz;
  out[3] = ex; out[4] = ey; out[5] = ez;
  out[6] = ox; out[7] = oy; out[8] = oz;
  return out;
}

// ── Planet classes ────────────────────────────────────────────────────────────────────────────

export type VisualType =
  | 'lava-world' | 'hot-rocky' | 'venus-like' | 'temperate-rocky' | 'frozen-rocky'
  | 'sub-neptune' | 'warm-neptune' | 'ice-giant'
  | 'cold-giant' | 'water-cloud-giant' | 'warm-giant' | 'hot-jupiter' | 'ultra-hot-jupiter';

export const VISUAL_TYPE_LABEL: Record<VisualType, string> = {
  'lava-world': 'Lava world',
  'hot-rocky': 'Scorched rocky planet',
  'venus-like': 'Runaway-greenhouse (Venus-like) world',
  'temperate-rocky': 'Temperate rocky planet',
  'frozen-rocky': 'Frozen rocky planet',
  'sub-neptune': 'Sub-Neptune',
  'warm-neptune': 'Warm Neptune',
  'ice-giant': 'Ice giant',
  'cold-giant': 'Cold gas giant',
  'water-cloud-giant': 'Temperate gas giant',
  'warm-giant': 'Warm gas giant',
  'hot-jupiter': 'Hot Jupiter',
  'ultra-hot-jupiter': 'Ultra-hot Jupiter',
};

export interface ClassifyInput {
  radiusE: number;
  massE: number;
  densGcc: number;
  /** Insolation, S⊕. */
  insolation: number;
  /** Zero-albedo, full-redistribution equilibrium temperature, K. */
  teq0K: number;
  starTeffK: number;
}

/** Is the planet most likely rocky? (radius valley at ~1.5–2 R⊕, Fulton et al. 2017; density decides in between). */
export function likelyRocky(radiusE: number, massE: number, densGcc: number): boolean {
  if (radiusE > 0) {
    if (radiusE < 1.6) return true;
    if (radiusE < 2.1 && densGcc >= 4.5) return true;
    return false;
  }
  return massE > 0 && massE < 5;
}

export function classifyPlanet(p: ClassifyInput): { type: VisualType; climate: ClimateStateResult } {
  const rocky = likelyRocky(p.radiusE, p.massE, p.densGcc);
  const r = p.radiusE > 0 ? p.radiusE : radiusFromMassEarth(p.massE);
  const sizeClass = rocky ? (r < 1.25 ? 'earth-size' : 'super-earth') : planetSizeClass(r);
  const climate = illustrativeClimateState({ teqK: p.teq0K, insolation: p.insolation, sizeClass, starTeffK: p.starTeffK });
  const t = p.teq0K;
  if (rocky) {
    if (t >= 1300) return { type: 'lava-world', climate };
    if (climate.state === 'hot') return { type: 'hot-rocky', climate };
    if (climate.state === 'runaway-greenhouse') return { type: 'venus-like', climate };
    if (climate.state === 'temperate') return { type: 'temperate-rocky', climate };
    if (climate.state === 'frozen') return { type: 'frozen-rocky', climate };
    return { type: t > 400 ? 'hot-rocky' : 'frozen-rocky', climate };
  }
  if (!(r >= 4)) return { type: 'sub-neptune', climate };
  if (r < 8) return { type: t < 200 ? 'ice-giant' : 'warm-neptune', climate };
  if (t >= 2000) return { type: 'ultra-hot-jupiter', climate };
  if (t >= 1000) return { type: 'hot-jupiter', climate };
  if (t >= 350) return { type: 'warm-giant', climate };
  if (t >= 150) return { type: 'water-cloud-giant', climate };
  return { type: 'cold-giant', climate };
}

// ── Tidal locking (Gladman et al. 1996, Icarus 122, 166) ─────────────────────────────────────

export interface TidalLockInput {
  semiMajorAxisM: number;
  planetMassKg: number;
  planetRadiusM: number;
  starMassKg: number;
  /** Initial spin rate, rad/s (default one turn per 12 h). */
  initialSpinRadS?: number;
  /** Tidal dissipation Q (default 100, rocky) and Love number k2 (default 0.3). */
  q?: number;
  k2?: number;
}

/** Despinning time to synchronous rotation, years: t = ω a⁶ I Q / (3 G M★² k₂ R⁵), I = 0.4 m R². */
export function tidalLockTimescaleYr(p: TidalLockInput): number {
  const { semiMajorAxisM: a, planetMassKg: m, planetRadiusM: R, starMassKg: M } = p;
  if (!(a > 0 && m > 0 && R > 0 && M > 0)) return NaN;
  const w = p.initialSpinRadS ?? (2 * Math.PI) / (12 * 3600);
  const Q = p.q ?? 100;
  const k2 = p.k2 ?? 0.3;
  const I = 0.4 * m * R * R;
  const t = (w * Math.pow(a, 6) * I * Q) / (3 * G_SI * M * M * k2 * Math.pow(R, 5));
  return t / (365.25 * 86_400);
}

// ── Planet + system models ───────────────────────────────────────────────────────────────────

export type ValueSource = 'observed' | 'archive-calculated' | 'estimated' | 'assumed' | 'unknown';

export interface PlanetModel {
  index: number;
  name: string;
  letter: string;
  placeable: boolean;
  aM: number;
  periodS: number;
  ecc: number;
  inclRad: number;
  omegaRad: number;
  raanRad: number;
  /** Mean anomaly at epochJd, rad. */
  meanAnomalyEpochRad: number;
  epochJd: number;
  /** μ = G (M★ + Mp), m³/s². */
  muM3S2: number;
  radiusM: number;
  radiusSource: ValueSource;
  massKg: number;
  massSource: ValueSource;
  /** S⊕ at a (from L★, a), or the archive value if L★/a are missing. */
  insolation: number;
  teq0K: number;
  type: VisualType;
  climate: ClimateStateResult;
  tidalLockYr: number;
  /** Likely synchronous (t_lock < age or < 1 Gyr when the age is unknown). */
  tidallyLocked: boolean;
  eccAssumed: boolean;
  inclIllustrative: boolean;
  phaseIllustrative: boolean;
  /** Max drawn radius before the planet would crowd its neighbours (exhibition scale), m. */
  clearanceM: number;
  /** Young self-luminous planet (directly imaged): observed effective temperature, K (NaN otherwise). */
  internalTeffK: number;
}

export interface CompanionStar {
  star: StarModel;
  /** Binary orbit (each star about the barycentre). */
  periodS: number;
  aM: number;
  ecc: number;
  inclRad: number;
  omegaRad: number;
  meanAnomalyEpochRad: number;
  epochJd: number;
  /** Mass fraction M_B / (M_A + M_B). */
  massFraction: number;
  source: string;
}

export interface SystemModel {
  host: number;
  name: string;
  star: StarModel;
  companion: CompanionStar | null;
  planets: PlanetModel[];
  hz: HabitableZone;
  /** Orbit frame → ICRS (column-major 3×3). */
  frame: Float64Array;
  raanRad: number;
  /** Largest apoapsis of a placeable planet (0 when none), m. */
  extentM: number;
  /** Max drawn star radius (exhibition scale), m. */
  starClearanceM: number;
  /** Planets with observed inclination share one; otherwise 60° (the median of random orientations) is illustrative. */
  systemInclRad: number;
  systemInclIllustrative: boolean;
}

export interface SystemExtras {
  companion?: CompanionStar | null;
  /** Observed effective temperatures of self-luminous planets by planet name. */
  internalTeffK?: Record<string, number>;
}

/** Build the drawable model of host `host` (all planets in archive order = period order). */
export function systemModel(c: ExoCatalog, host: number, extras: SystemExtras = {}): SystemModel {
  const P = c.planets;
  const star = starModel(c, host);
  const companion = extras.companion ?? null;
  const centralMass = star.massKg + (companion ? companion.star.massKg : 0);
  const centralLum = star.luminosityW + (companion ? companion.star.luminosityW : 0);
  const [r0, r1] = hostPlanetRange(c, host);
  const frame = new Float64Array(9);
  const x = c.hosts.xPc[host], y = c.hosts.yPc[host], z = c.hosts.zPc[host];
  if (fin(x)) skyPlaneFrame(x * PC_M, y * PC_M, z * PC_M, frame);
  else skyPlaneFrame(1, 0, 0, frame);
  const raan = hash01(`${c.hosts.name[host]}:node`) * 2 * Math.PI;

  // System inclination: median of the observed ones.
  const incl: number[] = [];
  for (let i = r0; i < r1; i++) if (fin(P.inclDeg[i])) incl.push(P.inclDeg[i]);
  incl.sort((a, b) => a - b);
  const sysIncl = incl.length ? incl[Math.floor(incl.length / 2)] * (Math.PI / 180) : Math.PI / 3;

  const age = c.hosts.ageGyr[host];
  const lockLimitYr = (age > 0 ? age : 1) * 1e9;
  const planets: PlanetModel[] = [];
  for (let i = r0; i < r1; i++) {
    const name = P.name[i];
    const mu0 = G_SI * centralMass;
    let periodS = P.periodDays[i] * 86_400;
    let aM = P.aAu[i] * AU_M;
    if (!(aM > 0) && periodS > 0) aM = Math.cbrt((mu0 * periodS * periodS) / (4 * Math.PI * Math.PI));
    if (!(periodS > 0) && aM > 0) periodS = 2 * Math.PI * Math.sqrt((aM * aM * aM) / mu0);
    const placeable = aM > 0 && periodS > 0;
    const eccRaw = P.ecc[i];
    const ecc = fin(eccRaw) && eccRaw >= 0 && eccRaw < 0.98 ? eccRaw : 0;
    const omega = fin(P.omegaDeg[i]) && ecc > 0 ? P.omegaDeg[i] * (Math.PI / 180) : Math.PI / 2;
    const inclKnown = fin(P.inclDeg[i]);
    const inclRad = inclKnown ? P.inclDeg[i] * (Math.PI / 180) : sysIncl;

    // Radius and mass.
    let radiusE = P.radiusE[i];
    let radiusSource: ValueSource = radiusE > 0 ? (P.calc[i] & 1 ? 'archive-calculated' : 'observed') : 'unknown';
    let massE = P.massE[i];
    let massSource: ValueSource = massE > 0 ? (P.massProv[i] === 4 ? 'archive-calculated' : 'observed') : 'unknown';
    if (!(radiusE > 0) && massE > 0) {
      radiusE = radiusFromMassEarth(massE);
      if (radiusE > 0) radiusSource = 'estimated';
    }
    if (!(radiusE > 0)) {
      radiusE = 1;
      radiusSource = 'assumed';
    }
    if (!(massE > 0)) {
      massE = massFromRadiusEarth(radiusE);
      massSource = massE > 0 ? 'estimated' : 'unknown';
    }
    const massKg = massE > 0 ? massE * M_EARTH_KG : NaN;
    const radiusM = radiusE * R_EARTH_MEAN_M;

    // Insolation & temperature.
    let S = aM > 0 ? centralLum / L_SUN_W / (aM / AU_M) ** 2 : NaN;
    if (!(S > 0)) S = P.insolE[i];
    let teq0 = S > 0 ? 278.6 * Math.pow(S, 0.25) : P.eqtK[i];
    if (!(teq0 > 0)) teq0 = NaN;
    const { type, climate } = classifyPlanet({
      radiusE, massE, densGcc: P.densGcc[i], insolation: S, teq0K: teq0, starTeffK: star.teffK,
    });

    // Phase: transit / conjunction midpoint when known, else illustrative.
    let epochJd = 2_451_545;
    let M0 = hash01(name) * 2 * Math.PI;
    let phaseIllustrative = true;
    if (fin(P.tMidJd[i]) && placeable) {
      const f = Math.PI / 2 - omega;
      M0 = trueToMeanAnomaly(f, ecc);
      epochJd = P.tMidJd[i];
      phaseIllustrative = false;
    }
    const tl = tidalLockTimescaleYr({ semiMajorAxisM: aM, planetMassKg: massKg, planetRadiusM: radiusM, starMassKg: star.massKg });
    planets.push({
      index: i, name, letter: P.letter[i], placeable,
      aM, periodS, ecc, inclRad, omegaRad: omega, raanRad: raan,
      meanAnomalyEpochRad: M0, epochJd,
      muM3S2: G_SI * (centralMass + (massKg > 0 ? massKg : 0)),
      radiusM, radiusSource, massKg, massSource,
      insolation: S, teq0K: teq0, type, climate,
      tidalLockYr: tl, tidallyLocked: tl > 0 && tl < lockLimitYr,
      eccAssumed: !fin(eccRaw), inclIllustrative: !inclKnown, phaseIllustrative,
      clearanceM: 0,
      internalTeffK: extras.internalTeffK?.[name] ?? NaN,
    });
  }

  // Clearances: a drawn planet stays within 30 % of the gap to its nearest neighbour orbit and of its periastron.
  const placed = planets.filter((p) => p.placeable).sort((a, b) => a.aM - b.aM);
  let extent = 0;
  let innerPeri = Infinity;
  for (let k = 0; k < placed.length; k++) {
    const p = placed[k];
    const peri = p.aM * (1 - p.ecc);
    innerPeri = Math.min(innerPeri, peri);
    extent = Math.max(extent, p.aM * (1 + p.ecc));
    let gap = 0.5 * peri;
    if (k > 0) gap = Math.min(gap, p.aM - placed[k - 1].aM);
    if (k < placed.length - 1) gap = Math.min(gap, placed[k + 1].aM - p.aM);
    p.clearanceM = Math.max(0.3 * gap, p.radiusM);
  }
  const binaryA = companion ? companion.aM * (1 + companion.ecc) : 0;
  let starClear = Number.isFinite(innerPeri) ? Math.max(0.3 * (innerPeri - binaryA), star.radiusM) : star.radiusM * 50;
  // Binary: both enlarged stars (same factor) must stay apart at periastron: R1·f + R2·f ≤ 0.6 a(1 − e).
  if (companion) {
    const sep = companion.aM * (1 - companion.ecc);
    const cap = (0.6 * sep * star.radiusM) / (star.radiusM + companion.star.radiusM);
    if (cap > 0) starClear = Math.max(Math.min(starClear, cap), star.radiusM);
  }
  return {
    host, name: c.hosts.name[host], star, companion, planets,
    hz: habitableZone(star.teffK, centralLum),
    frame, raanRad: raan, extentM: extent, starClearanceM: starClear,
    systemInclRad: sysIncl, systemInclIllustrative: incl.length === 0,
  };
}

/** Orbit-frame → ICRS rotation applied to a vector (column-major frame). */
export function applyFrame(frame: ArrayLike<number>, x: number, y: number, z: number, out: { x: number; y: number; z: number }): void {
  out.x = frame[0] * x + frame[3] * y + frame[6] * z;
  out.y = frame[1] * x + frame[4] * y + frame[7] * z;
  out.z = frame[2] * x + frame[5] * y + frame[8] * z;
}

interface OrbitLike {
  aM: number;
  periodS: number;
  ecc: number;
  inclRad: number;
  omegaRad: number;
  raanRad: number;
  meanAnomalyEpochRad: number;
  epochJd: number;
}

/** Mean anomaly at tMs. */
export function meanAnomalyAt(o: OrbitLike, tMs: number): number {
  const dt = (unixMsToJd(tMs) - o.epochJd) * 86_400;
  const M = o.meanAnomalyEpochRad + ((2 * Math.PI) / o.periodS) * dt;
  return M - 2 * Math.PI * Math.floor(M / (2 * Math.PI));
}

/** Offset from the system barycentre in the orbit frame (X north, Y east, Z toward us), metres. */
export function orbitOffset(o: OrbitLike, tMs: number, out: { x: number; y: number; z: number }): void {
  const M = meanAnomalyAt(o, tMs);
  const E = solveKeplerElliptic(M, o.ecc);
  const f = eccentricToTrueAnomaly(E, o.ecc);
  const r = o.aM * (1 - o.ecc * Math.cos(E));
  const u = o.omegaRad + f;
  const cu = Math.cos(u), su = Math.sin(u), cO = Math.cos(o.raanRad), sO = Math.sin(o.raanRad), ci = Math.cos(o.inclRad);
  out.x = r * (cO * cu - sO * su * ci);
  out.y = r * (sO * cu + cO * su * ci);
  out.z = r * su * Math.sin(o.inclRad);
}

/** Habitable-zone position words for a planet (uses the Kopparapu limits of the host). */
export function hzLabel(insolation: number, starTeffK: number): string {
  if (!(insolation > 0)) return 'Unknown';
  const t = Math.min(7200, Math.max(2600, starTeffK));
  if (insolation > hzEffectiveFlux(t, 'recentVenus')) return 'Inside the inner edge (too hot)';
  if (insolation > hzEffectiveFlux(t, 'runawayGreenhouse')) return 'Optimistic habitable zone (inner)';
  if (insolation >= hzEffectiveFlux(t, 'maximumGreenhouse')) return 'Conservative habitable zone';
  if (insolation >= hzEffectiveFlux(t, 'earlyMars')) return 'Optimistic habitable zone (outer)';
  return 'Beyond the outer edge (too cold)';
}

export { T_SUN_EFF_K };
