/**
 * Compact, columnar exoplanet catalogue built from the NASA Exoplanet Archive snapshot (public/data/exoplanets/
 * planets.json + systems.json; docs/data/exoplanets.md). The raw files are ~6.5 MB of JSON (≈ 190 ms to parse), so
 * the app parses them in a worker (catalog.worker.ts) and receives only these typed arrays + string tables. Full
 * rows (uncertainties, references) stay in the worker and are fetched per planet for fact sheets.
 *
 * Conventions: NaN = null in the archive ("Unknown", never 0); integers use 0 / −1 sentinels as documented below.
 */

/** Discovery-method groups (marker colours, filters). Timing = pulsar / eclipse / transit / pulsation timing. */
export const METHOD_GROUPS = ['Transit', 'Radial velocity', 'Imaging', 'Microlensing', 'Timing', 'Astrometry', 'Other'] as const;
export type MethodGroup = (typeof METHOD_GROUPS)[number];
export const METHOD_ALL_MASK = (1 << METHOD_GROUPS.length) - 1;

/** Okabe–Ito categorical colours per method group (VISUAL_DIRECTION: categories use Okabe–Ito). */
export const METHOD_COLORS: readonly string[] = ['#56B4E9', '#E69F00', '#CC79A7', '#009E73', '#F0E442', '#D55E00', '#9E9E9E'];

export function methodGroupCode(method: string | null | undefined): number {
  switch (method) {
    case 'Transit': return 0;
    case 'Radial Velocity': return 1;
    case 'Imaging': return 2;
    case 'Microlensing': return 3;
    case 'Eclipse Timing Variations':
    case 'Transit Timing Variations':
    case 'Pulsar Timing':
    case 'Pulsation Timing Variations': return 4;
    case 'Astrometry': return 5;
    default: return 6;
  }
}

/** pl_bmassprov codes. */
export const MASS_PROV = ['', 'Mass', 'Msini', 'Msin(i)/sin(i)', 'M-R relationship'] as const;

export interface ExoPlanets {
  count: number;
  name: string[];
  letter: string[];
  /** Host index (systems row), −1 when unknown. */
  host: Int32Array;
  /** Method group code (METHOD_GROUPS). */
  method: Uint8Array;
  /** Index into ExoCatalog.methodNames (archive discoverymethod string). */
  methodRaw: Uint8Array;
  /** Discovery year, 0 = unknown. */
  year: Int16Array;
  periodDays: Float64Array;
  aAu: Float64Array;
  ecc: Float64Array;
  inclDeg: Float64Array;
  /** Argument of periastron, deg. */
  omegaDeg: Float64Array;
  /** Transit midpoint, JD (BJD-TDB for nearly all rows). */
  tMidJd: Float64Array;
  radiusE: Float64Array;
  massE: Float64Array;
  /** Index into MASS_PROV (0 = no mass). */
  massProv: Uint8Array;
  densGcc: Float64Array;
  insolE: Float64Array;
  eqtK: Float64Array;
  /** 1 = circumbinary. */
  cb: Uint8Array;
  /** 1 = controversial. */
  controv: Uint8Array;
  /** Bit flags: value computed by the archive (refIdx = calculatedRefIdx): 1 radius, 2 a, 4 insolation, 8 Teq. */
  calc: Uint8Array;
}

export interface ExoHosts {
  count: number;
  name: string[];
  /** ICRS Cartesian, pc (NaN = no distance: never placed in 3-D). */
  xPc: Float64Array;
  yPc: Float64Array;
  zPc: Float64Array;
  distPc: Float64Array;
  raDeg: Float64Array;
  decDeg: Float64Array;
  teffK: Float64Array;
  radiusSun: Float64Array;
  massSun: Float64Array;
  /** log10(L/L☉). */
  logLum: Float64Array;
  metDex: Float64Array;
  ageGyr: Float64Array;
  vmag: Float64Array;
  /** Planets in planets.json rows (first = first row; rows are contiguous, period-ordered). */
  nPlanets: Uint16Array;
  firstPlanet: Int32Array;
  /** sy_snum, 0 = unknown. */
  nStars: Uint8Array;
  /** Archive sy_pnum (may exceed nPlanets in multiple-star systems). */
  sysPlanets: Uint16Array;
  spectype: string[];
  /** HIP number, 0 = none. */
  hip: Int32Array;
  hd: string[];
  /** Group code of the earliest-discovered planet (marker colour). */
  method: Uint8Array;
  /** Bitmask of all method groups of the host's planets. */
  methodMask: Uint8Array;
  /** Earliest discovery year, 0 = unknown. */
  firstYear: Int16Array;
}

export interface ExoCatalog {
  planets: ExoPlanets;
  hosts: ExoHosts;
  methodNames: string[];
  retrieved: string;
  acknowledgement: string;
  citation: string;
}

export interface RawTable {
  fields: string[];
  rows: unknown[][];
  retrieved?: string;
  acknowledgement?: string;
  citation?: string;
  calculatedRefIdx?: number;
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : NaN);
const str = (v: unknown): string => (typeof v === 'string' ? v : '');

function col(t: RawTable, name: string): number {
  const i = t.fields.indexOf(name);
  if (i < 0) throw new Error(`exoplanets catalogue: missing field ${name}`);
  return i;
}

function f64(t: RawTable, name: string): Float64Array {
  const c = col(t, name);
  const out = new Float64Array(t.rows.length);
  for (let i = 0; i < t.rows.length; i++) out[i] = num(t.rows[i][c]);
  return out;
}

/** Build the compact catalogue from the parsed archive tables (pure; used by the worker and by tests). */
export function buildCompactCatalog(planets: RawTable, systems: RawTable): ExoCatalog {
  const np = planets.rows.length;
  const nh = systems.rows.length;
  const cName = col(planets, 'pl_name'), cLetter = col(planets, 'pl_letter'), cSys = col(planets, 'sysIdx');
  const cMethod = col(planets, 'discoverymethod'), cYear = col(planets, 'disc_year'), cProv = col(planets, 'pl_bmassprov');
  const cCb = col(planets, 'cb_flag'), cCon = col(planets, 'pl_controv_flag');
  const methodNames: string[] = [];
  const methodIdx = new Map<string, number>();
  const p: ExoPlanets = {
    count: np,
    name: new Array<string>(np),
    letter: new Array<string>(np),
    host: new Int32Array(np),
    method: new Uint8Array(np),
    methodRaw: new Uint8Array(np),
    year: new Int16Array(np),
    periodDays: f64(planets, 'pl_orbper'),
    aAu: f64(planets, 'pl_orbsmax'),
    ecc: f64(planets, 'pl_orbeccen'),
    inclDeg: f64(planets, 'pl_orbincl'),
    omegaDeg: f64(planets, 'pl_orblper'),
    tMidJd: f64(planets, 'pl_tranmid'),
    radiusE: f64(planets, 'pl_rade'),
    massE: f64(planets, 'pl_bmasse'),
    massProv: new Uint8Array(np),
    densGcc: f64(planets, 'pl_dens'),
    insolE: f64(planets, 'pl_insol'),
    eqtK: f64(planets, 'pl_eqt'),
    cb: new Uint8Array(np),
    controv: new Uint8Array(np),
    calc: new Uint8Array(np),
  };
  const calcRef = planets.calculatedRefIdx ?? -1;
  const calcCols = ['pl_rade_refIdx', 'pl_orbsmax_refIdx', 'pl_insol_refIdx', 'pl_eqt_refIdx'].map((n) => col(planets, n));
  for (let i = 0; i < np; i++) {
    const r = planets.rows[i];
    p.name[i] = str(r[cName]);
    p.letter[i] = str(r[cLetter]);
    const s = r[cSys];
    p.host[i] = typeof s === 'number' ? s : -1;
    const m = str(r[cMethod]);
    let mi = methodIdx.get(m);
    if (mi === undefined) {
      mi = methodNames.length;
      methodNames.push(m);
      methodIdx.set(m, mi);
    }
    p.methodRaw[i] = mi;
    p.method[i] = methodGroupCode(m);
    const y = r[cYear];
    p.year[i] = typeof y === 'number' ? y : 0;
    const prov = MASS_PROV.indexOf(str(r[cProv]) as (typeof MASS_PROV)[number]);
    p.massProv[i] = prov > 0 && Number.isFinite(p.massE[i]) ? prov : 0;
    p.cb[i] = r[cCb] === 1 ? 1 : 0;
    p.controv[i] = r[cCon] === 1 ? 1 : 0;
    let flags = 0;
    for (let k = 0; k < calcCols.length; k++) if (r[calcCols[k]] === calcRef) flags |= 1 << k;
    p.calc[i] = flags;
  }

  const cHost = col(systems, 'hostname'), cN = col(systems, 'nPlanets'), cRows = col(systems, 'planetRows');
  const cSnum = col(systems, 'sy_snum'), cPnum = col(systems, 'sy_pnum'), cSpec = col(systems, 'st_spectype');
  const cHip = col(systems, 'hip_name'), cHd = col(systems, 'hd_name');
  const h: ExoHosts = {
    count: nh,
    name: new Array<string>(nh),
    xPc: f64(systems, 'xPc'),
    yPc: f64(systems, 'yPc'),
    zPc: f64(systems, 'zPc'),
    distPc: f64(systems, 'distPc'),
    raDeg: f64(systems, 'raDeg'),
    decDeg: f64(systems, 'decDeg'),
    teffK: f64(systems, 'st_teff'),
    radiusSun: f64(systems, 'st_rad'),
    massSun: f64(systems, 'st_mass'),
    logLum: f64(systems, 'st_lum'),
    metDex: f64(systems, 'st_met'),
    ageGyr: f64(systems, 'st_age'),
    vmag: f64(systems, 'sy_vmag'),
    nPlanets: new Uint16Array(nh),
    firstPlanet: new Int32Array(nh),
    nStars: new Uint8Array(nh),
    sysPlanets: new Uint16Array(nh),
    spectype: new Array<string>(nh),
    hip: new Int32Array(nh),
    hd: new Array<string>(nh),
    method: new Uint8Array(nh),
    methodMask: new Uint8Array(nh),
    firstYear: new Int16Array(nh),
  };
  for (let i = 0; i < nh; i++) {
    const r = systems.rows[i];
    h.name[i] = str(r[cHost]);
    const rows = Array.isArray(r[cRows]) ? (r[cRows] as number[]) : [];
    h.nPlanets[i] = typeof r[cN] === 'number' ? (r[cN] as number) : rows.length;
    h.firstPlanet[i] = rows.length ? rows[0] : -1;
    h.nStars[i] = typeof r[cSnum] === 'number' ? (r[cSnum] as number) : 0;
    h.sysPlanets[i] = typeof r[cPnum] === 'number' ? (r[cPnum] as number) : rows.length;
    h.spectype[i] = str(r[cSpec]);
    const hip = /HIP\s*(\d+)/.exec(str(r[cHip]));
    h.hip[i] = hip ? Number(hip[1]) : 0;
    h.hd[i] = str(r[cHd]);
    let firstYear = 0, method = 6, mask = 0;
    for (const k of rows) {
      const y = p.year[k];
      mask |= 1 << p.method[k];
      if (y > 0 && (firstYear === 0 || y < firstYear)) {
        firstYear = y;
        method = p.method[k];
      }
    }
    if (firstYear === 0 && rows.length) method = p.method[rows[0]];
    h.firstYear[i] = firstYear;
    h.method[i] = method;
    h.methodMask[i] = mask;
  }
  return {
    planets: p,
    hosts: h,
    methodNames,
    retrieved: planets.retrieved ?? '',
    acknowledgement: planets.acknowledgement ?? '',
    citation: planets.citation ?? '',
  };
}

/** Typed-array buffers of a catalogue (for postMessage transfer). */
export function catalogTransferables(c: ExoCatalog): ArrayBuffer[] {
  const out: ArrayBuffer[] = [];
  for (const group of [c.planets, c.hosts] as unknown as Record<string, unknown>[]) {
    for (const v of Object.values(group)) if (ArrayBuffer.isView(v)) out.push(v.buffer as ArrayBuffer);
  }
  return out;
}

/** Lookup indices built once on the main thread. */
export interface ExoIndex {
  planetByName: Map<string, number>;
  hostByName: Map<string, number>;
  hostByHip: Map<number, number>;
  /** Lower-case aliases (host name variants, HD, HIP) → host index. */
  hostAlias: Map<string, number>;
}

export function buildIndex(c: ExoCatalog): ExoIndex {
  const planetByName = new Map<string, number>();
  for (let i = 0; i < c.planets.count; i++) planetByName.set(c.planets.name[i], i);
  const hostByName = new Map<string, number>();
  const hostByHip = new Map<number, number>();
  const hostAlias = new Map<string, number>();
  for (let i = 0; i < c.hosts.count; i++) {
    const n = c.hosts.name[i];
    hostByName.set(n, i);
    hostAlias.set(n.toLowerCase(), i);
    if (c.hosts.hip[i] > 0) {
      hostByHip.set(c.hosts.hip[i], i);
      hostAlias.set(`hip ${c.hosts.hip[i]}`, i);
    }
    if (c.hosts.hd[i]) hostAlias.set(c.hosts.hd[i].toLowerCase(), i);
  }
  return { planetByName, hostByName, hostByHip, hostAlias };
}

/** Planet row indices of a host. */
export function hostPlanetRange(c: ExoCatalog, host: number): [number, number] {
  const f = c.hosts.firstPlanet[host];
  return f < 0 ? [0, 0] : [f, f + c.hosts.nPlanets[host]];
}

/** Entity ids. */
export const SYS_PREFIX = 'sys:';
export const EXO_PREFIX = 'exo:';
export const sysId = (host: string): string => SYS_PREFIX + host;
export const exoId = (planet: string): string => EXO_PREFIX + planet;
