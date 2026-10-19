/**
 * Solar ephemeris checks against astronomy-engine (Cross & Engine 2019+, VSOP87 / IAU 2015 rotation as implemented
 * by the library) and the IAU WGCCRE 2015 report (Archinal et al. 2018, CMDA 130:22).
 */
import * as Astronomy from 'astronomy-engine';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AU_M, DEG } from '../../core/units';
import { SOLAR_BODIES, SOLAR_BODY_BY_ID } from './constants';
import { bodyNorthPole, bodyOrientation, bodyPosition, bodyVelocity, rotationElements, solarIrradianceAt, sunDirectionAt } from './ephemeris';

const T = Date.parse('2026-10-18T12:34:56Z');
const v = new THREE.Vector3();

describe('positions', () => {
  for (const def of SOLAR_BODIES.filter((b) => b.aeBody)) {
    it(`${def.name} matches astronomy-engine BaryState (Hermite cache)`, () => {
      const st = Astronomy.BaryState(Astronomy.Body[def.aeBody!], Astronomy.MakeTime(new Date(T)));
      bodyPosition(def, T, v);
      const err = Math.hypot(v.x - st.x * AU_M, v.y - st.y * AU_M, v.z - st.z * AU_M);
      expect(err).toBeLessThan(20_000); // 20 km (≪ any planet radius)
    });
  }

  it('Ceres is in the asteroid belt and near its JPL Horizons position (2026-10-18, heliocentric distance ≈ 2.6–3.0 au)', () => {
    const ceres = SOLAR_BODY_BY_ID.get('sol:ceres')!;
    const sun = new THREE.Vector3();
    bodyPosition(SOLAR_BODY_BY_ID.get('sol:sun')!, T, sun);
    bodyPosition(ceres, T, v);
    const r = v.distanceTo(sun) / AU_M;
    expect(r).toBeGreaterThan(2.5);
    expect(r).toBeLessThan(3.0);
  });

  it('velocity matches a finite difference of the position', () => {
    const jup = SOLAR_BODY_BY_ID.get('sol:jupiter')!;
    const a = new THREE.Vector3(), b = new THREE.Vector3(), vel = new THREE.Vector3();
    bodyPosition(jup, T - 30_000, a);
    bodyPosition(jup, T + 30_000, b);
    bodyVelocity(jup, T, vel);
    const fd = b.sub(a).multiplyScalar(1 / 60);
    expect(fd.distanceTo(vel)).toBeLessThan(0.01 * vel.length());
  });
});

describe('rotation (IAU WGCCRE 2015)', () => {
  it('Earth-free sanity: Jupiter W(J2000) = 284.95°', () => {
    const out = { ra: 0, dec: 0, w: 0 };
    rotationElements(SOLAR_BODY_BY_ID.get('sol:jupiter')!.rotation, Date.UTC(2000, 0, 1, 12) - 69_184, out);
    expect(out.w).toBeCloseTo(284.95, 3);
    expect(out.ra).toBeCloseTo(268.056595, 5);
  });

  for (const name of ['Mercury', 'Venus', 'Mars', 'Jupiter', 'Saturn', 'Uranus', 'Neptune', 'Pluto', 'Sun'] as const) {
    it(`${name} pole and W agree with astronomy-engine RotationAxis`, () => {
      const def = SOLAR_BODIES.find((b) => b.name === name)!;
      const ax = Astronomy.RotationAxis(Astronomy.Body[name], new Date(T));
      const out = { ra: 0, dec: 0, w: 0 };
      rotationElements(def.rotation, T, out);
      const dRa = ((out.ra - ax.ra * 15 + 540) % 360) - 180;
      const tol = 0.05;
      expect(Math.abs(dRa) * Math.cos(out.dec * DEG)).toBeLessThan(tol);
      expect(Math.abs(out.dec - ax.dec)).toBeLessThan(tol);
      const dW = ((((out.w - ax.spin) % 360) + 540) % 360) - 180;
      expect(Math.abs(dW)).toBeLessThan(0.1);
      const pole = bodyNorthPole(def.rotation, T, new THREE.Vector3());
      expect(pole.distanceTo(new THREE.Vector3(ax.north.x, ax.north.y, ax.north.z))).toBeLessThan(1e-3);
    });
  }

  it('orientation quaternion maps local +Z to the pole and local +X to the prime meridian', () => {
    const def = SOLAR_BODY_BY_ID.get('sol:saturn')!;
    const q = bodyOrientation(def.rotation, T, new THREE.Quaternion());
    const z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const pole = bodyNorthPole(def.rotation, T, new THREE.Vector3());
    expect(z.distanceTo(pole)).toBeLessThan(1e-9);
    const out = { ra: 0, dec: 0, w: 0 };
    rotationElements(def.rotation, T, out);
    // Node N at RA = ra + 90°; X is W from N eastward.
    const x = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    const n = new THREE.Vector3(-Math.sin(out.ra * DEG), Math.cos(out.ra * DEG), 0);
    expect(Math.acos(Math.min(1, x.dot(n))) / DEG).toBeCloseTo(Math.min(out.w, 360 - out.w), 6);
  });
});

describe('lighting helpers', () => {
  it('irradiance at Earth is the solar constant within the orbital eccentricity', () => {
    const e = Astronomy.BaryState(Astronomy.Body.Earth, Astronomy.MakeTime(new Date(T)));
    const p = new THREE.Vector3(e.x * AU_M, e.y * AU_M, e.z * AU_M);
    const E = solarIrradianceAt(p, T);
    expect(E).toBeGreaterThan(1361 * 0.96);
    expect(E).toBeLessThan(1361 * 1.04);
    const d = sunDirectionAt(p, T, new THREE.Vector3());
    expect(d.length()).toBeCloseTo(1, 12);
  });
});
