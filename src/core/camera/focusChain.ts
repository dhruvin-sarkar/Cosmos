/**
 * Cosmic Ruler focus chain — semantic zoom (docs/ARCHITECTURE.md §6.2, ADR-004).
 *
 * The focus point is a blend along the focus entity's ancestor chain (ISS → Earth → Sun → Galactic Center → …).
 * For each step child → parent with separation s (at the current time) the point blends from child to parent as the
 * view scale goes from start = max(log10(s) + 0.6, parent.contextScaleMin) to start + 1 (smoothstep). The blend is
 * a pure function of (focus, scale, time), so zooming back in always returns along the same chain to the target.
 */
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../entity';
import type { Crumb } from '../../state/store';
import { smoothstep } from '../scale';
import { isFiniteVec } from './vec';

/** Decades above log10(separation) where a parent starts to take over the focus. */
export const CHAIN_BLEND_OFFSET_DECADES = 0.6;
/** Width of each child → parent blend, decades. */
export const CHAIN_BLEND_WIDTH_DECADES = 1.0;

export interface FocusChainLink {
  id: string;
  entity: Entity | null;
  /** World position (ICRS m, rel. SSB) at the evaluation time. */
  readonly position: Vector3;
  /** View scale where the blend toward this element starts (−Infinity for the focus itself). */
  blendStart: number;
  /** Own blend factor w toward this element (1 for the focus itself). */
  weight: number;
  /** Share of this element in the final focus point (contributions sum to 1). */
  contribution: number;
}

export interface FocusChainState {
  readonly links: FocusChainLink[];
  /** Number of valid links (links[0] = focus entity). 0 when the focus entity is unknown. */
  length: number;
  /** Blended focus point (unchanged when length = 0). */
  readonly point: Vector3;
  /** Index of the element with the largest contribution (camera anchor candidate); −1 when empty. */
  dominantIndex: number;
}

export function createFocusChainState(): FocusChainState {
  return { links: [], length: 0, point: new Vector3(), dominantIndex: -1 };
}

/**
 * Scale (log10 m) where the focus starts to move from `child` to `parent` given their separation. A zero/unknown
 * separation (e.g. a stellar-system entity at its star's position) falls back to 100 × the child's radius.
 */
export function blendStartScale(separationM: number, child: Entity | null, parent: Entity): number {
  let base = separationM;
  if (!(base > 0) || !Number.isFinite(base)) base = Math.max((child?.radiusM ?? 0) * 100, 1);
  const start = Math.log10(base) + CHAIN_BLEND_OFFSET_DECADES;
  const min = parent.contextScaleMin;
  return typeof min === 'number' && Number.isFinite(min) ? Math.max(start, min) : start;
}

function ensureLinks(state: FocusChainState, n: number): void {
  while (state.links.length < n) {
    state.links.push({ id: '', entity: null, position: new Vector3(), blendStart: -Infinity, weight: 0, contribution: 0 });
  }
}

/** Evaluates focus chains against a registry, caching ancestor lists until the registry changes. */
export class FocusChainEvaluator {
  private readonly ancestorCache = new Map<string, readonly Entity[]>();
  private readonly unsubscribe: () => void;

  constructor(private readonly registry: EntityRegistry) {
    this.unsubscribe = registry.onChange(() => this.ancestorCache.clear());
  }

  /** Ancestors of `id` from parent to root (cached). */
  ancestors(id: string): readonly Entity[] {
    let list = this.ancestorCache.get(id);
    if (!list) {
      try {
        list = this.registry.ancestors(id);
      } catch {
        list = [];
      }
      this.ancestorCache.set(id, list);
    }
    return list;
  }

  /** Blend the focus chain of `focusId` at `scaleLog10` and time `tMs` into `out`. Allocation-free once warmed up. */
  evaluate(focusId: string, scaleLog10: number, tMs: number, out: FocusChainState): FocusChainState {
    const focus = this.registry.get(focusId);
    out.length = 0;
    out.dominantIndex = -1;
    if (!focus) return out;
    const ancestors = this.ancestors(focusId);
    ensureLinks(out, ancestors.length + 1);

    const first = out.links[0];
    if (!safePosition(focus, tMs, first.position)) return out;
    first.id = focus.id;
    first.entity = focus;
    first.blendStart = -Infinity;
    first.weight = 1;
    out.point.copy(first.position);
    let count = 1;

    for (let i = 0; i < ancestors.length; i++) {
      const parent = ancestors[i];
      const link = out.links[count];
      if (!safePosition(parent, tMs, link.position)) continue;
      const prev = out.links[count - 1];
      link.id = parent.id;
      link.entity = parent;
      link.blendStart = blendStartScale(link.position.distanceTo(prev.position), prev.entity, parent);
      link.weight = smoothstep(link.blendStart, link.blendStart + CHAIN_BLEND_WIDTH_DECADES, scaleLog10);
      out.point.lerp(link.position, link.weight);
      count++;
    }

    let remaining = 1;
    let best = 0, bestContribution = -1;
    for (let i = count - 1; i >= 0; i--) {
      const link = out.links[i];
      link.contribution = link.weight * remaining;
      remaining *= 1 - link.weight;
      if (link.contribution > bestContribution) {
        bestContribution = link.contribution;
        best = i;
      }
    }
    out.length = count;
    out.dominantIndex = best;
    return out;
  }

  dispose(): void {
    this.unsubscribe();
    this.ancestorCache.clear();
  }
}

function safePosition(entity: Entity, tMs: number, out: Vector3): boolean {
  try {
    entity.position(tMs, out);
  } catch {
    return false;
  }
  return isFiniteVec(out);
}

/** Index of a chain element by id, or −1. */
export function chainIndexOf(state: FocusChainState, id: string): number {
  for (let i = 0; i < state.length; i++) if (state.links[i].id === id) return i;
  return -1;
}

/**
 * Anchor choice with hysteresis: keep `currentId` while it is still in the chain and holds at least
 * `keepContribution` of the blend; otherwise take the dominant element.
 */
export function chooseAnchor(state: FocusChainState, currentId: string | null, keepContribution = 0.4): string | null {
  if (state.length === 0) return currentId;
  if (currentId) {
    const i = chainIndexOf(state, currentId);
    if (i >= 0 && state.links[i].contribution >= keepContribution) return currentId;
  }
  return state.links[state.dominantIndex].id;
}

/** Context path from the root to the entity, e.g. Universe › Local Group › Milky Way › Sun › Earth. */
export function contextCrumbs(registry: EntityRegistry, id: string): Crumb[] {
  const entity = registry.get(id);
  if (!entity) return [];
  const crumbs: Crumb[] = [];
  const ancestors = registry.ancestors(id);
  for (let i = ancestors.length - 1; i >= 0; i--) crumbs.push({ id: ancestors[i].id, name: ancestors[i].name });
  crumbs.push({ id: entity.id, name: entity.name });
  return crumbs;
}
