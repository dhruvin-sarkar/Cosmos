/** React bindings for the exoplanet catalogue (loaded once, in a worker) and the shared explorer/marker view state. */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { exoCatalog, loadExoCatalog, onExoCatalog, type LoadedCatalog } from '../../domains/exoplanets/catalogClient';
import { exoView, subscribeExoView, type ExoViewState } from '../../domains/exoplanets/state';

export function useExoCatalog(): { loaded: LoadedCatalog | null; error: boolean } {
  const [loaded, setLoaded] = useState<LoadedCatalog | null>(() => exoCatalog());
  const [error, setError] = useState(false);
  useEffect(() => {
    if (loaded) return;
    const off = onExoCatalog(setLoaded);
    loadExoCatalog().catch(() => setError(true));
    return off;
  }, [loaded]);
  return { loaded, error };
}

const subscribe = (l: () => void): (() => void) => {
  const off = subscribeExoView(l);
  return () => void off();
};

/** Re-renders on every marker-filter / open-system change. */
export function useExoView(): ExoViewState {
  useSyncExternalStore(subscribe, () => exoView.version, () => exoView.version);
  return exoView;
}
