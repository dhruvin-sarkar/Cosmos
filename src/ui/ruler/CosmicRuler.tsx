import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type WheelEvent } from 'react';
import { formatPowerOfTen } from '../format';
import { useCommands, useCosmos, useRegistry, safeGetEntity, useReducedMotion } from '../hooks';
import { cx } from '../lib/dom';
import { RULER_LANDMARKS, type RulerLandmark } from './landmarks';
import { clampScale, decadeOf, fieldOfViewLine, rulerTicks, RULER_MAX_LOG10, RULER_MIN_LOG10, UNIT_BANDS } from './scale';

const ALL_TICKS = rulerTicks(RULER_MIN_LOG10, RULER_MAX_LOG10);
const LABEL_GAP_PX = 17;

/** Vertical label offsets (px) so landmark labels never overlap; each tick stays at its true value. */
export function landmarkOffsets(logs: readonly number[], ppd: number): number[] {
  const order = logs.map((l, i) => ({ l, i })).sort((a, b) => a.l - b.l);
  const out = new Array<number>(logs.length).fill(0);
  let lastY = Infinity;
  for (const { l, i } of order) {
    const y = -l * ppd;
    const placed = Math.min(y, lastY - LABEL_GAP_PX);
    out[i] = placed - y;
    lastY = placed;
  }
  return out;
}

const LANDMARK_LOGS = RULER_LANDMARKS.map(l => Math.log10(l.widthM));
const DRAG_THRESHOLD_PX = 4;

function pxPerDecadeFor(height: number): number {
  return Math.min(132, Math.max(72, height / 7.5));
}

/**
 * The Cosmic Ruler: a vertical slide-rule log scale (10⁰–10²⁷ m) that slides under a fixed brass cursor.
 * Drag or wheel to scrub the view scale, arrow keys step a decade, click a landmark to go there. The magnitude
 * reads in the Atlas voice: large while travelling or scrubbing, compact at rest.
 */
export function CosmicRuler({ className }: { className?: string }) {
  const commands = useCommands();
  const registry = useRegistry();
  const scale = useCosmos(s => s.view.scaleLog10);
  const traveling = useCosmos(s => s.camera.traveling);
  const tourActive = useCosmos(s => s.tour.activeId != null);
  const tourStep = useCosmos(s => s.tour.step);
  const tourCount = useCosmos(s => s.tour.stepCount);
  const reducedMotion = useReducedMotion();

  const rootRef = useRef<HTMLDivElement | null>(null);
  const slideRef = useRef<HTMLDivElement | null>(null);
  const dotRef = useRef<HTMLSpanElement | null>(null);
  const landmarksRef = useRef<HTMLUListElement | null>(null);
  const [height, setHeight] = useState(800);
  const [scrubbing, setScrubbing] = useState(false);
  const ppd = pxPerDecadeFor(height);
  const ppdRef = useRef(ppd);
  ppdRef.current = ppd;

  // The slide is positioned imperatively (rAF lerp toward the ~10 Hz store value) so React never renders per frame.
  const display = useRef(clampScale(scale));
  const target = useRef(clampScale(scale));
  const raf = useRef(0);
  const drag = useRef<{ startY: number; startScale: number; moved: boolean; pointerId: number } | null>(null);
  const suppressClick = useRef(false);
  const pending = useRef<number | null>(null);

  const apply = (s: number): void => {
    const slide = slideRef.current;
    if (slide) slide.style.transform = `translate3d(0, ${(s * ppdRef.current).toFixed(2)}px, 0)`;
    // Labels that would collide with the magnitude readout beside the cursor step back.
    const items = landmarksRef.current?.children;
    if (items) {
      for (let i = 0; i < items.length; i++) {
        const dy = (s - LANDMARK_LOGS[i]) * ppdRef.current;
        (items[i] as HTMLElement).classList.toggle('is-near', dy > -62 && dy < 70);
      }
    }
    const dot = dotRef.current;
    if (dot) dot.style.top = `${((RULER_MAX_LOG10 - s) / (RULER_MAX_LOG10 - RULER_MIN_LOG10)) * 100}%`;
  };

  const tick = (): void => {
    raf.current = 0;
    const d = target.current - display.current;
    if (Math.abs(d) < 1e-4 || reducedMotion) display.current = target.current;
    else display.current += d * 0.22;
    apply(display.current);
    if (display.current !== target.current) raf.current = requestAnimationFrame(tick);
  };
  const kick = (): void => {
    if (!raf.current) raf.current = requestAnimationFrame(tick);
  };

  useEffect(() => {
    if (drag.current) return;
    target.current = clampScale(scale);
    kick();
  }, [scale]);

  useLayoutEffect(() => {
    apply(display.current);
  }, [ppd]);

  useLayoutEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    setHeight(el.clientHeight || 800);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(e => setHeight(e[0]?.contentRect.height || 800));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  // Scrubbing sends setScale at most once per animation frame, without camera animation.
  const sendScale = (s: number): void => {
    pending.current = s;
    target.current = s;
    display.current = s;
    apply(s);
    requestAnimationFrame(() => {
      if (pending.current == null) return;
      commands.setScale(pending.current, { animate: false });
      pending.current = null;
    });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    drag.current = { startY: e.clientY, startScale: display.current, moved: false, pointerId: e.pointerId };
    suppressClick.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.abs(dy) < DRAG_THRESHOLD_PX) return;
    if (!d.moved) {
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      setScrubbing(true);
    }
    sendScale(clampScale(d.startScale + dy / ppdRef.current));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    const d = drag.current;
    if (!d) return;
    if (d.moved) {
      suppressClick.current = true;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    }
    drag.current = null;
    setScrubbing(false);
  };

  const wheelIdle = useRef(0);
  const onWheel = (e: WheelEvent<HTMLDivElement>): void => {
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    sendScale(clampScale(target.current + (e.deltaY * unit) / (ppd * 2.5)));
    setScrubbing(true);
    window.clearTimeout(wheelIdle.current);
    wheelIdle.current = window.setTimeout(() => setScrubbing(false), 600);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    let next: number | null = null;
    const step = e.shiftKey ? 0.1 : 1;
    switch (e.key) {
      case 'ArrowUp':
      case 'ArrowRight': next = target.current + step; break;
      case 'ArrowDown':
      case 'ArrowLeft': next = target.current - step; break;
      case 'PageUp': next = target.current + 3; break;
      case 'PageDown': next = target.current - 3; break;
      case 'Home': next = RULER_MIN_LOG10; break;
      case 'End': next = RULER_MAX_LOG10; break;
      default: return;
    }
    e.preventDefault();
    const s = clampScale(e.shiftKey ? next : Math.round(next));
    target.current = s;
    kick();
    commands.setScale(s, { animate: true });
  };

  const goToLandmark = (l: RulerLandmark): void => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return;
    }
    if (l.entityId && safeGetEntity(registry, l.entityId)) {
      void commands.focus(l.entityId);
      return;
    }
    const s = clampScale(Math.log10(l.widthM));
    target.current = s;
    kick();
    commands.setScale(s, { animate: true });
  };

  const big = traveling || scrubbing;
  const decade = decadeOf(scale);
  const line = fieldOfViewLine(scale);
  const labelOffsets = useMemo(() => landmarkOffsets(LANDMARK_LOGS, ppd), [ppd]);
  const tourMarks = useMemo(() => (tourActive && tourCount > 1 ? Array.from({ length: tourCount }, (_, i) => i) : []), [tourActive, tourCount]);

  // The slide (hundreds of ticks + landmarks) depends only on the layout: re-rendering it on every ~10 Hz scale update
  // cost ~15 ms per update while travelling.
  const goToLandmarkRef = useRef(goToLandmark);
  goToLandmarkRef.current = goToLandmark;
  const slideContent = useMemo(() => (
    <>
      <svg className="cx-ruler__ticks" width="64" height={RULER_MAX_LOG10 * ppd + 2} viewBox={`0 ${-RULER_MAX_LOG10 * ppd - 1} 64 ${RULER_MAX_LOG10 * ppd + 2}`} aria-hidden="true" style={{ top: -RULER_MAX_LOG10 * ppd - 1 }}>
        <line x1="20" x2="20" y1={-RULER_MAX_LOG10 * ppd} y2="0" className="cx-ruler__spine" />
        {ALL_TICKS.map(t => {
          const y = -t.log10 * ppd;
          const m = Math.round(10 ** (t.log10 - t.exponent));
          const len = t.major ? 16 : m === 5 ? 9 : 5;
          return <line key={t.log10} x1={20 - len} x2="20" y1={y} y2={y} className={t.major ? 'cx-ruler__major' : 'cx-ruler__minor'} />;
        })}
      </svg>
      {ALL_TICKS.filter(t => t.major).map(t => (
        <span key={t.exponent} className="cx-ruler__exp" style={{ top: -t.exponent * ppd }} aria-hidden="true">
          10<sup>{String(t.exponent)}</sup>
        </span>
      ))}
      {UNIT_BANDS.map(u => (
        Math.abs(u.log10 - Math.round(u.log10)) * ppd < 16 ? null : (
          <span key={u.id} className="cx-ruler__unit" style={{ top: -u.log10 * ppd }} title={u.name} aria-hidden="true">
            {u.label}
          </span>
        )
      ))}
      <ul ref={landmarksRef} className="cx-ruler__landmarks" aria-label="Landmarks">
        {RULER_LANDMARKS.map((l, i) => (
          <li key={l.id} style={{ top: -LANDMARK_LOGS[i] * ppd }}>
            <button type="button" className="cx-ruler__landmark" onClick={() => goToLandmarkRef.current(l)} title={l.note}>
              <span className="cx-ruler__landmark-label" style={labelOffsets[i] ? { transform: `translateY(${labelOffsets[i]}px)` } : undefined}>{l.label}</span>
              <span className="cx-ruler__landmark-tick" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
    </>
  ), [ppd, labelOffsets]);

  return (
    <div
      ref={rootRef}
      className={cx('cx-ruler', big && 'cx-ruler--big', className)}
      role="group"
      aria-label="Cosmic Ruler"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onWheel={onWheel}
    >
      <div className="cx-ruler__window">
        <div ref={slideRef} className="cx-ruler__slide" style={{ transform: `translate3d(0, ${display.current * ppd}px, 0)` }}>
          {slideContent}
        </div>
      </div>

      <div
        className="cx-ruler__cursor"
        role="slider"
        tabIndex={0}
        aria-label="View scale"
        aria-orientation="vertical"
        aria-valuemin={RULER_MIN_LOG10}
        aria-valuemax={RULER_MAX_LOG10}
        aria-valuenow={Number.isFinite(scale) ? Number(scale.toFixed(2)) : undefined}
        aria-valuetext={line}
        aria-keyshortcuts="ArrowUp ArrowDown PageUp PageDown Home End"
        onKeyDown={onKeyDown}
      >
        <span className="cx-ruler__hairline" aria-hidden="true" />
      </div>

      <div className="cx-ruler__readout" aria-hidden="true">
        <span className="cx-ruler__mag">
          10<sup key={decade} className="cx-ruler__mag-exp">{String(decade)}</sup>
          <span className="cx-ruler__mag-unit">m</span>
        </span>
        <span className="cx-ruler__line">{line}</span>
      </div>

      <div className="cx-ruler__overview" aria-hidden="true">
        <span ref={dotRef} className="cx-ruler__overview-dot" />
        {tourMarks.map(i => (
          <span key={i} className={cx('cx-ruler__tour-tick', i <= tourStep && 'is-done')} style={{ top: `${(i / (tourMarks.length - 1)) * 100}%` }} />
        ))}
      </div>
      <span className="cx-sr-only" aria-live="polite">{big ? '' : `${formatPowerOfTen(decade)} meters`}</span>
    </div>
  );
}
