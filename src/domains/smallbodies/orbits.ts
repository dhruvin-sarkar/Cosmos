/**
 * Two-body heliocentric motion of small bodies (elliptic and hyperbolic) in ICRS axes, plus the time helpers
 * shared by the asteroid cloud, the named bodies and the NEO API.
 *
 * Elements are SBDB osculating elements: ecliptic J2000, JD TDB epoch, angles in degrees, a in au (negative for
 * hyperbolic orbits). Positions come out heliocentric (Sun centre) in metres, ICRS axes; the caller adds the Sun's
 * barycentric position. Planetary perturbations are NOT modelled: accuracy degrades with |t − epoch| (years for
 * near-Earth objects, decades for slow comets). That is stated in every FactSheet.
 */
import type { Vector3 } from 'three';
import { AU_M, DEG, GM_SUN, JD_UNIX_EPOCH, SECONDS_PER_DAY } from '../../core/units';
import { eclipticToIcrs } from '../../core/frames';
import { solveKeplerElliptic } from '../../render/glsl/kepler';
import { solveKeplerHyperbolic } from '../../science/orbits';

/** TT − UTC at the present epoch (leap seconds + 32.184 s), s. Same constant the solar domain uses. */
export const TDB_MINUS_UTC_S = 69.184;

export interface HelioElements {
  /** Osculating epoch, JD TDB. */
  epochJD: number;
  /** Semi-major axis, au (negative = hyperbolic). */
  aAU: number;
  e: number;
  iDeg: number;
  nodeDeg: number;
  argPeriDeg: number;
  meanAnomalyDeg: number;
}

/** Julian date (TDB) of a Unix-ms UTC instant. */
export function jdTdbFromMs(tMs: number): number {
  return tMs / (SECONDS_PER_DAY * 1000) + JD_UNIX_EPOCH + TDB_MINUS_UTC_S / SECONDS_PER_DAY;
}

/** Unix ms (UTC) of a JD TDB. */
export function msFromJdTdb(jd: number): number {
  return (jd - JD_UNIX_EPOCH - TDB_MINUS_UTC_S / SECONDS_PER_DAY) * SECONDS_PER_DAY * 1000;
}

/** Gaussian gravitational constant k (rad/day) — mean motion at a = 1 au for the Sun. */
export const GAUSS_K = 0.017_202_098_95;

/** Mean motion, rad/day (|a|³ in au). */
export function meanMotionRadPerDay(aAU: number): number {
  return GAUSS_K / Math.sqrt(Math.abs(aAU) ** 3);
}

/** Orbital period in days; null for hyperbolic orbits. */
export function periodDays(aAU: number, e: number): number | null {
  return e < 1 && aAU > 0 ? (2 * Math.PI) / meanMotionRadPerDay(aAU) : null;
}

/** Perihelion distance, au. */
export function perihelionAU(aAU: number, e: number): number {
  return Math.abs(aAU) * Math.abs(1 - e);
}

/** Aphelion distance, au; null for open orbits. */
export function aphelionAU(aAU: number, e: number): number | null {
  return e < 1 && aAU > 0 ? aAU * (1 + e) : null;
}

interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * Heliocentric ECLIPTIC position (au) at JD TDB `jd`, written into `out`.
 */
export function eclipticPositionAU<T extends Vec3Like>(el: HelioElements, jd: number, out: T): T {
  const e = el.e;
  const n = meanMotionRadPerDay(el.aAU);
  const M = (el.meanAnomalyDeg * DEG) + n * (jd - el.epochJD);
  let xp: number;
  let yp: number;
  if (e < 1) {
    const E = solveKeplerElliptic(M, e);
    xp = el.aAU * (Math.cos(E) - e);
    yp = el.aAU * Math.sqrt(1 - e * e) * Math.sin(E);
  } else {
    const H = solveKeplerHyperbolic(M, e);
    const a = Math.abs(el.aAU);
    xp = a * (e - Math.cosh(H));
    yp = a * Math.sqrt(e * e - 1) * Math.sinh(H);
  }
  const i = el.iDeg * DEG, O = el.nodeDeg * DEG, w = el.argPeriDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
  const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
  out.x = xp * px + yp * qx;
  out.y = xp * py + yp * qy;
  out.z = xp * pz + yp * qz;
  return out;
}

const ecl = { x: 0, y: 0, z: 0 };

/** Heliocentric ICRS position in METRES at JD TDB `jd`, written into `out` (no allocation). */
export function heliocentricIcrsM(el: HelioElements, jd: number, out: Vector3): Vector3 {
  eclipticPositionAU(el, jd, ecl);
  eclipticToIcrs(ecl, out);
  return out.multiplyScalar(AU_M);
}

/** Heliocentric distance (au) at JD TDB `jd`. */
export function heliocentricDistanceAU(el: HelioElements, jd: number): number {
  eclipticPositionAU(el, jd, ecl);
  return Math.hypot(ecl.x, ecl.y, ecl.z);
}

const ecl2 = { x: 0, y: 0, z: 0 };

/** Heliocentric ICRS velocity (m/s) by a ±0.05 d central difference (dependable for all conics). */
export function heliocentricVelocityIcrs(el: HelioElements, jd: number, out: Vector3): Vector3 {
  const h = 0.05;
  eclipticPositionAU(el, jd + h, ecl);
  eclipticPositionAU(el, jd - h, ecl2);
  ecl.x = ecl.x - ecl2.x;
  ecl.y = ecl.y - ecl2.y;
  ecl.z = ecl.z - ecl2.z;
  eclipticToIcrs(ecl, out);
  return out.multiplyScalar(AU_M / (2 * h * SECONDS_PER_DAY));
}

/** Speed (m/s) from vis-viva at heliocentric distance rAU. */
export function visVivaSpeedMs(aAU: number, rAU: number): number {
  return Math.sqrt(GM_SUN * (2 / (rAU * AU_M) - 1 / (aAU * AU_M)));
}

/**
 * Ellipse/hyperbola sample (xyz ICRS metres, heliocentric) for drawing the whole orbit. Elliptic: `count` points
 * uniform in eccentric anomaly (closed loop, last ≠ first). Hyperbolic: the arc within `maxRAU` of the Sun.
 */
export function sampleOrbitIcrsM(el: HelioElements, count: number, maxRAU = 400): { points: Float64Array; count: number; closed: boolean; fractions: Float64Array } {
  const points = new Float64Array(3 * count);
  const fractions = new Float64Array(count);
  const v = { x: 0, y: 0, z: 0 };
  const i = el.iDeg * DEG, O = el.nodeDeg * DEG, w = el.argPeriDeg * DEG;
  const cO = Math.cos(O), sO = Math.sin(O), ci = Math.cos(i), si = Math.sin(i), cw = Math.cos(w), sw = Math.sin(w);
  const px = cO * cw - sO * sw * ci, py = sO * cw + cO * sw * ci, pz = sw * si;
  const qx = -cO * sw - sO * cw * ci, qy = -sO * sw + cO * cw * ci, qz = cw * si;
  const M0 = (((el.meanAnomalyDeg * DEG) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const a = Math.abs(el.aAU), e = el.e;
  let hMax = 0;
  if (e >= 1) {
    // r = a (e cosh H − 1) ≤ maxR  →  cosh H ≤ (maxR/a + 1)/e
    hMax = Math.acosh(Math.min(1e6, Math.max(1, (maxRAU / a + 1) / e)));
  }
  for (let k = 0; k < count; k++) {
    let xp: number, yp: number;
    if (e < 1) {
      const E = (k / count) * 2 * Math.PI;
      xp = a * (Math.cos(E) - e);
      yp = a * Math.sqrt(1 - e * e) * Math.sin(E);
      fractions[k] = (((E - e * Math.sin(E)) / (2 * Math.PI)) % 1 + 1) % 1;
    } else {
      const H = -hMax + (2 * hMax * k) / (count - 1);
      xp = a * (e - Math.cosh(H));
      yp = a * Math.sqrt(e * e - 1) * Math.sinh(H);
      fractions[k] = k / (count - 1);
    }
    v.x = xp * px + yp * qx;
    v.y = xp * py + yp * qy;
    v.z = xp * pz + yp * qz;
    const o = { x: 0, y: 0, z: 0 };
    eclipticToIcrs(v, o);
    points[3 * k] = o.x * AU_M;
    points[3 * k + 1] = o.y * AU_M;
    points[3 * k + 2] = o.z * AU_M;
  }
  void M0;
  return { points, count, closed: e < 1, fractions };
}
