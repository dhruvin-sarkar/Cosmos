/**
 * Moons domain: every major moon except Earth's Moon (Mars, Jupiter, Saturn, Uranus, Neptune and Pluto systems).
 * Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { MOON_RECORDS, moonEntityId } from './data';
import { createMoonEntities } from './entities';
import { createMoonsLayer } from './moonsLayer';

export const domain: DiscoveredDomain = {
  id: 'moons',
  order: 36,
  provides: MOON_RECORDS.map((r) => moonEntityId(r.id)),
  create: (ctx) => {
    const entities = createMoonEntities(ctx.registry);
    return { layers: [createMoonsLayer(entities)], entities, providers: [] };
  },
};
