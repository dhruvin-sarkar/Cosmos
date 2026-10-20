/** Scale-band fades shared by the galaxies and cosmology layers (pure). */
import { KPC_M, MPC_M } from '../../core/units';

/** Comoving radius of the last-scattering surface (cosmology.json derived; mirrors cosmology/constants.ts). */
const LSS_M = 13880.21 * MPC_M;
/** Surveys fade once the camera leaves the CMB sphere: from outside, the last-scattering surface hides its interior. */
const outsideFade = (camDistM: number): number => 1 - smooth(0.95 * LSS_M, 1.2 * LSS_M, camDistM);

export const smooth = (a: number, b: number, x: number): number => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};

/**
 * Local-volume galaxies (≤ 11 Mpc): in as the view leaves the Milky Way (field ≳ 30 kpc, or the camera ≳ 30 kpc from
 * the Sun), out once the field reaches ~1 Gpc where they are sub-pixel inside the survey clouds.
 */
export function localGalaxiesOpacity(scaleLog10: number, camDistM: number): number {
  const inn = Math.max(smooth(20.5, 21.25, scaleLog10), smooth(20 * KPC_M, 60 * KPC_M, camDistM));
  return inn * (1 - smooth(25.2, 25.9, scaleLog10));
}

/** 2MRS (all-sky, ≤ 0.7 Gpc): from ~10 Mpc fields to beyond the observable universe overview. */
export function nearbyWebOpacity(scaleLog10: number, camDistM: number): number {
  const inn = Math.max(smooth(23.2, 23.9, scaleLog10), smooth(8 * MPC_M, 25 * MPC_M, camDistM));
  return inn * (1 - 0.6 * smooth(26.4, 27.0, scaleLog10)) * outsideFade(camDistM);
}

/** DESI BGS + LRG wedges (to 3.6 Gpc). */
export function deepWebOpacity(scaleLog10: number, camDistM: number): number {
  const inn = Math.max(smooth(23.9, 24.7, scaleLog10), smooth(30 * MPC_M, 90 * MPC_M, camDistM));
  return inn * (1 - 0.5 * smooth(26.5, 27.1, scaleLog10)) * outsideFade(camDistM);
}

/** Structure labels: groups from ~3 Mpc fields, superclusters/voids/walls from ~60 Mpc fields. */
export function structureLabelOpacity(kind: string, scaleLog10: number): number {
  if (kind === 'group') return smooth(22.4, 22.9, scaleLog10) * (1 - smooth(24.6, 25.0, scaleLog10));
  if (kind === 'cluster') return smooth(23.0, 23.5, scaleLog10) * (1 - smooth(25.6, 26.0, scaleLog10));
  return smooth(23.9, 24.4, scaleLog10) * (1 - smooth(26.0, 26.4, scaleLog10));
}
