/** Auto-discovered registration of the stars domain (see src/domains/index.ts). */
import type { DiscoveredDomain } from '../index';
import { createStarsDomain } from './index';

export const domain: DiscoveredDomain = {
  id: 'stars',
  order: 10,
  provides: [],
  create: () => {
    const mod = createStarsDomain();
    return { layers: mod.layers, entities: [], providers: [] };
  },
};
