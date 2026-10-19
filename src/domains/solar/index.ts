/**
 * Solar domain: the Sun, the seven planets other than Earth and the five IAU dwarf planets, with orbits.
 * Earth and the Moon belong to the earth domain, other moons to the moons domain.
 */
import type { EntityRegistry } from '../../core/entity';
import type { Layer } from '../../core/types';
import { createBodiesLayer } from './bodiesLayer';
import { createSolarEntities, type SolarEntity } from './entities';
import { createOrbitsLayer } from './orbitsLayer';
import { createSunLayer } from './sunLayer';

export interface SolarDomainModule {
  layers: Layer[];
  entities: SolarEntity[];
}

export function createSolarDomain(opts: { registry: EntityRegistry; nowMs: () => number }): SolarDomainModule {
  const entities = createSolarEntities({ registry: opts.registry, nowMs: opts.nowMs });
  const sun = entities[0];
  const bodies = entities.slice(1);
  return {
    entities,
    layers: [createOrbitsLayer(entities), createSunLayer(sun), createBodiesLayer(bodies, () => opts.registry)],
  };
}

export { SOLAR_BODIES, SOLAR_PROVIDED_IDS } from './constants';
export {
  bodyNorthPole,
  bodyOrientation,
  exposureState,
  solarIrradianceAt,
  solarSceneIrradianceAt,
  sunAngularRadiusAt,
  sunDirectionAt,
  sunPosition,
  SOLAR_CONSTANT_W_M2,
  SUN_SCENE_IRRADIANCE_1AU,
} from './ephemeris';
