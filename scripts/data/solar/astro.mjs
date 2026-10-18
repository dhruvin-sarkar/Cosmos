// Small astronomy helpers (pure functions) used to derive values from source data.
// Frames: ICRF/J2000 equatorial unless stated; ecliptic = mean ecliptic & equinox of J2000.

/** J2000 obliquity of the ecliptic (IAU 1976 value used by JPL for "ecliptic of J2000"), degrees. */
export const OBLIQUITY_J2000_DEG = 84381.448 / 3600; // 23.4392911...

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const norm = (a) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a) => { const n = norm(a); return [a[0] / n, a[1] / n, a[2] / n]; };
export const scale = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/** Unit vector (ICRF) from right ascension / declination in degrees. */
export function radecToVec(raDeg, decDeg) {
  const ra = raDeg * D2R, de = decDeg * D2R;
  return [Math.cos(de) * Math.cos(ra), Math.cos(de) * Math.sin(ra), Math.sin(de)];
}

/** RA/Dec (degrees, RA in [0,360)) from an ICRF vector. */
export function vecToRadec(v) {
  const u = unit(v);
  let ra = Math.atan2(u[1], u[0]) * R2D;
  if (ra < 0) ra += 360;
  return { raDeg: ra, decDeg: Math.asin(Math.max(-1, Math.min(1, u[2]))) * R2D };
}

/** Rotate an ecliptic-J2000 vector to ICRF equatorial. */
export function eclToEqu(v) {
  const e = OBLIQUITY_J2000_DEG * D2R;
  const c = Math.cos(e), s = Math.sin(e);
  return [v[0], v[1] * c - v[2] * s, v[1] * s + v[2] * c];
}

/** Rotate an ICRF equatorial vector to ecliptic J2000. */
export function equToEcl(v) {
  const e = OBLIQUITY_J2000_DEG * D2R;
  const c = Math.cos(e), s = Math.sin(e);
  return [v[0], v[1] * c + v[2] * s, -v[1] * s + v[2] * c];
}

/** Ecliptic north pole as an ICRF unit vector. */
export const ECLIPTIC_POLE_ICRF = eclToEqu([0, 0, 1]);

/** Orbit normal (angular-momentum direction) for an orbit given w.r.t. the J2000 ecliptic. ICRF unit vector. */
export function orbitNormalFromEcliptic(iDeg, nodeDeg) {
  const i = iDeg * D2R, O = nodeDeg * D2R;
  return eclToEqu([Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)]);
}

/**
 * Orbit normal for satellite mean elements referred to a reference plane with pole (poleRa, poleDec),
 * node measured from the ascending node of the reference plane on the ICRF equator (JPL SSD convention).
 */
export function orbitNormalFromRefPlane(iDeg, nodeDeg, poleRaDeg, poleDecDeg) {
  const z = radecToVec(poleRaDeg, poleDecDeg);
  const ar = poleRaDeg * D2R;
  const x = [-Math.sin(ar), Math.cos(ar), 0]; // ascending node of ref plane on ICRF equator (RA = poleRa + 90 deg)
  const y = cross(z, x);
  const i = iDeg * D2R, O = nodeDeg * D2R;
  const n = [Math.sin(i) * Math.sin(O), -Math.sin(i) * Math.cos(O), Math.cos(i)];
  return unit([
    n[0] * x[0] + n[1] * y[0] + n[2] * z[0],
    n[0] * x[1] + n[1] * y[1] + n[2] * z[1],
    n[0] * x[2] + n[1] * y[2] + n[2] * z[2],
  ]);
}

/** Angle between two vectors in degrees. */
export function angleDeg(a, b) {
  const c = dot(unit(a), unit(b));
  return Math.acos(Math.max(-1, Math.min(1, c))) * R2D;
}

/** Ecliptic latitude (deg) of an ICRF direction. */
export function eclipticLatitudeDeg(v) {
  const e = equToEcl(unit(v));
  return Math.asin(Math.max(-1, Math.min(1, e[2]))) * R2D;
}

/** IAU pole at J2000 (epoch values only) as ICRF unit vector. */
export function poleVector(rot) {
  return radecToVec(rot.poleRaDeg, rot.poleDecDeg);
}

/**
 * Spin angular-momentum direction: the IAU pole if W increases, the opposite pole if W decreases.
 * (IAU convention: planets/satellites use the pole north of the invariable plane; dwarf planets
 * and small bodies use the right-hand-rule "positive" pole, for which W always increases.)
 */
export function spinVector(rot) {
  const p = poleVector(rot);
  return rot.wDotDegPerDay < 0 ? scale(p, -1) : p;
}

/** Normalize to [0, 360). */
export function wrap360(x) {
  const r = x % 360;
  return r < 0 ? r + 360 : r;
}
