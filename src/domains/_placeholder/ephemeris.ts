/**
 * TEMPORARY placeholder ephemeris: Sun, Earth and Moon positions from astronomy-engine (VSOP87 / ELP
 * truncated series, ~1′), barycentric, ICRS (EQJ) axes, converted from AU to meters.
 *
 * Results are cached per simulation instant: every consumer in a frame shares one evaluation, so the
 * library's small temporary objects are created once per frame, not once per call.
 */
import * as Astronomy from 'astronomy-engine';
import type { Vector3 } from 'three';
import { AU_M } from '../../core/units';

export type PlaceholderBody = 'sun' | 'earth' | 'moon';

const cache = { tMs: Number.NaN, sun: [0, 0, 0], earth: [0, 0, 0], moon: [0, 0, 0] };

function evaluate(tMs: number): void {
  if (tMs === cache.tMs) return;
  const time = Astronomy.MakeTime(new Date(tMs));
  const sun = Astronomy.BaryState(Astronomy.Body.Sun, time);
  const earth = Astronomy.BaryState(Astronomy.Body.Earth, time);
  const moonGeo = Astronomy.GeoMoon(time);
  cache.sun[0] = sun.x * AU_M;
  cache.sun[1] = sun.y * AU_M;
  cache.sun[2] = sun.z * AU_M;
  cache.earth[0] = earth.x * AU_M;
  cache.earth[1] = earth.y * AU_M;
  cache.earth[2] = earth.z * AU_M;
  cache.moon[0] = cache.earth[0] + moonGeo.x * AU_M;
  cache.moon[1] = cache.earth[1] + moonGeo.y * AU_M;
  cache.moon[2] = cache.earth[2] + moonGeo.z * AU_M;
  cache.tMs = tMs;
}

/** Barycentric ICRS position in meters at Unix ms `tMs`, written into `out`. */
export function placeholderPosition(body: PlaceholderBody, tMs: number, out: Vector3): Vector3 {
  evaluate(tMs);
  const p = cache[body];
  return out.set(p[0], p[1], p[2]);
}

/** Earth rotation angle about the ICRS z axis (Greenwich apparent sidereal time), radians. */
export function earthRotationRad(tMs: number): number {
  const gastHours = Astronomy.SiderealTime(new Date(tMs));
  return (gastHours / 24) * 2 * Math.PI;
}
