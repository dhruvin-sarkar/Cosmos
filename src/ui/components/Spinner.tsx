import { cx } from '../lib/dom';

export interface SpinnerProps {
  size?: number;
  /** Accessible status text; pass "" when a parent already announces the busy state. */
  label?: string;
  className?: string;
}

export function Spinner({ size = 16, label = 'Loading', className }: SpinnerProps) {
  return (
    <span className={cx('cx-spinner', className)} style={{ width: size, height: size }} role={label ? 'status' : undefined} aria-label={label || undefined} aria-hidden={label ? undefined : true}>
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true">
        <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" strokeOpacity="0.22" strokeWidth="1.5" />
        <path d="M8 1.75a6.25 6.25 0 0 1 6.25 6.25" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </span>
  );
}

export interface ProgressProps {
  /** 0..1; omit for an indeterminate bar. */
  value?: number;
  label: string;
  className?: string;
}

/** Hairline progress bar. */
export function Progress({ value, label, className }: ProgressProps) {
  const determinate = value != null && Number.isFinite(value);
  const pct = determinate ? Math.round(Math.min(1, Math.max(0, value)) * 100) : undefined;
  return (
    <div
      className={cx('cx-progress', !determinate && 'cx-progress--indeterminate', className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={determinate ? 0 : undefined}
      aria-valuemax={determinate ? 100 : undefined}
      aria-valuenow={pct}
    >
      <span className="cx-progress__fill" style={determinate ? { transform: `scaleX(${(pct ?? 0) / 100})` } : undefined} />
    </div>
  );
}

export interface SkeletonProps {
  /** Number of text lines. */
  lines?: number;
  className?: string;
}

/** Placeholder lines while content loads (shimmer is disabled under reduced motion). */
export function Skeleton({ lines = 3, className }: SkeletonProps) {
  return (
    <div className={cx('cx-skeleton', className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="cx-skeleton__line" style={{ width: `${[92, 76, 84, 58, 70][i % 5]}%` }} />
      ))}
    </div>
  );
}
