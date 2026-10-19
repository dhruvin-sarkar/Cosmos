/**
 * Shared per-frame context of the orbital domain:
 *  - Earth / Sun positions from the registry entities (so satellites sit exactly on the Earth that is drawn), with the
 *    same astronomy-engine computation as a fallback when they are not registered;
 *  - the VISUAL SCALE wiring: Earth's exhibition factor and the satellite-offset factor. Every radius and satellite
 *    offset in this domain goes through `orbitalScale` / `offsetScale` (single local rewire point), fed by the
 *    src/core/visualScale.ts runtime when Earth is registered there, else mirroring the Earth layer's enlarge-bodies rule.
 */
import * as Astronomy from 'astronomy-engine';
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import type { FrameContext } from '../../core/types';
import type { CosmosStore } from '../../state/store';
import { AU_M } from '../../core/units';
import { createSatelliteSystemTransform, isScaledBody, satelliteSystem } from '../../core/visualScale';

export const R_EARTH_M = 6_371_008.4;
/** Equatorial radius used by SGP4 apsis altitudes (WGS-72). */
export const R_EARTH_EQ_M = 6_378_135;

type PositionFn = (tMs: number, out: Vector3) => Vector3;
const fallback = { tMs: Number.NaN, sun: [0, 0, 0], earth: [0, 0, 0] };

function evaluate(tMs: number): void {
  if (tMs === fallback.tMs) return;
  const time = Astronomy.MakeTime(new Date(tMs));
  const s = Astronomy.BaryState(Astronomy.Body.Sun, time);
  const e = Astronomy.BaryState(Astronomy.Body.Earth, time);
  fallback.sun[0] = s.x * AU_M; fallback.sun[1] = s.y * AU_M; fallback.sun[2] = s.z * AU_M;
  fallback.earth[0] = e.x * AU_M; fallback.earth[1] = e.y * AU_M; fallback.earth[2] = e.z * AU_M;
  fallback.tMs = tMs;
}

let registryRef: Pick<EntityRegistry, 'get'> | null = null;
let earthEntity: Entity | undefined;
let sunEntity: Entity | undefined;

export function bindRegistry(r: Pick<EntityRegistry, 'get'> | null): void {
  registryRef = r;
  earthEntity = undefined;
  sunEntity = undefined;
}

function via(key: 'sun' | 'earth', id: string): PositionFn {
  return (tMs, out) => {
    let e = key === 'earth' ? earthEntity : sunEntity;
    if (!e && registryRef) {
      e = registryRef.get(id);
      // Never resolve to ourselves; a registry without the body falls back to astronomy-engine.
      if (key === 'earth') earthEntity = e; else sunEntity = e;
    }
    if (e) return e.position(tMs, out);
    evaluate(tMs);
    const p = fallback[key];
    return out.set(p[0], p[1], p[2]);
  };
}

/** Barycentric ICRS position (m) of Earth's centre. */
export const earthPosition: PositionFn = via('earth', 'sol:earth');
/** Barycentric ICRS position (m) of the Sun's centre. */
export const sunPosition: PositionFn = via('sun', 'sol:sun');

// ── Visual scale ─────────────────────────────────────────────────────────────────────────────

/** Earth layer's fallback enlargement rule when Earth is not registered with src/core/visualScale.ts
 *  (src/domains/earth/layer.ts: ENLARGE_TARGET_PX 10, MAX_ENLARGE 40, under the 'enlarge-bodies' overlay). */
const FALLBACK_TARGET_PX = 10;
const FALLBACK_MAX = 40;

/**
 * The single source of scale for this domain, updated once per frame by the orbital layers (first one wins per frame).
 * Satellite offsets follow the VISUAL SCALE contract (src/core/visualScale.ts mapSatelliteOffset): an offset `a` from
 * Earth's centre is drawn at  f·min(a, c) + max(a − c, 0)·g  with f = Earth's factor, c = Earth's radius, g = √f — so every
 * satellite stays outside the enlarged Earth and the whole system is magnified about Earth's drawn centre.
 */
export const orbitalScale = {
  frame: -1,
  /** Earth's radius factor (drawn radius = R⊕ · earthFactor). */
  earthFactor: 1,
  /** Rigid core radius, m (offsets ≤ core scale by earthFactor). */
  core: R_EARTH_M,
  /** Growth of the gap beyond the core. */
  gap: 1,
  earthDistM: 1e7,
  /** Earth's drawn position (ICRS m, rel. SSB) this frame. */
  earthDraw: new Vector3(),
  /** Earth's true position this frame. */
  earthTrue: new Vector3(),
};

const sys = createSatelliteSystemTransform();

/** Scale factor s(a) with drawnOffset = s · trueOffset (allocation-free). */
export function offsetScale(a: number): number {
  const f = orbitalScale.earthFactor;
  if (f <= 1 || !(a > 0)) return 1;
  const c = orbitalScale.core;
  return a <= c ? f : (f * c + (a - c) * orbitalScale.gap) / a;
}

/** Map a true Earth-relative offset to its drawn Earth-relative offset, in place. */
export function mapRel(rel: Vector3): Vector3 {
  return rel.multiplyScalar(offsetScale(rel.length()));
}

/** Drawn world position of a satellite at true Earth-relative offset `rel` (rel is not modified). */
export function satWorld(rel: Vector3, out: Vector3): Vector3 {
  const s = offsetScale(rel.length());
  return out.copy(orbitalScale.earthDraw).addScaledVector(rel, s);
}

/** Earth's drawn position at `tMs` (the visual-scale runtime's render position when Earth is registered). */
export function earthDrawPosition(tMs: number, out: Vector3): Vector3 {
  if (isScaledBody('sol:earth') && satelliteSystem('sol:earth', tMs, sys)) return out.copy(sys.renderPosition);
  return earthPosition(tMs, out);
}

export function updateOrbitalScale(ctx: FrameContext, _store: CosmosStore | null, earthWorld: Vector3): void {
  if (orbitalScale.frame === ctx.frame) return;
  orbitalScale.frame = ctx.frame;
  orbitalScale.earthTrue.copy(earthWorld);
  let f = 1;
  let core = R_EARTH_M;
  if (isScaledBody('sol:earth') && satelliteSystem('sol:earth', ctx.timeMs, sys)) {
    f = sys.factor;
    core = sys.coreRadiusM > 0 ? sys.coreRadiusM : R_EARTH_M;
    orbitalScale.earthDraw.copy(sys.renderPosition);
  } else {
    orbitalScale.earthDraw.copy(earthWorld);
    if (ctx.overlays['enlarge-bodies']) {
      const dd = Math.max(earthWorld.distanceTo(ctx.cameraPosition), 1);
      const pxTrue = (2 * R_EARTH_M / dd) * ctx.pixelsPerRadian;
      f = Math.min(FALLBACK_MAX, Math.max(1, FALLBACK_TARGET_PX / Math.max(pxTrue, 1e-6)));
    }
  }
  f = Number.isFinite(f) && f >= 1 ? f : 1;
  orbitalScale.earthFactor = f;
  orbitalScale.core = core;
  orbitalScale.gap = sys.factor === f && f > 1 ? sys.gapScale : Math.sqrt(f);
  orbitalScale.earthDistM = Math.max(orbitalScale.earthDraw.distanceTo(ctx.cameraPosition), 1);
}
