import { useId, type ReactNode } from 'react';
import { cx } from '../lib/dom';

export interface ToggleProps {
  checked: boolean;
  onCheckedChange(checked: boolean): void;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** On/off switch. The whole row is the hit target (≥ 40 px tall). */
export function Toggle({ checked, onCheckedChange, label, description, disabled, className }: ToggleProps) {
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      className={cx('cx-toggle', checked && 'cx-toggle--on', className)}
      onClick={() => onCheckedChange(!checked)}
    >
      <span className="cx-toggle__text">
        <span id={`${id}-label`} className="cx-toggle__label">
          {label}
        </span>
        {description && (
          <span id={`${id}-desc`} className="cx-toggle__desc">
            {description}
          </span>
        )}
      </span>
      <span className="cx-toggle__track" aria-hidden="true">
        <span className="cx-toggle__knob" />
      </span>
    </button>
  );
}
