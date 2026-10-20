/// <reference lib="webworker" />
/** Off-main-thread irregular moon shapes (geometry.ts): a detail-30 lumpy, cratered icosphere takes 50-110 ms. */
import { createIrregularGeometry, type IrregularOptions } from './geometry';

self.onmessage = (e: MessageEvent<{ id: number; radii: [number, number, number]; opts: IrregularOptions }>) => {
  const geo = createIrregularGeometry(e.data.radii, e.data.opts);
  const attrs: Record<string, [Float32Array, number]> = {};
  const transfer: Transferable[] = [];
  for (const [name, a] of Object.entries(geo.attributes)) {
    const arr = (a.array as Float32Array).slice();
    attrs[name] = [arr, a.itemSize];
    transfer.push(arr.buffer);
  }
  const index = geo.index ? (geo.index.array as Uint32Array | Uint16Array).slice() : null;
  if (index) transfer.push(index.buffer);
  const bs = geo.boundingSphere;
  geo.dispose();
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    { id: e.data.id, attrs, index, sphere: bs ? [bs.center.x, bs.center.y, bs.center.z, bs.radius] : null },
    transfer,
  );
};
