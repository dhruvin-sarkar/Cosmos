/**
 * Physically lit moon surface (one Sun, no ambient; scene-linear HDR, no tone mapping).
 *
 * Frame: body-fixed (+z north pole, +x prime meridian toward the planet, +y east); the mesh is built in units of the
 * moon's mean radius with analytic ellipsoid normals (or a displaced irregular mesh), so lengths below are in mean radii.
 *
 * BRDF: lunar-Lambert (McEwen 1991) L(α) = exp(−α/60°) with a Hapke-like opposition surge B0·exp(−α/3°):
 *   r = A/π · [2L·μ₀/(μ₀+μ) + (1−L)·μ₀] — flat full disc, crisp terminator. Icy bodies use half the lunar term (brighter limbs).
 *   Titan: opaque haze deck, Minnaert limb darkening.
 * Relief: a procedural crater field (hash-grid bowls with raised rims, three octaves, analytic gradients, faded by pixel
 * footprint so it never shimmers) plus explicit named features (Herschel, Odysseus, Stickney…) perturbs the shading normal.
 * Light sources: the Sun, then PLANETSHINE (Lambert sphere of the parent, phase-dependent) — physically the only other
 * light. The planet's own umbra/penumbra darkens the sunlight (analytic sphere shadow).
 * Night side is black apart from planetshine. Greyscale mosaics are colourised by a dark→light ramp and rescaled so the
 * map's mean equals the moon's measured geometric albedo; the map's high-pass detail is re-synthesised close up.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { SHADOW_GLSL } from '../../render/glsl/shadow';

export type MoonSpecial = 'none' | 'iapetus' | 'charon' | 'titan' | 'io' | 'hyperion' | 'enceladus' | 'europa' | 'triton' | 'miranda';

const SPECIAL_ID: Record<MoonSpecial, number> = {
  none: 0, iapetus: 1, charon: 2, titan: 3, io: 4, hyperion: 5, enceladus: 6, europa: 7, triton: 8, miranda: 9,
};

export interface MoonMaterialOptions {
  /** Linear-sRGB base colour (luminance already scaled to the geometric albedo). */
  color: THREE.Color;
  albedo: number;
  icy: boolean;
  surge: number;
  craters: number;
  mottling: number;
  seed: number;
  special: MoonSpecial;
  rampDark: THREE.Vector3;
  rampLight: THREE.Vector3;
  /** Explicit crater features: unit direction (body frame), angular radius (rad), depth (fraction of mean radius). */
  features?: { dir: [number, number, number]; radius: number; depth: number }[];
}

export class MoonMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uMap: { value: THREE.Texture | null };
    uHasMap: { value: number };
    uMapGain: { value: number };
    uCoverage: { value: THREE.Texture | null };
    uHasCoverage: { value: number };
    uAlbedo: { value: number };
    uColor: { value: THREE.Color };
    uRampDark: { value: THREE.Vector3 };
    uRampLight: { value: THREE.Vector3 };
    uSunDir: { value: THREE.Vector3 };
    uCamLocal: { value: THREE.Vector3 };
    uSunIntensity: { value: number };
    uSunAngularRadius: { value: number };
    uPlanet: { value: THREE.Vector4 };
    uPlanetShine: { value: THREE.Vector3 };
    uIcy: { value: number };
    uSurge: { value: number };
    uCraters: { value: number };
    uMottling: { value: number };
    uSeed: { value: number };
    uSpecial: { value: number };
    uDetail: { value: number };
    uFeat: { value: THREE.Vector4[] };
    uFeatDepth: { value: THREE.Vector2 };
    uTexel: { value: number };
    uRealShape: { value: number };
  };

  constructor(opts: MoonMaterialOptions) {
    const feats = opts.features ?? [];
    const f4 = [new THREE.Vector4(0, 0, 1, 0), new THREE.Vector4(0, 0, 1, 0)];
    const fd = new THREE.Vector2(0, 0);
    feats.slice(0, 2).forEach((f, i) => {
      const d = new THREE.Vector3(...f.dir).normalize();
      f4[i].set(d.x, d.y, d.z, f.radius);
      fd.setComponent(i, f.depth);
    });
    super({
      uniforms: {
        uMap: { value: null },
        uHasMap: { value: 0 },
        uMapGain: { value: 1 },
        uCoverage: { value: null },
        uHasCoverage: { value: 0 },
        uAlbedo: { value: opts.albedo },
        uColor: { value: opts.color.clone() },
        uRampDark: { value: opts.rampDark.clone() },
        uRampLight: { value: opts.rampLight.clone() },
        uSunDir: { value: new THREE.Vector3(1, 0, 0) },
        uCamLocal: { value: new THREE.Vector3(0, 0, 10) },
        uSunIntensity: { value: 5 },
        uSunAngularRadius: { value: 4.65e-3 },
        uPlanet: { value: new THREE.Vector4(0, 0, 0, 0) },
        uPlanetShine: { value: new THREE.Vector3(0, 0, 0) },
        uIcy: { value: opts.icy ? 1 : 0 },
        uSurge: { value: opts.surge },
        uCraters: { value: opts.craters },
        uMottling: { value: opts.mottling },
        uSeed: { value: opts.seed },
        uSpecial: { value: SPECIAL_ID[opts.special] },
        uDetail: { value: 1 },
        uFeat: { value: f4 },
        uFeatDepth: { value: fd },
        uTexel: { value: 0 },
        uRealShape: { value: 0 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  /** A real shape model carries the large craters itself: drop the procedural big bowls and named features. */
  setShapeModel(): void {
    this.uniforms.uRealShape.value = 1;
    this.uniforms.uFeatDepth.value.set(0, 0);
  }

  /** Bind a colour/greyscale mosaic. `meanLinear` is its mean linear luminance (rescales it to the geometric albedo). */
  setMap(tex: THREE.Texture, meanLinear: number, albedo: number, texelsAround: number): void {
    this.uniforms.uMap.value = tex;
    this.uniforms.uHasMap.value = 1;
    this.uniforms.uMapGain.value = albedo / Math.max(meanLinear, 0.02);
    this.uniforms.uTexel.value = texelsAround;
  }

  /** Bind the mosaic's coverage mask (1 = imaged). Unimaged areas get the illustrative procedural relief/mottling. */
  setCoverage(tex: THREE.Texture): void {
    this.uniforms.uCoverage.value = tex;
    this.uniforms.uHasCoverage.value = 1;
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vPos;
varying vec3 vNor;
void main() {
  vPos = position;
  vNor = normal;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${SHADOW_GLSL}
uniform sampler2D uMap;
uniform float uHasMap;
uniform sampler2D uCoverage;
uniform float uHasCoverage;
uniform float uMapGain;
uniform float uAlbedo;
uniform vec3 uColor;
uniform vec3 uRampDark;
uniform vec3 uRampLight;
uniform vec3 uSunDir;
uniform vec3 uCamLocal;
uniform float uSunIntensity;
uniform float uSunAngularRadius;
uniform vec4 uPlanet;
uniform vec3 uPlanetShine;
uniform float uIcy;
uniform float uSurge;
uniform float uCraters;
uniform float uMottling;
uniform float uSeed;
uniform int uSpecial;
uniform float uDetail;
uniform vec4 uFeat[2];
uniform vec2 uFeatDepth;
uniform float uTexel;
uniform float uRealShape;
varying vec3 vPos;
varying vec3 vNor;

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
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = hash33(i).x, n100 = hash33(i + vec3(1, 0, 0)).x, n010 = hash33(i + vec3(0, 1, 0)).x, n110 = hash33(i + vec3(1, 1, 0)).x;
  float n001 = hash33(i + vec3(0, 0, 1)).x, n101 = hash33(i + vec3(1, 0, 1)).x, n011 = hash33(i + vec3(0, 1, 1)).x, n111 = hash33(i + vec3(1, 1, 1)).x;
  return mix(mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y), mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y), f.z);
}
float fbm(vec3 p) {
  float a = 0.5, s = 0.0;
  for (int i = 0; i < 3; i++) { s += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return s;
}

float gFloor = 0.0;   // accumulated crater-floor depth (0 outside bowls, ~1 at the deepest centre) for floor darkening

// One octave of hash-grid craters on the unit sphere. Returns the surface gradient (tangent plane, d height / d arc).
// cells = grid frequency, density = probability a cell holds a crater, fade = footprint-based amplitude.
vec3 craterOctave(vec3 d, float cells, float density, float fade, float seed, float depthScale) {
  vec3 g = vec3(0.0);
  vec3 q = d * cells + seed;
  vec3 b = floor(q - 0.5);
  for (int k = 0; k < 8; k++) {
    vec3 cell = b + vec3(float(k & 1), float((k >> 1) & 1), float((k >> 2) & 1));
    vec3 h = hash33(cell);
    if (h.x > density) continue;
    vec3 c = cell + 0.15 + 0.7 * hash33(cell + 17.0);
    float rc = (0.16 + 0.26 * h.y * h.y);            // crater radius in cell units
    vec3 off = q - c;
    float dist = length(off);
    float u = dist / rc;
    if (u > 1.7) continue;
    float depth = depthScale * (0.35 + 0.65 * h.z) * rc;   // cell units
    float dh;                                             // d(height)/d(dist)
    if (u < 1.0) { dh = depth * 2.0 * u / rc; gFloor = max(gFloor, (1.0 - u * u) * fade * (0.35 + 0.65 * h.z)); }   // bowl: h = -depth (1 - u²)
    else dh = -depth * 0.22 * 80.0 * (u - 1.08) * exp(-(u - 1.08) * (u - 1.08) * 40.0) / rc;
    vec3 dir = off / max(dist, 1e-5);
    g += dh * dir;
  }
  // grid units -> unit-sphere arc: height and distance both scale by 1/cells, slope is unchanged.
  return g * fade;
}

// Explicit large feature: bowl with rim and central peak. Returns the tangent-plane gradient of height (units of R per R).
vec3 featureGradient(vec3 d, vec4 f, float depth) {
  if (f.w <= 0.0 || depth <= 0.0) return vec3(0.0);
  float th = acos(clamp(dot(d, f.xyz), -1.0, 1.0));
  float u = th / f.w;
  if (u > 1.7) return vec3(0.0);
  float dh;
  if (u < 1.0) dh = depth * 2.0 * u / f.w * (1.0 - 0.25 * exp(-u * u * 40.0)) + depth * (1.0 - u * u) * 0.25 * 80.0 * u * exp(-u * u * 40.0) / f.w;
  else dh = -depth * 0.22 * 80.0 * (u - 1.08) * exp(-(u - 1.08) * (u - 1.08) * 40.0) / f.w;
  vec3 away = d - f.xyz * dot(d, f.xyz);
  away = normalize(away + vec3(1e-6));
  return dh * away;
}

void main() {
  vec3 P = vPos;
  vec3 dir = normalize(P);
  vec3 n = normalize(vNor);
  vec3 s = normalize(uSunDir);
  vec3 toCam = normalize(uCamLocal - P);
  float lat = asin(clamp(dir.z, -1.0, 1.0));

  // ── relief ──
  vec3 grad = vec3(0.0);
  float pxFoot = length(fwidth(dir));                    // direction change per pixel
  // 1 where no imagery exists (whole body when unmapped; the coverage mask's holes when mapped).
  float unseen = uHasMap > 0.5 ? (uHasCoverage > 0.5 ? 1.0 - sampleEquirect(uCoverage, dir).r : 0.0) : 1.0;
  if (uDetail > 0.0) {
    if (uCraters > 0.0) {
      float seed = uSeed * 13.7;
      float dens = clamp(0.30 * uCraters, 0.0, 0.95);
      float amp = (uSpecial == 5 ? 1.6 : 1.0) * mix(0.14, uRealShape > 0.5 ? 0.13 : 0.3, unseen);
      // cells per radian-ish; fade octaves whose cells are smaller than ~2.5 px
      float c0 = 5.0, c1 = 12.0, c2 = 28.0, c3 = 66.0;
      float f0 = 1.0 - smoothstep(0.25, 0.5, pxFoot * c0 * 2.5);
      float f1 = 1.0 - smoothstep(0.25, 0.5, pxFoot * c1 * 2.5);
      float f2 = 1.0 - smoothstep(0.25, 0.5, pxFoot * c2 * 2.5);
      float f3 = 1.0 - smoothstep(0.25, 0.5, pxFoot * c3 * 2.5);
      if (unseen > 0.01 && uRealShape < 0.5 && f0 > 0.01) grad += craterOctave(dir, c0, dens * 0.55, f0, seed, amp * 1.1 * unseen);
      if (unseen > 0.01 && uRealShape < 0.5 && f1 > 0.01) grad += craterOctave(dir, c1, dens * 0.8, f1, seed + 3.0, amp * unseen);
      if (f2 > 0.01) grad += craterOctave(dir, c2, dens, f2, seed + 7.0, amp * 0.9);
      if (f3 > 0.01) grad += craterOctave(dir, c3, dens, f3, seed + 11.0, amp * 0.8);
    }
    grad += featureGradient(dir, uFeat[0], uFeatDepth.x);
    grad += featureGradient(dir, uFeat[1], uFeatDepth.y);
  }

  float gl = length(grad);
  if (gl > 0.55) grad *= 0.55 / gl;                       // keep slopes below ~30° so bowls never go pitch black

  // ── albedo ──
  vec3 albedo = uColor;
  if (uHasMap > 0.5) {
    vec3 m = sampleEquirect(uMap, dir).rgb;
    float lum = dot(m, vec3(0.3, 0.55, 0.15));
    if (uSpecial == 3) {
      albedo = uColor * uAlbedo * mix(1.0, lum / max(uAlbedo / max(uMapGain, 1e-4), 1e-3), 0.03);   // surface only faintly visible through the haze
    } else if (uSpecial == 4 || uSpecial == 8) {
      albedo = m * uMapGain;                                  // colour mosaics (Io, Triton)
      if (uSpecial == 8) albedo = mix(vec3(lum * uMapGain), albedo, 0.35) * vec3(1.0, 0.93, 0.85) * 0.82;   // Voyager colour is stretched: desaturate to the pale cream-pink of Triton
    } else {
      float rel = lum * uMapGain / max(uAlbedo, 1e-3);        // map brightness relative to its mean
      albedo = uColor * mix(uRampDark, uRampLight, smoothstep(0.3, 1.7, rel)) * (lum * uMapGain);
    }
    // Close-range micro albedo variation, replacing the blur of a finite-resolution mosaic.
    if (uDetail > 0.0) {
      float texFoot = pxFoot * uTexel;                     // mosaic texels per pixel
      float blur = smoothstep(0.0, 1.0, 1.0 - texFoot);    // 1 when magnified (mosaic blurry)
      if (blur > 0.02) albedo *= 1.0 + (fbm(dir * 220.0 + uSeed) - 0.5) * 0.22 * blur * uDetail;
    }
  }
  if (uMottling > 0.0 && uDetail > 0.0) {
    float mm = fbm(dir * 3.2 + uSeed * 1.7) - 0.5;
    mm += 0.5 * (fbm(dir * 9.0 + uSeed * 3.1) - 0.5);
    albedo *= 1.0 + uMottling * 1.1 * mm * unseen;
  }
  // Specials
  // Procedural stand-ins below only paint over bodies WITHOUT a mosaic (a real map already carries these features).
  if (uSpecial == 1 && uHasMap < 0.5) {                    // Iapetus: dark leading hemisphere (apex at 90°W = -y), tapering poleward
    float apex = dot(dir, vec3(0.0, -1.0, 0.0));
    float edge = apex + 0.20 * (fbm(dir * 5.0 + 3.0) - 0.5) + 0.35 * (abs(dir.z) - 0.35);
    float dark = smoothstep(0.05, 0.22, edge);
    vec3 bright = vec3(0.62, 0.60, 0.57);
    vec3 dk = vec3(0.045, 0.034, 0.026);
    albedo = mix(bright, dk, dark) * (0.85 + 0.3 * fbm(dir * 14.0));
  } else if (uSpecial == 2) {                              // Charon: red-brown polar cap ("Mordor Macula")
    float cap = smoothstep(1.05, 1.35, lat + 0.10 * (fbm(dir * 6.0) - 0.5));   // north of ~60°N only
    albedo *= mix(vec3(1.0), vec3(1.33, 0.87, 0.73), cap * 0.9);
  } else if (uSpecial == 9 && uHasMap < 0.5) {             // Miranda: patchwork of bright/dark provinces
    float pm = smoothstep(0.35, 0.65, fbm(dir * 2.4 + 5.0));
    albedo *= mix(0.72, 1.25, pm);
  } else if (uSpecial == 5) {                              // Hyperion: reddish-brown dark material pooled on the pit floors (sponge look)
    albedo *= vec3(1.1, 0.98, 0.88);
    albedo = mix(albedo, albedo * vec3(0.42, 0.31, 0.25), smoothstep(0.15, 0.7, gFloor));
  } else if (uSpecial == 7 && uDetail > 0.0) {             // Europa: dark reddish-brown lineae – long, gently curved double-ridged fractures on bright ice
    float lines = 0.0;
    float wmin = max(0.0012, pxFoot * 1.1);
    for (int i = 0; i < 14; i++) {
      if (uHasMap > 0.5) break;                            // the Galileo/Voyager mosaic carries the real large lineae
      vec3 h = hash33(vec3(float(i) * 1.7 + uSeed, 3.1, 7.7));
      vec3 nrm = normalize(h * 2.0 - 1.0 + vec3(0.001));
      float c0 = (hash33(h * 91.0).x - 0.5) * 1.5;                           // small circles: offset from a great circle
      float d = abs(dot(dir, nrm) - c0);
      float w = wmin * (0.8 + 1.8 * h.z);
      float arc = smoothstep(0.42, 0.58, fbm(dir * 2.6 + h * 9.0));          // each fracture only spans part of its circle
      float ridge = 1.0 - smoothstep(w, w * 2.4, d);
      lines += ridge * arc * (0.55 + 0.45 * h.y);
    }
    // fine lineae network at close range
    vec3 q = dir * 60.0 + uSeed;
    float fine = 1.0 - smoothstep(0.0, 0.07, abs(fbm(q) - 0.5));
    lines += fine * 0.22 * smoothstep(0.0, 1.0, uDetail) * (1.0 - smoothstep(0.1, 0.3, pxFoot * 60.0));
    albedo = mix(albedo, albedo * vec3(0.52, 0.36, 0.28), clamp(lines, 0.0, 0.72) * uDetail);
  }
  albedo = min(albedo, vec3(0.98));

  // ── shading normal ──
  vec3 ns = normalize(n - grad * 1.0);
  float mu0g = dot(n, s);
  float mu0 = dot(ns, s);
  float mu = max(dot(ns, toCam), 1e-3);
  float sinA = max(sin(uSunAngularRadius), 1e-5);
  float discUp = clamp((mu0g + sinA) / (2.0 * sinA), 0.0, 1.0);
  float mu0c = max(mu0, 0.0);
  float cosAlpha = clamp(dot(s, toCam), -1.0, 1.0);
  float alphaDeg = degrees(acos(cosAlpha));

  float f;
  if (uSpecial == 3) {                                     // Titan: opaque haze deck
    f = pow(mu0c, 0.78) * pow(max(dot(n, toCam), 1e-3), -0.22);
    f *= smoothstep(-0.12, 0.25, mu0g);                    // haze scatters past the geometric terminator
    f = mix(f, pow(max(mu0g * 0.5 + 0.5, 0.0), 2.4) * 0.55, 0.0);
  } else {
    float L = exp(-alphaDeg / 60.0);
    if (uIcy > 0.5) L *= 0.5;
    float surge = 1.0 + uSurge * 0.6 * exp(-alphaDeg / 3.0);
    f = (2.0 * L * mu0c / (mu0c + mu) + (1.0 - L) * mu0c) * surge;
    f *= smoothstep(-0.02, 0.08, mu0g) * mix(1.0, smoothstep(0.0, 0.2, mu0), 0.55);
  }
  float light = f * discUp;

  // Parent planet's umbra / penumbra on the moon.
  if (uPlanet.w > 0.0) light *= sphereShadow(P, s, uSunAngularRadius, uPlanet.xyz, uPlanet.w);

  vec3 radiance = albedo * light * (uSunIntensity * RECIPROCAL_PI);

  // Planetshine: Lambert light from the planet's lit disc (direction = toward the planet).
  if (uPlanet.w > 0.0) {
    vec3 toPlanet = normalize(uPlanet.xyz - P);
    float ps = max(dot(ns, toPlanet), 0.0) * smoothstep(-0.05, 0.1, dot(n, toPlanet));
    radiance += albedo * uPlanetShine * (ps * RECIPROCAL_PI);
  }

  gl_FragColor = vec4(radiance, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
