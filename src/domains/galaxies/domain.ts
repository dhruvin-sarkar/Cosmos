/** Auto-discovered registration of the galaxies domain (see src/domains/index.ts). */
import type { DiscoveredDomain } from '../index';
import { createGalaxiesDomain } from './index';

export const domain: DiscoveredDomain = {
  id: 'galaxies',
  order: 26,
  provides: [],
  create: () => ({ layers: createGalaxiesDomain().layers, entities: [], providers: [] }),
};
