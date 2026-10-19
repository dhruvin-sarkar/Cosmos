/**
 * Sun-detail physics checks.
 *  - Limb darkening: Allen's Astrophysical Quantities (4th ed., Cox 2000, Table 14.17); I(μ=0.5)/I(1) ≈ 0.70 at 0.55 µm
 *    agrees with Neckel & Labs (1994, Sol. Phys. 153, 91) to a few percent.
 *  - Differential rotation: Snodgrass & Ulrich (1990, ApJ 351, 309): 14.713 deg/day sidereal at the equator.
 *  - Orientation: Astronomical Almanac 2026 values for 2026-10-18 — B₀ ≈ +5.6°, P ≈ +25.9° (both computed here from
 *    the IAU 2015 solar pole and astronomy-engine's Earth position; the textbook formula B₀ = asin(sin(θ−Ω) sin 7.25°)
 *    with θ ≈ 205° gives 5.6°).
 *  - AgX display LUT: three.js AgX tone mapping inverted, including saturated AIA 304/171 colours AgX cannot reach
 *    from non-negative input.
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { agxToneMap } from '../../render/tonemap';
import { SOLAR_BODY_BY_ID } from './constants';
import { bodyNorthPole } from './ephemeris';
import { sunImageForBand } from './sunLayer';
import { agxInverseWide } from './sunImagery';
import { baumbachCorona, channelLimbCoefficients, differentialRotationDegPerDay, imageFrame, limbCoefficients, limbIntensity, projectToImage } from './sunPhysics';

const T = Date.parse('2026-10-18T12:00:00Z');
const sun = SOLAR_BODY_BY_ID.get('sol:sun')!;
const lin = (c: number): number => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const enc = (c: number): number => 255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);

describe('limb darkening', () => {
  it('matches Allen / Neckel & Labs centre-to-limb ratios at 0.55 µm', () => {
    const { u2, v2 } = limbCoefficients(0.55);
    expect(limbIntensity(1, u2, v2)).toBeCloseTo(1, 6);
    expect(limbIntensity(0.5, u2, v2)).toBeCloseTo(0.7, 1);
    expect(limbIntensity(0, u2, v2)).toBeCloseTo(0.3, 1);
  });
  it('darkens blue more than red, and IR least', () => {
    const vis = channelLimbCoefficients('visible');
    const ir = channelLimbCoefficients('infrared');
    const at = (c: { u2: number[]; v2: number[] }, i: number): number => limbIntensity(0.3, c.u2[i], c.v2[i]);
    expect(at(vis, 2)).toBeLessThan(at(vis, 0));
    expect(at(ir, 0)).toBeGreaterThan(at(vis, 0));
  });
});

describe('rotation and corona', () => {
  it('Snodgrass & Ulrich rates', () => {
    expect(differentialRotationDegPerDay(0)).toBeCloseTo(14.713, 3);
    // Slower toward the poles: ~13.4 deg/day at 30°, ~ 11.6 at 60°.
    expect(differentialRotationDegPerDay(30 * Math.PI / 180)).toBeCloseTo(14.713 - 2.396 * 0.25 - 1.787 * 0.0625, 6);
    expect(differentialRotationDegPerDay(60 * Math.PI / 180)).toBeLessThan(12);
  });
  it('Baumbach corona is ~1e-6 of the disc near the limb and falls steeply', () => {
    expect(baumbachCorona(1)).toBeCloseTo(4.04e-6, 7);
    expect(baumbachCorona(2) / baumbachCorona(1)).toBeLessThan(0.01);
  });
});

describe('Earth-view image frame', () => {
  const e = Astronomy.HelioVector(Astronomy.Body.Earth, new Date(T));
  const toEarth = new THREE.Vector3(e.x, e.y, e.z).normalize();
  const f = imageFrame(sun.rotation, T, toEarth);
  it('B0 ≈ +5.6° on 2026-10-18', () => {
    expect(f.b0Rad * 180 / Math.PI).toBeCloseTo(5.6, 0);
  });
  it('P angle ≈ +25.9° (solar north tilted east of celestial north)', () => {
    const d = toEarth.clone().negate(); // Earth → Sun
    const z = new THREE.Vector3(0, 0, 1);
    const north = z.clone().addScaledVector(d, -z.dot(d)).normalize();
    const east = new THREE.Vector3().crossVectors(z, d).normalize();
    const pole = bodyNorthPole(sun.rotation, T, new THREE.Vector3());
    const p = Math.atan2(pole.dot(east), pole.dot(north)) * 180 / Math.PI;
    expect(Math.abs(p - 25.9)).toBeLessThan(1);
  });
  it('disc centre projects to the image centre; far side is hidden', () => {
    const c = projectToImage(f, f.e)!;
    expect(Math.hypot(c.x, c.y)).toBeLessThan(1e-9);
    expect(projectToImage(f, f.e.clone().negate())).toBeNull();
    const north = projectToImage(f, new THREE.Vector3(0, 0, 1))!;
    expect(north.y).toBeCloseTo(Math.cos(f.b0Rad), 6);
  });
});

describe('SDO view', () => {
  it('maps spectral bands to AIA channels', () => {
    expect(sunImageForBand('h-alpha')).toBe('aia304');
    expect(sunImageForBand('ultraviolet')).toBe('aia171');
    expect(sunImageForBand('x-ray')).toBe('aia193');
    expect(sunImageForBand('visible')).toBeNull();
  });
  it('wide-gamut AgX inverse reproduces saturated AIA colours within 2/255', () => {
    for (const c of [[200, 50, 0], [235, 110, 12], [230, 170, 30], [255, 225, 160], [241, 233, 209], [60, 10, 0]]) {
      const v = agxInverseWide({ r: lin(c[0]), g: lin(c[1]), b: lin(c[2]) });
      const o = agxToneMap(v);
      [enc(o.r), enc(o.g), enc(o.b)].forEach((x, i) => expect(Math.abs(x - c[i])).toBeLessThan(2));
    }
  });
});
