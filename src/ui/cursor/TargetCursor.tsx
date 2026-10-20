/**
 * Lock-on cursor: four corner brackets that roam with the pointer and snap around interactive targets.
 *
 * Ported to TypeScript from React Bits <TargetCursor /> by David Haz (reactbits.dev; MIT + Commons Clause, credited
 * in the Sources panel) and adapted for Cosmos:
 * - fine pointers only (touch kiosks keep native behaviour); hidden over text fields so the I-beam stays usable;
 * - a plain, non-spinning reticle while the visitor drags the 3D view (it never fights orbiting);
 * - the spin winds down after a short idle and the animation loop stops completely when nothing moves;
 * - reduced motion (OS or in-app) removes the spin and makes every snap instant;
 * - engine DOM labels (.cosmos-label) are targets too, followed every frame while the camera moves.
 *
 * Main-thread budget (it shares the thread with the WebGL loop): the per-frame work only writes transforms and
 * opacity. No blend modes or filters (the dark outline is a second bracket drawn behind, see TargetCursor.css), no
 * layout reads per frame: a static target's rect is cached and refreshed on scroll, resize, size changes and the end
 * of CSS transitions/animations; a moving 3D label is tracked by reading its inline translate3d (written by the
 * engine) as an offset from the rect measured at lock time. The pointer position comes from pointerrawupdate where
 * available, so the reticle uses the freshest position at each frame.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import './TargetCursor.css';

const CORNER_ANGLES = [0, 90, 180, 270] as const;
const QUARTER = Math.PI / 2;
/** Seconds of stillness after which the roaming reticle stops spinning (and the loop can sleep). */
const IDLE_SPIN_S = 2.5;
const TEXT_ENTRY = 'input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="submit"]), textarea, select, [contenteditable="true"]';

interface SpringState {
  x: number;
  v: number;
}

/** Semi-implicit Euler with enough substeps to stay stable for stiff springs and long frames. */
function spring(state: SpringState, goal: number, stiffness: number, damping: number, dt: number): void {
  const n = Math.max(2, Math.ceil((dt * Math.sqrt(stiffness)) / 0.35));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    state.v += (stiffness * (goal - state.x) - damping * state.v) * h;
    state.x += state.v * h;
  }
}

function settle(state: SpringState, goal: number): void {
  state.x = goal;
  state.v = 0;
}

/** Parses "translate3d(12.3px, 45.6px, 0)" (or translate(...)) without allocating arrays; NaN when absent. */
function readTranslate(transform: string, out: { x: number; y: number }): boolean {
  const open = transform.indexOf('(');
  if (open < 0 || !transform.startsWith('translate')) return false;
  const comma = transform.indexOf(',', open);
  if (comma < 0) return false;
  const comma2 = transform.indexOf(',', comma + 1);
  const close = transform.indexOf(')', comma);
  const x = parseFloat(transform.slice(open + 1, comma));
  const y = parseFloat(transform.slice(comma + 1, comma2 > 0 && comma2 < close ? comma2 : close));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
  out.x = x;
  out.y = y;
  return true;
}

type ElementSource = RefObject<HTMLElement | null> | HTMLElement | null | undefined;

function resolveElement(value: ElementSource): HTMLElement | null {
  if (!value) return null;
  return 'current' in value ? value.current : value;
}

export interface TargetCursorProps {
  /** CSS selector for the elements the brackets lock onto. */
  targetSelector?: string;
  /** Elements matching this selector count as "the 3D view": dragging there shows the plain reticle. */
  dragSurfaceSelector?: string;
  /** Text shown above a locked target; defaults to its data-cursor-label attribute. */
  labelFor?: (target: Element) => string;
  /** Targets that move on their own (3D labels): the loop keeps tracking them while locked. */
  liveSelector?: string;
  cursorColor?: string;
  cursorColorOnTarget?: string;
  /** Outline drawn behind the brackets so they stay legible over bright surfaces. */
  outlineColor?: string;
  /** Seconds per turn while roaming; 0 stops the spin. */
  spinDuration?: number;
  /** Seconds the brackets take to snap onto a target. */
  hoverDuration?: number;
  parallaxOn?: boolean;
  hideDefaultCursor?: boolean;
  /** Reticle size while roaming (px). */
  size?: number;
  /** Reticle size while dragging the 3D view (px). */
  dragSize?: number;
  cornerSize?: number;
  thickness?: number;
  padding?: number;
  matchRadius?: boolean;
  dotSize?: number;
  showLabel?: boolean;
  clickEffect?: boolean;
  /** Limits the cursor to one element (default: the whole page). */
  container?: ElementSource;
}

export function TargetCursor({
  targetSelector = '.cursor-target',
  dragSurfaceSelector,
  labelFor,
  liveSelector,
  cursorColor = '#ffffff',
  cursorColorOnTarget,
  outlineColor = 'oklch(0 0 0 / 0.55)',
  spinDuration = 2,
  hoverDuration = 0.2,
  parallaxOn = true,
  hideDefaultCursor = true,
  size = 36,
  dragSize = 20,
  cornerSize = 12,
  thickness = 3,
  padding = 6,
  matchRadius = true,
  dotSize = 4,
  showLabel = true,
  clickEffect = true,
  container,
}: TargetCursorProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const cornerRefs = useRef<(HTMLSpanElement | null)[]>([]);
  const dotRef = useRef<HTMLSpanElement | null>(null);
  const labelRef = useRef<HTMLSpanElement | null>(null);
  const wakeRef = useRef<(() => void) | null>(null);
  const settings = {
    targetSelector,
    dragSurfaceSelector,
    labelFor,
    liveSelector,
    spinDuration,
    hoverDuration: Math.max(0.05, hoverDuration),
    parallaxOn,
    hideDefaultCursor,
    size: Math.max(4, size),
    dragSize: Math.max(4, dragSize),
    cornerSize: Math.max(2, cornerSize),
    thickness: Math.max(0.5, thickness),
    padding,
    matchRadius,
    dotSize: Math.max(0, dotSize),
    showLabel,
    clickEffect,
    container,
  };
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)');
    const update = (): void => setHost(finePointer.matches ? document.body : null);
    update();
    finePointer.addEventListener('change', update);
    return () => finePointer.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const root = rootRef.current;
    if (!host || !root) return undefined;

    const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduced = (): boolean => reduceQuery.matches || document.documentElement.dataset.reducedMotion === 'true';
    const style = document.createElement('style');
    style.dataset.targetCursor = '';
    document.head.appendChild(style);

    const pointer = { x: 0, y: 0, inside: false, seen: false, pressed: false, dragging: false, native: false, movedAt: 0 };
    const centerX: SpringState = { x: 0, v: 0 };
    const centerY: SpringState = { x: 0, v: 0 };
    const halfW: SpringState = { x: 0, v: 0 };
    const halfH: SpringState = { x: 0, v: 0 };
    const turn: SpringState = { x: 0, v: 0 };
    const lock: SpringState = { x: 0, v: 0 };
    const press: SpringState = { x: 0, v: 0 };
    const presence: SpringState = { x: 0, v: 0 };
    let target: Element | null = null;
    let targetRadius = 0;
    let quarter = 0;
    let spinSpeed = 0;
    let raf = 0;
    let last = 0;
    let lastLabel = '';
    let lastOpacity = '';
    let lastScope: HTMLElement | null = null;
    let lastGeometry = '';
    let wasLocked = false;
    // Cached target rect (viewport px). Static targets: refreshed only when marked dirty. Live targets: the rect at
    // lock time plus the change in the mover's inline translate since then.
    const rect = { left: 0, top: 0, width: 0, height: 0 };
    let rectX = 0;
    let rectY = 0;
    let rectDirty = true;
    let mover: HTMLElement | null = null;
    const moverAt = { x: 0, y: 0 };
    const moverNow = { x: 0, y: 0 };
    // Observing fires once immediately; only a real size change (vs. the cached rect) needs a re-measure.
    const resize = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(entries => {
        const box = entries[entries.length - 1]?.borderBoxSize?.[0];
        if (!box || Math.abs(box.inlineSize - rect.width) > 0.5 || Math.abs(box.blockSize - rect.height) > 0.5) markDirty();
      })
      : null;

    const scopeOf = (): HTMLElement | null => resolveElement(settingsRef.current.container);

    function markDirty(): void {
      rectDirty = true;
      if (target) wake();
    }

    const measure = (): void => {
      if (!target) return;
      const r = target.getBoundingClientRect();
      rect.left = r.left;
      rect.top = r.top;
      rect.width = r.width;
      rect.height = r.height;
      rectDirty = false;
      if (mover && !readTranslate(mover.style.transform, moverAt)) mover = null;
    };

    const hideCursor = (): void => {
      const s = settingsRef.current;
      const scope = scopeOf();
      if (scope !== lastScope) {
        lastScope?.removeAttribute('data-target-cursor-scope');
        scope?.setAttribute('data-target-cursor-scope', '');
        lastScope = scope;
      }
      const sel = scope ? '[data-target-cursor-scope]' : 'html';
      const rule = s.hideDefaultCursor && pointer.inside && !pointer.native ? `${sel}, ${sel} * { cursor: none !important; }` : '';
      if (style.textContent !== rule) style.textContent = rule;
    };

    const findTarget = (x: number, y: number, element?: Element | null): Element | null => {
      const s = settingsRef.current;
      const node = element ?? document.elementFromPoint(x, y);
      const found = node?.closest?.(s.targetSelector) ?? null;
      if (!found || (found as HTMLButtonElement).disabled || found.getAttribute('aria-disabled') === 'true') return null;
      const scope = scopeOf();
      if (scope && !scope.contains(found)) return null;
      return found;
    };

    const lockOn = (next: Element | null): void => {
      if (next === target) return;
      if (target) resize?.unobserve(target);
      target = next;
      mover = null;
      rectDirty = true;
      if (target) {
        const s = settingsRef.current;
        quarter = Math.round(turn.x / QUARTER);
        targetRadius = parseFloat(getComputedStyle(target).borderTopLeftRadius) || 0;
        if (s.liveSelector && target.matches(s.liveSelector)) {
          // The element the engine moves: the nearest ancestor (or self) with an inline translate.
          for (let el: HTMLElement | null = target as HTMLElement; el; el = el.parentElement) {
            if (el.style.transform.startsWith('translate')) {
              mover = el;
              break;
            }
          }
        }
        resize?.observe(target);
        spinSpeed = 0;
        // Measure now, inside the input event (style is usually clean here), not in the frame after the engine's
        // label writes, where it would force an extra style and layout pass.
        measure();
      }
    };

    const labelOf = (el: Element): string => {
      const s = settingsRef.current;
      if (!s.showLabel) return '';
      return el.getAttribute('data-cursor-label') ?? s.labelFor?.(el) ?? '';
    };

    const frame = (now: number): void => {
      raf = 0;
      const s = settingsRef.current;
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 1 / 60;
      last = now;
      const instant = reduced();

      if (target && (!target.isConnected || !target.matches(s.targetSelector))) lockOn(null);
      let hasRect = false;
      if (target && !pointer.dragging) {
        if (rectDirty) measure();
        let dx = 0;
        let dy = 0;
        if (mover) {
          if (readTranslate(mover.style.transform, moverNow)) {
            dx = moverNow.x - moverAt.x;
            dy = moverNow.y - moverAt.y;
          } else {
            mover = null;
            measure();
          }
        }
        hasRect = rect.width > 0;
        rectX = rect.left + dx;
        rectY = rect.top + dy;
      }
      const locked = hasRect && pointer.inside && !pointer.native;
      const snapW = 4.6 / s.hoverDuration;
      const snapK = snapW * snapW;
      const snapC = 2 * 0.62 * snapW;
      const shown = pointer.inside && !pointer.native;

      spring(presence, shown ? 1 : 0, 260, 32, dt);
      spring(lock, locked ? 1 : 0, snapK, 2 * snapW, dt);
      spring(press, pointer.pressed && s.clickEffect ? 1 : 0, 900, 40, dt);

      let goalX = pointer.x;
      let goalY = pointer.y;
      const roam = pointer.dragging ? s.dragSize : s.size;
      let goalW = roam / 2;
      let goalH = roam / 2;
      if (locked) {
        const cx = rectX + rect.width / 2;
        const cy = rectY + rect.height / 2;
        const lean = s.parallaxOn && !instant ? 0.08 : 0;
        goalX = cx + (pointer.x - cx) * lean;
        goalY = cy + (pointer.y - cy) * lean;
        const odd = Math.abs(quarter) % 2 === 1;
        const w = rect.width / 2 + s.padding;
        const h = rect.height / 2 + s.padding;
        goalW = odd ? h : w;
        goalH = odd ? w : h;
      }

      if (!shown && presence.x < 0.01) pointer.seen = false;
      if (!pointer.seen || instant) {
        settle(centerX, goalX);
        settle(centerY, goalY);
        settle(halfW, goalW);
        settle(halfH, goalH);
        pointer.seen = shown;
      }
      if (instant) {
        settle(lock, locked ? 1 : 0);
        settle(presence, shown ? 1 : 0);
      }

      if (locked) {
        spring(centerX, goalX, snapK, snapC, dt);
        spring(centerY, goalY, snapK, snapC, dt);
      } else if (lock.x > 0.02) {
        // Leaving a target: a quick (40 ms) critically damped catch-up to the pointer.
        spring(centerX, goalX, 6400, 160, dt);
        spring(centerY, goalY, 6400, 160, dt);
      } else {
        // Roaming: glued to the pointer, like the system cursor it replaces.
        settle(centerX, goalX);
        settle(centerY, goalY);
      }
      spring(halfW, goalW, snapK, snapC, dt);
      spring(halfH, goalH, snapK, snapC, dt);

      const idle = (now - pointer.movedAt) / 1000 > IDLE_SPIN_S;
      if (locked || pointer.dragging || instant) {
        // Square up to the nearest quarter turn (locked: the quarter chosen at lock time).
        if (!locked) quarter = Math.round(turn.x / QUARTER);
        if (instant) settle(turn, quarter * QUARTER);
        else spring(turn, quarter * QUARTER, snapK, snapC, dt);
        spinSpeed = 0;
      } else {
        const speed = s.spinDuration > 0 && shown && !idle ? (Math.PI * 2) / s.spinDuration : 0;
        spinSpeed += (speed - spinSpeed) * (1 - Math.exp(-dt * 3));
        if (spinSpeed < 0.002 && speed === 0) spinSpeed = 0;
        turn.v = spinSpeed;
        turn.x += spinSpeed * dt;
        if (turn.x > Math.PI * 64) turn.x -= Math.PI * 64;
      }

      // Bracket geometry and lock colour change only when the lock state flips: one style write, not one per frame.
      if (locked !== wasLocked) {
        wasLocked = locked;
        root.classList.toggle('is-locked', locked);
      }
      const r = locked && s.matchRadius ? Math.min(targetRadius + Math.max(0, s.padding), s.cornerSize) : Math.min(2, s.cornerSize / 4);
      const geometry = `${s.cornerSize}|${s.thickness}|${r.toFixed(1)}|${s.dotSize}`;
      if (geometry !== lastGeometry) {
        lastGeometry = geometry;
        root.style.setProperty('--tc-size', `${s.cornerSize}px`);
        root.style.setProperty('--tc-thick', `${s.thickness}px`);
        root.style.setProperty('--tc-radius', `${r.toFixed(1)}px`);
        root.style.setProperty('--tc-dot', `${s.dotSize}px`);
      }

      const squeeze = 1 - press.x * 0.14;
      const cos = Math.cos(turn.x);
      const sin = Math.sin(turn.x);
      const w = Math.max(0, halfW.x) * squeeze;
      const h = Math.max(0, halfH.x) * squeeze;
      const degrees = (turn.x * 180) / Math.PI;
      let left = Infinity;
      let top = Infinity;
      for (let i = 0; i < 4; i++) {
        const corner = cornerRefs.current[i];
        if (!corner) continue;
        const lx = i === 0 || i === 3 ? -w : w;
        const ly = i < 2 ? -h : h;
        const x = centerX.x + lx * cos - ly * sin;
        const y = centerY.x + lx * sin + ly * cos;
        if (x < left) left = x;
        if (y < top) top = y;
        corner.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${(CORNER_ANGLES[i] + degrees).toFixed(2)}deg)`;
      }

      const dot = dotRef.current;
      if (dot) {
        const dotScale = 1 - press.x * 0.35;
        dot.style.transform = `translate3d(${pointer.x}px, ${pointer.y}px, 0) translate(-50%, -50%) scale(${dotScale.toFixed(3)})`;
      }

      const label = labelRef.current;
      if (label) {
        const text = target && locked ? labelOf(target) : '';
        if (text && text !== lastLabel) label.textContent = text;
        if (text) lastLabel = text;
        const vis = text ? Math.max(0, Math.min(1, lock.x)) : 0;
        if (vis > 0.001 || label.style.opacity !== '0') {
          // Above the brackets; below them when the target hugs the top edge of the screen.
          const below = top < 34;
          const y = below ? top + h * 2 + 10 : top - 8;
          label.style.transform = `translate3d(${left.toFixed(2)}px, ${y.toFixed(2)}px, 0) translateY(${below ? '0%' : '-100%'}) translateY(${((1 - vis) * 4).toFixed(2)}px)`;
          label.style.opacity = vis < 0.001 ? '0' : vis.toFixed(3);
        }
      }

      const opacity = Math.max(0, Math.min(1, presence.x)).toFixed(3);
      if (opacity !== lastOpacity) {
        root.style.opacity = opacity;
        lastOpacity = opacity;
      }

      const resting = !shown && presence.x < 0.002 && Math.abs(presence.v) < 0.002 && Math.abs(lock.x) < 0.002 && Math.abs(press.x) < 0.002;
      const spinning = shown && spinSpeed > 0.0001;
      const moving =
        Math.abs(centerX.v) + Math.abs(centerY.v) + Math.abs(halfW.v) + Math.abs(halfH.v) + Math.abs(turn.v) > 0.01 ||
        Math.abs(goalX - centerX.x) + Math.abs(goalY - centerY.x) + Math.abs(goalW - halfW.x) + Math.abs(goalH - halfH.x) > 0.05 ||
        Math.abs(lock.v) + Math.abs(press.v) + Math.abs(presence.v) > 0.001;
      // Still roaming before the idle wind-down: wake once more when the spin is due to stop.
      const awaitingIdle = shown && !idle && !locked && !pointer.dragging && s.spinDuration > 0 && !instant;
      if (!resting && (spinning || moving || (locked && mover != null) || awaitingIdle)) raf = requestAnimationFrame(frame);
      else last = 0;
    };

    function wake(): void {
      if (!raf) raf = requestAnimationFrame(frame);
    }
    wakeRef.current = () => {
      hideCursor();
      wake();
    };

    const insideScope = (x: number, y: number, element: Element | null): boolean => {
      const scope = scopeOf();
      if (!scope) return true;
      if (element && scope.contains(element)) return true;
      const box = scope.getBoundingClientRect();
      return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
    };

    // pointerrawupdate (secure contexts, Chromium) arrives as soon as the OS reports motion, not once per frame: the
    // frame then reads the freshest position. It only stores coordinates; targeting stays on pointermove.
    const onRaw = (event: PointerEvent): void => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.movedAt = event.timeStamp || performance.now();
      if (pointer.inside) wake();
    };

    const onPointerMove = (event: PointerEvent): void => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.movedAt = performance.now();
      const el = event.target instanceof Element ? event.target : null;
      const inside = insideScope(pointer.x, pointer.y, el);
      const native = !!el?.closest?.(TEXT_ENTRY);
      if (inside !== pointer.inside || native !== pointer.native) {
        pointer.inside = inside;
        pointer.native = native;
        hideCursor();
      }
      if (!pointer.dragging) lockOn(inside ? findTarget(pointer.x, pointer.y, el) : null);
      wake();
    };

    const onPointerDown = (event: PointerEvent): void => {
      if (event.pointerType && event.pointerType !== 'mouse') return;
      pointer.pressed = true;
      const s = settingsRef.current;
      const el = event.target instanceof Element ? event.target : null;
      if (s.dragSurfaceSelector && el?.closest?.(s.dragSurfaceSelector) && !el.closest(s.targetSelector)) {
        pointer.dragging = true;
        lockOn(null);
      }
      wake();
    };

    const onPointerUp = (event: PointerEvent): void => {
      pointer.pressed = false;
      if (pointer.dragging) {
        pointer.dragging = false;
        const el = document.elementFromPoint(event.clientX, event.clientY);
        lockOn(findTarget(event.clientX, event.clientY, el));
      }
      wake();
    };

    const onLeave = (): void => {
      pointer.inside = false;
      pointer.pressed = false;
      pointer.dragging = false;
      lockOn(null);
      hideCursor();
      wake();
    };

    const onScroll = (): void => {
      rectDirty = true;
      if (!pointer.inside || pointer.dragging) return;
      lockOn(findTarget(pointer.x, pointer.y));
      wake();
    };

    // A locked target may slide or grow (popovers, sheets, hover styles): re-measure when its motion ends.
    const onSettled = (event: Event): void => {
      if (!target) return;
      const el = event.target;
      if (el instanceof Node && (el === target || el.contains(target))) markDirty();
    };

    const hasRaw = 'onpointerrawupdate' in window;
    if (hasRaw) window.addEventListener('pointerrawupdate', onRaw as EventListener, { passive: true });
    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerdown', onPointerDown, { passive: true, capture: true });
    window.addEventListener('pointerup', onPointerUp, { passive: true, capture: true });
    window.addEventListener('pointercancel', onLeave, { passive: true });
    window.addEventListener('scroll', onScroll, { passive: true, capture: true });
    window.addEventListener('resize', markDirty, { passive: true });
    document.addEventListener('transitionend', onSettled, { passive: true, capture: true });
    document.addEventListener('animationend', onSettled, { passive: true, capture: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    window.addEventListener('blur', onLeave);

    return () => {
      cancelAnimationFrame(raf);
      wakeRef.current = null;
      resize?.disconnect();
      if (hasRaw) window.removeEventListener('pointerrawupdate', onRaw as EventListener);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerup', onPointerUp, { capture: true });
      window.removeEventListener('pointercancel', onLeave);
      window.removeEventListener('scroll', onScroll, { capture: true });
      window.removeEventListener('resize', markDirty);
      document.removeEventListener('transitionend', onSettled, { capture: true });
      document.removeEventListener('animationend', onSettled, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
      window.removeEventListener('blur', onLeave);
      lastScope?.removeAttribute('data-target-cursor-scope');
      style.remove();
    };
  }, [host]);

  useEffect(() => {
    wakeRef.current?.();
  });

  if (!host) return null;

  const colors = {
    opacity: 0,
    '--target-cursor-color': cursorColor,
    '--target-cursor-color-on': cursorColorOnTarget ?? cursorColor,
    '--target-cursor-outline': outlineColor,
  } as React.CSSProperties;

  return createPortal(
    <div ref={rootRef} className="target-cursor" style={colors} aria-hidden="true">
      {CORNER_ANGLES.map((angle, i) => (
        <span
          key={angle}
          ref={element => {
            cornerRefs.current[i] = element;
          }}
          className="target-cursor__corner"
        />
      ))}
      <span ref={dotRef} className="target-cursor__dot" />
      <span ref={labelRef} className="target-cursor__label" style={{ opacity: 0 }} />
    </div>,
    host,
  );
}

export default TargetCursor;
