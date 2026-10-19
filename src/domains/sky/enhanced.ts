/**
 * "Enhanced colour composite" sky (default in exhibition mode): a one-time GPU bake that combines three observed
 * all-sky maps into the backdrop the visible band shows:
 *   - base: Gaia DR3 colour flux map (integrated starlight), star-removed like the natural view (catalogue stars
 *     supply the points), with a gentle local-contrast lift (star clouds vs dust lanes) and a contrast curve that lets
 *     the bright Sagittarius bulge glow; colours pulled from Gaia's saturated reddening orange toward the cream /
 *     warm-white of a long-exposure photograph, fainter outer-disc light slightly cooler;
 *   - emission: the Finkbeiner (2003) Hα composite (WHAM + VTSS + SHASSA) added as soft red-magenta clouds (Orion,
 *     Barnard's Loop, the Gum nebula, Cygnus, Carina, the Lagoon...). Hα is genuinely there in visible light; it is
 *     only boosted;
 *   - dust: AKARI far-infrared emission (closing filter fills the survey's missing-scan streaks) used as diffuse
 *     galactic light: dust lit by the local starlight (∝ dust column × smoothed starlight), a faint warm glow along
 *     the plane. Never adds structure where the visible map has no light.
 * Output: linear radiance × STORE_SCALE in a mipmapped sRGB8 target (headroom for Hα peaks); the display divides it
 * back out through the band exposure. Baked in horizontal strips across frames so an 8K bake never stalls a frame.
 */
import * as THREE from 'three';
import { SKY_TAP_GLSL } from './skyTap';

/** Tunables (exposed on window.__sky.tuning for live tuning; rebake() applies them). */
export interface EnhancedTuning {
  /** Visible map black point (linear) and 3×3 smoothing blend. */
  visBlack: number;
  visSmooth: number;
  /** Faint-sky smoothing: footprint (log2 texels at 8K), strength, and the luminance range it fades out over. */
  noiseLod8k: number;
  denoise: number;
  denoiseLo: number;
  denoiseHi: number;
  /** Exponent of the local-contrast term (L / local mean)^k. */
  localContrast: number;
  /** Mip level of the local mean relative to the 1K map (absolute lod = this + log2(width / 1024)). */
  localLod1k: number;
  /** Global power on luminance after the local contrast (> 1 deepens the faint sky, the bulge glows). */
  curve: number;
  /** Luminance gain after the curve. */
  gain: number;
  /** Chroma kept from the Gaia map (0 grey .. 1 as delivered). */
  saturation: number;
  /** Colour grade for faint / bright regions (multipliers, linear). */
  cool: [number, number, number];
  warm: [number, number, number];
  /** Hα: black point and gain on the map's intensity, power, blur (lod at 1K), colour. */
  haBlack: number;
  haGain: number;
  haGamma: number;
  haLod1k: number;
  haColor: [number, number, number];
  /** Hα visibility scaled by local starlight (0 = uniform, 1 = only where the Milky Way is bright). */
  haStarlightBias: number;
  /** Dust (far-IR) black point, glow gain and colour (diffuse galactic light). */
  dustBlack: number;
  dustGain: number;
  dustColor: [number, number, number];
}

export const ENHANCED_TUNING: EnhancedTuning = {
  visBlack: 0.016,
  visSmooth: 0.6,
  noiseLod8k: 2.5,
  denoise: 1.0,
  denoiseLo: 0.03,
  denoiseHi: 0.2,
  localContrast: 0.35,
  localLod1k: 2.5,
  curve: 1.2,
  gain: 1.15,
  saturation: 0.32,
  cool: [0.86, 0.93, 1.08],
  warm: [1.1, 0.98, 0.8],
  haBlack: 0.06,
  haGain: 1.5,
  haGamma: 2.0,
  haLod1k: -1.6,
  haColor: [1.0, 0.28, 0.45],
  haStarlightBias: 0.0,
  dustBlack: 0.05,
  dustGain: 0.35,
  dustColor: [1.0, 0.72, 0.45],
};

/** Stored value = linear × STORE_SCALE (headroom above 1 in the 8-bit target). */
export const STORE_SCALE = 0.5;

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FS = /* glsl */ `
uniform sampler2D uVis;
${SKY_TAP_GLSL}
uniform sampler2D uHa;
uniform sampler2D uDust;
uniform vec2 uTexel;
uniform vec2 uDustTexel;
uniform float uVisBlack;
uniform float uVisSmooth;
uniform float uNoiseLod;
uniform float uDenoise;
uniform float uDenoiseLo;
uniform float uDenoiseHi;
uniform float uLocalContrast;
uniform float uLocalLod;
uniform float uCurve;
uniform float uGain;
uniform float uSat;
uniform vec3 uCool;
uniform vec3 uWarm;
uniform float uHaBlack;
uniform float uHaGain;
uniform float uHaGamma;
uniform float uHaLod;
uniform vec2 uHaTexel;
uniform vec3 uHaColor;
uniform float uHaBias;
uniform float uDustBlack;
uniform float uDustGain;
uniform vec3 uDustColor;
uniform float uStore;
varying vec2 vUv;

float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
vec3 vis0(vec2 uv) { return textureLod(uVis, vec2(uv.x, clamp(uv.y, 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y)), 0.0).rgb; }

// Star-removed visible sample. Pole-aware: horizontal offsets are stretched by 1/cos(Dec) so every footprint is
// isotropic on the sky (no pole pinch, no ring streaks, and star removal works at every declination).
vec3 visClean(vec2 uv, float sx) {
  vec2 tx = vec2(uTexel.x * sx, 0.0);
  vec2 ty = vec2(0.0, uTexel.y);
  vec3 c = vis0(uv);
  vec3 b = c * 4.0;
  b += 2.0 * (vis0(uv + tx) + vis0(uv - tx) + vis0(uv + ty) + vis0(uv - ty));
  b += vis0(uv + tx + ty) + vis0(uv - tx - ty) + vis0(uv + tx - ty) + vis0(uv - tx + ty);
  c = mix(c, b / 16.0, uVisSmooth);
  float m1 = 0.0;
  float m2 = 0.0;
  for (int j = -3; j <= 3; j++) {
    for (int i = -3; i <= 3; i++) {
      if (abs(i) != 3 && abs(j) != 3) continue;
      float l = lum(vis0(uv + float(i) * tx + float(j) * ty));
      if (l > m1) { m2 = m1; m1 = l; } else if (l > m2) { m2 = l; }
    }
  }
  float lc = lum(c);
  float ref = m2 * 1.08 + 0.0015;
  if (lc > ref) c *= ref / lc;
  return c;
}

void main() {
  vec2 uv = vUv;
  float nb = 1.0 / (1.0 - uVisBlack);
  float cosDec = cos((uv.y - 0.5) * 3.14159265);
  float sx = min(48.0, 1.0 / max(cosDec, 0.02));
  vec3 vc = visClean(uv, sx);
  // Noise-adaptive smoothing: the Gaia map is star-count noise in the faint sky (grain, moire); smooth it there,
  // keep full detail in the bright star clouds and dust-lane edges.
  float polar = smoothstep(5.0, 20.0, sx);
  vec3 vs = skySoft(uVis, uv, uNoiseLod + 2.0 * polar, uTexel, sx);
  float wN = uDenoise * max(1.0 - smoothstep(uDenoiseLo, uDenoiseHi, lum(vs)), polar);
  vec3 v = max(mix(vc, vs, wN) - vec3(uVisBlack), vec3(0.0)) * nb;
  vec3 m = max(skySoft(uVis, uv, uLocalLod, uTexel, sx) - vec3(uVisBlack), vec3(0.0)) * nb;
  float L = lum(v);
  float mL = lum(m);

  // Local contrast (star clouds vs dust lanes), then the global curve.
  float e = 0.015;
  float L1 = L * pow((L + e) / (mL + e), uLocalContrast);
  float L2 = pow(max(L1, 0.0), uCurve) * uGain;

  // Colour: Gaia chroma, desaturated, graded cool (faint disc) -> warm cream (bright star clouds).
  vec3 chroma = L > 1e-5 ? v / L : vec3(1.0);
  vec3 col = max(mix(vec3(1.0), chroma, uSat), vec3(0.0));
  col /= max(lum(col), 1e-4);
  vec3 grade = mix(uCool, uWarm, smoothstep(0.04, 0.45, mL));
  vec3 outc = L2 * col * grade;

  // Diffuse galactic light: dust column × smoothed starlight (closing fills AKARI scan gaps).
  vec2 ddx = vec2(uDustTexel.x * 2.0 * sx, 0.0);
  vec2 ddy = vec2(0.0, uDustTexel.y * 2.0);
  float d = 0.0;
  for (int i = -2; i <= 2; i++) {
    d = max(d, lum(skyTap(uDust, uv + float(i) * ddx, 1.0, uDustTexel, sx)));
    d = max(d, lum(skyTap(uDust, uv + float(i) * ddx + ddy, 1.0, uDustTexel, sx)));
  }
  d = max(d - uDustBlack, 0.0) / (1.0 - uDustBlack);
  outc += uDustGain * d * mL * uDustColor;

  // Hα emission (map is a hot-style intensity ramp: mean of channels is monotonic).
  vec3 hr = skyTap(uHa, uv, uHaLod, uHaTexel, sx);
  float h = (hr.r + hr.g + hr.b) / 3.0;
  // CCD bleed trails (e.g. the horizontal streak through M42 in the survey) are horizontal and only a few texels
  // tall: clip anything much brighter than the map 5 texels above and below.
  vec2 hv = vec2(0.0, uHaTexel.y * 5.0);
  vec3 hu = skyTap(uHa, uv + hv, uHaLod, uHaTexel, sx);
  vec3 hb = skyTap(uHa, uv - hv, uHaLod, uHaTexel, sx);
  float href = max(hu.r + hu.g + hu.b, hb.r + hb.g + hb.b) / 3.0;
  h = min(h, href * 1.15 + 0.04);
  h = pow(max(h - uHaBlack, 0.0) / (1.0 - uHaBlack), uHaGamma) * uHaGain;
  h *= mix(1.0, smoothstep(0.0, 0.3, mL), uHaBias);
  outc += h * uHaColor;

  // Dither ±½ LSB of the sRGB8 target (no banding in the smooth glow).
  vec3 st = outc * uStore;
  float hsh = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5;
  st += hsh * (2.2 / 255.0) * pow(max(st, vec3(1e-6)), vec3(0.545));
  gl_FragColor = vec4(max(st, vec3(0.0)), 1.0);
}
`;

export interface EnhancedInputs {
  /** Gaia visible map (sRGB image texture). */
  vis: THREE.Texture;
  /** Hα map (sRGB image texture), any resolution. */
  ha: THREE.Texture | null;
  /** Far-infrared dust map (sRGB image texture), ~1K is enough. */
  dust: THREE.Texture | null;
}

let quad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
let quadScene: THREE.Scene | null = null;
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
let blackTex: THREE.DataTexture | null = null;

function prepare(t: THREE.Texture, aniso: number): void {
  t.wrapS = THREE.RepeatWrapping;
  t.wrapT = THREE.ClampToEdgeWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  t.needsUpdate = true;
}

const sizeOf = (t: THREE.Texture): { w: number; h: number } => {
  const img = t.image as { width: number; height: number };
  return { w: img.width, h: img.height };
};

const nextFrame = (): Promise<void> =>
  new Promise((r) => (typeof requestAnimationFrame === 'function' ? requestAnimationFrame(() => r()) : setTimeout(r, 16)));

/**
 * Bake the enhanced composite at the visible map's resolution. Resolves with a new mipmapped sRGB8 target (caller owns
 * it) after rendering ~4M-pixel strips on successive frames. `isCancelled` aborts between strips (target disposed).
 */
export async function bakeEnhanced(
  renderer: THREE.WebGLRenderer,
  inp: EnhancedInputs,
  tune: EnhancedTuning = ENHANCED_TUNING,
  isCancelled: () => boolean = () => false,
): Promise<THREE.WebGLRenderTarget | null> {
  const { w, h } = sizeOf(inp.vis);
  const aniso = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  prepare(inp.vis, aniso);
  if (inp.ha) prepare(inp.ha, aniso);
  if (inp.dust) prepare(inp.dust, aniso);
  if (!blackTex) {
    blackTex = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    blackTex.needsUpdate = true;
  }
  if (!quad) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const uniforms: Record<string, THREE.IUniform> = {
      uVis: { value: null }, uHa: { value: null }, uDust: { value: null },
      uTexel: { value: new THREE.Vector2() }, uDustTexel: { value: new THREE.Vector2() },
      uVisBlack: { value: 0 }, uVisSmooth: { value: 0 }, uNoiseLod: { value: 0 }, uDenoise: { value: 0 }, uDenoiseLo: { value: 0 }, uDenoiseHi: { value: 1 }, uLocalContrast: { value: 0 }, uLocalLod: { value: 0 },
      uCurve: { value: 1 }, uGain: { value: 1 }, uSat: { value: 1 },
      uCool: { value: new THREE.Vector3() }, uWarm: { value: new THREE.Vector3() },
      uHaBlack: { value: 0 }, uHaGain: { value: 0 }, uHaGamma: { value: 1 }, uHaLod: { value: 0 }, uHaTexel: { value: new THREE.Vector2(1 / 1024, 1 / 512) },
      uHaColor: { value: new THREE.Vector3() }, uHaBias: { value: 0 },
      uDustBlack: { value: 0 }, uDustGain: { value: 0 }, uDustColor: { value: new THREE.Vector3() },
      uStore: { value: STORE_SCALE },
    };
    const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: VS, fragmentShader: FS, depthTest: false, depthWrite: false });
    quad = new THREE.Mesh(geo, mat);
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);
  }
  const u = quad.material.uniforms;
  const lodBase = Math.log2(w / 1024);
  u.uVis.value = inp.vis;
  u.uHa.value = inp.ha ?? blackTex;
  u.uDust.value = inp.dust ?? blackTex;
  u.uTexel.value.set(1 / w, 1 / h);
  const ds = inp.dust ? sizeOf(inp.dust) : { w: 1024, h: 512 };
  u.uDustTexel.value.set(1 / ds.w, 1 / ds.h);
  u.uVisBlack.value = tune.visBlack;
  u.uVisSmooth.value = tune.visSmooth;
  u.uNoiseLod.value = Math.max(0, tune.noiseLod8k + Math.log2(w / 8192));
  u.uDenoise.value = tune.denoise;
  u.uDenoiseLo.value = tune.denoiseLo;
  u.uDenoiseHi.value = tune.denoiseHi;
  u.uLocalContrast.value = tune.localContrast;
  u.uLocalLod.value = Math.max(0, tune.localLod1k + lodBase);
  u.uCurve.value = tune.curve;
  u.uGain.value = tune.gain;
  u.uSat.value = tune.saturation;
  u.uCool.value.set(...tune.cool);
  u.uWarm.value.set(...tune.warm);
  u.uHaBlack.value = tune.haBlack;
  u.uHaGain.value = inp.ha ? tune.haGain : 0;
  u.uHaGamma.value = tune.haGamma;
  const haW = inp.ha ? sizeOf(inp.ha).w : 1024;
  if (inp.ha) u.uHaTexel.value.set(1 / sizeOf(inp.ha).w, 1 / sizeOf(inp.ha).h);
  u.uHaLod.value = Math.max(0, tune.haLod1k + Math.log2(haW / 1024));
  u.uHaColor.value.set(...tune.haColor);
  u.uHaBias.value = tune.haStarlightBias;
  u.uDustBlack.value = tune.dustBlack;
  u.uDustGain.value = inp.dust ? tune.dustGain : 0;
  u.uDustColor.value.set(...tune.dustColor);

  const rt = new THREE.WebGLRenderTarget(w, h, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
    colorSpace: THREE.SRGBColorSpace,
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
    magFilter: THREE.LinearFilter,
    wrapS: THREE.RepeatWrapping,
    wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false,
    stencilBuffer: false,
    anisotropy: Math.min(16, renderer.capabilities.getMaxAnisotropy()),
  });
  const stripRows = Math.max(64, Math.floor((4 * 1024 * 1024) / w));
  rt.scissorTest = true;
  for (let y = 0; y < h; y += stripRows) {
    if (isCancelled()) {
      rt.dispose();
      return null;
    }
    const last = y + stripRows >= h;
    rt.scissor.set(0, y, w, Math.min(stripRows, h - y));
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;
    const prevXr = renderer.xr.enabled;
    renderer.xr.enabled = false;
    renderer.autoClear = false;
    renderer.setRenderTarget(rt);
    renderer.render(quadScene!, quadCam);
    renderer.setRenderTarget(prevTarget);
    renderer.autoClear = prevAutoClear;
    renderer.xr.enabled = prevXr;
    if (!last) await nextFrame();
  }
  rt.scissorTest = false;
  rt.scissor.set(0, 0, w, h);
  u.uVis.value = null;
  u.uHa.value = null;
  u.uDust.value = null;
  return rt;
}
