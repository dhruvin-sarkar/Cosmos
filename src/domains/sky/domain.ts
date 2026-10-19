/** Auto-discovered registration of the sky domain (see src/domains/index.ts). */
import type { DiscoveredDomain } from '../index';
import { createSkyDomain } from './index';

export const domain: DiscoveredDomain = {
  id: 'sky',
  order: 1,
  provides: [],
  create: () => ({ layers: createSkyDomain().layers, entities: [], providers: [] }),
};
