/**
 * Composed camera shots (VISUAL_DIRECTION "Composition and camera framing"). Each returns a CameraViewState for
 * `CameraController.setView`, so tours and the cold open can reach them with the normal travel machinery.
 * Light stays physically true: we only choose where the camera stands.
 */
import { Quaternion, Vector3 } from 'three';
import type { CameraViewState } from '../types';
import type { Entity, EntityRegistry } from '../entity';
import { clamp, scaleFromFocusDistance } from '../scale';
import { DEG } from '../units';
import { entityNorthPole } from './upVector';
import { basisQuaternion } from './rigImpl';
import { anyPerpendicular, rejectFrom, rotateAboutAxis } from './vec';

export interface HorizonShotOptions {
  /** Camera altitude above the mean radius, m (default 400 km — ISS-like). */
  altitudeM?: number;
  /** Fraction of the frame height the planet fills at the bottom (default 0.40; VISUAL_DIRECTION 0.35–0.45). */
  fillFraction?: number;
  /** Sun elevation above the local horizon at the camera's nadir point, degrees (default 12: long, low light). */
  sunElevationDeg?: number;
  /** Azimuth of the view from the Sun's horizontal direction, degrees (default 70: Sun off-frame, limb backlit). */
  azimuthFromSunDeg?: number;
}

/** First 'star' ancestor of an entity (its light source), or null. */
function hostStar(registry: EntityRegistry, id: string): Entity | null {
  for (const a of registry.ancestors(id)) if (a.kind === 'star') return a;
  return null;
}

/**
 * Horizon shot: camera ~400 km above the body looking along the limb, the planet filling the bottom 35–45 % of the
 * frame, placed over the day side near the terminator so the atmosphere limb and surface relief read. Returns null
 * when the body is unknown or has no radius.
 */
export function horizonView(
  registry: EntityRegistry, bodyId: string, tMs: number, fovYRad: number, opts: HorizonShotOptions = {},
): CameraViewState | null {
  const body = registry.get(bodyId);
  const R = body?.radiusM ?? 0;
  if (!body || !(R > 0)) return null;
  const h = Math.max(opts.altitudeM ?? 400e3, 1);
  const fill = clamp(opts.fillFraction ?? 0.4, 0.05, 0.95);
  const elev = (opts.sunElevationDeg ?? 12) * DEG;
  const az = (opts.azimuthFromSunDeg ?? 70) * DEG;

  const c = body.position(tMs, new Vector3());
  const pole = entityNorthPole(body, tMs, new Vector3());
  const s = new Vector3(1, 0, 0);
  const star = hostStar(registry, bodyId);
  if (star) {
    star.position(tMs, s).sub(c);
    if (s.lengthSq() > 0) s.normalize(); else s.set(1, 0, 0);
  }
  // Nadir normal n: (90° − elevation) from the Sun direction, toward the evening/morning side of the equator.
  const e = new Vector3().crossVectors(pole, s);
  if (e.lengthSq() < 1e-12) anyPerpendicular(s, e);
  e.normalize();
  const zen = Math.PI / 2 - elev;
  const n = new Vector3().copy(s).multiplyScalar(Math.cos(zen)).addScaledVector(e, Math.sin(zen)).normalize();

  // Horizontal heading: the Sun's horizontal direction turned by `az` about the local vertical.
  const sh = rejectFrom(s, n, new Vector3());
  if (sh.lengthSq() < 1e-12) anyPerpendicular(n, sh);
  sh.normalize();
  const heading = rotateAboutAxis(sh, n, az, new Vector3());

  // Limb dip below the horizontal and the angle below frame centre where the limb should sit.
  const dip = Math.acos(R / (R + h));
  const below = Math.atan((1 - 2 * fill) * Math.tan(fovYRad / 2));
  const pitchDown = dip - below;
  const f = heading.clone().multiplyScalar(Math.cos(pitchDown)).addScaledVector(n, -Math.sin(pitchDown)).normalize();
  const up = n.clone().multiplyScalar(Math.cos(pitchDown)).addScaledVector(heading, Math.sin(pitchDown)).normalize();
  const q = basisQuaternion(f, up, new Quaternion());
  const offset = n.clone().multiplyScalar(R + h);
  return {
    anchorId: bodyId,
    offset: [offset.x, offset.y, offset.z],
    quaternion: [q.x, q.y, q.z, q.w],
    mode: 'orbit',
    focusId: bodyId,
    scaleLog10: scaleFromFocusDistance(R + h, fovYRad),
  };
}
