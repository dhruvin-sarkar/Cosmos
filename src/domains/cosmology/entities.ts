/** 'cosmo:observable-universe' and 'cosmo:cmb': the context roots of the focus chain and the CMB sphere. */
import type * as THREE from 'three';
import type { Capability, Entity } from '../../core/entity';
import type { FactSheet, SourceRef } from '../../data/provenance';
import { MPC_M } from '../../core/units';
import { AGE_GYR, CMB_DIPOLE, CMB_ID, LAST_SCATTERING_MPC, OBSERVABLE_ID, PARTICLE_HORIZON_MPC, T_CMB_K } from './constants';

const LY_PER_MPC = 3.2615637771674333e6;
const CAPS: Capability[] = ['focus', 'travel', 'bookmark', 'sources'];

const SRC_COSMO: SourceRef = { datasetId: 'galactic-cosmology-planck2018', reference: 'Planck Collaboration 2020, A&A 641, A6 (Planck 2018 results VI), Table 2' };
const SRC_CMB_MAP: SourceRef = {
  datasetId: 'sky-cmb',
  reference: 'Planck Collaboration 2020, A&A 641, A4 (SMICA, PR3). Credit: ESA, Planck Collaboration. Licence: CC BY-NC 3.0 IGO (Planck Legacy Archive); HiPS by CDS',
  note: 'textures/galaxies/cmb_dT_4k.jpg (scripts/data/galaxies/build-cmb-texture.py)',
};
const SRC_FIXSEN: SourceRef = { datasetId: 'galactic-cosmology-planck2018', reference: 'Fixsen 2009, ApJ 707, 916' };
const SRC_DIPOLE: SourceRef = { datasetId: 'galactic-cosmology-planck2018', reference: 'Planck Collaboration 2020, A&A 641, A1' };

const atOrigin = (_t: number, out: THREE.Vector3): THREE.Vector3 => out.set(0, 0, 0);
const q = (value: number, unit: string, sigDigits: number, source: SourceRef, provenance: 'observed' | 'derived' = 'observed', model?: string) =>
  ({ value, unit, provenance, sigDigits, source, model });
const gly = (mpc: number): string => (mpc * LY_PER_MPC / 1e9).toFixed(1);

export function createCosmologyEntities(): Entity[] {
  const Rh = PARTICLE_HORIZON_MPC * MPC_M;
  const Rls = LAST_SCATTERING_MPC * MPC_M;
  const observable: Entity = {
    id: OBSERVABLE_ID, name: 'Observable universe', aliases: ['Universe', 'Cosmos', 'Particle horizon'], kind: 'reference',
    domain: 'cosmology', parentId: null, radiusM: null, // a horizon, not a solid body: framingRadiusM frames it, the camera may fly inside
    position: atOrigin,
    framingRadiusM: Rh,
    viewDistance: { min: 50 * MPC_M, default: 3.3 * Rh, max: 12 * Rh },
    contextScaleMin: 25.6,
    tagline: 'Everything whose light has had time to reach us: a sphere 92 billion light-years across',
    capabilities: CAPS, importance: 90, representation: 'derived',
    facts: (): FactSheet => ({
      entityId: OBSERVABLE_ID,
      summary: 'The observable universe is the sphere around us from which light has had time to reach Earth since the Big Bang. Because space kept expanding while that light travelled, its edge is now about 46 billion light-years away, although the universe is only 13.8 billion years old.',
      sections: [{
        id: 'properties', title: 'Properties', facts: [
          { key: 'radius', label: 'Radius (comoving particle horizon)', quantity: q(Rh, 'm', 4, SRC_COSMO, 'derived', 'flat-lcdm@1'), provenance: 'derived', source: SRC_COSMO, help: `${gly(PARTICLE_HORIZON_MPC)} billion light-years: today's distance to the farthest matter whose light could, in principle, have reached us.` },
          { key: 'lss', label: 'Distance to the CMB (last scattering)', quantity: q(Rls, 'm', 4, SRC_COSMO, 'derived', 'flat-lcdm@1'), provenance: 'derived', source: SRC_COSMO },
          { key: 'age', label: 'Age of the universe', quantity: q(AGE_GYR * 1e9, 'yr', 5, SRC_COSMO), provenance: 'observed', source: SRC_COSMO, help: '± 0.020 billion years (Planck 2018, ΛCDM).' },
          { key: 'h0', label: 'Hubble constant (H₀)', quantity: q(67.66, 'km/s/Mpc', 4, SRC_COSMO), provenance: 'observed', source: SRC_COSMO, help: 'Planck + BAO value; distance-ladder measurements give about 73 km/s/Mpc (the "Hubble tension").' },
          { key: 'omegaM', label: 'Matter density (Ωm)', quantity: q(0.3111, '', 4, SRC_COSMO), provenance: 'observed', source: SRC_COSMO, help: 'About 5% ordinary matter and 26% dark matter.' },
          { key: 'omegaL', label: 'Dark energy (ΩΛ)', quantity: q(0.6889, '', 4, SRC_COSMO), provenance: 'observed', source: SRC_COSMO },
        ],
      }],
      representation: {
        provenance: 'derived',
        description: 'Distances are comoving (as they are today) from the Planck 2018 flat ΛCDM model. The galaxies inside come from the 2MRS and DESI DR1 redshift surveys, which cover only part of the sky and the nearest few billion light-years; the rest of the volume is left empty rather than invented.',
      },
      sources: [SRC_COSMO],
      assumptions: ['Spatially flat ΛCDM with Planck 2018 parameters.', "Comoving distances (today's separation), not light-travel distances."],
    }),
  };
  const cmb: Entity = {
    id: CMB_ID, name: 'Cosmic microwave background', aliases: ['CMB', 'Last scattering surface', 'Big Bang afterglow'], kind: 'reference',
    domain: 'cosmology', parentId: OBSERVABLE_ID, radiusM: null,
    position: atOrigin,
    framingRadiusM: Rls,
    viewDistance: { min: 50 * MPC_M, default: 3.2 * Rls, max: 12 * Rls },
    contextScaleMin: 25.5,
    tagline: 'The oldest light: released 380 000 years after the Big Bang, mapped by ESA Planck',
    capabilities: CAPS, importance: 88, representation: 'observed',
    facts: (): FactSheet => ({
      entityId: CMB_ID,
      summary: 'The cosmic microwave background is light released when the universe had cooled enough for atoms to form, about 380 000 years after the Big Bang. It reaches us from every direction; its tiny hot and cold spots (a few hundred millionths of a degree) are the seeds of every galaxy and cluster.',
      sections: [{
        id: 'properties', title: 'Properties', facts: [
          { key: 'tcmb', label: 'Temperature today', quantity: q(T_CMB_K, 'K', 6, SRC_FIXSEN), provenance: 'observed', source: SRC_FIXSEN },
          { key: 'z', label: 'Redshift of last scattering', quantity: q(1089.8, '', 5, SRC_COSMO), provenance: 'observed', source: SRC_COSMO },
          { key: 'distance', label: 'Comoving distance', quantity: q(Rls, 'm', 4, SRC_COSMO, 'derived', 'flat-lcdm@1'), provenance: 'derived', source: SRC_COSMO, help: `${gly(LAST_SCATTERING_MPC)} billion light-years today.` },
          { key: 'emitted', label: 'Released after the Big Bang', text: 'about 380 000 years', provenance: 'derived', source: SRC_COSMO },
          { key: 'anisotropy', label: 'Temperature fluctuations', text: 'about ± 100 µK rms (colour scale ± 300 µK)', provenance: 'observed', source: SRC_CMB_MAP },
          { key: 'dipole', label: 'Our motion through it', text: `${CMB_DIPOLE.velocityKmS} km/s toward Galactic (l, b) = (${CMB_DIPOLE.lDeg}°, ${CMB_DIPOLE.bDeg}°): a ${(CMB_DIPOLE.amplitudeUk / 1000).toFixed(2)} mK dipole, removed from this map`, provenance: 'observed', source: SRC_DIPOLE },
        ],
      }],
      representation: {
        provenance: 'observed',
        description: 'The Planck 2018 SMICA temperature map (foreground-cleaned) painted on the last-scattering sphere in its true sky orientation. We can only see this shell from inside; viewed from outside, as here, the map appears mirrored. Colours are a ± 300 µK scale, not the real colour of the light (it is microwave radiation).',
      },
      sources: [SRC_CMB_MAP, SRC_COSMO],
      assumptions: ['The last-scattering surface is drawn as a thin sphere; in reality it is about 19 Mpc (comoving) thick.'],
    }),
  };
  return [observable, cmb];
}
