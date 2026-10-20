/**
 * Camera rig implementation (docs/ARCHITECTURE.md §4.3, §6). See rig.ts for the public contract.
 *
 * Orbit/follow state is (focusId, scaleLog10, forward f, up u, look yaw/pitch). Every frame the focus point is the
 * Cosmic-Ruler blend along the focus chain at the current time and the camera sits at focusPoint − f·d(scale), so
 * moving targets never leave the camera behind regardless of the simulation rate. Free flight stores
 * (anchorId, offset) and re-anchors to the body whose sphere of influence contains the camera.
 */
import * as THREE from 'three';
import { renderPosition, renderRadius, stepVisualScale, updateScaleView, type ScaleFocusInput } from '../visualScale';
import type { CameraMode, CameraViewState, TravelOptions } from '../types';
import type { Entity, EntityKind } from '../entity';
import type { CameraFrameState, CameraRig, CameraRigDeps } from './rig';
import {
  SCALE_MAX_LOG10, SCALE_MIN_LOG10, clamp, focusDistanceFromScale, metersPerUnitForDistance,
  scaleFromFocusDistance, zoomScaleByAltitude,
} from '../scale';
import { CameraControls, createInputFrame, type InputFrame } from './controls';
import { FocusChainEvaluator, chooseAnchor, createFocusChainState, type FocusChainState } from './focusChain';
import {
  chooseArrivalDirection, planZoomPan, sampleZoomPan, travelDurationSec, type Sphere, type ZoomPanPath,
  type ZoomPanSample,
} from './travel';
import { SmoothedDelta, approachFactor, coast, createSpring, stepSpring } from './springs';
import {
  correctUp, dominantUp, entityNorthPole, hasPoleKind, preferredUpFromWeights, upBlendWeights, type UpWeights,
} from './upVector';
import { anyPerpendicular, angleBetweenUnit, isFiniteVec, orthonormalizeUp, rotateAboutAxis, slerpUnit } from './vec';
import { sphereOfInfluenceM } from './soi';
import { ViewHistory } from './history';
import { buildFrameLabel, type UpReference } from './frameLabel';
import { DEG } from '../units';

// ── Tuning ────────────────────────────────────────────────────────────────────────────────────
/** Orbit angle for a drag across the full viewport height. */
const ORBIT_RAD_PER_VIEWPORT = 1.6 * Math.PI;
const KEY_ORBIT_RAD_PER_SEC = 1.3;
const KEY_ZOOM_DECADES_PER_SEC = 1.1;
const DOLLY_DECADES_PER_PX = 0.006;
/** Drag smoothing (critically damped, ≈ 70 ms) and zoom smoothing (≈ 140 ms). */
const DRAG_OMEGA = 28;
const ZOOM_OMEGA = 14;
const COAST_TAU_SEC = 0.32;
const COAST_MIN_RAD_PER_SEC = 0.05;
const COAST_MAX_RAD_PER_SEC = 6;
/** Camera never closer to the focused body's centre than this × its radius. */
export const SURFACE_CLAMP_FACTOR = 1.02;
const OBSTACLE_CLAMP_FACTOR = 1.01;
/**
 * Extended volumes the camera may (and must) be inside: galaxies, groups, superclusters, regions and reference
 * spheres such as the observable universe sit in the focus chain of every Solar System body, so treating them as
 * solid obstacles pushed the camera ~1e26 m away from the focus.
 */
const NON_SOLID_KINDS: ReadonlySet<string> = new Set([
  'stellar-system', 'nebula', 'star-cluster', 'constellation', 'galaxy', 'galaxy-group', 'galaxy-cluster',
  'supercluster', 'void', 'region', 'cosmic-structure', 'reference',
]);
/** Polar limit of the orbit (keeps the camera off the exact pole → no gimbal flip). */
const ORBIT_POLAR_MIN_RAD = 3 * DEG;
const LOOK_PITCH_MAX_RAD = 85 * DEG;
const LOOK_RECENTER_TAU_SEC = 0.35;
/** Up correction per unit of motion (rad of orbit or decades of zoom); idle views never roll. */
const UP_PULL_PER_MOTION = 5;
/** Free flight: crosses the visible width (10^scale) in this many seconds. */
const FREE_CROSS_SEC = 2;
const FREE_FAST_FACTOR = 4;
const FREE_ACCEL_TAU_SEC = 0.25;
const FREE_REANCHOR_INTERVAL_SEC = 0.2;
/** Inspect framing (VISUAL_DIRECTION): focus at 0.60 W → +0.10 W shift; apparent diameter 0.86 H. */
export const INSPECT_SHIFT_X = 0.1;
export const INSPECT_DIAMETER_FRACTION = 0.86;
/** Default arrival framing without the inspector: disc ≈ 0.6 H. */
export const DEFAULT_DIAMETER_FRACTION = 0.6;
const SHIFT_OMEGA = 7;
const SETSCALE_ANIMATE_SEC = 0.6;
/** Extra time per decade so long ruler jumps stay readable (≤ ~0.15 decade per 60 Hz frame). */
const SETSCALE_SEC_PER_DECADE = 0.12;
const SETSCALE_MAX_SEC = 2.5;
const FOLLOW_FD_STEP_SEC = 10;

const LIT_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'planet', 'dwarf-planet', 'moon', 'asteroid', 'comet', 'interstellar-object', 'exoplanet',
  'spacecraft', 'satellite', 'space-station', 'rocket-body', 'debris',
]);
const ORBITER_KINDS: ReadonlySet<EntityKind> = new Set<EntityKind>([
  'spacecraft', 'satellite', 'space-station', 'rocket-body', 'debris', 'moon',
]);
/** Fallback arrival scales (log10 m) for entities without radius or viewDistance. */
const KIND_DEFAULT_SCALE: Partial<Record<EntityKind, number>> = {
  star: 10.5, 'stellar-system': 13, 'black-hole': 13, nebula: 17.5, 'star-cluster': 17.5, constellation: 18,
  galaxy: 21.3, 'galaxy-group': 23, 'galaxy-cluster': 23.5, supercluster: 24.5, void: 24.5, region: 20,
  'cosmic-structure': 25, reference: 22, exoplanet: 8, satellite: 2, debris: 1.5, 'rocket-body': 2,
};

interface TravelState {
  targetId: string;
  /** Focus id to orbit after arrival (null = free flight at the view below). */
  endFocusId: string | null;
  endMode: CameraMode;
  /** Start focus point = startAnchor.position(t) + startOffset (follows the start context). */
  startAnchorId: string;
  readonly startOffset: THREE.Vector3;
  startFocusId: string | null;
  path: ZoomPanPath;
  durationSec: number;
  elapsedSec: number;
  readonly f0: THREE.Vector3;
  readonly u0: THREE.Vector3;
  readonly f1: THREE.Vector3;
  readonly u1: THREE.Vector3;
  look0Yaw: number;
  look0Pitch: number;
  look1Yaw: number;
  look1Pitch: number;
  endScale: number;
  /** Free-flight arrival (setView with focusId null). */
  freeAnchorId: string | null;
  readonly freeOffset: THREE.Vector3;
  resolvers: (() => void)[];
}

export class CosmosCameraRig implements CameraRig {
  private readonly deps: CameraRigDeps;
  private readonly controls: CameraControls;
  private readonly chain: FocusChainEvaluator;
  private readonly chainState: FocusChainState = createFocusChainState();
  private readonly targetChain: FocusChainState = createFocusChainState();
  private readonly history = new ViewHistory();
  private readonly input: InputFrame = createInputFrame();
  private readonly state: CameraFrameState;

  private _mode: CameraMode = 'orbit';
  private _focusId: string | null;
  private _anchorId: string;
  private scale: number;
  private scaleTarget: number;
  private readonly scaleSpring = createSpring(0);
  private scaleTween: { from: number; to: number; t: number; dur: number } | null = null;
  private readonly f = new THREE.Vector3(0, 0, -1);
  private readonly u = new THREE.Vector3(0, 1, 0);
  private lookYaw = 0;
  private lookPitch = 0;
  private lookRecenter = false;
  private readonly yawSmooth = new SmoothedDelta(DRAG_OMEGA);
  private readonly pitchSmooth = new SmoothedDelta(DRAG_OMEGA);
  private readonly lookYawSmooth = new SmoothedDelta(DRAG_OMEGA);
  private readonly lookPitchSmooth = new SmoothedDelta(DRAG_OMEGA);
  private readonly yawCoast = { velocity: 0 };
  private readonly pitchCoast = { velocity: 0 };
  private readonly point = new THREE.Vector3();
  /** Focus context fed to the exhibition-scale runtime each frame (reused; no per-frame allocation). */
  private readonly scaleFocus: ScaleFocusInput = { focusId: null, focusDistanceM: Infinity, dtSec: 0, immediate: false };
  private readonly scaleFocusPos = new THREE.Vector3();
  private readonly preferredUp = new THREE.Vector3(0, 0, 1);
  private readonly weights: UpWeights = { pole: 0, ecliptic: 1, galactic: 0 };
  private poleBody: Entity | null = null;
  private needsInitialPose = true;
  private lastTimeMs: number;
  private travel: TravelState | null = null;
  // Free flight.
  private readonly freeOffset = new THREE.Vector3();
  private readonly freeVelocity = new THREE.Vector3();
  private reanchorTimer = 0;
  // Follow mode: last orbital (RTN) basis.
  private readonly prevBasis = new THREE.Matrix3();
  private hasPrevBasis = false;
  private readonly shiftSpring = createSpring(0);
  private labelKey = '';
  private disposed = false;

  constructor(deps: CameraRigDeps) {
    this.deps = deps;
    const st = deps.store.getState();
    this._focusId = deps.initialFocusId ?? st.camera.focusId ?? 'sol:earth';
    this._anchorId = this._focusId;
    this.scale = clamp(st.view.scaleLog10, SCALE_MIN_LOG10, SCALE_MAX_LOG10);
    this.scaleTarget = this.scale;
    this.scaleSpring.value = this.scale;
    this.lastTimeMs = st.time.simTimeMs;
    this.chain = new FocusChainEvaluator(deps.registry);
    this.state = {
      position: new THREE.Vector3(),
      quaternion: new THREE.Quaternion(),
      forward: new THREE.Vector3(0, 0, -1),
      focusDistanceM: focusDistanceFromScale(this.scale, deps.fovYRad),
      scaleLog10: this.scale,
      metersPerUnit: metersPerUnitForDistance(focusDistanceFromScale(this.scale, deps.fovYRad)),
      focusId: this._focusId,
      anchorId: this._anchorId,
      frameLabel: '',
      projectionShiftX: 0,
    };
    this.controls = new CameraControls({
      element: deps.inputElement,
      keyTarget: typeof window !== 'undefined' ? window : null,
      getViewport: () => deps.getViewport(),
      onClick: (x, y, dbl) => deps.onPointerClick(x, y, dbl),
      onHover: (x, y) => deps.onPointerHover(x, y),
    });
  }

  // ── CameraController ─────────────────────────────────────────────────────────────────────

  get mode(): CameraMode { return this._mode; }
  get focusId(): string | null { return this._focusId; }
  get anchorId(): string { return this._anchorId; }
  get traveling(): boolean { return this.travel !== null; }

  focus(id: string, opts?: TravelOptions): Promise<void> {
    const endMode: CameraMode = this._mode === 'follow' ? 'follow' : 'orbit';
    return this.beginEntityTravel(id, opts, endMode);
  }

  travelTo(id: string, opts?: TravelOptions): Promise<void> {
    const endMode: CameraMode = this._mode === 'follow' ? 'follow' : 'orbit';
    return this.beginEntityTravel(id, opts, endMode);
  }

  setScale(scaleLog10: number, opts?: { animate?: boolean; durationSec?: number }): void {
    if (!Number.isFinite(scaleLog10)) return;
    if (this.travel) this.interruptTravel();
    const target = clamp(scaleLog10, this.minScale(), SCALE_MAX_LOG10);
    if (opts?.animate && !this.deps.store.getState().ui.reducedMotion) {
      const auto = Math.min(SETSCALE_ANIMATE_SEC + SETSCALE_SEC_PER_DECADE * Math.abs(target - this.scale), SETSCALE_MAX_SEC);
      this.scaleTween = { from: this.scale, to: target, t: 0, dur: Math.max(opts.durationSec ?? auto, 0.05) };
    } else {
      this.scaleTween = null;
      this.scale = this.scaleTarget = this.scaleSpring.value = target;
      this.scaleSpring.velocity = 0;
    }
  }

  setMode(mode: CameraMode): void {
    if (mode === this._mode) return;
    if (this.travel) {
      this.travel.endMode = mode;
      return;
    }
    const prev = this._mode;
    if (mode === 'free') this.enterFree();
    else if (prev === 'free') this.leaveFree();
    this._mode = mode;
    this.hasPrevBasis = false;
    this.writeCameraStore();
  }

  getView(): CameraViewState {
    const anchor = this.deps.registry.get(this._anchorId);
    const anchorPos = SCRATCH.a;
    if (!anchor || !safePosition(anchor, this.lastTimeMs, anchorPos)) anchorPos.set(0, 0, 0);
    const p = this.state.position, q = this.state.quaternion;
    return {
      anchorId: this._anchorId,
      offset: [p.x - anchorPos.x, p.y - anchorPos.y, p.z - anchorPos.z],
      quaternion: [q.x, q.y, q.z, q.w],
      mode: this._mode,
      focusId: this._focusId,
      scaleLog10: this.scale,
    };
  }

  setView(view: CameraViewState, opts?: TravelOptions): Promise<void> {
    if (!view || !Array.isArray(view.offset) || !Array.isArray(view.quaternion)) return Promise.resolve();
    this.history.push(this.getView());
    return this.beginViewTravel(view, opts);
  }

  back(): boolean {
    const view = this.history.pop();
    if (!view) return false;
    void this.beginViewTravel(view, undefined);
    return true;
  }

  cancelTravel(): void {
    if (this.travel) this.interruptTravel();
  }

  // ── Frame update ─────────────────────────────────────────────────────────────────────────

  update(dtRealSec: number, timeMs: number): CameraFrameState {
    const dt = clamp(Number.isFinite(dtRealSec) ? dtRealSec : 0, 0, 0.1);
    this.lastTimeMs = timeMs;
    const vsState = this.deps.store.getState();
    stepVisualScale(dt, vsState.visualScale ?? 'exhibition', vsState.ui.reducedMotion);
    const input = this.controls.consume(this.input);
    const keys = this.controls.keys;
    const keyActive = keys.left || keys.right || keys.up || keys.down || keys.zoomIn || keys.zoomOut ||
      keys.forward || keys.back || keys.strafeLeft || keys.strafeRight || keys.rise || keys.sink;
    if (this.travel && (input.interacted || keyActive)) this.interruptTravel();

    if (this.needsInitialPose && !this.travel) this.tryInitialPose(timeMs);

    if (this.travel) this.stepTravel(dt, timeMs);
    else if (this._mode === 'free') this.stepFree(dt, timeMs, input);
    else this.stepOrbit(dt, timeMs, input);

    this.finishFrame(dt);
    // Feed the exhibition-scale runtime with this frame's final pose (layers update after the rig).
    this.feedScaleFocus(dt, timeMs, vsState.ui.reducedMotion);
    updateScaleView(this.state.position, this.deps.getViewport().height, this.deps.fovYRad, this.scaleFocus);
    return this.state;
  }

  /** Context for the exhibition-scale gate: the travel target while travelling, else the focus (or the free-flight anchor). */
  private feedScaleFocus(dt: number, timeMs: number, reducedMotion: boolean): void {
    const sf = this.scaleFocus;
    sf.resolve ??= (id: string) => this.deps.registry.get(id);
    const id = this.travel ? this.travel.targetId : (this._focusId ?? this._anchorId);
    const e = id ? this.deps.registry.get(id) : undefined;
    sf.focusId = e ? id : null;
    sf.focusDistanceM = Infinity;
    if (e) {
      try {
        e.position(timeMs, this.scaleFocusPos);
        const d = this.scaleFocusPos.distanceTo(this.state.position);
        if (Number.isFinite(d)) sf.focusDistanceM = d;
      } catch { /* unpositioned: no gate */ }
    }
    sf.dtSec = dt;
    sf.immediate = reducedMotion;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.travel) this.interruptTravel();
    this.controls.dispose();
    this.chain.dispose();
  }

  // ── Orbit / follow ───────────────────────────────────────────────────────────────────────

  private stepOrbit(dt: number, timeMs: number, input: InputFrame): void {
    const vp = this.deps.getViewport();
    const k = ORBIT_RAD_PER_VIEWPORT / Math.max(vp.height, 1);
    const keys = this.controls.keys;
    const fast = keys.fast ? 3 : 1;

    if (this._mode === 'follow') this.applyFollowRotation(timeMs);
    else this.hasPrevBasis = false;

    // Orbit input → smoothed yaw/pitch (+ release inertia).
    if (input.dragging) this.yawCoast.velocity = this.pitchCoast.velocity = 0;
    if (input.orbitDx !== 0 || input.orbitDy !== 0) {
      this.yawSmooth.add(-input.orbitDx * k);
      this.pitchSmooth.add(input.orbitDy * k);
    }
    if (input.releaseKind === 'orbit') {
      this.yawCoast.velocity = clampMagnitude(-input.releaseVx * k, COAST_MIN_RAD_PER_SEC, COAST_MAX_RAD_PER_SEC);
      this.pitchCoast.velocity = clampMagnitude(input.releaseVy * k, COAST_MIN_RAD_PER_SEC, COAST_MAX_RAD_PER_SEC);
    }
    let dyaw = this.yawSmooth.take(dt) + coast(this.yawCoast, dt, COAST_TAU_SEC) + input.twistRad;
    let dpitch = this.pitchSmooth.take(dt) + coast(this.pitchCoast, dt, COAST_TAU_SEC);
    const keyRate = KEY_ORBIT_RAD_PER_SEC * fast * dt;
    if (keys.left) dyaw += keyRate;
    if (keys.right) dyaw -= keyRate;
    if (keys.up) dpitch += keyRate;
    if (keys.down) dpitch -= keyRate;

    // Look-around (right / Shift drag): rotates the view about the camera, focus leaves the centre.
    const lk = this.deps.fovYRad / Math.max(vp.height, 1);
    if (input.lookDx !== 0 || input.lookDy !== 0) {
      this.lookRecenter = false;
      this.lookYawSmooth.add(input.lookDx * lk);
      this.lookPitchSmooth.add(input.lookDy * lk);
    }
    this.lookYaw = wrapAngle(this.lookYaw + this.lookYawSmooth.take(dt));
    this.lookPitch = clamp(this.lookPitch + this.lookPitchSmooth.take(dt), -LOOK_PITCH_MAX_RAD, LOOK_PITCH_MAX_RAD);
    if (this.lookRecenter) {
      const keep = 1 - approachFactor(dt, LOOK_RECENTER_TAU_SEC);
      this.lookYaw *= keep;
      this.lookPitch *= keep;
      if (Math.abs(this.lookYaw) + Math.abs(this.lookPitch) < 1e-5) {
        this.lookYaw = this.lookPitch = 0;
        this.lookRecenter = false;
      }
    }

    this.applyOrbitRotation(dyaw, dpitch);

    // Zoom (log-altitude near the focused body).
    let zoom = input.zoomDecades + input.dollyPx * DOLLY_DECADES_PER_PX;
    if (keys.zoomIn) zoom -= KEY_ZOOM_DECADES_PER_SEC * fast * dt;
    if (keys.zoomOut) zoom += KEY_ZOOM_DECADES_PER_SEC * fast * dt;
    const scaleBefore = this.scale;
    this.advanceScale(zoom, dt);

    this.evaluateChain(timeMs);
    this.updatePreferredUp(timeMs);
    const motion = Math.abs(dyaw) + Math.abs(dpitch) + Math.abs(this.scale - scaleBefore);
    if (motion > 0 && this._mode !== 'follow') {
      correctUp(this.f, this.u, this.preferredUp, 1 - Math.exp(-UP_PULL_PER_MOTION * motion));
    } else {
      orthonormalizeUp(this.f, this.u);
    }
    this.composePose(this.point, this.f, this.u, this.scale, this.lookYaw, this.lookPitch);
  }

  /** Rigid yaw about the preferred up and pitch about the camera right, with a polar clamp. */
  private applyOrbitRotation(dyaw: number, dpitch: number): void {
    const P = this.preferredUp;
    if (dyaw !== 0) {
      rotateAboutAxis(this.f, P, dyaw, this.f);
      rotateAboutAxis(this.u, P, dyaw, this.u);
    }
    if (dpitch !== 0) {
      // Camera offset direction −f; polar angle from the preferred up.
      SCRATCH.a.copy(this.f).negate();
      const polar = angleBetweenUnit(SCRATCH.a, P);
      const up = clamp(dpitch, -(Math.PI - ORBIT_POLAR_MIN_RAD - polar), polar - ORBIT_POLAR_MIN_RAD);
      if (up !== 0) {
        const right = SCRATCH.b.crossVectors(this.f, this.u);
        if (right.lengthSq() > 1e-12) {
          right.normalize();
          rotateAboutAxis(this.f, right, -up, this.f);
          rotateAboutAxis(this.u, right, -up, this.u);
        }
      }
    }
    this.f.normalize();
    orthonormalizeUp(this.f, this.u);
  }

  /** Carry f/u with the target's radial/along-track/cross-track frame (follow mode). */
  private applyFollowRotation(timeMs: number): void {
    const target = this._focusId ? this.deps.registry.get(this._focusId) : undefined;
    const B = SCRATCH.m1;
    if (!target || !orbitalBasis(this.deps.registry, target, timeMs, B)) {
      this.hasPrevBasis = false;
      return;
    }
    if (this.hasPrevBasis) {
      // R = B · prevBᵀ (both orthonormal).
      const R = SCRATCH.m2.copy(this.prevBasis).transpose().premultiply(B);
      this.f.applyMatrix3(R).normalize();
      this.u.applyMatrix3(R);
      orthonormalizeUp(this.f, this.u);
    }
    this.prevBasis.copy(B);
    this.hasPrevBasis = true;
  }

  private advanceScale(zoomDecades: number, dt: number): void {
    const min = this.minScale();
    if (zoomDecades !== 0) {
      this.scaleTween = null;
      const focus = this.focusEntity();
      const r = focus?.radiusM ?? 0;
      const nearBody = r > 0 && (this.chainState.length === 0 || this.chainState.links[0].contribution > 0.99);
      this.scaleTarget = nearBody
        ? zoomScaleByAltitude(this.scaleTarget, zoomDecades, r, SURFACE_CLAMP_FACTOR * r, this.deps.fovYRad)
        : this.scaleTarget + zoomDecades;
      this.scaleTarget = clamp(this.scaleTarget, min, SCALE_MAX_LOG10);
    }
    if (this.scaleTween) {
      const tw = this.scaleTween;
      tw.t += dt;
      const e = easeInOutSine(clamp(tw.t / tw.dur, 0, 1));
      this.scale = tw.from + (tw.to - tw.from) * e;
      this.scaleTarget = this.scaleSpring.value = this.scale;
      this.scaleSpring.velocity = 0;
      if (tw.t >= tw.dur) this.scaleTween = null;
    } else {
      stepSpring(this.scaleSpring, this.scaleTarget, ZOOM_OMEGA, dt);
      this.scale = this.scaleSpring.value;
    }
    if (this.scale < min) {
      this.scale = this.scaleSpring.value = min;
      if (this.scaleSpring.velocity < 0) this.scaleSpring.velocity = 0;
      if (this.scaleTarget < min) this.scaleTarget = min;
    }
  }

  private minScale(): number {
    const r = this.focusEntity()?.radiusM ?? 0;
    if (!(r > 0) || this._mode === 'free') return SCALE_MIN_LOG10;
    return Math.max(SCALE_MIN_LOG10, scaleFromFocusDistance(SURFACE_CLAMP_FACTOR * r, this.deps.fovYRad));
  }

  private evaluateChain(timeMs: number): void {
    if (!this._focusId) return;
    this.chain.evaluate(this._focusId, this.scale, timeMs, this.chainState);
    if (this.chainState.length === 0) return; // focus not (yet) resolvable: hold the last point
    this.point.copy(this.chainState.point);
    const anchor = chooseAnchor(this.chainState, this._anchorId);
    if (anchor) this._anchorId = anchor;
  }

  private updatePreferredUp(timeMs: number): void {
    if (this._mode === 'follow') {
      const target = this.focusEntity();
      if (target && orbitalBasis(this.deps.registry, target, timeMs, SCRATCH.m1)) {
        const e = SCRATCH.m1.elements;
        this.preferredUp.set(e[6], e[7], e[8]);
        return;
      }
    }
    // Pole body: first chain element (focus first) whose rotation axis is meaningful.
    let pole: Entity | null = null;
    for (let i = 0; i < this.chainState.length; i++) {
      const ent = this.chainState.links[i].entity;
      if (ent && hasPoleKind(ent)) { pole = ent; break; }
    }
    this.poleBody = pole;
    upBlendWeights(this.scale, pole ? pole.radiusM : null, this.weights);
    if (pole && this.weights.pole > 0) entityNorthPole(pole, timeMs, SCRATCH.c);
    else SCRATCH.c.set(0, 0, 1);
    preferredUpFromWeights(SCRATCH.c, this.weights, this.preferredUp);
  }

  // ── Free flight ──────────────────────────────────────────────────────────────────────────

  private enterFree(): void {
    // Bake the look offsets into the frame and anchor to the current context.
    this.f.copy(this.state.forward);
    SCRATCH.a.set(0, 1, 0).applyQuaternion(this.state.quaternion);
    this.u.copy(SCRATCH.a);
    orthonormalizeUp(this.f, this.u);
    this.lookYaw = this.lookPitch = 0;
    this.lookRecenter = false;
    this.rebaseFreeOffset(this._anchorId, this.lastTimeMs);
    this.freeVelocity.set(0, 0, 0);
    this.yawCoast.velocity = this.pitchCoast.velocity = 0;
  }

  private leaveFree(): void {
    this._focusId ??= this._anchorId;
    this.orbitFromCurrentPose(this.lastTimeMs);
  }

  private rebaseFreeOffset(anchorId: string, timeMs: number): void {
    const anchor = this.deps.registry.get(anchorId);
    if (!anchor || !safePosition(anchor, timeMs, SCRATCH.a)) SCRATCH.a.set(0, 0, 0);
    this.freeOffset.subVectors(this.state.position, SCRATCH.a);
    this._anchorId = anchorId;
  }

  private stepFree(dt: number, timeMs: number, input: InputFrame): void {
    const vp = this.deps.getViewport();
    const lk = this.deps.fovYRad / Math.max(vp.height, 1);
    const keys = this.controls.keys;
    // Mouse look (grab-the-sky convention, same as orbit look-around).
    const dx = input.orbitDx + input.lookDx, dy = input.orbitDy + input.lookDy;
    if (dx !== 0 || dy !== 0) {
      this.lookYawSmooth.add(dx * lk);
      this.lookPitchSmooth.add(dy * lk);
    }
    let yaw = this.lookYawSmooth.take(dt) + input.twistRad;
    let pitch = this.lookPitchSmooth.take(dt);
    const keyRate = KEY_ORBIT_RAD_PER_SEC * 0.6 * dt;
    if (keys.left) yaw += keyRate;
    if (keys.right) yaw -= keyRate;
    if (keys.up) pitch += keyRate;
    if (keys.down) pitch -= keyRate;

    this.updatePreferredUpFree(timeMs);
    const P = this.preferredUp;
    if (yaw !== 0) {
      rotateAboutAxis(this.f, P, yaw, this.f);
      rotateAboutAxis(this.u, P, yaw, this.u);
    }
    if (pitch !== 0) {
      const polar = angleBetweenUnit(this.f, P);
      const p = clamp(pitch, -(Math.PI - ORBIT_POLAR_MIN_RAD - polar), polar - ORBIT_POLAR_MIN_RAD);
      const right = SCRATCH.b.crossVectors(this.f, this.u);
      if (p !== 0 && right.lengthSq() > 1e-12) {
        right.normalize();
        rotateAboutAxis(this.f, right, p, this.f);
        rotateAboutAxis(this.u, right, p, this.u);
      }
    }
    this.f.normalize();
    const turn = Math.abs(yaw) + Math.abs(pitch);
    if (turn > 0) correctUp(this.f, this.u, P, 1 - Math.exp(-UP_PULL_PER_MOTION * turn));
    else orthonormalizeUp(this.f, this.u);

    // Wheel / keys set the speed scale.
    let zoom = input.zoomDecades + input.dollyPx * DOLLY_DECADES_PER_PX;
    if (keys.zoomIn) zoom -= KEY_ZOOM_DECADES_PER_SEC * dt;
    if (keys.zoomOut) zoom += KEY_ZOOM_DECADES_PER_SEC * dt;
    this.advanceScale(zoom, dt);

    // WASD/QE with smooth acceleration; speed ∝ 10^scale.
    const right = SCRATCH.b.crossVectors(this.f, this.u).normalize();
    const mx = (keys.strafeRight ? 1 : 0) - (keys.strafeLeft ? 1 : 0);
    const my = (keys.rise ? 1 : 0) - (keys.sink ? 1 : 0);
    const mz = (keys.forward ? 1 : 0) - (keys.back ? 1 : 0);
    const desired = SCRATCH.c.set(0, 0, 0);
    if (mx !== 0 || my !== 0 || mz !== 0) {
      desired.addScaledVector(right, mx).addScaledVector(this.u, my).addScaledVector(this.f, mz).normalize();
      desired.multiplyScalar((Math.pow(10, this.scale) / FREE_CROSS_SEC) * (keys.fast ? FREE_FAST_FACTOR : 1));
    }
    const a = approachFactor(dt, FREE_ACCEL_TAU_SEC);
    this.freeVelocity.lerp(desired, a);
    if (this.freeVelocity.lengthSq() < 1e-30) this.freeVelocity.set(0, 0, 0);
    this.freeOffset.addScaledVector(this.freeVelocity, dt);

    // Ride with the anchor; periodically re-anchor to the innermost sphere of influence.
    this.reanchorTimer -= dt;
    if (this.reanchorTimer <= 0) {
      this.reanchorTimer = FREE_REANCHOR_INTERVAL_SEC;
      this.reanchorFree(timeMs);
    }
    const anchor = this.deps.registry.get(this._anchorId);
    if (!anchor || !safePosition(anchor, timeMs, SCRATCH.a)) SCRATCH.a.set(0, 0, 0);
    this.state.position.addVectors(SCRATCH.a, this.freeOffset);
    this.pushOutOfBodies(this.state.position, timeMs, true);
    this.freeOffset.subVectors(this.state.position, SCRATCH.a);

    this.state.quaternion.copy(basisQuaternion(this.f, this.u, SCRATCH.q1));
    this.state.forward.copy(this.f);
    this.state.focusDistanceM = focusDistanceFromScale(this.scale, this.deps.fovYRad);
    this.point.copy(this.state.position).addScaledVector(this.f, this.state.focusDistanceM);
  }

  private updatePreferredUpFree(timeMs: number): void {
    const anchor = this.deps.registry.get(this._anchorId) ?? null;
    let pole: Entity | null = anchor && hasPoleKind(anchor) ? anchor : null;
    let dist = Infinity;
    if (anchor && safePosition(anchor, timeMs, SCRATCH.a)) dist = this.state.position.distanceTo(SCRATCH.a);
    // Free flight blends by distance from the anchor instead of focus scale.
    const s = Number.isFinite(dist) ? Math.max(scaleFromFocusDistance(dist, this.deps.fovYRad), this.scale - 1) : this.scale;
    if (!pole) pole = null;
    this.poleBody = pole;
    upBlendWeights(s, pole ? pole.radiusM : null, this.weights);
    if (pole && this.weights.pole > 0) entityNorthPole(pole, timeMs, SCRATCH.c);
    else SCRATCH.c.set(0, 0, 1);
    preferredUpFromWeights(SCRATCH.c, this.weights, this.preferredUp);
  }

  /** Choose the innermost chain element (focus chain, then anchor chain) whose sphere of influence holds the camera. */
  private reanchorFree(timeMs: number): void {
    const startId = this._focusId ?? this._anchorId;
    const candidates = [startId, ...this.chain.ancestors(startId).map(e => e.id)];
    if (startId !== this._anchorId) candidates.push(this._anchorId, ...this.chain.ancestors(this._anchorId).map(e => e.id));
    let chosen: string | null = null;
    for (const id of candidates) {
      const e = this.deps.registry.get(id);
      if (!e || !safePosition(e, timeMs, SCRATCH.d)) continue;
      if (this.state.position.distanceTo(SCRATCH.d) <= sphereOfInfluenceM(e)) { chosen = id; break; }
    }
    if (!chosen) chosen = candidates[candidates.length - 1] ?? this._anchorId;
    if (chosen !== this._anchorId) {
      const oldAnchor = this.deps.registry.get(this._anchorId);
      if (!oldAnchor || !safePosition(oldAnchor, timeMs, SCRATCH.a)) SCRATCH.a.set(0, 0, 0);
      const world = SCRATCH.d.addVectors(SCRATCH.a, this.freeOffset);
      const next = this.deps.registry.get(chosen);
      if (!next || !safePosition(next, timeMs, SCRATCH.a)) return;
      this.freeOffset.subVectors(world, SCRATCH.a);
      this._anchorId = chosen;
    }
  }

  // ── Travel ───────────────────────────────────────────────────────────────────────────────

  private beginEntityTravel(id: string, opts: TravelOptions | undefined, endMode: CameraMode): Promise<void> {
    const target = this.deps.registry.get(id);
    const t = this.lastTimeMs;
    if (!target || !safePosition(target, t, SCRATCH.a)) {
      console.warn(`[camera] cannot travel to unknown or unpositioned entity "${id}"`);
      return Promise.resolve();
    }
    this.history.push(this.getView());
    const endDist = this.arrivalDistance(target, opts?.distanceM);
    let endScale = clamp(scaleFromFocusDistance(endDist, this.deps.fovYRad), SCALE_MIN_LOG10, SCALE_MAX_LOG10);
    const r = target.radiusM ?? 0;
    if (r > 0) endScale = Math.max(endScale, scaleFromFocusDistance(SURFACE_CLAMP_FACTOR * r, this.deps.fovYRad));

    this.chain.evaluate(id, endScale, t, this.targetChain);
    const P1 = this.targetChain.length > 0 ? SCRATCH.b.copy(this.targetChain.point) : SCRATCH.b.copy(SCRATCH.a);
    const f1 = SCRATCH.c, u1 = SCRATCH.d;
    this.arrivalFrame(target, P1, endScale, t, f1, u1);
    return this.startTravel({
      targetId: id, endFocusId: id, endMode, endScale, P1, f1, u1, look1Yaw: 0, look1Pitch: 0,
      freeAnchorId: null, freeOffset: null, opts,
    });
  }

  private beginViewTravel(view: CameraViewState, opts: TravelOptions | undefined): Promise<void> {
    const t = this.lastTimeMs;
    const anchor = this.deps.registry.get(view.anchorId);
    const anchorPos = SCRATCH.a;
    if (!anchor || !safePosition(anchor, t, anchorPos)) {
      console.warn(`[camera] setView: unknown anchor "${view.anchorId}"`);
      return Promise.resolve();
    }
    const camPos = SCRATCH.e.set(view.offset[0], view.offset[1], view.offset[2]).add(anchorPos);
    const q = SCRATCH.q2.set(view.quaternion[0], view.quaternion[1], view.quaternion[2], view.quaternion[3]);
    if (!(q.lengthSq() > 0.5)) q.identity();
    q.normalize();
    const qf = SCRATCH.f.set(0, 0, -1).applyQuaternion(q);
    const qu = SCRATCH.g.set(0, 1, 0).applyQuaternion(q);
    const P1 = SCRATCH.b, f1 = SCRATCH.c, u1 = SCRATCH.d;
    let endScale = clamp(Number.isFinite(view.scaleLog10) ? view.scaleLog10 : this.scale, SCALE_MIN_LOG10, SCALE_MAX_LOG10);
    let look1Yaw = 0, look1Pitch = 0;
    const focus = view.focusId ? this.deps.registry.get(view.focusId) : undefined;
    if (view.focusId && focus && view.mode !== 'free') {
      // Orbit/follow arrival: f1 points from the stored camera position at the chain point.
      for (let i = 0; i < 2; i++) {
        this.chain.evaluate(view.focusId, endScale, t, this.targetChain);
        if (this.targetChain.length === 0) break;
        P1.copy(this.targetChain.point);
        const d = P1.distanceTo(camPos);
        if (d > 0) endScale = clamp(scaleFromFocusDistance(d, this.deps.fovYRad), SCALE_MIN_LOG10, SCALE_MAX_LOG10);
      }
      if (this.targetChain.length === 0) safePosition(focus, t, P1);
      f1.subVectors(P1, camPos);
      if (f1.lengthSq() > 0) f1.normalize(); else f1.copy(qf);
      u1.copy(qu);
      orthonormalizeUp(f1, u1);
      const yp = decomposeLook(f1, u1, q);
      look1Yaw = yp.yaw;
      look1Pitch = yp.pitch;
      return this.startTravel({
        targetId: view.focusId, endFocusId: view.focusId, endMode: view.mode, endScale, P1, f1, u1, look1Yaw,
        look1Pitch, freeAnchorId: null, freeOffset: null, opts,
      });
    }
    // Free-flight arrival.
    const d = focusDistanceFromScale(endScale, this.deps.fovYRad);
    P1.copy(camPos).addScaledVector(qf, d);
    f1.copy(qf);
    u1.copy(qu);
    orthonormalizeUp(f1, u1);
    SCRATCH.h.set(view.offset[0], view.offset[1], view.offset[2]);
    return this.startTravel({
      targetId: view.focusId ?? view.anchorId, endFocusId: view.focusId, endMode: 'free', endScale, P1, f1, u1,
      look1Yaw: 0, look1Pitch: 0, freeAnchorId: view.anchorId, freeOffset: SCRATCH.h, opts,
    });
  }

  private startTravel(p: {
    targetId: string; endFocusId: string | null; endMode: CameraMode; endScale: number;
    P1: THREE.Vector3; f1: THREE.Vector3; u1: THREE.Vector3; look1Yaw: number; look1Pitch: number;
    freeAnchorId: string | null; freeOffset: THREE.Vector3 | null; opts: TravelOptions | undefined;
  }): Promise<void> {
    if (this.travel) this.interruptTravel();
    const t = this.lastTimeMs;
    const reduced = this.deps.store.getState().ui.reducedMotion;
    // Start focus point, attached to the current anchor so it moves with its context.
    const startPoint = this.needsInitialPose ? SCRATCH.e.copy(p.P1) : SCRATCH.e.copy(this.point);
    const anchor = this.deps.registry.get(this._anchorId);
    if (!anchor || !safePosition(anchor, t, SCRATCH.a)) SCRATCH.a.set(0, 0, 0);
    const path = planZoomPan(Math.pow(10, this.scale), Math.pow(10, p.endScale), startPoint.distanceTo(p.P1));
    const instant = p.opts?.instant === true || this.needsInitialPose;
    const durationSec = instant ? 0 : travelDurationSec(path, { reducedMotion: reduced, overrideSec: p.opts?.durationSec });
    const tr: TravelState = {
      targetId: p.targetId, endFocusId: p.endFocusId, endMode: p.endMode, startAnchorId: this._anchorId,
      startOffset: new THREE.Vector3().subVectors(startPoint, SCRATCH.a), startFocusId: this._focusId,
      path, durationSec, elapsedSec: 0,
      f0: this.f.clone(), u0: this.u.clone(), f1: p.f1.clone(), u1: p.u1.clone(),
      look0Yaw: this.lookYaw, look0Pitch: this.lookPitch, look1Yaw: p.look1Yaw, look1Pitch: p.look1Pitch,
      endScale: p.endScale, freeAnchorId: p.freeAnchorId,
      freeOffset: p.freeOffset ? p.freeOffset.clone() : new THREE.Vector3(), resolvers: [],
    };
    this.needsInitialPose = false;
    this.yawSmooth.reset(); this.pitchSmooth.reset(); this.lookYawSmooth.reset(); this.lookPitchSmooth.reset();
    this.yawCoast.velocity = this.pitchCoast.velocity = 0;
    this.scaleTween = null;
    this.lookRecenter = false;
    this.travel = tr;
    const promise = new Promise<void>(resolve => tr.resolvers.push(resolve));
    this.deps.events.emit('travel-start', { targetId: tr.targetId });
    this.writeCameraStore();
    if (durationSec <= 0) this.endTravel(false);
    return promise;
  }

  private stepTravel(dt: number, timeMs: number): void {
    const tr = this.travel;
    if (!tr) return;
    tr.elapsedSec += dt;
    const tau = tr.durationSec > 0 ? clamp(tr.elapsedSec / tr.durationSec, 0, 1) : 1;
    if (tau >= 1) {
      this.endTravel(false);
      this.stepAfterTravel(timeMs);
      return;
    }
    const e = easeInOutSine(tau);
    const sample = SAMPLE;
    sampleZoomPan(tr.path, e * tr.path.length, sample);
    this.scale = clamp(Math.log10(sample.widthM), SCALE_MIN_LOG10, SCALE_MAX_LOG10);
    this.scaleTarget = this.scaleSpring.value = this.scale;
    this.scaleSpring.velocity = 0;

    // Moving endpoints are re-evaluated at the current time (no lag at any time rate).
    const P0 = this.travelStartPoint(tr, timeMs, SCRATCH.a);
    const P1 = this.travelEndPoint(tr, timeMs, SCRATCH.b);
    if (sample.pan < 0.5) this.point.copy(P1).sub(P0).multiplyScalar(sample.pan).add(P0);
    else this.point.copy(P0).sub(P1).multiplyScalar(sample.remaining).add(P1);

    slerpUnit(tr.f0, tr.f1, e, this.f, tr.u0);
    slerpUnit(tr.u0, tr.u1, e, this.u);
    orthonormalizeUp(this.f, this.u);
    this.lookYaw = tr.look0Yaw + wrapAngle(tr.look1Yaw - tr.look0Yaw) * e;
    this.lookPitch = tr.look0Pitch + (tr.look1Pitch - tr.look0Pitch) * e;
    // The anchor follows the dominant element along the way (for frame labels / getView).
    this._anchorId = sample.pan < 0.5 ? tr.startAnchorId : (tr.freeAnchorId ?? tr.endFocusId ?? tr.targetId);
    this.updatePreferredUpTravel(timeMs, tr);
    this.composePose(this.point, this.f, this.u, this.scale, this.lookYaw, this.lookPitch);
  }

  private updatePreferredUpTravel(timeMs: number, tr: TravelState): void {
    const id = tr.endFocusId ?? tr.targetId;
    this.chain.evaluate(id, this.scale, timeMs, this.chainState);
    this.updatePreferredUp(timeMs);
  }

  private travelStartPoint(tr: TravelState, timeMs: number, out: THREE.Vector3): THREE.Vector3 {
    const anchor = this.deps.registry.get(tr.startAnchorId);
    if (!anchor || !safePosition(anchor, timeMs, out)) out.set(0, 0, 0);
    return out.add(tr.startOffset);
  }

  private travelEndPoint(tr: TravelState, timeMs: number, out: THREE.Vector3): THREE.Vector3 {
    if (tr.freeAnchorId) {
      const anchor = this.deps.registry.get(tr.freeAnchorId);
      if (!anchor || !safePosition(anchor, timeMs, out)) out.set(0, 0, 0);
      return out.add(tr.freeOffset).addScaledVector(tr.f1, focusDistanceFromScale(tr.endScale, this.deps.fovYRad));
    }
    const id = tr.endFocusId ?? tr.targetId;
    this.chain.evaluate(id, tr.endScale, timeMs, this.targetChain);
    if (this.targetChain.length > 0) return out.copy(this.targetChain.point);
    const e = this.deps.registry.get(id);
    if (!e || !safePosition(e, timeMs, out)) out.copy(this.point);
    return out;
  }

  /** Arrival: adopt the travel's end state exactly. */
  private endTravel(interrupted: boolean): void {
    const tr = this.travel;
    if (!tr) return;
    this.travel = null;
    if (!interrupted) {
      this.f.copy(tr.f1);
      this.u.copy(tr.u1);
      orthonormalizeUp(this.f, this.u);
      this.lookYaw = tr.look1Yaw;
      this.lookPitch = tr.look1Pitch;
      this.scale = this.scaleTarget = this.scaleSpring.value = tr.endScale;
      this.scaleSpring.velocity = 0;
      this._focusId = tr.endFocusId ?? this._focusId;
      this._mode = tr.endMode;
      this.hasPrevBasis = false;
      if (tr.endMode === 'free') {
        this._anchorId = tr.freeAnchorId ?? this._anchorId;
        this.freeOffset.copy(tr.freeOffset);
        this.freeVelocity.set(0, 0, 0);
      } else if (tr.endFocusId) {
        this._anchorId = tr.endFocusId;
      }
    }
    this.deps.events.emit('travel-end', { targetId: tr.targetId, interrupted });
    this.writeCameraStore();
    for (const r of tr.resolvers) r();
  }

  /** Same-frame pose after arrival so the final frame has no one-frame hitch. */
  private stepAfterTravel(timeMs: number): void {
    if (this._mode === 'free') this.stepFree(0, timeMs, EMPTY_INPUT);
    else this.stepOrbit(0, timeMs, EMPTY_INPUT);
  }

  /**
   * User input during a travel: stop where we are. The orbit state is rebuilt around the nearer focus so the camera
   * position and orientation stay exactly continuous (orientation differences go into the look offsets, which then
   * ease back to centre).
   */
  private interruptTravel(): void {
    const tr = this.travel;
    if (!tr) return;
    const s = SAMPLE;
    const tau = tr.durationSec > 0 ? clamp(tr.elapsedSec / tr.durationSec, 0, 1) : 1;
    sampleZoomPan(tr.path, easeInOutSine(tau) * tr.path.length, s);
    const towardEnd = s.pan >= 0.5 || !tr.startFocusId;
    this.travel = null;
    if (towardEnd && tr.endMode === 'free') {
      this._mode = 'free';
      this.enterFree();
    } else {
      this._focusId = (towardEnd ? tr.endFocusId : tr.startFocusId) ?? tr.targetId;
      if (this._mode === 'free') this._mode = 'orbit';
      this.orbitFromCurrentPose(this.lastTimeMs);
    }
    this.deps.events.emit('travel-end', { targetId: tr.targetId, interrupted: true });
    this.writeCameraStore();
    for (const r of tr.resolvers) r();
  }

  /** Rebuild orbit state (scale, f, u, look) around the current focus from the current camera pose. */
  private orbitFromCurrentPose(timeMs: number): void {
    const cam = this.state.position;
    const q = SCRATCH.q2.copy(this.state.quaternion);
    if (!this._focusId) return;
    let scale = this.scale;
    const P = SCRATCH.b;
    let ok = false;
    for (let i = 0; i < 3; i++) {
      this.chain.evaluate(this._focusId, scale, timeMs, this.chainState);
      if (this.chainState.length === 0) break;
      ok = true;
      P.copy(this.chainState.point);
      const d = Math.max(P.distanceTo(cam), 1e-3);
      scale = clamp(scaleFromFocusDistance(d, this.deps.fovYRad), this.minScale(), SCALE_MAX_LOG10);
    }
    if (!ok) return;
    this.scale = this.scaleTarget = this.scaleSpring.value = scale;
    this.scaleSpring.velocity = 0;
    this.f.subVectors(P, cam);
    if (this.f.lengthSq() > 0) this.f.normalize(); else this.f.set(0, 0, -1).applyQuaternion(q);
    this.u.set(0, 1, 0).applyQuaternion(q);
    orthonormalizeUp(this.f, this.u);
    const yp = decomposeLook(this.f, this.u, q);
    this.lookYaw = yp.yaw;
    this.lookPitch = yp.pitch;
    this.lookRecenter = true;
    this.yawSmooth.reset(); this.pitchSmooth.reset(); this.lookYawSmooth.reset(); this.lookPitchSmooth.reset();
    this.point.copy(P);
    const anchor = chooseAnchor(this.chainState, null);
    if (anchor) this._anchorId = anchor;
  }

  // ── Arrival framing ──────────────────────────────────────────────────────────────────────

  /** Arrival distance from the target centre (m). */
  private arrivalDistance(target: Entity, override?: number): number {
    if (override !== undefined && override > 0 && Number.isFinite(override)) return override;
    const r = target.radiusM ?? 0;
    const fov = this.deps.fovYRad;
    if (r > 0 && this.deps.store.getState().ui.inspectorOpen) return distanceForDiameterFraction(Math.max(r, target.framingRadiusM ?? 0), fov, INSPECT_DIAMETER_FRACTION);
    const vd = target.viewDistance?.default;
    if (vd !== undefined && vd > 0) return vd;
    if (r > 0) return distanceForDiameterFraction(r, fov, DEFAULT_DIAMETER_FRACTION);
    const s = KIND_DEFAULT_SCALE[target.kind] ?? this.scale;
    return focusDistanceFromScale(s, fov);
  }

  /** Arrival forward/up: lit bodies at the configured phase angle, satellites from their outward side. */
  private arrivalFrame(target: Entity, P1: THREE.Vector3, endScale: number, t: number, f1: THREE.Vector3, u1: THREE.Vector3): void {
    const light = this.lightSourcePosition(target, t, SCRATCH.f);
    const pref = SCRATCH.g.subVectors(this.state.position, P1);
    if (this.needsInitialPose || !(pref.lengthSq() > 0) || !isFiniteVec(pref)) pref.set(0.3, -0.8, 0.5);
    if (target.approachDir) pref.set(target.approachDir[0], target.approachDir[1], target.approachDir[2]);
    pref.normalize();
    // Up at arrival: evaluate the target's chain at the end scale for the preferred up.
    const savedScale = this.scale;
    this.scale = endScale;
    this.chain.evaluate(target.id, endScale, t, this.chainState);
    this.updatePreferredUp(t);
    this.scale = savedScale;
    const up = SCRATCH.h.copy(this.preferredUp);
    let lift: { dir: THREE.Vector3; minDot: number } | undefined;
    let obstacles: Sphere[] | undefined;
    const parent = target.parentId ? this.deps.registry.get(target.parentId) : undefined;
    if (parent && ORBITER_KINDS.has(target.kind) && (parent.radiusM ?? 0) > 0) {
      const pp = new THREE.Vector3();
      if (safePosition(parent, t, pp)) {
        const dir = new THREE.Vector3().subVectors(P1, pp);
        if (dir.lengthSq() > 0) {
          lift = { dir: dir.normalize(), minDot: 0.2 };
          obstacles = [{ center: pp, radiusM: (parent.radiusM ?? 0) * OBSTACLE_CLAMP_FACTOR }];
        }
      }
    }
    chooseArrivalDirection({
      target: P1, light, preferredDir: pref, up, lift, obstacles,
      approachLengthM: focusDistanceFromScale(endScale, this.deps.fovYRad),
    }, SCRATCH.e);
    f1.copy(SCRATCH.e).negate();
    u1.copy(up);
    if (Math.abs(f1.dot(u1)) > 0.999) anyPerpendicular(f1, u1);
    orthonormalizeUp(f1, u1);
  }

  /** Host star position for lit bodies (nearest 'star' ancestor), else null. */
  private lightSourcePosition(target: Entity, t: number, out: THREE.Vector3): THREE.Vector3 | null {
    if (!LIT_KINDS.has(target.kind)) return null;
    for (const a of this.chain.ancestors(target.id)) {
      if (a.kind === 'star' && safePosition(a, t, out)) return out;
    }
    return null;
  }

  // ── Pose composition & output ────────────────────────────────────────────────────────────

  private composePose(point: THREE.Vector3, f: THREE.Vector3, u: THREE.Vector3, scale: number, yaw: number, pitch: number): void {
    const d = focusDistanceFromScale(scale, this.deps.fovYRad);
    const st = this.state;
    st.position.copy(point).addScaledVector(f, -d);
    this.pushOutOfBodies(st.position, this.lastTimeMs, false);
    basisQuaternion(f, u, st.quaternion);
    if (yaw !== 0 || pitch !== 0) {
      SCRATCH.euler.set(pitch, yaw, 0, 'YXZ');
      st.quaternion.multiply(SCRATCH.q1.setFromEuler(SCRATCH.euler));
    }
    st.forward.set(0, 0, -1).applyQuaternion(st.quaternion);
    st.focusDistanceM = st.position.distanceTo(point) || d;
  }

  /** Keep the camera outside the solid bodies of the focus chain (e.g. Earth while orbiting the ISS). */
  private pushOutOfBodies(pos: THREE.Vector3, timeMs: number, includeFocus: boolean): void {
    const cs = this.chainState;
    for (let i = includeFocus ? 0 : 1; i < cs.length; i++) {
      const link = cs.links[i];
      const r = link.entity && !NON_SOLID_KINDS.has(link.entity.kind) ? renderRadius(link.entity, timeMs) : 0;
      if (!(r > 0)) continue;
      const min = r * OBSTACLE_CLAMP_FACTOR;
      const c = link.position;
      const dx = pos.x - c.x, dy = pos.y - c.y, dz = pos.z - c.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist >= min || dist === 0) continue;
      const k = min / dist;
      pos.set(c.x + dx * k, c.y + dy * k, c.z + dz * k);
    }
  }

  private finishFrame(dt: number): void {
    const st = this.state;
    st.scaleLog10 = this.scale;
    st.metersPerUnit = metersPerUnitForDistance(st.focusDistanceM);
    st.focusId = this._focusId;
    st.anchorId = this._anchorId;
    const shiftTarget = this.deps.store.getState().ui.inspectorOpen ? INSPECT_SHIFT_X : 0;
    stepSpring(this.shiftSpring, shiftTarget, SHIFT_OMEGA, dt);
    if (Math.abs(this.shiftSpring.value - shiftTarget) < 1e-5 && Math.abs(this.shiftSpring.velocity) < 1e-4) {
      this.shiftSpring.value = shiftTarget;
      this.shiftSpring.velocity = 0;
    }
    st.projectionShiftX = this.shiftSpring.value;
    this.updateFrameLabel();
  }

  private updateFrameLabel(): void {
    const up: UpReference = this._mode === 'follow' ? 'orbit' : dominantUp(this.weights);
    const poleId = this.poleBody?.id ?? '';
    const key = `${this._anchorId}|${up}|${this._mode}|${poleId}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    const anchor = this.deps.registry.get(this._anchorId) ?? null;
    this.state.frameLabel = buildFrameLabel(anchor, up, this._mode, this.poleBody);
  }

  private focusEntity(): Entity | undefined {
    return this._focusId ? this.deps.registry.get(this._focusId) : undefined;
  }

  private tryInitialPose(timeMs: number): void {
    const id = this._focusId;
    if (!id) { this.needsInitialPose = false; return; }
    const target = this.deps.registry.get(id);
    if (!target || !safePosition(target, timeMs, SCRATCH.a)) return;
    // Keep the configured initial scale but use the cinematic arrival direction.
    const r = target.radiusM ?? 0;
    const minScale = r > 0 ? scaleFromFocusDistance(SURFACE_CLAMP_FACTOR * r, this.deps.fovYRad) : SCALE_MIN_LOG10;
    const scale = Math.max(this.scale, minScale);
    this.chain.evaluate(id, scale, timeMs, this.targetChain);
    const P1 = SCRATCH.b.copy(this.targetChain.length > 0 ? this.targetChain.point : SCRATCH.a);
    this.arrivalFrame(target, P1, scale, timeMs, this.f, this.u);
    this.scale = this.scaleTarget = this.scaleSpring.value = scale;
    this.needsInitialPose = false;
    this._anchorId = id;
  }

  private writeCameraStore(): void {
    const tr = this.travel;
    this.deps.store.setState(s => ({
      camera: {
        ...s.camera,
        mode: tr ? s.camera.mode : this._mode,
        focusId: this._focusId,
        traveling: tr !== null,
        travelTargetId: tr ? tr.targetId : null,
      },
    }));
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────────────────────

const SCRATCH = {
  a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(),
  e: new THREE.Vector3(), f: new THREE.Vector3(), g: new THREE.Vector3(), h: new THREE.Vector3(),
  m1: new THREE.Matrix3(), m2: new THREE.Matrix3(), m4: new THREE.Matrix4(),
  q1: new THREE.Quaternion(), q2: new THREE.Quaternion(), euler: new THREE.Euler(),
  right: new THREE.Vector3(), back: new THREE.Vector3(), lookYP: { yaw: 0, pitch: 0 },
};
const SAMPLE: ZoomPanSample = { widthM: 0, pan: 0, remaining: 0 };
const EMPTY_INPUT: InputFrame = createInputFrame();

/** Drawn position (exhibition scale aware, src/core/visualScale.ts) — what the camera frames and travels to. */
function safePosition(entity: Entity, tMs: number, out: THREE.Vector3): boolean {
  try {
    renderPosition(entity, tMs, out);
  } catch {
    return false;
  }
  return isFiniteVec(out);
}

/** Ease-in-out with a peak speed of only π/2 × the average (a cubic ease peaks at 3×). */
function easeInOutSine(t: number): number {
  return 0.5 - 0.5 * Math.cos(Math.PI * t);
}

function wrapAngle(a: number): number {
  if (a > Math.PI) return a - 2 * Math.PI * Math.ceil((a - Math.PI) / (2 * Math.PI));
  if (a < -Math.PI) return a + 2 * Math.PI * Math.ceil((-Math.PI - a) / (2 * Math.PI));
  return a;
}

function clampMagnitude(v: number, min: number, max: number): number {
  const a = Math.abs(v);
  if (a < min) return 0;
  return a > max ? Math.sign(v) * max : v;
}

/** Quaternion of the camera basis (x = right = f×u, y = u, z = −f). */
export function basisQuaternion(f: THREE.Vector3, u: THREE.Vector3, out: THREE.Quaternion): THREE.Quaternion {
  const r = SCRATCH.right.crossVectors(f, u).normalize();
  const b = SCRATCH.back.copy(f).negate();
  SCRATCH.m4.makeBasis(r, u, b);
  return out.setFromRotationMatrix(SCRATCH.m4);
}

/** Look yaw/pitch (Euler 'YXZ', no roll) that turns the basis (f, u) into the orientation `q`. */
export function decomposeLook(f: THREE.Vector3, u: THREE.Vector3, q: THREE.Quaternion): { yaw: number; pitch: number } {
  const base = basisQuaternion(f, u, SCRATCH.q1);
  const rel = base.invert().multiply(q);
  const fl = SCRATCH.right.set(0, 0, -1).applyQuaternion(rel);
  const out = SCRATCH.lookYP;
  out.yaw = Math.atan2(-fl.x, -fl.z);
  out.pitch = Math.asin(clamp(fl.y, -1, 1));
  return out;
}

/** Distance from a sphere's centre at which its disc spans `fraction` of the vertical field of view. */
export function distanceForDiameterFraction(radiusM: number, fovYRad: number, fraction: number): number {
  const half = clamp(fraction, 0.01, 0.99) * fovYRad * 0.5;
  return radiusM / Math.sin(half);
}

/**
 * Orbital basis of `entity` relative to its parent as matrix columns (radial, along-track, cross-track). Uses
 * entity.velocity when available, else a finite difference. Returns false when undefined (no parent / no motion).
 */
export function orbitalBasis(
  registry: { get(id: string): Entity | undefined }, entity: Entity, tMs: number, out: THREE.Matrix3,
): boolean {
  const parent = entity.parentId ? registry.get(entity.parentId) : undefined;
  if (!parent) return false;
  const p = ORB.p, pp = ORB.pp, v = ORB.v;
  if (!safePosition(entity, tMs, p) || !safePosition(parent, tMs, pp)) return false;
  let haveV = false;
  if (typeof entity.velocity === 'function') {
    try {
      entity.velocity(tMs, v);
      if (typeof parent.velocity === 'function') v.sub(parent.velocity(tMs, ORB.pv));
      haveV = isFiniteVec(v);
    } catch {
      haveV = false;
    }
  }
  if (!haveV) {
    const h = FOLLOW_FD_STEP_SEC * 1000;
    if (!safePosition(entity, tMs + h, v) || !safePosition(parent, tMs + h, ORB.pv)) return false;
    v.sub(ORB.pv).sub(p).add(pp).multiplyScalar(1 / FOLLOW_FD_STEP_SEC);
  }
  const r = ORB.r.subVectors(p, pp);
  if (!(r.lengthSq() > 0)) return false;
  r.normalize();
  const n = ORB.n.crossVectors(r, v);
  if (!(n.lengthSq() > 1e-30)) return false;
  n.normalize();
  const tAlong = ORB.t.crossVectors(n, r);
  out.set(r.x, tAlong.x, n.x, r.y, tAlong.y, n.y, r.z, tAlong.z, n.z);
  return true;
}

const ORB = {
  p: new THREE.Vector3(), pp: new THREE.Vector3(), v: new THREE.Vector3(), pv: new THREE.Vector3(),
  r: new THREE.Vector3(), n: new THREE.Vector3(), t: new THREE.Vector3(),
};
