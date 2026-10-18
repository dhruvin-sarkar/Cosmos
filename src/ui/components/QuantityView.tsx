import type { Quantity } from '../../data/provenance';
import { displayQuantity } from '../format';
import { cx } from '../lib/dom';

export interface QuantityViewProps {
  quantity: Quantity | null | undefined;
  /** Re-express in a context-appropriate unit of the same dimension. */
  smart?: boolean;
  sigDigits?: number;
  showUncertainty?: boolean;
  className?: string;
}

/**
 * A measured value: number in tabular figures, uncertainty in secondary ink, unit after a no-break space.
 * A null value reads "Unknown" in tertiary ink (never 0, never blank).
 */
export function QuantityView({ quantity, smart, sigDigits, showUncertainty = true, className }: QuantityViewProps) {
  const d = displayQuantity(quantity, { smart, sigDigits, showUncertainty });
  if (!d.known) {
    return <span className={cx('cx-q', 'cx-q--unknown', className)}>Unknown</span>;
  }
  if (!d.splittable) {
    return (
      <span className={cx('cx-q', className)} aria-label={d.spoken}>
        <span className="cx-q__v cx-num" aria-hidden="true">{d.text}</span>
      </span>
    );
  }
  return (
    <span className={cx('cx-q', className)} aria-label={d.spoken} data-limit={d.limit ?? undefined}>
      <span aria-hidden="true">
        <span className="cx-q__v cx-num">{d.main}</span>
        {d.uncertainty && <span className="cx-q__u cx-num">{d.uncertainty}</span>}
        {d.unit && <span className="cx-q__unit">{' '}{d.unit}</span>}
      </span>
    </span>
  );
}
