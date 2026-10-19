/**
 * Procedural small-body geometry: a subdivided icosphere pushed through a triaxial ellipsoid, a shape recipe (spinning top,
 * peanut, bilobed contact binary, elongated, shard), fractal lumpiness and impact craters — deterministic from the body id.
 * Illustrative: only the overall dimensions are published; the relief is generated. The geometry is normalised so that its
 * mean radius is ≈ 1 (scale the mesh by the body's mean radius).
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { ShapeRecipe } from './catalog';

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

function hash3(x: number, y: number, z: number, seed: number): number {
  let h = (x * 374761393 + y * 668265263 + z * 2147483647 + seed * 1274126177) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function vnoise(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  let fx = x - xi, fy = y - yi, fz = z - zi;
  fx = fx * fx * (3 - 2 * fx);
  fy = fy * fy * (3 - 2 * fy);
  fz = fz * fz * (3 - 2 * fz);
  const l = (a: number, b: number, t: number): number => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number): number => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
    l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy),
    fz,
  );
}

function fbm(x: number, y: number, z: number, seed: number, octaves = 4): number {
  let a = 0.5, s = 0, f = 1;
  for (let i = 0; i < octaves; i++) {
    s += a * vnoise(x * f, y * f, z * f, seed + i * 17);
    f *= 2.03;
    a *= 0.5;
  }
  return s / 0.9375;
}

export interface ShapeSpec {
  id: string;
  recipe: ShapeRecipe;
  /** Semi-axes, any unit (only ratios matter). */
  axes: [number, number, number];
  /** Lumpiness amplitude (fraction of radius). */
  lumpiness?: number;
  /** Crater count. */
  craters?: number;
  /** Icosphere detail (default 22 → ~10k faces). */
  detail?: number;
}

const LUMP_DEFAULT: Record<ShapeRecipe, number> = { ellipsoid: 0.025, top: 0.03, peanut: 0.05, bilobed: 0.04, elongated: 0.05, shard: 0.11 };

/** Build the geometry (positions in units of the mean radius, smooth vertex normals). */
export function buildSmallBodyGeometry(spec: ShapeSpec): THREE.BufferGeometry {
  const seed = hashString(spec.id) & 0xffff;
  const rand = rng(hashString(spec.id) ^ 0x9e3779b9);
  const [ax, ay, az] = spec.axes;
  const mean = Math.cbrt(ax * ay * az);
  const detail = spec.detail ?? 22;
  const ico = new THREE.IcosahedronGeometry(1, detail);
  ico.deleteAttribute('uv');
  ico.deleteAttribute('normal');
  const geo = mergeVertices(ico, 1e-5);
  ico.dispose();
  const pos = geo.getAttribute('position') as THREE.BufferAttribute;
  const lump = spec.lumpiness ?? LUMP_DEFAULT[spec.recipe];
  const craterCount = spec.craters ?? (spec.recipe === 'shard' ? 22 : spec.recipe === 'ellipsoid' ? 70 : 38);
  // Craters: unit centre, angular radius, depth.
  const craters: { x: number; y: number; z: number; rho: number; depth: number }[] = [];
  for (let k = 0; k < craterCount; k++) {
    const z = rand() * 2 - 1, phi = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    const big = Math.pow(rand(), 2.4);
    const rho = 0.05 + 0.3 * big;
    craters.push({ x: s * Math.cos(phi), y: s * Math.sin(phi), z, rho, depth: 0.05 + 0.18 * rho });
  }
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).normalize();
    let r = 1;
    const dx = v.x, dy = v.y, dz = v.z;
    switch (spec.recipe) {
      case 'top': {
        // Equatorial ridge and slightly flattened poles (Bennu/Ryugu/Didymos "spinning top").
        r *= 1 + 0.08 * Math.exp(-((dz / 0.32) ** 2)) - 0.04 * dz * dz;
        break;
      }
      case 'peanut': {
        r *= 1 - 0.3 * Math.exp(-((dx / 0.26) ** 2));
        break;
      }
      case 'bilobed': {
        const neck = Math.exp(-((dx / 0.22) ** 2));
        r *= (1 - 0.42 * neck) * (dx > 0 ? 1 : 0.7 + 0.3 * Math.exp(-((dx / 0.5) ** 2)));
        break;
      }
      case 'elongated':
        r *= 1 - 0.1 * Math.exp(-((dx / 0.3) ** 2));
        break;
      case 'shard':
        r *= 1 + 0.08 * (vnoise(dx * 2.2 + 3, dy * 2.2, dz * 2.2, seed + 5) - 0.5);
        break;
      default:
        break;
    }
    const n = fbm(dx * 1.7 + seed * 0.013, dy * 1.7, dz * 1.7, seed, 4) - 0.5;
    r *= 1 + 2 * lump * n;
    // Craters: a bowl with a raised rim.
    for (const c of craters) {
      const cosA = dx * c.x + dy * c.y + dz * c.z;
      if (cosA < 0.4) continue;
      const t = Math.acos(Math.min(1, cosA)) / c.rho;
      if (t > 1.25) continue;
      const bowl = t < 1 ? (1 - t * t) : 0;
      const rim = 0.25 * Math.exp(-(((t - 1.02) / 0.12) ** 2));
      r -= c.depth * (bowl * bowl - rim);
    }
    v.set(dx * ax * r, dy * ay * r, dz * az * r).multiplyScalar(1 / mean);
    if (spec.recipe === 'elongated') v.z += 0.12 * (v.x * v.x) * Math.sign(1);
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}
