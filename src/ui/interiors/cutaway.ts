/**
 * Cutaway renderer for the interior-structure view: a small dedicated three.js canvas (created on open, disposed
 * on close, never shared with the engine). Each body is a stack of layers drawn as spherical shells with a
 * pole-to-pole wedge removed; deeper layers have narrower wedges, so every layer shows its own curved surface and
 * two cut faces, and the innermost layer sits whole in the opening.
 *
 * Geometry is local to each body: unit radius, +y = north pole, the wedge centred on azimuth 0 (+x). The surface
 * texture rotates inside the fixed cut (uRot) so the opening keeps facing the visitor.
 *
 * Shading is linear HDR into AgX (same tone mapper as the engine): one soft key light from the upper left plus a
 * faint sky fill (this is a diagram view, so the night side is not black), temperature glow from a blackbody
 * colour weighted by T, and a "temperature" mode that colours every cut face with the inferno colour map on a log
 * temperature axis (legend in the overlay).
 */
import * as THREE from 'three';
import { AGX_GLSL } from '../../render/post/shaders';
import { drawnRadii, type InteriorBody, type InteriorMaterial } from './data';

export type ColourMode = 'material' | 'temperature';

export interface CutawayAnchor {
  x: number;
  y: number;
  visible: boolean;
}

export interface CutawayBodyLayout {
  /** Screen centre and radius of the body disc, CSS px relative to the canvas. */
  cx: number;
  cy: number;
  rPx: number;
  /** Kilometres per CSS pixel at the body's distance. */
  kmPerPx: number;
  /** One anchor per layer (centre -> surface) on the visible cut face. */
  anchors: CutawayAnchor[];
  /** Saturn's main rings projected to the screen (closed polygons), when the body has them. */
  ring?: CutawayRingLayout;
}

export interface CutawayRingPoint {
  x: number;
  y: number;
  /** On the half of the ring farther from the camera than the body's centre. */
  far: boolean;
}

export interface CutawayRingLayout {
  outer: CutawayRingPoint[];
  inner: CutawayRingPoint[];
  /** The far half projects above the body's centre (camera above the ring plane). */
  farUp: boolean;
}

/** Saturn's main rings (C ring inner edge 74,658 km to A ring outer edge 136,775 km) in equatorial radii (60,268 km). */
export const RING_INNER = 74658 / 60268;
export const RING_OUTER = 136775 / 60268;
const RING_SAMPLES = 72;

export interface CutawayLayout {
  width: number;
  height: number;
  bodies: CutawayBodyLayout[];
}

export interface CutawayOptions {
  canvas: HTMLCanvasElement;
  reducedMotion: boolean;
  /** Left inset (px) covered by the reading column; the bodies are framed in the remaining area. */
  insetLeft: number;
  onLayout(layout: CutawayLayout): void;
}

export const LOG_T_MIN = Math.log10(30);
export const LOG_T_MAX = Math.log10(2e7);

/**
 * Temperature colour scale for the bodies on screen: whole decades (log10 K) spanning every layer's model range, at
 * least two decades wide, so Earth's 300-6500 K is not squeezed into one corner of the Sun's 20-million-K scale.
 */
export function temperatureRange(bodies: ReadonlyArray<InteriorBody | null | undefined>): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const b of bodies) for (const l of b?.layers ?? []) {
    if (!l.temperatureK) continue;
    lo = Math.min(lo, l.temperatureK[0]);
    hi = Math.max(hi, l.temperatureK[1]);
  }
  if (!(hi > 0)) return [LOG_T_MIN, LOG_T_MAX];
  const l0 = Math.floor(Math.log10(lo));
  const l1 = Math.max(Math.ceil(Math.log10(hi)), l0 + 2);
  return [l0, l1];
}

const MAT_ID: Record<InteriorMaterial, number> = {
  rock: 0, crust: 1, metal: 2, 'metallic-hydrogen': 3, gas: 4, ice: 5, ocean: 6, plasma: 7, 'fluid-ices': 8,
  'rock-ice': 9, melt: 10, 'dilute-core': 11, photosphere: 12,
};

/** Base albedo (linear) per material; gas and ice-giant layers take the body's tint instead. */
const MAT_TINT: Record<InteriorMaterial, [number, number, number]> = {
  rock: [0.23, 0.17, 0.11],
  crust: [0.30, 0.24, 0.18],
  metal: [0.15, 0.14, 0.135], // iron: dark diffuse, bright specular
  'metallic-hydrogen': [0.30, 0.37, 0.50],
  gas: [0.60, 0.48, 0.34],
  ice: [0.70, 0.80, 0.88],
  ocean: [0.015, 0.07, 0.22],
  plasma: [1, 0.5, 0.2],
  'fluid-ices': [0.06, 0.30, 0.36],
  'rock-ice': [0.30, 0.29, 0.28],
  melt: [0.16, 0.06, 0.03],
  'dilute-core': [0.26, 0.22, 0.20],
  photosphere: [1, 0.6, 0.25],
};

const GAS_TINT: Record<string, [number, number, number]> = {
  jupiter: [0.56, 0.38, 0.21],
  saturn: [0.60, 0.46, 0.27],
  uranus: [0.42, 0.66, 0.70],
  neptune: [0.16, 0.30, 0.70],
};

const MANTLE_TINT: Record<string, [number, number, number]> = {
  earth: [0.20, 0.19, 0.10], // olive peridotite
  mars: [0.26, 0.15, 0.09],
  moon: [0.24, 0.21, 0.15],
};

/** Materials whose cut faces get relief (bump) and how much. */
const BUMP: Record<InteriorMaterial, number> = {
  rock: 1, crust: 1.2, metal: 0.5, 'metallic-hydrogen': 0.15, gas: 0, ice: 0.5, ocean: 0.1, plasma: 0, 'fluid-ices': 0.2,
  'rock-ice': 0.9, melt: 0.6, 'dilute-core': 0.4, photosphere: 0,
};

/** Fraction of thermal glow each material shows (gas and fluid layers are dense, opaque fluids, not glowing rock). */
const GLOW: Record<InteriorMaterial, number> = {
  rock: 1, crust: 1, metal: 1, 'metallic-hydrogen': 0.05, gas: 0.04, ice: 0, ocean: 0, plasma: 0, 'fluid-ices': 0.12,
  'rock-ice': 0.6, melt: 1.3, 'dilute-core': 0.07, photosphere: 0,
};

const COMMON = /* glsl */ `
  ${AGX_GLSL}
  // The engine's AgX with its 0.6 'Punchy' look (src/render/post/cinematic.ts AGX_LOOK_AMOUNT).
  const float AGX_LOOK = 0.6;
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vNormalL;
  uniform float uRot;
  uniform float uTime;
  uniform vec3 uLight;
  uniform vec3 uCamPos;
  uniform float uMode;
  uniform float uHighlight;
  uniform float uDim;
  uniform float uSeed;

  const float PI = 3.141592653589793;
  vec3 rotY(vec3 p, float a) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  float hash3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float vnoise(vec3 x) {
    vec3 i = floor(x); vec3 f = fract(x); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash3(i), hash3(i + vec3(1, 0, 0)), f.x), mix(hash3(i + vec3(0, 1, 0)), hash3(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash3(i + vec3(0, 0, 1)), hash3(i + vec3(1, 0, 1)), f.x), mix(hash3(i + vec3(0, 1, 1)), hash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vnoise(p); p = p * 2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
  vec3 srgbToLinear(vec3 c) { return pow(max(c, 0.0), vec3(2.2)); }
  // Approximate blackbody colour (linear, max channel 1) after Tanner Helland's fit.
  vec3 blackbody(float t) {
    t = clamp(t, 1000.0, 12000.0) / 100.0;
    float r = t <= 66.0 ? 1.0 : clamp(1.292936 * pow(t - 60.0, -0.1332047592), 0.0, 1.0);
    float g = t <= 66.0 ? clamp(0.39008157 * log(t) - 0.63184144, 0.0, 1.0) : clamp(1.12989086 * pow(t - 60.0, -0.0755148492), 0.0, 1.0);
    float b = t >= 66.0 ? 1.0 : (t <= 19.0 ? 0.0 : clamp(0.54320678 * log(t - 10.0) - 1.19625408, 0.0, 1.0));
    return srgbToLinear(vec3(r, g, b));
  }
  // Thermal glow weight: invisible below ~800 K, dull red at 1500 K, bright by 6000 K.
  float glowWeight(float t) { float x = clamp((t - 800.0) / 5200.0, 0.0, 1.2); return x * x * 1.8; }
  // Glow hue: the blackbody colour of a cooler body, so white-hot cores still read as yellow-orange on screen
  // (illustrative colour; the temperature mode shows the real values on a calibrated scale).
  vec3 glowColour(float t) { return pow(blackbody(min(t * 0.55, 3900.0)), vec3(1.5)); }
  // Inferno colour map (Matt Zucker's polynomial fit), sRGB in, sRGB out.
  vec3 inferno(float t) {
    t = clamp(t, 0.0, 1.0);
    const vec3 c0 = vec3(0.0002189403691192265, 0.001651004631001012, -0.01948089843709184);
    const vec3 c1 = vec3(0.1065134194856116, 0.5639564367884091, 3.932712388889277);
    const vec3 c2 = vec3(11.60249308247187, -3.972853965665698, -15.9423941062914);
    const vec3 c3 = vec3(-41.70399613139459, 17.43639888205313, 44.35414519872813);
    const vec3 c4 = vec3(77.162935699427, -33.40235894210092, -81.80730925738993);
    const vec3 c5 = vec3(-71.31942824499214, 32.62606426397723, 73.20951985803202);
    const vec3 c6 = vec3(25.13112622477341, -12.24266895238567, -23.07032500287172);
    return c0 + t * (c1 + t * (c2 + t * (c3 + t * (c4 + t * (c5 + t * c6)))));
  }
  vec3 bumpNormal(vec3 N, float h, float scale) {
    if (scale <= 0.0) return N;
    vec3 dpdx = dFdx(vWorld), dpdy = dFdy(vWorld);
    float dhx = dFdx(h) * scale, dhy = dFdy(h) * scale;
    vec3 r1 = cross(dpdy, N), r2 = cross(N, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
    return normalize(abs(det) * N - grad);
  }
  vec3 finish(vec3 col) {
    col *= mix(1.0, 0.42, uDim);
    return col;
  }
`;

const VERT = /* glsl */ `
  varying vec3 vLocal;
  varying vec3 vWorld;
  varying vec3 vNormalW;
  varying vec3 vNormalL;
  void main() {
    vLocal = position;
    vNormalL = normal;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`;

const LAYER_FRAG = /* glsl */ `
  ${COMMON}
  uniform int uMat;
  uniform vec3 uTint;
  uniform vec2 uTemp;   // (inner/hot, outer) K; x < 0 = unknown
  uniform vec2 uR;      // drawn inner and outer radius
  uniform float uHalf;  // half wedge angle of this layer (0 = whole sphere)
  uniform float uCull;  // half wedge of the layer above (> 3 = no cull)
  uniform float uBump;
  uniform float uGlow;
  uniform float uLogT0;
  uniform float uLogT1;

  float tempAt(float r) {
    float k = clamp((r - uR.x) / max(uR.y - uR.x, 1e-4), 0.0, 1.0);
    return mix(uTemp.x, uTemp.y, k);
  }

  void main() {
    vec3 p = vLocal;
    float r = length(p);
    float az = atan(p.z, p.x);
    // Cut faces have normals perpendicular to the radius; spherical shells have radial normals.
    float isFace = r < 1e-4 || abs(dot(normalize(vNormalL), p / r)) < 0.5 ? 1.0 : 0.0;
    if (isFace < 0.5) {
      if (abs(az) < uHalf) discard;
      if (uCull < 3.0 && abs(az) > uCull + 0.03) discard;
    }
    vec3 q = rotY(p, uRot) * 5.0 + uSeed;
    float n = fbm(q);
    float n2 = fbm(q * 3.1 + 5.0);
    float T = uTemp.x < 0.0 ? -1.0 : tempAt(r);

    vec3 alb = uTint;
    vec3 emit = vec3(0.0);
    float spec = 0.0;
    float h = n * 0.6 + n2 * 0.4;
    if (uMat == 0) {            // rock
      alb = uTint * (0.7 + 0.6 * n) * (0.85 + 0.3 * n2);
    } else if (uMat == 1) {     // crust: strata
      // Strata fade out where they would alias (thin crusts seen from afar).
      float sPhase = r * 600.0 + n * 7.0;
      float strata = 0.5 + 0.5 * sin(sPhase) * (1.0 - smoothstep(0.6, 1.6, fwidth(sPhase)));
      alb = uTint * (0.65 + 0.45 * n2) * (0.8 + 0.3 * strata);
      h += strata * 0.3;
    } else if (uMat == 2) {     // iron
      alb = uTint * (0.8 + 0.4 * n);
      spec = 1.3;
    } else if (uMat == 3) {     // metallic hydrogen: flowing silver sheen
      float flow = 0.5 + 0.5 * sin(p.y / max(r, 1e-3) * 30.0 + n * 6.0);
      alb = uTint * (0.55 + 0.5 * flow);
      spec = 1.6;
    } else if (uMat == 4) {     // gas: soft latitude bands
      float lat = p.y / max(r, 1e-3);
      float band = 0.5 + 0.5 * sin(lat * 24.0 + n * 3.0);
      // Deeper gas is denser and hotter: darker and warmer towards the layer's base.
      float kd = clamp((r - uR.x) / max(uR.y - uR.x, 1e-4), 0.0, 1.0);
      alb = uTint * (0.72 + 0.32 * band) * (0.9 + 0.2 * n2) * mix(vec3(0.62, 0.5, 0.42), vec3(1.0), kd);
    } else if (uMat == 5) {     // ice: pale, cracked, faint subsurface blue
      float crack = 1.0 - smoothstep(0.0, 0.035, abs(n2 - 0.5));
      alb = uTint * (0.85 + 0.25 * n) - crack * vec3(0.18, 0.1, 0.04);
      emit = uTint * vec3(0.02, 0.04, 0.07) * (0.5 + n);
      spec = 0.35;
    } else if (uMat == 6) {     // ocean
      alb = uTint * (0.6 + 0.6 * n);
      emit = vec3(0.0, 0.012, 0.035) * pow(n2, 3.0) * 6.0;
      spec = 0.6;
    } else if (uMat == 7 || uMat == 12) {     // plasma: emissive, brighter inward
      // Saturated hues at moderate intensity: AgX bleaches bright emission to cream, so the core stays below ~2.
      float lt = log(max(T, 3000.0)) / log(10.0);
      float s = clamp((lt - 3.76) / (7.2 - 3.76), 0.0, 1.0);
      vec3 c = mix(vec3(0.9, 0.1, 0.008), vec3(1.0, 0.32, 0.02), smoothstep(0.0, 0.55, s));
      c = mix(c, vec3(1.0, 0.6, 0.12), smoothstep(0.55, 1.0, s));
      float cells;
      if (uMat == 12) {
        cells = 1.0;
      } else if (uR.x > 0.6) {
        // Convection zone: rising hot plumes and sinking cool lanes.
        float plume = fbm(q * 2.2 + vec3(0.0, uTime * 0.03, 0.0));
        cells = 0.55 + 0.9 * smoothstep(0.35, 0.7, plume);
      } else if (uR.x > 0.1) {
        // Radiative zone: smooth, faint concentric shimmer (photons random-walking outward).
        cells = 0.88 + 0.24 * n2;
      } else {
        cells = 0.92 + 0.16 * n;
      }
      emit = c * (0.35 + 1.7 * s * s) * cells;
      alb = vec3(0.0);
    } else if (uMat == 8) {     // hot fluid ices
      float sw = fbm(q * 1.3 + vec3(0.0, uTime * 0.04, 0.0));
      alb = uTint * (0.6 + 0.8 * sw);
      spec = 0.4;
    } else if (uMat == 9) {     // rock-ice mix
      alb = mix(uTint, vec3(0.62, 0.66, 0.70), step(0.6, n2)) * (0.75 + 0.4 * n);
    } else if (uMat == 10) {    // partial melt: dark rock with glowing veins
      alb = uTint * (0.6 + 0.7 * n);
      float vein = pow(max(0.0, n2 - 0.52) * 3.0, 2.0);
      emit = vec3(1.0, 0.25, 0.03) * vein * 0.9;
    } else if (uMat == 11) {    // dilute core: heavy elements mottled through metallic hydrogen
      float k = clamp((r - uR.x) / max(uR.y - uR.x, 1e-4) + (n - 0.5) * 0.9, 0.0, 1.0);
      alb = mix(vec3(0.16, 0.10, 0.06), uTint, k) * (0.6 + 0.8 * n2);
      spec = 0.5 * k;
      // Hot (~20,000 K), dense heavy-element soup: a dull internal glow mottled by the mixing.
      emit = vec3(1.0, 0.32, 0.06) * 0.1 * smoothstep(0.35, 0.75, n);
    }
    float gw = T > 0.0 ? glowWeight(T) * uGlow : 0.0;
    // Liquid and solid iron above ~1500 K is visibly incandescent (orange at 2000 K): a stronger curve for metal.
    if (uMat == 2 && T > 0.0) gw = max(gw, pow(clamp((T - 800.0) / 2600.0, 0.0, 1.0), 1.5) * 1.3);
    if (gw > 0.0) emit += glowColour(T) * gw * (0.85 + 0.3 * n);
    // Glowing material is mostly seen by its own light.
    alb *= 1.0 - 0.75 * clamp(gw, 0.0, 1.0);

    vec3 N = normalize(vNormalW);
    if (!gl_FrontFacing) N = -N;
    N = bumpNormal(N, h, uBump * 0.012);
    vec3 V = normalize(uCamPos - vWorld);
    float ndl = dot(N, uLight);
    float diff = clamp((ndl + 0.3) / 1.3, 0.0, 1.0);
    float fill = 0.16 + 0.06 * N.y;
    vec3 H = normalize(uLight + V);
    float sp = spec * pow(max(dot(N, H), 0.0), 48.0) * step(0.0, ndl);
    // Incandescent layers keep their own colour: a glint on top of the glow would burn out to white.
    vec3 col = alb * (diff * 1.55 + fill) + vec3(sp) * 1.2 * (1.0 - 0.85 * clamp(gw, 0.0, 1.0)) + emit;

    if (uMode > 0.5) {
      if (T > 0.0) {
        float tn = (log(T) / log(10.0) - uLogT0) / (uLogT1 - uLogT0);
        col = srgbToLinear(inferno(tn)) * (0.72 + 0.4 * diff) * 1.1;
      } else {
        float hatch = step(0.5, fract((gl_FragCoord.x + gl_FragCoord.y) / 7.0));
        col = vec3(0.04 + 0.03 * hatch);
      }
    }

    if (uHighlight > 0.5) {
      // A clean lift, not a bloom: a modest gain that fades out as the layer gets brighter (glowing cores are already
      // near white), plus a thin warm rim on the cut-face edges. Nothing here is allowed to exceed ~1.0.
      float lum = dot(col, vec3(0.3, 0.55, 0.15));
      col *= 1.0 + 0.16 / (1.0 + 2.5 * lum);
      if (isFace > 0.5) {
        float px = fwidth(r);
        float edge = 1.0 - smoothstep(px * 1.1, px * 2.2, min(abs(r - uR.x), abs(uR.y - r)));
        col = mix(col, vec3(1.0, 0.97, 0.9), edge);
      } else {
        // A curved shell: rim it where the wedge cuts it away (angular distance to the cut, in pixels) and softly along
        // its silhouette.
        float wAz = max(fwidth(az), 1e-5);
        float dCut = 9.0;
        if (uHalf > 1e-3) dCut = abs(abs(az) - uHalf);
        if (uCull < 3.0) dCut = min(dCut, abs(abs(az) - (uCull + 0.03)));
        float edgeAz = 1.0 - smoothstep(wAz * 1.1, wAz * 2.2, dCut);
        float limb = pow(1.0 - clamp(abs(dot(N, V)), 0.0, 1.0), 3.0);
        col = mix(col, vec3(1.0, 0.97, 0.9), clamp(max(edgeAz, limb * 0.6), 0.0, 1.0));
      }
    }
    gl_FragColor = vec4(finish(col), 1.0);
    if (uMode < 0.5) gl_FragColor.rgb = agx(gl_FragColor.rgb, AGX_LOOK);
    #include <colorspace_fragment>
  }
`;

const SURFACE_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec3 uTint;
  uniform int uSurf;    // 0 rocky, 1 giant, 2 earth, 3 sun, 4 icy
  uniform float uHalf;

  float worley(vec3 p) {
    vec3 i = floor(p); vec3 f = fract(p); float d = 1.0;
    for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++) {
      vec3 o = vec3(float(x), float(y), float(z));
      vec3 c = o + vec3(hash3(i + o), hash3(i + o + 7.1), hash3(i + o + 13.7));
      d = min(d, length(c - f));
    }
    return d;
  }

  void main() {
    vec3 p = vLocal;
    float r = length(p);
    float az = atan(p.z, p.x);
    if (abs(az) < uHalf) discard;
    vec3 N = normalize(vNormalW);
    vec3 V = normalize(uCamPos - vWorld);
    float mu = clamp(dot(N, V), 0.0, 1.0);
    vec3 col;
    if (uSurf == 3) {
      vec3 q = rotY(p, uRot);
      float g = worley(q * 38.0 + uTime * 0.05);
      float s = 0.72 + 0.28 * smoothstep(0.15, 0.75, g) - 0.14 * fbm(q * 9.0);
      // Limb darkening (Neckel & Labs-like): the limb is redder and dimmer than the disc centre.
      float limb = 0.3 + 0.7 * pow(mu, 0.5);
      col = mix(vec3(0.9, 0.14, 0.01), vec3(1.0, 0.45, 0.08), pow(mu, 0.6)) * 1.25 * s * limb;
      col *= mix(1.0, 0.85, uDim);
    } else {
      float lon = -az + uRot;
      float uu = lon / (2.0 * PI) + 0.5;
      float u1 = fract(uu);
      float u2 = fract(uu + 0.5) - 0.5;
      float u = fwidth(u1) <= fwidth(u2) + 1e-5 ? u1 : u2;
      float v = 0.5 + asin(clamp(p.y / max(r, 1e-5), -1.0, 1.0)) / PI;
      vec3 alb = uHasMap > 0.5 ? texture2D(uMap, vec2(u, v)).rgb : uTint;
      float ndl = dot(N, uLight);
      float diff = clamp((ndl + 0.2) / 1.2, 0.0, 1.0);
      float fill = 0.05 + 0.03 * N.y;
      if (uSurf == 1) diff *= 0.55 + 0.45 * pow(mu, 0.35);
      col = alb * (diff * 2.2 + fill);
      if (uSurf == 2) col += pow(1.0 - mu, 3.5) * vec3(0.22, 0.42, 1.0) * 0.9 * clamp(ndl + 0.35, 0.0, 1.0);
      if (uMode > 0.5) col = vec3(dot(col, vec3(0.3, 0.55, 0.15))) * 0.35;
      if (uHighlight > 0.5) col *= 1.1;
      col = finish(col);
    }
    gl_FragColor = vec4(col, 1.0);
    gl_FragColor.rgb = agx(gl_FragColor.rgb, AGX_LOOK);
    #include <colorspace_fragment>
  }
`;

const RING_FRAG = /* glsl */ `
  ${COMMON}
  uniform sampler2D uMap;
  uniform float uHasMap;
  uniform vec2 uRing; // inner, outer (body radii)
  void main() {
    float r = length(vLocal.xy);
    float u = (r - uRing.x) / (uRing.y - uRing.x);
    if (u < 0.0 || u > 1.0) discard;
    vec4 t = uHasMap > 0.5 ? texture2D(uMap, vec2(u, 0.5)) : vec4(0.8, 0.75, 0.65, 0.5);
    vec3 N = normalize(vNormalW);
    float lit = 0.35 + 0.65 * abs(dot(N, uLight));
    vec3 col = t.rgb * lit * 1.7;
    if (uMode > 0.5) col *= 0.3;
    gl_FragColor = vec4(finish(col), t.a * 0.92);
    gl_FragColor.rgb = agx(gl_FragColor.rgb, AGX_LOOK);
    #include <colorspace_fragment>
  }
`;

interface LayerMeshes {
  sphere: THREE.Mesh;
  faces: [THREE.Mesh, THREE.Mesh] | null;
  material: THREE.ShaderMaterial;
  half: number;
}

interface BodyRig {
  data: InteriorBody;
  group: THREE.Group;
  radii: number[];
  layers: LayerMeshes[];
  surface: THREE.Mesh;
  surfaceMat: THREE.ShaderMaterial;
  ring: THREE.Mesh | null;
  /** Radius scale in compare mode (1 for the larger body). */
  scale: number;
  textures: THREE.Texture[];
  /** Every shader material of the rig (shared uniforms are set on all of them). */
  mats: THREE.ShaderMaterial[];
}

const SHARED_UNIFORMS = () => ({
  uRot: { value: 0 },
  uTime: { value: 0 },
  uLight: { value: new THREE.Vector3(-0.5, 0.5, 0.7).normalize() },
  uCamPos: { value: new THREE.Vector3() },
  uMode: { value: 0 },
  uHighlight: { value: 0 },
  uDim: { value: 0 },
  uSeed: { value: 0 },
});

/** Wedge half-angle (rad) per layer, centre -> surface: 45 deg for the surface, 4.5 deg less per layer inward, the innermost whole. */
export function wedgeHalfAngles(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const depth = n - 1 - i;
    out.push(i === 0 && n > 1 ? 0 : Math.max(0.12, (Math.PI / 4) * (1 - 0.1 * depth)));
  }
  return out;
}

function halfAnnulus(r0: number, r1: number, segments: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const th = (i / segments) * Math.PI;
    const s = Math.sin(th), c = Math.cos(th);
    pos.push(r0 * s, r0 * c, 0, r1 * s, r1 * c, 0);
    nor.push(0, 0, 1, 0, 0, 1);
    if (i < segments) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

function textureUrl(index: Record<string, Record<string, Record<string, string>>> | null, body: string, tier: 'high' | 'low', base: string): string | null {
  const b = index?.[body];
  if (!b) return null;
  for (const key of ['color', 'day', 'surface', 'atmosphere']) {
    const t = b[key];
    if (t?.[tier]) return base + t[tier];
  }
  return null;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export class CutawayRenderer {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 1, 0.01, 100);
  private readonly opts: CutawayOptions;
  private rigs: BodyRig[] = [];
  private raf = 0;
  private disposed = false;
  private last = 0;
  private time = 0;
  private rot = 0;
  private open = 0;
  private openFrom = 0;
  private openTarget = 1;
  private openStart = -1;
  private mode: ColourMode = 'material';
  private highlight: { body: number; layer: number } | null = null;
  private selected: { body: number; layer: number } | null = null;
  private camAz = 0.22;
  private camEl = 0.3;
  private zoom = 1;
  private width = 1;
  private height = 1;
  private layoutDirty = true;
  private texIndex: Record<string, Record<string, Record<string, string>>> | null = null;
  private texIndexPromise: Promise<void> | null = null;
  private readonly loader = new THREE.TextureLoader();
  private readonly tmpV = new THREE.Vector3();
  private readonly tmpV2 = new THREE.Vector3();
  private readonly tmpM = new THREE.Matrix4();
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly base: string;
  private readonly ro: ResizeObserver;

  constructor(opts: CutawayOptions) {
    this.opts = opts;
    this.base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    this.renderer = new THREE.WebGLRenderer({ canvas: opts.canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(0x000000, 1);
    // Tone mapping happens in the shaders (agx() with the engine's look), so the renderer adds none.
    this.renderer.toneMapping = THREE.NoToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(opts.canvas);
    this.resize();
    this.raf = requestAnimationFrame(this.frame);
  }

  setBodies(primary: InteriorBody, secondary: InteriorBody | null): void {
    for (const r of this.rigs) this.disposeRig(r);
    this.rigs = [];
    const maxR = Math.max(primary.radiusKm, secondary?.radiusKm ?? 0);
    this.rigs.push(this.buildRig(primary, primary.radiusKm / maxR, 0));
    if (secondary) this.rigs.push(this.buildRig(secondary, secondary.radiusKm / maxR, 1));
    this.selected = null;
    this.highlight = null;
    const [t0, t1] = temperatureRange([primary, secondary]);
    for (const r of this.rigs) for (const l of r.layers) {
      l.material.uniforms.uLogT0.value = t0;
      l.material.uniforms.uLogT1.value = t1;
    }
    this.setMode(this.mode);
    this.applyHighlight();
    this.layoutDirty = true;
    this.playOpen();
  }

  setMode(mode: ColourMode): void {
    this.mode = mode;
    for (const r of this.rigs) for (const m of r.mats) m.uniforms.uMode.value = mode === 'temperature' ? 1 : 0;
  }

  setHover(sel: { body: number; layer: number } | null): void {
    this.highlight = sel;
    this.applyHighlight();
  }

  setSelected(sel: { body: number; layer: number } | null): void {
    this.selected = sel;
    this.applyHighlight();
  }

  /** Replays the opening animation (instant under reduced motion). */
  playOpen(): void {
    this.openFrom = 0;
    this.openTarget = 1;
    this.open = this.opts.reducedMotion ? 1 : 0;
    this.openStart = this.opts.reducedMotion ? -1 : performance.now() + 250;
    this.applyOpen();
  }

  setReducedMotion(v: boolean): void {
    this.opts.reducedMotion = v;
  }

  orbitBy(dxPx: number, dyPx: number): void {
    this.camAz -= dxPx * 0.006;
    this.camEl = Math.min(1.1, Math.max(-0.6, this.camEl + dyPx * 0.005));
    this.layoutDirty = true;
  }

  zoomBy(factor: number): void {
    this.zoom = Math.min(1.8, Math.max(0.65, this.zoom * factor));
    this.layoutDirty = true;
  }

  resetView(): void {
    this.camAz = 0.22;
    this.camEl = 0.3;
    this.zoom = 1;
    this.layoutDirty = true;
  }

  setInsetLeft(px: number): void {
    this.opts.insetLeft = px;
    this.layoutDirty = true;
  }

  /** Layer under a canvas-relative point, found by marching the view ray through the cut solid. */
  pick(x: number, y: number): { body: number; layer: number } | null {
    this.ndc.set((x / this.width) * 2 - 1, -(y / this.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.camera);
    let best: { body: number; layer: number; t: number } | null = null;
    for (let b = 0; b < this.rigs.length; b++) {
      const rig = this.rigs[b];
      this.tmpM.copy(rig.group.matrixWorld).invert();
      const o = this.tmpV.copy(this.ray.ray.origin).applyMatrix4(this.tmpM);
      const d = this.tmpV2.copy(this.ray.ray.direction).transformDirection(this.tmpM);
      // Entry and exit of the unit sphere.
      const bq = o.dot(d);
      const c = o.lengthSq() - 1;
      const disc = bq * bq - c;
      if (disc < 0) continue;
      const s = Math.sqrt(disc);
      const t0 = Math.max(0, -bq - s), t1 = -bq + s;
      const steps = 240;
      const halves = rig.layers.map(l => l.half * this.open);
      for (let i = 0; i <= steps; i++) {
        const t = t0 + ((t1 - t0) * i) / steps;
        const px = o.x + d.x * t, py = o.y + d.y * t, pz = o.z + d.z * t;
        const r = Math.hypot(px, py, pz);
        const li = rig.radii.findIndex(rr => r <= rr);
        if (li < 0) continue;
        if (Math.abs(Math.atan2(pz, px)) < halves[li]) continue;
        const tw = t * rig.scale;
        if (!best || tw < best.t) best = { body: b, layer: li, t: tw };
        break;
      }
    }
    return best ? { body: best.body, layer: best.layer } : null;
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    for (const r of this.rigs) this.disposeRig(r);
    this.rigs = [];
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }

  // ---------------------------------------------------------------------------------------------------------------

  private buildRig(data: InteriorBody, scale: number, slot: number): BodyRig {
    const group = new THREE.Group();
    group.scale.setScalar(scale);
    this.scene.add(group);
    const { radii } = drawnRadii(data);
    const halves = wedgeHalfAngles(data.layers.length);
    const sphereGeo = new THREE.SphereGeometry(1, 96, 64);
    const layers: LayerMeshes[] = data.layers.map((layer, i) => {
      const inner = i === 0 ? 0 : radii[i - 1];
      const outer = radii[i];
      const mat = layer.material;
      const tint = (mat === 'gas' || mat === 'fluid-ices') && GAS_TINT[data.body]
        ? (mat === 'fluid-ices' ? mixTint(GAS_TINT[data.body], MAT_TINT['fluid-ices'], 0.55) : GAS_TINT[data.body])
        : mat === 'rock' && MANTLE_TINT[data.body] ? MANTLE_TINT[data.body] : MAT_TINT[mat];
      const t = layer.temperatureK;
      const material = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: LAYER_FRAG,
        side: THREE.DoubleSide,
        uniforms: {
          ...SHARED_UNIFORMS(),
          uMat: { value: MAT_ID[mat] },
          uTint: { value: new THREE.Vector3(...tint) },
          uTemp: { value: new THREE.Vector2(t ? t[1] : -1, t ? t[0] : -1) },
          uR: { value: new THREE.Vector2(inner, outer) },
          uHalf: { value: halves[i] },
          uCull: { value: i < data.layers.length - 1 ? halves[i + 1] : 9 },
          uBump: { value: BUMP[mat] },
          uGlow: { value: GLOW[mat] },
          uLogT0: { value: LOG_T_MIN },
          uLogT1: { value: LOG_T_MAX },
        },
      });
      material.uniforms.uSeed.value = i * 3.7 + slot * 11.3;
      // Spherical surface of the layer (the outermost layer's surface is the textured shell instead).
      const sphere = new THREE.Mesh(sphereGeo, material);
      sphere.scale.setScalar(outer);
      sphere.visible = i < data.layers.length - 1;
      group.add(sphere);
      let faces: [THREE.Mesh, THREE.Mesh] | null = null;
      if (halves[i] > 0) {
        const geo = halfAnnulus(inner, outer, 96);
        const a = new THREE.Mesh(geo, material);
        const b = new THREE.Mesh(geo, material);
        group.add(a, b);
        faces = [a, b];
      }
      return { sphere, faces, material, half: halves[i] };
    });

    const surfSurf = data.body === 'sun' ? 3 : data.body === 'earth' ? 2 : ['jupiter', 'saturn', 'uranus', 'neptune'].includes(data.body) ? 1 : 0;
    const surfaceMat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: SURFACE_FRAG,
      uniforms: {
        ...SHARED_UNIFORMS(),
        uMap: { value: null },
        uHasMap: { value: 0 },
        uTint: { value: new THREE.Vector3(0.3, 0.28, 0.26) },
        uSurf: { value: surfSurf },
        uHalf: { value: halves[halves.length - 1] },
      },
    });
    const surface = new THREE.Mesh(new THREE.SphereGeometry(1, 128, 96), surfaceMat);
    group.add(surface);

    const rig: BodyRig = { data, group, radii, layers, surface, surfaceMat, ring: null, scale, textures: [], mats: [] };

    if (data.body === 'saturn') {
      // Main rings (C ring inner edge 74,658 km to A ring outer edge 136,775 km) over Saturn's equatorial radius.
      const inner = RING_INNER, outer = RING_OUTER;
      const ringMat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        uniforms: { ...SHARED_UNIFORMS(), uMap: { value: null }, uHasMap: { value: 0 }, uRing: { value: new THREE.Vector2(inner, outer) } },
      });
      const ring = new THREE.Mesh(new THREE.RingGeometry(inner, outer, 256, 1), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.renderOrder = 2;
      group.add(ring);
      rig.ring = ring;
    }
    rig.mats = [...layers.map(l => l.material), surfaceMat, ...(rig.ring ? [rig.ring.material as THREE.ShaderMaterial] : [])];

    void this.loadTextures(rig);
    return rig;
  }

  private async loadTextures(rig: BodyRig): Promise<void> {
    const key = rig.data.texture;
    if (!key && !rig.ring) return;
    this.texIndexPromise ??= fetch(`${this.base}textures/index.json`)
      .then(r => (r.ok ? r.json() : null))
      .then((j: { bodies?: Record<string, Record<string, Record<string, string>>> } | null) => { this.texIndex = j?.bodies ?? null; })
      .catch(() => { this.texIndex = null; });
    await this.texIndexPromise;
    if (this.disposed || !this.rigs.includes(rig)) return;
    const maxAniso = Math.min(16, this.renderer.capabilities.getMaxAnisotropy());
    const apply = (tex: THREE.Texture, target: THREE.ShaderMaterial, srgb = true): void => {
      if (this.disposed || !this.rigs.includes(rig)) { tex.dispose(); return; }
      tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
      tex.anisotropy = maxAniso;
      tex.wrapS = THREE.RepeatWrapping;
      tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.needsUpdate = true;
      const prev = target.uniforms.uMap.value as THREE.Texture | null;
      target.uniforms.uMap.value = tex;
      target.uniforms.uHasMap.value = 1;
      rig.textures.push(tex);
      if (prev && prev !== tex) {
        prev.dispose();
        rig.textures = rig.textures.filter(t => t !== prev);
      }
    };
    const load = (url: string | null): Promise<THREE.Texture | null> =>
      url ? this.loader.loadAsync(url).catch(() => null) : Promise.resolve(null);
    if (key) {
      const low = textureUrl(this.texIndex, key, 'low', this.base) ?? `${this.base}textures/${key}/color_1k.jpg`;
      const high = textureUrl(this.texIndex, key, 'high', this.base) ?? `${this.base}textures/${key}/color_4k.jpg`;
      const lo = await load(low);
      if (lo) apply(lo, rig.surfaceMat);
      const hi = await load(high);
      if (hi) apply(hi, rig.surfaceMat);
    }
    if (rig.ring) {
      const ringUrl = this.texIndex?.saturn?.rings?.low ? this.base + this.texIndex.saturn.rings.low : `${this.base}textures/saturn/rings_2k.png`;
      const rt = await load(ringUrl);
      if (rt) {
        rt.wrapS = THREE.ClampToEdgeWrapping;
        apply(rt, rig.ring.material as THREE.ShaderMaterial);
        rt.wrapS = THREE.ClampToEdgeWrapping;
      }
    }
  }

  private disposeRig(rig: BodyRig): void {
    this.scene.remove(rig.group);
    const geos = new Set<THREE.BufferGeometry>();
    const mats = new Set<THREE.Material>();
    rig.group.traverse(o => {
      if (o instanceof THREE.Mesh) {
        geos.add(o.geometry as THREE.BufferGeometry);
        mats.add(o.material as THREE.Material);
      }
    });
    geos.forEach(g => g.dispose());
    mats.forEach(m => m.dispose());
    rig.textures.forEach(t => t.dispose());
    rig.textures = [];
  }

  private applyHighlight(): void {
    const any = this.highlight ?? this.selected;
    for (let b = 0; b < this.rigs.length; b++) {
      const rig = this.rigs[b];
      const n = rig.layers.length;
      rig.layers.forEach((l, i) => {
        const on = (this.highlight?.body === b && this.highlight.layer === i) || (this.selected?.body === b && this.selected.layer === i);
        l.material.uniforms.uHighlight.value = on ? 1 : 0;
        l.material.uniforms.uDim.value = any && !on ? 1 : 0;
      });
      const outerOn = (this.highlight?.body === b && this.highlight.layer === n - 1) || (this.selected?.body === b && this.selected.layer === n - 1);
      rig.surfaceMat.uniforms.uHighlight.value = outerOn ? 1 : 0;
      rig.surfaceMat.uniforms.uDim.value = any && !outerOn ? 0.6 : 0;
    }
  }

  private applyOpen(): void {
    const k = this.open;
    for (const rig of this.rigs) {
      rig.layers.forEach((l, i) => {
        const h = l.half * k;
        l.material.uniforms.uHalf.value = h;
        const next = rig.layers[i + 1];
        l.material.uniforms.uCull.value = next ? next.half * k : 9;
        if (l.faces) {
          l.faces[0].rotation.y = -h;
          l.faces[1].rotation.y = h;
          l.faces[0].visible = l.faces[1].visible = h > 1e-3;
        }
      });
      rig.surfaceMat.uniforms.uHalf.value = rig.layers[rig.layers.length - 1].half * k;
    }
    this.layoutDirty = true;
  }

  private resize(): void {
    const c = this.opts.canvas;
    const w = Math.max(1, c.clientWidth), h = Math.max(1, c.clientHeight);
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.renderer.setSize(w, h, false);
    this.layoutDirty = true;
  }

  private placeCamera(): void {
    const w = this.width, h = this.height;
    const cam = this.camera;
    cam.aspect = w / h;
    cam.updateProjectionMatrix();
    const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const tanX = tanY * cam.aspect;
    const inset = Math.min(this.opts.insetLeft, w * 0.5);
    const availW = w - inset;
    // Frame: one body fills ~0.74 of the height (0.5 with Saturn's rings); two bodies sit side by side.
    const ringed = this.rigs.some(r => r.ring);
    let dist: number;
    let centreX: number;
    const right = new THREE.Vector3(Math.sin(this.camAz), 0, -Math.cos(this.camAz));
    if (this.rigs.length <= 1) {
      // Ringed: also keep the whole ring inside the free width (it must not slide under the panel).
      const ringFit = ringed ? (availW / 2 - 14) / (RING_OUTER * 1.05) / (h / 2) : 1;
      const fill = Math.min(ringed ? 0.5 : 0.74, ringFit) / this.zoom;
      dist = 1 / Math.sin(Math.atan(fill * tanY));
      centreX = inset + availW * (ringed ? 0.5 : inset > 0 ? 0.4 : 0.5);
      this.rigs[0]?.group.position.set(0, 0, 0);
    } else {
      const [a, b] = this.rigs;
      const ra = a.scale * (a.ring ? 2.27 : 1), rb = b.scale * (b.ring ? 2.27 : 1);
      const gap = 0.35 * Math.max(a.scale, b.scale);
      // Edge to edge: both diameters plus the gap.
      const span = 2 * ra + gap + 2 * rb;
      // Fit the pair into 84% of the free width and the bigger body into 70% of the height.
      const fracW = (0.84 * availW) / w;
      const dW = span / 2 / (fracW * tanX);
      const dH = Math.max(a.scale, b.scale) / Math.sin(Math.atan(0.7 * tanY));
      dist = Math.max(dW, dH) / this.zoom;
      centreX = inset + availW * 0.5;
      const mid = span / 2;
      a.group.position.copy(right).multiplyScalar(ra - mid);
      b.group.position.copy(right).multiplyScalar(span - rb - mid);
    }
    const ce = Math.cos(this.camEl);
    cam.position.set(Math.cos(this.camAz) * ce * dist, Math.sin(this.camEl) * dist, Math.sin(this.camAz) * ce * dist);
    cam.near = dist * 0.05;
    cam.far = dist * 4;
    cam.up.set(0, 1, 0);
    cam.lookAt(0, 0, 0);
    cam.updateProjectionMatrix();
    // Off-axis shift so the scene centre lands at centreX.
    const shift = (2 * (centreX - w / 2)) / w;
    cam.projectionMatrix.elements[8] = -shift;
    cam.projectionMatrixInverse.copy(cam.projectionMatrix).invert();
    cam.updateMatrixWorld(true);
    // Key light from the upper left, slightly in front (camera space -> world).
    const fwd = this.tmpV.set(0, 0, 0).sub(cam.position).normalize();
    const rgt = this.tmpV2.crossVectors(fwd, cam.up).normalize();
    const up = new THREE.Vector3().crossVectors(rgt, fwd);
    const light = new THREE.Vector3().addScaledVector(rgt, -0.4).addScaledVector(up, 0.45).addScaledVector(fwd, -0.8).normalize();
    for (const rig of this.rigs) {
      rig.group.updateMatrixWorld(true);
      for (const m of rig.mats) {
        (m.uniforms.uLight.value as THREE.Vector3).copy(light);
        (m.uniforms.uCamPos.value as THREE.Vector3).copy(cam.position);
      }
    }
  }

  private computeLayout(): CutawayLayout {
    const cam = this.camera;
    const w = this.width, h = this.height;
    const out: CutawayLayout = { width: w, height: h, bodies: [] };
    const toScreen = (v: THREE.Vector3): { x: number; y: number } => {
      const p = v.clone().project(cam);
      return { x: (p.x * 0.5 + 0.5) * w, y: (-p.y * 0.5 + 0.5) * h };
    };
    for (const rig of this.rigs) {
      const centre = rig.group.position.clone();
      const c = toScreen(centre);
      const dist = cam.position.distanceTo(centre);
      const tanY = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
      const angR = Math.asin(Math.min(1, rig.scale / dist));
      const rPx = (Math.tan(angR) / tanY) * (h / 2);
      const camLocal = cam.position.clone().sub(centre).divideScalar(rig.scale);
      const anchors: CutawayAnchor[] = rig.layers.map((l, i) => {
        const inner = i === 0 ? 0 : rig.radii[i - 1];
        const outer = rig.radii[i];
        const half = l.half * this.open;
        let local: THREE.Vector3;
        let visible = true;
        if (half <= 1e-3) {
          if (i === rig.layers.length - 1) {
            local = camLocal.clone().normalize().add(new THREE.Vector3(0, 0.4, 0)).normalize().multiplyScalar(outer);
          } else {
            const towards = camLocal.clone().normalize().add(new THREE.Vector3(0, 0.55, 0)).normalize();
            local = towards.multiplyScalar(outer * 0.92);
            visible = this.open > 0.6 || i === rig.layers.length - 1;
          }
        } else {
          // Pick the cut face that faces the camera more; anchor at mid-depth, 50 deg from the north pole.
          const th = THREE.MathUtils.degToRad(i === rig.layers.length - 1 ? 42 : 50 + i * 2);
          const rm = (inner + outer) / 2;
          const cands = [half, -half].map(phi => {
            const p = new THREE.Vector3(rm * Math.sin(th) * Math.cos(phi), rm * Math.cos(th), rm * Math.sin(th) * Math.sin(phi));
            const nrm = phi > 0 ? new THREE.Vector3(Math.sin(phi), 0, -Math.cos(phi)) : new THREE.Vector3(Math.sin(-phi), 0, Math.cos(-phi));
            const facing = nrm.dot(camLocal.clone().sub(p).normalize());
            return { p, facing };
          });
          const best = cands[0].facing >= cands[1].facing ? cands[0] : cands[1];
          local = best.p;
          visible = best.facing > 0.05 && this.open > 0.6;
        }
        const world = local.multiplyScalar(rig.scale).add(centre);
        const s = toScreen(world);
        return { x: s.x, y: s.y, visible };
      });
      let ring: CutawayRingLayout | undefined;
      if (rig.ring) {
        const toCam = cam.position.clone().sub(centre).normalize();
        const poly = (radius: number): CutawayRingPoint[] => {
          const pts: CutawayRingPoint[] = [];
          for (let k = 0; k < RING_SAMPLES; k++) {
            const t = (k / RING_SAMPLES) * Math.PI * 2;
            const world = new THREE.Vector3(Math.cos(t) * radius, 0, Math.sin(t) * radius).multiplyScalar(rig.scale).add(centre);
            const s = toScreen(world);
            pts.push({ x: s.x, y: s.y, far: world.clone().sub(centre).dot(toCam) < 0 });
          }
          return pts;
        };
        const outer = poly(RING_OUTER);
        const far = outer.filter(p => p.far);
        ring = { outer, inner: poly(RING_INNER), farUp: far.reduce((a, p) => a + p.y, 0) / Math.max(1, far.length) < c.y };
      }
      out.bodies.push({ cx: c.x, cy: c.y, rPx, kmPerPx: rig.data.radiusKm / Math.max(rPx, 1e-3), anchors, ring });
    }
    return out;
  }

  private readonly frame = (now: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    this.time += dt;
    if (!this.opts.reducedMotion) this.rot += dt * 0.045;
    if (this.openStart >= 0 && now >= this.openStart) {
      const k = Math.min(1, (now - this.openStart) / 1500);
      this.open = this.openFrom + (this.openTarget - this.openFrom) * easeInOut(k);
      this.applyOpen();
      if (k >= 1) this.openStart = -1;
    }
    for (const rig of this.rigs) {
      for (const m of rig.mats) {
        m.uniforms.uRot.value = this.rot;
        m.uniforms.uTime.value = this.time;
      }
    }
    if (this.layoutDirty) {
      this.placeCamera();
      this.layoutDirty = false;
      this.opts.onLayout(this.computeLayout());
    }
    this.renderer.render(this.scene, this.camera);
  };
}

function mixTint(a: [number, number, number], b: [number, number, number], k: number): [number, number, number] {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
