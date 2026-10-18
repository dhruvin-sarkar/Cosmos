import { useCallback, useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { cx } from '../lib/dom';

export interface SliderMark {
  value: number;
  label?: string;
}

export interface SliderProps {
  value: number;
  onChange(value: number): void;
  /** Called once when a drag or key interaction finishes. */
  onCommit?(value: number): void;
  min: number;
  max: number;
  /**
   * Step in value units for linear sliders, or in decades (log10 units) for logarithmic ones
   * (e.g. 0.01 → 1 % multiplicative steps). Default: 1/100 of the range.
   */
  step?: number;
  scale?: 'linear' | 'log';
  label: ReactNode;
  /** Plain-text label for assistive technology when `label` is not a string. */
  ariaLabel?: string;
  /** Readout text for a value (without unit). */
  format?(value: number): string;
  unit?: string;
  /** A reference value drawn on the track, e.g. the real (observed) value in a lab. */
  referenceValue?: number | null;
  referenceLabel?: string;
  marks?: readonly SliderMark[];
  disabled?: boolean;
  className?: string;
  /** Extra content after the readout (e.g. a provenance badge). */
  trailing?: ReactNode;
}

function toT(v: number, min: number, max: number, log: boolean): number {
  if (log) {
    const lv = Math.log10(Math.max(v, Number.MIN_VALUE));
    return (lv - Math.log10(min)) / (Math.log10(max) - Math.log10(min));
  }
  return (v - min) / (max - min);
}

function fromT(t: number, min: number, max: number, log: boolean): number {
  const c = Math.min(1, Math.max(0, t));
  if (log) return 10 ** (Math.log10(min) + c * (Math.log10(max) - Math.log10(min)));
  return min + c * (max - min);
}

function snap(v: number, min: number, max: number, step: number, log: boolean): number {
  if (log) {
    const lmin = Math.log10(min);
    const lv = Math.round((Math.log10(v) - lmin) / step) * step + lmin;
    return Math.min(max, Math.max(min, Number((10 ** lv).toPrecision(6))));
  }
  const s = Math.round((v - min) / step) * step + min;
  return Math.min(max, Math.max(min, Number(s.toPrecision(12))));
}

/** Slide-rule graduations for a log scale: majors at each power of ten, minors at 2–9 (positions 0..1). */
export function logTicks(min: number, max: number): Array<{ t: number; major: boolean }> {
  const lmin = Math.log10(min);
  const lmax = Math.log10(max);
  const span = lmax - lmin;
  const out: Array<{ t: number; major: boolean }> = [];
  if (!(span > 0) || span > 40) return out;
  for (let e = Math.floor(lmin); e <= Math.ceil(lmax); e++) {
    for (let m = 1; m <= 9; m++) {
      const lv = e + Math.log10(m);
      if (lv < lmin - 1e-9 || lv > lmax + 1e-9) continue;
      if (m > 1 && span > 8) continue;
      out.push({ t: (lv - lmin) / span, major: m === 1 });
    }
  }
  return out;
}

const defaultFormat = (v: number): string => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(3));

/** Accessible slider (linear or logarithmic) with a value + unit readout and an optional reference marker. */
export function Slider({
  value, onChange, onCommit, min, max, step, scale = 'linear', label, ariaLabel, format = defaultFormat, unit, referenceValue,
  referenceLabel = 'Real', marks, disabled, className, trailing,
}: SliderProps) {
  const log = scale === 'log' && min > 0 && max > 0;
  const effectiveStep = step ?? (log ? (Math.log10(max) - Math.log10(min)) / 100 : (max - min) / 100);
  const id = useId();
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [dragging, setDragging] = useState(false);
  const latest = useRef(value);
  latest.current = value;

  const valueFromClientX = useCallback((clientX: number): number => {
    const el = trackRef.current;
    if (!el) return value;
    const r = el.getBoundingClientRect();
    return snap(fromT((clientX - r.left) / r.width, min, max, log), min, max, effectiveStep, log);
  }, [value, min, max, log, effectiveStep]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    (e.currentTarget.querySelector('[role="slider"]') as HTMLElement | null)?.focus();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    onChange(valueFromClientX(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    onChange(valueFromClientX(e.clientX));
  };
  const endDrag = (e: PointerEvent<HTMLDivElement>): void => {
    if (!dragging) return;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onCommit?.(latest.current);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    let next: number | null = null;
    const stepBy = (n: number): number => (log ? snap(value * 10 ** (n * effectiveStep), min, max, effectiveStep, log) : snap(value + n * effectiveStep, min, max, effectiveStep, log));
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp': next = stepBy(e.shiftKey ? 10 : 1); break;
      case 'ArrowLeft':
      case 'ArrowDown': next = stepBy(e.shiftKey ? -10 : -1); break;
      case 'PageUp': next = stepBy(10); break;
      case 'PageDown': next = stepBy(-10); break;
      case 'Home': next = min; break;
      case 'End': next = max; break;
      default: return;
    }
    e.preventDefault();
    onChange(next);
    onCommit?.(next);
  };

  const t = Math.min(1, Math.max(0, toT(value, min, max, log)));
  const refT = referenceValue != null && Number.isFinite(referenceValue) ? Math.min(1, Math.max(0, toT(referenceValue, min, max, log))) : null;
  const readout = Number.isFinite(value) ? format(value) : 'Unknown';
  const valueText = unit ? `${readout} ${unit}` : readout;
  const atReference = refT != null && referenceValue != null && Math.abs(value - referenceValue) <= Math.abs(referenceValue) * 1e-9;

  return (
    <div className={cx('cx-slider', disabled && 'cx-slider--disabled', dragging && 'cx-slider--dragging', className)}>
      <div className="cx-slider__head">
        <span id={`${id}-label`} className="cx-slider__label">
          {label}
        </span>
        <span className="cx-slider__readout">
          <span className="cx-num">{readout}</span>
          {unit && <span className="cx-slider__unit">{unit}</span>}
          {trailing}
        </span>
      </div>
      <div
        ref={trackRef}
        className="cx-slider__hit"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        <div className="cx-slider__rail">
          <span className="cx-slider__fill" style={{ transform: `scaleX(${t})` }} />
          {log && logTicks(min, max).map(k => (
            <span key={k.t} className={cx('cx-slider__tick', k.major && 'cx-slider__tick--major')} style={{ left: `${k.t * 100}%` }} aria-hidden="true" />
          ))}
          {marks?.map(m => (
            <span key={m.value} className="cx-slider__mark" style={{ left: `${toT(m.value, min, max, log) * 100}%` }} aria-hidden="true" />
          ))}
          {refT != null && (
            <span className={cx('cx-slider__ref', atReference && 'cx-slider__ref--match')} style={{ left: `${refT * 100}%` }} aria-hidden="true">
              <span className="cx-slider__ref-label">{referenceLabel}</span>
            </span>
          )}
        </div>
        <div
          role="slider"
          tabIndex={disabled ? -1 : 0}
          aria-labelledby={ariaLabel ? undefined : `${id}-label`}
          aria-label={ariaLabel}
          aria-valuemin={min}
          aria-valuemax={max}
          aria-valuenow={Number.isFinite(value) ? value : undefined}
          aria-valuetext={refT != null && referenceValue != null ? `${valueText}; ${referenceLabel.toLowerCase()} value ${format(referenceValue)}${unit ? ` ${unit}` : ''}` : valueText}
          aria-disabled={disabled || undefined}
          className="cx-slider__thumb"
          style={{ left: `${t * 100}%` }}
          onKeyDown={onKeyDown}
        />
      </div>
    </div>
  );
}
