/**
 * Surface shader for asteroid / comet-nucleus meshes. One light source (the Sun): no ambient, so the night side is black.
 * BRDF: lunar-Lambert (Lommel–Seeliger/Lambert blend, L = 0.65 — flat, "full-disc" look of airless dark bodies) with an
 * opposition surge (Hapke-style, B0 = 0.9, h = 0.05). Relief: the geometry's craters/lumps plus an object-space procedural
 * bump (fractal gradient) so the terminator shows texture at any zoom. Linear HDR output (no tone mapping here).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import type { SurfaceClass } from './catalog';

/** Linear reflectance (≈ geometric albedo) of each surface class. Sources: SBDB albedo ranges by taxonomy, Stern et al. 2019 (Arrokoth). */
export const SURFACE_ALBEDO: Record<SurfaceClass, [number, number, number]> = {
  C: [0.052, 0.049, 0.045],
  S: [0.30, 0.25, 0.19],
  V: [0.46, 0.43, 0.38],
  X: [0.15, 0.145, 0.14],
  B: [0.072, 0.077, 0.085],
  comet: [0.048, 0.045, 0.042],
  ice: [0.33, 0.17, 0.10],
  D: [0.20, 0.105, 0.07],
};

const VERTEX = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vPosW;
void main() {
  vObj = position;
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
uniform vec3 uAlbedo;
uniform float uSeed;
uniform float uBump;
uniform mat3 uObjToWorld;
varying vec3 vNormalW;
varying vec3 vObj;
varying vec3 vPosW;

float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float vn(vec3 x) {
  vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn(p); p = p * 2.07 + 11.3; a *= 0.5; } return s; }

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  vec3 p = vObj * 6.0 + uSeed;
  // Procedural bump: gradient of fractal noise in object space, rotated into world space.
  float e = 0.045;
  float h0 = fbm(p);
  vec3 g = vec3(fbm(p + vec3(e, 0.0, 0.0)) - h0, fbm(p + vec3(0.0, e, 0.0)) - h0, fbm(p + vec3(0.0, 0.0, e)) - h0) / e;
  vec3 gw = uObjToWorld * g;
  n = normalize(n - uBump * (gw - dot(gw, n) * n));
  float mu0 = max(dot(n, uSunDir), 0.0);
  vec3 toCam = normalize(cameraPosition - vPosW);
  float mu = max(dot(n, toCam), 1e-3);
  // Lunar-Lambert with L = 0.65.
  float L = 0.65;
  float brdf = 2.0 * L * mu0 / (mu0 + mu) + (1.0 - L) * mu0;
  // Opposition surge from the true phase angle.
  float cg = clamp(dot(uSunDir, toCam), -1.0, 1.0);
  float tanHalf = sqrt((1.0 - cg) / max(1.0 + cg, 1e-4));
  float surge = 1.0 + 0.9 / (1.0 + tanHalf / 0.05);
  // Albedo variation: broad dark/bright terrain plus fresh bright speckle.
  float terr = fbm(vObj * 2.3 + uSeed * 0.7);
  float variation = mix(0.78, 1.18, smoothstep(0.3, 0.7, terr)) * (0.94 + 0.12 * h0);
  vec3 radiance = uAlbedo * variation * (uIrradiance / 3.14159265) * brdf * surge;
  gl_FragColor = vec4(radiance, 1.0);
}`;

export class SmallBodyMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uSunDir: { value: THREE.Vector3 };
    uIrradiance: { value: number };
    uAlbedo: { value: THREE.Vector3 };
    uSeed: { value: number };
    uBump: { value: number };
    uObjToWorld: { value: THREE.Matrix3 };
  };

  constructor(surface: SurfaceClass, seed: number) {
    super({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uIrradiance: { value: 5 },
        uAlbedo: { value: new THREE.Vector3(...SURFACE_ALBEDO[surface]) },
        uSeed: { value: (seed % 997) * 0.37 },
        uBump: { value: 0.16 },
        uObjToWorld: { value: new THREE.Matrix3() },
      },
    });
  }
}
