/**
 * One-time GPU bake of a sky map: decodes the sRGB survey image to linear, removes isolated point sources (catalogue
 * stars supply the points, so the backdrop must not double them up), subtracts a black point and applies the band's
 * saturation, then writes an sRGB8 render target with mipmaps that the backdrop samples.
 *
 * Star removal: a pixel whose luminance exceeds the second-brightest pixel on the Chebyshev ring of radius 3 around it
 * (24 samples) by more than ~8 % is an isolated peak smaller than ~5 px; it is scaled down to that ring level, keeping
 * its colour. Extended structure (the Galactic band, nebulae, dust-lane edges) always has a ring pixel at least as
 * bright and passes untouched. At 4K one pixel is 0.088°, so this removes stars but not the Magellanic Clouds.
 */
import * as THREE from 'three';
import { SKY_TAP_GLSL } from './skyTap';

export interface BakeOptions {
  starless: boolean;
  saturation: number;
  blackPoint: number;
  /** 0..1 blend toward a 3×3 binomial blur (suppresses survey star-count noise). */
  smooth?: number;
  /** 0..1 noise-adaptive smoothing of the faint sky (footprint ~6 texels at 8K, fades out on bright structure). */
  denoise?: number;
  /** Power applied to the normalised linear value after the black point (< 1 lifts faint diffuse light). */
  gamma?: number;
}

const VS = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FS = /* glsl */ `
uniform sampler2D uSrc;
${SKY_TAP_GLSL}
uniform vec2 uTexel;
uniform float uStarless;
uniform float uSaturation;
uniform float uBlack;
uniform float uSmooth;
uniform float uGamma;
uniform float uDenoise;
uniform float uNoiseLod;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
// Sample with a footprint matching the (stretched) texel steps: an explicit box average along RA over ~1/cos(Dec)
// texels (isotropic on the sky), clamped off the pole rows.
vec3 src(vec2 uv, vec2 tx, vec2 ty) {
  vec2 p = vec2(uv.x, clamp(uv.y, 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y));
  float n = floor(0.5 * tx.x / uTexel.x);
  vec3 acc = vec3(0.0);
  for (int i = -24; i <= 24; i++) {
    if (abs(float(i)) > n) continue;
    acc += textureLod(uSrc, p + vec2(float(i) * uTexel.x, 0.0), 0.0).rgb;
  }
  return acc / (2.0 * n + 1.0);
}
void main() {
  // Pole-aware: horizontal offsets stretched by 1/cos(Dec) so every footprint is isotropic on the sky (no pole
  // pinch or radial streaks; star removal works at every declination).
  float cosDec = cos((vUv.y - 0.5) * 3.14159265);
  vec2 tx = vec2(uTexel.x * min(48.0, 1.0 / max(cosDec, 0.02)), 0.0);
  vec2 ty = vec2(0.0, uTexel.y);
  vec3 c = src(vUv, tx, ty);
  if (uSmooth > 0.0) {
    vec3 b = c * 4.0;
    b += 2.0 * (src(vUv + tx, tx, ty) + src(vUv - tx, tx, ty) + src(vUv + ty, tx, ty) + src(vUv - ty, tx, ty));
    b += src(vUv + tx + ty, tx, ty) + src(vUv - tx - ty, tx, ty) + src(vUv + tx - ty, tx, ty) + src(vUv - tx + ty, tx, ty);
    c = mix(c, b / 16.0, uSmooth);
  }
  if (uStarless > 0.5) {
    float m1 = 0.0;
    float m2 = 0.0;
    for (int j = -3; j <= 3; j++) {
      for (int i = -3; i <= 3; i++) {
        if (abs(i) != 3 && abs(j) != 3) continue;
        float l = lum(src(vUv + float(i) * tx + float(j) * ty, tx, ty));
        if (l > m1) { m2 = m1; m1 = l; } else if (l > m2) { m2 = l; }
      }
    }
    float lc = lum(c);
    float ref = m2 * 1.08 + 0.0015;
    if (lc > ref) c *= ref / lc;
  }
  // Noise-adaptive smoothing: survey noise in the faint sky (grain, moire, radial streaks near the poles) is
  // smoothed; bright structure keeps full detail.
  if (uDenoise > 0.0) {
    float sx = tx.x / uTexel.x;
    // Polar caps (|Dec| > ~80°, featureless faint sky): progressively wider smoothing so survey noise cannot
    // turn into radial streaks.
    float polar = smoothstep(5.0, 20.0, sx);
    vec3 vs = skySoft(uSrc, vUv, uNoiseLod + 2.0 * polar, uTexel, sx);
    float w = max(1.0 - smoothstep(uBlack + 0.015, uBlack + 0.18, lum(vs)), polar);
    c = mix(c, vs, uDenoise * w);
  }
  c = max(c - vec3(uBlack), vec3(0.0)) / (1.0 - uBlack);
  float l0 = lum(c);
  if (uGamma != 1.0 && l0 > 0.0) c *= pow(l0, uGamma - 1.0);
  float l = lum(c);
  c = max(mix(vec3(l), c, uSaturation), vec3(0.0));
  gl_FragColor = vec4(c, 1.0);
}
`;

let quad: THREE.Mesh<THREE.BufferGeometry, THREE.ShaderMaterial> | null = null;
let quadScene: THREE.Scene | null = null;
const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

/** Bake `src` (an sRGB image texture) into a new mipmapped sRGB render target. The caller owns the result. */
export function bakeSkyMap(renderer: THREE.WebGLRenderer, src: THREE.Texture, opts: BakeOptions): THREE.WebGLRenderTarget {
  const img = src.image as { width: number; height: number };
  const w = img.width;
  const h = img.height;
  src.wrapS = THREE.RepeatWrapping;
  src.wrapT = THREE.ClampToEdgeWrapping;
  // Mipmapped: the faint-sky smoothing samples coarse levels (skyTap).
  src.minFilter = THREE.LinearMipmapLinearFilter;
  src.magFilter = THREE.LinearFilter;
  src.generateMipmaps = true;
  src.anisotropy = Math.min(16, renderer.capabilities.getMaxAnisotropy());
  src.colorSpace = THREE.SRGBColorSpace;
  src.needsUpdate = true;

  if (!quad) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uStarless: { value: 0 }, uSaturation: { value: 1 }, uBlack: { value: 0 }, uSmooth: { value: 0 }, uGamma: { value: 1 }, uDenoise: { value: 0 }, uNoiseLod: { value: 0 } },
      vertexShader: VS,
      fragmentShader: FS,
      depthTest: false,
      depthWrite: false,
    });
    quad = new THREE.Mesh(geo, mat);
    quad.frustumCulled = false;
    quadScene = new THREE.Scene();
    quadScene.add(quad);
  }
  const u = quad.material.uniforms;
  u.uSrc.value = src;
  u.uTexel.value.set(1 / w, 1 / h);
  u.uStarless.value = opts.starless ? 1 : 0;
  u.uSaturation.value = opts.saturation;
  u.uBlack.value = opts.blackPoint;
  u.uSmooth.value = opts.smooth ?? 0;
  u.uGamma.value = opts.gamma ?? 1;
  u.uDenoise.value = opts.denoise ?? 0;
  u.uNoiseLod.value = Math.max(0, 2.5 + Math.log2(w / 8192));

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
  u.uSrc.value = null;
  return rt;
}
