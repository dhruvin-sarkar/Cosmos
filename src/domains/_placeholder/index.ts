/**
 * TEMPORARY placeholder domain — Sun, Earth, Moon and an illustrative star backdrop. Remove from the
 * domain list in src/app/createCosmos.ts once the real solar/earth/stars domains are registered.
 */
import type { Entity, EntityProvider } from '../../core/entity';
import type { Layer } from '../../core/types';
import { createPlaceholderEntities } from './entities';
import { createPlaceholderBodiesLayer, createPlaceholderStarfieldLayer } from './layers';

export interface DomainModule {
  layers: Layer[];
  providers?: EntityProvider[];
  entities?: Entity[];
}

export function createPlaceholderDomain(): DomainModule {
  const entities = createPlaceholderEntities();
  return {
    entities,
    layers: [createPlaceholderStarfieldLayer(), createPlaceholderBodiesLayer(entities)],
    providers: [],
  };
}

export { createPlaceholderEntities } from './entities';
export { createPlaceholderBodiesLayer, createPlaceholderStarfieldLayer } from './layers';
