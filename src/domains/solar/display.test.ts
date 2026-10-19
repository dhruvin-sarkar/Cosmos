import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AU_M } from '../../core/units';
import { exhibitionDisplayGain, exposureState } from './ephemeris';
import { createSolarEntities, type SolarEntity } from './entities';

describe('exhibitionDisplayGain', () => {
  it('is 1 at true size and continuous across 1 au', () => {
    exposureState.gain = 1;
    expect(exhibitionDisplayGain(1, 0.39 * AU_M)).toBe(1);
    const below = exhibitionDisplayGain(40, 0.9999 * AU_M);
    const above = exhibitionDisplayGain(40, 1.0001 * AU_M);
    expect(Math.abs(below - above)).toBeLessThan(1e-3);
  });

  it('tames enlarged inner planets in an overview (Venus still brighter than Earth per unit albedo)', () => {
    exposureState.gain = 1;
    const venus = exhibitionDisplayGain(40, 0.723 * AU_M) / 0.723 ** 2;
    const mercury = exhibitionDisplayGain(40, 0.387 * AU_M) / 0.387 ** 2;
    expect(mercury).toBeLessThan(2);
    expect(mercury).toBeGreaterThan(1);
    expect(venus).toBeLessThan(1.2);
    expect(venus).toBeGreaterThan(0.6);
  });
});

describe('preferredViewDir', () => {
  it('points at the New Horizons encounter hemisphere for Pluto only', () => {
    const ents = createSolarEntities({} as never) as SolarEntity[];
    const pluto = ents.find((e) => e.id === 'sol:pluto')!;
    const v = pluto.preferredViewDir(Date.parse('2026-10-18T12:00:00Z'), new THREE.Vector3());
    expect(v).not.toBeNull();
    expect(v!.length()).toBeCloseTo(1, 9);
    const jupiter = ents.find((e) => e.id === 'sol:jupiter')!;
    expect(jupiter.preferredViewDir(0, new THREE.Vector3())).toBeNull();
  });
});
