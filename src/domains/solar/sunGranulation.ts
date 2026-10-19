/**
 * Tileable solar surface-pattern texture, generated once on the CPU (≈ 10 ms, lazily on first use) so the
 * photosphere shader samples it triplanar instead of evaluating 3-D cellular noise per pixel (≈ 5× cheaper; mip-mapping
 * also averages the pattern to its mean at distance, so nothing shimmers).
 *
 *   R — granulation, seed A: bright domed granules, narrow dark intergranular lanes (Worley F1 / F2 − F1)
 *   G — supergranular network: thin lanes between a few large cells (Worley F2 − F1)
 *   B — granulation, seed B (cross-faded with R to make granules appear and dissolve)
 *   A — smooth tileable value noise (mesogranulation, facular grain)
 *
 * R, B and A are normalised to mean 0.5 so `(v − 0.5)` is a zero-mean contrast term.
 */
import * as THREE from 'three';

/** Granules across one tile edge (the shader scales the tile to the real ~1.3 Mm granule size). */
export const GRANULES_PER_TILE = 8;
/** Supergranules across one tile edge (the shader samples the network at its own, larger tile scale). */
export const NETWORK_CELLS_PER_TILE = 6;

function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Worley {
  f1: Float32Array;
  f2: Float32Array;
  /** Index of the nearest feature point (cell id). */
  id: Uint16Array;
}

/**
 * Tileable Worley F1/F2 on an n×n jittered grid, sampled at size² texels. `warp` (cells) bends the sample
 * coordinates with tile-periodic sinusoids so the cells become irregular polygons instead of crisp Voronoi tiles.
 */
function* worley(size: number, n: number, seed: number, warp = 0, field?: [Float32Array, Float32Array, number]): Generator<void, Worley> {
  const r = rng(seed);
  const pts = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) {
    pts[i * 2] = 0.1 + 0.8 * r();
    pts[i * 2 + 1] = 0.1 + 0.8 * r();
  }
  const ph = [r(), r(), r(), r()].map((v) => v * Math.PI * 2);
  const f1 = new Float32Array(size * size);
  const f2 = new Float32Array(size * size);
  const id = new Uint16Array(size * size);
  const TAU = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    if ((y & 31) === 31) yield;
    const v = (y + 0.5) / size;
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size;
      // Integer frequencies per tile keep the warp periodic.
      const wx = warp * (Math.sin(TAU * (2 * v + u) + ph[0]) * 0.6 + Math.sin(TAU * 5 * v + ph[1]) * 0.4);
      const wy = warp * (Math.sin(TAU * (2 * u - v) + ph[2]) * 0.6 + Math.sin(TAU * 5 * u + ph[3]) * 0.4);
      // Optional tile-periodic noise warp (zero-mean value noise, in cells): wobbly, non-polygonal cell edges.
      const fw = field ? field[2] : 0;
      const gx = u * n + wx + (field ? (field[0][y * size + x] - 0.5) * fw : 0);
      const gy = v * n + wy + (field ? (field[1][y * size + x] - 0.5) * fw : 0);
      const cx = Math.floor(gx), cy = Math.floor(gy);
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const ix = (((cx + ox) % n) + n) % n, iy = (((cy + oy) % n) + n) % n;
          const k = (iy * n + ix) * 2;
          const dx = cx + ox + pts[k] - gx, dy = cy + oy + pts[k + 1] - gy;
          const d = dx * dx + dy * dy;
          if (d < d1) { d2 = d1; d1 = d; best = iy * n + ix; } else if (d < d2) d2 = d;
        }
      }
      f1[y * size + x] = Math.sqrt(d1);
      f2[y * size + x] = Math.sqrt(d2);
      id[y * size + x] = best;
    }
  }
  return { f1, f2, id };
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/**
 * Granule brightness: each granule a hot, domed upflow (brightest at its centre, falling off toward its edge) with
 * its own brightness, separated by narrow dark intergranular lanes of cool downflow; ~1 in 8 is an "exploding"
 * granule with a darker centre. Matches the look of high-resolution G-band / continuum images (e.g. SST, DKIST).
 */
function granuleField(w: Worley, seed: number, laneN: Float32Array, fineN: Float32Array): Float32Array {
  const r = rng(seed);
  const cells = 1 + w.id.reduce((m, v) => Math.max(m, v), 0);
  const gain = new Float32Array(cells), explode = new Float32Array(cells);
  for (let i = 0; i < cells; i++) {
    gain[i] = 0.62 + 0.76 * r();
    explode[i] = r() < 0.13 ? 0.35 + 0.3 * r() : 0;
  }
  const out = new Float32Array(w.f1.length);
  for (let i = 0; i < out.length; i++) {
    const f1 = w.f1[i], f2 = w.f2[i];
    const edge = (2 * f1) / (f1 + f2); // 0 at the feature point, 1 on the cell boundary
    // Lane width and depth vary along the network (wide, dark vertices; narrow, shallow lane segments).
    const ln = laneN[i];
    const lane = smoothstep(0.0, 0.05 + 0.2 * ln * ln, f2 - f1);
    const laneFloor = 0.12 + 0.3 * (1 - ln);
    const dome = 1 - Math.pow(edge, 1.6 + 1.6 * ln);
    const c = w.id[i];
    const dimple = 1 - explode[c] * Math.exp(-(f1 * f1) / 0.02);
    // Fine interior structure (granule "texture") strongest toward the cell edges.
    const fine = 1 + 0.18 * (fineN[i] - 0.5) * (0.4 + edge);
    const body = (0.3 + 0.7 * dome * dimple) * gain[c] * fine;
    // Magnetic bright points: rare, tiny, sitting in the narrowest lanes.
    const bp = fineN[i] > 0.82 && ln < 0.35 ? 0.9 * (1 - lane) * smoothstep(0.82, 0.9, fineN[i]) : 0;
    out[i] = laneFloor * (1 - lane) * 0.45 + Math.pow(lane, 0.8) * body + bp;
  }
  return out;
}
/** Tileable value noise with a few octaves. */
function* valueNoise(size: number, seed: number, octaves: number[] = [4, 8, 16]): Generator<void, Float32Array> {
  const out = new Float32Array(size * size);
  let amp = 1;
  for (const n of octaves) {
    const r = rng(seed + n);
    const g = new Float32Array(n * n);
    for (let i = 0; i < g.length; i++) g[i] = r();
    for (let y = 0; y < size; y++) {
      if ((y & 63) === 63) yield;
      const fy = ((y + 0.5) / size) * n, y0 = Math.floor(fy), ty = fy - y0;
      const sy = ty * ty * (3 - 2 * ty);
      for (let x = 0; x < size; x++) {
        const fx = ((x + 0.5) / size) * n, x0 = Math.floor(fx), tx = fx - x0;
        const sx = tx * tx * (3 - 2 * tx);
        const a = g[(y0 % n) * n + (x0 % n)], b = g[(y0 % n) * n + ((x0 + 1) % n)];
        const c = g[((y0 + 1) % n) * n + (x0 % n)], d = g[((y0 + 1) % n) * n + ((x0 + 1) % n)];
        out[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
      }
    }
    amp *= 0.5;
  }
  return out;
}

/** Rescale to mean 0.5 with the given std, clamped to [0, 1]. */
function normalise(v: Float32Array, std: number): Float32Array {
  let m = 0;
  for (const x of v) m += x;
  m /= v.length;
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  s = Math.sqrt(s / v.length) || 1;
  for (let i = 0; i < v.length; i++) v[i] = Math.min(1, Math.max(0, 0.5 + ((v[i] - m) / s) * std));
  return v;
}

/** Runs a generator to completion, yielding to the event loop every ~6 ms (no long task on the main thread). */
async function runSliced<T>(gen: Generator<void, T>): Promise<T> {
  let t0 = performance.now();
  for (;;) {
    const r = gen.next();
    if (r.done) return r.value;
    if (performance.now() - t0 > 6) {
      await new Promise((res) => setTimeout(res, 0));
      t0 = performance.now();
    }
  }
}

let shared: Promise<THREE.DataTexture> | null = null;
let sharedTex: THREE.DataTexture | null = null;
let users = 0;

/**
 * Shared, ref-counted pattern texture (RGBA8, repeat, mip-mapped), generated in time slices so it never blocks a
 * frame. Call `releaseGranulationTexture` once per acquire (also when the promise has not settled yet).
 */
export function acquireGranulationTexture(size = 1024): Promise<THREE.DataTexture> {
  users++;
  shared ??= (async () => {
    const g = GRANULES_PER_TILE;
    const nx = normalise(await runSliced(valueNoise(size, 61, [g * 2, g * 4])), 0.25), ny = normalise(await runSliced(valueNoise(size, 71, [g * 2, g * 4])), 0.25);
    const laneN = normalise(await runSliced(valueNoise(size, 81, [g * 2, g * 4])), 0.3);
    const fineN = normalise(await runSliced(valueNoise(size, 91, [g * 8, g * 16])), 0.22);
    const gA = normalise(granuleField(await runSliced(worley(size, g, 11, 0.18, [nx, ny, 0.3])), 101, laneN, fineN), 0.22);
    const gB = normalise(granuleField(await runSliced(worley(size, g, 23, 0.18, [ny, nx, 0.3])), 202, laneN, fineN), 0.22);
    const net = await runSliced(worley(size, NETWORK_CELLS_PER_TILE, 37, 0.12));
    const vn = normalise(await runSliced(valueNoise(size, 51)), 0.22);
    const data = new Uint8Array(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      data[i * 4] = Math.round(gA[i] * 255);
      data[i * 4 + 1] = Math.round((1 - smoothstep(0, 0.09, net.f2[i] - net.f1[i])) * 255);
      data[i * 4 + 2] = Math.round(gB[i] * 255);
      data[i * 4 + 3] = Math.round(vn[i] * 255);
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.anisotropy = 4;
    tex.needsUpdate = true;
    sharedTex = tex;
    return tex;
  })();
  return shared;
}

export function releaseGranulationTexture(): void {
  users = Math.max(0, users - 1);
  if (users === 0 && shared) {
    const p = shared;
    shared = null;
    void p.then((t) => {
      t.dispose();
      if (sharedTex === t) sharedTex = null;
    });
  }
}
