/**
 * Camera rig — public API contract.
 *
 * STATUS: minimal working STUB. The camera-system implementation replaces the body of
 * `createCameraRig` (orbit / free / follow modes, input controls, Cosmic Ruler focus chain, cinematic travel,
 * up-vector blending, history) but MUST keep every exported name and signature in this file stable,
 * because src/core/engine.ts compiles against them.
 */
import * as THREE from 'three';
import type { CameraController, CameraMode, CameraViewState, EngineEvents, EventBus, TravelOptions, Viewport } from '../types';
import type { EntityRegistry } from '../entity';
import type { CosmosStore } from '../../state/store';

export interface CameraRigDeps {
  registry: EntityRegistry;
  store: CosmosStore;
  events: EventBus<EngineEvents>;
  /** Element receiving pointer / wheel / touch / keyboard input (the viewport container). */
  inputElement: HTMLElement;
  getViewport(): Viewport;
  /** Vertical field of view, radians. */
  fovYRad: number;
  /** Called on a click/tap without drag (CSS px). `double` = double-click/double-tap. The app selects / focuses. */
  onPointerClick(x: number, y: number, double: boolean): void;
  /** Called on pointer hover moves (CSS px), throttled by the rig. */
  onPointerHover(x: number, y: number): void;
  /** Initial focus entity id (default 'sol:earth'). */
  initialFocusId?: string;
}

/** Output of one camera update; the engine builds the FrameContext from it. */
export interface CameraFrameState {
  /** Camera world position, ICRS meters relative to the SSB (float64). */
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  /** Unit forward vector (ICRS). */
  forward: THREE.Vector3;
  focusDistanceM: number;
  scaleLog10: number;
  /** Render scale for this frame (see docs/ARCHITECTURE.md §5.1). */
  metersPerUnit: number;
  focusId: string | null;
  anchorId: string;
  /** Human-readable active reference frame, e.g. "Geocentric · ICRS axes". */
  frameLabel: string;
}

export interface CameraRig extends CameraController {
  update(dtRealSec: number, timeMs: number): CameraFrameState;
  dispose(): void;
}

// ───────────────────────────── STUB IMPLEMENTATION BELOW ─────────────────────────────

export function createCameraRig(deps: CameraRigDeps): CameraRig {
  const state: CameraFrameState = {
    position: new THREE.Vector3(),
    quaternion: new THREE.Quaternion(),
    forward: new THREE.Vector3(0, 0, -1),
    focusDistanceM: 2.5e7,
    scaleLog10: 7.4,
    metersPerUnit: 2.5e4,
    focusId: deps.initialFocusId ?? 'sol:earth',
    anchorId: deps.initialFocusId ?? 'sol:earth',
    frameLabel: 'Stub camera',
  };
  let mode: CameraMode = 'orbit';
  const anchorPos = new THREE.Vector3();
  const dir = new THREE.Vector3(0, -0.3, 1).normalize(); // camera sits at anchor + dir * distance

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    state.focusDistanceM *= Math.exp(e.deltaY * 0.001);
  };
  deps.inputElement.addEventListener('wheel', onWheel, { passive: false });

  const rig: CameraRig = {
    get mode() { return mode; },
    get focusId() { return state.focusId; },
    get anchorId() { return state.anchorId; },
    get traveling() { return false; },
    async focus(id: string, _opts?: TravelOptions) { state.focusId = id; state.anchorId = id; },
    async travelTo(id: string, _opts?: TravelOptions) { state.focusId = id; state.anchorId = id; },
    setScale(scaleLog10: number) {
      state.focusDistanceM = Math.pow(10, scaleLog10) / (2 * Math.tan(deps.fovYRad / 2));
    },
    setMode(m: CameraMode) { mode = m; },
    getView(): CameraViewState {
      return {
        anchorId: state.anchorId,
        offset: [dir.x * state.focusDistanceM, dir.y * state.focusDistanceM, dir.z * state.focusDistanceM],
        quaternion: [state.quaternion.x, state.quaternion.y, state.quaternion.z, state.quaternion.w],
        mode,
        focusId: state.focusId,
        scaleLog10: state.scaleLog10,
      };
    },
    async setView(view: CameraViewState) { state.anchorId = view.anchorId; state.focusId = view.focusId; },
    back() { return false; },
    cancelTravel() {},
    update(_dt: number, timeMs: number): CameraFrameState {
      const anchor = deps.registry.get(state.anchorId);
      if (anchor) anchor.position(timeMs, anchorPos);
      else anchorPos.set(0, 0, 0);
      state.position.copy(anchorPos).addScaledVector(dir, state.focusDistanceM);
      state.forward.copy(dir).negate();
      const m = new THREE.Matrix4().lookAt(state.position, anchorPos, new THREE.Vector3(0, 0, 1));
      state.quaternion.setFromRotationMatrix(m);
      state.scaleLog10 = Math.log10(2 * state.focusDistanceM * Math.tan(deps.fovYRad / 2));
      state.metersPerUnit = Math.max(1e-3, state.focusDistanceM / 1000);
      return state;
    },
    dispose() { deps.inputElement.removeEventListener('wheel', onWheel); },
  };
  return rig;
}
