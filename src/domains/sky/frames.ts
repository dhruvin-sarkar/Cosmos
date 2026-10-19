/**
 * Fixed sky-frame rotations used by the coordinate grids and their labels.
 *
 * ICRS → Galactic: the Hipparcos/ICRS transformation matrix A_G^T (ESA 1997, The Hipparcos and Tycho
 * Catalogues, Vol. 1 §1.5.3, eq. 1.5.11; also Liu, Zhu & Zhang 2011, A&A 526, A16). Rows are the Galactic
 * x (towards l=0,b=0), y (l=90°) and z (North Galactic Pole) axes expressed in ICRS.
 * ICRS → ecliptic: rotation about x by the J2000 mean obliquity ε0 = 84381.406″ (IAU 2006, Capitaine et al. 2003).
 */
import * as THREE from 'three';

export const OBLIQUITY_J2000_RAD = (84381.406 / 3600) * (Math.PI / 180);

/** Rows = Galactic axes in ICRS components. */
export const ICRS_TO_GALACTIC_ROWS: readonly (readonly [number, number, number])[] = [
  [-0.0548755604162154, -0.8734370902348850, -0.4838350155487132],
  [+0.4941094278755837, -0.4448296299600112, +0.7469822444972189],
  [-0.8676661490190047, -0.1980763734312015, +0.4559837761750669],
];

const ce = Math.cos(OBLIQUITY_J2000_RAD);
const se = Math.sin(OBLIQUITY_J2000_RAD);
export const ICRS_TO_ECLIPTIC_ROWS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0],
  [0, ce, se],
  [0, -se, ce],
];

export type GridFrame = 'equatorial' | 'ecliptic' | 'galactic';

/** Rotation matrix (THREE.Matrix3, row-major `set`) that maps an ICRS vector into the given frame. */
export function icrsToFrameMatrix(frame: GridFrame, out = new THREE.Matrix3()): THREE.Matrix3 {
  const r = frame === 'galactic' ? ICRS_TO_GALACTIC_ROWS : frame === 'ecliptic' ? ICRS_TO_ECLIPTIC_ROWS : null;
  if (!r) return out.identity();
  return out.set(r[0][0], r[0][1], r[0][2], r[1][0], r[1][1], r[1][2], r[2][0], r[2][1], r[2][2]);
}

/** Unit ICRS direction of the frame's (lon, lat) in degrees. */
export function frameDirToIcrs(frame: GridFrame, lonDeg: number, latDeg: number, out = new THREE.Vector3()): THREE.Vector3 {
  const lo = (lonDeg * Math.PI) / 180;
  const la = (latDeg * Math.PI) / 180;
  const x = Math.cos(la) * Math.cos(lo);
  const y = Math.cos(la) * Math.sin(lo);
  const z = Math.sin(la);
  const r = frame === 'galactic' ? ICRS_TO_GALACTIC_ROWS : frame === 'ecliptic' ? ICRS_TO_ECLIPTIC_ROWS : null;
  if (!r) return out.set(x, y, z);
  // Inverse of an orthonormal rotation = transpose.
  return out.set(
    r[0][0] * x + r[1][0] * y + r[2][0] * z,
    r[0][1] * x + r[1][1] * y + r[2][1] * z,
    r[0][2] * x + r[1][2] * y + r[2][2] * z,
  );
}

/** ICRS unit vector → (lon, lat) in degrees in the given frame (lon in [0, 360)). */
export function icrsToFrameLonLat(frame: GridFrame, v: THREE.Vector3): { lonDeg: number; latDeg: number } {
  const r = frame === 'galactic' ? ICRS_TO_GALACTIC_ROWS : frame === 'ecliptic' ? ICRS_TO_ECLIPTIC_ROWS : null;
  let x = v.x;
  let y = v.y;
  let z = v.z;
  if (r) {
    const a = r[0][0] * v.x + r[0][1] * v.y + r[0][2] * v.z;
    const b = r[1][0] * v.x + r[1][1] * v.y + r[1][2] * v.z;
    const c = r[2][0] * v.x + r[2][1] * v.y + r[2][2] * v.z;
    x = a;
    y = b;
    z = c;
  }
  let lon = (Math.atan2(y, x) * 180) / Math.PI;
  if (lon < 0) lon += 360;
  const lat = (Math.asin(Math.max(-1, Math.min(1, z / Math.hypot(x, y, z)))) * 180) / Math.PI;
  return { lonDeg: lon, latDeg: lat };
}
