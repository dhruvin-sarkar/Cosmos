/**
 * Stellar photometry helpers for the star field (pure, unit-tested).
 *
 *  - Display zero point: a star of apparent V magnitude m has integrated display intensity
 *    I = SKY_EXPOSURE · 10^(−0.4 (m − refMag)) (scene-linear × CSS px²; see render-kit PointStarMaterial).
 *    The defaults put the naked-eye limit (m ≈ 6.5) just above the visibility floor after AgX, like a dark site.
 *  - Radius: R/R☉ = √(L/L☉) · (T☉/T)², with L from M_V and the Flower (1996) bolometric correction as
 *    re-fitted by Torres (2010, PASP 122, 1158, Table 1). Derived, not measured.
 */

/** Sun: M_V = 4.83, M_bol = 4.74 (IAU 2015 B2 nominal), Teff = 5772 K. */
export const SUN_ABS_MAG_V = 4.83;
export const SUN_M_BOL = 4.74;
export const SUN_TEFF_K = 5772;

/**
 * Bolometric correction BC_V(Teff), Torres (2010) Table 1 (Flower 1996 polynomials; typo-corrected).
 * Valid ~2 900–50 000 K; clamped outside.
 */
export function bolometricCorrectionV(teffK: number): number {
  const t = Math.log10(Math.min(Math.max(teffK, 2_900), 50_000));
  let c: readonly number[];
  if (t < 3.7) c = [-0.190537291496456e5, 0.155144866764412e5, -0.421278819301717e4, 0.381476328422343e3];
  else if (t < 3.9) c = [-0.370510203809015e5, 0.385672629965804e5, -0.150651486316025e5, 0.261724637119416e4, -0.170623810323864e3];
  else c = [-0.118115450538963e6, 0.137145973583929e6, -0.636233812100225e5, 0.147412923562646e5, -0.170587278406872e4, 0.788731721804990e2];
  let bc = 0;
  for (let k = c.length - 1; k >= 0; k--) bc = bc * t + c[k];
  return bc;
}

/** Bolometric luminosity, L☉, from M_V and Teff (null Teff → BC = 0, i.e. V-band luminosity). */
export function luminosityLsun(absMagV: number, teffK: number | null): number {
  const bc = teffK !== null && teffK > 0 ? bolometricCorrectionV(teffK) : 0;
  return Math.pow(10, -0.4 * (absMagV + bc - SUN_M_BOL));
}

/** Photospheric radius, R☉, from M_V and Teff (Stefan–Boltzmann). Unknown Teff assumes solar. Clamped to [0.005, 2500]. */
export function stellarRadiusRsun(absMagV: number, teffK: number | null): number {
  if (!Number.isFinite(absMagV)) return 1;
  const t = teffK !== null && teffK > 0 ? teffK : SUN_TEFF_K;
  const L = luminosityLsun(absMagV, teffK);
  const r = Math.sqrt(L) * (SUN_TEFF_K / t) ** 2;
  return Math.min(Math.max(r, 0.005), 2500);
}

export function apparentMag(absMag: number, distPc: number): number {
  return absMag + 5 * Math.log10(Math.max(distPc, 1e-12)) - 5;
}

// ── Sky exposure vs view scale ────────────────────────────────────────────────────────────────

export interface SkyExposure {
  /** Magnitude whose integrated intensity equals `exposure`. */
  refMag: number;
  exposure: number;
  limitMag: number;
  limitSoftness: number;
  /** Whole-layer opacity (fades out where the galaxy model takes over). */
  opacity: number;
}

/** Integrated intensity of a magnitude-0 star near the Sun (scene-linear × CSS px²). */
export const SKY_EXPOSURE = 60;
/** Naked-eye dark-site limit used in the Solar neighbourhood. */
export const SKY_LIMIT_MAG = 7.0;

const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Exposure for the current Cosmic Ruler scale (log10 m of field width). Inside ~0.1 pc fields the sky is a dark
 * site (limit ≈ 7). Zooming out to the stellar neighbourhood (1–300 pc fields) the "eye" adapts: the limit deepens
 * to ~11 and faint stars gain up to 2.5 mag so the catalogue reads as a 3-D cloud. Beyond ~1e20 m (the catalogue
 * spans ≤ 1 kpc) the field fades out and the Milky Way model carries the view.
 */
export function skyExposureForScale(scaleLog10: number, out: SkyExposure): SkyExposure {
  const deep = smooth(16.5, 19.3, scaleLog10);
  out.refMag = 2.5 * deep;
  out.exposure = SKY_EXPOSURE;
  out.limitMag = SKY_LIMIT_MAG + 4 * deep;
  out.limitSoftness = 1.2 + 0.8 * deep;
  out.opacity = 1 - smooth(20, 21, scaleLog10);
  return out;
}

/** Integrated intensity of a star (before the near-star compression applied in the shader). */
export function starIntensity(mag: number, e: SkyExposure): number {
  return e.exposure * Math.pow(10, -0.4 * (mag - e.refMag));
}

/** Point stars brighter than this (integrated intensity) hand over to the close-up glare/photosphere. */
export const HANDOVER_START = 600;
export const HANDOVER_END = 2400;
/** Above this intensity point stars are compressed (I0 · √(I/I0)) so a near star never becomes a giant blob. */
export const COMPRESS_START = 100;

export function compressIntensity(i: number): number {
  return i > COMPRESS_START ? COMPRESS_START * Math.sqrt(i / COMPRESS_START) : i;
}
