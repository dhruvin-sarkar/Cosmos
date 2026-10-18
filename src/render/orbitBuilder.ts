/**
 * Orbit polylines for OrbitLineMaterial.
 *
 * Sampling: src/science/orbits.ts `sampleOrbitPolyline` (curvature-adaptive: the tight end of an e = 0.97 ellipse
 * gets the vertices it needs). Precision: vertices stay float64 on the CPU, relative to the orbit's focus (the
 * parent body). The GPU copy is float32 relative to a *rebase origin* that follows the camera: whenever the camera
 * has moved by more than a quarter of its distance to the nearest vertex, the float32 buffer is rewritten
 * relative to the camera's current position (no allocation; ≤ maxVertices × 10 floats). Coordinates near the
 * camera are therefore small and exact, distant ones are large but far away — the error is always ≲ 1e-7 of
 * the viewing distance, i.e. far below a pixel, at any scale.
 */
import * as THREE from 'three';
import { OrbitLineMaterial, type OrbitLineMaterialOptions } from './materials/OrbitLineMaterial';
import { sampleOrbitPolyline, type KeplerElements } from '../science/orbits';
import type { FrameContext } from '../core/types';

const STRIDE = 10; // start xyz, end xyz, dist start/end, param start/end

export interface OrbitLineOptions extends OrbitLineMaterialOptions {
  /** Capacity in vertices (default 1024). */
  maxVertices?: number;
}

export type OrbitFrameContext = Pick<FrameContext, 'cameraPosition' | 'metersPerUnit' | 'pixelsPerRadian' | 'viewport'>;

let quadGeometry: THREE.BufferGeometry | null = null;
function segmentQuad(): THREE.BufferGeometry {
  if (!quadGeometry) {
    quadGeometry = new THREE.BufferGeometry();
    quadGeometry.setAttribute('position', new THREE.Float32BufferAttribute([-1, 0, 0, 1, 0, 0, -1, 1, 0, 1, 1, 0], 3));
    quadGeometry.setIndex([0, 1, 2, 2, 1, 3]);
  }
  return quadGeometry;
}

export class OrbitLine extends THREE.Mesh<THREE.InstancedBufferGeometry, OrbitLineMaterial> {
  /** World position (ICRS m) of the orbit's focus; set before update() each frame. */
  readonly parentPositionM = new THREE.Vector3();
  readonly maxVertices: number;
  private readonly pointsM: Float64Array;
  private readonly fraction: Float64Array;
  private readonly cumLenM: Float64Array;
  private readonly gpu: Float32Array;
  private readonly buffer: THREE.InstancedInterleavedBuffer;
  private readonly rebaseM = new THREE.Vector3(Number.NaN, 0, 0);
  private readonly camRel = new THREE.Vector3();
  private vertexCount = 0;
  private closed = true;
  private sampleTimes: Float64Array | null = null;

  constructor(opts: OrbitLineOptions = {}) {
    const maxV = Math.max(4, opts.maxVertices ?? 1024);
    const geom = new THREE.InstancedBufferGeometry();
    const base = segmentQuad();
    geom.setIndex(base.getIndex());
    geom.setAttribute('position', base.getAttribute('position'));
    const gpu = new Float32Array(maxV * STRIDE);
    const buffer = new THREE.InstancedInterleavedBuffer(gpu, STRIDE, 1);
    buffer.setUsage(THREE.DynamicDrawUsage);
    geom.setAttribute('instanceStart', new THREE.InterleavedBufferAttribute(buffer, 3, 0));
    geom.setAttribute('instanceEnd', new THREE.InterleavedBufferAttribute(buffer, 3, 3));
    geom.setAttribute('instanceDist', new THREE.InterleavedBufferAttribute(buffer, 2, 6));
    geom.setAttribute('instanceParam', new THREE.InterleavedBufferAttribute(buffer, 2, 8));
    geom.instanceCount = 0;
    super(geom, new OrbitLineMaterial(opts));
    this.maxVertices = maxV;
    this.gpu = gpu;
    this.buffer = buffer;
    this.pointsM = new Float64Array(3 * maxV);
    this.fraction = new Float64Array(maxV);
    this.cumLenM = new Float64Array(maxV + 1);
    this.frustumCulled = false;
  }

  /**
   * Sample Keplerian elements (`mu` in m³/s²). `frame` rotates the elements' reference frame into ICRS
   * (e.g. ecliptic J2000 → ICRS). Orbit fractions follow time from periapsis, so setHead() takes the body's
   * mean anomaly / 2π.
   */
  setFromElements(el: KeplerElements, muM3S2: number, opts: { samples?: number; frame?: THREE.Matrix3 } = {}): this {
    const n = Math.min(this.maxVertices, Math.max(8, opts.samples ?? 512));
    if (!this.sampleTimes || this.sampleTimes.length < n) this.sampleTimes = new Float64Array(this.maxVertices);
    const pts = sampleOrbitPolyline(el, muM3S2, n, { out: this.pointsM, outTimeFromPeriapsisS: this.sampleTimes });
    const closed = el.eccentricity < 1;
    if (closed) {
      const period = 2 * Math.PI * Math.sqrt(Math.pow(el.semiMajorAxisM, 3) / muM3S2);
      for (let i = 0; i < n; i++) this.fraction[i] = this.sampleTimes[i] / period;
    } else {
      for (let i = 0; i < n; i++) this.fraction[i] = i / (n - 1);
    }
    if (opts.frame) applyMatrix3InPlace(pts, n, opts.frame);
    this.vertexCount = n;
    this.closed = closed;
    this.finishPolyline();
    return this;
  }

  /**
   * Use an explicit polyline (xyz meters relative to the focus). `fractions` (0–1 per vertex) drive the trail fade;
   * by default the cumulative length is used.
   */
  setPolyline(pointsM: ArrayLike<number>, count: number, closed: boolean, fractions?: ArrayLike<number>): this {
    const n = Math.min(this.maxVertices, count);
    for (let i = 0; i < 3 * n; i++) this.pointsM[i] = pointsM[i];
    this.vertexCount = n;
    this.closed = closed;
    this.computeLengths();
    const total = this.cumLenM[closed ? n : n - 1] || 1;
    for (let i = 0; i < n; i++) this.fraction[i] = fractions ? fractions[i] : this.cumLenM[i] / total;
    this.rebaseM.x = Number.NaN;
    return this;
  }

  /** Orbit fraction (0–1) of the body for the trail fade; negative disables it. */
  setHead(fraction: number, minFade = 0.15): void {
    this.material.setTrail(fraction < 0 ? -1 : fraction - Math.floor(fraction), minFade);
  }

  /** Per-frame: camera-relative placement, rebasing when needed, dash scale. Allocation-free. */
  update(ctx: OrbitFrameContext): void {
    const n = this.vertexCount;
    if (n < 2) {
      this.visible = false;
      return;
    }
    const c = this.camRel.subVectors(ctx.cameraPosition, this.parentPositionM);
    let near2 = Infinity;
    const p = this.pointsM;
    for (let i = 0; i < n; i++) {
      const dx = p[3 * i] - c.x, dy = p[3 * i + 1] - c.y, dz = p[3 * i + 2] - c.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < near2) near2 = d2;
    }
    const nearM = Math.sqrt(near2);
    if (!Number.isFinite(this.rebaseM.x) || this.rebaseM.distanceTo(c) > 0.25 * nearM) this.rebase(c);

    const inv = 1 / ctx.metersPerUnit;
    this.position.set(
      (this.parentPositionM.x + this.rebaseM.x - ctx.cameraPosition.x) * inv,
      (this.parentPositionM.y + this.rebaseM.y - ctx.cameraPosition.y) * inv,
      (this.parentPositionM.z + this.rebaseM.z - ctx.cameraPosition.z) * inv,
    );
    this.scale.setScalar(inv);
    const m = this.material;
    m.setViewport(ctx.viewport.width, ctx.viewport.height, ctx.viewport.pixelRatio);
    m.setPxPerUnit(ctx.pixelsPerRadian / Math.max(nearM, 1e-9));
  }

  override dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }

  private finishPolyline(): void {
    this.computeLengths();
    this.rebaseM.x = Number.NaN;
  }

  private computeLengths(): void {
    const n = this.vertexCount;
    const p = this.pointsM;
    this.cumLenM[0] = 0;
    const segs = this.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const a = s, b = (s + 1) % n;
      this.cumLenM[s + 1] = this.cumLenM[s] + Math.hypot(p[3 * b] - p[3 * a], p[3 * b + 1] - p[3 * a + 1], p[3 * b + 2] - p[3 * a + 2]);
    }
  }

  private rebase(origin: THREE.Vector3): void {
    this.rebaseM.copy(origin);
    const n = this.vertexCount;
    const p = this.pointsM;
    const g = this.gpu;
    const segs = this.closed ? n : n - 1;
    for (let s = 0; s < segs; s++) {
      const a = s, b = (s + 1) % n;
      const o = s * STRIDE;
      g[o] = p[3 * a] - origin.x;
      g[o + 1] = p[3 * a + 1] - origin.y;
      g[o + 2] = p[3 * a + 2] - origin.z;
      g[o + 3] = p[3 * b] - origin.x;
      g[o + 4] = p[3 * b + 1] - origin.y;
      g[o + 5] = p[3 * b + 2] - origin.z;
      g[o + 6] = this.cumLenM[s];
      g[o + 7] = this.cumLenM[s + 1];
      g[o + 8] = this.fraction[a];
      // The closing segment wraps to fraction 1 so the trail fade interpolates monotonically.
      g[o + 9] = b === 0 ? 1 : this.fraction[b];
    }
    this.geometry.instanceCount = segs;
    this.buffer.clearUpdateRanges();
    this.buffer.addUpdateRange(0, segs * STRIDE);
    this.buffer.needsUpdate = true;
  }
}

function applyMatrix3InPlace(p: Float64Array, n: number, m: THREE.Matrix3): void {
  const e = m.elements;
  for (let i = 0; i < n; i++) {
    const x = p[3 * i], y = p[3 * i + 1], z = p[3 * i + 2];
    p[3 * i] = e[0] * x + e[3] * y + e[6] * z;
    p[3 * i + 1] = e[1] * x + e[4] * y + e[7] * z;
    p[3 * i + 2] = e[2] * x + e[5] * y + e[8] * z;
  }
}
