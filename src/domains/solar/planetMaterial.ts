/**
 * Physically lit planet surface for the solar domain (one Sun, no ambient; scene-linear HDR, no tone mapping).
 *
 * Frame: body-fixed, +Z = IAU north pole, +X = prime meridian; lengths in units of the equatorial radius a.
 * The mesh is a unit sphere scaled by (1, b/a, c/a) so oblate and triaxial bodies are exact ellipsoids; the
 * shading normal is the analytic ellipsoid normal, texture coordinates are planetocentric longitude/latitude
 * computed per fragment (no UV seam: the longitude gradient is taken from whichever of two phase-shifted u
 * coordinates is continuous, Tarini 2012, so mip selection never breaks at the antimeridian).
 *
 * BRDFs (radiance = E · f · μ₀ … with E the scene-linear solar irradiance):
 *  - rocky: lunar-Lambert (McEwen 1991) L(α) = exp(−α/60°): r = A/π · [2L·μ₀/(μ₀+μ) + (1−L)·μ₀] — a flat, evenly
 *    bright full disc and a crisp terminator, plus a narrow opposition surge (shadow hiding, ≈ 25 % at α → 0).
 *  - ice: same law with L = 0.5·L(α) (brighter limbs than rock, still flattish).
 *  - giant / cloud: Minnaert r = A/π · μ₀^k μ^(k−1): limb darkening of deep cloud decks (k ≈ 0.8–0.9 giants,
 *    0.6 for Venus' haze-topped deck).
 * Shadows: penumbral eclipses by up to 4 spherical moons, the ring shadow (strip opacity along the sun ray), and a
 * soft solar-disc terminator. Night side: black, except Saturn-style ringshine from the lit ring face.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { SHADOW_GLSL } from '../../render/glsl/shadow';
import { SOLAR_SHADOW_GLSL } from './shadowGlsl';

export type PlanetBrdf = 'rocky' | 'ice' | 'giant' | 'cloud';

const BRDF_ID: Record<PlanetBrdf, number> = { rocky: 0, ice: 1, giant: 2, cloud: 3 };

export interface PlanetMaterialOptions {
  brdf: PlanetBrdf;
  /** Linear albedo multiplier (tints greyscale maps; the whole albedo when there is no map). */
  tint: THREE.Color;
  /** Semi-axes relative to a: (1, b/a, c/a). */
  axes: THREE.Vector3;
  minnaertK?: number;
  ring?: { innerA: number; outerA: number } | null;
}

export class PlanetMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uMap: { value: THREE.Texture | null };
    uNormalMap: { value: THREE.Texture | null };
    uHasMap: { value: number };
    uHasNormal: { value: number };
    uNormalStrength: { value: number };
    uTint: { value: THREE.Color };
    uAxes: { value: THREE.Vector3 };
    uSunDir: { value: THREE.Vector3 };
    uCamLocal: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngularRadius: { value: number };
    uBrdf: { value: number };
    uMinnaertK: { value: number };
    uRingStrip: { value: THREE.Texture | null };
    uRingRadii: { value: THREE.Vector2 };
    uRingShine: { value: number };
    uOccluders: { value: THREE.Vector4[] };
    uDetail: { value: number };
  };

  constructor(opts: PlanetMaterialOptions) {
    const defines: Record<string, string> = {};
    if (opts.ring) defines.USE_RING_SHADOW = '';
    super({
      defines,
      uniforms: {
        uMap: { value: null },
        uNormalMap: { value: null },
        uHasMap: { value: 0 },
        uHasNormal: { value: 0 },
        uNormalStrength: { value: 1 },
        uTint: { value: opts.tint.clone() },
        uAxes: { value: opts.axes.clone() },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: 5 },
        uSunAngularRadius: { value: 4.65e-3 },
        uBrdf: { value: BRDF_ID[opts.brdf] },
        uMinnaertK: { value: opts.minnaertK ?? 0.85 },
        uRingStrip: { value: null },
        uRingRadii: { value: new THREE.Vector2(opts.ring?.innerA ?? 0, opts.ring?.outerA ?? 0) },
        uRingShine: { value: 0 },
        uOccluders: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
        uDetail: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  setMap(tex: THREE.Texture): void {
    this.uniforms.uMap.value = tex;
    this.uniforms.uHasMap.value = 1;
  }

  setNormalMap(tex: THREE.Texture, strength: number): void {
    this.uniforms.uNormalMap.value = tex;
    this.uniforms.uHasNormal.value = 1;
    this.uniforms.uNormalStrength.value = strength;
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
uniform vec3 uAxes;
varying vec3 vSph;
varying vec3 vViewPos;
void main() {
  vSph = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${SHADOW_GLSL}
${SOLAR_SHADOW_GLSL}
uniform sampler2D uMap;
uniform sampler2D uNormalMap;
uniform float uHasMap;
uniform float uHasNormal;
uniform float uNormalStrength;
uniform vec3 uTint;
uniform vec3 uAxes;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uSunIntensity;
uniform float uSunAngularRadius;
uniform int uBrdf;
uniform float uMinnaertK;
uniform sampler2D uRingStrip;
uniform vec2 uRingRadii;
uniform float uRingShine;
uniform vec4 uOccluders[4];
uniform float uDetail;
varying vec3 vSph;
varying vec3 vViewPos;

// Seam-free equirectangular lookup (x = 0 at 180° W, east-positive; v = 1 at the north pole).
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

void main() {
  vec3 sph = normalize(vSph);
  vec3 P = sph * uAxes;                       // surface point (units of a)
  vec3 n = normalize(sph / uAxes);            // ellipsoid normal
  vec3 s = normalize(uSunDir);
  vec3 toCam = normalize(uCamLocal - P);

  vec3 albedo = uTint;
  if (uHasMap > 0.5) albedo *= sampleEquirect(uMap, P).rgb;
  albedo = min(albedo, vec3(0.98));

  vec3 ns = n;
  if (uHasNormal > 0.5 && uDetail > 0.0) {
    vec3 east = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(n, east);
    vec3 t = sampleEquirect(uNormalMap, P).xyz * 2.0 - 1.0;
    t.xy *= uNormalStrength * uDetail;
    ns = normalize(east * t.x + north * t.y + n * max(t.z, 0.05));
  }

  float mu0g = dot(n, s);                     // geometric incidence (terminator, self-shadow)
  float mu0 = dot(ns, s);
  float mu = max(dot(ns, toCam), 1e-3);
  // Soft terminator: fraction of the solar disc above the local horizon.
  float sinA = max(sin(uSunAngularRadius), 1e-5);
  float discUp = clamp((mu0g + sinA) / (2.0 * sinA), 0.0, 1.0);
  float mu0c = max(mu0, 0.0);

  float cosAlpha = clamp(dot(s, toCam), -1.0, 1.0);
  float alphaDeg = degrees(acos(cosAlpha));
  float f;                                     // BRDF × μ₀ × π
  if (uBrdf <= 1) {
    float L = exp(-alphaDeg / 60.0);
    if (uBrdf == 1) L *= 0.5;
    float surge = 1.0 + 0.25 * exp(-alphaDeg / 3.0);
    f = (2.0 * L * mu0c / (mu0c + mu) + (1.0 - L) * mu0c) * surge;
    // Relief: normal-mapped facets turned away from the Sun self-shadow near the terminator.
    f *= smoothstep(-0.02, 0.08, mu0g) * mix(1.0, smoothstep(0.0, 0.25, mu0), uHasNormal * 0.6);
  } else {
    float k = uMinnaertK;
    f = pow(mu0c, k) * pow(mu, k - 1.0);
    f *= smoothstep(-0.01, 0.06, mu0g);
  }
  vec3 light = vec3(f * discUp);

  vec3 Pm = P;
#ifdef USE_RING_SHADOW
  light *= ringTransmittance(Pm, s, vec3(0.0, 0.0, 1.0), uRingRadii.x, uRingRadii.y, uRingStrip);
#endif
  for (int i = 0; i < 4; i++) {
    if (uOccluders[i].w > 0.0) light *= solarSphereShadow(Pm, s, uSunAngularRadius, uOccluders[i].xyz, uOccluders[i].w);
  }

  vec3 radiance = albedo * light * (uSunIntensity * RECIPROCAL_PI);

#ifdef USE_RING_SHADOW
  // Ringshine: the sunlit ring face lights the hemisphere that faces it, visible on the night side.
  if (uRingShine > 0.0) {
    float faceSide = sign(s.z);
    float sees = clamp(P.z * faceSide * 1.5, 0.0, 1.0) * clamp(dot(n, vec3(0.0, 0.0, faceSide)) + 0.2, 0.0, 1.0);
    float night = 1.0 - smoothstep(-0.05, 0.1, mu0g);
    radiance += albedo * uRingShine * abs(s.z) * sees * night * (uSunIntensity * RECIPROCAL_PI);
  }
#endif

  gl_FragColor = vec4(radiance, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
