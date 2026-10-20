/**
 * Habitability lab model against published values: Earth T_eq ≈ 255 K and T_surf ≈ 288 K (NASA Earth Fact Sheet),
 * Venus T_surf 737 K, Mars ≈ 210 K; HZ limits for the Sun 0.95/0.75 AU (conservative inner / optimistic inner) and
 * 1.67/1.77 AU (Kopparapu et al. 2014, Table 1 for 1 M⊕); TRAPPIST-1 e in the conservative HZ (Agol et al. 2021).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AU_M } from '../../core/units';
import { buildCompactCatalog, buildIndex, type RawTable } from '../../domains/exoplanets/catalog';
import { PLANET_PRESETS, STAR_PRESETS, evaluateHabitability, inputsEqual, massFromLuminosity, starRadiusM } from './model';
import { inputsFromCatalog } from './fromCatalog';

const preset = (id: string) => PLANET_PRESETS.find((p) => p.id === id)!.inputs;

describe('evaluateHabitability', () => {
  it('reproduces Earth', () => {
    const r = evaluateHabitability(preset('earth'));
    expect(r.teqK).toBeGreaterThan(252);
    expect(r.teqK).toBeLessThan(256);
    expect(r.surfaceK).toBeGreaterThan(285);
    expect(r.surfaceK).toBeLessThan(290);
    expect(r.hzPos).toBe('conservative');
    expect(r.esi.value).toBeGreaterThan(0.98);
    expect(r.water).toBe('liquid');
    expect(r.likelyLocked).toBe(false);
    expect(r.gaseous).toBe(false);
    expect(r.densityGcc).toBeCloseTo(5.514, 2);
    expect(r.escapeKms).toBeCloseTo(11.19, 1);
  });

  it('reproduces Venus and Mars', () => {
    const v = evaluateHabitability(preset('venus'));
    expect(v.surfaceK).toBeGreaterThan(700);
    expect(v.surfaceK).toBeLessThan(760);
    expect(v.water).toBe('boiling');
    expect(v.hzPos).toBe('too-hot');
    const m = evaluateHabitability(preset('mars'));
    expect(m.surfaceK).toBeGreaterThan(200);
    expect(m.surfaceK).toBeLessThan(220);
    expect(m.water).toBe('frozen');
  });

  it('places the solar habitable zone at Kopparapu et al. 2014 distances', () => {
    const { hz } = evaluateHabitability(preset('earth'));
    expect(hz.runawayGreenhouse.distanceM / AU_M).toBeCloseTo(0.95, 1);
    expect(hz.recentVenus.distanceM / AU_M).toBeCloseTo(0.75, 1);
    expect(hz.maximumGreenhouse.distanceM / AU_M).toBeCloseTo(1.67, 1);
    expect(hz.earlyMars.distanceM / AU_M).toBeCloseTo(1.77, 1);
  });

  it('flags red-dwarf planets as tidally locked and gas-rich planets as surfaceless', () => {
    const t = evaluateHabitability(preset('trappist-1e'));
    expect(t.hzPos).toBe('conservative');
    expect(t.likelyLocked).toBe(true);
    expect(t.notes.some((n) => n.includes('flare'))).toBe(true);
    const jup = evaluateHabitability({ ...preset('earth'), distanceAu: 5.2, radiusE: 11.2, massE: 317.8 });
    expect(jup.gaseous).toBe(true);
    expect(jup.verdict).toMatch(/gas/);
  });

  it('every preset evaluates to finite numbers', () => {
    for (const p of PLANET_PRESETS) {
      const r = evaluateHabitability(p.inputs);
      expect(Number.isFinite(r.surfaceK), p.id).toBe(true);
      expect(r.hzPos, p.id).not.toBe('unknown');
    }
    for (const s of STAR_PRESETS) {
      const r = evaluateHabitability({ ...preset('earth'), starTeffK: s.teffK, starLum: s.lum, starMass: s.mass });
      expect(Number.isFinite(r.teqK), s.id).toBe(true);
    }
  });
});

describe('stellar helpers', () => {
  it('gives the Sun its radius and mass', () => {
    expect(starRadiusM(5772, 1) / 6.957e8).toBeCloseTo(1, 2);
    expect(massFromLuminosity(1)).toBeCloseTo(1, 6);
  });
  it('inputsEqual tolerates rounding only', () => {
    const a = preset('earth');
    expect(inputsEqual(a, { ...a })).toBe(true);
    expect(inputsEqual(a, { ...a, albedo: 0.31 })).toBe(false);
  });
});

describe('inputsFromCatalog', () => {
  const dir = resolve(__dirname, '../../../public/data/exoplanets');
  const load = (f: string): RawTable => JSON.parse(readFileSync(resolve(dir, f), 'utf8')) as RawTable;
  const c = buildCompactCatalog(load('planets.json'), load('systems.json'));
  const idx = buildIndex(c);

  it('fills Proxima b (no measured radius) and labels the estimate', () => {
    const r = inputsFromCatalog(c, idx.planetByName.get('Proxima Cen b')!)!;
    expect(r.estimated).toContain('radius');
    expect(r.inputs.radiusE).toBeGreaterThan(0.9);
    expect(r.inputs.radiusE).toBeLessThan(1.3);
    expect(r.inputs.distanceAu).toBeCloseTo(0.0486, 2);
    expect(evaluateHabitability(r.inputs).hzPos).toMatch(/conservative|optimistic/);
  });

  it('every archive planet gives finite lab inputs', () => {
    let bad = 0;
    for (let i = 0; i < c.planets.count; i++) {
      const r = inputsFromCatalog(c, i);
      if (!r || !Object.values(r.inputs).every((v) => typeof v !== 'number' || Number.isFinite(v))) bad++;
    }
    expect(bad).toBe(0);
  });
});
