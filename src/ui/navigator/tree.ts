/**
 * Solar-System navigator tree, built from the registry: Sun → planets and dwarf planets → their moons and notable
 * spacecraft. Nothing is hard-coded except the ordering hints below; any entity a domain registers with the right
 * kind and parent chain appears automatically. Pure logic (no React, no DOM) so it is unit-testable.
 */
import { Vector3 } from 'three';
import type { Entity, EntityKind, EntityProvider, EntityRegistry, SearchRecord } from '../../core/entity';

export const SUN_ID = 'sol:sun';

/** Mean heliocentric distance ordering (semi-major axis, AU) — ordering only, never displayed. */
const MEAN_DISTANCE_AU: Readonly<Record<string, number>> = {
  'sol:mercury': 0.387, 'sol:venus': 0.723, 'sol:earth': 1, 'sol:mars': 1.524, 'sol:ceres': 2.77,
  'sol:jupiter': 5.203, 'sol:saturn': 9.537, 'sol:uranus': 19.19, 'sol:neptune': 30.07,
  'sol:pluto': 39.48, 'sol:haumea': 43.1, 'sol:makemake': 45.4, 'sol:eris': 67.7,
};

/** Digit shortcuts: 0 Sun, 1–8 planets, 9 Pluto. */
export const DIGIT_TARGETS: readonly string[] = [
  SUN_ID, 'sol:mercury', 'sol:venus', 'sol:earth', 'sol:mars', 'sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune', 'sol:pluto',
];

const PRIMARY_KINDS: ReadonlySet<EntityKind> = new Set(['planet', 'dwarf-planet']);
const ARTIFICIAL_KINDS: ReadonlySet<EntityKind> = new Set(['space-station', 'satellite', 'spacecraft']);
const SMALL_KINDS: ReadonlySet<EntityKind> = new Set(['asteroid', 'comet', 'interstellar-object']);
/** Artificial satellites shown under a planet: stations always, others only when notable (avoids catalogue floods). */
const MIN_ARTIFICIAL_IMPORTANCE = 55;
const MIN_SMALL_BODY_IMPORTANCE = 45;
const MAX_SMALL_BODIES = 16;
const MAX_HELIO_SPACECRAFT = 12;
const AU = 1.495978707e11;

export interface NavBody {
  entity: Entity;
  /** Natural moons first (by distance from the parent), then spacecraft. */
  satellites: Entity[];
}

export interface SystemTree {
  sun: Entity | null;
  /** Planets and dwarf planets in mean-distance order. */
  bodies: NavBody[];
  /** Spacecraft orbiting the Sun (Voyagers, probes). */
  spacecraft: Entity[];
  /** Notable named small bodies. */
  smallBodies: Entity[];
  /** Black holes (stellar, supermassive, mergers), most important first. */
  blackHoles: Entity[];
  /** Every navigable id → its entity (for neighbour lookups). */
  index: Map<string, Entity>;
}

interface RegistryLike extends EntityRegistry {
  list?(): readonly Entity[];
  providers?(): readonly EntityProvider[];
}

function safeGet(registry: EntityRegistry, id: string): Entity | undefined {
  try {
    return registry.get(id);
  } catch {
    return undefined;
  }
}

/** Eager entities plus notable provider records (resolved lazily — only for the kinds the navigator lists). */
export function candidateEntities(registry: EntityRegistry): Entity[] {
  const r = registry as RegistryLike;
  const out: Entity[] = [];
  const seen = new Set<string>();
  const push = (e: Entity | undefined): void => {
    if (e && !seen.has(e.id)) {
      seen.add(e.id);
      out.push(e);
    }
  };
  try {
    for (const e of r.list?.() ?? []) push(e);
  } catch {
    /* registry without list(): fall back to known ids below */
  }
  let providers: readonly EntityProvider[] = [];
  try {
    providers = r.providers?.() ?? [];
  } catch {
    providers = [];
  }
  for (const p of providers) {
    let records: readonly SearchRecord[] = [];
    try {
      records = p.searchRecords();
    } catch {
      continue;
    }
    for (const rec of records) {
      if (seen.has(rec.id)) continue;
      const wanted =
        PRIMARY_KINDS.has(rec.kind) || rec.kind === 'moon' || rec.kind === 'space-station' ||
        (ARTIFICIAL_KINDS.has(rec.kind) && rec.importance >= MIN_ARTIFICIAL_IMPORTANCE) ||
        (SMALL_KINDS.has(rec.kind) && rec.importance >= MIN_SMALL_BODY_IMPORTANCE) || rec.kind === 'black-hole';
      if (wanted) push(safeGet(registry, rec.id));
    }
  }
  if (!r.list) for (const id of [...DIGIT_TARGETS, ...Object.keys(MEAN_DISTANCE_AU)]) push(safeGet(registry, id));
  return out;
}

function distance(a: Entity, b: Entity | null, tMs: number, pa: Vector3, pb: Vector3): number {
  try {
    a.position(tMs, pa);
    if (b) b.position(tMs, pb);
    else pb.set(0, 0, 0);
    const d = pa.distanceTo(pb);
    return Number.isFinite(d) ? d : Infinity;
  } catch {
    return Infinity;
  }
}

/** Build the tree at simulation time `tMs` (distances only order things; the tree is cached per registry version). */
export function buildSystemTree(entities: readonly Entity[], tMs: number): SystemTree {
  const byId = new Map<string, Entity>();
  for (const e of entities) byId.set(e.id, e);
  const sun = byId.get(SUN_ID) ?? null;
  const pa = new Vector3();
  const pb = new Vector3();
  const helio = (e: Entity): number => {
    const known = MEAN_DISTANCE_AU[e.id];
    return known != null ? known * AU : distance(e, sun, tMs, pa, pb);
  };

  const primaries = entities.filter(e => PRIMARY_KINDS.has(e.kind) && (e.parentId === SUN_ID || e.parentId == null));
  const primaryIds = new Set(primaries.map(e => e.id));
  const kids = new Map<string, Entity[]>();
  for (const e of entities) {
    if (!e.parentId || !primaryIds.has(e.parentId)) continue;
    const natural = e.kind === 'moon';
    const artificial = ARTIFICIAL_KINDS.has(e.kind) && (e.kind === 'space-station' || e.importance >= MIN_ARTIFICIAL_IMPORTANCE);
    if (!natural && !artificial) continue;
    let list = kids.get(e.parentId);
    if (!list) kids.set(e.parentId, (list = []));
    list.push(e);
  }

  const order = primaries.map(e => ({ e, d: helio(e) })).sort((a, b) => a.d - b.d);
  const bodies: NavBody[] = order.map(({ e }) => {
    const list = kids.get(e.id) ?? [];
    const scored = list.map(s => ({ s, art: s.kind !== 'moon' ? 1 : 0, d: distance(s, e, tMs, pa, pb) }));
    scored.sort((a, b) => a.art - b.art || a.d - b.d || b.s.importance - a.s.importance);
    return { entity: e, satellites: scored.map(x => x.s) };
  });

  const spacecraft = entities
    .filter(e => ARTIFICIAL_KINDS.has(e.kind) && e.parentId === SUN_ID && e.importance >= MIN_ARTIFICIAL_IMPORTANCE - 15)
    .sort((a, b) => b.importance - a.importance)
    .slice(0, MAX_HELIO_SPACECRAFT);
  const smallBodies = entities
    .filter(e => SMALL_KINDS.has(e.kind) && e.importance >= MIN_SMALL_BODY_IMPORTANCE)
    .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name))
    .slice(0, MAX_SMALL_BODIES);

  const index = new Map<string, Entity>();
  if (sun) index.set(sun.id, sun);
  for (const b of bodies) {
    index.set(b.entity.id, b.entity);
    for (const s of b.satellites) index.set(s.id, s);
  }
  for (const e of spacecraft) index.set(e.id, e);
  // Most important first; one chip per name (the Milky Way landmark markers repeat some catalogue black holes).
  const bhNames = new Set<string>();
  const blackHoles = entities
    .filter(e => e.kind === 'black-hole')
    .sort((a, b) => b.importance - a.importance || a.name.localeCompare(b.name))
    .filter(e => {
      const k = e.name.toLowerCase();
      if (bhNames.has(k)) return false;
      bhNames.add(k);
      return true;
    });
  for (const e of smallBodies) index.set(e.id, e);
  for (const e of blackHoles) index.set(e.id, e);
  return { sun, bodies, spacecraft, smallBodies, blackHoles, index };
}

/** The planet / dwarf planet whose system `id` belongs to (itself, or its parent for a moon or spacecraft). */
export function systemBodyOf(tree: SystemTree, id: string | null): NavBody | null {
  if (!id) return null;
  for (const b of tree.bodies) {
    if (b.entity.id === id) return b;
    if (b.satellites.some(s => s.id === id)) return b;
  }
  return null;
}

/**
 * Next / previous stop within the current planet's system: planet → first moon → … → last moon (wrapping back to
 * the planet). Null when the focus is not in a planetary system or the system has no satellites.
 */
export function stepSatellite(tree: SystemTree, focusId: string | null, dir: 1 | -1): string | null {
  const sys = systemBodyOf(tree, focusId);
  if (!sys || sys.satellites.length === 0) return null;
  const ring = [sys.entity.id, ...sys.satellites.map(s => s.id)];
  const i = Math.max(0, ring.indexOf(focusId ?? ''));
  return ring[(i + dir + ring.length) % ring.length];
}

/** Next / previous planet (or dwarf planet) in heliocentric order; from the Sun or elsewhere, starts at the ends. */
export function stepPlanet(tree: SystemTree, focusId: string | null, dir: 1 | -1, includeDwarfs = true): string | null {
  const list = tree.bodies.filter(b => includeDwarfs || b.entity.kind === 'planet');
  if (list.length === 0) return null;
  const sys = systemBodyOf(tree, focusId);
  const i = sys ? list.indexOf(sys) : -1;
  if (i < 0) return (dir > 0 ? list[0] : list[list.length - 1]).entity.id;
  return list[Math.min(list.length - 1, Math.max(0, i + dir))].entity.id;
}

const GENERIC_TAIL = /\s+(space station|space telescope|telescope|observatory|spacecraft|probe)$/i;

/**
 * Moon-strip pill label for long names: drop a generic tail ("Hubble Space Telescope" → "Hubble"), else use an
 * acronym alias ("International Space Station" → "ISS"), else the full name (CSS ellipsis + tooltip).
 */
export function pillLabel(e: Pick<Entity, 'name' | 'aliases'>, longName = 16): string {
  if (e.name.length <= longName) return e.name;
  const trimmed = e.name.replace(GENERIC_TAIL, '');
  if (trimmed !== e.name && trimmed.length >= 2 && trimmed.length <= longName && !/^(International|European|Chinese)$/i.test(trimmed)) return trimmed;
  const acronym = (e.aliases ?? []).find(a => /^[A-Za-z]{2,6}$/.test(a) && (a === a.toUpperCase() || a === a.toLowerCase()));
  return acronym ? acronym.toUpperCase() : e.name;
}

/** Classification line in plain words (sentence case). */
export function classify(e: Entity, parent?: Entity | null): string {
  switch (e.kind) {
    case 'star':
      return e.id === SUN_ID ? 'Our star' : 'Star';
    case 'planet':
      return 'Planet';
    case 'dwarf-planet':
      return 'Dwarf planet';
    case 'moon':
      return parent ? `Moon of ${parent.name}` : 'Moon';
    case 'space-station':
      return parent ? `Space station, ${parent.name} orbit` : 'Space station';
    case 'satellite':
      return parent ? `Satellite of ${parent.name}` : 'Satellite';
    case 'spacecraft':
      return 'Spacecraft';
    case 'comet':
      return 'Comet';
    case 'asteroid':
      return 'Asteroid';
    case 'interstellar-object':
      return 'Interstellar object';
    default:
      return e.tagline ?? '';
  }
}
