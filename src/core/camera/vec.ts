/**
 * Allocation-free unit-vector helpers for the camera (float64, ICRS axes).
 */
import { Vector3 } from 'three';

const EPS = 1e-12;
const scratchAxis = new Vector3();
const scratchA = new Vector3();
const scratchB = new Vector3();

/** Rotate `v` about the unit `axis` by `angle` (right-hand rule, Rodrigues). `out` may alias `v`. */
export function rotateAboutAxis(v: Vector3, axis: Vector3, angle: number, out: Vector3): Vector3 {
  if (angle === 0) return out.copy(v);
  const c = Math.cos(angle), s = Math.sin(angle);
  const kx = axis.x, ky = axis.y, kz = axis.z;
  const vx = v.x, vy = v.y, vz = v.z;
  const dot = kx * vx + ky * vy + kz * vz;
  const cx = ky * vz - kz * vy, cy = kz * vx - kx * vz, cz = kx * vy - ky * vx;
  out.x = vx * c + cx * s + kx * dot * (1 - c);
  out.y = vy * c + cy * s + ky * dot * (1 - c);
  out.z = vz * c + cz * s + kz * dot * (1 - c);
  return out;
}

/** Some unit vector perpendicular to the unit vector `v`. */
export function anyPerpendicular(v: Vector3, out: Vector3): Vector3 {
  const ax = Math.abs(v.x), ay = Math.abs(v.y), az = Math.abs(v.z);
  if (ax <= ay && ax <= az) out.set(0, -v.z, v.y);
  else if (ay <= az) out.set(-v.z, 0, v.x);
  else out.set(-v.y, v.x, 0);
  return out.normalize();
}

/** Component of `v` perpendicular to the unit vector `n` (not normalized). `out` may alias `v`. */
export function rejectFrom(v: Vector3, n: Vector3, out: Vector3): Vector3 {
  const d = v.x * n.x + v.y * n.y + v.z * n.z;
  out.set(v.x - d * n.x, v.y - d * n.y, v.z - d * n.z);
  return out;
}

/** Angle between two unit vectors, radians (robust near 0 and π). */
export function angleBetweenUnit(a: Vector3, b: Vector3): number {
  const cx = a.y * b.z - a.z * b.y, cy = a.z * b.x - a.x * b.z, cz = a.x * b.y - a.y * b.x;
  return Math.atan2(Math.hypot(cx, cy, cz), a.x * b.x + a.y * b.y + a.z * b.z);
}

/**
 * Spherical interpolation between unit vectors. For (nearly) opposite vectors the great circle is chosen through
 * `hint` (a unit vector ⟂-ish to `a`; falls back to any perpendicular). `out` must not alias `b`.
 */
export function slerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3, hint?: Vector3): Vector3 {
  if (t <= 0) return out.copy(a);
  if (t >= 1) return out.copy(b);
  const omega = angleBetweenUnit(a, b);
  if (omega < 1e-6) return out.copy(a).lerp(b, t).normalize();
  if (Math.PI - omega < 1e-4) {
    // Rotate about an axis perpendicular to a (and b) — the great circle through the hint.
    if (hint) rejectFrom(hint, a, scratchAxis);
    if (!hint || scratchAxis.lengthSq() < 1e-12) anyPerpendicular(a, scratchAxis);
    scratchAxis.normalize();
    scratchA.crossVectors(a, scratchAxis).normalize();
    return rotateAboutAxis(a, scratchA, omega * t, out);
  }
  const s = Math.sin(omega);
  const wa = Math.sin((1 - t) * omega) / s, wb = Math.sin(t * omega) / s;
  scratchB.copy(b);
  return out.copy(a).multiplyScalar(wa).addScaledVector(scratchB, wb).normalize();
}

/** Normalized linear blend of unit vectors (falls back to slerp when they nearly cancel). */
export function nlerpUnit(a: Vector3, b: Vector3, t: number, out: Vector3): Vector3 {
  if (t <= 0) return out.copy(a);
  if (t >= 1) return out.copy(b);
  const x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
  const len = Math.hypot(x, y, z);
  if (len < 1e-3) return slerpUnit(a, b, t, out);
  return out.set(x / len, y / len, z / len);
}

/** True when every component is a finite number. */
export function isFiniteVec(v: Vector3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Make `u` a unit vector orthogonal to the unit `f` (Gram–Schmidt), keeping it continuous with its old value. */
export function orthonormalizeUp(f: Vector3, u: Vector3): Vector3 {
  rejectFrom(u, f, u);
  const len = u.length();
  if (len < EPS) anyPerpendicular(f, u);
  else u.multiplyScalar(1 / len);
  return u;
}
