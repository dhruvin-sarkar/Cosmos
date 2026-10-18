import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { computePlacement, type Align, type Side } from '../lib/position';
import { cx, useOutsidePointerDown } from '../lib/dom';

export interface PopoverProps {
  open: boolean;
  onClose(): void;
  /** Element the popover is placed against (also excluded from outside-click dismissal). */
  anchorRef: RefObject<HTMLElement | null>;
  /** Accessible name of the dialog. */
  label: string;
  side?: Side;
  align?: Align;
  className?: string;
  children: ReactNode;
}

/**
 * Non-modal anchored panel (role="dialog"). Escape and outside clicks close it and return focus to the anchor.
 * Placement flips and clamps into the viewport.
 */
export function Popover({ open, onClose, anchorRef, label, side = 'bottom', align = 'end', className, children }: PopoverProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

  useOutsidePointerDown([ref, anchorRef], () => onClose(), open);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = (): void => {
      const a = anchorRef.current;
      const p = ref.current;
      if (!a || !p) return;
      const r = a.getBoundingClientRect();
      const placed = computePlacement(r, { width: p.offsetWidth, height: p.offsetHeight }, side, align, 8, { width: window.innerWidth, height: window.innerHeight }, 12);
      setPos({ x: placed.x, y: placed.y });
    };
    place();
    const first = ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, [tabindex="0"]');
    first?.focus({ preventScroll: true });
    window.addEventListener('resize', place);
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(place) : null;
    if (ref.current) ro?.observe(ref.current);
    return () => {
      window.removeEventListener('resize', place);
      ro?.disconnect();
    };
  }, [open, side, align, anchorRef]);

  if (!open) return null;
  return createPortal(
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cx('cx-popover', className)}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
      onKeyDown={e => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
          anchorRef.current?.focus();
        }
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
