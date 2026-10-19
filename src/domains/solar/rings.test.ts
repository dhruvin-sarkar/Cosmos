import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { ringPointInPlanetShadow } from './ringMaterial';
import { discVisibleExact, solarDiscVisible } from './shadowGlsl';

describe('planet shadow on the ring plane (oblate Saturn, c/a = 0.902)', () => {
  const c = 54_364 / 60_268;
  const beta = (12 * Math.PI) / 180; // solar elevation above the ring plane
  const s = new THREE.Vector3(Math.cos(beta), 0, Math.sin(beta)); // Sun toward +x, north of the rings
  it('a ring point directly anti-sunward of the planet is shadowed; a sunward one is lit', () => {
    expect(ringPointInPlanetShadow(new THREE.Vector3(-1.8, 0, 0), s, c)).toBe(true);
    expect(ringPointInPlanetShadow(new THREE.Vector3(1.8, 0, 0), s, c)).toBe(false);
  });
  it('the shadow is a cylinder of the planet width projected on the ring plane (narrower than the equator at β = 12°): lit beyond |y| > 1', () => {
    expect(ringPointInPlanetShadow(new THREE.Vector3(-1.8, 0.85, 0), s, c)).toBe(true);
    expect(ringPointInPlanetShadow(new THREE.Vector3(-1.8, 1.05, 0), s, c)).toBe(false);
  });
  it('at low solar elevation the shadow reaches the outer A ring; at high elevation it is short', () => {
    // Shadow length along −x on the ring plane ≈ c / tan β past the limb (oblate polar radius sets it).
    const low = new THREE.Vector3(Math.cos(0.05), 0, Math.sin(0.05));
    expect(ringPointInPlanetShadow(new THREE.Vector3(-2.27, 0, 0), low, c)).toBe(true);
    const high = new THREE.Vector3(Math.cos(1.2), 0, Math.sin(1.2));
    expect(ringPointInPlanetShadow(new THREE.Vector3(-1.6, 0, 0), high, c)).toBe(false);
  });
});

describe('robust solar-disc penumbra', () => {
  const sunR = 4.9e-4; // Sun seen from Saturn (rad)
  it('matches the exact two-circle overlap for a large occluder within 1 %', () => {
    const occR = 20 * sunR;
    for (let h = -0.99; h <= 0.99; h += 0.11) {
      const sep = occR + h * sunR;
      expect(Math.abs(solarDiscVisible(sunR, occR, sep) - discVisibleExact(sunR, occR, sep))).toBeLessThan(0.01);
    }
  });
  it('stays in [0, 1] and monotonic for a planet seen from its rings (occR ≈ 1000 × sunR, float32 inputs)', () => {
    const occR = Math.fround(0.5);
    let prev = -1;
    for (let i = -20; i <= 20; i++) {
      const sep = Math.fround(occR + (i / 10) * sunR);
      const f = solarDiscVisible(sunR, occR, sep);
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(f).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = f;
    }
  });
  it('half the disc is visible when the limb crosses the Sun centre', () => {
    expect(solarDiscVisible(sunR, 0.5, 0.5)).toBeCloseTo(0.5, 6);
  });
});
