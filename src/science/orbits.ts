/**
 * Two-body orbital mechanics: Kepler's equation, anomaly conversions, orbital elements ↔ Cartesian state,
 * universal-variable propagation, vis-viva and apsides, Earth J2 secular drift and orbit polylines.
 *
 * Units: SI (m, s, rad, m^3 s^-2). Frames: elements and states share whatever inertial frame the elements are
 * referred to (heliocentric ecliptic J2000 for small bodies, ECI for satellites); conversion to the ICRS world
 * frame is the caller's job (src/core/frames.ts).
 * Conventions: hyperbolic orbits have a NEGATIVE semi-major axis (a = −μ/2ε); exactly parabolic orbits
 * (e = 1) are supported by propagateKepler (universal variables) but not by the element-based functions.
 * Domain errors return NaN (rendered as "Unknown" by src/data/format.ts) — these functions never throw.
 * No allocations in the scalar/out-parameter paths (safe for per-frame use).
 */
import { GM_EARTH } from '../core/units';
import type { ModelInfo } from './models';

const TWO_PI = 2 * Math.PI;

export const MODEL_KEPLER = 'kepler-two-body@1';
export const MODEL_J2_SECULAR = 'j2-secular@1';

/** Classical (Keplerian) orbital elements at an epoch. */
export interface KeplerElements {
  /** a, m. Negative for hyperbolic orbits. */
  semiMajorAxisM: number;
  /** e ≥ 0 (e ≠ 1 for element-based functions). */
  eccentricity: number;
  /** i ∈ [0, π]. */
  inclinationRad: number;
  /** Longitude of the ascending node Ω. */
  raanRad: number;
  /** Argument of periapsis ω. */
  argPeriapsisRad: number;
  /** Mean anomaly M at the epoch (unbounded for hyperbolic orbits). */
  meanAnomalyRad: number;
}

/** Reduce an angle to [0, 2π). */
export function wrapTwoPi(angleRad: number): number {
  const r = angleRad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Reduce an angle to (−π, π]. */
export function wrapPi(angleRad: number): number {
  let r = wrapTwoPi(angleRad);
  if (r > Math.PI) r -= TWO_PI;
  return r;
}

// ── Kepler's equation ─────────────────────────────────────────────────────────────────────

/** Real root of (c/6)x³ + b·x − m = 0 (b ≥ 0, c > 0) — the small-anomaly cubic used as a starter near e ≈ 1. */
function cubicStarter(m: number, b: number, c: number): number {
  const p = (6 * b) / c;
  const q = (-6 * m) / c;
  const d = Math.sqrt((q * q) / 4 + (p * p * p) / 27);
  const A = Math.cbrt(-q / 2 + d);
  return A > 0 ? A - p / (3 * A) : 0;
}

/**
 * Solve Kepler's equation M = E − e·sin E for the eccentric anomaly E (elliptic orbits, 0 ≤ e < 1).
 * Safeguarded Halley iteration inside the bracket [0, π] of the reduced problem: converges for every
 * e < 1 (tested to e = 0.999999) to ~1 ulp. E is returned in the same revolution as M.
 */
export function solveKeplerElliptic(meanAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (!Number.isFinite(meanAnomalyRad) || !(e >= 0 && e < 1)) return NaN;
  const k = Math.round(meanAnomalyRad / TWO_PI);
  let m = meanAnomalyRad - k * TWO_PI;
  const sign = m < 0 ? -1 : 1;
  m *= sign; // reduced problem: m ∈ [0, π] ⇒ E ∈ [0, π]
  if (e === 0 || m === 0) return sign * m + k * TWO_PI;

  let E: number;
  if (e >= 0.5 && m < 1) E = cubicStarter(m, 1 - e, e);
  else if (e < 0.5) E = m + e * Math.sin(m);
  else E = m + 0.85 * e; // Danby (1987) starter
  let lo = 0;
  let hi = Math.PI;
  E = Math.min(hi, Math.max(lo, E));

  for (let iter = 0; iter < 80; iter++) {
    const s = Math.sin(E);
    const f = E - e * s - m;
    if (f === 0) break;
    if (f > 0) hi = E;
    else lo = E;
    const f1 = 1 - e * Math.cos(E);
    const newton = f / f1;
    const step = f / (f1 - 0.5 * newton * e * s); // Halley
    let next = E - step;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    const done = Math.abs(next - E) <= 4e-16 * Math.max(1, next);
    E = next;
    if (done) break;
  }
  return sign * E + k * TWO_PI;
}

/**
 * Solve the hyperbolic Kepler equation M = e·sinh H − H for H (e > 1). Safeguarded Halley iteration in the
 * bracket [0, asinh(|M|/(e−1))]; robust from e = 1 + 1e-9 to e ≫ 1 and |M| up to ~1e300.
 */
export function solveKeplerHyperbolic(meanAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (!Number.isFinite(meanAnomalyRad) || !(e > 1)) return NaN;
  const sign = meanAnomalyRad < 0 ? -1 : 1;
  const m = Math.abs(meanAnomalyRad);
  if (m === 0) return 0;

  let lo = 0;
  let hi = Math.asinh(m / (e - 1)); // f(hi) ≥ (e−1)·sinh(hi) − m = 0
  let H = m / e > 3 ? Math.log((2 * m) / e) : cubicStarter(m, e - 1, e);
  if (!(H > lo && H < hi)) H = 0.5 * (lo + hi);

  for (let iter = 0; iter < 200; iter++) {
    const sh = Math.sinh(H);
    const f = e * sh - H - m;
    if (f === 0) break;
    if (f > 0) hi = H;
    else lo = H;
    const f1 = e * Math.cosh(H) - 1;
    const newton = f / f1;
    const step = f / (f1 - 0.5 * newton * e * sh);
    let next = H - step;
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    const done = Math.abs(next - H) <= 4e-16 * Math.max(1, next);
    H = next;
    if (done) break;
  }
  return sign * H;
}

// ── Anomaly conversions ───────────────────────────────────────────────────────────────────

/** Elliptic: eccentric → true anomaly (revolution count preserved). */
export function eccentricToTrueAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (!(e >= 0 && e < 1)) return NaN;
  const k = Math.round(eccentricAnomalyRad / TWO_PI);
  const Er = eccentricAnomalyRad - k * TWO_PI;
  return 2 * Math.atan2(Math.sqrt(1 + e) * Math.sin(Er / 2), Math.sqrt(1 - e) * Math.cos(Er / 2)) + k * TWO_PI;
}

/** Elliptic: true → eccentric anomaly (revolution count preserved). */
export function trueToEccentricAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (!(e >= 0 && e < 1)) return NaN;
  const k = Math.round(trueAnomalyRad / TWO_PI);
  const nr = trueAnomalyRad - k * TWO_PI;
  return 2 * Math.atan2(Math.sqrt(1 - e) * Math.sin(nr / 2), Math.sqrt(1 + e) * Math.cos(nr / 2)) + k * TWO_PI;
}

/** Elliptic: E → M = E − e·sin E. */
export function eccentricToMeanAnomaly(eccentricAnomalyRad: number, eccentricity: number): number {
  if (!(eccentricity >= 0 && eccentricity < 1)) return NaN;
  return eccentricAnomalyRad - eccentricity * Math.sin(eccentricAnomalyRad);
}

/** Hyperbolic: H → true anomaly ν ∈ (−ν∞, ν∞). */
export function hyperbolicToTrueAnomaly(hyperbolicAnomaly: number, eccentricity: number): number {
  const e = eccentricity;
  if (!(e > 1)) return NaN;
  return 2 * Math.atan(Math.sqrt((e + 1) / (e - 1)) * Math.tanh(hyperbolicAnomaly / 2));
}

/** Hyperbolic: true anomaly → H. NaN beyond the asymptote |ν| ≥ acos(−1/e). */
export function trueToHyperbolicAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (!(e > 1)) return NaN;
  const nu = wrapPi(trueAnomalyRad);
  if (Math.abs(nu) >= hyperbolicAsymptoteTrueAnomalyRad(e)) return NaN;
  return 2 * Math.atanh(Math.sqrt((e - 1) / (e + 1)) * Math.tan(nu / 2));
}

/** Limiting true anomaly of a hyperbola's asymptotes, ν∞ = acos(−1/e). */
export function hyperbolicAsymptoteTrueAnomalyRad(eccentricity: number): number {
  return eccentricity > 1 ? Math.acos(-1 / eccentricity) : NaN;
}

/** Mean → true anomaly for elliptic (e < 1) or hyperbolic (e > 1) orbits. */
export function meanToTrueAnomaly(meanAnomalyRad: number, eccentricity: number): number {
  if (eccentricity >= 0 && eccentricity < 1) {
    return eccentricToTrueAnomaly(solveKeplerElliptic(meanAnomalyRad, eccentricity), eccentricity);
  }
  if (eccentricity > 1) {
    return hyperbolicToTrueAnomaly(solveKeplerHyperbolic(meanAnomalyRad, eccentricity), eccentricity);
  }
  return NaN;
}

/** True → mean anomaly for elliptic (revolution count preserved) or hyperbolic orbits. */
export function trueToMeanAnomaly(trueAnomalyRad: number, eccentricity: number): number {
  const e = eccentricity;
  if (e >= 0 && e < 1) return eccentricToMeanAnomaly(trueToEccentricAnomaly(trueAnomalyRad, e), e);
  if (e > 1) {
    const H = trueToHyperbolicAnomaly(trueAnomalyRad, e);
    return e * Math.sinh(H) - H;
  }
  return NaN;
}

// ── Scalar relations ──────────────────────────────────────────────────────────────────────

/** Orbital period P = 2π·sqrt(a³/μ), s. NaN for unbound orbits (a ≤ 0). */
export function orbitalPeriodS(semiMajorAxisM: number, muM3S2: number): number {
  if (!(semiMajorAxisM > 0) || !(muM3S2 > 0)) return NaN;
  return TWO_PI * Math.sqrt((semiMajorAxisM * semiMajorAxisM * semiMajorAxisM) / muM3S2);
}

/** Semi-major axis from period (Kepler's third law), m. */
export function semiMajorAxisFromPeriodM(periodS: number, muM3S2: number): number {
  if (!(periodS > 0) || !(muM3S2 > 0)) return NaN;
  return Math.cbrt((muM3S2 * periodS * periodS) / (TWO_PI * TWO_PI));
}

/** Mean motion n = sqrt(μ/|a|³), rad/s (also valid for hyperbolic orbits). */
export function meanMotionRadS(semiMajorAxisM: number, muM3S2: number): number {
  const a = Math.abs(semiMajorAxisM);
  if (!(a > 0) || !(muM3S2 > 0) || !Number.isFinite(a)) return NaN;
  return Math.sqrt(muM3S2 / (a * a * a));
}

/** Vis-viva: v = sqrt(μ(2/r − 1/a)), m/s. NaN where the orbit cannot reach r. */
export function visVivaSpeedMS(radiusM: number, semiMajorAxisM: number, muM3S2: number): number {
  if (!(radiusM > 0) || !(muM3S2 > 0) || semiMajorAxisM === 0) return NaN;
  const v2 = muM3S2 * (2 / radiusM - 1 / semiMajorAxisM);
  return v2 >= 0 ? Math.sqrt(v2) : NaN;
}

/** Circular-orbit speed sqrt(μ/r), m/s. */
export function circularSpeedMS(radiusM: number, muM3S2: number): number {
  if (!(radiusM > 0) || !(muM3S2 > 0)) return NaN;
  return Math.sqrt(muM3S2 / radiusM);
}

/** Escape speed sqrt(2μ/r), m/s. */
export function escapeSpeedMS(radiusM: number, muM3S2: number): number {
  if (!(radiusM > 0) || !(muM3S2 > 0)) return NaN;
  return Math.sqrt((2 * muM3S2) / radiusM);
}

/** Specific orbital energy ε = v²/2 − μ/r, J/kg. */
export function specificOrbitalEnergy(radiusM: number, speedMS: number, muM3S2: number): number {
  if (!(radiusM > 0)) return NaN;
  return 0.5 * speedMS * speedMS - muM3S2 / radiusM;
}

/** Periapsis distance q = a(1 − e), m (valid for ellipses and hyperbolas with a < 0). */
export function periapsisRadiusM(semiMajorAxisM: number, eccentricity: number): number {
  const q = semiMajorAxisM * (1 - eccentricity);
  return q > 0 && eccentricity >= 0 ? q : NaN;
}

/** Apoapsis distance Q = a(1 + e), m; +Infinity for unbound orbits (e ≥ 1). */
export function apoapsisRadiusM(semiMajorAxisM: number, eccentricity: number): number {
  if (eccentricity >= 1) return Infinity;
  if (!(semiMajorAxisM > 0) || !(eccentricity >= 0)) return NaN;
  return semiMajorAxisM * (1 + eccentricity);
}

// ── Elements ↔ state ──────────────────────────────────────────────────────────────────────

function elementsValid(a: number, e: number, mu: number): boolean {
  return mu > 0 && Number.isFinite(a) && ((e >= 0 && e < 1 && a > 0) || (e > 1 && a < 0));
}

function fillNaN(out: Float64Array, offset: number): Float64Array {
  for (let i = 0; i < 6; i++) out[offset + i] = NaN;
  return out;
}

/**
 * Cartesian state at a given TRUE anomaly. Writes [x, y, z, vx, vy, vz] (m, m/s) into `out` at `offset`.
 */
export function stateFromTrueAnomaly(
  el: Omit<KeplerElements, 'meanAnomalyRad'>,
  trueAnomalyRad: number,
  muM3S2: number,
  out: Float64Array = new Float64Array(6),
  offset = 0,
): Float64Array {
  const a = el.semiMajorAxisM;
  const e = el.eccentricity;
  if (!elementsValid(a, e, muM3S2) || !Number.isFinite(trueAnomalyRad)) return fillNaN(out, offset);
  const cn = Math.cos(trueAnomalyRad);
  const denom = 1 + e * cn;
  if (!(denom > 0)) return fillNaN(out, offset); // beyond a hyperbola's asymptote
  const p = a * (1 - e * e);
  const sn = Math.sin(trueAnomalyRad);
  const r = p / denom;
  const vf = Math.sqrt(muM3S2 / p);

  const cO = Math.cos(el.raanRad);
  const sO = Math.sin(el.raanRad);
  const ci = Math.cos(el.inclinationRad);
  const si = Math.sin(el.inclinationRad);
  const cw = Math.cos(el.argPeriapsisRad);
  const sw = Math.sin(el.argPeriapsisRad);
  // Perifocal basis P (towards periapsis) and Q (90° ahead in the direction of motion), inertial components.
  const Px = cO * cw - sO * sw * ci;
  const Py = sO * cw + cO * sw * ci;
  const Pz = sw * si;
  const Qx = -cO * sw - sO * cw * ci;
  const Qy = -sO * sw + cO * cw * ci;
  const Qz = cw * si;

  const xp = r * cn;
  const yp = r * sn;
  const vxp = -vf * sn;
  const vyp = vf * (e + cn);
  out[offset] = xp * Px + yp * Qx;
  out[offset + 1] = xp * Py + yp * Qy;
  out[offset + 2] = xp * Pz + yp * Qz;
  out[offset + 3] = vxp * Px + vyp * Qx;
  out[offset + 4] = vxp * Py + vyp * Qy;
  out[offset + 5] = vxp * Pz + vyp * Qz;
  return out;
}

/** Cartesian state from Keplerian elements (mean anomaly at epoch). Writes 6 numbers into `out` at `offset`. */
export function elementsToState(
  el: KeplerElements,
  muM3S2: number,
  out: Float64Array = new Float64Array(6),
  offset = 0,
): Float64Array {
  return stateFromTrueAnomaly(el, meanToTrueAnomaly(el.meanAnomalyRad, el.eccentricity), muM3S2, out, offset);
}

const SINGULAR_EPS = 1e-11;

/**
 * Keplerian elements from a Cartesian state [x, y, z, vx, vy, vz] (read at `offset`).
 * Singular cases follow Vallado (2013, Alg. 9): circular (e < 1e-11) → ω = 0 and M measured from the node
 * (argument of latitude); equatorial (sin i < 1e-11) → Ω = 0 and ω measured from +x (longitude of periapsis);
 * circular equatorial → M is the true longitude. Ω, ω ∈ [0, 2π); M ∈ [0, 2π) for ellipses.
 * Radial (zero angular momentum) and exactly parabolic states give NaN elements.
 */
export function stateToElements(
  state: ArrayLike<number>,
  muM3S2: number,
  out: KeplerElements = { semiMajorAxisM: 0, eccentricity: 0, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 },
  offset = 0,
): KeplerElements {
  const rx = state[offset], ry = state[offset + 1], rz = state[offset + 2];
  const vx = state[offset + 3], vy = state[offset + 4], vz = state[offset + 5];
  const r = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  const hx = ry * vz - rz * vy;
  const hy = rz * vx - rx * vz;
  const hz = rx * vy - ry * vx;
  const h = Math.hypot(hx, hy, hz);
  if (!(muM3S2 > 0) || !(r > 0) || !(h > 1e-12 * r * Math.sqrt(v2)) || !Number.isFinite(h)) {
    out.semiMajorAxisM = out.eccentricity = out.inclinationRad = out.raanRad = out.argPeriapsisRad = out.meanAnomalyRad = NaN;
    return out;
  }
  const rdotv = rx * vx + ry * vy + rz * vz;
  const c1 = v2 - muM3S2 / r;
  const ex = (c1 * rx - rdotv * vx) / muM3S2;
  const ey = (c1 * ry - rdotv * vy) / muM3S2;
  const ez = (c1 * rz - rdotv * vz) / muM3S2;
  const e = Math.hypot(ex, ey, ez);
  const energy = 0.5 * v2 - muM3S2 / r;
  const a = Math.abs(e - 1) < 1e-14 ? NaN : -muM3S2 / (2 * energy);

  const hux = hx / h, huy = hy / h, huz = hz / h;
  const nxy = Math.hypot(hx, hy);
  const inclination = Math.atan2(nxy, hz);
  const equatorial = nxy / h < SINGULAR_EPS;
  const circular = e < SINGULAR_EPS;
  // Node unit vector (x-axis stands in for an undefined node on equatorial orbits).
  const nx = equatorial ? 1 : -hy / nxy;
  const ny = equatorial ? 0 : hx / nxy;
  const raan = equatorial ? 0 : wrapTwoPi(Math.atan2(ny, nx));

  let argp: number;
  let nu: number;
  if (!circular) {
    const eux = ex / e, euy = ey / e, euz = ez / e;
    // ω: signed angle from node to periapsis about ĥ.  ĥ·(n̂ × ê), n̂·ê   (n̂ has no z component)
    const crossZ = hux * (ny * euz) + huy * (-nx * euz) + huz * (nx * euy - ny * eux);
    argp = wrapTwoPi(Math.atan2(crossZ, nx * eux + ny * euy));
    // ν: signed angle from periapsis to position about ĥ.
    const cx = euy * rz - euz * ry;
    const cy = euz * rx - eux * rz;
    const cz = eux * ry - euy * rx;
    nu = Math.atan2(hux * cx + huy * cy + huz * cz, eux * rx + euy * ry + euz * rz);
  } else {
    argp = 0;
    const crossZ = hux * (ny * rz) + huy * (-nx * rz) + huz * (nx * ry - ny * rx);
    nu = Math.atan2(crossZ, nx * rx + ny * ry);
  }

  out.semiMajorAxisM = a;
  out.eccentricity = e;
  out.inclinationRad = inclination;
  out.raanRad = raan;
  out.argPeriapsisRad = argp;
  out.meanAnomalyRad = e < 1 ? wrapTwoPi(trueToMeanAnomaly(nu, e)) : trueToMeanAnomaly(nu, e);
  return out;
}

/** Advance the mean anomaly by n·Δt (pure two-body). Writes into `out` (may alias `el`). */
export function propagateElements(
  el: KeplerElements,
  muM3S2: number,
  dtS: number,
  out: KeplerElements = { ...el },
): KeplerElements {
  const n = meanMotionRadS(el.semiMajorAxisM, muM3S2);
  out.semiMajorAxisM = el.semiMajorAxisM;
  out.eccentricity = el.eccentricity;
  out.inclinationRad = el.inclinationRad;
  out.raanRad = el.raanRad;
  out.argPeriapsisRad = el.argPeriapsisRad;
  const m = el.meanAnomalyRad + n * dtS;
  out.meanAnomalyRad = el.eccentricity < 1 ? wrapTwoPi(m) : m;
  return out;
}

// ── Universal-variable propagation ────────────────────────────────────────────────────────

/** Stumpff functions c2(ψ), c3(ψ) written to a 2-element scratch (series near ψ = 0). */
function stumpff(psi: number, out: Float64Array): void {
  if (psi > 1e-4) {
    const s = Math.sqrt(psi);
    out[0] = (1 - Math.cos(s)) / psi;
    out[1] = (s - Math.sin(s)) / (psi * s);
  } else if (psi < -1e-4) {
    const s = Math.sqrt(-psi);
    out[0] = (Math.cosh(s) - 1) / -psi;
    out[1] = (Math.sinh(s) - s) / (-psi * s);
  } else {
    out[0] = 0.5 - psi * (1 / 24 - psi * (1 / 720 - psi / 40320));
    out[1] = 1 / 6 - psi * (1 / 120 - psi * (1 / 5040 - psi / 362880));
  }
}

const STUMPFF_SCRATCH = new Float64Array(2);

/**
 * Propagate a two-body state by Δt using universal variables with the Laguerre–Conway iteration
 * (Conway 1986), valid for elliptic, parabolic and hyperbolic orbits alike and for Δt of either sign.
 * Reads [x,y,z,vx,vy,vz] from `state0` at `inOffset`, writes the propagated state into `out` at `outOffset`
 * (`out` may be the same array as `state0`). Exact Keplerian motion: no perturbations.
 */
export function propagateKepler(
  state0: ArrayLike<number>,
  muM3S2: number,
  dtS: number,
  out: Float64Array = new Float64Array(6),
  inOffset = 0,
  outOffset = 0,
): Float64Array {
  const rx = state0[inOffset], ry = state0[inOffset + 1], rz = state0[inOffset + 2];
  const vx = state0[inOffset + 3], vy = state0[inOffset + 4], vz = state0[inOffset + 5];
  const r0 = Math.hypot(rx, ry, rz);
  const v2 = vx * vx + vy * vy + vz * vz;
  if (!(muM3S2 > 0) || !(r0 > 0) || !Number.isFinite(dtS) || !Number.isFinite(v2)) return fillNaN(out, outOffset);
  if (dtS === 0) {
    out[outOffset] = rx; out[outOffset + 1] = ry; out[outOffset + 2] = rz;
    out[outOffset + 3] = vx; out[outOffset + 4] = vy; out[outOffset + 5] = vz;
    return out;
  }
  const sqrtMu = Math.sqrt(muM3S2);
  const alpha = 2 / r0 - v2 / muM3S2; // 1/a
  let dt = dtS;
  if (alpha > 0) {
    // Remove whole revolutions: exact, and keeps the universal anomaly small.
    const period = TWO_PI / (sqrtMu * Math.sqrt(alpha * alpha * alpha));
    dt -= period * Math.trunc(dt / period);
  }
  const sigma0 = (rx * vx + ry * vy + rz * vz) / sqrtMu;
  const beta = 1 - alpha * r0;

  // Initial guess.
  let chi: number;
  if (alpha > 1e-12 / r0) {
    chi = sqrtMu * dt * alpha;
  } else if (alpha < -1e-12 / r0) {
    const a = 1 / alpha;
    const sgn = dt >= 0 ? 1 : -1;
    const arg = (-2 * muM3S2 * alpha * dt) / (sigma0 * sqrtMu + sgn * Math.sqrt(-muM3S2 * a) * beta);
    chi = arg > 0 ? sgn * Math.sqrt(-a) * Math.log(arg) : (sqrtMu * dt) / r0;
  } else {
    chi = (sqrtMu * dt) / r0;
  }
  if (!Number.isFinite(chi)) chi = (sqrtMu * dt) / r0;

  // Laguerre–Conway (n = 5) on F(χ) = σ0χ²c2 + βχ³c3 + r0χ − √μ·Δt.
  const N = 5;
  const c = STUMPFF_SCRATCH;
  let rNew = r0;
  for (let iter = 0; iter < 100; iter++) {
    const chi2 = chi * chi;
    const psi = alpha * chi2;
    stumpff(psi, c);
    const F = sigma0 * chi2 * c[0] + beta * chi2 * chi * c[1] + r0 * chi - sqrtMu * dt;
    const F1 = sigma0 * chi * (1 - psi * c[1]) + beta * chi2 * c[0] + r0; // = r(χ)
    const F2 = sigma0 * (1 - psi * c[0]) + beta * chi * (1 - psi * c[1]);
    rNew = F1;
    const disc = Math.sqrt(Math.abs((N - 1) * (N - 1) * F1 * F1 - N * (N - 1) * F * F2));
    const denom = F1 + (F1 >= 0 ? disc : -disc);
    const delta = denom !== 0 ? (N * F) / denom : F / F1;
    chi -= delta;
    if (Math.abs(delta) <= 1e-15 * Math.max(1, Math.abs(chi))) break;
  }

  const chi2 = chi * chi;
  const psi = alpha * chi2;
  stumpff(psi, c);
  rNew = sigma0 * chi * (1 - psi * c[1]) + beta * chi2 * c[0] + r0;
  const f = 1 - (chi2 / r0) * c[0];
  const g = dt - ((chi2 * chi) / sqrtMu) * c[1];
  const gdot = 1 - (chi2 / rNew) * c[0];
  const fdot = (sqrtMu / (rNew * r0)) * chi * (psi * c[1] - 1);
  out[outOffset] = f * rx + g * vx;
  out[outOffset + 1] = f * ry + g * vy;
  out[outOffset + 2] = f * rz + g * vz;
  out[outOffset + 3] = fdot * rx + gdot * vx;
  out[outOffset + 4] = fdot * ry + gdot * vy;
  out[outOffset + 5] = fdot * rz + gdot * vz;
  return out;
}

// ── Earth J2 secular drift ────────────────────────────────────────────────────────────────

/** Earth's dynamical form factor J2 (EGM96; Vallado 2013 Table D-1: 0.0010826267). */
export const J2_EARTH = 1.082_626_68e-3;
/** Reference equatorial radius of the EGM96 gravity model, m. */
export const EARTH_J2_REFERENCE_RADIUS_M = 6_378_136.3;

export interface J2SecularRates {
  /** dΩ/dt, rad/s (negative = westward nodal regression for prograde orbits). */
  raanRateRadS: number;
  /** dω/dt, rad/s (apsidal precession; zero at the critical inclination 63.43°). */
  argPeriapsisRateRadS: number;
  /** dM/dt = n + J2 correction, rad/s. */
  meanAnomalyRateRadS: number;
}

export interface J2Options {
  muM3S2?: number;
  j2?: number;
  referenceRadiusM?: number;
}

/**
 * First-order secular J2 rates (Vallado 2013 eq. 9-41; Kozai 1959):
 *   dΩ/dt = −(3/2) n J2 (R/p)² cos i
 *   dω/dt =  (3/4) n J2 (R/p)² (4 − 5 sin² i)
 *   dM/dt = n + (3/4) n J2 (R/p)² √(1−e²) (2 − 3 sin² i)
 * Defaults to Earth (GM⊕, J2 EGM96). Elliptic orbits only.
 */
export function j2SecularRates(
  el: Pick<KeplerElements, 'semiMajorAxisM' | 'eccentricity' | 'inclinationRad'>,
  opts: J2Options = {},
  out: J2SecularRates = { raanRateRadS: 0, argPeriapsisRateRadS: 0, meanAnomalyRateRadS: 0 },
): J2SecularRates {
  const mu = opts.muM3S2 ?? GM_EARTH;
  const j2 = opts.j2 ?? J2_EARTH;
  const R = opts.referenceRadiusM ?? EARTH_J2_REFERENCE_RADIUS_M;
  const a = el.semiMajorAxisM;
  const e = el.eccentricity;
  if (!(a > 0) || !(e >= 0 && e < 1) || !(mu > 0)) {
    out.raanRateRadS = out.argPeriapsisRateRadS = out.meanAnomalyRateRadS = NaN;
    return out;
  }
  const n = Math.sqrt(mu / (a * a * a));
  const p = a * (1 - e * e);
  const k = 0.75 * n * j2 * (R / p) * (R / p);
  const ci = Math.cos(el.inclinationRad);
  const s2 = 1 - ci * ci;
  out.raanRateRadS = -2 * k * ci;
  out.argPeriapsisRateRadS = k * (4 - 5 * s2);
  out.meanAnomalyRateRadS = n + k * Math.sqrt(1 - e * e) * (2 - 3 * s2);
  return out;
}

const J2_SCRATCH: J2SecularRates = { raanRateRadS: 0, argPeriapsisRateRadS: 0, meanAnomalyRateRadS: 0 };

/** Two-body + secular J2 element drift over Δt (the ADR-006 bulk-display approximation). */
export function propagateElementsJ2(
  el: KeplerElements,
  dtS: number,
  opts: J2Options = {},
  out: KeplerElements = { ...el },
): KeplerElements {
  const rates = j2SecularRates(el, opts, J2_SCRATCH);
  out.semiMajorAxisM = el.semiMajorAxisM;
  out.eccentricity = el.eccentricity;
  out.inclinationRad = el.inclinationRad;
  out.raanRad = wrapTwoPi(el.raanRad + rates.raanRateRadS * dtS);
  out.argPeriapsisRad = wrapTwoPi(el.argPeriapsisRad + rates.argPeriapsisRateRadS * dtS);
  out.meanAnomalyRad = wrapTwoPi(el.meanAnomalyRad + rates.meanAnomalyRateRadS * dtS);
  return out;
}

// ── Orbit polylines ───────────────────────────────────────────────────────────────────────

export interface OrbitPolylineOptions {
  /** Destination (length ≥ 3n). Allocated when omitted. */
  out?: Float64Array;
  /**
   * Share w ∈ [0, 1) of the vertex budget spent on curvature: vertices are uniform in c = w·θ + (1 − w)·E,
   * where θ is the turning angle of the tangent and E the eccentric (hyperbolic) anomaly, so every segment
   * turns by at most Δc/w and spans at most Δc/(1 − w) of anomaly. Default 0.75.
   */
  curvatureWeight?: number;
  /** Hyperbolic orbits: truncate the arc at this distance from the focus (default 20 × periapsis distance). */
  maxRadiusM?: number;
  /** Optional per-vertex time since periapsis passage, s (length ≥ n). */
  outTimeFromPeriapsisS?: Float64Array;
}

/** Invert a strictly increasing smooth g on [lo, hi] (g(lo) ≤ target ≤ g(hi)) by safeguarded Newton. */
function invertMonotone(
  g: (x: number) => number,
  dg: (x: number) => number,
  target: number,
  lo: number,
  hi: number,
  guess: number,
): number {
  let x = Math.min(hi, Math.max(lo, guess));
  for (let iter = 0; iter < 60; iter++) {
    const f = g(x) - target;
    if (f === 0) return x;
    if (f > 0) hi = x;
    else lo = x;
    let next = x - f / dg(x);
    if (!(next > lo && next < hi)) next = 0.5 * (lo + hi);
    if (Math.abs(next - x) <= 1e-14 * Math.max(1, Math.abs(next))) return next;
    x = next;
  }
  return x;
}

/**
 * Sample an orbit as a polyline of `n` vertices [x,y,z,…] (m, relative to the central body, in the elements'
 * frame) with curvature-adaptive spacing (see {@link OrbitPolylineOptions.curvatureWeight}): the tight ends of
 * an e = 0.99 ellipse receive as many vertices as they need while its long flanks are not starved.
 * Ellipses: n vertices over one revolution starting at periapsis (draw as a closed loop; the first vertex is
 * not repeated). Hyperbolas: n vertices from −Hmax to +Hmax inclusive (open arc, symmetric about periapsis).
 * Not per-frame code (a few Newton steps per vertex): call it when the elements change.
 */
export function sampleOrbitPolyline(
  el: KeplerElements,
  muM3S2: number,
  n: number,
  opts: OrbitPolylineOptions = {},
): Float64Array {
  const count = Math.max(2, Math.floor(n));
  const out = opts.out && opts.out.length >= 3 * count ? opts.out : new Float64Array(3 * count);
  const times = opts.outTimeFromPeriapsisS;
  const a = el.semiMajorAxisM;
  const e = el.eccentricity;
  if (!elementsValid(a, e, muM3S2 > 0 ? muM3S2 : 1)) {
    out.fill(NaN, 0, 3 * count);
    if (times) times.fill(NaN, 0, count);
    return out;
  }
  const w = Math.min(1 - 1e-9, Math.max(0, opts.curvatureWeight ?? 0.75));
  const cO = Math.cos(el.raanRad), sO = Math.sin(el.raanRad);
  const ci = Math.cos(el.inclinationRad), si = Math.sin(el.inclinationRad);
  const cw = Math.cos(el.argPeriapsisRad), sw = Math.sin(el.argPeriapsisRad);
  const Px = cO * cw - sO * sw * ci, Py = sO * cw + cO * sw * ci, Pz = sw * si;
  const Qx = -cO * sw - sO * cw * ci, Qy = -sO * sw + cO * cw * ci, Qz = cw * si;
  const nMean = muM3S2 > 0 ? meanMotionRadS(a, muM3S2) : NaN;

  if (e < 1) {
    const b = a * Math.sqrt(1 - e * e);
    // Tangent turning angle θ(E) = direction of the outward normal, unwrapped to [0, 2π).
    const theta = (E: number): number => {
      const t = Math.atan2(a * Math.sin(E), b * Math.cos(E));
      return t < 0 || (t === 0 && E > Math.PI) ? t + TWO_PI : t;
    };
    const dTheta = (E: number): number => {
      const s = Math.sin(E), c = Math.cos(E);
      return (a * b) / (b * b * c * c + a * a * s * s);
    };
    const g = (E: number): number => w * theta(E) + (1 - w) * E;
    const dg = (E: number): number => w * dTheta(E) + (1 - w);
    for (let i = 0; i < count; i++) {
      const c = (TWO_PI * i) / count;
      let guess = Math.atan2(b * Math.sin(c), a * Math.cos(c));
      if (guess < 0) guess += TWO_PI;
      const E = i === 0 ? 0 : invertMonotone(g, dg, c, 0, TWO_PI, (1 - w) * c + w * guess);
      const xp = a * (Math.cos(E) - e);
      const yp = b * Math.sin(E);
      out[3 * i] = xp * Px + yp * Qx;
      out[3 * i + 1] = xp * Py + yp * Qy;
      out[3 * i + 2] = xp * Pz + yp * Qz;
      if (times) times[i] = (E - e * Math.sin(E)) / nMean;
    }
    return out;
  }

  const aa = -a; // |a|
  const b = aa * Math.sqrt(e * e - 1);
  const q = aa * (e - 1);
  const rMax = Math.max(q * 1.000001, opts.maxRadiusM ?? 20 * q);
  const hMax = Math.acosh((rMax / aa + 1) / e);
  const k = aa / b;
  const phiMax = Math.atan(k * Math.tanh(hMax));
  const g = (H: number): number => (w * Math.atan(k * Math.tanh(H))) / phiMax + ((1 - w) * H) / hMax;
  const dg = (H: number): number => {
    const ch = Math.cosh(H);
    const t = k * Math.tanh(H);
    return (w * k) / (ch * ch * phiMax * (1 + t * t)) + (1 - w) / hMax;
  };
  for (let i = 0; i < count; i++) {
    const c = -1 + (2 * i) / (count - 1);
    const H = invertMonotone(g, dg, c, -hMax, hMax, c * hMax);
    const xp = aa * (e - Math.cosh(H));
    const yp = b * Math.sinh(H);
    out[3 * i] = xp * Px + yp * Qx;
    out[3 * i + 1] = xp * Py + yp * Qy;
    out[3 * i + 2] = xp * Pz + yp * Qz;
    if (times) times[i] = (e * Math.sinh(H) - H) / nMean;
  }
  return out;
}

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const ORBIT_MODELS: readonly ModelInfo[] = [
  {
    id: 'kepler-two-body',
    version: 1,
    title: 'Two-body Keplerian motion',
    summary:
      'Motion of a small body around a single point mass: conic-section orbits described by six elements, with ' +
      "Kepler's equation linking time to position along the orbit.",
    latex: String.raw`M = E - e\sin E = n\,(t - t_p),\qquad n = \sqrt{\mu / a^{3}}`,
    extraLatex: [
      String.raw`v^{2} = \mu\left(\frac{2}{r} - \frac{1}{a}\right)`,
      String.raw`P = 2\pi\sqrt{a^{3}/\mu}`,
      String.raw`r = \frac{a(1-e^{2})}{1 + e\cos\nu}`,
      String.raw`M = e\sinh H - H \quad (e > 1)`,
    ],
    variables: [
      { symbol: 'M', meaning: 'Mean anomaly', unit: 'rad' },
      { symbol: 'E', meaning: 'Eccentric anomaly', unit: 'rad' },
      { symbol: 'H', meaning: 'Hyperbolic anomaly', unit: 'rad' },
      { symbol: String.raw`\nu`, meaning: 'True anomaly', unit: 'rad' },
      { symbol: 'e', meaning: 'Eccentricity', unit: '' },
      { symbol: 'a', meaning: 'Semi-major axis (negative for hyperbolic orbits)', unit: 'm' },
      { symbol: String.raw`\mu`, meaning: 'Gravitational parameter GM of the central body', unit: 'm3/s2' },
      { symbol: 'n', meaning: 'Mean motion', unit: 'rad/s' },
      { symbol: 'r', meaning: 'Distance from the central body', unit: 'm' },
      { symbol: 'v', meaning: 'Orbital speed', unit: 'm/s' },
      { symbol: 'P', meaning: 'Orbital period', unit: 's' },
    ],
    assumptions: [
      'Only two bodies; the orbiting body\'s mass is negligible (or included in μ).',
      'Central body treated as a point mass (no oblateness, no atmosphere).',
      'No perturbations from other bodies, radiation pressure or relativity.',
    ],
    validity:
      'Exact for an isolated two-body system. For real objects, accuracy degrades with time from the element epoch ' +
      'because of perturbations (planets on asteroids; J2, drag and the Moon on satellites).',
    accuracy: 'Solver accuracy ~1e-15 rad; physical accuracy limited by neglected perturbations.',
    kind: 'derived',
    references: [
      { citation: 'Vallado, D. A. (2013), Fundamentals of Astrodynamics and Applications, 4th ed., Microcosm Press — Algorithms 2, 8, 9, 10' },
      { citation: 'Conway, B. A. (1986), An improved algorithm due to Laguerre for the solution of Kepler\'s equation, Celestial Mechanics 39, 199', bibcode: '1986CeMec..39..199C' },
      { citation: 'Danby, J. M. A. (1987), The solution of Kepler\'s equation III, Celestial Mechanics 40, 303', bibcode: '1987CeMec..40..303D' },
    ],
  },
  {
    id: 'j2-secular',
    version: 1,
    title: 'Secular drift from Earth\'s oblateness (J2)',
    summary:
      'Earth\'s equatorial bulge makes orbital planes slowly rotate (nodal regression) and ellipses precess. ' +
      'This first-order model gives the average rates, which is why sun-synchronous orbits are possible.',
    latex: String.raw`\dot\Omega = -\tfrac{3}{2}\,n J_2 \left(\frac{R_\oplus}{p}\right)^{2}\cos i`,
    extraLatex: [
      String.raw`\dot\omega = \tfrac{3}{4}\,n J_2 \left(\frac{R_\oplus}{p}\right)^{2}\left(4 - 5\sin^{2} i\right)`,
      String.raw`\dot M = n + \tfrac{3}{4}\,n J_2 \left(\frac{R_\oplus}{p}\right)^{2}\sqrt{1-e^{2}}\left(2 - 3\sin^{2} i\right)`,
      String.raw`p = a(1-e^{2})`,
    ],
    variables: [
      { symbol: String.raw`\dot\Omega`, meaning: 'Rate of change of the ascending-node longitude', unit: 'rad/s' },
      { symbol: String.raw`\dot\omega`, meaning: 'Rate of change of the argument of perigee', unit: 'rad/s' },
      { symbol: String.raw`\dot M`, meaning: 'Mean-anomaly rate', unit: 'rad/s' },
      { symbol: 'J_2', meaning: 'Earth oblateness coefficient (1.0826267×10⁻³, EGM96)', unit: '' },
      { symbol: String.raw`R_\oplus`, meaning: 'Earth reference equatorial radius (6378.1363 km)', unit: 'm' },
      { symbol: 'i', meaning: 'Inclination', unit: 'rad' },
      { symbol: 'p', meaning: 'Semi-latus rectum', unit: 'm' },
    ],
    assumptions: [
      'Only the J2 zonal harmonic; first order in J2; orbit-averaged (short-period terms dropped).',
      'No drag, third-body or radiation-pressure effects.',
    ],
    validity: 'Bound Earth orbits above the atmosphere; rates accurate to O(J2²) ≈ 0.1%.',
    accuracy: 'Positions drift by km per day versus SGP4 for LEO objects (labelled approximate per ADR-006).',
    kind: 'derived',
    references: [
      { citation: 'Vallado, D. A. (2013), Fundamentals of Astrodynamics and Applications, 4th ed., §9.6, eq. 9-41' },
      { citation: 'Kozai, Y. (1959), The motion of a close earth satellite, AJ 64, 367', bibcode: '1959AJ.....64..367K' },
    ],
  },
];
