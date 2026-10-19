/**
 * Procedural spacecraft models at TRUE size in metres (illustrative geometry, accurate proportions):
 * ISS (integrated truss 109 m, eight 35 × 12 m legacy solar array wings, six of them overlaid by iROSA roll-out arrays
 * (installed 2021–2023), thermal radiators, pressurised modules), Hubble (silver MLI, SA3 rigid arrays, high-gain antennas,
 * handrails) and Tiangong. Body frame = LVLH: +X along velocity, +Z toward nadir, +Y = Z × X (starboard).
 * Each model = one merged structure mesh + solar-array meshes that the layer rotates to track the Sun about +Y.
 * Vertex attributes: color (linear albedo, or F0 for metals), aRough (GGX roughness), aMat (finish id, see MAT).
 * Solar-cell blankets carry uv in metres (x along the blanket length, y across).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOISE_GLSL } from '../../render/glsl/noise';

type V3 = [number, number, number];

/** Finish ids (aMat). Keep in sync with the fragment shader. */
const MAT = { PAINT: 0, CELL: 1, TRUSS: 2, MLI: 3, GOLD: 4, RAD: 5, BETA: 6, DARK: 7, IROSA: 8, HSA: 9 } as const;

interface Finish { c: V3; m: number; r: number }
// Linear albedos (dielectrics) / F0 (metals).
const PAINT: Finish = { c: [0.66, 0.66, 0.64], m: MAT.PAINT, r: 0.45 }; // MMOD shield panels
const BETA: Finish = { c: [0.62, 0.6, 0.55], m: MAT.BETA, r: 0.9 }; // beta cloth
const RUS: Finish = { c: [0.5, 0.53, 0.47], m: MAT.BETA, r: 0.85 }; // Russian thermal blankets (grey-green)
const SOYUZ: Finish = { c: [0.4, 0.45, 0.36], m: MAT.BETA, r: 0.85 }; // Soyuz/Progress green blankets
const MLI: Finish = { c: [0.9, 0.9, 0.92], m: MAT.MLI, r: 0.26 }; // aluminised MLI foil
const GOLD: Finish = { c: [1.0, 0.74, 0.36], m: MAT.GOLD, r: 0.3 }; // gold Kapton
const TRUSS: Finish = { c: [0.4, 0.4, 0.41], m: MAT.TRUSS, r: 0.5 };
const MECH: Finish = { c: [0.32, 0.32, 0.33], m: MAT.PAINT, r: 0.5 }; // mechanisms, masts, gimbals
const DARK: Finish = { c: [0.035, 0.035, 0.04], m: MAT.DARK, r: 0.5 };
const RAD: Finish = { c: [0.8, 0.8, 0.78], m: MAT.RAD, r: 0.7 }; // Z-93 white radiator panels
const HANDRAIL: Finish = { c: [0.55, 0.4, 0.05], m: MAT.PAINT, r: 0.35 };

interface Part { geo: THREE.BufferGeometry; f: Finish }

const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const eu = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);
const pv = new THREE.Vector3();

function place(geo: THREE.BufferGeometry, pos: V3, rot: V3, f: Finish): Part {
  eu.set(rot[0], rot[1], rot[2]);
  qq.setFromEuler(eu);
  m4.compose(pv.set(pos[0], pos[1], pos[2]), qq, one);
  geo.applyMatrix4(m4);
  return { geo, f };
}
const box = (sx: number, sy: number, sz: number, pos: V3, f: Finish): Part => place(new THREE.BoxGeometry(sx, sy, sz), pos, [0, 0, 0], f);
/** Cylinder along an axis. */
function cyl(axis: 'x' | 'y' | 'z', r: number, len: number, pos: V3, f: Finish, seg = 24, r2 = r): Part {
  const rot: V3 = axis === 'x' ? [0, 0, Math.PI / 2] : axis === 'z' ? [Math.PI / 2, 0, 0] : [0, 0, 0];
  return place(new THREE.CylinderGeometry(r2, r, len, seg), pos, rot, f);
}
const sphere = (r: number, pos: V3, f: Finish): Part => place(new THREE.SphereGeometry(r, 20, 14), pos, [0, 0, 0], f);
/**
 * Solar-cell blanket, normal +X: width across, length along Z (or along Y when alongY). uv in metres.
 * PlaneGeometry(length, width) → Ry(π/2) puts the length on −Z and the normal on +X; Rx(π/2) then turns −Z into +Y.
 */
function blanket(width: number, length: number, pos: V3, mat: number = MAT.CELL, alongY = false): Part {
  const g = new THREE.PlaneGeometry(length, width);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * length, uv.getY(i) * width);
  return place(g, pos, [alongY ? Math.PI / 2 : 0, Math.PI / 2, 0], { c: [0.5, 0.3, 0.08], m: mat, r: 0.12 });
}
/** Truss segment: a box shaded as an open lattice. */
const truss = (sx: number, sy: number, sz: number, pos: V3): Part => box(sx, sy, sz, pos, TRUSS);
/** Flat panel in the YZ plane. */
const panelYZ = (w: number, l: number, pos: V3, f: Finish): Part => box(0.08, w, l, pos, f);

function merge(parts: Part[]): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const rough = new Float32Array(n);
    const mat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[3 * i] = p.f.c[0]; col[3 * i + 1] = p.f.c[1]; col[3 * i + 2] = p.f.c[2];
      rough[i] = p.f.r;
      mat[i] = p.f.m;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aRough', new THREE.BufferAttribute(rough, 1));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
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

/**
 * One ISS photovoltaic module: two wings (±Z from the truss), each two 34 × 4.6 m legacy blankets either side of a mast.
 * iROSA (18.3 × 6 m roll-out array) overlays the inboard 60 % of a wing on the sunward side, on two struts.
 */
function issWingPair(iPlus: boolean, iMinus: boolean): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    const zc = s * (2.2 + 17);
    parts.push(blanket(4.6, 34, [0, 3.0, zc]), blanket(4.6, 34, [0, -3.0, zc]));
    parts.push(box(0.25, 0.25, 34.5, [0, 0, zc], TRUSS)); // mast
    parts.push(box(0.5, 12, 0.35, [0, 0, s * 36.4], MECH)); // tip bar
    parts.push(box(0.9, 12, 0.6, [0, 0, s * 2.0], MECH)); // blanket box
    if (s > 0 ? iPlus : iMinus) {
      const zi = s * (3.4 + 9.15);
      parts.push(blanket(6.0, 18.3, [1.5, 0, zi], MAT.IROSA));
      parts.push(box(0.12, 0.3, 18.6, [1.45, 0, zi], MECH)); // roll-out boom
      parts.push(box(1.5, 0.25, 0.25, [0.75, 0, s * 3.2], MECH), box(1.5, 0.25, 0.25, [0.75, 0, s * 16.0], MECH)); // mod-kit struts
      parts.push(cyl('y', 0.25, 6.2, [1.5, 0, s * 3.3], MECH, 10)); // root mandrel
    }
  }
  parts.push(box(1.2, 1.6, 4.2, [0, 0, 0], MECH)); // beta gimbal
  return merge(parts);
}

function issStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  // US pressurised segment along X.
  P.push(cyl('x', 2.15, 8.5, [0, 0, 0], PAINT)); // Destiny
  P.push(cyl('x', 2.2, 7.2, [7.9, 0, 0], PAINT)); // Harmony
  P.push(cyl('x', 0.9, 2.6, [12.8, 0, 0], BETA)); // PMA-2 / IDA
  P.push(cyl('x', 1.0, 0.5, [14.3, 0, 0], MLI, 18)); // IDA-2 docking adapter
  P.push(cyl('y', 2.25, 6.9, [7.9, 5.65, 0], PAINT)); // Columbus
  P.push(box(1.2, 1.4, 1.0, [7.9, 9.4, -1.6], GOLD), box(1.0, 1.2, 1.0, [7.9, 9.4, 1.6], MLI)); // Columbus external payloads
  P.push(cyl('y', 2.2, 11.2, [7.9, -7.8, 0], PAINT)); // Kibo PM
  P.push(cyl('z', 2.2, 4.2, [7.9, -6.5, -4.3], PAINT)); // Kibo ELM-PS
  P.push(box(5.0, 5.2, 0.6, [7.9, -16.1, 1.6], PAINT)); // Kibo exposed facility deck
  P.push(box(1.6, 1.8, 1.4, [6.6, -15.0, 0.6], GOLD), box(1.6, 1.8, 1.4, [9.2, -17.0, 0.6], MLI), box(1.4, 1.6, 1.2, [6.8, -17.4, 0.7], GOLD)); // EF payloads
  P.push(cyl('z', 1.2, 3.5, [7.9, 0, 3.6], PAINT)); // Harmony nadir port (cargo vehicle berth)
  P.push(cyl('x', 2.3, 5.5, [-7.0, 0, 0], PAINT)); // Unity
  P.push(cyl('y', 2.25, 6.7, [-7.0, -5.6, 0], PAINT)); // Tranquility
  P.push(cyl('z', 1.5, 1.5, [-7.0, -6.2, 3.0], MLI, 7)); // Cupola
  P.push(cyl('z', 1.1, 0.06, [-7.0, -6.2, 3.78], DARK, 7)); // Cupola top window
  P.push(cyl('y', 2.0, 5.0, [-7.0, 4.5, 0], PAINT)); // Quest airlock
  P.push(cyl('x', 2.2, 6.4, [-0.5, -10.2, 0], PAINT)); // PMM Leonardo (off Tranquility, approx.)
  P.push(cyl('x', 1.0, 2.2, [-10.8, 0, 0], BETA)); // PMA-1
  // Russian segment.
  P.push(cyl('x', 2.05, 12.6, [-18.2, 0, 0], RUS)); // Zarya
  P.push(cyl('z', 1.2, 6.0, [-18.2, 0, 5.0], RUS)); // Rassvet
  P.push(cyl('z', 1.35, 7.0, [-18.2, 0, 11.4], SOYUZ)); // Soyuz at Rassvet
  P.push(cyl('x', 2.1, 9.0, [-31.0, 0, 0], RUS)); // Zvezda work compartment
  P.push(cyl('x', 1.35, 4.0, [-37.5, 0, 0], RUS)); // Zvezda aft
  P.push(sphere(1.6, [-25.5, 0, 0], RUS)); // Zvezda transfer compartment
  P.push(cyl('x', 1.35, 7.4, [-43.2, 0, 0], SOYUZ)); // Progress (aft port)
  P.push(cyl('z', 2.1, 13.0, [-25.5, 0, 8.2], RUS)); // Nauka (nadir)
  P.push(cyl('y', 0.15, 9.0, [-25.5, 3.2, 10.0], MECH, 8)); // ERA arm on Nauka (stowed)
  P.push(sphere(1.6, [-25.5, 0, 16.2], RUS)); // Prichal
  P.push(cyl('z', 1.3, 4.0, [-25.5, 0, -3.8], RUS)); // Poisk (zenith)
  P.push(cyl('z', 1.35, 7.0, [-25.5, 0, -9.5], SOYUZ)); // Soyuz/Progress at Poisk
  for (const s of [1, -1]) {
    // Zvezda arrays (blue-grey cells, 3 m wide), fixed.
    P.push(blanket(3.2, 12.5, [-33.5, s * 9.0, 0], MAT.IROSA, true));
    P.push(box(0.2, 3, 0.2, [-33.5, s * 2.6, 0], MECH));
    // Zarya radiator-like panels on its flanks.
    P.push(box(6.0, 0.08, 1.4, [-18.2, s * 2.1, 0], RAD));
  }
  // Integrated truss along Y above Destiny (−Z = zenith).
  const tz = -4.6;
  P.push(truss(4.6, 13.4, 3.4, [0, 0, tz])); // S0
  P.push(box(4.0, 2.6, 4.6, [0, 0, tz + 2.4], MECH)); // S0 mounts to Destiny
  for (const s of [1, -1]) {
    P.push(truss(4.2, 13.6, 3.2, [0, s * 13.5, tz])); // S1/P1
    P.push(truss(3.8, 6.4, 3.0, [0, s * 23.6, tz])); // S3/P3
    P.push(cyl('y', 2.2, 1.6, [0, s * 27.6, tz], MLI)); // SARJ
    P.push(truss(3.6, 10.6, 3.0, [0, s * 33.6, tz])); // S4/P4
    P.push(truss(3.4, 3.0, 2.8, [0, s * 41.2, tz])); // S5/P5
    P.push(truss(3.6, 12.4, 3.0, [0, s * 48.3, tz])); // S6/P6 (tip at ±54.5)
    // Main thermal radiators (HRS) on S1/P1: three 23 × 3.4 m wings toward nadir, on a rotary joint.
    for (let k = 0; k < 3; k++) P.push(panelYZ(3.3, 22.5, [0.4, s * (8.8 + 3.7 * k), tz + 13.6], RAD));
    P.push(cyl('z', 0.6, 1.6, [0.4, s * 12.5, tz + 2.2], MLI, 12)); // TRRJ
    // Photovoltaic radiators on S4/P4 and S6/P6.
    P.push(panelYZ(3.1, 13.0, [0, s * 37.0, tz + 9.0], RAD));
    P.push(panelYZ(3.1, 13.0, [0, s * 44.6, tz + 9.0], RAD));
    // Canadarm2 (stowed along the truss, approximate) and ExPRESS logistics carriers with payloads.
    if (s > 0) P.push(cyl('y', 0.2, 16, [2.6, 5.0, tz - 2.0], PAINT, 8), cyl('y', 0.3, 0.9, [2.6, 13.4, tz - 2.0], MECH, 10));
    P.push(box(2.4, 4, 0.5, [2.6, s * 19.0, tz - 1.7], PAINT)); // ELC deck
    P.push(box(1.2, 1.4, 1.0, [2.6, s * 18.0, tz - 2.4], GOLD), box(1.0, 1.2, 0.8, [2.6, s * 20.2, tz - 2.3], MLI));
  }
  return merge(P);
}

// ── Hubble ──────────────────────────────────────────────────────────────────────────────────

/** SA3 rigid arrays: two 7.1 × 2.45 m wings on a mast through the equipment section. */
function hubbleArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    const zc = s * (1.2 + 3.55);
    parts.push(blanket(2.45, 7.1, [0, 0, zc], MAT.HSA));
    parts.push(box(0.12, 0.12, 7.5, [0, 0, zc], MECH)); // mast
    for (const e of [1.25, -1.25]) parts.push(box(0.06, 0.06, 7.1, [0, e, zc], MECH)); // frame
    parts.push(box(0.06, 2.5, 0.06, [0, 0, s * 8.3], MECH));
  }
  parts.push(box(0.4, 0.4, 2.4, [0, 0, 0], MECH));
  return merge(parts);
}

function hubbleStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  P.push(cyl('x', 2.1, 4.4, [-4.2, 0, 0], MLI, 32)); // aft shroud
  P.push(cyl('x', 2.1, 0.12, [-6.45, 0, 0], MECH, 32)); // aft bulkhead
  P.push(cyl('x', 2.2, 1.2, [-1.4, 0, 0], MLI, 20)); // equipment section (bays)
  P.push(cyl('x', 1.55, 7.0, [2.7, 0, 0], MLI, 32)); // forward shell + light shield
  for (const x of [0.4, 3.2, 5.6]) P.push(cyl('x', 1.6, 0.12, [x, 0, 0], MECH, 32)); // light-shield stiffener rings
  P.push(cyl('x', 1.6, 0.25, [6.25, 0, 0], DARK, 32)); // aperture ring
  P.push(place(new THREE.CircleGeometry(1.5, 32), [6.25, 0, 0], [0, Math.PI / 2, 0], DARK)); // aperture (dark interior)
  P.push(place(new THREE.CircleGeometry(1.6, 32), [7.1, 0, -1.6], [0, Math.PI / 2 + 1.1, 0], MLI)); // aperture door, open
  P.push(cyl('y', 0.1, 0.5, [6.4, 0, -1.6], MECH, 8)); // door hinge
  for (let k = 0; k < 4; k++) {
    const a = (k + 0.5) * Math.PI / 2;
    const cy = Math.cos(a), cz = Math.sin(a);
    P.push(box(2.6, 0.18, 0.18, [3.2, 1.62 * cy, 1.62 * cz], MECH)); // magnetic torquer bars
    P.push(cyl('x', 0.03, 4.0, [-4.2, 2.17 * Math.cos(a + 0.3), 2.17 * Math.sin(a + 0.3)], HANDRAIL, 6)); // handrails
    P.push(cyl('x', 0.03, 5.5, [2.4, 1.6 * Math.cos(a - 0.3), 1.6 * Math.sin(a - 0.3)], HANDRAIL, 6));
  }
  for (const s of [1, -1]) {
    P.push(cyl('z', 0.08, 4.0, [-1.2, 0, s * 3.4], PAINT, 6)); // high-gain antenna booms
    P.push(place(new THREE.SphereGeometry(0.75, 20, 8, 0, Math.PI * 2, 0, 0.7), [-1.2, 0, s * 5.6], [s > 0 ? -Math.PI / 2 : Math.PI / 2, 0, 0], PAINT));
    P.push(cyl('x', 0.12, 0.5, [5.9, 0, s * 1.45], MECH, 8)); // low-gain antenna
  }
  P.push(box(1.2, 0.9, 0.9, [-2.4, 0, -2.3], MLI)); // fine-guidance / radial bay cover (approx.)
  P.push(box(0.6, 3.0, 0.6, [-1.0, 0, 0], MECH)); // array masts root
  return merge(P);
}

// ── Tiangong ────────────────────────────────────────────────────────────────────────────────

function tiangongLabArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) {
    parts.push(blanket(4.2, 26, [0, 0, s * (1.6 + 13)], MAT.IROSA));
    parts.push(box(0.2, 0.2, 26.5, [0, 0, s * (1.6 + 13)], MECH));
  }
  parts.push(box(0.8, 0.8, 3.2, [0, 0, 0], MECH));
  return merge(parts);
}

function tiangongCoreArray(): THREE.BufferGeometry {
  const parts: Part[] = [];
  for (const s of [1, -1]) parts.push(blanket(2.8, 11, [0, 0, s * (1.3 + 5.5)], MAT.IROSA));
  parts.push(box(0.5, 0.5, 2.6, [0, 0, 0], MECH));
  return merge(parts);
}

function tiangongStructure(): THREE.BufferGeometry {
  const P: Part[] = [];
  P.push(cyl('x', 2.1, 9.0, [-3.0, 0, 0], BETA)); // Tianhe resource / large section
  P.push(cyl('x', 1.4, 4.4, [3.6, 0, 0], BETA)); // Tianhe small section
  P.push(sphere(1.5, [6.6, 0, 0], BETA)); // docking hub
  for (const s of [1, -1]) {
    P.push(cyl('y', 2.1, 16.0, [6.6, s * 9.6, 0], BETA)); // Wentian (+Y) / Mengtian (−Y)
    P.push(cyl('y', 1.4, 2.0, [6.6, s * 2.2, 0], MLI));
    P.push(box(1.6, 6.0, 0.08, [6.6, s * 10.0, -2.2], RAD)); // lab radiators
  }
  P.push(cyl('x', 1.7, 10.0, [-12.6, 0, 0], PAINT)); // Tianzhou (aft)
  P.push(cyl('z', 1.4, 8.0, [6.6, 0, 5.4], PAINT)); // Shenzhou (nadir)
  P.push(box(0.6, 0.6, 2.0, [6.6, 0, -2.2], MECH));
  P.push(cyl('x', 0.15, 10.0, [-3.0, 2.3, -0.6], PAINT, 8)); // Chinarm (stowed)
  return merge(P);
}

export type ModelId = 'iss' | 'hubble' | 'tiangong';
const cache = new Map<ModelId, ModelDef>();

export function modelDef(id: ModelId): ModelDef {
  let d = cache.get(id);
  if (d) return d;
  if (id === 'iss') {
    const tz = -4.6;
    // iROSAs (illustrative channel assignment): P6 both wings, S4 both, P4 and S6 one each — 6 of 8 wings.
    const both = issWingPair(true, true);
    d = {
      structure: issStructure(),
      arrays: [
        { geometry: both, position: [0, -48.3, tz], axis: 'y' },
        { geometry: issWingPair(true, false), position: [0, -33.6, tz], axis: 'y' },
        { geometry: both, position: [0, 33.6, tz], axis: 'y' },
        { geometry: issWingPair(false, true), position: [0, 48.3, tz], axis: 'y' },
      ],
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
attribute float aRough;
attribute float aMat;
varying vec3 vColor;
varying float vRough;
varying float vMat;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;
void main() {
  vColor = color; vRough = aRough; vMat = aMat; vUv = uv; vObj = position; vObjN = normal;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
${NOISE_GLSL}
uniform mat4 modelMatrix;
uniform vec3 uSunDir;       // world (render) axes
uniform float uIrradiance;  // scene irradiance × eclipse factor
uniform float uSunIrr;      // scene irradiance (unshadowed; lights the Earth seen in reflections)
uniform vec3 uEarthDir;     // toward Earth's centre
uniform float uEarthQ;      // R_earth / distance
uniform float uEarthshine;  // Earth-reflected irradiance on a surface facing the Earth
varying vec3 vColor;
varying float vRough;
varying float vMat;
varying vec2 vUv;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;

const vec3 EARTH_TINT = vec3(0.72, 0.85, 1.0);

float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float hash13(vec3 p3) { p3 = fract(p3 * 0.1031); p3 += dot(p3, p3.zyx + 31.32); return fract((p3.x + p3.y) * p3.z); }

// Anti-aliased boundary lines of half-width w (cell units); converges to the mean coverage when sub-pixel.
float lines1(float x, float w) {
  float f = abs(fract(x) - 0.5);
  float fw = fwidth(x) + 1e-5;
  float l = smoothstep(0.5 - w - 0.5 * fw, 0.5 - w + 0.5 * fw, f);
  return mix(l, 2.0 * w, smoothstep(0.15, 0.5, fw));
}
float grid2(vec2 q, vec2 w) { return max(lines1(q.x, w.x), lines1(q.y, w.y)); }
// Planar projection onto the face's dominant plane (object metres).
vec2 planar(vec3 p, vec3 n) {
  vec3 a = abs(n);
  return a.x >= max(a.y, a.z) ? p.yz : (a.y >= a.z ? p.xz : p.xy);
}
// Octave weight that removes noise finer than ~a pixel.
float octW(float fp, float freq) { return 1.0 - smoothstep(0.06, 0.3, fp * freq); }

// Bump mapping from screen-space height derivatives (Mikkelsen), in object space.
vec3 perturb(vec3 p, vec3 n, float h, float face) {
  vec3 sx = dFdx(p), sy = dFdy(p);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1) * face;
  vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - grad);
}

// Radiance of the Earth along a direction (ray-sphere hit; procedural ocean/cloud mottling, day side lit, blue limb).
vec3 earthRadiance(vec3 r) {
  vec3 C = uEarthDir / max(uEarthQ, 1e-4);
  float b = dot(r, C);
  float c = dot(C, C) - 1.0;
  float disc = b * b - c;
  if (b <= 0.0) return vec3(0.0);
  if (disc <= 0.0) {
    vec3 N = normalize(r * b - C);
    float g = exp(-(-disc) * 30.0);
    return vec3(0.25, 0.5, 1.0) * g * 0.08 * uSunIrr * smoothstep(-0.2, 0.3, dot(N, uSunDir));
  }
  float t = b - sqrt(disc);
  vec3 N = normalize(r * t - C);
  float mu = dot(N, uSunDir);
  float cloud = smoothstep(-0.05, 0.45, simplexNoise3(N * 7.0) * 0.7 + simplexNoise3(N * 19.0) * 0.3);
  vec3 alb = mix(vec3(0.045, 0.08, 0.15), vec3(0.75), cloud);
  float limb = pow(1.0 - clamp(-dot(N, r), 0.0, 1.0), 3.0);
  alb = mix(alb, vec3(0.35, 0.55, 1.0), limb * 0.6);
  return alb * max(mu, 0.0) * uSunIrr / PI;
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  float face = gl_FrontFacing ? 1.0 : -1.0;
  vec3 nO = normalize(vObjN) * face;
  int m = int(vMat + 0.5);
  vec3 albedo = vColor;
  float metal = 0.0;
  float rough = vRough;
  float h = 0.0;
  float aniso = 0.0;
  float fp = length(fwidth(vObj)); // pixel footprint (m)
  vec2 q = planar(vObj, nO);
  if (m == 2) {
    // Open truss lattice: aluminium members (longerons, battens, diagonals) over the dark interior.
    vec2 tq = q / 1.45;
    vec2 g = abs(fract(tq) - 0.5);
    float dg = abs(fract(tq.x + tq.y) - 0.5);
    float fw = max(fwidth(tq.x), fwidth(tq.y));
    float mem = max(max(smoothstep(0.43 - fw, 0.46, g.x), smoothstep(0.43 - fw, 0.46, g.y)), smoothstep(0.455 - fw, 0.475, dg));
    mem = mix(mem, 0.35, smoothstep(0.08, 0.3, fw));
    albedo = mix(vec3(0.04), vColor * 1.25, mem);
    rough = mix(0.9, 0.4, mem);
  } else if (m == 1 || m == 8 || m == 9) {
    // Solar cells under coverglass (front), Kapton substrate (back). uv in metres: x along the blanket, y across.
    vec2 cell = m == 1 ? vec2(0.083, 0.083) : (m == 8 ? vec2(0.11, 0.07) : vec2(0.06, 0.04));
    vec2 cq = vUv / cell;
    float gap = grid2(cq, m == 1 ? vec2(0.045, 0.045) : vec2(0.03, 0.03));
    vec2 panelL = m == 1 ? vec2(0.415, 2.3) : (m == 8 ? vec2(0.9, 1.5) : vec2(0.5, 0.62));
    float panel = grid2(vUv / panelL, vec2(0.025, 0.012));
    float var = hash12(floor(cq));
    if (face > 0.0) {
      vec3 cellC = m == 1 ? vec3(0.032, 0.024, 0.034) : (m == 8 ? vec3(0.012, 0.016, 0.045) : vec3(0.028, 0.02, 0.07));
      vec3 gapC = m == 1 ? vec3(0.34, 0.2, 0.05) : vec3(0.26, 0.26, 0.28);
      albedo = mix(cellC * (0.8 + 0.4 * var), gapC, gap);
      albedo = mix(albedo, vec3(0.4, 0.4, 0.42), panel * 0.5); // bus bars / hinge lines
      rough = mix(0.07 + 0.05 * var, 0.5, max(gap, panel));
      h = -0.0015 * gap * octW(fp, 1.0 / cell.x);
    } else {
      albedo = mix(vec3(0.5, 0.3, 0.08), vec3(0.32, 0.2, 0.07), panel * 0.6);
      if (m == 8) albedo = mix(vec3(0.55, 0.55, 0.53), vec3(0.3), panel * 0.6); // iROSA white back
      rough = 0.55;
      h = 0.002 * simplexNoise3(vec3(vUv * 2.0, 0.0)) * octW(fp, 2.0);
    }
  } else if (m == 3 || m == 4) {
    // Crinkled metallised MLI / gold Kapton blankets in stitched panels.
    vec2 pq = q / vec2(1.1, 0.95);
    float seam = grid2(pq, vec2(0.012));
    float pid = hash12(floor(pq) + vec2(m * 7));
    h = 0.012 * simplexNoise3(vObj * 5.0 + pid * 9.0) * octW(fp, 5.0)
      + 0.0025 * simplexNoise3(vObj * 17.0) * octW(fp, 17.0)
      + 0.0015 * simplexNoise3(vObj * 53.0) * octW(fp, 53.0)
      - 0.004 * seam;
    metal = m == 3 ? 0.6 : 0.8; // second-surface foils: part specular, part diffuse
    rough = clamp(vRough * (0.8 + 0.8 * pid), 0.2, 0.6);
    albedo = vColor * (0.88 + 0.14 * pid) * (1.0 - 0.3 * seam);
    aniso = 1.0;
  } else if (m == 5) {
    // White radiator panels: flow-tube ribs every 0.22 m.
    float rib = lines1(q.x / 0.22, 0.06);
    albedo = vColor * (1.0 - 0.18 * rib);
    h = 0.002 * rib * octW(fp, 4.5);
  } else if (m == 6) {
    // Beta cloth / thermal blankets: quilting seams, weave, slight weathering.
    vec2 pq = q / vec2(0.62, 0.55);
    float seam = grid2(pq, vec2(0.02));
    float weather = simplexNoise3(vObj * 0.6) * 0.5 + simplexNoise3(vObj * 2.3) * 0.25;
    albedo = vColor * (1.0 + 0.07 * weather) * (1.0 - 0.3 * seam);
    h = -0.003 * seam + 0.0012 * simplexNoise3(vObj * 9.0) * octW(fp, 9.0);
  } else if (m == 0) {
    // Painted MMOD shield panels with seams and per-panel tone.
    vec2 pq = q / vec2(1.05, 0.9);
    float seam = grid2(pq, vec2(0.012));
    float var = hash12(floor(pq));
    albedo = vColor * (0.94 + 0.08 * var) * (1.0 - 0.25 * seam);
    rough = mix(vRough + 0.1 * var, 0.8, seam);
    h = -0.003 * seam * octW(fp, 1.0);
  }
  if (h != 0.0) nO = perturb(vObj, nO, h, face);
  vec3 n = normalize(mat3(modelMatrix) * nO);
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 L = uSunDir;
  float nl = max(dot(n, L), 0.0);
  float nv = max(dot(n, v), 1e-3);
  float a = max(rough * rough, 0.003);
  vec3 F0 = mix(vec3(0.04), albedo, metal);
  vec3 diffC = albedo * (1.0 - metal);
  // Sun: GGX (anisotropic for foil, stretched along the body axis).
  vec3 hh = normalize(L + v);
  float nh = max(dot(n, hh), 0.0);
  float vh = max(dot(v, hh), 0.0);
  float D;
  if (aniso > 0.5) {
    vec3 axW = normalize(mat3(modelMatrix) * vec3(1.0, 0.0, 0.0));
    vec3 t = axW - n * dot(n, axW);
    t = dot(t, t) > 1e-6 ? normalize(t) : normalize(cross(n, vec3(0.0, 1.0, 0.0)) + 1e-4);
    vec3 bt = cross(n, t);
    float ax = a * 1.8, ay = a * 0.55;
    float th = dot(hh, t) / ax, bh = dot(hh, bt) / ay;
    float d = th * th + bh * bh + nh * nh;
    D = 1.0 / (PI * ax * ay * d * d);
  } else {
    float d = nh * nh * (a * a - 1.0) + 1.0;
    D = a * a / (PI * d * d);
  }
  float k = a * 0.5;
  float G = (nl / (nl * (1.0 - k) + k)) * (nv / (nv * (1.0 - k) + k));
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vh, 5.0);
  vec3 sunSpec = D * G * F / (4.0 * nv + 1e-4); // × nl / nl
  vec3 sun = (diffC * nl / PI + sunSpec * step(0.0, dot(n, L))) * uIrradiance;
  // Earth: diffuse earthshine from below plus its reflection (sharp for smooth finishes, blurred for rough ones).
  float ne = max(dot(n, uEarthDir), 0.0);
  vec3 eDiff = diffC * ne / PI * uEarthshine * EARTH_TINT;
  vec3 r = reflect(-v, n);
  vec3 env = mix(earthRadiance(r), EARTH_TINT * uEarthshine * ne / PI, smoothstep(0.2, 0.75, rough));
  vec3 Fe = F0 + (max(vec3(1.0 - rough), F0) - F0) * pow(1.0 - nv, 5.0);
  gl_FragColor = vec4(sun + eDiff + Fe * env, 1.0);
}`;

export class SpacecraftMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uIrradiance: { value: number };
    uSunIrr: { value: number };
    uEarthDir: { value: THREE.Vector3 };
    uEarthQ: { value: number };
    uEarthshine: { value: number };
  };
  constructor() {
    super({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uIrradiance: { value: 5 },
        uSunIrr: { value: 5 },
        uEarthDir: { value: new THREE.Vector3(0, 0, -1) },
        uEarthQ: { value: 0.9 },
        uEarthshine: { value: 0 },
      },
      side: THREE.DoubleSide,
    });
  }
}
