import { describe, expect, it } from 'vitest';
import { MPC_M } from '../../core/units';
import { comovingDistanceM, particleHorizonComovingM, Z_LAST_SCATTERING } from '../../science/cosmology';
import { discAxes, dot } from '../galaxies/math';
import { deepWebOpacity, localGalaxiesOpacity, nearbyWebOpacity } from '../galaxies/fade';
import { distanceReadout, shellInfo } from './cmbLayer';
import { LAST_SCATTERING_MPC, PARTICLE_HORIZON_MPC } from './constants';
import { createCosmologyEntities } from './entities';

describe('cosmology constants agree with the shared ΛCDM model (Planck 2018)', () => {
  it('last-scattering distance ≈ 13 880 Mpc (cosmology.json derived, ±21.5)', () => {
    expect(comovingDistanceM(Z_LAST_SCATTERING) / MPC_M).toBeCloseTo(LAST_SCATTERING_MPC, -2);
  });
  it('particle horizon ≈ 14 161 Mpc (46.2 billion ly)', () => {
    expect(particleHorizonComovingM() / MPC_M).toBeCloseTo(PARTICLE_HORIZON_MPC, -2);
  });
});

describe('shell readouts', () => {
  it('z = 1: comoving distance ≈ 3.40 Gpc, lookback ≈ 7.9 Gyr (astropy Planck18: 3395 Mpc, 7.93 Gyr)', () => {
    const s = shellInfo(1);
    expect(s.distanceM / MPC_M).toBeGreaterThan(3350);
    expect(s.distanceM / MPC_M).toBeLessThan(3440);
    expect(s.lookbackYr / 1e9).toBeCloseTo(7.93, 1);
    expect(s.label).toContain('z = 1');
  });
  it('last scattering shell uses the catalogued distance', () => {
    expect(shellInfo(Z_LAST_SCATTERING).distanceM).toBeCloseTo(LAST_SCATTERING_MPC * MPC_M, -10);
  });
  it('distance readout inverts the distance–redshift relation', () => {
    expect(distanceReadout(10 * MPC_M)).toBeNull();
    expect(distanceReadout(comovingDistanceM(0.5))).toContain('z = 0.500');
    expect(distanceReadout(PARTICLE_HORIZON_MPC * MPC_M * 1.2)).toContain('beyond the particle horizon');
  });
});

describe('entities', () => {
  it('observable universe is the root and the CMB hangs from it', () => {
    const [obs, cmb] = createCosmologyEntities();
    expect(obs.parentId).toBeNull();
    expect(cmb.parentId).toBe(obs.id);
    expect(cmb.id).toBe('cosmo:cmb');
  });
});

describe('galaxies math and fades', () => {
  it('disc axes: major axis along PA (north through east), normal tilts by the inclination', () => {
    const { a, normal } = discAxes(10.68, 41.27, 38, 77);
    expect(Math.hypot(a.x, a.y, a.z)).toBeCloseTo(1, 9);
    expect(Math.hypot(normal.x, normal.y, normal.z)).toBeCloseTo(1, 9);
    expect(dot(a, normal)).toBeCloseTo(0, 9);
    const ra = 10.68 * Math.PI / 180, de = 41.27 * Math.PI / 180;
    const los = { x: Math.cos(de) * Math.cos(ra), y: Math.cos(de) * Math.sin(ra), z: Math.sin(de) };
    expect(Math.abs(dot(normal, los))).toBeCloseTo(Math.cos(77 * Math.PI / 180), 6);
  });
  it('scale bands: galaxies hidden inside the Milky Way, survey clouds present at 300 Mpc', () => {
    expect(localGalaxiesOpacity(19, 1e18)).toBe(0);
    expect(localGalaxiesOpacity(22.5, 1e22)).toBe(1);
    const s300 = Math.log10(300 * MPC_M);
    expect(nearbyWebOpacity(s300, 300 * MPC_M)).toBeGreaterThan(0.9);
    expect(deepWebOpacity(s300, 300 * MPC_M)).toBeGreaterThan(0.9);
  });
});
