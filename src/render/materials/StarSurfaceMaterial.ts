/**
 * Stellar photosphere for close-ups (the Sun, or any star given Teff).
 *
 *  - Colour: blackbody(Teff) in linear sRGB at unit luminance × HDR intensity (feeds bloom).
 *  - Limb darkening: quadratic law I(μ)/I(1) = 1 − u₁(1 − μ) − u₂(1 − μ)², per channel. Defaults are fits for
 *    the Sun at ≈ 650/550/450 nm reproducing the observed centre-to-limb ratios (≈ 0.40/0.30/0.20 at the limb;
 *    Pierce & Slaughter 1977, Solar Phys. 51, 25; Neckel & Labs 1994, Solar Phys. 153, 91). The limb is
 *    therefore darker and redder than the centre, as in white-light images.
 *  - Granulation: animated Worley cells (bright granule centres, dark intergranular lanes) at the real scale
 *    (~1.3 Mm cells on the Sun → ~3 400 across a great circle), modulated by mesogranulation; every noise band is
 *    faded out once its cells shrink below ~2 px using screen-space derivatives, so a distant star shows a clean,
 *    shimmer-free disc. Contrast ≈ 15 % rms (observed white-light granulation contrast is 13–20 %).
 *
 * Use on a sphere mesh of the star's radius; vNormal/vView are computed in view space.
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { BLACKBODY_GLSL } from '../glsl/blackbody';
import { NOISE_GLSL } from '../glsl/noise';
import { T_SUN_EFF_K } from '../../core/units';

/** Solar quadratic limb-darkening coefficients (u₁ per R, G, B; u₂ per R, G, B). */
export const SUN_LIMB_DARKENING = {
  u1: [0.42, 0.5, 0.58] as [number, number, number],
  u2: [0.18, 0.2, 0.22] as [number, number, number],
};

/** Quadratic limb-darkening law I(μ)/I(1) (TS mirror). */
export function limbDarkening(mu: number, u1: number, u2: number): number {
  const x = 1 - Math.max(0, Math.min(1, mu));
  return 1 - u1 * x - u2 * x * x;
}

export interface StarSurfaceOptions {
  teffK?: number;
  /** HDR multiplier at disc centre. */
  intensity?: number;
  /** Granules across the star's circumference (Sun ≈ 3400). */
  granuleCount?: number;
  /** Granulation contrast 0–1. */
  granulationContrast?: number;
  limbU1?: [number, number, number];
  limbU2?: [number, number, number];
}

export class StarSurfaceMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uTeff: { value: number };
    uIntensity: { value: number };
    uGranuleScale: { value: number };
    uContrast: { value: number };
    uTime: { value: number };
    uU1: { value: THREE.Vector3 };
    uU2: { value: THREE.Vector3 };
  };

  constructor(opts: StarSurfaceOptions = {}) {
    super({
      uniforms: {
        uTeff: { value: opts.teffK ?? T_SUN_EFF_K },
        uIntensity: { value: opts.intensity ?? 12 },
        // Worley cell size 1 ⇒ circumference 2π in sphere units holds granuleCount cells.
        uGranuleScale: { value: (opts.granuleCount ?? 3400) / (2 * Math.PI) },
        uContrast: { value: opts.granulationContrast ?? 0.15 },
        uTime: { value: 0 },
        uU1: { value: new THREE.Vector3(...(opts.limbU1 ?? SUN_LIMB_DARKENING.u1)) },
        uU2: { value: new THREE.Vector3(...(opts.limbU2 ?? SUN_LIMB_DARKENING.u2)) },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });
  }

  /** Simulation seconds; granules evolve on their real ~8–20 min lifetime. */
  setTime(seconds: number): void {
    // Wrap to keep float32 phase precise; the cell motion has no long-period structure that would reveal it.
    this.uniforms.uTime.value = seconds % 86_400;
  }

  set teffK(t: number) {
    this.uniforms.uTeff.value = t;
  }
  set intensity(v: number) {
    this.uniforms.uIntensity.value = v;
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
uniform float uGranuleScale;
uniform float uContrast;
uniform float uTime;
uniform vec3 uU1;
uniform vec3 uU2;
varying vec3 vNormalView;
varying vec3 vViewPos;
varying vec3 vObjPos;

// Granule pattern in [−1, 1] at a given cell scale, faded by its on-screen cell size.
float granules(vec3 p, float scale, float phase) {
  vec3 q = p * scale;
  float cellPx = 1.0 / max(length(fwidth(q)), 1e-6);
  float vis = smoothstep(1.5, 4.0, cellPx);
  if (vis <= 0.0) return 0.0;
  vec2 f = cellularNoise3Animated(q, phase);
  // Bright, domed granule centres; narrow dark lanes where F2 − F1 → 0.
  float lane = smoothstep(0.0, 0.18, f.y - f.x);
  float dome = 1.0 - f.x * f.x;
  return vis * (lane * (0.55 + 0.45 * dome) * 2.0 - 1.0);
}

void main() {
  vec3 n = normalize(vNormalView);
  vec3 v = normalize(-vViewPos);
  float mu = clamp(dot(n, v), 0.0, 1.0);
  float x = 1.0 - mu;
  vec3 limb = max(1.0 - uU1 * x - uU2 * x * x, 0.0);

  // Granule lifetime ~10 min: phase advances 2π per ~600 s.
  float phase = uTime * (PI2 / 600.0);
  float g = granules(vObjPos, uGranuleScale, phase);
  // Mesogranulation / supergranular network: broad, low-contrast brightness modulation.
  float qMeso = uGranuleScale * 0.12;
  float mesoVis = smoothstep(1.5, 4.0, 1.0 / max(length(fwidth(vObjPos * qMeso)), 1e-6));
  float meso = mesoVis * fbm3(vObjPos * qMeso + vec3(0.0, 0.0, uTime * 1e-5), 3);
  // Granulation contrast falls toward the limb (corrugation is seen edge-on).
  float contrast = uContrast * (0.35 + 0.65 * mu);
  float mod1 = 1.0 + contrast * g + 0.04 * meso;

  vec3 color = blackbodyLinearSrgb(uTeff) * uIntensity * limb * mod1;
  gl_FragColor = vec4(color, 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
