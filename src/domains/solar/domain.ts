/** Auto-discovered registration of the solar domain (see src/domains/index.ts). */
import type { DiscoveredDomain } from '../index';
import { SOLAR_PROVIDED_IDS } from './constants';
import { createSolarDomain } from './index';

export const domain: DiscoveredDomain = {
  id: 'solar',
  order: 30,
  provides: SOLAR_PROVIDED_IDS,
  create: (ctx) => {
    const mod = createSolarDomain({ registry: ctx.registry, nowMs: () => ctx.store.getState().time.simTimeMs });
    return { layers: mod.layers, entities: mod.entities, providers: [] };
  },
};
