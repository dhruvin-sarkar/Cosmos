import { describe, expect, it } from 'vitest';
import { AU_M, L_SUN_W, R_SUN_M, T_SUN_EFF_K } from '../core/units';
import {
  ESI_DISCLAIMER,
  S_EARTH_W_M2,
  earthSimilarityIndex,
  equilibriumTemperatureFromInsolationK,
  equilibriumTemperatureK,
  habitableZone,
  hzEffectiveFlux,
  hzPosition,
  illustrativeClimateState,
  insolationEarth,
  insolationFromStarEarth,
  planetSizeClass,
} from './exoplanets';

const earthTeq = (redistribution: 'full' | 'dayside' | number) =>
  equilibriumTemperatureK({ starTeffK: T_SUN_EFF_K, starRadiusM: R_SUN_M, semiMajorAxisM: AU_M, bondAlbedo: 0.3, redistribution });

describe('equilibrium temperature', () => {
  it('Earth: A = 0.3, full redistribution → ≈ 255 K', () => {
    expect(earthTeq('full')).toBeCloseTo(254.6, 0);
  });
  it('dayside redistribution is 2^¼ warmer than full', () => {
    expect(earthTeq('dayside') / earthTeq('full')).toBeCloseTo(Math.pow(2, 0.25), 10);
    expect(earthTeq(0.25)).toBeCloseTo(earthTeq('full'), 12);
  });
  it('invalid inputs → NaN', () => {
    expect(earthTeq(0.9)).toBeNaN();
    expect(equilibriumTemperatureK({ starTeffK: 5772, starRadiusM: R_SUN_M, semiMajorAxisM: AU_M, bondAlbedo: 1, redistribution: 'full' })).toBeNaN();
  });
  it('insolation form agrees with the stellar form', () => {
    expect(equilibriumTemperatureFromInsolationK(1, 0.3)).toBeCloseTo(earthTeq('full'), 1);
  });
});

describe('insolation', () => {
  it('S⊕ ≈ 1361 W/m² and Earth receives 1 S⊕', () => {
    expect(S_EARTH_W_M2).toBeCloseTo(1361, 0);
    expect(insolationEarth(L_SUN_W, AU_M)).toBeCloseTo(1, 12);
    expect(insolationFromStarEarth(T_SUN_EFF_K, R_SUN_M, AU_M)).toBeCloseTo(1, 3);
    expect(insolationEarth(L_SUN_W, 2 * AU_M)).toBeCloseTo(0.25, 12);
  });
});

describe('habitable zone (Kopparapu et al. 2014)', () => {
  it('Sun: conservative HZ ≈ 0.95–1.67 AU, optimistic ≈ 0.75–1.77 AU', () => {
    const hz = habitableZone(5780, L_SUN_W);
    expect(hz.valid).toBe(true);
    expect(hz.runawayGreenhouse.seff).toBeCloseTo(1.107, 3);
    expect(hz.runawayGreenhouse.distanceM / AU_M).toBeCloseTo(0.95, 2);
    expect(hz.maximumGreenhouse.distanceM / AU_M).toBeCloseTo(1.676, 2);
    expect(hz.recentVenus.distanceM / AU_M).toBeCloseTo(0.75, 2);
    expect(hz.earlyMars.distanceM / AU_M).toBeCloseTo(1.768, 2);
    expect(hz.runawayGreenhouse5Me.distanceM).toBeLessThan(hz.runawayGreenhouse.distanceM);
    expect(hz.runawayGreenhouse01Me.distanceM).toBeGreaterThan(hz.runawayGreenhouse.distanceM);
  });
  it('M dwarf (3300 K): limits shift to lower flux; validity flag outside 2600–7200 K', () => {
    expect(hzEffectiveFlux(3300, 'runawayGreenhouse')).toBeLessThan(1.107);
    expect(habitableZone(2400, 1e-3 * L_SUN_W).valid).toBe(false);
    expect(habitableZone(8000, 10 * L_SUN_W).valid).toBe(false);
  });
  it('positions: Earth and Mars (1.52 AU, inside 1.67 AU) conservative, Venus too hot', () => {
    expect(hzPosition(1, 5772)).toBe('conservative');
    expect(hzPosition(1.91, 5772)).toBe('too-hot');
    expect(hzPosition(0.43, 5772)).toBe('conservative');
    expect(hzPosition(0.33, 5772)).toBe('optimistic-outer');
    expect(hzPosition(0.2, 5772)).toBe('too-cold');
    expect(hzPosition(Number.NaN, 5772)).toBe('unknown');
  });
});

describe('Earth Similarity Index', () => {
  it('ESI(Earth) = 1 for every variant', () => {
    const full = earthSimilarityIndex({ radiusEarth: 1, densityEarth: 1, escapeVelocityEarth: 1, surfaceTempK: 288 });
    expect(full.variant).toBe('full');
    expect(full.value).toBeCloseTo(1, 12);
    const rs = earthSimilarityIndex({ radiusEarth: 1, insolationEarth: 1 });
    expect(rs.variant).toBe('radius-insolation');
    expect(rs.value).toBeCloseTo(1, 12);
    expect(rs.missing).toEqual(['densityEarth', 'escapeVelocityEarth', 'surfaceTempK']);
    expect(full.disclaimer).toBe(ESI_DISCLAIMER);
  });
  it('Mars (R 0.53, ρ 0.71, v_esc 0.45, T 227 K) ≈ 0.70 (Schulze-Makuch et al. 2011 lists 0.70)', () => {
    const mars = earthSimilarityIndex({ radiusEarth: 0.532, densityEarth: 0.713, escapeVelocityEarth: 0.45, surfaceTempK: 227 });
    expect(mars.value!).toBeGreaterThan(0.66);
    expect(mars.value!).toBeLessThan(0.74);
  });
  it('radius–insolation variant matches the PHL closed form', () => {
    const r = earthSimilarityIndex({ radiusEarth: 1.5, insolationEarth: 0.5 });
    const expected = 1 - Math.sqrt(0.5 * ((0.5 / 2.5) ** 2 + (0.5 / 1.5) ** 2));
    expect(r.value).toBeCloseTo(expected, 12);
  });
  it('nothing known → null, not 0', () => {
    const r = earthSimilarityIndex({});
    expect(r.value).toBeNull();
    expect(r.variant).toBeNull();
  });
  it('partial data → partial variant with listed gaps', () => {
    const r = earthSimilarityIndex({ radiusEarth: 1.2, densityEarth: 0.9 });
    expect(r.variant).toBe('partial');
    expect(r.missing).toContain('surfaceTempK');
    expect(r.value!).toBeGreaterThan(0.8);
  });
});

describe('size class and illustrative climate', () => {
  it('classes', () => {
    expect(planetSizeClass(1)).toBe('earth-size');
    expect(planetSizeClass(1.6)).toBe('super-earth');
    expect(planetSizeClass(3)).toBe('sub-neptune');
    expect(planetSizeClass(11)).toBe('gas-giant');
    expect(planetSizeClass(null)).toBe('unknown');
  });
  it('Earth-like insolation → temperate with oceans; Venus → runaway; Mercury-plus → hot; Mars-minus → frozen', () => {
    const earth = illustrativeClimateState({ insolation: 1, sizeClass: 'earth-size', starTeffK: 5772 });
    expect(earth.state).toBe('temperate');
    expect(earth.oceanCover).toBeGreaterThan(0.5);
    expect(earth.provenance).toBe('illustrative');
    expect(illustrativeClimateState({ insolation: 1.9, sizeClass: 'earth-size' }).state).toBe('runaway-greenhouse');
    expect(illustrativeClimateState({ insolation: 6.7, sizeClass: 'earth-size' }).state).toBe('hot');
    expect(illustrativeClimateState({ insolation: 0.1, sizeClass: 'sub-earth' }).state).toBe('frozen');
    expect(illustrativeClimateState({ insolation: 0.1, sizeClass: 'sub-earth' }).iceCover).toBeGreaterThan(0.9);
  });
  it('giants follow Sudarsky classes by Teq', () => {
    expect(illustrativeClimateState({ teqK: 110, sizeClass: 'gas-giant' }).state).toBe('gas-giant-ammonia');
    expect(illustrativeClimateState({ teqK: 1500, sizeClass: 'gas-giant' }).state).toBe('gas-giant-silicate');
  });
  it('no data → unknown', () => {
    expect(illustrativeClimateState({ sizeClass: 'earth-size' }).state).toBe('unknown');
  });
});
