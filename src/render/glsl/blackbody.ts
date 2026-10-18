/**
 * Blackbody colour: effective temperature → linear sRGB (D65 white), valid 1000–40 000 K.
 *
 * Method: the CIE 1931 2° chromaticity (x, y) of a Planck radiator was computed by integrating
 * B_λ(T) against the official CIE 1931 colour-matching functions (CVRL 1 nm table, 360–830 nm) and fitted
 * with rational functions of t = 1000 K / T (numerator degree 4, denominator degree 3; no poles on
 * [0.025, 1]). Max fit error over 1000–40 000 K: |Δx| < 3e-5, |Δy| < 8e-5 — far below a just-noticeable
 * chromaticity difference (~1e-3). xy → XYZ (Y = 1) → linear sRGB with the standard D65 matrix.
 * Out-of-gamut colours (T ≲ 1900 K lies outside sRGB) are pulled toward the neutral axis at constant
 * luminance until no channel is negative.
 *
 * The GLSL and TypeScript implementations are line-for-line equivalent (tests exercise the TS one).
 */
import { COMMON_GLSL } from './common';

/** Valid temperature range of the fit, kelvin. Inputs are clamped to it. */
export const BLACKBODY_MIN_K = 1000;
export const BLACKBODY_MAX_K = 40_000;

const X_NUM = [0.2401226791, -0.06063117508, 2.712905176, -1.734167274, -0.3643054187] as const;
const X_DEN = [-1.257921438, 5.407907967, -3.93365766] as const;
const Y_NUM = [0.2345514789, 0.7022829298, 4.084847633, 0.1058943562, 0.749366009] as const;
const Y_DEN = [1.520423525, 3.64948803, 10.88758296] as const;

/** Linear sRGB (D65) from CIE XYZ, rows R, G, B (Lindbloom, derived from IEC 61966-2-1 primaries). */
const SRGB_FROM_XYZ = [
  3.2404542, -1.5371385, -0.4985314,
  -0.969266, 1.8760108, 0.041556,
  0.0556434, -0.2040259, 1.0572252,
] as const;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** CIE 1931 (x, y) chromaticity of a blackbody at `teffK` (clamped to 1000–40 000 K). */
export function planckianChromaticity(teffK: number, out: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const t = 1000 / Math.min(Math.max(teffK, BLACKBODY_MIN_K), BLACKBODY_MAX_K);
  out.x =
    (X_NUM[0] + t * (X_NUM[1] + t * (X_NUM[2] + t * (X_NUM[3] + t * X_NUM[4])))) /
    (1 + t * (X_DEN[0] + t * (X_DEN[1] + t * X_DEN[2])));
  out.y =
    (Y_NUM[0] + t * (Y_NUM[1] + t * (Y_NUM[2] + t * (Y_NUM[3] + t * Y_NUM[4])))) /
    (1 + t * (Y_DEN[0] + t * (Y_DEN[1] + t * Y_DEN[2])));
  return out;
}

const scratchXy = { x: 0, y: 0 };

/**
 * Linear-sRGB colour of a blackbody normalized to unit luminance (Rec.709 Y = 1). Hot stars therefore
 * have a blue channel > 1: multiply by an intensity to get HDR radiance. Allocation-free with `out`.
 */
export function blackbodyLinearSrgb(teffK: number, out: Rgb = { r: 0, g: 0, b: 0 }): Rgb {
  const { x, y } = planckianChromaticity(teffK, scratchXy);
  const X = x / y;
  const Z = (1 - x - y) / y;
  let r = SRGB_FROM_XYZ[0] * X + SRGB_FROM_XYZ[1] + SRGB_FROM_XYZ[2] * Z;
  let g = SRGB_FROM_XYZ[3] * X + SRGB_FROM_XYZ[4] + SRGB_FROM_XYZ[5] * Z;
  let b = SRGB_FROM_XYZ[6] * X + SRGB_FROM_XYZ[7] + SRGB_FROM_XYZ[8] * Z;
  const m = Math.min(r, g, b);
  if (m < 0) {
    const s = 1 / (1 - m);
    r = 1 + (r - 1) * s;
    g = 1 + (g - 1) * s;
    b = 1 + (b - 1) * s;
  }
  out.r = r;
  out.g = g;
  out.b = b;
  return out;
}

/** Same hue as blackbodyLinearSrgb but scaled so the largest channel is 1 (display "star colour"). */
export function blackbodyChroma(teffK: number, out: Rgb = { r: 0, g: 0, b: 0 }): Rgb {
  blackbodyLinearSrgb(teffK, out);
  const k = 1 / Math.max(out.r, out.g, out.b);
  out.r *= k;
  out.g *= k;
  out.b *= k;
  return out;
}

/**
 * Effective temperature from Johnson B−V colour index (Ballesteros 2012, EPL 97, 34008):
 * T = 4600 K · (1/(0.92·BV + 1.7) + 1/(0.92·BV + 0.62)). Blackbody-based; good to a few percent for
 * main-sequence stars with −0.3 < B−V < 1.8 (Sun: B−V = 0.65 → 5778 K). Returns null for missing input.
 */
export function bvToTeffK(bv: number | null | undefined): number | null {
  if (bv == null || !Number.isFinite(bv)) return null;
  const c = Math.min(Math.max(bv, -0.4), 2.0);
  return 4600 * (1 / (0.92 * c + 1.7) + 1 / (0.92 * c + 0.62));
}

/** GLSL: `vec3 blackbodyLinearSrgb(float teffK)` (unit luminance) and `vec3 blackbodyChroma(float teffK)` (max channel 1). */
export const BLACKBODY_GLSL = /* glsl */ `
${COMMON_GLSL}
#ifndef COSMOS_BLACKBODY
#define COSMOS_BLACKBODY

vec2 planckianChromaticity(float teffK) {
  float t = 1000.0 / clamp(teffK, ${BLACKBODY_MIN_K.toFixed(1)}, ${BLACKBODY_MAX_K.toFixed(1)});
  float x = (${X_NUM[0]} + t * (${X_NUM[1]} + t * (${X_NUM[2]} + t * (${X_NUM[3]} + t * ${X_NUM[4]})))) /
            (1.0 + t * (${X_DEN[0]} + t * (${X_DEN[1]} + t * ${X_DEN[2]})));
  float y = (${Y_NUM[0]} + t * (${Y_NUM[1]} + t * (${Y_NUM[2]} + t * (${Y_NUM[3]} + t * ${Y_NUM[4]})))) /
            (1.0 + t * (${Y_DEN[0]} + t * (${Y_DEN[1]} + t * ${Y_DEN[2]})));
  return vec2(x, y);
}

vec3 blackbodyLinearSrgb(float teffK) {
  vec2 xy = planckianChromaticity(teffK);
  vec3 xyz = vec3(xy.x / xy.y, 1.0, (1.0 - xy.x - xy.y) / xy.y);
  // GLSL matrices are column-major: each vec3 below is one column of SRGB_FROM_XYZ.
  const mat3 SRGB_FROM_XYZ = mat3(
    ${SRGB_FROM_XYZ[0]}, ${SRGB_FROM_XYZ[3]}, ${SRGB_FROM_XYZ[6]},
    ${SRGB_FROM_XYZ[1]}, ${SRGB_FROM_XYZ[4]}, ${SRGB_FROM_XYZ[7]},
    ${SRGB_FROM_XYZ[2]}, ${SRGB_FROM_XYZ[5]}, ${SRGB_FROM_XYZ[8]});
  vec3 rgb = SRGB_FROM_XYZ * xyz;
  float m = min(rgb.r, min(rgb.g, rgb.b));
  if (m < 0.0) rgb = 1.0 + (rgb - 1.0) / (1.0 - m);
  return rgb;
}

vec3 blackbodyChroma(float teffK) {
  vec3 c = blackbodyLinearSrgb(teffK);
  return c / max(c.r, max(c.g, c.b));
}

#endif
`;
