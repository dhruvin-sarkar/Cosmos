/**
 * Companion star of the hero black-hole system: a blackbody sphere with limb darkening, convective mottling,
 * gravity darkening and — for Roche-lobe-filling donors — a tidal teardrop pointing at the black hole (ILLUSTRATIVE
 * shape). And the mass-transfer stream: gas from the L1 point (or a focused stellar wind, Cygnus X-1) curving onto the
 * disc rim under the Coriolis force (Lubow & Shu 1975), drawn as flowing additive particles. Linear HDR.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { NOISE_GLSL } from '../../render/glsl/noise';
import { BLACKBODY_GLSL } from '../../render/glsl/blackbody';

const STAR_VERT = /* glsl */ `
${VERTEX_PRELUDE}
uniform vec3 uToBh;
uniform float uStretch;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying float vTip;
void main() {
  vec3 n = normalize(position);
  float s = max(dot(n, uToBh), 0.0);
  float tip = pow(s, 4.0);
  vec3 p = n + uToBh * tip * uStretch;
  // Approximate normal of the stretched surface: tilt towards the axis-perpendicular direction near the tip.
  vec3 perp = n - uToBh * dot(n, uToBh);
  vN = normalize(mix(n, normalize(perp + 1e-4), tip * uStretch * 0.6));
  vObj = n;
  vTip = tip;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vView = -mv.xyz;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}`;

const STAR_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
${NOISE_GLSL}
${BLACKBODY_GLSL}
uniform float uTeff;
uniform float uIntensity;
uniform float uTime;
uniform float uGrain;
uniform mat3 uViewRot;
varying vec3 vN;
varying vec3 vObj;
varying vec3 vView;
varying float vTip;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 nv = normalize(uViewRot * vN);
  float mu = clamp(dot(nv, normalize(vView)), 0.0, 1.0);
  // Limb darkening a little stronger than the V-band law so it survives the highlight tone curve.
  float limb = max(1.0 - 0.72 * (1.0 - mu) - 0.2 * (1.0 - mu) * (1.0 - mu), 0.04);
  float cells = fbm3(vObj * uGrain + vec3(0.0, 0.0, uTime * 0.02), 4);
  float mottle = 1.0 + 0.16 * cells;
  float gdark = 1.0 - 0.3 * vTip;
  float T = uTeff * (1.0 - 0.06 * vTip) * (1.0 + 0.01 * cells);
  vec3 col = blackbodyLinearSrgb(T) * uIntensity * limb * mottle * gdark;
  gl_FragColor = vec4(col, 1.0);
}`;

export interface CompanionMesh {
  readonly mesh: THREE.Mesh<THREE.SphereGeometry, THREE.ShaderMaterial>;
  set(teffK: number, intensity: number, rocheFill: number, grain: number): void;
  update(render: THREE.Vector3, radiusUnits: number, toBh: THREE.Vector3, cameraQuat: THREE.Quaternion, timeSec: number): void;
  dispose(): void;
}

export function createCompanionMesh(): CompanionMesh {
  const mat = new THREE.ShaderMaterial({
    vertexShader: STAR_VERT,
    fragmentShader: STAR_FRAG,
    uniforms: {
      uToBh: { value: new THREE.Vector3(1, 0, 0) },
      uStretch: { value: 0 },
      uTeff: { value: 5800 },
      uIntensity: { value: 12 },
      uTime: { value: 0 },
      uGrain: { value: 22 },
      uViewRot: { value: new THREE.Matrix3() },
    },
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), mat);
  mesh.name = 'blackhole-companion';
  mesh.frustumCulled = false;
  mesh.visible = false;
  const m4 = new THREE.Matrix4();
  return {
    mesh,
    set(teffK, intensity, rocheFill, grain) {
      mat.uniforms.uTeff.value = teffK;
      mat.uniforms.uIntensity.value = intensity;
      mat.uniforms.uStretch.value = rocheFill >= 0.9 ? Math.min(0.45, (rocheFill - 0.9) * 4.5 + 0.15) : 0;
      mat.uniforms.uGrain.value = grain;
    },
    update(render, radiusUnits, toBh, cameraQuat, timeSec) {
      mesh.position.copy(render);
      mesh.scale.setScalar(radiusUnits);
      (mat.uniforms.uToBh.value as THREE.Vector3).copy(toBh);
      mat.uniforms.uTime.value = timeSec;
      // World → view rotation for normals (the mesh has no rotation; the camera only rotates).
      m4.makeRotationFromQuaternion(cameraQuat).invert();
      (mat.uniforms.uViewRot.value as THREE.Matrix3).setFromMatrix4(m4);
    },
    dispose() {
      mesh.geometry.dispose();
      mat.dispose();
    },
  };
}

// ── Mass-transfer stream ─────────────────────────────────────────────────────────────────────

const STREAM_COUNT = 2400;

const STREAM_VERT = /* glsl */ `
${VERTEX_PRELUDE}
attribute vec3 aSeed;
uniform vec3 uBh;
uniform vec3 uU;
uniform vec3 uW;
uniform vec3 uN;
uniform float uAUnits;
uniform float uL1;
uniform float uRd;
uniform float uWind;
uniform float uTime;
uniform float uPixelRatio;
uniform float uPxPerUnit;
varying float vBright;
vec2 bez(vec2 a, vec2 b, vec2 c, float t) { float m = 1.0 - t; return m * m * a + 2.0 * m * t * b + t * t * c; }
void main() {
  float s = fract(aSeed.x + uTime * (0.025 + 0.02 * aSeed.y));
  float hit = 1.15;
  vec2 p0 = vec2(uL1, 0.0);
  vec2 p2 = uRd * vec2(cos(hit), sin(hit));
  vec2 p1 = vec2(uL1 * 0.42, uL1 * 0.34);
  float spread = mix(0.012, 0.035, s);
  if (uWind > 0.5) {
    // Focused wind: leaves a wide patch of the star's BH-facing surface, converges onto the disc.
    float ang = (aSeed.z - 0.5) * 1.3 * (1.0 - s);
    p0 = vec2(uL1 + 0.04 * cos(ang * 2.0), 0.22 * ang);
    spread = mix(0.06, 0.02, s);
  }
  vec2 q = bez(p0, p1, p2, s);
  vec2 dq = normalize(bez(p0, p1, p2, min(s + 0.01, 1.0)) - bez(p0, p1, p2, max(s - 0.01, 0.0)) + 1e-5);
  vec2 side = vec2(-dq.y, dq.x);
  float j1 = (fract(aSeed.y * 91.7) - 0.5) * 2.0;
  float j2 = (fract(aSeed.z * 53.3) - 0.5) * 2.0;
  vec3 pos = uU * q.x + uW * q.y;
  pos += (uU * side.x + uW * side.y) * j1 * spread + uN * j2 * spread * 0.6;
  vec4 mv = modelViewMatrix * vec4(uBh + pos * uAUnits, 1.0);
  gl_Position = projectionMatrix * mv;
  float sizePx = clamp(0.012 * uAUnits * uPxPerUnit / max(-mv.z, 1e-6), 1.2, 6.0);
  gl_PointSize = sizePx * uPixelRatio;
  vBright = smoothstep(0.0, 0.08, s) * (0.5 + 0.9 * s * s) * (1.0 - smoothstep(0.93, 1.0, s)) / (sizePx * sizePx);
  ${LOGDEPTH_VERTEX}
}`;

const STREAM_FRAG = /* glsl */ `
${FRAGMENT_PRELUDE}
uniform vec3 uColor;
uniform float uGain;
varying float vBright;
void main() {
  ${LOGDEPTH_FRAGMENT}
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(uColor * (uGain * vBright * exp(-3.0 * r2)), 1.0);
}`;

export interface MassStream {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  update(o: {
    bhRender: THREE.Vector3; u: THREE.Vector3; w: THREE.Vector3; n: THREE.Vector3; aUnits: number; l1: number; discR: number;
    wind: boolean; timeSec: number; pixelRatio: number; pxPerUnit: number; gain: number;
  }): void;
  dispose(): void;
}

export function createMassStream(): MassStream {
  const seeds = new Float32Array(STREAM_COUNT * 3);
  let h = 12345;
  const rnd = (): number => ((h = (h * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(STREAM_COUNT * 3), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e30);
  const mat = new THREE.ShaderMaterial({
    vertexShader: STREAM_VERT,
    fragmentShader: STREAM_FRAG,
    uniforms: {
      uBh: { value: new THREE.Vector3() },
      uU: { value: new THREE.Vector3(1, 0, 0) },
      uW: { value: new THREE.Vector3(0, 1, 0) },
      uN: { value: new THREE.Vector3(0, 0, 1) },
      uAUnits: { value: 1 },
      uL1: { value: 0.5 },
      uRd: { value: 0.3 },
      uWind: { value: 0 },
      uTime: { value: 0 },
      uPixelRatio: { value: 1 },
      uPxPerUnit: { value: 1000 },
      uColor: { value: new THREE.Color(0.75, 0.85, 1.0) },
      uGain: { value: 6 },
    },
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    depthTest: true,
  });
  const points = new THREE.Points(geo, mat);
  points.name = 'blackhole-stream';
  points.frustumCulled = false;
  points.renderOrder = 52;
  points.visible = false;
  return {
    points,
    update(o) {
      const u = mat.uniforms;
      (u.uBh.value as THREE.Vector3).copy(o.bhRender);
      (u.uU.value as THREE.Vector3).copy(o.u);
      (u.uW.value as THREE.Vector3).copy(o.w);
      (u.uN.value as THREE.Vector3).copy(o.n);
      u.uAUnits.value = o.aUnits;
      u.uL1.value = o.l1;
      u.uRd.value = o.discR;
      u.uWind.value = o.wind ? 1 : 0;
      u.uTime.value = o.timeSec;
      u.uPixelRatio.value = o.pixelRatio;
      u.uPxPerUnit.value = o.pxPerUnit;
      u.uGain.value = o.gain;
    },
    dispose() {
      geo.dispose();
      mat.dispose();
    },
  };
}
