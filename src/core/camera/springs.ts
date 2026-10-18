/**
 * Frame-rate independent smoothing primitives for camera motion.
 *
 * All functions integrate exactly over `dtSec` (no Euler steps), so 1 step of 1/30 s gives the same result as
 * 2 steps of 1/60 s for a constant target — the camera feels identical at 30, 60 or 144 Hz.
 */

export interface Spring1D {
  value: number;
  velocity: number;
}

export function createSpring(value = 0): Spring1D {
  return { value, velocity: 0 };
}

/**
 * Advance a critically damped spring toward `target` (held constant over the step):
 * x'' = −ω²(x − target) − 2ω x'. Closed form: y(t) = (y₀ + (v₀ + ω y₀) t) e^(−ω t).
 * A critically damped spring never overshoots a target it starts at rest from.
 */
export function stepSpring(s: Spring1D, target: number, omega: number, dtSec: number): void {
  if (!(dtSec > 0)) return;
  const y0 = s.value - target;
  const c = s.velocity + omega * y0;
  const e = Math.exp(-omega * dtSec);
  s.value = target + (y0 + c * dtSec) * e;
  s.velocity = (s.velocity - omega * c * dtSec) * e;
}

/** Angular frequency for a smoothing time, Unity `SmoothDamp` convention (ω = 2 / smoothTime). */
export function omegaForSmoothTime(smoothTimeSec: number): number {
  return 2 / Math.max(smoothTimeSec, 1e-4);
}

/** Fraction of the remaining gap an exponential follower closes in `dtSec` (first-order low-pass). */
export function approachFactor(dtSec: number, timeConstantSec: number): number {
  if (!(dtSec > 0)) return 0;
  if (!(timeConstantSec > 0)) return 1;
  return 1 - Math.exp(-dtSec / timeConstantSec);
}

/**
 * Inertial coasting with exponential friction: returns the displacement travelled during `dtSec` and decays
 * `state.velocity` in place (v(t) = v₀ e^(−t/τ), displacement = v₀ τ (1 − e^(−dt/τ))).
 */
export function coast(state: { velocity: number }, dtSec: number, timeConstantSec: number): number {
  if (!(dtSec > 0) || state.velocity === 0) return 0;
  const e = Math.exp(-dtSec / timeConstantSec);
  const displacement = state.velocity * timeConstantSec * (1 - e);
  state.velocity *= e;
  if (Math.abs(state.velocity) < 1e-9) state.velocity = 0;
  return displacement;
}

/**
 * Accumulator for a quantity applied incrementally (e.g. an orbit angle): user input moves `target`, a critically
 * damped spring moves `applied` toward it, and `take(dt)` returns the increment to apply this frame. Both values are
 * rebased toward zero when idle so they never lose precision.
 */
export class SmoothedDelta {
  target = 0;
  readonly spring: Spring1D = createSpring(0);

  constructor(public omega: number) {}

  add(amount: number): void {
    this.target += amount;
  }

  /** Remaining (not yet applied) amount. */
  get pending(): number {
    return this.target - this.spring.value;
  }

  get active(): boolean {
    return Math.abs(this.target - this.spring.value) > 1e-7 || Math.abs(this.spring.velocity) > 1e-6;
  }

  take(dtSec: number): number {
    const before = this.spring.value;
    stepSpring(this.spring, this.target, this.omega, dtSec);
    const delta = this.spring.value - before;
    if (!this.active) {
      this.spring.value = 0;
      this.spring.velocity = 0;
      this.target = 0;
    }
    return delta;
  }

  /** Drop pending motion (e.g. when a travel takes over). */
  reset(): void {
    this.target = 0;
    this.spring.value = 0;
    this.spring.velocity = 0;
  }

  /** Remove `amount` from the pending motion without moving (used when a constraint absorbs it). */
  absorb(amount: number): void {
    this.target -= amount;
  }
}
