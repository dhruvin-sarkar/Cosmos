/**
 * Screen-space picking (docs/ARCHITECTURE.md §5.7).
 *
 * Layers answer `pick()` from their own CPU-side data. The engine merges those hits with a generic
 * fallback for eagerly registered entities and chooses: nearest in pixels (within a 2 px tolerance),
 * then front-most (within 1 % of depth), then highest priority.
 */
import * as THREE from 'three';
import type { Entity } from './entity';
import type { FrameContext, Layer, PickHit, ScreenPoint } from './types';

export const DEFAULT_PICK_RADIUS_PX = 8;
/** Pick radius for coarse pointers (touch): fingers are not cursors. */
export const TOUCH_PICK_RADIUS_PX = 18;
const PX_TIE_TOLERANCE = 2;
const DEPTH_TIE_RATIO = 0.01;
/** Bodies smaller than this on screen are only pickable through their label or a layer's own pick(). */
const FALLBACK_MIN_DISK_PX = 2;

/** Negative when `a` is the better hit. */
export function comparePickHits(a: PickHit, b: PickHit): number {
  const dPx = a.distancePx - b.distancePx;
  if (Math.abs(dPx) > PX_TIE_TOLERANCE) return dPx;
  const da = Math.max(a.depthM, 0);
  const db = Math.max(b.depthM, 0);
  if (Math.abs(da - db) > DEPTH_TIE_RATIO * Math.max(da, db)) return da - db;
  if (a.priority !== b.priority) return b.priority - a.priority;
  return dPx;
}

/** Best hit within `radiusPx`, or null. */
export function bestPickHit(hits: readonly PickHit[], radiusPx: number): PickHit | null {
  let best: PickHit | null = null;
  for (const h of hits) {
    if (!(h.distancePx <= radiusPx) || !h.entityId) continue;
    if (best === null || comparePickHits(h, best) < 0) best = h;
  }
  return best;
}

export interface PickerOptions {
  /** Eagerly registered entities for the generic fallback. */
  entities: () => readonly Entity[];
  /** Whether the label manager drew this entity's label in the last frame (visibility proxy for tiny bodies). */
  isLabelShown?: (entityId: string) => boolean;
  /** Called when a layer's pick() throws (the engine disables the layer). */
  onLayerError?: (layer: Layer, error: unknown) => void;
}

export interface Picker {
  /** Merge layer hits + the generic fallback; returns the winning entity id or null. */
  pick(ctx: FrameContext, layers: readonly Layer[], x: number, y: number, radiusPx: number): string | null;
  /** All hits from the last pick() call, best first (debug overlay). */
  lastHits(): readonly PickHit[];
}

export function createPicker(opts: PickerOptions): Picker {
  const hits: PickHit[] = [];
  const world = new THREE.Vector3();
  const screen: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };

  const fallback = (ctx: FrameContext, x: number, y: number, radiusPx: number): void => {
    for (const e of opts.entities()) {
      try {
        e.position(ctx.timeMs, world);
      } catch {
        continue;
      }
      ctx.project(world, screen);
      if (!screen.visible) continue;
      const distanceM = world.distanceTo(ctx.cameraPosition);
      const diskRadiusPx = e.radiusM && e.radiusM > 0 ? ctx.pixelDiameter(e.radiusM, distanceM) / 2 : 0;
      if (diskRadiusPx * 2 < FALLBACK_MIN_DISK_PX && !opts.isLabelShown?.(e.id)) continue;
      const d = Math.hypot(screen.x - x, screen.y - y);
      if (d > Math.max(diskRadiusPx, radiusPx)) continue;
      hits.push({ entityId: e.id, distancePx: Math.max(0, d - diskRadiusPx), depthM: distanceM, priority: e.importance });
    }
  };

  return {
    pick(ctx, layers, x, y, radiusPx): string | null {
      hits.length = 0;
      for (const layer of layers) {
        if (!layer.pick) continue;
        try {
          const layerHits = layer.pick(ctx, x, y, radiusPx);
          for (const h of layerHits) hits.push(h);
        } catch (err) {
          opts.onLayerError?.(layer, err);
        }
      }
      fallback(ctx, x, y, radiusPx);
      hits.sort(comparePickHits);
      return bestPickHit(hits, radiusPx)?.entityId ?? null;
    },

    lastHits(): readonly PickHit[] {
      return hits;
    },
  };
}
