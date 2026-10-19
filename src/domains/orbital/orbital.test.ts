import { describe, expect, it } from 'vitest';
import { propagate } from 'satellite.js';
import { temeToIcrsMatrix } from '../../core/frames';
import { F, regimeCode, REGIME_GEO, REGIME_LEO, REGIME_MEO, type CatalogRow } from './catalogTypes';
import { ELEMENT_STRIDE, classicalToElements, elementsPosition, elementsVelocity, solveKepler, stateToElements } from './kepler';
import notable from './notable.generated.json';
import { TrackedSat, satrecFromRow, sgp4Icrs } from './sgp4';

const rows = (notable as { rows: CatalogRow[] }).rows;
const row = (norad: string) => rows.find((r) => r[F.norad] === norad)!;
const T = Date.parse('2026-10-18T12:00:00Z');

describe('kepler', () => {
  it('solves Kepler\'s equation for high eccentricity', () => {
    for (const e of [0, 0.1, 0.7, 0.95]) for (const M of [0.01, 1, 3, 5.5]) {
      const E = solveKepler(M, e);
      expect(E - e * Math.sin(E)).toBeCloseTo(M, 10);
    }
  });

  it('round-trips a state vector through perifocal elements', () => {
    const el = new Float64Array(ELEMENT_STRIDE);
    const r = [6778e3, 120e3, -300e3], v = [-50, 6000, 4700];
    expect(stateToElements(r[0], r[1], r[2], v[0], v[1], v[2], el, 0)).toBe(true);
    const p = { x: 0, y: 0, z: 0 }, w = { x: 0, y: 0, z: 0 };
    elementsPosition(el, 0, 0, p);
    elementsVelocity(el, 0, 0, w);
    expect(Math.hypot(p.x - r[0], p.y - r[1], p.z - r[2])).toBeLessThan(1e-3);
    expect(Math.hypot(w.x - v[0], w.y - v[1], w.z - v[2])).toBeLessThan(1e-6);
  });

  it('classical elements give the requested apsides', () => {
    const el = new Float64Array(ELEMENT_STRIDE);
    const a = 26_560e3, e = 0.7;
    classicalToElements(a, e, 1.1, 0.3, 4.7, 0, el, 0);
    const p = { x: 0, y: 0, z: 0 };
    elementsPosition(el, 0, 0, p);
    expect(Math.hypot(p.x, p.y, p.z)).toBeCloseTo(a * (1 - e), -1);
  });
});

describe('SGP4 (satellite.js 7) and the two-body interpolation', () => {
  it('ISS: ICRS state matches satellite.js TEME rotated by the core matrix', () => {
    const rec = satrecFromRow(row('25544'))!;
    const out = new Float64Array(6);
    expect(sgp4Icrs(rec, T, out)).toBe(true);
    const pv = propagate(rec, new Date(T))!;
    const p = pv.position as { x: number; y: number; z: number };
    const m = temeToIcrsMatrix(T);
    const x = (m[0] * p.x + m[1] * p.y + m[2] * p.z) * 1000;
    expect(out[0]).toBeCloseTo(x, 3);
    // ISS altitude ~ 410–430 km (CelesTrak apsides 415.9 × 425.1 km above 6378.135 km).
    const alt = Math.hypot(out[0], out[1], out[2]) / 1000 - 6378.135;
    expect(alt).toBeGreaterThan(395);
    expect(alt).toBeLessThan(440);
    // Speed ~7.66 km/s.
    expect(Math.hypot(out[3], out[4], out[5]) / 1000).toBeCloseTo(7.66, 1);
  });

  it('Kepler interpolation stays within 200 m of SGP4 over the 20 s refresh window (LEO) and 2 km over 90 s', () => {
    for (const norad of ['25544', '20580', '49260', '5']) {
      const rec = satrecFromRow(row(norad))!;
      const s0 = new Float64Array(6), s1 = new Float64Array(6);
      sgp4Icrs(rec, T, s0);
      const el = new Float64Array(ELEMENT_STRIDE);
      stateToElements(s0[0], s0[1], s0[2], s0[3], s0[4], s0[5], el, 0);
      const p = { x: 0, y: 0, z: 0 };
      for (const [dt, tol] of [[20, 200], [90, 2000]] as const) {
        sgp4Icrs(rec, T + dt * 1000, s1);
        elementsPosition(el, 0, dt, p);
        expect(Math.hypot(p.x - s1[0], p.y - s1[1], p.z - s1[2])).toBeLessThan(tol);
      }
    }
  });

  it('TrackedSat follows SGP4 across refreshes (ISS, one revolution)', () => {
    const rec = satrecFromRow(row('25544'))!;
    const tr = new TrackedSat(rec);
    const s = new Float64Array(6);
    const p = { x: 0, y: 0, z: 0 };
    let worst = 0;
    for (let t = 0; t <= 5600; t += 7.3) {
      tr.position(T + t * 1000, p);
      sgp4Icrs(rec, T + t * 1000, s);
      worst = Math.max(worst, Math.hypot(p.x - s[0], p.y - s[1], p.z - s[2]));
    }
    expect(worst).toBeLessThan(200);
  });

  it('GEO satellites (GOES-18/19) sit near 42,164 km; GPS near 26,560 km', () => {
    const s = new Float64Array(6);
    for (const n of ['60133', '51850']) {
      sgp4Icrs(satrecFromRow(row(n))!, T, s);
      expect(Math.hypot(s[0], s[1], s[2]) / 1000).toBeGreaterThan(42_100);
      expect(Math.hypot(s[0], s[1], s[2]) / 1000).toBeLessThan(42_230);
    }
    sgp4Icrs(satrecFromRow(row('55268'))!, T, s);
    expect(Math.abs(Math.hypot(s[0], s[1], s[2]) / 1000 - 26_560)).toBeLessThan(200);
  });
});

describe('regimes (summary.json definitions)', () => {
  it('classifies LEO, MEO and GEO', () => {
    expect(regimeCode(415.9, 425.1, 0.0007)).toBe(REGIME_LEO);
    expect(regimeCode(20169, 20195, 0.0005)).toBe(REGIME_MEO);
    expect(regimeCode(35785.7, 35789.4, 0.0001)).toBe(REGIME_GEO);
  });
});
