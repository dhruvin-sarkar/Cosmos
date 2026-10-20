/**
 * Named camera views of the galaxy domain (for tours, bookmarks and screenshots): CameraViewState objects anchored on the
 * galaxy entities, built from the Galactocentric frame so "above" really is above the Galactic plane.
 */
import * as THREE from 'three';
import type { CameraViewState } from '../../core/types';
import { AU_M, KPC_M, PC_M } from '../../core/units';
import { SGRA_RS_M, type V3 } from './model';
import { galaxyRuntime } from './runtime';
import { GALAXY_IDS } from './entities';
import { discBasis } from './blackHoleLayer';

export type GalaxyViewName = 'above' | 'oblique' | 'edge' | 'sun' | 'gc' | 'nsc' | 'sstars' | 'bh' | 'bh-edge' | 'bh-earth';

const v = (a: V3): THREE.Vector3 => new THREE.Vector3(a.x, a.y, a.z);

/** Camera view: anchor + offset (Galactocentric direction × distance) looking at the anchor with `up` (Galactocentric). */
function view(anchorId: string, dirGal: [number, number, number], distM: number, upGal: [number, number, number], lookOffsetGal?: [number, number, number]): CameraViewState {
  const f = galaxyRuntime().frame;
  const ex = v(f.ex), ey = v(f.ey), ez = v(f.ez);
  const toW = (g: [number, number, number]): THREE.Vector3 => ex.clone().multiplyScalar(g[0]).add(ey.clone().multiplyScalar(g[1])).add(ez.clone().multiplyScalar(g[2]));
  const off = toW(dirGal).normalize().multiplyScalar(distM);
  const lookAt = lookOffsetGal ? toW(lookOffsetGal) : new THREE.Vector3();
  const fwd = lookAt.clone().sub(off).normalize();
  const up = toW(upGal).normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, up));
  return { anchorId, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: anchorId, scaleLog10: Math.log10(distM) };
}

/** Black hole view at `inclDeg` from the disc normal (0 = face-on), `azDeg` around it, `distRs` Schwarzschild radii away. */
function bhView(inclDeg: number, azDeg: number, distRs: number): CameraViewState {
  const { n, e1, e2 } = discBasis();
  const i = inclDeg * Math.PI / 180, a = azDeg * Math.PI / 180;
  const inPlane = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
  const off = n.clone().multiplyScalar(Math.cos(i)).addScaledVector(inPlane, Math.sin(i)).multiplyScalar(distRs * SGRA_RS_M);
  const fwd = off.clone().negate().normalize();
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), fwd, n));
  return { anchorId: GALAXY_IDS.sgrA, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: GALAXY_IDS.sgrA, scaleLog10: Math.log10(off.length()) };
}

/** Line of sight from Earth (the EHT's view: disc ≈ 30° from face-on), `distRs` r_s from the hole, sky north up. */
function bhFromEarth(distRs: number): CameraViewState {
  const { toEarth, north } = discBasis();
  const off = toEarth.clone().multiplyScalar(distRs * SGRA_RS_M);
  const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(new THREE.Vector3(), toEarth.clone().negate(), north));
  return { anchorId: GALAXY_IDS.sgrA, offset: [off.x, off.y, off.z], quaternion: [q.x, q.y, q.z, q.w], mode: 'orbit', focusId: GALAXY_IDS.sgrA, scaleLog10: Math.log10(off.length()) };
}

export function galaxyView(name: GalaxyViewName): CameraViewState {
  switch (name) {
    // Face-on from the North Galactic Pole, Sun towards the bottom of the frame.
    case 'above': return view(GALAXY_IDS.galaxy, [-0.12, 0, 1], 62 * KPC_M, [1, 0, 0]);
    case 'oblique': return view(GALAXY_IDS.galaxy, [-0.75, 0.35, 0.55], 58 * KPC_M, [0, 0, 1]);
    case 'edge': return view(GALAXY_IDS.galaxy, [-0.15, 1, 0.045], 56 * KPC_M, [0, 0, 1]);
    // The Sun's neighbourhood from 4 kpc above the plane, Galactic Centre towards the top.
    case 'sun': return view('sol:sun', [-0.35, 0, 1], 5 * KPC_M, [1, 0, 0]);
    case 'gc': return view(GALAXY_IDS.bar, [-0.55, 0.4, 0.75], 14 * KPC_M, [0, 0, 1]);
    case 'nsc': return view(GALAXY_IDS.nsc, [-0.6, 0.5, 0.6], 25 * PC_M, [0, 0, 1]);
    case 'sstars': return view(GALAXY_IDS.sCluster, [-1, 0.25, 0.35], 4200 * AU_M, [0, 0, 1]);
    // Cinematic: 78° from the disc axis, so the far side of the disc is lensed up over the shadow.
    case 'bh': return bhView(78, 200, 46);
    case 'bh-edge': return bhView(86, 200, 40);
    case 'bh-earth': return bhFromEarth(46);
  }
}
