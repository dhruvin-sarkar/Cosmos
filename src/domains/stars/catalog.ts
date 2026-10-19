/**
 * Star catalogue runtime: loads public/data/stars/* (HYG v4.4 field, named stars, HIP index, constellations,
 * star systems) into flat typed arrays the layers and the entity provider share.
 *
 * Frame: heliocentric ICRS/J2000 Cartesian (stars.json `frame`), parsecs on disk, metres at runtime. The Sun–SSB
 * offset (< 1e9 m) is far below anything visible at stellar distances, so the catalogue origin is used as the SSB.
 */
import { PC_M } from '../../core/units';
import { parseInterleavedFloat32 } from '../../data/binary';
import { stellarRadiusRsun } from './photometry';

export interface StarsHeader {
  count: number;
  stride: number;
  fields: string[];
  [k: string]: unknown;
}

/** Row of stars-named.json, decoded. Null = not available in the source. */
export interface NamedStar {
  index: number | null;
  hip: number | null;
  hd: number | null;
  hr: number | null;
  gl: string | null;
  bayerFlamsteed: string | null;
  properName: string | null;
  constellation: string | null;
  spectralType: string | null;
  apparentMag: number | null;
  absMag: number | null;
  distPc: number | null;
  raDeg: number | null;
  decDeg: number | null;
  colorIndexBV: number | null;
  luminositySolar: number | null;
  variableName: string | null;
  hygId: number | null;
  properNameSource: string | null;
}

export interface ConstellationRecord {
  abbr: string;
  name: string;
  genitive: string;
  englishName: string | null;
  /** [hipA, hipB] segments. */
  lines: [number, number][];
  labelRaDeg: number;
  labelDecDeg: number;
  areaDeg2: number | null;
  /** Boundary rings, [raDeg, decDeg] vertices, implicitly closed. */
  rings: [number, number][][];
}

export interface StarSystemMember {
  index: number | null;
  hygId: number | null;
  properName: string | null;
  gl: string | null;
  comp: number | null;
  apparentMag: number | null;
}

export interface StarSystem {
  base: string;
  primaryHygId: number | null;
  distPc: number | null;
  members: StarSystemMember[];
}

export interface StarCatalog {
  count: number;
  /** xyz per star, metres (float64), ICRS, catalogue origin = Sun. */
  positionsM: Float64Array;
  /** Distance from the Sun, pc. */
  distPc: Float32Array;
  absMag: Float32Array;
  /** B−V; NaN when unknown. */
  bv: Float32Array;
  /** Teff (K) for rendering; −1 when unknown. */
  teffK: Float32Array;
  /** Derived photospheric radius, R☉ (see photometry.ts). */
  radiusRsun: Float32Array;
  /** HIP number per star index (0 = none). */
  hipOf: Int32Array;
  /** Companions whose distance was set to their primary's (parallax noise ≫ true separation). */
  snappedToPrimary: Set<number>;
  header: StarsHeader;
  /** Detail rows (after loadDetails). */
  details?: StarDetails;
}

export interface StarDetails {
  named: NamedStar[];
  /** star index → named row. */
  namedByIndex: Map<number, NamedStar>;
  /** hygId → named row (stars without a usable distance have no index). */
  namedByHyg: Map<number, NamedStar>;
  hipToIndex: Map<number, number>;
  hdToIndex: Map<number, number>;
  hrToIndex: Map<number, number>;
  glToIndex: Map<string, number>;
  constellations: ConstellationRecord[];
  systems: StarSystem[];
  /** star index → system. */
  systemOf: Map<number, StarSystem>;
  sources: { constellations: Record<string, { id: string; citation?: string; license?: string }> };
}

export type FetchBinary = (path: string) => Promise<ArrayBuffer>;
export type FetchJson = <T>(path: string) => Promise<T>;

export const STARS_DIR = 'data/stars/';
/** Companions closer (in projection) than this to their primary take the primary's distance. */
const SNAP_PROJECTED_AU = 2000;
const AU_PER_PC = 206_264.806;

export async function loadStarCatalog(fetchJson: FetchJson, fetchBinary: FetchBinary): Promise<StarCatalog> {
  // The query string matters: on the exhibition machine Chrome answers bare `*.bin` URLs with an empty 204
  // (an interception outside the dev server; `?v=` requests pass), so never request the bare path.
  const header = await fetchJson<StarsHeader>(STARS_DIR + 'stars.json');
  const buf = await fetchBinary(`${STARS_DIR}${typeof header.file === 'string' ? header.file : 'stars.bin'}?v=${String(header.byteLength ?? 1)}`);
  const parsed = parseInterleavedFloat32(buf, header as never, { label: 'stars.bin' });
  const n = parsed.count;
  const data = parsed.data;
  const stride = parsed.stride;
  const ox = parsed.offsetOf('xPc'), oy = parsed.offsetOf('yPc'), oz = parsed.offsetOf('zPc');
  const om = parsed.offsetOf('absMagV'), ob = parsed.offsetOf('colorIndexBV'), ot = parsed.offsetOf('teffK');
  const positionsM = new Float64Array(3 * n);
  const distPc = new Float32Array(n);
  const absMag = new Float32Array(n);
  const bv = new Float32Array(n);
  const teffK = new Float32Array(n);
  const radiusRsun = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const b = i * stride;
    const x = data[b + ox], y = data[b + oy], z = data[b + oz];
    positionsM[3 * i] = x * PC_M;
    positionsM[3 * i + 1] = y * PC_M;
    positionsM[3 * i + 2] = z * PC_M;
    distPc[i] = Math.hypot(x, y, z);
    absMag[i] = data[b + om];
    bv[i] = data[b + ob];
    const t = data[b + ot];
    teffK[i] = Number.isFinite(t) && t > 0 ? t : -1;
    radiusRsun[i] = stellarRadiusRsun(absMag[i], teffK[i] > 0 ? teffK[i] : null);
  }
  return {
    count: n,
    positionsM,
    distPc,
    absMag,
    bv,
    teffK,
    radiusRsun,
    hipOf: new Int32Array(n),
    snappedToPrimary: new Set(),
    header,
  };
}

interface TableJson {
  fields: string[];
  rows: unknown[][];
  [k: string]: unknown;
}

interface ConstellationsJson {
  source: Record<string, { id: string; citation?: string; license?: string }>;
  constellations: {
    abbr: string;
    name: string;
    genitive: string;
    englishName?: string;
    lines: [number, number][];
    labelRaDeg: number;
    labelDecDeg: number;
    areaDeg2?: number;
    boundary: number[][][] | number[][];
    boundaryParts?: string[];
  }[];
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

/** Normalise the boundary encoding (rings of vertices, or one vertex per entry grouped by boundaryParts). */
export function normalizeBoundary(boundary: unknown, parts?: string[]): [number, number][][] {
  if (!Array.isArray(boundary) || boundary.length === 0) return [];
  const isVertex = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && typeof v[0] === 'number';
  if (isVertex(boundary[0])) return [boundary.filter(isVertex)];
  const rings = boundary as unknown[][];
  const singletons = rings.every((r) => Array.isArray(r) && r.length === 1);
  if (!singletons) return rings.map((r) => r.filter(isVertex)).filter((r) => r.length > 1);
  const out: [number, number][][] = [];
  let current: [number, number][] = [];
  let part: string | undefined;
  for (let i = 0; i < rings.length; i++) {
    const p = parts && parts.length === rings.length ? parts[i] : undefined;
    if (i > 0 && p !== part) {
      if (current.length > 1) out.push(current);
      current = [];
    }
    part = p;
    const v = rings[i][0];
    if (isVertex(v)) current.push(v);
  }
  if (current.length > 1) out.push(current);
  return out;
}

export async function loadStarDetails(cat: StarCatalog, fetchJson: FetchJson): Promise<StarDetails> {
  const [namedJ, hipJ, constJ, sysJ] = await Promise.all([
    fetchJson<TableJson>(STARS_DIR + 'stars-named.json'),
    fetchJson<Record<string, number>>(STARS_DIR + 'hip-index.json'),
    fetchJson<ConstellationsJson>(STARS_DIR + 'constellations.json'),
    fetchJson<TableJson & { memberFields: string[] }>(STARS_DIR + 'star-systems.json').catch(() => null),
  ]);

  const hipToIndex = new Map<number, number>();
  for (const k in hipJ) {
    const idx = hipJ[k];
    const hip = Number(k);
    if (!Number.isInteger(hip) || typeof idx !== 'number' || idx < 0 || idx >= cat.count) continue;
    hipToIndex.set(hip, idx);
    cat.hipOf[idx] = hip;
  }

  const f = namedJ.fields;
  const col = (name: string): number => f.indexOf(name);
  const c = {
    index: col('index'), hip: col('hip'), hd: col('hd'), hr: col('hr'), gl: col('gl'), bayer: col('bayerFlamsteed'),
    proper: col('properName'), con: col('constellation'), sp: col('spectralType'), app: col('apparentMag'),
    abs: col('absMag'), dist: col('distPc'), ra: col('raDeg'), dec: col('decDeg'), bv: col('colorIndexBV'),
    lum: col('luminositySolar'), varName: col('variableName'), hyg: col('hygId'), src: col('properNameSource'),
  };
  const at = (r: unknown[], i: number): unknown => (i >= 0 ? r[i] : null);
  const named: NamedStar[] = [];
  const namedByIndex = new Map<number, NamedStar>();
  const namedByHyg = new Map<number, NamedStar>();
  const hdToIndex = new Map<number, number>();
  const hrToIndex = new Map<number, number>();
  const glToIndex = new Map<string, number>();
  for (const r of namedJ.rows) {
    const s: NamedStar = {
      index: num(at(r, c.index)), hip: num(at(r, c.hip)), hd: num(at(r, c.hd)), hr: num(at(r, c.hr)),
      gl: str(at(r, c.gl)), bayerFlamsteed: str(at(r, c.bayer)), properName: str(at(r, c.proper)),
      constellation: str(at(r, c.con)), spectralType: str(at(r, c.sp)), apparentMag: num(at(r, c.app)),
      absMag: num(at(r, c.abs)), distPc: num(at(r, c.dist)), raDeg: num(at(r, c.ra)), decDeg: num(at(r, c.dec)),
      colorIndexBV: num(at(r, c.bv)), luminositySolar: num(at(r, c.lum)), variableName: str(at(r, c.varName)),
      hygId: num(at(r, c.hyg)), properNameSource: str(at(r, c.src)),
    };
    named.push(s);
    if (s.hygId !== null) namedByHyg.set(s.hygId, s);
    if (s.index === null || s.index < 0 || s.index >= cat.count) continue;
    namedByIndex.set(s.index, s);
    if (s.hd !== null) hdToIndex.set(s.hd, s.index);
    if (s.hr !== null) hrToIndex.set(s.hr, s.index);
    if (s.gl) glToIndex.set(normalizeGl(s.gl), s.index);
  }

  const constellations: ConstellationRecord[] = constJ.constellations.map((k) => ({
    abbr: k.abbr,
    name: k.name,
    genitive: k.genitive,
    englishName: k.englishName ?? null,
    lines: k.lines,
    labelRaDeg: k.labelRaDeg,
    labelDecDeg: k.labelDecDeg,
    areaDeg2: typeof k.areaDeg2 === 'number' && k.areaDeg2 > 0 ? k.areaDeg2 : null,
    rings: normalizeBoundary(k.boundary, k.boundaryParts),
  }));

  const systems: StarSystem[] = [];
  const systemOf = new Map<number, StarSystem>();
  if (sysJ) {
    const sf = sysJ.fields, mf = sysJ.memberFields;
    const mi = (n: string): number => mf.indexOf(n);
    for (const r of sysJ.rows) {
      const membersRaw = (r[sf.indexOf('members')] as unknown[][]) ?? [];
      const sys: StarSystem = {
        base: String(r[sf.indexOf('base')]),
        primaryHygId: num(r[sf.indexOf('primaryHygId')]),
        distPc: num(r[sf.indexOf('distPc')]),
        members: membersRaw.map((m) => ({
          index: num(m[mi('index')]), hygId: num(m[mi('hygId')]), properName: str(m[mi('properName')]),
          gl: str(m[mi('gl')]), comp: num(m[mi('comp')]), apparentMag: num(m[mi('apparentMag')]),
        })),
      };
      systems.push(sys);
      for (const m of sys.members) if (m.index !== null) systemOf.set(m.index, sys);
    }
    snapCompanions(cat, systems);
  }

  const details: StarDetails = {
    named, namedByIndex, namedByHyg, hipToIndex, hdToIndex, hrToIndex, glToIndex, constellations, systems, systemOf,
    sources: { constellations: constJ.source },
  };
  cat.details = details;
  return details;
}

/**
 * Close companions inherit the primary's distance: independent parallaxes of a visual binary differ by far more
 * than the true separation (e.g. a 0.5 mas difference at 10 pc is 0.05 pc ≈ 10 000 AU), which would tear systems
 * apart in 3-D. The directions (observed) are kept; only the radial coordinate changes (derived).
 */
function snapCompanions(cat: StarCatalog, systems: StarSystem[]): void {
  const p = cat.positionsM;
  for (const sys of systems) {
    const primary = sys.members.find((m) => m.hygId === sys.primaryHygId && m.index !== null) ?? sys.members.find((m) => m.index !== null);
    if (!primary || primary.index === null) continue;
    const pi = primary.index;
    const dp = cat.distPc[pi];
    for (const m of sys.members) {
      if (m.index === null || m.index === pi) continue;
      const i = m.index;
      const di = cat.distPc[i];
      if (!(di > 0) || !(dp > 0) || Math.abs(di - dp) < 1e-9) continue;
      const cosA = (p[3 * i] * p[3 * pi] + p[3 * i + 1] * p[3 * pi + 1] + p[3 * i + 2] * p[3 * pi + 2]) / (di * dp * PC_M * PC_M);
      const sepAu = Math.acos(Math.min(1, Math.max(-1, cosA))) * dp * AU_PER_PC;
      if (sepAu > SNAP_PROJECTED_AU) continue;
      const k = dp / di;
      p[3 * i] *= k;
      p[3 * i + 1] *= k;
      p[3 * i + 2] *= k;
      // Keep the observed apparent magnitude: M changes with the new distance.
      cat.absMag[i] -= 5 * Math.log10(k);
      cat.distPc[i] = dp;
      cat.radiusRsun[i] = stellarRadiusRsun(cat.absMag[i], cat.teffK[i] > 0 ? cat.teffK[i] : null);
      cat.snappedToPrimary.add(i);
    }
  }
}

/** "Gl 559A", "GJ 559 A", "Gliese 559a" → "559A". */
export function normalizeGl(s: string): string {
  return s.replace(/^\s*(gliese|gl|gj|nn|wo)\s*/i, '').replace(/\s+/g, '').toUpperCase();
}
