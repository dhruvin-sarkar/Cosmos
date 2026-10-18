/**
 * Camera "up" reference by context (docs/ARCHITECTURE.md §6.4): the focused body's rotational pole close up →
 * ecliptic north at planetary-system scales → galactic north beyond ~10¹⁹ m.
 */
import { Vector3 } from 'three';
import type { Entity, EntityKind } from '../entity';
import { ECLIPTIC_NORTH_POLE_ICRS, GALACTIC_NORTH_POLE_ICRS, bodyPoleIcrs, type SolarSystemBodyName } from '../frames';
import { smoothstep } from '../scale';
import { anyPerpendicular, nlerpUnit, rejectFrom } from './vec';

/**
 * Optional, duck-typed extension a domain may add to its entities (not part of the Entity contract):
 * the body's north rotational pole as a unit vector in ICRS axes.
 */
export interface PoleProvider {
  northPole?(tMs: number, out: Vector3): Vector3;
}

export const ECLIPTIC_NORTH = new Vector3(ECLIPTIC_NORTH_POLE_ICRS.x, ECLIPTIC_NORTH_POLE_ICRS.y, ECLIPTIC_NORTH_POLE_ICRS.z);
export const GALACTIC_NORTH = new Vector3(GALACTIC_NORTH_POLE_ICRS.x, GALACTIC_NORTH_POLE_ICRS.y, GALACTIC_NORTH_POLE_ICRS.z);
export const ICRS_NORTH = new Vector3(0, 0, 1);

/** Pole → ecliptic transition, in decades above log10(body radius) (≈ 20 R … 200 R). */
export const POLE_FADE_START_DECADES = 1.3;
export const POLE_FADE_END_DECADES = 2.3;
/** Ecliptic → galactic transition, view scale (log10 m). Fully galactic beyond 10¹⁹ m. */
export const GALACTIC_FADE_START = 17;
export const GALACTIC_FADE_END = 19;

const SOLAR_SYSTEM_BODIES: Readonly<Record<string, SolarSystemBodyName>> = {
  'sol:sun': 'Sun', 'sol:mercury': 'Mercury', 'sol:venus': 'Venus', 'sol:earth': 'Earth', 'sol:moon': 'Moon',
  'sol:mars': 'Mars', 'sol:jupiter': 'Jupiter', 'sol:saturn': 'Saturn', 'sol:uranus': 'Uranus',
  'sol:neptune': 'Neptune', 'sol:pluto': 'Pluto',
};

/** Kinds whose rotation axis is a meaningful "up" when seen close up. */
const POLE_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'star', 'planet', 'dwarf-planet', 'moon', 'asteroid', 'comet', 'exoplanet',
]);

export function hasPoleKind(entity: Entity): boolean {
  return POLE_KINDS.has(entity.kind) && (entity.radiusM ?? 0) > 0;
}

interface PoleCacheEntry {
  tMs: number;
  pole: Vector3;
}

/** Re-evaluate astronomy-engine poles at most this often in simulation time (they move < 0.1″ per day). */
const POLE_CACHE_MS = 6 * 3600 * 1000;
const poleCache = new Map<string, PoleCacheEntry>();

/**
 * North pole of an entity in ICRS: `entity.northPole()` when the domain provides it, the IAU model from
 * astronomy-engine for Solar System bodies ('sol:*'), else ICRS +Z.
 */
export function entityNorthPole(entity: Entity, tMs: number, out: Vector3): Vector3 {
  const provider = entity as Entity & PoleProvider;
  if (typeof provider.northPole === 'function') {
    provider.northPole(tMs, out);
    const len = out.length();
    if (len > 0 && Number.isFinite(len)) return out.multiplyScalar(1 / len);
  }
  const body = SOLAR_SYSTEM_BODIES[entity.id];
  if (!body) return out.copy(ICRS_NORTH);
  let entry = poleCache.get(entity.id);
  if (!entry) {
    entry = { tMs: Number.NaN, pole: new Vector3() };
    poleCache.set(entity.id, entry);
  }
  if (!(Math.abs(tMs - entry.tMs) < POLE_CACHE_MS)) {
    bodyPoleIcrs(body, tMs, entry.pole);
    entry.tMs = tMs;
  }
  return out.copy(entry.pole);
}

export interface UpWeights {
  pole: number;
  ecliptic: number;
  galactic: number;
}

/**
 * Blend weights of the three up references at a view scale. `poleBodyRadiusM` is the radius of the body whose pole
 * applies (null when the context has no such body).
 */
export function upBlendWeights(scaleLog10: number, poleBodyRadiusM: number | null, out: UpWeights): UpWeights {
  const galactic = smoothstep(GALACTIC_FADE_START, GALACTIC_FADE_END, scaleLog10);
  let poleFade = 0;
  if (poleBodyRadiusM !== null && poleBodyRadiusM > 0) {
    const base = Math.log10(poleBodyRadiusM);
    poleFade = 1 - smoothstep(base + POLE_FADE_START_DECADES, base + POLE_FADE_END_DECADES, scaleLog10);
  }
  out.pole = poleFade * (1 - galactic);
  out.ecliptic = (1 - poleFade) * (1 - galactic);
  out.galactic = galactic;
  return out;
}

/** Dominant reference of a weight set. */
export function dominantUp(w: UpWeights): 'pole' | 'ecliptic' | 'galactic' {
  if (w.pole >= w.ecliptic && w.pole >= w.galactic) return 'pole';
  return w.ecliptic >= w.galactic ? 'ecliptic' : 'galactic';
}

/** Preferred up direction for the weights (pole → ecliptic → galactic, normalized blends). */
export function preferredUpFromWeights(pole: Vector3, w: UpWeights, out: Vector3): Vector3 {
  const nonGal = w.pole + w.ecliptic;
  const towardEcliptic = nonGal > 0 ? w.ecliptic / nonGal : 1;
  nlerpUnit(pole, ECLIPTIC_NORTH, towardEcliptic, out);
  return nlerpUnit(out, GALACTIC_NORTH, w.galactic, out);
}

const scratchPerp = new Vector3();

/**
 * Soft up correction for a camera frame: rotates `up` (unit, ⟂ forward) toward the preferred up projected onto the
 * view plane. The pull fades out when the view looks along the preferred up (projection ill-defined), so the frame
 * never flips; `strength` ∈ [0, 1] is the fraction of the gap closed this frame. Returns `up` (re-orthonormalized).
 */
export function correctUp(forward: Vector3, up: Vector3, preferred: Vector3, strength: number): Vector3 {
  rejectFrom(preferred, forward, scratchPerp);
  const len = scratchPerp.length();
  const pull = strength * smoothstep(0.02, 0.15, len);
  if (pull > 0 && len > 1e-9) {
    scratchPerp.multiplyScalar(1 / len);
    nlerpUnit(up, scratchPerp, pull, up);
  }
  rejectFrom(up, forward, up);
  const l2 = up.length();
  if (l2 < 1e-9) anyPerpendicular(forward, up);
  else up.multiplyScalar(1 / l2);
  return up;
}
