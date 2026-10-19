/**
 * Attaches the lab's overlay layer to the running engine. Labs have no engine handle in their props, so this uses the
 * documented automation handle window.__cosmos (src/core/perf.ts) and duck-types addLayer/removeLayer.
 * (Requested contract change: expose addLayer/removeLayer to lab panels through AppContext.)
 */
import type { Layer } from '../../core/types';
import { DEBRIS_OVERLAY_LAYER_ID, createDebrisOverlayLayer, createOverlayState, type DebrisOverlayState } from './overlay';

interface EngineLike {
  addLayer(layer: Layer): void;
  removeLayer(id: string): void;
}

function engine(): EngineLike | null {
  if (typeof window === 'undefined') return null;
  const e = window.__cosmos?.engine as Partial<EngineLike> | undefined;
  return e && typeof e.addLayer === 'function' && typeof e.removeLayer === 'function' ? (e as EngineLike) : null;
}

/** Shared overlay state (one lab instance at a time). */
export const overlayState: DebrisOverlayState = createOverlayState();
let attachedTo: EngineLike | null = null;
let users = 0;

/** Add the overlay layer if the engine is available. Returns true when attached. Pair with detachOverlay(). */
export function attachOverlay(): boolean {
  const e = engine();
  if (!e) return false;
  users++;
  if (attachedTo !== e) {
    if (attachedTo) attachedTo.removeLayer(DEBRIS_OVERLAY_LAYER_ID);
    e.addLayer(createDebrisOverlayLayer(overlayState));
    attachedTo = e;
  }
  return true;
}

export function detachOverlay(): void {
  users = Math.max(0, users - 1);
  if (users > 0 || !attachedTo) return;
  overlayState.mode = 'off';
  attachedTo.removeLayer(DEBRIS_OVERLAY_LAYER_ID);
  attachedTo = null;
}
