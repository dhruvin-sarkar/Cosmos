/**
 * Gravitational "sphere of influence" radii used to re-anchor the free-flight camera: inside a body's sphere the
 * camera rides along with that body, so time-driven motion (even at 10⁶ × real time) stays correct.
 *
 * r_SOI = a · (m / M)^(2/5) (Laplace). Values for the major Solar System bodies are tabulated; domains may provide
 * `soiRadiusM` on an entity (optional, duck-typed); otherwise a kind-based estimate is used.
 */
import type { Entity, EntityKind } from '../entity';
import { AU_M, LY_M } from '../units';

/** Optional, duck-typed extension a domain may add to its entities. */
export interface SoiProvider {
  soiRadiusM?: number;
}

/** Laplace sphere-of-influence radii (m), from semi-major axes and IAU mass ratios. */
export const KNOWN_SOI_M: Readonly<Record<string, number>> = {
  'sol:mercury': 1.12e8,
  'sol:venus': 6.16e8,
  'sol:earth': 9.25e8,
  'sol:moon': 6.61e7,
  'sol:mars': 5.77e8,
  'sol:jupiter': 4.82e10,
  'sol:saturn': 5.48e10,
  'sol:uranus': 5.18e10,
  'sol:neptune': 8.66e10,
  'sol:pluto': 3.08e9,
  // The Sun's gravity dominates out to its Hill sphere in the Galactic tide (~1 pc ≈ 2·10⁵ AU).
  'sol:sun': 2.0e5 * AU_M,
};

const SPACECRAFT_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'spacecraft', 'satellite', 'space-station', 'rocket-body', 'debris',
]);
const SMALL_BODY_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'planet', 'dwarf-planet', 'moon', 'asteroid', 'comet', 'interstellar-object', 'exoplanet',
]);

/**
 * Radius (m) inside which the free-flight camera anchors to `entity`; Infinity for roots / unbounded contexts.
 * Spacecraft get a small bubble (camera rides along when you fly up close to inspect them).
 */
export function sphereOfInfluenceM(entity: Entity): number {
  const provided = (entity as Entity & SoiProvider).soiRadiusM;
  if (typeof provided === 'number' && provided > 0) return provided;
  const known = KNOWN_SOI_M[entity.id];
  if (known) return known;
  const r = entity.radiusM ?? 0;
  if (entity.parentId === null) return Infinity;
  if (SPACECRAFT_KINDS.has(entity.kind)) return Math.max(r * 40, 2_000);
  if (SMALL_BODY_KINDS.has(entity.kind)) return Math.max(r * 150, 1e5);
  if (entity.kind === 'star' || entity.kind === 'stellar-system') return 1.5 * LY_M;
  if (entity.kind === 'black-hole') return Math.max(r * 1e6, 1e15);
  if (entity.viewDistance?.max) return entity.viewDistance.max;
  if (r > 0) return r * 3;
  return Infinity;
}
