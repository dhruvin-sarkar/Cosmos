/**
 * Flat ΛCDM cosmology with radiation: expansion rate, comoving / angular-diameter / luminosity distances,
 * lookback time and age, the inverse redshift(distance), CMB temperature and the particle horizon.
 *
 * Integrals are evaluated in s = √a (a = 1/(1+z)), where every integrand is smooth down to a = 0, with composite
 * Simpson's rule (2048 panels; relative error < 1e-10). Units: SI (m, s, K). H0 is given in km/s/Mpc as is
 * conventional. Invalid z (< 0 or NaN) → NaN.
 */
import { C_M_PER_S, G_SI, JULIAN_YEAR_S, MPC_M, SIGMA_SB } from '../core/units';
import type { ModelInfo } from './models';

export const MODEL_LCDM = 'flat-lcdm@1';

export interface CosmologyParams {
  /** Hubble constant today, km/s/Mpc. */
  h0KmSMpc: number;
  /** Total matter density today (CDM + baryons + massive neutrinos), in units of the critical density. */
  omegaM: number;
  /** CMB temperature today, K. */
  tCmbK: number;
  /** Effective number of relativistic neutrino species (radiation density uses all of it as massless). */
  nEff: number;
  /** Optional label for the UI. */
  name?: string;
}

/**
 * Planck 2018 VI (A&A 641, A6), Table 2, "TT,TE,EE+lowE+lensing+BAO" column: H0 = 67.66 km/s/Mpc,
 * Ωm = 0.3111, age 13.787 ± 0.020 Gyr; T_CMB = 2.7255 K (Fixsen 2009); N_eff = 3.046.
 */
export const PLANCK18: Readonly<CosmologyParams> = Object.freeze({
  h0KmSMpc: 67.66,
  omegaM: 0.3111,
  tCmbK: 2.7255,
  nEff: 3.046,
  name: 'Planck 2018 (TT,TE,EE+lowE+lensing+BAO)',
});

/** Redshift of photon decoupling / last scattering z* (Planck 2018 VI, Table 2). */
export const Z_LAST_SCATTERING = 1089.8;

interface Derived {
  h0S: number; // H0 in 1/s
  hubbleDistanceM: number; // c / H0
  omegaR: number;
  omegaL: number;
}

const derivedCache = new WeakMap<object, Derived>();

/** H0 in SI (1/s) from km/s/Mpc. */
export const h0ToSI = (h0KmSMpc: number): number => (h0KmSMpc * 1000) / MPC_M;

function derive(p: CosmologyParams): Derived {
  let d = derivedCache.get(p);
  if (d) return d;
  const h0S = h0ToSI(p.h0KmSMpc);
  const rhoCrit = (3 * h0S * h0S) / (8 * Math.PI * G_SI); // kg/m³
  const rhoGamma = (4 * SIGMA_SB * p.tCmbK ** 4) / C_M_PER_S ** 3; // kg/m³ (energy density / c²)
  // Each massless neutrino species adds (7/8)(4/11)^(4/3) ≈ 0.2271 of the photon density.
  const omegaR = (rhoGamma / rhoCrit) * (1 + 0.227_107 * p.nEff);
  d = { h0S, hubbleDistanceM: C_M_PER_S / h0S, omegaR, omegaL: 1 - p.omegaM - omegaR };
  derivedCache.set(p, d);
  return d;
}

/** Radiation density parameter Ω_r (photons + massless neutrinos) and dark-energy Ω_Λ = 1 − Ω_m − Ω_r. */
export function densityParameters(p: CosmologyParams = PLANCK18): { omegaM: number; omegaR: number; omegaL: number } {
  const d = derive(p);
  return { omegaM: p.omegaM, omegaR: d.omegaR, omegaL: d.omegaL };
}

/** Dimensionless Hubble rate E(z) = H(z)/H0 = √(Ω_r(1+z)⁴ + Ω_m(1+z)³ + Ω_Λ). */
export function hubbleE(z: number, p: CosmologyParams = PLANCK18): number {
  if (!(z >= 0)) return NaN;
  const d = derive(p);
  const x = 1 + z;
  return Math.sqrt(d.omegaR * x ** 4 + p.omegaM * x ** 3 + d.omegaL);
}

/** H(z) in SI (1/s). */
export function hubbleParameterSI(z: number, p: CosmologyParams = PLANCK18): number {
  return derive(p).h0S * hubbleE(z, p);
}

const SIMPSON_PANELS = 2048;

/** √(a⁴E²) as a function of s = √a: √(Ω_r + Ω_m s² + Ω_Λ s⁸). */
function a2E(s: number, omegaM: number, d: Derived): number {
  const s2 = s * s;
  const s8 = s2 * s2 * s2 * s2;
  return Math.sqrt(d.omegaR + omegaM * s2 + d.omegaL * s8);
}

/**
 * ∫_{s0}^{s1} 2 s^k / √(Ω_r + Ω_m s² + Ω_Λ s⁸) ds by composite Simpson.
 * k = 1 → comoving distance / (c/H0); k = 3 → time × H0.
 */
function integrateS(s0: number, s1: number, k: 1 | 3, p: CosmologyParams): number {
  if (s1 <= s0) return 0;
  const d = derive(p);
  const n = SIMPSON_PANELS;
  const h = (s1 - s0) / n;
  const f = (s: number): number => (2 * (k === 1 ? s : s * s * s)) / a2E(s, p.omegaM, d);
  let sum = f(s0) + f(s1);
  for (let i = 1; i < n; i++) sum += (i % 2 === 1 ? 4 : 2) * f(s0 + i * h);
  return (sum * h) / 3;
}

const sOfZ = (z: number): number => 1 / Math.sqrt(1 + z);

/** Line-of-sight comoving distance χ(z) = (c/H0) ∫₀^z dz′/E(z′), m. */
export function comovingDistanceM(z: number, p: CosmologyParams = PLANCK18): number {
  if (!(z >= 0)) return NaN;
  if (z === Infinity) return particleHorizonComovingM(0, p);
  return derive(p).hubbleDistanceM * integrateS(sOfZ(z), 1, 1, p);
}

/** Angular-diameter distance D_A = χ/(1+z) (flat), m. */
export function angularDiameterDistanceM(z: number, p: CosmologyParams = PLANCK18): number {
  return comovingDistanceM(z, p) / (1 + z);
}

/** Luminosity distance D_L = (1+z) χ (flat), m. */
export function luminosityDistanceM(z: number, p: CosmologyParams = PLANCK18): number {
  return comovingDistanceM(z, p) * (1 + z);
}

/** Distance modulus 5 log10(D_L / 10 pc). */
export function cosmologicalDistanceModulus(z: number, p: CosmologyParams = PLANCK18): number {
  const dl = luminosityDistanceM(z, p);
  return dl > 0 ? 5 * Math.log10(dl / (10 * (MPC_M / 1e6))) : NaN;
}

/** Lookback time t_L(z) = (1/H0) ∫₀^z dz′/((1+z′)E(z′)), s. */
export function lookbackTimeS(z: number, p: CosmologyParams = PLANCK18): number {
  if (!(z >= 0)) return NaN;
  if (z === Infinity) return ageS(0, p);
  return integrateS(sOfZ(z), 1, 3, p) / derive(p).h0S;
}

/** Age of the universe at redshift z (time since the Big Bang), s; ageS(0) is the age today. */
export function ageS(z = 0, p: CosmologyParams = PLANCK18): number {
  if (!(z >= 0)) return NaN;
  if (z === Infinity) return 0;
  return integrateS(0, sOfZ(z), 3, p) / derive(p).h0S;
}

/** Comoving radius of the particle horizon as seen at redshift z (0 = today): (c/H0)∫_{z}^{∞} dz′/E, m. */
export function particleHorizonComovingM(z = 0, p: CosmologyParams = PLANCK18): number {
  if (!(z >= 0)) return NaN;
  return derive(p).hubbleDistanceM * integrateS(0, sOfZ(z), 1, p);
}

/**
 * Inverse of {@link comovingDistanceM}: redshift whose comoving distance is χ, by bisection in ln(1+z)
 * (60 iterations, relative precision ~1e-12). χ ≥ particle horizon → Infinity; χ < 0 → NaN.
 */
export function redshiftFromComovingDistance(chiM: number, p: CosmologyParams = PLANCK18): number {
  if (!(chiM >= 0)) return NaN;
  if (chiM === 0) return 0;
  if (chiM >= particleHorizonComovingM(0, p)) return Infinity;
  let lo = 0;
  let hi = Math.log(1 + 1e8);
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (comovingDistanceM(Math.expm1(mid), p) < chiM) lo = mid;
    else hi = mid;
  }
  return Math.expm1(0.5 * (lo + hi));
}

/** CMB temperature at redshift z: T(z) = T0 (1 + z). */
export function cmbTemperatureK(z: number, p: CosmologyParams = PLANCK18): number {
  return z >= 0 ? p.tCmbK * (1 + z) : NaN;
}

/** Scale factor a = 1/(1+z). */
export const scaleFactor = (z: number): number => (z >= 0 ? 1 / (1 + z) : NaN);

/** Seconds → billions of Julian years (Gyr), for display. */
export const secondsToGyr = (s: number): number => s / (1e9 * JULIAN_YEAR_S);

// ── Model documentation ───────────────────────────────────────────────────────────────────

export const COSMOLOGY_MODELS: readonly ModelInfo[] = [
  {
    id: 'flat-lcdm',
    version: 1,
    title: 'Flat ΛCDM expanding universe',
    summary:
      'The standard model of cosmology: a spatially flat universe of radiation, matter and dark energy whose ' +
      'expansion history sets distances, lookback times and the age of the universe.',
    latex: String.raw`E(z) = \frac{H(z)}{H_0} = \sqrt{\Omega_r(1+z)^{4} + \Omega_m(1+z)^{3} + \Omega_\Lambda}`,
    extraLatex: [
      String.raw`\chi(z) = \frac{c}{H_0}\int_0^{z}\frac{dz'}{E(z')},\quad D_A = \frac{\chi}{1+z},\quad D_L = (1+z)\,\chi`,
      String.raw`t_L(z) = \frac{1}{H_0}\int_0^{z}\frac{dz'}{(1+z')E(z')},\qquad T_{\mathrm{CMB}}(z) = T_0(1+z)`,
      String.raw`\Omega_\Lambda = 1 - \Omega_m - \Omega_r,\quad \Omega_r = \Omega_\gamma\left[1 + \tfrac78\left(\tfrac{4}{11}\right)^{4/3}N_{\mathrm{eff}}\right]`,
    ],
    variables: [
      { symbol: 'H_0', meaning: 'Hubble constant (67.66 km/s/Mpc, Planck 2018)', unit: 'km/s/Mpc' },
      { symbol: String.raw`\Omega_m`, meaning: 'Matter density parameter (0.3111)', unit: '' },
      { symbol: String.raw`\Omega_r`, meaning: 'Radiation density parameter (photons + neutrinos)', unit: '' },
      { symbol: String.raw`\Omega_\Lambda`, meaning: 'Dark-energy density parameter', unit: '' },
      { symbol: 'z', meaning: 'Redshift', unit: '' },
      { symbol: String.raw`\chi`, meaning: 'Comoving distance', unit: 'm' },
      { symbol: 't_L', meaning: 'Lookback time', unit: 's' },
      { symbol: 'T_0', meaning: 'CMB temperature today (2.7255 K)', unit: 'K' },
    ],
    assumptions: [
      'Spatially flat; cosmological constant (w = −1).',
      'All neutrinos treated as radiation in Ω_r; their small rest mass is included in Ω_m instead.',
      'Homogeneous, isotropic universe (FLRW metric).',
    ],
    validity: 'Distances accurate to ~0.1% against full Boltzmann-code cosmologies with these parameters.',
    accuracy: 'Age today 13.79 Gyr, matching Planck 2018 (13.787 ± 0.020 Gyr).',
    kind: 'derived',
    references: [
      { citation: 'Planck Collaboration (2020), Planck 2018 results. VI. Cosmological parameters, A&A 641, A6', doi: '10.1051/0004-6361/201833910' },
      { citation: 'Hogg, D. W. (1999), Distance measures in cosmology, arXiv:astro-ph/9905116' },
      { citation: 'Fixsen, D. J. (2009), The Temperature of the Cosmic Microwave Background, ApJ 707, 916', doi: '10.1088/0004-637X/707/2/916' },
    ],
  },
];
