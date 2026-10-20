/**
 * Loads the exoplanet catalogue once per page: a module worker parses the archive JSON (catalog.worker.ts); without
 * workers (tests, old browsers) it falls back to parsing on the main thread. Shared by the domain layers, the entity
 * provider, the explorer panel and the habitability lab.
 */
import { buildCompactCatalog, buildIndex, type ExoCatalog, type ExoIndex, type RawTable } from './catalog';
import { detailFor, type DetailTables, type ExoDetail } from './detail';

export interface LoadedCatalog {
  catalog: ExoCatalog;
  index: ExoIndex;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
let loadP: Promise<LoadedCatalog> | null = null;
let loaded: LoadedCatalog | null = null;
let mainTables: DetailTables | null = null;
const listeners = new Set<(c: LoadedCatalog) => void>();
const detailCache = new Map<string, Promise<ExoDetail>>();

function baseUrl(): string {
  const base = import.meta.env?.BASE_URL ?? '/';
  if (typeof location === 'undefined') return base;
  return new URL(base, location.href).href;
}

function call<T>(w: Worker, msg: Record<string, unknown>): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    w.postMessage({ id, ...msg });
  });
}

async function loadOnMainThread(): Promise<ExoCatalog> {
  const get = async (p: string): Promise<RawTable> => {
    const r = await fetch(`${baseUrl()}data/exoplanets/${p}`);
    if (!r.ok) throw new Error(`exoplanets ${p}: HTTP ${r.status}`);
    return (await r.json()) as RawTable;
  };
  const [planets, systems, refs] = await Promise.all([get('planets.json'), get('systems.json'), get('references.json')]);
  mainTables = { planets, systems, refs };
  return buildCompactCatalog(planets, systems);
}

function startWorker(): Worker {
  const w = new Worker(new URL('./catalog.worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = (ev: MessageEvent<{ id: number; error?: string; catalog?: unknown; detail?: unknown }>) => {
    const p = pending.get(ev.data.id);
    if (!p) return;
    pending.delete(ev.data.id);
    if (ev.data.error) p.reject(new Error(ev.data.error));
    else p.resolve(ev.data.catalog ?? ev.data.detail);
  };
  w.onerror = () => {
    for (const p of pending.values()) p.reject(new Error('exoplanet catalogue worker crashed'));
    pending.clear();
    w.terminate();
    if (worker === w) worker = null;
  };
  return w;
}

/** Start (or join) the catalogue load. */
export function loadExoCatalog(): Promise<LoadedCatalog> {
  if (loadP) return loadP;
  loadP = (async () => {
    let catalog: ExoCatalog;
    try {
      if (typeof Worker === 'undefined') throw new Error('no workers');
      worker = startWorker();
      catalog = await call<ExoCatalog>(worker, { type: 'load', baseUrl: baseUrl() });
    } catch {
      worker?.terminate();
      worker = null;
      catalog = await loadOnMainThread();
    }
    const l: LoadedCatalog = { catalog, index: buildIndex(catalog) };
    loaded = l;
    for (const fn of listeners) fn(l);
    listeners.clear();
    return l;
  })();
  loadP.catch(() => {
    loadP = null;
  });
  return loadP;
}

/** The catalogue if already loaded (synchronous). */
export function exoCatalog(): LoadedCatalog | null {
  return loaded;
}

/** Called once when the catalogue is available (immediately if it already is). Returns an unsubscribe. */
export function onExoCatalog(fn: (c: LoadedCatalog) => void): () => void {
  if (loaded) {
    fn(loaded);
    return () => undefined;
  }
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Full archive rows + references for one planet (or the host only with planet = −1). */
export function exoDetail(planet: number, host: number): Promise<ExoDetail> {
  const key = `${planet}:${host}`;
  let p = detailCache.get(key);
  if (!p) {
    p = loadExoCatalog().then(() => {
      if (worker) return call<ExoDetail>(worker, { type: 'detail', planet, host });
      if (mainTables) return detailFor(mainTables, planet, host);
      throw new Error('exoplanet catalogue unavailable');
    });
    p.catch(() => detailCache.delete(key));
    detailCache.set(key, p);
  }
  return p;
}
