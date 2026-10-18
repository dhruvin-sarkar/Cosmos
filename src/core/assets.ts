/**
 * AssetLoader (docs/ARCHITECTURE.md §12, §15): textures, JSON and binaries from the offline snapshot.
 *
 * Textures are returned immediately as a 1×1 placeholder of a fallback color and swapped in place when the
 * image arrives, so materials never wait and never need rebinding. Images are decoded off the main thread
 * with fetch + createImageBitmap where available (HTMLImageElement otherwise). A failed load keeps the
 * fallback and posts one notice per path. All paths are relative to the app base (import.meta.env.BASE_URL).
 */
import * as THREE from 'three';
import { pushNotice, type CosmosStore } from '../state/store';
import type { AssetLoader } from './types';

export interface TextureOptions {
  colorSpace?: 'srgb' | 'linear';
  fallbackColor?: number;
  anisotropy?: number;
}

export interface AssetLoaderOptions {
  /** Used for the anisotropy cap; may be null in tests. */
  renderer?: THREE.WebGLRenderer | null;
  /** Receives user-visible notices for texture failures. */
  store?: CosmosStore | null;
  /** Default: import.meta.env.BASE_URL. */
  baseUrl?: string;
  /** Anisotropic filtering used when a texture does not ask for a value (clamped to the GPU maximum). */
  defaultAnisotropy?: number;
  fetchImpl?: typeof fetch;
}

export interface CosmosAssetLoader extends AssetLoader {
  /** Resolve an app-relative path to a fetchable URL (absolute, data: and blob: URLs pass through). */
  url(path: string): string;
  /** Resolves once no request is in flight (screenshot tooling, tests). */
  idle(): Promise<void>;
  /** Dispose every cached texture and drop all caches. */
  dispose(): void;
}

interface TextureEntry {
  texture: THREE.Texture;
  ready: Promise<THREE.Texture>;
}

const DEFAULT_FALLBACK = 0x808080;
const ABSOLUTE_URL = /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;

function defaultBaseUrl(): string {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

function describeError(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function placeholderImage(color: number): HTMLCanvasElement | ImageData | null {
  const css = `#${(color & 0xffffff).toString(16).padStart(6, '0')}`;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
    }
    return canvas;
  }
  if (typeof ImageData !== 'undefined') {
    const data = new Uint8ClampedArray([(color >> 16) & 255, (color >> 8) & 255, color & 255, 255]);
    return new ImageData(data, 1, 1);
  }
  return null;
}

export function createAssetLoader(opts: AssetLoaderOptions = {}): CosmosAssetLoader {
  const base = opts.baseUrl ?? defaultBaseUrl();
  const fetchImpl: typeof fetch = opts.fetchImpl ?? ((input, init) => fetch(input, init));
  const textures = new Map<string, TextureEntry>();
  const jsonCache = new Map<string, Promise<unknown>>();
  const binaryCache = new Map<string, Promise<ArrayBuffer>>();
  const reportedFailures = new Set<string>();
  let pending = 0;
  let idleWaiters: Array<() => void> = [];

  const maxAnisotropy = (): number => {
    try {
      return opts.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    } catch {
      return 1;
    }
  };

  const url = (path: string): string => {
    if (ABSOLUTE_URL.test(path)) return path;
    const b = base.endsWith('/') ? base : `${base}/`;
    return b + path.replace(/^\/+/, '');
  };

  const track = <T>(promise: Promise<T>): Promise<T> => {
    pending += 1;
    const done = (): void => {
      pending -= 1;
      if (pending === 0) {
        const waiters = idleWaiters;
        idleWaiters = [];
        for (const w of waiters) w();
      }
    };
    promise.then(done, done);
    return promise;
  };

  const fetchOk = async (path: string): Promise<Response> => {
    let res: Response;
    try {
      res = await fetchImpl(url(path));
    } catch (err) {
      throw new Error(`Network error loading ${path}: ${describeError(err)}`);
    }
    if (!res.ok) throw new Error(`Failed to load ${path}: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}`);
    // A dev-server SPA fallback answers missing files with index.html; never mistake that for data.
    const type = res.headers.get('content-type') ?? '';
    if (type.includes('text/html') && !/\.html?$/i.test(path)) throw new Error(`Failed to load ${path}: not found (server returned HTML)`);
    return res;
  };

  const decodeImage = async (path: string): Promise<ImageBitmap | HTMLImageElement> => {
    if (typeof createImageBitmap === 'function') {
      const res = await fetchOk(path);
      const blob = await res.blob();
      try {
        return await createImageBitmap(blob, { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      } catch (err) {
        throw new Error(`Could not decode ${path}: ${describeError(err)}`);
      }
    }
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.decoding = 'async';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load ${path}`));
      img.src = url(path);
    });
  };

  const notifyFailure = (path: string, err: unknown): void => {
    console.warn(`[cosmos] texture ${path} unavailable:`, err);
    if (reportedFailures.has(path) || !opts.store) return;
    reportedFailures.add(path);
    pushNotice(opts.store, {
      kind: 'warning',
      text: `Image "${path.split('/').pop() ?? path}" could not be loaded; a plain fallback color is shown instead.`,
      ttlMs: 8000,
    });
  };

  const loadTexture = (path: string, colorSpace: 'srgb' | 'linear', fallbackColor: number, anisotropy: number | undefined): TextureEntry => {
    const placeholder = placeholderImage(fallbackColor);
    const texture: THREE.Texture = new THREE.Texture(placeholder ?? undefined) as THREE.Texture;
    texture.name = path;
    texture.colorSpace = colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.anisotropy = Math.max(1, Math.min(anisotropy ?? opts.defaultAnisotropy ?? 8, maxAnisotropy()));
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    if (placeholder) texture.needsUpdate = true;

    const ready = track(decodeImage(path)).then(image => {
      // Free the 1×1 GPU texture first: three's immutable texture storage cannot be resized in place.
      texture.dispose();
      texture.image = image;
      texture.flipY = !(typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap);
      texture.generateMipmaps = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.needsUpdate = true;
      return texture;
    });
    return { texture, ready };
  };

  const getEntry = (path: string, o: TextureOptions): TextureEntry => {
    const colorSpace = o.colorSpace ?? 'srgb';
    const key = `${colorSpace}|${path}`;
    let entry = textures.get(key);
    if (!entry) {
      entry = loadTexture(path, colorSpace, o.fallbackColor ?? DEFAULT_FALLBACK, o.anisotropy);
      entry.ready.catch(err => notifyFailure(path, err));
      textures.set(key, entry);
    }
    return entry;
  };

  return {
    get pending() {
      return pending;
    },

    url,

    texture(path: string, o: TextureOptions = {}): THREE.Texture {
      return getEntry(path, o).texture;
    },

    textureAsync(path: string, o: Omit<TextureOptions, 'fallbackColor'> = {}): Promise<THREE.Texture> {
      return getEntry(path, o).ready;
    },

    json<T>(path: string): Promise<T> {
      let p = jsonCache.get(path);
      if (!p) {
        p = track(
          fetchOk(path).then(async res => {
            try {
              return (await res.json()) as unknown;
            } catch (err) {
              throw new Error(`Invalid JSON in ${path}: ${describeError(err)}`);
            }
          }),
        );
        p.catch(() => jsonCache.delete(path));
        jsonCache.set(path, p);
      }
      return p as Promise<T>;
    },

    binary(path: string): Promise<ArrayBuffer> {
      let p = binaryCache.get(path);
      if (!p) {
        p = track(fetchOk(path).then(res => res.arrayBuffer()));
        p.catch(() => binaryCache.delete(path));
        binaryCache.set(path, p);
      }
      return p;
    },

    idle(): Promise<void> {
      if (pending === 0) return Promise.resolve();
      return new Promise(resolve => idleWaiters.push(resolve));
    },

    dispose(): void {
      for (const { texture } of textures.values()) texture.dispose();
      textures.clear();
      jsonCache.clear();
      binaryCache.clear();
    },
  };
}
