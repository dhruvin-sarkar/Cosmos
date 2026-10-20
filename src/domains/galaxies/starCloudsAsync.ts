/**
 * Star-cloud build (image fetch + decode + luminance sampling) in starClouds.worker.ts, with a main-thread fallback
 * when workers (or OffscreenCanvas in workers) are unavailable.
 */
import type { V3 } from './math';
import { loadLinearImage, mulberry32, sampleCloud } from './starClouds';

export interface CloudJob {
  /** Absolute image URL. */
  url: string;
  maxSize: number;
  center: V3;
  normal: V3;
  radiusMpc: number;
  fovRad: number;
  count: number;
  seed: number;
}

export interface CloudResult {
  positions: Float32Array;
  colors: Float32Array;
  sumLum: number;
  count: number;
  /** Decoded image width (px) - the per-pixel solid angle of the brightness calibration. */
  width: number;
}

export async function buildCloudFromImage(job: CloudJob): Promise<CloudResult> {
  const img = await loadLinearImage(job.url, job.maxSize);
  const smp = sampleCloud({ ...img, center: job.center, normal: job.normal, radiusMpc: job.radiusMpc, fovRad: job.fovRad, count: job.count, rand: mulberry32(job.seed) });
  return { positions: smp.positions.slice(0, smp.count * 3), colors: smp.colors.slice(0, smp.count * 3), sumLum: smp.sumLum, count: smp.count, width: img.width };
}

export function buildCloudAsync(job: CloudJob): Promise<CloudResult> {
  let w: Worker;
  try {
    w = new Worker(new URL('./starClouds.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    return buildCloudFromImage(job);
  }
  return new Promise((resolve, reject) => {
    const fallback = (): void => {
      w.terminate();
      buildCloudFromImage(job).then(resolve, reject);
    };
    w.onmessage = (e: MessageEvent<CloudResult | { error: string }>) => {
      if ('error' in e.data) { fallback(); return; }
      w.terminate();
      resolve(e.data);
    };
    w.onerror = fallback;
    w.postMessage(job);
  });
}
