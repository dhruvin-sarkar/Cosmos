import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findAlignmentTime, tourViewDirection, type TourPositionSource } from '../../app/tours';
import { QUICK_TOUR } from './quick';
import { SOLAR_SYSTEM_TOUR } from './solarSystem';

const DEG = Math.PI / 180;
const AU = 1.495978707e11;

/** Sun at the origin, planet at 1 AU on +X, a satellite on a 90-minute circular orbit in the ecliptic. */
const position: TourPositionSource = (id, t, out) => {
  if (id === 'sol:sun') return !!out.set(0, 0, 0);
  if (id === 'p') return !!out.set(AU, 0, 0);
  if (id === 's') {
    const a = (2 * Math.PI * t) / 5_400_000;
    // Ecliptic-plane circle expressed in ICRS (rotate about X by the obliquity).
    const eps = 23.4392911 * DEG;
    const y = 7e6 * Math.sin(a);
    return !!out.set(AU + 7e6 * Math.cos(a), y * Math.cos(eps), y * Math.sin(eps));
  }
  return false;
};

describe('tour geometry', () => {
  it('view-phase puts the camera at the requested Sun–body–camera angle', () => {
    const d = tourViewDirection({ type: 'view-phase', anchorId: 'p', distanceM: 1e7, phaseDeg: 60 }, 0, position, new THREE.Vector3())!;
    const toSun = new THREE.Vector3(-1, 0, 0);
    expect(d.angleTo(toSun) / DEG).toBeCloseTo(60, 6);
  });

  it('view-toward with away and sunwardDeg turns the line toward the Sun by at most that angle', () => {
    const d = tourViewDirection(
      { type: 'view-toward', anchorId: 'p', towardId: 's', away: true, sunwardDeg: 30, distanceM: 1e4 }, 0, position, new THREE.Vector3(),
    )!;
    // At t = 0 the satellite is at +X (anti-sunward), so 'away' points at the Sun and the turn is clamped to 0°.
    expect(d.angleTo(new THREE.Vector3(-1, 0, 0)) / DEG).toBeLessThan(1e-6);
  });

  it('findAlignmentTime finds the satellite at the requested angle from the subsolar direction', () => {
    const t = findAlignmentTime('p', 's', 60, 0, 5_400_000, position)!;
    const p = new THREE.Vector3();
    const s = new THREE.Vector3();
    position('p', t, p);
    position('s', t, s);
    expect(Math.abs(s.sub(p).angleTo(new THREE.Vector3(-1, 0, 0)) / DEG - 60)).toBeLessThan(1.5);
  });
});

describe('tour content', () => {
  it('has the grand tour (14-20 chapters) and the six-chapter quick tour', () => {
    expect(SOLAR_SYSTEM_TOUR.steps.length).toBeGreaterThanOrEqual(14);
    expect(SOLAR_SYSTEM_TOUR.steps.length).toBeLessThanOrEqual(20);
    expect(QUICK_TOUR.steps).toHaveLength(6);
  });

  it('every chapter has a unique id and 2-5 sentences of narration', () => {
    const ids = new Set(SOLAR_SYSTEM_TOUR.steps.map(s => s.id));
    expect(ids.size).toBe(SOLAR_SYSTEM_TOUR.steps.length);
    for (const s of SOLAR_SYSTEM_TOUR.steps) {
      const sentences = s.narration.split(/[.!?](?:\s|$)/).filter(x => x.trim().length > 0).length;
      expect(sentences, s.id).toBeGreaterThanOrEqual(2);
      expect(sentences, s.id).toBeLessThanOrEqual(5);
    }
  });
});
