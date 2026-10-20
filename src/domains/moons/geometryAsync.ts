/**
 * createIrregularGeometry off the main thread (geometry.worker.ts); identical output. Falls back to a synchronous
 * build after a macrotask yield when workers are unavailable.
 */
import * as THREE from 'three';
import { createIrregularGeometry, type IrregularOptions } from './geometry';

interface Reply {
  id: number;
  attrs: Record<string, [Float32Array, number]>;
  index: Uint32Array | Uint16Array | null;
  sphere: [number, number, number, number] | null;
}
type Job = { resolve: (g: THREE.BufferGeometry) => void; radii: [number, number, number]; opts: IrregularOptions };

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, Job>();

const fallback = (radii: [number, number, number], opts: IrregularOptions): Promise<THREE.BufferGeometry> =>
  new Promise(r => setTimeout(() => r(createIrregularGeometry(radii, opts)), 0));

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./geometry.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      const geo = new THREE.BufferGeometry();
      for (const [name, [arr, size]] of Object.entries(e.data.attrs)) geo.setAttribute(name, new THREE.BufferAttribute(arr, size));
      if (e.data.index) geo.setIndex(new THREE.BufferAttribute(e.data.index, 1));
      const s = e.data.sphere;
      if (s) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3]);
      job.resolve(geo);
    };
    worker.onerror = () => {
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const [, job] of pending) void fallback(job.radii, job.opts).then(job.resolve);
      pending.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

export function createIrregularGeometryAsync(radii: [number, number, number], opts: IrregularOptions): Promise<THREE.BufferGeometry> {
  const w = getWorker();
  if (!w) return fallback(radii, opts);
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, { resolve, radii, opts });
    w.postMessage({ id, radii, opts });
  });
}
