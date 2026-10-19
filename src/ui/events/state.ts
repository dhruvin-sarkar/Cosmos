/**
 * Sky-events panel state: open flag, visitor location and the event being shown. Kept local (tiny external store read
 * with useSyncExternalStore) so the panel needs no shared-store changes. The location persists in localStorage.
 */
import { useSyncExternalStore } from 'react';
import type { VisualScaleMode } from '../../core/visualScale';
import { DUBAI, type SkyEvent, type SkyObserver } from '../../science/events';

export const OBSERVER_PRESETS: SkyObserver[] = [
  DUBAI,
  { name: 'Abu Dhabi', latDeg: 24.4539, lonDeg: 54.3773, heightM: 5, timeZone: 'Asia/Dubai' },
  { name: 'Sharjah', latDeg: 25.3463, lonDeg: 55.4209, heightM: 5, timeZone: 'Asia/Dubai' },
  { name: 'Riyadh', latDeg: 24.7136, lonDeg: 46.6753, heightM: 612, timeZone: 'Asia/Riyadh' },
  { name: 'Cairo', latDeg: 30.0444, lonDeg: 31.2357, heightM: 23, timeZone: 'Africa/Cairo' },
  { name: 'Mumbai', latDeg: 19.076, lonDeg: 72.8777, heightM: 14, timeZone: 'Asia/Kolkata' },
  { name: 'London', latDeg: 51.5072, lonDeg: -0.1276, heightM: 11, timeZone: 'Europe/London' },
  { name: 'New York', latDeg: 40.7128, lonDeg: -74.006, heightM: 10, timeZone: 'America/New_York' },
  { name: 'Sydney', latDeg: -33.8688, lonDeg: 151.2093, heightM: 3, timeZone: 'Australia/Sydney' },
];

const STORAGE_KEY = 'cosmos.events.observer';

interface EventsUiState {
  open: boolean;
  observer: SkyObserver;
  /** Event currently shown by "Show me" (drives the caption card). */
  shown: SkyEvent | null;
  /** Start of the listed window (app time when the list was built), UTC ms; null until first opened. */
  anchorMs: number | null;
  /** Visual-scale mode to restore when the caption closes (eclipse views switch to true scale), or null. */
  restoreScale: VisualScaleMode | null;
}

function loadObserver(): SkyObserver {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return DUBAI;
    const o = JSON.parse(raw) as Partial<SkyObserver>;
    if (typeof o.latDeg === 'number' && typeof o.lonDeg === 'number' && Math.abs(o.latDeg) <= 90 && Math.abs(o.lonDeg) <= 180) {
      return { name: String(o.name ?? 'Custom'), latDeg: o.latDeg, lonDeg: o.lonDeg, heightM: Number(o.heightM ?? 0) || 0, timeZone: typeof o.timeZone === 'string' ? o.timeZone : null };
    }
  } catch { /* ignore corrupt storage */ }
  return DUBAI;
}

let state: EventsUiState = { open: false, observer: loadObserver(), shown: null, anchorMs: null, restoreScale: null };
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of [...listeners]) l();
}

export function patchEventsUi(patch: Partial<EventsUiState>): void {
  state = { ...state, ...patch };
  if (patch.observer) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(patch.observer)); } catch { /* storage unavailable */ }
  }
  emit();
}

export function getEventsUi(): EventsUiState {
  return state;
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useEventsUi(): EventsUiState {
  return useSyncExternalStore(subscribe, getEventsUi, getEventsUi);
}
