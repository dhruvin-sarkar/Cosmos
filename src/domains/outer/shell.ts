/**
 * Translucent "reconstructed boundary" shell: a rim-lit, gridded surface r(dir) = R·(1 + k·s^p)·(1 + a·dir·north),
 * evaluated on the GPU from unit directions (see model.ts). Used for the termination shock, the heliopause and (with k = a = 0,
 * a full sphere) the Oort-cloud limb. Additive, depth-tested, never writes depth; placed with the Sun's render position.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { ECLIPTIC_NORTH_ICRS, NOSE_ICRS, type ShellParams } from './model';

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
attribute float aPhi;
uniform vec3 uNose;
uniform vec3 uNorth;
uniform float uR;
uniform float uK;
uniform float uP;
uniform float uA;
uniform float uUnitsPerAu;
varying float vTheta;
varying float vPhi;
varying vec3 vView;

void main() {
  float cosT = clamp(dot(position, uNose), -1.0, 1.0);
  float s = 0.5 * (1.0 - cosT);
  float r = uR * (1.0 + uK * pow(s, uP)) * (1.0 + uA * dot(position, uNorth));
  vec4 mv = modelViewMatrix * vec4(position * r * uUnitsPerAu, 1.0);
  vView = mv.xyz;
  vTheta = acos(cosT);
  vPhi = aPhi;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}`;

const FRAGMENT = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uOpacity;
uniform float uThetaMax;
uniform float uBase;
uniform float uRimK;
uniform float uGridK;
uniform float uGridThetaStep;
uniform float uGridPhiStep;
varying float vTheta;
varying float vPhi;
varying vec3 vView;

float gridLine(float x, float step) {
  float g = x / step;
  float w = max(fwidth(g), 1e-4);
  return 1.0 - clamp((abs(fract(g + 0.5) - 0.5)) / (w * 1.2), 0.0, 1.0);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(cross(dFdx(vView), dFdy(vView)));
  float facing = abs(dot(n, normalize(vView)));
  float rim = pow(1.0 - facing, 2.2);
  float grid = max(gridLine(vTheta, uGridThetaStep), gridLine(vPhi, uGridPhiStep) * smoothstep(0.02, 0.12, vTheta));
  float tail = 1.0 - smoothstep(uThetaMax * 0.62, uThetaMax, vTheta);
  float a = uOpacity * tail * (uBase + uRimK * rim + uGridK * grid * (0.3 + 0.7 * rim));
  gl_FragColor = vec4(uColor * a, a);
}`;

export interface ShellVisual {
  mesh: THREE.Mesh;
  material: THREE.ShaderMaterial;
  /** Update the shell for this frame. `unitsPerAu` = AU_M / ctx.metersPerUnit. */
  setFrame(unitsPerAu: number, opacity: number): void;
  dispose(): void;
}

export interface ShellStyle {
  color: [number, number, number];
  base: number;
  rim: number;
  grid: number;
  gridThetaDeg?: number;
  gridPhiDeg?: number;
}

/** Polar grid around the nose axis: θ ∈ [0, thetaMax], φ ∈ [0, 2π]. */
export function buildShellGeometry(thetaMaxRad: number, nTheta: number, nPhi: number): THREE.BufferGeometry {
  const e0 = new THREE.Vector3(NOSE_ICRS.x, NOSE_ICRS.y, NOSE_ICRS.z);
  const north = new THREE.Vector3(ECLIPTIC_NORTH_ICRS.x, ECLIPTIC_NORTH_ICRS.y, ECLIPTIC_NORTH_ICRS.z);
  const e1 = north.clone().addScaledVector(e0, -north.dot(e0)).normalize();
  const e2 = new THREE.Vector3().crossVectors(e0, e1);
  const verts = (nTheta + 1) * (nPhi + 1);
  const pos = new Float32Array(verts * 3);
  const phi = new Float32Array(verts);
  let k = 0;
  for (let i = 0; i <= nTheta; i++) {
    const th = (i / nTheta) * thetaMaxRad;
    const ct = Math.cos(th), st = Math.sin(th);
    for (let j = 0; j <= nPhi; j++) {
      const ph = (j / nPhi) * Math.PI * 2;
      const cp = Math.cos(ph), sp = Math.sin(ph);
      pos[3 * k] = e0.x * ct + st * (e1.x * cp + e2.x * sp);
      pos[3 * k + 1] = e0.y * ct + st * (e1.y * cp + e2.y * sp);
      pos[3 * k + 2] = e0.z * ct + st * (e1.z * cp + e2.z * sp);
      phi[k] = ph;
      k++;
    }
  }
  const idx: number[] = [];
  for (let i = 0; i < nTheta; i++) {
    for (let j = 0; j < nPhi; j++) {
      const a = i * (nPhi + 1) + j, b = a + nPhi + 1;
      idx.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aPhi', new THREE.BufferAttribute(phi, 1));
  g.setIndex(idx);
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e9);
  return g;
}

export function createShellVisual(params: ShellParams, style: ShellStyle, name: string, nTheta = 72, nPhi = 96): ShellVisual {
  const thetaMax = (params.thetaMaxDeg * Math.PI) / 180;
  const material = new THREE.ShaderMaterial({
    vertexShader: VERTEX,
    fragmentShader: FRAGMENT,
    uniforms: {
      uNose: { value: new THREE.Vector3(NOSE_ICRS.x, NOSE_ICRS.y, NOSE_ICRS.z) },
      uNorth: { value: new THREE.Vector3(ECLIPTIC_NORTH_ICRS.x, ECLIPTIC_NORTH_ICRS.y, ECLIPTIC_NORTH_ICRS.z) },
      uR: { value: params.R },
      uK: { value: params.k },
      uP: { value: params.p },
      uA: { value: params.a },
      uUnitsPerAu: { value: 1 },
      uColor: { value: new THREE.Vector3(...style.color) },
      uOpacity: { value: 0 },
      uThetaMax: { value: thetaMax },
      uBase: { value: style.base },
      uRimK: { value: style.rim },
      uGridK: { value: style.grid },
      uGridThetaStep: { value: ((style.gridThetaDeg ?? 15) * Math.PI) / 180 },
      uGridPhiStep: { value: ((style.gridPhiDeg ?? 30) * Math.PI) / 180 },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const geometry = buildShellGeometry(thetaMax, nTheta, nPhi);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = name;
  mesh.frustumCulled = false;
  mesh.visible = false;
  return {
    mesh,
    material,
    setFrame(unitsPerAu, opacity) {
      material.uniforms.uUnitsPerAu.value = unitsPerAu;
      material.uniforms.uOpacity.value = opacity;
      mesh.visible = opacity > 0.003;
    },
    dispose() {
      mesh.removeFromParent();
      geometry.dispose();
      material.dispose();
    },
  };
}
