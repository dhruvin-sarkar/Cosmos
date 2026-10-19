/**
 * Main-thread client of the propagation worker: holds the catalog metadata and the current element buffer
 * (ping-ponged with the worker, so steady state allocates nothing), schedules SGP4 refreshes around the sim time,
 * and evaluates single objects on the CPU (picking, lazily resolved entities) with the same Kepler step as the GPU.
 */
import type { Vector3 } from 'three';
import type { CatalogRow, ElementsMessage, MetaMessage, WorkerIn, WorkerOut } from './catalogTypes';
import { ELEMENT_STRIDE, elementsPosition, elementsVelocity } from './kepler';

/** Base refresh window (sim seconds): two-body drift from SGP4 stays ≲ 1 km in LEO over this span. */
const REFRESH_SEC = 90;

export class Population {
  meta: MetaMessage | null = null;
  elements: Float32Array | null = null;
  t0Ms = 0;
  /** Increments whenever `elements` changes (GPU upload trigger). */
  version = 0;
  lastCostMs = 0;
  failed = 0;
  error: string | null = null;
  private worker: Worker | null = null;
  private spare: Float32Array | null = null;
  private pending = false;
  private pendingSince = 0;
  private byNorad: Map<number, number> | null = null;
  private reqId = 0;
  private readonly rowWaiters = new Map<number, (r: CatalogRow | null) => void>();
  private readonly listeners = new Set<() => void>();
  private disposed = false;

  start(url: string): void {
    if (this.worker || this.disposed) return;
    try {
      this.worker = new Worker(new URL('./propagator.worker.ts', import.meta.url), { type: 'module' });
    } catch (err) {
      this.error = String(err);
      return;
    }
    this.worker.onmessage = (e: MessageEvent<WorkerOut>) => this.onMessage(e.data);
    this.worker.onerror = (e) => { this.error = e.message || 'worker error'; this.pending = false; };
    this.post({ type: 'init', url });
  }

  private post(msg: WorkerIn, transfer: Transferable[] = []): void {
    this.worker?.postMessage(msg, transfer);
  }

  private onMessage(msg: WorkerOut): void {
    if (this.disposed) return;
    if (msg.type === 'meta') {
      this.meta = msg;
      this.emit();
    } else if (msg.type === 'elements') {
      this.acceptElements(msg);
    } else if (msg.type === 'row') {
      const w = this.rowWaiters.get(msg.reqId);
      this.rowWaiters.delete(msg.reqId);
      w?.(msg.row);
    } else if (msg.type === 'error') {
      this.error = msg.message;
      this.pending = false;
      this.emit();
    }
  }

  private acceptElements(msg: ElementsMessage): void {
    this.pending = false;
    this.spare = this.elements;
    this.elements = msg.buf;
    this.t0Ms = msg.t0Ms;
    this.lastCostMs = msg.costMs;
    this.failed = msg.failed;
    this.version++;
    this.emit();
  }

  /** Per frame: request a refresh when the elements are missing or stale for the current sim time. */
  update(tMs: number, rate: number): void {
    if (!this.meta || this.disposed) return;
    const now = performance.now();
    if (this.pending && now - this.pendingSince < 4000) return;
    const window = Math.max(REFRESH_SEC, Math.abs(rate) * 0.6);
    if (this.elements && Math.abs(tMs - this.t0Ms) < window * 1000) return;
    // Aim slightly ahead so the result is centred on the time it will be used.
    const lead = Math.max(-window, Math.min(window, rate * 0.15)) * 1000;
    const buf = this.spare && this.spare.length === this.meta.count * ELEMENT_STRIDE ? this.spare : undefined;
    this.spare = null;
    this.pending = true;
    this.pendingSince = now;
    this.post({ type: 'propagate', tMs: tMs + lead, buf }, buf ? [buf.buffer] : []);
  }

  get count(): number {
    return this.meta?.count ?? 0;
  }

  indexOfNorad(norad: number): number {
    if (!this.meta) return -1;
    if (!this.byNorad) {
      this.byNorad = new Map();
      const ids = this.meta.norad;
      for (let i = 0; i < ids.length; i++) this.byNorad.set(ids[i], i);
    }
    return this.byNorad.get(norad) ?? -1;
  }

  /** Earth-centred ICRS position (m) of object `i` at `tMs`; false when it has no position. */
  position(i: number, tMs: number, out: Vector3 | { x: number; y: number; z: number }): boolean {
    if (!this.elements || i < 0) return false;
    return elementsPosition(this.elements, i * ELEMENT_STRIDE, (tMs - this.t0Ms) / 1000, out);
  }

  velocity(i: number, tMs: number, out: Vector3 | { x: number; y: number; z: number }): boolean {
    if (!this.elements || i < 0) return false;
    return elementsVelocity(this.elements, i * ELEMENT_STRIDE, (tMs - this.t0Ms) / 1000, out);
  }

  /** Full catalog row (fact sheets); resolves null when unavailable. */
  row(i: number): Promise<CatalogRow | null> {
    if (!this.worker || !this.meta) return Promise.resolve(null);
    const reqId = ++this.reqId;
    return new Promise((resolve) => {
      this.rowWaiters.set(reqId, resolve);
      this.post({ type: 'row', reqId, index: i });
      setTimeout(() => {
        if (this.rowWaiters.delete(reqId)) resolve(null);
      }, 5000);
    });
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }

  dispose(): void {
    this.disposed = true;
    this.worker?.terminate();
    this.worker = null;
    this.listeners.clear();
    for (const w of this.rowWaiters.values()) w(null);
    this.rowWaiters.clear();
  }
}
