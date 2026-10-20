/**
 * buildSmallBodyGeometry off the main thread (shape.worker.ts). Results are identical to the synchronous builder;
 * when workers are unavailable it falls back to building after a macrotask yield.
 */
import * as THREE from 'three';
import { buildSmallBodyGeometry, type ShapeSpec } from './shape';

interface Reply {
  id: number;
  position: Float32Array;
  normal: Float32Array;
  index: Uint32Array | Uint16Array | null;
  sphere: [number, number, number, number] | null;
}

let worker: Worker | null = null;
let workerFailed = false;
let nextId = 1;
const pending = new Map<number, { resolve: (g: THREE.BufferGeometry) => void; spec: ShapeSpec }>();

const fallback = (spec: ShapeSpec): Promise<THREE.BufferGeometry> =>
  new Promise(r => setTimeout(() => r(buildSmallBodyGeometry(spec)), 0));

function getWorker(): Worker | null {
  if (worker || workerFailed) return worker;
  try {
    worker = new Worker(new URL('./shape.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(e.data.position, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(e.data.normal, 3));
      if (e.data.index) geo.setIndex(new THREE.BufferAttribute(e.data.index, 1));
      const s = e.data.sphere;
      if (s) geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(s[0], s[1], s[2]), s[3]);
      job.resolve(geo);
    };
    worker.onerror = () => {
      workerFailed = true;
      worker?.terminate();
      worker = null;
      for (const [, job] of pending) void fallback(job.spec).then(job.resolve);
      pending.clear();
    };
  } catch {
    workerFailed = true;
    worker = null;
  }
  return worker;
}

export function buildSmallBodyGeometryAsync(spec: ShapeSpec): Promise<THREE.BufferGeometry> {
  const w = getWorker();
  if (!w) return fallback(spec);
  return new Promise(resolve => {
    const id = nextId++;
    pending.set(id, { resolve, spec });
    w.postMessage({ id, spec });
  });
}
