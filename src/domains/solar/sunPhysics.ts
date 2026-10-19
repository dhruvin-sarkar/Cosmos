/**
 * Pure solar-physics helpers for the Sun renderer (no GPU): wavelength-dependent limb darkening, differential
 * rotation, the white-light corona brightness profile, and the geometry that projects an Earth-view (SDO) full-disc
 * image onto the rotating solar sphere.
 *
 * Body frame (bodyOrientation in ./ephemeris): +Z = solar north pole, +X = IAU prime meridian (W), right-handed.
 */
import * as THREE from 'three';
import type { RotationModel } from './constants';
import { bodyOrientation } from './ephemeris';

// ── Limb darkening ───────────────────────────────────────────────────────────────────────────────────

/**
 * Solar limb darkening I(μ)/I(1) = 1 − u₂ − v₂ + u₂μ + v₂μ² ("Allen's" two-coefficient law), tabulated by
 * wavelength in Allen's Astrophysical Quantities (4th ed., Cox 2000, §14.7, Table 14.17), a fit to the measured
 * centre-to-limb variation of Pierce & Slaughter (1977, Solar Phys. 51, 25) and Neckel & Labs (1994, Solar Phys.
 * 153, 91). Rows: [λ µm, u₂, v₂].
 */
export const ALLEN_LIMB_TABLE: readonly (readonly [number, number, number])[] = [
  [0.4, 0.91, -0.05],
  [0.45, 0.99, -0.17],
  [0.5, 0.97, -0.22],
  [0.55, 0.93, -0.23],
  [0.6, 0.88, -0.23],
  [0.8, 0.73, -0.22],
  [1.0, 0.64, -0.2],
  [1.5, 0.57, -0.21],
  [2.0, 0.48, -0.18],
  [3.0, 0.35, -0.12],
  [5.0, 0.22, -0.07],
  [10.0, 0.15, -0.07],
];

/** Interpolated (u₂, v₂) at wavelength λ (µm), clamped to the table range. */
export function limbCoefficients(lambdaUm: number): { u2: number; v2: number } {
  const t = ALLEN_LIMB_TABLE;
  if (lambdaUm <= t[0][0]) return { u2: t[0][1], v2: t[0][2] };
  for (let i = 1; i < t.length; i++) {
    if (lambdaUm <= t[i][0]) {
      const a = t[i - 1], b = t[i];
      const f = (lambdaUm - a[0]) / (b[0] - a[0]);
      return { u2: a[1] + (b[1] - a[1]) * f, v2: a[2] + (b[2] - a[2]) * f };
    }
  }
  const z = t[t.length - 1];
  return { u2: z[1], v2: z[2] };
}

/** I(μ)/I(1) for coefficients (u₂, v₂). */
export function limbIntensity(mu: number, u2: number, v2: number): number {
  const m = Math.max(0, Math.min(1, mu));
  return 1 - u2 - v2 + u2 * m + v2 * m * m;
}

/** Effective wavelengths (µm) of the display R, G, B channels used for per-channel limb darkening. */
export const CHANNEL_WAVELENGTH_UM = { visible: [0.61, 0.54, 0.465], infrared: [1.6, 1.25, 1.0] } as const;

/** Per-channel (u₂ RGB, v₂ RGB) for a band. */
export function channelLimbCoefficients(band: 'visible' | 'infrared'): { u2: [number, number, number]; v2: [number, number, number] } {
  const l = CHANNEL_WAVELENGTH_UM[band];
  const c = l.map(limbCoefficients);
  return { u2: [c[0].u2, c[1].u2, c[2].u2], v2: [c[0].v2, c[1].v2, c[2].v2] };
}

// ── Rotation ─────────────────────────────────────────────────────────────────────────────────────────

/** IAU (WGCCRE 2015) rigid rotation rate of the Sun's prime meridian, deg/day (the body frame's rate). */
export const SUN_FRAME_RATE_DEG_DAY = 14.1844;

/**
 * Sidereal differential rotation rate (deg/day) at heliographic latitude `latRad`:
 * ω = A + B sin²φ + C sin⁴φ with A = 14.713, B = −2.396, C = −1.787 (Snodgrass & Ulrich 1990, ApJ 351, 309).
 */
export function differentialRotationDegPerDay(latRad: number): number {
  const s2 = Math.sin(latRad) ** 2;
  return 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
}

// ── Corona ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * White-light (K + F) corona radiance relative to the disc-centre photosphere, at r solar radii:
 * Baumbach (1937) / Allen: I/I☉ = 10⁻⁶ (0.0532 r⁻²·⁵ + 1.425 r⁻⁷ + 2.565 r⁻¹⁷). About 2 × 10⁻⁶ just above the
 * limb — a million times fainter than the disc, which is why it is only seen in eclipses or with coronagraphs.
 */
export function baumbachCorona(r: number): number {
  return 1e-6 * (0.0532 * r ** -2.5 + 1.425 * r ** -7 + 2.565 * r ** -17);
}

// ── Earth-view image geometry ────────────────────────────────────────────────────────────────────────

/** SDO browse-image plate scales (arcsec per pixel at 1024²): AIA 0.6″ and HMI 0.504″ native at 4096². */
export const AIA_ARCSEC_PER_PX_1024 = 2.4;
export const HMI_ARCSEC_PER_PX_1024 = 2.016;

const ARCSEC = Math.PI / (180 * 3600);

/** Apparent solar radius (arcsec) from distance `dM` (metres) for a radius `rM`. */
export function sunAngularRadiusArcsec(rM: number, dM: number): number {
  return Math.asin(Math.min(1, rM / dM)) / ARCSEC;
}

/**
 * Orientation of a north-up, Earth-view full-disc image on the solar body frame at the image time:
 * `e` = toward the observer (disc centre), `up` = projected solar north, `right` = solar west (image +x).
 * A body-frame unit point p on the visible hemisphere (p·e > 0) maps to image coordinates
 * (x, y) = (p·right, p·up) in units of the disc radius.
 */
export interface ImageFrame {
  e: THREE.Vector3;
  up: THREE.Vector3;
  right: THREE.Vector3;
  /** Heliographic latitude of the disc centre (B₀), radians. */
  b0Rad: number;
}

const qScratch = new THREE.Quaternion();

/**
 * Image frame for an observer in ICRS direction `towardObserverIcrs` (unit, from the Sun) at `tMs`.
 * Solar rotation carries features toward +right (east → west), which follows from right = up × e.
 */
export function imageFrame(rot: RotationModel, tMs: number, towardObserverIcrs: THREE.Vector3, out?: ImageFrame): ImageFrame {
  const f = out ?? { e: new THREE.Vector3(), up: new THREE.Vector3(), right: new THREE.Vector3(), b0Rad: 0 };
  bodyOrientation(rot, tMs, qScratch).invert();
  f.e.copy(towardObserverIcrs).normalize().applyQuaternion(qScratch);
  f.up.set(0, 0, 1).addScaledVector(f.e, -f.e.z);
  if (f.up.lengthSq() < 1e-12) f.up.set(1, 0, 0);
  f.up.normalize();
  f.right.crossVectors(f.up, f.e).normalize();
  f.b0Rad = Math.asin(Math.max(-1, Math.min(1, f.e.z)));
  return f;
}

/** Project body-frame unit point `p` through an image frame to image (x, y) in disc radii; null if on the far side. */
export function projectToImage(f: ImageFrame, p: THREE.Vector3): { x: number; y: number } | null {
  if (p.dot(f.e) <= 0) return null;
  return { x: p.dot(f.right), y: p.dot(f.up) };
}
