/**
 * Small bodies domain: the 75,855-asteroid Kepler cloud, ~40 named asteroids / comets / interstellar objects with FactSheets,
 * the 3,449 NEOs (lazy provider, highlightable), and 12 spacecraft with Horizons trajectories. Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { SMALL_BODY_MODELS, createSmallBodyEntities } from './bodies';
import { createSmallBodiesLayer } from './bodiesLayer';
import { createAsteroidCloudLayer } from './asteroidLayer';
import { createBeltRocksLayer } from './beltRocks';
import { CRAFT_META, createCraftEntities } from './spacecraft';
import { createCraftLayer } from './craftLayer';
import { loadNeoCatalog } from './neoApi';
import { createNeoProvider } from './neoProvider';

export const domain: DiscoveredDomain = {
  id: 'small-bodies',
  order: 34,
  provides: [...SMALL_BODY_MODELS.map((m) => m.entityId), ...CRAFT_META.map((c) => `sc:${c.id}`)],
  create: (ctx) => {
    const { entities: bodyEntities, models } = createSmallBodyEntities(ctx.registry);
    const craftEntities = createCraftEntities(ctx.registry);
    // The NEO catalog (≈ 0.5 MB) arrives after the first frame; its entities then resolve lazily through a provider.
    void loadNeoCatalog()
      .then((rows) => ctx.registry.registerProvider(createNeoProvider(ctx.registry, rows)))
      .catch(() => undefined);
    return {
      layers: [createAsteroidCloudLayer(ctx.registry), createSmallBodiesLayer(bodyEntities, models, ctx.registry), createCraftLayer(craftEntities, ctx.registry), createBeltRocksLayer(ctx.registry)],
      entities: [...bodyEntities, ...craftEntities],
      providers: [],
    };
  },
};
