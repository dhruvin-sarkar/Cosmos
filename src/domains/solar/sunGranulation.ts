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
import { patternGen } from './sunGranulationGen';

export { GRANULES_PER_TILE, NETWORK_CELLS_PER_TILE } from './sunGranulationGen';

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

/** Generates the pattern in a Web Worker (no main-thread cost); falls back to time slices on the main thread. */
function generate(size: number): Promise<Uint8Array> {
  if (typeof Worker === 'undefined') return runSliced(patternGen(size));
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sunGranulation.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(runSliced(patternGen(size)));
      return;
    }
    const fallback = (): void => {
      worker.terminate();
      resolve(runSliced(patternGen(size)));
    };
    worker.onmessage = (e: MessageEvent<Uint8Array>) => {
      worker.terminate();
      resolve(e.data);
    };
    worker.onerror = fallback;
    worker.onmessageerror = fallback;
    worker.postMessage(size);
  });
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
    const data = await generate(size);
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
