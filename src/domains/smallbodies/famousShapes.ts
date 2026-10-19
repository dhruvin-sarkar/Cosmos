/**
 * Real shape models and spin states of famous small bodies.
 *
 * Shapes: public/data/smallbodies/shapes/index.json + <id>.bin (built by scripts/data/smallbodies/ from the mission shape
 * models; format 'SBSH' v1 — int16 positions × scaleKm / 32767 in the body-fixed frame (+Z = north/positive pole,
 * +X = prime meridian), uint16|uint32 triangle indices, outward winding). Missing files fall back to the procedural shape.
 *
 * Spin states: IAU WGCCRE 2015 (Archinal et al. 2018) where defined, otherwise the mission papers cited per entry.
 * Poles are the positive (right-hand-rule) poles, so Ẇ > 0 even for retrograde rotators (IAU convention for small bodies).
 * Orientation follows the IAU convention: body → ICRS = Rz(α₀ + 90°) · Rx(90° − δ₀) · Rz(W), W = W₀ + Ẇ·d (d = days from J2000 TDB).
 */
import * as THREE from 'three';
import { DEG } from '../../core/units';
import { eclipticToIcrs } from '../../core/frames';
import { hashString } from './shape';

export interface ShapeIndexEntry {
  file: string;
  vertices: number;
  triangles: number;
  meanRadiusKm: number;
  extentKm: [number, number, number];
  model: string;
  source: string;
  citation: string;
  license: string;
}

export interface ShapeIndex {
  version: number;
  generated?: string;
  shapes: Record<string, ShapeIndexEntry>;
}

export interface SpinState {
  /** Pole right ascension / declination (ICRS, deg). */
  raDeg: number;
  decDeg: number;
  /** Prime meridian at J2000 (deg) and rotation rate (deg/day, about the positive pole). */
  w0Deg: number;
  wDotDegPerDay: number;
  source: string;
}

const fromPeriod = (hours: number): number => (360 * 24) / hours;

function eclPole(lonDeg: number, latDeg: number): { raDeg: number; decDeg: number } {
  const v = eclipticToIcrs(
    { x: Math.cos(latDeg * DEG) * Math.cos(lonDeg * DEG), y: Math.cos(latDeg * DEG) * Math.sin(lonDeg * DEG), z: Math.sin(latDeg * DEG) },
    new THREE.Vector3(),
  );
  return { raDeg: (Math.atan2(v.y, v.x) / DEG + 360) % 360, decDeg: Math.asin(Math.max(-1, Math.min(1, v.z))) / DEG };
}

/** Known spin states (pole + rotation). Bodies not listed get an illustrative pole and their SBDB period. */
export const SPIN_STATES: Record<string, SpinState> = {
  vesta: { raDeg: 309.031, decDeg: 42.235, w0Deg: 285.39, wDotDegPerDay: 1617.3329428, source: 'IAU WGCCRE 2015 (Archinal et al. 2018)' },
  eros: { raDeg: 11.35, decDeg: 17.22, w0Deg: 326.07, wDotDegPerDay: 1639.38864745, source: 'IAU WGCCRE 2015 (Archinal et al. 2018)' },
  itokawa: { raDeg: 90.53, decDeg: -66.3, w0Deg: 0, wDotDegPerDay: 712.143, source: 'IAU WGCCRE 2015 (Archinal et al. 2018)' },
  psyche: { raDeg: 32.8, decDeg: 6.0, w0Deg: 0, wDotDegPerDay: fromPeriod(4.195948), source: 'Shepard et al. 2021 (PSJ 2, 125)' },
  bennu: { raDeg: 85.65, decDeg: -60.17, w0Deg: 150.0, wDotDegPerDay: 2011.145, source: 'Lauretta et al. 2019 (Nature 568, 55); Barnouin et al. 2019' },
  ryugu: { raDeg: 96.4, decDeg: -66.4, w0Deg: 0, wDotDegPerDay: fromPeriod(7.63262), source: 'Watanabe et al. 2019 (Science 364, 268)' },
  didymos: { ...eclPole(310, -84), w0Deg: 0, wDotDegPerDay: fromPeriod(2.2600), source: 'Naidu et al. 2020 (Icarus 348); Daly et al. 2023 (Nature 616, 443)' },
  arrokoth: { raDeg: 317.5, decDeg: -24.9, w0Deg: 0, wDotDegPerDay: fromPeriod(15.9380), source: 'Stern et al. 2019 (Science 364); Spencer et al. 2020 (Science 367)' },
  '67p': { raDeg: 69.54, decDeg: 64.11, w0Deg: 114.69, wDotDegPerDay: 696.543884683, source: 'Jorda et al. 2016 (Icarus 277, 257); ESA SPICE frame' },
  apophis: { ...eclPole(250, -75), w0Deg: 0, wDotDegPerDay: fromPeriod(30.56), source: 'Pravec et al. 2014 (Icarus 233), tumbling; principal-axis approximation' },
};

const J2000_MS = 946728000000;
const qa = new THREE.Quaternion();
const qb = new THREE.Quaternion();
const qc = new THREE.Quaternion();
const AX_X = new THREE.Vector3(1, 0, 0);
const AX_Z = new THREE.Vector3(0, 0, 1);

/** Illustrative but deterministic pole for bodies without a published spin state. */
export function illustrativeSpin(id: string, periodH: number | null): SpinState {
  const h = hashString(id);
  return {
    raDeg: ((h & 0xffff) / 0xffff) * 360,
    decDeg: (((h >>> 16) / 0xffff) * 2 - 1) * 63,
    w0Deg: (h % 360),
    wDotDegPerDay: fromPeriod(periodH ?? 12),
    source: 'illustrative',
  };
}

/** Body-fixed → ICRS rotation at Unix-ms `tMs`. */
export function spinQuaternion(spin: SpinState, tMs: number, out: THREE.Quaternion): THREE.Quaternion {
  const d = (tMs - J2000_MS) / 86400000;
  const W = ((spin.w0Deg + spin.wDotDegPerDay * d) % 360) * DEG;
  qa.setFromAxisAngle(AX_Z, (spin.raDeg + 90) * DEG);
  qb.setFromAxisAngle(AX_X, (90 - spin.decDeg) * DEG);
  qc.setFromAxisAngle(AX_Z, W);
  return out.copy(qa).multiply(qb).multiply(qc);
}

/** Pole unit vector (ICRS). */
export function spinPole(spin: SpinState, out: THREE.Vector3): THREE.Vector3 {
  const a = spin.raDeg * DEG, dd = spin.decDeg * DEG;
  return out.set(Math.cos(dd) * Math.cos(a), Math.cos(dd) * Math.sin(a), Math.sin(dd));
}

/** Decode an 'SBSH' v1 binary into a geometry in km (body-fixed), with smooth vertex normals. Throws on a bad file. */
export function decodeShape(buf: ArrayBuffer): { geometry: THREE.BufferGeometry; scaleKm: number } {
  const dv = new DataView(buf);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== 'SBSH' || dv.getUint32(4, true) !== 1) throw new Error('bad shape file');
  const nv = dv.getUint32(8, true), nt = dv.getUint32(12, true);
  const scale = dv.getFloat32(16, true);
  const wide = (dv.getUint32(20, true) & 1) === 1;
  const q = new Int16Array(buf, 24, nv * 3);
  const pos = new Float32Array(nv * 3);
  const k = scale / 32767;
  for (let i = 0; i < pos.length; i++) pos[i] = q[i] * k;
  const idxOff = 24 + Math.ceil((nv * 6) / 4) * 4;
  const idx = wide ? new Uint32Array(buf.slice(idxOff, idxOff + nt * 12)) : new Uint16Array(buf.slice(idxOff, idxOff + nt * 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  return { geometry: g, scaleKm: scale };
}

let indexPromise: Promise<ShapeIndex | null> | null = null;

/** The shape index (null when absent). Cached. */
export function loadShapeIndex(json: (path: string) => Promise<unknown>): Promise<ShapeIndex | null> {
  indexPromise ??= json('data/smallbodies/shapes/index.json')
    .then((j) => (j && typeof j === 'object' && 'shapes' in j ? (j as ShapeIndex) : null))
    .catch(() => null);
  return indexPromise;
}

/** Mission shape models shipped in public/data/smallbodies/shapes/ (mirrors index.json, for synchronous FactSheets). */
export const REAL_SHAPES: Record<string, { model: string; citation: string; license: string }> = {
  bennu: { model: 'OSIRIS-REx OLA global shape model v021 (3.25 m), decimated to 40k facets', citation: 'OSIRIS-REx Altimetry Working Group; Daly et al. 2020, Sci. Adv. 6', license: 'NASA PDS (public domain)' },
  ryugu: { model: 'Hayabusa2 ONC SfM shape model SHAPE_SFM_49k_v20180804, decimated to 40k facets', citation: 'Watanabe et al. 2019, Science 364, 268 (JAXA/Hayabusa2)', license: 'JAXA DARTS open data (credit JAXA and the Hayabusa2 team)' },
  eros: { model: 'NEAR Shoemaker Gaskell shape model v1.0 (ver128q), decimated to 40k facets', citation: 'Gaskell 2008, NEAR-A-MSI-5-EROSSHAPE-V1.0', license: 'NASA PDS (public domain)' },
  itokawa: { model: 'Hayabusa Gaskell shape model v1.0 (ver128q), decimated to 40k facets', citation: 'Gaskell et al. 2008, HAY-A-AMICA-5-ITOKAWASHAPE-V1.0', license: 'NASA PDS (public domain)' },
  didymos: { model: 'DART SPC shape model v003 (4.657 m), decimated to 20k facets', citation: 'Daly et al. 2023, DART Shape Model Bundle (doi:10.26007/96fn-p578)', license: 'NASA PDS (public domain)' },
  dimorphos: { model: 'DART SPC shape model v004 (0.972 m), decimated to 20k facets', citation: 'Daly et al. 2024, PSJ 5, 24', license: 'NASA PDS (public domain)' },
  arrokoth: { model: 'New Horizons merged shape model (mu69_merged), decimated to 40k facets', citation: 'Spencer et al. 2020, Science 367, eaay3999', license: 'NASA PDS (public domain)' },
  '67p': { model: 'Rosetta NAVCAM SPC shape model MTP019 (low resolution), decimated to 40k facets', citation: 'ESA/Rosetta/NAVCAM; RO-C-MULTI-5-67P-SHAPE-V2.0', license: 'CC BY-SA 3.0 IGO' },
};
