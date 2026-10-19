/**
 * Earth–Moon ephemeris and orientation, evaluated once per simulation instant and shared by every consumer
 * (entities, layer, fact sheets).
 *
 * Positions: astronomy-engine (VSOP87 for the Earth, truncated ELP/MPP02 for the Moon, ~1′), barycentric,
 * ICRS (EQJ) axes, metres — the same convention as src/core/frames.ts and the rest of the engine.
 * The Sun is read from the registered 'sol:sun' entity when present so that lighting and the drawn Sun agree;
 * otherwise astronomy-engine's barycentric Sun is used.
 *
 * Orientation:
 *   Earth: ecefToIcrsMatrix (GAST + IAU 2000B nutation + precession; src/core/frames.ts). Body-fixed +x is the
 *          Greenwich meridian, +z the north pole.
 *   Moon:  IAU WGCCRE mean-Earth/polar-axis model with periodic terms (astronomy-engine RotationAxis), which
 *          includes physical libration; optical libration follows from the true orbit.
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import type { EntityRegistry } from '../../core/entity';
import { AU_M } from '../../core/units';
import { bodyFixedToIcrsMatrixForBody, ecefToIcrsMatrix, utDaysSinceJ2000 } from '../../core/frames';

const AU_PER_DAY_TO_M_PER_S = AU_M / 86_400;

export interface EarthMoonState {
  tMs: number;
  /** Barycentric ICRS positions, m. */
  sun: THREE.Vector3;
  earth: THREE.Vector3;
  moon: THREE.Vector3;
  /** Barycentric ICRS velocities, m/s. */
  earthVel: THREE.Vector3;
  moonVel: THREE.Vector3;
  /** Body-fixed → ICRS rotation matrices (row-major 3×3). */
  earthRot: Float64Array;
  moonRot: Float64Array;
}

const state: EarthMoonState = {
  tMs: Number.NaN,
  sun: new THREE.Vector3(),
  earth: new THREE.Vector3(),
  moon: new THREE.Vector3(),
  earthVel: new THREE.Vector3(),
  moonVel: new THREE.Vector3(),
  earthRot: new Float64Array(9),
  moonRot: new Float64Array(9),
};

let registry: EntityRegistry | null = null;
let sunLookupFailed = false;

/** Lets the ephemeris read the Sun from the registry (set by the domain factory). */
export function bindRegistry(r: EntityRegistry | null): void {
  registry = r;
  sunLookupFailed = false;
}

const scratchSun = new THREE.Vector3();

/** Recompute everything for `tMs` (no-op when already current). */
export function evaluate(tMs: number): EarthMoonState {
  if (tMs === state.tMs) return state;
  const time = Astronomy.MakeTime(new Date(tMs));
  const e = Astronomy.BaryState(Astronomy.Body.Earth, time);
  const m = Astronomy.GeoMoonState(time);
  state.earth.set(e.x * AU_M, e.y * AU_M, e.z * AU_M);
  state.earthVel.set(e.vx * AU_PER_DAY_TO_M_PER_S, e.vy * AU_PER_DAY_TO_M_PER_S, e.vz * AU_PER_DAY_TO_M_PER_S);
  state.moon.set(state.earth.x + m.x * AU_M, state.earth.y + m.y * AU_M, state.earth.z + m.z * AU_M);
  state.moonVel.set(
    state.earthVel.x + m.vx * AU_PER_DAY_TO_M_PER_S,
    state.earthVel.y + m.vy * AU_PER_DAY_TO_M_PER_S,
    state.earthVel.z + m.vz * AU_PER_DAY_TO_M_PER_S,
  );
  // Sun: prefer the registered entity (the solar domain), fall back to astronomy-engine.
  const sunEntity = registry && !sunLookupFailed ? registry.get('sol:sun') : undefined;
  if (sunEntity && sunEntity.domain !== 'earth') {
    sunEntity.position(tMs, scratchSun);
    state.sun.copy(scratchSun);
  } else {
    const s = Astronomy.BaryState(Astronomy.Body.Sun, time);
    state.sun.set(s.x * AU_M, s.y * AU_M, s.z * AU_M);
  }
  ecefToIcrsMatrix(tMs, state.earthRot);
  bodyFixedToIcrsMatrixForBody('Moon', tMs, state.moonRot);
  state.tMs = tMs;
  return state;
}

export function earthPosition(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(evaluate(tMs).earth);
}

export function moonPosition(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  // The Moon's parent is the Earth entity of this domain: same evaluation, so it sits exactly on it.
  return out.copy(evaluate(tMs).moon);
}

export function earthVelocity(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(evaluate(tMs).earthVel);
}

export function moonVelocity(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  return out.copy(evaluate(tMs).moonVel);
}

/** North rotational pole (unit, ICRS) = third column of the body-fixed → ICRS matrix. */
export function earthNorthPole(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  const r = evaluate(tMs).earthRot;
  return out.set(r[2], r[5], r[8]);
}

export function moonNorthPole(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  const r = evaluate(tMs).moonRot;
  return out.set(r[2], r[5], r[8]);
}

/** Write a row-major 3×3 rotation into a Quaternion (via a scratch Matrix4). */
const scratchM4 = new THREE.Matrix4();
export function rotationToQuaternion(r: Float64Array, out: THREE.Quaternion): THREE.Quaternion {
  scratchM4.set(r[0], r[1], r[2], 0, r[3], r[4], r[5], 0, r[6], r[7], r[8], 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(scratchM4);
}

/** ICRS vector → body-fixed (transpose of the row-major matrix). */
export function icrsToBodyFixed(r: Float64Array, v: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const x = v.x, y = v.y, z = v.z;
  return out.set(r[0] * x + r[3] * y + r[6] * z, r[1] * x + r[4] * y + r[7] * z, r[2] * x + r[5] * y + r[8] * z);
}

export interface GeoPoint {
  latDeg: number;
  /** East-positive, (−180, 180]. */
  lonDeg: number;
}

const scratchDir = new THREE.Vector3();
const scratchBf = new THREE.Vector3();

/** Planetocentric latitude/longitude of the sub-solar point on the Earth at `tMs`. */
export function subsolarPoint(tMs: number, out: GeoPoint = { latDeg: 0, lonDeg: 0 }): GeoPoint {
  const s = evaluate(tMs);
  scratchDir.subVectors(s.sun, s.earth).normalize();
  icrsToBodyFixed(s.earthRot, scratchDir, scratchBf);
  out.latDeg = (Math.asin(Math.max(-1, Math.min(1, scratchBf.z))) * 180) / Math.PI;
  out.lonDeg = (Math.atan2(scratchBf.y, scratchBf.x) * 180) / Math.PI;
  return out;
}

/** Planetocentric latitude/longitude of the sub-lunar point on the Earth. */
export function sublunarPoint(tMs: number, out: GeoPoint = { latDeg: 0, lonDeg: 0 }): GeoPoint {
  const s = evaluate(tMs);
  scratchDir.subVectors(s.moon, s.earth).normalize();
  icrsToBodyFixed(s.earthRot, scratchDir, scratchBf);
  out.latDeg = (Math.asin(Math.max(-1, Math.min(1, scratchBf.z))) * 180) / Math.PI;
  out.lonDeg = (Math.atan2(scratchBf.y, scratchBf.x) * 180) / Math.PI;
  return out;
}

/** Sub-Earth point on the Moon (optical + physical libration as seen from the Earth's centre). */
export function subEarthPointOnMoon(tMs: number, out: GeoPoint = { latDeg: 0, lonDeg: 0 }): GeoPoint {
  const s = evaluate(tMs);
  scratchDir.subVectors(s.earth, s.moon).normalize();
  icrsToBodyFixed(s.moonRot, scratchDir, scratchBf);
  out.latDeg = (Math.asin(Math.max(-1, Math.min(1, scratchBf.z))) * 180) / Math.PI;
  out.lonDeg = (Math.atan2(scratchBf.y, scratchBf.x) * 180) / Math.PI;
  return out;
}

/** Moon phase angle (Sun–Moon–Earth, degrees) and illuminated fraction. */
export function moonPhase(tMs: number): { phaseAngleDeg: number; illuminatedFraction: number } {
  const s = evaluate(tMs);
  const a = scratchDir.subVectors(s.sun, s.moon).normalize();
  const b = scratchBf.subVectors(s.earth, s.moon).normalize();
  const cos = Math.max(-1, Math.min(1, a.dot(b)));
  return { phaseAngleDeg: (Math.acos(cos) * 180) / Math.PI, illuminatedFraction: (1 + cos) / 2 };
}

/** Days since J2000 (UT) — re-exported for tests. */
export { utDaysSinceJ2000 };
