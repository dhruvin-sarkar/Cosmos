/**
 * Camera view history for `back()`: the view the user was looking at when each focus/travel started, so going back
 * restores where they were (including their own zoom/orbit adjustments), like a browser restoring scroll position.
 */
import type { CameraViewState } from '../types';

export const VIEW_HISTORY_LIMIT = 64;

function sameView(a: CameraViewState, b: CameraViewState): boolean {
  if (a.focusId !== b.focusId || a.mode !== b.mode) return false;
  if (Math.abs(a.scaleLog10 - b.scaleLog10) > 0.05) return false;
  // |q·q'| ≈ 1 ⇔ same orientation (within ~1.5°).
  const dot = Math.abs(a.quaternion[0] * b.quaternion[0] + a.quaternion[1] * b.quaternion[1] +
    a.quaternion[2] * b.quaternion[2] + a.quaternion[3] * b.quaternion[3]);
  if (dot < 0.99991) return false;
  if (a.focusId !== null) return true;
  return a.anchorId === b.anchorId &&
    Math.hypot(a.offset[0] - b.offset[0], a.offset[1] - b.offset[1], a.offset[2] - b.offset[2]) <=
      1e-3 * Math.hypot(a.offset[0], a.offset[1], a.offset[2]);
}

export function cloneView(v: CameraViewState): CameraViewState {
  return {
    anchorId: v.anchorId,
    offset: [v.offset[0], v.offset[1], v.offset[2]],
    quaternion: [v.quaternion[0], v.quaternion[1], v.quaternion[2], v.quaternion[3]],
    mode: v.mode,
    focusId: v.focusId,
    scaleLog10: v.scaleLog10,
  };
}

export class ViewHistory {
  private readonly stack: CameraViewState[] = [];

  constructor(private readonly limit = VIEW_HISTORY_LIMIT) {}

  get size(): number {
    return this.stack.length;
  }

  /** Record a view (deduplicated against the most recent entry; oldest entries drop beyond the limit). */
  push(view: CameraViewState): void {
    const top = this.stack[this.stack.length - 1];
    if (top && sameView(top, view)) return;
    this.stack.push(cloneView(view));
    if (this.stack.length > this.limit) this.stack.shift();
  }

  pop(): CameraViewState | undefined {
    return this.stack.pop();
  }

  peek(): CameraViewState | undefined {
    return this.stack[this.stack.length - 1];
  }

  clear(): void {
    this.stack.length = 0;
  }
}
