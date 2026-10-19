import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { frameDirToIcrs, icrsToFrameLonLat } from './frames';

const DEG = Math.PI / 180;
const radec = (ra: number, dec: number) =>
  new THREE.Vector3(Math.cos(dec * DEG) * Math.cos(ra * DEG), Math.cos(dec * DEG) * Math.sin(ra * DEG), Math.sin(dec * DEG));

describe('sky frames', () => {
  // Galactic centre (l=0,b=0) at ICRS RA 266.40500°, Dec −28.93617° (Reid & Brunthaler 2004 / Hipparcos definition).
  it('maps the Galactic centre to l=0, b=0', () => {
    const g = icrsToFrameLonLat('galactic', radec(266.405, -28.93617));
    expect(Math.min(g.lonDeg, 360 - g.lonDeg)).toBeLessThan(0.01);
    expect(Math.abs(g.latDeg)).toBeLessThan(0.01);
  });
  // North Galactic Pole: RA 192.85948°, Dec +27.12825° (ICRS, Hipparcos Vol. 1 §1.5.3).
  it('maps the NGP to b=+90', () => {
    expect(icrsToFrameLonLat('galactic', radec(192.85948, 27.12825)).latDeg).toBeGreaterThan(89.99);
  });
  // North ecliptic pole: RA 18h00m, Dec +66.5607° (J2000, ε0 = 23.4392794°).
  it('maps the north ecliptic pole to β=+90', () => {
    expect(icrsToFrameLonLat('ecliptic', radec(270, 90 - 23.4392794)).latDeg).toBeGreaterThan(89.999);
  });
  it('round-trips frame directions', () => {
    const v = frameDirToIcrs('galactic', 123.4, -12.3);
    const g = icrsToFrameLonLat('galactic', v);
    expect(g.lonDeg).toBeCloseTo(123.4, 6);
    expect(g.latDeg).toBeCloseTo(-12.3, 6);
  });
});
