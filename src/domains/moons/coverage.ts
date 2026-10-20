/**
 * Imagery coverage of the five big Uranian moons. Voyager 2 flew by in January 1986 with the southern hemisphere in
 * sunlight, so the global mosaics only cover the south; the rest of the surface is an illustrative procedural fill.
 * Uranus' north pole is sunlit around 2026-2028, so the lit face seen today is mostly that unimaged fill.
 */
import { Vector3 } from 'three';
import type { MoonRecord } from './data';
import { moonRotation } from './ephemeris';

/** Fraction of the sphere area that Voyager 2 imaged (southern cap, from the mosaic coverage masks). */
export const IMAGED_FRACTION: Readonly<Record<string, number>> = {
  miranda: 0.37,
  ariel: 0.32,
  umbriel: 0.35,
  titania: 0.3,
  oberon: 0.32,
};

export const hasPartialCoverage = (id: string): boolean => id in IMAGED_FRACTION;

/** sin(latitude) of the imaged cap's northern edge: the cap covers sinLat <= 2f - 1 (equal-area latitude bands). */
export const imagedSinLatLimit = (id: string): number => 2 * (IMAGED_FRACTION[id] ?? 1) - 1;

const N = 240;
/** Fibonacci sphere sample directions in the body frame (z = north), built once. */
const SAMPLES = (() => {
  const a = new Float32Array(N * 3);
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const z = 1 - (2 * (i + 0.5)) / N;
    const r = Math.sqrt(1 - z * z);
    a[i * 3] = Math.cos(g * i) * r;
    a[i * 3 + 1] = Math.sin(g * i) * r;
    a[i * 3 + 2] = z;
  }
  return a;
})();

/**
 * Share (0..1) of the lit, visible part of the disc that lies outside the imaged cap, weighted by illumination.
 * `sun` and `cam` are unit/any-length direction vectors from the moon in the BODY frame (z = north pole).
 */
export function fillFractionOfLitDisc(id: string, sun: Vector3, cam: Vector3): number {
  const lim = imagedSinLatLimit(id);
  const cl = Math.hypot(cam.x, cam.y, cam.z) || 1;
  const sl = Math.hypot(sun.x, sun.y, sun.z) || 1;
  let lit = 0;
  let fill = 0;
  for (let i = 0; i < N; i++) {
    const x = SAMPLES[i * 3], y = SAMPLES[i * 3 + 1], z = SAMPLES[i * 3 + 2];
    const ndl = (x * sun.x + y * sun.y + z * sun.z) / sl;
    const ndc = (x * cam.x + y * cam.y + z * cam.z) / cl;
    if (ndl <= 0 || ndc <= 0) continue;
    const w = ndl * ndc;
    lit += w;
    if (z > lim) fill += w;
  }
  return lit > 0 ? fill / lit : 0;
}

/** Latitude (deg) of the sub-solar point given the body-frame Sun direction. */
export const subSolarLatDeg = (sunBody: Vector3): number => (Math.asin(Math.max(-1, Math.min(1, sunBody.z / (sunBody.length() || 1)))) * 180) / Math.PI;

/** Unit ICRS direction from the moon toward its south pole (the pole of the imaged hemisphere), at a fixed epoch. */
export function southPoleDirection(rec: MoonRecord): readonly [number, number, number] {
  const r = new Float64Array(9);
  moonRotation(rec, Date.UTC(2026, 9, 18), r);
  return [-r[2], -r[5], -r[8]];
}

/** Simulation time of the latest layer update, so lazily built fact sheets can describe the current illumination. */
export const coverageClock = { timeMs: Date.UTC(2026, 9, 18), sunLatDeg: Number.NaN };
