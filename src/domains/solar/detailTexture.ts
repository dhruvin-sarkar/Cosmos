/**
 * Shared tileable detail-height texture for close-up micro-relief and fine cloud streaks (planet shader).
 * 256² periodic fBm of lattice value noise (periods 4–64 texels, quintic interpolation), single half-float channel (8 bits
 * band into visible contour lines when magnified), with a box-filtered mip chain built here,
 * repeat-wrapped: its mip chain converges to flat grey, so the detail fades out with distance without aliasing.
 * Generated once on the CPU (~65k texels × 5 octaves), shared by every planet material, never disposed (tiny).
 */
import * as THREE from 'three';

const SIZE = 256;
let shared: THREE.DataTexture | null = null;

function hash(x: number, y: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + seed * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function quintic(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Periodic value noise in [0, 1] with `period` lattice cells across the tile. */
function valueNoise(x: number, y: number, period: number, seed: number): number {
  const fx = (x / SIZE) * period;
  const fy = (y / SIZE) * period;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = quintic(fx - x0);
  const ty = quintic(fy - y0);
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0 % period, y0 % period, seed);
  const b = hash(x1, y0 % period, seed);
  const c = hash(x0 % period, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

export function detailTexture(): THREE.DataTexture {
  if (shared) return shared;
  const level0 = new Float32Array(SIZE * SIZE);
  const periods = [4, 8, 16, 32, 64];
  const amps = [0.36, 0.26, 0.18, 0.12, 0.08];
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      let h = 0;
      for (let o = 0; o < periods.length; o++) h += amps[o] * (valueNoise(x, y, periods[o], o + 1) - 0.5);
      level0[y * SIZE + x] = 0.5 + h;
    }
  }
  const toHalf = (a: Float32Array): Uint16Array => {
    const out = new Uint16Array(a.length);
    for (let i = 0; i < a.length; i++) out[i] = THREE.DataUtils.toHalfFloat(a[i]);
    return out;
  };
  const mipmaps: { data: Uint16Array; width: number; height: number }[] = [];
  let cur = level0;
  let n = SIZE;
  for (;;) {
    mipmaps.push({ data: toHalf(cur), width: n, height: n });
    if (n === 1) break;
    const m = n >> 1;
    const next = new Float32Array(m * m);
    for (let y = 0; y < m; y++) {
      for (let x = 0; x < m; x++) {
        const i = 2 * y * n + 2 * x;
        next[y * m + x] = 0.25 * (cur[i] + cur[i + 1] + cur[i + n] + cur[i + n + 1]);
      }
    }
    cur = next;
    n = m;
  }
  const tex = new THREE.DataTexture(mipmaps[0].data, SIZE, SIZE, THREE.RedFormat, THREE.HalfFloatType);
  tex.mipmaps = mipmaps as unknown as THREE.DataTexture['mipmaps'];
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}
