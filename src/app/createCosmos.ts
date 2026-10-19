/**
 * Composition root (docs/ARCHITECTURE.md §3): creates the store, registry, engine and domains, implements
 * AppCommands and tours, and publishes the debug handle. The only module that imports every domain.
 *
 * Adding a domain is one line in DOMAINS: each domain module exports `create<X>Domain(ctx)` returning
 * `{ layers, providers?, entities? }`.
 */
import type { Entity, EntityProvider, LabId } from '../core/entity';
import type { CameraMode, CameraViewState, Layer, OverlayId, QualityPreset, SpectralBandId, TravelOptions } from '../core/types';
import type { DataManifest } from '../data/provenance';
import { createEngine, type Engine } from '../core/engine';
import { createRegistry, type CosmosRegistry } from '../core/registry';
import { exposeDebugHandle } from '../core/perf';
import { createSearchIndex } from '../data/search';
import { loadManifestDetailed } from '../data/manifest';
import {
  createCosmosStore,
  DEFAULT_OVERLAYS,
  pushNotice,
  type Bookmark,
  type CosmosStore,
} from '../state/store';
import type { AppCommands } from './commands';
import { createTourRunner, GOLDEN_JOURNEY_PREVIEW, SOLAR_SYSTEM_TOUR, type TourRunner } from './tours';
import { discoverDomains } from '../domains';

export const HOME_FOCUS_ID = 'sol:earth';
const BOOKMARKS_KEY = 'cosmos.bookmarks.v1';

/** What a domain factory receives (a stable subset of the app; engine services arrive in Layer.init). */
export interface DomainContext {
  store: CosmosStore;
  registry: CosmosRegistry;
  manifest(): DataManifest | null;
}

export interface DomainModule {
  layers: Layer[];
  providers?: EntityProvider[];
  entities?: Entity[];
}

export interface DomainDefinition {
  id: string;
  create(ctx: DomainContext): DomainModule;
}

/** Registered domains, in render/registration order (auto-discovered from src/domains/<id>/domain.ts). */
export const DOMAINS: DomainDefinition[] = discoverDomains();

export interface CreateCosmosOptions {
  container: HTMLElement;
  /** Pass a store created beforehand so the UI can render boot/error states even if WebGL fails. */
  store?: CosmosStore;
  initialFocusId?: string;
  timeMs?: number;
  domains?: DomainDefinition[];
}

export interface CosmosApp {
  engine: Engine;
  store: CosmosStore;
  registry: CosmosRegistry;
  commands: AppCommands;
  tours: TourRunner;
  manifest(): DataManifest | null;
  /** Resolves after the first rendered frame (boot.phase is then 'ready'). */
  ready: Promise<void>;
  dispose(): void;
}

interface BookmarkView {
  camera: CameraViewState;
  timeMs: number;
}

function loadBookmarks(): Bookmark[] {
  try {
    const raw = localStorage.getItem(BOOKMARKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed.filter(b => b && typeof b.id === 'string' && typeof b.name === 'string') as Bookmark[]) : [];
  } catch {
    return [];
  }
}

function saveBookmarks(bookmarks: Bookmark[]): void {
  try {
    localStorage.setItem(BOOKMARKS_KEY, JSON.stringify(bookmarks));
  } catch {
    /* storage unavailable (private mode): bookmarks live for this session only */
  }
}

function isBookmarkView(v: unknown): v is BookmarkView {
  const b = v as BookmarkView | null;
  return !!b && typeof b.timeMs === 'number' && !!b.camera && typeof b.camera.anchorId === 'string' && Array.isArray(b.camera.offset);
}

/**
 * Boot the app. Throws WebGLUnsupportedError (after setting store.boot.webgl = 'unsupported') when WebGL 2
 * is unavailable — pass your own `store` to keep rendering the explanatory screen.
 */
export function createCosmos(opts: CreateCosmosOptions): CosmosApp {
  const store = opts.store ?? createCosmosStore();
  const setBoot = (progress: number, message: string): void =>
    store.setState(s => ({ boot: { ...s.boot, progress: Math.max(s.boot.progress, progress), message } }));
  setBoot(0.05, 'Preparing the universe…');

  const registry = createRegistry(createSearchIndex());
  let manifest: DataManifest | null = null;

  const initialFocusId = opts.initialFocusId ?? HOME_FOCUS_ID;
  setBoot(0.15, 'Starting the renderer…');
  let engine: Engine;
  try {
    engine = createEngine({ container: opts.container, store, registry, initialFocusId, timeMs: opts.timeMs, manifest: () => manifest });
  } catch (err) {
    store.setState(s => ({ boot: { ...s.boot, phase: 'error', error: s.boot.error ?? (err instanceof Error ? err.message : String(err)) } }));
    throw err;
  }
  const { rig, time } = engine;

  void loadManifestDetailed(path => engine.services.assets.json(path)).then(result => {
    manifest = result.manifest;
    if (result.status === 'invalid' || result.status === 'error') {
      console.warn('[cosmos] data manifest unavailable:', result.error);
    }
  });

  // ── Domains ───────────────────────────────────────────────────────────────────────────────
  setBoot(0.3, 'Loading the Solar System…');
  const domainCtx: DomainContext = { store, registry, manifest: () => manifest };
  for (const d of opts.domains ?? DOMAINS) {
    try {
      const mod = d.create(domainCtx);
      for (const e of mod.entities ?? []) registry.register(e);
      for (const p of mod.providers ?? []) registry.registerProvider(p);
      for (const layer of mod.layers) engine.addLayer(layer);
    } catch (err) {
      console.error(`[cosmos] domain '${d.id}' failed to start`, err);
      pushNotice(store, { kind: 'warning', text: `The ${d.id} view could not start. The rest of the universe is still available.`, ttlMs: 10000 });
    }
  }

  // ── Commands ──────────────────────────────────────────────────────────────────────────────
  const notFound = (id: string): void => {
    pushNotice(store, { kind: 'info', text: `Couldn't find "${id}" in the loaded data.`, ttlMs: 5000 });
  };

  const persistBookmarks = (bookmarks: Bookmark[]): void => {
    store.setState({ bookmarks });
    saveBookmarks(bookmarks);
  };

  let tours!: TourRunner;

  const commands: AppCommands = {
    select(id: string | null): void {
      if (id !== null && !registry.get(id)) {
        notFound(id);
        return;
      }
      store.setState(s => ({ selection: { id }, ui: { ...s.ui, inspectorOpen: id !== null } }));
      engine.services.events.emit('select', { id });
    },

    async focus(id: string, travel?: TravelOptions): Promise<void> {
      if (!registry.get(id)) {
        notFound(id);
        return;
      }
      commands.select(id);
      await rig.focus(id, travel);
    },

    async travelTo(id: string, travel?: TravelOptions): Promise<void> {
      if (!registry.get(id)) {
        notFound(id);
        return;
      }
      await rig.travelTo(id, travel);
    },

    setScale(scaleLog10: number, o?: { animate?: boolean }): void {
      if (!Number.isFinite(scaleLog10)) return;
      rig.setScale(scaleLog10, { animate: o?.animate });
    },

    setCameraMode(mode: CameraMode): void {
      rig.setMode(mode);
    },

    back(): void {
      rig.back();
    },

    home(): void {
      store.setState(s => ({
        overlays: { ...DEFAULT_OVERLAYS },
        spectral: { band: 'visible' },
        lab: { active: null, params: null },
        selection: { id: null },
        ui: { ...s.ui, inspectorOpen: false },
      }));
      time.toNow();
      if (registry.get(initialFocusId)) void rig.focus(initialFocusId);
    },

    setTimeRate: rate => time.setRate(rate),
    pause: () => time.pause(),
    resume: () => time.resume(),
    togglePause: () => time.togglePause(),
    jumpToTime: ms => time.jumpTo(ms),
    timeToNow: () => time.toNow(),

    setOverlay(id: OverlayId, on: boolean): void {
      store.setState(s => (s.overlays[id] === on ? s : { overlays: { ...s.overlays, [id]: on } }));
    },
    toggleOverlay(id: OverlayId): void {
      store.setState(s => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } }));
    },
    setSpectralBand(band: SpectralBandId): void {
      store.setState(s => (s.spectral.band === band ? s : { spectral: { band } }));
    },
    setQuality(preset: QualityPreset): void {
      store.setState(s => ({ quality: { ...s.quality, preset } }));
    },

    openLab(lab: LabId, params?: Record<string, unknown>): void {
      store.setState({ lab: { active: lab, params: params ?? null } });
    },
    closeLab(): void {
      store.setState({ lab: { active: null, params: null } });
    },

    startTour(tourId: string): void {
      if (!tours.start(tourId)) pushNotice(store, { kind: 'info', text: `Tour "${tourId}" is not available.`, ttlMs: 5000 });
    },
    tourNext: () => tours.next(),
    tourPrev: () => tours.prev(),
    tourRestartStep: () => tours.restartStep(),
    exitTour: () => tours.exit(),

    addBookmark(name?: string): void {
      const view: BookmarkView = { camera: rig.getView(), timeMs: time.nowMs };
      const focusName = view.camera.focusId ? registry.get(view.camera.focusId)?.name : undefined;
      const created = new Date().toISOString();
      const bookmark: Bookmark = {
        id: `bm-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`,
        name: name?.trim() || `${focusName ?? 'View'}, ${new Date(view.timeMs).toISOString().slice(0, 10)}`,
        created,
        view,
      };
      persistBookmarks([...store.getState().bookmarks, bookmark]);
    },
    goToBookmark(id: string): void {
      const b = store.getState().bookmarks.find(x => x.id === id);
      if (!b || !isBookmarkView(b.view)) {
        pushNotice(store, { kind: 'info', text: 'That bookmark could not be opened.', ttlMs: 5000 });
        return;
      }
      time.jumpTo(b.view.timeMs);
      void rig.setView(b.view.camera);
    },
    removeBookmark(id: string): void {
      persistBookmarks(store.getState().bookmarks.filter(b => b.id !== id));
    },
  };

  tours = createTourRunner({ store, commands: () => commands, setView: (v, o) => rig.setView(v, o) });
  tours.register(SOLAR_SYSTEM_TOUR);
  tours.register(GOLDEN_JOURNEY_PREVIEW);
  store.setState({ bookmarks: loadBookmarks() });

  engine.setInteractionHandlers({
    select: id => commands.select(id),
    focus: id => void commands.focus(id),
  });

  // ── Boot ──────────────────────────────────────────────────────────────────────────────────
  setBoot(0.6, 'Rendering the first frame…');
  const ready = engine.ready.then(() => {
    store.setState(s => ({ boot: { ...s.boot, phase: 'ready', progress: 1, message: 'Ready' } }));
  });
  ready.catch(() => undefined);
  engine.start();

  const removeDebug = exposeDebugHandle({
    ready,
    engine,
    store,
    registry,
    commands,
    time,
    perf: () => engine.perf(),
  });

  return {
    engine,
    store,
    registry,
    commands,
    tours,
    manifest: () => manifest,
    ready,
    dispose(): void {
      tours.exit();
      removeDebug();
      engine.dispose();
    },
  };
}
