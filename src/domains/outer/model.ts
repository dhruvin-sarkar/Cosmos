/**
 * Outer Solar System model: pure, allocation-free-where-it-matters maths shared by the layers, entities and tests.
 *
 *  - Heliosphere shells (termination shock, heliopause): RECONSTRUCTED. A smooth axisymmetric-plus-tilt surface
 *    r(dir) = R · (1 + k·s^p) · (1 + a·dir·north) with s = (1 − cos θ)/2 and θ the angle from the interstellar-flow nose.
 *    (R, a) are fitted so the surface passes through the four spacecraft crossings below; k and p set the flank/tail
 *    elongation and are NOT measured (the tail is unconstrained by any spacecraft). The real shape is still debated.
 *  - Oort cloud: ILLUSTRATIVE seeded random shell (inner toroidal/Hills part + outer spherical part). Never observed.
 *  - Light-travel scale rings: DERIVED (c × time).
 */
import { AU_M, LIGHT_DAY_M, LIGHT_HOUR_M, LY_M } from '../../core/units';
import { eclipticToIcrs, sphericalToVector, ECLIPTIC_NORTH_POLE_ICRS, type Vec3 } from '../../core/frames';

// ── Interstellar flow / heliosphere nose ───────────────────────────────────────────────────

/** Ecliptic (J2000) coordinates of the interstellar-gas upwind direction (IBEX-Lo helium flow; Bzowski et al. 2015, ApJS 220, 28). */
export const NOSE_ECLIPTIC_LON_DEG = 255.7;
export const NOSE_ECLIPTIC_LAT_DEG = 5.1;
/** Interstellar neutral-helium inflow speed relative to the Sun, km/s (IBEX; ≈ 25–26 km/s). */
export const INFLOW_SPEED_KMS = 25.4;

/** Unit vector toward the heliospheric nose (upwind), ICRS axes. */
export const NOSE_ICRS: Readonly<Vec3> = Object.freeze(
  eclipticToIcrs(sphericalToVector(NOSE_ECLIPTIC_LON_DEG, NOSE_ECLIPTIC_LAT_DEG, 1, { x: 0, y: 0, z: 0 }), { x: 0, y: 0, z: 0 }),
);
export const ECLIPTIC_NORTH_ICRS: Readonly<Vec3> = ECLIPTIC_NORTH_POLE_ICRS;

const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;

// ── Spacecraft crossings (observed) ────────────────────────────────────────────────────────

export interface ShellCrossing {
  craftId: 'voyager-1' | 'voyager-2';
  shell: 'termination-shock' | 'heliopause';
  /** UTC instant of the crossing. */
  dateIso: string;
  /** Heliocentric distance at the crossing, AU. */
  distanceAU: number;
  citation: string;
}

export const CROSSINGS: readonly ShellCrossing[] = [
  { craftId: 'voyager-1', shell: 'termination-shock', dateIso: '2004-12-16T00:00:00Z', distanceAU: 94.0, citation: 'Stone et al. 2005, Science 309, 2017' },
  { craftId: 'voyager-2', shell: 'termination-shock', dateIso: '2007-08-30T00:00:00Z', distanceAU: 83.7, citation: 'Stone et al. 2008, Nature 454, 71' },
  { craftId: 'voyager-1', shell: 'heliopause', dateIso: '2012-08-25T00:00:00Z', distanceAU: 121.6, citation: 'Stone et al. 2013, Science 341, 150; Gurnett et al. 2013, Science 341, 1489' },
  { craftId: 'voyager-2', shell: 'heliopause', dateIso: '2018-11-05T00:00:00Z', distanceAU: 119.0, citation: 'Stone et al. 2019, Nature Astronomy 3, 1013' },
];

/**
 * Fallback sky directions (RA, Dec in degrees, ICRS) used only when the spacecraft entity or its trajectory is unavailable:
 * Voyager 1 ≈ 17h16m +12.2°, Voyager 2 ≈ 20h12m −59.4° (from the 2026 Horizons trajectories; both craft move almost radially, so the direction is constant to within a few degrees).
 */
export const CRAFT_FALLBACK_RADEC: Record<ShellCrossing['craftId'], { raDeg: number; decDeg: number }> = {
  'voyager-1': { raDeg: 258.9, decDeg: 12.2 },
  'voyager-2': { raDeg: 303.0, decDeg: -59.4 },
};

// ── Shell shape ────────────────────────────────────────────────────────────────────────────

export interface ShellParams {
  /** Nose-scale distance, AU. */
  R: number;
  /** Flank/tail elongation (dimensionless) and exponent. */
  k: number;
  p: number;
  /** North–south asymmetry coefficient (fitted to the two Voyager lines of sight). */
  a: number;
  /** Maximum angle from the nose that is drawn, degrees (the tail is open and unconstrained). */
  thetaMaxDeg: number;
}

/** Fitted so that r(Voyager 1 direction) and r(Voyager 2 direction) match the crossings above (see model.test.ts). */
export const TERMINATION_SHOCK: ShellParams = { R: 85.1, k: 0.9, p: 1.5, a: 0.151, thetaMaxDeg: 150 };
export const HELIOPAUSE: ShellParams = { R: 110.1, k: 1.8, p: 1.5, a: 0.123, thetaMaxDeg: 150 };

/** Shell radius (AU) in the direction of unit vector `dir` (ICRS). */
export function shellRadiusAU(s: ShellParams, dir: Vec3): number {
  const sθ = 0.5 * (1 - dot(dir, NOSE_ICRS));
  return s.R * (1 + s.k * Math.pow(sθ, s.p)) * (1 + s.a * dot(dir, ECLIPTIC_NORTH_ICRS));
}

/** Angle (degrees) between `dir` and the nose. */
export function angleFromNoseDeg(dir: Vec3): number {
  return (Math.acos(Math.max(-1, Math.min(1, dot(dir, NOSE_ICRS)))) * 180) / Math.PI;
}

// ── Light-travel scale rings ───────────────────────────────────────────────────────────────

export interface ScaleRing {
  id: 'light-hour' | 'light-day' | 'light-year';
  label: string;
  radiusM: number;
  radiusAU: number;
}

const ring = (id: ScaleRing['id'], label: string, radiusM: number): ScaleRing => ({ id, label, radiusM, radiusAU: radiusM / AU_M });
export const SCALE_RINGS: readonly ScaleRing[] = [
  ring('light-hour', '1 light-hour', LIGHT_HOUR_M),
  ring('light-day', '1 light-day', LIGHT_DAY_M),
  ring('light-year', '1 light-year', LY_M),
];

// ── Oort cloud (illustrative) ──────────────────────────────────────────────────────────────

export const OORT_INNER_AU = 2_000;
export const OORT_OUTER_AU = 100_000;
/** Boundary between the flattened inner (Hills) cloud and the isotropic outer cloud, AU. */
export const OORT_HILLS_EDGE_AU = 20_000;

/** mulberry32 — small seeded PRNG so the illustrative cloud is identical every run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface OortCloudData {
  /** xyz (AU), ecliptic-frame, interleaved. Rotate to ICRS with the ecliptic obliquity when placing. */
  positions: Float32Array;
  /** Per-point brightness 0.3..1. */
  brightness: Float32Array;
  count: number;
}

/**
 * Seeded illustrative Oort cloud in the ECLIPTIC frame: ~35 % inner cloud (2 000–20 000 AU, concentrated toward the
 * ecliptic: latitude σ ≈ 25°), ~65 % outer cloud (20 000–100 000 AU, isotropic). Radii follow a density ∝ r⁻³·⁵ shell
 * profile for the inner part and a gently peaked shell for the outer part so the edge reads clearly.
 */
export function generateOortCloud(count: number, seed = 1950): OortCloudData {
  const rnd = mulberry32(seed);
  const gauss = (): number => Math.sqrt(-2 * Math.log(Math.max(1e-9, rnd()))) * Math.cos(2 * Math.PI * rnd());
  const positions = new Float32Array(count * 3);
  const brightness = new Float32Array(count);
  const nInner = Math.floor(count * 0.35);
  for (let i = 0; i < count; i++) {
    let r: number, lat: number;
    if (i < nInner) {
      // pdf(r) ∝ r^-1.5 on [inner, hills]: inverse-CDF sampling.
      const u = rnd();
      const a = Math.pow(OORT_INNER_AU, -0.5), b = Math.pow(OORT_HILLS_EDGE_AU, -0.5);
      r = Math.pow(a - u * (a - b), -2);
      lat = (gauss() * 25 * Math.PI) / 180;
    } else {
      // Outer: log-uniform in r, then biased outward so the shell edge is visible.
      const u = Math.pow(rnd(), 0.7);
      r = OORT_HILLS_EDGE_AU * Math.pow(OORT_OUTER_AU / OORT_HILLS_EDGE_AU, u);
      lat = Math.asin(2 * rnd() - 1);
    }
    const lon = 2 * Math.PI * rnd();
    const c = Math.cos(lat);
    positions[3 * i] = r * c * Math.cos(lon);
    positions[3 * i + 1] = r * c * Math.sin(lon);
    positions[3 * i + 2] = r * Math.sin(lat);
    brightness[i] = 0.3 + 0.7 * Math.pow(rnd(), 2.5);
  }
  return { positions, brightness, count };
}

// ── Trans-Neptunian object classes ─────────────────────────────────────────────────────────

/** Order matches `classes` in public/data/outer/tnos.json. Scene-linear colours, deliberately muted but distinct. */
export const TNO_CLASSES = [
  'cold-classical', 'hot-classical', 'plutino', 'twotino', 'other-resonant', 'scattered', 'detached', 'other',
] as const;
export type TnoClass = (typeof TNO_CLASSES)[number];

export const TNO_CLASS_LABEL: Record<TnoClass, string> = {
  'cold-classical': 'Cold classical Kuiper belt',
  'hot-classical': 'Hot classical Kuiper belt',
  plutino: 'Plutino (3:2 resonance with Neptune)',
  twotino: 'Twotino (2:1 resonance with Neptune)',
  'other-resonant': 'Other Neptune resonance',
  scattered: 'Scattered disk',
  detached: 'Detached object',
  other: 'Other trans-Neptunian object',
};

export const TNO_CLASS_COLOR: Record<TnoClass, [number, number, number]> = {
  'cold-classical': [1.0, 0.62, 0.42], // reddish: the dynamically cold, very red surfaces
  'hot-classical': [0.95, 0.82, 0.62],
  plutino: [0.62, 0.78, 1.0],
  twotino: [0.55, 0.95, 0.85],
  'other-resonant': [0.7, 0.72, 1.0],
  scattered: [0.85, 0.7, 1.0],
  detached: [1.0, 0.55, 0.8],
  other: [0.72, 0.74, 0.78],
};
