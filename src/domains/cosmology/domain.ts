/** Auto-discovered registration of the cosmology domain (see src/domains/index.ts): the edge of the observable universe. */
import type { DiscoveredDomain } from '../index';
import { createEdgeLayer } from './cmbLayer';
import { CMB_ID, OBSERVABLE_ID } from './constants';
import { createCosmologyEntities } from './entities';

export const domain: DiscoveredDomain = {
  id: 'cosmology',
  order: 27,
  provides: [OBSERVABLE_ID, CMB_ID],
  create: () => ({ layers: [createEdgeLayer()], entities: createCosmologyEntities(), providers: [] }),
};
