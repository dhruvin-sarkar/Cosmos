/**
 * Stellar photometry: magnitudes and distances, colour index → temperature, blackbody colour for rendering,
 * and the Stefan–Boltzmann luminosity relation.
 *
 * Units: SI internally (m, K, W); distances in parsecs where the astronomical convention requires it (names say so).
 * Domain errors return NaN; nothing here throws or allocates in the scalar paths.
 */
import { L_SUN_W, PC_M, SIGMA_SB } from '../core/units';
import type { ModelInfo } from './models';

export const MODEL_DISTANCE_MODULUS = 'distance-modulus@1';
export const MODEL_BV_TEFF = 'bv-teff-ballesteros@1';
export const MODEL_BLACKBODY_COLOR = 'blackbody-color@1';
export const MODEL_STEFAN_BOLTZMANN = 'stefan-boltzmann@1';

/**
 * Zero point of the IAU 2015 B2 absolute bolometric magnitude scale: M_bol = 0 ⇔ L = 3.0128×10²⁸ W
 * (so the nominal Sun has M_bol = 4.74).
 */
export const L0_BOLOMETRIC_W = 3.0128e28;

// ── Magnitudes and distances ──────────────────────────────────────────────────────────────

/** Distance modulus μ = m − M = 5 log10(d / 10 pc). */
export function distanceModulus(distancePc: number): number {
  return distancePc > 0 ? 5 * Math.log10(distancePc / 10) : NaN;
}

/** Distance (pc) from a distance modulus: d = 10^(μ/5 + 1). */
export function distanceFromModulusPc(modulus: number): number {
  return Number.isFinite(modulus) ? Math.pow(10, modulus / 5 + 1) : NaN;
}

/** Apparent magnitude m = M + 5 log10(d / 10 pc) (no extinction). */
export function apparentMagnitude(absoluteMagnitude: number, distancePc: number): number {
  return absoluteMagnitude + distanceModulus(distancePc);
}

/** Absolute magnitude M = m − 5 log10(d / 10 pc) (no extinction). */
export function absoluteMagnitude(apparentMag: number, distancePc: number): number {
  return apparentMag - distanceModulus(distancePc);
}

/** Absolute magnitude from a parallax in milliarcseconds (d = 1000/ϖ pc). Non-positive parallax → NaN. */
export function absoluteMagnitudeFromParallax(apparentMag: number, parallaxMas: number): number {
  return parallaxMas > 0 ? absoluteMagnitude(apparentMag, 1000 / parallaxMas) : NaN;
}

/** Flux ratio F1/F2 = 10^(−0.4 (m1 − m2)) (Pogson). */
export function fluxRatio(mag1: number, mag2: number): number {
  return Math.pow(10, -0.4 * (mag1 - mag2));
}

/** Magnitude difference m1 − m2 = −2.5 log10(F1/F2). */
export function magnitudeDifference(fluxRatio12: number): number {
  return fluxRatio12 > 0 ? -2.5 * Math.log10(fluxRatio12) : NaN;
}

/** Absolute bolometric magnitude from luminosity (IAU 2015 B2): M_bol = −2.5 log10(L / L0). */
export function absoluteBolometricMagnitude(luminosityW: number): number {
  return luminosityW > 0 ? -2.5 * Math.log10(luminosityW / L0_BOLOMETRIC_W) : NaN;
}

/** Luminosity (W) from an absolute bolometric magnitude (IAU 2015 B2). */
export function luminosityFromBolometricMagnitudeW(absBolMag: number): number {
  return Number.isFinite(absBolMag) ? L0_BOLOMETRIC_W * Math.pow(10, -0.4 * absBolMag) : NaN;
}

/** Bolometric flux (W/m²) received at distance d from a source of luminosity L: F = L / (4π d²). */
export function fluxAtDistanceWM2(luminosityW: number, distanceM: number): number {
  return distanceM > 0 && luminosityW >= 0 ? luminosityW / (4 * Math.PI * distanceM * distanceM) : NaN;
}

/** Parsec ↔ meters convenience kept here so photometry callers need a single import. */
export const parsecsToMeters = (pc: number): number => pc * PC_M;

// ── Colour index → temperature ────────────────────────────────────────────────────────────

/** Range of B−V over which the Ballesteros formula is used for display (outside: NaN). */
export const BV_TEFF_VALID_RANGE: readonly [number, number] = [-0.4, 2.0];

/**
 * Effective temperature from the Johnson B−V colour index (Ballesteros 2012, EPL 97, 34008):
 *   T = 4600 K · [1/(0.92(B−V) + 1.7) + 1/(0.92(B−V) + 0.62)].
 * Derived by modelling stars as blackbodies; the Sun (B−V = 0.65) gives ≈ 5780 K. Returns NaN outside
 * {@link BV_TEFF_VALID_RANGE} or for non-finite input. Accuracy ~±10% for main-sequence stars (worse for
 * reddened, very hot or very cool stars).
 */
export function bvToTeffK(bMinusV: number): number {
  if (!(bMinusV >= BV_TEFF_VALID_RANGE[0] && bMinusV <= BV_TEFF_VALID_RANGE[1])) return NaN;
  return 4600 * (1 / (0.92 * bMinusV + 1.7) + 1 / (0.92 * bMinusV + 0.62));
}

// ── Blackbody colour ──────────────────────────────────────────────────────────────────────

const H_PLANCK = 6.626_070_15e-34; // J s (exact)
const K_BOLTZMANN = 1.380_649e-23; // J/K (exact)
const C_LIGHT = 299_792_458;
const C2_M_K = (H_PLANCK * C_LIGHT) / K_BOLTZMANN; // second radiation constant, ≈ 1.4388e-2 m K

/** Piecewise Gaussian used by the Wyman–Sloan–Shirley CMF fit. */
function lobe(x: number, mu: number, sigmaLow: number, sigmaHigh: number): number {
  const t = (x - mu) / (x < mu ? sigmaLow : sigmaHigh);
  return Math.exp(-0.5 * t * t);
}

/**
 * CIE 1931 2° colour-matching functions, multi-lobe analytic fit (Wyman, Sloan & Shirley 2013, JCGT 2(2), 1–11).
 * Writes x̄, ȳ, z̄ for wavelength λ (nm) into out[0..2].
 */
export function cie1931Cmf(wavelengthNm: number, out: Float64Array): void {
  const l = wavelengthNm;
  out[0] = 1.056 * lobe(l, 599.8, 37.9, 31.0) + 0.362 * lobe(l, 442.0, 16.0, 26.7) - 0.065 * lobe(l, 501.1, 20.4, 26.2);
  out[1] = 0.821 * lobe(l, 568.8, 46.9, 40.5) + 0.286 * lobe(l, 530.9, 16.3, 31.1);
  out[2] = 1.217 * lobe(l, 437.0, 11.8, 36.0) + 0.681 * lobe(l, 459.0, 26.0, 13.8);
}

/** Planck spectral radiance B_λ(T) up to the constant 2hc² (shape only), λ in meters. */
function planckShape(lambdaM: number, tK: number): number {
  const l5 = lambdaM * lambdaM * lambdaM * lambdaM * lambdaM;
  return 1 / (l5 * Math.expm1(C2_M_K / (lambdaM * tK)));
}

const CMF_SCRATCH = new Float64Array(3);

/**
 * CIE XYZ tristimulus of a blackbody (arbitrary scale, Y normalised to 1). Integration 380–780 nm in 2 nm steps.
 * Writes X, Y, Z into `out` at `offset`.
 */
export function blackbodyXyz(teffK: number, out: Float64Array | number[] = new Float64Array(3), offset = 0): Float64Array | number[] {
  if (!(teffK > 0) || !Number.isFinite(teffK)) {
    out[offset] = out[offset + 1] = out[offset + 2] = NaN;
    return out;
  }
  let X = 0, Y = 0, Z = 0;
  for (let l = 380; l <= 780; l += 2) {
    const b = planckShape(l * 1e-9, teffK);
    cie1931Cmf(l, CMF_SCRATCH);
    X += b * CMF_SCRATCH[0];
    Y += b * CMF_SCRATCH[1];
    Z += b * CMF_SCRATCH[2];
  }
  out[offset] = X / Y;
  out[offset + 1] = 1;
  out[offset + 2] = Z / Y;
  return out;
}

/**
 * Linear-light sRGB (D65, IEC 61966-2-1) chromaticity of a blackbody at temperature T, normalised so that the
 * largest channel is 1 (brightness is the renderer's job). Out-of-gamut negative channels (very hot stars) are
 * clamped to 0 before normalisation. Output is LINEAR — apply the sRGB transfer function (or let three.js do it)
 * before display. Non-positive/NaN T writes NaN.
 */
export function blackbodyLinearSrgb(
  teffK: number,
  out: Float64Array | Float32Array | number[] = new Float64Array(3),
  offset = 0,
): Float64Array | Float32Array | number[] {
  const xyz = XYZ_SCRATCH;
  blackbodyXyz(teffK, xyz, 0);
  const X = xyz[0], Y = xyz[1], Z = xyz[2];
  if (!Number.isFinite(X)) {
    out[offset] = out[offset + 1] = out[offset + 2] = NaN;
    return out;
  }
  const r = Math.max(0, 3.2406255 * X - 1.537208 * Y - 0.4986286 * Z);
  const g = Math.max(0, -0.9689307 * X + 1.8757561 * Y + 0.0415175 * Z);
  const b = Math.max(0, 0.0557101 * X - 0.2040211 * Y + 1.0569959 * Z);
  const m = Math.max(r, g, b);
  out[offset] = r / m;
  out[offset + 1] = g / m;
  out[offset + 2] = b / m;
  return out;
}

const XYZ_SCRATCH = new Float64Array(3);

/** Precomputed blackbody colour table, log-spaced in temperature, for per-frame / per-star lookup. */
export interface BlackbodyColorLut {
  minK: number;
  maxK: number;
  size: number;
  /** size × 3 linear sRGB triplets (max channel = 1). */
  rgb: Float32Array;
}

/** Build a log-spaced blackbody → linear sRGB lookup table (default 1000–40000 K, 256 entries). */
export function createBlackbodyColorLut(minK = 1000, maxK = 40_000, size = 256): BlackbodyColorLut {
  const n = Math.max(2, Math.floor(size));
  const rgb = new Float32Array(n * 3);
  const l0 = Math.log(minK);
  const dl = (Math.log(maxK) - l0) / (n - 1);
  for (let i = 0; i < n; i++) blackbodyLinearSrgb(Math.exp(l0 + i * dl), rgb, 3 * i);
  return { minK, maxK, size: n, rgb };
}

/** Interpolated LUT lookup (temperature clamped to the table range). Writes 3 channels into `out` at `offset`. */
export function sampleBlackbodyColorLut(
  lut: BlackbodyColorLut,
  teffK: number,
  out: Float32Array | Float64Array | number[],
  offset = 0,
): void {
  const t = Number.isFinite(teffK) && teffK > 0 ? Math.min(lut.maxK, Math.max(lut.minK, teffK)) : 5772;
  const f = ((Math.log(t) - Math.log(lut.minK)) / (Math.log(lut.maxK) - Math.log(lut.minK))) * (lut.size - 1);
  const i = Math.min(lut.size - 2, Math.floor(f));
  const w = f - i;
  for (let c = 0; c < 3; c++) out[offset + c] = lut.rgb[3 * i + c] * (1 - w) + lut.rgb[3 * (i + 1) + c] * w;
}

// ── Stefan–Boltzmann ──────────────────────────────────────────────────────────────────────

/** Luminosity of a spherical blackbody: L = 4π R² σ T⁴ (W). */
export function luminosityFromTeffRadiusW(teffK: number, radiusM: number): number {
  if (!(teffK > 0) || !(radiusM > 0)) return NaN;
  return 4 * Math.PI * radiusM * radiusM * SIGMA_SB * teffK ** 4;
}

/** Radius from luminosity and effective temperature: R = sqrt(L / (4π σ T⁴)) (m). */
export function radiusFromLuminosityTeffM(luminosityW: number, teffK: number): number {
  if (!(luminosityW > 0) || !(teffK > 0)) return NaN;
  return Math.sqrt(luminosityW / (4 * Math.PI * SIGMA_SB * teffK ** 4));
}

/** Effective temperature from luminosity and radius: T = (L / (4π R² σ))^¼ (K). */
export function teffFromLuminosityRadiusK(luminosityW: number, radiusM: number): number {
  if (!(luminosityW > 0) || !(radiusM > 0)) return NaN;
  return Math.pow(luminosityW / (4 * Math.PI * radiusM * radiusM * SIGMA_SB), 0.25);
}

/** Luminosity in nominal solar units (L / 3.828×10²⁶ W). */
export const luminosityToSolar = (luminosityW: number): number => luminosityW / L_SUN_W;

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const PHOTOMETRY_MODELS: readonly ModelInfo[] = [
  {
    id: 'distance-modulus',
    version: 1,
    title: 'Distance modulus',
    summary: 'How much fainter a star looks because of its distance: the gap between apparent and absolute magnitude.',
    latex: String.raw`m - M = 5\log_{10}\!\left(\frac{d}{10\,\mathrm{pc}}\right)`,
    extraLatex: [String.raw`\frac{F_1}{F_2} = 10^{-0.4\,(m_1 - m_2)}`],
    variables: [
      { symbol: 'm', meaning: 'Apparent magnitude', unit: '' },
      { symbol: 'M', meaning: 'Absolute magnitude (magnitude at 10 pc)', unit: '' },
      { symbol: 'd', meaning: 'Distance', unit: 'pc' },
      { symbol: 'F', meaning: 'Flux', unit: 'W/m2' },
    ],
    assumptions: ['No interstellar extinction.', 'Inverse-square dilution of light (Euclidean, non-cosmological distances).'],
    validity: 'Galactic distances; for cosmological distances use the luminosity distance.',
    kind: 'derived',
    references: [{ citation: 'Pogson, N. (1856), MNRAS 17, 12', bibcode: '1856MNRAS..17...12P' }],
  },
  {
    id: 'bv-teff-ballesteros',
    version: 1,
    title: 'Colour index → temperature (Ballesteros)',
    summary: 'Estimates a star\'s surface temperature from its B−V colour by treating it as a blackbody.',
    latex: String.raw`T = 4600\,\mathrm{K}\left(\frac{1}{0.92(B-V)+1.7} + \frac{1}{0.92(B-V)+0.62}\right)`,
    variables: [
      { symbol: 'B-V', meaning: 'Johnson colour index', unit: 'mag' },
      { symbol: 'T', meaning: 'Effective temperature', unit: 'K' },
    ],
    assumptions: ['Stellar spectrum approximated by a blackbody.', 'No interstellar reddening.'],
    validity: 'B−V from −0.4 to 2.0 (≈ 2,500–40,000 K); best for main-sequence stars.',
    accuracy: 'Typically within ~10% of spectroscopic temperatures for unreddened main-sequence stars.',
    kind: 'derived',
    references: [
      { citation: 'Ballesteros, F. J. (2012), New insights into black bodies, EPL 97, 34008', doi: '10.1209/0295-5075/97/34008' },
    ],
  },
  {
    id: 'blackbody-color',
    version: 1,
    title: 'Blackbody colour',
    summary: 'The colour a perfect thermal emitter at a given temperature has for the human eye, used to tint stars.',
    latex: String.raw`X = \int B_\lambda(T)\,\bar x(\lambda)\,d\lambda,\quad B_\lambda(T) = \frac{2hc^2}{\lambda^5}\frac{1}{e^{hc/\lambda k T}-1}`,
    extraLatex: [String.raw`\begin{pmatrix}R\\G\\B\end{pmatrix}_{\mathrm{lin}} = M_{\mathrm{sRGB}}\begin{pmatrix}X\\Y\\Z\end{pmatrix}`],
    variables: [
      { symbol: String.raw`B_\lambda`, meaning: 'Planck spectral radiance', unit: 'W/m3/sr' },
      { symbol: String.raw`\bar x, \bar y, \bar z`, meaning: 'CIE 1931 2° colour-matching functions', unit: '' },
      { symbol: 'T', meaning: 'Temperature', unit: 'K' },
    ],
    assumptions: [
      'Pure blackbody spectrum (real stellar spectra have absorption lines).',
      'D65 white point: a ≈ 6500 K blackbody appears white; the Sun appears faintly warm.',
      'Colour only — brightness normalised away; out-of-gamut channels clamped.',
    ],
    validity: 'Any temperature; very hot stars saturate to the sRGB blue-white gamut edge.',
    kind: 'derived',
    references: [
      { citation: 'Wyman, Sloan & Shirley (2013), Simple Analytic Approximations to the CIE XYZ Color Matching Functions, JCGT 2(2), 1–11' },
      { citation: 'IEC 61966-2-1:1999, sRGB colour space' },
    ],
  },
  {
    id: 'stefan-boltzmann',
    version: 1,
    title: 'Stefan–Boltzmann luminosity',
    summary: 'A star\'s total power output from its radius and surface temperature.',
    latex: String.raw`L = 4\pi R^{2}\sigma T_{\mathrm{eff}}^{4}`,
    extraLatex: [String.raw`M_{\mathrm{bol}} = -2.5\log_{10}(L / 3.0128\times10^{28}\,\mathrm{W})`],
    variables: [
      { symbol: 'L', meaning: 'Luminosity', unit: 'W' },
      { symbol: 'R', meaning: 'Stellar radius', unit: 'm' },
      { symbol: String.raw`T_{\mathrm{eff}}`, meaning: 'Effective temperature', unit: 'K' },
      { symbol: String.raw`\sigma`, meaning: 'Stefan–Boltzmann constant', unit: 'W/m2/K4' },
    ],
    assumptions: ['Spherical star; Teff defined as the temperature of the equivalent blackbody.'],
    validity: 'Exact by definition of effective temperature.',
    kind: 'derived',
    references: [{ citation: 'IAU 2015 Resolution B2 (bolometric magnitude scale) and B3 (nominal solar values)' }],
  },
];
