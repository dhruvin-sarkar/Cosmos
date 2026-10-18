// Flat ΛCDM distance/age integrals used for the cosmology finale constants.
// Radiation density: photons from T_CMB plus N_eff = 3.046 effectively massless neutrino species
// (the 0.06 eV Planck-base neutrino is treated as radiation at early times and its small late-time
// matter contribution is already inside the quoted Omega_m). Omega_Lambda = 1 - Omega_m - Omega_r (flat).

export const C_KMS = 299792.458; // exact
export const MPC_M = 3.0856775814913673e22; // IAU 2015 B2 parsec × 1e6
export const LY_M = 9.4607304725808e15; // IAU light-year (Julian year × c), exact
export const MPC_IN_GLY = MPC_M / LY_M / 1e9; // 1 Mpc in Gly
export const GYR_S = 365.25 * 86400 * 1e9;
const KM_PER_MPC = MPC_M / 1000;

/** Omega_gamma h^2 for T_CMB [K]: rho_gamma / rho_crit,100 ; = 2.4728e-5 (T/2.7255)^4 */
export function omegaGammaH2(Tcmb) {
  // a_rad = 4 sigma / c ; rho_gamma c^2 = a T^4 ; rho_crit(h=1) c^2 = 3 (100 km/s/Mpc)^2 c^2 / (8 pi G)
  const sigma = 5.670374419e-8; // W m^-2 K^-4 (CODATA 2018, exact)
  const c = 299792458;
  const G = 6.67430e-11; // CODATA 2018
  const aRad = 4 * sigma / c; // J m^-3 K^-4
  const uGamma = aRad * Tcmb ** 4; // J/m^3
  const H100 = 100 / KM_PER_MPC; // s^-1
  const rhoCritC2 = 3 * H100 ** 2 * c ** 2 / (8 * Math.PI * G); // J/m^3 for h = 1
  return uGamma / rhoCritC2;
}

export function makeModel({ H0, Om, Tcmb = 2.7255, Neff = 3.046 }) {
  const h = H0 / 100;
  const Og = omegaGammaH2(Tcmb) / (h * h);
  const Or = Og * (1 + 0.2271 * Neff); // 7/8 (4/11)^(4/3) = 0.2271
  const OL = 1 - Om - Or;
  const E = (a) => Math.sqrt(Or / a ** 4 + Om / a ** 3 + OL);
  return { H0, h, Om, Or, Og, OL, E, hubbleDistMpc: C_KMS / H0, hubbleTimeGyr: (KM_PER_MPC / H0) / GYR_S };
}

// Composite Simpson on [lo, hi] with n (even) intervals.
function simpson(f, lo, hi, n = 200000) {
  if (n % 2) n++;
  const hstep = (hi - lo) / n;
  let s = f(lo) + f(hi);
  for (let k = 1; k < n; k++) s += f(lo + k * hstep) * (k % 2 ? 4 : 2);
  return (s * hstep) / 3;
}

/** comoving distance [Mpc] from scale factor a1 to a2 (a1 < a2 <= 1). Integrand c/(a^2 H) da, substituted a = s^2 for accuracy at small a. */
export function comovingDistanceMpc(m, aFrom, aTo = 1) {
  // ∫ da / (a^2 E(a)) = ∫ 2 s ds / (s^4 E(s^2)) ; written as 2 ds / (s^3 E) which is finite as s->0: s^3 E ~ s^3 sqrt(Or)/s^4 -> sqrt(Or)/s ... keep form da/(a^2 E) = da / sqrt(Or + Om a + OL a^4)
  const g = (s) => { const a = s * s; return (2 * s) / Math.sqrt(m.Or + m.Om * a + m.OL * a ** 4); };
  return m.hubbleDistMpc * simpson(g, Math.sqrt(aFrom), Math.sqrt(aTo));
}
/** cosmic time [Gyr] from a=0 to a */
export function ageGyr(m, a = 1) {
  const g = (s) => { const x = s * s; return (2 * s) * x / Math.sqrt(m.Or + m.Om * x + m.OL * x ** 4); };
  return m.hubbleTimeGyr * simpson(g, 0, Math.sqrt(a));
}
export function particleHorizonMpc(m) { return comovingDistanceMpc(m, 0, 1); }

/** Deterministic pseudo-random normal generator (mulberry32 + Box-Muller) so outputs are reproducible. */
export function makeRng(seed = 12345) {
  let t = seed >>> 0;
  const u = () => { t += 0x6D2B79F5; let r = Math.imul(t ^ (t >>> 15), 1 | t); r ^= r + Math.imul(r ^ (r >>> 7), 61 | r); return ((r ^ (r >>> 14)) >>> 0) / 4294967296; };
  return () => { const u1 = Math.max(u(), 1e-12), u2 = u(); return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2); };
}
export function meanStd(xs) {
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
  return { mean: m, std: Math.sqrt(v) };
}
