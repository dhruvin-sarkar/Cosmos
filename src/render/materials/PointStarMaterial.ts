/**
 * Photometric point stars.
 *
 * Each star is a point sprite carrying an apparent (or absolute) magnitude and Teff. Its integrated intensity
 * follows Pogson's law (glsl/photometry.ts); the flux is spread over a fixed-width Gaussian PSF core (the
 * "seeing" disc, σ in CSS px) plus a faint Moffat halo. Bright stars therefore keep the same core width but get
 * a brighter peak and a wider visible footprint, and their HDR peak exceeds the bloom threshold so bloom
 * catches them — exactly how a photographic star field reads. Faint stars stay ≥ the PSF footprint and
 * lose brightness instead of size, which avoids sub-pixel shimmer.
 *
 * Units: intensity is "scene-linear value × CSS px²", so the per-pixel radiance (and the look) is identical
 * at any device pixel ratio; only gl_PointSize is scaled by the DPR.
 *
 * Geometry attributes: `position` (float32; chunk-relative, see ChunkedPointCloud, or unit directions when
 * `atInfinity`), `aMag` (float, magnitude), `aTeff` (float, K; ≤ 0 = unknown → neutral white).
 */
import * as THREE from 'three';
import { FRAGMENT_PRELUDE, LOGDEPTH_FRAGMENT, LOGDEPTH_FRAGMENT_AT_INFINITY, LOGDEPTH_VERTEX, VERTEX_PRELUDE } from '../glsl/logdepth';
import { BLACKBODY_GLSL } from '../glsl/blackbody';
import { PHOTOMETRY_GLSL } from '../glsl/photometry';
import { PC_M } from '../../core/units';
import { PSF_GLSL } from '../glsl/psf';

export interface PointStarMaterialOptions {
  /** 'apparent': aMag is the apparent magnitude. 'absolute': aMag is M and the distance comes from the vertex position. */
  magnitudeMode?: 'apparent' | 'absolute';
  /** Positions are directions (stars at infinity, e.g. a sky backdrop); drawn at the far plane. */
  atInfinity?: boolean;
  /** Magnitude whose integrated intensity equals `exposure`. Default 0. */
  refMag?: number;
  /** Integrated intensity (scene-linear × CSS px²) of a refMag star. Default 20 (mag 6.5 ≈ faintest visible). */
  exposure?: number;
  /** Faintest magnitude drawn; stars fade out over `limitSoftnessMag` before it. Default 8. */
  limitMag?: number;
  limitSoftnessMag?: number;
  /** PSF core σ in CSS px. Default 0.6. */
  psfSigmaPx?: number;
  /** Fraction of the flux in the halo wing. Default 0.06. */
  haloFraction?: number;
  minSizePx?: number;
  maxSizePx?: number;
  /** Colour saturation relative to the true blackbody colour (1 = physical). */
  saturation?: number;
  opacity?: number;
}

export class PointStarMaterial extends THREE.ShaderMaterial {
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
    uParsecsPerUnit: { value: number };
    uSaturation: { value: number };
    uOpacity: { value: number };
  };

  constructor(opts: PointStarMaterialOptions = {}) {
    const defines: Record<string, string> = {};
    if (opts.magnitudeMode === 'absolute') defines.STAR_MAGNITUDE_ABSOLUTE = '';
    if (opts.atInfinity) defines.STAR_AT_INFINITY = '';
    super({
      defines,
      uniforms: {
        uPixelRatio: { value: 1 },
        uRefMag: { value: opts.refMag ?? 0 },
        uExposure: { value: opts.exposure ?? 20 },
        uLimitMag: { value: opts.limitMag ?? 8 },
        uLimitSoftness: { value: opts.limitSoftnessMag ?? 1 },
        uPsfSigma: { value: opts.psfSigmaPx ?? 0.6 },
        uHaloFraction: { value: opts.haloFraction ?? 0.06 },
        uMinSize: { value: opts.minSizePx ?? 4 },
        uMaxSize: { value: opts.maxSizePx ?? 96 },
        uParsecsPerUnit: { value: 1 },
        uSaturation: { value: opts.saturation ?? 1 },
        uOpacity: { value: opts.opacity ?? 1 },
      },
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: true,
    });
  }

  /** Call when the render scale changes (absolute-magnitude mode converts render-space distance to parsecs). */
  setMetersPerUnit(metersPerUnit: number): void {
    this.uniforms.uParsecsPerUnit.value = metersPerUnit / PC_M;
  }

  setPixelRatio(pixelRatio: number): void {
    this.uniforms.uPixelRatio.value = pixelRatio;
  }

  get exposure(): number {
    return this.uniforms.uExposure.value;
  }
  set exposure(v: number) {
    this.uniforms.uExposure.value = v;
  }
  get limitMag(): number {
    return this.uniforms.uLimitMag.value;
  }
  set limitMag(v: number) {
    this.uniforms.uLimitMag.value = v;
  }
}

/** Moffat halo shape parameters (in units of the PSF σ and dimensionless β). */
const HALO_ALPHA_SIGMAS = 4.0;
const HALO_BETA = 2.2;
/** Scene-linear radiance below which the footprint is considered invisible (AgX maps it to < 1/255). */
const VISIBILITY_FLOOR = 0.0015;

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
uniform float uParsecsPerUnit;
uniform float uSaturation;
uniform float uOpacity;

varying vec3 vColor;
varying float vCorePeak;
varying float vHaloPeak;
varying float vRadiusPx;

void main() {
#ifdef STAR_AT_INFINITY
  vec4 mvPosition = vec4(normalize(mat3(modelViewMatrix) * position), 1.0);
#else
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
#endif

  float mag = aMag;
#ifdef STAR_MAGNITUDE_ABSOLUTE
  mag = apparentMagnitudeFromLog10Pc(aMag, log10Safe(length(mvPosition.xyz)) + log10Safe(uParsecsPerUnit));
#endif

  float flux = photometricIntensity(mag, uRefMag, uExposure) * magnitudeLimitFade(mag, uLimitMag, uLimitSoftness) * uOpacity;
  float s2 = uPsfSigma * uPsfSigma;
  vCorePeak = flux * (1.0 - uHaloFraction) / (2.0 * PI * s2);
  float alpha = ${HALO_ALPHA_SIGMAS.toFixed(1)} * uPsfSigma;
  vHaloPeak = flux * uHaloFraction * (${HALO_BETA.toFixed(2)} - 1.0) / (PI * alpha * alpha);

  // Radius at which core and halo drop below the visibility floor.
  float rCore = vCorePeak > ${VISIBILITY_FLOOR} ? uPsfSigma * sqrt(2.0 * log(vCorePeak / ${VISIBILITY_FLOOR})) : 0.0;
  float rHalo = vHaloPeak > ${VISIBILITY_FLOOR} ? alpha * sqrt(pow(vHaloPeak / ${VISIBILITY_FLOOR}, 1.0 / ${HALO_BETA.toFixed(2)}) - 1.0) : 0.0;
  vRadiusPx = clamp(max(rCore, rHalo) + 1.0, 0.5 * uMinSize, 0.5 * uMaxSize);

  vColor = aTeff > 0.0 ? desaturate(blackbodyLinearSrgb(aTeff), uSaturation) : vec3(1.0);

  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = flux > 0.0 ? 2.0 * vRadiusPx * uPixelRatio : 0.0;
#ifdef STAR_AT_INFINITY
  gl_Position.z = gl_Position.w;
#endif
  ${LOGDEPTH_VERTEX}
}
`;

const FRAGMENT_SHADER = /* glsl */ `
${FRAGMENT_PRELUDE}

uniform float uPsfSigma;
uniform float uPixelRatio;
${PSF_GLSL}

varying vec3 vColor;
varying float vCorePeak;
varying float vHaloPeak;
varying float vRadiusPx;

void main() {
  vec2 d = (gl_PointCoord - 0.5) * (2.0 * vRadiusPx);
  float r2 = dot(d, d);
  float r = sqrt(r2);
  if (r > vRadiusPx) discard;
  // Pixel-integrated core: flux-conserving at any sub-pixel offset (no sampling twinkle).
  float core = vCorePeak * psfPixelGauss(d, uPsfSigma, 0.5 / uPixelRatio);
  float alpha = ${HALO_ALPHA_SIGMAS.toFixed(1)} * uPsfSigma;
  float halo = vHaloPeak * pow(1.0 + r2 / (alpha * alpha), -${HALO_BETA.toFixed(2)});
  // Taper the clipped wing to zero at the sprite edge so no square or ring edge shows.
  halo *= 1.0 - smoothstep(0.7 * vRadiusPx, vRadiusPx, r);
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
  ${LOGDEPTH_FRAGMENT}
#ifdef STAR_AT_INFINITY
  ${LOGDEPTH_FRAGMENT_AT_INFINITY}
#endif
}
`;
