/**
 * Cosmic Ruler landmarks and plain-language comparisons.
 *
 * Every value is the field width (meters) that frames the landmark: a diameter for an object or orbit, a distance
 * for "how far to" landmarks. Values come from src/core/units.ts where a constant exists; the rest cite their
 * source inline.
 */
import {
  AU_M, GPC_M, KPC_M, LUNAR_DISTANCE_M, LY_M, MPC_M, R_EARTH_MEAN_M, R_SUN_M,
} from '../../core/units';

export interface RulerLandmark {
  id: string;
  /** Instrument-voice label on the ruler. */
  label: string;
  /** Field width that frames it, meters. */
  widthM: number;
  /** Entity to focus when clicked (if the registry knows it); otherwise the ruler just sets the scale. */
  entityId?: string;
  /** Noun phrase used in comparisons: "about 3 times <the>". */
  the: string;
  /** Short note for the tooltip. */
  note: string;
}

const GEO_RADIUS_M = 42_164e3; // geostationary orbit radius (IAU / ITU)
const NEPTUNE_A_AU = 30.07; // JPL mean orbital elements
const HELIOPAUSE_AU = 120; // Voyager 1 crossing, 2012 (121.6 AU)
const OORT_OUTER_AU = 1e5; // outer Oort cloud, order of magnitude (Oort 1950; poorly constrained)
const PROXIMA_LY = 4.2465; // Gaia DR3 parallax 768.07 mas
const MILKY_WAY_DISK_KPC = 30; // stellar disk diameter, order of magnitude
const SGR_A_KPC = 8.178; // GRAVITY Collaboration 2019
const M31_KPC = 765; // McConnachie 2012 (≈ 2.5 Mly)
const LOCAL_GROUP_MPC = 3; // diameter, order of magnitude
const VIRGO_MPC = 16.5; // Mei et al. 2007
const LANIAKEA_MPC = 160; // Tully et al. 2014 (≈ 520 Mly)
const OBSERVABLE_RADIUS_GPC = 14.26; // comoving radius, Planck 2018 cosmology

export const RULER_LANDMARKS: readonly RulerLandmark[] = [
  { id: 'earth', label: 'Earth', widthM: 2 * R_EARTH_MEAN_M, entityId: 'sol:earth', the: "Earth's diameter", note: 'Diameter 12,742 km' },
  { id: 'geo', label: 'Geostationary ring', widthM: 2 * GEO_RADIUS_M, the: 'the geostationary ring', note: 'Orbit radius 42,164 km' },
  { id: 'moon-orbit', label: "Moon's orbit", widthM: 2 * LUNAR_DISTANCE_M, entityId: 'sol:moon', the: "the Moon's orbit", note: 'Mean distance 384,399 km' },
  { id: 'sun', label: 'Sun', widthM: 2 * R_SUN_M, entityId: 'sol:sun', the: "the Sun's diameter", note: 'Diameter 1.39 million km' },
  { id: 'earth-orbit', label: "Earth's orbit", widthM: 2 * AU_M, the: "Earth's orbit", note: '1 AU from the Sun' },
  { id: 'neptune-orbit', label: "Neptune's orbit", widthM: 2 * NEPTUNE_A_AU * AU_M, entityId: 'sol:neptune', the: "Neptune's orbit", note: '30.07 AU from the Sun' },
  { id: 'heliopause', label: 'Heliopause', widthM: 2 * HELIOPAUSE_AU * AU_M, the: 'the heliosphere', note: 'About 120 AU; crossed by Voyager 1 in 2012' },
  { id: 'oort', label: 'Oort cloud', widthM: 2 * OORT_OUTER_AU * AU_M, the: 'the Oort cloud', note: 'Outer edge near 100,000 AU (poorly constrained)' },
  { id: 'proxima', label: 'Proxima Centauri', widthM: PROXIMA_LY * LY_M, entityId: 'star:hip:70890', the: 'the distance to Proxima Centauri', note: '4.25 light-years, the nearest star' },
  { id: 'galactic-centre', label: 'Galactic Centre', widthM: SGR_A_KPC * KPC_M, entityId: 'mw:sgr-a*', the: 'the distance to the Galactic Centre', note: '8.18 kpc to Sagittarius A*' },
  { id: 'milky-way', label: 'Milky Way disk', widthM: MILKY_WAY_DISK_KPC * KPC_M, the: 'the Milky Way', note: 'About 100,000 light-years across' },
  { id: 'andromeda', label: 'Andromeda', widthM: M31_KPC * KPC_M, entityId: 'gal:m31', the: 'the distance to Andromeda', note: '2.5 million light-years' },
  { id: 'local-group', label: 'Local Group', widthM: LOCAL_GROUP_MPC * MPC_M, entityId: 'struct:local-group', the: 'the Local Group', note: 'About 3 Mpc across' },
  { id: 'virgo', label: 'Virgo Cluster', widthM: VIRGO_MPC * MPC_M, entityId: 'struct:virgo-cluster', the: 'the distance to the Virgo Cluster', note: '16.5 Mpc away' },
  { id: 'laniakea', label: 'Laniakea', widthM: LANIAKEA_MPC * MPC_M, entityId: 'struct:laniakea', the: 'Laniakea', note: 'Our supercluster, about 520 million light-years across' },
  { id: 'observable', label: 'Observable universe', widthM: 2 * OBSERVABLE_RADIUS_GPC * GPC_M, entityId: 'cosmo:observable-universe', the: 'the observable universe', note: '93 billion light-years across (comoving)' },
];

/** Extra everyday comparisons below the first landmark (comparisons only, not drawn on the ruler). */
export const SMALL_COMPARISONS: ReadonlyArray<{ widthM: number; the: string }> = [
  { widthM: 1.7, the: 'a person' },
  { widthM: 109, the: 'the International Space Station' },
  { widthM: 8_849, the: 'the height of Mount Everest' },
  { widthM: 3_474.8e3, the: "the Moon's diameter" },
];
