/**
 * Shared shapes between the orbital propagation worker and the main thread (no runtime dependencies besides constants).
 * Catalog: public/data/orbital/catalog.json (docs/data/orbital.md), positional rows by `fields`.
 */

/** Positional field indices of catalog.json rows (docs/data/orbital.md, "Files"). */
export const F = {
  norad: 0, name: 1, intlDes: 2, objectClass: 3, isActive: 4, owner: 5, launchDate: 6, rcsSize: 7, groups: 8,
  hasElements: 9, epochUTC: 10, meanMotion: 11, ecc: 12, inc: 13, raan: 14, argp: 15, meanAnomaly: 16, bstar: 17,
  ndot: 18, nddot: 19, apogeeKm: 20, perigeeKm: 21, periodMin: 22, elementSource: 23, launchSite: 24, opsStatus: 25, rcsM2: 26,
} as const;

export type CatalogRow = (string | number | boolean | null | string[])[];

export interface CatalogFile {
  schemaVersion: number;
  generated: string;
  epochNote?: string;
  fields: string[];
  rows: CatalogRow[];
}

// Per-object flag byte.
export const CLASS_MASK = 3;
export const CLASS_PAYLOAD = 0;
export const CLASS_ROCKET = 1;
export const CLASS_DEBRIS = 2;
export const CLASS_UNKNOWN = 3;
export const FLAG_ACTIVE = 4;
export const FLAG_STARLINK = 8;
/** Orbit shape only (SATCAT): node, perigee and phase are illustrative. */
export const FLAG_RECONSTRUCTED = 16;
/** No orbit data at all (never drawn). */
export const FLAG_NO_ORBIT = 32;

export const REGIME_LEO = 0;
export const REGIME_MEO = 1;
export const REGIME_GEO = 2;
export const REGIME_HEO = 3;
export const REGIME_UNKNOWN = 4;
export const REGIME_NAMES = ['LEO', 'MEO', 'GEO', 'HEO / other', 'Unknown'] as const;

export function classCode(c: unknown): number {
  return c === 'payload' ? CLASS_PAYLOAD : c === 'rocket-body' ? CLASS_ROCKET : c === 'debris' ? CLASS_DEBRIS : CLASS_UNKNOWN;
}

/** Regime rules of summary.json `definitions` (mean apsis altitudes, tested in this order). */
export function regimeCode(perigeeKm: number | null, apogeeKm: number | null, ecc: number | null): number {
  if (perigeeKm == null || apogeeKm == null) return REGIME_UNKNOWN;
  const mean = (perigeeKm + apogeeKm) / 2;
  if (Math.abs(mean - 35786) <= 200 && (ecc ?? (apogeeKm - perigeeKm) / (2 * 6378.135 + apogeeKm + perigeeKm)) < 0.01) return REGIME_GEO;
  if (apogeeKm < 2000) return REGIME_LEO;
  if (perigeeKm >= 2000 && apogeeKm <= 31570) return REGIME_MEO;
  return REGIME_HEO;
}

export interface MetaMessage {
  type: 'meta';
  generated: string;
  count: number;
  norad: Uint32Array;
  flags: Uint8Array;
  regime: Uint8Array;
  names: string[];
  /** Element epoch (Unix ms), NaN when none. */
  epochMs: Float64Array;
}

export interface ElementsMessage {
  type: 'elements';
  /** Reference instant of the elements (Unix ms). */
  t0Ms: number;
  /** count × ELEMENT_STRIDE perifocal elements in ICRS axes, metres, relative to Earth's centre. */
  buf: Float32Array;
  /** Propagation time in the worker, ms. */
  costMs: number;
  failed: number;
}

export interface RowMessage {
  type: 'row';
  reqId: number;
  row: CatalogRow | null;
}

export type WorkerOut = MetaMessage | ElementsMessage | RowMessage | { type: 'error'; message: string };

export type WorkerIn =
  | { type: 'init'; url: string }
  | { type: 'propagate'; tMs: number; buf?: Float32Array }
  | { type: 'row'; reqId: number; index: number };
