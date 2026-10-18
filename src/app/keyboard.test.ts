import { describe, expect, it } from 'vitest';
import { stepTimeRate, TIME_RATE_STEPS } from './keyboard';

describe('stepTimeRate', () => {
  it('steps up and down the ladder', () => {
    expect(stepTimeRate(1, 1)).toBe(10);
    expect(stepTimeRate(10, -1)).toBe(1);
    expect(stepTimeRate(86_400, 1)).toBe(604_800);
  });
  it('crosses from forward to reverse through ±1', () => {
    expect(stepTimeRate(1, -1)).toBe(-1);
    expect(stepTimeRate(-1, 1)).toBe(1);
    expect(stepTimeRate(-1, -1)).toBe(-10);
  });
  it('snaps arbitrary rates to the nearest rung and clamps at the ends', () => {
    expect(stepTimeRate(50, 1)).toBe(600);
    expect(stepTimeRate(1e7, 1)).toBe(1e7);
    expect(stepTimeRate(-1e7, -1)).toBe(-1e7);
    expect(Math.max(...TIME_RATE_STEPS.map(Math.abs))).toBeLessThanOrEqual(1e7);
  });
  it('treats a zero rate as forward', () => {
    expect(stepTimeRate(0, 1)).toBe(10);
  });
});
