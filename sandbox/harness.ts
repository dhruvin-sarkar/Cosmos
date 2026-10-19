/**
 * Sandbox harness: boots the real engine + AppCommands for an isolated module WITHOUT the React UI.
 * A tiny text HUD shows fps, scale and focus; `window.__cosmos` is published (tools/shot.mjs waits on it).
 *
 *   import { bootSandbox } from './harness';
 *   const { commands } = bootSandbox({ layers: [myLayer], entities: [myEntity], focusId: 'sol:earth' });
 */
import '../src/core/installIdmSafeFetch';
import '@fontsource-variable/inter/opsz.css';
import '@fontsource-variable/bodoni-moda/opsz-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '../src/styles/tokens.css';
import type { Entity, EntityProvider } from '../src/core/entity';
import type { Layer, OverlayId } from '../src/core/types';
import { createCosmos, type CosmosApp } from '../src/app/createCosmos';
import { installKeyboardShortcuts } from '../src/app/keyboard';
import { createCosmosStore, DEFAULT_OVERLAYS } from '../src/state/store';
import { installIdmSafeFetch } from '../src/core/idmSafeFetch';
installIdmSafeFetch();

export interface SandboxOptions {
  container?: HTMLElement;
  layers: Layer[];
  entities?: Entity[];
  providers?: EntityProvider[];
  focusId?: string;
  timeMs?: number;
  overlays?: Partial<Record<OverlayId, boolean>>;
  /** Show the text HUD (default true). */
  hud?: boolean;
}

export type SandboxApp = Pick<CosmosApp, 'engine' | 'store' | 'registry' | 'commands' | 'tours' | 'ready' | 'dispose'>;

function ensureContainer(): HTMLElement {
  document.documentElement.style.cssText = 'height:100%;background:#000;';
  document.body.style.cssText = 'margin:0;height:100%;overflow:hidden;background:#000;color:#e8e8e8;';
  const el = document.createElement('div');
  el.id = 'cosmos-sandbox';
  el.style.cssText = 'position:fixed;inset:0;';
  document.body.appendChild(el);
  return el;
}

function formatScale(scaleLog10: number): string {
  const exp = Math.floor(scaleLog10);
  const mant = Math.pow(10, scaleLog10 - exp);
  return `${mant.toFixed(2)} × 10^${exp} m`;
}

function mountHud(app: SandboxApp, container: HTMLElement): () => void {
  const hud = document.createElement('div');
  hud.style.cssText =
    'position:absolute;left:12px;bottom:12px;z-index:5;pointer-events:none;font:12.5px/1.45 var(--font-mono, monospace);' +
    'color:oklch(0.8 0 0);text-shadow:0 0 3px #000,0 0 8px #000;white-space:pre;';
  container.appendChild(hud);
  let last = '';
  const render = (): void => {
    const s = app.store.getState();
    const focus = s.camera.focusId ? (app.registry.get(s.camera.focusId)?.name ?? s.camera.focusId) : '—';
    const text =
      `fps ${s.quality.fps}  ${s.quality.effective}\n` +
      `scale ${formatScale(s.view.scaleLog10)}  (10^${s.view.scaleLog10.toFixed(2)})\n` +
      `focus ${focus}${s.selection.id ? `  selected ${s.selection.id}` : ''}\n` +
      `${new Date(s.time.simTimeMs).toISOString().slice(0, 19)}Z  ×${s.time.rate}${s.time.paused ? ' paused' : ''}`;
    if (text !== last) {
      last = text;
      hud.textContent = text;
    }
  };
  const unsub = app.store.subscribe(render);
  render();
  return () => {
    unsub();
    hud.remove();
  };
}

export function bootSandbox(opts: SandboxOptions): SandboxApp {
  const container = opts.container ?? ensureContainer();
  const store = createCosmosStore({ overlays: { ...DEFAULT_OVERLAYS, ...opts.overlays } });
  const app = createCosmos({
    container,
    store,
    initialFocusId: opts.focusId,
    timeMs: opts.timeMs,
    domains: [
      {
        id: 'sandbox',
        create: () => ({ layers: opts.layers, entities: opts.entities ?? [], providers: opts.providers ?? [] }),
      },
    ],
  });
  const removeKeys = installKeyboardShortcuts({ store: app.store, commands: app.commands });
  const removeHud = opts.hud === false ? () => undefined : mountHud(app, container);
  const dispose = app.dispose;
  app.dispose = () => {
    removeKeys();
    removeHud();
    dispose();
  };
  return app;
}
