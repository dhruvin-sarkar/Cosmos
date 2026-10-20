/**
 * Entity model — the normalized universe the renderer and UI consume.
 *
 * The renderer never sees raw NASA/JPL/SIMBAD response objects: each domain normalizes its data into
 * `Entity` objects (eagerly for a few hundred "hero" objects, lazily via `EntityProvider.resolve` for
 * catalog-backed objects such as 120k stars or 30k satellites). Domain-specific detail lives behind
 * `facts()` (a FactSheet with provenance), not in a giant nullable interface.
 */
import type { Vector3 } from 'three';
import type { FactSheet, ProvenanceClass } from '../data/provenance';

export type EntityKind =
  | 'star' | 'planet' | 'dwarf-planet' | 'moon' | 'asteroid' | 'comet' | 'interstellar-object'
  | 'spacecraft' | 'satellite' | 'space-station' | 'rocket-body' | 'debris'
  | 'exoplanet' | 'stellar-system' | 'black-hole' | 'nebula' | 'star-cluster' | 'constellation'
  | 'galaxy' | 'galaxy-group' | 'galaxy-cluster' | 'supercluster' | 'void'
  | 'region' | 'cosmic-structure'
  /** Scale / context markers (heliosphere, Oort cloud, observable universe, CMB...). */
  | 'reference';

/** Render/data domains (each owns a folder under src/domains/). */
export type DomainId =
  | 'earth' | 'orbital' | 'solar' | 'stars' | 'exoplanets' | 'galaxy' | 'blackhole' | 'extragalactic' | 'cosmology' | 'sky';

/** Interactive laboratories (each owns a folder under src/labs/). */
export type LabId = 'debris' | 'defense' | 'habitability' | 'relativity';

export type Capability =
  | 'focus' | 'orbit' | 'follow' | 'travel' | 'show-orbit' | 'compare' | 'bookmark' | 'sources'
  | 'surface-view' | 'sky-view' | 'related' | 'spectrum'
  | `experiment:${LabId}`;

export interface Entity {
  /**
   * Globally unique, namespaced, stable id. Conventions:
   *   'sol:earth', 'sol:moon', 'sol:jupiter', 'sb:apophis' (small body), 'sc:voyager-1' (spacecraft),
   *   'sat:25544' (NORAD id as string — may exceed 5 digits), 'star:hip:70890', 'star:hyg:12345',
   *   'exo:TRAPPIST-1 e' (archive pl_name), 'sys:TRAPPIST-1' (host system), 'mw:sgr-a*', 'mw:m42',
   *   'gal:m31', 'struct:virgo-cluster', 'cosmo:cmb', 'const:Ori'.
   */
  id: string;
  name: string;
  aliases: string[];
  kind: EntityKind;
  domain: DomainId;
  /**
   * Parent in the context hierarchy (used for breadcrumbs and Cosmic-Ruler focus chains), e.g.
   * 'sol:moon' → 'sol:earth' → 'sol:sun' → 'mw:galaxy' → 'struct:local-group' → 'cosmo:observable-universe'.
   */
  parentId: string | null;
  /** Mean physical radius in meters (framing, LOD, collision-free orbiting); null when not meaningful/unknown. */
  radiusM: number | null;
  /**
   * Position at simulation time `tMs` (Unix ms, UTC) in ICRS axes, METERS, relative to the Solar System
   * barycenter. Must write into `out` and return it. Must not allocate (called every frame).
   */
  position(tMs: number, out: Vector3): Vector3;
  /** Optional velocity in m/s in the same frame (follow mode, inspector). */
  velocity?(tMs: number, out: Vector3): Vector3;
  /** Radius the inspect view fits on screen when larger than radiusM (e.g. the outer edge of a ring system), meters. */
  framingRadiusM?: number;
  /** Recommended camera distances for focusing, meters. */
  viewDistance?: { min: number; default: number; max?: number };
  /**
   * Optional preferred arrival direction (unit vector, ICRS, pointing from the entity toward the camera) for travel. Used
   * by extended structures whose default approach from Earth would be degenerate (e.g. the Local Group seen along the
   * Milky Way-Andromeda line). When omitted the camera approaches from its current position.
   */
  approachDir?: readonly [number, number, number];
  /**
   * Cosmic Ruler focus chain: the minimum view scale (log10 m) at which this entity may become the focus
   * context when the user zooms out from one of its descendants (e.g. the Galactic Center only takes over
   * the focus beyond ~10^21 m). When omitted the engine uses log10(separation from the child) + 0.6.
   */
  contextScaleMin?: number;
  /** One-line plain-language description for search results and hover cards. */
  tagline?: string;
  capabilities: Capability[];
  /** Search/label ranking hint, 0..100 (Earth/Sun/Moon ≈ 100, catalog stars ≈ 5–40). */
  importance: number;
  /** How the current visual of this entity should be read. */
  representation: ProvenanceClass;
  /** Lazily build the inspector fact sheet (may load data). */
  facts(): FactSheet | Promise<FactSheet>;
}

/** Lightweight record for the search index (do not index every catalog row — only named/notable ones). */
export interface SearchRecord {
  id: string;
  name: string;
  aliases: string[];
  kind: EntityKind;
  domain: DomainId;
  importance: number;
  tagline?: string;
}

export interface SearchResult {
  record: SearchRecord;
  score: number;
  /** What matched: the canonical name, an alias, a catalog identifier, or a category word. */
  matched: 'name' | 'alias' | 'identifier' | 'category';
  matchedText: string;
}

/** Pluggable search algorithm (implemented in src/data/search.ts, injected into the registry). */
export interface SearchIndex {
  rebuild(records: readonly SearchRecord[]): void;
  query(text: string, limit: number): SearchResult[];
}

export interface EntityProvider {
  domain: DomainId;
  /** Resolve (materialize, cache) an entity by id; may lazily construct it from catalog buffers. */
  resolve(id: string): Entity | undefined;
  /** Named/notable records for the search index. */
  searchRecords(): readonly SearchRecord[];
  /**
   * Resolve catalog-identifier queries, e.g. "HIP 70890", "HD 10700", "NORAD 25544", "25544", "M 31", "NGC 224",
   * "Gliese 581". Returns matching entity ids (possibly empty). Pure lookup; no network.
   */
  resolveIdentifier?(query: string): string[];
}

export interface EntityRegistry {
  /** Register an eagerly-constructed entity (hero objects). */
  register(entity: Entity): void;
  registerProvider(provider: EntityProvider): void;
  /** Get by id: registered entities first, then providers (results cached). */
  get(id: string): Entity | undefined;
  /** Ancestors from the entity up to the root (excluding the entity itself). */
  ancestors(id: string): Entity[];
  /** Ranked search across registered entities, provider search records and identifier resolvers. */
  search(text: string, limit?: number): SearchResult[];
  /** Subscribe to registry changes (new entities/providers); returns unsubscribe. */
  onChange(listener: () => void): () => void;
}
