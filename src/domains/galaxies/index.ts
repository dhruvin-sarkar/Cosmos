/**
 * Galaxies domain: the Local Volume (UNGC + curated famous galaxies, image impostors for the big ones), the Milky Way
 * seen from outside, large-scale structure annotations and the cosmic-web redshift surveys (2MRS, DESI DR1).
 * Entity ids: 'gal:<id>' (famous.json ids: gal:m31, gal:m33, gal:lmc, gal:smc, gal:m87 ...), 'gal:ungc:<slug>'
 * (UNGC names, slugged), 'struct:<id>' (struct:local-group, struct:virgo-cluster, struct:coma-cluster,
 * struct:laniakea, struct:great-attractor ...), fallback 'mw:galaxy'.
 */
import type { Layer } from '../../core/types';
import { createLocalGalaxiesLayer, type LocalGalaxiesLayer } from './localLayer';
import { createStructuresLayer } from './structuresLayer';
import { createCosmicWebLayer, type CosmicWebLayer } from './webLayer';

export interface GalaxiesDomainModule {
  layers: Layer[];
  local: LocalGalaxiesLayer;
  web: CosmicWebLayer;
}

export function createGalaxiesDomain(): GalaxiesDomainModule {
  const local = createLocalGalaxiesLayer();
  const web = createCosmicWebLayer();
  const structures = createStructuresLayer(local);
  return { layers: [web, local, structures], local, web };
}

export { loadGalaxyCatalog, buildGalaxyCatalog, structureEntityId } from './catalog';
export type { Galaxy, GalaxyCatalog, Structure } from './catalog';
