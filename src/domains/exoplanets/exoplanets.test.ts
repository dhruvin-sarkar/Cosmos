/**
 * Exoplanet domain logic against the shipped NASA Exoplanet Archive snapshot (public/data/exoplanets/) and published values.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCompactCatalog, buildIndex, hostPlanetRange, methodGroupCode, type RawTable } from './catalog';
import { classifyPlanet, massFromRadiusEarth, radiusFromMassEarth, systemModel, tidalLockTimescaleYr, orbitOffset } from './physics';
import { countByMethodYear, searchExo } from './stats';
import { SHOWCASE } from './showcase';
import { AU_M, M_EARTH_KG, M_SUN_KG, R_EARTH_MEAN_M } from '../../core/units';

const dir = resolve(__dirname, '../../../public/data/exoplanets');
const load = (f: string): RawTable => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawTable;
const catalog = buildCompactCatalog(load('planets.json'), load('systems.json'));
const index = buildIndex(catalog);

describe('mass–radius (Chen & Kipping 2017)', () => {
  it('reproduces Earth and the Terran/Neptunian branches', () => {
    expect(radiusFromMassEarth(1)).toBeCloseTo(1.008, 3);
    expect(massFromRadiusEarth(1.008)).toBeCloseTo(1, 6);
    // Neptune: 17.15 M⊕ → ~4.6 R⊕ by the mean relation (real 3.88 R⊕; the relation has ~30 % scatter).
    const rn = radiusFromMassEarth(17.15);
    expect(rn).toBeGreaterThan(3.5);
    expect(rn).toBeLessThan(5);
    // Jupiter: 317.8 M⊕ → ~13 R⊕ (real 11.2).
    expect(radiusFromMassEarth(317.8)).toBeGreaterThan(10);
    expect(radiusFromMassEarth(317.8)).toBeLessThan(14);
    expect(radiusFromMassEarth(0)).toBeNaN();
    for (const r of [0.6, 1.1, 2, 3.5, 8]) expect(radiusFromMassEarth(massFromRadiusEarth(r))).toBeCloseTo(r, 6);
  });
});

describe('tidal locking (Gladman et al. 1996)', () => {
  it('locks close-in M-dwarf planets but not Earth', () => {
    const earth = tidalLockTimescaleYr({ semiMajorAxisM: AU_M, planetMassKg: M_EARTH_KG, planetRadiusM: R_EARTH_MEAN_M, starMassKg: M_SUN_KG });
    expect(earth).toBeGreaterThan(1e10);
    const proxB = tidalLockTimescaleYr({ semiMajorAxisM: 0.0486 * AU_M, planetMassKg: 1.07 * M_EARTH_KG, planetRadiusM: 1.03 * R_EARTH_MEAN_M, starMassKg: 0.12 * M_SUN_KG });
    expect(proxB).toBeLessThan(1e9);
  });
});

describe('planet classification', () => {
  it('separates lava worlds, temperate rocky planets, sub-Neptunes and hot Jupiters', () => {
    const base = { densGcc: 5.5, starTeffK: 5772 };
    expect(classifyPlanet({ ...base, radiusE: 1.9, massE: 8, densGcc: 6.4, insolation: 2400, teq0K: 1950 }).type).toBe('lava-world'); // 55 Cnc e
    expect(classifyPlanet({ ...base, radiusE: 1, massE: 1, insolation: 1, teq0K: 278 }).type).toBe('temperate-rocky');
    expect(classifyPlanet({ ...base, radiusE: 2.6, massE: 7, densGcc: 2.2, insolation: 5, teq0K: 420 }).type).toBe('sub-neptune');
    expect(classifyPlanet({ ...base, radiusE: 15.2, massE: 220, densGcc: 0.35, insolation: 1000, teq0K: 1450 }).type).toBe('hot-jupiter'); // HD 209458 b
  });
});

describe('archive catalogue', () => {
  it('loads every confirmed planet with sane columns', () => {
    expect(catalog.planets.count).toBeGreaterThan(5500);
    expect(catalog.hosts.count).toBeGreaterThan(4000);
    let withHost = 0;
    for (let i = 0; i < catalog.planets.count; i++) if (catalog.planets.host[i] >= 0) withHost++;
    expect(withHost).toBe(catalog.planets.count);
  });

  it('has the showcase systems with their known planet counts', () => {
    const counts: Record<string, number> = { 'TRAPPIST-1': 7, 'HR 8799': 4, '55 Cnc': 5, 'Kepler-16': 1, '51 Peg': 1 };
    for (const [host, n] of Object.entries(counts)) {
      const h = index.hostByName.get(host);
      expect(h, host).toBeDefined();
      const [a, b] = hostPlanetRange(catalog, h as number);
      expect(b - a, host).toBe(n);
    }
    for (const s of SHOWCASE) expect(index.hostByName.has(s.host), s.host).toBe(true);
  });

  it('TRAPPIST-1 e matches Agol et al. 2021', () => {
    const i = index.planetByName.get('TRAPPIST-1 e') as number;
    expect(i).toBeDefined();
    expect(catalog.planets.radiusE[i]).toBeCloseTo(0.92, 1);
    expect(catalog.planets.periodDays[i]).toBeCloseTo(6.1, 1);
    const h = catalog.planets.host[i];
    expect(catalog.hosts.distPc[h]).toBeCloseTo(12.4, 0);
  });

  it('classifies discovery methods', () => {
    expect(methodGroupCode('Transit')).toBe(0);
    expect(methodGroupCode('Radial Velocity')).toBe(1);
    expect(methodGroupCode('Imaging')).toBe(2);
    expect(methodGroupCode('Microlensing')).toBe(3);
  });

  it('counts by method and year add up and respect filters', () => {
    const all = countByMethodYear(catalog, { methodMask: 0x7f, yearMin: 1989, yearMax: 2026 }, [1989, 2026]);
    expect(all.byMethod.reduce((a, b) => a + b, 0)).toBe(all.total);
    expect(all.byMethod[0]).toBeGreaterThan(all.byMethod[1]); // transits dominate
    const rv = countByMethodYear(catalog, { methodMask: 1 << 1, yearMin: 1995, yearMax: 1995 }, [1989, 2026]);
    expect(rv.total).toBeGreaterThanOrEqual(1); // 51 Pegasi b
    expect(rv.total).toBeLessThan(all.total);
  });

  it('searches planets and hosts by name and alias', () => {
    const hits = searchExo(catalog, index, 'trappist-1 e');
    expect(hits[0]?.label).toContain('TRAPPIST-1 e');
    expect(searchExo(catalog, index, 'proxima').length).toBeGreaterThan(0);
    expect(searchExo(catalog, index, '').length).toBe(0);
  });
});

describe('system model', () => {
  it('builds TRAPPIST-1 with orbits ordered by period and the HZ around planets e–g', () => {
    const h = index.hostByName.get('TRAPPIST-1') as number;
    const m = systemModel(catalog, h);
    expect(m.planets.length).toBe(7);
    const aAu = m.planets.map((p) => p.aM / AU_M);
    for (let k = 1; k < aAu.length; k++) expect(aAu[k]).toBeGreaterThan(aAu[k - 1]);
    const e = m.planets.find((p) => p.name === 'TRAPPIST-1 e');
    expect(e).toBeDefined();
    const inner = m.hz.runawayGreenhouse.distanceM, outer = m.hz.maximumGreenhouse.distanceM;
    expect(e!.aM).toBeGreaterThan(inner * 0.9);
    expect(e!.aM).toBeLessThan(outer);
    // Orbit offsets stay on the ellipse: r ∈ [a(1−e), a(1+e)].
    const o = { x: 0, y: 0, z: 0 };
    for (const t of [0, 1e9, 3.7e10]) {
      orbitOffset(e!, t, o);
      const r = Math.hypot(o.x, o.y, o.z);
      expect(r).toBeGreaterThanOrEqual(e!.aM * (1 - e!.ecc) * 0.999);
      expect(r).toBeLessThanOrEqual(e!.aM * (1 + e!.ecc) * 1.001);
    }
  });
});
