/**
 * Near-Earth-object, close-approach and Sentry data API — the documented entry point for the future planetary-defense lab.
 *
 *   import { loadNeoCatalog, loadCloseApproaches, loadSentry, neoElements, propagateNeoHeliocentricM,
 *            nextApproaches, findNeo } from '../domains/smallbodies/neoApi';
 *
 * All loaders fetch once (cached promise) from public/data/solar/ and resolve to typed rows. Missing values are `null`
 * (never 0). Distances are au unless a name says otherwise; epochs are JD TDB.
 *
 * Accuracy notes the lab must carry to the user:
 *  - NEO osculating elements in neos.json are rounded by the SBDB query API to ~4–5 significant figures; they are
 *    adequate for display and for ~±1 yr propagation, NOT for impact-probability work. Named bodies (named.generated.json)
 *    use full-precision elements.
 *  - Close-approach distances are the CAD nominal centre-to-centre values with 3σ min/max bounds.
 *  - `diameterEstKm` is derived from H with a fixed albedo of 0.14 (factor ≈ 2 uncertainty).
 */
import type { Vector3 } from 'three';
import { jdTdbFromMs, heliocentricIcrsM, type HelioElements } from './orbits';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

export interface NeoRow {
  spkid: number;
  fullname: string;
  designation: string;
  orbitClass: string;
  /** Potentially hazardous asteroid flag (MOID ≤ 0.05 au and H ≤ 22). */
  pha: boolean;
  /** Absolute magnitude. */
  H: number | null;
  diameterKm: number | null;
  diameterSigmaKm: number | null;
  /** DERIVED from H with albedo 0.14. */
  diameterEstKm: number | null;
  albedo: number | null;
  rotationPeriodH: number | null;
  /** Earth minimum orbit intersection distance, au. */
  moidAU: number | null;
  epochJD: number;
  aAU: number;
  e: number;
  iDeg: number;
  nodeDeg: number;
  argPeriDeg: number;
  meanAnomalyDeg: number;
  tpJD: number | null;
  periodDays: number | null;
  sigmaAAU: number | null;
  sigmaE: number | null;
  conditionCode: number | null;
  dataArcDays: number | null;
  nObsUsed: number | null;
}

export interface CloseApproach {
  designation: string;
  fullname: string;
  /** JD TDB of the approach. */
  jdTDB: number;
  /** Calendar string from CAD, "YYYY-Mon-DD HH:MM" (TDB). */
  calendarTDB: string;
  /** Nominal geocentric centre-to-centre distance, au. */
  distAU: number;
  /** 3σ bounds on the distance, au. */
  distMinAU: number | null;
  distMaxAU: number | null;
  /** Relative velocity, km/s. */
  vRelKms: number;
  H: number | null;
  diameterKm: number | null;
  /** CAD t_sigma_f string ("< 00:01", "04:14", "~2 days"...). */
  timeSigma: string | null;
}

export interface SentryRow {
  designation: string;
  fullname: string;
  /** Cumulative impact probability (0–1). */
  ipCumulative: number;
  psCum: number | null;
  psMax: number | null;
  /** Torino scale (0–10). */
  tsMax: number | null;
  nImp: number;
  yearMin: number | null;
  yearMax: number | null;
  H: number | null;
  diameterKm: number | null;
  massKg: number | null;
  vInfKms: number | null;
  lastObs: string | null;
}

interface Table {
  fields: string[];
  rows: unknown[][];
}

async function fetchJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return (await res.json()) as T;
}

function rowsToObjects<T>(t: Table, map: (o: Record<string, unknown>) => T): T[] {
  const out: T[] = new Array(t.rows.length);
  for (let i = 0; i < t.rows.length; i++) {
    const o: Record<string, unknown> = {};
    for (let k = 0; k < t.fields.length; k++) o[t.fields[k]] = t.rows[i][k];
    out[i] = map(o);
  }
  return out;
}

const n = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

let neoPromise: Promise<NeoRow[]> | null = null;
let cadPromise: Promise<CloseApproach[]> | null = null;
let sentryPromise: Promise<SentryRow[]> | null = null;

/** All 3,449 catalogued PHAs + NEAs with H < 18 + notable NEOs, sorted by H ascending. */
export function loadNeoCatalog(): Promise<NeoRow[]> {
  neoPromise ??= fetchJson<Table>('data/solar/neos.json').then((t) =>
    rowsToObjects<NeoRow>(t, (o) => ({
      spkid: o.spkid as number,
      fullname: String(o.fullname).trim(),
      designation: String(o.designation),
      orbitClass: String(o.orbitClass),
      pha: o.pha === true,
      H: n(o.H),
      diameterKm: n(o.diameterKm),
      diameterSigmaKm: n(o.diameterSigmaKm),
      diameterEstKm: n(o.diameterEstKm),
      albedo: n(o.albedo),
      rotationPeriodH: n(o.rotationPeriodH),
      moidAU: n(o.moidAU),
      epochJD: o.epochJD as number,
      aAU: o.aAU as number,
      e: o.e as number,
      iDeg: o.iDeg as number,
      nodeDeg: o.nodeDeg as number,
      argPeriDeg: o.argPeriDeg as number,
      meanAnomalyDeg: o.meanAnomalyDeg as number,
      tpJD: n(o.tpJD),
      periodDays: n(o.periodDays),
      sigmaAAU: n(o.sigmaAAU),
      sigmaE: n(o.sigmaE),
      conditionCode: n(o.conditionCode),
      dataArcDays: n(o.dataArcDays),
      nObsUsed: n(o.nObsUsed),
    })),
  );
  return neoPromise;
}

/** Earth close approaches < 0.05 au, 2026-10-16 … 2036-10-16, plus Apophis 2029. Sorted by date. */
export function loadCloseApproaches(): Promise<CloseApproach[]> {
  cadPromise ??= fetchJson<Table>('data/solar/close-approaches.json').then((t) =>
    rowsToObjects<CloseApproach>(t, (o) => ({
      designation: String(o.des),
      fullname: String(o.fullname).trim(),
      jdTDB: o.jdTDB as number,
      calendarTDB: String(o.cdTDB),
      distAU: o.distAU as number,
      distMinAU: n(o.distMinAU),
      distMaxAU: n(o.distMaxAU),
      vRelKms: o.vRelKms as number,
      H: n(o.hMag),
      diameterKm: n(o.diameterKm),
      timeSigma: typeof o.timeSigma === 'string' ? o.timeSigma : null,
    })).sort((a, b) => a.jdTDB - b.jdTDB),
  );
  return cadPromise;
}

/** NASA/JPL Sentry risk table (objects with at least one potential impact), sorted by cumulative probability. */
export function loadSentry(): Promise<SentryRow[]> {
  sentryPromise ??= fetchJson<Table>('data/solar/sentry.json').then((t) =>
    rowsToObjects<SentryRow>(t, (o) => ({
      designation: String(o.des),
      fullname: String(o.fullname).trim(),
      ipCumulative: o.ipCumulative as number,
      psCum: n(o.psCum),
      psMax: n(o.psMax),
      tsMax: n(o.tsMax),
      nImp: (o.nImp as number) ?? 0,
      yearMin: n(o.yearMin),
      yearMax: n(o.yearMax),
      H: n(o.hMag),
      diameterKm: n(o.diameterKm),
      massKg: n(o.massKg),
      vInfKms: n(o.vInfKms),
      lastObs: typeof o.lastObs === 'string' ? o.lastObs : null,
    })),
  );
  return sentryPromise;
}

/** Strip parentheses/spaces and lowercase, so "(2024 YR4)", "2024 yr4" and "2024YR4" compare equal. */
export function normalizeDesignation(s: string): string {
  return s.replace(/[()\s]/g, '').toLowerCase();
}

/** Find a NEO by designation ("99942", "2024 YR4") or by (part of) its full name ("Apophis"). */
export async function findNeo(query: string): Promise<NeoRow | undefined> {
  const q = normalizeDesignation(query);
  const rows = await loadNeoCatalog();
  return rows.find((r) => normalizeDesignation(r.designation) === q) ?? rows.find((r) => normalizeDesignation(r.fullname).includes(q));
}

/** Close approaches in [fromMs, toMs] (Unix ms UTC; TDB−UTC ≈ 69 s is ignored) with distance ≤ maxAU, soonest first. */
export async function nextApproaches(fromMs: number, toMs: number, maxAU = 0.05, limit = 50): Promise<CloseApproach[]> {
  const cad = await loadCloseApproaches();
  const a = jdTdbFromMs(fromMs), b = jdTdbFromMs(toMs);
  const out: CloseApproach[] = [];
  for (const r of cad) {
    if (r.jdTDB < a || r.jdTDB > b || r.distAU > maxAU) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

/** Sentry row for a designation, if the object is on the risk list. */
export async function sentryFor(designation: string): Promise<SentryRow | undefined> {
  const q = normalizeDesignation(designation);
  return (await loadSentry()).find((r) => normalizeDesignation(r.designation) === q);
}

/** The osculating elements of a catalog row in the shape the propagator takes. */
export function neoElements(r: NeoRow): HelioElements {
  return { epochJD: r.epochJD, aAU: r.aAU, e: r.e, iDeg: r.iDeg, nodeDeg: r.nodeDeg, argPeriDeg: r.argPeriDeg, meanAnomalyDeg: r.meanAnomalyDeg };
}

/** Heliocentric ICRS position (m, Sun-centre) of a NEO at Unix-ms `tMs` by two-body propagation from its epoch. */
export function propagateNeoHeliocentricM(r: NeoRow, tMs: number, out: Vector3): Vector3 {
  return heliocentricIcrsM(neoElements(r), jdTdbFromMs(tMs), out);
}

/** Minimum possible Earth-centre approach distance in km from the CAD 3σ lower bound, falling back to nominal. */
export function minApproachKm(a: CloseApproach): number {
  return (a.distMinAU ?? a.distAU) * 149_597_870.7;
}
