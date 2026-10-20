/**
 * Shared exoplanet view state (module singleton): marker-field filters set by the explorer panel and read every frame by
 * the marker layer, and the currently open system (published by the system layer for the UI). Plain object + listeners,
 * so per-frame reads are free.
 */
import { METHOD_ALL_MASK } from './catalog';

export interface ExoViewState {
  /** Show the planet-host marker field at interstellar scale. */
  markers: boolean;
  /** Bitmask over METHOD_GROUPS. */
  methodMask: number;
  yearMin: number;
  yearMax: number;
  /** Highlight only the showcase systems. */
  showcaseOnly: boolean;
  /** Host index of the open system (−1 = none). */
  openHost: number;
  /** Bumped on every change. */
  version: number;
}

export const DISCOVERY_YEAR_MIN = 1989;
export const DISCOVERY_YEAR_MAX = 2026;

export const exoView: ExoViewState = {
  markers: true,
  methodMask: METHOD_ALL_MASK,
  yearMin: DISCOVERY_YEAR_MIN,
  yearMax: DISCOVERY_YEAR_MAX,
  showcaseOnly: false,
  openHost: -1,
  version: 0,
};

const listeners = new Set<() => void>();

export function setExoView(patch: Partial<Omit<ExoViewState, 'version'>>): void {
  let changed = false;
  for (const [k, v] of Object.entries(patch) as [keyof ExoViewState, never][]) {
    if (exoView[k] !== v) {
      (exoView as unknown as Record<string, unknown>)[k] = v;
      changed = true;
    }
  }
  if (!changed) return;
  exoView.version++;
  for (const l of listeners) l();
}

export function subscribeExoView(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function resetExoFilters(): void {
  setExoView({ methodMask: METHOD_ALL_MASK, yearMin: DISCOVERY_YEAR_MIN, yearMax: DISCOVERY_YEAR_MAX, showcaseOnly: false });
}
