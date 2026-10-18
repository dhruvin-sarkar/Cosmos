import { describe, expect, it } from 'vitest';
import { comparisonFor, decadeOf, fieldOfViewLine, rulerTicks, UNIT_BANDS } from './scale';

describe('cosmic ruler scale', () => {
  it('produces slide-rule ticks with majors at powers of ten', () => {
    const t = rulerTicks(7, 9);
    expect(t.filter(x => x.major).map(x => x.exponent)).toEqual([7, 8, 9]);
    expect(t.length).toBe(19);
  });
  it('compares field widths in plain language', () => {
    expect(comparisonFor(1.27e7)).toBe("about Earth's diameter");
    expect(comparisonFor(3.9e7)).toMatch(/^about 3 times Earth's diameter$/);
    expect(comparisonFor(0.5)).toBe('about a person');
  });
  it('builds a field-of-view line', () => {
    expect(fieldOfViewLine(Math.log10(1.27e7))).toMatch(/^Field of view ≈ 13,000 km|^Field of view ≈ 12/);
    expect(fieldOfViewLine(Number.NaN)).toBe('Field of view unknown');
  });
  it('clamps decades and lists unit bands', () => {
    expect(decadeOf(30)).toBe(27);
    expect(decadeOf(7.99)).toBe(7);
    expect(UNIT_BANDS.some(b => b.id === 'AU')).toBe(true);
  });
});
