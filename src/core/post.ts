/**
 * Post-processing (docs/ARCHITECTURE.md §5.4): linear HDR scene → HalfFloat target (MSAA per preset)
 * → ordered domain passes (e.g. lensing) → CinematicPass (src/render/post) → screen.
 *
 * CinematicPass: metered cinematic exposure (EV per scale regime + lit-pixel metering, smooth asymmetric
 * adaptation), occlusion-tested Sun glare (aureole, halo, veiling glare, faint diffraction spikes), physically
 * based mip-chain bloom (Karis-averaged 13-tap downsample, soft-knee threshold in exposure space, energy-
 * conserving tent upsample), extremely subtle vignette, AgX tone mapping, sRGB encoding, blue-noise dither
 * and fine grain — one fullscreen composite.
 *
 * Tone mapping: AgX. Stars, the Sun and accretion flows are emissive HDR sources whose hue carries physical
 * information (blackbody temperature). ACES Filmic skews saturated highlights (deep red/blue emitters drift
 * toward yellow/magenta and clip hard), whereas AgX desaturates smoothly toward white and keeps the hue of
 * bright sources, which matches how an overexposed real star looks. The curve is three.js r186's AgX
 * (Filament/Blender), reproduced in src/render/post/shaders.ts and mirrored in src/render/tonemap.ts.
 *
 * Bloom only picks up exposure-scaled values above ~display white (soft knee from 0.8, full at 1.6), so a
 * sunlit surface never hazes; the Sun, specular glints and hot emitters do.
 */
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import type { Pass } from 'three/addons/postprocessing/Pass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { CinematicPass, GRAIN_AMOUNT as CINEMATIC_GRAIN, type CinematicSettings } from '../render/post/cinematic';
import { computeSunScreen, glareGain, SUN_ANG_RADIUS_1AU } from '../render/post/glare';
import { renderTransform } from './visualScale';
import type { ExposureState } from '../render/post/exposure';
import type { EntityRegistry } from './entity';
import type { EffectiveQuality, FrameContext, QualityProfile } from './types';

export const TONE_MAPPING = THREE.AgXToneMapping;
export const DEFAULT_EXPOSURE = 1;
/** Exposure-scaled linear brightness where bloom reaches full contribution (soft knee below). */
export const BLOOM_THRESHOLD = 1.6;
/** Peak grain amplitude as a fraction of display luminance (VISUAL_DIRECTION: ≤ 1.5 %). */
export const GRAIN_AMOUNT = CINEMATIC_GRAIN;
/** Added bloom = profile.bloomStrength × this × (energy-conserving bloom texture). */
export const BLOOM_STRENGTH_SCALE = 0.6;
/** Entity whose glare the pipeline renders. */
export const SUN_ENTITY_ID = 'sol:sun';

/**
 * Current linear exposure as a shared uniform (updated every frame). Overlay materials whose colours are
 * pre-inverted through AgX at exposure 1 (src/render/tonemap.ts) can divide by it to stay on their tokens.
 */
export const POST_EXPOSURE_UNIFORM: { value: number } = { value: DEFAULT_EXPOSURE };

/** Post settings per effective preset (Balanced ≲ 1 ms of post on an RTX 3050 at 1080p). */
export const POST_QUALITY: Readonly<
  Record<EffectiveQuality, Readonly<Pick<CinematicSettings, 'bloomLevels' | 'bloomResolution' | 'glare' | 'spikes' | 'metering'>>>
> = Object.freeze({
  performance: { bloomLevels: 5, bloomResolution: 0.25, glare: true, spikes: 0, metering: true },
  balanced: { bloomLevels: 6, bloomResolution: 0.5, glare: true, spikes: 1, metering: true },
  ultra: { bloomLevels: 7, bloomResolution: 0.5, glare: true, spikes: 1, metering: true },
});

export interface PostPipelineOptions {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.Camera;
  /** False when the GPU cannot render to half-float targets (LDR fallback, bloom stays off). */
  halfFloat: boolean;
  /** Source of the Sun entity for glare (optional; no glare without it). */
  registry?: Pick<EntityRegistry, 'get'>;
}

export interface PostPipeline {
  readonly composer: EffectComposer;
  readonly cinematic: CinematicPass;
  /** Linear exposure currently in effect (2^EV). */
  readonly exposure: number;
  /** CSS size and effective device pixel ratio of the drawing buffer. */
  setSize(cssWidth: number, cssHeight: number, pixelRatio: number): void;
  applyQuality(profile: QualityProfile): void;
  /** Insert a pass before bloom/tone mapping; lower order runs first (stable for equal orders). */
  addPass(pass: Pass, order: number): () => void;
  /** Manual linear exposure (sets a manual EV override); see setExposureOverride. */
  setExposure(exposure: number): void;
  /** Manual exposure in EV (linear = 2^EV), or null for automatic. */
  setExposureOverride(ev: number | null): void;
  /** EV bias added to automatic exposure (e.g. a "brighter / darker" UI control). */
  setExposureBias(ev: number): void;
  exposureState(): Readonly<ExposureState>;
  /** Static grain when true (reduced motion); dithering stays on. */
  setReducedMotion(on: boolean): void;
  /** Per-frame inputs (scale regime, Sun screen position). Call after the camera update, before render. */
  update(ctx: FrameContext): void;
  render(dtSec: number): void;
  dispose(): void;
}

interface CustomPass {
  pass: Pass;
  order: number;
  seq: number;
}

const _sunPos = new THREE.Vector3();

export function createPostPipeline(opts: PostPipelineOptions): PostPipeline {
  const { renderer, scene, camera } = opts;
  renderer.toneMapping = TONE_MAPPING;
  renderer.toneMappingExposure = DEFAULT_EXPOSURE;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  let samples = 0;
  const makeTarget = (msaa: number): THREE.WebGLRenderTarget => {
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), {
      type: opts.halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
      samples: msaa,
      depthBuffer: true,
      stencilBuffer: false,
    });
    target.texture.name = 'Cosmos.hdr';
    return target;
  };

  const composer = new EffectComposer(renderer, makeTarget(0));
  // Only the scene buffer (the composer's readBuffer at frame start) is multisampled; the ping-pong buffer
  // used by domain passes is single-sample. At 1080p × DPR 1.5 this saves ~75 MB (2×) / ~150 MB (4×) of VRAM.
  let sceneTarget: THREE.WebGLRenderTarget = composer.renderTarget2;
  const installTargets = (): void => {
    composer.reset(makeTarget(0));
    composer.renderTarget2.dispose();
    sceneTarget = makeTarget(samples);
    composer.renderTarget2 = sceneTarget;
    composer.readBuffer = sceneTarget;
    composer.setPixelRatio(pr);
    composer.setSize(cssW, cssH);
  };
  const renderPass = new RenderPass(scene, camera);
  const cinematic = new CinematicPass(opts.halfFloat);
  const custom: CustomPass[] = [];
  let seq = 0;
  let cssW = 1;
  let cssH = 1;
  let pr = 1;
  let bufferH = 1;

  const rebuildChain = (): void => {
    custom.sort((a, b) => a.order - b.order || a.seq - b.seq);
    composer.passes = [renderPass, ...custom.map(c => c.pass), cinematic];
  };

  rebuildChain();

  const currentLinear = (): number => Math.pow(2, cinematic.exposure.state.ev);

  return {
    composer,
    cinematic,
    get exposure() {
      return currentLinear();
    },

    setSize(width: number, height: number, pixelRatio: number): void {
      cssW = Math.max(1, width);
      cssH = Math.max(1, height);
      pr = pixelRatio;
      bufferH = Math.max(1, Math.round(cssH * pr));
      composer.setPixelRatio(pr);
      composer.setSize(cssW, cssH);
    },

    applyQuality(profile: QualityProfile): void {
      const q = POST_QUALITY[profile.preset];
      cinematic.configure({
        ...q,
        bloom: profile.bloom && opts.halfFloat,
        bloomIntensity: profile.bloomStrength * BLOOM_STRENGTH_SCALE,
      });
      const nextSamples = opts.halfFloat ? profile.msaaSamples : 0;
      if (nextSamples !== samples) {
        samples = nextSamples;
        installTargets();
      }
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
      cinematic.exposure.setManual(Math.log2(value));
    },

    setExposureOverride(ev: number | null): void {
      cinematic.exposure.setManual(ev);
    },

    setExposureBias(ev: number): void {
      cinematic.exposure.setBias(ev);
    },

    exposureState(): Readonly<ExposureState> {
      return cinematic.exposure.state;
    },

    setReducedMotion(on: boolean): void {
      cinematic.staticGrain = on;
    },

    update(ctx: FrameContext): void {
      cinematic.scaleLog10 = ctx.scaleLog10;
      const sunScreen = cinematic.sun;
      sunScreen.gain = 0;
      sunScreen.inFront = false;
      const sun = opts.registry?.get(SUN_ENTITY_ID);
      if (!sun || !(sun.radiusM && sun.radiusM > 0)) return;
      let f = 1;
      try {
        // Drawn (exhibition-scale) disc position and radius, so the glare sits on the Sun that is actually rendered.
        f = renderTransform(sun, ctx.timeMs, _sunPos);
      } catch {
        return;
      }
      _sunPos.sub(ctx.cameraPosition);
      computeSunScreen(_sunPos, sun.radiusM * f, camera, bufferH, sunScreen);
      if (f > 1 && sunScreen.angRadius > 0) {
        // Glare strength stays physical: irradiance from the TRUE angular size, not the enlarged disc.
        const trueAng = Math.asin(Math.min(1, sun.radiusM / Math.max(_sunPos.length(), sun.radiusM)));
        const r = trueAng / SUN_ANG_RADIUS_1AU;
        sunScreen.brightness = r * r;
        sunScreen.gain = glareGain(sunScreen.brightness);
      }
    },

    render(dtSec: number): void {
      composer.render(dtSec);
      // Domain passes swap the ping-pong buffers; the next frame's scene must land in the MSAA target again.
      if (composer.readBuffer !== sceneTarget) composer.swapBuffers();
      const lin = currentLinear();
      POST_EXPOSURE_UNIFORM.value = lin;
      renderer.toneMappingExposure = lin;
    },

    dispose(): void {
      cinematic.dispose();
      renderPass.dispose();
      composer.dispose();
    },
  };
}
