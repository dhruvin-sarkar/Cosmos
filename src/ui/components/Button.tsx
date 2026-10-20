import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react';
import type { IconComponent } from '../icons';
import { cx } from '../lib/dom';
import { spokenShortcut } from './Kbd';
import { Spinner } from './Spinner';
import { Tooltip } from './Tooltip';
import type { Align, Side } from '../lib/position';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: IconComponent;
  iconEnd?: IconComponent;
  /** Shows a spinner, sets aria-busy and blocks clicks. */
  loading?: boolean;
  /** Toggle-button state (aria-pressed). */
  pressed?: boolean;
  /** Stretch to the container width. */
  block?: boolean;
  children?: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

export function Button({
  variant = 'secondary', size = 'md', icon: Icon, iconEnd: IconEnd, loading, pressed, block, className, children,
  disabled, type = 'button', ref, onClick, ...rest
}: ButtonProps) {
  return (
    <button
      ref={ref}
      type={type}
      className={cx('cx-btn', 'cursor-target', `cx-btn--${variant}`, `cx-btn--${size}`, block && 'cx-btn--block', className)}
      aria-pressed={pressed}
      aria-busy={loading || undefined}
      disabled={disabled}
      onClick={loading ? undefined : onClick}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} label="" /> : Icon ? <Icon size={size === 'sm' ? 15 : 17} aria-hidden /> : null}
      {children != null && <span className="cx-btn__label">{children}</span>}
      {IconEnd && <IconEnd size={size === 'sm' ? 14 : 16} aria-hidden className="cx-btn__icon-end" />}
    </button>
  );
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  /** Accessible name and default tooltip text. */
  label: string;
  icon: IconComponent;
  /** Shown as key caps in the tooltip and announced with the label. */
  shortcut?: string | string[];
  /** Richer tooltip content (defaults to `label`). */
  tooltip?: ReactNode;
  tooltipSide?: Side;
  tooltipAlign?: Align;
  variant?: 'ghost' | 'secondary' | 'primary' | 'quiet';
  size?: ButtonSize;
  pressed?: boolean;
  /** Small status dot in the corner (e.g. a non-default state). */
  indicator?: boolean;
  ref?: Ref<HTMLButtonElement>;
}

export function IconButton({
  label, icon: Icon, shortcut, tooltip, tooltipSide = 'bottom', tooltipAlign = 'center', variant = 'ghost', size = 'md',
  pressed, indicator, className, type = 'button', ref, ...rest
}: IconButtonProps) {
  const firstShortcut = Array.isArray(shortcut) ? shortcut[0] : shortcut;
  return (
    <Tooltip content={tooltip ?? label} shortcut={shortcut} side={tooltipSide} align={tooltipAlign}>
      <button
        ref={ref}
        type={type}
        className={cx('cx-icon-btn', 'cursor-target', `cx-icon-btn--${variant}`, `cx-icon-btn--${size}`, className)}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={firstShortcut ? spokenShortcut(firstShortcut) : undefined}
        {...rest}
      >
        <Icon size={size === 'sm' ? 16 : 18} aria-hidden />
        {indicator && <span className="cx-icon-btn__dot" aria-hidden="true" />}
      </button>
    </Tooltip>
  );
}
