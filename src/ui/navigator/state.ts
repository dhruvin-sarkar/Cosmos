/**
 * Navigator-local state and shared hooks. The open flag lives here (not in the app store) so the navigator needs no
 * shared-state changes; it is a tiny external store read with useSyncExternalStore.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { Entity } from '../../core/entity';
import type { CosmosState } from '../../state/store';
import { useCosmos, useRegistry, useRegistryVersion } from '../hooks';
import { buildSystemTree, candidateEntities, type SystemTree } from './tree';
import { peekThumbnail, requestThumbnail } from './thumbnails';

let open = false;
const listeners = new Set<() => void>();

export function isNavigatorOpen(): boolean {
  return open;
}

export function setNavigatorOpen(next: boolean): void {
  if (next === open) return;
  open = next;
  for (const l of [...listeners]) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useNavigatorOpen(): boolean {
  return useSyncExternalStore(subscribe, isNavigatorOpen, isNavigatorOpen);
}

const DAY_MS = 86_400_000;

/** The navigator tree, rebuilt when the registry changes (and at most once per simulated day). */
export function useSystemTree(): SystemTree {
  const registry = useRegistry();
  const version = useRegistryVersion();
  const dayMs = useCosmos(s => Math.floor(s.time.simTimeMs / DAY_MS) * DAY_MS);
  return useMemo(() => buildSystemTree(candidateEntities(registry), dayMs), [registry, version, dayMs]);
}

/** Where navigation steps from: the travel target while flying (so quick key presses chain), else the focus. */
export function navFocusId(s: CosmosState): string | null {
  return (s.camera.traveling ? s.camera.travelTargetId : null) ?? s.camera.focusId ?? s.selection.id;
}

export function useNavFocusId(): string | null {
  return useCosmos(navFocusId);
}

/** Thumbnail data URL for an entity (null while loading or unavailable). */
export function useThumbnail(entity: Entity | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(() => (entity ? peekThumbnail(entity) ?? null : null));
  useEffect(() => {
    if (!entity) {
      setUrl(null);
      return;
    }
    const ready = peekThumbnail(entity);
    if (ready !== undefined) {
      setUrl(ready);
      return;
    }
    let live = true;
    void requestThumbnail(entity).then(u => {
      if (live) setUrl(u);
    });
    return () => {
      live = false;
    };
  }, [entity]);
  return url;
}
