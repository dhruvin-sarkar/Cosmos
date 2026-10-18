import { useRef, type KeyboardEvent } from 'react';
import type { IconComponent } from '../icons';
import { cx } from '../lib/dom';

export interface SegmentOption<T extends string> {
  value: T;
  label: string;
  icon?: IconComponent;
  disabled?: boolean;
}

export interface SegmentedControlProps<T extends string> {
  value: T;
  onChange(value: T): void;
  options: ReadonlyArray<SegmentOption<T>>;
  /** Accessible group name. */
  label: string;
  size?: 'sm' | 'md';
  className?: string;
}

/** Single-choice radio group styled as segments. Arrow keys move and select (roving tab stop). */
export function SegmentedControl<T extends string>({ value, onChange, options, label, size = 'md', className }: SegmentedControlProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const enabled = options.filter(o => !o.disabled);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const delta = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    const jump = e.key === 'Home' ? 'first' : e.key === 'End' ? 'last' : null;
    if (!delta && !jump) return;
    e.preventDefault();
    const idx = enabled.findIndex(o => o.value === value);
    let next = jump === 'first' ? 0 : jump === 'last' ? enabled.length - 1 : (idx + delta + enabled.length) % enabled.length;
    if (next < 0) next = 0;
    const opt = enabled[next];
    if (!opt) return;
    onChange(opt.value);
    refs.current[options.indexOf(opt)]?.focus();
  };

  return (
    <div role="radiogroup" aria-label={label} className={cx('cx-seg', `cx-seg--${size}`, className)} onKeyDown={onKeyDown}>
      {options.map((o, i) => {
        const selected = o.value === value;
        const Icon = o.icon;
        return (
          <button
            key={o.value}
            ref={el => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={o.disabled}
            className={cx('cx-seg__item', selected && 'cx-seg__item--on')}
            onClick={() => onChange(o.value)}
          >
            {Icon && <Icon size={15} aria-hidden />}
            <span>{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
