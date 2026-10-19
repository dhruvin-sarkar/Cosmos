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
 *
 * Cloud motion (winds.ts): giant-planet zonal winds advect two copies of the map over a bounded wind-clock cycle and
 * cross-fade them; a vortex (Jupiter's Great Red Spot) is held rigid against the shear and spins about its centre.
 * Venus' cloud deck rotates rigidly (super-rotation). Close-up detail beyond the map's resolution: micro-relief on
 * solid bodies (screen-space bump, Mikkelsen 2010, of a tileable fBm height texture projected triplanar at two scales
 * below the map texel) and fine zonal cloud streaks on the giants and Venus (the same texture stretched east–west),
 * both fading in only where a map texel spans several pixels; the texture's mip chain fades them without aliasing.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { SHADOW_GLSL } from '../../render/glsl/shadow';
import { SOLAR_SHADOW_GLSL } from './shadowGlsl';
import { detailTexture } from './detailTexture';

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
  /** Zonal-wind drift texture (°/day vs planetocentric latitude). */
  wind?: THREE.Texture | null;
  /** Rigid cloud-deck rotation (Venus). */
  cloudRotation?: boolean;
  /** Brightness-dependent colourisation of a greyscale map ('pluto'). */
  palette?: 'pluto' | null;
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
    uWindTex: { value: THREE.Texture | null };
    uWind: { value: THREE.Vector4 };
    uVortex: { value: THREE.Vector4 };
    uVortexSpin: { value: number };
    uCloudRot: { value: number };
    uTexelRad: { value: number };
    uMicro: { value: number };
    uMapContrast: { value: number };
    uHiRes: { value: THREE.Vector4 };
    uDetailTex: { value: THREE.Texture };
    uLimbPow: { value: number };
    uPolarCap: { value: THREE.Vector3 };
    uRingThinGain: { value: number };
  };

  constructor(opts: PlanetMaterialOptions) {
    const defines: Record<string, string> = {};
    if (opts.ring) defines.USE_RING_SHADOW = '';
    if (opts.wind) defines.USE_WIND = '';
    if (opts.cloudRotation) defines.USE_CLOUD_ROT = '';
    if (opts.palette === 'pluto') defines.USE_PLUTO_PALETTE = '';
    if (opts.brdf === 'rocky' || opts.brdf === 'ice') defines.MICRO_RELIEF = '';
    else defines.MICRO_CLOUDS = '';
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
        uWindTex: { value: opts.wind ?? null },
        uWind: { value: new THREE.Vector4(0, 0, 1, 0) },
        uVortex: { value: new THREE.Vector4(0, 0, 1, 1) },
        uVortexSpin: { value: 0 },
        uCloudRot: { value: 0 },
        uTexelRad: { value: (2 * Math.PI) / 1024 },
        uMicro: { value: 1 },
        uMapContrast: { value: 1 },
        uHiRes: { value: new THREE.Vector4(0, 0, -2, -3) },
        uDetailTex: { value: detailTexture() },
        uLimbPow: { value: 0 },
        uPolarCap: { value: new THREE.Vector3(0, 0, 0) },
        uRingThinGain: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  /** Bind a colour map; `tint` replaces the albedo factor (maps differ in calibration). */
  setMap(tex: THREE.Texture, tint?: readonly [number, number, number]): void {
    this.uniforms.uMap.value = tex;
    this.uniforms.uHasMap.value = 1;
    if (tint) this.uniforms.uTint.value.setRGB(tint[0], tint[1], tint[2]);
    const w = (tex.image as { width?: number } | null)?.width;
    if (w) this.uniforms.uTexelRad.value = (2 * Math.PI) / w;
  }

  setNormalMap(tex: THREE.Texture, strength: number): void {
    this.uniforms.uNormalMap.value = tex;
    this.uniforms.uHasNormal.value = 1;
    this.uniforms.uNormalStrength.value = strength;
  }

  /**
   * Hold a vortex rigid against the zonal shear and spin it (map longitude/latitude of the centre, semi-axes, all
   * radians; spin in radians per day, positive counter-clockwise on the map seen from outside).
   */
  setVortex(lonRad: number, latRad: number, halfLonRad: number, halfLatRad: number, spinRadPerDay: number): void {
    this.uniforms.uVortex.value.set(lonRad, latRad, halfLonRad, halfLatRad);
    this.uniforms.uVortexSpin.value = spinRadPerDay;
  }

  /** Show the map sharp only within `fullDeg` of a centre and blurred beyond `blurDeg` (resolution of the data). */
  setResolutionCap(lonDeg: number, latDeg: number, fullDeg: number, blurDeg: number): void {
    const d = THREE.MathUtils.DEG2RAD;
    this.uniforms.uHiRes.value.set(lonDeg * d, latDeg * d, Math.cos(fullDeg * d), Math.cos(blurDeg * d));
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
uniform sampler2D uWindTex;
uniform vec4 uWind;
uniform vec4 uVortex;
uniform float uVortexSpin;
uniform float uCloudRot;
uniform float uTexelRad;
uniform float uMicro;
uniform float uMapContrast;
uniform vec4 uHiRes;
uniform sampler2D uDetailTex;
uniform float uLimbPow;
uniform vec3 uPolarCap;
uniform float uRingThinGain;

// Ring shadow on the planet with the ring material's optical-depth remap (SolarRingOptions.thinGain), so the C ring
// and Cassini division cast the same translucent shadow the rings show (render-kit ringTransmittance without it).
float solarRingTransmittance(vec3 p, vec3 sunDir, float innerRadius, float outerRadius, sampler2D ringStrip) {
  float mu0 = sunDir.z;
  if (abs(mu0) < 1e-4) return 1.0;
  float t = -p.z / mu0;
  if (t <= 0.0) return 1.0;
  float r = length(p + t * sunDir);
  float u = (r - innerRadius) / (outerRadius - innerRadius);
  if (u < 0.0 || u > 1.0) return 1.0;
  float a = min(texture2D(ringStrip, vec2(u, 0.5)).a, 0.999);
  float tau = -log(1.0 - a) * mix(uRingThinGain, 1.0, smoothstep(0.4, 0.95, a));
  return exp(-tau / abs(mu0));
}
varying vec3 vSph;
varying vec3 vViewPos;

// Map gradients shared by every lookup of this fragment (seam-free: Tarini 2012).
vec2 gX;
vec2 gY;

float wrapPi(float a) { return a - 2.0 * PI * floor((a + PI) / (2.0 * PI)); }

vec3 mapAt(sampler2D tex, float lon, float lat) {
  vec2 uv = vec2(lon * (0.5 / PI) + 0.5, lat / PI + 0.5);
  return textureGrad(tex, uv, gX, gY).rgb;
}

#if defined(USE_WIND)
// Map coordinates a cloud parcel now at (lon, lat) came from, τ days ago (copy advected for τ days).
vec2 advect(float lon, float lat, float rateDeg, float tau) {
  vec2 src = vec2(lon - radians(rateDeg * tau), lat);
  // Vortex: rigid against the shear, spinning about its centre (collar fastest, quiet core).
  vec2 d = vec2(wrapPi(lon - uVortex.x), lat - uVortex.y) / uVortex.zw;
  float rho = length(d);
  float inside = 1.0 - smoothstep(0.8, 1.3, rho);
  if (inside > 0.0) {
    float ang = -uVortexSpin * tau * smoothstep(0.1, 0.75, rho) * (1.0 - smoothstep(0.95, 1.3, rho));
    float c = cos(ang), s = sin(ang);
    vec2 r = vec2(c * d.x - s * d.y, s * d.x + c * d.y);
    vec2 rot = vec2(uVortex.x, uVortex.y) + r * uVortex.zw;
    src = mix(src, rot, inside);
  }
  return src;
}
#endif

#if defined(MICRO_CLOUDS)
// Sub-texel turbulence: displace the map lookup by a smooth random field so magnified band edges break into fine
// zonal filaments drawn from the map's own colours instead of blurring. The field is the detail texture stretched
// east–west (one repeat per 128 map texels E–W, 40 N–S; integer repeats around the planet so no seam) at two scales;
// the displacement (≈ ±2 texels E–W, ±0.6 N–S) stays below the field's wavelength everywhere, so the lookup never
// folds (no sawtooth) and the tile never reads as a lattice. Returns a (lon, lat) offset in radians.
vec2 cloudWarp(float lon, float lat, float amount) {
  float W = 2.0 * PI / uTexelRad;
  vec2 k1 = vec2(max(1.0, floor(W / 128.0)), W / 80.0);
  vec2 k2 = vec2(k1.x * 5.0, k1.y * 4.7);
  vec2 uv = vec2(lon * (0.5 / PI) + 0.5, lat / PI + 0.5);
  float wx = textureGrad(uDetailTex, uv * k1, gX * k1, gY * k1).r - 0.5;
  float wy = textureGrad(uDetailTex, uv * k1 + vec2(0.37, 0.61), gX * k1, gY * k1).r - 0.5;
  float fx = textureGrad(uDetailTex, uv * k2 + vec2(0.71, 0.13), gX * k2, gY * k2).r - 0.5;
  return vec2((wx + 0.3 * fx) * 6.0, wy * 2.0) * (uTexelRad * amount);
}
#endif

#if defined(MICRO_RELIEF)
// Detail height (texture units, ≈ 0.5 ± 0.1) projected triplanar along the body axes.
float detailTri(vec3 p, vec3 w) {
  return texture(uDetailTex, p.yz).r * w.x + texture(uDetailTex, p.zx).r * w.y + texture(uDetailTex, p.xy).r * w.z;
}
#endif

void main() {
  vec3 sph = normalize(vSph);
  vec3 P = sph * uAxes;                       // surface point (units of a)
  vec3 n = normalize(sph / uAxes);            // ellipsoid normal
  vec3 s = normalize(uSunDir);
  vec3 toCam = normalize(uCamLocal - P);

  float lon = atan(P.y, P.x);
  float lat = atan(P.z, length(P.xy));
  {
    float u = lon * (0.5 / PI) + 0.5;
    float v = lat / PI + 0.5;
    float uB = fract(u + 0.5);
    vec2 gA = vec2(dFdx(u), dFdy(u));
    vec2 gB = vec2(dFdx(uB), dFdy(uB));
    vec2 gu = dot(gA, gA) <= dot(gB, gB) ? gA : gB;
    gX = vec2(gu.x, dFdx(v));
    gY = vec2(gu.y, dFdy(v));
    // Polar caps: an equirectangular row near the pole spans only cos(lat) of an equatorial texel, and the source
    // mosaics are interpolated there (radial "starburst" streaks). Filter east–west over at least the physically
    // equal-area footprint (×3 above ~75°, the mosaics' effective polar resolution) so the caps read as smooth ground.
    float uFloor = (uTexelRad * (0.5 / PI)) * mix(1.0, 3.0, smoothstep(1.05, 1.4, abs(lat))) / max(cos(lat), 0.01);
    float uCur = max(max(abs(gX.x), abs(gY.x)), 1e-9);
    if (uCur < uFloor) {
      gX.x *= uFloor / uCur;
      gY.x *= uFloor / uCur;
    }
  }
  // Angular size of a pixel on the body (radians of arc) vs a map texel: detail fades in when magnified.
  float foot = max(length(dFdx(P)), length(dFdy(P)));
  float magnified = smoothstep(0.7, 0.2, foot / uTexelRad) * uDetail * uMicro;

  vec3 albedo = uTint;
  // Map coverage weight: 1 where the source data are high-resolution, 0 where they are coarse (relief fades out there).
  float hiResW = 1.0;
#if defined(USE_PLUTO_PALETTE)
  // Data resolution: sharp on the encounter hemisphere, honestly blurred where New Horizons saw only coarsely.
  vec3 cdir = vec3(cos(uHiRes.y) * cos(uHiRes.x), cos(uHiRes.y) * sin(uHiRes.x), sin(uHiRes.y));
  float blur = smoothstep(uHiRes.z, uHiRes.w, dot(sph, cdir));
  hiResW = 1.0 - smoothstep(0.0, 0.5, blur);
#endif
  if (uHasMap > 0.5) {
#if defined(USE_PLUTO_PALETTE)
    gX *= mix(1.0, 40.0, blur);
    gY *= mix(1.0, 40.0, blur);
#endif
#if defined(USE_WIND)
    float rate = texture(uWindTex, vec2(lat / PI + 0.5, 0.5)).r;
    vec2 a = advect(lon, lat, rate, uWind.x);
    vec2 b = advect(lon, lat, rate, uWind.y);
  #if defined(MICRO_CLOUDS)
    a += cloudWarp(a.x, a.y, magnified);
    b += cloudWarp(b.x, b.y, magnified);
  #endif
    vec3 m = mapAt(uMap, a.x, a.y) * uWind.z + mapAt(uMap, b.x, b.y) * uWind.w;
#elif defined(USE_CLOUD_ROT)
    vec2 c0 = vec2(lon - uCloudRot, lat);
  #if defined(MICRO_CLOUDS)
    c0 += cloudWarp(c0.x, c0.y, magnified);
  #endif
    vec3 m = mapAt(uMap, c0.x, c0.y);
#else
    vec2 c0 = vec2(lon, lat);
  #if defined(MICRO_CLOUDS)
    c0 += cloudWarp(c0.x, c0.y, magnified);
  #endif
    vec3 m = mapAt(uMap, c0.x, c0.y);
#endif
    // Within ~8° of the poles the source mosaics converge into radial smears: blend to the ring average there.
    float poleW = smoothstep(1.40, 1.54, abs(lat));
    if (poleW > 0.0) {
      vec3 ring = textureGrad(uMap, vec2(lon * (0.5 / PI) + 0.5, lat / PI + 0.5), vec2(0.06, 0.0), vec2(0.0, 0.003)).rgb;
      m = mix(m, ring, poleW);
    }
    if (uMapContrast != 1.0) {
      vec3 mean = textureLod(uMap, vec2(0.5, 0.5), 20.0).rgb;
      m = max(mean + (m - mean) * uMapContrast, 0.0);
    }
    albedo *= m;
  }
#if defined(USE_PLUTO_PALETTE)
  {
    // Greyscale LORRI mosaic → colour by brightness (MVIC: dark maculae red-brown, mid terrain tan, bright N₂ ice cream).
    float A = dot(albedo, vec3(0.2126, 0.7152, 0.0722));
    // Soft knee: Sputnik Planitia's N₂ ice (normal albedo ≈ 0.9–1) keeps its cellular texture instead of clipping flat.
    A = A < 0.6 ? A : 0.6 + 0.36 * (1.0 - exp(-(A - 0.6) / 0.36));
    // Unit-luminance hues: brick-red maculae (Cthulhu), cream-tan mid terrain, near-white N₂ ice (Tombaugh Regio).
    vec3 hue = mix(vec3(1.85, 0.80, 0.52), vec3(1.40, 0.93, 0.62), smoothstep(0.08, 0.4, A));
    hue = mix(hue, vec3(1.04, 0.995, 0.93), smoothstep(0.5, 0.95, A));
    // True-colour saturation (×0.8 about the hue's luminance): the post AgX Punchy look adds ×1.4 on top.
    float hl = dot(hue, vec3(0.2126, 0.7152, 0.0722));
    hue = max(hl + (hue - hl) * 0.8, vec3(0.0));
    albedo = hue * A;
  }
#endif
  // Polar haze brightening (Uranus' sunward north-polar cap): albedo × (1 + gain) poleward of the latitude band.
  if (uPolarCap.z != 0.0) albedo *= 1.0 + uPolarCap.z * smoothstep(uPolarCap.x, uPolarCap.y, lat);
  albedo = min(albedo, vec3(0.98));

  vec3 ns = n;
  if (uHasNormal > 0.5 && uDetail > 0.0) {
    vec3 east = normalize(vec3(-n.y, n.x, 0.0) + vec3(1e-6, 0.0, 0.0));
    vec3 north = cross(n, east);
    vec3 t = mapAt(uNormalMap, lon, lat).xyz * 2.0 - 1.0;
    t.xy *= uNormalStrength * uDetail * hiResW * (1.0 - smoothstep(1.466, 1.553, abs(lat)));
    ns = normalize(east * t.x + north * t.y + n * max(t.z, 0.05));
  }
#if defined(MICRO_RELIEF)
  if (uDetail * uMicro > 0.0) {
    // Detail height (units of a): one texture repeat per 4 map texels, plus a 6× finer layer; slopes ≈ 0.1. (Uniform
    // control flow: the screen-space derivatives below need every pixel of the quad to run this.)
    vec3 tw = pow(abs(n), vec3(4.0));
    tw /= tw.x + tw.y + tw.z;
    float q = 1.0 / (4.0 * uTexelRad);
    float amp = 0.012 * uTexelRad;
    float h = (detailTri(P * q, tw) - 0.5) * amp + (detailTri(P * q * 6.1 + 0.37, tw) - 0.5) * (amp / 6.1);
    h *= magnified * hiResW;
    vec3 dPx = dFdx(P);
    vec3 dPy = dFdy(P);
    vec3 r1 = cross(dPy, ns);
    vec3 r2 = cross(ns, dPx);
    float det = dot(dPx, r1);
    vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
    ns = normalize(abs(det) * ns - grad);
  }
#endif

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
    // Extra limb darkening for deep hazy atmospheres seen through a log tone curve (ice giants; see constants.ts).
    if (uLimbPow > 0.0) f *= pow(mu, uLimbPow);
    f *= smoothstep(-0.01, 0.06, mu0g);
  }
  vec3 light = vec3(f * discUp);

  vec3 Pm = P;
#ifdef USE_RING_SHADOW
  light *= solarRingTransmittance(Pm, s, uRingRadii.x, uRingRadii.y, uRingStrip);
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
