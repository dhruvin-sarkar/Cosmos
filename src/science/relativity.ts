/**
 * General-relativity helpers for the Sagittarius A* lab: Schwarzschild radii and characteristic orbits,
 * gravitational time dilation for static and circular-orbit observers, weak-field light deflection, the Einstein
 * radius, tidal stretching and a proper-time clock.
 *
 * Non-rotating (Schwarzschild) black holes only — Sgr A*'s spin is poorly constrained and ignored here.
 * Units: SI (m, s, kg). Inside or at the horizon the static/circular quantities are undefined → NaN (never throw).
 */
import { C_M_PER_S, G_SI } from '../core/units';
import type { ModelInfo } from './models';

export const MODEL_SCHWARZSCHILD = 'schwarzschild@1';
export const MODEL_LIGHT_DEFLECTION = 'weak-field-deflection@1';
export const MODEL_TIDAL = 'newtonian-tidal@1';

const C2 = C_M_PER_S * C_M_PER_S;

/** Schwarzschild radius r_s = 2GM/c². */
export function schwarzschildRadiusM(massKg: number): number {
  return massKg > 0 ? (2 * G_SI * massKg) / C2 : NaN;
}

/** Schwarzschild radius from a gravitational parameter μ = GM (more precise for solar-system bodies). */
export function schwarzschildRadiusFromMuM(muM3S2: number): number {
  return muM3S2 > 0 ? (2 * muM3S2) / C2 : NaN;
}

/** Photon-sphere radius 1.5 r_s (unstable circular light orbits). */
export const photonSphereRadiusM = (rsM: number): number => (rsM > 0 ? 1.5 * rsM : NaN);

/** Innermost stable circular orbit 3 r_s (= 6GM/c²) for a non-rotating black hole. */
export const iscoRadiusM = (rsM: number): number => (rsM > 0 ? 3 * rsM : NaN);

/** Apparent radius of the shadow seen from far away: b_c = (3√3/2) r_s ≈ 2.598 r_s. */
export const shadowRadiusM = (rsM: number): number => (rsM > 0 ? 1.5 * Math.sqrt(3) * rsM : NaN);

/**
 * Proper-time rate of a STATIC observer at radius r relative to a distant observer: dτ/dt = √(1 − r_s/r).
 * Defined for r > r_s; NaN otherwise.
 */
export function staticObserverTimeDilation(radiusM: number, rsM: number): number {
  if (!(rsM >= 0) || !(radiusM > rsM)) return NaN;
  return Math.sqrt(1 - rsM / radiusM);
}

/**
 * Proper-time rate on a circular geodesic orbit at radius r: dτ/dt = √(1 − 3r_s/2r) (gravitational + orbital
 * motion). Timelike circular orbits exist for r > 1.5 r_s (stable only for r ≥ 3 r_s); NaN otherwise.
 */
export function circularOrbitTimeDilation(radiusM: number, rsM: number): number {
  if (!(rsM >= 0) || !(radiusM > 1.5 * rsM)) return NaN;
  return Math.sqrt(1 - (1.5 * rsM) / radiusM);
}

/** Gravitational redshift of light emitted by a static source at r and received far away: z = 1/√(1 − r_s/r) − 1. */
export function gravitationalRedshift(radiusM: number, rsM: number): number {
  const k = staticObserverTimeDilation(radiusM, rsM);
  return Number.isFinite(k) ? 1 / k - 1 : NaN;
}

/** Orbital speed on a circular Schwarzschild orbit measured by a local static observer: v/c = √(r_s / (2(r − r_s))). */
export function circularOrbitLocalSpeedMS(radiusM: number, rsM: number): number {
  if (!(radiusM > 1.5 * rsM) || !(rsM > 0)) return NaN;
  return C_M_PER_S * Math.sqrt(rsM / (2 * (radiusM - rsM)));
}

/**
 * Weak-field light deflection angle α = 4GM/(c² b) = 2 r_s / b (rad), valid for b ≫ r_s.
 * The Sun's limb (b = R☉) gives 1.75″.
 */
export function lightDeflectionRad(massKg: number, impactParameterM: number): number {
  if (!(massKg > 0) || !(impactParameterM > 0)) return NaN;
  return (4 * G_SI * massKg) / (C2 * impactParameterM);
}

/**
 * Einstein radius θ_E = √(4GM/c² · D_ls / (D_l D_s)) (rad) for a point-mass lens. Distances are angular-diameter
 * distances; in a non-cosmological (Galactic) setting D_ls = D_s − D_l.
 */
export function einsteinRadiusRad(lensMassKg: number, lensDistanceM: number, sourceDistanceM: number, lensSourceDistanceM?: number): number {
  const dls = lensSourceDistanceM ?? sourceDistanceM - lensDistanceM;
  if (!(lensMassKg > 0) || !(lensDistanceM > 0) || !(sourceDistanceM > 0) || !(dls > 0)) return NaN;
  return Math.sqrt(((4 * G_SI * lensMassKg) / C2) * (dls / (lensDistanceM * sourceDistanceM)));
}

/**
 * Newtonian tidal stretch: difference in gravitational acceleration across a body of length L oriented radially
 * at distance r, Δa ≈ 2GM L / r³ (m/s²). Valid for L ≪ r; near a black hole it is the leading-order radial
 * component of the geodesic deviation (exact in the static frame up to O(r_s/r) corrections).
 */
export function tidalStretchAccelerationMS2(massKg: number, radiusM: number, lengthM: number): number {
  if (!(massKg > 0) || !(radiusM > 0) || !(lengthM >= 0)) return NaN;
  return (2 * G_SI * massKg * lengthM) / (radiusM * radiusM * radiusM);
}

/** Radius at which radial tidal stretch over `lengthM` reaches `accelerationMS2`: r = (2GM L / Δa)^(1/3). */
export function tidalRadiusForAccelerationM(massKg: number, lengthM: number, accelerationMS2: number): number {
  if (!(massKg > 0) || !(lengthM > 0) || !(accelerationMS2 > 0)) return NaN;
  return Math.cbrt((2 * G_SI * massKg * lengthM) / accelerationMS2);
}

export type ClockMotion = 'static' | 'circular';

/**
 * Accumulates proper time τ of an observer against coordinate time t (the clock of a distant observer).
 * Each `advance(dt, r)` integrates dτ = (dτ/dt)(r) dt with the midpoint radius supplied by the caller.
 * Crossing r ≤ r_s (static) or r ≤ 1.5 r_s (circular) stops the clock (`valid` becomes false) instead of
 * producing NaN in the totals. Allocation-free; safe in a frame loop.
 */
export class ProperTimeClock {
  coordinateTimeS = 0;
  properTimeS = 0;
  /** Most recent dτ/dt. */
  rate = 1;
  valid = true;

  constructor(
    readonly rsM: number,
    readonly motion: ClockMotion = 'static',
  ) {}

  /** Advance by coordinate time dt at radius r. Returns the proper time elapsed in this step (0 once invalid). */
  advance(dtCoordinateS: number, radiusM: number): number {
    if (!this.valid || !(dtCoordinateS >= 0)) return 0;
    const k = this.motion === 'static' ? staticObserverTimeDilation(radiusM, this.rsM) : circularOrbitTimeDilation(radiusM, this.rsM);
    if (!Number.isFinite(k)) {
      this.valid = false;
      this.rate = 0;
      return 0;
    }
    this.rate = k;
    const dTau = k * dtCoordinateS;
    this.coordinateTimeS += dtCoordinateS;
    this.properTimeS += dTau;
    return dTau;
  }

  /** Accumulated lag t − τ (s). */
  get lagS(): number {
    return this.coordinateTimeS - this.properTimeS;
  }

  reset(): void {
    this.coordinateTimeS = 0;
    this.properTimeS = 0;
    this.rate = 1;
    this.valid = true;
  }
}

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const RELATIVITY_MODELS: readonly ModelInfo[] = [
  {
    id: 'schwarzschild',
    version: 1,
    title: 'Schwarzschild black hole: horizon, orbits and time dilation',
    summary:
      'Near a non-rotating black hole clocks run slow compared with clocks far away. The event horizon, photon ' +
      'sphere and innermost stable orbit are all simple multiples of the Schwarzschild radius.',
    latex: String.raw`r_s = \frac{2GM}{c^{2}},\qquad \frac{d\tau}{dt}\Big|_{\mathrm{static}} = \sqrt{1 - \frac{r_s}{r}}`,
    extraLatex: [
      String.raw`\frac{d\tau}{dt}\Big|_{\mathrm{circular}} = \sqrt{1 - \frac{3r_s}{2r}}`,
      String.raw`r_{\mathrm{ph}} = \tfrac32 r_s,\quad r_{\mathrm{ISCO}} = 3r_s,\quad b_{\mathrm{shadow}} = \tfrac{3\sqrt3}{2}r_s`,
      String.raw`1 + z = \left(1 - \frac{r_s}{r}\right)^{-1/2}`,
    ],
    variables: [
      { symbol: 'r_s', meaning: 'Schwarzschild radius (event horizon)', unit: 'm' },
      { symbol: 'M', meaning: 'Black-hole mass', unit: 'kg' },
      { symbol: 'r', meaning: 'Areal radius (circumference / 2π)', unit: 'm' },
      { symbol: String.raw`\tau`, meaning: 'Proper time of the nearby observer', unit: 's' },
      { symbol: 't', meaning: 'Coordinate time of a distant observer', unit: 's' },
      { symbol: 'z', meaning: 'Gravitational redshift', unit: '' },
    ],
    assumptions: [
      'Non-rotating, uncharged black hole (Schwarzschild metric); spin of Sgr A* ignored.',
      'Observers are static (hovering with rockets) or on free circular orbits.',
    ],
    validity: 'r > r_s for static observers; r > 1.5 r_s for circular orbits (stable only beyond 3 r_s).',
    kind: 'derived',
    references: [
      { citation: 'Schwarzschild, K. (1916), Sitzungsber. Preuss. Akad. Wiss., 189' },
      { citation: 'Misner, Thorne & Wheeler (1973), Gravitation, W. H. Freeman, §25' },
      { citation: 'GRAVITY Collaboration (2023), A&A 677, L10 — Sgr A* mass 4.297×10⁶ M☉', doi: '10.1051/0004-6361/202347416' },
    ],
  },
  {
    id: 'weak-field-deflection',
    version: 1,
    title: 'Gravitational light deflection and Einstein ring',
    summary: 'Mass bends passing light; a lens exactly in front of a source turns it into a ring of angular radius θ_E.',
    latex: String.raw`\alpha = \frac{4GM}{c^{2}b}`,
    extraLatex: [String.raw`\theta_E = \sqrt{\frac{4GM}{c^{2}}\,\frac{D_{ls}}{D_l D_s}}`],
    variables: [
      { symbol: String.raw`\alpha`, meaning: 'Deflection angle', unit: 'rad' },
      { symbol: 'b', meaning: 'Impact parameter (closest approach of the light ray)', unit: 'm' },
      { symbol: String.raw`\theta_E`, meaning: 'Einstein radius', unit: 'rad' },
      { symbol: 'D_l, D_s, D_{ls}', meaning: 'Distances observer–lens, observer–source, lens–source', unit: 'm' },
    ],
    assumptions: ['Weak field (b ≫ r_s); point-mass lens; thin-lens approximation.'],
    validity: 'b ≳ 10 r_s; strong-field images near the photon sphere need ray tracing.',
    kind: 'derived',
    references: [
      { citation: 'Einstein, A. (1936), Science 84, 506', doi: '10.1126/science.84.2188.506' },
      { citation: 'Schneider, Ehlers & Falco (1992), Gravitational Lenses, Springer' },
    ],
  },
  {
    id: 'newtonian-tidal',
    version: 1,
    title: 'Tidal stretching',
    summary: 'The difference in gravity between your head and feet; near small black holes it becomes lethal outside the horizon.',
    latex: String.raw`\Delta a \approx \frac{2GM\,L}{r^{3}}`,
    variables: [
      { symbol: String.raw`\Delta a`, meaning: 'Stretching acceleration across the body', unit: 'm/s2' },
      { symbol: 'L', meaning: 'Body length along the radial direction', unit: 'm' },
      { symbol: 'r', meaning: 'Distance from the centre', unit: 'm' },
    ],
    assumptions: ['L ≪ r; leading-order (Newtonian / geodesic-deviation) term.'],
    validity: 'Good to O(r_s/r) outside the horizon.',
    kind: 'derived',
    references: [{ citation: 'Misner, Thorne & Wheeler (1973), Gravitation, §31.2 (geodesic deviation)' }],
  },
];
