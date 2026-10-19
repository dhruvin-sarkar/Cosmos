/**
 * Features domain: named surface features (IAU/USGS Gazetteer of Planetary Nomenclature), mission landing sites and a few
 * informal/dynamic features on the Moon, planets, dwarf planets, moons, Vesta and Eros. Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { FEATURE_IDS } from './data';
import { createFeatureEntities } from './entities';
import { createFeaturesLayer } from './featuresLayer';

export const domain: DiscoveredDomain = {
  id: 'features',
  order: 45,
  provides: FEATURE_IDS,
  create: (ctx) => {
    const entities = createFeatureEntities(ctx.registry, () => ctx.store.getState().time.simTimeMs);
    return { layers: [createFeaturesLayer(entities)], entities, providers: [] };
  },
};
