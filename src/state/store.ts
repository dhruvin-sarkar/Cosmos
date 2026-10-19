/**
 * Application state shared by the engine and the React UI (zustand vanilla store — framework-free).
 *
 * Data flow:
 *  - UI and tours never mutate engine objects directly; they call AppCommands (src/app/commands.ts).
 *  - The engine writes view/time/perf snapshots into the store at a throttled rate (~10 Hz), never per frame.
 *  - React components subscribe with selectors (see src/ui/hooks.ts) so canvas performance is unaffected.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CameraMode, EffectiveQuality, OverlayId, QualityPreset, SpectralBandId } from '../core/types';
import type { LabId } from '../core/entity';
import type { VisualScaleMode } from '../core/visualScale';

export interface Crumb {
  id: string;
  name: string;
}

export interface Notice {
  id: string;
  kind: 'info' | 'warning' | 'error';
  text: string;
  /** Auto-dismiss after this many ms (undefined = sticky). */
  ttlMs?: number;
}

export interface Bookmark {
  id: string;
  name: string;
  /** ISO-8601 creation time. */
  created: string;
  /** Serialized CameraViewState + simulation time. */
  view: unknown;
}

export interface CosmosState {
  boot: {
    phase: 'loading' | 'ready' | 'error';
    /** 0..1 */
    progress: number;
    message: string;
    error: string | null;
    webgl: 'unknown' | 'ok' | 'unsupported';
  };
  selection: { id: string | null };
  hover: { id: string | null; x: number; y: number };
  camera: { mode: CameraMode; focusId: string | null; traveling: boolean; travelTargetId: string | null };
  view: {
    /** Cosmic Ruler scale: log10(visible width in meters). */
    scaleLog10: number;
    focusDistanceM: number;
    /** Context path, e.g. Universe › Local Group › Milky Way › Solar System › Earth. */
    breadcrumb: Crumb[];
    /** Human description of the active reference frame, e.g. "Geocentric inertial (ICRS axes)". */
    frameLabel: string;
  };
  time: { simTimeMs: number; rate: number; paused: boolean };
  overlays: Record<OverlayId, boolean>;
  /**
   * Exhibition scale (default): bodies drawn enlarged for visibility, shrinking to true size near the camera
   * (src/core/visualScale.ts, docs/design/VISUAL_SCALE.md). 'true' = everything at its real size. Change it through
   * setVisualScale() so the legacy 'enlarge-bodies' overlay stays in step.
   */
  visualScale: VisualScaleMode;
  spectral: { band: SpectralBandId };
  quality: { preset: QualityPreset; effective: EffectiveQuality; fps: number };
  lab: { active: LabId | null; params: Record<string, unknown> | null };
  tour: { activeId: string | null; step: number; stepCount: number };
  ui: {
    inspectorOpen: boolean;
    searchOpen: boolean;
    debugOpen: boolean;
    helpOpen: boolean;
    sourcesOpen: boolean;
    settingsOpen: boolean;
    hudHidden: boolean;
    reducedMotion: boolean;
    sound: boolean;
  };
  bookmarks: Bookmark[];
  notices: Notice[];
}

export type CosmosStore = StoreApi<CosmosState>;

export const DEFAULT_OVERLAYS: Record<OverlayId, boolean> = {
  labels: true,
  orbits: true,
  satellites: true,
  debris: true,
  spacecraft: true,
  asteroids: true,
  constellations: false,
  'constellation-boundaries': false,
  'grid-equatorial': false,
  'grid-ecliptic': false,
  'grid-galactic': false,
  'habitable-zones': true,
  'milkyway-procedural': true,
  'scale-markers': true,
  'light-travel': false,
  // Legacy alias of visualScale === 'exhibition' for layers that have not adopted src/core/visualScale.ts yet.
  'enlarge-bodies': true,
};

function prefersReducedMotion(): boolean {
  try {
    return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

export function initialState(): CosmosState {
  return {
    boot: { phase: 'loading', progress: 0, message: 'Starting…', error: null, webgl: 'unknown' },
    selection: { id: null },
    hover: { id: null, x: 0, y: 0 },
    camera: { mode: 'orbit', focusId: 'sol:earth', traveling: false, travelTargetId: null },
    view: { scaleLog10: 7.4, focusDistanceM: 2.5e7, breadcrumb: [], frameLabel: '' },
    time: { simTimeMs: Date.now(), rate: 1, paused: false },
    overlays: { ...DEFAULT_OVERLAYS },
    visualScale: 'exhibition',
    spectral: { band: 'visible' },
    quality: { preset: 'auto', effective: 'balanced', fps: 0 },
    lab: { active: null, params: null },
    tour: { activeId: null, step: 0, stepCount: 0 },
    ui: {
      inspectorOpen: false,
      searchOpen: false,
      debugOpen: false,
      helpOpen: false,
      sourcesOpen: false,
      settingsOpen: false,
      hudHidden: false,
      reducedMotion: prefersReducedMotion(),
      sound: false,
    },
    bookmarks: [],
    notices: [],
  };
}

export function createCosmosStore(overrides?: Partial<CosmosState>): CosmosStore {
  return createStore<CosmosState>()(() => ({ ...initialState(), ...overrides }));
}

let noticeSeq = 0;

/** Push a user-visible notice (e.g. "Live orbital data unavailable — showing snapshot from 2026-10-16"). */
export function pushNotice(store: CosmosStore, notice: Omit<Notice, 'id'>): string {
  const id = `n${++noticeSeq}`;
  store.setState(s => ({ notices: [...s.notices, { ...notice, id }] }));
  return id;
}

export function dismissNotice(store: CosmosStore, id: string): void {
  store.setState(s => ({ notices: s.notices.filter(n => n.id !== id) }));
}

/** Switch Exhibition ⇄ True scale (keeps the legacy 'enlarge-bodies' overlay in step). */
export function setVisualScale(store: CosmosStore, mode: VisualScaleMode): void {
  store.setState(s => ({ visualScale: mode, overlays: { ...s.overlays, 'enlarge-bodies': mode === 'exhibition' } }));
}
