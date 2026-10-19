// Small astronomy helpers for the "stars" domain (no dependencies).

export const DEG = Math.PI / 180;

/**
 * Effective temperature from Johnson B-V (Ballesteros 2012, EPL 97, 34008, eq. 14):
 *   T = 4600 K * ( 1 / (0.92 (B-V) + 1.7) + 1 / (0.92 (B-V) + 0.62) )
 * The formula assumes black-body spectra and is calibrated on main-sequence stars; it diverges
 * at B-V = -0.674. B-V is clamped to [BV_MIN, BV_MAX] before evaluation (documented in headers).
 * Returns NaN when B-V is unknown.
 */
export const BV_MIN = -0.4;
export const BV_MAX = 2.0;
export function teffBallesteros(bv) {
  if (bv == null || !Number.isFinite(bv)) return NaN;
  const x = Math.min(BV_MAX, Math.max(BV_MIN, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62));
}

/** Unit vector (ICRS equatorial Cartesian) from RA/Dec in degrees. */
export function unitVec(raDeg, decDeg) {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const c = Math.cos(dec);
  return [c * Math.cos(ra), c * Math.sin(ra), Math.sin(dec)];
}

/** RA/Dec in degrees (RA in [0,360)) from a (not necessarily unit) vector. */
export function raDecOf(v) {
  const [x, y, z] = v;
  const r = Math.hypot(x, y, z);
  let ra = Math.atan2(y, x) / DEG;
  if (ra < 0) ra += 360;
  if (ra >= 360) ra -= 360;
  return [ra, Math.asin(Math.max(-1, Math.min(1, z / r))) / DEG];
}

export function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
export function normalize(v) {
  const r = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / r, v[1] / r, v[2] / r];
}
export function angleDeg(a, b) {
  // robust angle between unit vectors
  const c = cross(a, b);
  return Math.atan2(Math.hypot(c[0], c[1], c[2]), dot(a, b)) / DEG;
}

/** Normalised mean direction of a list of unit vectors. */
export function meanDirection(vs) {
  const s = [0, 0, 0];
  for (const v of vs) {
    s[0] += v[0];
    s[1] += v[1];
    s[2] += v[2];
  }
  return normalize(s);
}

/**
 * Spherical polygon helper: ring = array of unit vectors (implicitly closed).
 * Precomputes a bounding cap so far-away points (incl. antipodal regions) are rejected first.
 */
export class SphericalRing {
  constructor(raDecPoints) {
    this.raDec = raDecPoints;
    this.v = raDecPoints.map(([ra, dec]) => unitVec(ra, dec));
    this.center = meanDirection(this.v);
    let r = 0;
    for (const p of this.v) r = Math.max(r, angleDeg(this.center, p));
    this.capRadiusDeg = r;
  }

  /** Winding-number test: sum of signed tangent-plane angles of the edges as seen from p. */
  contains(p) {
    if (angleDeg(p, this.center) > this.capRadiusDeg + 1e-9) return false;
    let sum = 0;
    const n = this.v.length;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const vi = this.v[i % n];
      const k = dot(vi, p);
      const a = [vi[0] - k * p[0], vi[1] - k * p[1], vi[2] - k * p[2]];
      if (prev) {
        const s = dot(p, cross(prev, a));
        const c = dot(prev, a);
        sum += Math.atan2(s, c);
      }
      prev = a;
    }
    return Math.abs(sum) > Math.PI;
  }

  /** Signed area (steradians) via the sum of spherical triangle excesses around the cap centre. */
  areaSr() {
    let area = 0;
    const n = this.v.length;
    const c = this.center;
    for (let i = 0; i < n; i++) {
      const a = this.v[i];
      const b = this.v[(i + 1) % n];
      // Van Oosterom & Strackee: tan(E/2) = c.(a x b) / (1 + a.b + b.c + c.a)
      const num = dot(c, cross(a, b));
      const den = 1 + dot(a, b) + dot(b, c) + dot(c, a);
      area += 2 * Math.atan2(num, den);
    }
    return area;
  }
}

// ------------------------------------------------------- designations ----

const GREEK = {
  alp: 'α', bet: 'β', gam: 'γ', del: 'δ', eps: 'ε', zet: 'ζ', eta: 'η', the: 'θ', iot: 'ι', kap: 'κ', lam: 'λ', mu: 'μ',
  nu: 'ν', xi: 'ξ', omi: 'ο', pi: 'π', rho: 'ρ', sig: 'σ', tau: 'τ', ups: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', ome: 'ω',
};
const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/**
 * HYG Bayer field ("Alp", "Kap-1", "Kap1", "p", "A") -> display form ("α", "κ¹", "p", "A").
 * Returns null when empty.
 */
export function bayerDisplay(bayer) {
  if (!bayer) return null;
  const m = /^([A-Za-z]+)[\s-]?(\d*)$/.exec(bayer.trim());
  if (!m) return bayer.trim();
  const g = GREEK[m[1].toLowerCase()];
  const letter = g ?? m[1];
  const sup = m[2] ? [...m[2]].map((d) => SUP[d]).join('') : '';
  return letter + sup;
}

/** "[Flamsteed] [Bayer] Con", e.g. "58 α Ori", "κ¹ Scl", "61 Cyg". null if neither designation exists. */
export function bayerFlamsteedDisplay(flam, bayer, con) {
  const b = bayerDisplay(bayer);
  if (flam == null && !b) return null;
  const parts = [];
  if (flam != null) parts.push(String(flam));
  if (b) parts.push(b);
  if (con) parts.push(con);
  return parts.join(' ');
}

/** Lower-case, diacritics-stripped comparison key for names. */
export function nameKey(s) {
  return String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[’'`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// ------------------------------------------------------------ precession ----

/** Precess an equatorial unit vector from epoch jd0 (TT-ish JD) to J2000.0 (IAU 1976 / Lieske 1977; Meeus ch. 21). */
export function precessToJ2000Fn(jd0) {
  const T = (jd0 - 2451545.0) / 36525; // epoch of the *given* coordinates, relative to J2000 (this is "t" with T=0 start)
  // From epoch jd0 (start, "T" = (jd0-J2000)/36525) to J2000 (t = -T).
  const t = -T;
  const AS = Math.PI / 648000;
  const zeta = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (0.30188 - 0.000344 * T) * t * t + 0.017998 * t * t * t) * AS;
  const z = ((2306.2181 + 1.39656 * T - 0.000139 * T * T) * t + (1.09468 + 0.000066 * T) * t * t + 0.018203 * t * t * t) * AS;
  const th = ((2004.3109 - 0.85330 * T - 0.000217 * T * T) * t - (0.42665 + 0.000217 * T) * t * t - 0.041833 * t * t * t) * AS;
  const [cz, sz, cth, sth, cze, sze] = [Math.cos(z), Math.sin(z), Math.cos(th), Math.sin(th), Math.cos(zeta), Math.sin(zeta)];
  const P = [
    [cze * cth * cz - sze * sz, -sze * cth * cz - cze * sz, -sth * cz],
    [cze * cth * sz + sze * cz, -sze * cth * sz + cze * cz, -sth * sz],
    [cze * sth, -sze * sth, cth],
  ];
  return (v) => [P[0][0] * v[0] + P[0][1] * v[1] + P[0][2] * v[2], P[1][0] * v[0] + P[1][1] * v[1] + P[1][2] * v[2], P[2][0] * v[0] + P[2][1] * v[1] + P[2][2] * v[2]];
}
