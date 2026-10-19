/**
 * Procedural spacecraft models at TRUE size in metres (illustrative geometry, accurate proportions):
 * ISS (integrated truss 109 m, eight 35 × 12 m solar array wings with copper-gold cells, thermal radiators, pressurised
 * modules), Hubble and Tiangong. Body frame = LVLH: +X along velocity, +Z toward nadir, +Y = Z × X (starboard).
 * Each model = one merged structure mesh + solar-array meshes that the layer rotates to track the Sun about +Y.
 * Vertex attributes: color (linear reflectance), aSpec (specular strength), aCell (1 = solar-cell blanket, uses uv).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';

type V3 = [number, number, number];

// Linear reflectances.
const WHITE: V3 = [0.62, 0.62, 0.6];
const BETA: V3 = [0.55, 0.54, 0.5]; // beta-cloth / Russian thermal blankets
const RUS: V3 = [0.48, 0.5, 0.46];
const FOIL: V3 = [0.58, 0.58, 0.6];
const TRUSS: V3 = [0.3, 0.3, 0.31];
const DARK: V3 = [0.05, 0.05, 0.055];
const GOLDFOIL: V3 = [0.45, 0.28, 0.07];
const RADIATOR: V3 = [0.72, 0.72, 0.7];

interface Part { geo: THREE.BufferGeometry; color: V3; spec: number; cell: number }

const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const eu = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);
const pv = new THREE.Vector3();

function place(geo: THREE.BufferGeometry, pos: V3, rot: V3, color: V3, spec: number, cell = 0): Part {
  eu.set(rot[0], rot[1], rot[2]);
  qq.setFromEuler(eu);
  m4.compose(pv.set(pos[0], pos[1], pos[2]), qq, one);
  geo.applyMatrix4(m4);
  return { geo, color, spec, cell };
}
const box = (sx: number, sy: number, sz: number, pos: V3, color: V3, spec = 0.25): Part => place(new THREE.BoxGeometry(sx, sy, sz), pos, [0, 0, 0], color, spec);
/** Cylinder along an axis. */
function cyl(axis: 'x' | 'y' | 'z', r: number, len: number, pos: V3, color: V3, spec = 0.2, seg = 20, r2 = r): Part {
  const rot: V3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return place(new THREE.CylinderGeometry(r2, r, len, seg), pos, rot, color, spec);
}
const sphere = (r: number, pos: V3, color: V3, spec = 0.2): Part => place(new THREE.SphereGeometry(r, 18, 12), pos, [0, 0, 0], color, spec);
/** Solar-cell blanket in the YZ plane (normal +X): width along Y, length along Z, centred at pos. */
function blanket(width: number, length: number, pos: V3): Part {
  // PlaneGeometry(length, width): length along X → rotated onto Z; width along Y; uv.x runs along the length.
  return place(new THREE.PlaneGeometry(length, width), pos, [0, Math.PI / 2, 0], [0.5, 0.3, 0.08], 0.7, 1);
}
/** Flat panel in the YZ plane. */
/** Truss segment: a box shaded as an open lattice (aCell = 2). */
const truss = (sx: number, sy: number, sz: number, pos: V3): Part => { const p = box(sx, sy, sz, pos, TRUSS, 0.45); p.cell = 2; return p; };
const panelYZ = (w: number, l: number, pos: V3, color: V3, spec = 0.15): Part => box(0.08, w, l, pos, color, spec);

function merge(parts: Part[]): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const spec = new Float32Array(n);
    const cell = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[3 * i] = p.color[0]; col[3 * i + 1] = p.color[1]; col[3 * i + 2] = p.color[2];
      spec[i] = p.spec;
      cell[i] = p.cell;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSpec', new THREE.BufferAttribute(spec, 1));
    g.setAttribute('aCell', new THREE.BufferAttribute(cell, 1));
    if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
    return g;
  });
  const out = mergeGeometries(gs, false);
  for (const g of gs) g.dispose();
  out.computeBoundingSphere();
  return out;
}

export interface ArrayMount {
  geometry: THREE.BufferGeometry;
  /** Mount point in the body frame (m). */
  position: V3;
  /** Rotation axis of the tracking joint in the body frame (unit). Always +Y here (truss / lab axis). */
  axis: 'y';
}

export interface ModelDef {
  structure: THREE.BufferGeometry;
  arrays: ArrayMount[];
  /** Bounding radius (m). */
  radiusM: number;
}

// ── ISS ─────────────────────────────────────────────────────────────────────────────────────

/** One ISS photovoltaic module: two wings (±Z from the truss), each two 34 × 4.6 m blankets either side of a mast. */
function issWingPair(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    const zc = s * (2.2 + 17);
    parts.push(blanket(4.6, 34, [0, 3.0, zc]), blanket(4.6, 34, [0, -3.0, zc]));
    parts.push(box(0.25, 0.25, 34.5, [0, 0, zc], TRUSS, 0.4)); // mast
    parts.push(box(0.5, 12, 0.35, [0, 0, s * 36.4], TRUSS, 0.3)); // tip bar
    parts.push(box(0.9, 12, 0.6, [0, 0, s * 2.0], DARK, 0.2)); // blanket box
  }
  parts.push(box(1.2, 1.6, 4.2, [0, 0, 0], TRUSS, 0.35)); // beta gimbal
  return merge(parts);
}

function issStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  // US pressurised segment along X.
  P.push(cyl('x', 2.15, 8.5, [0, 0, 0], WHITE)); // Destiny
  P.push(cyl('x', 2.2, 7.2, [7.9, 0, 0], WHITE)); // Harmony
  P.push(cyl('x', 0.9, 2.6, [12.8, 0, 0], FOIL, 0.4)); // PMA-2 / IDA
  P.push(cyl('y', 2.25, 6.9, [7.9, 5.65, 0], WHITE)); // Columbus
  P.push(cyl('y', 2.2, 11.2, [7.9, -7.8, 0], WHITE)); // Kibo PM
  P.push(cyl('z', 2.2, 4.2, [7.9, -6.5, -4.3], WHITE)); // Kibo ELM-PS
  P.push(box(5.0, 5.2, 3.8, [7.9, -16.1, 0], GOLDFOIL, 0.5)); // Kibo exposed facility
  P.push(cyl('z', 1.2, 3.5, [7.9, 0, 3.6], WHITE)); // Harmony nadir port (cargo vehicle berth)
  P.push(cyl('x', 2.3, 5.5, [-7.0, 0, 0], WHITE)); // Unity
  P.push(cyl('y', 2.25, 6.7, [-7.0, -5.6, 0], WHITE)); // Tranquility
  P.push(cyl('z', 1.5, 1.5, [-7.0, -6.2, 3.0], FOIL, 0.6, 7)); // Cupola
  P.push(cyl('y', 2.0, 5.0, [-7.0, 4.5, 0], WHITE)); // Quest airlock
  P.push(cyl('x', 2.2, 6.4, [-0.5, -10.2, 0], WHITE)); // PMM Leonardo (off Tranquility, approx.)
  P.push(cyl('x', 1.0, 2.2, [-10.8, 0, 0], FOIL, 0.4)); // PMA-1
  // Russian segment.
  P.push(cyl('x', 2.05, 12.6, [-18.2, 0, 0], RUS)); // Zarya
  P.push(cyl('z', 1.2, 6.0, [-18.2, 0, 5.0], RUS)); // Rassvet
  P.push(cyl('z', 1.35, 7.0, [-18.2, 0, 11.4], BETA)); // Soyuz at Rassvet
  P.push(cyl('x', 2.1, 9.0, [-31.0, 0, 0], RUS)); // Zvezda work compartment
  P.push(cyl('x', 1.35, 4.0, [-37.5, 0, 0], RUS)); // Zvezda aft
  P.push(sphere(1.6, [-25.5, 0, 0], RUS)); // Zvezda transfer compartment
  P.push(cyl('x', 1.35, 7.4, [-43.2, 0, 0], BETA)); // Progress (aft port)
  P.push(cyl('z', 2.1, 13.0, [-25.5, 0, 8.2], RUS)); // Nauka (nadir)
  P.push(sphere(1.6, [-25.5, 0, 16.2], RUS)); // Prichal
  P.push(cyl('z', 1.3, 4.0, [-25.5, 0, -3.8], RUS)); // Poisk (zenith)
  P.push(cyl('z', 1.35, 7.0, [-25.5, 0, -9.5], BETA)); // Soyuz/Progress at Poisk
  for (const s of [1, -1]) {
    // Zvezda arrays (blue-grey cells, 3 m wide), fixed.
    P.push(box(0.05, 12.5, 3.2, [-33.5, s * 9.0, 0], [0.025, 0.03, 0.07], 0.6));
    P.push(box(0.2, 3, 0.2, [-33.5, s * 2.6, 0], TRUSS, 0.3));
  }
  // Integrated truss along Y above Destiny (−Z = zenith).
  const tz = -4.6;
  P.push(truss(4.6, 13.4, 3.4, [0, 0, tz])); // S0
  P.push(box(4.0, 2.6, 4.6, [0, 0, tz + 2.4], TRUSS, 0.3)); // S0 mounts to Destiny
  for (const s of [1, -1]) {
    P.push(truss(4.2, 13.6, 3.2, [0, s * 13.5, tz])); // S1/P1
    P.push(truss(3.8, 6.4, 3.0, [0, s * 23.6, tz])); // S3/P3
    P.push(cyl('y', 2.2, 1.6, [0, s * 27.6, tz], FOIL, 0.6)); // SARJ
    P.push(truss(3.6, 10.6, 3.0, [0, s * 33.6, tz])); // S4/P4
    P.push(truss(3.4, 3.0, 2.8, [0, s * 41.2, tz])); // S5/P5
    P.push(truss(3.6, 12.4, 3.0, [0, s * 48.3, tz])); // S6/P6 (tip at ±54.5)
    // Main thermal radiators (HRS) on S1/P1: three 23 × 3.4 m wings toward nadir.
    for (let k = 0; k < 3; k++) P.push(panelYZ(3.3, 22.5, [0.4, s * (8.8 + 3.7 * k), tz + 13.6], RADIATOR, 0.1));
    // Photovoltaic radiators on S4/P4 and S6/P6.
    P.push(panelYZ(3.1, 13.0, [0, s * 37.0, tz + 9.0], RADIATOR, 0.1));
    P.push(panelYZ(3.1, 13.0, [0, s * 44.6, tz + 9.0], RADIATOR, 0.1));
    // Canadarm2 (stowed along the truss, approximate) and external stowage.
    if (s > 0) P.push(cyl('y', 0.2, 16, [2.6, 5.0, tz - 2.0], WHITE, 0.3, 8));
    P.push(box(2.4, 4, 1.6, [2.6, s * 19.0, tz - 2.2], GOLDFOIL, 0.4)); // ExPRESS logistics carriers
  }
  return merge(P);
}

// ── Hubble ──────────────────────────────────────────────────────────────────────────────────

function hubbleArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    parts.push(blanket(2.45, 7.1, [0, 0, s * (1.2 + 3.55)]));
    parts.push(box(0.12, 0.12, 7.5, [0, 0, s * (1.2 + 3.55)], TRUSS, 0.4));
  }
  parts.push(box(0.4, 0.4, 2.4, [0, 0, 0], TRUSS, 0.3));
  return merge(parts);
}

function hubbleStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  P.push(cyl('x', 2.1, 4.4, [-4.2, 0, 0], FOIL, 0.65, 24)); // aft shroud
  P.push(cyl('x', 2.1, 1.2, [-1.4, 0, 0], FOIL, 0.6, 24)); // equipment section
  P.push(cyl('x', 1.55, 7.0, [2.7, 0, 0], FOIL, 0.55, 24)); // forward shell + light shield
  P.push(cyl('x', 1.6, 0.25, [6.25, 0, 0], DARK, 0.2, 24)); // aperture ring
  P.push(place(new THREE.CircleGeometry(1.5, 24), [6.25, 0, 0], [0, Math.PI / 2, 0], DARK, 0.05)); // aperture (dark interior)
  P.push(place(new THREE.CircleGeometry(1.6, 24), [7.1, 0, -1.6], [0, Math.PI / 2 + 1.1, 0], FOIL, 0.5)); // aperture door, open
  for (const s of [1, -1]) {
    P.push(cyl('z', 0.08, 4.0, [-1.2, 0, s * 3.4], WHITE, 0.3, 6)); // high-gain antenna booms
    P.push(place(new THREE.SphereGeometry(0.75, 16, 6, 0, Math.PI * 2, 0, 0.7), [-1.2, 0, s * 5.6], [s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0], WHITE, 0.3));
  }
  P.push(box(0.6, 3.0, 0.6, [-1.0, 0, 0], TRUSS, 0.3)); // array masts root
  return merge(P);
}

// ── Tiangong ────────────────────────────────────────────────────────────────────────────────

function tiangongLabArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    parts.push(blanket(4.2, 26, [0, 0, s * (1.6 + 13)]));
    parts.push(box(0.2, 0.2, 26.5, [0, 0, s * (1.6 + 13)], TRUSS, 0.4));
  }
  parts.push(box(0.8, 0.8, 3.2, [0, 0, 0], TRUSS, 0.3));
  return merge(parts);
}

function tiangongCoreArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) parts.push(blanket(2.8, 11, [0, 0, s * (1.3 + 5.5)]));
  parts.push(box(0.5, 0.5, 2.6, [0, 0, 0], TRUSS, 0.3));
  return merge(parts);
}

function tiangongStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  P.push(cyl('x', 2.1, 9.0, [-3.0, 0, 0], BETA)); // Tianhe resource / large section
  P.push(cyl('x', 1.4, 4.4, [3.6, 0, 0], BETA)); // Tianhe small section
  P.push(sphere(1.5, [6.6, 0, 0], BETA)); // docking hub
  for (const s of [1, -1]) {
    P.push(cyl('y', 2.1, 16.0, [6.6, s * 9.6, 0], BETA)); // Wentian (+Y) / Mengtian (−Y)
    P.push(cyl('y', 1.4, 2.0, [6.6, s * 2.2, 0], BETA));
  }
  P.push(cyl('x', 1.7, 10.0, [-12.6, 0, 0], WHITE)); // Tianzhou (aft)
  P.push(cyl('z', 1.4, 8.0, [6.6, 0, 5.4], WHITE)); // Shenzhou (nadir)
  P.push(box(0.6, 0.6, 2.0, [6.6, 0, -2.2], TRUSS, 0.3));
  return merge(P);
}

export type ModelId = 'iss' | 'hubble' | 'tiangong';
const cache = new Map<ModelId, ModelDef>();

export function modelDef(id: ModelId): ModelDef {
  let d = cache.get(id);
  if (d) return d;
  if (id === 'iss') {
    const pair = issWingPair();
    const tz = -4.6;
    d = {
      structure: issStructure(),
      arrays: [-48.3, -33.6, 33.6, 48.3].map((y): ArrayMount => ({ geometry: pair, position: [0, y, tz], axis: 'y' })),
      radiusM: 56,
    };
  } else if (id === 'hubble') {
    d = { structure: hubbleStructure(), arrays: [{ geometry: hubbleArray(), position: [-1.0, 0, 0], axis: 'y' }], radiusM: 7.5 };
    // Hubble's wings extend along ±Y; rotate the pair geometry (built along ±Z) into ±Y around X.
    d.arrays[0].geometry.rotateX(Math.PI / 2);
  } else {
    const lab = tiangongLabArray();
    const core = tiangongCoreArray();
    d = {
      structure: tiangongStructure(),
      arrays: [
        { geometry: lab, position: [6.6, 18.4, 0], axis: 'y' },
        { geometry: lab, position: [6.6, -18.4, 0], axis: 'y' },
        { geometry: core, position: [-6.0, 0, 0], axis: 'y' },
      ],
      radiusM: 30,
    };
  }
  cache.set(id, d);
  return d;
}

export function disposeModels(): void {
  const seen = new Set<THREE.BufferGeometry>();
  for (const d of cache.values()) {
    for (const g of [d.structure, ...d.arrays.map((a) => a.geometry)]) if (!seen.has(g)) { seen.add(g); g.dispose(); }
  }
  cache.clear();
}

// ── Material ────────────────────────────────────────────────────────────────────────────────

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 color;
attribute float aSpec;
attribute float aCell;
varying vec3 vColor;
varying float vSpec;
varying float vCell;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;
void main() {
  vColor = color; vSpec = aSpec; vCell = aCell; vUv = uv; vObj = position; vObjN = normal;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uSunDir;       // world (render) axes
uniform float uIrradiance;  // scene irradiance × eclipse factor
uniform vec3 uEarthDir;     // toward Earth's centre
uniform float uEarthshine;  // Earth-reflected irradiance (blue-white fill from below)
uniform vec3 uCellScale;    // cells per uv unit (x, y), grid line width
varying vec3 vColor;
varying float vSpec;
varying float vCell;
varying vec2 vUv;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;

float gridLine(vec2 uv, vec2 cells, float w) {
  vec2 g = abs(fract(uv * cells) - 0.5);
  vec2 fw = fwidth(uv * cells) + 1e-4;
  vec2 l = smoothstep(vec2(0.5 - w) - fw, vec2(0.5 - w), g);
  float far = smoothstep(0.25, 0.6, max(fw.x, fw.y));
  return mix(max(l.x, l.y), 2.0 * w, far);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  bool front = gl_FrontFacing;
  if (!front) n = -n;
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 albedo = vColor;
  float specK = vSpec;
  float rough = 36.0;
  if (vCell > 1.5) {
    // Open truss lattice: bright members (longerons, battens, diagonals) over the dark interior.
    vec3 an = abs(vObjN);
    vec2 q = (an.x > 0.5 ? vObj.yz : an.y > 0.5 ? vObj.xz : vObj.xy) / 1.45;
    vec2 g = abs(fract(q) - 0.5);
    float dg = abs(fract(q.x + q.y) - 0.5);
    float fw = max(fwidth(q.x), fwidth(q.y));
    float mem = max(max(smoothstep(0.43 - fw, 0.46, g.x), smoothstep(0.43 - fw, 0.46, g.y)), smoothstep(0.455 - fw, 0.475, dg));
    mem = mix(mem, 0.35, smoothstep(0.08, 0.3, fw));
    albedo = mix(vec3(0.012), vColor * 1.6, mem);
    specK *= mem;
  } else if (vCell > 0.5) {
    // Solar-cell blanket: front = dark copper-violet cells in a silver grid; back = gold Kapton.
    float grid = gridLine(vUv, uCellScale.xy, uCellScale.z);
    float panel = gridLine(vUv, uCellScale.xy / 8.0, 0.02);
    if (front) {
      albedo = mix(vec3(0.12, 0.055, 0.02), vec3(0.32, 0.30, 0.28), grid * 0.5 + panel * 0.4);
      specK = 0.9; rough = 90.0;
    } else {
      albedo = mix(vec3(0.52, 0.32, 0.09), vec3(0.3, 0.2, 0.08), panel * 0.6);
      specK = 0.25; rough = 20.0;
    }
  }
  float nl = max(dot(n, uSunDir), 0.0);
  vec3 h = normalize(uSunDir + v);
  float spec = pow(max(dot(n, h), 0.0), rough) * specK * step(0.0, dot(n, uSunDir));
  // Earthshine: diffuse light from the sunlit Earth below (bluish), no specular.
  float ne = max(dot(n, uEarthDir), 0.0);
  vec3 rad = (albedo * nl / 3.14159265 + vec3(spec) * 0.5) * uIrradiance
           + albedo * ne / 3.14159265 * uEarthshine * vec3(0.75, 0.85, 1.0);
  gl_FragColor = vec4(rad, 1.0);
}`;

export class SpacecraftMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uIrradiance: { value: number };
    uEarthDir: { value: THREE.Vector3 };
    uEarthshine: { value: number };
    uCellScale: { value: THREE.Vector3 };
  };
  constructor(cellsX = 8, cellsY = 82) {
    super({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uIrradiance: { value: 5 },
        uEarthDir: { value: new THREE.Vector3(0, 0, -1) },
        uEarthshine: { value: 0 },
        uCellScale: { value: new THREE.Vector3(cellsX, cellsY, 0.06) },
      },
      side: THREE.DoubleSide,
    });
  }
}
