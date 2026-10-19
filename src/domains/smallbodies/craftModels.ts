/**
 * Stylised spacecraft models (illustrative: simplified geometry at roughly true proportions), built from merged primitives.
 * Unit convention: the model's bounding radius is ≈ 1; +Z is the "business axis" (high-gain antenna toward Earth, or the
 * Sun shield toward the Sun for Parker and JWST); panels are thin along Y so a roll about Z can face them to the Sun.
 * Vertex attributes: color (linear reflectance), aSpec (specular strength: foil/metal high, matte low).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import type { CraftModelId } from './spacecraft';

type V3 = [number, number, number];

const GOLD: V3 = [0.42, 0.24, 0.06];
const SILVER: V3 = [0.5, 0.5, 0.52];
const WHITE: V3 = [0.62, 0.62, 0.6];
const GREY: V3 = [0.2, 0.2, 0.21];
const DARK: V3 = [0.03, 0.03, 0.035];
const PANEL: V3 = [0.012, 0.02, 0.06];
const SHIELD: V3 = [0.7, 0.68, 0.62];

interface Part {
  geo: THREE.BufferGeometry;
  color: V3;
  spec: number;
}

const m4 = new THREE.Matrix4();
const q = new THREE.Quaternion();
const eu = new THREE.Euler();

function place(geo: THREE.BufferGeometry, pos: V3, rot: V3 = [0, 0, 0], color: V3, spec: number): Part {
  eu.set(rot[0], rot[1], rot[2]);
  q.setFromEuler(eu);
  m4.compose(new THREE.Vector3(...pos), q, new THREE.Vector3(1, 1, 1));
  geo.applyMatrix4(m4);
  return { geo, color, spec };
}

const box = (w: number, h: number, d: number, pos: V3, color: V3, spec = 0.3, rot: V3 = [0, 0, 0]): Part => place(new THREE.BoxGeometry(w, h, d), pos, rot, color, spec);
/** Cylinder along Z. */
const cyl = (rt: number, rb: number, len: number, pos: V3, color: V3, spec = 0.3, seg = 16): Part => place(new THREE.CylinderGeometry(rt, rb, len, seg), pos, [Math.PI / 2, 0, 0], color, spec);
/** Parabolic dish opening toward +Z (a spherical cap), radius r, depth d. */
function dish(r: number, depth: number, pos: V3, color: V3 = WHITE): Part {
  const R = (r * r + depth * depth) / (2 * depth);
  const theta = Math.asin(r / R);
  const g = new THREE.SphereGeometry(R, 24, 8, 0, Math.PI * 2, 0, theta);
  g.translate(0, -R + depth, 0);
  return place(g, pos, [Math.PI / 2, 0, 0], color, 0.35);
}
/** Flat panel in the XZ plane (thin in Y). */
const panel = (w: number, d: number, pos: V3, color: V3 = PANEL, thick = 0.02): Part => box(w, thick, d, pos, color, 0.6);

function merge(parts: Part[]): THREE.BufferGeometry {
  const gs: THREE.BufferGeometry[] = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const spec = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[3 * i] = p.color[0];
      col[3 * i + 1] = p.color[1];
      col[3 * i + 2] = p.color[2];
      spec[i] = p.spec;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSpec', new THREE.BufferAttribute(spec, 1));
    g.deleteAttribute('uv');
    return g;
  });
  const out = mergeGeometries(gs, false);
  gs.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

function hexMirror(r: number, z: number, color: V3): Part[] {
  // JWST primary: 18 hexagons in rings of 1 + 6 + 12 → show 7 centre + 12 outer, with the standard gaps.
  const out: Part[] = [];
  const cell = r * 0.205;
  const axial: [number, number][] = [];
  for (let qx = -2; qx <= 2; qx++) for (let rz = -2; rz <= 2; rz++) {
    const s = -qx - rz;
    if (Math.max(Math.abs(qx), Math.abs(rz), Math.abs(s)) > 2) continue;
    if (qx === 0 && rz === 0) continue;
    if (Math.max(Math.abs(qx), Math.abs(rz), Math.abs(s)) === 2 && qx + rz === 0) continue; // 18 segments, no centre
    axial.push([qx, rz]);
  }
  for (const [qx, rz] of axial) {
    const x = cell * Math.sqrt(3) * (qx + rz / 2);
    const y = cell * 1.5 * rz;
    out.push(place(new THREE.CylinderGeometry(cell * 0.97, cell * 0.97, 0.03, 6), [x, y, z], [Math.PI / 2, Math.PI / 6, 0], color, 0.9));
  }
  return out;
}

function build(model: CraftModelId): Part[] {
  switch (model) {
    case 'voyager':
      return [
        dish(0.55, 0.14, [0, 0, 0.1], WHITE),
        cyl(0.2, 0.2, 0.16, [0, 0, -0.04], SILVER, 0.5, 10),
        place(new THREE.CylinderGeometry(0.03, 0.03, 0.9, 8), [0.55, 0, -0.45], [0, 0, Math.PI / 2 - 0.25], GREY, 0.4),
        cyl(0.07, 0.07, 0.3, [0.75, 0.0, -0.55], DARK, 0.3, 8),
        place(new THREE.CylinderGeometry(0.015, 0.015, 1.0, 6), [-0.45, 0.3, -0.55], [0.3, 0, Math.PI / 2], GREY, 0.4),
        box(0.05, 0.05, 0.18, [-0.9, 0.5, -0.6], DARK, 0.2),
        place(new THREE.CylinderGeometry(0.015, 0.015, 0.9, 6), [0, -0.2, -0.45], [0, 0, 0.0], GREY, 0.4),
      ];
    case 'new-horizons':
      return [
        dish(0.42, 0.11, [0, 0, 0.5], WHITE),
        place(new THREE.CylinderGeometry(0.4, 0.4, 0.5, 3), [0, 0, 0.1], [Math.PI / 2, 0, 0], GOLD, 0.7),
        cyl(0.11, 0.11, 0.55, [0.55, 0, -0.2], SILVER, 0.5, 10),
        box(0.12, 0.08, 0.1, [-0.35, 0, -0.1], DARK, 0.2),
      ];
    case 'parker':
      return [
        cyl(0.92, 0.92, 0.04, [0, 0, 0.5], SHIELD, 0.15, 36),
        cyl(0.2, 0.28, 0.4, [0, 0, 0.1], GOLD, 0.6, 12),
        cyl(0.2, 0.2, 0.2, [0, 0, -0.2], GREY, 0.3, 12),
        panel(0.22, 0.4, [-0.38, 0, 0.1], PANEL),
        panel(0.22, 0.4, [0.38, 0, 0.1], PANEL),
        place(new THREE.CylinderGeometry(0.01, 0.01, 0.5, 6), [0, 0.4, -0.2], [0, 0, 0], GREY, 0.3),
        dish(0.14, 0.04, [0.3, 0.15, -0.28], WHITE),
      ];
    case 'juno':
      return [
        place(new THREE.CylinderGeometry(0.2, 0.2, 0.18, 6), [0, 0, 0], [Math.PI / 2, 0, 0], SILVER, 0.6),
        dish(0.42, 0.1, [0, 0, 0.1], WHITE),
        ...[0, 1, 2].flatMap((i) => {
          const a = (i * 2 * Math.PI) / 3;
          const ca = Math.cos(a), sa = Math.sin(a);
          const L = 0.55;
          return [place(new THREE.BoxGeometry(L * 1.0, 0.016, i === 2 ? 0.14 : 0.3), [ca * (0.2 + L / 2) * 0.0 + (0.2 + L / 2) * Math.cos(a), (0.2 + L / 2) * Math.sin(a), -0.05], [0, 0, a], PANEL, 0.6)];
        }),
      ];
    case 'clipper':
      return [
        cyl(0.17, 0.17, 0.5, [0, 0, -0.1], GOLD, 0.6, 10),
        dish(0.38, 0.1, [0, 0, 0.3], WHITE),
        panel(1.0, 0.28, [-0.62, 0, -0.1], PANEL),
        panel(1.0, 0.28, [0.62, 0, -0.1], PANEL),
        box(0.08, 0.08, 0.5, [0, 0.0, -0.58], GREY, 0.3),
        place(new THREE.CylinderGeometry(0.01, 0.01, 1.0, 6), [0, 0.28, -0.4], [Math.PI / 2, 0, 0], GREY, 0.4),
      ];
    case 'psyche':
      return [
        box(0.3, 0.3, 0.3, [0, 0, 0], GOLD, 0.65),
        dish(0.3, 0.07, [0, 0, 0.2], WHITE),
        panel(0.5, 0.26, [-0.45, 0.0, 0.0], PANEL), panel(0.5, 0.26, [-0.45, 0.0, -0.3], PANEL),
        panel(0.5, 0.26, [0.45, 0.0, 0.0], PANEL), panel(0.5, 0.26, [0.45, 0.0, -0.3], PANEL),
        cyl(0.04, 0.04, 0.3, [0, 0, -0.3], GREY, 0.4, 8),
        box(0.05, 0.05, 0.4, [0.2, 0.18, -0.2], DARK, 0.2),
      ];
    case 'lucy':
      return [
        box(0.25, 0.25, 0.3, [0, 0, 0], GOLD, 0.65),
        dish(0.3, 0.07, [0, 0, 0.2], WHITE),
        place(new THREE.CylinderGeometry(0.46, 0.46, 0.02, 28), [-0.62, 0, -0.05], [Math.PI / 2, 0, 0], PANEL, 0.6),
        place(new THREE.CylinderGeometry(0.46, 0.46, 0.02, 28), [0.62, 0, -0.05], [Math.PI / 2, 0, 0], PANEL, 0.6),
        cyl(0.05, 0.05, 0.3, [0, 0, -0.28], GREY, 0.4, 8),
      ];
    case 'hera':
      return [
        box(0.3, 0.3, 0.4, [0, 0, 0], GOLD, 0.65),
        dish(0.26, 0.06, [0, 0, 0.26], WHITE),
        panel(0.8, 0.28, [-0.58, 0, 0], PANEL), panel(0.8, 0.28, [0.58, 0, 0], PANEL),
        box(0.12, 0.12, 0.12, [0.1, 0.2, -0.1], DARK, 0.3),
      ];
    case 'juice':
      return [
        box(0.3, 0.3, 0.5, [0, 0, 0], GOLD, 0.65),
        dish(0.4, 0.1, [0, 0, 0.32], WHITE),
        ...[0, 1, 2, 3, 4].flatMap((i) => [panel(0.18, 0.5, [-0.4 - 0.18 * i, 0, -0.05], PANEL), panel(0.18, 0.5, [0.4 + 0.18 * i, 0, -0.05], PANEL)]),
        place(new THREE.CylinderGeometry(0.01, 0.01, 1.6, 6), [0.05, 0.3, -0.5], [Math.PI / 2, 0, 0], GREY, 0.4),
      ];
    case 'bepicolombo':
      return [
        box(0.3, 0.3, 0.4, [0, 0, -0.1], GOLD, 0.65),
        cyl(0.26, 0.26, 0.2, [0, 0, 0.2], GOLD, 0.6, 12),
        cyl(0.16, 0.16, 0.14, [0, 0, 0.36], WHITE, 0.4, 12),
        panel(0.5, 0.5, [0.52, 0, -0.1], PANEL),
        panel(0.5, 0.5, [-0.52, 0, -0.1], PANEL),
        dish(0.18, 0.04, [0.2, 0.2, -0.28], WHITE),
      ];
    case 'jwst':
      return [
        // Sun shield: kite-shaped five-layer sunshield in the XZ-plane, on the sun side (+Z is toward the Sun)
        place(new THREE.BoxGeometry(1.0, 0.7, 0.014), [0, -0.12, 0.4], [0, 0, 0], SHIELD, 0.3),
        place(new THREE.BoxGeometry(1.0, 0.7, 0.014), [0, -0.12, 0.37], [0, 0, 0], SHIELD, 0.3),
        place(new THREE.BoxGeometry(0.94, 0.66, 0.014), [0, -0.12, 0.34], [0, 0, 0], SHIELD, 0.3),
        box(0.4, 0.3, 0.3, [0, -0.1, 0.1], GOLD, 0.6),
        ...hexMirror(0.65, -0.28, [0.58, 0.45, 0.12]),
        box(0.02, 0.4, 0.02, [0, 0.35, -0.55], GREY, 0.3),
        panel(0.3, 0.2, [0, -0.45, 0.2], PANEL),
      ];
  }
}

const cache = new Map<CraftModelId, THREE.BufferGeometry>();
export function craftGeometry(model: CraftModelId): THREE.BufferGeometry {
  let g = cache.get(model);
  if (!g) {
    g = merge(build(model));
    cache.set(model, g);
  }
  return g;
}

export function disposeCraftGeometries(): void {
  for (const g of cache.values()) g.dispose();
  cache.clear();
}

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 color;
attribute float aSpec;
varying vec3 vColor;
varying float vSpec;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  vColor = color;
  vSpec = aSpec;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uSunDir;
uniform float uIrradiance;
varying vec3 vColor;
varying float vSpec;
varying vec3 vNormalW;
varying vec3 vPosW;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vPosW);
  float nl = max(dot(n, uSunDir), 0.0);
  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), 36.0) * vSpec * step(0.0, dot(n, uSunDir));
  vec3 rad = (vColor * nl / 3.14159265 + vec3(spec) * 0.4) * uIrradiance;
  gl_FragColor = vec4(rad, 1.0);
}`;

export class CraftMaterial extends THREE.ShaderMaterial {
  declare uniforms: { uSunDir: { value: THREE.Vector3 }; uIrradiance: { value: number } };
  constructor() {
    super({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: { uSunDir: { value: new THREE.Vector3(1, 0, 0) }, uIrradiance: { value: 5 } },
      side: THREE.DoubleSide,
    });
  }
}
