import {
  cloneElement, isValidElement, useCallback, useEffect, useId, useLayoutEffect, useRef, useState,
  type FocusEvent, type KeyboardEvent, type MutableRefObject, type PointerEvent, type ReactElement, type ReactNode, type Ref,
} from 'react';
import { createPortal } from 'react-dom';
import { computePlacement, type Align, type Side } from '../lib/position';
import { Kbd } from './Kbd';

/** After one tooltip closes, the next opens instantly for a short while (scanning a toolbar). */
let lastHiddenAt = 0;
const WARM_WINDOW_MS = 600;

export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>): (node: T | null) => void {
  return node => {
    for (const r of refs) {
      if (typeof r === 'function') r(node);
      else if (r) (r as MutableRefObject<T | null>).current = node;
    }
  };
}

export interface TooltipProps {
  content: ReactNode;
  /** Shortcut shown as key caps after the content, e.g. "L" or "Ctrl+K". */
  shortcut?: string | string[];
  side?: Side;
  align?: Align;
  delayMs?: number;
  disabled?: boolean;
  /** A single element that accepts ref, pointer and focus handlers (usually a button). */
  children: ReactElement;
}

interface TriggerProps {
  ref?: Ref<HTMLElement>;
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onPointerDown?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
}

/**
 * Hover/focus tooltip. Opens after a delay on mouse hover, immediately on keyboard focus, never on touch.
 * Rendered in a portal so it is never clipped; flips to stay in the viewport.
 */
export function Tooltip({ content, shortcut, side = 'top', align = 'center', delayMs = 450, disabled, children }: TooltipProps) {
  const id = useId();
  const anchorRef = useRef<HTMLElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number; side: Side } | null>(null);

  const clear = (): void => {
    if (timer.current !== undefined) window.clearTimeout(timer.current);
    timer.current = undefined;
  };
  const show = useCallback((immediate: boolean) => {
    clear();
    if (immediate || performance.now() - lastHiddenAt < WARM_WINDOW_MS) setOpen(true);
    else timer.current = window.setTimeout(() => setOpen(true), delayMs);
  }, [delayMs]);
  const hide = useCallback(() => {
    clear();
    setOpen(prev => {
      if (prev) lastHiddenAt = performance.now();
      return false;
    });
  }, []);

  useEffect(() => () => clear(), []);
  useEffect(() => {
    if (disabled) hide();
  }, [disabled, hide]);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const place = (): void => {
      const a = anchorRef.current;
      const t = tipRef.current;
      if (!a || !t) return;
      const r = a.getBoundingClientRect();
      setPos(computePlacement(r, { width: t.offsetWidth, height: t.offsetHeight }, side, align, 8, { width: window.innerWidth, height: window.innerHeight }));
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side, align, content]);

  if (!isValidElement(children)) return children;
  const childProps = children.props as TriggerProps;

  const trigger = cloneElement(children as ReactElement<TriggerProps>, {
    ref: mergeRefs(anchorRef, childProps.ref),
    'aria-describedby': open ? [childProps['aria-describedby'], id].filter(Boolean).join(' ') : childProps['aria-describedby'],
    onPointerEnter: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerEnter?.(e);
      if (!disabled && e.pointerType !== 'touch') show(false);
    },
    onPointerLeave: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerLeave?.(e);
      hide();
    },
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      childProps.onPointerDown?.(e);
      hide();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      childProps.onFocus?.(e);
      let keyboard = false;
      try {
        keyboard = e.currentTarget.matches(':focus-visible');
      } catch {
        keyboard = false;
      }
      if (!disabled && keyboard) show(true);
    },
    onBlur: (e: FocusEvent<HTMLElement>) => {
      childProps.onBlur?.(e);
      hide();
    },
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      childProps.onKeyDown?.(e);
      if (e.key === 'Escape' && open) hide();
    },
  });

  return (
    <>
      {trigger}
      {open && !disabled &&
        createPortal(
          <div
            ref={tipRef}
            id={id}
            role="tooltip"
            className="cx-tooltip"
            data-side={pos?.side ?? side}
            style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, visibility: pos ? 'visible' : 'hidden' }}
          >
            <span className="cx-tooltip__content">{content}</span>
            {shortcut && <Kbd keys={shortcut} size="sm" className="cx-tooltip__kbd" />}
          </div>,
          document.body,
        )}
    </>
  );
}
