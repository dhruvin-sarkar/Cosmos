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
      ).then((c) => (rt.catalog = c));
      return catP;
    },
    loadDetails(assets) {
      detP ??= rt.loadCatalog(assets).then((c) => loadStarDetails(c, (p) => assets.json(p))).then((d) => (rt.details = d));
      return detP;
    },
  };
  return rt;
}
