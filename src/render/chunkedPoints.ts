/**
 * Precision-safe, culled, budget-limited point clouds (ARCHITECTURE §5.1, ADR-002).
 *
 * Input positions are float64 world coordinates (ICRS m relative to the SSB, or any common origin). They are split
 * into spatial chunks (octree leaves of ≤ targetPointsPerChunk). Each chunk keeps a float64 origin and stores its
 * points as float32 offsets normalized by the chunk radius, so on the GPU every coordinate is O(1) and fully
 * precise. Per frame each chunk's Object3D is placed at (origin − camera)/metersPerUnit computed in float64 with
 * scale radius/metersPerUnit — the model-view matrix therefore carries the large translation as an exactly-
 * cancelled float64 difference, and nothing large ever reaches float32.
 *
 * LOD: inputs must be sorted brightest-first. A global budget B keeps exactly the global prefix [0, B): each chunk
 * draws the points whose global index < B (binary search over the chunk's ascending index list), so the drawn set
 * is identical to drawing the first B points of the catalogue, whatever the chunking.
 * Culling: frustum test of each chunk's bounding sphere and, when absolute magnitudes are supplied, a magnitude
 * test (the brightest member at the chunk's nearest distance is fainter than the limit).
 */
import * as THREE from 'three';
import { PC_M } from '../core/units';

export interface PointAttributeSource {
  array: Float32Array;
  itemSize: number;
}

export interface ChunkedPointCloudOptions {
  /** xyz per point, float64, meters. */
  positionsM: Float64Array;
  /** Per-point attributes copied into the chunks (e.g. aMag, aTeff). */
  attributes?: Record<string, PointAttributeSource>;
  material: THREE.Material;
  targetPointsPerChunk?: number;
  /** Per-point absolute magnitude for magnitude-limit chunk culling (optional). */
  absMag?: Float32Array;
  renderOrder?: number;
}

export interface PointChunk {
  readonly points: THREE.Points;
  /** Chunk origin, float64 world meters. */
  readonly originM: THREE.Vector3;
  /** Bounding radius about the origin, meters. */
  readonly radiusM: number;
  /** Global (catalogue) index of each point, ascending. */
  readonly indices: Uint32Array;
  /** Brightest absolute magnitude in the chunk (Infinity when unknown). */
  readonly minAbsMag: number;
}

export interface ChunkCullOptions {
  /** Max catalogue prefix drawn. */
  budget?: number;
  /** Apparent magnitude limit for chunk culling (needs `absMag`). */
  limitMag?: number;
}

const MAX_DEPTH = 16;

export class ChunkedPointCloud {
  readonly object = new THREE.Group();
  readonly chunks: PointChunk[] = [];
  readonly count: number;
  /** Points drawn in the last update. */
  drawnCount = 0;
  /** Chunks drawn in the last update. */
  visibleChunks = 0;

  private readonly frustum = new THREE.Frustum();
  private readonly projView = new THREE.Matrix4();
  private readonly sphere = new THREE.Sphere();

  constructor(opts: ChunkedPointCloudOptions) {
    const n = Math.floor(opts.positionsM.length / 3);
    this.count = n;
    this.object.name = 'ChunkedPointCloud';
    const target = Math.max(64, opts.targetPointsPerChunk ?? 4096);
    const idx = new Uint32Array(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    const leaves: Uint32Array[] = [];
    splitOctree(opts.positionsM, idx, target, 0, leaves);
    for (const leaf of leaves) this.chunks.push(buildChunk(opts, leaf));
    for (const c of this.chunks) {
      if (opts.renderOrder !== undefined) c.points.renderOrder = opts.renderOrder;
      this.object.add(c.points);
    }
  }

  /**
   * Position, cull and LOD every chunk for this frame. `camera` is the render camera (at the render origin) with
   * up-to-date matrices. Allocation-free.
   */
  update(cameraPositionM: THREE.Vector3, metersPerUnit: number, camera: THREE.Camera, opts: ChunkCullOptions = {}): void {
    const budget = opts.budget ?? Infinity;
    const limitMag = opts.limitMag;
    this.projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projView, camera.coordinateSystem);
    let drawn = 0;
    let visible = 0;
    const inv = 1 / metersPerUnit;
    for (const c of this.chunks) {
      const pts = c.points;
      const dx = c.originM.x - cameraPositionM.x;
      const dy = c.originM.y - cameraPositionM.y;
      const dz = c.originM.z - cameraPositionM.z;
      let show = true;
      const n = countBelow(c.indices, budget);
      if (n === 0) show = false;
      if (show && limitMag !== undefined && Number.isFinite(c.minAbsMag)) {
        const nearestPc = Math.max(Math.hypot(dx, dy, dz) - c.radiusM, 1e-3 * PC_M) / PC_M;
        if (c.minAbsMag + 5 * Math.log10(nearestPc) - 5 > limitMag) show = false;
      }
      if (show) {
        this.sphere.center.set(dx * inv, dy * inv, dz * inv);
        this.sphere.radius = c.radiusM * inv;
        if (!this.frustum.intersectsSphere(this.sphere)) show = false;
      }
      pts.visible = show;
      if (!show) continue;
      pts.position.set(dx * inv, dy * inv, dz * inv);
      pts.scale.setScalar(c.radiusM * inv);
      pts.geometry.setDrawRange(0, n);
      drawn += n;
      visible++;
    }
    this.drawnCount = drawn;
    this.visibleChunks = visible;
  }

  dispose(): void {
    for (const c of this.chunks) c.points.geometry.dispose();
    this.object.removeFromParent();
  }
}

/** Number of entries < limit in an ascending index list (binary search). */
export function countBelow(sortedIndices: Uint32Array, limit: number): number {
  if (limit === Infinity) return sortedIndices.length;
  let lo = 0;
  let hi = sortedIndices.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sortedIndices[mid] < limit) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Stable octree split (each leaf keeps catalogue order). Exported for tests. */
export function splitOctree(pos: Float64Array, idx: Uint32Array, target: number, depth: number, out: Uint32Array[]): void {
  if (idx.length === 0) return;
  if (idx.length <= target || depth >= MAX_DEPTH) {
    out.push(idx);
    return;
  }
  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let k = 0; k < idx.length; k++) {
    const i = 3 * idx[k];
    const x = pos[i], y = pos[i + 1], z = pos[i + 2];
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (maxX - minX === 0 && maxY - minY === 0 && maxZ - minZ === 0) {
    out.push(idx);
    return;
  }
  const cx = 0.5 * (minX + maxX), cy = 0.5 * (minY + maxY), cz = 0.5 * (minZ + maxZ);
  const counts = new Uint32Array(8);
  const octant = new Uint8Array(idx.length);
  for (let k = 0; k < idx.length; k++) {
    const i = 3 * idx[k];
    const o = (pos[i] >= cx ? 1 : 0) | (pos[i + 1] >= cy ? 2 : 0) | (pos[i + 2] >= cz ? 4 : 0);
    octant[k] = o;
    counts[o]++;
  }
  const parts = Array.from(counts, (c) => new Uint32Array(c));
  const fill = new Uint32Array(8);
  for (let k = 0; k < idx.length; k++) {
    const o = octant[k];
    parts[o][fill[o]++] = idx[k];
  }
  for (const p of parts) splitOctree(pos, p, target, depth + 1, out);
}

function buildChunk(opts: ChunkedPointCloudOptions, indices: Uint32Array): PointChunk {
  const pos = opts.positionsM;
  const n = indices.length;
  let sx = 0, sy = 0, sz = 0;
  for (let k = 0; k < n; k++) {
    const i = 3 * indices[k];
    sx += pos[i];
    sy += pos[i + 1];
    sz += pos[i + 2];
  }
  const origin = new THREE.Vector3(sx / n, sy / n, sz / n);
  let r2 = 0;
  for (let k = 0; k < n; k++) {
    const i = 3 * indices[k];
    const dx = pos[i] - origin.x, dy = pos[i + 1] - origin.y, dz = pos[i + 2] - origin.z;
    r2 = Math.max(r2, dx * dx + dy * dy + dz * dz);
  }
  // A single point (or coincident points) gets a nominal radius so the normalization stays finite.
  const radius = r2 > 0 ? Math.sqrt(r2) : Math.max(1, Math.hypot(origin.x, origin.y, origin.z) * 1e-9);
  const local = new Float32Array(3 * n);
  const invR = 1 / radius;
  for (let k = 0; k < n; k++) {
    const i = 3 * indices[k];
    local[3 * k] = (pos[i] - origin.x) * invR;
    local[3 * k + 1] = (pos[i + 1] - origin.y) * invR;
    local[3 * k + 2] = (pos[i + 2] - origin.z) * invR;
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(local, 3));
  for (const [name, src] of Object.entries(opts.attributes ?? {})) {
    const s = src.itemSize;
    const arr = new Float32Array(s * n);
    for (let k = 0; k < n; k++) for (let j = 0; j < s; j++) arr[s * k + j] = src.array[s * indices[k] + j];
    geom.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  geom.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1);
  let minAbsMag = Infinity;
  if (opts.absMag) for (let k = 0; k < n; k++) minAbsMag = Math.min(minAbsMag, opts.absMag[indices[k]]);
  const points = new THREE.Points(geom, opts.material);
  points.frustumCulled = false;
  points.matrixAutoUpdate = true;
  return { points, originM: origin, radiusM: radius, indices, minAbsMag };
}
