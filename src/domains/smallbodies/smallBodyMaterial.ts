/**
 * Surface shader for asteroid / comet-nucleus meshes. One light source (the Sun): no ambient, so the night side is black.
 * BRDF: lunar-Lambert (Lommel–Seeliger/Lambert blend, L = 0.65 — flat, "full-disc" look of airless dark bodies) with an
 * opposition surge (Hapke-style, B0 = 0.9, h = 0.05). Relief: the geometry's craters/lumps (or the real shape model) plus an
 * object-space procedural bump (fractal gradient) and a distance-adaptive micro-crater field (5 octaves of cellular bowls with
 * raised rims, each faded in only once its craters span a few pixels) so the surface stays crisp at any zoom.
 * Optional global map (famousShapes SURFACE_MAPS): an equirectangular mosaic sampled with the body-fixed direction scales the
 * albedo; there the broad procedural mottling and the coarse crater octaves (below uMapCraterStart) are dropped, the fine
 * relief stays, and a coverage mask (0 = never imaged) restores the full procedural look in the gaps. A DTM normal map
 * (tangent space on the lon/lat basis of the body-fixed direction, as planetMaterial) then carries the real relief and the
 * procedural bump shrinks to micro-detail there.
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
uniform sampler2D uMap;
uniform float uHasMap;
uniform float uMapMean;
uniform sampler2D uCoverage;
uniform float uHasCoverage;
uniform float uMapCraterStart;
uniform sampler2D uNormalMap;
uniform float uHasNormal;
uniform float uNormalStrength;
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
// Equirectangular lookup (x = 0 at 180° W, east-positive, y = 0 at 90° N) with seam-safe gradients.
vec4 sampleEquirect(sampler2D tex, vec3 p) {
  float lon = atan(p.y, p.x);
  float lat = atan(p.z, length(p.xy));
  float u = lon * (0.5 / PI) + 0.5;
  float v = lat / PI + 0.5;
  float uB = fract(u + 0.5);
  vec2 gA = vec2(dFdx(u), dFdy(u));
  vec2 gB = vec2(dFdx(uB), dFdy(uB));
  vec2 gu = dot(gA, gA) <= dot(gB, gB) ? gA : gB;
  return textureGrad(tex, vec2(u, v), vec2(gu.x, dFdx(v)), vec2(gu.y, dFdy(v)));
}
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
  // Global map (body-fixed direction): relative brightness, and where the surface was never imaged (1 = procedural only).
  float unseen = 1.0;
  float mapRel = 1.0;
  if (uHasMap > 0.5) {
    vec3 m = sampleEquirect(uMap, vObj).rgb;
    mapRel = clamp(dot(m, vec3(0.3, 0.55, 0.15)) / max(uMapMean, 1e-3), 0.0, 4.0);
    unseen = uHasCoverage > 0.5 ? 1.0 - sampleEquirect(uCoverage, vObj).r : 0.0;
  }
  // DTM relief: tangent-space normal on the east/north basis of the body-fixed direction (rotated to world space).
  if (uHasNormal > 0.5) {
    vec3 d = normalize(vObj);
    vec3 eastO = normalize(vec3(-d.y, d.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 northO = cross(d, eastO);
    vec3 eastW = normalize(uObjToWorld * eastO);
    eastW = normalize(eastW - dot(eastW, n) * n);
    vec3 northW = cross(n, eastW);
    vec3 t = sampleEquirect(uNormalMap, vObj).xyz * 2.0 - 1.0;
    // Polar rows: the lon/lat basis degenerates, fade the map to flat within ~4° of the poles.
    t.xy *= uNormalStrength * (1.0 - smoothstep(0.995, 0.9995, abs(d.z)));
    n = normalize(eastW * t.x + northW * t.y + n * max(t.z, 0.05));
  }
  vec3 p = vObj * 6.0 + uSeed;
  // Procedural bump: gradient of fractal noise in object space, rotated into world space.
  float e = 0.045;
  float h0 = fbm(p);
  vec3 g = vec3(fbm(p + vec3(e, 0.0, 0.0)) - h0, fbm(p + vec3(0.0, e, 0.0)) - h0, fbm(p + vec3(0.0, 0.0, e)) - h0) / e;
  vec3 gw = uObjToWorld * g;
  // With a DTM the broad fbm bump would invent relief: keep only a trace of it as texture, full strength in DTM gaps.
  float bump = uBump * (uHasNormal > 0.5 ? 0.3 : 1.0);
  n = normalize(n - bump * (gw - dot(gw, n) * n));
  // Distance-adaptive micro-craters: each octave fades in once its cells span ≳ 5 px.
  float fw = length(fwidth(vObj));
  vec3 cg = vec3(0.0);
  float cav = 0.0;
  float s = uCraterStart;
  for (int k = 0; k < 6; k++) {
    float w = smoothstep(0.25, 0.08, fw * s) * (s < uMapCraterStart ? unseen : 1.0);
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
  // Mapped: the mosaic replaces the broad mottling; the fine speckle and crater-floor shading stay on top.
  float variation = mix(mapRel, mix(0.78, 1.18, smoothstep(0.3, 0.7, terr)), unseen) * (0.94 + 0.12 * h0) * (1.0 + clamp(cav, -0.3, 0.3) * 0.25);
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
    uMap: { value: THREE.Texture | null };
    uHasMap: { value: number };
    /** Mean linear luminance of the map (its luminance / this = brightness relative to the class albedo). */
    uMapMean: { value: number };
    uCoverage: { value: THREE.Texture | null };
    uHasCoverage: { value: number };
    /** Mapped areas skip crater octaves coarser than this cell frequency (the mosaic shows the real craters). */
    uMapCraterStart: { value: number };
    uNormalMap: { value: THREE.Texture | null };
    uHasNormal: { value: number };
    uNormalStrength: { value: number };
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
        uMap: { value: null },
        uHasMap: { value: 0 },
        uMapMean: { value: 0.2 },
        uCoverage: { value: null },
        uHasCoverage: { value: 0 },
        uMapCraterStart: { value: 20 },
        uNormalMap: { value: null },
        uHasNormal: { value: 0 },
        uNormalStrength: { value: 1 },
      },
    });
  }

  /**
   * Bind a global surface map (equirectangular, sRGB); `meanLinear` is its mean linear luminance, `texelsAround` its
   * width. Procedural crater octaves are kept only where their cells are smaller than ~5 map texels (the mosaic already
   * shows everything larger, and invented craters there would contradict it).
   */
  setMap(tex: THREE.Texture, meanLinear: number, texelsAround: number): void {
    this.uniforms.uMap.value = tex;
    this.uniforms.uMapMean.value = meanLinear;
    this.uniforms.uHasMap.value = 1;
    this.uniforms.uMapCraterStart.value = Math.max(20, texelsAround / (2 * Math.PI * 5));
  }

  /** Bind a DTM normal map (linear, OpenGL tangent space: R = east, G = north); `strength` scales the slopes. */
  setNormalMap(tex: THREE.Texture, strength: number): void {
    this.uniforms.uNormalMap.value = tex;
    this.uniforms.uNormalStrength.value = strength;
    this.uniforms.uHasNormal.value = 1;
  }

  /** Bind the map's coverage mask (linear, 1 = imaged). */
  setCoverage(tex: THREE.Texture): void {
    this.uniforms.uCoverage.value = tex;
    this.uniforms.uHasCoverage.value = 1;
  }
}
