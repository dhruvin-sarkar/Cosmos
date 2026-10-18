/**
 * Cinematic travel math (docs/ARCHITECTURE.md §6.4).
 *
 * A travel is a path in (focus point, visible width, view direction). The zoom/pan profile is the optimal
 * smooth path of van Wijk & Nuij, "Smooth and efficient zooming and panning" (IEEE InfoVis 2003): it zooms out
 * just enough for the pan to be perceptually smooth, pans while zoomed out, and zooms back in — the continuous
 * version of "zoom out to log10(separation) + 0.3, pan, zoom in". With ρ = 2 the peak visible width is ≈ 2 ×
 * the separation (= log10(s) + 0.3).
 *
 * Everything is evaluated in log space so separations of 10²² m against widths of 10 m stay exact.
 */
import { Vector3 } from 'three';
import { clamp } from '../scale';
import { DEG } from '../units';
import { anyPerpendicular, rejectFrom } from './vec';

/** van Wijk curvature parameter ρ (√2 in the paper; 2 gives the spec'd +0.3 decade context zoom). */
export const TRAVEL_RHO = 2;
export const TRAVEL_BASE_SEC = 2;
export const TRAVEL_SEC_PER_DECADE = 0.35;
export const TRAVEL_MIN_SEC = 1.5;
export const TRAVEL_MAX_SEC = 9;
/** Transition length when the user prefers reduced motion. */
export const REDUCED_MOTION_TRAVEL_SEC = 0.3;
/**
 * Sun–target–camera angle at arrival for lit bodies (VISUAL_DIRECTION "Approach geometry": 50–70°): the terminator
 * is in view so relief reads in the shadows, while the disc is still ~75 % lit.
 */
export const ARRIVAL_PHASE_ANGLE_DEG = 60;

const LN2 = Math.LN2;

/** ln(cosh x), stable for any x. */
function logCosh(x: number): number {
  const a = Math.abs(x);
  return a + Math.log1p(Math.exp(-2 * a)) - LN2;
}

/** ln(sinh x) for x > 0, stable for small and large x. */
function logSinh(x: number): number {
  if (x < 1e-3) return Math.log(x) + (x * x) / 6;
  return x + Math.log1p(-Math.exp(-2 * x)) - LN2;
}

export interface ZoomPanPath {
  /** Start / end visible width (m). */
  w0: number;
  w1: number;
  /** Straight-line distance between the start and end focus points at planning time (m). */
  separationM: number;
  rho: number;
  r0: number;
  r1: number;
  /** Path length S in van Wijk's natural units (≥ 0). */
  length: number;
  pureZoom: boolean;
  /** Largest visible width along the path (m). */
  peakWidthM: number;
  /** ln of the pan fraction at s = S (≈ 0); subtracted so the pan ends at exactly 1. */
  logPanEnd: number;
  /** ln(w1) − ln(w(S)) (≈ 0); spread linearly over the path so the width ends at exactly w1. */
  logWidthCorrection: number;
  /** ln of the remaining fraction at s = 0 (≈ 0); subtracted so `remaining` starts at exactly 1. */
  logRemainingStart: number;
}

export interface ZoomPanSample {
  /** Visible width (m). */
  widthM: number;
  /** Fraction of the way from the start to the end focus point, 0…1. */
  pan: number;
  /**
   * 1 − pan, computed independently from the reversed path so it stays accurate to full relative precision near
   * the end (a 10²² m pan that must land within metres of the target). Interpolate from the end point when
   * pan > 0.5: focus = P1 + (P0 − P1)·remaining.
   */
  remaining: number;
}

/** Plan a zoom/pan path from width `w0` to `w1` across `separationM`. Widths are clamped to ≥ 1e-6 m. */
export function planZoomPan(w0: number, w1: number, separationM: number, rho = TRAVEL_RHO): ZoomPanPath {
  const a = Math.max(w0, 1e-6), b = Math.max(w1, 1e-6);
  const u = Math.max(separationM, 0);
  const path: ZoomPanPath = {
    w0: a, w1: b, separationM: u, rho, r0: 0, r1: 0, length: 0, pureZoom: false,
    peakWidthM: Math.max(a, b), logPanEnd: 0, logWidthCorrection: 0, logRemainingStart: 0,
  };
  if (!(u > 1e-9 * Math.min(a, b)) || !Number.isFinite(u)) {
    path.pureZoom = true;
    path.length = Math.abs(Math.log(b / a)) / rho;
    return path;
  }
  const rho2 = rho * rho;
  // b_i = (w1² − w0² ± ρ⁴u²) / (2 w_i ρ² u), rewritten to avoid squaring 1e27-sized numbers needlessly.
  const k = (b / u) * (b / (2 * rho2)) - (a / u) * (a / (2 * rho2));
  const m = (rho2 * u) / 2;
  const b0 = (k + m) / a;
  const b1 = (k - m) / b;
  path.r0 = -Math.asinh(b0);
  path.r1 = -Math.asinh(b1);
  path.length = Math.max((path.r1 - path.r0) / rho, 0);
  if (path.r0 < 0 && path.r1 > 0) {
    path.peakWidthM = Math.max(a * Math.exp(logCosh(path.r0)), path.peakWidthM);
  }
  const end: ZoomPanSample = { widthM: 0, pan: 0, remaining: 0 };
  rawSample(path, path.length, end);
  path.logPanEnd = end.pan > 0 ? Math.log(end.pan) : 0;
  path.logWidthCorrection = Math.log(b) - Math.log(end.widthM);
  const r0 = rawRemaining(path, 0);
  path.logRemainingStart = r0 > 0 ? Math.log(r0) : 0;
  return path;
}

/**
 * Remaining pan fraction from the reversed path: seen from the end, the path is a van Wijk path with
 * r0' = −r1 starting at width w1, so the distance still to go after arc s is (w1/ρ²)·sinh(ρσ)/cosh(ρσ − r1), σ = S − s.
 */
function rawRemaining(path: ZoomPanPath, s: number): number {
  const { rho, r1, w1 } = path;
  const sigma = path.length - s;
  if (!(sigma > 0)) return 0;
  return Math.exp(Math.log(w1 / (rho * rho * path.separationM)) + logSinh(rho * sigma) - logCosh(rho * sigma - r1));
}

function rawSample(path: ZoomPanPath, s: number, out: ZoomPanSample): ZoomPanSample {
  const { rho, r0, w0 } = path;
  const x = rho * s + r0;
  out.widthM = Math.exp(Math.log(w0) + logCosh(r0) - logCosh(x));
  out.pan = s > 0 ? Math.exp(Math.log(w0 / (rho * rho * path.separationM)) + logSinh(rho * s) - logCosh(x)) : 0;
  return out;
}

/** Sample the path at arc parameter s ∈ [0, S]. */
export function sampleZoomPan(path: ZoomPanPath, s: number, out: ZoomPanSample): ZoomPanSample {
  const S = path.length;
  const t = S > 0 ? clamp(s / S, 0, 1) : 1;
  if (path.pureZoom) {
    out.widthM = Math.exp(Math.log(path.w0) + (Math.log(path.w1) - Math.log(path.w0)) * t);
    out.pan = t;
    out.remaining = 1 - t;
    return out;
  }
  rawSample(path, t * S, out);
  out.widthM *= Math.exp(path.logWidthCorrection * t);
  out.pan = t >= 1 ? 1 : clamp(t > 0 ? Math.exp(Math.log(Math.max(out.pan, 1e-300)) - path.logPanEnd * t) : 0, 0, 1);
  const rem = rawRemaining(path, t * S);
  out.remaining = t <= 0 ? 1 : clamp(rem > 0 ? Math.exp(Math.log(rem) - path.logRemainingStart * (1 - t)) : 0, 0, 1);
  // Each half keeps the accurately computed small value and derives the other one from it.
  if (out.remaining < 0.5) out.pan = 1 - out.remaining;
  else out.remaining = 1 - out.pan;
  return out;
}

/** Orders of magnitude zoomed along the path (out to the peak, then back in). */
export function travelDecades(path: ZoomPanPath): number {
  const peak = path.peakWidthM;
  return Math.log10(peak / path.w0) + Math.log10(peak / path.w1);
}

/** Travel duration: 2 s + 0.35 s per order of magnitude, clamped to 1.5–9 s (short when motion is reduced). */
export function travelDurationSec(path: ZoomPanPath, opts: { reducedMotion?: boolean; overrideSec?: number } = {}): number {
  if (opts.overrideSec !== undefined && Number.isFinite(opts.overrideSec)) return Math.max(opts.overrideSec, 0);
  if (opts.reducedMotion) return REDUCED_MOTION_TRAVEL_SEC;
  return clamp(TRAVEL_BASE_SEC + TRAVEL_SEC_PER_DECADE * travelDecades(path), TRAVEL_MIN_SEC, TRAVEL_MAX_SEC);
}

// ── Arrival direction ───────────────────────────────────────────────────────────────────────

export interface Sphere {
  center: Vector3;
  radiusM: number;
}

export interface ArrivalGeometry {
  /** Target position (world m). */
  target: Vector3;
  /** Light source position (host star) for lit bodies; null keeps the current viewing side. */
  light: Vector3 | null;
  /** Unit vector from the target toward the camera's current position (the preferred side). */
  preferredDir: Vector3;
  /** Preferred up at arrival (used for a slightly elevated view). */
  up: Vector3;
  /** Hard-ish constraint: keep dir·lift.dir ≥ lift.minCos (e.g. stay outside a satellite's parent planet). */
  lift?: { dir: Vector3; minDot: number };
  /** Spheres the final approach line (target → camera, `approachLengthM` long) should not cross. */
  obstacles?: readonly Sphere[];
  approachLengthM?: number;
}

const ARRIVAL_SAMPLES = 24;
const MIN_ELEVATION_SIN = Math.sin(10 * DEG);
const cand = new Vector3();
const e1 = new Vector3();
const e2 = new Vector3();
const sunDir = new Vector3();
const best = new Vector3();

/** Does the segment from `origin` along unit `dir` (length L) pass within `radius` of `center`? */
export function segmentHitsSphere(origin: Vector3, dir: Vector3, lengthM: number, center: Vector3, radiusM: number): boolean {
  const mx = center.x - origin.x, my = center.y - origin.y, mz = center.z - origin.z;
  const along = clamp(mx * dir.x + my * dir.y + mz * dir.z, 0, lengthM);
  const dx = mx - dir.x * along, dy = my - dir.y * along, dz = mz - dir.z * along;
  return dx * dx + dy * dy + dz * dz < radiusM * radiusM;
}

/**
 * Unit vector from the target to the camera at arrival. Lit bodies are framed at a gibbous phase
 * (Sun–target–camera angle = ARRIVAL_PHASE_ANGLE_DEG), choosing the azimuth around the Sun direction that is closest to the current
 * viewing side while respecting `lift`, preferring a view ≥ 10° above the `up` plane and avoiding approach lines
 * through `obstacles`. Unlit targets keep the current viewing side (subject to `lift`).
 */
export function chooseArrivalDirection(g: ArrivalGeometry, out: Vector3): Vector3 {
  if (!g.light) {
    out.copy(g.preferredDir);
    if (g.lift && out.dot(g.lift.dir) < g.lift.minDot) liftInto(out, g.lift.dir, g.lift.minDot);
    return out;
  }
  sunDir.subVectors(g.light, g.target);
  const sunDist = sunDir.length();
  if (!(sunDist > 0)) return out.copy(g.preferredDir);
  sunDir.multiplyScalar(1 / sunDist);
  rejectFrom(g.preferredDir, sunDir, e1);
  if (e1.lengthSq() < 1e-10) rejectFrom(g.up, sunDir, e1);
  if (e1.lengthSq() < 1e-10) anyPerpendicular(sunDir, e1);
  e1.normalize();
  e2.crossVectors(sunDir, e1);

  const phase = ARRIVAL_PHASE_ANGLE_DEG * DEG;
  const cp = Math.cos(phase), sp = Math.sin(phase);
  const approach = g.approachLengthM ?? 0;
  let bestCost = Infinity;
  for (let k = 0; k < ARRIVAL_SAMPLES; k++) {
    const theta = (2 * Math.PI * k) / ARRIVAL_SAMPLES;
    const ct = Math.cos(theta), st = Math.sin(theta);
    cand.set(
      cp * sunDir.x + sp * (ct * e1.x + st * e2.x),
      cp * sunDir.y + sp * (ct * e1.y + st * e2.y),
      cp * sunDir.z + sp * (ct * e1.z + st * e2.z),
    );
    let cost = Math.min(theta, 2 * Math.PI - theta);
    if (g.lift) {
      const d = cand.dot(g.lift.dir);
      if (d < g.lift.minDot) cost += 10 + 20 * (g.lift.minDot - d);
    }
    const elev = cand.dot(g.up);
    if (elev < MIN_ELEVATION_SIN) cost += 1.5 * (MIN_ELEVATION_SIN - elev);
    if (g.obstacles && approach > 0) {
      for (let i = 0; i < g.obstacles.length; i++) {
        const o = g.obstacles[i];
        if (segmentHitsSphere(g.target, cand, approach, o.center, o.radiusM)) cost += 50;
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      best.copy(cand);
    }
  }
  out.copy(best);
  if (g.lift && out.dot(g.lift.dir) < g.lift.minDot) liftInto(out, g.lift.dir, g.lift.minDot);
  return out;
}

/** Rotate the unit `v` toward the unit `axis` until v·axis = minDot (minimal rotation). */
function liftInto(v: Vector3, axis: Vector3, minDot: number): void {
  rejectFrom(v, axis, e1);
  if (e1.lengthSq() < 1e-12) anyPerpendicular(axis, e1);
  e1.normalize();
  const c = clamp(minDot, -1, 1);
  const s = Math.sqrt(Math.max(0, 1 - c * c));
  v.set(axis.x * c + e1.x * s, axis.y * c + e1.y * s, axis.z * c + e1.z * s);
}
