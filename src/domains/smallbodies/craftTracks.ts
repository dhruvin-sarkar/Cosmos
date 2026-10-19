/**
 * Whole-mission spacecraft trajectories (public/data/smallbodies/craft-tracks.json, built by
 * scripts/data/smallbodies/craft-tracks.mjs from JPL Horizons): non-uniform samples of position AND velocity, interpolated
 * with a cubic Hermite spline that uses the true velocities. The samples were decimated so this interpolant reproduces every
 * Horizons state within a per-centre tolerance (Sun 20 km, Earth 2 km, Jupiter/Saturn 5 km, Didymos 5 m), so perijoves,
 * perihelia and planetary flybys are resolved. Outside the coverage the track is held at its end point — never extrapolated.
 * Fallback: the older uniform 2025–2030 samples (public/data/solar/spacecraft.json) via `HermiteTrack.fromUniform`.
 */
import type { Vector3 } from 'three';
import type { CraftData } from './spacecraft';

export type CraftCenterId = 'sun' | 'earth' | 'jupiter' | 'saturn' | 'didymos';

export interface CraftTrackJson {
  id: string;
  naifId: number;
  centerId: CraftCenterId;
  /** JD TDB of the first sample. */
  t0: number;
  /** Sample times, days from t0. */
  t: number[];
  /** km, xyz interleaved. */
  p: number[];
  /** km/s, xyz interleaved. */
  v: number[];
}

const DAY_S = 86400;
const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

export class HermiteTrack {
  readonly id: string;
  readonly centerId: CraftCenterId;
  /** Absolute JD TDB per sample. */
  readonly t: Float64Array;
  /** km. */
  readonly p: Float64Array;
  /** km/s. */
  readonly v: Float64Array;
  readonly count: number;
  private seg = 0;

  constructor(id: string, centerId: CraftCenterId, t: Float64Array, p: Float64Array, v: Float64Array) {
    this.id = id;
    this.centerId = centerId;
    this.t = t;
    this.p = p;
    this.v = v;
    this.count = t.length;
  }

  static fromJson(j: CraftTrackJson): HermiteTrack {
    const t = new Float64Array(j.t.length);
    for (let i = 0; i < t.length; i++) t[i] = j.t0 + j.t[i];
    return new HermiteTrack(j.id, j.centerId, t, Float64Array.from(j.p), Float64Array.from(j.v));
  }

  /** From the uniform 2025–2030 samples: velocities by central differences. */
  static fromUniform(d: CraftData): HermiteTrack {
    const n = d.count;
    const s = d.samples ?? [];
    const t = new Float64Array(n), p = Float64Array.from(s), v = new Float64Array(3 * n);
    for (let i = 0; i < n; i++) {
      t[i] = d.startJD + i * d.stepDays;
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
      for (let k = 0; k < 3; k++) v[3 * i + k] = (s[3 * b + k] - s[3 * a + k]) / (((b - a) || 1) * d.stepDays * DAY_S);
    }
    return new HermiteTrack(d.id, d.centerId, t, p, v);
  }

  get startJD(): number {
    return this.t[0];
  }
  get endJD(): number {
    return this.t[this.count - 1];
  }
  covers(jd: number): boolean {
    return jd >= this.startJD && jd <= this.endJD;
  }

  /** Segment index i with t[i] ≤ jd < t[i+1] (cached walk, binary search on jumps). */
  private segment(jd: number): number {
    const t = this.t;
    const last = this.count - 2;
    let i = this.seg;
    if (i > last) i = last;
    if (jd >= t[i] && jd < t[i + 1]) return i;
    if (i < last && jd >= t[i + 1] && jd < t[i + 2]) return (this.seg = i + 1);
    let lo = 0, hi = last;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (t[mid] <= jd) lo = mid;
      else hi = mid - 1;
    }
    return (this.seg = lo);
  }

  /** Position (m, relative to the centre body) at JD TDB, clamped to the coverage. */
  positionM(jd: number, out: Vector3): Vector3 {
    const n = this.count;
    const p = this.p;
    if (n === 1 || jd <= this.t[0]) return out.set(p[0] * 1000, p[1] * 1000, p[2] * 1000);
    if (jd >= this.t[n - 1]) return out.set(p[3 * n - 3] * 1000, p[3 * n - 2] * 1000, p[3 * n - 1] * 1000);
    const i = this.segment(jd);
    const h = (this.t[i + 1] - this.t[i]) * DAY_S;
    const u = (jd - this.t[i]) / (this.t[i + 1] - this.t[i]);
    const u2 = u * u, u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1, h10 = (u3 - 2 * u2 + u) * h, h01 = -2 * u3 + 3 * u2, h11 = (u3 - u2) * h;
    const a = 3 * i, b = a + 3, v = this.v;
    return out.set(
      (h00 * p[a] + h10 * v[a] + h01 * p[b] + h11 * v[b]) * 1000,
      (h00 * p[a + 1] + h10 * v[a + 1] + h01 * p[b + 1] + h11 * v[b + 1]) * 1000,
      (h00 * p[a + 2] + h10 * v[a + 2] + h01 * p[b + 2] + h11 * v[b + 2]) * 1000,
    );
  }

  /** Velocity (m/s, relative to the centre body); zero outside the coverage. */
  velocityMs(jd: number, out: Vector3): Vector3 {
    const n = this.count;
    if (n < 2 || jd < this.t[0] || jd > this.t[n - 1]) return out.set(0, 0, 0);
    const i = this.segment(Math.min(jd, this.t[n - 1] - 1e-9));
    const h = (this.t[i + 1] - this.t[i]) * DAY_S;
    const u = (jd - this.t[i]) / (this.t[i + 1] - this.t[i]);
    const u2 = u * u;
    const d00 = (6 * u2 - 6 * u) / h, d10 = 3 * u2 - 4 * u + 1, d01 = (-6 * u2 + 6 * u) / h, d11 = 3 * u2 - 2 * u;
    const a = 3 * i, b = a + 3, p = this.p, v = this.v;
    return out.set(
      (d00 * p[a] + d10 * v[a] + d01 * p[b] + d11 * v[b]) * 1000,
      (d00 * p[a + 1] + d10 * v[a + 1] + d01 * p[b + 1] + d11 * v[b + 1]) * 1000,
      (d00 * p[a + 2] + d10 * v[a + 2] + d01 * p[b + 2] + d11 * v[b + 2]) * 1000,
    );
  }
}

let tracksPromise: Promise<CraftTrackJson[]> | null = null;
/** Fetch craft-tracks.json once (lazy; resolves to [] when missing). */
export function loadCraftTrackJson(): Promise<CraftTrackJson[]> {
  tracksPromise ??= fetch(`${BASE}data/smallbodies/craft-tracks.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ craft: CraftTrackJson[] }>) : { craft: [] }))
    .then((j) => j.craft ?? [])
    .catch(() => []);
  return tracksPromise;
}
