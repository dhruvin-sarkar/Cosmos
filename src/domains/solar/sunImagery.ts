/**
 * Today's SDO full-disc images (public/data/sky/sun/: HMI continuum, AIA 304/171/193), prepared for projection onto
 * the solar sphere. Everything loads lazily after the first frame and the Sun renders procedurally until (or
 * unless) it arrives; a missing file never throws.
 *
 *  - HMI continuum → a single-channel "relative intensity" map: the image's own azimuthally averaged centre-to-limb
 *    profile is divided out, so 1 = quiet photosphere, ≈0.2–0.4 = umbra, ≈0.8 = penumbra, > 1 = faculae. The
 *    renderer applies its own physical limb darkening and colour, so the quick-look's orange palette never shows.
 *  - AIA images → a single-channel index map (the browse image's encoded luma) plus a 256-entry colour LUT in
 *    display-graded scene-linear units: each colourmap level is passed through agxInverse (src/render/tonemap.ts),
 *    so after the post's AgX tone mapping the disc shows the image's own colours instead of AgX's desaturated
 *    highlights. The caption strip is replaced by the image's azimuthally averaged off-limb profile (it would
 *    otherwise show as a hard-edged hole in the off-limb emission).
 *  - Geometry → the image frame (disc centre, solar north, west) in the solar body frame at the image time, from
 *    the Sun→Earth direction (SDO is in geosynchronous orbit, i.e. Earth's viewpoint) and the IAU rotation model.
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import type { AssetLoader } from '../../core/types';
import { AU_M } from '../../core/units';
import type { RotationModel } from './constants';
import type { SunImageJob, SunImageResult } from './sunImagery.worker';
import { processAia, processHmi } from './sunImageryGen';
import { AIA_ARCSEC_PER_PX_1024, HMI_ARCSEC_PER_PX_1024, imageFrame, sunAngularRadiusArcsec, type ImageFrame } from './sunPhysics';

export type SunImageId = 'hmi-continuum' | 'aia304' | 'aia171' | 'aia193';

interface SunJsonItem {
  id: string;
  label: string;
  wavelength: string;
  shows: string;
  file: string;
  width: number;
  height: number;
  imageTimeUtc: string;
  source: string;
}
interface SunJson {
  credit: string;
  license: string;
  items: SunJsonItem[];
}

export interface SunImage {
  id: SunImageId;
  label: string;
  wavelength: string;
  texture: THREE.Texture;
  /** Approximate image time (HTTP Last-Modified), ms. */
  timeMs: number;
  /** Disc radius as a fraction of the image width. */
  radiusFrac: number;
  frame: ImageFrame;
  /** Mean linear colour of the disc (fallback tint for the far side; AIA: LUT units). */
  meanColor: THREE.Color;
  /** AIA only: 256×1 colour LUT indexed by `texture.r` (scene-linear, ×1 at the agxInverse reference exposure). */
  lut?: THREE.DataTexture;
  source: string;
}

export interface SunImagery {
  credit: string;
  get(id: SunImageId): SunImage | null;
  /** Starts loading `id` if not yet requested; resolves to null when unavailable. */
  request(id: SunImageId): Promise<SunImage | null>;
  dispose(): void;
}

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';
/** Rows at the bottom of the 1024² browse images that carry the caption. */
const CAPTION_ROWS = 52;

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`sun image failed: ${url}`));
    img.src = url;
  });
}

function earthDirection(tMs: number, rM: number): { dir: THREE.Vector3; radiusArcsec: number } {
  const v = Astronomy.HelioVector(Astronomy.Body.Earth, new Date(tMs));
  const dir = new THREE.Vector3(v.x, v.y, v.z);
  const dM = dir.length() * AU_M;
  return { dir: dir.normalize(), radiusArcsec: sunAngularRadiusArcsec(rM, dM) };
}

/** 256-entry scene-linear colour LUT (RGBA float) -> half-float DataTexture. */
function lutTexture(lutF: Float32Array): THREE.DataTexture {
  const half = new Uint16Array(256 * 4);
  for (let i = 0; i < half.length; i++) half[i] = THREE.DataUtils.toHalfFloat(Math.max(-60000, Math.min(lutF[i], 60000)));
  const lut = new THREE.DataTexture(half, 256, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  lut.colorSpace = THREE.NoColorSpace;
  lut.minFilter = lut.magFilter = THREE.LinearFilter;
  lut.wrapS = lut.wrapT = THREE.ClampToEdgeWrapping;
  lut.generateMipmaps = false;
  lut.needsUpdate = true;
  return lut;
}

/** Decode + process one image in a Web Worker (the 1024² pixel passes take 150-230 ms; never on the main thread). */
function processInWorker(job: SunImageJob): Promise<SunImageResult | null> {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(null);
  return new Promise((resolve) => {
    let worker: Worker;
    try {
      worker = new Worker(new URL('./sunImagery.worker.ts', import.meta.url), { type: 'module' });
    } catch {
      resolve(null);
      return;
    }
    const done = (r: SunImageResult | null): void => {
      worker.terminate();
      resolve(r);
    };
    worker.onmessage = (e: MessageEvent<SunImageResult>) => done(e.data.ok ? e.data : null);
    worker.onerror = () => done(null);
    worker.onmessageerror = () => done(null);
    worker.postMessage(job);
  });
}

/** Fallback without workers / OffscreenCanvas: the same processing on the main thread. */
async function processOnMainThread(job: SunImageJob): Promise<SunImageResult | null> {
  const img = await loadImage(job.url);
  const w = img.naturalWidth, h = img.naturalHeight;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.drawImage(img, 0, 0);
  const px = g.getImageData(0, 0, w, h).data;
  const scale = w / 1024;
  if (job.kind === 'hmi') {
    const r = processHmi(px, w, h, job.radiusPx1024 * scale);
    return { ok: true, w, h, data: r.data, rPx: r.rPx, mean: r.mean, lut: null };
  }
  const rPx = job.radiusPx1024 * scale;
  const r = processAia(px, w, h, rPx, Math.round(job.captionRows1024 * scale));
  return { ok: true, w, h, data: r.data, rPx, mean: r.mean, lut: r.lut };
}

export { agxInverseWide } from './sunImageryGen';

export function createSunImagery(assets: AssetLoader, rotation: RotationModel, radiusM: number, maxAnisotropy: number): SunImagery {
  let meta: Promise<SunJson | null> | null = null;
  const loaded = new Map<SunImageId, SunImage>();
  const pending = new Map<SunImageId, Promise<SunImage | null>>();
  let disposed = false;
  const credit = 'NASA/SDO and the AIA, EVE, and HMI science teams';

  const getMeta = (): Promise<SunJson | null> => (meta ??= assets.json<SunJson>('data/sky/sun/sun.json').catch(() => null));

  async function load(id: SunImageId): Promise<SunImage | null> {
    const m = await getMeta();
    const item = m?.items.find((i) => i.id === id);
    if (!item) return null;
    const timeMs = Date.parse(item.imageTimeUtc);
    const { dir, radiusArcsec } = earthDirection(timeMs, radiusM);
    const frame = imageFrame(rotation, timeMs, dir);
    const hmi = id === 'hmi-continuum';
    const job: SunImageJob = {
      url: new URL(BASE + item.file, location.href).href,
      kind: hmi ? 'hmi' : 'aia',
      radiusPx1024: radiusArcsec / (hmi ? HMI_ARCSEC_PER_PX_1024 : AIA_ARCSEC_PER_PX_1024),
      captionRows1024: CAPTION_ROWS,
    };
    const r = await processInWorker(job).catch(() => null) ?? (await processOnMainThread(job).catch(() => null));
    if (!r?.ok || disposed) return null;
    const { w, h } = r;
    const tex = new THREE.DataTexture(r.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    tex.colorSpace = THREE.NoColorSpace;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    if (!hmi) tex.anisotropy = Math.min(16, maxAnisotropy);
    tex.needsUpdate = true;
    const texture: THREE.Texture = tex;
    const radiusFrac = r.rPx / w;
    const meanColor = hmi
      ? new THREE.Color().setRGB(r.mean[0], r.mean[1], r.mean[2], THREE.SRGBColorSpace)
      : new THREE.Color(r.mean[0], r.mean[1], r.mean[2]);
    const lut = r.lut ? lutTexture(r.lut) : undefined;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    const out: SunImage = { id, label: item.label, wavelength: item.wavelength, texture, timeMs, radiusFrac, frame, meanColor, lut, source: item.source };
    loaded.set(id, out);
    return out;
  }

  return {
    credit,
    get: (id) => loaded.get(id) ?? null,
    request(id) {
      let p = pending.get(id);
      if (!p) {
        p = load(id).catch(() => null);
        pending.set(id, p);
      }
      return p;
    },
    dispose() {
      disposed = true;
      for (const img of loaded.values()) {
        img.texture.dispose();
        img.lut?.dispose();
      }
      loaded.clear();
    },
  };
}
