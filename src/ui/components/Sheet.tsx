import { useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cx, useFocusTrap, usePresence } from '../lib/dom';
import { IconButton } from './Button';

export interface SheetProps {
  open: boolean;
  onClose(): void;
  /** Visible title (Instrument voice) and accessible name. */
  title: ReactNode;
  ariaLabel?: string;
  side?: 'left' | 'right' | 'bottom' | 'center';
  /** Modal sheets trap focus and dim the universe; non-modal drawers leave the scene interactive. */
  modal?: boolean;
  width?: number | string;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}

/** Faceplate drawer / dialog. Escape closes; modal sheets trap focus and restore it on close. */
export function Sheet({ open, onClose, title, ariaLabel, side = 'right', modal = false, width, actions, className, children }: SheetProps) {
  const { mounted, visible } = usePresence(open, 220);
  const ref = useRef<HTMLElement | null>(null);
  useFocusTrap(ref, open && modal, ref);
  if (!mounted) return null;
  return (
    <>
      {modal && <div className={cx('cx-sheet-scrim', visible && 'is-visible')} onPointerDown={onClose} aria-hidden="true" />}
      <section
        ref={ref}
        role="dialog"
        aria-modal={modal || undefined}
        aria-label={ariaLabel ?? (typeof title === 'string' ? title : undefined)}
        className={cx('cx-sheet', `cx-sheet--${side}`, visible && 'is-visible', className)}
        style={width != null ? { width } : undefined}
        tabIndex={-1}
        onKeyDown={e => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            onClose();
          }
        }}
      >
        <header className="cx-sheet__head">
          <h2 className="cx-sheet__title">{title}</h2>
          <div className="cx-sheet__actions">
            {actions}
            <IconButton label="Close" icon={X} shortcut="Escape" onClick={onClose} />
          </div>
        </header>
        <div className="cx-sheet__body">{children}</div>
      </section>
    </>
  );
}
