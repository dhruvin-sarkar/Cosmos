/**
 * Earth domain: the Earth (Blue Marble surface, VIIRS night lights, clouds, ocean glint, physically based
 * atmosphere) and the Moon (LRO imagery, lunar-Lambert photometry, libration, Earthshine, eclipses).
 * Auto-discovered by src/domains/index.ts; retires the placeholder's Earth and Moon.
 */
import type { DiscoveredDomain } from '../index';
import { bindRegistry } from './ephemeris';
import { createEarthEntities } from './entities';
import { createEarthMoonLayer } from './layer';

export const domain: DiscoveredDomain = {
  id: 'earth',
  order: 40,
  provides: ['sol:earth', 'sol:moon'],
  create: ctx => {
    bindRegistry(ctx.registry);
    const { earth, moon } = createEarthEntities(() => ctx.store.getState().time.simTimeMs);
    return { entities: [earth, moon], layers: [createEarthMoonLayer({ earth, moon })], providers: [] };
  },
};
