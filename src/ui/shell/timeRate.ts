import { JULIAN_YEAR_S, SECONDS_PER_DAY } from '../../core/units';
import { formatTimeRate } from '../format';

const MONTH_S = JULIAN_YEAR_S / 12;

/** Rate steps (simulation seconds per real second), positive half; the stepper mirrors them for reverse. */
export const RATE_STEPS: ReadonlyArray<{ rate: number; words: string }> = [
  { rate: 1, words: 'Real time' },
  { rate: 60, words: '1 minute per second' },
  { rate: 3_600, words: '1 hour per second' },
  { rate: SECONDS_PER_DAY, words: '1 day per second' },
  { rate: 7 * SECONDS_PER_DAY, words: '1 week per second' },
  { rate: MONTH_S, words: '1 month per second' },
  { rate: JULIAN_YEAR_S, words: '1 year per second' },
  { rate: 10 * JULIAN_YEAR_S, words: '10 years per second' },
  { rate: 100 * JULIAN_YEAR_S, words: '100 years per second' },
];

/** Signed ladder from −100 yr/s through real time to +100 yr/s. */
export const RATE_LADDER: readonly number[] = [...RATE_STEPS.map(s => -s.rate).reverse(), ...RATE_STEPS.map(s => s.rate)];

/** Next rate on the (ascending) ladder: direction +1 → the first step above `rate`, −1 → the last step below. */
export function stepRate(rate: number, direction: 1 | -1): number {
  const eps = Math.abs(rate) * 1e-9;
  if (direction > 0) return RATE_LADDER.find(r => r > rate + eps) ?? RATE_LADDER[RATE_LADDER.length - 1];
  for (let i = RATE_LADDER.length - 1; i >= 0; i--) if (RATE_LADDER[i] < rate - eps) return RATE_LADDER[i];
  return RATE_LADDER[0];
}

/** The rate in words: "1 day per second", "1 day per second, backwards", "Paused". */
export function rateInWords(rate: number, paused = false): string {
  if (paused) return 'Paused';
  if (!Number.isFinite(rate)) return 'Unknown';
  if (rate === 0) return 'Paused';
  const step = RATE_STEPS.find(s => Math.abs(Math.abs(rate) - s.rate) < s.rate * 1e-6);
  const words = step ? step.words : formatTimeRate(Math.abs(rate)).replace(' / s', ' per second');
  if (rate < 0) return step?.rate === 1 ? 'Real time, backwards' : `${words}, backwards`;
  return words;
}

/** Within two minutes of the wall clock, running forwards at real time: the sky on screen is "now". */
export function isLive(ms: number, rate: number, paused: boolean, now = Date.now()): boolean {
  return !paused && rate === 1 && Math.abs(ms - now) < 120_000;
}

/** Compact rate for the time status chip: "1 day/s", "1 hour/s reversed". */
export function compactRate(rate: number): string {
  return rateInWords(rate).replace(' per second', '/s').replace(', backwards', ' reversed');
}
