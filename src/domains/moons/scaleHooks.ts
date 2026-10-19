/**
 * The ONLY place moon sizes and orbital offsets are scaled for visibility. Everything that draws or places a moon
 * (entity positions, orbit lines, mesh scale) goes through these two functions so the exhibition-scale module
 * (src/core/visualScale.ts) can be wired in here, in one spot:
 *   moonRadiusFactor(...)  -> multiplier on the moon's radius (>= 1)
 *   moonOffsetFactor(...)  -> multiplier on the moon's offset from its parent (the parent's visual factor, so a moon stays
 *                             outside its enlarged planet and the whole system is magnified about the planet).
 */
import type { ParentKey } from './data';

const parentFactor: Partial<Record<ParentKey, number>> = {};

/** Called by the layer each frame once the exhibition scale knows the parent's factor (default 1 = true scale). */
export function setParentVisualFactor(parent: ParentKey, factor: number): void {
  parentFactor[parent] = factor;
}

export function moonOffsetFactor(parent: ParentKey): number {
  return parentFactor[parent] ?? 1;
}

export interface MoonRadiusArgs {
  /** On-screen diameter at true size (px). */
  px: number;
  /** The 'enlarge-bodies' overlay. */
  enlargeOverlay: boolean;
  /** Largest enlargement that keeps the moon well inside its orbit. */
  maxFactor: number;
}

export function moonRadiusFactor(a: MoonRadiusArgs): number {
  return a.enlargeOverlay && a.px < 10 ? Math.min(10 / Math.max(a.px, 1e-9), 4000, a.maxFactor) : 1;
}
