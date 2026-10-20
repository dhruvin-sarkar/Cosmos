/**
 * Guided tours / exhibition mode (docs/ARCHITECTURE.md §13): data-driven steps executed through
 * AppCommands, so a tour can do nothing a visitor could not do by hand.
 *
 * Each step runs the tour's `baseline` actions, then its own actions, in order. Camera actions ('focus',
 * 'travel', 'view-*') are awaited only when the step sets `waitForTravel`; otherwise they start and the
 * remaining actions run immediately. 'wait' always pauses. Going to another step (next/prev/restart/exit)
 * cancels the in-flight one: its pending actions are skipped. Exiting a tour restores the visitor's visual
 * scale and spectral band.
 *
 * Tour content (narration, framing) lives in src/content/tours/.
 */
import type { EntityRegistry, LabId } from '../core/entity';
import * as THREE from 'three';
import type { CameraViewState, OverlayId, SpectralBandId, TravelOptions } from '../core/types';
import type { VisualScaleMode } from '../core/visualScale';
import { setVisualScale, type CosmosStore } from '../state/store';
import type { AppCommands } from './commands';

export type TourAction =
  | { type: 'focus'; id: string; options?: TravelOptions }
  | { type: 'travel'; id: string; options?: TravelOptions }
  | { type: 'scale'; scaleLog10: number; animate?: boolean }
  | { type: 'overlay'; id: OverlayId; on: boolean }
  | { type: 'spectral'; band: SpectralBandId }
  | { type: 'time-rate'; rate: number }
  /** Absolute Unix ms, or 'now'. */
  | { type: 'time-jump'; ms: number | 'now' }
  /**
   * Jump the clock forward (within `windowHours`, default 12) to the first moment when the angle at `anchorId`
   * between `satelliteId` and the Sun is `sunAngleDeg`: e.g. a moon on its planet's day side, so a camera behind
   * the moon sees both sunlit with the planet looming beyond.
   */
  | { type: 'time-align'; anchorId: string; satelliteId: string; sunAngleDeg: number; windowHours?: number }
  | { type: 'lab'; lab: LabId | null; params?: Record<string, unknown> }
  | { type: 'select'; id: string | null }
  /** Exhibition (enlarged for visibility) or true scale. */
  | { type: 'visual-scale'; mode: VisualScaleMode }
  /** Pause the step (real ms), e.g. to reveal a second view after the visitor has taken in the first. */
  | { type: 'wait'; ms: number }
  /** Orbit-frame the anchor from above the ecliptic: elevation and azimuth (ecliptic longitude) in degrees. */
  | { type: 'view-from'; anchorId: string; distanceM: number; elevationDeg: number; azimuthDeg: number; durationSec?: number }
  /**
   * Orbit-frame the anchor at a Sun–body–camera phase angle (degrees, measured in the ecliptic plane, `side`
   * picks the east (+1) or west (−1) limb) and an elevation above the body's ecliptic plane. 0° = full disc,
   * 50–70° = the lit gibbous approach of VISUAL_DIRECTION, 150° = backlit crescent.
   */
  | { type: 'view-phase'; anchorId: string; distanceM: number; phaseDeg: number; elevationDeg?: number; side?: 1 | -1; durationSec?: number }
  /**
   * Orbit-frame the anchor from the direction of another entity (or from the opposite side with `away`, which
   * puts `towardId` behind the anchor). `sunwardDeg` then turns that line up to this many degrees toward the Sun, so
   * the anchor's lit side faces the camera; `azimuthOffsetDeg` / `elevationOffsetDeg` swing the camera off the result.
   */
  | {
      type: 'view-toward'; anchorId: string; towardId: string; distanceM: number; away?: boolean; sunwardDeg?: number;
      azimuthOffsetDeg?: number; elevationOffsetDeg?: number; durationSec?: number;
    }
  /**
   * Orbit-frame the anchor looking down the orbit normal of `satelliteId` around it (both bodies and the
   * satellite's orbit in view), tipped `tiltDeg` toward the Sun so the sunlit hemisphere faces the camera.
   */
  | { type: 'view-orbit-normal'; anchorId: string; satelliteId: string; distanceM: number; tiltDeg?: number; durationSec?: number }
  /**
   * A camera view computed when the action runs (e.g. a domain's named view built from its own frame, such as the
   * galaxy's face-on view). Null (frame not ready) falls back to focusing `fallbackId` when given.
   */
  | { type: 'view'; view: () => CameraViewState | null; fallbackId?: string; durationSec?: number };

export interface TourStep {
  id: string;
  title: string;
  /** Two to four short sentences of plain-language narration (plain text, never HTML). */
  narration: string;
  /** Order of magnitude shown as the chapter index ("10⁷ m"), per VISUAL_DIRECTION; optional. */
  scaleLog10?: number;
  /** Presenter hint in small type, e.g. "Drag to orbit Earth". */
  hint?: string;
  actions: TourAction[];
  /** Await camera travel before running the following actions. */
  waitForTravel?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  /** Actions run at the start of every step (each step then sets what it needs on top). */
  baseline?: TourAction[];
  steps: TourStep[];
}

/** Subset of AppCommands a tour may drive (tours never call tour commands themselves). */
export type TourCommands = Pick<
  AppCommands,
  'focus' | 'travelTo' | 'setScale' | 'setOverlay' | 'setSpectralBand' | 'setTimeRate' | 'jumpToTime' | 'timeToNow' | 'openLab' | 'closeLab' | 'select'
>;

export interface TourRunner {
  register(tour: Tour): void;
  get(id: string): Tour | undefined;
  list(): readonly Tour[];
  /** Currently active step, or null. */
  currentStep(): TourStep | null;
  start(id: string): boolean;
  next(): void;
  prev(): void;
  restartStep(): void;
  exit(): void;
}

const DEG = Math.PI / 180;
const OBLIQUITY_J2000_RAD = 23.439281 * DEG;
const COS_E = Math.cos(OBLIQUITY_J2000_RAD);
const SIN_E = Math.sin(OBLIQUITY_J2000_RAD);
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Unit vector (ICRS) for an ecliptic longitude/latitude in radians. */
function eclipticToIcrs(azRad: number, elRad: number, out: THREE.Vector3): THREE.Vector3 {
  const xe = Math.cos(elRad) * Math.cos(azRad);
  const ye = Math.cos(elRad) * Math.sin(azRad);
  const ze = Math.sin(elRad);
  // Ecliptic → ICRS: rotate about +X by the obliquity.
  return out.set(xe, ye * COS_E - ze * SIN_E, ye * SIN_E + ze * COS_E);
}

/** Ecliptic longitude/latitude (radians) of an ICRS direction. */
function icrsToEcliptic(v: THREE.Vector3): { az: number; el: number } {
  const len = v.length() || 1;
  const xe = v.x / len;
  const ye = (v.y * COS_E + v.z * SIN_E) / len;
  const ze = (-v.y * SIN_E + v.z * COS_E) / len;
  return { az: Math.atan2(ye, xe), el: Math.asin(Math.max(-1, Math.min(1, ze))) };
}

/**
 * Camera view looking at `anchorId` from `dir` (unit vector from the anchor toward the camera, ICRS axes),
 * ecliptic north up on screen.
 */
export function viewAlong(anchorId: string, distanceM: number, dir: THREE.Vector3): CameraViewState {
  _z.copy(dir).normalize(); // camera +Z points away from the target
  _n.set(0, -SIN_E, COS_E); // ecliptic north
  _x.crossVectors(_n, _z);
  if (_x.lengthSq() < 1e-8) _x.set(1, 0, 0); // looking straight down the ecliptic pole
  _x.normalize();
  _y.crossVectors(_z, _x);
  _q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  return {
    anchorId,
    offset: [_z.x * distanceM, _z.y * distanceM, _z.z * distanceM],
    quaternion: [_q.x, _q.y, _q.z, _q.w],
    mode: 'orbit',
    focusId: anchorId,
    scaleLog10: Math.log10(distanceM),
  };
}

/** Camera view looking at `anchorId` from the given ecliptic elevation/azimuth (ICRS axes), ecliptic north up. */
export function eclipticViewFrom(anchorId: string, distanceM: number, elevationDeg: number, azimuthDeg: number): CameraViewState {
  return viewAlong(anchorId, distanceM, eclipticToIcrs(azimuthDeg * DEG, elevationDeg * DEG, new THREE.Vector3()));
}

/** Resolves entity positions for the geometry-aware views. */
export type TourPositionSource = (id: string, timeMs: number, out: THREE.Vector3) => boolean;

/**
 * Direction (unit, ICRS, from the anchor toward the camera) for a 'view-phase' / 'view-toward' /
 * 'view-orbit-normal' action at `timeMs`, or null when a body cannot be resolved.
 */
export function tourViewDirection(
  action: Extract<TourAction, { type: 'view-phase' | 'view-toward' | 'view-orbit-normal' }>,
  timeMs: number,
  position: TourPositionSource,
  out: THREE.Vector3,
): THREE.Vector3 | null {
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  if (!position(action.anchorId, timeMs, a)) return null;
  switch (action.type) {
    case 'view-phase': {
      if (!position('sol:sun', timeMs, b)) b.set(0, 0, 0);
      const toSun = icrsToEcliptic(b.sub(a));
      const side = action.side ?? 1;
      return eclipticToIcrs(toSun.az + side * action.phaseDeg * DEG, (action.elevationDeg ?? 0) * DEG, out);
    }
    case 'view-toward': {
      if (!position(action.towardId, timeMs, b)) return null;
      b.sub(a);
      if (action.away) b.negate();
      b.normalize();
      if (action.sunwardDeg) {
        const s = new THREE.Vector3();
        if (!position('sol:sun', timeMs, s)) s.set(0, 0, 0);
        s.sub(a).normalize();
        const angle = Math.acos(Math.max(-1, Math.min(1, b.dot(s))));
        const axis = new THREE.Vector3().crossVectors(b, s);
        if (axis.lengthSq() > 1e-12) b.applyAxisAngle(axis.normalize(), Math.min(angle, action.sunwardDeg * DEG));
      }
      const d = icrsToEcliptic(b);
      return eclipticToIcrs(d.az + (action.azimuthOffsetDeg ?? 0) * DEG, d.el + (action.elevationOffsetDeg ?? 0) * DEG, out);
    }
    case 'view-orbit-normal': {
      // Orbit normal from two satellite positions ten minutes apart (relative to the anchor at each time).
      const dtMs = 600_000;
      const a2 = new THREE.Vector3();
      const r1 = new THREE.Vector3();
      const r2 = new THREE.Vector3();
      if (!position(action.satelliteId, timeMs, r1) || !position(action.anchorId, timeMs + dtMs, a2) || !position(action.satelliteId, timeMs + dtMs, r2)) return null;
      r1.sub(a);
      r2.sub(a2);
      const n = out.crossVectors(r1, r2);
      if (n.lengthSq() === 0) return null;
      n.normalize();
      if (!position('sol:sun', timeMs, b)) b.set(0, 0, 0);
      const s = b.sub(a).normalize();
      if (n.dot(s) < 0) n.negate(); // the pole that faces the Sun
      const perp = s.addScaledVector(n, -s.dot(n));
      const tilt = (action.tiltDeg ?? 0) * DEG;
      if (perp.lengthSq() > 1e-12 && tilt !== 0) n.multiplyScalar(Math.cos(tilt)).addScaledVector(perp.normalize(), Math.sin(tilt));
      return n.normalize();
    }
  }
}

/**
 * First time in [fromMs, fromMs + windowMs] (2-minute samples) when the angle at the anchor between the satellite
 * and the Sun comes within 1.5° of `targetDeg`; else the sample closest to it. Null when a body cannot be resolved.
 */
export function findAlignmentTime(
  anchorId: string, satelliteId: string, targetDeg: number, fromMs: number, windowMs: number, position: TourPositionSource,
): number | null {
  const a = new THREE.Vector3();
  const s = new THREE.Vector3();
  const sun = new THREE.Vector3();
  let best: number | null = null;
  let bestErr = Infinity;
  for (let t = fromMs; t <= fromMs + windowMs; t += 120_000) {
    if (!position(anchorId, t, a) || !position(satelliteId, t, s)) return null;
    if (!position('sol:sun', t, sun)) sun.set(0, 0, 0);
    const err = Math.abs(s.sub(a).angleTo(sun.sub(a)) / DEG - targetDeg);
    if (err < 1.5) return t;
    if (err < bestErr) { bestErr = err; best = t; }
  }
  return best;
}

export function createTourRunner(opts: {
  store: CosmosStore;
  commands: () => TourCommands;
  setView?: (view: CameraViewState, travel?: TravelOptions) => Promise<void>;
  /** Entity lookup for the geometry-aware views ('view-phase', 'view-toward', 'view-orbit-normal'). */
  registry?: Pick<EntityRegistry, 'get'>;
}): TourRunner {
  const tours = new Map<string, Tour>();
  let active: Tour | null = null;
  let stepIndex = 0;
  let runToken = 0;
  /** What the visitor had before the tour, restored on exit. */
  let before: { visualScale: VisualScaleMode; band: SpectralBandId } | null = null;
  const dir = new THREE.Vector3();

  const position: TourPositionSource = (id, timeMs, out) => {
    const e = opts.registry?.get(id);
    if (!e) return false;
    try {
      e.position(timeMs, out);
    } catch {
      return false;
    }
    return Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.z);
  };

  const publish = (): void => {
    opts.store.setState({
      tour: active ? { activeId: active.id, step: stepIndex, stepCount: active.steps.length } : { activeId: null, step: 0, stepCount: 0 },
    });
  };

  const settle = (p: Promise<void>, wait: boolean): Promise<void> | void => {
    if (wait) return p;
    p.catch(() => undefined);
  };

  const runAction = async (action: TourAction, wait: boolean): Promise<void> => {
    const c = opts.commands();
    switch (action.type) {
      case 'focus':
        return settle(c.focus(action.id, action.options), wait);
      case 'travel':
        return settle(c.travelTo(action.id, action.options), wait);
      case 'scale':
        c.setScale(action.scaleLog10, { animate: action.animate ?? true });
        return;
      case 'overlay':
        c.setOverlay(action.id, action.on);
        return;
      case 'spectral':
        c.setSpectralBand(action.band);
        return;
      case 'time-rate':
        c.setTimeRate(action.rate);
        return;
      case 'time-jump':
        if (action.ms === 'now') c.timeToNow();
        else c.jumpToTime(action.ms);
        return;
      case 'time-align': {
        const t = findAlignmentTime(action.anchorId, action.satelliteId, action.sunAngleDeg, opts.store.getState().time.simTimeMs,
          (action.windowHours ?? 12) * 3_600_000, position);
        if (t !== null) c.jumpToTime(t);
        return;
      }
      case 'lab':
        if (action.lab) c.openLab(action.lab, action.params);
        else c.closeLab();
        return;
      case 'select':
        c.select(action.id);
        return;
      case 'visual-scale':
        if (opts.store.getState().visualScale !== action.mode) setVisualScale(opts.store, action.mode);
        return;
      case 'wait':
        await new Promise<void>(resolve => setTimeout(resolve, Math.max(0, action.ms)));
        return;
      case 'view-from':
        if (!opts.setView) return;
        return settle(opts.setView(eclipticViewFrom(action.anchorId, action.distanceM, action.elevationDeg, action.azimuthDeg), { durationSec: action.durationSec }), wait);
      case 'view': {
        let v: CameraViewState | null = null;
        try { v = action.view(); } catch (err) { console.warn('[cosmos] tour view failed', err); }
        if (!v || !opts.setView) {
          if (action.fallbackId) return settle(c.focus(action.fallbackId, { durationSec: action.durationSec }), wait);
          return;
        }
        return settle(opts.setView(v, { durationSec: action.durationSec }), wait);
      }
      case 'view-phase':
      case 'view-toward':
      case 'view-orbit-normal': {
        const t = opts.store.getState().time.simTimeMs;
        const d = tourViewDirection(action, t, position, dir);
        if (!d) {
          // Geometry unavailable (entity not registered yet): fall back to the entity's own approach view.
          return settle(c.focus(action.anchorId, { distanceM: action.distanceM, durationSec: action.durationSec }), wait);
        }
        if (!opts.setView) return;
        return settle(opts.setView(viewAlong(action.anchorId, action.distanceM, d), { durationSec: action.durationSec }), wait);
      }
    }
  };

  const runStep = async (): Promise<void> => {
    if (!active) return;
    const token = ++runToken;
    const step = active.steps[stepIndex];
    publish();
    const actions = active.baseline ? [...active.baseline, ...step.actions] : step.actions;
    for (const action of actions) {
      if (token !== runToken) return;
      try {
        await runAction(action, !!step.waitForTravel);
      } catch (err) {
        console.warn(`[cosmos] tour step '${step.id}' action '${action.type}' failed`, err);
      }
    }
  };

  const goTo = (index: number): void => {
    if (!active) return;
    stepIndex = Math.max(0, Math.min(active.steps.length - 1, index));
    void runStep();
  };

  return {
    register(tour: Tour): void {
      if (tour.steps.length === 0) throw new Error(`Tour '${tour.id}' has no steps`);
      tours.set(tour.id, tour);
    },
    get: id => tours.get(id),
    list: () => [...tours.values()],
    currentStep: () => (active ? active.steps[stepIndex] : null),

    start(id: string): boolean {
      const tour = tours.get(id);
      if (!tour) return false;
      if (!active) {
        const s = opts.store.getState();
        before = { visualScale: s.visualScale, band: s.spectral.band };
      }
      active = tour;
      goTo(0);
      return true;
    },
    next(): void {
      if (!active) return;
      if (stepIndex >= active.steps.length - 1) return;
      goTo(stepIndex + 1);
    },
    prev(): void {
      if (active) goTo(stepIndex - 1);
    },
    restartStep(): void {
      if (active) goTo(stepIndex);
    },
    exit(): void {
      runToken++;
      const wasActive = active !== null;
      active = null;
      stepIndex = 0;
      publish();
      if (wasActive && before) {
        if (opts.store.getState().visualScale !== before.visualScale) setVisualScale(opts.store, before.visualScale);
        if (opts.store.getState().spectral.band !== before.band) opts.commands().setSpectralBand(before.band);
        opts.commands().setTimeRate(1);
      }
      before = null;
    },
  };
}

export { SOLAR_SYSTEM_TOUR } from '../content/tours/solarSystem';
export { GOLDEN_JOURNEY } from '../content/tours/goldenJourney';
export { QUICK_TOUR } from '../content/tours/quick';
