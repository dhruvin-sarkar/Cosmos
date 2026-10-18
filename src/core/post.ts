/**
 * Post-processing (docs/ARCHITECTURE.md §5.4): linear HDR scene → HalfFloat target (optional MSAA)
 * → ordered domain passes (e.g. lensing) → bloom → OutputPass (tone mapping + sRGB).
 *
 * Tone mapping: AgX. Stars, the Sun and accretion flows are emissive HDR sources whose hue carries physical
 * information (blackbody temperature). ACES Filmic skews saturated highlights (deep red/blue emitters drift
 * toward yellow/magenta and clip hard), whereas AgX desaturates smoothly toward white and keeps the hue of
 * bright sources, which matches how an overexposed real star looks. The cost is slightly flatter mid-tones,
 * compensated by exposure. Exposure (`renderer.toneMappingExposure`) is a separate, linear control.
 *
 * Bloom only picks up linear values above BLOOM_THRESHOLD (> display white under AgX at exposure 1), so a
 * sunlit surface (albedo ≤ 1 under unit irradiance) never glows; only emissive HDR sources do.
 *
 * Final pass: blue-noise-like dithering (interleaved gradient noise, Jimenez 2014) of ±0.5 LSB on every
 * non-black pixel to kill 8-bit banding in dark gradients, plus film grain of at most 1.5 % luminance,
 * attenuated in highlights and in true black (black stays #000). Grain is static under reduced motion.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { EffectiveQuality, QualityProfile } from './types';

export const TONE_MAPPING = THREE.AgXToneMapping;
export const DEFAULT_EXPOSURE = 1;
/** Linear-light luminance above which pixels contribute to bloom. */
export const BLOOM_THRESHOLD = 1.5;
/** Peak grain amplitude as a fraction of display luminance (VISUAL_DIRECTION: ≤ 1.5 %). */
export const GRAIN_AMOUNT = 0.012;

const GrainDitherShader = {
  name: 'CosmosGrainDither',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uFrame: { value: 0 },
    uGrain: { value: GRAIN_AMOUNT },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uFrame;
    uniform float uGrain;
    varying vec2 vUv;
    float ign(vec2 p) {
      return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      vec2 p = gl_FragCoord.xy + vec2(5.588238, 3.1415) * uFrame;
      float n0 = ign(p) - 0.5;
      float n1 = ign(p + vec2(17.0, 59.0)) - 0.5;
      float alive = step(0.5 / 255.0, luma);
      float grain = uGrain * n1 * smoothstep(0.0, 0.06, luma) * (1.0 - smoothstep(0.55, 1.0, luma));
      c.rgb += alive * (n0 / 255.0 + grain);
      gl_FragColor = vec4(max(c.rgb, 0.0), c.a);
    }`,
};
export const BLOOM_RADIUS = 0.55;
/** Bloom strength = profile.bloomStrength × this. */
export const BLOOM_STRENGTH_SCALE = 0.75;
/** Bloom buffer resolution relative to the render resolution (the pass halves it again internally). */
const BLOOM_RESOLUTION_SCALE: Record<EffectiveQuality, number> = { performance: 0.5, balanced: 0.75, ultra: 1 };

export interface PostPipelineOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** False when the GPU cannot render to half-float targets (LDR fallback, bloom stays off). */
  halfFloat: boolean;
}

export interface PostPipeline {
  readonly composer: EffectComposer;
  readonly bloom: UnrealBloomPass;
  readonly exposure: number;
  /** CSS size and effective device pixel ratio of the drawing buffer. */
  setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  applyQuality(profile: QualityProfile): void;
  /** Insert a pass before bloom/tone mapping; lower order runs first (stable for equal orders). */
  addPass(pass: Pass, order: number): () => void;
  setExposure(exposure: number): void;
  /** Static grain when true (reduced motion); dithering stays on. */
  setReducedMotion(on: boolean): void;
  render(dtSec: number): void;
  dispose(): void;
}

interface CustomPass {
  pass: Pass;
  order: number;
  seq: number;
}

export function createPostPipeline(opts: PostPipelineOptions): PostPipeline {
  const { renderer, scene, camera } = opts;
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let samples = 0;
  const makeTarget = (): THREE.WebGLRenderTarget => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: opts.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = 'Cosmos.hdr';
    return target;
  };

  const composer = new EffectComposer(renderer, makeTarget());
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 1, BLOOM_RADIUS, BLOOM_THRESHOLD);
  const output = new OutputPass();
  const grain = new ShaderPass(GrainDitherShader);
  let grainFrame = 0;
  let staticGrain = false;
  const custom: CustomPass[] = [];
  let seq = 0;
  let cssW = 1;
  let cssH = 1;
  let pr = 1;
  let bloomScale = BLOOM_RESOLUTION_SCALE.balanced;
  let exposure = DEFAULT_EXPOSURE;

  const rebuildChain = (): void => {
    custom.sort((a, b) => a.order - b.order || a.seq - b.seq);
    composer.passes = [renderPass, ...custom.map(c => c.pass), bloom, output, grain];
  };

  const sizeBloom = (): void => {
    const w = Math.max(2, Math.round(cssW * pr * bloomScale));
    const h = Math.max(2, Math.round(cssH * pr * bloomScale));
    bloom.setSize(w, h);
  };

  rebuildChain();

  return {
    composer,
    bloom,
    get exposure() {
      return exposure;
    },

    setSize(width: number, height: number, pixelRatio: number): void {
      cssW = Math.max(1, width);
      cssH = Math.max(1, height);
      pr = pixelRatio;
      composer.setPixelRatio(pr);
      composer.setSize(cssW, cssH);
      sizeBloom();
    },

    applyQuality(profile: QualityProfile): void {
      bloom.enabled = profile.bloom && opts.halfFloat;
      bloom.strength = profile.bloomStrength * BLOOM_STRENGTH_SCALE;
      bloomScale = BLOOM_RESOLUTION_SCALE[profile.preset];
      const nextSamples = opts.halfFloat ? profile.msaaSamples : 0;
      if (nextSamples !== samples) {
        samples = nextSamples;
        composer.reset(makeTarget());
        composer.setPixelRatio(pr);
        composer.setSize(cssW, cssH);
      }
      sizeBloom();
    },

    addPass(pass: Pass, order: number): () => void {
      const entry: CustomPass = { pass, order, seq: seq++ };
      custom.push(entry);
      pass.setSize(Math.round(cssW * pr), Math.round(cssH * pr));
      rebuildChain();
      return () => {
        const i = custom.indexOf(entry);
        if (i < 0) return;
        custom.splice(i, 1);
        rebuildChain();
      };
    },

    setExposure(value: number): void {
      if (!Number.isFinite(value) || value <= 0) return;
      exposure = value;
      renderer.toneMappingExposure = value;
    },

    setReducedMotion(on: boolean): void {
      staticGrain = on;
    },

    render(dtSec: number): void {
      if (!staticGrain) grainFrame = (grainFrame + 1) % 64;
      grain.uniforms.uFrame.value = grainFrame;
      composer.render(dtSec);
    },

    dispose(): void {
      bloom.dispose();
      output.dispose();
      grain.dispose();
      renderPass.dispose();
      composer.dispose();
    },
  };
}
