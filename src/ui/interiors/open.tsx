/**
 * Mounts the interior cutaway as a self-contained React root over the app (no shared-file wiring beyond the
 * entry buttons). The engine's render loop is paused while the cutaway is open (via the published debug/automation
 * handle, window.__cosmos.engine) and resumed on close; focus returns to the control that opened it.
 */
import { createRoot, type Root } from 'react-dom/client';
import { InteriorsOverlay, type InteriorsOverlayProps } from './InteriorsOverlay';
import './interiors.css';

interface EngineLike {
  start?(): void;
  stop?(): void;
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let restoreFocus: HTMLElement | null = null;
let pausedEngine: EngineLike | null = null;

/** Blocks the app's global shortcuts while the dialog is open (keys outside the dialog never reach the app). */
function guard(e: KeyboardEvent): void {
  if (!host || host.contains(e.target as Node)) return;
  e.stopPropagation();
  if (e.key === 'Escape') {
    e.preventDefault();
    closeInterior();
  } else {
    host.querySelector<HTMLElement>('#cx-int-title')?.focus();
  }
}

export function isInteriorOpen(): boolean {
  return root != null;
}

export type OpenInteriorOptions = Pick<InteriorsOverlayProps, 'initialCompare' | 'initialMode' | 'initialLayer'>;

/** Opens (or switches) the cutaway for an entity id ('sol:earth') or body key ('earth'). */
export function openInterior(entityId: string, options: OpenInteriorOptions = {}): void {
  if (!host) {
    restoreFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    host = document.createElement('div');
    host.className = 'cx-int-host';
    document.body.appendChild(host);
    root = createRoot(host);
    window.addEventListener('keydown', guard, true);
    const engine = (window.__cosmos?.engine ?? null) as EngineLike | null;
    if (engine && typeof engine.stop === 'function' && typeof engine.start === 'function') {
      engine.stop();
      pausedEngine = engine;
    }
  }
  root?.render(<InteriorsOverlay key={entityId} entityId={entityId} onClose={closeInterior} {...options} />);
}

export function closeInterior(): void {
  if (!host) return;
  window.removeEventListener('keydown', guard, true);
  const r = root;
  const h = host;
  root = null;
  host = null;
  r?.unmount();
  h.remove();
  pausedEngine?.start?.();
  pausedEngine = null;
  restoreFocus?.focus?.();
  restoreFocus = null;
}
