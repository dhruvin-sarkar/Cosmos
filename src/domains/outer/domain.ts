/**
 * Outer Solar System domain: Kuiper belt + scattered disk (≈ 7,300 catalogued TNOs on real orbits), heliosphere shells with the
 * Voyager crossing markers, the illustrative Oort cloud, and light-hour / light-day / light-year scale rings.
 * Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { OUTER_IDS, createOuterEntities, createTnoProvider } from './entities';
import { createTnoLayer } from './tnoLayer';
import { createHeliosphereLayer } from './heliosphereLayer';
import { createOortLayer } from './oortLayer';
import { createScaleRingsLayer } from './scaleRings';

export const domain: DiscoveredDomain = {
  id: 'outer',
  order: 32,
  provides: Object.values(OUTER_IDS),
  create: (ctx) => {
    const provider = createTnoProvider(ctx.registry);
    // The named-TNO provider answers once the catalogue (about 0.3 MB) has arrived, after the first frame.
    void provider.load().then(() => ctx.registry.registerProvider(provider)).catch(() => undefined);
    return {
      layers: [createTnoLayer(ctx.registry), createHeliosphereLayer(ctx.registry), createOortLayer(ctx.registry), createScaleRingsLayer(ctx.registry)],
      entities: createOuterEntities(ctx.registry),
      providers: [],
    };
  },
};
