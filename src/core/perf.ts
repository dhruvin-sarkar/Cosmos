/**
 * Frame instrumentation (docs/ARCHITECTURE.md §14): CPU and GPU frame time, worst frame per second,
 * renderer.info counters, JS heap and long tasks.
 *
 * GPU time uses EXT_disjoint_timer_query_webgl2. Queries are read back asynchronously a few frames later
 * (never blocking the pipeline); a small ring of query objects keeps at most one per frame in flight.
 * Results from frames where the GPU reports a disjoint event are discarded.
 */
import * as THREE from 'three';
import type { PerfSnapshot } from './types';

const QUERY_RING = 6;
const WINDOW_MS = 1000;
const FPS_EMA_MS = 500;

interface TimerExt {
  TIME_ELAPSED_EXT: number;
  GPU_DISJOINT_EXT: number;
}

interface PendingQuery {
  query: WebGLQuery;
  busy: boolean;
}

interface PerformanceMemory {
  usedJSHeapSize: number;
}

export interface PerfMonitor {
  /** Call right before rendering the frame (starts CPU timer and GPU query). */
  beginFrame(nowMs: number): void;
  /** Call right after rendering (ends GPU query, records CPU time). */
  endFrame(nowMs: number): void;
  /** Main-thread ms of the last frame (update + render submission). */
  readonly lastCpuMs: number;
  /** Latest GPU frame time, ms (null when no timer extension). */
  readonly lastGpuMs: number | null;
  /** Real interval between the last two frames, ms. */
  readonly lastIntervalMs: number;
  readonly gpuTimer: boolean;
  setScaleInfo(pixelRatio: number, renderScale: number): void;
  snapshot(): PerfSnapshot;
  dispose(): void;
}

export function createPerfMonitor(renderer: THREE.WebGLRenderer): PerfMonitor {
  const gl = renderer.getContext() as WebGL2RenderingContext;
  let ext: TimerExt | null = null;
  try {
    ext = (gl.getExtension('EXT_disjoint_timer_query_webgl2') as TimerExt | null) ?? null;
  } catch {
    ext = null;
  }
  const ring: PendingQuery[] = [];
  const inFlight: PendingQuery[] = [];
  let active: PendingQuery | null = null;
  if (ext && typeof gl.createQuery === 'function') {
    for (let i = 0; i < QUERY_RING; i++) {
      const q = gl.createQuery();
      if (q) ring.push({ query: q, busy: false });
    }
  }

  // Worst frame in a sliding 1 s window: circular buffer of (time, interval).
  const winT = new Float64Array(256);
  const winV = new Float64Array(256);
  let winHead = 0;
  let winLen = 0;

  let frameStart = 0;
  let lastFrameEnd = 0;
  let lastBegin = 0;
  let cpuMs = 0;
  let gpuMs: number | null = null;
  let intervalMs = 16.7;
  let fps = 0;
  let longTasks = 0;
  let pixelRatio = 1;
  let renderScale = 1;

  let observer: PerformanceObserver | null = null;
  try {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      observer = new PerformanceObserver(list => {
        longTasks += list.getEntries().length;
      });
      observer.observe({ type: 'longtask', buffered: false });
    }
  } catch {
    observer = null;
  }

  const pollQueries = (): void => {
    if (!ext || inFlight.length === 0) return;
    const disjoint = gl.getParameter(ext.GPU_DISJOINT_EXT) as boolean;
    while (inFlight.length > 0) {
      const p = inFlight[0];
      const available = gl.getQueryParameter(p.query, gl.QUERY_RESULT_AVAILABLE) as boolean;
      if (!available) break;
      const ns = gl.getQueryParameter(p.query, gl.QUERY_RESULT) as number;
      if (!disjoint) gpuMs = ns / 1e6;
      p.busy = false;
      inFlight.shift();
    }
  };

  const pushWindow = (t: number, v: number): void => {
    const i = (winHead + winLen) % winT.length;
    winT[i] = t;
    winV[i] = v;
    if (winLen < winT.length) winLen++;
    else winHead = (winHead + 1) % winT.length;
    while (winLen > 0 && t - winT[winHead] > WINDOW_MS) {
      winHead = (winHead + 1) % winT.length;
      winLen--;
    }
  };

  const worst = (): number => {
    let w = 0;
    for (let k = 0; k < winLen; k++) {
      const v = winV[(winHead + k) % winT.length];
      if (v > w) w = v;
    }
    return w;
  };

  return {
    get lastCpuMs() {
      return cpuMs;
    },
    get lastGpuMs() {
      return gpuMs;
    },
    get lastIntervalMs() {
      return intervalMs;
    },
    gpuTimer: ring.length > 0,

    beginFrame(nowMs: number): void {
      if (lastBegin > 0) {
        intervalMs = Math.max(0.1, nowMs - lastBegin);
        const a = 1 - Math.exp(-intervalMs / FPS_EMA_MS);
        const inst = 1000 / intervalMs;
        fps = fps === 0 ? inst : fps + (inst - fps) * a;
        pushWindow(nowMs, intervalMs);
      }
      lastBegin = nowMs;
      // Main-thread cost starts when the engine callback runs, not at the rAF timestamp (which can lag it).
      frameStart = performance.now();
      pollQueries();
      if (ext && !active) {
        const free = ring.find(p => !p.busy);
        if (free) {
          gl.beginQuery(ext.TIME_ELAPSED_EXT, free.query);
          free.busy = true;
          active = free;
        }
      }
    },

    endFrame(nowMs: number): void {
      if (ext && active) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        inFlight.push(active);
        active = null;
      }
      cpuMs = nowMs - frameStart;
      lastFrameEnd = nowMs;
    },

    setScaleInfo(pr: number, rs: number): void {
      pixelRatio = pr;
      renderScale = rs;
    },

    snapshot(): PerfSnapshot {
      const info = renderer.info;
      const mem = (performance as Performance & { memory?: PerformanceMemory }).memory;
      return {
        fps: Math.round(fps * 10) / 10,
        cpuFrameMs: Math.round(cpuMs * 100) / 100,
        gpuFrameMs: gpuMs === null ? null : Math.round(gpuMs * 100) / 100,
        worstFrameMs: Math.round(worst() * 10) / 10,
        drawCalls: info.render.calls,
        triangles: info.render.triangles,
        points: info.render.points,
        lines: info.render.lines,
        textures: info.memory.textures,
        geometries: info.memory.geometries,
        jsHeapMB: mem ? Math.round(mem.usedJSHeapSize / 1048576) : null,
        longTasks,
        pixelRatio,
        renderScale,
      };
    },

    dispose(): void {
      observer?.disconnect();
      if (active && ext) {
        try {
          gl.endQuery(ext.TIME_ELAPSED_EXT);
        } catch {
          /* context may be lost */
        }
      }
      for (const p of ring) gl.deleteQuery(p.query);
      ring.length = 0;
      inFlight.length = 0;
    },
  };
}

/**
 * Debug/automation handle published as `window.__cosmos` (used by tools/shot.mjs, perf tooling and the
 * debug overlay). `ready` resolves after the first rendered frame; `perf()` returns a fresh PerfSnapshot.
 * Commands are the same AppCommands the UI uses, so scripts can drive the app exactly like a visitor:
 *   await __cosmos.ready; __cosmos.commands.setScale(12); __cosmos.perf().fps
 */
export interface CosmosDebugHandle {
  ready: Promise<void>;
  engine: unknown;
  store: unknown;
  registry: unknown;
  commands: unknown;
  time: unknown;
  perf(): PerfSnapshot | null;
}

declare global {
  interface Window {
    __cosmos?: CosmosDebugHandle;
  }
}

export function exposeDebugHandle(handle: CosmosDebugHandle): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.__cosmos = handle;
  return () => {
    if (window.__cosmos === handle) delete window.__cosmos;
  };
}

/**
 * Idle-time shader warm-up. three.js compiles a material's program the first time it is drawn, which on ANGLE/D3D11
 * stalls that frame for 100-1000 ms (HLSL translation + link) - the hitches seen when a travel reveals a new body.
 * Every WARM_INTERVAL_MS this scans the scene for materials that have never been compiled (hidden objects, lazily
 * built layers) and compiles a few with renderer.compileAsync, which uses KHR_parallel_shader_compile so the main
 * thread never waits on the link. Programs are keyed for the HDR scene target (linear output, no tone mapping),
 * exactly as RenderPass will request them.
 *
 * gate() (call right before rendering) covers objects that appear without warning (built lazily when the camera enters
 * their range): any visible object whose program does not exist yet or is still linking is kept out of the camera's
 * layer mask until KHR_parallel_shader_compile reports it complete, so it pops in a few frames later instead of
 * freezing the frame. Objects whose programs are ready are untouched (one WeakMap lookup per material per frame).
 */
export interface ShaderWarmup {
  tick(nowMs: number): void;
  /** Hold back visible objects whose shader programs are not linked yet (call before rendering). */
  gate(nowMs: number): void;
  /** Objects currently held back (diagnostics). */
  readonly gated: number;
  /** Materials warmed so far (diagnostics). */
  readonly warmed: number;
  dispose(): void;
}

const WARM_INTERVAL_MS = 250;
const WARM_BATCH = 24;
/** Main-thread budget per warm-up tick (shader source assembly + compile/link submission). */
const WARM_BUDGET_MS = 4;
/** Layer bit no camera enables: a gated object is excluded from rendering and picking while it compiles. */
const GATE_LAYER = 31;
/** Give up waiting (render normally, compiling synchronously if need be) after this long. */
const GATE_TIMEOUT_MS = 4000;
/**
 * Gate from the first frame: at boot every program is then created up front and linked in parallel by ANGLE's worker
 * threads behind the boot screen (engine.ts holds `ready` until nothing is gated), instead of three.js linking them one
 * by one on first draw (each first use blocks on getActiveUniform: ~5 s of a 7 s boot).
 */
const GATE_AFTER_MS = 0;

type ProgramLike = { isReady?: () => boolean };

export function createShaderWarmup(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): ShaderWarmup {
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false });
  const tried = new WeakSet<THREE.Material>();
  const batch: THREE.Object3D[] = [];
  let nextMs = 0;
  let pending = false;
  let warmed = 0;
  let disposed = false;
  let gateFrom = -1;
  /** Gated object -> [saved layer mask, deadline]. */
  const gatedObjs = new Map<THREE.Object3D, [number, number]>();
  const toCompile: THREE.Object3D[] = [];
  let gateNow = 0;

  /** Material version a program was last (re)requested for by the gate (needsUpdate -> possibly a new variant). */
  const compiledVersion = new WeakMap<THREE.Material, number>();
  /** 0 ready, 1 still linking, 2 no program yet, 3 changed since its last draw (needsUpdate; may need a new variant). */
  const matState = (m: THREE.Material): number => {
    const props = renderer.properties.get(m) as { currentProgram?: ProgramLike; __version?: number };
    const p = props.currentProgram;
    if (p === undefined) return 2;
    if (props.__version !== undefined && props.__version !== m.version && compiledVersion.get(m) !== m.version) return 3;
    return p.isReady !== undefined && !p.isReady() ? 1 : 0;
  };
  const stateOf = (o: THREE.Object3D): number => {
    const mat = (o as THREE.Mesh).material;
    if (!Array.isArray(mat)) return matState(mat as THREE.Material);
    let st = 0;
    for (const m of mat) {
      const s = matState(m);
      if (s === 2) return 2;
      if (s > st) st = s;
    }
    return st;
  };
  const materialsOf = (o: THREE.Object3D): THREE.Material[] => {
    const mat = (o as THREE.Mesh).material;
    return Array.isArray(mat) ? mat : [mat as THREE.Material];
  };
  const gateVisit = (o: THREE.Object3D): void => {
    const r = o as THREE.Mesh;
    if (!r.material || !(r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite)) return;
    if (gatedObjs.has(o) || (o.layers.mask & (1 << GATE_LAYER)) !== 0) return;
    let st = stateOf(o);
    if (st === 3) {
      // A material changed (side, defines, ...): request its program now (non-blocking) and gate only if it is a new
      // variant still linking; otherwise its first draw would link it synchronously (aurora side flip: 140 ms).
      for (const m of materialsOf(o)) compiledVersion.set(m, m.version);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try {
        renderer.compile(o, camera, scene);
      } catch {
        /* rendered (and compiled) normally */
      } finally {
        renderer.setRenderTarget(prev);
      }
      st = stateOf(o);
      if (st === 3) return;
    }
    if (st === 0) return;
    gatedObjs.set(o, [o.layers.mask, gateNow + GATE_TIMEOUT_MS]);
    o.layers.mask = 1 << GATE_LAYER;
    if (st === 2) toCompile.push(o);
  };

  const uncompiled = (m: THREE.Material): boolean => !tried.has(m) && (renderer.properties.get(m) as { currentProgram?: unknown }).currentProgram === undefined;
  const visit = (o: THREE.Object3D): void => {
    if (batch.length >= WARM_BATCH) return;
    const r = o as THREE.Mesh;
    if (!(r.isMesh || (o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as THREE.Sprite).isSprite) || !r.material) return;
    const mats = Array.isArray(r.material) ? r.material : [r.material];
    if (mats.some(uncompiled)) batch.push(o);
  };

  return {
    get warmed() {
      return warmed;
    },
    get gated() {
      return gatedObjs.size;
    },
    gate(nowMs: number): void {
      if (disposed) return;
      if (gateFrom < 0) gateFrom = nowMs + GATE_AFTER_MS;
      if (nowMs < gateFrom) return;
      // Release objects whose programs finished linking (or that waited too long).
      for (const [o, [mask, deadline]] of gatedObjs) {
        if (o.parent === null || nowMs > deadline || stateOf(o) === 0) {
          if (o.layers.mask === 1 << GATE_LAYER) o.layers.mask = mask;
          gatedObjs.delete(o);
        }
      }
      gateNow = nowMs;
      scene.traverseVisible(gateVisit);
      if (toCompile.length === 0) return;
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      try {
        // Creates the programs (non-blocking with KHR_parallel_shader_compile); readiness is polled above.
        for (const o of toCompile) {
          const mats = Array.isArray((o as THREE.Mesh).material) ? ((o as THREE.Mesh).material as THREE.Material[]) : [(o as THREE.Mesh).material as THREE.Material];
          for (const m of mats) tried.add(m);
          warmed += mats.length;
          void renderer.compileAsync(o, camera, scene).catch(() => undefined);
        }
      } catch (err) {
        console.warn('[cosmos] shader gate compile failed', err);
      } finally {
        renderer.setRenderTarget(prev);
        toCompile.length = 0;
      }
    },
    tick(nowMs: number): void {
      if (pending || disposed || nowMs < nextMs) return;
      nextMs = nowMs + WARM_INTERVAL_MS;
      batch.length = 0;
      scene.traverse(visit);
      if (batch.length === 0) return;
      const prev = renderer.getRenderTarget();
      const jobs: Promise<unknown>[] = [];
      renderer.setRenderTarget(target);
      try {
        const t0 = performance.now();
        for (const o of batch) {
          if (performance.now() - t0 > WARM_BUDGET_MS) break;
          const mats = Array.isArray((o as THREE.Mesh).material) ? ((o as THREE.Mesh).material as THREE.Material[]) : [(o as THREE.Mesh).material as THREE.Material];
          for (const m of mats) tried.add(m);
          // compileAsync's synchronous part (program creation) runs now, under the HDR target binding.
          jobs.push(renderer.compileAsync(o, camera, scene));
          warmed += mats.length;
        }
      } catch (err) {
        console.warn('[cosmos] shader warm-up failed', err);
      } finally {
        renderer.setRenderTarget(prev);
      }
      batch.length = 0;
      pending = true;
      const done = (): void => {
        pending = false;
      };
      void Promise.race([Promise.all(jobs), new Promise(r => setTimeout(r, 5000))]).then(done, done);
    },
    dispose(): void {
      disposed = true;
      for (const [o, [mask]] of gatedObjs) if (o.layers.mask === 1 << GATE_LAYER) o.layers.mask = mask;
      gatedObjs.clear();
      target.dispose();
    },
  };
}

/**
 * Pre-compile the programs of a scene a layer renders itself (off-screen passes are invisible to the idle warm-up and
 * the gate, so their first render links synchronously: the galaxy-volume march was a 130 ms freeze on the first Milky
 * Way view). Programs are created now under `target` (any non-XR render target: linear output, no tone mapping) and
 * link in parallel (KHR_parallel_shader_compile). The returned poll is true once every program is linked; skip the
 * pass until then. Call it after the scene's materials are final (defines/side changes create new variants).
 */
export function precompileOffscreen(renderer: THREE.WebGLRenderer, scene: THREE.Object3D, camera: THREE.Camera, target: THREE.WebGLRenderTarget): () => boolean {
  let mats: Set<THREE.Material>;
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(target);
  try {
    mats = renderer.compile(scene, camera);
  } catch (err) {
    console.warn('[cosmos] off-screen precompile failed', err);
    return () => true;
  } finally {
    renderer.setRenderTarget(prev);
  }
  let ready = false;
  return () => {
    if (ready) return true;
    for (const m of mats) {
      const p = (renderer.properties.get(m) as { currentProgram?: ProgramLike }).currentProgram;
      if (p?.isReady !== undefined && !p.isReady()) return false;
    }
    ready = true;
    return true;
  };
}

/**
 * Upload a large image texture to the GPU in horizontal slices spread over several frames, instead of the single
 * texSubImage2D three.js issues on first use (an uncompressed 8K map blocks the main thread for 80-180 ms; a 4K one
 * 30-60 ms). Returns a texture with the same sampling state whose storage is already filled (mipmaps generated
 * once at the end); disposing it also disposes `src`. Small, compressed or non-image textures are returned as is.
 */
export async function sliceUpload(
  renderer: THREE.WebGLRenderer,
  src: THREE.Texture,
  opts: { maxBytesPerSlice?: number; nextFrame?: () => Promise<void> } = {},
): Promise<THREE.Texture> {
  const img = src.image as { width?: number; height?: number } | null;
  const w = img?.width ?? 0;
  const h = img?.height ?? 0;
  // ImageBitmaps only: they ignore UNPACK_FLIP_Y (already oriented at decode), so slice rows map 1:1.
  const isImage = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
  if (!isImage || (src as THREE.CompressedTexture).isCompressedTexture || w * h < 2048 * 2048) return src;
  const nextFrame = opts.nextFrame ?? ((): Promise<void> => new Promise(r => requestAnimationFrame(() => r())));
  const rows = Math.max(16, Math.floor((opts.maxBytesPerSlice ?? 4 * 1024 * 1024) / (w * 4)));

  const dst = new THREE.DataTexture(null, w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
  dst.source.dataReady = false; // allocate storage only; the slices fill it
  dst.colorSpace = src.colorSpace;
  dst.wrapS = src.wrapS;
  dst.wrapT = src.wrapT;
  dst.magFilter = src.magFilter;
  dst.minFilter = src.minFilter;
  dst.anisotropy = src.anisotropy;
  dst.flipY = src.flipY;
  dst.premultiplyAlpha = src.premultiplyAlpha;
  dst.unpackAlignment = src.unpackAlignment;
  const mips = src.generateMipmaps && src.minFilter !== THREE.NearestFilter && src.minFilter !== THREE.LinearFilter;
  dst.generateMipmaps = mips; // allocates the full mip chain; regenerated once the slices are in
  dst.name = src.name;
  dst.needsUpdate = true;
  renderer.initTexture(dst);

  const region = new THREE.Box2();
  const pos = new THREE.Vector2();
  for (let y = 0; y < h; y += rows) {
    const hh = Math.min(rows, h - y);
    region.min.set(0, y);
    region.max.set(w, y + hh);
    pos.set(0, y);
    renderer.copyTextureToTexture(src, dst, region, pos);
    await nextFrame();
  }
  if (mips) {
    const gl = renderer.getContext();
    const props = renderer.properties.get(dst) as { __webglTexture?: WebGLTexture };
    if (props.__webglTexture) {
      renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
      gl.generateMipmap(gl.TEXTURE_2D);
    }
  }
  dst.addEventListener('dispose', () => src.dispose());
  return dst;
}

/**
 * Upload a big compressed (KTX2-transcoded) texture in block-row slices over several frames instead of the single
 * initTexture() three.js does (an 8K BC7 map with mips is 40+ MB: 30-110 ms in one call mid-travel). three allocates the
 * immutable storage (dataReady = false skips its data upload); the mip levels are then filled with
 * compressedTexSubImage2D, ~maxBytesPerSlice per frame. Small or non-2D textures upload in one go as before.
 */
export async function sliceUploadCompressed(
  renderer: THREE.WebGLRenderer,
  tex: THREE.CompressedTexture,
  opts: { maxBytesPerSlice?: number; nextFrame?: () => Promise<void> } = {},
): Promise<void> {
  const mips = tex.mipmaps as Array<{ data: ArrayBufferView; width: number; height: number }> | undefined;
  const budget = opts.maxBytesPerSlice ?? 3 * 1024 * 1024;
  let total = 0;
  for (const m of mips ?? []) total += m.data?.byteLength ?? 0;
  const gl = renderer.getContext() as WebGL2RenderingContext;
  const twoD = !(tex as unknown as { isCompressedArrayTexture?: boolean }).isCompressedArrayTexture && !Array.isArray(tex.image);
  if (!mips?.length || !twoD || total <= budget * 2 || typeof gl.texStorage2D !== 'function') {
    renderer.initTexture(tex);
    return;
  }
  const nextFrame = opts.nextFrame ?? ((): Promise<void> => new Promise(r => requestAnimationFrame(() => r())));
  const glFormat = new THREE.WebGLUtils(gl, renderer.extensions).convert(tex.format, tex.colorSpace) as number | null;
  tex.source.dataReady = false; // allocate the storage only
  renderer.initTexture(tex);
  tex.source.dataReady = true; // later re-uploads (context restore) carry the data again
  const props = renderer.properties.get(tex) as { __webglTexture?: WebGLTexture };
  if (glFormat === null || !props.__webglTexture) {
    tex.needsUpdate = true;
    return;
  }
  let sent = 0;
  for (let level = 0; level < mips.length; level++) {
    const m = mips[level];
    const bh = Math.ceil(m.height / 4);
    const rowBytes = m.data.byteLength / bh; // one row of 4x4 blocks
    const rowsPer = Math.max(1, Math.floor(budget / rowBytes));
    const bytes = new Uint8Array(m.data.buffer, m.data.byteOffset, m.data.byteLength);
    for (let by = 0; by < bh; by += rowsPer) {
      const n = Math.min(rowsPer, bh - by);
      // Rebind every slice: three may have bound other textures to the unit since the last frame.
      renderer.state.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
      const y = by * 4, h = Math.min(n * 4, m.height - y);
      gl.compressedTexSubImage2D(gl.TEXTURE_2D, level, 0, y, m.width, h, glFormat, bytes.subarray(by * rowBytes, (by + n) * rowBytes));
      sent += n * rowBytes;
      if (sent >= budget) {
        sent = 0;
        await nextFrame();
      }
    }
  }
}
