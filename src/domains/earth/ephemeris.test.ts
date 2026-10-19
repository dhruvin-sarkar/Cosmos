/**
 * Earth / Moon orientation checks against astronomy-engine (Cross, "Astronomy Engine", v2; VSOP87 / ELP + IAU 2006
 * precession, IAU 2000B nutation, IAU WGCCRE 2015 rotation elements).
 *
 * Subsolar point: astronomy-engine's apparent equator-of-date Sun (RA, Dec) and Greenwich apparent sidereal time give
 * lat = Dec, lon = RA − GAST. Our point is geometric (no light time, no aberration: both ≈ 20″), so 0.05° tolerance.
 * Sub-Earth point on the Moon: astronomy-engine Libration() (Meeus ch. 53 optical + physical libration) vs. the IAU
 * body-fixed frame (mean-Earth vs. principal-axis frame offsets are < 0.03°) — 0.3° tolerance.
 */
import * as Astronomy from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { evaluate, moonPhase, subEarthPointOnMoon, subsolarPoint } from './ephemeris';
import { solarElevationDeg } from './entities';

const DATES = [
  Date.UTC(2000, 0, 1, 12, 0, 0),
  Date.UTC(2024, 2, 20, 3, 6, 0), // March equinox 2024 (03:06 UT): subsolar latitude ≈ 0
  Date.UTC(2024, 5, 20, 20, 51, 0), // June solstice 2024: subsolar latitude ≈ +23.44
  Date.UTC(2026, 9, 18, 12, 0, 0),
  Date.UTC(2031, 11, 31, 23, 59, 0),
];

function wrap180(d: number): number {
  return ((((d + 180) % 360) + 360) % 360) - 180;
}

describe('earth ephemeris', () => {
  it('subsolar point matches astronomy-engine for several dates', () => {
    const observer = new Astronomy.Observer(0, 0, 0);
    for (const t of DATES) {
      const time = Astronomy.MakeTime(new Date(t));
      const eq = Astronomy.Equator(Astronomy.Body.Sun, time, observer, true, true);
      const gast = Astronomy.SiderealTime(time);
      const ref = { lat: eq.dec, lon: wrap180((eq.ra - gast) * 15) };
      // Topocentric observer at the geocentre-ish (0,0,0 on the surface): parallax of the Sun is 8.8″ — negligible.
      const p = subsolarPoint(t);
      expect(Math.abs(p.latDeg - ref.lat)).toBeLessThan(0.05);
      expect(Math.abs(wrap180(p.lonDeg - ref.lon))).toBeLessThan(0.05);
    }
  });

  it('subsolar latitude at the 2024 equinox and solstice', () => {
    expect(Math.abs(subsolarPoint(DATES[1]!).latDeg)).toBeLessThan(0.02);
    expect(subsolarPoint(DATES[2]!).latDeg).toBeCloseTo(23.44, 1);
  });

  it('sub-Earth point on the Moon matches astronomy-engine libration', () => {
    for (const t of DATES) {
      const lib = Astronomy.Libration(Astronomy.MakeTime(new Date(t)));
      const p = subEarthPointOnMoon(t);
      expect(Math.abs(p.latDeg - lib.elat)).toBeLessThan(0.3);
      expect(Math.abs(wrap180(p.lonDeg - lib.elon))).toBeLessThan(0.3);
    }
  });

  it('Moon illuminated fraction matches astronomy-engine', () => {
    for (const t of DATES) {
      const ill = Astronomy.Illumination(Astronomy.Body.Moon, Astronomy.MakeTime(new Date(t)));
      expect(moonPhase(t).illuminatedFraction).toBeCloseTo(ill.phase_fraction, 2);
    }
  });

  it('solar elevation from the sub-solar point', () => {
    expect(solarElevationDeg(0, 0, 0, 0)).toBeCloseTo(90, 9);
    expect(solarElevationDeg(0, 0, 0, 90)).toBeCloseTo(0, 9);
    expect(solarElevationDeg(0, 0, 0, 180)).toBeCloseTo(-90, 9);
    // June solstice noon at the Tropic of Cancer; 66.56° N sees the Sun at 0° at midnight (polar day edge).
    expect(solarElevationDeg(23.44, 10, 23.44, 10)).toBeCloseTo(90, 6);
    expect(solarElevationDeg(23.44, 10, 66.56, -170)).toBeCloseTo(0, 6);
  });

  it('Moon sits at the astronomy-engine geocentric distance', () => {
    const t = DATES[3]!;
    const s = evaluate(t);
    const g = Astronomy.GeoMoon(Astronomy.MakeTime(new Date(t)));
    const ref = Math.hypot(g.x, g.y, g.z) * 149_597_870_700;
    expect(Math.abs(s.moon.distanceTo(s.earth) - ref)).toBeLessThan(1);
  });
});
