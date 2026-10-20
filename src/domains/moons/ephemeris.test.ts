import * as Astronomy from 'astronomy-engine';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { AU_M } from '../../core/units';
import { MOON_LOOKS, MOON_RECORDS } from './data';
import { meanElementOffset, moonOffset, recordOf, solveKepler, subParentLonLat } from './ephemeris';

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0); // 2026-10-18 12:00 UTC
const DEG = Math.PI / 180;
const angleBetween = (a: Vector3, b: Vector3): number => Math.acos(Math.min(1, Math.max(-1, a.dot(b) / (a.length() * b.length()))));

describe('moons ephemeris', () => {
  it('Galilean positions equal astronomy-engine JupiterMoons (relative to Jupiter, EQJ)', () => {
    const jm = Astronomy.JupiterMoons(Astronomy.MakeTime(new Date(T0)));
    const v = new Vector3();
    for (const id of ['io', 'europa', 'ganymede', 'callisto'] as const) {
      moonOffset(recordOf(id), T0, v);
      const ref = jm[id];
      expect(v.x).toBeCloseTo(ref.x * AU_M, 0);
      expect(v.y).toBeCloseTo(ref.y * AU_M, 0);
      expect(v.z).toBeCloseTo(ref.z * AU_M, 0);
    }
  });

  it('JPL mean elements place the Galileans within a few degrees of the L1.2 theory (as seen from Jupiter)', () => {
    const a = new Vector3(), b = new Vector3();
    for (const id of ['io', 'europa', 'ganymede', 'callisto']) {
      const rec = recordOf(id);
      for (const dt of [0, 400 * 86_400_000, -900 * 86_400_000]) {
        moonOffset(rec, T0 + dt, a);
        meanElementOffset(rec, T0 + dt, b);
        const lim = id === 'io' ? 6 : 8; // mean-vs-true differences (resonance librations, short-period terms) are a few degrees
        expect(angleBetween(a, b) / DEG).toBeLessThan(lim);
        expect(Math.abs(a.length() / b.length() - 1)).toBeLessThan(0.05);
      }
    }
  });

  it('every moon stays between periapsis and apoapsis and advances at the tabulated sidereal rate', () => {
    const v = new Vector3(), w = new Vector3();
    for (const rec of MOON_RECORDS) {
      const o = rec.orbit;
      for (const dt of [0, 123456789, -987654321]) {
        meanElementOffset(rec, T0 + dt, v);
        const r = v.length() / 1000;
        expect(r).toBeGreaterThanOrEqual(o.aKm * (1 - o.e) * 0.9999);
        expect(r).toBeLessThanOrEqual(o.aKm * (1 + o.e) * 1.0001);
      }
      // For near-circular orbits the angle swept in 1/50 of a period equals 2π/50 within ~e.
      const dt = (o.periodDays * 86_400_000) / 50;
      meanElementOffset(rec, T0, v);
      meanElementOffset(rec, T0 + dt, w);
      const swept = angleBetween(v, w);
      if (o.e < 0.05) expect(swept).toBeCloseTo((2 * Math.PI) / 50, 1);
    }
  });

  it('solves Kepler’s equation', () => {
    for (const e of [0, 0.1, 0.5, 0.75, 0.95]) {
      for (const M of [-3, -1, 0.2, 1, 3, 10]) {
        const E = solveKepler(M, e);
        const m = ((M % (2 * Math.PI)) + 3 * Math.PI) % (2 * Math.PI) - Math.PI;
        expect(E - e * Math.sin(E)).toBeCloseTo(m, 9);
      }
    }
  });

  it('reference values: Titan mean distance and Io/Callisto sidereal periods (NASA NSSDCA: 1.769138 d, 16.689018 d)', () => {
    expect(recordOf('titan').orbit.aKm).toBe(1221900);
    expect(recordOf('io').orbit.periodDays).toBeCloseTo(1.769138, 4);
    expect(recordOf('callisto').orbit.periodDays).toBeCloseTo(16.689018, 4);
  });

  it('IAU frames of the mapped moons stay locked to the planet (stable sub-planet longitude over decades)', () => {
    const J2000 = Date.UTC(2000, 0, 1, 12);
    const T1 = Date.UTC(2013, 5, 1);
    // Prime meridian is the sub-planet point for these; the others (Titan, Enceladus) have crater/other definitions but a stable offset.
    const nearZero = new Set(['io', 'europa', 'ganymede', 'callisto', 'triton', 'charon']);
    for (const id of ['io', 'europa', 'ganymede', 'callisto', 'titan', 'enceladus', 'triton', 'charon']) {
      const rec = recordOf(id);
      const a = subParentLonLat(rec, J2000).lonDeg, b = subParentLonLat(rec, T1).lonDeg, c = subParentLonLat(rec, T0).lonDeg;
      const dif = (x: number, y: number): number => Math.abs(((x - y + 540) % 360) - 180);
      expect(dif(a, b), id + ' drift ' + a + ' ' + b).toBeLessThan(8);
      expect(dif(b, c), id + ' drift ' + b + ' ' + c).toBeLessThan(8);
      if (nearZero.has(id)) expect(dif(c, 0), id).toBeLessThan(10);
    }
  });

  it('untextured moons use an exactly tidally locked frame', () => {
    // Moons with a mosaic follow their IAU frame instead (the map longitudes are defined by it).
    const ids = ['phobos', 'mimas', 'tethys', 'rhea', 'ariel', 'titania', 'proteus', 'amalthea', 'iapetus'].filter((id) => !MOON_LOOKS[id]?.texture);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      const s = subParentLonLat(recordOf(id), T0);
      expect(Math.abs(s.lonDeg), id).toBeLessThan(2 * (recordOf(id).orbit.e * 57.3) + 0.5);
      expect(Math.abs(s.latDeg), id).toBeLessThan(2 + recordOf(id).orbit.iDeg);
    }
  });

  // JPL Horizons (SSD API, VECTORS, CENTER=500@699, ICRF, km) at 2026-10-18 12:00 TDB. The JPL SSD mean-element table put
  // Tethys/Dione/Rhea/Iapetus 58-158 deg away from these; the SAT441-fitted elements (data.ts SATURN_MEAN_ELEMENTS) fix it.
  it('Saturnian moons sit near their JPL Horizons positions (2026-10-18)', () => {
    const H: Record<string, [number, number, number]> = {
      enceladus: [-2.348360292876383e5, -3.887079320534974e4, 2.304768678392082e4],
      tethys: [4.261175748916178e4, 2.904538555843362e5, -2.579166352320153e4],
      dione: [6.557890798040564e4, -3.718401112451365e5, 2.162238971910894e4],
      rhea: [5.159428588552371e5, -9.929248267815373e4, -3.509825786187185e4],
      iapetus: [3.352518450396704e6, -4.52219523761395e5, -7.511071380037798e5],
    };
    const v = new Vector3();
    for (const [id, h] of Object.entries(H)) {
      moonOffset(recordOf(id), Date.UTC(2026, 9, 18, 12), v);
      expect((new Vector3(...h).multiplyScalar(1000).angleTo(v) * 180) / Math.PI, id).toBeLessThan(1);
    }
  });
});
