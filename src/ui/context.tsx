import { createContext, useContext, type ReactNode } from 'react';
import type { AppContextValue } from '../app/commands';
import type { PerfSnapshot } from '../core/types';

/**
 * Optional engine queries the HUD uses when the integrator provides them. Every member is optional: the UI
 * degrades gracefully (shows "Unknown" or hides the row) when a query is missing. All are polled at ≤ 2 Hz.
 */
export interface CosmosUiExtensions {
  /** Distance from the camera to an entity's center at the current frame, meters (null when unknown). */
  cameraDistanceM?(entityId: string): number | null;
  /** Latest performance snapshot (debug overlay). Falls back to `window.__cosmos.perf()`. */
  perf?(): PerfSnapshot | null;
  /** Current engine frame number (debug overlay). */
  frame?(): number | null;
  /** Ids of the bodies orbiting a system primary (body strip). Without it the strip knows only the Solar System. */
  systemBodies?(systemId: string): string[];
  /**
   * Projected screen bounds (CSS px) of an entity this frame, or null when off-screen / unknown. Polled by the
   * selection reticle with requestAnimationFrame, so it must be allocation-free or cheap.
   */
  screenBounds?(entityId: string): { x: number; y: number; width: number; height: number } | null;
  /** Content of a guided-tour step for the tour card. Without it the card shows the chapter number and scale. */
  tourStep?(tourId: string, step: number): TourStepContent | null;
}

export interface TourStepContent {
  title: string;
  /** One to three short sentences. */
  narration: string;
  /** View scale of the chapter (its order of magnitude indexes the chapter, e.g. "10⁷ m"). */
  scaleLog10?: number;
  /** Presenter hint shown in small type, e.g. "Drag to orbit Earth". */
  hint?: string;
}

const AppContext = createContext<AppContextValue | null>(null);
const ExtensionsContext = createContext<CosmosUiExtensions>({});

export interface AppContextProviderProps {
  value: AppContextValue;
  extensions?: CosmosUiExtensions;
  children: ReactNode;
}

const NO_EXTENSIONS: CosmosUiExtensions = {};

export function AppContextProvider({ value, extensions, children }: AppContextProviderProps) {
  return (
    <AppContext.Provider value={value}>
      <ExtensionsContext.Provider value={extensions ?? NO_EXTENSIONS}>{children}</ExtensionsContext.Provider>
    </AppContext.Provider>
  );
}

/** The store, commands, registry and manifest accessor. Throws when used outside <AppContextProvider>. */
export function useAppContext(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('Cosmos UI: useAppContext() must be used inside <AppContextProvider>.');
  return ctx;
}

export function useUiExtensions(): CosmosUiExtensions {
  return useContext(ExtensionsContext);
}
