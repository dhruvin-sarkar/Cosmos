import { describe, expect, it } from 'vitest';
import {
  FOCUS_RENDER_UNITS, LIGHT_TIME_BANDS, METERS_PER_UNIT_MAX, METERS_PER_UNIT_MIN, RULER_BANDS, SCALE_MAX_LOG10,
  SCALE_MIN_LOG10, bestLengthUnit, clamp, clampScale, easeInOutCubic, focusDistanceFromScale, inverseLerp,
  lengthInBestUnit, lengthUnit, lerp, metersPerUnitForDistance, metersPerUnitForScale, scaleFromFocusDistance,
  smootherstep, smoothstep, unitBandsInScaleRange, visibleExtentM, zoomScaleByAltitude, type LengthInUnit,
} from './scale';
import { AU_M, DEG, KPC_M, LUNAR_DISTANCE_M, LY_M, MPC_M, PC_M, R_EARTH_MEAN_M } from './units';

const FOV = 50 * DEG;

describe('interpolation helpers', () => {
  it('clamp / lerp / inverseLerp', () => {
    expect(clamp(5, 0, 1)).toBe(1);
    expect(clamp(-5, 0, 1)).toBe(0);
    expect(lerp(2, 4, 0.25)).toBe(2.5);
    expect(inverseLerp(2, 4, 3)).toBe(0.5);
    expect(inverseLerp(3, 3, 9)).toBe(0);
  });

  it('smoothstep has the Hermite shape with flat ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 2)).toBe(1);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(10, 12, 10.5)).toBeCloseTo(0.15625, 12);
    const h = 1e-6;
    expect((smoothstep(0, 1, h) - smoothstep(0, 1, 0)) / h).toBeLessThan(1e-5);
    expect((smoothstep(0, 1, 1) - smoothstep(0, 1, 1 - h)) / h).toBeLessThan(1e-5);
  });

  it('smoothstep / smootherstep degrade to a hard step when the edges coincide', () => {
    expect(smoothstep(3, 3, 2.9)).toBe(0);
    expect(smoothstep(3, 3, 3)).toBe(1);
    expect(smootherstep(3, 3, 2.9)).toBe(0);
    expect(smootherstep(3, 3, 3.1)).toBe(1);
  });

  it('smootherstep and easeInOutCubic are symmetric and monotonic', () => {
    let prevA = -1, prevB = -1;
    for (let i = 0; i <= 100; i++) {
      const t = i / 100;
      const a = smootherstep(0, 1, t), b = easeInOutCubic(t);
      expect(a).toBeGreaterThanOrEqual(prevA);
      expect(b).toBeGreaterThanOrEqual(prevB);
      expect(a + smootherstep(0, 1, 1 - t)).toBeCloseTo(1, 12);
      expect(b + easeInOutCubic(1 - t)).toBeCloseTo(1, 12);
      prevA = a;
      prevB = b;
    }
    expect(easeInOutCubic(-1)).toBe(0);
    expect(easeInOutCubic(2)).toBe(1);
  });
});

describe('scale ↔ focus distance', () => {
  it('scale = log10(2 d tan(fovY/2))', () => {
    const d = 2.5e7;
    expect(scaleFromFocusDistance(d, FOV)).toBeCloseTo(Math.log10(2 * d * Math.tan(FOV / 2)), 12);
    expect(visibleExtentM(7)).toBe(1e7);
  });

  it('round-trips over the whole universe range', () => {
    for (let s = SCALE_MIN_LOG10; s <= SCALE_MAX_LOG10; s += 0.5) {
      expect(scaleFromFocusDistance(focusDistanceFromScale(s, FOV), FOV)).toBeCloseTo(s, 10);
    }
  });

  it('maps degenerate distances to the minimum scale instead of NaN / −Infinity', () => {
    expect(scaleFromFocusDistance(0, FOV)).toBe(SCALE_MIN_LOG10);
    expect(scaleFromFocusDistance(-1, FOV)).toBe(SCALE_MIN_LOG10);
    expect(scaleFromFocusDistance(Number.NaN, FOV)).toBe(SCALE_MIN_LOG10);
  });

  it('clampScale bounds the ruler (observable universe Ø ≈ 8.8e26 m fits)', () => {
    expect(clampScale(-3)).toBe(SCALE_MIN_LOG10);
    expect(clampScale(40)).toBe(SCALE_MAX_LOG10);
    expect(Math.log10(8.8e26)).toBeLessThan(SCALE_MAX_LOG10);
  });
});

describe('metersPerUnit (render scale, docs §5.1)', () => {
  it('keeps the focus ~1000 render units away and clamps to [1e-3, 1e30]', () => {
    expect(FOCUS_RENDER_UNITS).toBe(1000);
    expect(metersPerUnitForDistance(2.5e7)).toBe(2.5e4);
    expect(metersPerUnitForDistance(0.5)).toBe(METERS_PER_UNIT_MIN);
    expect(metersPerUnitForDistance(1e40)).toBe(METERS_PER_UNIT_MAX);
    expect(metersPerUnitForDistance(0)).toBe(METERS_PER_UNIT_MIN);
    expect(metersPerUnitForDistance(Number.NaN)).toBe(METERS_PER_UNIT_MIN);
  });

  it('is consistent with the scale definition', () => {
    const s = 12.3;
    expect(metersPerUnitForScale(s, FOV)).toBeCloseTo(focusDistanceFromScale(s, FOV) / 1000, 0);
  });
});

describe('log-altitude zoom near a surface', () => {
  const R = R_EARTH_MEAN_M;
  const minD = 1.02 * R;

  it('scales the altitude, not the centre distance', () => {
    const s0 = scaleFromFocusDistance(R + 1e7, FOV);
    const s1 = zoomScaleByAltitude(s0, -1, R, minD, FOV);
    expect(focusDistanceFromScale(s1, FOV) - R).toBeCloseTo(1e6, 3);
  });

  it('never goes below 1.02 R however hard the user zooms in', () => {
    let s = scaleFromFocusDistance(3 * R, FOV);
    for (let i = 0; i < 50; i++) s = zoomScaleByAltitude(s, -0.5, R, minD, FOV);
    expect(focusDistanceFromScale(s, FOV)).toBeCloseTo(minD, 0);
  });

  it('behaves like a plain distance zoom far from the body', () => {
    const s0 = 20;
    expect(zoomScaleByAltitude(s0, 0.3, R, minD, FOV)).toBeCloseTo(20.3, 6);
  });

  it('accepts bodies without a radius', () => {
    const s = zoomScaleByAltitude(5, -1, 0, 10, FOV);
    expect(s).toBeCloseTo(4, 6);
    expect(Number.isFinite(zoomScaleByAltitude(5, -100, 0, 10, FOV))).toBe(true);
  });

  it('stays within the ruler range', () => {
    expect(zoomScaleByAltitude(27, 5, R, minD, FOV)).toBe(SCALE_MAX_LOG10);
  });
});

describe('ruler units', () => {
  it('lists bands in increasing order', () => {
    for (const bands of [RULER_BANDS, LIGHT_TIME_BANDS]) {
      for (let i = 1; i < bands.length; i++) expect(bands[i].fromM).toBeGreaterThan(bands[i - 1].fromM);
    }
  });

  it('picks the unit that keeps numbers readable', () => {
    expect(bestLengthUnit(500).id).toBe('m');
    expect(bestLengthUnit(4e5).id).toBe('km');
    expect(bestLengthUnit(4.2e7).id).toBe('R_earth');
    expect(bestLengthUnit(LUNAR_DISTANCE_M * 3).id).toBe('LD');
    expect(bestLengthUnit(30 * AU_M).id).toBe('AU');
    expect(bestLengthUnit(4.2 * LY_M).id).toBe('pc');
    expect(bestLengthUnit(0.5 * LY_M).id).toBe('ly');
    expect(bestLengthUnit(8.2 * KPC_M).id).toBe('kpc');
    expect(bestLengthUnit(16.5 * MPC_M).id).toBe('Mpc');
    expect(bestLengthUnit(14e3 * MPC_M).id).toBe('Gpc');
    expect(bestLengthUnit(-4e5).id).toBe('km');
  });

  it('chooses light-travel units for the secondary label', () => {
    expect(bestLengthUnit(AU_M, LIGHT_TIME_BANDS).id).toBe('lmin');
    expect(bestLengthUnit(30 * AU_M, LIGHT_TIME_BANDS).id).toBe('lh');
    expect(bestLengthUnit(300 * AU_M, LIGHT_TIME_BANDS).id).toBe('ld');
    expect(bestLengthUnit(PC_M, LIGHT_TIME_BANDS).id).toBe('ly');
    expect(bestLengthUnit(1e8, LIGHT_TIME_BANDS).id).toBe('ls');
  });

  it('expresses lengths in the best unit, optionally into a reused object', () => {
    const r = lengthInBestUnit(AU_M);
    expect(r.unit.id).toBe('AU');
    expect(r.value).toBeCloseTo(1, 12);
    const out: LengthInUnit = { unit: lengthUnit('m'), value: 0 };
    const same = lengthInBestUnit(PC_M * 1300, RULER_BANDS, out);
    expect(same).toBe(out);
    expect(out.unit.id).toBe('kpc');
    expect(out.value).toBeCloseTo(1.3, 12);
  });

  it('returns contiguous band spans for a scale window', () => {
    const spans = unitBandsInScaleRange(5, 23);
    expect(spans[0].fromScale).toBe(5);
    expect(spans[spans.length - 1].toScale).toBe(23);
    for (let i = 1; i < spans.length; i++) expect(spans[i].fromScale).toBeCloseTo(spans[i - 1].toScale, 12);
    expect(spans.map(s => s.unit.id)).toEqual(['km', 'R_earth', 'LD', 'AU', 'ly', 'pc', 'kpc', 'Mpc']);
    expect(unitBandsInScaleRange(2, 2.5).map(s => s.unit.id)).toEqual(['m']);
  });
});
