import { describe, expect, it } from 'vitest';
import { rateInWords, stepRate } from './timeRate';

describe('time rate ladder', () => {
  it('steps through nice rates in both directions', () => {
    expect(stepRate(1, 1)).toBe(60);
    expect(stepRate(60, -1)).toBe(1);
    expect(stepRate(1, -1)).toBe(-1);
    expect(stepRate(-1, -1)).toBe(-60);
    expect(stepRate(5000, 1)).toBe(86_400);
  });
  it('reads the rate in words', () => {
    expect(rateInWords(86_400)).toBe('1 day per second');
    expect(rateInWords(-86_400)).toBe('1 day per second, backwards');
    expect(rateInWords(1)).toBe('Real time');
    expect(rateInWords(3, true)).toBe('Paused');
    expect(rateInWords(10)).toBe('10 s per second');
  });
});
