/**
 * The Sun's photosphere (copy-and-extend of the render-kit StarSurfaceMaterial for the solar close-up).
 *
 *  - Limb darkening per display channel from Allen's two-coefficient law at each channel's effective wavelength
 *    (sunPhysics.ts; Pierce & Slaughter 1977, Neckel & Labs 1994): the limb falls to ≈ 0.35 / 0.30 / 0.20 of the
 *    centre in R / G / B, so it is darker and redder, exactly as in white-light images.
 *  - Granulation (≈ 1.3 Mm cells, ≈ 10 min lifetimes, 13–20 % rms contrast), mesogranulation and the supergranular
 *    network; each band fades out once its cells are below ~1.5 px, so nothing shimmers at system scale.
 *  - Faculae: bright network patches in the activity belts whose contrast rises toward the limb (they are hot walls
 *    of magnetic flux tubes seen obliquely) and vanishes at disc centre.
 *  - Sunspots: today's SDO/HMI continuum image, de-limb-darkened (sunImagery.ts) and projected onto the sphere
 *    from Earth's viewpoint at the image time, carried along by differential rotation (Snodgrass & Ulrich 1990).
 *    It fades out on the far hemisphere, near the image limb and as the simulated date moves away from the image
 *    date; there, illustrative procedural spot groups in the ±5–35° activity belts take over. Umbrae (I ≈ 0.25,
 *    T ≈ 4 000 K) and penumbrae (I ≈ 0.8) are coloured by their brightness temperature.
 *  - SDO view: an AIA image (304 / 171 / 193 Å) projected the same way, cross-faded in with `uSdoMix`; outside
 *    its coverage a procedural mottled disc in the image's mean colour (with EUV limb brightening) stands in.
 *
 * Output is linear HDR radiance; exposure, bloom, glare and AgX happen in the post pipeline.
 *
 * DISPLAY GRADE (`uGrade`, default 1): AgX compresses highlights logarithmically and desaturates them, so a physically
 * exact solar disc (white, limb at 0.3× the centre) displays as a flat pale-grey disc. The grade re-maps the centre-to-
 * limb profile to radiances that AgX displays like a filtered white-light photograph: a warm white centre falling to a
 * deep orange-red limb, with feature contrast (spots, granules, faculae) expanded ×1.6 in log space. It was solved
 * numerically with agxInverse (src/render/tonemap.ts) for the exposure the metered post sets on the resolved Sun. The
 * Sun's true colour is white (5772 K); uGrade = 0 renders the physical radiance.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { BLACKBODY_GLSL } from '../../render/glsl/blackbody';
import { NOISE_GLSL } from '../../render/glsl/noise';
import { T_SUN_EFF_K } from '../../core/units';
import { channelLimbCoefficients, SUN_FRAME_RATE_DEG_DAY } from './sunPhysics';
import { GRANULES_PER_TILE, NETWORK_CELLS_PER_TILE } from './sunGranulation';
import type { SunImage } from './sunImagery';

export interface SunMaterialOptions {
  intensity?: number;
  grade?: number;
  granuleCount?: number;
}

type ImageUniforms = {
  tex: { value: THREE.Texture | null };
  w: { value: number };
  scale: { value: number };
  e: { value: THREE.Vector3 };
  up: { value: THREE.Vector3 };
  right: { value: THREE.Vector3 };
  days: { value: number };
};

const imageUniforms = (): ImageUniforms => ({
  tex: { value: null },
  w: { value: 0 },
  scale: { value: 0.45 },
  e: { value: new THREE.Vector3(1, 0, 0) },
  up: { value: new THREE.Vector3(0, 0, 1) },
  right: { value: new THREE.Vector3(0, 1, 0) },
  days: { value: 0 },
});

const MS_PER_DAY = 86_400_000;

export class SunMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uTeff: { value: number };
    uIntensity: { value: number };
    uGrade: { value: number };
    uGranuleScale: { value: number };
    uContrast: { value: number };
    uTime: { value: number };
    uU2: { value: THREE.Vector3 };
    uV2: { value: THREE.Vector3 };
    uProcSpots: { value: number };
    uPattern: { value: THREE.Texture | null };
    uPatternOn: { value: number };
    uHmi: { value: THREE.Texture | null };
    uHmiW: { value: number };
    uHmiScale: { value: number };
    uHmiE: { value: THREE.Vector3 };
    uHmiUp: { value: THREE.Vector3 };
    uHmiRight: { value: THREE.Vector3 };
    uHmiDays: { value: number };
    uSdo: { value: THREE.Texture | null };
    uSdoW: { value: number };
    uSdoScale: { value: number };
    uSdoE: { value: THREE.Vector3 };
    uSdoUp: { value: THREE.Vector3 };
    uSdoRight: { value: THREE.Vector3 };
    uSdoDays: { value: number };
    uSdoMix: { value: number };
    uSdoTint: { value: THREE.Color };
    uSdoLut: { value: THREE.Texture | null };
    uSdoGain: { value: number };
  };

  private hmi: SunImage | null = null;
  private sdo: SunImage | null = null;

  constructor(opts: SunMaterialOptions = {}) {
    const ld = channelLimbCoefficients('visible');
    const h = imageUniforms();
    const s = imageUniforms();
    super({
      uniforms: {
        uTeff: { value: T_SUN_EFF_K },
        uIntensity: { value: opts.intensity ?? 14 },
        uGrade: { value: opts.grade ?? 1 },
        uGranuleScale: { value: (opts.granuleCount ?? 3400) / (2 * Math.PI) },
        uContrast: { value: 0.26 },
        uTime: { value: 0 },
        uU2: { value: new THREE.Vector3(...ld.u2) },
        uV2: { value: new THREE.Vector3(...ld.v2) },
        uProcSpots: { value: 1 },
        uPattern: { value: null },
        uPatternOn: { value: 0 },
        uHmi: h.tex, uHmiW: h.w, uHmiScale: h.scale, uHmiE: h.e, uHmiUp: h.up, uHmiRight: h.right, uHmiDays: h.days,
        uSdo: s.tex, uSdoW: s.w, uSdoScale: s.scale, uSdoE: s.e, uSdoUp: s.up, uSdoRight: s.right, uSdoDays: s.days,
        uSdoMix: { value: 0 },
        uSdoTint: { value: new THREE.Color(0.5, 0.25, 0.05) },
        uSdoLut: { value: null },
        uSdoGain: { value: 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  /** Limb-darkening band: visible light, or the weaker near-infrared law. */
  setBand(band: 'visible' | 'infrared'): void {
    const ld = channelLimbCoefficients(band);
    this.uniforms.uU2.value.set(...ld.u2);
    this.uniforms.uV2.value.set(...ld.v2);
    // The infrared view shows the physical (weaker, near-grey) limb darkening.
    this.uniforms.uGrade.value = band === 'infrared' ? 0 : 1;
  }

  /** Surface-pattern texture (sunGranulation.ts); granulation is off until it is set. */
  setPattern(tex: THREE.Texture | null): void {
    this.uniforms.uPattern.value = tex;
    this.uniforms.uPatternOn.value = tex ? 1 : 0;
  }

  setHmi(img: SunImage | null): void {
    this.hmi = img;
    const u = this.uniforms;
    u.uHmi.value = img?.texture ?? null;
    if (img) {
      u.uHmiScale.value = img.radiusFrac;
      u.uHmiE.value.copy(img.frame.e);
      u.uHmiUp.value.copy(img.frame.up);
      u.uHmiRight.value.copy(img.frame.right);
    } else u.uHmiW.value = 0;
  }

  setSdo(img: SunImage | null): void {
    this.sdo = img;
    const u = this.uniforms;
    u.uSdo.value = img?.texture ?? null;
    u.uSdoLut.value = img?.lut ?? null;
    if (img) {
      u.uSdoScale.value = img.radiusFrac;
      u.uSdoE.value.copy(img.frame.e);
      u.uSdoUp.value.copy(img.frame.up);
      u.uSdoRight.value.copy(img.frame.right);
      u.uSdoTint.value.copy(img.meanColor);
    } else u.uSdoW.value = 0;
  }

  /** Simulation time (ms): granulation phase and the age of the projected images. */
  setTime(timeMs: number): void {
    const u = this.uniforms;
    // Wrap to keep float32 phase precise; the cell motion has no long-period structure that would reveal it.
    u.uTime.value = (timeMs / 1000) % 86_400;
    if (this.hmi) {
      const d = (timeMs - this.hmi.timeMs) / MS_PER_DAY;
      u.uHmiDays.value = d;
      // Spots evolve over days and rotate off the visible hemisphere in ~1 week.
      u.uHmiW.value = 1 - THREE.MathUtils.smoothstep(Math.abs(d), 4, 12);
    }
    if (this.sdo) {
      const d = (timeMs - this.sdo.timeMs) / MS_PER_DAY;
      u.uSdoDays.value = d;
      // EUV structure (loops, coronal holes) changes within a day or two.
      u.uSdoW.value = 1 - THREE.MathUtils.smoothstep(Math.abs(d), 2, 8);
    }
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vObjPos;
void main() {
  vObjPos = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vViewPos = mv.xyz;
  vNormalView = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}
${BLACKBODY_GLSL}
${NOISE_GLSL}
uniform float uTeff;
uniform float uIntensity;
uniform float uGrade;

// Display-graded centre-to-limb colour (centre luminance 1), solved with agxInverse so that, at the metered exposure,
// AgX shows μ = 1 (241,233,209) · 0.85 (233,213,171) · 0.7 (222,190,130) · 0.45 (200,141,78) · 0.25 (173,87,41) · 0.1 (137,44,13).
// Interpolated in log radiance (smooth gradient, no visible kinks at the nodes).
vec3 gradeLimb(float mu) {
  vec3 l;
  if (mu > 0.85) l = mix(vec3(-0.2243, -0.8027, -2.6736), vec3(0.2833, -0.0230, -1.3459), (mu - 0.85) / 0.15);
  else if (mu > 0.70) l = mix(vec3(-0.7002, -1.4576, -4.4918), vec3(-0.2243, -0.8027, -2.6736), (mu - 0.70) / 0.15);
  else if (mu > 0.45) l = mix(vec3(-1.4114, -2.6255, -6.9078), vec3(-0.7002, -1.4576, -4.4918), (mu - 0.45) / 0.25);
  else if (mu > 0.25) l = mix(vec3(-2.0565, -3.9686, -8.1117), vec3(-1.4114, -2.6255, -6.9078), (mu - 0.25) / 0.20);
  else if (mu > 0.10) l = mix(vec3(-2.7662, -5.2030, -9.2103), vec3(-2.0565, -3.9686, -8.1117), (mu - 0.10) / 0.15);
  else if (mu > 0.02) l = mix(vec3(-3.7173, -5.9915, -9.2103), vec3(-2.7662, -5.2030, -9.2103), (mu - 0.02) / 0.08);
  else l = mix(vec3(-4.1997, -6.5023, -9.2103), vec3(-3.7173, -5.9915, -9.2103), mu / 0.02);
  return exp(l);
}
uniform float uGranuleScale;
uniform float uContrast;
uniform float uTime;
uniform vec3 uU2;
uniform vec3 uV2;
uniform float uProcSpots;
uniform sampler2D uHmi;
uniform float uHmiW;
uniform float uHmiScale;
uniform vec3 uHmiE;
uniform vec3 uHmiUp;
uniform vec3 uHmiRight;
uniform float uHmiDays;
uniform sampler2D uSdo;
uniform float uSdoW;
uniform float uSdoScale;
uniform vec3 uSdoE;
uniform vec3 uSdoUp;
uniform vec3 uSdoRight;
uniform float uSdoDays;
uniform float uSdoMix;
uniform vec3 uSdoTint;
uniform sampler2D uSdoLut;
uniform float uSdoGain;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vObjPos;

const float GRANULES_PER_TILE = ${GRANULES_PER_TILE.toFixed(1)};
// Network tile scale: NETWORK_CELLS_PER_TILE supergranules (~30 Mm, ≈ 23 granules) per network tile.
const float NETWORK_SCALE = ${(GRANULES_PER_TILE / (23 * NETWORK_CELLS_PER_TILE)).toFixed(5)};
const float FRAME_RATE = ${SUN_FRAME_RATE_DEG_DAY.toFixed(4)};

// Body-frame point p now → where that plasma was at the image time (differential rotation relative to the frame).
vec3 atImageTime(vec3 p, float days) {
  float s2 = p.z * p.z;
  float omega = 14.713 - 2.396 * s2 - 1.787 * s2 * s2;
  float a = -radians((omega - FRAME_RATE) * days);
  float c = cos(a), s = sin(a);
  return vec3(c * p.x - s * p.y, s * p.x + c * p.y, p.z);
}

// Image uv of body point p0; returns μ at the image time (≤ 0 on the image's far side).
float imageUv(vec3 p0, vec3 e, vec3 up, vec3 right, float scale, out vec2 uv) {
  uv = 0.5 + vec2(dot(p0, right), dot(p0, up)) * scale;
  return dot(p0, e);
}

uniform sampler2D uPattern;
uniform float uPatternOn;

// Triplanar sample of the surface-pattern texture (sunGranulation.ts) at unit-sphere point p, s tiles per radius.
vec4 tri(vec3 p, vec3 w, float s, vec3 off) {
  vec3 q = p * s + off;
  // Planes with negligible weight are skipped (weights are renormalised after the 0.05 cut in main()).
  vec4 c = vec4(0.0);
  if (w.x > 0.0) c += texture2D(uPattern, q.yz) * w.x;
  if (w.y > 0.0) c += texture2D(uPattern, q.zx) * w.y;
  if (w.z > 0.0) c += texture2D(uPattern, q.xy) * w.z;
  return c;
}

void main() {
  vec3 n = normalize(vNormalView);
  vec3 v = normalize(-vViewPos);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  vec3 p = normalize(vObjPos);
  // Steep triplanar weights: overlapping planes would show two lane networks at once, so blend zones stay narrow.
  vec3 w = pow(abs(p), vec3(16.0));
  w /= w.x + w.y + w.z;
  w = max(w - 0.05, 0.0);
  w /= w.x + w.y + w.z;

  // ── quiet photosphere (mip-mapping averages every band to its mean once its cells are sub-pixel) ──
  float tile = uGranuleScale / GRANULES_PER_TILE;
  // Granules live ~10 min: two independent patterns cross-fade, each re-seeded while invisible.
  float cyc = uTime / 600.0;
  float fa = fract(cyc);
  // Sharpened cross-fade: one pattern dominates most of the cycle (no doubled lane network).
  float wa = smoothstep(0.25, 0.75, 1.0 - abs(2.0 * fa - 1.0));
  float wb = 1.0 - wa;
  vec3 oa = fract(vec3(0.131, 0.713, 0.377) * floor(cyc)) * 17.0;
  vec3 ob = fract(vec3(0.617, 0.293, 0.839) * floor(cyc + 0.5)) * 17.0 + 5.0;
  // Low-frequency domain warp (±0.4 tile over ~6 tiles) so the repeating tile never reads as a lattice.
  vec3 pw = p * tile * 0.17;
  vec3 warp = 0.4 * vec3(simplexNoise3(pw), simplexNoise3(pw + vec3(19.1, 7.3, 2.9)), simplexNoise3(pw + vec3(5.7, 23.3, 11.1)));
  vec4 ta = tri(p, w, tile, oa + warp);
  vec4 tb = tri(p, w, tile, ob + warp);
  // Supergranulation (~30 Mm, ≈ 23 granules across): its lanes host the magnetic network; A = mesogranular noise.
  vec3 pn = p * tile * 0.03;
  vec3 warpN = 0.45 * vec3(simplexNoise3(pn + vec3(3.3, 1.7, 9.1)), simplexNoise3(pn + vec3(13.7, 4.1, 0.3)), simplexNoise3(pn + vec3(8.9, 17.3, 6.1)));
  vec4 tn = tri(p, w, tile * NETWORK_SCALE, vec3(0.0, 0.0, uTime * 1e-6) + warpN);
  float g = uPatternOn * ((ta.r - 0.5) * wa + (tb.b - 0.5) * wb) / (0.22 * sqrt(wa * wa + wb * wb));
  float meso = uPatternOn * (tn.a - 0.5) / 0.22;
  float network = uPatternOn * tn.g;
  float contrast = uContrast * (0.3 + 0.7 * mu);
  float quiet = 1.0 + contrast * clamp(g, -2.5, 2.5) + 0.008 * meso; // meso/supergranular intensity contrast < 1 %

  // ── activity belts: faculae and (illustrative) procedural spots ──
  float alat = abs(p.z);
  float belt = smoothstep(0.06, 0.16, alat) * (1.0 - smoothstep(0.42, 0.6, alat));
  float act = belt * smoothstep(0.05, 0.45, fbm3(p * 3.2 + vec3(11.0, 3.0, 7.0), 2));
  // Faculae: grains of bright network, invisible at disc centre, strongest toward (not at) the limb.
  float facProfile = pow(1.0 - mu, 1.3) * smoothstep(0.0, 0.12, mu);
  float grain = clamp(0.5 + (ta.a - 0.5) * 3.0, 0.0, 1.0);
  float faculae = facProfile * (0.3 * network * grain * (0.25 + 0.75 * act) + 0.1 * act);

  float relProc = 1.0;
  if (act > 0.0) {
    float blob = simplexNoise3(p * 34.0 + vec3(5.0, 1.0, 2.0)) * 0.7 + simplexNoise3(p * 90.0) * 0.3;
    float spotV = act * smoothstep(0.42, 0.8, blob);
    relProc = 1.0 - 0.2 * smoothstep(0.02, 0.06, spotV) - 0.52 * smoothstep(0.45, 0.5, spotV);
  }
  relProc = mix(1.0, relProc, uProcSpots);

  // ── today's HMI continuum, carried by differential rotation ──
  float rel = relProc;
  if (uHmiW > 0.0) {
    vec2 uv;
    float mu0 = imageUv(atImageTime(p, uHmiDays), uHmiE, uHmiUp, uHmiRight, uHmiScale, uv);
    float wImg = uHmiW * smoothstep(0.12, 0.35, mu0);
    if (wImg > 0.0) {
      // Faculae in the image are a limb effect of the image's own geometry: keep only the dark (spot) signal, and
      // sharpen it into umbra (≈ 0.28) and penumbra (≈ 0.8) so the 1.45 Mm/px image stays crisp at close range.
      float relImg = min(texture2D(uHmi, uv).r * 1.5, 1.0);
      float quietW = smoothstep(0.86, 0.96, relImg);
      float penW = smoothstep(0.5, 0.6, relImg);
      relImg = mix(mix(0.28, 0.8, penW), 1.0, quietW);
      rel = mix(relProc, relImg, wImg);
    }
  }
  // Spot interiors: no granulation; penumbral grain at the granular scale, faint umbral dots.
  float inSpot = 1.0 - smoothstep(0.6, 0.97, rel);
  quiet = mix(quiet, 1.0 + 0.08 * g * (rel > 0.5 ? 1.0 : 0.4), inSpot);
  faculae *= 1.0 - inSpot;

  // ── colour: per-channel limb darkening × brightness temperature ──
  float x = 1.0 - mu;
  vec3 limb = max(1.0 - uU2 * x - uV2 * (1.0 - mu * mu), 0.0);
  float bright = quiet * rel * (1.0 + faculae);
  // Brightness temperature ∝ I^¼ (bolometric): umbrae ~4 000 K, granules a few % hotter than lanes.
  float tLoc = uTeff * pow(max(bright, 0.05), 0.25);
  vec3 bbLoc = blackbodyLinearSrgb(tLoc);
  vec3 phys = bbLoc * limb * bright;
  // ×2.18 keeps the graded disc's total flux equal to the physical disc's (mean I/I₀ 0.80 vs 0.37), so exposure, bloom
  // and the post glare see the same Sun either way.
  vec3 graded = 2.18 * gradeLimb(mu) * (bbLoc / blackbodyLinearSrgb(uTeff)) * pow(max(bright, 0.0), 1.6);
  vec3 col = max(mix(phys, graded, uGrade), 0.0) * uIntensity;

  // ── SDO (AIA) view ──
  if (uSdoMix > 0.0) {
    vec3 sdo = uSdoTint * (0.45 + 0.55 * clamp(0.5 + 0.6 * fbm3(p * 9.0 + vec3(0.0, 0.0, uTime * 1e-5), 4), 0.0, 1.0));
    sdo *= 1.0 + 0.8 * pow(x, 3.0);
    if (uSdoW > 0.0) {
      vec2 uvS;
      float muS = imageUv(atImageTime(p, uSdoDays), uSdoE, uSdoUp, uSdoRight, uSdoScale, uvS);
      float wS = uSdoW * smoothstep(0.03, 0.22, muS);
      if (wS > 0.0) sdo = mix(sdo, texture2D(uSdoLut, vec2(texture2D(uSdo, uvS).r * (255.0 / 256.0) + 0.5 / 256.0, 0.5)).rgb, wS);
    }
    col = mix(col, sdo * uIntensity * uSdoGain, uSdoMix);
  }

  gl_FragColor = vec4(col, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
