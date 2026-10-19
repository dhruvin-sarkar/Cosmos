/**
 * Sun position source for the outer-system layers: the 'sol:sun' registry entity when present (so everything sits exactly on
 * it), else the same astronomy-engine barycentric computation. Allocation-free after warm-up.
 */
import * as Astronomy from 'astronomy-engine';
import type { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { AU_M } from '../../core/units';

export type PositionFn = (tMs: number, out: Vector3) => Vector3;

let cacheT = Number.NaN;
let cacheX = 0, cacheY = 0, cacheZ = 0;

export function sunSource(registry: Pick<EntityRegistry, 'get'>): PositionFn {
  let entity: Entity | undefined;
  return (tMs, out) => {
    entity ??= registry.get('sol:sun');
    if (entity) return entity.position(tMs, out);
    if (tMs !== cacheT) {
      const s = Astronomy.BaryState(Astronomy.Body.Sun, Astronomy.MakeTime(new Date(tMs)));
      cacheX = s.x * AU_M; cacheY = s.y * AU_M; cacheZ = s.z * AU_M;
      cacheT = tMs;
    }
    return out.set(cacheX, cacheY, cacheZ);
  };
}
