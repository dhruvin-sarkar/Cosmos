/**
 * Entity registry (docs/ARCHITECTURE.md §8): eager hero entities + lazy catalog providers + search.
 *
 * - `get()` checks registered entities first, then asks providers in registration order and caches the
 *   result (misses are cached too until the registry changes, so per-frame lookups of unknown ids stay cheap).
 * - `search()` merges the injected SearchIndex (built over registered entities + provider search records)
 *   with provider `resolveIdentifier()` hits, which always rank first (`matched: 'identifier'`).
 * - Change listeners are notified once per microtask batch, so registering hundreds of entities in a loop
 *   produces a single notification.
 */
import type { Entity, EntityKind, EntityProvider, EntityRegistry, SearchIndex, SearchRecord, SearchResult } from './entity';

export interface CosmosRegistry extends EntityRegistry {
  /** Eagerly registered entities, in registration order (generic picking, debug tooling). */
  list(): readonly Entity[];
  providers(): readonly EntityProvider[];
  /** True when `get(id)` would return an entity. */
  has(id: string): boolean;
  /** Increments on every change (cheap cache key for derived data such as breadcrumbs). */
  readonly version: number;
}

const MAX_ANCESTOR_DEPTH = 64;
const DEFAULT_SEARCH_LIMIT = 20;

export function createRegistry(searchIndex?: SearchIndex): CosmosRegistry {
  const index = searchIndex ?? createSimpleSearchIndex();
  const entities = new Map<string, Entity>();
  const order: Entity[] = [];
  const providerList: EntityProvider[] = [];
  const resolved = new Map<string, Entity>();
  const misses = new Set<string>();
  const listeners = new Set<() => void>();
  const failedProviders = new WeakSet<EntityProvider>();

  let version = 0;
  let indexDirty = true;
  let recordsById = new Map<string, SearchRecord>();
  let notifyQueued = false;

  const flushNotify = (): void => {
    notifyQueued = false;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (err) {
        console.error('[cosmos] registry listener threw', err);
      }
    }
  };

  const changed = (): void => {
    version += 1;
    indexDirty = true;
    misses.clear();
    if (!notifyQueued) {
      notifyQueued = true;
      queueMicrotask(flushNotify);
    }
  };

  const reportProviderError = (provider: EntityProvider, what: string, err: unknown): void => {
    if (failedProviders.has(provider)) return;
    failedProviders.add(provider);
    console.error(`[cosmos] ${provider.domain} provider ${what} threw`, err);
  };

  const rebuildIndex = (): void => {
    const byId = new Map<string, SearchRecord>();
    for (const e of order) byId.set(e.id, recordFromEntity(e));
    for (const p of providerList) {
      let records: readonly SearchRecord[] = [];
      try {
        records = p.searchRecords();
      } catch (err) {
        reportProviderError(p, 'searchRecords()', err);
      }
      for (const r of records) if (!byId.has(r.id)) byId.set(r.id, r);
    }
    recordsById = byId;
    index.rebuild([...byId.values()]);
    indexDirty = false;
  };

  const registry: CosmosRegistry = {
    get version() {
      return version;
    },

    register(entity: Entity): void {
      const previous = entities.get(entity.id);
      if (previous) {
        if (previous === entity) return;
        order[order.indexOf(previous)] = entity;
      } else {
        order.push(entity);
      }
      entities.set(entity.id, entity);
      resolved.delete(entity.id);
      changed();
    },

    registerProvider(provider: EntityProvider): void {
      if (providerList.includes(provider)) return;
      providerList.push(provider);
      changed();
    },

    get(id: string): Entity | undefined {
      const eager = entities.get(id);
      if (eager) return eager;
      const cached = resolved.get(id);
      if (cached) return cached;
      if (misses.has(id)) return undefined;
      for (const p of providerList) {
        let e: Entity | undefined;
        try {
          e = p.resolve(id);
        } catch (err) {
          reportProviderError(p, `resolve('${id}')`, err);
        }
        if (e) {
          resolved.set(id, e);
          return e;
        }
      }
      misses.add(id);
      return undefined;
    },

    has(id: string): boolean {
      return registry.get(id) !== undefined;
    },

    ancestors(id: string): Entity[] {
      const out: Entity[] = [];
      const seen = new Set<string>([id]);
      let parentId = registry.get(id)?.parentId ?? null;
      while (parentId !== null && !seen.has(parentId) && out.length < MAX_ANCESTOR_DEPTH) {
        const parent = registry.get(parentId);
        if (!parent) break;
        seen.add(parentId);
        out.push(parent);
        parentId = parent.parentId;
      }
      return out;
    },

    search(text: string, limit = DEFAULT_SEARCH_LIMIT): SearchResult[] {
      const query = text.trim();
      if (!query || limit <= 0) return [];
      if (indexDirty) rebuildIndex();

      let ranked: SearchResult[] = [];
      try {
        ranked = index.query(query, limit);
      } catch (err) {
        console.error('[cosmos] search index query threw', err);
      }

      const identifierIds: string[] = [];
      for (const p of providerList) {
        if (!p.resolveIdentifier) continue;
        try {
          for (const id of p.resolveIdentifier(query)) if (!identifierIds.includes(id)) identifierIds.push(id);
        } catch (err) {
          reportProviderError(p, 'resolveIdentifier()', err);
        }
      }

      if (identifierIds.length === 0) return ranked.slice(0, limit);

      let top = 1;
      for (const r of ranked) if (r.score >= top) top = r.score + 1;
      const out: SearchResult[] = [];
      const taken = new Set<string>();
      for (const id of identifierIds) {
        const record = recordsById.get(id) ?? recordFromId(id);
        if (!record) continue;
        taken.add(id);
        out.push({ record, score: top, matched: 'identifier', matchedText: query });
      }
      for (const r of ranked) {
        if (taken.has(r.record.id)) continue;
        taken.add(r.record.id);
        out.push(r);
      }
      return out.slice(0, limit);
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    list(): readonly Entity[] {
      return order;
    },

    providers(): readonly EntityProvider[] {
      return providerList;
    },
  };

  const recordFromId = (id: string): SearchRecord | undefined => {
    const e = registry.get(id);
    return e ? recordFromEntity(e) : undefined;
  };

  return registry;
}

export function recordFromEntity(e: Entity): SearchRecord {
  return {
    id: e.id,
    name: e.name,
    aliases: e.aliases,
    kind: e.kind,
    domain: e.domain,
    importance: e.importance,
    tagline: e.tagline,
  };
}

// ── Default search index ─────────────────────────────────────────────────────────────────────
// Used only when no SearchIndex is injected (the real, richer one lives in src/data/search.ts).

const GREEK: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho',
  σ: 'sigma', ς: 'sigma', τ: 'tau', υ: 'upsilon', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

/** Lower-case, strip diacritics, spell Greek letters, collapse punctuation to single spaces. */
export function normalizeSearchText(text: string): string {
  let s = text.toLowerCase();
  s = s.replace(/[α-ω]/g, ch => ` ${GREEK[ch] ?? ch} `);
  s = s.normalize('NFKD').replace(/[̀-ͯ]/g, '');
  return s.replace(/[^a-z0-9*+]+/g, ' ').trim();
}

const CATEGORY_WORDS: Record<string, EntityKind[]> = {
  star: ['star'], stars: ['star'], planet: ['planet', 'dwarf-planet'], planets: ['planet', 'dwarf-planet'],
  moon: ['moon'], moons: ['moon'], asteroid: ['asteroid'], asteroids: ['asteroid'], comet: ['comet'], comets: ['comet'],
  spacecraft: ['spacecraft', 'space-station'], satellite: ['satellite', 'space-station'], satellites: ['satellite', 'space-station'],
  exoplanet: ['exoplanet'], exoplanets: ['exoplanet'], galaxy: ['galaxy'], galaxies: ['galaxy'], nebula: ['nebula'],
  nebulae: ['nebula'], cluster: ['star-cluster', 'galaxy-cluster'], 'black hole': ['black-hole'], constellation: ['constellation'],
};

interface IndexedRecord {
  record: SearchRecord;
  name: string;
  aliases: string[];
}

export function createSimpleSearchIndex(): SearchIndex {
  let items: IndexedRecord[] = [];

  const scoreText = (candidate: string, q: string): number => {
    if (!candidate) return 0;
    if (candidate === q) return 100;
    if (candidate.startsWith(q)) return 80 - Math.min(20, candidate.length - q.length);
    if (candidate.includes(` ${q}`)) return 60;
    if (candidate.includes(q)) return 40;
    return 0;
  };

  return {
    rebuild(records: readonly SearchRecord[]): void {
      items = records.map(record => ({
        record,
        name: normalizeSearchText(record.name),
        aliases: record.aliases.map(normalizeSearchText),
      }));
    },

    query(text: string, limit: number): SearchResult[] {
      const q = normalizeSearchText(text);
      if (!q) return [];
      const category = CATEGORY_WORDS[q];
      const results: SearchResult[] = [];
      for (const item of items) {
        const nameScore = scoreText(item.name, q);
        let best = nameScore;
        let matched: SearchResult['matched'] = 'name';
        let matchedText = item.record.name;
        for (let i = 0; i < item.aliases.length; i++) {
          const s = scoreText(item.aliases[i], q) * 0.92;
          if (s > best) {
            best = s;
            matched = 'alias';
            matchedText = item.record.aliases[i];
          }
        }
        if (best === 0 && category?.includes(item.record.kind)) {
          best = 30;
          matched = 'category';
          matchedText = item.record.kind;
        }
        if (best > 0) {
          results.push({ record: item.record, score: best + item.record.importance * 0.2, matched, matchedText });
        }
      }
      results.sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name));
      return results.slice(0, limit);
    },
  };
}
