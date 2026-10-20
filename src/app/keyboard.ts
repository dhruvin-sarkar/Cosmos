/**
 * Global keyboard shortcuts (docs/ARCHITECTURE.md §13), mapped onto AppCommands and UI flags in the store.
 * Ignored while the user types in a text field. Camera movement keys (WASD/QE, arrows) belong to the
 * camera rig and are not handled here.
 */
import type { SpectralBandId } from '../core/types';
import type { CosmosStore, CosmosState } from '../state/store';
import type { AppCommands } from './commands';

/** Signed time-rate ladder for [ and ] (simulation seconds per real second; |rate| ≤ 10⁷ per §7). */
export const TIME_RATE_STEPS: readonly number[] = (() => {
  const up = [1, 10, 60, 600, 3_600, 21_600, 86_400, 604_800, 2_629_800, 10_000_000];
  return [...up.slice().reverse().map(r => -r), ...up];
})();

export const DEFAULT_TOUR_ID = 'golden-journey';

const SPECTRAL_KEYS: Record<string, SpectralBandId> = { '1': 'visible', '2': 'near-infrared', '3': 'x-ray', '4': 'cmb' };

/** Next rate on the ladder in direction `dir` (+1 faster/forward, −1 slower/backward). */
export function stepTimeRate(rate: number, dir: 1 | -1): number {
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < TIME_RATE_STEPS.length; i++) {
    const d = Math.abs(Math.log10(Math.abs(TIME_RATE_STEPS[i]) + 1e-9) - Math.log10(Math.abs(rate) + 1e-9)) +
      (Math.sign(TIME_RATE_STEPS[i]) === Math.sign(rate || 1) ? 0 : 100);
    if (d < best) {
      best = d;
      nearest = i;
    }
  }
  const next = Math.max(0, Math.min(TIME_RATE_STEPS.length - 1, nearest + dir));
  return TIME_RATE_STEPS[next];
}

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag === 'INPUT') {
    const type = (el as HTMLInputElement).type;
    return !['button', 'checkbox', 'radio', 'range', 'submit', 'reset', 'color'].includes(type);
  }
  return false;
}

export interface KeyboardOptions {
  store: CosmosStore;
  commands: AppCommands;
  target?: Window | HTMLElement;
  tourId?: string;
}

/** Install the shortcuts; returns an uninstaller. */
export function installKeyboardShortcuts(opts: KeyboardOptions): () => void {
  const { store, commands } = opts;
  const target = opts.target ?? window;
  const setUi = (patch: Partial<CosmosState['ui']>): void => store.setState(s => ({ ui: { ...s.ui, ...patch } }));

  /** Esc closes the topmost thing: overlays first, then the lab, then the selection. */
  const escape = (): boolean => {
    const s = store.getState();
    const ui = s.ui;
    if (ui.searchOpen) return setUi({ searchOpen: false }), true;
    if (ui.helpOpen) return setUi({ helpOpen: false }), true;
    if (ui.settingsOpen) return setUi({ settingsOpen: false }), true;
    if (ui.sourcesOpen) return setUi({ sourcesOpen: false }), true;
    if (ui.debugOpen) return setUi({ debugOpen: false }), true;
    if (s.lab.active) return commands.closeLab(), true;
    if (s.selection.id || ui.inspectorOpen) return commands.select(null), true;
    return false;
  };

  const onKeyDown = (event: Event): void => {
    const e = event as KeyboardEvent;
    if (e.defaultPrevented) return;
    const typing = isTypingTarget(e.target);
    const key = e.key;

    if ((e.ctrlKey || e.metaKey) && !e.altKey && key.toLowerCase() === 'k') {
      e.preventDefault();
      setUi({ searchOpen: !store.getState().ui.searchOpen });
      return;
    }
    if (key === 'Escape') {
      if (escape()) e.preventDefault();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey || e.altKey) return;

    let handled = true;
    switch (key) {
      case '/':
        setUi({ searchOpen: true });
        break;
      case '?':
        setUi({ helpOpen: !store.getState().ui.helpOpen });
        break;
      case '`':
        setUi({ debugOpen: !store.getState().ui.debugOpen });
        break;
      case ' ':
        if (e.repeat) break;
        commands.togglePause();
        break;
      // [ and ] step between moons (src/ui/navigator/keys.ts); time rate lives on , and .
      case ',':
        commands.setTimeRate(stepTimeRate(store.getState().time.rate, -1));
        break;
      case '.':
        commands.setTimeRate(stepTimeRate(store.getState().time.rate, 1));
        break;
      case 'Backspace':
        commands.back();
        break;
      default: {
        const lower = key.length === 1 ? key.toLowerCase() : key;
        if (e.repeat) break;
        if (lower === 'h') commands.home();
        else if (lower === 'f') {
          const id = store.getState().selection.id;
          if (id) void commands.focus(id);
        } else if (lower === 'g') {
          const tour = store.getState().tour;
          if (tour.activeId) commands.tourNext();
          else commands.startTour(opts.tourId ?? DEFAULT_TOUR_ID);
        } else if (lower === 'l') commands.toggleOverlay('labels');
        else if (lower === 'o') commands.toggleOverlay('orbits');
        else if (SPECTRAL_KEYS[key]) commands.setSpectralBand(SPECTRAL_KEYS[key]);
        else handled = false;
      }
    }
    if (handled) e.preventDefault();
  };

  target.addEventListener('keydown', onKeyDown);
  return () => target.removeEventListener('keydown', onKeyDown);
}
