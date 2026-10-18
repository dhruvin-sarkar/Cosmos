/**
 * Typed synchronous event bus (EngineEvents and any other event map).
 *
 * Listener exceptions are caught and logged so one faulty subscriber cannot break the emitter
 * (the frame loop emits 'frame-stats'; a throwing UI listener must not stop rendering).
 */
import type { EventBus } from './types';

type Listener<P> = (payload: P) => void;

export interface DisposableEventBus<E> extends EventBus<E> {
  /** Remove every listener (engine teardown). */
  clear(): void;
  /** Number of listeners currently subscribed to `type` (debug overlay / tests). */
  listenerCount(type: keyof E): number;
}

export function createEventBus<E>(): DisposableEventBus<E> {
  const listeners = new Map<keyof E, Set<Listener<never>>>();

  return {
    on<K extends keyof E>(type: K, listener: Listener<E[K]>): () => void {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      const entry = listener as Listener<never>;
      set.add(entry);
      return () => {
        set.delete(entry);
      };
    },

    emit<K extends keyof E>(type: K, payload: E[K]): void {
      const set = listeners.get(type);
      if (!set || set.size === 0) return;
      for (const entry of set) {
        try {
          (entry as Listener<E[K]>)(payload);
        } catch (err) {
          console.error(`[cosmos] '${String(type)}' listener threw`, err);
        }
      }
    },

    clear(): void {
      listeners.clear();
    },

    listenerCount(type: keyof E): number {
      return listeners.get(type)?.size ?? 0;
    },
  };
}
