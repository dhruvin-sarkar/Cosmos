/**
 * CinematicPass: the tail of the HDR chain, as one EffectComposer pass that renders to the screen.
 *
 *   scene-linear HDR (MSAA-resolved half float)
 *     → exposure meter (async, every few frames)        → ExposureController (EV per regime + metering)
 *     → Sun visibility (1×1, temporal)                  → glare gain
 *     → physically based bloom (mip chain, soft knee)
 *     → composite: + Sun glare PSF, × exposure, + bloom, × vignette → AgX → sRGB → dither + grain → screen
 *
 * Everything before AgX is linear light. Nothing here clamps until AgX.
 */
import * as THREE from 'three';
import { FullScreenQuad, Pass } from 'three/addons/postprocessing/Pass.js';
import { PhysicalBloom, type BloomSettings } from './bloom';
import { ExposureController, ExposureMeter, type MeterReading } from './exposure';
import { createSunScreen, SunVisibility, type SunScreen } from './glare';
import { AGX_GLSL, FULLSCREEN_VERT, NAN_GLSL } from './shaders';

/** Peak grain amplitude as a fraction of display luminance (VISUAL_DIRECTION: ≤ 1.5 %). */
export const GRAIN_AMOUNT = 0.012;
/** Corner darkening of the (extremely subtle) vignette. */
export const VIGNETTE_AMOUNT = 0.1;
/** AgX look: 1 = Blender 'Punchy' (power 1.35, saturation 1.4); 0.6 restores colour that base AgX washes to pastel
 *  without pushing Jupiter's zones blue-grey or the Sahara burnt orange (art-director round 2). */
export const AGX_LOOK_AMOUNT = 0.6;
/** Sun colour for glare: blackbody 5772 K in linear sRGB, normalised to unit luminance (approx.). */
const SUN_GLARE_COLOR = new THREE.Color(1.0, 0.975, 0.94);

export interface CinematicSettings {
  bloom: boolean;
  /** Added bloom = intensity × (energy-conserving bloom texture). */
  bloomIntensity: number;
  bloomLevels: number;
  bloomResolution: number;
  glare: boolean;
  /** Diffraction-spike strength multiplier (0 disables spikes). */
  spikes: number;
  /** Metered auto exposure on/off (off = regime base EV + bias only). */
  metering: boolean;
  vignette: number;
  /** AgX 'Punchy' look strength (0 = base AgX, 1 = Punchy). */
  look: number;
  /** Display transform: AgX (default) or Khronos PBR Neutral (comparison / alternative). */
  toneMapper: 'agx' | 'neutral';
}

const COMPOSITE_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform sampler2D tGlareVis;
uniform float uExposure;
uniform float uBloomIntensity;
uniform vec2 uSun;
uniform vec2 uRadPerUv;
uniform float uSunAng;
uniform float uGlareGain;
uniform float uPxRad;
uniform float uSpikes;
uniform vec3 uSunColor;
uniform float uVignette;
uniform float uAspect;
uniform float uFrame;
uniform float uGrain;
uniform float uLook;
uniform float uToneMapper;
varying vec2 vUv;
${AGX_GLSL}
${NAN_GLSL}
float ign(vec2 p) {
  return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}
// Glare PSF in scene-linear units for a 1-AU Sun (gain 1): narrow aureole, 2° halo, wide veiling glare,
// and four faint diffraction spikes (spider vanes, 45°).
vec3 sunGlare(vec2 uv, float gain) {
  vec2 d = (uv - uSun) * uRadPerUv;
  float th = length(d);
  float x = max(th - uSunAng, 0.0);
  float halo = 0.5 * exp(-x / 0.0035) + 0.09 * pow(0.02 / (x + 0.02), 2.0) + 0.004 * pow(0.12 / (x + 0.12), 1.5);
  // On the disc itself the glare would wash out the limb darkening and colour: keep ~10 % there.
  halo *= mix(0.1, 1.0, smoothstep(uSunAng * 0.96, uSunAng * 1.01, th));
  float spikes = 0.0;
  if (uSpikes > 0.0) {
    const vec2 a1 = vec2(0.70710678, 0.70710678);
    const vec2 a2 = vec2(-0.70710678, 0.70710678);
    float w = uPxRad * 1.2 + uSunAng * 0.12;
    float len = 0.03 * sqrt(gain) + uSunAng;
    float p1 = dot(d, vec2(-a1.y, a1.x));
    float p2 = dot(d, vec2(-a2.y, a2.x));
    float l1 = abs(dot(d, a1));
    float l2 = abs(dot(d, a2));
    spikes = exp(-p1 * p1 / (w * w)) * pow(len / (l1 + len), 2.0) + exp(-p2 * p2 / (w * w)) * pow(len / (l2 + len), 2.0);
    // An extended disc smears the spikes into faint wide bands: fade them out as the disc is resolved.
    float discPx = uSunAng / max(uPxRad, 1e-9);
    spikes *= 0.1 * uSpikes * smoothstep(uSunAng * 0.9, uSunAng * 1.3 + uPxRad * 2.0, th) * (1.0 - smoothstep(6.0, 60.0, discPx));
  }
  return uSunColor * gain * (halo + spikes);
}
void main() {
  vec3 c = texture2D(tScene, vUv).rgb;
  // A stray NaN texel from any material must not reach AgX (undefined clamp → white/black specks).
  if (anyNan(c)) c = vec3(0.0);
  float gain = uGlareGain * texture2D(tGlareVis, vec2(0.5)).r;
  if (gain > 1e-4) c += sunGlare(vUv, gain);
  c = c * uExposure + texture2D(tBloom, vUv).rgb * uBloomIntensity;
  vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
  float r = clamp(length(q) / length(vec2(uAspect, 1.0) * 0.5), 0.0, 1.0);
  c *= 1.0 - uVignette * r * r * r;
  c = linearToSrgb(uToneMapper > 0.5 ? pbrNeutral(c) : agx(c, uLook));
  // Dither (±0.5 LSB, interleaved gradient noise) + fine grain, both off in true black.
  float luma = dot(c, vec3(0.2126, 0.7152, 0.0722));
  vec2 p = gl_FragCoord.xy + vec2(5.588238, 3.1415) * uFrame;
  float n0 = ign(p) - 0.5;
  float n1 = ign(p + vec2(17.0, 59.0)) - 0.5;
  float alive = step(0.5 / 255.0, luma);
  float grain = uGrain * n1 * smoothstep(0.0, 0.06, luma) * (1.0 - smoothstep(0.55, 1.0, luma));
  c += alive * (n0 / 255.0 + grain);
  gl_FragColor = vec4(max(c, 0.0), 1.0);
}`;

const BLACK = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
BLACK.needsUpdate = true;

export class CinematicPass extends Pass {
  readonly exposure = new ExposureController();
  readonly sun: SunScreen = createSunScreen();
  readonly settings: CinematicSettings = {
    bloom: true,
    bloomIntensity: 0.6,
    bloomLevels: 6,
    bloomResolution: 0.5,
    glare: true,
    spikes: 1,
    metering: true,
    vignette: VIGNETTE_AMOUNT,
    look: AGX_LOOK_AMOUNT,
    toneMapper: 'agx',
  };
  /** Cosmic Ruler scale of the current frame (set by the pipeline before render). */
  scaleLog10 = 7;
  /** Static grain (reduced motion). */
  staticGrain = false;
  /** Drawing-buffer size, device px. */
  private width = 1;
  private height = 1;
  private frame = 0;
  private grainFrame = 0;
  private readonly bloom: PhysicalBloom;
  private readonly meter: ExposureMeter;
  private readonly visibility: SunVisibility;
  private readonly quad: FullScreenQuad;
  private readonly composite: THREE.ShaderMaterial;
  private meterClock = 0;
  private readonly onMeter = (reading: MeterReading): void => this.exposure.meter(reading);

  constructor(halfFloat: boolean) {
    super();
    // Always the last pass (renders to the screen); never swaps the composer buffers.
    this.needsSwap = false;
    this.bloom = new PhysicalBloom(halfFloat);
    this.meter = new ExposureMeter(halfFloat);
    this.visibility = new SunVisibility(halfFloat);
    this.composite = new THREE.ShaderMaterial({
      name: 'CosmosCinematicComposite',
      uniforms: {
        tScene: { value: null },
        tBloom: { value: BLACK },
        tGlareVis: { value: BLACK },
        uExposure: { value: 1 },
        uBloomIntensity: { value: 0 },
        uSun: { value: new THREE.Vector2() },
        uRadPerUv: { value: new THREE.Vector2(1, 1) },
        uSunAng: { value: 0 },
        uGlareGain: { value: 0 },
        uPxRad: { value: 0.001 },
        uSpikes: { value: 1 },
        uSunColor: { value: SUN_GLARE_COLOR },
        uVignette: { value: VIGNETTE_AMOUNT },
        uAspect: { value: 1 },
        uFrame: { value: 0 },
        uGrain: { value: GRAIN_AMOUNT },
        uLook: { value: AGX_LOOK_AMOUNT },
        uToneMapper: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.quad = new FullScreenQuad(this.composite);
  }

  configure(next: Partial<CinematicSettings>): void {
    Object.assign(this.settings, next);
    const b: Partial<BloomSettings> = { levels: this.settings.bloomLevels, resolution: this.settings.bloomResolution };
    this.bloom.configure(b);
  }

  /** Direct access to bloom tuning (threshold, knee, scatter). */
  get bloomSettings(): BloomSettings {
    return this.bloom.settings;
  }

  /** Collect the exposure meter's pending readback; call before the frame's draw calls are queued (perf). */
  pollMeter(): void {
    this.meter.poll();
  }

  override setSize(width: number, height: number): void {
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.bloom.setSize(this.width, this.height);
  }

  override render(
    renderer: THREE.WebGLRenderer,
    writeBuffer: THREE.WebGLRenderTarget,
    readBuffer: THREE.WebGLRenderTarget,
    deltaTime?: number,
  ): void {
    const dt = deltaTime ?? 1 / 60;
    const src = readBuffer.texture;
    const s = this.settings;
    this.frame++;

    // Meter at 4 Hz (adaptation tau >= 0.45 s) whatever the frame rate: each readback is a synchronous GPU-process round trip in Chrome
    // (getBufferSubData), and exposure adaptation is time-based, so faster readings buy nothing (perf).
    this.meterClock += dt;
    if (s.metering && this.meterClock >= 0.25 && !this.meter.busy) {
      this.meterClock = 0;
      this.meter.measure(renderer, src, this.onMeter);
    }
    if (!s.metering) this.exposure.state.coverage = null;
    const exposure = Math.pow(2, this.exposure.update(this.scaleLog10, dt));

    const u = this.composite.uniforms;
    const sun = this.sun;
    if (s.glare && sun.gain > 0 && sun.inFront) {
      this.visibility.update(renderer, src, sun, this.width, this.height, dt);
      u.tGlareVis.value = this.visibility.texture;
      u.uGlareGain.value = sun.gain;
    } else {
      u.uGlareGain.value = 0;
      // Keep the filter state decaying so a re-appearing Sun fades in.
      if (s.glare) {
        sun.inFront = false;
        this.visibility.update(renderer, src, sun, this.width, this.height, dt);
      }
    }

    const bloomTex = s.bloom ? this.bloom.render(renderer, src, exposure) : null;
    u.tBloom.value = bloomTex ?? BLACK;
    u.uBloomIntensity.value = bloomTex ? s.bloomIntensity : 0;

    u.tScene.value = src;
    u.uExposure.value = exposure;
    (u.uSun.value as THREE.Vector2).set(sun.u, sun.v);
    (u.uRadPerUv.value as THREE.Vector2).set(sun.radiusU > 0 ? sun.angRadius / sun.radiusU : 1, sun.radiusV > 0 ? sun.angRadius / sun.radiusV : 1);
    u.uSunAng.value = sun.angRadius;
    u.uPxRad.value = sun.radiusV > 0 ? sun.angRadius / sun.radiusV / this.height : 0.001;
    u.uSpikes.value = s.spikes;
    u.uVignette.value = s.vignette;
    u.uLook.value = s.look;
    u.uToneMapper.value = s.toneMapper === 'neutral' ? 1 : 0;
    u.uAspect.value = this.width / this.height;
    if (!this.staticGrain) this.grainFrame = (this.grainFrame + 1) % 64;
    u.uFrame.value = this.grainFrame;

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  override dispose(): void {
    this.bloom.dispose();
    this.meter.dispose();
    this.visibility.dispose();
    this.composite.dispose();
    this.quad.dispose();
  }
}
