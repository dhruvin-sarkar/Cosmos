/**
 * Moon ephemerides and orientation (ICRS axes, metres, relative to the parent planet).
 *
 * - Galilean moons: astronomy-engine JupiterMoons (L1.2 theory, ~arcminute), relative to Jupiter.
 * - All others: JPL mean elements. The mean longitude advances at the published sidereal rate (JPL's P is anomalistic for some moons);
 *   ω and Ω precess with the tabulated periods, so M = λ − ω − Ω. Plane frames follow JPL: node measured from the intersection of the reference plane
 *   with the ICRF equator (Laplace / planet-equator planes: pole RA/Dec) or from the vernal equinox (ecliptic).
 *   Mean elements are for orbit lines and plausible positions, not precise ones.
 * - Orientation: IAU WGCCRE 2015 elements (pole + prime meridian incl. periodic terms) where they exist, otherwise an
 *   explicitly illustrative spin model.
 */
import * as Astronomy from 'astronomy-engine';
import { Vector3 } from 'three';
import { bodyFixedToIcrsMatrix, OBLIQUITY_J2000_DEG } from '../../core/frames';
import { AU_M } from '../../core/units';
import { APSIS_RETROGRADE, MOON_LOOKS, MOON_RECORDS, SATURN_MEAN_ELEMENTS, SIDEREAL_DAYS, type MeanElementFit, type MoonRecord, type ParentKey } from './data';

const DEG = Math.PI / 180;
const TWO_PI = 2 * Math.PI;
const DAY_MS = 86_400_000;
const YEAR_DAYS = 365.25;
const GALILEAN = new Set(['io', 'europa', 'ganymede', 'callisto']);

export const PARENT_BODY: Record<ParentKey, Astronomy.Body> = {
  mars: Astronomy.Body.Mars,
  jupiter: Astronomy.Body.Jupiter,
  saturn: Astronomy.Body.Saturn,
  uranus: Astronomy.Body.Uranus,
  neptune: Astronomy.Body.Neptune,
  pluto: Astronomy.Body.Pluto,
};

/** J2000 spin poles of the primaries (RA, Dec deg; IAU WGCCRE 2015), for 'equatorial' reference planes. */
const PRIMARY_POLE: Record<ParentKey, [number, number]> = {
  mars: [317.269202, 54.432516],
  jupiter: [268.056595, 64.495303],
  saturn: [40.589, 83.537],
  // Uranus' SPIN pole (the moons orbit prograde about it); the IAU 'north' pole (257.311, -15.175) is its antipode.
  uranus: [77.311, 15.175],
  neptune: [299.36, 43.46],
  pluto: [132.993, -6.163],
};

export function julianDate(tMs: number): number {
  return tMs / DAY_MS + 2440587.5;
}

/** Solve Kepler's equation for the eccentric anomaly (Newton, converges in < 8 steps for e < 0.8). */
export function solveKepler(M: number, e: number): number {
  let m = M % TWO_PI;
  if (m > Math.PI) m -= TWO_PI;
  else if (m < -Math.PI) m += TWO_PI;
  let E = e < 0.8 ? m + e * Math.sin(m) : Math.PI * Math.sign(m || 1);
  for (let i = 0; i < 12; i++) {
    const f = E - e * Math.sin(E) - m;
    const d = f / (1 - e * Math.cos(E));
    E -= d;
    if (Math.abs(d) < 1e-13) break;
  }
  return E;
}

interface MoonModel {
  rec: MoonRecord;
  /** Reference plane → ICRS (row-major 3×3). */
  plane: Float64Array;
  a: number;
  e: number;
  i: number;
  /** Mean longitude at the epoch (M + ω + Ω), rad. */
  lambda0: number;
  /** +1 prograde, −1 retrograde orbit. */
  nodeSign: number;
  /** Mean-longitude rate from the sidereal period, rad/day. */
  n: number;
  omega0: number;
  node0: number;
  /** Apsidal / nodal rates, rad/day (signed). */
  omegaDot: number;
  nodeDot: number;
  /** Epoch of the angles (JD TDB). */
  epochJD: number;
  /** Resonant libration of the mean longitude (fitted Saturnian elements only). */
  libration: MeanElementFit['libration'] | null;
}

const models = new Map<string, MoonModel>();

function planeMatrix(rec: MoonRecord): Float64Array {
  const o = rec.orbit;
  if (o.frame === 'ecliptic') {
    const eps = OBLIQUITY_J2000_DEG * DEG;
    const c = Math.cos(eps), s = Math.sin(eps);
    return Float64Array.from([1, 0, 0, 0, c, -s, 0, s, c]);
  }
  const [ra, dec] = o.frame === 'laplace' && o.pole ? o.pole : PRIMARY_POLE[rec.parent];
  return bodyFixedToIcrsMatrix(ra, dec, 0);
}

export function modelFor(rec: MoonRecord): MoonModel {
  let m = models.get(rec.id);
  if (m) return m;
  const o = rec.orbit;
  const node0 = o.nodeDeg * DEG;
  const omega0 = o.periDeg * DEG;
  const retrograde = o.iDeg > 90;
  const perDay = (yr: number | null): number => (yr && yr > 0 ? TWO_PI / (yr * YEAR_DAYS) : 0);
  const fit = SATURN_MEAN_ELEMENTS[rec.id];
  if (fit) {
    // Elements fitted to JPL Horizons SAT441 (see data.ts), J2000 epoch, all prograde: ω = ϖ − Ω.
    m = {
      rec,
      plane: planeMatrix(rec),
      a: o.aKm * 1000,
      e: o.e,
      i: o.iDeg * DEG,
      lambda0: fit.lambdaDeg * DEG,
      nodeSign: 1,
      n: fit.nDegPerDay * DEG,
      omega0: (fit.periLonDeg - fit.nodeDeg) * DEG,
      node0: fit.nodeDeg * DEG,
      omegaDot: (fit.periRateDegPerDay - fit.nodeRateDegPerDay) * DEG,
      nodeDot: fit.nodeRateDegPerDay * DEG,
      epochJD: 2451545.0,
      libration: fit.libration ?? null,
    };
    models.set(rec.id, m);
    return m;
  }
  m = {
    rec,
    plane: planeMatrix(rec),
    a: o.aKm * 1000,
    e: o.e,
    i: o.iDeg * DEG,
    lambda0: omega0 + (retrograde ? -node0 : node0) + o.meanAnomDeg * DEG,
    nodeSign: retrograde ? -1 : 1,
    n: TWO_PI / (SIDEREAL_DAYS[rec.id] ?? o.periodDays),
    omega0,
    node0,
    omegaDot: (retrograde !== APSIS_RETROGRADE.has(rec.id) ? -1 : 1) * perDay(o.precApsisYr),
    nodeDot: (retrograde ? 1 : -1) * perDay(o.precNodeYr),
    epochJD: o.epochJD,
    libration: null,
  };
  models.set(rec.id, m);
  return m;
}

export interface OrbitState {
  /** Current argument of periapsis / node (rad) and mean anomaly (rad). */
  omega: number;
  node: number;
  meanAnomaly: number;
}

export function orbitState(m: MoonModel, tMs: number, out: OrbitState = { omega: 0, node: 0, meanAnomaly: 0 }): OrbitState {
  const d = julianDate(tMs) - m.epochJD;
  out.omega = m.omega0 + m.omegaDot * d;
  out.node = m.node0 + m.nodeDot * d;
  let lib = 0;
  if (m.libration) {
    const th = (m.libration.argDeg + (m.libration.rateDegPerYr * d) / YEAR_DAYS) * DEG;
    for (const [k, amp] of m.libration.terms) lib += amp * DEG * Math.sin(k * th);
  }
  // Prograde: M = λ − ω − Ω. A retrograde orbit (i > 90°) measures its in-plane angle against the node motion: M = λ − ω + Ω.
  out.meanAnomaly = m.lambda0 + lib + m.n * d - out.omega - m.nodeSign * out.node;
  return out;
}

const scratchState: OrbitState = { omega: 0, node: 0, meanAnomaly: 0 };

/** Apply the orbital-plane rotation Rz(Ω)·Rx(i)·Rz(ω) then the plane→ICRS matrix to an in-plane vector. */
function orbitToIcrs(m: MoonModel, node: number, omega: number, x: number, y: number, out: Vector3): Vector3 {
  const cw = Math.cos(omega), sw = Math.sin(omega);
  const x1 = cw * x - sw * y, y1 = sw * x + cw * y;
  const ci = Math.cos(m.i), si = Math.sin(m.i);
  const y2 = ci * y1, z2 = si * y1;
  const cn = Math.cos(node), sn = Math.sin(node);
  const px = cn * x1 - sn * y2, py = sn * x1 + cn * y2, pz = z2;
  const p = m.plane;
  return out.set(p[0] * px + p[1] * py + p[2] * pz, p[3] * px + p[4] * py + p[5] * pz, p[6] * px + p[7] * py + p[8] * pz);
}

// ── astronomy-engine Galilean cache ──────────────────────────────────────────────────────
const gal = { tMs: Number.NaN, io: [0, 0, 0], europa: [0, 0, 0], ganymede: [0, 0, 0], callisto: [0, 0, 0] } as {
  tMs: number;
  [k: string]: number[] | number;
};

function evaluateGalilean(tMs: number): void {
  if (gal.tMs === tMs) return;
  const jm = Astronomy.JupiterMoons(Astronomy.MakeTime(new Date(tMs)));
  const put = (key: string, v: Astronomy.StateVector): void => {
    const a = gal[key] as number[];
    a[0] = v.x * AU_M;
    a[1] = v.y * AU_M;
    a[2] = v.z * AU_M;
  };
  put('io', jm.io);
  put('europa', jm.europa);
  put('ganymede', jm.ganymede);
  put('callisto', jm.callisto);
  gal.tMs = tMs;
}

/** Position of the moon relative to its parent, ICRS metres, written into `out`. */
export function moonOffset(rec: MoonRecord, tMs: number, out: Vector3): Vector3 {
  if (GALILEAN.has(rec.id)) {
    evaluateGalilean(tMs);
    const a = gal[rec.id] as number[];
    return out.set(a[0], a[1], a[2]);
  }
  return meanElementOffset(rec, tMs, out);
}

/** Mean-element position relative to the parent (every moon but the Galileans, orbit lines, tests). */
export function meanElementOffset(rec: MoonRecord, tMs: number, out: Vector3): Vector3 {
  const m = modelFor(rec);
  const s = orbitState(m, tMs, scratchState);
  const E = solveKepler(s.meanAnomaly, m.e);
  const x = m.a * (Math.cos(E) - m.e);
  const y = m.a * Math.sqrt(1 - m.e * m.e) * Math.sin(E);
  return orbitToIcrs(m, s.node, s.omega, x, y, out);
}

/** Velocity relative to the parent (m/s), by a symmetric 60 s difference of the position model. */
export function moonRelativeVelocity(rec: MoonRecord, tMs: number, out: Vector3, scratch: Vector3): Vector3 {
  moonOffset(rec, tMs + 30_000, out);
  moonOffset(rec, tMs - 30_000, scratch);
  return out.sub(scratch).multiplyScalar(1 / 60);
}

// ── Parent positions (fallback when the parent entity is not registered) ─────────────────
const parentCache = new Map<ParentKey, { tMs: number; v: [number, number, number] }>();

export function fallbackParentPosition(parent: ParentKey, tMs: number, out: Vector3): Vector3 {
  let c = parentCache.get(parent);
  if (!c) {
    c = { tMs: Number.NaN, v: [0, 0, 0] };
    parentCache.set(parent, c);
  }
  if (c.tMs !== tMs) {
    const s = Astronomy.BaryState(PARENT_BODY[parent], Astronomy.MakeTime(new Date(tMs)));
    c.v[0] = s.x * AU_M;
    c.v[1] = s.y * AU_M;
    c.v[2] = s.z * AU_M;
    c.tMs = tMs;
  }
  return out.set(c.v[0], c.v[1], c.v[2]);
}

// ── Orientation ──────────────────────────────────────────────────────────────────────────
const wrap360 = (x: number): number => ((x % 360) + 360) % 360;
const scratchMat = new Float64Array(9);

/** IAU pole (RA, Dec) and prime-meridian angle (deg) at `tMs`, written to out[0..2]. */
export function iauElements(rec: MoonRecord, tMs: number, out: number[]): number[] {
  const r = rec.rotation!;
  const d = julianDate(tMs) - 2451545;
  const T = d / 36525;
  let ra = r.ra + r.raR * T;
  let dec = r.dec + r.decR * T;
  let w = r.w0 + r.wd * d + r.wdd * d * d;
  if (r.ang) {
    for (let k = 0; k < r.ang.length; k++) {
      const a = r.ang[k];
      const th = (a[0] + a[1] * T + (a[2] ?? 0) * T * T) * DEG;
      if (r.raS && r.raS[k]) ra += r.raS[k] * Math.sin(th);
      if (r.decC && r.decC[k]) dec += r.decC[k] * Math.cos(th);
      if (r.wS && r.wS[k]) w += r.wS[k] * Math.sin(th);
    }
  }
  out[0] = ra;
  out[1] = dec;
  out[2] = wrap360(w);
  return out;
}

const iauScratch = [0, 0, 0];

function writeSync(m: MoonModel, tMs: number, out: Float64Array): Float64Array {
  // Tidally locked, uniform rotation at the mean orbital rate: body +x points at the planet at mean position.
  const s = orbitState(m, tMs, scratchState);
  const u = s.omega + s.meanAnomaly; // in-orbit-plane mean argument of latitude
  const ex = -Math.cos(u), ey = -Math.sin(u);
  const ci = Math.cos(m.i), si = Math.sin(m.i);
  const cn = Math.cos(s.node), sn = Math.sin(s.node);
  // Orbit-plane basis (x toward ascending node of the orbit, z orbit normal) → reference plane.
  const bx = [cn, sn, 0], by = [-sn * ci, cn * ci, si], bz = [sn * si, -cn * si, ci];
  const X = [ex * bx[0] + ey * by[0], ex * bx[1] + ey * by[1], ex * bx[2] + ey * by[2]];
  const Y = [-ey * bx[0] + ex * by[0], -ey * bx[1] + ex * by[1], -ey * bx[2] + ex * by[2]];
  const p = m.plane;
  const rot = (v: number[], k: number): number => p[k * 3] * v[0] + p[k * 3 + 1] * v[1] + p[k * 3 + 2] * v[2];
  for (let r = 0; r < 3; r++) {
    out[r * 3] = rot(X, r);
    out[r * 3 + 1] = rot(Y, r);
    out[r * 3 + 2] = rot(bz, r);
  }
  return out;
}

/** Build a rotation from axis tilt angles (illustrative spin). */
function writeSpin(rec: MoonRecord, tMs: number, tumble: boolean, out: Float64Array): Float64Array {
  const look = MOON_LOOKS[rec.id];
  const hours = look.spin?.periodHours ?? 24;
  const t = tMs / 3_600_000;
  // Deterministic per-moon axis from its id.
  let h = 0;
  for (let i = 0; i < rec.id.length; i++) h = (h * 31 + rec.id.charCodeAt(i)) >>> 0;
  const ra = ((h % 360) + 0) , dec = 30 + ((h >>> 9) % 50);
  let w = wrap360((t / hours) * 360);
  let tilt = 0, prec = 0;
  if (tumble) {
    tilt = 38 * Math.sin((t / (hours * 2.7)) * TWO_PI);
    prec = (t / (hours * 4.3)) * 360;
  }
  // Compose Rz(ra+90)Rx(90-dec) pole frame with W, then a wobble about the body x axis.
  bodyFixedToIcrsMatrix(ra + prec * 0.2, dec + tilt * 0.4, w, out);
  return out;
}

/** Body-fixed → ICRS rotation (row-major) of the moon at `tMs`; body +z north/spin pole, +x prime meridian. */
export function moonRotation(rec: MoonRecord, tMs: number, out: Float64Array): Float64Array {
  // Moons with a published map follow the IAU frame (the map's longitudes are defined by it). Untextured moons are drawn
  // as exactly tidally locked: several IAU Saturnian/Uranian prime meridians are crater-defined and carry fitted
  // periodic terms of tens of degrees (Mimas) that are not physical librations.
  if (rec.rotation && MOON_LOOKS[rec.id].texture) {
    iauElements(rec, tMs, iauScratch);
    return bodyFixedToIcrsMatrix(iauScratch[0], iauScratch[1], iauScratch[2], out);
  }
  const kind = MOON_LOOKS[rec.id].spin?.kind ?? 'sync';
  if (kind === 'sync') return writeSync(modelFor(rec), tMs, out);
  return writeSpin(rec, tMs, kind === 'tumble', out);
}

/**
 * Sub-parent point of a tidally locked moon (planetocentric east longitude, latitude, deg) — validation helper.
 * With uniform sync rotation this stays near 0° (±optical libration ≈ 2e rad).
 */
export function subParentLonLat(rec: MoonRecord, tMs: number): { lonDeg: number; latDeg: number } {
  const rel = { x: 0, y: 0, z: 0 };
  const v = new Vector3();
  moonOffset(rec, tMs, v);
  rel.x = -v.x; rel.y = -v.y; rel.z = -v.z;
  const R = moonRotation(rec, tMs, scratchMat);
  // body = Rᵀ · rel
  const bx = R[0] * rel.x + R[3] * rel.y + R[6] * rel.z;
  const by = R[1] * rel.x + R[4] * rel.y + R[7] * rel.z;
  const bz = R[2] * rel.x + R[5] * rel.y + R[8] * rel.z;
  const len = Math.hypot(bx, by, bz);
  let lon = Math.atan2(by, bx) / DEG;
  if (lon > 180) lon -= 360;
  return { lonDeg: lon, latDeg: Math.asin(bz / len) / DEG };
}

export function recordOf(id: string): MoonRecord {
  const r = MOON_RECORDS.find((x) => x.id === id);
  if (!r) throw new Error(`unknown moon ${id}`);
  return r;
}
