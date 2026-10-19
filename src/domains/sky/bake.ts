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

export interface BakeOptions {
  starless: boolean;
  saturation: number;
  blackPoint: number;
  /** 0..1 blend toward a 3×3 binomial blur (suppresses survey star-count noise). */
  smooth?: number;
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
uniform vec2 uTexel;
uniform float uStarless;
uniform float uSaturation;
uniform float uBlack;
uniform float uSmooth;
uniform float uGamma;
varying vec2 vUv;
float lum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
void main() {
  vec3 c = texture2D(uSrc, vUv).rgb;
  if (uSmooth > 0.0) {
    vec3 b = c * 4.0;
    b += 2.0 * (texture2D(uSrc, vUv + vec2(uTexel.x, 0.0)).rgb + texture2D(uSrc, vUv - vec2(uTexel.x, 0.0)).rgb);
    b += 2.0 * (texture2D(uSrc, vUv + vec2(0.0, uTexel.y)).rgb + texture2D(uSrc, vUv - vec2(0.0, uTexel.y)).rgb);
    b += texture2D(uSrc, vUv + uTexel).rgb + texture2D(uSrc, vUv - uTexel).rgb;
    b += texture2D(uSrc, vUv + vec2(uTexel.x, -uTexel.y)).rgb + texture2D(uSrc, vUv + vec2(-uTexel.x, uTexel.y)).rgb;
    c = mix(c, b / 16.0, uSmooth);
  }
  // Pole pinch: equirectangular texels shrink as cos(Dec) towards the poles, so survey noise turns into radial
  // streaks there. Average horizontally over ~1/cos(Dec) texels (an isotropic footprint on the sky).
  float cosDec = cos((vUv.y - 0.5) * 3.14159265);
  float k = floor(min(24.0, 0.6 / max(cosDec, 1e-3)));
  if (k >= 1.0) {
    vec3 acc = vec3(0.0);
    for (int i = -24; i <= 24; i++) {
      if (abs(float(i)) > k) continue;
      acc += texture2D(uSrc, vUv + vec2(float(i) * uTexel.x, 0.0)).rgb;
    }
    c = acc / (2.0 * k + 1.0);
  } else if (uStarless > 0.5) {
    float m1 = 0.0;
    float m2 = 0.0;
    for (int j = -3; j <= 3; j++) {
      for (int i = -3; i <= 3; i++) {
        if (abs(i) != 3 && abs(j) != 3) continue;
        vec2 o = vec2(float(i), float(j)) * uTexel;
        vec2 uv = vec2(vUv.x + o.x, clamp(vUv.y + o.y, 0.5 * uTexel.y, 1.0 - 0.5 * uTexel.y));
        float l = lum(texture2D(uSrc, uv).rgb);
        if (l > m1) { m2 = m1; m1 = l; } else if (l > m2) { m2 = l; }
      }
    }
    float lc = lum(c);
    float ref = m2 * 1.08 + 0.0015;
    if (lc > ref) c *= ref / lc;
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
  src.minFilter = THREE.NearestFilter;
  src.magFilter = THREE.NearestFilter;
  src.generateMipmaps = false;
  src.colorSpace = THREE.SRGBColorSpace;
  src.needsUpdate = true;

  if (!quad) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uSrc: { value: null }, uTexel: { value: new THREE.Vector2() }, uStarless: { value: 0 }, uSaturation: { value: 1 }, uBlack: { value: 0 }, uSmooth: { value: 0 }, uGamma: { value: 1 } },
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
