/**
 * Cosmology domain constants. Distances are the derived values in public/data/galactic/cosmology.json
 * (flat ΛCDM, Planck 2018 TT,TE,EE+lowE+lensing+BAO; Planck Collaboration 2020, A&A 641, A6).
 */
export const OBSERVABLE_ID = 'cosmo:observable-universe';
export const CMB_ID = 'cosmo:cmb';

/** Comoving distance to the last-scattering surface (z* = 1089.8), Mpc (cosmology.json derived, ±21.5). */
export const LAST_SCATTERING_MPC = 13880.21;
/** Comoving particle horizon today, Mpc (cosmology.json derived; 46.19 billion light-years). */
export const PARTICLE_HORIZON_MPC = 14160.68;
/** Age of the universe, Gyr (Planck 2018 Table 2, 13.787 ± 0.020). */
export const AGE_GYR = 13.787;
/** CMB monopole temperature, K (Fixsen 2009, ApJ 707, 916). */
export const T_CMB_K = 2.72548;
/** Solar dipole (Planck 2018 I): amplitude µK, direction (l, b) deg, solar velocity km/s. */
export const CMB_DIPOLE = { amplitudeUk: 3362.08, lDeg: 264.021, bDeg: 48.253, velocityKmS: 369.82 } as const;
