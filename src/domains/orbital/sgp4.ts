/**
 * Main-thread SGP4 for a handful of objects (the notable satellites): satellite.js 7 from a catalog row, output
 * rotated TEME → ICRS (src/core/frames.ts), then cached as two-body elements and advanced with Kepler between
 * refreshes (≤ 20 sim-seconds apart) so the many per-frame position() calls cost a single Kepler solve each.
 */
import { json2satrec, propagate, type SatRec } from 'satellite.js';
import { temeToIcrsMatrix } from '../../core/frames';
import { F, type CatalogRow } from './catalogTypes';
import { ELEMENT_STRIDE, elementsPosition, elementsVelocity, stateToElements, type Vec3Like } from './kepler';

export function satrecFromRow(r: CatalogRow): SatRec | null {
  if (r[F.elementSource] !== 'celestrak-gp') return null;
  try {
    return json2satrec({
      OBJECT_NAME: String(r[F.name]), OBJECT_ID: String(r[F.intlDes] ?? ''), EPOCH: String(r[F.epochUTC]).replace(/Z$/, ''),
      MEAN_MOTION: r[F.meanMotion] as number, ECCENTRICITY: r[F.ecc] as number, INCLINATION: r[F.inc] as number,
      RA_OF_ASC_NODE: r[F.raan] as number, ARG_OF_PERICENTER: r[F.argp] as number, MEAN_ANOMALY: r[F.meanAnomaly] as number,
      EPHEMERIS_TYPE: 0, CLASSIFICATION_TYPE: 'U', NORAD_CAT_ID: Number(r[F.norad]), ELEMENT_SET_NO: 999, REV_AT_EPOCH: 0,
      BSTAR: r[F.bstar] as number, MEAN_MOTION_DOT: r[F.ndot] as number, MEAN_MOTION_DDOT: r[F.nddot] as number,
    });
  } catch {
    return null;
  }
}

const m = new Float64Array(9);

/** SGP4 state at tMs in ICRS axes: metres and m/s relative to Earth's centre. False when propagation fails. */
export function sgp4Icrs(rec: SatRec, tMs: number, out: Float64Array): boolean {
  const pv = propagate(rec, new Date(tMs));
  const p = pv?.position, v = pv?.velocity;
  if (!p || !v || typeof p === 'boolean' || !Number.isFinite(p.x)) return false;
  temeToIcrsMatrix(tMs, m);
  out[0] = (m[0] * p.x + m[1] * p.y + m[2] * p.z) * 1000;
  out[1] = (m[3] * p.x + m[4] * p.y + m[5] * p.z) * 1000;
  out[2] = (m[6] * p.x + m[7] * p.y + m[8] * p.z) * 1000;
  out[3] = (m[0] * v.x + m[1] * v.y + m[2] * v.z) * 1000;
  out[4] = (m[3] * v.x + m[4] * v.y + m[5] * v.z) * 1000;
  out[5] = (m[6] * v.x + m[7] * v.y + m[8] * v.z) * 1000;
  return true;
}

const REFRESH_MS = 20_000;

/** One tracked object: SGP4 refreshed every 20 sim-seconds, Kepler in between. Allocation-free after construction. */
export class TrackedSat {
  readonly el = new Float64Array(ELEMENT_STRIDE);
  private t0 = Number.NaN;
  private readonly state = new Float64Array(6);
  ok = false;
  constructor(readonly rec: SatRec | null) {}

  private refresh(tMs: number): void {
    if (Number.isFinite(this.t0) && Math.abs(tMs - this.t0) < REFRESH_MS) return;
    this.t0 = tMs;
    this.ok = !!this.rec && sgp4Icrs(this.rec, tMs, this.state)
      && stateToElements(this.state[0], this.state[1], this.state[2], this.state[3], this.state[4], this.state[5], this.el, 0);
  }

  /** Earth-centred ICRS position (m); false when unavailable. */
  position(tMs: number, out: Vec3Like): boolean {
    this.refresh(tMs);
    return this.ok && elementsPosition(this.el, 0, (tMs - this.t0) / 1000, out);
  }

  /** Position `dtSec` after `tMs` on the current osculating orbit (orbit tracks). */
  positionAhead(tMs: number, dtSec: number, out: Vec3Like): boolean {
    this.refresh(tMs);
    return this.ok && elementsPosition(this.el, 0, (tMs - this.t0) / 1000 + dtSec, out);
  }

  velocity(tMs: number, out: Vec3Like): boolean {
    this.refresh(tMs);
    return this.ok && elementsVelocity(this.el, 0, (tMs - this.t0) / 1000, out);
  }

  /** Orbital period (s) of the current osculating orbit, NaN when unavailable. */
  periodSec(tMs: number): number {
    this.refresh(tMs);
    return this.ok ? (2 * Math.PI) / this.el[8] : Number.NaN;
  }
}
