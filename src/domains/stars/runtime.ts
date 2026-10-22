/**
 * Shared, lazily-started catalogue loading for the stars domain's layers and entity provider. The first layer
 * init starts the fetch with the engine's asset loader (cached JSON/binary); everything else awaits it.
 */
import type { AssetLoader } from '../../core/types';
import { loadStarCatalog, loadStarDetails, type StarCatalog, type StarDetails } from './catalog';

export interface StarsRuntime {
  /** Set once the field (stars.bin) has loaded. */
  catalog: StarCatalog | null;
  details: StarDetails | null;
  loadCatalog(assets: AssetLoader): Promise<StarCatalog>;
  loadDetails(assets: AssetLoader): Promise<StarDetails>;
}

const BASE = import.meta.env?.BASE_URL ?? '/';

async function freshFetch(path: string, attempt: number): Promise<Response> {
  const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}retry=${attempt}-${Date.now()}`;
  const res = await fetch(url, { cache: 'reload' });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
  return res;
}

async function retryCatalog(err: unknown, attempt: number): Promise<StarCatalog> {
  console.warn(`[stars] catalogue load failed (${(err as Error)?.message ?? String(err)}); retry ${attempt}`);
  await new Promise((r) => setTimeout(r, 1200 * attempt));
  try {
    return await loadStarCatalog(
      async <T>(p: string) => (await (await freshFetch(p, attempt)).json()) as T,
      async (p) => (await freshFetch(p, attempt)).arrayBuffer(),
    );
  } catch (e) {
    if (attempt >= 2) throw e;
    return retryCatalog(e, attempt + 1);
  }
}

export function createStarsRuntime(): StarsRuntime {
  let catP: Promise<StarCatalog> | null = null;
  let detP: Promise<StarDetails> | null = null;
  const rt: StarsRuntime = {
    catalog: null,
    details: null,
    loadCatalog(assets) {
      catP ??= loadStarCatalog(
        (p) => assets.json(p),
        (p) => assets.binary(p),
      )
        // The starfield is what makes space look like space: one transient failure (a flaky network, a stale
        // cached 404, a download manager answering with an empty body) must not leave the sky black. Retry
        // twice with fresh, cache-bypassing requests.
        .catch((err: unknown) => retryCatalog(err, 1))
        .then((c) => (rt.catalog = c));
      return catP;
    },
    loadDetails(assets) {
      detP ??= rt.loadCatalog(assets).then((c) => loadStarDetails(c, (p) => assets.json(p))).then((d) => (rt.details = d));
      return detP;
    },
  };
  return rt;
}
