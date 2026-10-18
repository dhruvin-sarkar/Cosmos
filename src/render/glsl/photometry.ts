/**
 * Photometry: magnitudes → relative flux → HDR display intensity.
 *
 * Pogson's relation F/F₀ = 10^(−0.4·(m − m₀)); distance modulus m − M = 5·log10(d / 10 pc).
 * The display zero point is expressed as a reference magnitude: a star of magnitude `refMag` has an
 * integrated (PSF-summed) intensity of `exposure`. Context exposure (bright near the Sun, deep in
 * interstellar space) is applied by moving `refMag` / `exposure`, never by editing catalog values.
 */
import { COMMON_GLSL } from './common';

/** Relative flux of a source of magnitude `mag` with respect to a magnitude-0 source. */
export function magnitudeToFlux(mag: number): number {
  return Math.pow(10, -0.4 * mag);
}

/** Magnitude of a source with the given flux relative to magnitude 0 (inverse of magnitudeToFlux). */
export function fluxToMagnitude(relativeFlux: number): number {
  return -2.5 * Math.log10(relativeFlux);
}

/** Distance modulus 5·log10(d/10 pc) for a distance in parsecs. */
export function distanceModulus(distPc: number): number {
  return 5 * Math.log10(distPc) - 5;
}

/** Apparent magnitude from absolute magnitude and distance (pc). */
export function apparentMagnitude(absMag: number, distPc: number): number {
  return absMag + distanceModulus(distPc);
}

/** Absolute magnitude from apparent magnitude and distance (pc). */
export function absoluteMagnitude(appMag: number, distPc: number): number {
  return appMag - distanceModulus(distPc);
}

/** Integrated HDR intensity of a source of magnitude `mag` for a display zero point `refMag`. */
export function photometricIntensity(mag: number, refMag: number, exposure = 1): number {
  return exposure * Math.pow(10, -0.4 * (mag - refMag));
}

/** 1 for mag ≤ limit − softness, smoothly falling to 0 at the limit (Hermite smoothstep). */
export function magnitudeLimitFade(mag: number, limitMag: number, softnessMag: number): number {
  const t = Math.min(Math.max((mag - (limitMag - softnessMag)) / softnessMag, 0), 1);
  return 1 - t * t * (3 - 2 * t);
}

/**
 * GLSL: magnitudeToFlux, apparentMagnitudeFromLog10Pc, photometricIntensity, magnitudeLimitFade.
 * `apparentMagnitudeFromLog10Pc` takes log10(distance/pc) so callers can add exponents instead of
 * multiplying huge float32 distances (see PointStarMaterial).
 */
export const PHOTOMETRY_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_PHOTOMETRY
#define COSMOS_PHOTOMETRY

float magnitudeToFlux(float mag) { return exp2(-0.4 * LOG2_10 * mag); }

float apparentMagnitudeFromLog10Pc(float absMag, float log10DistPc) { return absMag + 5.0 * log10DistPc - 5.0; }

float photometricIntensity(float mag, float refMag, float exposure) { return exposure * exp2(-0.4 * LOG2_10 * (mag - refMag)); }

float magnitudeLimitFade(float mag, float limitMag, float softnessMag) {
  return 1.0 - smoothstep(limitMag - softnessMag, limitMag, mag);
}

#endif
`;
