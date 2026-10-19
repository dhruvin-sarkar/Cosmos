/**
 * Sky-events sandbox: boots the full app (src/main.tsx) and mounts <SkyEvents /> in a small bar pinned under the
 * top bar, exactly as the TopBar mount would. Automation: window.__skyEvents.{open(), show(id), list()}.
 */
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { AppCommands, AppContextValue } from '../src/app/commands';
import type { EntityRegistry } from '../src/core/entity';
import type { CosmosStore } from '../src/state/store';
import { AppContextProvider } from '../src/ui/context';
import { SkyEvents } from '../src/ui/events/SkyEvents';
import { getEventsUi, patchEventsUi } from '../src/ui/events/state';
import { showEvent } from '../src/ui/events/showMe';
import { computeSkyEvents } from '../src/science/events';

async function main(): Promise<void> {
  for (let i = 0; i < 200 && !window.__cosmos; i++) await new Promise(r => setTimeout(r, 50));
  const h = window.__cosmos;
  if (!h) throw new Error('sky-events sandbox: app handle missing');
  await h.ready;
  const value: AppContextValue = {
    store: h.store as CosmosStore, commands: h.commands as AppCommands, registry: h.registry as EntityRegistry, manifest: () => null,
  };
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;top:calc(var(--topbar-h) + 4px);right:24px;z-index:60;display:flex;background:var(--faceplate);border:1px solid var(--hairline);';
  document.body.appendChild(host);
  createRoot(host).render(createElement(AppContextProvider, { value, children: createElement(SkyEvents) }));
  (window as unknown as { __skyEvents: unknown }).__skyEvents = {
    open: () => patchEventsUi({ open: true, anchorMs: Math.floor(value.store.getState().time.simTimeMs / 86_400_000) * 86_400_000 }),
    list: () => computeSkyEvents({ startMs: value.store.getState().time.simTimeMs, observer: getEventsUi().observer }).map(e => e.id),
    show: async (id: string) => {
      const ev = computeSkyEvents({ startMs: Date.UTC(2026, 9, 19), observer: getEventsUi().observer }).find(e => e.id === id);
      if (!ev) throw new Error(`no event ${id}`);
      patchEventsUi({ open: false, shown: ev });
      await showEvent(ev, { commands: value.commands, registry: value.registry, store: value.store }, true);
    },
  };
}

void main();
