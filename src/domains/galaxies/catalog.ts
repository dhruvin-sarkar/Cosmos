/**
 * Galaxies catalogue: famous.json (curated, 37) merged with the UNGC local volume (local.json, 869 → ~830 after
 * de-duplication), structures.json (groups/clusters/superclusters/voids/walls) and the impostor index
 * (public/textures/galaxies/impostors.json, built by scripts/data/galaxies/build-impostors.py).
 * Positions: ICRS, Mpc from the Solar System (heliocentric distance; the barycentre offset is irrelevant here).
 */
import type { AssetLoader } from '../../core/types';
import { colorForTType, discAxes, hashUnit, relativeSurfaceBrightness, skyBasis, slugName, type V3 } from './math';

interface Table { fields: string[]; rows: unknown[][] }
type Row = Record<string, unknown>;

function rowsOf(t: Table): Row[] {
  return t.rows.map((r) => {
    const o: Row = {};
    t.fields.forEach((f, k) => { o[f] = r[k]; });
    return o;
  });
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

export interface ImpostorMeta {
  id: string;
  raDeg: number;
  decDeg: number;
  fovDeg: number;
  semiMajorArcmin: number;
  positionAngleDeg: number;
  inclinationDeg: number;
  positionAngleSource: string;
  inclinationSource: string;
  meanColorLinear: [number, number, number];
  fillFraction: number;
  file?: string;
  fileLow?: string;
  /** 2048 px tier when `file` is 4096 px (M31, M33). */
  fileMid?: string;
  /** Companions / foreground objects removed from the image (build-impostors.py COMPANIONS). */
  masked?: string;
  atlasSlot?: number;
  note?: string;
}

export interface ImpostorIndex {
  atlas: { files: { '4k': string; '2k': string }; grid: number };
  credit: string;
  license: string;
  source: string;
  processing: string;
  entries: ImpostorMeta[];
}

export type OrientationSource = 'catalogue' | 'image-moments' | 'illustrative';

export interface Galaxy {
  id: string;
  name: string;
  aliases: string[];
  source: 'famous' | 'ungc';
  raDeg: number;
  decDeg: number;
  distMpc: number;
  distErrMpc: number | null;
  distRef: string | null;
  distMethod: string | null;
  morphology: string | null;
  tType: number | null;
  majorAxisArcmin: number | null;
  /** Linear Holmberg/D25 diameter, kpc (null = unknown; the renderer then assumes 3 kpc and says so). */
  majorAxisKpc: number | null;
  inclinationDeg: number | null;
  positionAngleDeg: number | null;
  orientationSource: OrientationSource;
  orientationRef: string | null;
  absMagB: number | null;
  logMstarMsun: number | null;
  logMHIMsun: number | null;
  vHelioKms: number | null;
  vLgKms: number | null;
  bhMassMsun: number | null;
  bhRef: string | null;
  mainDisturber: string | null;
  /** Spheroids (E, S0, dE, dSph) and irregular/peculiar systems are drawn as view-facing ellipses. */
  spheroid: boolean;
  parentId: string;
  importance: number;
  /** Derived render inputs. */
  pos: V3;
  normal: V3;
  majorAxis: V3;
  minorAxis: V3;
  color: [number, number, number];
  surfaceBrightness: number;
  impostor: ImpostorMeta | null;
}

export type StructureKind = 'group' | 'cluster' | 'supercluster' | 'void' | 'wall';

export interface Structure {
  id: string;
  name: string;
  kind: StructureKind;
  raDeg: number;
  decDeg: number;
  redshift: number | null;
  distMpc: number;
  radiusMpc: number;
  members: number | null;
  membersNote: string | null;
  positionQuality: 'catalogued' | 'approximate';
  description: string;
  refs: string[];
  parentId: string;
  pos: V3;
}

export interface GalaxyCatalog {
  galaxies: Galaxy[];
  byId: Map<string, Galaxy>;
  structures: Structure[];
  structuresById: Map<string, Structure>;
  impostors: ImpostorIndex | null;
}

const STRUCT_IDS: Record<string, string> = {
  virgo: 'struct:virgo-cluster', fornax: 'struct:fornax-cluster', coma: 'struct:coma-cluster',
  perseus: 'struct:perseus-cluster', norma: 'struct:norma-cluster', centaurus: 'struct:centaurus-cluster',
  hydra: 'struct:hydra-cluster',
};
export const structureEntityId = (id: string): string => STRUCT_IDS[id] ?? `struct:${id}`;

/** Structures inside Laniakea (Tully et al. 2014, Nature 513, 71); the rest sit in the wider cosmic web. */
const IN_LANIAKEA = new Set(['local-group', 'm81-group', 'sculptor-group', 'cena-m83-group', 'virgo', 'fornax', 'norma',
  'centaurus', 'hydra', 'local-void', 'great-attractor']);

export const OBSERVABLE_UNIVERSE_ID = 'cosmo:observable-universe';
export const MILKY_WAY_ID = 'mw:galaxy';
export const LOCAL_GROUP_ID = 'struct:local-group';
export const LANIAKEA_ID = 'struct:laniakea';

/** Drawn as view-facing ellipses: the image projection already is what we see; no disc to deproject. */
const BILLBOARD_IDS = new Set(['gal:cena', 'gal:antennae', 'gal:m87', 'gal:m32', 'gal:maffei1', 'gal:smc']);

function isSpheroidMorph(m: string | null, t: number | null): boolean {
  if (m && /(^|[^a-z])(dE|Sph|dSph|cE|E\d?|S0|dS0|giant elliptical|elliptical)/i.test(m) && !/spiral/i.test(m)) return true;
  return t !== null && t <= -2;
}

function parentFor(name: string, distMpc: number, mainDisturber: string | null, structs: Structure[]): string {
  if (distMpc < 0.3) return MILKY_WAY_ID;
  if (mainDisturber === 'MESSIER031' && distMpc < 1.2) return 'gal:m31';
  if (distMpc < 1.5) return LOCAL_GROUP_ID;
  void name;
  for (const s of structs) {
    if (s.kind !== 'group' && s.kind !== 'cluster') continue;
    if (s.id === LOCAL_GROUP_ID) continue;
    if (Math.abs(s.distMpc - distMpc) < s.radiusMpc * 1.6) return s.id;
  }
  return LANIAKEA_ID;
}

export async function loadGalaxyCatalog(assets: AssetLoader): Promise<GalaxyCatalog> {
  const [famousT, localT, structT, imp] = await Promise.all([
    assets.json<Table>('data/galaxies/famous.json'),
    assets.json<Table>('data/galaxies/local.json'),
    assets.json<Table>('data/galaxies/structures.json'),
    assets.json<ImpostorIndex>('textures/galaxies/impostors.json').catch(() => null),
  ]);
  return buildGalaxyCatalog(famousT, localT, structT, imp);
}

export function buildGalaxyCatalog(famousT: Table, localT: Table, structT: Table, imp: ImpostorIndex | null): GalaxyCatalog {
  const impById = new Map<string, ImpostorMeta>((imp?.entries ?? []).map((e) => [e.id, e]));
  const structures: Structure[] = rowsOf(structT).map((r) => {
    const id = String(r.id);
    const dist = num(r.distMpc) ?? 1;
    const b = skyBasis(num(r.raDeg) ?? 0, num(r.decDeg) ?? 0).c;
    return {
      id: structureEntityId(id), name: String(r.name), kind: r.kind as StructureKind,
      raDeg: num(r.raDeg) ?? 0, decDeg: num(r.decDeg) ?? 0, redshift: num(r.redshift), distMpc: dist,
      radiusMpc: num(r.radiusMpc) ?? 1, members: num(r.members), membersNote: str(r.membersNote),
      positionQuality: r.positionQuality === 'catalogued' ? 'catalogued' : 'approximate',
      description: String(r.description ?? ''), refs: Array.isArray(r.refs) ? (r.refs as string[]) : [],
      parentId: id === 'laniakea' ? OBSERVABLE_UNIVERSE_ID : IN_LANIAKEA.has(id) ? LANIAKEA_ID : OBSERVABLE_UNIVERSE_ID,
      pos: { x: b.x * dist, y: b.y * dist, z: b.z * dist },
    };
  });
  // The Great Attractor: the overdensity towards the Norma cluster region (Lynden-Bell et al. 1988; Kraan-Korteweg
  // et al. 1996). Laniakea's catalogued centre is placed there too; position approximate.
  const norma = structures.find((s) => s.id === 'struct:norma-cluster');
  if (norma) {
    structures.push({
      ...norma, id: 'struct:great-attractor', name: 'Great Attractor', kind: 'supercluster', radiusMpc: 20, members: null,
      membersNote: null, positionQuality: 'approximate', parentId: LANIAKEA_ID,
      description: 'A gravitational focus of the local flow of galaxies, centred near the Norma cluster behind the Zone of Avoidance; galaxies within Laniakea stream towards it.',
      refs: ['Lynden-Bell et al. 1988, ApJ 326, 19', 'Kraan-Korteweg et al. 1996, Nature 379, 519', 'Tully et al. 2014, Nature 513, 71'],
    });
  }
  const groupsForParent = structures.filter((s) => s.kind === 'group' || s.kind === 'cluster');

  const galaxies: Galaxy[] = [];
  const famous = rowsOf(famousT);
  const famousUngc = new Set(famous.map((f) => str(f.ungcName)).filter((v): v is string => v !== null));
  const local = rowsOf(localT);
  const localByName = new Map(local.map((r) => [String(r.name), r]));

  const add = (g: Omit<Galaxy, 'pos' | 'normal' | 'majorAxis' | 'minorAxis' | 'color' | 'surfaceBrightness' | 'impostor' | 'orientationSource'> & { orientationSource?: OrientationSource }): void => {
    const im = impById.get(g.id) ?? null;
    let pa = g.positionAngleDeg, inc = g.inclinationDeg;
    let src: OrientationSource = g.orientationSource ?? (pa !== null && inc !== null ? 'catalogue' : 'illustrative');
    if (im) {
      if (pa === null) { pa = im.positionAngleDeg; src = 'image-moments'; }
      if (inc === null) { inc = im.inclinationDeg; if (src === 'catalogue') src = 'image-moments'; }
    }
    if (pa === null) pa = hashUnit(g.id, 1) * 180;
    if (inc === null) inc = Math.acos(hashUnit(g.id, 2)) * 180 / Math.PI;
    const ax = discAxes(g.raDeg, g.decDeg, pa, inc);
    const c = skyBasis(g.raDeg, g.decDeg).c;
    const color = im ? normalise(im.meanColorLinear) : colorForTType(g.tType);
    galaxies.push({
      ...g, positionAngleDeg: g.positionAngleDeg, inclinationDeg: g.inclinationDeg, orientationSource: src,
      pos: { x: c.x * g.distMpc, y: c.y * g.distMpc, z: c.z * g.distMpc },
      normal: ax.normal, majorAxis: ax.a, minorAxis: ax.b, color,
      surfaceBrightness: relativeSurfaceBrightness(g.absMagB, g.majorAxisKpc),
      impostor: im ? { ...im, positionAngleDeg: pa, inclinationDeg: inc } : null,
    });
  };

  for (const f of famous) {
    const id = `gal:${String(f.id)}`;
    const u = str(f.ungcName) ? localByName.get(String(f.ungcName)) : undefined;
    const dist = num(f.distMpc) ?? num(u?.distMpc) ?? 1;
    const morph = str(f.morphology);
    const tType = num(f.tType) ?? num(u?.tType);
    const name = String(f.name);
    add({
      id, name, aliases: [...((f.aliases as string[]) ?? []), ...(u ? ((u.aliases as string[]) ?? []) : []), ...(u ? [String(u.name)] : [])],
      source: 'famous', raDeg: num(f.raDeg) ?? 0, decDeg: num(f.decDeg) ?? 0, distMpc: dist,
      distErrMpc: num(f.distErrMpc), distRef: str(f.distRef), distMethod: u ? str(u.distMethod) : null,
      morphology: morph, tType,
      majorAxisArcmin: num(f.majorAxisArcmin) ?? num(u?.majorAxisArcmin),
      majorAxisKpc: num(f.majorAxisKpc) ?? num(u?.majorAxisKpc),
      inclinationDeg: num(f.inclinationDeg) ?? num(u?.inclinationDeg), positionAngleDeg: num(f.positionAngleDeg),
      orientationRef: str(f.orientationRef),
      absMagB: num(f.absMagB) ?? num(u?.absMagB), logMstarMsun: num(f.logMstarMsun) ?? num(u?.logMstarMsun),
      logMHIMsun: u ? num(u.logMHIMsun) : null, vHelioKms: num(f.vHelioKms) ?? num(u?.vHelioKms), vLgKms: u ? num(u.vLgKms) : null,
      bhMassMsun: num(f.bhMassMsun), bhRef: str(f.bhRef), mainDisturber: u ? str(u.mainDisturber) : null,
      spheroid: BILLBOARD_IDS.has(id) || isSpheroidMorph(morph, tType),
      parentId: id === 'gal:m32' ? 'gal:m31' : parentFor(name, dist, u ? str(u.mainDisturber) : null, groupsForParent),
      importance: id === 'gal:m31' ? 92 : ['gal:m33', 'gal:lmc', 'gal:smc'].includes(id) ? 82 : 66,
    });
  }
  for (const r of local) {
    const name = String(r.name);
    if (famousUngc.has(name) || name === 'Milky Way' || name === 'LMC' || name === 'SMC') continue;
    const dist = num(r.distMpc);
    if (dist === null) continue;
    const id = `gal:ungc:${slugName(name)}`;
    const morph = str(r.morphology);
    const tType = num(r.tType);
    const absB = num(r.absMagB);
    add({
      id, name, aliases: (r.aliases as string[]) ?? [], source: 'ungc',
      raDeg: num(r.raDeg) ?? 0, decDeg: num(r.decDeg) ?? 0, distMpc: dist, distErrMpc: num(r.distErrMpc),
      distRef: 'Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (UNGC)', distMethod: str(r.distMethod),
      morphology: morph, tType, majorAxisArcmin: num(r.majorAxisArcmin), majorAxisKpc: num(r.majorAxisKpc),
      inclinationDeg: num(r.inclinationDeg), positionAngleDeg: null, orientationRef: null,
      absMagB: absB, logMstarMsun: num(r.logMstarMsun), logMHIMsun: num(r.logMHIMsun),
      vHelioKms: num(r.vHelioKms), vLgKms: num(r.vLgKms), bhMassMsun: null, bhRef: null,
      mainDisturber: str(r.mainDisturber), spheroid: isSpheroidMorph(morph, tType),
      parentId: parentFor(name, dist, str(r.mainDisturber), groupsForParent),
      importance: Math.round(Math.min(60, Math.max(8, 30 + (-(absB ?? -12) - 14) * 4))),
    });
  }
  return {
    galaxies, byId: new Map(galaxies.map((g) => [g.id, g])), structures,
    structuresById: new Map(structures.map((s) => [s.id, s])), impostors: imp,
  };
}

function normalise(c: [number, number, number]): [number, number, number] {
  const m = Math.max(c[0], c[1], c[2], 1e-6);
  return [c[0] / m, c[1] / m, c[2] / m];
}
