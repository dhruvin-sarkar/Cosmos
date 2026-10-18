/**
 * Two-body (Keplerian) propagation for GPU point clouds, with an equivalent TypeScript mirror.
 *
 * Kepler's equation E − e·sin E = M is solved with the Danby (1987) starter E₀ = M + 0.85·e·sign(M)
 * (M reduced to [−π, π]) followed by KEPLER_ITERATIONS steps of Danby & Burkardt's (1983) quartic
 * iteration. Verified over e ∈ [0, 0.97], M ∈ [−π, π]: three steps reach |ΔE| ≤ 4e-7 rad with float32
 * arithmetic (float32 resolution); see kepler.test.ts.
 *
 * Units are the caller's: positions come out in the unit of `a`. Choose units so a³ stays well inside
 * float32 range on the GPU (km for satellites, AU for small bodies). Angles in radians.
 * Elements are relative to the reference plane they were given in (e.g. ecliptic J2000 for small bodies,
 * TEME/equator for satellites); rotate the result into ICRS with a mat3 uniform.
 */
import { COMMON_GLSL } from './common';

export const KEPLER_ITERATIONS = 3;
/** Eccentricity up to which the GPU solver is verified. Higher values are clamped. */
export const KEPLER_MAX_ECCENTRICITY = 0.97;

const TWO_PI = 2 * Math.PI;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** Reduce an angle to [−π, π). */
export function wrapPi(angleRad: number): number {
  return angleRad - TWO_PI * Math.floor((angleRad + Math.PI) / TWO_PI);
}

function danbyStep(E: number, ecc: number, M: number): number {
  const es = ecc * Math.sin(E);
  const ec = ecc * Math.cos(E);
  const f = E - es - M;
  const f1 = 1 - ec;
  const d1 = -f / f1;
  const d2 = -f / (f1 + 0.5 * d1 * es);
  return -f / (f1 + 0.5 * d2 * es + (d2 * d2 * ec) / 6);
}

/** Exact mirror of the GLSL solver: e clamped to KEPLER_MAX_ECCENTRICITY, fixed KEPLER_ITERATIONS steps. */
export function solveKeplerGpuMirror(meanAnomalyRad: number, e: number): number {
  const ecc = Math.min(Math.max(e, 0), KEPLER_MAX_ECCENTRICITY);
  const M = wrapPi(meanAnomalyRad);
  let E = M + 0.85 * ecc * (M >= 0 ? 1 : -1);
  for (let k = 0; k < KEPLER_ITERATIONS; k++) E += danbyStep(E, ecc, M);
  return E;
}

/**
 * CPU solver for any 0 ≤ e < 1 (clamped to 0.999 999): same starter and iteration as the GPU, run to
 * convergence (|ΔE| < 1e-14, at most 12 steps). Returns E in [−π, π] for M reduced to [−π, π).
 */
export function solveKeplerElliptic(meanAnomalyRad: number, e: number): number {
  const ecc = Math.min(Math.max(e, 0), 0.999999);
  const M = wrapPi(meanAnomalyRad);
  let E = M + 0.85 * ecc * (M >= 0 ? 1 : -1);
  for (let k = 0; k < 12; k++) {
    const d = danbyStep(E, ecc, M);
    E += d;
    if (Math.abs(d) < 1e-14) break;
  }
  return E;
}

/** Mean motion n = √(μ/a³), rad per time unit of μ. */
export function meanMotion(semiMajorAxis: number, mu: number): number {
  return Math.sqrt(mu / (semiMajorAxis * semiMajorAxis * semiMajorAxis));
}

/**
 * Position from classical elements at mean anomaly M (reference-plane frame, unit of `a`).
 * Perifocal (x toward periapsis) rotated by R_z(Ω)·R_x(i)·R_z(ω).
 */
export function keplerPosition<T extends Vec3Like>(
  a: number,
  e: number,
  inclinationRad: number,
  nodeRad: number,
  argPeriRad: number,
  meanAnomalyRad: number,
  out: T,
): T {
  const E = solveKeplerElliptic(meanAnomalyRad, e);
  const xp = a * (Math.cos(E) - e);
  const yp = a * Math.sqrt(Math.max(0, 1 - e * e)) * Math.sin(E);
  const cO = Math.cos(nodeRad), sO = Math.sin(nodeRad);
  const ci = Math.cos(inclinationRad), si = Math.sin(inclinationRad);
  const cw = Math.cos(argPeriRad), sw = Math.sin(argPeriRad);
  // P = unit vector to periapsis, Q = in-plane 90° ahead (direction of motion at periapsis).
  const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
  const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
  out.x = xp * px + yp * qx;
  out.y = xp * py + yp * qy;
  out.z = xp * pz + yp * qz;
  return out;
}

/**
 * GLSL:
 *   float solveKeplerElliptic(float meanAnomaly, float e)
 *   vec3  keplerPerifocal(float a, float e, float meanAnomaly)                 — (x toward periapsis, y, 0)
 *   void  keplerBasis(float inc, float node, float argPeri, out vec3 P, out vec3 Q)
 *   vec3  keplerPosition(float a, float e, float inc, float node, float argPeri, float meanAnomaly)
 *   float keplerMeanAnomaly(float meanAnomalyAtEpoch, float meanMotion, float dt) — reduced to [−π, π)
 */
export const KEPLER_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_KEPLER
#define COSMOS_KEPLER

float keplerWrapPi(float x) { return x - PI2 * floor((x + PI) / PI2); }

float solveKeplerElliptic(float meanAnomaly, float e) {
  float ecc = clamp(e, 0.0, ${KEPLER_MAX_ECCENTRICITY.toFixed(2)});
  float M = keplerWrapPi(meanAnomaly);
  float E = M + 0.85 * ecc * (M >= 0.0 ? 1.0 : -1.0);
  for (int k = 0; k < ${KEPLER_ITERATIONS}; k++) {
    float es = ecc * sin(E);
    float ec = ecc * cos(E);
    float f = E - es - M;
    float f1 = 1.0 - ec;
    float d1 = -f / f1;
    float d2 = -f / (f1 + 0.5 * d1 * es);
    float d3 = -f / (f1 + 0.5 * d2 * es + d2 * d2 * ec / 6.0);
    E += d3;
  }
  return E;
}

vec3 keplerPerifocal(float a, float e, float meanAnomaly) {
  float E = solveKeplerElliptic(meanAnomaly, e);
  float ecc = clamp(e, 0.0, ${KEPLER_MAX_ECCENTRICITY.toFixed(2)});
  return vec3(a * (cos(E) - ecc), a * sqrt(max(0.0, 1.0 - ecc * ecc)) * sin(E), 0.0);
}

void keplerBasis(float inc, float node, float argPeri, out vec3 P, out vec3 Q) {
  float cO = cos(node), sO = sin(node);
  float ci = cos(inc), si = sin(inc);
  float cw = cos(argPeri), sw = sin(argPeri);
  P = vec3(cO * cw - sO * sw * ci, sO * cw + cO * sw * ci, sw * si);
  Q = vec3(-cO * sw - sO * cw * ci, -sO * sw + cO * cw * ci, cw * si);
}

vec3 keplerPosition(float a, float e, float inc, float node, float argPeri, float meanAnomaly) {
  vec3 P, Q;
  keplerBasis(inc, node, argPeri, P, Q);
  vec3 pf = keplerPerifocal(a, e, meanAnomaly);
  return pf.x * P + pf.y * Q;
}

float keplerMeanAnomaly(float meanAnomalyAtEpoch, float meanMotion, float dt) {
  return keplerWrapPi(meanAnomalyAtEpoch + keplerWrapPi(meanMotion * dt));
}

#endif
`;
