/**
 * Camera rig — public API contract (implementation in ./rigImpl.ts).
 *
 * Orbit / free / follow modes, input controls, Cosmic Ruler focus chain, cinematic travel, up-vector blending and
 * view history. Every exported name and signature in this file is stable: src/core/engine.ts compiles against them.
 */
import * as THREE from 'three';
import type { CameraController, EngineEvents, EventBus, Viewport } from '../types';
import type { EntityRegistry } from '../entity';
import type { CosmosStore } from '../../state/store';
import { CosmosCameraRig } from './rigImpl';

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
  /**
   * Off-axis projection shift as a fraction of the viewport width (+ = the focus appears right of centre). Eases to
   * +0.10 while the inspector is open so the focused body sits at 0.60 W (VISUAL_DIRECTION "Inspect framing").
   * Apply with `applyProjectionShift(camera, viewport, shift)` after updating the projection.
   */
  projectionShiftX?: number;
}

export interface CameraRig extends CameraController {
  update(dtRealSec: number, timeMs: number): CameraFrameState;
  dispose(): void;
}

export function createCameraRig(deps: CameraRigDeps): CameraRig {
  return new CosmosCameraRig(deps);
}

/**
 * Apply the rig's horizontal projection shift to the render camera (camera.setViewOffset). The principal point moves
 * by `shiftX · width` so the focus is framed off-centre without moving the camera; picking/projection through the
 * camera's projection matrix stays consistent. Call after any change to the viewport or the camera's aspect/fov.
 */
export function applyProjectionShift(camera: THREE.PerspectiveCamera, viewport: Viewport, shiftX: number | undefined): void {
  const w = Math.max(viewport.width, 1), h = Math.max(viewport.height, 1);
  const shift = shiftX ?? 0;
  if (Math.abs(shift) < 1e-5) {
    if (camera.view?.enabled) camera.clearViewOffset();
    return;
  }
  camera.setViewOffset(w, h, -shift * w, 0, w, h);
}
