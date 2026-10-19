/**
 * HUD-aware inspect framing for travel started from the UI. The camera rig frames an inspected body at a fixed
 * fraction of the full viewport height (INSPECT_DIAMETER_FRACTION), which runs the disc under the moon strip and the
 * body strip. Here the disc fills FILL of the clear band between the top bar and the moon strip (or the bottom band
 * when the target has no strip), kept inside that band while the disc stays vertically centred (the rig has no
 * vertical projection shift). The result is passed as TravelOptions.distanceM.
 */
import { useCallback } from 'react';
import type { AppCommands } from '../../app/commands';
import type { TravelOptions } from '../../core/types';
import type { EntityRegistry } from '../../core/entity';
import type { CosmosStore } from '../../state/store';
import { safeGetEntity, useCommands, useRegistry, useStoreApi } from '../hooks';
import { buildSystemTree, candidateEntities, systemBodyOf, type SystemTree } from './tree';

/** Fraction of the clear band the disc's diameter fills (art direction: 0.80). */
export const FILL = 0.8;
/** Keep this many px between the disc and the HUD edges. */
const EDGE_MARGIN_PX = 8;
/** Moon strip height + gap when it is not mounted yet (it appears after the travel starts). */
const STRIP_FALLBACK_PX = 48;
/** Matches CAMERA_FOV_DEG in src/core/engine.ts (kept local so the UI does not import the engine module). */
export const FOV_Y_RAD = (50 * Math.PI) / 180;

export interface Band {
  /** Viewport height, CSS px. */
  height: number;
  /** First clear row below the top bar, CSS px from the top. */
  top: number;
  /** Last clear row above the bottom HUD (moon strip or body strip), CSS px from the top. */
  bottom: number;
}

/** Disc diameter as a fraction of the viewport height for a centred disc inside `band`. */
export function discFraction(band: Band, fill = FILL): number {
  const h = band.height;
  if (!(h > 0) || !(band.bottom > band.top)) return fill;
  const c = h / 2;
  const room = 2 * Math.min(c - band.top, band.bottom - c) - 2 * EDGE_MARGIN_PX;
  const d = Math.min(fill * (band.bottom - band.top), room);
  return Math.min(0.92, Math.max(0.3, d / h));
}

/** Camera distance (m, from the centre) at which a sphere's projected disc spans `fraction` of the viewport height. */
export function distanceForProjectedFraction(radiusM: number, fovYRad: number, fraction: number): number {
  const alpha = Math.atan(fraction * Math.tan(fovYRad / 2));
  return radiusM / Math.sin(alpha);
}

function cssPx(name: string, fallback: number): number {
  const v = parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(v) ? v : fallback;
}

/** The clear band of the current layout; `withStrip` reserves room for the moon strip. */
export function measureBand(withStrip: boolean): Band {
  const height = window.innerHeight;
  const top = cssPx('--topbar-h', 48) + EDGE_MARGIN_PX;
  const bottomBand = height - cssPx('--bottom-h', 72);
  let bottom = bottomBand;
  if (withStrip) {
    const strip = document.querySelector('.cx-moonstrip')?.getBoundingClientRect();
    bottom = strip && strip.height > 0 ? strip.top : bottomBand - cssPx('--sp-4', 16) - STRIP_FALLBACK_PX;
  }
  return { height, top, bottom };
}

let cached: { registry: EntityRegistry; version: number; day: number; tree: SystemTree } | null = null;

/** Navigator tree for "now", cached per registry version and simulated day. */
export function systemTreeNow(registry: EntityRegistry, simTimeMs: number): SystemTree {
  const version = (registry as { version?: number }).version ?? -1;
  const day = Math.floor(simTimeMs / 86_400_000);
  if (!cached || cached.registry !== registry || cached.version !== version || cached.day !== day || version < 0) {
    cached = { registry, version, day, tree: buildSystemTree(candidateEntities(registry), day * 86_400_000) };
  }
  return cached.tree;
}

/** Inspect arrival distance for `id`, or undefined to leave framing to the rig (no radius / no DOM). */
export function inspectDistanceM(registry: EntityRegistry, store: CosmosStore, id: string): number | undefined {
  if (typeof window === 'undefined') return undefined;
  const e = safeGetEntity(registry, id);
  const r = Math.max(e?.radiusM ?? 0, e?.framingRadiusM ?? 0);
  if (!(r > 0)) return undefined;
  const s = store.getState();
  const sys = systemBodyOf(systemTreeNow(registry, s.time.simTimeMs), id);
  const withStrip = !!sys && sys.satellites.length > 0 && s.lab.active == null;
  const d = distanceForProjectedFraction(r, FOV_Y_RAD, discFraction(measureBand(withStrip)));
  return Number.isFinite(d) && d > r ? d : undefined;
}

/** commands.focus with HUD-aware inspect framing. */
export function focusFramed(
  commands: AppCommands, registry: EntityRegistry, store: CosmosStore, id: string, opts?: TravelOptions,
): Promise<void> {
  if (opts?.distanceM !== undefined) return commands.focus(id, opts);
  const distanceM = inspectDistanceM(registry, store, id);
  return commands.focus(id, distanceM === undefined ? opts : { ...opts, distanceM });
}

/** Hook form: `const go = useFocusFramed(); go(id)`. */
export function useFocusFramed(): (id: string, opts?: TravelOptions) => Promise<void> {
  const commands = useCommands();
  const registry = useRegistry();
  const store = useStoreApi();
  return useCallback((id: string, opts?: TravelOptions) => focusFramed(commands, registry, store, id, opts), [commands, registry, store]);
}
