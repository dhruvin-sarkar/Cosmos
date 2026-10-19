/**
 * Stars domain: the HYG v4.4 star field (photometric, 3-D, apparent magnitudes from the camera position), close-up
 * photospheres, the Sun as a star from interstellar space, constellation figures/boundaries/names, and the
 * 'star:hip:<n>' / 'const:<Abbr>' entity provider.
 */
import type { EngineServices, Layer } from '../../core/types';
import { createConstellationsLayer } from './constellationsLayer';
import { createStarsProvider } from './entities';
import { createStarsRuntime, type StarsRuntime } from './runtime';
import { createStarsLayer } from './starsLayer';

export interface StarsDomainModule {
  layers: Layer[];
  runtime: StarsRuntime;
  field: ReturnType<typeof createStarsLayer>;
  constellations: ReturnType<typeof createConstellationsLayer>;
}

export function createStarsDomain(): StarsDomainModule {
  const runtime = createStarsRuntime();
  let registered = false;
  const field = createStarsLayer({
    runtime,
    onDetails(svc: EngineServices) {
      if (registered || !runtime.catalog) return;
      registered = true;
      svc.registry.registerProvider(createStarsProvider({ catalog: runtime.catalog }));
    },
  });
  const constellations = createConstellationsLayer(runtime);
  return { layers: [field, constellations], runtime, field, constellations };
}

export { createStarsProvider } from './entities';
export { starIdForIndex, indexForStarId } from './ids';
export { skyExposureForScale, stellarRadiusRsun, luminosityLsun, bolometricCorrectionV } from './photometry';
