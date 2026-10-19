/**
 * Orbital domain: Earth orbit. The ISS ('sc:iss') and notable satellites ('sat:<norad>') as hero entities with
 * illustrative true-proportion models (ISS, Tiangong, Hubble) or sunlit glints; every tracked object (~35k, CelesTrak
 * GP + SATCAT) as an SGP4-propagated point cloud (overlays 'satellites' and 'debris'); Starlink and tracked-population
 * group entities; any catalog object resolvable as 'sat:<norad>'. Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { NOTABLE, createNotableSats } from './notable';
import { Population } from './population';
import { createPopulationLayer } from './populationLayer';
import { createOrbitalProvider } from './provider';
import { createSatLayer } from './satLayer';
import { bindRegistry } from './scene';

export const domain: DiscoveredDomain = {
  id: 'orbital',
  order: 50,
  provides: [...NOTABLE.map((n) => n.id), 'sat:group:starlink', 'sat:group:tracked'],
  create: (ctx) => {
    bindRegistry(ctx.registry);
    const sats = createNotableSats(() => ctx.store.getState().time.simTimeMs);
    const heroIds = new Map<number, string>(NOTABLE.map((n) => [Number(n.norad), n.id]));
    const heroById = new Map(sats.map((s) => [s.entity.id, s.entity]));
    const population = new Population();
    const highlight = { starlink: 0 };
    const provider = createOrbitalProvider(population, heroIds, (id) => heroById.get(id));
    const popLayer = createPopulationLayer({ population, heroIds, highlight });
    const satLayer = createSatLayer(sats);
    const baseInit = popLayer.init.bind(popLayer);
    popLayer.init = (svc) => {
      population.start(new URL(`${import.meta.env.BASE_URL}data/orbital/catalog.json`, location.href).href);
      return baseInit(svc);
    };
    const baseUpdate = popLayer.update.bind(popLayer);
    popLayer.update = (fc) => {
      highlight.starlink = fc.selectedId === 'sat:group:starlink' || fc.focusEntityId === 'sat:group:starlink' ? 1 : 0;
      baseUpdate(fc);
    };
    const baseDispose = popLayer.dispose?.bind(popLayer);
    popLayer.dispose = () => {
      baseDispose?.();
      population.dispose();
    };
    return {
      entities: [...sats.map((s) => s.entity), ...provider.groups],
      layers: [satLayer, popLayer],
      providers: [provider],
    };
  },
};
