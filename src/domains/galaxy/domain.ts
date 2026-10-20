/**
 * Galaxy domain: the reconstructed 3-D Milky Way (volumetric light + dust, star particles, arms, bar), its landmarks
 * (globular clusters, Messier objects, nebulae, black holes) and the Galactic Centre (Sgr A*, the S-stars, a ray-traced
 * Schwarzschild black hole). Auto-discovered by src/domains/index.ts.
 */
import type { DiscoveredDomain } from '../index';
import { GALAXY_IDS, createGalaxyEntities, createLandmarkProvider, createSStarProvider } from './entities';
import { galaxyRuntime } from './runtime';
import { createGalaxyVolumeLayer } from './volumeLayer';
import { createGalaxyParticlesLayer } from './particlesLayer';
import { createGalacticCentreLayer } from './gcLayer';
import { createBlackHoleLayer } from './blackHoleLayer';
import { createGalaxyLandmarksLayer } from './landmarksLayer';
import { galaxyView } from './views';

export const domain: DiscoveredDomain = {
  id: 'galaxy',
  order: 22,
  provides: Object.values(GALAXY_IDS),
  create: (ctx) => {
    const rt = galaxyRuntime();
    // Landmark + S-star providers answer once the catalogues (≈ 240 kB) have arrived, after the first frame.
    void rt.ready.then(() => {
      ctx.registry.registerProvider(createLandmarkProvider(rt));
      ctx.registry.registerProvider(createSStarProvider(rt));
    }).catch(() => undefined);
    const volume = createGalaxyVolumeLayer();
    const particles = createGalaxyParticlesLayer();
    const gc = createGalacticCentreLayer();
    const blackHole = createBlackHoleLayer();
    const landmarks = createGalaxyLandmarksLayer();
    if (typeof window !== 'undefined') (window as unknown as { __galaxy?: unknown }).__galaxy = { runtime: rt, view: galaxyView, volume, particles, blackHole };
    return {
      layers: [volume, particles, gc, blackHole, landmarks],
      entities: createGalaxyEntities(rt),
      providers: [],
    };
  },
};
