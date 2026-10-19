/**
 * Moon geometry, built in the body-fixed frame (+z north pole, +x prime meridian / toward the planet, +y east).
 * Lengths are in units of the moon's mean radius (the mesh scale converts to render units).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/** UV sphere with poles on +z, deformed to a triaxial ellipsoid; normals are the analytic ellipsoid normals. */
export function createEllipsoidGeometry(radii: readonly [number, number, number], widthSegs = 128, heightSegs = 64): THREE.BufferGeometry {
  const [a, b, c] = radii;
  const vCount = (widthSegs + 1) * (heightSegs + 1);
  const pos = new Float32Array(vCount * 3);
  const nor = new Float32Array(vCount * 3);
  let k = 0;
  for (let j = 0; j <= heightSegs; j++) {
    const lat = Math.PI / 2 - (j / heightSegs) * Math.PI;
    const cl = Math.cos(lat), sl = Math.sin(lat);
    for (let i = 0; i <= widthSegs; i++) {
      const lon = -Math.PI + (i / widthSegs) * 2 * Math.PI;
      const dx = cl * Math.cos(lon), dy = cl * Math.sin(lon), dz = sl;
      pos[k] = dx * a;
      pos[k + 1] = dy * b;
      pos[k + 2] = dz * c;
      const nx = dx / a, ny = dy / b, nz = dz / c;
      const nl = Math.hypot(nx, ny, nz);
      nor[k] = nx / nl;
      nor[k + 1] = ny / nl;
      nor[k + 2] = nz / nl;
      k += 3;
    }
  }
  const idx = new Uint32Array(widthSegs * heightSegs * 6);
  let t = 0;
  for (let j = 0; j < heightSegs; j++) {
    for (let i = 0; i < widthSegs; i++) {
      const p = j * (widthSegs + 1) + i;
      const q = p + widthSegs + 1;
      if (j !== 0) {
        idx[t++] = p; idx[t++] = q; idx[t++] = p + 1;
      }
      if (j !== heightSegs - 1) {
        idx[t++] = p + 1; idx[t++] = q; idx[t++] = q + 1;
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(new THREE.BufferAttribute(idx.subarray(0, t), 1));
  g.computeBoundingSphere();
  return g;
}

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface IrregularOptions {
  seed: number;
  /** Number of impact craters carved into the shape (scaled by the caller). */
  craters: number;
  /** Subdivision of the icosahedron (triangles = 20 (detail+1)²). */
  detail: number;
  /** Extra explicit craters: centre direction (body frame), angular radius (rad), depth (fraction of the mean radius). */
  features?: { dir: [number, number, number]; radius: number; depth: number }[];
  /** Low-frequency lumpiness amplitude (fraction of the mean radius). */
  lumpiness?: number;
}

/**
 * Triaxial ellipsoid with low-frequency lumps and bowl-and-rim craters, as a smooth-shaded indexed mesh. The shape is
 * ILLUSTRATIVE (only the semi-axes are measured); a seeded RNG keeps it identical across sessions.
 */
export function createIrregularGeometry(radii: readonly [number, number, number], opts: IrregularOptions): THREE.BufferGeometry {
  const rnd = mulberry32(opts.seed);
  const ico = new THREE.IcosahedronGeometry(1, opts.detail);
  ico.deleteAttribute('normal');
  ico.deleteAttribute('uv');
  const g = mergeVertices(ico, 1e-5);
  ico.dispose();
  const posAttr = g.getAttribute('position') as THREE.BufferAttribute;
  const n = posAttr.count;

  // Random lumps: a few low-frequency sinusoids over the sphere.
  const lumps: { d: THREE.Vector3; f: number; ph: number; a: number }[] = [];
  const lumpAmp = opts.lumpiness ?? 0.05;
  for (let i = 0; i < 6; i++) {
    lumps.push({ d: new THREE.Vector3(rnd() * 2 - 1, rnd() * 2 - 1, rnd() * 2 - 1).normalize(), f: 1.2 + rnd() * 2.4, ph: rnd() * 6.28, a: (lumpAmp * (0.4 + rnd())) / 3 });
  }
  const craters: { c: THREE.Vector3; r: number; depth: number }[] = [];
  for (let i = 0; i < opts.craters; i++) {
    const z = rnd() * 2 - 1, ph = rnd() * 6.2832, s = Math.sqrt(1 - z * z);
    // Power-law sizes: many small, few large.
    const r = 0.07 + 0.42 * Math.pow(rnd(), 2.6);
    craters.push({ c: new THREE.Vector3(s * Math.cos(ph), s * Math.sin(ph), z), r, depth: 0.2 * r + 0.01 });
  }
  for (const f of opts.features ?? []) craters.push({ c: new THREE.Vector3(...f.dir).normalize(), r: f.radius, depth: f.depth });

  const d = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.fromBufferAttribute(posAttr, i).normalize();
    let h = 1;
    for (const l of lumps) h += l.a * Math.sin(l.f * 3 * d.dot(l.d) + l.ph);
    for (const cr of craters) {
      const th = Math.acos(Math.min(1, Math.max(-1, d.dot(cr.c))));
      const u = th / cr.r;
      if (u < 1) h -= cr.depth * (1 - u * u) * (1 - 0.25 * Math.exp(-u * u * 40));
      else if (u < 1.6) h += cr.depth * 0.22 * Math.exp(-((u - 1.08) * (u - 1.08)) * 40);
    }
    posAttr.setXYZ(i, d.x * radii[0] * h, d.y * radii[1] * h, d.z * radii[2] * h);
  }
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}
