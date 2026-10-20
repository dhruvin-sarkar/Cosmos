/**
 * Physically based bloom: mip-chain downsample / upsample (Jimenez 2014, "Next Generation Post Processing in
 * Call of Duty: Advanced Warfare"), as used by Unreal/Unity HDRP/Bevy.
 *
 *  - Prefilter (first downsample): 13-tap filter with Karis partial averaging (kills fireflies from
 *    sub-pixel stars), applied to exposure-scaled colour, then a soft-knee threshold (quadratic knee, no
 *    hard cut): pixels below ~display white contribute nothing, so sunlit surfaces never haze; the Sun,
 *    specular glints and hot emitters do.
 *  - Downsample: 13-tap filter per level, half resolution each.
 *  - Upsample: 3×3 tent, combined as up_i = mix(down_i, tent(up_{i+1}), scatter). The level weights
 *    (1−s), s(1−s), s²(1−s) … sum to 1, so the chain only redistributes the above-threshold energy over
 *    progressively wider radii (energy conserving); the composite adds it back with a low intensity.
 *
 * Output is in exposure-scaled scene-linear units (the composite adds it after exposure, before AgX).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT, LUMA_GLSL, NAN_GLSL } from './shaders';

export interface BloomSettings {
  /** Number of mip levels (≥ 2). */
  levels: number;
  /** Resolution of the first mip relative to the source buffer (0.25–0.5). */
  resolution: number;
  /** Exposure-scaled linear brightness where bloom reaches full contribution. */
  threshold: number;
  /** Soft-knee half width (linear). */
  knee: number;
  /** Upsample blend toward the wider level (0..1): higher = wider, softer bloom. */
  scatter: number;
}

export const DEFAULT_BLOOM: Readonly<BloomSettings> = Object.freeze({
  levels: 6,
  resolution: 0.5,
  threshold: 1.6,
  knee: 0.8,
  scatter: 0.7,
});

const DOWN_FRAG = /* glsl */ `
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uExposure;
uniform float uThreshold;
uniform float uKnee;
varying vec2 vUv;
${LUMA_GLSL}
${NAN_GLSL}
#ifdef PREFILTER
// Scene-linear input is untrusted: one NaN texel (a 0/0 in any material) would otherwise spread through the whole
// mip chain into a screen-sized white blob. NaN -> 0, ±Inf -> half-float range.
vec3 s(vec2 o) {
  vec3 v = texture2D(tSrc, vUv + o * uTexel).rgb;
  if (anyNan(v)) return vec3(0.0);
  return clamp(v, 0.0, 65504.0);
}
#else
vec3 s(vec2 o) { return texture2D(tSrc, vUv + o * uTexel).rgb; }
#endif
#ifdef PREFILTER
vec3 karis(vec3 a, vec3 b, vec3 c, vec3 d) {
  vec3 m = (a + b + c + d) * 0.25;
  return m / (1.0 + lumaRec709(m));
}
float kw(vec3 a, vec3 b, vec3 c, vec3 d) {
  return 1.0 / (1.0 + lumaRec709((a + b + c + d) * 0.25));
}
#endif
void main() {
  vec3 a = s(vec2(-2.0, 2.0)), b = s(vec2(0.0, 2.0)), c = s(vec2(2.0, 2.0));
  vec3 d = s(vec2(-2.0, 0.0)), e = s(vec2(0.0, 0.0)), f = s(vec2(2.0, 0.0));
  vec3 g = s(vec2(-2.0, -2.0)), h = s(vec2(0.0, -2.0)), i = s(vec2(2.0, -2.0));
  vec3 j = s(vec2(-1.0, 1.0)), k = s(vec2(1.0, 1.0)), l = s(vec2(-1.0, -1.0)), m = s(vec2(1.0, -1.0));
#ifdef PREFILTER
  a *= uExposure; b *= uExposure; c *= uExposure; d *= uExposure; e *= uExposure; f *= uExposure;
  g *= uExposure; h *= uExposure; i *= uExposure; j *= uExposure; k *= uExposure; l *= uExposure; m *= uExposure;
  // Karis average: weight each 2×2 group by 1/(1+luma) so a single hot texel cannot dominate.
  vec3 col = karis(j, k, l, m) * 0.5 + (karis(a, b, d, e) + karis(b, c, e, f) + karis(d, e, g, h) + karis(e, f, h, i)) * 0.125;
  float wsum = kw(j, k, l, m) * 0.5 + (kw(a, b, d, e) + kw(b, c, e, f) + kw(d, e, g, h) + kw(e, f, h, i)) * 0.125;
  col /= max(wsum, 1e-5);
  col = min(col, vec3(32768.0));
  float br = max(col.r, max(col.g, col.b));
  float soft = clamp(br - uThreshold + uKnee, 0.0, 2.0 * uKnee);
  soft = soft * soft / (4.0 * uKnee + 1e-4);
  col *= max(soft, br - uThreshold) / max(br, 1e-4);
#else
  vec3 col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
#endif
  gl_FragColor = vec4(max(col, 0.0), 1.0);
}`;

const UP_FRAG = /* glsl */ `
uniform sampler2D tLow;
uniform sampler2D tHigh;
uniform vec2 uTexel;
uniform float uScatter;
varying vec2 vUv;
void main() {
  vec3 t = texture2D(tLow, vUv + vec2(-1.0, 1.0) * uTexel).rgb
    + texture2D(tLow, vUv + vec2(0.0, 1.0) * uTexel).rgb * 2.0
    + texture2D(tLow, vUv + vec2(1.0, 1.0) * uTexel).rgb
    + texture2D(tLow, vUv + vec2(-1.0, 0.0) * uTexel).rgb * 2.0
    + texture2D(tLow, vUv).rgb * 4.0
    + texture2D(tLow, vUv + vec2(1.0, 0.0) * uTexel).rgb * 2.0
    + texture2D(tLow, vUv + vec2(-1.0, -1.0) * uTexel).rgb
    + texture2D(tLow, vUv + vec2(0.0, -1.0) * uTexel).rgb * 2.0
    + texture2D(tLow, vUv + vec2(1.0, -1.0) * uTexel).rgb;
  vec3 high = texture2D(tHigh, vUv).rgb;
  gl_FragColor = vec4(mix(high, t * (1.0 / 16.0), uScatter), 1.0);
}`;

function makeMaterial(frag: string, uniforms: Record<string, THREE.IUniform>, defines?: Record<string, string>): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    defines: defines ?? {},
    vertexShader: FULLSCREEN_VERT,
    fragmentShader: frag,
    depthTest: false,
    depthWrite: false,
    blending: THREE.NoBlending,
    toneMapped: false,
  });
}

export class PhysicalBloom {
  readonly settings: BloomSettings = { ...DEFAULT_BLOOM };
  private readonly type: THREE.TextureDataType;
  private down: THREE.WebGLRenderTarget[] = [];
  private up: THREE.WebGLRenderTarget[] = [];
  private srcW = 1;
  private srcH = 1;
  private readonly quad = new FullScreenQuad();
  private readonly prefilter = makeMaterial(
    DOWN_FRAG,
    {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uExposure: { value: 1 },
      uThreshold: { value: DEFAULT_BLOOM.threshold },
      uKnee: { value: DEFAULT_BLOOM.knee },
    },
    { PREFILTER: '1' },
  );
  private readonly downMat = makeMaterial(DOWN_FRAG, {
    tSrc: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uExposure: { value: 1 },
    uThreshold: { value: 0 },
    uKnee: { value: 1 },
  });
  private readonly upMat = makeMaterial(UP_FRAG, {
    tLow: { value: null },
    tHigh: { value: null },
    uTexel: { value: new THREE.Vector2() },
    uScatter: { value: DEFAULT_BLOOM.scatter },
  });

  constructor(halfFloat: boolean) {
    this.type = halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType;
  }

  /** Source buffer size in device pixels. */
  setSize(width: number, height: number): void {
    this.srcW = Math.max(1, Math.round(width));
    this.srcH = Math.max(1, Math.round(height));
    this.rebuild();
  }

  configure(next: Partial<BloomSettings>): void {
    const prevLevels = this.settings.levels;
    const prevRes = this.settings.resolution;
    Object.assign(this.settings, next);
    this.settings.levels = Math.max(2, Math.min(9, Math.round(this.settings.levels)));
    if (this.settings.levels !== prevLevels || this.settings.resolution !== prevRes) this.rebuild();
  }

  private rebuild(): void {
    this.disposeTargets();
    let w = Math.max(2, Math.round(this.srcW * this.settings.resolution));
    let h = Math.max(2, Math.round(this.srcH * this.settings.resolution));
    for (let i = 0; i < this.settings.levels; i++) {
      const t = new THREE.WebGLRenderTarget(w, h, {
        type: this.type,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        wrapS: THREE.ClampToEdgeWrapping,
        wrapT: THREE.ClampToEdgeWrapping,
        generateMipmaps: false,
      });
      t.texture.name = `Cosmos.bloom.down${i}`;
      this.down.push(t);
      if (i < this.settings.levels - 1) {
        const u = t.clone();
        u.texture.name = `Cosmos.bloom.up${i}`;
        this.up.push(u);
      }
      if (w <= 2 && h <= 2) break;
      w = Math.max(2, w >> 1);
      h = Math.max(2, h >> 1);
    }
  }

  /** Runs the chain; returns the bloom texture (exposure-scaled linear), or null when nothing to do. */
  render(renderer: THREE.WebGLRenderer, src: THREE.Texture, exposure: number): THREE.Texture | null {
    const n = this.down.length;
    if (n === 0) return null;
    const pf = this.prefilter.uniforms;
    pf.tSrc.value = src;
    (pf.uTexel.value as THREE.Vector2).set(1 / this.srcW, 1 / this.srcH);
    pf.uExposure.value = exposure;
    pf.uThreshold.value = this.settings.threshold;
    pf.uKnee.value = Math.max(1e-3, this.settings.knee);
    this.quad.material = this.prefilter;
    renderer.setRenderTarget(this.down[0]);
    this.quad.render(renderer);

    const dm = this.downMat.uniforms;
    this.quad.material = this.downMat;
    for (let i = 1; i < n; i++) {
      const prev = this.down[i - 1];
      dm.tSrc.value = prev.texture;
      (dm.uTexel.value as THREE.Vector2).set(1 / prev.width, 1 / prev.height);
      renderer.setRenderTarget(this.down[i]);
      this.quad.render(renderer);
    }

    const um = this.upMat.uniforms;
    um.uScatter.value = this.settings.scatter;
    this.quad.material = this.upMat;
    let low = this.down[n - 1];
    for (let i = n - 2; i >= 0; i--) {
      um.tLow.value = low.texture;
      um.tHigh.value = this.down[i].texture;
      (um.uTexel.value as THREE.Vector2).set(1 / low.width, 1 / low.height);
      renderer.setRenderTarget(this.up[i]);
      this.quad.render(renderer);
      low = this.up[i];
    }
    return low.texture;
  }

  private disposeTargets(): void {
    for (const t of this.down) t.dispose();
    for (const t of this.up) t.dispose();
    this.down = [];
    this.up = [];
  }

  dispose(): void {
    this.disposeTargets();
    this.prefilter.dispose();
    this.downMat.dispose();
    this.upMat.dispose();
    this.quad.dispose();
  }
}
