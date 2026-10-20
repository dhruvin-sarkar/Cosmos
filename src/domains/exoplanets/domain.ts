/**
 * Exoplanets domain (auto-discovered, see src/domains/index.ts): the planet-host marker field, the open planetary
 * system (star, planets, orbits, habitable zone) and the 'sys:<host>' / 'exo:<planet>' entity provider. The NASA
 * Exoplanet Archive snapshot is parsed in a worker; the provider registers once it has loaded.
 */
import type { DiscoveredDomain } from '../index';
import { loadExoCatalog } from './catalogClient';
import { createExoProvider, indexShowcaseAliases } from './entities';
import { createExoMarkersLayer } from './markersLayer';
import { setExoRegistry } from './runtime';
import { createExoSystemLayer } from './systemLayer';

export const domain: DiscoveredDomain = {
  id: 'exoplanets',
  order: 15,
  provides: [],
  create: (ctx) => {
    setExoRegistry(ctx.registry);
    loadExoCatalog()
      .then((l) => {
        indexShowcaseAliases(l.index);
        ctx.registry.registerProvider(createExoProvider(l.catalog, l.index));
      })
      .catch((e) => console.warn('[exoplanets] catalogue unavailable', e));
    return { layers: [createExoMarkersLayer(), createExoSystemLayer()], entities: [], providers: [] };
  },
};
