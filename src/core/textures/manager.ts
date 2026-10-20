/**
 * Shared texture manager: GPU-compressed KTX2 tiers, uploads spread across frames, VRAM budget with LRU eviction.
 *
 * - KTX2 / Basis Universal (public/textures/ktx2.json, scripts/data/textures-ktx2/): fetched, then transcoded in Web
 *   Workers by three's KTX2Loader (transcoder served from public/basis/, fully offline) to BC7 on desktop GPUs
 *   (ASTC / ETC2 elsewhere). An 8K map costs ~43 MB of VRAM instead of ~171 MB for RGBA8 + mips, and arrives with its
 *   mip chain, so the upload is a straight copy (no generateMipmap stall on the main thread).
 * - Anything without a KTX2 twin (or a stale one, or no transcoder) falls back to the AssetLoader's ImageBitmap path
 *   (decoded off the main thread); new maps from hd.json therefore work immediately and get compressed on the next
 *   conversion run.
 * - Uploads go through a queue drained in requestAnimationFrame with a small per-frame time budget, so several HD maps
 *   arriving together never land in the same frame.
 * - Evictable HD tiers (registered by the domain resolvers with an evict/restore pair) are tracked by draw: the manager
 *   notices every time three binds a texture for a draw (an accessor on texture.version, which WebGLTextures reads
 *   on every bind). Over budget, idle or tiny tiers drop back to their preview tier and come back when wanted.
 */
import * as THREE from 'three';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import type { AssetLoader, QualityProfile } from '../types';
import { HD_BUDGET_BYTES, chooseEvictions, chooseRestore, type ResidentState } from './budget';
import { KTX2_MANIFEST_PATH, compressedMipBytes, normalizeKey, parseKtx2Manifest, rgbaBytes, type Ktx2Entry, type Ktx2Manifest } from './manifest';

export interface ManagedTextureOptions {
  colorSpace: 'srgb' | 'linear';
  /** Requested anisotropy, clamped to the GPU maximum (default 16). */
  anisotropy?: number;
  /** 'equirect' (default): repeat in u, clamp in v. 'clamp': both clamped, anisotropy 1 (radial strips). */
  wrap?: 'equirect' | 'clamp';
  /** Upload order when several are queued: higher first (default 0). */
  priority?: number;
  /** How much the texture is wanted right now (on-screen px of its body); decides which queued HD decode goes first. */
  wanted?: () => number;
}

export interface ResidencyHooks {
  /** Rebind the preview tier; the manager then frees the HD texture's GPU memory. */
  evict(): void;
  /** Reload and rebind the HD tier; resolves with the new texture (null = could not restore). */
  restore(): Promise<THREE.Texture | null>;
  /** False once the slot was superseded or its owner went away: the manager forgets the entry. */
  alive(): boolean;
  /** The body's on-screen disc size in px, if the owner knows it. */
  screenPx?: () => number;
  /** The preview texture bound while evicted (its draws mean the body is still being looked at). */
  preview: THREE.Texture;
  label?: string;
}

export interface TextureManagerStats {
  ktx2Supported: boolean | null;
  ktx2Loaded: number;
  ktx2Failed: number;
  fallbackLoaded: number;
  /** Estimated GPU bytes of all textures this manager loaded and that are still alive. */
  managedBytes: number;
  /** Bytes of registered (evictable) HD tiers currently resident. */
  residentHdBytes: number;
  budgetBytes: number;
  residents: number;
  evicted: number;
  evictions: number;
  restores: number;
  uploads: number;
  uploadQueue: number;
  maxUploadMs: number;
  lastUploadMs: number;
  totalUploadMs: number;
  maxTranscodeMs: number;
  pending: number;
}

interface Resident extends ResidentState {
  tex: THREE.Texture;
  hooks: ResidencyHooks;
  restoring: boolean;
}

interface QueuedUpload {
  tex: THREE.Texture;
  priority: number;
  resolve: () => void;
}

/** Per-frame upload time budget; at least one texture is always uploaded per frame. */
const UPLOAD_BUDGET_MS = 4;
/** Residency is re-evaluated every this many frames. */
const TICK_FRAMES = 20;

const usage = new WeakMap<THREE.Texture, { lastUsed: number }>();
let frameNo = 0;

/** Install a draw tracker on a texture (idempotent): WebGLTextures reads `version` on every bind. */
function trackUsage(tex: THREE.Texture): { lastUsed: number } {
  let rec = usage.get(tex);
  if (rec) return rec;
  const r = { lastUsed: -1 };
  rec = r;
  usage.set(tex, rec);
  let version = tex.version;
  Object.defineProperty(tex, 'version', {
    configurable: true,
    enumerable: true,
    get(): number {
      r.lastUsed = frameNo;
      return version;
    },
    set(v: number) {
      version = v;
    },
  });
  return rec;
}

/** Estimated GPU bytes of a texture (compressed mip data when present, else RGBA8 with mips). */
export function estimateTextureBytes(tex: THREE.Texture): number {
  const mips = (tex as THREE.CompressedTexture).isCompressedTexture ? (tex as THREE.CompressedTexture).mipmaps : null;
  if (mips && mips.length) {
    let s = 0;
    for (const m of mips) s += (m as { data?: ArrayBufferView }).data?.byteLength ?? 0;
    if (s > 0) return s;
    const img = tex.image as { width?: number; height?: number } | null;
    return compressedMipBytes(img?.width ?? 1, img?.height ?? 1);
  }
  const img = tex.image as { width?: number; height?: number } | null;
  if (!img?.width || !img.height) return 0;
  const mipmapped = tex.generateMipmaps || (tex.minFilter !== THREE.LinearFilter && tex.minFilter !== THREE.NearestFilter);
  return rgbaBytes(img.width, img.height, mipmapped);
}

/** Sum of the estimated GPU bytes of every distinct texture bound by materials under `root` (diagnostics). */
export function estimateSceneTextureBytes(root: THREE.Object3D): { bytes: number; count: number; largest: { name: string; bytes: number }[] } {
  const seen = new Set<THREE.Texture>();
  const visit = (v: unknown): void => {
    if (v && (v as THREE.Texture).isTexture) seen.add(v as THREE.Texture);
  };
  root.traverse(obj => {
    const mats = (obj as THREE.Mesh).material;
    if (!mats) return;
    for (const m of Array.isArray(mats) ? mats : [mats]) {
      for (const val of Object.values(m)) visit(val);
      const uniforms = (m as THREE.ShaderMaterial).uniforms;
      if (uniforms) for (const u of Object.values(uniforms)) visit(u?.value);
    }
  });
  const list = [...seen].map(t => ({ name: t.name || (t.image as { width?: number } | null)?.width?.toString() || t.uuid.slice(0, 8), bytes: estimateTextureBytes(t) }));
  list.sort((a, b) => b.bytes - a.bytes);
  return { bytes: list.reduce((s, e) => s + e.bytes, 0), count: list.length, largest: list.slice(0, 12) };
}

function baseUrl(): string {
  try {
    return import.meta.env?.BASE_URL ?? '/';
  } catch {
    return '/';
  }
}

export class TextureManager {
  private renderer: THREE.WebGLRenderer | null = null;
  private rendererWaiters: Array<(ok: boolean) => void> = [];
  private ktx2: KTX2Loader | null = null;
  private ktx2Supported: boolean | null = null;
  private manifestPromise: Promise<Ktx2Manifest | null> | null = null;
  private readonly ktxCache = new Map<string, Promise<THREE.Texture | null>>();
  private readonly managed = new Map<THREE.Texture, number>();
  private readonly residents: Resident[] = [];
  private readonly queue: QueuedUpload[] = [];
  private budget = HD_BUDGET_BYTES.high;
  private raf = 0;
  private disposed = false;
  private nextId = 1;
  private pendingCount = 0;
  private idleWaiters: Array<() => void> = [];
  private readonly s = {
    ktx2Loaded: 0, ktx2Failed: 0, fallbackLoaded: 0, evictions: 0, restores: 0, uploads: 0,
    maxUploadMs: 0, lastUploadMs: 0, totalUploadMs: 0, maxTranscodeMs: 0,
  };

  constructor(private readonly assets: AssetLoader) {}

  attachRenderer(renderer: THREE.WebGLRenderer): void {
    if (this.renderer === renderer) return;
    this.renderer = renderer;
    const waiters = this.rendererWaiters;
    this.rendererWaiters = [];
    for (const w of waiters) w(true);
    this.ensureLoop();
  }

  /** Resolves true once a renderer is attached (false after `timeoutMs`). */
  private whenRenderer(timeoutMs = 4000): Promise<boolean> {
    if (this.renderer) return Promise.resolve(true);
    return new Promise(resolve => {
      // Until the engine attaches its renderer explicitly, also look at the published engine handle (window.__cosmos).
      const poll = setInterval(() => {
        const r = (globalThis as { __cosmos?: { engine?: { services?: { renderer?: THREE.WebGLRenderer } } } }).__cosmos?.engine?.services?.renderer;
        if (r && typeof r.initTexture === 'function') this.attachRenderer(r);
      }, 100);
      const t = setTimeout(() => { clearInterval(poll); resolve(false); }, timeoutMs);
      this.rendererWaiters.push(ok => { clearTimeout(t); clearInterval(poll); resolve(ok); });
    });
  }

  setQuality(q: QualityProfile['textureQuality']): void {
    this.budget = HD_BUDGET_BYTES[q] ?? HD_BUDGET_BYTES.high;
  }

  private url(path: string): string {
    const u = (this.assets as { url?: (p: string) => string }).url;
    if (u) return u(path);
    const b = baseUrl();
    return (b.endsWith('/') ? b : `${b}/`) + path.replace(/^\/+/, '');
  }

  private manifest(): Promise<Ktx2Manifest | null> {
    // '?ktx2=0' in the page URL disables the compressed path (A/B comparisons, debugging).
    const off = typeof location !== 'undefined' && /[?&]ktx2=0(?:&|$)/.test(location.search);
    this.manifestPromise ??= off ? Promise.resolve(null) : this.assets.json<unknown>(KTX2_MANIFEST_PATH).then(parseKtx2Manifest, () => null);
    return this.manifestPromise;
  }

  /** The KTX2 twin of a source path ('<path>' or '<path>@<width>'), or null. */
  async ktx2Entry(path: string): Promise<Ktx2Entry | null> {
    const m = await this.manifest();
    return m?.entries.get(normalizeKey(path)) ?? null;
  }

  private loader(): KTX2Loader | null {
    if (this.ktx2 || this.ktx2Supported === false) return this.ktx2;
    const r = this.renderer;
    if (!r) return null;
    try {
      const l = new KTX2Loader();
      l.setTranscoderPath(this.url('basis/'));
      l.setWorkerLimit(2);
      l.detectSupport(r);
      const cfg = (l as unknown as { workerConfig?: Record<string, boolean> }).workerConfig ?? {};
      this.ktx2Supported = !!(cfg.bptcSupported || cfg.astcSupported || cfg.etc2Supported || cfg.dxtSupported);
      if (!this.ktx2Supported) { l.dispose(); return null; }
      this.ktx2 = l;
    } catch {
      this.ktx2Supported = false;
    }
    return this.ktx2;
  }

  private track<T>(p: Promise<T>): Promise<T> {
    this.pendingCount++;
    const done = (): void => {
      if (--this.pendingCount === 0) {
        const w = this.idleWaiters;
        this.idleWaiters = [];
        for (const f of w) f();
      }
    };
    p.then(done, done);
    return p;
  }

  /** Resolves when no load or upload is in flight (screenshot tooling). */
  idle(): Promise<void> {
    if (this.pendingCount === 0 && this.queue.length === 0) return Promise.resolve();
    return new Promise(resolve => this.idleWaiters.push(resolve));
  }

  /**
   * The KTX2 version of `path` (configured, uploaded), or null when there is none, it is stale, the GPU cannot
   * transcode it or loading failed. Callers fall back to their image path on null.
   */
  loadKtx2(path: string, opts: ManagedTextureOptions): Promise<THREE.Texture | null> {
    const key = `${opts.colorSpace}|${opts.wrap ?? 'equirect'}|${normalizeKey(path)}`;
    let p = this.ktxCache.get(key);
    if (!p) {
      p = this.track(this.fetchKtx2(path, opts));
      this.ktxCache.set(key, p);
      p.then(t => {
        if (!t) { this.ktxCache.delete(key); return; }
        t.addEventListener('dispose', () => {
          if (this.ktxCache.get(key) === p) this.ktxCache.delete(key);
          this.managed.delete(t);
        });
      }, () => this.ktxCache.delete(key));
    }
    return p;
  }

  private async fetchKtx2(path: string, opts: ManagedTextureOptions): Promise<THREE.Texture | null> {
    const entry = await this.ktx2Entry(path);
    if (!entry || this.disposed) return null;
    if (!(await this.whenRenderer())) return null;
    const loader = this.loader();
    if (!loader) return null;
    const release = await this.acquireDecode(opts);
    try {
      const srcPath = normalizeKey(path).replace(/@\d+$/, '');
      const [res, fresh] = await Promise.all([fetch(this.url(entry.ktx2)), this.sourceUnchanged(srcPath, entry)]);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      if (!fresh) {
        console.warn(`[cosmos] ${entry.ktx2} is older than ${srcPath}; using the image (rerun scripts/data/textures-ktx2/convert.mjs)`);
        void res.body?.cancel();
        return null;
      }
      const buf = await res.arrayBuffer();
      if (this.disposed) return null;
      const t0 = performance.now();
      const tex = await new Promise<THREE.CompressedTexture>((resolve, reject) => {
        void loader.parse(buf, t => resolve(t as THREE.CompressedTexture), reject);
      });
      this.s.maxTranscodeMs = Math.max(this.s.maxTranscodeMs, performance.now() - t0);
      if (entry.skipLevels > 0 && tex.mipmaps.length > entry.skipLevels) {
        // A downscaled tier served from a larger file: drop the top levels before anything reaches the GPU.
        tex.mipmaps = tex.mipmaps.slice(entry.skipLevels);
        const m0 = tex.mipmaps[0] as { width: number; height: number };
        tex.image = { width: m0.width, height: m0.height } as unknown as typeof tex.image;
      }
      tex.name = path;
      this.configure(tex, opts, true);
      this.managed.set(tex, estimateTextureBytes(tex));
      await this.upload(tex, opts.priority ?? 0);
      this.s.ktx2Loaded++;
      return tex;
    } catch (err) {
      this.s.ktx2Failed++;
      console.warn(`[cosmos] KTX2 ${entry.ktx2} unavailable, using the image:`, err);
      return null;
    } finally {
      release();
    }
  }

  private decodeActive = 0;
  private decodeWaiters: Array<{ opts: ManagedTextureOptions; go: () => void }> = [];

  /** At most two fetch+transcode jobs at once; the next one started is a preview tier, else the most on-screen body. */
  private acquireDecode(opts: ManagedTextureOptions): Promise<() => void> {
    const release = (): void => {
      this.decodeActive--;
      let best = -1;
      let bestScore = -Infinity;
      for (let i = 0; i < this.decodeWaiters.length; i++) {
        const o = this.decodeWaiters[i].opts;
        const score = (o.priority ?? 0) * 1e9 + (o.wanted?.() ?? 0);
        if (score > bestScore) { bestScore = score; best = i; }
      }
      if (best >= 0) this.decodeWaiters.splice(best, 1)[0].go();
    };
    if (this.decodeActive < 2) {
      this.decodeActive++;
      return Promise.resolve(release);
    }
    return new Promise(resolve => this.decodeWaiters.push({ opts, go: () => { this.decodeActive++; resolve(release); } }));
  }

  /** HEAD the source image: a size different from the one converted means the KTX2 is stale. */
  private async sourceUnchanged(srcPath: string, entry: Ktx2Entry): Promise<boolean> {
    if (!entry.srcBytes) return true;
    try {
      const res = await fetch(this.url(srcPath), { method: 'HEAD' });
      const len = Number(res.headers.get('content-length'));
      return !res.ok || !len || len === entry.srcBytes;
    } catch {
      return true;
    }
  }

  /** KTX2 when available, else the AssetLoader image; configured and uploaded (spread across frames) either way. */
  async load(path: string, opts: ManagedTextureOptions): Promise<THREE.Texture> {
    const k = await this.loadKtx2(path, opts);
    if (k) return k;
    const tex = await this.track(this.assets.textureAsync(path, { colorSpace: opts.colorSpace, anisotropy: opts.anisotropy ?? 16 }));
    this.configure(tex, opts, false);
    if (!this.managed.has(tex)) {
      this.managed.set(tex, estimateTextureBytes(tex));
      tex.addEventListener('dispose', () => this.managed.delete(tex));
      this.s.fallbackLoaded++;
    }
    await this.upload(tex, opts.priority ?? 0);
    return tex;
  }

  private configure(tex: THREE.Texture, opts: ManagedTextureOptions, compressed: boolean): void {
    const clamp = opts.wrap === 'clamp';
    const maxAniso = this.renderer?.capabilities.getMaxAnisotropy() ?? 1;
    const aniso = clamp ? 1 : Math.max(1, Math.min(opts.anisotropy ?? 16, maxAniso, 16));
    const cs = opts.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    const wrapS = clamp ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    const mipmapped = compressed ? (tex as THREE.CompressedTexture).mipmaps.length > 1 : true;
    const minFilter = mipmapped ? THREE.LinearMipmapLinearFilter : THREE.LinearFilter;
    // Only flag a re-upload when something actually changed (a shared, already-uploaded image stays put).
    const changed = tex.colorSpace !== cs || tex.wrapS !== wrapS || tex.wrapT !== THREE.ClampToEdgeWrapping || tex.anisotropy !== aniso
      || tex.minFilter !== minFilter || tex.magFilter !== THREE.LinearFilter || (!compressed && !tex.generateMipmaps);
    tex.colorSpace = cs;
    tex.wrapS = wrapS;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.anisotropy = aniso;
    tex.minFilter = minFilter;
    tex.magFilter = THREE.LinearFilter;
    if (compressed) {
      tex.generateMipmaps = false;
      tex.flipY = false; // orientation is baked into the file (bottom-left texcoord origin)
    } else {
      tex.generateMipmaps = true;
    }
    if (changed || compressed) tex.needsUpdate = true;
  }

  /** Queue the GPU upload; resolves after renderer.initTexture() ran in an animation frame. */
  private upload(tex: THREE.Texture, priority: number): Promise<void> {
    if (!this.renderer || typeof requestAnimationFrame !== 'function') return Promise.resolve();
    return new Promise(resolve => {
      this.queue.push({ tex, priority, resolve });
      this.queue.sort((a, b) => b.priority - a.priority);
      this.ensureLoop();
    });
  }

  private ensureLoop(): void {
    if (this.raf || this.disposed || typeof requestAnimationFrame !== 'function') return;
    const step = (): void => {
      this.raf = 0;
      if (this.disposed) return;
      frameNo++;
      this.drainUploads();
      if (frameNo % TICK_FRAMES === 0) this.tickResidency();
      this.raf = requestAnimationFrame(step);
    };
    this.raf = requestAnimationFrame(step);
  }

  private drainUploads(): void {
    const r = this.renderer;
    if (!r || !this.queue.length) return;
    const t0 = performance.now();
    let first = true;
    while (this.queue.length && (first || performance.now() - t0 < UPLOAD_BUDGET_MS)) {
      const job = this.queue.shift()!;
      const t = performance.now();
      try {
        r.initTexture(job.tex);
      } catch {
        /* the next draw retries the upload */
      }
      const ms = performance.now() - t;
      this.s.uploads++;
      this.s.lastUploadMs = ms;
      this.s.totalUploadMs += ms;
      this.s.maxUploadMs = Math.max(this.s.maxUploadMs, ms);
      job.resolve();
      first = false;
    }
    if (!this.queue.length && this.pendingCount === 0) {
      const w = this.idleWaiters;
      this.idleWaiters = [];
      for (const f of w) f();
    }
  }

  /**
   * Register an HD tier that may be dropped back to `hooks.preview` under VRAM pressure. Returns an unregister
   * function. The texture's draws are tracked from now on.
   */
  register(tex: THREE.Texture, hooks: ResidencyHooks): () => void {
    const rec: Resident = {
      id: this.nextId++, bytes: estimateTextureBytes(tex), lastUsed: frameNo, priority: null, evicted: false, tex, hooks, restoring: false,
    };
    trackUsage(tex);
    trackUsage(hooks.preview);
    this.residents.push(rec);
    this.ensureLoop();
    return () => this.drop(rec, false);
  }

  private drop(rec: Resident, disposeTex: boolean): void {
    const i = this.residents.indexOf(rec);
    if (i >= 0) this.residents.splice(i, 1);
    if (disposeTex && rec.evicted === false) rec.tex.dispose();
  }

  private tickResidency(): void {
    if (!this.residents.length) return;
    for (const r of [...this.residents]) {
      if (!r.hooks.alive()) {
        // Superseded by a better tier (or the owner went away): free the GPU copy unless it is still shown.
        const shown = frameNo - (usage.get(r.tex)?.lastUsed ?? -1) <= TICK_FRAMES;
        this.drop(r, !shown && !r.evicted);
        continue;
      }
      const tracked = r.evicted ? r.hooks.preview : r.tex;
      r.lastUsed = usage.get(tracked)?.lastUsed ?? r.lastUsed;
      r.priority = r.hooks.screenPx ? r.hooks.screenPx() : null;
    }
    for (const r of chooseEvictions(this.residents, this.budget, frameNo)) {
      try {
        r.hooks.evict();
      } catch {
        continue;
      }
      r.tex.dispose();
      r.evicted = true;
      this.s.evictions++;
    }
    const back = chooseRestore(this.residents, this.budget, frameNo);
    if (back && !back.restoring) {
      back.restoring = true;
      void back.hooks.restore().then(t => {
        back.restoring = false;
        if (!t || !this.residents.includes(back)) return;
        back.tex = t;
        back.bytes = estimateTextureBytes(t);
        back.evicted = false;
        back.lastUsed = frameNo;
        trackUsage(t);
        this.s.restores++;
      }, () => { back.restoring = false; });
    }
  }

  stats(): TextureManagerStats {
    let managedBytes = 0;
    for (const b of this.managed.values()) managedBytes += b;
    return {
      ktx2Supported: this.ktx2Supported,
      ...this.s,
      managedBytes,
      residentHdBytes: this.residents.reduce((s, r) => s + (r.evicted ? 0 : r.bytes), 0),
      budgetBytes: this.budget,
      residents: this.residents.length,
      evicted: this.residents.filter(r => r.evicted).length,
      uploadQueue: this.queue.length,
      pending: this.pendingCount,
    };
  }

  dispose(): void {
    this.disposed = true;
    if (this.raf && typeof cancelAnimationFrame === 'function') cancelAnimationFrame(this.raf);
    this.raf = 0;
    for (const q of this.queue) q.resolve();
    this.queue.length = 0;
    this.residents.length = 0;
    this.ktx2?.dispose();
    this.ktx2 = null;
  }
}

const managers = new WeakMap<AssetLoader, TextureManager>();

/**
 * The manager for an AssetLoader (one per engine). Pass the renderer whenever you have it: KTX2 loads wait (briefly)
 * until some caller has attached one, then fall back to images.
 */
export function getTextureManager(assets: AssetLoader, renderer?: THREE.WebGLRenderer | null): TextureManager {
  let m = managers.get(assets);
  if (!m) {
    m = new TextureManager(assets);
    managers.set(assets, m);
    if (typeof window !== 'undefined') {
      const mgr = m;
      (window as unknown as { __cosmosTextures?: unknown }).__cosmosTextures = {
        stats: () => mgr.stats(),
        idle: () => mgr.idle(),
        estimate: (root: THREE.Object3D) => estimateSceneTextureBytes(root),
      };
    }
  }
  if (renderer) m.attachRenderer(renderer);
  return m;
}
