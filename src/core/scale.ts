/**
 * Cosmic Ruler scale math (docs/ARCHITECTURE.md §5.1, §6.1).
 *
 *   scaleLog10     = log10(2 · d · tan(fovY / 2))   — visible vertical extent (m) at focus distance d
 *   metersPerUnit  = clamp(d / 1000, 1e-3, 1e30)    — the focus target sits ~1000 render units away
 *
 * Pure functions, no allocations, SI units throughout.
 */
import {
  AU_M, LENGTH_UNITS, LIGHT_DAY_M, LIGHT_HOUR_M, LIGHT_MINUTE_M, LUNAR_DISTANCE_M, LY_M, PC_M, type LengthUnitId,
} from './units';

/** Smallest supported view scale: a 1 m field of view. */
export const SCALE_MIN_LOG10 = 0;
/** Largest supported view scale: comfortably beyond the observable universe (Ø ≈ 8.8e26 m → 26.94). */
export const SCALE_MAX_LOG10 = 27.5;
export const METERS_PER_UNIT_MIN = 1e-3;
export const METERS_PER_UNIT_MAX = 1e30;
/** Render-space distance (units) at which the focus target is kept. */
export const FOCUS_RENDER_UNITS = 1000;

// ── Generic interpolation helpers ──────────────────────────────────────────────────────────

export function clamp(x: number, lo: number, hi: number): number {
  return Math.min(Math.max(x, lo), hi);
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Position of x between a and b as a fraction (unclamped). Returns 0 when a === b. */
export function inverseLerp(a: number, b: number, x: number): number {
  return a === b ? 0 : (x - a) / (b - a);
}

/** Hermite smoothstep (3t² − 2t³) of x over [edge0, edge1]; a hard step when the edges coincide. */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Perlin smootherstep (6t⁵ − 15t⁴ + 10t³): zero first and second derivatives at both ends. */
export function smootherstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Symmetric cubic ease-in-out on t ∈ [0, 1]. */
export function easeInOutCubic(t: number): number {
  const x = clamp(t, 0, 1);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

// ── Scale ↔ distance ───────────────────────────────────────────────────────────────────────

/** Camera-to-focus distance (m) that shows a visible vertical extent of 10^scaleLog10 m. */
export function focusDistanceFromScale(scaleLog10: number, fovYRad: number): number {
  return Math.pow(10, scaleLog10) / (2 * Math.tan(fovYRad / 2));
}

/** Cosmic Ruler scale for a camera-to-focus distance (m). Non-positive distances map to SCALE_MIN_LOG10. */
export function scaleFromFocusDistance(distanceM: number, fovYRad: number): number {
  if (Number.isNaN(distanceM) || distanceM <= 0) return SCALE_MIN_LOG10;
  return Math.log10(2 * distanceM * Math.tan(fovYRad / 2));
}

/** Render scale (meters per render unit) for a focus distance (docs §5.1). */
export function metersPerUnitForDistance(distanceM: number): number {
  if (Number.isNaN(distanceM) || distanceM <= 0) return METERS_PER_UNIT_MIN;
  return clamp(distanceM / FOCUS_RENDER_UNITS, METERS_PER_UNIT_MIN, METERS_PER_UNIT_MAX);
}

export function metersPerUnitForScale(scaleLog10: number, fovYRad: number): number {
  return metersPerUnitForDistance(focusDistanceFromScale(scaleLog10, fovYRad));
}

export function clampScale(scaleLog10: number): number {
  return clamp(scaleLog10, SCALE_MIN_LOG10, SCALE_MAX_LOG10);
}

/** Visible vertical extent (m) at a scale. */
export function visibleExtentM(scaleLog10: number): number {
  return Math.pow(10, scaleLog10);
}

/**
 * Scale after a zoom step applied to the ALTITUDE above a sphere of radius `radiusM` (log-altitude zoom,
 * docs §6.4): altitude' = altitude · 10^decades (positive = zoom out). Far from the body this is the same
 * as scaling the distance; near the surface it slows down naturally. The result never brings the camera
 * closer than `minDistanceM` (typically 1.02 R).
 */
export function zoomScaleByAltitude(
  scaleLog10: number,
  decades: number,
  radiusM: number,
  minDistanceM: number,
  fovYRad: number,
): number {
  const r = Math.max(radiusM || 0, 0);
  const d = focusDistanceFromScale(scaleLog10, fovYRad);
  const minAlt = Math.max(minDistanceM - r, 1e-6);
  const alt = Math.max(d - r, minAlt);
  const next = Math.max(alt * Math.pow(10, decades), minAlt);
  return clampScale(scaleFromFocusDistance(r + next, fovYRad));
}

// ── Ruler units ────────────────────────────────────────────────────────────────────────────

export type LengthUnit = (typeof LENGTH_UNITS)[number];

const UNIT_BY_ID: Readonly<Record<LengthUnitId, LengthUnit>> = Object.fromEntries(
  LENGTH_UNITS.map(u => [u.id, u]),
) as Record<LengthUnitId, LengthUnit>;

export function lengthUnit(id: LengthUnitId): LengthUnit {
  return UNIT_BY_ID[id];
}

/** A unit band: `unitId` describes lengths from `fromM` (inclusive) up to the next band's start. */
export interface UnitBandDef {
  unitId: LengthUnitId;
  fromM: number;
}

/**
 * Primary Cosmic Ruler bands (docs §6.3). Each unit is used over the range where its numbers stay
 * readable: km up to 10 000 km, Earth radii up to one lunar distance, LD up to 0.1 AU, AU through the
 * Oort cloud (10 000 AU), then light-years up to 1 pc and the parsec family beyond.
 */
export const RULER_BANDS: readonly UnitBandDef[] = [
  { unitId: 'm', fromM: 0 },
  { unitId: 'km', fromM: 1e3 },
  { unitId: 'R_earth', fromM: 1e7 },
  { unitId: 'LD', fromM: LUNAR_DISTANCE_M },
  { unitId: 'AU', fromM: 0.1 * AU_M },
  { unitId: 'ly', fromM: 1e4 * AU_M },
  { unitId: 'pc', fromM: PC_M },
  { unitId: 'kpc', fromM: 1e3 * PC_M },
  { unitId: 'Mpc', fromM: 1e6 * PC_M },
  { unitId: 'Gpc', fromM: 1e9 * PC_M },
];

/** Light-travel-time bands ("light needs N … to cross this"), for educational secondary labels. */
export const LIGHT_TIME_BANDS: readonly UnitBandDef[] = [
  { unitId: 'ls', fromM: 0 },
  { unitId: 'lmin', fromM: LIGHT_MINUTE_M },
  { unitId: 'lh', fromM: LIGHT_HOUR_M },
  { unitId: 'ld', fromM: LIGHT_DAY_M },
  { unitId: 'ly', fromM: LY_M },
];

/** The unit that best describes a length (m) according to a band table (default: the ruler bands). */
export function bestLengthUnit(lengthM: number, bands: readonly UnitBandDef[] = RULER_BANDS): LengthUnit {
  const x = Math.abs(lengthM);
  let id = bands[0].unitId;
  for (let i = 1; i < bands.length; i++) {
    if (x >= bands[i].fromM) id = bands[i].unitId;
    else break;
  }
  return UNIT_BY_ID[id];
}

export interface LengthInUnit {
  unit: LengthUnit;
  value: number;
}

/** Express a length in its best unit, e.g. 1.5e11 m → { unit: AU, value: 1.0027 }. Writes into `out` when given. */
export function lengthInBestUnit(
  lengthM: number,
  bands: readonly UnitBandDef[] = RULER_BANDS,
  out?: LengthInUnit,
): LengthInUnit {
  const unit = bestLengthUnit(lengthM, bands);
  const value = lengthM / unit.meters;
  if (out) {
    out.unit = unit;
    out.value = value;
    return out;
  }
  return { unit, value };
}

export interface UnitBandSpan {
  unit: LengthUnit;
  /** Scale (log10 m) where the band starts, clipped to the requested range. */
  fromScale: number;
  toScale: number;
}

/** Bands intersecting [minScale, maxScale], in increasing order (for drawing the ruler track). */
export function unitBandsInScaleRange(
  minScale: number,
  maxScale: number,
  bands: readonly UnitBandDef[] = RULER_BANDS,
): UnitBandSpan[] {
  const out: UnitBandSpan[] = [];
  for (let i = 0; i < bands.length; i++) {
    const from = bands[i].fromM > 0 ? Math.log10(bands[i].fromM) : -Infinity;
    const to = i + 1 < bands.length ? Math.log10(bands[i + 1].fromM) : Infinity;
    const a = Math.max(from, minScale);
    const b = Math.min(to, maxScale);
    if (b > a) out.push({ unit: UNIT_BY_ID[bands[i].unitId], fromScale: a, toScale: b });
  }
  return out;
}
