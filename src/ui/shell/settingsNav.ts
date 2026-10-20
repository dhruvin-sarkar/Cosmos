import type { CosmosStore } from '../../state/store';
import { setUi } from '../hooks';

export type SettingsSection = 'scale' | 'time' | 'quality';

let pending: SettingsSection | null = null;

/** Opens the Settings panel scrolled to one section (the time status chip opens it at Time). */
export function openSettingsAt(store: CosmosStore, section: SettingsSection): void {
  pending = section;
  setUi(store, { settingsOpen: true, sourcesOpen: false, helpOpen: false });
  // Already open: the panel's effect will not re-run on an unchanged flag, so reveal now.
  if (document.querySelector('.cx-settings')) revealPendingSection();
}

/** Scrolls the requested section into view, focuses its heading and flashes it once. Called by the panel on open. */
export function revealPendingSection(): void {
  const section = pending;
  pending = null;
  if (!section) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(`cx-settings-${section}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'auto' });
    el.querySelector<HTMLElement>('.cx-settings__title')?.focus({ preventScroll: true });
    el.classList.remove('is-flash');
    void el.offsetWidth;
    el.classList.add('is-flash');
  });
}
