import { describe, expect, it } from 'vitest';
import { compactRate, isLive } from './timeRate';

describe('time status chip', () => {
  const now = Date.UTC(2026, 9, 20, 12, 0, 0);
  it('is live only at real time, unpaused, within two minutes of the wall clock', () => {
    expect(isLive(now + 30_000, 1, false, now)).toBe(true);
    expect(isLive(now, 1, true, now)).toBe(false);
    expect(isLive(now, 60, false, now)).toBe(false);
    expect(isLive(now, -1, false, now)).toBe(false);
    expect(isLive(now - 3 * 60_000, 1, false, now)).toBe(false);
  });
  it('shortens the rate for the chip', () => {
    expect(compactRate(86_400)).toBe('1 day/s');
    expect(compactRate(-3_600)).toBe('1 hour/s reversed');
    expect(compactRate(1)).toBe('Real time');
  });
});
