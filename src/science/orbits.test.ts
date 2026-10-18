import { describe, expect, it } from 'vitest';
import { AU_M, DEG, GM_EARTH, GM_SUN, SECONDS_PER_DAY } from '../core/units';
import { createRng } from './rng';
import {
  type KeplerElements,
  apoapsisRadiusM,
  eccentricToTrueAnomaly,
  elementsToState,
  j2SecularRates,
  meanMotionRadS,
  meanToTrueAnomaly,
  orbitalPeriodS,
  periapsisRadiusM,
  propagateElements,
  propagateElementsJ2,
  propagateKepler,
  sampleOrbitPolyline,
  semiMajorAxisFromPeriodM,
  solveKeplerElliptic,
  solveKeplerHyperbolic,
  stateFromTrueAnomaly,
  stateToElements,
  trueToEccentricAnomaly,
  trueToMeanAnomaly,
  visVivaSpeedMS,
  wrapPi,
} from './orbits';

const MU_EARTH_VALLADO = 398_600.4418e9; // m^3/s^2 (Vallado's EGM-96 value used in his worked examples)

function angleDiff(a: number, b: number): number {
  return Math.abs(wrapPi(a - b));
}

function energy(s: ArrayLike<number>, mu: number): number {
  return 0.5 * (s[3] ** 2 + s[4] ** 2 + s[5] ** 2) - mu / Math.hypot(s[0], s[1], s[2]);
}

function angularMomentum(s: ArrayLike<number>): [number, number, number] {
  return [s[1] * s[5] - s[2] * s[4], s[2] * s[3] - s[0] * s[5], s[0] * s[4] - s[1] * s[3]];
}

describe('Kepler equation (elliptic)', () => {
  it('reproduces Vallado (2013) Example 2-1: M = 235.4°, e = 0.4 → E = 220.512074767522°', () => {
    const E = solveKeplerElliptic(235.4 * DEG, 0.4);
    expect(E / DEG).toBeCloseTo(220.512074767522, 7);
  });

  it('solves to machine precision for e up to 0.999999 and any mean anomaly', () => {
    const eccentricities = [0, 1e-8, 0.05, 0.3, 0.5, 0.7, 0.9, 0.97, 0.99, 0.999, 0.9999, 0.999999];
    for (const e of eccentricities) {
      for (let M = -12; M <= 12; M += 0.0137) {
        const E = solveKeplerElliptic(M, e);
        expect(Number.isFinite(E)).toBe(true);
        expect(Math.abs(E - e * Math.sin(E) - M)).toBeLessThan(5e-15 * Math.max(1, Math.abs(M)));
      }
    }
  });

  it('handles the hardest corner (e → 1, tiny M) and exact multiples of π', () => {
    for (const M of [1e-12, 1e-9, 1e-6, 1e-3, Math.PI, -Math.PI, 2 * Math.PI]) {
      const E = solveKeplerElliptic(M, 0.999999);
      expect(Math.abs(E - 0.999999 * Math.sin(E) - M)).toBeLessThan(1e-15 * Math.max(1, Math.abs(M)) + 1e-18);
    }
  });

  it('keeps E in the same revolution as M (monotonic)', () => {
    let prev = -Infinity;
    for (let M = -20; M < 20; M += 0.05) {
      const E = solveKeplerElliptic(M, 0.8);
      expect(E).toBeGreaterThan(prev);
      prev = E;
    }
  });

  it('returns NaN outside its domain instead of throwing', () => {
    expect(solveKeplerElliptic(1, 1)).toBeNaN();
    expect(solveKeplerElliptic(1, -0.1)).toBeNaN();
    expect(solveKeplerElliptic(NaN, 0.1)).toBeNaN();
  });
});

describe('Kepler equation (hyperbolic)', () => {
  it('solves M = e sinh H − H across eccentricities and mean anomalies', () => {
    for (const e of [1 + 1e-9, 1.0001, 1.01, 1.2, 2, 5, 50]) {
      for (const M of [-1e4, -300, -20, -1, -1e-3, 0, 1e-6, 0.5, 3, 40, 900, 1e5]) {
        const H = solveKeplerHyperbolic(M, e);
        expect(Number.isFinite(H)).toBe(true);
        const residual = e * Math.sinh(H) - H - M;
        expect(Math.abs(residual)).toBeLessThan(2e-14 * Math.max(1, Math.abs(M), e * Math.cosh(H) * 1e-1));
      }
    }
  });

  it('is odd in M', () => {
    expect(solveKeplerHyperbolic(-7.5, 1.7)).toBeCloseTo(-solveKeplerHyperbolic(7.5, 1.7), 14);
  });
});

describe('anomaly conversions', () => {
  it('round-trips true ↔ eccentric ↔ mean for ellipses, preserving revolutions', () => {
    for (const e of [0, 0.1, 0.6, 0.95, 0.9999]) {
      for (let nu = -9; nu <= 9; nu += 0.31) {
        const M = trueToMeanAnomaly(nu, e);
        // dν/dM = (1 + e cos ν)² / (1 − e²)^{3/2} reaches ~1e6 at periapsis for e = 0.9999: round-off in M is
        // amplified by that factor, so the attainable accuracy is lower for near-parabolic ellipses.
        expect(meanToTrueAnomaly(M, e)).toBeCloseTo(nu, e > 0.99 ? 7 : 9);
        expect(eccentricToTrueAnomaly(trueToEccentricAnomaly(nu, e), e)).toBeCloseTo(nu, 12);
      }
    }
  });

  it('round-trips true ↔ mean for hyperbolas inside the asymptotes', () => {
    for (const e of [1.05, 1.5, 3]) {
      const nuInf = Math.acos(-1 / e);
      for (let f = -0.95; f <= 0.95; f += 0.1) {
        const nu = f * nuInf;
        expect(meanToTrueAnomaly(trueToMeanAnomaly(nu, e), e)).toBeCloseTo(nu, 10);
      }
      expect(trueToMeanAnomaly(nuInf * 1.01, e)).toBeNaN();
    }
  });
});

describe('scalar relations', () => {
  it("gives Earth's Keplerian (Gaussian) year for a = 1 AU around GM☉", () => {
    // 2π·sqrt(AU³/GM☉) = 365.25690 d with the IAU 2015 nominal GM☉ (heliocentric, Earth mass not included).
    expect(orbitalPeriodS(AU_M, GM_SUN) / SECONDS_PER_DAY).toBeCloseTo(365.2569, 3);
    expect(semiMajorAxisFromPeriodM(orbitalPeriodS(AU_M, GM_SUN), GM_SUN) / AU_M).toBeCloseTo(1, 12);
  });

  it('vis-viva matches periapsis/apoapsis speeds and the circular limit', () => {
    const a = 2e7, e = 0.5, mu = GM_EARTH;
    const q = periapsisRadiusM(a, e), Q = apoapsisRadiusM(a, e);
    expect(q).toBeCloseTo(1e7, 6);
    expect(Q).toBeCloseTo(3e7, 6);
    expect(visVivaSpeedMS(q, a, mu)).toBeCloseTo(Math.sqrt((mu / a) * ((1 + e) / (1 - e))), 9);
    expect(visVivaSpeedMS(a, a, mu)).toBeCloseTo(Math.sqrt(mu / a), 9);
    expect(visVivaSpeedMS(5e7, a, mu)).toBeNaN(); // r > 2a: unreachable for any bound orbit with this a
    expect(apoapsisRadiusM(-1e7, 1.3)).toBe(Infinity);
    expect(meanMotionRadS(-1e7, mu)).toBeCloseTo(Math.sqrt(mu / 1e21), 15);
  });
});

describe('elements ↔ state', () => {
  it('reproduces Vallado (2013) Example 2-6 (COE2RV)', () => {
    const p = 11_067.79e3;
    const e = 0.83285;
    const el = {
      semiMajorAxisM: p / (1 - e * e),
      eccentricity: e,
      inclinationRad: 87.87 * DEG,
      raanRad: 227.89 * DEG,
      argPeriapsisRad: 53.38 * DEG,
    };
    const s = stateFromTrueAnomaly(el, 92.335 * DEG, MU_EARTH_VALLADO);
    const rKm = [s[0] / 1e3, s[1] / 1e3, s[2] / 1e3];
    const vKms = [s[3] / 1e3, s[4] / 1e3, s[5] / 1e3];
    expect(rKm[0]).toBeCloseTo(6525.368, 0);
    expect(rKm[1]).toBeCloseTo(6861.532, 0);
    expect(rKm[2]).toBeCloseTo(6449.119, 0);
    expect(vKms[0]).toBeCloseTo(4.902279, 3);
    expect(vKms[1]).toBeCloseTo(5.533140, 3);
    expect(vKms[2]).toBeCloseTo(-1.975710, 3);
  });

  it('round-trips random elliptic and hyperbolic elements (incl. retrograde)', () => {
    const rng = createRng('orbit-roundtrip');
    const s = new Float64Array(6);
    const back = stateToElements(new Float64Array([7e6, 0, 0, 0, 7.5e3, 0]), GM_EARTH);
    for (let k = 0; k < 2000; k++) {
      const hyper = k % 4 === 3;
      const e = hyper ? rng.uniform(1.001, 4) : rng.uniform(0.001, 0.98);
      const el: KeplerElements = {
        semiMajorAxisM: (hyper ? -1 : 1) * rng.uniform(7e6, 5e8),
        eccentricity: e,
        inclinationRad: rng.uniform(0.01, Math.PI - 0.01),
        raanRad: rng.uniform(0, 2 * Math.PI),
        argPeriapsisRad: rng.uniform(0, 2 * Math.PI),
        meanAnomalyRad: hyper ? rng.uniform(-5, 5) : rng.uniform(0, 2 * Math.PI),
      };
      elementsToState(el, GM_EARTH, s);
      stateToElements(s, GM_EARTH, back);
      expect(back.semiMajorAxisM / el.semiMajorAxisM).toBeCloseTo(1, 9);
      expect(back.eccentricity).toBeCloseTo(el.eccentricity, 9);
      expect(back.inclinationRad).toBeCloseTo(el.inclinationRad, 9);
      expect(angleDiff(back.raanRad, el.raanRad)).toBeLessThan(1e-8);
      expect(angleDiff(back.argPeriapsisRad, el.argPeriapsisRad)).toBeLessThan(1e-7);
      expect(angleDiff(back.meanAnomalyRad, el.meanAnomalyRad)).toBeLessThan(1e-7);
    }
  });

  it('handles circular, equatorial and circular-equatorial singular cases consistently', () => {
    const cases: KeplerElements[] = [
      { semiMajorAxisM: 7e6, eccentricity: 0, inclinationRad: 0.9, raanRad: 1.1, argPeriapsisRad: 0, meanAnomalyRad: 2.2 },
      { semiMajorAxisM: 7e6, eccentricity: 0.2, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0.7, meanAnomalyRad: 1.3 },
      { semiMajorAxisM: 7e6, eccentricity: 0, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 4.0 },
      { semiMajorAxisM: 7e6, eccentricity: 0.3, inclinationRad: Math.PI, raanRad: 0, argPeriapsisRad: 2.0, meanAnomalyRad: 0.5 },
    ];
    const s = new Float64Array(6);
    const s2 = new Float64Array(6);
    for (const el of cases) {
      elementsToState(el, GM_EARTH, s);
      const back = stateToElements(s, GM_EARTH);
      for (const v of Object.values(back)) expect(Number.isFinite(v)).toBe(true);
      elementsToState(back, GM_EARTH, s2);
      for (let i = 0; i < 3; i++) expect(Math.abs(s2[i] - s[i])).toBeLessThan(1e-6);
      for (let i = 3; i < 6; i++) expect(Math.abs(s2[i] - s[i])).toBeLessThan(1e-9);
    }
  });

  it('returns NaN elements for a radial (zero angular momentum) state', () => {
    const el = stateToElements([7e6, 0, 0, 1e3, 0, 0], GM_EARTH);
    expect(el.eccentricity).toBeNaN();
  });
});

describe('universal-variable propagation', () => {
  it('moves a circular orbit a quarter turn in a quarter period', () => {
    const r = 7e6;
    const v = Math.sqrt(GM_EARTH / r);
    const P = orbitalPeriodS(r, GM_EARTH);
    const out = propagateKepler([r, 0, 0, 0, v, 0], GM_EARTH, P / 4);
    expect(out[0]).toBeCloseTo(0, 2);
    expect(out[1]).toBeCloseTo(r, 3);
    expect(out[3]).toBeCloseTo(-v, 8);
  });

  it('agrees with element (mean-anomaly) propagation for ellipses and hyperbolas', () => {
    const cases: KeplerElements[] = [
      { semiMajorAxisM: 1.2 * AU_M, eccentricity: 0.2, inclinationRad: 0.1, raanRad: 1, argPeriapsisRad: 2, meanAnomalyRad: 0.3 },
      { semiMajorAxisM: 3 * AU_M, eccentricity: 0.95, inclinationRad: 1.2, raanRad: 4, argPeriapsisRad: 0.5, meanAnomalyRad: 3.0 },
      { semiMajorAxisM: 18 * AU_M, eccentricity: 0.9995, inclinationRad: 2.5, raanRad: 0.2, argPeriapsisRad: 5.1, meanAnomalyRad: 6.2 },
      { semiMajorAxisM: -2 * AU_M, eccentricity: 1.4, inclinationRad: 0.4, raanRad: 2.2, argPeriapsisRad: 1.0, meanAnomalyRad: -0.8 },
      { semiMajorAxisM: -500 * AU_M, eccentricity: 1.0008, inclinationRad: 1.9, raanRad: 3.3, argPeriapsisRad: 4.4, meanAnomalyRad: -0.001 },
    ];
    const s0 = new Float64Array(6);
    const sU = new Float64Array(6);
    const sE = new Float64Array(6);
    for (const el of cases) {
      elementsToState(el, GM_SUN, s0);
      for (const dtDays of [-4000, -365, -1, 0.5, 30, 365.25, 2000, 40000]) {
        const dt = dtDays * SECONDS_PER_DAY;
        propagateKepler(s0, GM_SUN, dt, sU);
        elementsToState(propagateElements(el, GM_SUN, dt), GM_SUN, sE);
        const scale = Math.hypot(sE[0], sE[1], sE[2]);
        const dr = Math.hypot(sU[0] - sE[0], sU[1] - sE[1], sU[2] - sE[2]);
        expect(dr / scale).toBeLessThan(2e-9);
      }
    }
  });

  it('conserves energy and angular momentum, and inverts exactly (forward then backward)', () => {
    const states = [
      [7e6, 1e5, -2e5, 100, 7.4e3, 1.2e3], // LEO ellipse
      [6.6e6, 0, 0, 0, Math.sqrt((2 * GM_EARTH) / 6.6e6), 0], // exactly parabolic
      [6.6e6, 0, 0, 0, 1.05 * Math.sqrt((2 * GM_EARTH) / 6.6e6), 300], // hyperbolic
      [6.6e6, 0, 0, 0, 0.99995 * Math.sqrt((2 * GM_EARTH) / 6.6e6), 0], // near-parabolic ellipse
    ];
    const out = new Float64Array(6);
    const back = new Float64Array(6);
    for (const s0 of states) {
      for (const dt of [60, 3600, 86400 * 3, -86400]) {
        propagateKepler(s0, GM_EARTH, dt, out);
        expect(energy(out, GM_EARTH)).toBeCloseTo(energy(s0, GM_EARTH), 3);
        const h0 = angularMomentum(s0), h1 = angularMomentum(out);
        for (let i = 0; i < 3; i++) expect(Math.abs(h1[i] - h0[i])).toBeLessThan(1e-6 * Math.hypot(...h0));
        propagateKepler(out, GM_EARTH, -dt, back);
        // Round-off scales with the largest distance reached on the arc, not with |r0|.
        const reach = Math.max(Math.hypot(s0[0], s0[1], s0[2]), Math.hypot(out[0], out[1], out[2]));
        for (let i = 0; i < 3; i++) expect(Math.abs(back[i] - s0[i])).toBeLessThan(1e-11 * reach + 1e-5);
      }
    }
  });

  it('supports in-place propagation and strided buffers', () => {
    const buf = new Float64Array(12);
    buf.set([7e6, 0, 0, 0, 7.6e3, 0], 6);
    propagateKepler(buf, GM_EARTH, 1000, buf, 6, 6);
    const ref = propagateKepler([7e6, 0, 0, 0, 7.6e3, 0], GM_EARTH, 1000);
    for (let i = 0; i < 6; i++) expect(buf[6 + i]).toBeCloseTo(ref[i], 6);
  });
});

describe('J2 secular rates', () => {
  it('makes an 800 km, i = 98.6° circular orbit sun-synchronous (+0.9856°/day)', () => {
    const rates = j2SecularRates({ semiMajorAxisM: 6_378_137 + 800e3, eccentricity: 0, inclinationRad: 98.6 * DEG });
    expect((rates.raanRateRadS * SECONDS_PER_DAY) / DEG).toBeCloseTo(0.9856, 2);
  });

  it('gives the ISS nodal regression of about −5.0°/day', () => {
    const rates = j2SecularRates({ semiMajorAxisM: 6_378_137 + 420e3, eccentricity: 0.0005, inclinationRad: 51.64 * DEG });
    const deg = (rates.raanRateRadS * SECONDS_PER_DAY) / DEG;
    expect(deg).toBeGreaterThan(-5.1);
    expect(deg).toBeLessThan(-4.9);
  });

  it('has no apsidal precession at the critical inclination 63.435°', () => {
    const rates = j2SecularRates({ semiMajorAxisM: 2.6e7, eccentricity: 0.7, inclinationRad: Math.acos(Math.sqrt(1 / 5)) });
    expect(Math.abs(rates.argPeriapsisRateRadS)).toBeLessThan(1e-18);
  });

  it('drifts RAAN linearly in propagateElementsJ2', () => {
    const el: KeplerElements = { semiMajorAxisM: 7e6, eccentricity: 0.001, inclinationRad: 0.9, raanRad: 1, argPeriapsisRad: 0, meanAnomalyRad: 0 };
    const r = j2SecularRates(el);
    const after = propagateElementsJ2(el, 86400);
    expect(angleDiff(after.raanRad, 1 + r.raanRateRadS * 86400)).toBeLessThan(1e-12);
  });
});

describe('orbit polylines', () => {
  it('places every vertex on the conic and adapts spacing to curvature', () => {
    const el: KeplerElements = { semiMajorAxisM: 1e8, eccentricity: 0.99, inclinationRad: 0.3, raanRad: 0.4, argPeriapsisRad: 0.5, meanAnomalyRad: 0 };
    const n = 256;
    const pts = sampleOrbitPolyline(el, GM_EARTH, n);
    const p = el.semiMajorAxisM * (1 - el.eccentricity ** 2);
    const q = periapsisRadiusM(el.semiMajorAxisM, el.eccentricity);
    expect(Math.hypot(pts[0], pts[1], pts[2])).toBeCloseTo(q, 0); // first vertex at periapsis
    let maxTurn = 0;
    for (let i = 0; i < n; i++) {
      const r = Math.hypot(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
      expect(r).toBeGreaterThanOrEqual(q * (1 - 1e-9));
      expect(r).toBeLessThanOrEqual(el.semiMajorAxisM * (1 + el.eccentricity) * (1 + 1e-9));
      // conic equation via the in-plane angle measured from periapsis
      const i0 = 3 * ((i + n - 1) % n), i1 = 3 * i, i2 = 3 * ((i + 1) % n);
      const ax = pts[i1] - pts[i0], ay = pts[i1 + 1] - pts[i0 + 1], az = pts[i1 + 2] - pts[i0 + 2];
      const bx = pts[i2] - pts[i1], by = pts[i2 + 1] - pts[i1 + 1], bz = pts[i2 + 2] - pts[i1 + 2];
      const cos = (ax * bx + ay * by + az * bz) / (Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz));
      maxTurn = Math.max(maxTurn, Math.acos(Math.min(1, cos)));
    }
    // Equal-turning share 0.75 → worst segment turn ≈ 2π/n / 0.75; uniform-E sampling would give ~0.17 rad here.
    expect(maxTurn).toBeLessThan((2 * Math.PI) / n / 0.7);
    // r(ν) conic check on a few vertices through the time output
    const times = new Float64Array(n);
    sampleOrbitPolyline(el, GM_EARTH, n, { outTimeFromPeriapsisS: times });
    const nMean = meanMotionRadS(el.semiMajorAxisM, GM_EARTH);
    for (const i of [1, 17, 128, 200]) {
      const nu = meanToTrueAnomaly(times[i] * nMean, el.eccentricity);
      const r = Math.hypot(pts[3 * i], pts[3 * i + 1], pts[3 * i + 2]);
      expect(r / (p / (1 + el.eccentricity * Math.cos(nu)))).toBeCloseTo(1, 9);
    }
  });

  it('samples hyperbolic arcs symmetrically up to the requested radius', () => {
    const el: KeplerElements = { semiMajorAxisM: -2e7, eccentricity: 1.5, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 };
    const q = periapsisRadiusM(el.semiMajorAxisM, el.eccentricity);
    const pts = sampleOrbitPolyline(el, GM_EARTH, 101, { maxRadiusM: 30 * q });
    const rEnd = Math.hypot(pts[0], pts[1], pts[2]);
    expect(rEnd).toBeCloseTo(30 * q, -2);
    expect(Math.hypot(pts[150], pts[151], pts[152])).toBeCloseTo(q, 0); // middle vertex = periapsis
    expect(pts[1]).toBeCloseTo(-pts[3 * 100 + 1], 3);
  });

  it('fills NaN for invalid elements', () => {
    const pts = sampleOrbitPolyline({ semiMajorAxisM: -1, eccentricity: 0.5, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 }, GM_EARTH, 8);
    expect(pts[0]).toBeNaN();
  });
});
