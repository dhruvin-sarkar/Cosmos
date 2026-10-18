/**
 * Named reference frames and explicit, tested conversions (docs/ARCHITECTURE.md §4.2).
 *
 * World frame: ICRS axes (≈ J2000 mean equator/equinox — the ~20 mas frame bias is below anything we
 * render), meters, origin at the Solar System barycenter. Every function here is pure. Vectors are any
 * `{ x, y, z }` object (a THREE.Vector3 works), written into `out` (which may alias the input) so that hot
 * paths stay allocation-free; this module has no rendering dependency.
 *
 * Matrices are row-major 3×3 (`m[3 * row + col]`) and map column vectors: v' = M · v.
 *
 * Earth orientation uses UT1 ≈ UTC (|UT1 − UTC| < 0.9 s ⇒ < 0.42 km along the equator) and neglects polar
 * motion (< ~15 m at the surface) — documented approximations, well below rendering needs.
 */
import { AstroTime, e_tilt, Rotation_EQD_EQJ, RotationAxis, SiderealTime, Body } from 'astronomy-engine';
import { DEG, RAD, SECONDS_PER_DAY, UNIX_MS_2000_01_01_12_UTC } from './units';

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Row-major 3×3 matrix (read-only view). */
export type Mat3 = ArrayLike<number>;

const TWO_PI = 2 * Math.PI;
const MS_PER_DAY = SECONDS_PER_DAY * 1000;

// ── Small matrix kit ───────────────────────────────────────────────────────────────────────

/** out = M · v (out may alias v). */
export function applyMat3<T extends Vec3>(m: Mat3, v: Vec3, out: T): T {
  const x = v.x, y = v.y, z = v.z;
  out.x = m[0] * x + m[1] * y + m[2] * z;
  out.y = m[3] * x + m[4] * y + m[5] * z;
  out.z = m[6] * x + m[7] * y + m[8] * z;
  return out;
}

/** out = Mᵀ · v — the inverse rotation for orthonormal M (out may alias v). */
export function applyMat3Transposed<T extends Vec3>(m: Mat3, v: Vec3, out: T): T {
  const x = v.x, y = v.y, z = v.z;
  out.x = m[0] * x + m[3] * y + m[6] * z;
  out.y = m[1] * x + m[4] * y + m[7] * z;
  out.z = m[2] * x + m[5] * y + m[8] * z;
  return out;
}

/** out = A · B (out must not alias A or B). */
export function multiplyMat3(a: Mat3, b: Mat3, out: Float64Array = new Float64Array(9)): Float64Array {
  for (let r = 0; r < 3; r++) {
    const a0 = a[3 * r], a1 = a[3 * r + 1], a2 = a[3 * r + 2];
    out[3 * r] = a0 * b[0] + a1 * b[3] + a2 * b[6];
    out[3 * r + 1] = a0 * b[1] + a1 * b[4] + a2 * b[7];
    out[3 * r + 2] = a0 * b[2] + a1 * b[5] + a2 * b[8];
  }
  return out;
}

export function transposeMat3(m: Mat3, out: Float64Array = new Float64Array(9)): Float64Array {
  const t1 = m[1], t2 = m[2], t5 = m[5];
  out[0] = m[0]; out[4] = m[4]; out[8] = m[8];
  out[1] = m[3]; out[3] = t1;
  out[2] = m[6]; out[6] = t2;
  out[5] = m[7]; out[7] = t5;
  return out;
}

function frozenMat3(values: ArrayLike<number>): Mat3 {
  return Object.freeze(Array.from(values));
}

// ── Spherical coordinates ──────────────────────────────────────────────────────────────────

export interface RaDecDist {
  /** Right ascension, degrees in [0, 360). */
  raDeg: number;
  /** Declination, degrees in [−90, 90]. */
  decDeg: number;
  /** Distance in the input vector's unit (meters for world vectors). */
  distM: number;
}

/** Generic spherical → Cartesian: longitude/latitude (deg) and radius. */
export function sphericalToVector<T extends Vec3>(lonDeg: number, latDeg: number, radius: number, out: T): T {
  const lon = lonDeg * DEG, lat = latDeg * DEG;
  const c = Math.cos(lat);
  out.x = radius * c * Math.cos(lon);
  out.y = radius * c * Math.sin(lon);
  out.z = radius * Math.sin(lat);
  return out;
}

/** Equatorial (RA, Dec, distance) → ICRS Cartesian. */
export function raDecDistToIcrs<T extends Vec3>(raDeg: number, decDeg: number, distM: number, out: T): T {
  return sphericalToVector(raDeg, decDeg, distM, out);
}

/** ICRS Cartesian → (RA, Dec, distance). A zero vector yields RA = Dec = 0. */
export function icrsToRaDec(v: Vec3, out: RaDecDist = { raDeg: 0, decDeg: 0, distM: 0 }): RaDecDist {
  const rxy = Math.hypot(v.x, v.y);
  const r = Math.hypot(rxy, v.z);
  let ra = Math.atan2(v.y, v.x) * RAD;
  if (ra < 0) ra += 360;
  out.raDeg = r === 0 ? 0 : ra;
  out.decDeg = r === 0 ? 0 : Math.atan2(v.z, rxy) * RAD;
  out.distM = r;
  return out;
}

// ── Ecliptic J2000 ─────────────────────────────────────────────────────────────────────────

/** Mean obliquity of the ecliptic at J2000.0 (IAU 2006: 84381.406″). */
export const OBLIQUITY_J2000_DEG = 23.4392911;
const COS_EPS = Math.cos(OBLIQUITY_J2000_DEG * DEG);
const SIN_EPS = Math.sin(OBLIQUITY_J2000_DEG * DEG);

/** Ecliptic J2000 → ICRS (rotation about +x by ε₀). */
export function eclipticToIcrs<T extends Vec3>(v: Vec3, out: T): T {
  const y = v.y, z = v.z;
  out.x = v.x;
  out.y = COS_EPS * y - SIN_EPS * z;
  out.z = SIN_EPS * y + COS_EPS * z;
  return out;
}

/** ICRS → ecliptic J2000. */
export function icrsToEcliptic<T extends Vec3>(v: Vec3, out: T): T {
  const y = v.y, z = v.z;
  out.x = v.x;
  out.y = COS_EPS * y + SIN_EPS * z;
  out.z = -SIN_EPS * y + COS_EPS * z;
  return out;
}

/** Unit vector of the north ecliptic pole in ICRS. */
export const ECLIPTIC_NORTH_POLE_ICRS: Readonly<Vec3> = Object.freeze({ x: 0, y: -SIN_EPS, z: COS_EPS });

// ── Galactic & supergalactic ───────────────────────────────────────────────────────────────

/**
 * ICRS → Galactic rotation (Hipparcos Catalogue, ESA 1997, Vol. 1 §1.5.3, matrix A_Gᵀ). Rows are the
 * galactic x (toward l = 0, b = 0), y (l = 90°) and z (north galactic pole) axes expressed in ICRS.
 */
export const ICRS_TO_GALACTIC: Mat3 = frozenMat3([
  -0.0548755604162154, -0.8734370902348850, -0.4838350155487132,
  +0.4941094278755837, -0.4448296299600112, +0.7469822444972189,
  -0.8676661490190047, -0.1980763734312015, +0.4559837761750669,
]);
export const GALACTIC_TO_ICRS: Mat3 = frozenMat3(transposeMat3(ICRS_TO_GALACTIC));

/** Direction of the Galactic Center (l = b = 0) in ICRS (RA ≈ 266.405°, Dec ≈ −28.936°). */
export const GALACTIC_CENTER_DIRECTION_ICRS: Readonly<Vec3> = Object.freeze({
  x: ICRS_TO_GALACTIC[0], y: ICRS_TO_GALACTIC[1], z: ICRS_TO_GALACTIC[2],
});
/** North galactic pole in ICRS (RA ≈ 192.859°, Dec ≈ +27.128°). */
export const GALACTIC_NORTH_POLE_ICRS: Readonly<Vec3> = Object.freeze({
  x: ICRS_TO_GALACTIC[6], y: ICRS_TO_GALACTIC[7], z: ICRS_TO_GALACTIC[8],
});

export function icrsToGalactic<T extends Vec3>(v: Vec3, out: T): T {
  return applyMat3(ICRS_TO_GALACTIC, v, out);
}

export function galacticToIcrs<T extends Vec3>(v: Vec3, out: T): T {
  return applyMat3Transposed(ICRS_TO_GALACTIC, v, out);
}

/**
 * Galactic → supergalactic (de Vaucouleurs et al. 1976, RC2): the north supergalactic pole lies at
 * (l, b) = (47.37°, +6.32°) and SGL = 0 at (l, b) = (137.37°, 0°). Rows are the SG axes in galactic axes.
 */
export const GALACTIC_TO_SUPERGALACTIC: Mat3 = (() => {
  const x = sphericalToVector(137.37, 0, 1, { x: 0, y: 0, z: 0 });
  const z = sphericalToVector(47.37, 6.32, 1, { x: 0, y: 0, z: 0 });
  const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  return frozenMat3([x.x, x.y, x.z, y.x, y.y, y.z, z.x, z.y, z.z]);
})();

export function galacticToSupergalactic<T extends Vec3>(v: Vec3, out: T): T {
  return applyMat3(GALACTIC_TO_SUPERGALACTIC, v, out);
}

export function supergalacticToGalactic<T extends Vec3>(v: Vec3, out: T): T {
  return applyMat3Transposed(GALACTIC_TO_SUPERGALACTIC, v, out);
}

// ── Time & Earth rotation ──────────────────────────────────────────────────────────────────

/** UT days since J2000.0 (2000-01-01T12:00 UTC) for a Unix ms timestamp. */
export function utDaysSinceJ2000(tMs: number): number {
  return (tMs - UNIX_MS_2000_01_01_12_UTC) / MS_PER_DAY;
}

/** astronomy-engine time object for a Unix ms timestamp (allocates; not for per-object hot loops). */
export function astroTime(tMs: number): AstroTime {
  return new AstroTime(utDaysSinceJ2000(tMs));
}

function wrapTwoPi(rad: number): number {
  const r = rad % TWO_PI;
  return r < 0 ? r + TWO_PI : r;
}

/** Earth Rotation Angle (IERS Conventions 2010, eq. 5.15), radians in [0, 2π). */
export function earthRotationAngleRad(tMs: number): number {
  const du = utDaysSinceJ2000(tMs);
  const turns = 0.7790572732640 + 0.00273781191135448 * du + (du % 1);
  return wrapTwoPi(turns * TWO_PI);
}

/** Equation of the equinoxes Δψ·cos ε (astronomy-engine IAU 2000B nutation), radians. */
export function equationOfEquinoxesRad(tMs: number): number {
  return e_tilt(astroTime(tMs)).ee * 15 * (DEG / 3600);
}

/** Greenwich apparent sidereal time (astronomy-engine SiderealTime), radians in [0, 2π). */
export function gastRad(tMs: number): number {
  return wrapTwoPi(SiderealTime(astroTime(tMs)) * 15 * DEG);
}

/** Greenwich mean sidereal time = GAST − equation of the equinoxes, radians in [0, 2π). */
export function gmstRad(tMs: number): number {
  const t = astroTime(tMs);
  return wrapTwoPi(SiderealTime(t) * 15 * DEG - e_tilt(t).ee * 15 * (DEG / 3600));
}

/** Row-major copy of astronomy-engine's equator-of-date → J2000 rotation (its `rot[j][i]` is our M[i][j]). */
function eqdToEqjInto(time: AstroTime, out: Float64Array): Float64Array {
  const r = Rotation_EQD_EQJ(time).rot;
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) out[3 * i + j] = r[j][i];
  return out;
}

/** out = M · Rz(θ) for an active rotation Rz about +z (out must not alias M). */
function mulRz(m: Mat3, theta: number, out: Float64Array): Float64Array {
  const c = Math.cos(theta), s = Math.sin(theta);
  for (let i = 0; i < 3; i++) {
    const a0 = m[3 * i], a1 = m[3 * i + 1];
    out[3 * i] = a0 * c + a1 * s;
    out[3 * i + 1] = -a0 * s + a1 * c;
    out[3 * i + 2] = m[3 * i + 2];
  }
  return out;
}

const scratchEqd = new Float64Array(9);

/**
 * TEME (SGP4 output frame: true equator, mean equinox of date) → ICRS rotation at time t.
 * TEME → true-of-date is a rotation by the equation of the equinoxes about +z (Vallado et al. 2006,
 * "Revisiting Spacetrack Report #3"); true-of-date → J2000 uses astronomy-engine's precession–nutation.
 */
export function temeToIcrsMatrix(tMs: number, out: Float64Array = new Float64Array(9)): Float64Array {
  const time = astroTime(tMs);
  const ee = e_tilt(time).ee * 15 * (DEG / 3600);
  return mulRz(eqdToEqjInto(time, scratchEqd), ee, out);
}

const temeCache = { tMs: Number.NaN, m: new Float64Array(9) };

/** TEME → ICRS for one vector (units preserved, e.g. km in → km out). Repeated calls at the same t reuse the matrix. */
export function temeToIcrs<T extends Vec3>(tMs: number, teme: Vec3, out: T): T {
  if (temeCache.tMs !== tMs) {
    temeToIcrsMatrix(tMs, temeCache.m);
    temeCache.tMs = tMs;
  }
  return applyMat3(temeCache.m, teme, out);
}

// ── Geodetic / ECEF (WGS 84) ───────────────────────────────────────────────────────────────

export const WGS84_A_M = 6_378_137.0;
export const WGS84_F = 1 / 298.257223563;
export const WGS84_B_M = WGS84_A_M * (1 - WGS84_F);
export const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export interface Geodetic {
  latDeg: number;
  lonDeg: number;
  heightM: number;
}

/** WGS 84 geodetic latitude/longitude (deg) and ellipsoidal height (m) → ECEF (ITRF) meters. */
export function geodeticToEcef<T extends Vec3>(latDeg: number, lonDeg: number, heightM: number, out: T): T {
  const lat = latDeg * DEG, lon = lonDeg * DEG;
  const sLat = Math.sin(lat), cLat = Math.cos(lat);
  const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sLat * sLat);
  out.x = (n + heightM) * cLat * Math.cos(lon);
  out.y = (n + heightM) * cLat * Math.sin(lon);
  out.z = (n * (1 - WGS84_E2) + heightM) * sLat;
  return out;
}

/** ECEF meters → WGS 84 geodetic (Bowring's iteration; sub-millimetre after a few steps). */
export function ecefToGeodetic(v: Vec3, out: Geodetic = { latDeg: 0, lonDeg: 0, heightM: 0 }): Geodetic {
  const p = Math.hypot(v.x, v.y);
  const lon = Math.atan2(v.y, v.x);
  if (p < 1e-9) {
    out.latDeg = v.z >= 0 ? 90 : -90;
    out.lonDeg = 0;
    out.heightM = Math.abs(v.z) - WGS84_B_M;
    return out;
  }
  let lat = Math.atan2(v.z, p * (1 - WGS84_E2));
  let height = 0;
  for (let i = 0; i < 6; i++) {
    const s = Math.sin(lat);
    const n = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * s * s);
    height = p / Math.cos(lat) - n;
    lat = Math.atan2(v.z, p * (1 - WGS84_E2 * (n / (n + height))));
  }
  out.latDeg = lat * RAD;
  out.lonDeg = lon * RAD;
  out.heightM = height;
  return out;
}

/** ECEF (ITRF, no polar motion) → ICRS rotation at time t: true-of-date = Rz(GAST) · ECEF, then EQD → EQJ. */
export function ecefToIcrsMatrix(tMs: number, out: Float64Array = new Float64Array(9)): Float64Array {
  const time = astroTime(tMs);
  return mulRz(eqdToEqjInto(time, scratchEqd), SiderealTime(time) * 15 * DEG, out);
}

const ecefCache = { tMs: Number.NaN, m: new Float64Array(9) };

function ecefMatrixCached(tMs: number): Float64Array {
  if (ecefCache.tMs !== tMs) {
    ecefToIcrsMatrix(tMs, ecefCache.m);
    ecefCache.tMs = tMs;
  }
  return ecefCache.m;
}

/** Earth-fixed vector → ICRS axes (rotation only; add Earth's world position for absolute coordinates). */
export function ecefToIcrs<T extends Vec3>(tMs: number, ecef: Vec3, out: T): T {
  return applyMat3(ecefMatrixCached(tMs), ecef, out);
}

export function icrsToEcef<T extends Vec3>(tMs: number, icrs: Vec3, out: T): T {
  return applyMat3Transposed(ecefMatrixCached(tMs), icrs, out);
}

// ── Body-fixed frames (IAU WGCCRE rotational elements) ─────────────────────────────────────

/**
 * Body-fixed → ICRS rotation from IAU rotational elements: north pole (α₀, δ₀) and prime-meridian angle W
 * (all degrees). M = Rz(90° + α₀) · Rx(90° − δ₀) · Rz(W) (active rotations; Archinal et al. 2011, eq. 1).
 * Body-fixed +z is the north pole and +x the prime meridian on the equator.
 */
export function bodyFixedToIcrsMatrix(
  poleRaDeg: number,
  poleDecDeg: number,
  wDeg: number,
  out: Float64Array = new Float64Array(9),
): Float64Array {
  const a = (90 + poleRaDeg) * DEG;
  const b = (90 - poleDecDeg) * DEG;
  const w = wDeg * DEG;
  const cA = Math.cos(a), sA = Math.sin(a);
  const cB = Math.cos(b), sB = Math.sin(b);
  const cW = Math.cos(w), sW = Math.sin(w);
  out[0] = cA * cW - sA * cB * sW; out[1] = -cA * sW - sA * cB * cW; out[2] = sA * sB;
  out[3] = sA * cW + cA * cB * sW; out[4] = -sA * sW + cA * cB * cW; out[5] = -cA * sB;
  out[6] = sB * sW;                out[7] = sB * cW;                 out[8] = cB;
  return out;
}

const scratchBodyFixed = new Float64Array(9);

export function bodyFixedToIcrs<T extends Vec3>(poleRaDeg: number, poleDecDeg: number, wDeg: number, v: Vec3, out: T): T {
  return applyMat3(bodyFixedToIcrsMatrix(poleRaDeg, poleDecDeg, wDeg, scratchBodyFixed), v, out);
}

export type SolarSystemBodyName =
  | 'Sun' | 'Mercury' | 'Venus' | 'Earth' | 'Moon' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';

const BODY_ENUM: Readonly<Record<SolarSystemBodyName, Body>> = {
  Sun: Body.Sun, Mercury: Body.Mercury, Venus: Body.Venus, Earth: Body.Earth, Moon: Body.Moon, Mars: Body.Mars,
  Jupiter: Body.Jupiter, Saturn: Body.Saturn, Uranus: Body.Uranus, Neptune: Body.Neptune, Pluto: Body.Pluto,
};

export interface RotationElements {
  /** J2000 right ascension of the north pole, degrees. */
  poleRaDeg: number;
  /** J2000 declination of the north pole, degrees. */
  poleDecDeg: number;
  /** Prime-meridian angle W, degrees. */
  wDeg: number;
}

const scratchEarth = new Float64Array(9);

/**
 * Earth's elements derived from the precise ECEF → ICRS rotation, so that
 * bodyFixedToIcrsMatrix(elements) reproduces ecefToIcrsMatrix(t) exactly. (astronomy-engine's Earth `spin`
 * is not consistent with GAST-based Earth orientation at the ~0.3° level, so it is not used here.)
 */
function earthRotationElements(tMs: number, out: RotationElements): RotationElements {
  const m = ecefToIcrsMatrix(tMs, scratchEarth);
  const ra = Math.atan2(m[5], m[2]);
  const dec = Math.asin(Math.max(-1, Math.min(1, m[8])));
  const a = Math.PI / 2 + ra, b = Math.PI / 2 - dec;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b);
  const u0 = cA * m[0] + sA * m[3];
  const u1 = -sA * m[0] + cA * m[3];
  const u2 = m[6];
  let w = Math.atan2(cB * u1 + sB * u2, u0) * RAD;
  if (w < 0) w += 360;
  out.poleRaDeg = ra < 0 ? ra * RAD + 360 : ra * RAD;
  out.poleDecDeg = dec * RAD;
  out.wDeg = w;
  return out;
}

/**
 * IAU WGCCRE rotational elements of a Solar System body at time t (astronomy-engine RotationAxis; Earth from
 * the precession–nutation + GAST model used by ecefToIcrs).
 */
export function bodyRotationElements(
  body: SolarSystemBodyName,
  tMs: number,
  out: RotationElements = { poleRaDeg: 0, poleDecDeg: 0, wDeg: 0 },
): RotationElements {
  if (body === 'Earth') return earthRotationElements(tMs, out);
  const axis = RotationAxis(BODY_ENUM[body], astroTime(tMs));
  out.poleRaDeg = axis.ra * 15;
  out.poleDecDeg = axis.dec;
  out.wDeg = axis.spin;
  return out;
}

/** Body-fixed → ICRS rotation matrix of a Solar System body at time t. */
export function bodyFixedToIcrsMatrixForBody(
  body: SolarSystemBodyName,
  tMs: number,
  out: Float64Array = new Float64Array(9),
): Float64Array {
  if (body === 'Earth') return ecefToIcrsMatrix(tMs, out);
  const e = bodyRotationElements(body, tMs, scratchElements);
  return bodyFixedToIcrsMatrix(e.poleRaDeg, e.poleDecDeg, e.wDeg, out);
}

/** Unit vector of a Solar System body's north rotational pole in ICRS at time t. */
export function bodyPoleIcrs<T extends Vec3>(body: SolarSystemBodyName, tMs: number, out: T): T {
  const n = RotationAxis(BODY_ENUM[body], astroTime(tMs)).north;
  out.x = n.x;
  out.y = n.y;
  out.z = n.z;
  return out;
}

const scratchElements: RotationElements = { poleRaDeg: 0, poleDecDeg: 0, wDeg: 0 };
const scratchBodyMatrix = new Float64Array(9);

/** Body-fixed vector of a Solar System body → ICRS axes at time t. */
export function bodyFixedToIcrsForBody<T extends Vec3>(body: SolarSystemBodyName, tMs: number, v: Vec3, out: T): T {
  return applyMat3(bodyFixedToIcrsMatrixForBody(body, tMs, scratchBodyMatrix), v, out);
}
