/**
 * Sky domain: the Milky Way backdrop at infinity (all-sky survey maps per spectral band, cross-faded, valid near the
 * Solar System) and the celestial coordinate grids. No entities.
 */
import type { Layer } from '../../core/types';
import { createSkyBackdropLayer, type SkyRuntime } from './skyLayer';
import { createSkyGridLayer } from './gridLayer';

export { SKY_BACKDROP_LAYER_ID, SKY_FADE_END_M, SKY_FADE_START_M, type SkyRuntime, type SkyStyle } from './skyLayer';
export { SKY_GRID_LAYER_ID } from './gridLayer';
export { BAND_DATA_IDS, BAND_DISPLAY, type SkyBandCaption } from './bands';

let current: SkyRuntime | null = null;
/** Runtime of the most recently created sky domain (captions for the UI's Light switcher). */
export const skyRuntime = (): SkyRuntime | null => current;

export function createSkyDomain(): { layers: Layer[]; runtime: SkyRuntime } {
  const backdrop = createSkyBackdropLayer();
  current = backdrop.runtime;
  if (typeof window !== 'undefined') (window as unknown as { __sky?: SkyRuntime }).__sky = backdrop.runtime;
  return { layers: [backdrop.layer, createSkyGridLayer()], runtime: backdrop.runtime };
}
