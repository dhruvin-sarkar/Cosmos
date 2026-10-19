/**
 * Sun glare: screen geometry of the Sun (CPU, allocation-free) and a GPU occlusion/visibility estimate.
 *
 * Visibility is measured on the rendered HDR frame itself: 32 golden-angle samples inside the solar disc
 * (≥ 1.5 px radius) count how many are still at photospheric brightness. A planet or moon in front of the Sun
 * replaces those pixels with its (dark) night side, so an eclipse fades the glare in proportion to the
 * covered disc, and a disc leaving the screen edge fades it too. The result is low-pass filtered over ~0.1 s
 * in a 1×1 ping-pong target, so it never pops. No CPU readback.
 *
 * Glare strength follows the Sun's apparent brightness (∝ solid angle, i.e. (θ/θ₁AU)²) compressed with a
 * 0.35 power, and fades out beyond ~100 AU where the Sun is just a bright star (the star field's own PSF
 * takes over).
 */
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { FULLSCREEN_VERT, LUMA_GLSL } from './shaders';

/** Solar angular radius at 1 AU, rad (R☉ = 695,700 km, IAU 2015 B3; 1 AU = 1.495978707e11 m). */
export const SUN_ANG_RADIUS_1AU = 695_700e3 / 1.495978707e11;

export interface SunScreen {
  /** True when the Sun is in front of the camera and close enough to the screen to matter. */
  inFront: boolean;
  /** Screen position in uv (0..1, y up). */
  u: number;
  v: number;
  /** Angular radius, rad. */
  angRadius: number;
  /** Disc radius in uv units (x, y). */
  radiusU: number;
  radiusV: number;
  /** Disc radius in device pixels. */
  radiusPx: number;
  /** Apparent brightness relative to the Sun seen from 1 AU (solid-angle ratio). */
  brightness: number;
  /** Glare gain (0 when the Sun is too faint/far to glare). */
  gain: number;
}

export function createSunScreen(): SunScreen {
  return { inFront: false, u: 0, v: 0, angRadius: 0, radiusU: 0, radiusV: 0, radiusPx: 0, brightness: 0, gain: 0 };
}

const smoothstep = (a: number, b: number, x: number): number => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Glare gain for a brightness ratio (1 at 1 AU). */
export function glareGain(brightness: number): number {
  if (!(brightness > 0)) return 0;
  const fade = smoothstep(Math.log10(1e-6), Math.log10(1e-4), Math.log10(brightness));
  return Math.min(3, Math.pow(brightness, 0.35)) * fade;
}

const _v = new THREE.Vector3();

/**
 * @param rel Sun position minus camera position, metres (ICRS axes, same frame as the render camera).
 * @param camera The render camera (at the origin; matrixWorldInverse/projectionMatrix current).
 * @param bufferHeightPx Drawing-buffer height in device pixels.
 */
export function computeSunScreen(
  rel: THREE.Vector3,
  radiusM: number,
  camera: THREE.Camera,
  bufferHeightPx: number,
  out: SunScreen,
): SunScreen {
  const dist = rel.length();
  out.inFront = false;
  out.gain = 0;
  if (!(dist > radiusM) || !(radiusM > 0)) return out;
  _v.copy(rel).divideScalar(dist).transformDirection(camera.matrixWorldInverse);
  if (_v.z > -1e-4) return out;
  _v.applyMatrix4(camera.projectionMatrix);
  const p = camera.projectionMatrix.elements;
  out.u = _v.x * 0.5 + 0.5;
  out.v = _v.y * 0.5 + 0.5;
  out.angRadius = Math.asin(Math.min(1, radiusM / dist));
  // A sphere's limb projects at tan(angRadius) (≈ 6 % beyond the linear estimate at 2.6 radii): use it so the glare's
  // on-disc suppression ends exactly at the drawn limb up close.
  const tanAng = Math.tan(Math.min(out.angRadius, 1.5));
  out.radiusU = tanAng * p[0] * 0.5;
  out.radiusV = tanAng * p[5] * 0.5;
  out.radiusPx = out.radiusV * bufferHeightPx;
  const r = out.angRadius / SUN_ANG_RADIUS_1AU;
  out.brightness = r * r;
  out.gain = glareGain(out.brightness);
  const margin = Math.max(out.radiusU, out.radiusV) + 0.02;
  out.inFront = out.u > -margin && out.u < 1 + margin && out.v > -margin && out.v < 1 + margin;
  return out;
}

const VIS_FRAG = /* glsl */ `
uniform sampler2D tScene;
uniform sampler2D tPrev;
uniform vec2 uSun;
uniform vec2 uRadius;
uniform vec2 uPixel;
uniform float uRadiusPx;
uniform float uThreshold;
uniform float uBlend;
uniform float uActive;
varying vec2 vUv;
${LUMA_GLSL}
void main() {
  float prev = texture2D(tPrev, vec2(0.5)).r;
  float vis = 0.0;
  if (uActive > 0.5) {
    vec2 r = max(uRadius * 0.85, uPixel * 1.5);
    float bright = 0.0;
    float inside = 0.0;
    for (int i = 0; i < 32; i++) {
      float fi = float(i) + 0.5;
      float rr = sqrt(fi / 32.0);
      float a = fi * 2.39996323;
      vec2 uv = uSun + vec2(cos(a), sin(a)) * rr * r;
      float on = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
      float l = lumaRec709(texture2D(tScene, clamp(uv, vec2(0.0), vec2(1.0))).rgb);
      bright += on * step(uThreshold, l);
      inside += on;
    }
    float frac = bright / 32.0;
    // A sub-pixel Sun is a PSF a few pixels wide: any bright sample means it is there.
    float anyBright = step(0.5, bright);
    vis = mix(anyBright * (inside / 32.0), frac, smoothstep(2.0, 6.0, uRadiusPx));
  }
  gl_FragColor = vec4(mix(prev, vis, uBlend), 0.0, 0.0, 1.0);
}`;

export class SunVisibility {
  private targets: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget];
  private index = 0;
  private readonly quad = new FullScreenQuad();
  readonly material: THREE.ShaderMaterial;

  constructor(halfFloat: boolean) {
    const make = (): THREE.WebGLRenderTarget =>
      new THREE.WebGLRenderTarget(1, 1, {
        type: halfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        depthBuffer: false,
        stencilBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
        generateMipmaps: false,
      });
    this.targets = [make(), make()];
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        tScene: { value: null },
        tPrev: { value: null },
        uSun: { value: new THREE.Vector2() },
        uRadius: { value: new THREE.Vector2() },
        uPixel: { value: new THREE.Vector2() },
        uRadiusPx: { value: 0 },
        uThreshold: { value: 2 },
        uBlend: { value: 1 },
        uActive: { value: 0 },
      },
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: VIS_FRAG,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
      toneMapped: false,
    });
    this.quad.material = this.material;
  }

  /** Current (filtered) visibility texture: r = 0..1. */
  get texture(): THREE.Texture {
    return this.targets[this.index].texture;
  }

  update(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Texture,
    sun: SunScreen,
    bufferW: number,
    bufferH: number,
    dtSec: number,
  ): void {
    const u = this.material.uniforms;
    const prev = this.targets[this.index];
    this.index ^= 1;
    u.tScene.value = scene;
    u.tPrev.value = prev.texture;
    (u.uSun.value as THREE.Vector2).set(sun.u, sun.v);
    (u.uRadius.value as THREE.Vector2).set(sun.radiusU, sun.radiusV);
    (u.uPixel.value as THREE.Vector2).set(1 / Math.max(1, bufferW), 1 / Math.max(1, bufferH));
    u.uRadiusPx.value = sun.radiusPx;
    u.uActive.value = sun.inFront && sun.gain > 0 ? 1 : 0;
    u.uBlend.value = 1 - Math.exp(-Math.max(0, dtSec) / 0.09);
    renderer.setRenderTarget(this.targets[this.index]);
    this.quad.render(renderer);
  }

  dispose(): void {
    this.targets[0].dispose();
    this.targets[1].dispose();
    this.material.dispose();
    this.quad.dispose();
  }
}
