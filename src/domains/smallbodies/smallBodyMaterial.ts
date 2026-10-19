/**
 * Surface shader for asteroid / comet-nucleus meshes. One light source (the Sun): no ambient, so the night side is black.
 * BRDF: lunar-Lambert (Lommel–Seeliger/Lambert blend, L = 0.65 — flat, "full-disc" look of airless dark bodies) with an
 * opposition surge (Hapke-style, B0 = 0.9, h = 0.05). Relief: the geometry's craters/lumps (or the real shape model) plus an
 * object-space procedural bump (fractal gradient) and a distance-adaptive micro-crater field (5 octaves of cellular bowls with
 * raised rims, each faded in only once its craters span a few pixels) so the surface stays crisp at any zoom.
 * Linear HDR output (no tone mapping here).
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
uniform float uCraterAmp;
uniform float uBoulders;
uniform float uCraterStart;
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
vec3 hash33(vec3 p) {
  p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
  return fract(sin(p) * 43758.5453123);
}
// Crater field at cell frequency s: xyz = slope (object space, dimensionless), w = height (cell units).
vec4 craters(vec3 p, float s) {
  vec3 q = p * s;
  vec3 i = floor(q);
  vec3 f = q - i;
  vec3 g = vec3(0.0);
  float h = 0.0;
  for (int z = -1; z <= 1; z++)
  for (int y = -1; y <= 1; y++)
  for (int x = -1; x <= 1; x++) {
    vec3 o = vec3(float(x), float(y), float(z));
    vec3 r = hash33(i + o + s);
    if (r.z > 0.55) continue;
    float rad = 0.18 + 0.42 * r.z * r.z / 0.3025;
    vec3 dp = f - (o + r);
    float len = length(dp);
    float d = len / rad;
    if (d > 1.45) continue;
    if (r.y < uBoulders) {
      // Boulder: a half-buried rounded block (rubble-pile surfaces: Bennu, Ryugu, Itokawa).
      rad *= 0.7;
      d = len / rad;
      if (d > 1.0) continue;
      float k = sqrt(max(1.0 - d * d, 0.04));
      h += k * rad * 0.9;
      g += (-d / k) * 0.9 * dp / max(len, 1e-4);
      continue;
    }
    float rim = 0.32 * exp(-((d - 1.0) * (d - 1.0)) / 0.0324);
    float bowl = d < 1.0 ? d * d - 1.0 : 0.0;
    float dh = (d < 1.0 ? 2.0 * d : 0.0) + rim * (-2.0 * (d - 1.0) / 0.0324);
    h += (bowl + rim) * rad * 0.35;
    g += dh * 0.35 * dp / max(len, 1e-4);
  }
  return vec4(g, h);
}

void main() {
  ${LOGDEPTH_FRAGMENT}
  vec3 n = normalize(vNormalW);
  vec3 nGeom = n;
  vec3 p = vObj * 6.0 + uSeed;
  // Procedural bump: gradient of fractal noise in object space, rotated into world space.
  float e = 0.045;
  float h0 = fbm(p);
  vec3 g = vec3(fbm(p + vec3(e, 0.0, 0.0)) - h0, fbm(p + vec3(0.0, e, 0.0)) - h0, fbm(p + vec3(0.0, 0.0, e)) - h0) / e;
  vec3 gw = uObjToWorld * g;
  n = normalize(n - uBump * (gw - dot(gw, n) * n));
  // Distance-adaptive micro-craters: each octave fades in once its cells span ≳ 5 px.
  float fw = length(fwidth(vObj));
  vec3 cg = vec3(0.0);
  float cav = 0.0;
  float s = uCraterStart;
  for (int k = 0; k < 6; k++) {
    float w = smoothstep(0.25, 0.08, fw * s);
    if (w > 0.01) {
      vec4 c = craters(vObj + uSeed * 0.11, s);
      cg += w * c.xyz;
      cav += w * c.w;
    }
    s *= 2.7;
  }
  vec3 cgw = uObjToWorld * cg;
  n = normalize(n - uCraterAmp * (cgw - dot(cgw, n) * n));
  // Relief never lights terrain beyond the geometric terminator (no floating crater rims on the night side).
  float mu0 = max(dot(n, uSunDir), 0.0) * smoothstep(-0.12, 0.06, dot(nGeom, uSunDir));
  vec3 toCam = normalize(cameraPosition - vPosW);
  float mu = max(dot(n, toCam), 1e-3);
  // Lunar-Lambert with L = 0.65.
  float L = 0.65;
  float brdf = 2.0 * L * mu0 / (mu0 + mu) + (1.0 - L) * mu0;
  // Opposition surge from the true phase angle.
  float cgp = clamp(dot(uSunDir, toCam), -1.0, 1.0);
  float tanHalf = sqrt((1.0 - cgp) / max(1.0 + cgp, 1e-4));
  float surge = 1.0 + 0.9 / (1.0 + tanHalf / 0.05);
  // Albedo variation: broad dark/bright terrain plus fresh bright speckle.
  float terr = fbm(vObj * 2.3 + uSeed * 0.7);
  float variation = mix(0.78, 1.18, smoothstep(0.3, 0.7, terr)) * (0.94 + 0.12 * h0) * (1.0 + clamp(cav, -0.3, 0.3) * 0.25);
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
    uCraterAmp: { value: number };
    uBoulders: { value: number };
    /** Cell frequency of the coarsest crater octave (3 = craters up to ~1/3 radius; real shape models start finer). */
    uCraterStart: { value: number };
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
        uCraterAmp: { value: surface === 'B' || surface === 'C' || surface === 'comet' ? 0.4 : 0.55 },
        uBoulders: { value: surface === 'B' || surface === 'C' || surface === 'comet' ? 0.82 : 0.3 },
        uCraterStart: { value: 3 },
      },
    });
  }
}
