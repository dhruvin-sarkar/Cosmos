/**
 * Parent-position sources: the Sun and Earth positions come from the registry entities ('sol:sun', 'sol:earth') so
 * anything attached to them sits exactly on them; when they are not registered the same astronomy-engine (VSOP87)
 * computation is used. Allocation-free after warm-up.
 */
import * as Astronomy from 'astronomy-engine';
import type { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { AU_M } from '../../core/units';

export type PositionFn = (tMs: number, out: Vector3) => Vector3;

const fallbackCache = { tMs: Number.NaN, sun: [0, 0, 0], earth: [0, 0, 0] };

function evaluate(tMs: number): void {
  if (tMs === fallbackCache.tMs) return;
  const time = Astronomy.MakeTime(new Date(tMs));
  const sun = Astronomy.BaryState(Astronomy.Body.Sun, time);
  const earth = Astronomy.BaryState(Astronomy.Body.Earth, time);
  fallbackCache.sun[0] = sun.x * AU_M; fallbackCache.sun[1] = sun.y * AU_M; fallbackCache.sun[2] = sun.z * AU_M;
  fallbackCache.earth[0] = earth.x * AU_M; fallbackCache.earth[1] = earth.y * AU_M; fallbackCache.earth[2] = earth.z * AU_M;
  fallbackCache.tMs = tMs;
}

function viaRegistry(registry: Pick<EntityRegistry, 'get'>, id: string, key: 'sun' | 'earth'): PositionFn {
  let entity: Entity | undefined;
  return (tMs, out) => {
    entity ??= registry.get(id);
    if (entity) return entity.position(tMs, out);
    evaluate(tMs);
    const p = fallbackCache[key];
    return out.set(p[0], p[1], p[2]);
  };
}

/** Barycentric ICRS position (m) of the Sun's centre. */
export const sunSource = (registry: Pick<EntityRegistry, 'get'>): PositionFn => viaRegistry(registry, 'sol:sun', 'sun');
/** Barycentric ICRS position (m) of Earth (the planet, not the Earth–Moon barycentre). */
export const earthSource = (registry: Pick<EntityRegistry, 'get'>): PositionFn => viaRegistry(registry, 'sol:earth', 'earth');
