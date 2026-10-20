/**
 * Pixel-integrated point-spread function.
 *
 * A star's Gaussian core is only ~0.6–0.8 CSS px wide (σ), i.e. undersampled: evaluating it at pixel centres makes
 * the peak pixel swing by ~2× as the star drifts by half a pixel ("sampling twinkle" while the camera moves) and
 * changes its total flux with sub-pixel position. Averaging the Gaussian over each pixel's footprint instead
 * (a box-filtered PSF, separable: a difference of erf in x and in y) conserves the flux exactly at any sub-pixel
 * offset and reduces to the point-sampled Gaussian for large σ.
 *
 * GLSL: `float psfPixelGauss(vec2 d, float sigma, float halfPx)` — mean of exp(−|d|²/2σ²) over the axis-aligned
 * pixel square of half-width `halfPx` centred at offset `d` (all in the same units, e.g. CSS px; halfPx =
 * 0.5 / devicePixelRatio). Multiply by the sampled-Gaussian peak exactly as before.
 */

export const PSF_GLSL = /* glsl */ `
// erf via Winitzki (2008), |error| < 1.3e-4: sign(x)·sqrt(1 − exp(−x²(4/π + a x²)/(1 + a x²))), a = 0.147.
float psfErf(float x) {
  float x2 = x * x;
  float ax2 = 0.147 * x2;
  // max(): approximate GPU exp() may return 1 + ε for tiny x, and sqrt(−ε) is NaN.
  return sign(x) * sqrt(max(1.0 - exp(-x2 * (1.2732395 + ax2) / (1.0 + ax2)), 0.0));
}
float psfPixelGauss1(float x, float sigma, float h) {
  sigma = max(sigma, 1e-3); // σ → 0 would give 0·∞
  float k = 0.70710678 / sigma;
  // σ·sqrt(π/2)/(2h) · [erf((x+h)/(σ√2)) − erf((x−h)/(σ√2))]
  return (0.62665707 * sigma / h) * (psfErf((x + h) * k) - psfErf((x - h) * k));
}
float psfPixelGauss(vec2 d, float sigma, float halfPx) {
  float h = max(halfPx, 1e-3);
  return psfPixelGauss1(d.x, sigma, h) * psfPixelGauss1(d.y, sigma, h);
}
// Padded point sprite for dense 1–3 px dot clouds (asteroids, TNOs): the vertex shader draws gl_PointSize =
// (sizeCss + 2)·dpr (one CSS pixel of padding per side) so the PSF can spread into neighbours. Returns a UNIT-FLUX
// density (per CSS px²): multiply by the dot's flux. Cheap form (one exp): the pixel box filter is folded into the
// Gaussian as extra variance h²/3 (box of width 2h); with σ = 0.35 + 0.15·size the summed flux varies ≤ 3 % with the
// sub-pixel position, so dots no longer pop between 1 and 4 lit pixels (twinkle) as they move.
float psfSprite(vec2 pointCoord, float sizeCss, float sigmaCss, float dpr) {
  vec2 o = (pointCoord - 0.5) * (sizeCss + 2.0);
  float h = 0.5 / dpr;
  float v = sigmaCss * sigmaCss + h * h / 3.0;
  return exp(-dot(o, o) / (2.0 * v)) / (6.2831853 * v);
}
`;

/** Winitzki erf approximation (mirror of the GLSL, for tests). */
export function psfErf(x: number): number {
  const x2 = x * x;
  const ax2 = 0.147 * x2;
  return Math.sign(x) * Math.sqrt(1 - Math.exp((-x2 * (4 / Math.PI + ax2)) / (1 + ax2)));
}

/** Mean of exp(−|d|²/2σ²) over a pixel of half-width h centred at (x, y) (mirror of the GLSL). */
export function psfPixelGauss(x: number, y: number, sigma: number, h: number): number {
  const k = Math.SQRT1_2 / sigma;
  const g = (t: number): number => ((sigma * Math.sqrt(Math.PI / 2)) / (2 * h)) * (psfErf((t + h) * k) - psfErf((t - h) * k));
  return g(x) * g(y);
}

/** Unit-flux padded-sprite density at sprite coordinate (u, v) ∈ [0,1]² (mirror of the GLSL psfSprite). */
export function psfSprite(u: number, v: number, sizeCss: number, sigmaCss: number, dpr: number): number {
  const draw = sizeCss + 2;
  const ox = (u - 0.5) * draw;
  const oy = (v - 0.5) * draw;
  const h = 0.5 / dpr;
  const s2 = sigmaCss * sigmaCss + (h * h) / 3;
  return Math.exp(-(ox * ox + oy * oy) / (2 * s2)) / (2 * Math.PI * s2);
}
