/// <reference lib="webworker" />
/**
 * Parses the archive snapshot off the main thread (≈ 190 ms of JSON.parse) and returns the compact catalogue.
 * Keeps the full rows + references to answer per-planet detail requests for fact sheets.
 */
import { buildCompactCatalog, catalogTransferables, type RawTable } from './catalog';
import { detailFor, type DetailTables } from './detail';

type Req = { id: number; type: 'load'; baseUrl: string } | { id: number; type: 'detail'; planet: number; host: number };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let tables: DetailTables | null = null;

async function fetchJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return (await r.json()) as T;
}

scope.onmessage = async (ev: MessageEvent<Req>) => {
  const req = ev.data;
  try {
    if (req.type === 'load') {
      const [planets, systems, refs] = await Promise.all([
        fetchJson<RawTable>(`${req.baseUrl}data/exoplanets/planets.json`),
        fetchJson<RawTable>(`${req.baseUrl}data/exoplanets/systems.json`),
        fetchJson<RawTable>(`${req.baseUrl}data/exoplanets/references.json`),
      ]);
      tables = { planets, systems, refs };
      const catalog = buildCompactCatalog(planets, systems);
      scope.postMessage({ id: req.id, catalog }, catalogTransferables(catalog));
    } else {
      if (!tables) throw new Error('catalogue not loaded');
      scope.postMessage({ id: req.id, detail: detailFor(tables, req.planet, req.host) });
    }
  } catch (e) {
    scope.postMessage({ id: req.id, error: e instanceof Error ? e.message : String(e) });
  }
};
export {};
