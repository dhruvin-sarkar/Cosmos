/**
 * Solar-domain ephemeris and orientation.
 *
 * Positions: barycentric ICRS (EQJ) metres, the same frame and origin as every other domain.
 *  - Sun, planets and Pluto: astronomy-engine BaryState (VSOP87 / Pluto integrator). To keep the frame loop free
 *    of allocations, each body is evaluated on a time grid (cell = period / 400) and cubic-Hermite interpolated
 *    from the positions and velocities at the two cell ends; the interpolation error is < 1e-9 of the orbit
 *    radius (≈ 6 km for Mercury, < 1 km elsewhere). At real-time rate a body is re-evaluated a few times a day.
 *  - Ceres, Eris, Haumea, Makemake: two-body Kepler motion from SBDB osculating elements (J2000 ecliptic,
 *    heliocentric) added to the Sun's barycentric position.
 * Orientation: IAU WGCCRE 2015 (NAIF pck00011) pole and prime meridian, linear in time plus Neptune's periodic
 * terms and Mars' long-period terms, evaluated in TDB ≈ UTC + 69.184 s.
 *
 * Also exports the helpers other domains use for lighting: sunDirectionAt(), solarIrradianceAt() (W/m²),
 * solarSceneIrradianceAt() (scene-linear, including the shared exposure gain).
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { AU_M, DEG, GM_SUN, JD_UNIX_EPOCH, L_SUN_W, SECONDS_PER_DAY } from '../../core/units';
import { elementsToState, type KeplerElements } from '../../science/orbits';
import { OBLIQUITY_J2000_RAD, SOLAR_BODIES, type RotationModel, type SolarBodyDef } from './constants';

/** TT − UTC (TAI − UTC = 37 s since 2017, + 32.184 s); TDB − TT < 2 ms is ignored. */
export const TT_MINUS_UTC_S = 69.184;
const AU_PER_DAY_TO_M_S = AU_M / SECONDS_PER_DAY;

/** Days from J2000.0 TDB for Unix ms UTC. */
export function daysSinceJ2000Tdb(tMs: number): number {
  return (tMs + TT_MINUS_UTC_S * 1000) / 86_400_000 + JD_UNIX_EPOCH - 2_451_545.0;
}

// ── Hermite-cached astronomy-engine states ─────────────────────────────────────────────────────────

interface Cell {
  t0: number;
  t1: number;
  /** x y z vx vy vz at t0 then at t1 (m, m/s). */
  s: Float64Array;
}

const cells = new Map<string, Cell>();
const cellMs = new Map<string, number>();

function evalState(body: NonNullable<SolarBodyDef['aeBody']>, tMs: number, out: Float64Array, o: number): void {
  const st = Astronomy.BaryState(Astronomy.Body[body], Astronomy.MakeTime(new Date(tMs)));
  out[o] = st.x * AU_M;
  out[o + 1] = st.y * AU_M;
  out[o + 2] = st.z * AU_M;
  out[o + 3] = st.vx * AU_PER_DAY_TO_M_S;
  out[o + 4] = st.vy * AU_PER_DAY_TO_M_S;
  out[o + 5] = st.vz * AU_PER_DAY_TO_M_S;
}

function cellFor(def: SolarBodyDef, tMs: number): Cell {
  const body = def.aeBody!;
  let c = cells.get(def.id);
  let w = cellMs.get(def.id);
  if (w === undefined) {
    // The Sun's barycentric wobble is dominated by Jupiter (11.9 yr): a 4-day cell is far below 1 m error.
    w = def.id === 'sol:sun' ? 4 * 86_400_000 : Math.min(def.periodDays / 400, 10) * 86_400_000;
    cellMs.set(def.id, w);
  }
  if (c && tMs >= c.t0 && tMs <= c.t1) return c;
  const t0 = Math.floor(tMs / w) * w;
  const t1 = t0 + w;
  if (!c) {
    c = { t0: Number.NaN, t1: Number.NaN, s: new Float64Array(12) };
    cells.set(def.id, c);
  }
  if (c.t1 === t0) {
    c.s.copyWithin(0, 6, 12); // slide forward one cell
    evalState(body, t1, c.s, 6);
  } else if (c.t0 === t1) {
    c.s.copyWithin(6, 0, 6); // slide backward one cell
    evalState(body, t0, c.s, 0);
  } else {
    evalState(body, t0, c.s, 0);
    evalState(body, t1, c.s, 6);
  }
  c.t0 = t0;
  c.t1 = t1;
  return c;
}

/** Cubic Hermite interpolation of position (and optionally velocity) inside a cell. */
function hermite(c: Cell, tMs: number, out: THREE.Vector3, vel: THREE.Vector3 | null): void {
  const h = (c.t1 - c.t0) / 1000;
  const u = (tMs - c.t0) / (c.t1 - c.t0);
  const u2 = u * u, u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1, h10 = u3 - 2 * u2 + u, h01 = -2 * u3 + 3 * u2, h11 = u3 - u2;
  const s = c.s;
  out.set(
    h00 * s[0] + h10 * h * s[3] + h01 * s[6] + h11 * h * s[9],
    h00 * s[1] + h10 * h * s[4] + h01 * s[7] + h11 * h * s[10],
    h00 * s[2] + h10 * h * s[5] + h01 * s[8] + h11 * h * s[11],
  );
  if (vel) {
    const d00 = (6 * u2 - 6 * u) / h, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / h, d11 = 3 * u2 - 2 * u;
    vel.set(
      d00 * s[0] + d10 * s[3] + d01 * s[6] + d11 * s[9],
      d00 * s[1] + d10 * s[4] + d01 * s[7] + d11 * s[10],
      d00 * s[2] + d10 * s[5] + d01 * s[8] + d11 * s[11],
    );
  }
}

// ── Kepler bodies ──────────────────────────────────────────────────────────────────────────────────

const keplerScratch = new Float64Array(6);
const keplerEl: KeplerElements = { semiMajorAxisM: 1, eccentricity: 0, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 };
const cosE = Math.cos(OBLIQUITY_J2000_RAD);
const sinE = Math.sin(OBLIQUITY_J2000_RAD);
const sunScratch = new THREE.Vector3();
const sunVelScratch = new THREE.Vector3();

/** Heliocentric J2000-ecliptic Kepler state rotated to EQJ; writes x y z vx vy vz (m, m/s) into keplerScratch. */
function keplerHelioEqj(def: SolarBodyDef, tMs: number): Float64Array {
  const el = def.elements!;
  const a = el.aAu * AU_M;
  const n = Math.sqrt(GM_SUN / (a * a * a)); // rad/s
  const dtS = (daysSinceJ2000Tdb(tMs) + 2_451_545.0 - el.epochJd) * SECONDS_PER_DAY;
  keplerEl.semiMajorAxisM = a;
  keplerEl.eccentricity = el.e;
  keplerEl.inclinationRad = el.iDeg * DEG;
  keplerEl.raanRad = el.nodeDeg * DEG;
  keplerEl.argPeriapsisRad = el.argPeriDeg * DEG;
  keplerEl.meanAnomalyRad = el.meanAnomalyDeg * DEG + n * dtS;
  const s = elementsToState(keplerEl, GM_SUN, keplerScratch, 0);
  for (let k = 0; k < 6; k += 3) {
    const y = s[k + 1], z = s[k + 2];
    s[k + 1] = cosE * y - sinE * z;
    s[k + 2] = sinE * y + cosE * z;
  }
  return s;
}

const SUN_DEF = SOLAR_BODIES[0];

/** Barycentric ICRS position (m) of a solar-domain body at Unix ms `tMs`. Allocation-free. */
export function bodyPosition(def: SolarBodyDef, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  if (def.aeBody) {
    hermite(cellFor(def, tMs), tMs, out, null);
    return out;
  }
  const s = keplerHelioEqj(def, tMs);
  hermite(cellFor(SUN_DEF, tMs), tMs, sunScratch, null);
  return out.set(sunScratch.x + s[0], sunScratch.y + s[1], sunScratch.z + s[2]);
}

/** Barycentric ICRS velocity (m/s). Allocation-free. */
export function bodyVelocity(def: SolarBodyDef, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  if (def.aeBody) {
    hermite(cellFor(def, tMs), tMs, sunScratch, out);
    return out;
  }
  const s = keplerHelioEqj(def, tMs);
  hermite(cellFor(SUN_DEF, tMs), tMs, sunScratch, sunVelScratch);
  return out.set(sunVelScratch.x + s[3], sunVelScratch.y + s[4], sunVelScratch.z + s[5]);
}

/** Barycentric ICRS position of the Sun (m). */
export function sunPosition(tMs: number, out: THREE.Vector3): THREE.Vector3 {
  return bodyPosition(SUN_DEF, tMs, out);
}

// ── Lighting helpers for every domain ──────────────────────────────────────────────────────────────

/** Solar irradiance at 1 au, W/m² (TSI, Kopp & Lean 2011). */
export const SOLAR_CONSTANT_W_M2 = 1361;

/**
 * Scene-linear irradiance of sunlight at 1 au (with the exposure gain at 1). A white Lambertian surface facing
 * the Sun has radiance E/π ≈ 1.6 — just above AgX display white, so only bright ice and specular glints bloom.
 */
export const SUN_SCENE_IRRADIANCE_1AU = 5;

const sunDirScratch = new THREE.Vector3();

/**
 * Unit vector from `pointIcrsM` (barycentric ICRS metres) toward the Sun's centre at `tMs`, written into `out`.
 * Light-time is ignored (the Sun is effectively static over minutes).
 */
export function sunDirectionAt(pointIcrsM: THREE.Vector3, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  sunPosition(tMs, sunDirScratch);
  return out.subVectors(sunDirScratch, pointIcrsM).normalize();
}

/** Distance (m) from a point to the Sun's centre. */
export function sunDistanceAt(pointIcrsM: THREE.Vector3, tMs: number): number {
  sunPosition(tMs, sunDirScratch);
  return sunDirScratch.distanceTo(pointIcrsM);
}

/** Solar irradiance at the point, W/m² (inverse square of the distance to the Sun's centre; L☉ / 4πd²). */
export function solarIrradianceAt(pointIcrsM: THREE.Vector3, tMs: number): number {
  const d = Math.max(sunDistanceAt(pointIcrsM, tMs), 7e8);
  return L_SUN_W / (4 * Math.PI * d * d);
}

/** Angular radius of the Sun seen from the point, radians. */
export function sunAngularRadiusAt(pointIcrsM: THREE.Vector3, tMs: number): number {
  const d = Math.max(sunDistanceAt(pointIcrsM, tMs), 7e8);
  return Math.asin(Math.min(1, 6.957e8 / d));
}

/**
 * Shared exposure gain (camera-like): the solar layer adapts it each frame so that the body in focus is exposed
 * as a body at 1 au would be — Neptune is lit by 1/900 of Earth's sunlight, a camera there exposes 900× longer.
 * Relative brightness between bodies in one view stays physical. Other domains multiply their sunlight by it
 * (solarSceneIrradianceAt does this for you).
 */
export const exposureState = { gain: 1, targetGain: 1 };

/**
 * EXHIBITION-SCALE display gain for an enlarged disc (disclosed with the enlargement: 'Enlarged for visibility'). In a
 * system overview exposed for the Sun, an outer planet's true surface brightness (∝ 1/r²) renders black; strongly
 * enlarged discs get part of that falloff back (Neptune ≈ 1/4 of Earth's surface brightness instead of 1/900). The gain
 * fades to exactly 1 as the body approaches true size (factor → 1), so close-ups and true-scale mode stay photometric.
 */
export function exhibitionDisplayGain(enlarge: number, sunDistanceM: number): number {
  if (!(enlarge > 1.5)) return 1;
  const r2 = (sunDistanceM / AU_M) ** 2;
  const rel = r2 / Math.max(exposureState.gain, 1e-6);
  const t = Math.min(Math.max((enlarge - 1.5) / 18.5, 0), 1);
  const w = t * t * (3 - 2 * t);
  if (rel < 1) {
    // Inner planets in an overview: Mercury gets 6.7× and Venus 1.9× Earth's sunlight, so strongly enlarged discs blow
    // out to flat white. Give back part of that excess and scale the drawn albedo by 0.6 (Venus still outshines Earth).
    // Continuous at rel = 1 (Earth-distance bodies keep their gain of 1).
    const s = Math.min(Math.max((1 - rel) / 0.5, 0), 1);
    return Math.pow(rel, 0.5 * w) * (1 - 0.4 * w * s * s * (3 - 2 * s));
  }
  const lost = Math.min(rel, 2500);
  return Math.pow(lost, 0.8 * w);
}

/** Scene-linear sunlight irradiance at a point, including the exposure gain. Use as the Sun intensity uniform. */
export function solarSceneIrradianceAt(pointIcrsM: THREE.Vector3, tMs: number): number {
  const d = Math.max(sunDistanceAt(pointIcrsM, tMs), 7e8);
  const r = AU_M / d;
  return SUN_SCENE_IRRADIANCE_1AU * r * r * exposureState.gain;
}

// ── Orientation ───────────────────────────────────────────────────────────────────────────────────

/** IAU pole RA/Dec (deg) and prime-meridian angle W (deg) at `tMs`. */
export function rotationElements(rot: RotationModel, tMs: number, out: { ra: number; dec: number; w: number }): typeof out {
  const d = daysSinceJ2000Tdb(tMs);
  const T = d / 36_525;
  let ra = rot.ra0 + rot.raRate * T;
  let dec = rot.dec0 + rot.decRate * T;
  let w = rot.w0 + rot.wDot * d;
  if (rot.neptuneTerms) {
    const N = (357.85 + 52.316 * T) * DEG;
    ra += 0.7 * Math.sin(N);
    dec -= 0.51 * Math.cos(N);
    w -= 0.48 * Math.sin(N);
  }
  if (rot.marsTerms) {
    const M = 0.5042615 * T;
    ra += 0.419057 * Math.sin((79.398797 + M) * DEG);
    dec += 1.591274 * Math.cos((166.325722 + M) * DEG);
    w += 0.584542 * Math.sin((95.391654 + M) * DEG);
  }
  out.ra = ra;
  out.dec = dec;
  out.w = ((w % 360) + 360) % 360;
  return out;
}

const rotScratch = { ra: 0, dec: 0, w: 0 };
const mScratch = new THREE.Matrix4();

/**
 * Body-fixed → ICRS rotation as a quaternion: local +Z = north pole, local +X = prime meridian (longitude 0),
 * local +Y = 90° E. Allocation-free.
 */
export function bodyOrientation(rot: RotationModel, tMs: number, out: THREE.Quaternion): THREE.Quaternion {
  const r = rotationElements(rot, tMs, rotScratch);
  const ra = r.ra * DEG, dec = r.dec * DEG, w = r.w * DEG;
  const cd = Math.cos(dec);
  const px = cd * Math.cos(ra), py = cd * Math.sin(ra), pz = Math.sin(dec);
  // Ascending node of the body equator on the ICRS equator: N = ẑ × p̂ (RA = ra + 90°).
  const nx = -Math.sin(ra), ny = Math.cos(ra);
  // Q = p × N (90° east of the node along the body equator).
  const qx = -pz * ny, qy = pz * nx, qz = px * ny - py * nx;
  const cw = Math.cos(w), sw = Math.sin(w);
  const xx = cw * nx + sw * qx, xy = cw * ny + sw * qy, xz = sw * qz;
  // Y = Z × X
  const yx = py * xz - pz * xy, yy = pz * xx - px * xz, yz = px * xy - py * xx;
  mScratch.set(xx, yx, px, 0, xy, yy, py, 0, xz, yz, pz, 0, 0, 0, 0, 1);
  return out.setFromRotationMatrix(mScratch);
}

/** Unit north-pole vector (ICRS) at `tMs`. */
export function bodyNorthPole(rot: RotationModel, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  const r = rotationElements(rot, tMs, rotScratch);
  const ra = r.ra * DEG, dec = r.dec * DEG;
  return out.set(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec));
}
