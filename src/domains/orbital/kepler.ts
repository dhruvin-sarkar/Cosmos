/**
 * Two-body helpers for the orbital population. The worker turns each object's SGP4 state at a reference instant t0
 * into "perifocal" elements; the GPU (and the CPU for picking / lazily resolved entities) then advances them with
 * Kepler's equation for the few minutes until the next SGP4 refresh:
 *
 *   r(t) = Pa·(cos E − e) + Qb·sin E,   E − e·sin E = M0 + n·(t − t0)
 *
 * with Pa = a·P̂ and Qb = a·√(1−e²)·Q̂ (P̂ toward periapsis, Q̂ = ĥ × P̂). Over a refresh window of ≤ ~10 min the
 * difference from SGP4 (J2 drift of the node and perigee, drag) stays at the km level in LEO.
 * Layout per object (ELEMENT_STRIDE floats): Pa.xyz, Qb.xyz, e, M0 (rad), n (rad/s). n = 0 marks "no position".
 */

/** Earth's gravitational parameter (WGS-72, as SGP4 uses), m³/s². */
export const MU_EARTH = 3.986008e14;
export const ELEMENT_STRIDE = 9;
const TWO_PI = Math.PI * 2;

/**
 * Perifocal elements from a state vector (metres, m/s; any inertial axes — the elements live in the same axes).
 * Writes ELEMENT_STRIDE values at `o`; returns false (and writes n = 0) for unbound or degenerate states.
 */
export function stateToElements(
  rx: number, ry: number, rz: number, vx: number, vy: number, vz: number,
  out: Float32Array | Float64Array, o: number, mu = MU_EARTH,
): boolean {
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  const inv = 2 / r - v2 / mu;
  // h = r × v
  const hx = ry * vz - rz * vy, hy = rz * vx - rx * vz, hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);
  if (!(r > 0) || !(inv > 0) || !(h > 0)) {
    out.fill(0, o, o + ELEMENT_STRIDE);
    return false;
  }
  const a = 1 / inv;
  // e = (v × h)/μ − r̂
  let ex = (vy * hz - vz * hy) / mu - rx / r;
  let ey = (vz * hx - vx * hz) / mu - ry / r;
  let ez = (vx * hy - vy * hx) / mu - rz / r;
  let e = Math.hypot(ex, ey, ez);
  let px: number, py: number, pz: number;
  if (e < 1e-9) {
    // Circular: measure from the current position (true anomaly 0).
    e = 0;
    px = rx / r; py = ry / r; pz = rz / r;
    ex = ey = ez = 0;
  } else {
    px = ex / e; py = ey / e; pz = ez / e;
  }
  if (e >= 1) {
    out.fill(0, o, o + ELEMENT_STRIDE);
    return false;
  }
  const ux = hx / h, uy = hy / h, uz = hz / h;
  // Q̂ = ĥ × P̂
  const qx = uy * pz - uz * py, qy = uz * px - ux * pz, qz = ux * py - uy * px;
  const cosNu = (px * rx + py * ry + pz * rz) / r;
  const sinNu = (qx * rx + qy * ry + qz * rz) / r;
  const s = Math.sqrt(1 - e * e);
  const E = Math.atan2(s * sinNu, e + cosNu);
  let M = E - e * Math.sin(E);
  M -= TWO_PI * Math.floor(M / TWO_PI);
  const b = a * s;
  out[o] = a * px; out[o + 1] = a * py; out[o + 2] = a * pz;
  out[o + 3] = b * qx; out[o + 4] = b * qy; out[o + 5] = b * qz;
  out[o + 6] = e;
  out[o + 7] = M;
  out[o + 8] = Math.sqrt(mu / (a * a * a));
  return true;
}

/** Solve Kepler's equation E − e sin E = M (any M, 0 ≤ e < 1). */
export function solveKepler(M: number, e: number): number {
  M -= TWO_PI * Math.floor(M / TWO_PI);
  let E = e < 0.8 ? M : Math.PI;
  for (let k = 0; k < 12; k++) {
    const f = E - e * Math.sin(E) - M;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-12) break;
  }
  return E;
}

export interface Vec3Like { x: number; y: number; z: number }

/**
 * Position (same units/axes as the elements) `dtSec` after the reference instant. Returns false when the object
 * has no position (n = 0).
 */
export function elementsPosition(el: ArrayLike<number>, o: number, dtSec: number, out: Vec3Like): boolean {
  const n = el[o + 8];
  if (!(n > 0)) return false;
  const e = el[o + 6];
  const E = solveKepler(el[o + 7] + n * dtSec, e);
  const c = Math.cos(E) - e, s = Math.sin(E);
  out.x = el[o] * c + el[o + 3] * s;
  out.y = el[o + 1] * c + el[o + 4] * s;
  out.z = el[o + 2] * c + el[o + 5] * s;
  return true;
}

/**
 * Perifocal elements from classical elements (a in m, angles in radians) at the reference instant: used for the
 * SATCAT-shape objects, whose node, perigee and phase are illustrative.
 */
export function classicalToElements(
  a: number, e: number, inc: number, raan: number, argp: number, M0: number,
  out: Float32Array | Float64Array, o: number, mu = MU_EARTH,
): void {
  const cO = Math.cos(raan), sO = Math.sin(raan), ci = Math.cos(inc), si = Math.sin(inc), cw = Math.cos(argp), sw = Math.sin(argp);
  const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
  const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
  const b = a * Math.sqrt(1 - e * e);
  out[o] = a * px; out[o + 1] = a * py; out[o + 2] = a * pz;
  out[o + 3] = b * qx; out[o + 4] = b * qy; out[o + 5] = b * qz;
  out[o + 6] = e;
  out[o + 7] = M0 - TWO_PI * Math.floor(M0 / TWO_PI);
  out[o + 8] = Math.sqrt(mu / (a * a * a));
}

/** Velocity (units of the elements per second) `dtSec` after the reference instant; false when n = 0. */
export function elementsVelocity(el: ArrayLike<number>, o: number, dtSec: number, out: Vec3Like): boolean {
  const n = el[o + 8];
  if (!(n > 0)) return false;
  const e = el[o + 6];
  const E = solveKepler(el[o + 7] + n * dtSec, e);
  const Edot = n / (1 - e * Math.cos(E));
  const s = -Math.sin(E) * Edot, c = Math.cos(E) * Edot;
  out.x = el[o] * s + el[o + 3] * c;
  out.y = el[o + 1] * s + el[o + 4] * c;
  out.z = el[o + 2] * s + el[o + 5] * c;
  return true;
}

/** Semi-major axis (same unit as the elements) of a stored object. */
export function elementsSemiMajorAxis(el: ArrayLike<number>, o: number): number {
  return Math.hypot(el[o], el[o + 1], el[o + 2]);
}
