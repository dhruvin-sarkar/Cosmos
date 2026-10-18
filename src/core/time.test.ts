import { describe, expect, it, vi } from 'vitest';
import { createTimeController, DEFAULT_TIME_BOUNDS, MAX_TIME_RATE } from './time';

const T0 = Date.UTC(2026, 9, 16, 12, 0, 0);

describe('createTimeController', () => {
  it('starts at the given time, rate 1, running', () => {
    const t = createTimeController({ startMs: T0 });
    expect(t.nowMs).toBe(T0);
    expect(t.rate).toBe(1);
    expect(t.paused).toBe(false);
    expect(t.bounds).toEqual(DEFAULT_TIME_BOUNDS);
  });

  it('defaults to the injected wall clock', () => {
    const t = createTimeController({ now: () => T0 + 5 });
    expect(t.nowMs).toBe(T0 + 5);
  });

  it('advances by rate × real seconds and reports simulated seconds', () => {
    const t = createTimeController({ startMs: T0 });
    expect(t.tick(0.5)).toBeCloseTo(0.5, 12);
    expect(t.nowMs).toBe(T0 + 500);
    t.setRate(86_400);
    expect(t.tick(0.016)).toBeCloseTo(1382.4, 6);
    expect(t.nowMs).toBeCloseTo(T0 + 500 + 1_382_400, 3);
  });

  it('runs backwards with a negative rate', () => {
    const t = createTimeController({ startMs: T0 });
    t.setRate(-3600);
    expect(t.tick(1)).toBeCloseTo(-3600, 9);
    expect(t.nowMs).toBe(T0 - 3_600_000);
  });

  it('does not advance while paused, or for invalid dt', () => {
    const t = createTimeController({ startMs: T0 });
    t.pause();
    expect(t.tick(1)).toBe(0);
    expect(t.nowMs).toBe(T0);
    t.resume();
    expect(t.tick(-1)).toBe(0);
    expect(t.tick(Number.NaN)).toBe(0);
    expect(t.tick(Number.POSITIVE_INFINITY)).toBe(0);
    expect(t.nowMs).toBe(T0);
    t.togglePause();
    expect(t.paused).toBe(true);
    t.togglePause();
    expect(t.paused).toBe(false);
  });

  it('clamps the rate to ±1e10 and ignores non-finite rates', () => {
    const t = createTimeController({ startMs: T0 });
    t.setRate(1e12);
    expect(t.rate).toBe(MAX_TIME_RATE);
    t.setRate(-1e12);
    expect(t.rate).toBe(-MAX_TIME_RATE);
    t.setRate(Number.NaN);
    expect(t.rate).toBe(-MAX_TIME_RATE);
  });

  it('clamps jumps to the bounds and reports a notice', () => {
    const onClamp = vi.fn();
    const t = createTimeController({ startMs: T0, onClamp });
    t.jumpTo(Date.UTC(2050, 0, 1));
    expect(t.nowMs).toBe(Date.UTC(2050, 0, 1));
    expect(onClamp).not.toHaveBeenCalled();
    t.jumpTo(Date.UTC(2500, 0, 1));
    expect(t.nowMs).toBe(DEFAULT_TIME_BOUNDS.maxMs);
    expect(onClamp).toHaveBeenCalledTimes(1);
    expect(onClamp.mock.calls[0][0]).toMatch(/1900-01-01 – 2100-01-01/);
    t.jumpTo(Date.UTC(1000, 0, 1));
    expect(t.nowMs).toBe(DEFAULT_TIME_BOUNDS.minMs);
    t.jumpTo(Number.NaN);
    expect(t.nowMs).toBe(DEFAULT_TIME_BOUNDS.minMs);
  });

  it('pauses exactly at a bound when the running clock reaches it', () => {
    const onClamp = vi.fn();
    const bounds = { minMs: T0 - 10_000, maxMs: T0 + 10_000 };
    const t = createTimeController({ startMs: T0, bounds, onClamp });
    t.setRate(4);
    expect(t.tick(1)).toBeCloseTo(4, 9);
    const dtSim = t.tick(10);
    expect(dtSim).toBeCloseTo(6, 9);
    expect(t.nowMs).toBe(bounds.maxMs);
    expect(t.paused).toBe(true);
    expect(onClamp).toHaveBeenCalledTimes(1);
    expect(t.tick(1)).toBe(0);
    t.setRate(-100);
    t.resume();
    t.tick(1);
    expect(t.nowMs).toBe(bounds.minMs);
    expect(t.paused).toBe(true);
  });

  it('toNow returns to the wall clock at rate 1 and resumes', () => {
    let wall = T0;
    const t = createTimeController({ startMs: T0 - 1e9, now: () => wall });
    t.setRate(500);
    t.pause();
    wall = T0 + 42;
    t.toNow();
    expect(t.nowMs).toBe(T0 + 42);
    expect(t.rate).toBe(1);
    expect(t.paused).toBe(false);
  });

  it('notifies listeners on discrete changes only', () => {
    const t = createTimeController({ startMs: T0 });
    const listener = vi.fn();
    const off = t.onChange(listener);
    t.tick(1);
    expect(listener).not.toHaveBeenCalled();
    t.setRate(10);
    t.setRate(10);
    t.pause();
    t.pause();
    t.jumpTo(T0);
    expect(listener).toHaveBeenCalledTimes(3);
    off();
    t.resume();
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it('rejects inverted bounds', () => {
    expect(() => createTimeController({ bounds: { minMs: 10, maxMs: 5 } })).toThrow(RangeError);
  });
});
