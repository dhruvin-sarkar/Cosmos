/**
 * React bindings for the Cosmos store, commands, registry and manifest.
 *
 * Rule: components subscribe to narrow, slowly-changing slices (the engine writes view/time snapshots at
 * ~10 Hz). Never subscribe to per-frame data; poll with `useInterval` when a value is only needed at 1–2 Hz.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { AppCommands } from '../app/commands';
import type { Entity, EntityRegistry } from '../core/entity';
import type { DataManifest, FactSheet } from '../data/provenance';
import type { CosmosState, CosmosStore } from '../state/store';
import { useAppContext } from './context';

/** Subscribe to a slice of the app state. The selector must return a stable value (primitive or store ref). */
export function useCosmos<T>(selector: (state: CosmosState) => T): T {
  return useStore(useAppContext().store, selector);
}

/** Like useCosmos, for selectors that build a new object/array: re-renders only when its members change. */
export function useCosmosShallow<T>(selector: (state: CosmosState) => T): T {
  return useStore(useAppContext().store, useShallow(selector));
}

export function useStoreApi(): CosmosStore {
  return useAppContext().store;
}

export function useCommands(): AppCommands {
  return useAppContext().commands;
}

export function useRegistry(): EntityRegistry {
  return useAppContext().registry;
}

/** Shallow-merge a patch into `state.ui` (UI-only flags have no command; they live in the store). */
export function setUi(store: CosmosStore, patch: Partial<CosmosState['ui']>): void {
  store.setState(s => ({ ui: { ...s.ui, ...patch } }));
}

export function useReducedMotion(): boolean {
  return useCosmos(s => s.ui.reducedMotion);
}

function readManifest(accessor: () => DataManifest | null): DataManifest | null {
  try {
    return accessor();
  } catch {
    return null;
  }
}

/** The data-source registry, or null until it has loaded (re-checked once per second until present). */
export function useManifest(): DataManifest | null {
  const { manifest } = useAppContext();
  const phase = useCosmos(s => s.boot.phase);
  const [value, setValue] = useState<DataManifest | null>(() => readManifest(manifest));
  useEffect(() => {
    const now = readManifest(manifest);
    if (now) {
      setValue(now);
      return;
    }
    const id = window.setInterval(() => {
      const next = readManifest(manifest);
      if (next) {
        setValue(next);
        window.clearInterval(id);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [manifest, phase]);
  return value;
}

/** Registry lookups never throw into React: a misbehaving provider just yields "not found". */
export function safeGetEntity(registry: EntityRegistry, id: string): Entity | undefined {
  try {
    return registry.get(id);
  } catch {
    return undefined;
  }
}

/** Increments whenever the registry gains entities or providers (lets lookups re-resolve). */
export function useRegistryVersion(): number {
  const registry = useRegistry();
  const [version, setVersion] = useState(0);
  useEffect(() => registry.onChange(() => setVersion(v => v + 1)), [registry]);
  return version;
}

/** Resolve an entity by id; re-resolves when the registry gains entities or providers. */
export function useEntity(id: string | null | undefined): Entity | undefined {
  const registry = useRegistry();
  const version = useRegistryVersion();
  // `version` participates so late-registered entities resolve.
  return useMemo(() => (id ? safeGetEntity(registry, id) : undefined), [registry, id, version]);
}

export type FactSheetState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; sheet: FactSheet }
  | { status: 'error'; error: string };

const factCache = new WeakMap<Entity, Promise<FactSheet> | FactSheet>();

export function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function isThenable<T>(v: T | Promise<T>): v is Promise<T> {
  return typeof (v as { then?: unknown } | null)?.then === 'function';
}

/**
 * Load an entity's fact sheet (sync or async), cached per entity object. Failed loads are evicted from the
 * cache; bump `retryToken` to try again.
 */
export function useFactSheet(entity: Entity | undefined, retryToken = 0): FactSheetState {
  const [state, setState] = useState<FactSheetState>({ status: 'idle' });
  useEffect(() => {
    if (!entity) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    let result = factCache.get(entity);
    if (!result) {
      try {
        result = entity.facts();
      } catch (e) {
        setState({ status: 'error', error: errorText(e) });
        return;
      }
      factCache.set(entity, result);
    }
    if (isThenable(result)) {
      setState({ status: 'loading' });
      result.then(
        sheet => {
          if (!cancelled) setState({ status: 'ready', sheet });
        },
        e => {
          factCache.delete(entity);
          if (!cancelled) setState({ status: 'error', error: errorText(e) });
        },
      );
    } else {
      setState({ status: 'ready', sheet: result });
    }
    return () => {
      cancelled = true;
    };
  }, [entity, retryToken]);
  return state;
}

/** Re-render every `ms` while `enabled` (returns a tick counter). For 1–2 Hz polling only. */
export function useInterval(ms: number, enabled = true): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => setTick(t => t + 1), ms);
    return () => window.clearInterval(id);
  }, [ms, enabled]);
  return tick;
}

/** Keep the latest value in a ref (for stable callbacks that need fresh props). */
export function useLatest<T>(value: T): { readonly current: T } {
  const ref = useRef(value);
  ref.current = value;
  return ref;
}
