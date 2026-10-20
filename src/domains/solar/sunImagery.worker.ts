/// <reference lib="webworker" />
/** Off-main-thread decode + processing of one SDO browse image (sunImagery.ts): fetch, decode, read pixels, process. */
import { processAia, processHmi } from './sunImageryGen';

export interface SunImageJob {
  url: string;
  kind: 'hmi' | 'aia';
  /** Disc radius in pixels of a 1024² image (scaled to the real image size here). */
  radiusPx1024: number;
  captionRows1024: number;
}

export type SunImageResult =
  | { ok: true; w: number; h: number; data: Uint8Array; rPx: number; mean: [number, number, number]; lut: Float32Array | null }
  | { ok: false; error: string };

self.onmessage = async (e: MessageEvent<SunImageJob>) => {
  const scope = self as unknown as DedicatedWorkerGlobalScope;
  const job = e.data;
  try {
    const res = await fetch(job.url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const bmp = await createImageBitmap(await res.blob());
    const w = bmp.width, h = bmp.height;
    const g = new OffscreenCanvas(w, h).getContext('2d', { willReadFrequently: true });
    if (!g) throw new Error('no 2d context');
    g.drawImage(bmp, 0, 0);
    bmp.close();
    const px = g.getImageData(0, 0, w, h).data;
    const scale = w / 1024;
    let out: SunImageResult;
    if (job.kind === 'hmi') {
      const r = processHmi(px, w, h, job.radiusPx1024 * scale);
      out = { ok: true, w, h, data: r.data, rPx: r.rPx, mean: r.mean, lut: null };
    } else {
      const rPx = job.radiusPx1024 * scale;
      const r = processAia(px, w, h, rPx, Math.round(job.captionRows1024 * scale));
      out = { ok: true, w, h, data: r.data, rPx, mean: r.mean, lut: r.lut };
    }
    scope.postMessage(out, out.lut ? [out.data.buffer, out.lut.buffer] : [out.data.buffer]);
  } catch (err) {
    scope.postMessage({ ok: false, error: String((err as Error)?.message ?? err) } satisfies SunImageResult);
  }
};
