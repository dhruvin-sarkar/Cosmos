/**
 * Centre-body position sources for spacecraft tracks. The registry entity is used when present ('sol:sun', 'sol:earth',
 * 'sol:jupiter', 'sol:saturn', 'sb:didymos') so a craft sits exactly on the body it orbits as drawn by its owner; otherwise
 * the same astronomy-engine computation (VSOP87) is used for the Sun and planets. Didymos has no fallback (it is registered
 * by this domain); without it the Sun is used and DART simply stays near its true heliocentric neighbourhood. Allocation-free.
 */
import * as Astronomy from 'astronomy-engine';
import type { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { AU_M } from '../../core/units';
import type { CraftCenterId } from './craftTracks';

export type PositionFn = (tMs: number, out: Vector3) => Vector3;

export const CENTER_ENTITY: Readonly<Record<CraftCenterId, string>> = {
  sun: 'sol:sun', earth: 'sol:earth', jupiter: 'sol:jupiter', saturn: 'sol:saturn', didymos: 'sb:didymos',
};

const BODY: Partial<Record<CraftCenterId, Astronomy.Body>> = {
  sun: Astronomy.Body.Sun, earth: Astronomy.Body.Earth, jupiter: Astronomy.Body.Jupiter, saturn: Astronomy.Body.Saturn,
};

/** Barycentric ICRS position (m) of a craft-track centre body. */
export function centerSource(registry: Pick<EntityRegistry, 'get'>, center: CraftCenterId): PositionFn {
  let entity: Entity | undefined;
  let cacheT = Number.NaN;
  const c = [0, 0, 0];
  const body = BODY[center] ?? Astronomy.Body.Sun;
  return (tMs, out) => {
    entity ??= registry.get(CENTER_ENTITY[center]);
    if (entity) return entity.position(tMs, out);
    if (tMs !== cacheT) {
      const s = Astronomy.BaryState(body, Astronomy.MakeTime(new Date(tMs)));
      c[0] = s.x * AU_M; c[1] = s.y * AU_M; c[2] = s.z * AU_M;
      cacheT = tMs;
    }
    return out.set(c[0], c[1], c[2]);
  };
}
