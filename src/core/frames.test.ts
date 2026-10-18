import { describe, expect, it } from 'vitest';
import { GeoMoon, MakeTime } from 'astronomy-engine';
import {
  ECLIPTIC_NORTH_POLE_ICRS, GALACTIC_CENTER_DIRECTION_ICRS, GALACTIC_NORTH_POLE_ICRS, GALACTIC_TO_SUPERGALACTIC,
  ICRS_TO_GALACTIC, OBLIQUITY_J2000_DEG, WGS84_A_M, WGS84_B_M,
  applyMat3, applyMat3Transposed, bodyFixedToIcrs, bodyFixedToIcrsForBody, bodyFixedToIcrsMatrix, bodyPoleIcrs,
  bodyRotationElements, earthRotationAngleRad, ecefToGeodetic, ecefToIcrs, ecefToIcrsMatrix, eclipticToIcrs,
  equationOfEquinoxesRad, galacticToIcrs, galacticToSupergalactic, gastRad, geodeticToEcef, gmstRad, icrsToEcef,
  icrsToEcliptic, icrsToGalactic, icrsToRaDec, multiplyMat3, raDecDistToIcrs, sphericalToVector,
  supergalacticToGalactic, temeToIcrs, temeToIcrsMatrix, transposeMat3, utDaysSinceJ2000, type Mat3, type Vec3,
} from './frames';
import { AU_M, DEG, RAD } from './units';

const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
const J2000_MS = Date.UTC(2000, 0, 1, 12);
const ARCSEC_DEG = 1 / 3600;

function angleDeg(a: Vec3, b: Vec3): number {
  const dot = a.x * b.x + a.y * b.y + a.z * b.z;
  const c = dot / (Math.hypot(a.x, a.y, a.z) * Math.hypot(b.x, b.y, b.z));
  return Math.acos(Math.min(1, Math.max(-1, c))) * RAD;
}

/** Signed difference of two angles in degrees, wrapped into (−180, 180]. */
function wrapDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

function expectOrthonormal(m: Mat3): void {
  const prod = multiplyMat3(m, transposeMat3(m));
  for (let i = 0; i < 9; i++) expect(prod[i]).toBeCloseTo(i % 4 === 0 ? 1 : 0, 12);
  const det =
    m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
  expect(det).toBeCloseTo(1, 12);
}

function galacticOf(raDeg: number, decDeg: number): { l: number; b: number } {
  const g = icrsToRaDec(icrsToGalactic(raDecDistToIcrs(raDeg, decDeg, 1, v()), v()));
  return { l: g.raDeg, b: g.decDeg };
}

describe('spherical ↔ Cartesian', () => {
  it('maps the equinox, the pole and RA = 90° to the ICRS axes', () => {
    const x = raDecDistToIcrs(0, 0, 2, v());
    expect(x.x).toBeCloseTo(2, 14);
    expect(x.y).toBeCloseTo(0, 14);
    const y = raDecDistToIcrs(90, 0, 1, v());
    expect(y.y).toBeCloseTo(1, 14);
    const z = raDecDistToIcrs(123, 90, 5, v());
    expect(z.z).toBeCloseTo(5, 14);
  });

  it('round-trips RA/Dec/distance (including RA wrap into [0, 360))', () => {
    for (const [ra, dec, d] of [[0, 0, 1], [359.9, -45, AU_M], [180, 89.5, 3.1e16], [271.25, -88.1, 7], [12.5, 33.3, 1e26]]) {
      const back = icrsToRaDec(raDecDistToIcrs(ra, dec, d, v()));
      expect(wrapDiffDeg(back.raDeg, ra)).toBeCloseTo(0, 9);
      expect(back.decDeg).toBeCloseTo(dec, 9);
      expect(back.distM / d).toBeCloseTo(1, 12);
      expect(back.raDeg).toBeGreaterThanOrEqual(0);
      expect(back.raDeg).toBeLessThan(360);
    }
  });

  it('returns RA = Dec = 0 for the zero vector instead of NaN', () => {
    const r = icrsToRaDec(v());
    expect(r).toEqual({ raDeg: 0, decDeg: 0, distM: 0 });
  });

  it('allows out to alias the input', () => {
    const p = v(1, 2, 3);
    applyMat3(ICRS_TO_GALACTIC, p, p);
    applyMat3Transposed(ICRS_TO_GALACTIC, p, p);
    expect(p.x).toBeCloseTo(1, 12);
    expect(p.y).toBeCloseTo(2, 12);
    expect(p.z).toBeCloseTo(3, 12);
  });
});

describe('ecliptic J2000', () => {
  it('uses ε₀ = 23.4392911° and puts the north ecliptic pole at RA 270°, Dec 66.5607°', () => {
    expect(OBLIQUITY_J2000_DEG).toBe(23.4392911);
    const pole = icrsToRaDec(ECLIPTIC_NORTH_POLE_ICRS);
    expect(pole.raDeg).toBeCloseTo(270, 9);
    expect(pole.decDeg).toBeCloseTo(90 - 23.4392911, 9);
    const fromEcl = eclipticToIcrs(v(0, 0, 1), v());
    expect(angleDeg(fromEcl, ECLIPTIC_NORTH_POLE_ICRS)).toBeLessThan(1e-9);
  });

  it('leaves the vernal equinox fixed and maps ecliptic longitude 90° above the equator', () => {
    const eq = eclipticToIcrs(v(1, 0, 0), v());
    expect(eq.x).toBeCloseTo(1, 14);
    const l90 = icrsToRaDec(eclipticToIcrs(v(0, 1, 0), v()));
    expect(l90.raDeg).toBeCloseTo(90, 9);
    expect(l90.decDeg).toBeCloseTo(23.4392911, 9);
  });

  it('round-trips', () => {
    const p = v(1.2e11, -3.4e10, 5.6e9);
    const back = eclipticToIcrs(icrsToEcliptic(p, v()), v());
    expect(back.x / p.x).toBeCloseTo(1, 12);
    expect(back.y / p.y).toBeCloseTo(1, 12);
    expect(back.z / p.z).toBeCloseTo(1, 12);
  });
});

describe('galactic (Hipparcos 1997 definition)', () => {
  it('is a proper rotation', () => {
    expectOrthonormal(ICRS_TO_GALACTIC);
  });

  it('sends the Galactic Center (RA 266.40500°, Dec −28.93617°) to l = b = 0', () => {
    const gc = galacticOf(266.405, -28.936175);
    expect(Math.abs(wrapDiffDeg(gc.l, 0))).toBeLessThan(2e-5);
    expect(Math.abs(gc.b)).toBeLessThan(2e-5);
    const dir = icrsToRaDec(GALACTIC_CENTER_DIRECTION_ICRS);
    expect(dir.raDeg).toBeCloseTo(266.405, 4);
    expect(dir.decDeg).toBeCloseTo(-28.936175, 4);
  });

  it('puts the north galactic pole at RA 192.85948°, Dec +27.12825°', () => {
    const ngp = icrsToRaDec(GALACTIC_NORTH_POLE_ICRS);
    expect(ngp.raDeg).toBeCloseTo(192.85948, 4);
    expect(ngp.decDeg).toBeCloseTo(27.12825, 4);
    expect(galacticOf(192.85948, 27.12825).b).toBeCloseTo(90, 4);
  });

  it('matches SIMBAD galactic coordinates of bright stars (±0.001°)', () => {
    const sirius = galacticOf(101.287155, -16.716116);
    expect(sirius.l).toBeCloseTo(227.2303, 3);
    expect(sirius.b).toBeCloseTo(-8.8903, 3);
    const vega = galacticOf(279.234735, 38.783689);
    expect(vega.l).toBeCloseTo(67.4482, 3);
    expect(vega.b).toBeCloseTo(19.2373, 3);
  });

  it('round-trips', () => {
    const p = v(-2.4e20, 1.1e19, -3.3e18);
    const back = galacticToIcrs(icrsToGalactic(p, v()), v());
    expect(back.x / p.x).toBeCloseTo(1, 12);
    expect(back.y / p.y).toBeCloseTo(1, 12);
    expect(back.z / p.z).toBeCloseTo(1, 12);
  });
});

describe('supergalactic (de Vaucouleurs RC2)', () => {
  it('is a proper rotation with SGZ at (l, b) = (47.37°, 6.32°) and SGL = 0 at (137.37°, 0°)', () => {
    expectOrthonormal(GALACTIC_TO_SUPERGALACTIC);
    const pole = galacticToSupergalactic(sphericalToVector(47.37, 6.32, 1, v()), v());
    expect(pole.z).toBeCloseTo(1, 12);
    const origin = galacticToSupergalactic(sphericalToVector(137.37, 0, 1, v()), v());
    expect(origin.x).toBeCloseTo(1, 12);
  });

  it('places the supergalactic pole at RA ≈ 283.75°, Dec ≈ +15.71° (ICRS)', () => {
    const sgp = icrsToRaDec(galacticToIcrs(supergalacticToGalactic(v(0, 0, 1), v()), v()));
    expect(sgp.raDeg).toBeCloseTo(283.754, 2);
    expect(sgp.decDeg).toBeCloseTo(15.709, 2);
  });

  it('gives M87 (Virgo cluster core) SGL ≈ 102.88°, SGB ≈ −2.35° (NED)', () => {
    const g = icrsToGalactic(raDecDistToIcrs(187.70593, 12.39112, 1, v()), v());
    const sg = icrsToRaDec(galacticToSupergalactic(g, v()));
    expect(sg.raDeg).toBeCloseTo(102.88, 1);
    expect(sg.decDeg).toBeCloseTo(-2.35, 1);
  });

  it('round-trips', () => {
    const p = v(3.1e23, -1.7e22, 8.8e22);
    const back = supergalacticToGalactic(galacticToSupergalactic(p, v()), v());
    expect(back.x / p.x).toBeCloseTo(1, 12);
    expect(back.y / p.y).toBeCloseTo(1, 12);
    expect(back.z / p.z).toBeCloseTo(1, 12);
  });
});

describe('Earth rotation & sidereal time', () => {
  it('counts UT days from 2000-01-01T12:00Z', () => {
    expect(utDaysSinceJ2000(J2000_MS)).toBe(0);
    expect(utDaysSinceJ2000(J2000_MS + 86_400_000 * 1.5)).toBeCloseTo(1.5, 12);
  });

  it('Earth Rotation Angle at J2000.0 = 2π × 0.7790572732640 (IERS 2010)', () => {
    expect(earthRotationAngleRad(J2000_MS) * RAD).toBeCloseTo(0.779057273264 * 360, 9);
    const oneSiderealDayMs = 86_164.0905 * 1000;
    const d = earthRotationAngleRad(J2000_MS + oneSiderealDayMs) - earthRotationAngleRad(J2000_MS);
    expect(Math.abs(d)).toBeLessThan(1e-5);
  });

  it('GMST of 1992-08-20 12:14 UT1 = 152.578787810° (Vallado, Example 3-5) within 0.2″', () => {
    const g = gmstRad(Date.UTC(1992, 7, 20, 12, 14, 0)) * RAD;
    expect(Math.abs(wrapDiffDeg(g, 152.57878781))).toBeLessThan(0.2 * ARCSEC_DEG);
  });

  it('GAST − GMST equals the equation of the equinoxes (|ee| < 18″)', () => {
    const t = Date.UTC(2026, 9, 17, 6);
    const ee = equationOfEquinoxesRad(t);
    expect(Math.abs(ee * RAD * 3600)).toBeLessThan(18);
    expect(wrapDiffDeg(gastRad(t) * RAD, gmstRad(t) * RAD)).toBeCloseTo(ee * RAD, 9);
  });
});

/**
 * Vallado, Crawford, Hujsak & Kelso (2006), "Revisiting Spacetrack Report #3", worked example at
 * 2004-04-06 07:51:28.386009 UTC (UT1 − UTC = −0.4399619 s). Expected GCRF position in km.
 */
const VALLADO_T_MS = Date.UTC(2004, 3, 6, 7, 51, 28, 386.009);
const VALLADO_GCRF_KM = v(5102.508958, 6123.011401, 6378.136928);

describe('TEME → ICRS (SGP4 output frame)', () => {
  it('reproduces the Vallado et al. 2006 GCRF position within 10 m', () => {
    const r = temeToIcrs(VALLADO_T_MS, v(5094.1801621, 6127.6446595, 6380.3445327), v());
    const errM = Math.hypot(r.x - VALLADO_GCRF_KM.x, r.y - VALLADO_GCRF_KM.y, r.z - VALLADO_GCRF_KM.z) * 1000;
    expect(errM).toBeLessThan(10);
  });

  it('is a proper rotation and caches per timestamp without changing results', () => {
    const m = temeToIcrsMatrix(VALLADO_T_MS);
    expectOrthonormal(m);
    const a = temeToIcrs(VALLADO_T_MS, v(7000, 0, 0), v());
    const b = temeToIcrs(VALLADO_T_MS + 1, v(7000, 0, 0), v());
    const c = temeToIcrs(VALLADO_T_MS, v(7000, 0, 0), v());
    expect(c).toEqual(a);
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(1e-6);
  });
});

describe('geodetic / ECEF (WGS 84)', () => {
  it('converts the equator, the pole and 45°N exactly', () => {
    const eq = geodeticToEcef(0, 0, 0, v());
    expect(eq.x).toBeCloseTo(WGS84_A_M, 6);
    const pole = geodeticToEcef(90, 0, 0, v());
    expect(pole.z).toBeCloseTo(WGS84_B_M, 6);
    expect(Math.abs(pole.x)).toBeLessThan(1e-6);
    const p = geodeticToEcef(45, 0, 0, v());
    expect(p.x).toBeCloseTo(4_517_590.878849, 4);
    expect(p.z).toBeCloseTo(4_487_348.408866, 4);
  });

  it('round-trips geodetic ↔ ECEF to sub-millimetre', () => {
    const pts: [number, number, number][] = [[51.4779, -0.0015, 46], [-33.8688, 151.2093, 58], [89.99, 10, 0], [-89.5, -120, 4200], [0.001, 179.999, -400], [28.5729, -80.649, 408e3]];
    for (const [lat, lon, h] of pts) {
      const g = ecefToGeodetic(geodeticToEcef(lat, lon, h, v()));
      expect(g.latDeg).toBeCloseTo(lat, 9);
      expect(wrapDiffDeg(g.lonDeg, lon)).toBeCloseTo(0, 9);
      expect(Math.abs(g.heightM - h)).toBeLessThan(1e-3);
    }
  });

  it('handles points on the rotation axis', () => {
    const g = ecefToGeodetic(v(0, 0, -WGS84_B_M - 10));
    expect(g.latDeg).toBe(-90);
    expect(g.heightM).toBeCloseTo(10, 6);
  });
});

describe('ECEF → ICRS', () => {
  it('reproduces the Vallado et al. 2006 GCRF position within 30 m (polar motion neglected, ≈ 10 m)', () => {
    const tUt1 = VALLADO_T_MS - 439.9619;
    const r = ecefToIcrs(tUt1, v(-1033.479383, 7901.2952754, 6380.3565958), v());
    const errM = Math.hypot(r.x - VALLADO_GCRF_KM.x, r.y - VALLADO_GCRF_KM.y, r.z - VALLADO_GCRF_KM.z) * 1000;
    expect(errM).toBeLessThan(30);
  });

  it('is a proper rotation and inverts with icrsToEcef', () => {
    const t = Date.UTC(2026, 9, 17, 3, 21, 7);
    expectOrthonormal(ecefToIcrsMatrix(t));
    const p = geodeticToEcef(19.8207, -155.468, 4205, v());
    const back = icrsToEcef(t, ecefToIcrs(t, p, v()), v());
    expect(Math.hypot(back.x - p.x, back.y - p.y, back.z - p.z)).toBeLessThan(1e-6);
  });

  it('rotates a ground point once per sidereal day', () => {
    const t = Date.UTC(2026, 9, 17);
    const p = geodeticToEcef(0, 0, 0, v());
    const a = ecefToIcrs(t, p, v());
    const b = ecefToIcrs(t + 86_164_090.5, p, v());
    expect(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z)).toBeLessThan(10);
    const c = ecefToIcrs(t + 86_164_090.5 / 2, p, v());
    expect(angleDeg(a, c)).toBeCloseTo(180, 1);
  });
});

describe('body-fixed frames (IAU WGCCRE)', () => {
  it('maps body +z to the pole (α₀, δ₀) and body +x to the node at W = 0', () => {
    const m = bodyFixedToIcrsMatrix(317.68143, 52.8865, 0);
    expectOrthonormal(m);
    const pole = icrsToRaDec(applyMat3(m, v(0, 0, 1), v()));
    expect(pole.raDeg).toBeCloseTo(317.68143, 9);
    expect(pole.decDeg).toBeCloseTo(52.8865, 9);
    const node = icrsToRaDec(bodyFixedToIcrs(317.68143, 52.8865, 0, v(1, 0, 0), v()));
    expect(node.raDeg).toBeCloseTo(317.68143 + 90 - 360, 9);
    expect(node.decDeg).toBeCloseTo(0, 9);
  });

  it('matches IAU poles at J2000: Mars (317.681°, 52.886°) and the Sun (286.13°, 63.87°)', () => {
    const mars = bodyRotationElements('Mars', J2000_MS);
    expect(mars.poleRaDeg).toBeCloseTo(317.681, 2);
    expect(mars.poleDecDeg).toBeCloseTo(52.886, 2);
    const sun = bodyRotationElements('Sun', J2000_MS);
    expect(sun.poleRaDeg).toBeCloseTo(286.13, 6);
    expect(sun.poleDecDeg).toBeCloseTo(63.87, 6);
  });

  it("derives Earth's elements consistently with the ECEF → ICRS rotation", () => {
    const t = Date.UTC(2026, 9, 17, 12);
    const e = bodyRotationElements('Earth', t);
    const fromElements = bodyFixedToIcrsMatrix(e.poleRaDeg, e.poleDecDeg, e.wDeg);
    const precise = ecefToIcrsMatrix(t);
    for (let i = 0; i < 9; i++) expect(fromElements[i]).toBeCloseTo(precise[i], 12);
    const viaBody = bodyFixedToIcrsForBody('Earth', t, v(1e6, 2e6, 3e6), v());
    const viaEcef = ecefToIcrs(t, v(1e6, 2e6, 3e6), v());
    expect(Math.hypot(viaBody.x - viaEcef.x, viaBody.y - viaEcef.y, viaBody.z - viaEcef.z)).toBeLessThan(1e-6);
  });

  it("keeps Earth's pole within 0.01° of ICRS +Z at J2000 and precesses ≈ 0.0056°/yr", () => {
    const p2000 = bodyPoleIcrs('Earth', J2000_MS, v());
    expect(angleDeg(p2000, v(0, 0, 1))).toBeLessThan(0.01);
    const p2026 = bodyPoleIcrs('Earth', Date.UTC(2026, 0, 1, 12), v());
    expect(angleDeg(p2026, v(0, 0, 1))).toBeCloseTo(26 * 0.00557, 1);
  });

  it("points the Moon's prime meridian (+x) at Earth to within the optical libration (< 10°)", () => {
    for (const t of [J2000_MS, Date.UTC(2013, 4, 5), Date.UTC(2026, 9, 17)]) {
      const gm = GeoMoon(MakeTime(new Date(t)));
      const xAxis = bodyFixedToIcrsForBody('Moon', t, v(1, 0, 0), v());
      expect(angleDeg(v(-gm.x, -gm.y, -gm.z), xAxis)).toBeLessThan(10);
    }
  });

  it('uses the right-hand rule: W increases eastward (prograde rotation)', () => {
    const a = bodyFixedToIcrs(0, 90, 0, v(1, 0, 0), v());
    const b = bodyFixedToIcrs(0, 90, 10, v(1, 0, 0), v());
    const raA = icrsToRaDec(a).raDeg, raB = icrsToRaDec(b).raDeg;
    expect(wrapDiffDeg(raB, raA)).toBeCloseTo(10, 9);
    expect(DEG).toBeCloseTo(Math.PI / 180, 15);
  });
});
