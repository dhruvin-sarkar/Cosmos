/**
 * Frame instrumentation (docs/ARCHITECTURE.md §14): CPU and GPU frame time, worst frame per second,
 * renderer.info counters, JS heap and long tasks.
 *
 * GPU time uses EXT_disjoint_timer_query_webgl2. Queries are read back asynchronously a few frames later
 * (never blocking the pipeline); a small ring of query objects keeps at most one per frame in flight.
 * Results from frames where the GPU reports a disjoint event are discarded.
 */
import type * as THREE from 'three';
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
      frameStart = nowMs;
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
