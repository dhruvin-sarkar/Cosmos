/**
 * Loaders and adapters for public/data/galactic/*.json (docs/data/galactic.md). The files use their own Quantity shape
 * ({value, unit, uncertainty:{kind,…}, ref}); `toQuantity` adapts it to src/data/provenance.ts.
 */
import type { Quantity, ProvenanceClass, SourceRef, Uncertainty } from '../../data/provenance';
import type { SStarElements } from './model';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

export const DATASET = {
  milkyway: 'galactic-milkyway-model',
  sgra: 'galactic-sgra-sstars',
  landmarks: 'galactic-landmarks',
  messier: 'galactic-messier',
  cosmology: 'galactic-cosmology-planck2018',
} as const;

export interface RawQuantity {
  value: number | null;
  unit: string | null;
  uncertainty?: { kind: string; value?: number; plus?: number; minus?: number; stat?: number; sys?: number } | null;
  ref?: string;
  note?: string;
  range?: [number, number];
}

export interface RefEntry { short: string; citation: string; doi?: string; bibcode?: string; url?: string }

export interface MilkyWayJson {
  disclaimer: string;
  sun: Record<string, RawQuantity | Record<string, RawQuantity>>;
  bar: Record<string, RawQuantity>;
  bulge: Record<string, unknown>;
  disk: Record<string, Record<string, RawQuantity> | RawQuantity>;
  stellarHalo: Record<string, RawQuantity | string>;
  global: Record<string, RawQuantity>;
  references: Record<string, RefEntry>;
}

export interface SgraJson {
  blackHole: {
    mass: Record<string, RawQuantity>;
    distanceR0: Record<string, RawQuantity>;
    ehtRing: Record<string, RawQuantity | string>;
    spin: RawQuantity;
    derived: Record<string, RawQuantity>;
  };
  sStars: {
    s2Gravity2020: Record<string, RawQuantity | string | string[] | Record<string, number>>;
    gillessen2017: { fields: string[]; rows: (string | number | null)[][] };
  };
  references: Record<string, RefEntry>;
}

export interface LandmarkJson {
  id: string;
  name: string;
  aliases: string[];
  type: string;
  simbadMainId: string | null;
  raDeg: number;
  decDeg: number;
  lDeg: number;
  bDeg: number;
  distPc: number | null;
  distErrPc: number | null;
  distErrMinusPc: number | null;
  distErrPlusPc: number | null;
  distMethod: string | null;
  distRef: string | null;
  distNote: string | null;
  xyzHelioPc: [number, number, number] | null;
  sizePc: number | null;
  sizeNote?: string | null;
  massMsun: number | null;
  metallicityFeH?: number | null;
  summary: string;
  source: string;
  provenanceClass: ProvenanceClass;
}

export interface MessierJson {
  messier: number;
  id: string;
  designation: string;
  name: string | null;
  commonNames: string[];
  ngcIc: string[];
  aliases: string[];
  simbadMainId: string | null;
  simbadType: string | null;
  type: string;
  morphology: string | null;
  constellation: string | null;
  constellationAbbr: string | null;
  raDeg: number;
  decDeg: number;
  lDeg: number;
  bDeg: number;
  apparentMag: number | null;
  apparentMagBand: string | null;
  apparentMagSource: string | null;
  angularSizeArcmin: { major: number | null; minor: number | null } | null;
  distPc: number | null;
  distErrPc: number | null;
  distErrMinusPc: number | null;
  distErrPlusPc: number | null;
  distMethod: string | null;
  distRef: string | null;
}

const cache = new Map<string, Promise<unknown>>();

export function loadJson<T>(file: string): Promise<T> {
  let p = cache.get(file) as Promise<T> | undefined;
  if (!p) {
    p = fetch(`${BASE}data/galactic/${file}`).then((r) => {
      if (!r.ok) throw new Error(`data/galactic/${file}: HTTP ${r.status}`);
      return r.json() as Promise<T>;
    });
    p.catch(() => cache.delete(file));
    cache.set(file, p);
  }
  return p;
}

export const loadMilkyWay = (): Promise<MilkyWayJson> => loadJson<MilkyWayJson>('milkyway.json');
export const loadSgra = (): Promise<SgraJson> => loadJson<SgraJson>('sgra.json');
export const loadLandmarks = (): Promise<{ objects: LandmarkJson[]; references?: Record<string, RefEntry> }> => loadJson('landmarks.json');
export const loadMessier = (): Promise<{ objects: MessierJson[] }> => loadJson('messier.json');

/** Data-file uncertainty → provenance Uncertainty. */
export function toUncertainty(u: RawQuantity['uncertainty']): Uncertainty | undefined {
  if (!u) return undefined;
  if (typeof u.value === 'number') return { kind: 'symmetric', sigma: u.value };
  if (typeof u.plus === 'number' && typeof u.minus === 'number') return { kind: 'asymmetric', plus: u.plus, minus: u.minus };
  if (typeof u.stat === 'number' && typeof u.sys === 'number') return { kind: 'symmetric', sigma: Math.hypot(u.stat, u.sys) };
  return undefined;
}

/** Data-file quantity → provenance Quantity (null-safe: a missing value stays null = Unknown). */
export function toQuantity(raw: RawQuantity | undefined | null, datasetId: string, refs: Record<string, RefEntry> | undefined, provenance: ProvenanceClass = 'observed', unitOverride?: string): Quantity {
  const ref = raw?.ref && refs?.[raw.ref];
  const source: SourceRef = { datasetId, reference: ref ? ref.citation : raw?.ref, note: raw?.note };
  return {
    value: raw?.value ?? null,
    unit: unitOverride ?? normalizeUnit(raw?.unit ?? ''),
    uncertainty: toUncertainty(raw?.uncertainty),
    provenance,
    source,
  };
}

function normalizeUnit(u: string): string {
  switch (u) {
    case 'Msun': return 'M_sun';
    case 'uas': return 'µas';
    default: return u;
  }
}

/** Parse the Gillessen 2017 S-star table into element records (S2 replaced by the GRAVITY 2020 fit). */
export function parseSStars(j: SgraJson, s2: SStarElements): SStarElements[] {
  const t = j.sStars.gillessen2017;
  const f = (row: (string | number | null)[], k: string): string | number | null => row[t.fields.indexOf(k)] ?? null;
  const out: SStarElements[] = [];
  for (const row of t.rows) {
    const id = String(f(row, 'id'));
    if (id === 'S2') { out.push(s2); continue; }
    const num = (k: string): number | null => { const v = f(row, k); return typeof v === 'number' ? v : null; };
    const a = num('semiMajorAxisMas'), e = num('eccentricity');
    if (a === null || e === null) continue;
    out.push({
      id,
      aMas: a,
      e,
      iDeg: num('inclinationDeg') ?? 0,
      OmegaDeg: num('longitudeAscendingNodeDeg') ?? 0,
      omegaDeg: num('argumentPericentreDeg') ?? 0,
      tPeriYr: num('tPeriYr') ?? 2000,
      periodYr: e < 1 ? num('periodYr') : null,
      spectralClass: (f(row, 'spectralClass') as string | null) ?? null,
      kMag: num('kMag'),
      flag: (f(row, 'flag') as string | null) ?? null,
    });
  }
  return out;
}
