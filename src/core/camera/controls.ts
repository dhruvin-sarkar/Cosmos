/**
 * DOM input → camera intents. Pointer (mouse / pen / touch), wheel and keyboard events are accumulated here and
 * consumed once per frame by the rig, which keeps all motion integration frame-synchronous and testable.
 *
 * Mouse: left-drag orbit · right-drag or Shift+left-drag look around · middle-drag zoom · wheel zoom.
 * Touch: one finger orbit · two-finger pinch zoom + twist · tap = click · double-tap = double-click.
 * Keys (ignored while typing in inputs/sliders or with Ctrl/Meta/Alt): arrows, + / −, W A S D Q E, Shift (fast).
 */
import type { Viewport } from '../types';

/** Movement (CSS px) that turns a press into a drag; below it, release is a click. */
export const DRAG_THRESHOLD_PX = 4;
export const TOUCH_DRAG_THRESHOLD_PX = 8;
export const DOUBLE_CLICK_MS = 320;
const DOUBLE_CLICK_SLOP_PX = 8;
const DOUBLE_TAP_SLOP_PX = 30;
const TAP_MAX_MS = 600;
/** Minimum interval between hover callbacks (leading + trailing edge). */
export const HOVER_THROTTLE_MS = 50;
/** Zoom decades per wheel pixel (one 100 px notch ≈ 0.3 decade ≈ ×2). Trackpad pinch arrives as Ctrl+wheel. */
export const WHEEL_DECADES_PER_PX = 0.003;
const PINCH_WHEEL_DECADES_PER_PX = 0.01;
const VELOCITY_WINDOW_MS = 90;
const VELOCITY_STALE_MS = 70;

export type DragKind = 'orbit' | 'look' | 'dolly';

export interface InputFrame {
  /** Drag deltas (CSS px) since the previous frame. */
  orbitDx: number;
  orbitDy: number;
  lookDx: number;
  lookDy: number;
  dollyPx: number;
  /** Zoom request, decades (+ = zoom out). */
  zoomDecades: number;
  /** Two-finger twist, radians (+ = counter-clockwise on screen). */
  twistRad: number;
  /** Pointer velocity at the end of a drag (CSS px/s), reported once; `releaseKind` null otherwise. */
  releaseKind: DragKind | null;
  releaseVx: number;
  releaseVy: number;
  /** A drag or pinch is in progress. */
  dragging: boolean;
  /** Any pointer drag, pinch or wheel input since the previous frame. */
  interacted: boolean;
}

export function createInputFrame(): InputFrame {
  return {
    orbitDx: 0, orbitDy: 0, lookDx: 0, lookDy: 0, dollyPx: 0, zoomDecades: 0, twistRad: 0,
    releaseKind: null, releaseVx: 0, releaseVy: 0, dragging: false, interacted: false,
  };
}

export interface HeldKeys {
  left: boolean; right: boolean; up: boolean; down: boolean;
  zoomIn: boolean; zoomOut: boolean;
  forward: boolean; back: boolean; strafeLeft: boolean; strafeRight: boolean; rise: boolean; sink: boolean;
  fast: boolean;
}

type KeyName = keyof HeldKeys;

const CODE_TO_KEY: Readonly<Record<string, KeyName>> = {
  ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down',
  KeyW: 'forward', KeyS: 'back', KeyA: 'strafeLeft', KeyD: 'strafeRight', KeyE: 'rise', KeyQ: 'sink',
  NumpadAdd: 'zoomIn', NumpadSubtract: 'zoomOut', ShiftLeft: 'fast', ShiftRight: 'fast',
};
const CHAR_TO_KEY: Readonly<Record<string, KeyName>> = { '+': 'zoomIn', '=': 'zoomIn', '-': 'zoomOut', '_': 'zoomOut' };

const IGNORE_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="slider"], [role="textbox"], ' +
  '[role="listbox"], [role="menu"], [role="menuitem"], [role="tablist"], [role="radiogroup"], [role="spinbutton"], [role="combobox"]';

interface Sample {
  t: number;
  x: number;
  y: number;
}

interface ActivePointer {
  id: number;
  type: string;
  startX: number;
  startY: number;
  startT: number;
  x: number;
  y: number;
  kind: DragKind;
  dragging: boolean;
}

export interface ControlsOptions {
  element: HTMLElement;
  /** Target for keyboard listeners (normally `window`); null disables keyboard input. */
  keyTarget: EventTarget | null;
  getViewport(): Viewport;
  onClick(x: number, y: number, double: boolean): void;
  onHover(x: number, y: number): void;
  now?(): number;
}

function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as (Element & { closest?: (s: string) => Element | null; isContentEditable?: boolean }) | null;
  if (!el || typeof el.closest !== 'function') return false;
  return el.isContentEditable === true || el.closest(IGNORE_SELECTOR) !== null;
}

export class CameraControls {
  readonly keys: HeldKeys = {
    left: false, right: false, up: false, down: false, zoomIn: false, zoomOut: false,
    forward: false, back: false, strafeLeft: false, strafeRight: false, rise: false, sink: false, fast: false,
  };

  private readonly acc: InputFrame = createInputFrame();
  private readonly pointers = new Map<number, ActivePointer>();
  private readonly samples: Sample[] = [];
  private pinch: { dist: number; angle: number } | null = null;
  /** True once a multi-touch gesture happened in the current touch sequence (suppresses taps). */
  private multiTouch = false;
  private lastClick = { t: -Infinity, x: 0, y: 0 };
  private hoverLastEmit = -Infinity;
  private hoverPending: { x: number; y: number } | null = null;
  private hoverTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly prevTouchAction: string;
  private readonly now: () => number;
  private readonly cleanup: (() => void)[] = [];

  constructor(private readonly opts: ControlsOptions) {
    this.now = opts.now ?? (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    const el = opts.element;
    this.prevTouchAction = el.style?.touchAction ?? '';
    if (el.style) el.style.touchAction = 'none';
    this.listen(el, 'pointerdown', this.onPointerDown as EventListener);
    this.listen(el, 'pointermove', this.onPointerMove as EventListener);
    this.listen(el, 'pointerup', this.onPointerUp as EventListener);
    this.listen(el, 'pointercancel', this.onPointerCancel as EventListener);
    this.listen(el, 'lostpointercapture', this.onPointerCancel as EventListener);
    this.listen(el, 'pointerleave', this.onPointerLeave as EventListener);
    this.listen(el, 'wheel', this.onWheel as EventListener, { passive: false });
    this.listen(el, 'contextmenu', this.onContextMenu);
    if (opts.keyTarget) {
      this.listen(opts.keyTarget, 'keydown', this.onKeyDown as EventListener);
      this.listen(opts.keyTarget, 'keyup', this.onKeyUp as EventListener);
      this.listen(opts.keyTarget, 'blur', this.onBlur);
    }
  }

  /** Copy the accumulated input into `out` and reset the accumulators. */
  consume(out: InputFrame): InputFrame {
    const a = this.acc;
    out.orbitDx = a.orbitDx; out.orbitDy = a.orbitDy;
    out.lookDx = a.lookDx; out.lookDy = a.lookDy;
    out.dollyPx = a.dollyPx;
    out.zoomDecades = a.zoomDecades;
    out.twistRad = a.twistRad;
    out.releaseKind = a.releaseKind; out.releaseVx = a.releaseVx; out.releaseVy = a.releaseVy;
    out.interacted = a.interacted;
    out.dragging = this.pinch !== null || this.anyDragging();
    a.orbitDx = a.orbitDy = a.lookDx = a.lookDy = a.dollyPx = a.zoomDecades = a.twistRad = 0;
    a.releaseKind = null; a.releaseVx = a.releaseVy = 0;
    a.interacted = false;
    return out;
  }

  /** Inject a zoom request (decades, + = out) as if it came from the wheel. */
  addZoom(decades: number): void {
    this.acc.zoomDecades += decades;
    this.acc.interacted = true;
  }

  dispose(): void {
    for (const off of this.cleanup) off();
    this.cleanup.length = 0;
    if (this.hoverTimer !== null) clearTimeout(this.hoverTimer);
    this.hoverTimer = null;
    if (this.opts.element.style) this.opts.element.style.touchAction = this.prevTouchAction;
    this.pointers.clear();
    this.clearKeys();
  }

  // ── internals ─────────────────────────────────────────────────────────────────────────────

  private listen(target: EventTarget, type: string, fn: EventListener, options?: AddEventListenerOptions): void {
    target.addEventListener(type, fn, options);
    this.cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const el = this.opts.element as HTMLElement & { getBoundingClientRect?: () => DOMRect };
    const r = typeof el.getBoundingClientRect === 'function' ? el.getBoundingClientRect() : null;
    return { x: e.clientX - (r ? r.left : 0), y: e.clientY - (r ? r.top : 0) };
  }

  private anyDragging(): boolean {
    for (const p of this.pointers.values()) if (p.dragging) return true;
    return false;
  }

  private onPointerDown = (e: PointerEvent): void => {
    const { x, y } = this.local(e);
    const isTouch = e.pointerType === 'touch';
    if (!isTouch && this.pointers.size > 0) return;
    let kind: DragKind = 'orbit';
    if (!isTouch) {
      if (e.button === 2) kind = 'look';
      else if (e.button === 1) kind = 'dolly';
      else if (e.button !== 0) return;
      else if (e.shiftKey) kind = 'look';
      if (e.button === 1) e.preventDefault?.();
    }
    const t = this.now();
    const p: ActivePointer = { id: e.pointerId, type: e.pointerType, startX: x, startY: y, startT: t, x, y, kind, dragging: false };
    this.pointers.set(e.pointerId, p);
    try {
      (this.opts.element as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(e.pointerId);
    } catch {
      // Capture can fail for synthetic events; dragging still works while the pointer stays over the element.
    }
    if (isTouch) {
      if (this.pointers.size === 1) this.multiTouch = false;
      if (this.pointers.size === 2) this.beginPinch();
    }
    this.samples.length = 0;
    this.samples.push({ t, x, y });
  };

  private beginPinch(): void {
    const pts = Array.from(this.pointers.values());
    const [a, b] = pts;
    this.pinch = { dist: Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1), angle: Math.atan2(b.y - a.y, b.x - a.x) };
    this.multiTouch = true;
    for (const p of pts) p.dragging = true;
  }

  private onPointerMove = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    const { x, y } = this.local(e);
    if (!p) {
      if (e.pointerType !== 'touch' && e.buttons === 0) this.hover(x, y);
      return;
    }
    const dx = x - p.x, dy = y - p.y;
    p.x = x;
    p.y = y;
    if (this.pinch && this.pointers.size >= 2) {
      this.updatePinch();
      return;
    }
    if (!p.dragging) {
      const threshold = p.type === 'touch' ? TOUCH_DRAG_THRESHOLD_PX : DRAG_THRESHOLD_PX;
      if (Math.hypot(x - p.startX, y - p.startY) < threshold) return;
      p.dragging = true;
    }
    const a = this.acc;
    if (p.kind === 'orbit') { a.orbitDx += dx; a.orbitDy += dy; }
    else if (p.kind === 'look') { a.lookDx += dx; a.lookDy += dy; }
    else a.dollyPx += dy;
    a.interacted = true;
    const t = this.now();
    this.samples.push({ t, x, y });
    while (this.samples.length > 2 && t - this.samples[0].t > VELOCITY_WINDOW_MS) this.samples.shift();
  };

  private updatePinch(): void {
    if (!this.pinch) return;
    const it = this.pointers.values();
    const a = it.next().value as ActivePointer;
    const b = it.next().value as ActivePointer;
    const dist = Math.max(Math.hypot(b.x - a.x, b.y - a.y), 1);
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    this.acc.zoomDecades -= Math.log10(dist / this.pinch.dist);
    let dAngle = angle - this.pinch.angle;
    if (dAngle > Math.PI) dAngle -= 2 * Math.PI;
    else if (dAngle < -Math.PI) dAngle += 2 * Math.PI;
    // Screen y points down, so a positive atan2 change is a clockwise twist on screen.
    this.acc.twistRad -= dAngle;
    this.acc.interacted = true;
    this.pinch.dist = dist;
    this.pinch.angle = angle;
  }

  private onPointerUp = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    const t = this.now();
    if (this.pinch) {
      if (this.pointers.size < 2) this.pinch = null;
      for (const rest of this.pointers.values()) {
        rest.startX = rest.x;
        rest.startY = rest.y;
      }
      this.samples.length = 0;
      return;
    }
    if (p.dragging) {
      this.reportRelease(p.kind, t);
      return;
    }
    const isTouch = p.type === 'touch';
    if (isTouch && (this.multiTouch || t - p.startT > TAP_MAX_MS)) return;
    if (!isTouch && e.button !== 0) return;
    this.click(p.x, p.y, t, isTouch);
  };

  private onPointerCancel = (e: PointerEvent): void => {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (p.dragging) this.reportRelease(p.kind, this.now());
  };

  private onPointerLeave = (e: PointerEvent): void => {
    if (e.pointerType === 'touch' || this.pointers.size > 0) return;
    this.hoverPending = null;
    this.opts.onHover(-1, -1);
  };

  private reportRelease(kind: DragKind, t: number): void {
    const s = this.samples;
    this.acc.releaseKind = kind;
    this.acc.releaseVx = 0;
    this.acc.releaseVy = 0;
    if (s.length >= 2) {
      const last = s[s.length - 1];
      if (t - last.t <= VELOCITY_STALE_MS) {
        let first = s[0];
        for (let i = s.length - 2; i >= 0; i--) {
          first = s[i];
          if (last.t - s[i].t >= VELOCITY_WINDOW_MS * 0.6) break;
        }
        const dt = (last.t - first.t) / 1000;
        if (dt > 0.008) {
          this.acc.releaseVx = (last.x - first.x) / dt;
          this.acc.releaseVy = (last.y - first.y) / dt;
        }
      }
    }
    s.length = 0;
  }

  private click(x: number, y: number, t: number, isTouch: boolean): void {
    const slop = isTouch ? DOUBLE_TAP_SLOP_PX : DOUBLE_CLICK_SLOP_PX;
    const lc = this.lastClick;
    if (t - lc.t <= DOUBLE_CLICK_MS && Math.hypot(x - lc.x, y - lc.y) <= slop) {
      lc.t = -Infinity;
      this.opts.onClick(x, y, true);
      return;
    }
    lc.t = t;
    lc.x = x;
    lc.y = y;
    this.opts.onClick(x, y, false);
  }

  private hover(x: number, y: number): void {
    const t = this.now();
    if (t - this.hoverLastEmit >= HOVER_THROTTLE_MS) {
      this.hoverLastEmit = t;
      this.hoverPending = null;
      this.opts.onHover(x, y);
      return;
    }
    this.hoverPending = { x, y };
    if (this.hoverTimer === null) {
      this.hoverTimer = setTimeout(() => {
        this.hoverTimer = null;
        const pending = this.hoverPending;
        if (!pending) return;
        this.hoverPending = null;
        this.hoverLastEmit = this.now();
        this.opts.onHover(pending.x, pending.y);
      }, Math.max(0, HOVER_THROTTLE_MS - (t - this.hoverLastEmit)));
    }
  }

  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    // Shift+wheel arrives as horizontal scroll in Chromium.
    let px = e.deltaY !== 0 ? e.deltaY : e.deltaX;
    if (e.deltaMode === 1) px *= 16;
    else if (e.deltaMode === 2) px *= Math.max(this.opts.getViewport().height, 1);
    const perPx = e.ctrlKey ? PINCH_WHEEL_DECADES_PER_PX : WHEEL_DECADES_PER_PX;
    this.acc.zoomDecades += px * perPx * (e.shiftKey ? 3 : 1);
    this.acc.interacted = true;
  };

  private onContextMenu = (e: Event): void => {
    e.preventDefault();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
    if (isEditableTarget(e.target)) return;
    const k = CODE_TO_KEY[e.code] ?? CHAR_TO_KEY[e.key];
    if (!k) return;
    this.keys[k] = true;
    if (k === 'left' || k === 'right' || k === 'up' || k === 'down') e.preventDefault();
  };

  private onKeyUp = (e: KeyboardEvent): void => {
    const k = CODE_TO_KEY[e.code] ?? CHAR_TO_KEY[e.key];
    if (k) this.keys[k] = false;
    if (e.key === 'Shift') this.keys.fast = false;
  };

  private onBlur = (): void => {
    this.clearKeys();
  };

  private clearKeys(): void {
    for (const k of Object.keys(this.keys) as KeyName[]) this.keys[k] = false;
  }
}
