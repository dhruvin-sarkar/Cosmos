/**
 * Procedural starfield fallback (ILLUSTRATIVE): used only when the catalogue backdrop is unavailable, so the sky
 * is never blank. Statistics follow the real naked-eye sky so it reads correctly:
 *  - counts N(< m) ∝ 10^(0.45 m) (≈ 8 000 stars brighter than m = 6.5 for the default count);
 *  - Teff mix of bright stars (K/M giants, A/F dwarfs, a few hot B stars);
 *  - a fraction of stars concentrated toward the galactic plane (|b| ~ 12°), converted to ICRS with the Hipparcos
 *    Galactic↔ICRS rotation (ESA 1997, Vol. 1 §1.5.3).
 * Output is sorted brightest-first and rendered with PointStarMaterial({ atInfinity: true }).
 */
import * as THREE from 'three';
import { PointStarMaterial, type PointStarMaterialOptions } from './materials/PointStarMaterial';

/** Rows of the ICRS → Galactic rotation (Hipparcos). Galactic → ICRS is its transpose. */
export const ICRS_TO_GALACTIC = [
  [-0.0548755604, -0.8734370902, -0.4838350155],
  [0.4941094279, -0.44482963, 0.7469822445],
  [-0.867666149, -0.1980763734, 0.4559837762],
] as const;

export interface StarfieldData {
  /** Unit ICRS directions, xyz per star. */
  directions: Float32Array;
  magnitudes: Float32Array;
  teffK: Float32Array;
  count: number;
}

export interface StarfieldOptions {
  count?: number;
  limitMag?: number;
  brightestMag?: number;
  /** Fraction of stars drawn from the galactic-plane population. */
  diskFraction?: number;
  seed?: number;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rand: () => number): number {
  return Math.sqrt(-2 * Math.log(1 - rand())) * Math.cos(2 * Math.PI * rand());
}

const TEFF_POPULATION: Array<[weight: number, minK: number, maxK: number]> = [
  [0.08, 11_000, 25_000], // B
  [0.18, 7_500, 10_000], // A
  [0.22, 6_000, 7_500], // F/G dwarfs
  [0.42, 3_900, 5_200], // K giants dominate the bright sky
  [0.1, 3_200, 3_900], // M giants
];

function sampleTeff(rand: () => number): number {
  let r = rand();
  for (const [w, lo, hi] of TEFF_POPULATION) {
    if (r < w) return lo + (hi - lo) * rand();
    r -= w;
  }
  return 5_000;
}

export function generateStarfield(opts: StarfieldOptions = {}): StarfieldData {
  const count = opts.count ?? 9_000;
  const limit = opts.limitMag ?? 6.8;
  const brightest = opts.brightestMag ?? -1.5;
  const disk = opts.diskFraction ?? 0.45;
  const rand = mulberry32(opts.seed ?? 0x5eed);
  const mags = new Float64Array(count);
  for (let i = 0; i < count; i++) mags[i] = Math.max(brightest, limit + Math.log10(Math.max(rand(), 1e-12)) / 0.45);
  mags.sort();
  const directions = new Float32Array(3 * count);
  const magnitudes = new Float32Array(count);
  const teffK = new Float32Array(count);
  const G = ICRS_TO_GALACTIC;
  for (let i = 0; i < count; i++) {
    const l = 2 * Math.PI * rand();
    const b = rand() < disk ? Math.max(-1.5, Math.min(1.5, gaussian(rand) * 0.21)) : Math.asin(2 * rand() - 1);
    const gx = Math.cos(b) * Math.cos(l), gy = Math.cos(b) * Math.sin(l), gz = Math.sin(b);
    // ICRS = Gᵀ · galactic.
    directions[3 * i] = G[0][0] * gx + G[1][0] * gy + G[2][0] * gz;
    directions[3 * i + 1] = G[0][1] * gx + G[1][1] * gy + G[2][1] * gz;
    directions[3 * i + 2] = G[0][2] * gx + G[1][2] * gy + G[2][2] * gz;
    magnitudes[i] = mags[i];
    teffK[i] = sampleTeff(rand);
  }
  return { directions, magnitudes, teffK, count };
}

/** Points at infinity for the starfield (add to the `background` or `far` group). Dispose geometry + material. */
export function createStarfieldPoints(
  data: StarfieldData = generateStarfield(),
  material: PointStarMaterial = new PointStarMaterial({ atInfinity: true } satisfies PointStarMaterialOptions),
): THREE.Points<THREE.BufferGeometry, PointStarMaterial> {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(data.directions, 3));
  geom.setAttribute('aMag', new THREE.BufferAttribute(data.magnitudes, 1));
  geom.setAttribute('aTeff', new THREE.BufferAttribute(data.teffK, 1));
  const pts = new THREE.Points(geom, material);
  pts.frustumCulled = false;
  pts.name = 'ProceduralStarfield (illustrative)';
  return pts;
}
