/**
 * Procedural spacecraft models at TRUE size in metres (illustrative geometry at accurate proportions, real colours), built
 * from merged primitives. Body frame: +Z is the "business axis" — the high-gain antenna boresight (toward Earth) or the heat
 * shield normal (toward the Sun) for Parker, Solar Orbiter and JWST; arrays that roll to the Sun have their cells on +Y,
 * arrays fixed to the antenna axis (Juno, Clipper, Psyche, Lucy, Hera, JUICE) face +Z.
 * Vertex attributes: color (linear reflectance), aSpec (specular strength), aMat (0 paint/metal, 1 solar cells, 2 multilayer
 * insulation foil with crinkle relief, 3 sunshield membrane).
 * Sources for dimensions: agency fact sheets cited in spacecraft.ts (CRAFT_INFO[*].specs / page).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import type { CraftModelId } from './spacecraft';

type V3 = [number, number, number];

// Linear reflectances.
const GOLD: V3 = [0.5, 0.3, 0.075]; // aluminised Kapton seen through its amber film
const AMBER: V3 = [0.42, 0.22, 0.05]; // Cassini's darker amber blankets
const SILVER: V3 = [0.55, 0.55, 0.57];
const BLACKMLI: V3 = [0.045, 0.045, 0.05];
const WHITE: V3 = [0.7, 0.7, 0.68];
const GREY: V3 = [0.22, 0.22, 0.23];
const DARK: V3 = [0.035, 0.035, 0.04];
const TITANIUM: V3 = [0.38, 0.37, 0.36];
const SUBSTRATE: V3 = [0.3, 0.3, 0.3];
const MEMBRANE1: V3 = [0.62, 0.5, 0.62]; // JWST layer 1: silicon-doped coating, faint magenta sheen
const MEMBRANE: V3 = [0.64, 0.64, 0.66];
const MIRROR_GOLD: V3 = [0.85, 0.6, 0.2];

const enum Mat { Plain = 0, Cells = 1, Foil = 2, Membrane = 3 }

interface Part { geo: THREE.BufferGeometry; color: V3; spec: number; mat: number }

const m4 = new THREE.Matrix4();
const qq = new THREE.Quaternion();
const eu = new THREE.Euler();
const one = new THREE.Vector3(1, 1, 1);
const pv = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

function place(geo: THREE.BufferGeometry, pos: V3, rot: V3, color: V3, spec: number, mat = 0): Part {
  eu.set(rot[0], rot[1], rot[2]);
  qq.setFromEuler(eu);
  m4.compose(pv.set(pos[0], pos[1], pos[2]), qq, one);
  geo.applyMatrix4(m4);
  return { geo, color, spec, mat };
}
/** Apply a transform to already-built parts (sub-assemblies). */
function xform(parts: Part[], pos: V3, rot: V3): Part[] {
  eu.set(rot[0], rot[1], rot[2]);
  qq.setFromEuler(eu);
  m4.compose(pv.set(pos[0], pos[1], pos[2]), qq, one);
  for (const p of parts) p.geo.applyMatrix4(m4);
  return parts;
}

const box = (sx: number, sy: number, sz: number, pos: V3, color: V3, spec = 0.25, mat = 0, rot: V3 = [0, 0, 0]): Part =>
  place(new THREE.BoxGeometry(sx, sy, sz), pos, rot, color, spec, mat);
/** Prism / cylinder along Z. */
const cylZ = (rt: number, rb: number, len: number, pos: V3, color: V3, spec = 0.25, mat = 0, seg = 20, rot: V3 = [0, 0, 0]): Part => {
  const g = new THREE.CylinderGeometry(rt, rb, len, seg);
  g.rotateX(Math.PI / 2);
  return place(g, pos, rot, color, spec, mat);
};
/** Rod between two points. */
function rod(a: V3, b: V3, r: number, color: V3 = GREY, spec = 0.3, seg = 6): Part {
  const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, d.normalize()));
  g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
  return { geo: g, color, spec, mat: 0 };
}
/** Parabolic-looking dish (spherical cap) opening toward +Z, rim radius r, depth d, apex at `pos`. */
function dish(r: number, depth: number, pos: V3, color: V3 = WHITE, rot: V3 = [0, 0, 0]): Part[] {
  const R = (r * r + depth * depth) / (2 * depth);
  const theta = Math.asin(Math.min(r / R, 1));
  const g = new THREE.SphereGeometry(R, 40, 6, 0, Math.PI * 2, Math.PI - theta, theta);
  g.translate(0, R, 0);
  g.rotateX(Math.PI / 2);
  const rim = new THREE.TorusGeometry(r, Math.max(r * 0.02, 0.01), 4, 40);
  rim.translate(0, 0, depth);
  const feed = new THREE.CylinderGeometry(r * 0.06, r * 0.09, r * 0.35, 10);
  feed.rotateX(Math.PI / 2);
  feed.translate(0, 0, r * 0.18);
  return [place(g, pos, rot, color, 0.15), place(rim, pos, rot, color, 0.2), place(feed, pos, rot, GREY, 0.3)];
}
/** Solar-array panel: substrate + cell blanket. 'z': lies in XY, cells on +Z. 'y': lies in XZ, cells on +Y. */
function cells(len: number, width: number, pos: V3, rot: V3 = [0, 0, 0], facing: 'z' | 'y' = 'z'): Part[] {
  const t = 0.035;
  const sub = facing === 'z' ? new THREE.BoxGeometry(len, width, t) : new THREE.BoxGeometry(len, t, width);
  const blanket = new THREE.PlaneGeometry(len * 0.985, width * 0.97);
  if (facing === 'y') blanket.rotateX(-Math.PI / 2);
  blanket.translate(0, facing === 'y' ? t / 2 + 0.003 : 0, facing === 'z' ? t / 2 + 0.003 : 0);
  return [place(sub, pos, rot, SUBSTRATE, 0.2), place(blanket, pos, rot, [0.02, 0.025, 0.05], 0.9, Mat.Cells)];
}
/** A wing of `n` panels along +X from `x0` (mirrored for side −1). */
function wing(n: number, panelLen: number, width: number, x0: number, side: 1 | -1, y: number, z: number, facing: 'z' | 'y' = 'z', tilt = 0): Part[] {
  const out: Part[] = [];
  const gap = 0.06;
  for (let i = 0; i < n; i++) {
    const cx = side * (x0 + panelLen / 2 + i * (panelLen + gap));
    out.push(...cells(panelLen, width, [cx, y, z], [tilt, 0, 0], facing));
  }
  out.push(rod([side * (x0 - 0.3), y, z], [side * (x0 + 0.05), y, z], 0.05, TITANIUM)); // yoke
  return out;
}
/** Flat polygon (XY plane, +Z normal) extruded slightly. */
function slab(points: [number, number][], thick: number, pos: V3, color: V3, spec: number, mat: number, rot: V3 = [0, 0, 0]): Part {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  return place(g, pos, rot, color, spec, mat);
}

// ── Models ────────────────────────────────────────────────────────────────────────────────────────────────────

/** JWST sunshield outline (m): an elongated hexagon 21.2 × 14.2 m. */
const JWST_A = 10.6, JWST_B = 7.08, JWST_XC = 5.4;
const jwstOutline = (k: number): [number, number][] =>
  [[JWST_A, 0], [JWST_XC, JWST_B], [-JWST_XC, JWST_B], [-JWST_A, 0], [-JWST_XC, -JWST_B], [JWST_XC, -JWST_B]].map(([x, y]) => [x * k, y * k] as [number, number]);

function jwst(): Part[] {
  const p: Part[] = [];
  // Five membrane layers; layer 1 (+Z) faces the Sun. Layers spread apart toward the edges in reality; spaced evenly here.
  for (let i = 0; i < 5; i++) p.push(slab(jwstOutline(1 - i * 0.012), 0.01, [0, 0, -i * 0.28], i === 0 ? MEMBRANE1 : MEMBRANE, 0.55, Mat.Membrane));
  // Mid-booms, fore/aft pallets, spreader bars.
  p.push(rod([0, 1.0, -0.55], [0, JWST_B, -0.55], 0.07, GREY), rod([0, -1.0, -0.55], [0, -JWST_B, -0.55], 0.07, GREY));
  p.push(box(1.2, 4.2, 0.35, [JWST_A - 1.2, 0, -0.55], BLACKMLI, 0.3), box(1.2, 4.2, 0.35, [-JWST_A + 1.2, 0, -0.55], BLACKMLI, 0.3));
  // Spacecraft bus on the warm side, solar array, Earth-pointing antenna, momentum flap.
  p.push(box(2.1, 2.1, 1.5, [-1.0, 0, 1.05], BLACKMLI, 0.4, Mat.Foil), box(2.15, 2.15, 0.05, [-1.0, 0, 1.82], SILVER, 0.5, Mat.Foil));
  p.push(...cells(5.6, 2.0, [-4.9, 0, 1.4], [0, 0, 0], 'z'));
  p.push(...dish(0.3, 0.08, [0.4, -0.7, 1.85]));
  p.push(box(1.6, 2.4, 0.03, [-JWST_A - 0.6, 0, -0.9], DARK, 0.6, 0, [0, -0.6, 0]));
  // Deployable tower up through the shield to the telescope.
  p.push(cylZ(0.32, 0.32, 3.0, [-1.0, 0, -0.9], GREY, 0.3, 0, 12));
  // Optical telescope element (cold side, −Z): primary mirror in the YZ plane facing +X.
  const ote: Part[] = [];
  const R = 0.762; // segment circumradius (1.32 m flat to flat)
  const F = 16; // curvature: segments tilt toward a focus F m in front
  const n = new THREE.Vector3();
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      const ring = Math.max(Math.abs(q), Math.abs(r), Math.abs(s));
      if (ring === 0 || ring > 2) continue;
      const cx = 1.5 * R * q * 1.006, cy = Math.sqrt(3) * R * (r + q / 2) * 1.006;
      const hex = new THREE.CylinderGeometry(R * 0.995, R * 0.995, 0.06, 6);
      hex.rotateX(Math.PI / 2); // axis +Z; a vertex on +X matches the layout
      hex.rotateZ(Math.PI / 2 - Math.PI / 2);
      n.set(-cx, -cy, 2 * F).normalize();
      hex.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n));
      hex.translate(cx, cy, (cx * cx + cy * cy) / (4 * F));
      ote.push({ geo: hex, color: MIRROR_GOLD, spec: 1.0, mat: 0 });
    }
  }
  ote.push(box(2.4, 5.8, 0.6, [0, 0, -0.45], DARK, 0.2)); // backplane
  ote.push(box(2.2, 2.2, 2.0, [0, 0, -1.8], BLACKMLI, 0.4, Mat.Foil)); // ISIM
  ote.push(cylZ(0.3, 0.42, 0.9, [0, 0, 0.45], DARK, 0.2, 0, 16)); // aft-optics baffle
  const sm: V3 = [0, 0, 7.15];
  ote.push(cylZ(0.37, 0.37, 0.12, sm, MIRROR_GOLD, 1.0, 0, 6), cylZ(0.4, 0.4, 0.25, [0, 0, 7.33], DARK, 0.2, 0, 6));
  ote.push(rod([2.9, 0, 0.2], [0.3, 0, 7.1], 0.05, DARK), rod([-1.6, 2.6, 0.2], [-0.15, 0.25, 7.1], 0.05, DARK), rod([-1.6, -2.6, 0.2], [-0.15, -0.25, 7.1], 0.05, DARK));
  // Local +Z (boresight) → world +X; local +X → world −Z (away from the shield).
  p.push(...xform(ote, [-2.4, 0, -5.0], [0, Math.PI / 2, 0]));
  return p;
}

function voyager(): Part[] {
  return [
    ...dish(1.83, 0.42, [0, 0, 0.5]),
    rod([0.9, 0, 0.92], [0, 0, 1.55], 0.02), rod([-0.45, 0.78, 0.92], [0, 0, 1.55], 0.02), rod([-0.45, -0.78, 0.92], [0, 0, 1.55], 0.02),
    cylZ(0.2, 0.2, 0.12, [0, 0, 1.58], WHITE, 0.2, 0, 16), // sub-reflector
    cylZ(0.89, 0.89, 0.47, [0, 0, 0.24], BLACKMLI, 0.55, Mat.Foil, 10), // decagonal bus
    cylZ(0.9, 0.9, 0.03, [0, 0, 0.0], SILVER, 0.5, Mat.Foil, 10),
    cylZ(0.36, 0.25, 0.4, [0, 0, -0.2], WHITE, 0.2, 0, 16), // propellant tank / adapter
    // RTG boom with three finned generators.
    rod([-0.85, 0, 0.1], [-3.2, 0, -0.25], 0.04, GREY),
    ...[1.8, 2.35, 2.9].flatMap((x): Part[] => [
      place(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 12), [-x, 0, 0.1 - x * 0.15], [0, 0, Math.PI / 2], DARK, 0.25),
      box(0.5, 0.62, 0.02, [-x, 0, 0.1 - x * 0.15], DARK, 0.2), box(0.5, 0.02, 0.62, [-x, 0, 0.1 - x * 0.15], DARK, 0.2),
    ]),
    // Science boom and scan platform (cameras).
    rod([0.85, 0, 0.1], [2.6, 0, -0.1], 0.05, GREY),
    box(0.6, 0.5, 0.45, [2.75, 0, -0.15], GREY, 0.3, Mat.Foil),
    place(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 12), [2.7, -0.55, -0.1], [0, 0, 0], WHITE, 0.25),
    place(new THREE.CylinderGeometry(0.08, 0.08, 0.5, 12), [2.95, -0.45, -0.3], [0, 0, 0], WHITE, 0.25),
    // 13 m magnetometer boom, plasma-wave antennas.
    rod([0, 0.85, 0.1], [-1.2, 12.9, -0.4], 0.035, GREY, 0.3, 4),
    box(0.12, 0.12, 0.12, [-1.2, 12.9, -0.4], GREY, 0.3),
    rod([-0.5, -0.6, -0.05], [-3.3, -7.0, -5.8], 0.012, SILVER, 0.5, 4),
    rod([0.5, -0.6, -0.05], [3.3, -7.0, -5.8], 0.012, SILVER, 0.5, 4),
  ];
}

function newHorizons(): Part[] {
  return [
    cylZ(1.35, 1.35, 0.72, [0, 0, 0], GOLD, 0.7, Mat.Foil, 3, [0, 0, Math.PI / 2]),
    ...dish(1.05, 0.26, [0.15, 0, 0.36]),
    // RTG on its mount, pointing away from a triangle vertex.
    rod([-0.6, 0, -0.1], [-1.25, 0, -0.1], 0.08, GREY),
    place(new THREE.CylinderGeometry(0.21, 0.21, 1.1, 14), [-1.8, 0, -0.1], [0, 0, Math.PI / 2], DARK, 0.25),
    box(1.1, 0.6, 0.02, [-1.8, 0, -0.1], DARK, 0.2), box(1.1, 0.02, 0.6, [-1.8, 0, -0.1], DARK, 0.2),
    // Instruments: LORRI telescope, Ralph, Alice, SWAP.
    place(new THREE.CylinderGeometry(0.11, 0.11, 0.62, 14), [0.45, -0.9, -0.15], [0, 0, 0], SILVER, 0.5),
    box(0.4, 0.3, 0.3, [0.9, -0.55, -0.2], BLACKMLI, 0.3, Mat.Foil),
    box(0.25, 0.25, 0.35, [0.2, 0.75, -0.2], BLACKMLI, 0.3, Mat.Foil),
    cylZ(0.15, 0.15, 0.06, [-0.3, 0.6, -0.4], GREY, 0.3, 0, 12),
  ];
}

function parker(): Part[] {
  const p: Part[] = [
    cylZ(1.15, 1.15, 0.114, [0, 0, 1.3], [0.06, 0.06, 0.06], 0.1, 0, 48), // carbon-foam shield
    place(new THREE.CircleGeometry(1.14, 48), [0, 0, 1.3 + 0.059], [0, 0, 0], [0.82, 0.8, 0.76], 0.05), // white alumina face
    cylZ(0.55, 0.55, 1.1, [0, 0, 0.1], BLACKMLI, 0.5, Mat.Foil, 6),
    cylZ(0.56, 0.56, 0.04, [0, 0, 0.66], SILVER, 0.4, 0, 6),
    box(0.9, 0.05, 0.7, [0, 0.62, 0.95], WHITE, 0.15), box(0.9, 0.05, 0.7, [0, -0.62, 0.95], WHITE, 0.15), // radiators
    ...cells(0.62, 1.1, [1.0, 0, -0.1], [0, -1.2, 0], 'z'), ...cells(0.62, 1.1, [-1.0, 0, -0.1], [0, 1.2, 0], 'z'),
    ...dish(0.3, 0.07, [0, 0.5, -0.5], WHITE, [Math.PI, 0, 0]),
    rod([0, 0, -0.45], [0, 0, -2.0], 0.025, GREY, 0.3, 4), box(0.1, 0.1, 0.1, [0, 0, -1.4], GREY), box(0.1, 0.1, 0.1, [0, 0, -2.0], GREY),
  ];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.3;
    p.push(rod([Math.cos(a) * 0.82, Math.sin(a) * 0.82, 1.24], [Math.cos(a + 0.5) * 0.48, Math.sin(a + 0.5) * 0.48, 0.66], 0.025, DARK));
  }
  // FIELDS whip antennas fan out just behind the shield rim.
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    p.push(rod([Math.cos(a) * 0.9, Math.sin(a) * 0.9, 1.2], [Math.cos(a) * 3.0, Math.sin(a) * 3.0, 1.05], 0.012, SILVER, 0.6, 4));
  }
  return p;
}

function juno(): Part[] {
  const p: Part[] = [
    cylZ(1.75, 1.75, 1.45, [0, 0, 0], GOLD, 0.65, Mat.Foil, 6),
    cylZ(1.76, 1.76, 0.04, [0, 0, 0.74], BLACKMLI, 0.4, 0, 6),
    box(0.85, 0.85, 0.8, [0.35, 0.2, 1.15], TITANIUM, 0.45), // radiation vault
    ...dish(1.25, 0.3, [0, 0, 1.25]),
    cylZ(0.25, 0.45, 0.6, [0, 0, -1.0], DARK, 0.4, 0, 16), // main engine
  ];
  for (let w = 0; w < 3; w++) {
    const a = (w * 2 * Math.PI) / 3;
    const n = w === 2 ? 3 : 4;
    const panels = wing(n, 2.2, 2.65, 1.85, 1, 0, 0.1, 'z');
    if (w === 2) panels.push(box(1.0, 0.6, 0.6, [1.85 + 3 * 2.26 + 0.5, 0, 0.1], SILVER, 0.5, Mat.Foil)); // magnetometer boom
    p.push(...xform(panels, [0, 0, 0], [0, 0, a]));
  }
  return p;
}

function clipper(): Part[] {
  return [
    cylZ(0.75, 0.75, 3.0, [0, 0, -0.6], SILVER, 0.5, Mat.Foil, 20),
    box(1.5, 1.5, 1.0, [0, 0, 1.3], TITANIUM, 0.4),
    ...dish(1.5, 0.35, [0, 0, 1.82]),
    ...wing(5, 2.7, 4.1, 0.9, 1, 0, -0.2, 'z'), ...wing(5, 2.7, 4.1, 0.9, -1, 0, -0.2, 'z'),
    rod([0, 0.75, -1.5], [0, 9.3, -1.5], 0.03, GREY, 0.3, 4), box(0.15, 0.15, 0.15, [0, 9.3, -1.5], GREY),
    cylZ(0.3, 0.4, 0.5, [0, 0, -2.3], DARK, 0.3, 0, 12),
    box(0.8, 0.6, 0.6, [0.5, -0.9, 0.6], BLACKMLI, 0.3, Mat.Foil), // instrument deck
  ];
}

function crossWing(side: 1 | -1, x0: number, panelLen: number, width: number): Part[] {
  const p = wing(3, panelLen, width, x0, side, 0, 0, 'z');
  const midX = side * (x0 + 1.5 * panelLen + 0.06);
  p.push(...cells(panelLen * 0.9, width, [midX, width + 0.08, 0]), ...cells(panelLen * 0.9, width, [midX, -width - 0.08, 0]));
  return p;
}

function psyche(): Part[] {
  return [
    box(2.4, 2.2, 2.4, [0, 0, 0], SILVER, 0.5, Mat.Foil),
    ...dish(1.0, 0.22, [0, 0, 1.2]),
    ...crossWing(1, 1.3, 3.6, 2.4), ...crossWing(-1, 1.3, 3.6, 2.4),
    cylZ(0.2, 0.25, 0.3, [0.5, 0, -1.35], DARK, 0.3, 0, 12), cylZ(0.2, 0.25, 0.3, [-0.5, 0, -1.35], DARK, 0.3, 0, 12),
    box(0.3, 0.3, 1.8, [0.8, 0.9, 0.2], GREY, 0.3), // instrument boom
  ];
}

function lucy(): Part[] {
  const fan = (x: number): Part[] => [
    place(new THREE.CircleGeometry(3.6, 20), [x, 0, -0.29], [0, 0, 0], [0.02, 0.025, 0.05], 0.9, Mat.Cells),
    place(new THREE.CircleGeometry(3.62, 20), [x, 0, -0.32], [Math.PI, 0, 0], SUBSTRATE, 0.2),
    rod([Math.sign(x) * 0.85, 0, -0.3], [x - Math.sign(x) * 3.6, 0, -0.3], 0.06, TITANIUM),
    ...Array.from({ length: 10 }, (_, i) => rod([x, 0, -0.28], [x + 3.6 * Math.cos((i * Math.PI) / 5), 3.6 * Math.sin((i * Math.PI) / 5), -0.28], 0.015, SILVER, 0.4, 4)),
  ];
  return [
    box(1.7, 1.7, 2.0, [0, 0, 0], GOLD, 0.65, Mat.Foil),
    ...dish(1.0, 0.22, [0, 0, 1.0]),
    ...fan(5.3), ...fan(-5.3),
    box(0.8, 0.6, 0.55, [0, -1.15, 0.5], BLACKMLI, 0.3, Mat.Foil),
    place(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 12), [0.25, -1.55, 0.5], [0, 0, 0], SILVER, 0.5),
  ];
}

function hera(): Part[] {
  return [
    box(1.6, 1.6, 1.7, [0, 0, 0], GOLD, 0.65, Mat.Foil),
    box(1.62, 1.62, 0.05, [0, 0, 0.86], BLACKMLI, 0.3),
    ...dish(0.57, 0.14, [0.3, 0, 0.88]),
    ...wing(3, 1.6, 1.6, 0.85, 1, 0, 0, 'y'), ...wing(3, 1.6, 1.6, 0.85, -1, 0, 0, 'y'),
    box(0.45, 0.35, 0.4, [-0.4, -0.95, 0.5], DARK, 0.3), // AFC camera + instrument deck
  ];
}

function juice(): Part[] {
  const crossY = (side: 1 | -1): Part[] => {
    const p = wing(3, 3.3, 2.5, 1.35, side, 0, 0, 'y');
    const midX = side * (1.35 + 1.5 * 3.3 + 0.06);
    p.push(...cells(3.0, 2.5, [midX, 0, 2.58]), ...cells(3.0, 2.5, [midX, 0, -2.58]));
    // side panels of the cross lie in the XZ plane too
    p.splice(p.length - 4, 4, ...cells(3.0, 2.5, [midX, 0, 2.58], [0, 0, 0], 'y'), ...cells(3.0, 2.5, [midX, 0, -2.58], [0, 0, 0], 'y'));
    return p;
  };
  return [
    box(2.4, 2.4, 3.6, [0, 0, -0.4], GOLD, 0.6, Mat.Foil),
    box(2.42, 2.42, 0.6, [0, 0, 1.1], SILVER, 0.5, Mat.Foil),
    ...dish(1.25, 0.3, [0, 0, 1.4]),
    ...crossY(1), ...crossY(-1),
    rod([0, -1.2, -1.0], [0, -11.8, -1.0], 0.035, GREY, 0.3, 4), box(0.15, 0.15, 0.15, [0, -11.8, -1.0], GREY),
    rod([-0.6, 1.2, 1.3], [-0.6, 16.0, 1.3], 0.03, SILVER, 0.5, 4), // RIME radar antenna
    cylZ(0.3, 0.45, 0.5, [0, 0, -2.45], DARK, 0.3, 0, 12),
  ];
}

function bepicolombo(): Part[] {
  return [
    // MTM (bottom), with two long array wings that roll to the Sun.
    box(3.6, 3.6, 1.7, [0, 0, -2.2], SILVER, 0.5, Mat.Foil),
    ...wing(5, 2.4, 2.4, 1.85, 1, 0, -2.2, 'y'), ...wing(5, 2.4, 2.4, 1.85, -1, 0, -2.2, 'y'),
    cylZ(0.25, 0.35, 0.4, [0.8, 0.8, -3.25], DARK, 0.3, 0, 12), cylZ(0.25, 0.35, 0.4, [-0.8, -0.8, -3.25], DARK, 0.3, 0, 12),
    // MPO: radiator panel (white) and its single three-panel array.
    box(3.0, 3.0, 1.6, [0, 0, -0.45], SILVER, 0.5, Mat.Foil),
    box(0.05, 2.8, 1.5, [1.53, 0, -0.45], WHITE, 0.1),
    ...wing(3, 2.4, 1.8, 1.6, -1, 0, -0.45, 'y', 0.5),
    ...dish(0.5, 0.12, [0.6, -1.55, -0.45], WHITE, [Math.PI / 2, 0, 0]),
    // Mio inside the MOSIF sunshade (top).
    cylZ(0.9, 0.9, 0.9, [0, 0, 0.85], [0.03, 0.04, 0.08], 0.8, Mat.Cells, 8),
    place(new THREE.CylinderGeometry(1.15, 1.45, 1.6, 20, 1, true), [0, 0, 0.95], [Math.PI / 2, 0, 0], SILVER, 0.55, Mat.Foil),
  ];
}

function solarOrbiter(): Part[] {
  return [
    box(3.1, 2.4, 0.35, [0, 0, 1.9], [0.035, 0.035, 0.035], 0.05), // titanium shield, black calcium-phosphate front
    box(3.12, 2.42, 0.04, [0, 0, 1.7], SILVER, 0.4),
    rod([1.2, 0.9, 1.7], [1.0, 0.8, 1.55], 0.04, GREY), rod([-1.2, -0.9, 1.7], [-1.0, -0.8, 1.55], 0.04, GREY),
    box(2.5, 2.4, 2.6, [0, 0, 0.25], SILVER, 0.5, Mat.Foil),
    box(2.52, 0.05, 2.4, [0, 1.23, 0.25], WHITE, 0.1), // radiator
    ...wing(3, 2.4, 2.1, 1.35, 1, 0, 0.3, 'z', -0.9), ...wing(3, 2.4, 2.1, 1.35, -1, 0, 0.3, 'z', -0.9),
    rod([0, -1.2, -0.8], [0, -5.6, -1.3], 0.04, GREY, 0.3, 4), box(0.15, 0.15, 0.15, [0, -4.0, -1.12], GREY), box(0.15, 0.15, 0.15, [0, -5.6, -1.3], GREY),
    ...dish(0.55, 0.13, [0.9, 1.0, -1.05], WHITE, [Math.PI, 0, 0]),
    rod([1.2, 1.2, -1.0], [5.5, 4.0, -3.0], 0.012, SILVER, 0.5, 4), rod([-1.2, 1.2, -1.0], [-5.5, 4.0, -3.0], 0.012, SILVER, 0.5, 4),
    rod([0, -1.2, -1.0], [0, -3.5, -6.5], 0.012, SILVER, 0.5, 4),
  ];
}

function cassini(): Part[] {
  const p: Part[] = [
    ...dish(2.0, 0.55, [0, 0, 2.55]),
    rod([1.0, 0, 2.85], [0, 0, 3.7], 0.025), rod([-0.5, 0.87, 2.85], [0, 0, 3.7], 0.025), rod([-0.5, -0.87, 2.85], [0, 0, 3.7], 0.025),
    cylZ(0.25, 0.25, 0.12, [0, 0, 3.72], WHITE, 0.2, 0, 16),
    cylZ(1.0, 1.0, 0.7, [0, 0, 2.1], BLACKMLI, 0.4, Mat.Foil, 12), // 12-bay electronics bus
    cylZ(1.05, 1.05, 3.1, [0, 0, 0.2], AMBER, 0.7, Mat.Foil, 24), // propulsion module in amber blankets
    cylZ(0.75, 0.9, 0.45, [0, 0, -1.6], BLACKMLI, 0.4, Mat.Foil, 16),
    cylZ(0.18, 0.4, 0.75, [0.38, 0, -2.2], SILVER, 0.5, 0, 16), cylZ(0.18, 0.4, 0.75, [-0.38, 0, -2.2], SILVER, 0.5, 0, 16),
    // Huygens probe on the side (gold-blanketed back cover facing out).
    place(new THREE.CylinderGeometry(0.35, 1.35, 0.45, 32), [1.45, 0, 0.6], [0, 0, -Math.PI / 2], GOLD, 0.6, Mat.Foil),
    // Remote-sensing and fields-and-particles pallets, magnetometer boom.
    box(0.9, 0.5, 1.0, [0, -1.25, 1.4], BLACKMLI, 0.3, Mat.Foil), box(0.8, 0.5, 0.8, [0, 1.25, 1.4], SILVER, 0.4, Mat.Foil),
    rod([-0.9, 0, 2.2], [-11.5, 0, 2.2], 0.03, GREY, 0.3, 4), box(0.15, 0.15, 0.15, [-11.5, 0, 2.2], GREY),
    rod([0.5, 0.8, 2.3], [3.5, 8.5, 2.3], 0.01, SILVER, 0.5, 4), rod([-0.5, 0.8, 2.3], [-3.5, 8.5, 2.3], 0.01, SILVER, 0.5, 4),
  ];
  for (const a of [0.6, 2.7, 4.6]) {
    const x = Math.cos(a) * 1.35, y = Math.sin(a) * 1.35;
    p.push(cylZ(0.22, 0.22, 1.13, [x, y, -1.45], DARK, 0.25, 0, 12), box(0.62, 0.02, 1.1, [x, y, -1.45], DARK, 0.2, 0, [0, 0, a]));
  }
  return p;
}

function dart(): Part[] {
  const rosa = (side: 1 | -1): Part[] => [
    ...cells(8.4, 2.35, [side * 4.85, 0, 0], [0, 0, 0], 'y'),
    rod([side * 0.6, 0, 1.2], [side * 9.05, 0, 1.2], 0.04, TITANIUM), rod([side * 0.6, 0, -1.2], [side * 9.05, 0, -1.2], 0.04, TITANIUM),
    cylZ(0.08, 0.08, 2.4, [side * 9.05, 0, 0], TITANIUM, 0.4, 0, 8),
  ];
  return [
    box(1.2, 1.3, 1.3, [0, 0, 0], SILVER, 0.5, Mat.Foil),
    box(1.22, 1.32, 0.04, [0, 0, -0.66], GOLD, 0.6, Mat.Foil),
    cylZ(0.5, 0.5, 0.05, [0, 0, 0.68], [0.3, 0.3, 0.3], 0.3, 0, 32), // radial-line-slot array antenna
    place(new THREE.CylinderGeometry(0.16, 0.16, 0.7, 16), [0.2, -0.95, 0.2], [0, 0, 0], BLACKMLI, 0.4), // DRACO camera
    cylZ(0.22, 0.3, 0.3, [0, 0, -0.85], DARK, 0.3, 0, 16), // NEXT-C ion thruster
    ...rosa(1), ...rosa(-1),
  ];
}

const BUILDERS: Record<CraftModelId, () => Part[]> = {
  jwst, voyager, 'new-horizons': newHorizons, parker, juno, clipper, psyche, lucy, hera, juice, bepicolombo,
  'solar-orbiter': solarOrbiter, cassini, dart,
};

/**
 * Shadow casters for the cheap self-shadow in the shader: shield plane (object z, m), half-extents a (x) and b (y), and
 * shape (0 ellipse, 1 JWST hexagon, 2 rectangle). Anything behind the shield (−Z) whose ray to the Sun crosses it is shaded.
 */
export const CRAFT_SHIELD: Partial<Record<CraftModelId, [number, number, number, number]>> = {
  jwst: [-1.13, JWST_A, JWST_B, 1],
  parker: [1.24, 1.15, 1.15, 0],
  'solar-orbiter': [1.68, 1.55, 1.2, 2],
};

function merge(parts: Part[]): THREE.BufferGeometry {
  const gs = parts.map((p) => {
    const g = p.geo.index ? p.geo.toNonIndexed() : p.geo;
    if (g !== p.geo) p.geo.dispose();
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    const spec = new Float32Array(n);
    const mat = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      col[3 * i] = p.color[0]; col[3 * i + 1] = p.color[1]; col[3 * i + 2] = p.color[2];
      spec[i] = p.spec;
      mat[i] = p.mat;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSpec', new THREE.BufferAttribute(spec, 1));
    g.setAttribute('aMat', new THREE.BufferAttribute(mat, 1));
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'color' && k !== 'aSpec' && k !== 'aMat') g.deleteAttribute(k);
    return g;
  });
  const out = mergeGeometries(gs, false);
  gs.forEach((g) => g.dispose());
  out.computeBoundingSphere();
  return out;
}

const cache = new Map<CraftModelId, THREE.BufferGeometry>();
/** Merged geometry of a model, in metres (cached; shared between craft of the same model). */
export function craftGeometry(model: CraftModelId): THREE.BufferGeometry {
  let g = cache.get(model);
  if (!g) {
    g = merge(BUILDERS[model]());
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
attribute float aMat;
varying vec3 vColor;
varying float vSpec;
varying float vMat;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;
void main() {
  vColor = color; vSpec = aSpec; vMat = aMat; vObj = position; vObjN = normal;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vPosW = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uSunDir;      // world
uniform vec3 uSunObj;      // object space
uniform float uIrradiance; // scene irradiance × eclipse × display gain
uniform vec4 uShield;      // z, a, b, shape (−1 none)
uniform vec3 uFillDir;     // world, toward the nearby planet
uniform vec3 uFill;        // planetshine irradiance (rgb, scene units)
uniform float uUnits;      // render units per metre (bump heights)
varying vec3 vColor;
varying float vSpec;
varying float vMat;
varying vec3 vNormalW;
varying vec3 vPosW;
varying vec3 vObj;
varying vec3 vObjN;

float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vnoise(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Screen-space bump (three.js perturbNormalArb): height h in world units.
vec3 bump(vec3 n, float h) {
  vec3 sx = dFdx(vPosW), sy = dFdy(vPosW);
  vec3 r1 = cross(sy, n), r2 = cross(n, sx);
  float det = dot(sx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
float gridLine(vec2 q, float w) {
  vec2 g = abs(fract(q) - 0.5);
  vec2 fw = fwidth(q) + 1e-4;
  vec2 l = smoothstep(vec2(0.5 - w) - fw, vec2(0.5 - w), g);
  return mix(max(l.x, l.y), 2.0 * w, smoothstep(0.25, 0.6, max(fw.x, fw.y)));
}
bool shielded() {
  if (uShield.w < 0.0 || vObj.z > uShield.x - 0.005 || uSunObj.z <= 0.02) return false;
  float t = (uShield.x - vObj.z) / uSunObj.z;
  vec2 h = abs(vObj.xy + uSunObj.xy * t);
  if (uShield.w < 0.5) return dot(h / uShield.yz, h / uShield.yz) < 1.0;
  if (uShield.w < 1.5) return h.y < uShield.z && h.x < uShield.y - (uShield.y - 0.51 * uShield.y) * h.y / uShield.z;
  return h.x < uShield.y && h.y < uShield.z;
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vPosW);
  vec3 albedo = vColor;
  float specK = vSpec;
  float shin = 30.0;
  vec3 specCol = vec3(1.0);
  if (vMat > 2.5) {
    // Sunshield membrane: large soft pillowing, aluminised (specular, tinted on layer 1).
    float fw = length(fwidth(vObj * 0.7));
    float h = vnoise(vObj * 0.7) * 0.04 * (1.0 - smoothstep(0.3, 1.0, fw));
    n = bump(n, h * uUnits);
    shin = 60.0; specCol = mix(vec3(1.0), vColor * 1.4, 0.5); albedo = vColor * 0.55;
  } else if (vMat > 1.5) {
    // Multilayer insulation: crinkled metallised film. Metallic: specular takes the film colour.
    vec3 q = vObj * 7.0;
    float fw = length(fwidth(q));
    float h = (vnoise(q) * 0.65 + vnoise(q * 2.7 + 3.1) * 0.35) * 0.012 * (1.0 - smoothstep(0.35, 1.2, fw));
    n = bump(n, h * uUnits);
    shin = 45.0; specCol = vColor * 1.7; albedo = vColor * 0.35;
  } else if (vMat > 0.5) {
    // Solar cells: dark cells in a silver grid under cover glass (sharp glints); blanket seams every ~0.6 m.
    vec3 an = abs(vObjN);
    vec2 q = an.z > 0.5 ? vObj.xy : an.y > 0.5 ? vObj.xz : vObj.yz;
    float grid = gridLine(q / vec2(0.04, 0.07), 0.07);
    float seam = gridLine(q / 0.62, 0.015);
    albedo = mix(vColor, vec3(0.32, 0.31, 0.3), grid * 0.45 + seam * 0.6);
    shin = 260.0; specK = 0.08;
  }
  float nl = dot(n, uSunDir);
  float lit = shielded() ? 0.0 : 1.0;
  float nlc = max(nl, 0.0);
  vec3 hv = normalize(uSunDir + v);
  float norm = (shin + 8.0) / (8.0 * 3.14159265);
  vec3 spec = specCol * specK * norm * pow(max(dot(n, hv), 0.0), shin) * step(0.0, nl);
  vec3 rad = (albedo / 3.14159265 + spec) * nlc * uIrradiance * lit;
  rad += albedo / 3.14159265 * max(dot(n, uFillDir), 0.0) * uFill;
  gl_FragColor = vec4(rad, 1.0);
}`;

export class CraftMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uSunObj: { value: THREE.Vector3 };
    uIrradiance: { value: number };
    uShield: { value: THREE.Vector4 };
    uFillDir: { value: THREE.Vector3 };
    uFill: { value: THREE.Vector3 };
    uUnits: { value: number };
  };
  constructor(model: CraftModelId) {
    const s = CRAFT_SHIELD[model];
    super({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uSunObj: { value: new THREE.Vector3(0, 0, 1) },
        uIrradiance: { value: 5 },
        uShield: { value: s ? new THREE.Vector4(s[0], s[1], s[2], s[3]) : new THREE.Vector4(0, 0, 0, -1) },
        uFillDir: { value: new THREE.Vector3(0, 0, -1) },
        uFill: { value: new THREE.Vector3(0, 0, 0) },
        uUnits: { value: 1 },
      },
      side: THREE.DoubleSide,
    });
  }
}
