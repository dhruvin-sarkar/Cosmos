import { describe, expect, it } from 'vitest';
import {
  ARCSEC, AU_M, C_M_PER_S, DEG, GPC_M, JULIAN_YEAR_S, KPC_M, LUNAR_DISTANCE_M, MAS, MICROARCSEC, M_EARTH_KG,
  M_JUPITER_KG, M_SUN_KG, PC_M,
} from '../core/units';
import type { Quantity } from './provenance';
import {
  convertUnit, formatAgeDays, formatAngle, formatDeclination, formatDistance, formatDistanceParts, formatDuration,
  formatFact, formatInteger, formatLatitude, formatLongitude, formatMass, formatNumber, formatPercent,
  formatPowerOfTen, formatQuantity, formatQuantityParts, formatRightAscension, formatScale, formatScaleParts,
  formatScientific, formatSimDate, formatTemperature, formatTimeRate, formatVelocity, toSuperscript, unitLabel,
  unitName,
} from './format';

const MINUS = '−';
const q = (value: number | null, unit: string, extra: Partial<Quantity> = {}): Quantity => ({ value, unit, provenance: 'observed', ...extra });

describe('formatNumber', () => {
  it('renders missing and non-finite values honestly', () => {
    expect(formatNumber(null)).toBe('Unknown');
    expect(formatNumber(undefined)).toBe('Unknown');
    expect(formatNumber(Number.NaN)).toBe('Unknown');
    expect(formatNumber(Infinity)).toBe('∞');
    expect(formatNumber(-Infinity)).toBe(`${MINUS}∞`);
    expect(formatNumber(0)).toBe('0');
  });

  it('uses 3 significant digits, widened for whole numbers, with grouping', () => {
    expect(formatNumber(0.0123)).toBe('0.0123');
    expect(formatNumber(-12.34)).toBe(`${MINUS}12.3`);
    expect(formatNumber(5772)).toBe('5,772');
    expect(formatNumber(42164)).toBe('42,164');
    expect(formatNumber(384399)).toBe('384,400');
  });

  it('uses words for millions to trillions and superscript exponents beyond', () => {
    expect(formatNumber(2.54e6)).toBe('2.54 million');
    expect(formatNumber(149.6e6)).toBe('149.6 million');
    expect(formatNumber(4.57e9)).toBe('4.57 billion');
    expect(formatNumber(1.5e12)).toBe('1.50 trillion');
    expect(formatNumber(1.5e12, { trimZeros: true })).toBe('1.5 trillion');
    expect(formatNumber(999_999_999)).toBe('1.00 billion');
    expect(formatNumber(1.2e18)).toBe('1.20 × 10¹⁸');
    expect(formatNumber(3.2e-5)).toBe('3.20 × 10⁻⁵');
    expect(formatNumber(2.5e6, { words: false })).toBe('2.50 × 10⁶');
  });

  it('supports fixed decimals without negative zero', () => {
    expect(formatNumber(1234.5678, { decimals: 2 })).toBe('1,234.57');
    expect(formatNumber(-0.0001, { decimals: 2 })).toBe('0.00');
    expect(formatInteger(6445)).toBe('6,445');
    expect(formatPercent(0.1234)).toBe('12.3%');
  });

  it('formats exponents with real superscripts', () => {
    expect(formatScientific(1.2e9, 2)).toBe('1.2 × 10⁹');
    expect(formatScientific(-4.56e-7)).toBe(`${MINUS}4.56 × 10⁻⁷`);
    expect(formatScientific(3)).toBe('3.00');
    expect(toSuperscript('-12')).toBe('⁻¹²');
    expect(formatPowerOfTen(12)).toBe('10¹²');
    expect(formatPowerOfTen(-3)).toBe('10⁻³');
  });
});

describe('formatDistance', () => {
  it('picks context units with educational secondary comparisons', () => {
    expect(formatDistance(LUNAR_DISTANCE_M)).toBe('384,400 km · 1.28 light-s');
    expect(formatDistance(1.3 * PC_M)).toBe('4.24 ly · 1.30 pc');
    expect(formatDistance(AU_M)).toBe('1.00 AU · 8.32 light-min');
    expect(formatDistance(42_164e3)).toBe('42,164 km · 6.62 R⊕');
    expect(formatDistance(30.07 * AU_M)).toBe('30.1 AU · 4.17 light-h');
    expect(formatDistance(2000 * AU_M)).toBe('2,000 AU · 11.6 light-d');
    expect(formatDistance(20000 * AU_M)).toBe('20,000 AU · 0.316 ly');
    expect(formatDistance(8.18 * KPC_M)).toBe('26,680 ly · 8.18 kpc');
    expect(formatDistance(765 * KPC_M)).toBe('2.50 million ly · 765 kpc');
    expect(formatDistance(14 * GPC_M)).toBe('45.7 billion ly · 14.0 Gpc');
  });

  it('handles small distances and unit boundaries', () => {
    expect(formatDistance(420e3)).toBe('420 km');
    expect(formatDistance(350)).toBe('350 m');
    expect(formatDistance(0.1)).toBe('10.0 cm');
    expect(formatDistance(999.96)).toBe('1.00 km');
    expect(formatDistance(null)).toBe('Unknown');
    expect(formatDistance(Number.NaN)).toBe('Unknown');
  });

  it('honours unit, secondary and parsec preferences', () => {
    expect(formatDistance(LUNAR_DISTANCE_M, { secondary: 'none' })).toBe('384,400 km');
    expect(formatDistance(AU_M, { unit: 'km' })).toBe('149.6 million km · 8.32 light-min');
    expect(formatDistance(765 * KPC_M, { prefer: 'pc' })).toBe('765 kpc · 2.50 million ly');
    expect(formatDistance(LUNAR_DISTANCE_M, { secondary: 'LD' })).toBe('384,400 km · 1.00 LD');
  });

  it('exposes structured parts for styling and aria labels', () => {
    const p = formatDistanceParts(AU_M);
    expect(p.primary).toEqual({ value: '1.00', unit: 'AU', unitName: 'astronomical units', text: '1.00 AU' });
    expect(p.secondary?.unitName).toBe('light-minutes');
  });
});

describe('formatMass', () => {
  it('chooses kg, Earth, Jupiter and solar masses by context', () => {
    expect(formatMass(721)).toBe('721 kg');
    expect(formatMass(0.25)).toBe('250 g');
    expect(formatMass(4.3e9)).toBe('4.30 billion kg');
    expect(formatMass(7.342e22)).toBe('0.0123 M⊕ · 7.34 × 10²² kg');
    expect(formatMass(M_EARTH_KG)).toBe('1.00 M⊕ · 5.97 × 10²⁴ kg');
    expect(formatMass(M_JUPITER_KG)).toBe('1.00 M♃ · 318 M⊕');
    expect(formatMass(0.1221 * M_SUN_KG)).toBe('0.122 M☉ · 128 M♃');
    expect(formatMass(M_SUN_KG)).toBe('1.00 M☉ · 1.99 × 10³⁰ kg');
    expect(formatMass(4.297e6 * M_SUN_KG)).toBe('4.30 million M☉');
    expect(formatMass(undefined)).toBe('Unknown');
  });
});

describe('formatDuration', () => {
  it('uses one friendly unit by default', () => {
    expect(formatDuration(0.25)).toBe('250 ms');
    expect(formatDuration(5560)).toBe('92.7 min');
    expect(formatDuration(-3600)).toBe(`${MINUS}60.0 min`);
    expect(formatDuration(27.321661 * 86400)).toBe('27.3 days');
    expect(formatDuration(11.862 * JULIAN_YEAR_S)).toBe('11.9 years');
    expect(formatDuration(25772 * JULIAN_YEAR_S)).toBe('25,772 years');
    expect(formatDuration(4.57e9 * JULIAN_YEAR_S)).toBe('4.57 billion years');
    expect(formatDuration(null)).toBe('Unknown');
  });

  it('supports short and compound styles', () => {
    expect(formatDuration(27.3 * 86400, { style: 'short' })).toBe('27.3 d');
    expect(formatDuration(4.57e9 * JULIAN_YEAR_S, { style: 'short' })).toBe('4.57 Gyr');
    expect(formatDuration(499.0048, { style: 'compound' })).toBe('8 min 19 s');
    expect(formatDuration(5560, { style: 'compound' })).toBe('1 h 33 min');
    expect(formatDuration(3599.6, { style: 'compound' })).toBe('1 h');
    expect(formatDuration(1, { style: 'compound' })).toBe('1 s');
  });
});

describe('formatVelocity', () => {
  it('spans mm/s (DART) to relativistic speeds', () => {
    expect(formatVelocity(0.0027)).toBe('2.70 mm/s');
    expect(formatVelocity(250)).toBe('250 m/s');
    expect(formatVelocity(7660)).toBe('7.66 km/s');
    expect(formatVelocity(7.65e6)).toBe('7,650 km/s · 2.55% of c');
    expect(formatVelocity(0.99 * C_M_PER_S)).toBe('296,790 km/s · 0.990 c');
    expect(formatVelocity(7660, { secondary: 'km/h' })).toBe('7.66 km/s · 27,600 km/h');
  });
});

describe('formatTemperature', () => {
  it('adds °C only in the terrestrial range', () => {
    expect(formatTemperature(255)).toBe(`255 K · ${MINUS}18 °C`);
    expect(formatTemperature(737)).toBe('737 K · 464 °C');
    expect(formatTemperature(5772)).toBe('5,772 K');
    expect(formatTemperature(2.7255)).toBe('2.73 K');
    expect(formatTemperature(15.7e6)).toBe('15.7 million K');
    expect(formatTemperature(288, { celsius: 'never' })).toBe('288 K');
    expect(formatTemperature(-5)).toBe('Unknown');
  });
});

describe('angles and sky coordinates', () => {
  it('chooses degrees down to microarcseconds', () => {
    expect(formatAngle(23.44 * DEG)).toBe('23.4°');
    expect(formatAngle(0.518 * DEG)).toBe('31.1′');
    expect(formatAngle(1.85 * ARCSEC)).toBe('1.85″');
    expect(formatAngle(768.07 * MAS)).toBe('768 mas');
    expect(formatAngle(52 * MICROARCSEC)).toBe('52.0 µas');
  });

  it('formats RA / Dec / lat / lon', () => {
    const ra = (14 + 29 / 60 + 42.96 / 3600) * 15 * DEG;
    expect(formatRightAscension(ra)).toBe('14h 29m 43.0s');
    expect(formatRightAscension(2 * Math.PI - 1e-12)).toBe('00h 00m 00.0s');
    expect(formatDeclination(-(62 + 40 / 60 + 46.1 / 3600) * DEG)).toBe(`${MINUS}62° 40′ 46″`);
    expect(formatDeclination((7 + 24 / 60 + 25 / 3600) * DEG)).toBe('+07° 24′ 25″');
    expect(formatLatitude(24.4539 * DEG)).toBe('24.45° N');
    expect(formatLongitude(54.3773 * DEG)).toBe('54.38° E');
    expect(formatLongitude(-118.24 * DEG)).toBe('118.24° W');
    expect(formatLongitude(200 * DEG)).toBe('160.00° W');
  });
});

describe('formatQuantity', () => {
  it('shows Unknown for missing values, never 0', () => {
    expect(formatQuantity(q(null, 'K'))).toBe('Unknown');
    expect(formatQuantity(undefined)).toBe('Unknown');
    expect(formatQuantityParts(q(null, 'K')).known).toBe(false);
  });

  it('rounds uncertainties with the PDG rule and aligns the value', () => {
    expect(formatQuantity(q(1.3012, 'pc', { uncertainty: { kind: 'symmetric', sigma: 0.0213 } }))).toBe('1.301 ± 0.021 pc');
    expect(formatQuantity(q(4.2465, 'ly', { uncertainty: { kind: 'symmetric', sigma: 0.0005 } }))).toBe('4.2465 ± 0.0005 ly');
    expect(formatQuantity(q(1.07, 'M_earth', { uncertainty: { kind: 'asymmetric', plus: 0.06, minus: 0.04 } })))
      .toBe(`1.07 +0.06 / ${MINUS}0.04 M⊕`);
    expect(formatQuantity(q(1.07, 'M_earth', { uncertainty: { kind: 'asymmetric', plus: 0.051, minus: 0.049 } })))
      .toBe('1.07 ± 0.05 M⊕');
    expect(formatQuantity(q(4.297e6, 'M_sun', { uncertainty: { kind: 'symmetric', sigma: 0.012e6 } })))
      .toBe('(4.297 ± 0.012) million M☉');
    expect(formatQuantity(q(23.4393, 'deg', { uncertainty: { kind: 'symmetric', sigma: 0.0001 } })))
      .toBe('(23.43930 ± 0.00010)°');
  });

  it('formats ranges and limits', () => {
    expect(formatQuantity(q(1.1, 'AU', { uncertainty: { kind: 'range', min: 0.9, max: 1.4 } }))).toBe(`1.10 (0.90 ${'–'} 1.40) AU`);
    expect(formatQuantity(q(1.3, 'M_jup', { sigDigits: 2, uncertainty: { kind: 'limit', type: 'upper' } }))).toBe('< 1.3 M♃');
    expect(formatQuantity(q(0.5, 'Gyr', { sigDigits: 1, uncertainty: { kind: 'limit', type: 'lower' } }))).toBe('> 0.5 billion years');
    expect(formatQuantityParts(q(1.3, 'M_jup', { uncertainty: { kind: 'limit', type: 'upper' } })).limit).toBe('upper');
  });

  it('respects sigDigits, units and options', () => {
    expect(formatQuantity(q(0.04851, 'AU', { sigDigits: 3 }))).toBe('0.0485 AU');
    expect(formatQuantity(q(1, 'd', { sigDigits: 1 }))).toBe('1 day');
    expect(formatQuantity(q(5, 'furlong'))).toBe('5.00 furlong');
    expect(formatQuantity(q(0.0167, ''))).toBe('0.0167');
    expect(formatQuantity(q(63241.077, 'AU'), { smart: true })).toBe('1.00 ly');
    expect(formatQuantity(q(2000, 'km', { uncertainty: { kind: 'symmetric', sigma: 10 } }), { smart: true })).toBe('2,000 ± 10 km');
    expect(formatQuantity(q(1.3012, 'pc', { uncertainty: { kind: 'symmetric', sigma: 0.0213 } }), { showUncertainty: false })).toBe('1.30 pc');
  });

  it('formats facts and exposes unit metadata', () => {
    expect(formatFact({ text: 'M5.5Ve' })).toBe('M5.5Ve');
    expect(formatFact({})).toBe('Unknown');
    expect(formatFact({ quantity: q(255, 'K') })).toBe('255 K');
    expect(unitLabel('M_earth')).toBe('M⊕');
    expect(unitLabel('Mjup')).toBe('M♃');
    expect(unitName('pc')).toBe('parsecs');
    expect(convertUnit(1, 'AU', 'km')).toBeCloseTo(149_597_870.7, 3);
    expect(convertUnit(1, 'AU', 'kg')).toBeNull();
  });
});

describe('dates, rates and scale', () => {
  const t = Date.UTC(2026, 9, 16, 20, 15, 3);

  it('formats simulation dates in UTC', () => {
    expect(formatSimDate(t)).toBe('2026-10-16 20:15:03 UTC');
    expect(formatSimDate(t, { style: 'date' })).toBe('2026-10-16');
    expect(formatSimDate(t, { style: 'time' })).toBe('20:15:03 UTC');
    expect(formatSimDate(t, { style: 'long' })).toBe('16 Oct 2026, 20:15 UTC');
    expect(formatSimDate(t, { style: 'iso' })).toBe('2026-10-16T20:15:03Z');
    expect(formatSimDate(t, { seconds: false })).toBe('2026-10-16 20:15 UTC');
    expect(formatSimDate(Date.UTC(-500, 2, 1), { style: 'date' })).toBe(`${MINUS}0500-03-01`);
    expect(formatSimDate(Date.UTC(-500, 2, 1), { style: 'long' })).toBe('1 Mar 501 BCE, 00:00 UTC');
    expect(formatSimDate(Date.UTC(12000, 0, 1), { style: 'date' })).toBe('+12000-01-01');
    expect(formatSimDate(Number.NaN)).toBe('Unknown');
    expect(formatSimDate(1e16)).toBe('Unknown');
  });

  it('formats time rates', () => {
    expect(formatTimeRate(0)).toBe('Paused');
    expect(formatTimeRate(86400, true)).toBe('Paused');
    expect(formatTimeRate(1)).toBe('Real time');
    expect(formatTimeRate(10)).toBe('10 s / s');
    expect(formatTimeRate(0.5)).toBe('0.5 s / s');
    expect(formatTimeRate(60)).toBe('1 min / s');
    expect(formatTimeRate(3600)).toBe('1 h / s');
    expect(formatTimeRate(86400)).toBe('1 day / s');
    expect(formatTimeRate(172800)).toBe('2 days / s');
    expect(formatTimeRate(1e7)).toBe('116 days / s');
    expect(formatTimeRate(-JULIAN_YEAR_S)).toBe(`${MINUS}1 yr / s`);
    expect(formatTimeRate(Number.NaN)).toBe('Unknown');
  });

  it('formats the Cosmic Ruler scale', () => {
    expect(formatScale(12)).toBe('10¹² m');
    expect(formatScale(-1)).toBe('10⁻¹ m');
    expect(formatScale(-0.2)).toBe('10⁰ m');
    expect(formatScale(12.34, { decimals: 1 })).toBe('10¹²·³ m');
    expect(formatScale(26.94)).toBe('10²⁷ m');
    expect(formatScaleParts(Math.log10(AU_M))).toEqual({ power: '10¹¹ m', friendly: '1.00 AU · 8.32 light-min' });
  });

  it('formats dataset ages', () => {
    expect(formatAgeDays(0.5)).toBe('today');
    expect(formatAgeDays(1)).toBe('1 day ago');
    expect(formatAgeDays(3.7)).toBe('3 days ago');
    expect(formatAgeDays(90)).toBe('3 months ago');
    expect(formatAgeDays(400)).toBe('1 year ago');
    expect(formatAgeDays(800)).toBe('2 years ago');
    expect(formatAgeDays(null)).toBe('Unknown');
  });
});
