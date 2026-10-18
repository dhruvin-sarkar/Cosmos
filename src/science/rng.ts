/**
 * Seeded pseudo-random numbers for reproducible Monte Carlo: the same seed yields the same samples on every
 * machine and every run, so an uncertainty band shown at the exhibition can be regenerated exactly.
 *
 * Generator: xoshiro128** 1.1 (Blackman & Vigna 2018, "Scrambled linear pseudorandom number generators",
 * ACM TOMS 47(4) 2021), 128-bit state, period 2^128 − 1, seeded through splitmix32 so that nearby integer seeds
 * give uncorrelated streams. Floats use 53 random bits. Not cryptographic.
 */

export interface Rng {
  /** Uniform float in [0, 1) with 53 bits of randomness. */
  next(): number;
  /** Uniform unsigned 32-bit integer. */
  nextUint32(): number;
  /** Uniform float in [min, max). */
  uniform(min: number, max: number): number;
  /** Uniform integer in [0, n) (n ≥ 1). */
  int(n: number): number;
  /** Gaussian deviate (Box–Muller; the second value of each pair is cached). */
  normal(mean?: number, sigma?: number): number;
  /** Log-uniform float in [min, max) (min > 0): uniform in log space, for quantities spanning decades. */
  logUniform(min: number, max: number): number;
  /** Copy of the 4-word internal state (plus normal cache) for exact replay. */
  getState(): RngState;
  setState(state: RngState): void;
  /** Independent copy continuing from the current state. */
  clone(): Rng;
}

export interface RngState {
  words: [number, number, number, number];
  /** Cached second Box–Muller deviate, or null. */
  spareNormal: number | null;
}

const TWO_POW_53 = 9_007_199_254_740_992;

/** 32-bit string hash (FNV-1a) so seeds can be human-readable, e.g. 'dart-preset'. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** splitmix32 step: returns [nextState, output]. Used only for seeding. */
function splitmix32(state: number): [number, number] {
  const s = (state + 0x9e3779b9) | 0;
  let t = s ^ (s >>> 16);
  t = Math.imul(t, 0x21f0aaad);
  t ^= t >>> 15;
  t = Math.imul(t, 0x735a2d97);
  t ^= t >>> 15;
  return [s, t >>> 0];
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}

class Xoshiro128ss implements Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;
  private spare: number | null = null;

  constructor(words: readonly [number, number, number, number]) {
    this.load(words);
  }

  private load(w: readonly [number, number, number, number]): void {
    this.s0 = w[0] >>> 0;
    this.s1 = w[1] >>> 0;
    this.s2 = w[2] >>> 0;
    this.s3 = w[3] >>> 0;
    // The all-zero state is the generator's only fixed point.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  nextUint32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  next(): number {
    const hi = this.nextUint32() >>> 5; // 27 bits
    const lo = this.nextUint32() >>> 6; // 26 bits
    return (hi * 67_108_864 + lo) / TWO_POW_53;
  }

  uniform(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  int(n: number): number {
    if (!(n >= 1)) return NaN;
    return Math.floor(this.next() * Math.floor(n));
  }

  normal(mean = 0, sigma = 1): number {
    if (this.spare !== null) {
      const z = this.spare;
      this.spare = null;
      return mean + sigma * z;
    }
    // 1 − next() ∈ (0, 1] avoids log(0).
    const u1 = 1 - this.next();
    const u2 = this.next();
    const r = Math.sqrt(-2 * Math.log(u1));
    const theta = 2 * Math.PI * u2;
    this.spare = r * Math.sin(theta);
    return mean + sigma * r * Math.cos(theta);
  }

  logUniform(min: number, max: number): number {
    if (!(min > 0) || !(max >= min)) return NaN;
    return Math.exp(Math.log(min) + (Math.log(max) - Math.log(min)) * this.next());
  }

  getState(): RngState {
    return { words: [this.s0 >>> 0, this.s1 >>> 0, this.s2 >>> 0, this.s3 >>> 0], spareNormal: this.spare };
  }

  setState(state: RngState): void {
    this.load(state.words);
    this.spare = state.spareNormal;
  }

  clone(): Rng {
    const c = new Xoshiro128ss([this.s0, this.s1, this.s2, this.s3]);
    c.spare = this.spare;
    return c;
  }
}

/** Create a seeded generator. String seeds are hashed with {@link hashSeed}. */
export function createRng(seed: number | string): Rng {
  let s = typeof seed === 'string' ? hashSeed(seed) : Math.floor(Number.isFinite(seed) ? seed : 0) >>> 0;
  const words: [number, number, number, number] = [0, 0, 0, 0];
  for (let i = 0; i < 4; i++) {
    const [next, out] = splitmix32(s);
    s = next;
    words[i] = out;
  }
  return new Xoshiro128ss(words);
}

/** Generator starting from an explicit raw state (used by known-answer tests against the reference C code). */
export function createRngFromState(words: readonly [number, number, number, number]): Rng {
  return new Xoshiro128ss(words);
}

// ── Distributions for uncertain inputs ────────────────────────────────────────────────────

/** Input-uncertainty description used by the labs' Monte Carlo bands. */
export type Distribution =
  | { kind: 'fixed'; value: number }
  | { kind: 'uniform'; min: number; max: number }
  | { kind: 'loguniform'; min: number; max: number }
  /** Gaussian, optionally truncated to [min, max] by rejection (falls back to clamping after 64 rejections). */
  | { kind: 'normal'; mean: number; sigma: number; min?: number; max?: number }
  /** Gaussian in log10 space, e.g. { log10Mean: −1, log10Sigma: 0.3 }. */
  | { kind: 'lognormal'; log10Mean: number; log10Sigma: number };

export function sampleDistribution(rng: Rng, d: Distribution): number {
  switch (d.kind) {
    case 'fixed':
      return d.value;
    case 'uniform':
      return rng.uniform(d.min, d.max);
    case 'loguniform':
      return rng.logUniform(d.min, d.max);
    case 'normal': {
      const lo = d.min ?? -Infinity;
      const hi = d.max ?? Infinity;
      for (let i = 0; i < 64; i++) {
        const x = rng.normal(d.mean, d.sigma);
        if (x >= lo && x <= hi) return x;
      }
      return Math.min(hi, Math.max(lo, d.mean));
    }
    case 'lognormal':
      return Math.pow(10, rng.normal(d.log10Mean, d.log10Sigma));
  }
}

/** Nominal (central) value of a distribution — what the "Real"/deterministic computation uses. */
export function distributionCenter(d: Distribution): number {
  switch (d.kind) {
    case 'fixed':
      return d.value;
    case 'uniform':
      return 0.5 * (d.min + d.max);
    case 'loguniform':
      return Math.sqrt(d.min * d.max);
    case 'normal':
      return d.mean;
    case 'lognormal':
      return Math.pow(10, d.log10Mean);
  }
}

/**
 * Isotropic unit vector: uniform z and azimuth (Archimedes' hat-box theorem). Writes x,y,z at `offset`.
 * Used for fragment-cloud ejection directions.
 */
export function sampleUnitSphere(rng: Rng, out: { [i: number]: number }, offset = 0): void {
  const z = 2 * rng.next() - 1;
  const phi = 2 * Math.PI * rng.next();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  out[offset] = r * Math.cos(phi);
  out[offset + 1] = r * Math.sin(phi);
  out[offset + 2] = z;
}

