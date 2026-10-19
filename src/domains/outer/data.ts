/**
 * Trans-Neptunian object catalogue loader (public/data/outer/tnos.bin + tnos.json, written by scripts/data/outer/fetch-tnos.mjs).
 * One cached promise per page; rows are float32 [aAU, e, i, node, argPeri, M0 (deg), epochOffsetDays, H, classCode], brightest first.
 */
import type { HelioElements } from '../smallbodies/orbits';
import type { TnoClass } from './model';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

export interface NamedTno {
  /** Row index in the binary. */
  i: number;
  name: string;
  pdes: string;
  H: number;
  diameterKm: number | null;
  cls: TnoClass;
  aAU: number;
  e: number;
}

export interface TnoHeader {
  count: number;
  stride: number;
  epochBaseJD: number;
  classes: TnoClass[];
  classCounts: Record<string, number>;
  named: NamedTno[];
  generated: string;
}

export interface TnoData {
  header: TnoHeader;
  /** Row-major float32 table. */
  f: Float32Array;
  count: number;
}

let promise: Promise<TnoData> | null = null;

export function loadTnos(): Promise<TnoData> {
  promise ??= (async () => {
    const [h, b] = await Promise.all([
      fetch(`${BASE}data/outer/tnos.json`).then((r) => { if (!r.ok) throw new Error(`tnos.json ${r.status}`); return r.json() as Promise<TnoHeader>; }),
      fetch(`${BASE}data/outer/tnos.bin`).then((r) => { if (!r.ok) throw new Error(`tnos.bin ${r.status}`); return r.arrayBuffer(); }),
    ]);
    const f = new Float32Array(b);
    return { header: h, f, count: Math.min(h.count, Math.floor(f.length / h.stride)) };
  })();
  promise.catch(() => { promise = null; });
  return promise;
}

/** Fill `out` with the osculating elements of row `i` (no allocation). */
export function tnoElements(d: TnoData, i: number, out: HelioElements): HelioElements {
  const o = i * d.header.stride;
  out.aAU = d.f[o];
  out.e = d.f[o + 1];
  out.iDeg = d.f[o + 2];
  out.nodeDeg = d.f[o + 3];
  out.argPeriDeg = d.f[o + 4];
  out.meanAnomalyDeg = d.f[o + 5];
  out.epochJD = d.header.epochBaseJD + d.f[o + 6];
  return out;
}

export const newElements = (): HelioElements => ({ epochJD: 0, aAU: 1, e: 0, iDeg: 0, nodeDeg: 0, argPeriDeg: 0, meanAnomalyDeg: 0 });

/** Named objects already represented by other domains: lower-case name → existing entity id. */
export const LINKED_TNOS: Readonly<Record<string, string>> = {
  pluto: 'sol:pluto', eris: 'sol:eris', haumea: 'sol:haumea', makemake: 'sol:makemake', sedna: 'sb:sedna', arrokoth: 'sb:arrokoth',
};

export const cleanName = (n: string): string => n.replace(/^[^A-Za-z0-9]+/, '');
export const tnoSlug = (n: string): string => cleanName(n).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const tnoEntityId = (n: string): string => LINKED_TNOS[cleanName(n).toLowerCase()] ?? `sb:${tnoSlug(n)}`;
