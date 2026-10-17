/**
 * AppCommands — the single command surface used by the UI, keyboard shortcuts, guided tours and
 * exhibition mode. Implemented in src/app/ by wiring the engine (camera, time, registry) and the store.
 * Keeping this surface small and stable is what lets UI, tours and engine evolve independently.
 */
import type { CameraMode, OverlayId, QualityPreset, SpectralBandId, TravelOptions } from '../core/types';
import type { LabId } from '../core/entity';
import type { EntityRegistry } from '../core/entity';
import type { CosmosStore } from '../state/store';
import type { DataManifest } from '../data/provenance';

export interface AppCommands {
  // ── Selection & navigation ──────────────────────────────────────────────────────────────
  /** Select an entity (opens the inspector) or clear the selection with null. Does not move the camera. */
  select(id: string | null): void;
  /** Travel to an entity and orbit it (also selects it). */
  focus(id: string, opts?: TravelOptions): Promise<void>;
  /** Cinematic travel without changing selection. */
  travelTo(id: string, opts?: TravelOptions): Promise<void>;
  /** Cosmic Ruler: set view scale (log10 meters of visible width). */
  setScale(scaleLog10: number, opts?: { animate?: boolean }): void;
  setCameraMode(mode: CameraMode): void;
  /** Navigate back in camera history. */
  back(): void;
  /** Return to the default home view (Earth, current time, default overlays). Never leaves the user lost. */
  home(): void;

  // ── Time ────────────────────────────────────────────────────────────────────────────────
  setTimeRate(rate: number): void;
  pause(): void;
  resume(): void;
  togglePause(): void;
  jumpToTime(ms: number): void;
  timeToNow(): void;

  // ── Views & overlays ────────────────────────────────────────────────────────────────────
  setOverlay(id: OverlayId, on: boolean): void;
  toggleOverlay(id: OverlayId): void;
  setSpectralBand(band: SpectralBandId): void;
  setQuality(preset: QualityPreset): void;

  // ── Laboratories (Explore Reality ↔ Experiment With Reality) ────────────────────────────
  openLab(lab: LabId, params?: Record<string, unknown>): void;
  closeLab(): void;

  // ── Guided tours / exhibition mode ──────────────────────────────────────────────────────
  startTour(tourId: string): void;
  tourNext(): void;
  tourPrev(): void;
  /** Re-run the current step (presenter recovery after free exploration). */
  tourRestartStep(): void;
  exitTour(): void;

  // ── Bookmarks ───────────────────────────────────────────────────────────────────────────
  addBookmark(name?: string): void;
  goToBookmark(id: string): void;
  removeBookmark(id: string): void;
}

/** Everything the React UI needs, provided via context (see src/ui/context.tsx). */
export interface AppContextValue {
  store: CosmosStore;
  commands: AppCommands;
  registry: EntityRegistry;
  manifest: () => DataManifest | null;
}
