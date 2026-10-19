import './core/installIdmSafeFetch';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Vector3 } from 'three';
import './styles/index.css';
import './labs';
import { createCosmos, type CosmosApp as CosmosRuntime } from './app/createCosmos';
import { DEFAULT_TOUR_ID } from './app/keyboard';
import type { AppCommands, AppContextValue } from './app/commands';
import type { ScreenPoint } from './core/types';
import { createRegistry } from './core/registry';
import { renderTransform } from './core/visualScale';
import { createCosmosStore } from './state/store';
import { CosmosApp } from './ui/App';
import type { CosmosUiExtensions } from './ui/context';

const rootEl = document.getElementById('cosmos-root');
if (!rootEl) throw new Error('Missing #cosmos-root');

// The engine canvas lives in its own element so it can be created before React mounts (it needs a sized
// container); React's viewport host adopts it on mount.
const engineHost = document.createElement('div');
engineHost.className = 'cx-engine-host';
engineHost.style.cssText = 'position:absolute;inset:0;';
rootEl.appendChild(engineHost);

const store = createCosmosStore();
let runtime: CosmosRuntime | null = null;
try {
  runtime = createCosmos({ container: engineHost, store });
} catch (e) {
  // WebGL unsupported or engine failure: keep the UI up so the boot screen can explain what happened.
  console.error(e);
  store.setState(s => ({ boot: { ...s.boot, phase: 'error', error: s.boot.webgl === 'unsupported' ? null : e instanceof Error ? e.message : String(e) } }));
}

function noopCommands(): AppCommands {
  const none = (): void => undefined;
  const nonePromise = (): Promise<void> => Promise.resolve();
  return {
    select: none, focus: nonePromise, travelTo: nonePromise, setScale: none, setCameraMode: none, back: none, home: none,
    setTimeRate: none, pause: none, resume: none, togglePause: none, jumpToTime: none, timeToNow: none,
    setOverlay: none, toggleOverlay: none, setSpectralBand: none, setQuality: none, openLab: none, closeLab: none,
    startTour: none, tourNext: none, tourPrev: none, tourRestartStep: none, exitTour: none,
    addBookmark: none, goToBookmark: none, removeBookmark: none,
  };
}

const ctx: AppContextValue = runtime
  ? { store: runtime.store, commands: runtime.commands, registry: runtime.registry, manifest: runtime.manifest }
  : { store, commands: noopCommands(), registry: createRegistry(), manifest: () => null };

function buildExtensions(app: CosmosRuntime): CosmosUiExtensions {
  const world = new Vector3();
  const point: ScreenPoint = { x: 0, y: 0, depthM: 0, visible: false };
  const frame = (): ReturnType<typeof app.engine.frameContext> | null => {
    try {
      return app.engine.frameContext();
    } catch {
      return null;
    }
  };
  return {
    perf: () => app.engine.perf(),
    cameraDistanceM(id) {
      const f = frame();
      const e = app.registry.get(id);
      if (!f || !e) return null;
      e.position(f.timeMs, world);
      const d = world.distanceTo(f.cameraPosition);
      return Number.isFinite(d) ? d : null;
    },
    screenBounds(id) {
      const f = frame();
      const e = app.registry.get(id);
      if (!f || !e) return null;
      // Drawn (exhibition-scale) centre and radius, so the brackets frame what is on screen.
      const k = renderTransform(e, f.timeMs, world);
      f.project(world, point);
      if (!point.visible || point.depthM <= 0) return null;
      const size = e.radiusM ? f.pixelDiameter(e.radiusM * k, point.depthM) : 0;
      return { x: point.x - size / 2, y: point.y - size / 2, width: size, height: size };
    },
    tourStep(tourId, step) {
      const s = app.tours.get(tourId)?.steps[step];
      return s ? { title: s.title, narration: s.narration, scaleLog10: s.scaleLog10 } : null;
    },
  };
}

const extensions = runtime ? buildExtensions(runtime) : undefined;

// React renders into its own node so mounting never clears the engine host.
const uiRoot = document.createElement('div');
uiRoot.style.cssText = 'position:absolute;inset:0;';
rootEl.appendChild(uiRoot);

createRoot(uiRoot).render(
  <StrictMode>
    <CosmosApp
      ctx={ctx}
      extensions={extensions}
      tourId={DEFAULT_TOUR_ID}
      viewportRef={el => {
        if (el && engineHost.parentElement !== el) el.appendChild(engineHost);
      }}
    />
  </StrictMode>,
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => runtime?.dispose());
}
