/// <reference lib="webworker" />
/** Off-main-thread procedural small-body geometry (shape.ts): 10k-face icospheres take 10-50 ms each to displace. */
import { buildSmallBodyGeometry, type ShapeSpec } from './shape';

self.onmessage = (e: MessageEvent<{ id: number; spec: ShapeSpec }>) => {
  const geo = buildSmallBodyGeometry(e.data.spec);
  const position = (geo.getAttribute('position').array as Float32Array).slice();
  const normal = (geo.getAttribute('normal').array as Float32Array).slice();
  const index = geo.index ? (geo.index.array as Uint32Array | Uint16Array).slice() : null;
  const bs = geo.boundingSphere;
  geo.dispose();
  const transfer: Transferable[] = [position.buffer, normal.buffer];
  if (index) transfer.push(index.buffer);
  (self as unknown as DedicatedWorkerGlobalScope).postMessage(
    { id: e.data.id, position, normal, index, sphere: bs ? [bs.center.x, bs.center.y, bs.center.z, bs.radius] : null },
    transfer,
  );
};
