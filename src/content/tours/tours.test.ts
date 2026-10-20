import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { findAlignmentTime, tourViewDirection, type TourPositionSource } from '../../app/tours';
import { GOLDEN_JOURNEY } from './goldenJourney';
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

  it('view-toward with phaseDeg sets the exact phase angle on the side of the target, even when it is sunward', () => {
    const toSun = new THREE.Vector3(-1, 0, 0);
    for (const t of [0, 1_350_000, 2_700_000]) {
      // t = 0: 'away' line exactly sunward (degenerate); then a quarter and half orbit (line anti-sunward).
      const d = tourViewDirection(
        { type: 'view-toward', anchorId: 'p', towardId: 's', away: true, phaseDeg: 60, distanceM: 1e4 }, t, position, new THREE.Vector3(),
      )!;
      expect(d.length()).toBeCloseTo(1, 9);
      expect(d.angleTo(toSun) / DEG).toBeCloseTo(60, 6);
    }
    // A quarter orbit on, the satellite direction is perpendicular to the Sun line: the camera stays on that side.
    const s = new THREE.Vector3();
    position('s', 1_350_000, s);
    const awayFromS = s.sub(new THREE.Vector3(AU, 0, 0)).negate().normalize();
    const d = tourViewDirection(
      { type: 'view-toward', anchorId: 'p', towardId: 's', away: true, phaseDeg: 60, distanceM: 1e4 }, 1_350_000, position, new THREE.Vector3(),
    )!;
    expect(d.angleTo(awayFromS) / DEG).toBeCloseTo(30, 6);
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

  it('has the golden journey (16-24 chapters) from Earth to the CMB and back home', () => {
    expect(GOLDEN_JOURNEY.id).toBe('golden-journey');
    expect(SOLAR_SYSTEM_TOUR.id).toBe('solar-system');
    expect(GOLDEN_JOURNEY.steps.length).toBeGreaterThanOrEqual(16);
    expect(GOLDEN_JOURNEY.steps.length).toBeLessThanOrEqual(24);
    const ids = GOLDEN_JOURNEY.steps.map(s => s.id);
    expect(ids[0]).toBe('earth');
    expect(ids.at(-1)).toBe('home');
    expect(ids.indexOf('cmb')).toBe(ids.length - 2);
    // The four lab moments.
    const labs = GOLDEN_JOURNEY.steps.flatMap(s => s.actions).flatMap(a => (a.type === 'lab' && a.lab ? [a.lab] : []));
    expect(new Set(labs)).toEqual(new Set(['debris', 'defense', 'habitability', 'relativity']));
    // Every chapter closes the previous chapter's lab.
    expect(GOLDEN_JOURNEY.baseline).toContainEqual({ type: 'lab', lab: null });
  });

  it.each([
    ['solar-system', SOLAR_SYSTEM_TOUR],
    ['golden-journey', GOLDEN_JOURNEY],
  ] as const)('%s: every chapter has a unique id and 2-5 sentences of narration', (_, tour) => {
    const ids = new Set(tour.steps.map(s => s.id));
    expect(ids.size).toBe(tour.steps.length);
    for (const s of tour.steps) {
      const sentences = s.narration.split(/[.!?](?:\s|$)/).filter(x => x.trim().length > 0).length;
      expect(sentences, s.id).toBeGreaterThanOrEqual(2);
      expect(sentences, s.id).toBeLessThanOrEqual(5);
    }
  });
});
