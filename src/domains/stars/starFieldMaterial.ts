/**
 * Catalogue star material: a copy-and-extend of render-kit PointStarMaterial for 3-D star positions.
 *
 * Differences from PointStarMaterial (absolute mode):
 *  - Distances never leave log space: log10(d/pc) = log10(|mv|) + log10(pc per render unit), so the apparent
 *    magnitude is exact from any camera position (the sky changes as you fly).
 *  - Uniform depth compression about the camera (`uDepthScale` ≤ 1): every vertex is drawn at k·mv. A uniform
 *    scale about the eye leaves every projected position unchanged, keeps depth ordering, and keeps 1 kpc stars
 *    inside the camera's far plane even when the render scale is metres.
 *  - Near-star handling: above COMPRESS_START the integrated intensity is compressed (I₀·√(I/I₀)); between the
 *    handover intensities the point fades out while the close-up glare + photosphere (starsLayer) fades in.
 *
 * Units and PSF match PointStarMaterial: intensity = scene-linear × CSS px², Gaussian core σ (CSS px) + Moffat halo.
 * Attributes: position (chunk-local), aMag (absolute V), aTeff (K, ≤ 0 = unknown → neutral white).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../../render/glsl/logdepth';
import { BLACKBODY_GLSL } from '../../render/glsl/blackbody';
import { PHOTOMETRY_GLSL } from '../../render/glsl/photometry';
import { PC_M } from '../../core/units';
import { COMPRESS_START, HANDOVER_END, HANDOVER_START, SKY_EXPOSURE, SKY_LIMIT_MAG, type SkyExposure } from './photometry';

const HALO_ALPHA_SIGMAS = 4.0;
const HALO_BETA = 2.2;
const VISIBILITY_FLOOR = 0.0015;

export class StarFieldMaterial extends THREE.ShaderMaterial {
  declare uniforms: {
    uPixelRatio: { value: number };
    uRefMag: { value: number };
    uExposure: { value: number };
    uLimitMag: { value: number };
    uLimitSoftness: { value: number };
    uPsfSigma: { value: number };
    uHaloFraction: { value: number };
    uMinSize: { value: number };
    uMaxSize: { value: number };
    uLog10PcPerUnit: { value: number };
    uDepthScale: { value: number };
    uSaturation: { value: number };
    uOpacity: { value: number };
    uHandover: { value: THREE.Vector2 };
    uNearFade: { value: number };
  };

  constructor(opts: { nearFade?: boolean; saturation?: number } = {}) {
    super({
      uniforms: {
        uPixelRatio: { value: 1 },
        uRefMag: { value: 0 },
        uExposure: { value: SKY_EXPOSURE },
        uLimitMag: { value: SKY_LIMIT_MAG },
        uLimitSoftness: { value: 1.2 },
        uPsfSigma: { value: 0.8 },
        uHaloFraction: { value: 0.11 },
        uMinSize: { value: 4 },
        uMaxSize: { value: 112 },
        uLog10PcPerUnit: { value: 0 },
        uDepthScale: { value: 1 },
        uSaturation: { value: opts.saturation ?? 0.85 },
        uOpacity: { value: 1 },
        uHandover: { value: new THREE.Vector2(HANDOVER_START, HANDOVER_END) },
        uNearFade: { value: opts.nearFade === false ? 0 : 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }

  setFrame(metersPerUnit: number, pixelRatio: number, depthScale: number, e: SkyExposure): void {
    const u = this.uniforms;
    u.uLog10PcPerUnit.value = Math.log10(metersPerUnit / PC_M);
    u.uPixelRatio.value = pixelRatio;
    u.uDepthScale.value = depthScale;
    u.uRefMag.value = e.refMag;
    u.uExposure.value = e.exposure;
    u.uLimitMag.value = e.limitMag;
    u.uLimitSoftness.value = e.limitSoftness;
  }
}

const VERTEX_SHADER = /* glsl */ `
${VERTEX_PRELUDE}
${BLACKBODY_GLSL}
${PHOTOMETRY_GLSL}

attribute float aMag;
attribute float aTeff;

uniform float uPixelRatio;
uniform float uRefMag;
uniform float uExposure;
uniform float uLimitMag;
uniform float uLimitSoftness;
uniform float uPsfSigma;
uniform float uHaloFraction;
uniform float uMinSize;
uniform float uMaxSize;
uniform float uLog10PcPerUnit;
uniform float uDepthScale;
uniform float uSaturation;
uniform float uOpacity;
uniform vec2 uHandover;
uniform float uNearFade;

varying vec3 vColor;
varying float vCorePeak;
varying float vHaloPeak;
varying float vRadiusPx;

void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  float dist = max(length(mvPosition.xyz), 1e-30);
  float mag = apparentMagnitudeFromLog10Pc(aMag, log2(dist) / LOG2_10 + uLog10PcPerUnit);

  float flux = photometricIntensity(mag, uRefMag, uExposure);
  float near = 1.0 - uNearFade * smoothstep(uHandover.x, uHandover.y, flux);
  flux = flux > ${COMPRESS_START.toFixed(1)} ? ${COMPRESS_START.toFixed(1)} * sqrt(flux / ${COMPRESS_START.toFixed(1)}) : flux;
  flux *= magnitudeLimitFade(mag, uLimitMag, uLimitSoftness) * near * uOpacity;

  float s2 = uPsfSigma * uPsfSigma;
  vCorePeak = flux * (1.0 - uHaloFraction) / (2.0 * PI * s2);
  float alpha = ${HALO_ALPHA_SIGMAS.toFixed(1)} * uPsfSigma;
  vHaloPeak = flux * uHaloFraction * (${HALO_BETA.toFixed(2)} - 1.0) / (PI * alpha * alpha);
  float rCore = vCorePeak > ${VISIBILITY_FLOOR} ? uPsfSigma * sqrt(2.0 * log(vCorePeak / ${VISIBILITY_FLOOR})) : 0.0;
  float rHalo = vHaloPeak > ${VISIBILITY_FLOOR} ? alpha * sqrt(pow(vHaloPeak / ${VISIBILITY_FLOOR}, 1.0 / ${HALO_BETA.toFixed(2)}) - 1.0) : 0.0;
  vRadiusPx = clamp(max(rCore, rHalo) + 1.0, 0.5 * uMinSize, 0.5 * uMaxSize);

  vColor = aTeff > 0.0 ? desaturate(blackbodyLinearSrgb(aTeff), uSaturation) : vec3(1.0);

  gl_Position = projectionMatrix * vec4(mvPosition.xyz * uDepthScale, 1.0);
  gl_PointSize = flux > 1e-4 ? 2.0 * vRadiusPx * uPixelRatio : 0.0;
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}

uniform float uPsfSigma;

varying vec3 vColor;
varying float vCorePeak;
varying float vHaloPeak;
varying float vRadiusPx;

void main() {
  vec2 d = (gl_PointCoord - 0.5) * (2.0 * vRadiusPx);
  float r2 = dot(d, d);
  float r = sqrt(r2);
  if (r > vRadiusPx) discard;
  float core = vCorePeak * exp(-0.5 * r2 / (uPsfSigma * uPsfSigma));
  float alpha = ${HALO_ALPHA_SIGMAS.toFixed(1)} * uPsfSigma;
  float halo = vHaloPeak * pow(1.0 + r2 / (alpha * alpha), -${HALO_BETA.toFixed(2)});
  halo *= 1.0 - smoothstep(0.7 * vRadiusPx, vRadiusPx, r);
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
  ${LOGDEPTH_FRAGMENT}
}
`;
