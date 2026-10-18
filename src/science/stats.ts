/**
 * Small statistics helpers for Monte Carlo uncertainty bands (quantiles, summaries, a seeded runner).
 */
import { createRng, type Rng } from './rng';

export interface SampleSummary {
  /** Finite samples used for the statistics. */
  count: number;
  /** Samples that were NaN/±Infinity (excluded; a non-zero value means some inputs were outside a model's domain). */
  invalid: number;
  mean: number;
  /** Sample standard deviation (n − 1). */
  std: number;
  min: number;
  max: number;
  /** 5th / 16th / 50th / 84th / 95th percentiles (16–84 ≈ ±1σ, 5–95 = 90% interval). */
  p05: number;
  p16: number;
  p50: number;
  p84: number;
  p95: number;
}

/** Quantile of ascending-sorted data with linear interpolation (Hyndman & Fan type 7, as numpy/R default). */
export function quantileSorted(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length;
  if (n === 0 || !(q >= 0 && q <= 1)) return NaN;
  if (n === 1) return sorted[0];
  const h = (n - 1) * q;
  const lo = Math.floor(h);
  const hi = Math.min(n - 1, lo + 1);
  return sorted[lo] + (h - lo) * (sorted[hi] - sorted[lo]);
}

export function summarizeSamples(samples: ArrayLike<number>): SampleSummary {
  const finite = new Float64Array(samples.length);
  let n = 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) {
    const x = samples[i];
    if (Number.isFinite(x)) {
      finite[n++] = x;
      sum += x;
    }
  }
  const sorted = finite.subarray(0, n).sort();
  const mean = n > 0 ? sum / n : NaN;
  let ss = 0;
  for (let i = 0; i < n; i++) ss += (sorted[i] - mean) ** 2;
  return {
    count: n,
    invalid: samples.length - n,
    mean,
    std: n > 1 ? Math.sqrt(ss / (n - 1)) : NaN,
    min: n > 0 ? sorted[0] : NaN,
    max: n > 0 ? sorted[n - 1] : NaN,
    p05: quantileSorted(sorted, 0.05),
    p16: quantileSorted(sorted, 0.16),
    p50: quantileSorted(sorted, 0.5),
    p84: quantileSorted(sorted, 0.84),
    p95: quantileSorted(sorted, 0.95),
  };
}

export interface MonteCarloResult {
  samples: Float64Array;
  summary: SampleSummary;
  seed: number | string;
}

/**
 * Run `count` independent trials of `trial(rng, i)` with a seeded generator. Deterministic for a given seed,
 * count and trial function — the basis for reproducible uncertainty bands.
 */
export function runMonteCarlo(
  count: number,
  seed: number | string,
  trial: (rng: Rng, index: number) => number,
  out?: Float64Array,
): MonteCarloResult {
  const n = Math.max(0, Math.floor(count));
  const samples = out && out.length >= n ? out.subarray(0, n) : new Float64Array(n);
  const rng = createRng(seed);
  for (let i = 0; i < n; i++) samples[i] = trial(rng, i);
  return { samples, summary: summarizeSamples(samples), seed };
}
