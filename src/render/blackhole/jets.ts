/**
 * Relativistic jets outside the lensing sphere: two camera-facing ribbons along ±axis, log-spaced from z0 (the lens
 * radius, where the ray-marched part of the jet ends) to the jet length. Width follows the parabolic collimation
 * measured for M87 (w ∝ z^0.6 up to ~3×10⁵ r_s; Asada & Nakamura 2012, ApJ 745, L28) and turns conical beyond.
 * Surface brightness is Doppler-boosted by δ³ (approaching jet brighter, the counter-jet faint) with knots that move
 * outwards. Shapes, brightness and colour are ILLUSTRATIVE; additive linear HDR.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { NOISE_GLSL } from '../glsl/noise';

const SEGMENTS = 96;

const VERT = /* glsl */ `
${VERTEX_PRELUDE}
uniform vec3 uBh;
uniform vec3 uAxis;
uniform vec3 uCamRs;
uniform float uRsUnits;
uniform float uZ0;
uniform float uZ1;
uniform float uW;
uniform float uZb;
uniform vec3 uDiscN;
uniform float uDiscOut;
uniform float uDiscAlpha;
varying float vZ;
varying float vOcc;
varying float vSide;
varying float vCos;
void main() {
  float u = position.x;
  float side = position.y;
  float sgn = position.z;
  float z = exp(mix(log(uZ0), log(uZ1), u));
  vec3 p = uAxis * z * sgn;
  vec3 toCam = normalize(uCamRs - p);
  vec3 perp = cross(uAxis, toCam);
  if (dot(perp, perp) < 1e-8) perp = cross(uAxis, abs(uAxis.x) < 0.9 ? vec3(1.0, 0.0, 0.0) : vec3(0.0, 1.0, 0.0));
  perp = normalize(perp);
  float w = uW * (0.6 + pow(min(z, uZb), 0.6)) * max(1.0, z / uZb);
  vec3 q = p + perp * side * 2.5 * w;
  vZ = z;
  vSide = side;
  vCos = dot(uAxis * sgn, toCam);
  // The thin disc hides the part of the jet on its far side (per vertex: where the sight line crosses the disc plane).
  float sp = dot(q, uDiscN);
  float sc = dot(uCamRs, uDiscN);
  vOcc = 0.0;
  if (uDiscOut > 0.0 && sp * sc < 0.0) {
    vec3 xc = uCamRs + (q - uCamRs) * (sc / (sc - sp));
    vOcc = uDiscAlpha * (1.0 - smoothstep(uDiscOut * 0.55, uDiscOut, length(xc)));
  }
  gl_Position = projectionMatrix * modelViewMatrix * vec4(uBh + q * uRsUnits, 1.0);
  ${LOGDEPTH_VERTEX}
}`;

const FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
${NOISE_GLSL}
uniform float uBeta;
uniform float uGain;
uniform float uZ0;
uniform float uZ1;
uniform float uTime;
uniform float uOpacity;
uniform float uDcam;
varying float vZ;
varying float vOcc;
varying float vSide;
varying float vCos;
void main() {
  ${LOGDEPTH_FRAGMENT}
  float gam = inversesqrt(1.0 - uBeta * uBeta);
  // Floor on δ: seen from the side a fast jet is deboosted to near-invisibility; keep it readable (illustrative).
  float dop = max(1.0 / (gam * (1.0 - uBeta * vCos)), 0.6);
  float prof = exp(-pow(vSide * 2.5, 2.0));
  float lz = log(vZ);
  float knots = 0.5 + 0.5 * smoothstep(-0.35, 0.65, simplexNoise3(vec3(lz * 6.0 - uTime * 0.25, vSide * 0.8, sign(vCos) * 3.0)));
  // Brightness falls as z^-1/2 from the base, referenced to the camera's scale so the part in view stays visible.
  float s = 1.772 / (1.0 + 0.15 * uZ0) * min(1.0, pow(vZ / max(uZ0, 0.08 * uDcam), -0.5));
  float tail = 1.0 - smoothstep(0.6, 1.0, (lz - log(uZ0)) / max(log(uZ1 / uZ0), 1e-3));
  vec3 col = vec3(0.55, 0.72, 1.0) * uGain * s * prof * knots * tail * dop * dop * dop * uOpacity * (1.0 - vOcc);
  gl_FragColor = vec4(col, 1.0);
}`;

export interface JetParams {
  /** Bulk speed, fraction of c. */
  beta: number;
  /** Brightness (matches the ray-marched jet gain). */
  gain: number;
  /** Width scale (r_s), as uJetW in the lens shader. */
  width: number;
  /** Jet length, r_s. */
  lengthRs: number;
  /** Distance (r_s) over which the jet base brightens and accelerates in the ray-marched part; default 14. */
  baseRs?: number;
  /** Camera distance (r_s) below which the jet fades out (it fills the view from inside its cone); fully shown at 4×. */
  fadeInRs?: number;
  /** Brightness of the large-scale jet (the ribbons) relative to `gain`; default 1. */
  ribbonGain?: number;
}

export interface JetRibbons {
  readonly mesh: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial>;
  /**
   * @param bhRender black hole position in render space
   * @param axis unit jet axis (world axes)
   * @param camRs camera relative to the hole, r_s
   * @param rsUnits render units per r_s
   * @param z0 start of the ribbon, r_s (the lens radius)
   */
  update(bhRender: THREE.Vector3, axis: THREE.Vector3, camRs: THREE.Vector3, rsUnits: number, z0: number, p: JetParams, timeSec: number, opacity: number): void;
  /** The thin disc that hides the counter-jet behind it (outerRs 0 = none). */
  setDisc(normal: THREE.Vector3, outerRs: number, alpha: number): void;
  dispose(): void;
}

export function createJetRibbons(): JetRibbons {
  const pos = new Float32Array((SEGMENTS + 1) * 2 * 2 * 3);
  const idx: number[] = [];
  let k = 0;
  for (const sgn of [1, -1]) {
    const base = k / 3;
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = i / SEGMENTS;
      pos[k++] = u; pos[k++] = -1; pos[k++] = sgn;
      pos[k++] = u; pos[k++] = 1; pos[k++] = sgn;
      if (i < SEGMENTS) {
        const a = base + i * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uBh: { value: new THREE.Vector3() },
      uAxis: { value: new THREE.Vector3(0, 0, 1) },
      uCamRs: { value: new THREE.Vector3() },
      uRsUnits: { value: 1 },
      uZ0: { value: 30 },
      uZ1: { value: 1e4 },
      uW: { value: 0.25 },
      uZb: { value: 3e5 },
      uBeta: { value: 0.9 },
      uGain: { value: 1 },
      uTime: { value: 0 },
      uOpacity: { value: 1 },
      uDcam: { value: 1 },
      uDiscN: { value: new THREE.Vector3(0, 0, 1) },
      uDiscOut: { value: 0 },
      uDiscAlpha: { value: 0.9 },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = 'blackhole-jets';
  mesh.frustumCulled = false;
  mesh.renderOrder = 51;
  mesh.visible = false;
  return {
    mesh,
    update(bhRender, axis, camRs, rsUnits, z0, p, timeSec, opacity) {
      const u = mat.uniforms;
      (u.uBh.value as THREE.Vector3).copy(bhRender);
      (u.uAxis.value as THREE.Vector3).copy(axis);
      (u.uCamRs.value as THREE.Vector3).copy(camRs);
      u.uRsUnits.value = rsUnits;
      u.uZ0.value = Math.max(1.5, z0);
      u.uZ1.value = Math.max(z0 * 2, p.lengthRs);
      u.uW.value = p.width;
      u.uBeta.value = Math.min(0.995, Math.max(0, p.beta));
      u.uGain.value = p.gain * (p.ribbonGain ?? 1);
      u.uTime.value = timeSec;
      u.uOpacity.value = opacity;
      u.uDcam.value = camRs.length();
    },
    setDisc(normal, outerRs, alpha) {
      (mat.uniforms.uDiscN.value as THREE.Vector3).copy(normal);
      mat.uniforms.uDiscOut.value = outerRs;
      mat.uniforms.uDiscAlpha.value = alpha;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
