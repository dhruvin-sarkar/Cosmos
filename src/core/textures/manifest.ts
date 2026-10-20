/**
 * public/textures/ktx2.json: which source maps have a GPU-compressed KTX2 twin (written by
 * scripts/data/textures-ktx2/convert.mjs). Keys are the app-relative source paths the domain resolvers already use
 * ('textures/mars/color_8k.jpg', or 'textures/moon/color_8k.jpg@4096' for a downscaled tier).
 */

export interface Ktx2Entry {
  /** App-relative path of the .ktx2 file. */
  ktx2: string;
  codec: 'uastc' | 'etc1s';
  colorSpace: 'srgb' | 'linear';
  width: number;
  height: number;
  /** File size on disk. */
  bytes: number;
  /** Estimated GPU bytes after transcoding (BC7, full mip chain). */
  vramBytes: number;
  /** Size of the source image at conversion time: a different size means the KTX2 is stale. */
  srcBytes: number;
  /** Upload the file's mip chain from this level (a power-of-two downscale served from a larger KTX2). */
  skipLevels: number;
}

export interface Ktx2Manifest {
  version: number;
  entries: Map<string, Ktx2Entry>;
}

export const KTX2_MANIFEST_PATH = 'textures/ktx2.json';

/** Validate the JSON (pure; exported for tests). Bad entries are dropped, never thrown. */
export function parseKtx2Manifest(json: unknown): Ktx2Manifest {
  const entries = new Map<string, Ktx2Entry>();
  const raw = (json as { entries?: Record<string, unknown> } | null)?.entries;
  if (raw && typeof raw === 'object') {
    for (const [key, v] of Object.entries(raw)) {
      const e = v as Partial<Ktx2Entry> | null;
      if (!e || typeof e.ktx2 !== 'string' || !/\.ktx2$/i.test(e.ktx2)) continue;
      if (typeof e.width !== 'number' || typeof e.height !== 'number') continue;
      entries.set(normalizeKey(key), {
        ktx2: e.ktx2.replace(/^\/+/, ''),
        codec: e.codec === 'etc1s' ? 'etc1s' : 'uastc',
        colorSpace: e.colorSpace === 'linear' ? 'linear' : 'srgb',
        width: e.width,
        height: e.height,
        bytes: typeof e.bytes === 'number' ? e.bytes : 0,
        vramBytes: typeof e.vramBytes === 'number' ? e.vramBytes : compressedMipBytes(e.width, e.height),
        srcBytes: typeof e.srcBytes === 'number' ? e.srcBytes : 0,
        skipLevels: typeof e.skipLevels === 'number' && e.skipLevels > 0 ? Math.floor(e.skipLevels) : 0,
      });
    }
  }
  return { version: typeof (json as { version?: unknown } | null)?.version === 'number' ? (json as { version: number }).version : 1, entries };
}

export function normalizeKey(path: string): string {
  return path.replace(/^\/+/, '').replace(/^public\//, '');
}

/** GPU bytes of a 4×4-block, 16-bytes-per-block texture (BC7 / ASTC 4×4 / ETC2 RGBA) with a full mip chain. */
export function compressedMipBytes(width: number, height: number): number {
  let sum = 0;
  let w = Math.max(1, width), h = Math.max(1, height);
  for (;;) {
    sum += Math.ceil(w / 4) * Math.ceil(h / 4) * 16;
    if (w === 1 && h === 1) break;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return sum;
}

/** GPU bytes of an uncompressed RGBA8 texture (+1/3 for mips when mipmapped). */
export function rgbaBytes(width: number, height: number, mipmapped = true): number {
  const base = width * height * 4;
  return mipmapped ? Math.round(base * 4 / 3) : base;
}
