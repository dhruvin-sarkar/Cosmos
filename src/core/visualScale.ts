/**
 * Exhibition scale — the single source of truth for drawing bodies larger than life (docs/design/VISUAL_SCALE.md).
 *
 * In the default EXHIBITION mode every opted-in body is drawn enlarged so it reads as a disc at system scale, and shrinks
 * smoothly back to its true size as the camera approaches it (exactly true inside TRUE_SCALE_RADII radii). Heliocentric
 * positions never change. A satellite system (moons, artificial satellites, rings) is magnified around its parent so that
 * satellites always stay outside the enlarged parent. TRUE mode draws everything at its real size.
 *
 * Two levels of API:
 *  1. Pure laws (no state): `bodyScale`, `targetDiameterPx`, `mapSatelliteOffset`, `satelliteOffsetScale`,
 *     `maxFactorForClearance`, `satelliteMaxFactor`. Unit-tested in visualScale.test.ts.
 *  2. A registry-level runtime: domains `registerScaledBody(entity)` once; then the renderer (layers), the camera rig and
 *     the picker all ask `renderTransform(entity, tMs, out)` / `renderPosition` / `renderRadius`, so what is drawn, what the
 *     camera travels to and what the cursor hits always agree. Unregistered entities are identity (true position, factor 1).
 *     The camera rig feeds the runtime each frame (`updateScaleView`, `stepVisualScale`) before layers update, so layers see
 *     exactly the camera position of the frame they draw.
 *
 * Laws (all in CSS px of a viewport of height H, with the engine's px-per-radian H / fovY):
 *  - target apparent diameter T = H · TARGET_EARTH_FRACTION · sqrt(R / R⊕), clamped per kind (square-root compression keeps
 *    the size ordering readable: Jupiter ≈ 3.3 × Earth instead of 11 ×; Mercury ≈ 0.62 ×);
 *  - displayed diameter D = (p⁴ + T⁴)^¼ where p is the true apparent diameter (a smooth max: D → T far away, D → p close);
 *  - distance gate: the enlargement (D/p − 1) is multiplied by smoothstep(TRUE_SCALE_RADII, FULL_EXHIBITION_RADII, d/R), so the
 *    body is EXACTLY true size within 40 radii and the transition is C¹-smooth (no popping);
 *  - caps: a planet's enlarged satellite system stays within PRIMARY_CLEARANCE_FRACTION of its distance from the Sun, the Sun
 *    stays well inside Mercury's perihelion, a satellite stays within SATELLITE_SIZE_GAP_FRACTION of its gap to the parent;
 *  - satellite offsets: a' = f·min(a, c) + max(a − c, 0)·f^SATELLITE_GAP_EXPONENT, c = the parent's core radius (its radius or
 *    ring outer edge). Rings and ring-moons scale exactly with the parent (×f); the gap beyond grows by √f so a magnified Moon
 *    stays near Earth instead of flying out to Venus. Continuous, monotonic, identity when f = 1.
 */
import * as THREE from 'three';
import type { Entity, EntityKind } from './entity';

export type VisualScaleMode = 'exhibition' | 'true';

// ── Constants ────────────────────────────────────────────────────────────────────────────────

/** IAU 2015 nominal mean Earth radius (m) — the reference body of the square-root law. */
export const REF_EARTH_RADIUS_M = 6.371e6;
/** Target apparent diameter of an Earth-sized body, as a fraction of the viewport height (≈ 28 px at 1080 px; owner: "make the planets and sun bigger"). */
export const TARGET_EARTH_FRACTION = 0.026;
/** Exponent of the size-compression law (0.5 = square root). */
export const SIZE_LAW_EXPONENT = 0.5;
/** Sharpness of the smooth max between true and target size (higher = crisper knee). */
export const KNEE_SHARPNESS = 4;
/** Inside this many radii of the camera a body is drawn at exactly its true size. */
export const TRUE_SCALE_RADII = 40;
/** Beyond this many radii the full exhibition enlargement applies. */
export const FULL_EXHIBITION_RADII = 160;
/** A body's enlarged satellite system may extend at most this fraction of its distance from its primary (the Sun). */
export const PRIMARY_CLEARANCE_FRACTION = 0.12;
/**
 * Beyond the belt the planets are far more widely spaced (Jupiter–Saturn ≥ 3.6 AU apart), so the clearance fraction ramps up to
 * PRIMARY_CLEARANCE_FRACTION_OUTER between 2 and 5 AU (Jupiter) and to PRIMARY_CLEARANCE_FRACTION_FAR between 7 and 9 AU
 * (Saturn outward); this lets Saturn and its rings read at their size next to Uranus and Neptune in outer-system views.
 * Jupiter (aphelion 5.46 AU, 0.22) + Saturn (perihelion 9.04 AU, 0.30) = 3.9 AU vs the 3.58 AU minimum separation: the enlarged
 * systems could only touch in that rare alignment, and only when both are clearance-limited (very distant views).
 */
export const PRIMARY_CLEARANCE_FRACTION_OUTER = 0.22;
export const PRIMARY_CLEARANCE_FRACTION_FAR = 0.3;
const AU_M = 1.495978707e11;

/** Clearance fraction for a body at heliocentric distance `r` (m). */
export function primaryClearanceFraction(r: number): number {
  return PRIMARY_CLEARANCE_FRACTION
    + (PRIMARY_CLEARANCE_FRACTION_OUTER - PRIMARY_CLEARANCE_FRACTION) * smoothstep(2 * AU_M, 5 * AU_M, r)
    + (PRIMARY_CLEARANCE_FRACTION_FAR - PRIMARY_CLEARANCE_FRACTION_OUTER) * smoothstep(7 * AU_M, 9 * AU_M, r);
}
/** Mercury perihelion distance, m (a(1 − e), JPL approximate elements: a = 0.387098 AU, e = 0.205630). */
export const MERCURY_PERIHELION_M = 4.6001e10;
/** The enlarged Sun never exceeds this radius (0.4 × Mercury's perihelion, so Mercury always orbits clear of it). */
export const SUN_MAX_RADIUS_M = 0.4 * MERCURY_PERIHELION_M;
/** Gap beyond a parent's core grows as f^this (0.38: moons stay close to the enlarged planet so it can grow). */
export const SATELLITE_GAP_EXPONENT = 0.38;
/** A satellite's enlarged radius is at most this fraction of its (enlarged) gap to the parent's surface. */
export const SATELLITE_SIZE_GAP_FRACTION = 0.35;
/** Hard ceiling on any factor (numerical safety). */
export const MAX_FACTOR = 1e6;
/** Duration of the Exhibition ⇄ True transition, s (instant under reduced motion). */
export const MODE_TRANSITION_SEC = 1.1;

interface KindLaw {
  /** Size-law target fraction override (else TARGET_EARTH_FRACTION · (R/R⊕)^SIZE_LAW_EXPONENT). */
  fixed?: number;
  /** Clamp of the target apparent diameter, as viewport-height fractions. */
  min: number;
  max: number;
}

/** Per-kind laws. Kinds not listed are never enlarged (stars other than the Sun, galaxies, regions…). */
export const KIND_LAWS: Partial<Record<EntityKind, KindLaw>> = {
  /** The Sun: big and glowing (≈ 81 px at 1080), capped by SUN_MAX_RADIUS_M. */
  star: { min: 0.075, max: 0.075 },
  planet: { min: 0.013, max: 0.085 },
  'dwarf-planet': { min: 0.009, max: 0.032 },
  moon: { min: 0.0045, max: 0.026 },
  asteroid: { min: 0.0025, max: 0.01 },
  comet: { min: 0.0025, max: 0.01 },
  'interstellar-object': { min: 0.0025, max: 0.006 },
  spacecraft: { fixed: 0.004, min: 0.004, max: 0.004 },
  satellite: { fixed: 0.003, min: 0.003, max: 0.003 },
  'space-station': { fixed: 0.005, min: 0.005, max: 0.005 },
  'rocket-body': { fixed: 0.0025, min: 0.0025, max: 0.0025 },
  debris: { fixed: 0.002, min: 0.002, max: 0.002 },
};

/**
 * Outer radius of the parent's rigid "core" (its ring system), m. Rings and anything inside scale exactly with the parent.
 * Sources: NSSDCA ring fact sheets (Saturn A-ring outer edge 136,775 km; Uranus ε ring 51,149 km; Neptune Adams ring 62,930 km).
 */
export const CORE_RADIUS_M: Readonly<Record<string, number>> = {
  'sol:saturn': 1.36775e8,
  'sol:uranus': 5.1149e7,
  'sol:neptune': 6.293e7,
};

/**
 * True extent of each planet's major regular satellite system (semi-major axis of its outermost major moon), m — used to keep the
 * enlarged system inside the planet's clearance. Source: JPL SSD planetary satellite mean elements (ssd.jpl.nasa.gov/sats/elem).
 * Moon 384,400 km; Deimos 23,463 km; Callisto 1,882,700 km; Titan 1,221,870 km; Oberon 583,520 km; Triton 354,759 km;
 * Hydra 64,738 km; Dysnomia 37,300 km; Hiʻiaka 49,880 km; S/2015 (136472) 1 ≈ 21,100 km.
 */
export const SYSTEM_EXTENT_M: Readonly<Record<string, number>> = {
  'sol:earth': 3.844e8,
  'sol:mars': 2.3463e7,
  'sol:jupiter': 1.8827e9,
  'sol:saturn': 1.22187e9,
  'sol:uranus': 5.8352e8,
  'sol:neptune': 3.54759e8,
  'sol:pluto': 6.4738e7,
  'sol:eris': 3.73e7,
  'sol:haumea': 4.988e7,
  'sol:makemake': 2.11e7,
};

// ── Pure laws ────────────────────────────────────────────────────────────────────────────────

function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

/** Target apparent diameter (CSS px) of a body of `radiusM` and `kind`; 0 when the kind is never enlarged. */
export function targetDiameterPx(radiusM: number, kind: EntityKind, viewportHeightPx: number): number {
  const law = KIND_LAWS[kind];
  if (!law || !(radiusM > 0) || !(viewportHeightPx > 0)) return 0;
  const frac = law.fixed ?? TARGET_EARTH_FRACTION * Math.pow(radiusM / REF_EARTH_RADIUS_M, SIZE_LAW_EXPONENT);
  return viewportHeightPx * Math.min(Math.max(frac, law.min), law.max);
}

/** True apparent diameter (CSS px) at the engine's px-per-radian (viewportHeight / fovY). */
export function trueDiameterPx(radiusM: number, distanceM: number, viewportHeightPx: number, fovYRad: number): number {
  if (!(radiusM > 0)) return 0;
  const ppr = viewportHeightPx / fovYRad;
  if (!(distanceM > radiusM)) return viewportHeightPx * 2;
  return 2 * Math.asin(radiusM / distanceM) * ppr;
}

export interface BodyScaleOptions {
  /** Upper bound on the factor (clearance caps), ≥ 1. */
  maxFactor?: number;
  /** Override the target apparent diameter as a viewport-height fraction. */
  targetFraction?: number;
}

/**
 * Exhibition enlargement factor (≥ 1) of a body seen from `cameraDistanceM` (from its centre). Pure: no mode / blend applied.
 * Exactly 1 within TRUE_SCALE_RADII radii and for kinds that are never enlarged.
 */
export function bodyScale(
  radiusM: number, kind: EntityKind, cameraDistanceM: number, viewportHeightPx: number, fovYRad: number, opts?: BodyScaleOptions,
): number {
  if (!(radiusM > 0) || !(cameraDistanceM > 0) || !(viewportHeightPx > 0) || !(fovYRad > 0)) return 1;
  const x = cameraDistanceM / radiusM;
  const gate = smoothstep(TRUE_SCALE_RADII, FULL_EXHIBITION_RADII, x);
  if (gate <= 0) return 1;
  const T = opts?.targetFraction !== undefined ? viewportHeightPx * opts.targetFraction : targetDiameterPx(radiusM, kind, viewportHeightPx);
  if (!(T > 0)) return 1;
  const p = trueDiameterPx(radiusM, cameraDistanceM, viewportHeightPx, fovYRad);
  // (p^k + T^k)^(1/k) / p, written as (1 + (T/p)^k)^(1/k) to stay finite for tiny p.
  const r = T / Math.max(p, 1e-300);
  const k = KNEE_SHARPNESS;
  const raw = r > 1e4 ? r : Math.pow(1 + Math.pow(r, k), 1 / k);
  let f = 1 + (raw - 1) * gate;
  const cap = Math.min(opts?.maxFactor ?? MAX_FACTOR, MAX_FACTOR);
  if (f > cap) f = cap;
  return f < 1 ? 1 : f;
}

/** Mapped (drawn) distance of a satellite at true distance `offsetM` from a parent enlarged by `parentFactor`. */
export function mapSatelliteOffset(parentFactor: number, parentCoreRadiusM: number, offsetM: number): number {
  const f = parentFactor > 1 ? parentFactor : 1;
  if (f === 1 || !(offsetM > 0)) return offsetM;
  const c = parentCoreRadiusM > 0 ? parentCoreRadiusM : 0;
  if (offsetM <= c) return f * offsetM;
  return f * c + (offsetM - c) * Math.pow(f, SATELLITE_GAP_EXPONENT);
}

/** The factor s with drawnOffset = s · trueOffset (≥ 1; = parentFactor inside the core; → 1 as parentFactor → 1). */
export function satelliteOffsetScale(parentFactor: number, parentCoreRadiusM: number, offsetM: number): number {
  if (!(offsetM > 0)) return parentFactor > 1 ? parentFactor : 1;
  return mapSatelliteOffset(parentFactor, parentCoreRadiusM, offsetM) / offsetM;
}

/**
 * Largest parent factor whose enlarged system (core ×f, satellites out to `systemExtentM` mapped) fits in `clearanceM`.
 * Solves c·f + (A − c)·f^k = C (k = SATELLITE_GAP_EXPONENT; monotonic in f, bisection in log f). ≥ 1.
 */
export function maxFactorForClearance(coreRadiusM: number, systemExtentM: number, clearanceM: number): number {
  if (!(coreRadiusM > 0) || !(clearanceM > 0)) return MAX_FACTOR;
  const c = coreRadiusM;
  const A = Math.max(systemExtentM, c);
  if (A <= c) return Math.max(1, Math.min(clearanceM / c, MAX_FACTOR));
  const b = A - c;
  const k = SATELLITE_GAP_EXPONENT;
  if (c + b >= clearanceM) return 1;
  let lo = 0, hi = Math.log(MAX_FACTOR);
  if (c * MAX_FACTOR + b * Math.pow(MAX_FACTOR, k) <= clearanceM) return MAX_FACTOR;
  for (let i = 0; i < 44; i++) {
    const mid = 0.5 * (lo + hi);
    const fm = Math.exp(mid);
    if (c * fm + b * Math.pow(fm, k) > clearanceM) hi = mid; else lo = mid;
  }
  return Math.max(1, Math.min(Math.exp(lo), MAX_FACTOR));
}

/** Cap on a satellite's own factor so it stays clear of its (enlarged) parent's surface. ≥ 1. */
export function satelliteMaxFactor(parentFactor: number, parentRadiusM: number, parentCoreRadiusM: number, offsetM: number, satRadiusM: number): number {
  if (!(satRadiusM > 0)) return 1;
  const mapped = mapSatelliteOffset(parentFactor, parentCoreRadiusM, offsetM);
  const f = parentFactor > 1 ? parentFactor : 1;
  const gap = mapped - f * Math.max(parentRadiusM, 0);
  return Math.max(1, Math.min((SATELLITE_SIZE_GAP_FRACTION * gap) / satRadiusM, MAX_FACTOR));
}

/** Ease used for the Exhibition ⇄ True transition (blend 0..1 → applied weight). */
export function modeEase(blend: number): number {
  return smoothstep(0, 1, blend);
}

// ── Runtime (registry-level render transforms) ────────────────────────────────────────────────

/** Per-frame view the runtime evaluates against (fed by the camera rig). */
export interface ScaleView {
  readonly cameraPosition: THREE.Vector3;
  viewportHeightPx: number;
  fovYRad: number;
  mode: VisualScaleMode;
  /** Raw transition progress toward exhibition, 0..1. */
  blend: number;
  /** Eased weight applied to every enlargement: factor = 1 + (f − 1) · weight. */
  weight: number;
  /** Bumped on every change; render transforms cache on (tMs, version). */
  version: number;
}

const view: ScaleView = {
  cameraPosition: new THREE.Vector3(),
  viewportHeightPx: 1080,
  fovYRad: (50 * Math.PI) / 180,
  mode: 'exhibition',
  blend: 1,
  weight: 1,
  version: 0,
};

/** Read-only access to the current view (layers transforming many points use `weight`, `viewportHeightPx`, `fovYRad`). */
export function getScaleView(): Readonly<ScaleView> {
  return view;
}

/** Called by the camera rig once per frame with the final camera pose (before layers update). */
export function updateScaleView(cameraPosition: THREE.Vector3, viewportHeightPx: number, fovYRad: number): void {
  if (cameraPosition.x === view.cameraPosition.x && cameraPosition.y === view.cameraPosition.y && cameraPosition.z === view.cameraPosition.z &&
    viewportHeightPx === view.viewportHeightPx && fovYRad === view.fovYRad) return;
  view.cameraPosition.copy(cameraPosition);
  if (viewportHeightPx > 0) view.viewportHeightPx = viewportHeightPx;
  if (fovYRad > 0) view.fovYRad = fovYRad;
  view.version++;
}

/** Set the mode; `immediate` skips the eased transition (boot, reduced motion, tests). */
export function setVisualScaleMode(mode: VisualScaleMode, immediate = false): void {
  if (mode !== view.mode) { view.mode = mode; view.version++; }
  if (immediate) {
    const b = mode === 'exhibition' ? 1 : 0;
    if (view.blend !== b) { view.blend = b; view.weight = b; view.version++; }
  }
}

/** Advance the Exhibition ⇄ True transition (called by the camera rig each frame). */
export function stepVisualScale(dtSec: number, mode: VisualScaleMode, reducedMotion = false): void {
  if (mode !== view.mode) { view.mode = mode; view.version++; }
  const target = mode === 'exhibition' ? 1 : 0;
  if (view.blend === target) return;
  if (reducedMotion || !(dtSec >= 0)) view.blend = target;
  else {
    const step = dtSec / MODE_TRANSITION_SEC;
    view.blend = target > view.blend ? Math.min(target, view.blend + step) : Math.max(target, view.blend - step);
  }
  view.weight = modeEase(view.blend);
  view.version++;
}

export interface ScaledBodyOptions {
  /** Defaults to entity.kind. */
  kind?: EntityKind;
  /** Defaults to entity.radiusM. */
  radiusM?: number;
  /** Parent whose satellite system this body belongs to (defaults to entity.parentId). Only a REGISTERED parent magnifies. */
  parentId?: string | null;
  /** Rigid core radius (ring outer edge) for this body as a parent; defaults to CORE_RADIUS_M[id] or the radius. */
  coreRadiusM?: number;
  /** True extent of this body's satellite system; defaults to SYSTEM_EXTENT_M[id] or none. */
  systemExtentM?: number;
  /** Override the clearance (max enlarged system radius), m. */
  clearanceM?: number;
  /** Extra cap on the factor. */
  maxFactor?: number;
  /** Override the target apparent diameter (viewport-height fraction). */
  targetFraction?: number;
}

interface Rec {
  entity: Entity;
  kind: EntityKind;
  radiusM: number;
  parentId: string | null;
  coreRadiusM: number;
  systemExtentM: number;
  clearanceM: number | null;
  maxFactor: number;
  targetFraction: number | undefined;
  // cache
  t: number;
  ver: number;
  factor: number;
  computing: boolean;
  readonly truePos: THREE.Vector3;
  readonly pos: THREE.Vector3;
}

const records = new Map<string, Rec>();
let registryVersion = 0;
const tmp = new THREE.Vector3();

/** Register an entity for exhibition scaling. Returns an unregister function. Re-registering replaces the options. */
export function registerScaledBody(entity: Entity, opts: ScaledBodyOptions = {}): () => void {
  const radiusM = opts.radiusM ?? entity.radiusM ?? 0;
  const rec: Rec = {
    entity,
    kind: opts.kind ?? entity.kind,
    radiusM,
    parentId: opts.parentId !== undefined ? opts.parentId : entity.parentId,
    coreRadiusM: Math.max(opts.coreRadiusM ?? CORE_RADIUS_M[entity.id] ?? radiusM, radiusM),
    systemExtentM: opts.systemExtentM ?? SYSTEM_EXTENT_M[entity.id] ?? 0,
    clearanceM: opts.clearanceM ?? null,
    maxFactor: opts.maxFactor ?? MAX_FACTOR,
    targetFraction: opts.targetFraction,
    t: NaN, ver: -1, factor: 1, computing: false,
    truePos: new THREE.Vector3(), pos: new THREE.Vector3(),
  };
  records.set(entity.id, rec);
  registryVersion++;
  return () => {
    if (records.get(entity.id) === rec) { records.delete(entity.id); registryVersion++; }
  };
}

/** Whether an entity id is scaled by the runtime. */
export function isScaledBody(id: string): boolean {
  return records.has(id);
}

/** Remove every registration (tests, engine teardown). */
export function clearScaledBodies(): void {
  records.clear();
  registryVersion++;
}

function compute(rec: Rec, tMs: number): Rec {
  const ver = view.version + registryVersion * 1e9;
  if (rec.t === tMs && rec.ver === ver) return rec;
  if (rec.computing) return rec; // cycle guard (malformed parent chain)
  rec.computing = true;
  try {
    rec.entity.position(tMs, rec.truePos);
    rec.pos.copy(rec.truePos);
    const w = view.weight;
    let cap = rec.maxFactor;
    const parent = rec.parentId ? records.get(rec.parentId) : undefined;
    if (parent && parent.kind !== 'star') {
      // Satellite of a registered body: magnify its offset around the parent's drawn position.
      compute(parent, tMs);
      tmp.subVectors(rec.truePos, parent.truePos);
      const a = tmp.length();
      if (a > 0 && parent.factor > 1) {
        const s = mapSatelliteOffset(parent.factor, parent.coreRadiusM, a) / a;
        rec.pos.copy(parent.pos).addScaledVector(tmp, s);
      } else {
        rec.pos.copy(parent.pos).add(tmp);
      }
      cap = Math.min(cap, satelliteMaxFactor(parent.factor, parent.radiusM, parent.coreRadiusM, a, rec.radiusM));
    } else if (rec.kind === 'star') {
      cap = Math.min(cap, SUN_MAX_RADIUS_M / Math.max(rec.radiusM, 1));
    } else {
      // Orbits the Sun (or an unregistered primary): keep the enlarged system inside its clearance.
      let clearance = rec.clearanceM;
      if (clearance === null) {
        const sun = records.get('sol:sun');
        if (sun) compute(sun, tMs);
        const r = sun ? tmp.subVectors(rec.truePos, sun.truePos).length() : rec.truePos.length();
        clearance = primaryClearanceFraction(r) * r;
      }
      if (clearance > 0) cap = Math.min(cap, maxFactorForClearance(rec.coreRadiusM, rec.systemExtentM, clearance));
    }
    let f = 1;
    if (w > 0) {
      const d = rec.pos.distanceTo(view.cameraPosition);
      const ex = bodyScale(rec.radiusM, rec.kind, d, view.viewportHeightPx, view.fovYRad, { maxFactor: cap, targetFraction: rec.targetFraction });
      f = 1 + (ex - 1) * w;
    }
    rec.factor = Number.isFinite(f) && f >= 1 ? f : 1;
    if (!Number.isFinite(rec.pos.x + rec.pos.y + rec.pos.z)) rec.pos.copy(rec.truePos);
  } catch {
    rec.factor = 1;
  } finally {
    rec.computing = false;
    rec.t = tMs;
    rec.ver = ver;
  }
  return rec;
}

/**
 * Render transform of an entity at `tMs`: writes its DRAWN position (ICRS m, rel. SSB) into `out` and returns its radius
 * factor (drawn radius = radiusM × factor). Identity (true position, 1) for unregistered entities. Cached per frame.
 */
export function renderTransform(entity: Entity, tMs: number, out: THREE.Vector3): number {
  const rec = records.get(entity.id);
  if (!rec) {
    entity.position(tMs, out);
    return 1;
  }
  compute(rec, tMs);
  out.copy(rec.pos);
  return rec.factor;
}

/** Drawn position (see renderTransform). */
export function renderPosition(entity: Entity, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  renderTransform(entity, tMs, out);
  return out;
}

/** Radius factor only (1 for unregistered entities). */
export function renderFactor(entity: Entity, tMs: number): number {
  const rec = records.get(entity.id);
  if (!rec) return 1;
  return compute(rec, tMs).factor;
}

/** Drawn radius, m (null radius → 0). */
export function renderRadius(entity: Entity, tMs: number): number {
  const r = entity.radiusM ?? 0;
  return r > 0 ? r * renderFactor(entity, tMs) : 0;
}

/** Satellite-system transform of a registered parent, for layers that move many points (artificial satellites, rings, debris). */
export interface SatelliteSystemTransform {
  /** Parent's true position (what child positions are relative to). */
  readonly truePosition: THREE.Vector3;
  /** Parent's drawn position. */
  readonly renderPosition: THREE.Vector3;
  /** Parent radius factor (rings scale by exactly this). */
  factor: number;
  /** Parent rigid core radius, m (offsets ≤ core scale by `factor`). */
  coreRadiusM: number;
  /** Gap growth beyond the core: factor^SATELLITE_GAP_EXPONENT. */
  gapScale: number;
}

/**
 * Fill `out` with the satellite-system transform of `parentId` (identity when not registered). A child at true position P is
 * drawn at  renderPosition + (P − truePosition) · mapSatelliteOffset(factor, coreRadiusM, |P − truePosition|) / |P − truePosition|.
 * Returns false when the parent is not registered (out = identity around nothing; draw at true positions).
 */
export function satelliteSystem(parentId: string, tMs: number, out: SatelliteSystemTransform): boolean {
  const rec = records.get(parentId);
  if (!rec) {
    out.factor = 1; out.gapScale = 1; out.coreRadiusM = 0;
    return false;
  }
  compute(rec, tMs);
  out.truePosition.copy(rec.truePos);
  out.renderPosition.copy(rec.pos);
  out.factor = rec.factor;
  out.coreRadiusM = rec.coreRadiusM;
  out.gapScale = Math.pow(rec.factor, SATELLITE_GAP_EXPONENT);
  return true;
}

export function createSatelliteSystemTransform(): SatelliteSystemTransform {
  return { truePosition: new THREE.Vector3(), renderPosition: new THREE.Vector3(), factor: 1, coreRadiusM: 0, gapScale: 1 };
}

/** Map one child's true position to its drawn position with a filled transform (allocation-free). */
export function applySatelliteSystem(sys: SatelliteSystemTransform, trueChild: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dx = trueChild.x - sys.truePosition.x, dy = trueChild.y - sys.truePosition.y, dz = trueChild.z - sys.truePosition.z;
  const a = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const s = sys.factor > 1 && a > 0 ? mapSatelliteOffset(sys.factor, sys.coreRadiusM, a) / a : 1;
  return out.set(sys.renderPosition.x + dx * s, sys.renderPosition.y + dy * s, sys.renderPosition.z + dz * s);
}
