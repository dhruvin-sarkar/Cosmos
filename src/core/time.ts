/**
 * Simulation clock (docs/ARCHITECTURE.md §7).
 *
 * Simulation time is Unix ms (UTC). It advances by `rate × real seconds` each tick, can run backwards,
 * and is confined to the validity range of the time-dependent models (default 1900–2100, the span in
 * which the bundled ephemerides are trustworthy). Leaving the range clamps and reports a notice; the
 * running clock pauses at the boundary instead of silently sticking there.
 */
import type { TimeController } from './types';

export const DEFAULT_TIME_BOUNDS: Readonly<{ minMs: number; maxMs: number }> = Object.freeze({
  minMs: Date.UTC(1900, 0, 1),
  maxMs: Date.UTC(2100, 0, 1),
});

/** |rate| limit, simulation seconds per real second. */
export const MAX_TIME_RATE = 1e10;

export interface TimeControllerOptions {
  /** Initial simulation time, Unix ms (default: wall clock now). */
  startMs?: number;
  bounds?: { minMs: number; maxMs: number };
  /** Receives a user-facing message whenever a jump or the running clock is clamped to the bounds. */
  onClamp?: (message: string) => void;
  /** Wall-clock source, Unix ms (injectable for tests). */
  now?: () => number;
}

/** TimeController plus the engine-facing tick and change notifications. */
export interface SimulationClock extends TimeController {
  /**
   * Advance by `dtRealSec` real seconds. Returns the simulation seconds advanced (0 while paused,
   * negative when running backwards, shortened when a bound was hit).
   */
  tick(dtRealSec: number): number;
  /** Subscribe to discrete changes (rate, pause/resume, jumps) — not called on ordinary ticks. */
  onChange(listener: () => void): () => void;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export function createTimeController(opts: TimeControllerOptions = {}): SimulationClock {
  const wallNow = opts.now ?? Date.now;
  const minMs = opts.bounds?.minMs ?? DEFAULT_TIME_BOUNDS.minMs;
  const maxMs = opts.bounds?.maxMs ?? DEFAULT_TIME_BOUNDS.maxMs;
  if (!(minMs < maxMs)) throw new RangeError(`Invalid time bounds: ${minMs} … ${maxMs}`);
  const bounds = Object.freeze({ minMs, maxMs });
  const listeners = new Set<() => void>();

  const rangeText = `${isoDay(minMs)} – ${isoDay(maxMs)}`;
  const notifyClamp = (message: string): void => opts.onClamp?.(message);
  const emitChange = (): void => {
    for (const l of listeners) {
      try {
        l();
      } catch (err) {
        console.error('[cosmos] time listener threw', err);
      }
    }
  };

  const clampMs = (ms: number): number => Math.min(maxMs, Math.max(minMs, ms));

  let nowMs = clampMs(Number.isFinite(opts.startMs) ? (opts.startMs as number) : wallNow());
  let rate = 1;
  let paused = false;

  const clock: SimulationClock = {
    get nowMs() {
      return nowMs;
    },
    get rate() {
      return rate;
    },
    get paused() {
      return paused;
    },
    bounds,

    setRate(next: number): void {
      if (!Number.isFinite(next)) return;
      const clamped = Math.max(-MAX_TIME_RATE, Math.min(MAX_TIME_RATE, next));
      if (clamped === rate) return;
      rate = clamped;
      emitChange();
    },

    pause(): void {
      if (paused) return;
      paused = true;
      emitChange();
    },

    resume(): void {
      if (!paused) return;
      paused = false;
      emitChange();
    },

    togglePause(): void {
      paused = !paused;
      emitChange();
    },

    jumpTo(ms: number): void {
      if (!Number.isFinite(ms)) return;
      const clamped = clampMs(ms);
      if (clamped !== ms) {
        notifyClamp(`Time is limited to ${rangeText} (validity range of the ephemeris models); showing ${isoDay(clamped)}.`);
      }
      nowMs = clamped;
      emitChange();
    },

    toNow(): void {
      const wall = wallNow();
      nowMs = clampMs(wall);
      if (nowMs !== wall) notifyClamp(`The current date lies outside ${rangeText}; showing ${isoDay(nowMs)}.`);
      rate = 1;
      paused = false;
      emitChange();
    },

    tick(dtRealSec: number): number {
      if (paused || rate === 0 || !(dtRealSec > 0) || !Number.isFinite(dtRealSec)) return 0;
      const target = nowMs + rate * dtRealSec * 1000;
      if (target > maxMs || target < minMs) {
        const edge = target > maxMs ? maxMs : minMs;
        const dtSimSec = (edge - nowMs) / 1000;
        nowMs = edge;
        paused = true;
        notifyClamp(`Reached the ${edge === maxMs ? 'end' : 'start'} of the supported time range (${rangeText}); time paused.`);
        emitChange();
        return dtSimSec;
      }
      const dtSimSec = (target - nowMs) / 1000;
      nowMs = target;
      return dtSimSec;
    },

    onChange(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };

  return clock;
}
