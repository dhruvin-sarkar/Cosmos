/**
 * Human-friendly scientific formatting for the HUD, inspector, labs and labels.
 *
 * Units are part of the lesson: each formatter picks a unit that fits the magnitude (km near Earth, AU in
 * the Solar System, light-years between stars, Mpc between galaxies) and can add a secondary comparison
 * ("384,400 km · 1.28 light-s", "4.24 ly · 1.30 pc"). Primary UI text avoids raw exponent notation: large
 * values use words ("4.57 billion years") and only extreme values fall back to "1.2 × 10⁹" with real
 * superscript digits.
 *
 * Conventions
 *  - Inputs are SI (m, kg, s, m/s, K, rad, Unix ms) unless the function name says otherwise.
 *  - Missing values (null / undefined / NaN) render as "Unknown" — never as 0.
 *  - Typographic minus (U+2212), en-US digit grouping ("6,371"), a plain space between value and unit
 *    except for °, ′, ″ and %.
 *  - Default precision: 3 significant digits, widened for whole numbers so they stay readable
 *    (6,371 · 42,164 · 384,400). Catalog quantities use their own `sigDigits` / uncertainty instead.
 *  - Output is plain text (never HTML), safe to place in textContent / aria-labels.
 */
import {
  ARCSEC, AU_M, C_M_PER_S, DEG, JULIAN_YEAR_S, LENGTH_UNITS, LIGHT_DAY_M, LIGHT_HOUR_M, LUNAR_DISTANCE_M, LY_M,
  L_SUN_W, MAS, MICROARCSEC, M_EARTH_KG, M_JUPITER_KG, M_SUN_KG, PC_M, R_EARTH_MEAN_M, R_JUPITER_EQ_M, R_SUN_M,
  SECONDS_PER_DAY, type LengthUnitId,
} from '../core/units';
import type { Fact, Quantity, Uncertainty } from './provenance';

// ── Typography ───────────────────────────────────────────────────────────────────────────────

export const UNKNOWN_TEXT = 'Unknown';
export const MINUS_SIGN = '−';
/** Separator between a primary value and its secondary comparison: "4.24 ly · 1.30 pc". */
export const SECONDARY_SEPARATOR = ' · ';
const TIMES = '×';
const PLUS_MINUS = '±';
const EN_DASH = '–';
const INFINITY = '∞';

const SUPERSCRIPT: Readonly<Record<string, string>> = {
  '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹',
  '-': '⁻', '−': '⁻', '+': '⁺', '.': '·',
};

/** Map digits, signs and '.' to superscript characters ("-12" → "⁻¹²"); other characters pass through. */
export function toSuperscript(value: number | string): string {
  const s = typeof value === 'number' ? String(value) : value;
  let out = '';
  for (const ch of s) out += SUPERSCRIPT[ch] ?? ch;
  return out;
}

/** "10¹²" — a power of ten with a superscript exponent (`decimals` > 0 renders "10¹²·³"). */
export function formatPowerOfTen(exponent: number, decimals = 0): string {
  if (!Number.isFinite(exponent)) return UNKNOWN_TEXT;
  const e = decimals > 0 ? exponent.toFixed(decimals) : String(Math.round(exponent));
  return `10${toSuperscript(e === '-0' ? '0' : e)}`;
}

// ── Number core ──────────────────────────────────────────────────────────────────────────────

function nonFinite(x: number): string {
  if (Number.isNaN(x)) return UNKNOWN_TEXT;
  return x > 0 ? INFINITY : MINUS_SIGN + INFINITY;
}

function clampSig(sig: number): number {
  return Math.min(21, Math.max(1, Math.round(sig)));
}

/** floor(log10(a)) for finite a > 0, exact at powers of ten. */
function exponentOf(a: number): number {
  const s = a.toExponential();
  return Number(s.slice(s.indexOf('e') + 1));
}

function roundSig(x: number, sig: number): number {
  return x === 0 ? 0 : Number(x.toPrecision(clampSig(sig)));
}

function groupInt(int: string): string {
  const n = int.length;
  if (n <= 3) return int;
  let out = '';
  for (let i = 0; i < n; i++) {
    if (i > 0 && (n - i) % 3 === 0) out += ',';
    out += int[i];
  }
  return out;
}

function trimFraction(s: string): string {
  if (s.indexOf('.') < 0) return s;
  const t = s.replace(/0+$/, '');
  return t.endsWith('.') ? t.slice(0, -1) : t;
}

/** Fixed-point text with grouping; negative `decimals` rounds to tens, hundreds, … */
function fixed(x: number, decimals: number, group = true, trim = false): string {
  let v = x;
  let d = Math.round(decimals);
  if (d < 0) {
    const f = 10 ** -d;
    v = Math.round(x / f) * f;
    d = 0;
  }
  let s = Math.abs(v).toFixed(Math.min(20, d));
  if (trim) s = trimFraction(s);
  const negative = v < 0 && /[1-9]/.test(s);
  const dot = s.indexOf('.');
  const int = dot < 0 ? s : s.slice(0, dot);
  const frac = dot < 0 ? '' : s.slice(dot);
  return (negative ? MINUS_SIGN : '') + (group ? groupInt(int) : int) + frac;
}

/** Decimal places needed to show `sig` significant digits of x (negative = round to tens, …). */
function sigDecimals(x: number, sig: number): number {
  const r = Math.abs(roundSig(x, sig));
  return r === 0 ? 0 : clampSig(sig) - 1 - exponentOf(r);
}

function formatSig(x: number, sig: number, group: boolean, trim: boolean): string {
  const s = clampSig(sig);
  const r = roundSig(x, s);
  return fixed(r, Math.max(0, sigDecimals(r, s)), group, trim);
}

/** Default significant digits for a magnitude: 3, widened so whole numbers keep their digits (5,772 · 42,164). */
export function autoSigDigits(magnitude: number): number {
  const a = Math.abs(magnitude);
  return a < 1e3 ? 3 : a < 1e4 ? 4 : 5;
}

const WORD_SCALES: ReadonlyArray<{ factor: number; word: string }> = [
  { factor: 1e12, word: 'trillion' },
  { factor: 1e9, word: 'billion' },
  { factor: 1e6, word: 'million' },
];

export interface NumberFormatOptions {
  /** Significant digits (default: 3, more for whole numbers ≥ 1,000; see autoSigDigits). */
  sigDigits?: number;
  /** Fixed decimal places (overrides sigDigits, disables words / exponent notation). */
  decimals?: number;
  /** Thousands separators (default true). */
  group?: boolean;
  /** "1.5 million" … "2.3 trillion" for 10⁶ ≤ |x| < 10¹⁵ (default true); otherwise × 10ⁿ from 10⁶. */
  words?: boolean;
  /** Drop insignificant trailing zeros ("1.50" → "1.5"). Default false: trailing zeros carry precision. */
  trimZeros?: boolean;
}

/** "1.23 × 10⁻⁵" — exponent notation with superscript digits (exponent 0 prints the plain mantissa). */
export function formatScientific(x: number | null | undefined, sigDigits = 3, opts: { trimZeros?: boolean } = {}): string {
  if (x == null) return UNKNOWN_TEXT;
  if (!Number.isFinite(x)) return nonFinite(x);
  if (x === 0) return '0';
  const s = Math.abs(x).toExponential(clampSig(sigDigits) - 1);
  const e = s.indexOf('e');
  let mantissa = s.slice(0, e);
  const exponent = Number(s.slice(e + 1));
  if (opts.trimZeros) mantissa = trimFraction(mantissa);
  const sign = x < 0 ? MINUS_SIGN : '';
  if (exponent === 0) return sign + mantissa;
  return `${sign}${mantissa} ${TIMES} 10${toSuperscript(exponent)}`;
}

function formatWords(x: number, sigDigits: number | undefined, trim: boolean): string {
  const a = Math.abs(x);
  let idx = a >= 1e12 ? 0 : a >= 1e9 ? 1 : 2;
  let scaled = a / WORD_SCALES[idx].factor;
  let sig = sigDigits ?? (scaled < 100 ? 3 : 4);
  if (Math.abs(roundSig(scaled, sig)) >= 1000) {
    if (idx === 0) return formatScientific(x, sigDigits ?? 3, { trimZeros: trim });
    idx -= 1;
    scaled = a / WORD_SCALES[idx].factor;
    sig = sigDigits ?? 3;
  }
  return `${x < 0 ? MINUS_SIGN : ''}${formatSig(scaled, sig, true, trim)} ${WORD_SCALES[idx].word}`;
}

/**
 * General number formatting: "0.0123", "5,772", "384,400", "2.54 million", "1.2 × 10¹⁸".
 * null / undefined / NaN → "Unknown"; ±Infinity → "∞".
 */
export function formatNumber(x: number | null | undefined, opts: NumberFormatOptions = {}): string {
  if (x == null) return UNKNOWN_TEXT;
  if (!Number.isFinite(x)) return nonFinite(x);
  const group = opts.group ?? true;
  const trim = opts.trimZeros ?? false;
  if (opts.decimals != null) return fixed(x, opts.decimals, group, trim);
  if (x === 0) return '0';
  const a = Math.abs(x);
  if (a < 1e-3) return formatScientific(x, opts.sigDigits ?? 3, { trimZeros: trim });
  const sig = opts.sigDigits ?? autoSigDigits(a);
  if (Math.abs(roundSig(a, sig)) >= 1e6) {
    if ((opts.words ?? true) && a < 1e15) return formatWords(x, opts.sigDigits, trim);
    return formatScientific(x, opts.sigDigits ?? 3, { trimZeros: trim });
  }
  return formatSig(x, sig, group, trim);
}

/** Whole number with grouping: 6445 → "6,445". */
export function formatInteger(n: number | null | undefined): string {
  if (n == null) return UNKNOWN_TEXT;
  if (!Number.isFinite(n)) return nonFinite(n);
  return fixed(Math.round(n), 0, true);
}

/** Fraction → percent: 0.123 → "12.3%". */
export function formatPercent(fraction: number | null | undefined, opts: { sigDigits?: number; decimals?: number } = {}): string {
  if (fraction == null || !Number.isFinite(fraction)) return fraction == null ? UNKNOWN_TEXT : nonFinite(fraction);
  return `${formatNumber(fraction * 100, { sigDigits: opts.sigDigits ?? 3, decimals: opts.decimals, words: false })}%`;
}

// ── Display units ────────────────────────────────────────────────────────────────────────────

export type UnitDimension = 'length' | 'mass' | 'time' | 'velocity' | 'angle' | 'temperature' | 'dimensionless' | 'other';

export interface DisplayUnit {
  readonly id: string;
  /** Short label shown after the number, e.g. "M⊕", "light-min", "°". */
  readonly label: string;
  /** Spoken / tooltip name, e.g. "Earth masses". */
  readonly name: string;
  readonly dimension: UnitDimension;
  /** Size of one unit in SI (m, kg, s, m/s, rad, K); absent when not linearly convertible. */
  readonly si?: number;
  /** Space between number and label ("5 km") — false for "45°", "31′", "12%". */
  readonly spaced: boolean;
  /** Label used when the value prints exactly "1" ("1 day"). */
  readonly singular?: string;
}

function unitDef(
  id: string, label: string, name: string, dimension: UnitDimension, si?: number, spaced = true, singular?: string,
): DisplayUnit {
  return { id, label, name, dimension, si, spaced, singular };
}

const UNIT_LIST: readonly DisplayUnit[] = [
  unitDef('', '', '', 'dimensionless', 1, false),
  // length
  unitDef('nm', 'nm', 'nanometers', 'length', 1e-9),
  unitDef('um', 'µm', 'micrometers', 'length', 1e-6),
  unitDef('mm', 'mm', 'millimeters', 'length', 1e-3),
  unitDef('cm', 'cm', 'centimeters', 'length', 1e-2),
  ...LENGTH_UNITS.map((u) => unitDef(u.id, u.label, u.name, 'length', u.meters)),
  unitDef('R_jup', 'R♃', 'Jupiter radii', 'length', R_JUPITER_EQ_M),
  unitDef('R_sun', 'R☉', 'solar radii', 'length', R_SUN_M),
  // mass
  unitDef('g', 'g', 'grams', 'mass', 1e-3),
  unitDef('kg', 'kg', 'kilograms', 'mass', 1),
  unitDef('t', 't', 'tonnes', 'mass', 1e3),
  unitDef('M_earth', 'M⊕', 'Earth masses', 'mass', M_EARTH_KG),
  unitDef('M_jup', 'M♃', 'Jupiter masses', 'mass', M_JUPITER_KG),
  unitDef('M_sun', 'M☉', 'solar masses', 'mass', M_SUN_KG),
  // time (year = Julian year, 365.25 d)
  unitDef('us', 'µs', 'microseconds', 'time', 1e-6),
  unitDef('ms', 'ms', 'milliseconds', 'time', 1e-3),
  unitDef('s', 's', 'seconds', 'time', 1),
  unitDef('min', 'min', 'minutes', 'time', 60),
  unitDef('h', 'h', 'hours', 'time', 3_600),
  unitDef('d', 'days', 'days', 'time', SECONDS_PER_DAY, true, 'day'),
  unitDef('yr', 'years', 'years', 'time', JULIAN_YEAR_S, true, 'year'),
  unitDef('kyr', 'thousand years', 'thousand years', 'time', 1e3 * JULIAN_YEAR_S),
  unitDef('Myr', 'million years', 'million years', 'time', 1e6 * JULIAN_YEAR_S),
  unitDef('Gyr', 'billion years', 'billion years', 'time', 1e9 * JULIAN_YEAR_S),
  // velocity
  unitDef('um/s', 'µm/s', 'micrometers per second', 'velocity', 1e-6),
  unitDef('mm/s', 'mm/s', 'millimeters per second', 'velocity', 1e-3),
  unitDef('cm/s', 'cm/s', 'centimeters per second', 'velocity', 1e-2),
  unitDef('m/s', 'm/s', 'meters per second', 'velocity', 1),
  unitDef('km/h', 'km/h', 'kilometers per hour', 'velocity', 1 / 3.6),
  unitDef('km/s', 'km/s', 'kilometers per second', 'velocity', 1e3),
  unitDef('c', 'c', 'times the speed of light', 'velocity', C_M_PER_S),
  // angle
  unitDef('rad', 'rad', 'radians', 'angle', 1),
  unitDef('deg', '°', 'degrees', 'angle', DEG, false),
  unitDef('arcmin', '′', 'arcminutes', 'angle', DEG / 60, false),
  unitDef('arcsec', '″', 'arcseconds', 'angle', ARCSEC, false),
  unitDef('mas', 'mas', 'milliarcseconds', 'angle', MAS),
  unitDef('uas', 'µas', 'microarcseconds', 'angle', MICROARCSEC),
  // temperature
  unitDef('K', 'K', 'kelvin', 'temperature', 1),
  unitDef('degC', '°C', 'degrees Celsius', 'temperature'),
  // other
  unitDef('%', '%', 'percent', 'dimensionless', 0.01, false),
  unitDef('ppm', 'ppm', 'parts per million', 'dimensionless', 1e-6),
  unitDef('bar', 'bar', 'bar', 'other'),
  unitDef('Pa', 'Pa', 'pascals', 'other'),
  unitDef('atm', 'atm', 'standard atmospheres', 'other'),
  unitDef('g/cm3', 'g/cm³', 'grams per cubic centimeter', 'other'),
  unitDef('kg/m3', 'kg/m³', 'kilograms per cubic meter', 'other'),
  unitDef('W/m2', 'W/m²', 'watts per square meter', 'other'),
  unitDef('S_earth', 'S⊕', 'times the insolation Earth receives', 'other'),
  unitDef('L_sun', 'L☉', 'solar luminosities', 'other', L_SUN_W),
  unitDef('m/s2', 'm/s²', 'meters per second squared', 'other'),
  unitDef('cm/s2', 'cm/s²', 'centimeters per second squared', 'other'),
  unitDef('g_earth', 'g', 'Earth gravities', 'other'),
  unitDef('km2', 'km²', 'square kilometers', 'other'),
  unitDef('deg/d', '°/d', 'degrees per day', 'other', undefined, false),
  unitDef('mag', 'mag', 'magnitudes', 'other'),
  unitDef('dex', 'dex', 'dex', 'other'),
  unitDef('W', 'W', 'watts', 'other'),
  unitDef('J', 'J', 'joules', 'other'),
  unitDef('N', 'N', 'newtons', 'other'),
  unitDef('Hz', 'Hz', 'hertz', 'other'),
  unitDef('Jy', 'Jy', 'janskys', 'other'),
  unitDef('kg/s', 'kg/s', 'kilograms per second', 'other'),
];

const UNIT_MAP: ReadonlyMap<string, DisplayUnit> = new Map(UNIT_LIST.map((u) => [u.id, u]));

/** Spellings seen in source catalogs, mapped onto the documented unit ids. */
const UNIT_ALIASES: Readonly<Record<string, string>> = {
  au: 'AU', 'R_Earth': 'R_earth', Rearth: 'R_earth', 'M_Earth': 'M_earth', Mearth: 'M_earth',
  M_Jup: 'M_jup', Mjup: 'M_jup', M_jupiter: 'M_jup', R_Jup: 'R_jup', Rjup: 'R_jup', R_jupiter: 'R_jup',
  M_Sun: 'M_sun', Msun: 'M_sun', R_Sun: 'R_sun', Rsun: 'R_sun', L_Sun: 'L_sun', Lsun: 'L_sun',
  day: 'd', days: 'd', year: 'yr', years: 'yr', y: 'yr', hr: 'h', sec: 's',
  '°': 'deg', degrees: 'deg', '°C': 'degC', C: 'degC', 'µas': 'uas', 'μas': 'uas',
  'km s-1': 'km/s', 'm s-1': 'm/s', 'g cm-3': 'g/cm3', 'g/cc': 'g/cm3', 'W m-2': 'W/m2',
  '1': '', none: '', dimensionless: '',
};

/** Look up a display unit by id (documented ids in src/data/provenance.ts, plus common catalog spellings). */
export function getDisplayUnit(id: string): DisplayUnit | undefined {
  return UNIT_MAP.get(id) ?? UNIT_MAP.get(UNIT_ALIASES[id] ?? '\u0000');
}

/** Short label for a unit id ("M_earth" → "M⊕"); unknown ids are returned unchanged. */
export function unitLabel(id: string): string {
  return getDisplayUnit(id)?.label ?? id;
}

/** Spoken name for a unit id ("pc" → "parsecs"); unknown ids are returned unchanged. */
export function unitName(id: string): string {
  return getDisplayUnit(id)?.name ?? id;
}

/** Linear conversion between two units of the same dimension; null when not convertible. */
export function convertUnit(value: number, fromId: string, toId: string): number | null {
  const a = getDisplayUnit(fromId);
  const b = getDisplayUnit(toId);
  if (!a || !b || a.si == null || b.si == null || a.dimension !== b.dimension) return null;
  return (value * a.si) / b.si;
}

function joinUnit(valueText: string, u: DisplayUnit | undefined, rawId: string, compound: boolean): string {
  if (!u) return rawId ? `${valueText} ${rawId}` : valueText;
  if (!u.label) return valueText;
  const label = u.singular && valueText === '1' ? u.singular : u.label;
  if (!u.spaced) return compound ? `(${valueText})${label}` : `${valueText}${label}`;
  return `${valueText} ${label}`;
}

// ── Structured results ───────────────────────────────────────────────────────────────────────

export interface FormattedValue {
  /** Number text, e.g. "384,400" or "2.54 million". */
  value: string;
  /** Unit label, e.g. "km" (empty when dimensionless). */
  unit: string;
  /** Spoken unit name for assistive technology, e.g. "kilometers". */
  unitName: string;
  /** value + unit, e.g. "384,400 km". */
  text: string;
}

export interface MeasureParts {
  primary: FormattedValue;
  /** Context comparison in another unit (e.g. light travel time), or null. */
  secondary: FormattedValue | null;
  /** Full display text: "384,400 km · 1.28 light-s". */
  text: string;
}

const UNKNOWN_VALUE: FormattedValue = { value: UNKNOWN_TEXT, unit: '', unitName: '', text: UNKNOWN_TEXT };

function unknownParts(): MeasureParts {
  return { primary: { ...UNKNOWN_VALUE }, secondary: null, text: UNKNOWN_TEXT };
}

function infiniteParts(x: number, unitId: string): MeasureParts {
  const u = UNIT_MAP.get(unitId);
  const value = nonFinite(x);
  const primary: FormattedValue = { value, unit: u?.label ?? '', unitName: u?.name ?? '', text: value };
  return { primary, secondary: null, text: value };
}

function valueIn(si: number, unitId: string, sig: number | undefined): FormattedValue {
  const u = UNIT_MAP.get(unitId);
  if (!u || u.si == null) return { value: formatNumber(si, { sigDigits: sig }), unit: unitId, unitName: unitId, text: `${formatNumber(si, { sigDigits: sig })} ${unitId}` };
  const value = formatNumber(si / u.si, { sigDigits: sig });
  const unit = u.singular && value === '1' ? u.singular : u.label;
  return { value, unit, unitName: u.name, text: joinUnit(value, u, unitId, false) };
}

function measure(si: number, primaryId: string, secondaryId: string | null, sig: number | undefined): MeasureParts {
  const primary = valueIn(si, primaryId, sig);
  const secondary = secondaryId && secondaryId !== primaryId ? valueIn(si, secondaryId, 3) : null;
  return { primary, secondary, text: secondary ? primary.text + SECONDARY_SEPARATOR + secondary.text : primary.text };
}

// ── Distance ─────────────────────────────────────────────────────────────────────────────────

export type DistanceUnitId = LengthUnitId | 'nm' | 'um' | 'mm' | 'cm' | 'R_jup' | 'R_sun';

export interface DistanceFormatOptions {
  /** Force the primary unit (default 'auto'). */
  unit?: DistanceUnitId | 'auto';
  /** Secondary comparison unit (default 'auto'; 'none' to disable). */
  secondary?: DistanceUnitId | 'auto' | 'none';
  sigDigits?: number;
  /** Unit family beyond half a light-year: 'ly' (default) or parsecs ('pc' → pc/kpc/Mpc/Gpc). */
  prefer?: 'ly' | 'pc';
}

function parsecUnitFor(m: number): DistanceUnitId {
  const pc = m / PC_M;
  return pc < 1e3 ? 'pc' : pc < 1e6 ? 'kpc' : pc < 1e9 ? 'Mpc' : 'Gpc';
}

/** Context-appropriate primary length unit for |m| (SI sub-meter units, m, km, AU, then ly or pc-family). */
export function chooseDistanceUnit(m: number, prefer: 'ly' | 'pc' = 'ly'): DistanceUnitId {
  const a = Math.abs(m);
  if (a === 0 || !Number.isFinite(a)) return 'm';
  if (a < 1e-6) return 'nm';
  if (a < 1e-3) return 'um';
  if (a < 1e-2) return 'mm';
  if (a < 1) return 'cm';
  if (a < 1e3) return 'm';
  if (a < 0.05 * AU_M) return 'km';
  if (a < 0.5 * LY_M) return 'AU';
  return prefer === 'pc' ? parsecUnitFor(a) : 'ly';
}

function autoSecondaryDistance(a: number, primary: DistanceUnitId): DistanceUnitId | null {
  if (a < R_EARTH_MEAN_M) return null;
  if (a < 0.5 * LUNAR_DISTANCE_M) return 'R_earth';
  if (a < 0.05 * AU_M) return 'ls';
  if (a < LIGHT_HOUR_M) return 'lmin';
  if (a < 2 * LIGHT_DAY_M) return 'lh';
  if (a < 0.05 * LY_M) return 'ld';
  if (a < 0.5 * LY_M) return 'ly';
  if (primary === 'pc' || primary === 'kpc' || primary === 'Mpc' || primary === 'Gpc') return 'ly';
  return parsecUnitFor(a);
}

/** Structured distance, e.g. { primary: "4.24 ly", secondary: "1.30 pc", text: "4.24 ly · 1.30 pc" }. */
export function formatDistanceParts(m: number | null | undefined, opts: DistanceFormatOptions = {}): MeasureParts {
  if (m == null || Number.isNaN(m)) return unknownParts();
  if (!Number.isFinite(m)) return infiniteParts(m, 'm');
  const a = Math.abs(m);
  const sig = opts.sigDigits;
  // Choose the unit from the rounded magnitude so 999.96 m reads "1.00 km", not "1,000 m".
  const unitId = opts.unit && opts.unit !== 'auto'
    ? opts.unit
    : chooseDistanceUnit(roundSig(a, sig ?? 3), opts.prefer);
  const secondaryId = opts.secondary === 'none'
    ? null
    : opts.secondary && opts.secondary !== 'auto' ? opts.secondary : autoSecondaryDistance(a, unitId);
  return measure(m, unitId, secondaryId, sig);
}

/** "384,400 km · 1.28 light-s", "1.00 AU · 8.32 light-min", "4.24 ly · 1.30 pc", "2.54 million ly · 778 kpc". */
export function formatDistance(m: number | null | undefined, opts: DistanceFormatOptions = {}): string {
  return formatDistanceParts(m, opts).text;
}

// ── Mass ─────────────────────────────────────────────────────────────────────────────────────

export type MassUnitId = 'g' | 'kg' | 't' | 'M_earth' | 'M_jup' | 'M_sun';

export interface MassFormatOptions {
  unit?: MassUnitId | 'auto';
  secondary?: MassUnitId | 'auto' | 'none';
  sigDigits?: number;
}

/** kg up to 10²¹ kg (spacecraft … asteroids), then M⊕ (moons, rocky planets), M♃ (giants, brown dwarfs), M☉ (stars and beyond). */
export function chooseMassUnit(kg: number): MassUnitId {
  const a = Math.abs(kg);
  if (a === 0 || !Number.isFinite(a)) return 'kg';
  if (a < 1) return 'g';
  if (a < 1e21) return 'kg';
  if (a < 0.1 * M_JUPITER_KG) return 'M_earth';
  if (a < 0.075 * M_SUN_KG) return 'M_jup';
  return 'M_sun';
}

function autoSecondaryMass(a: number, primary: MassUnitId): MassUnitId | null {
  switch (primary) {
    case 'M_earth': return 'kg';
    case 'M_jup': return 'M_earth';
    case 'M_sun': return a < 0.5 * M_SUN_KG ? 'M_jup' : a < 1e3 * M_SUN_KG ? 'kg' : null;
    default: return null;
  }
}

export function formatMassParts(kg: number | null | undefined, opts: MassFormatOptions = {}): MeasureParts {
  if (kg == null || Number.isNaN(kg)) return unknownParts();
  if (!Number.isFinite(kg)) return infiniteParts(kg, 'kg');
  const a = Math.abs(kg);
  const unitId = opts.unit && opts.unit !== 'auto' ? opts.unit : chooseMassUnit(a);
  const secondaryId = opts.secondary === 'none'
    ? null
    : opts.secondary && opts.secondary !== 'auto' ? opts.secondary : autoSecondaryMass(a, unitId);
  return measure(kg, unitId, secondaryId, opts.sigDigits);
}

/** "721 kg", "4.30 billion kg", "1.00 M⊕ · 5.97 × 10²⁴ kg", "1.00 M♃ · 318 M⊕", "4.30 million M☉". */
export function formatMass(kg: number | null | undefined, opts: MassFormatOptions = {}): string {
  return formatMassParts(kg, opts).text;
}

// ── Duration ─────────────────────────────────────────────────────────────────────────────────

export type DurationUnitId = 'us' | 'ms' | 's' | 'min' | 'h' | 'd' | 'yr';

export interface DurationFormatOptions {
  /**
   * 'auto' (default): one well-chosen unit ("92.7 min", "27.3 days", "4.57 billion years");
   * 'short': compact labels ("27.3 d", "11.9 yr", "4.57 Gyr");
   * 'compound': whole-unit parts ("8 min 19 s", "1 h 33 min", "27 d 8 h").
   */
  style?: 'auto' | 'short' | 'compound';
  sigDigits?: number;
  /** Parts shown by the compound style (default 2). */
  maxParts?: number;
}

/** µs … min (< 2 h) … h (< 3 d) … days (< 1000 d) … years. */
export function chooseDurationUnit(seconds: number): DurationUnitId {
  const a = Math.abs(seconds);
  if (a === 0 || !Number.isFinite(a)) return 's';
  if (a < 1e-3) return 'us';
  if (a < 1) return 'ms';
  if (a < 60) return 's';
  if (a < 7_200) return 'min';
  if (a < 72 * 3_600) return 'h';
  if (a < 1_000 * SECONDS_PER_DAY) return 'd';
  return 'yr';
}

const COMPOUND_PARTS: ReadonlyArray<{ label: string; s: number }> = [
  { label: 'yr', s: JULIAN_YEAR_S },
  { label: 'd', s: SECONDS_PER_DAY },
  { label: 'h', s: 3_600 },
  { label: 'min', s: 60 },
  { label: 's', s: 1 },
];

function formatCompoundDuration(seconds: number, maxParts: number): string {
  const a = Math.abs(seconds);
  const parts = Math.max(1, Math.round(maxParts));
  const lastIndex = COMPOUND_PARTS.length - 1;
  const span = (first: number): { first: number; last: number; total: number } => {
    const last = Math.min(lastIndex, first + parts - 1);
    const unitS = COMPOUND_PARTS[last].s;
    return { first, last, total: Math.round(a / unitS) * unitS };
  };
  let s = span(Math.max(0, COMPOUND_PARTS.findIndex((p) => a >= p.s)));
  // Rounding can carry into the next larger unit (3599.6 s → 1 h): re-plan from the rounded total.
  const carried = COMPOUND_PARTS.findIndex((p) => s.total >= p.s);
  if (carried >= 0 && carried < s.first) s = span(carried);
  let rem = s.total;
  const out: string[] = [];
  for (let i = s.first; i <= s.last; i++) {
    const p = COMPOUND_PARTS[i];
    const q = i === s.last ? Math.round(rem / p.s) : Math.floor(rem / p.s + 1e-9);
    rem -= q * p.s;
    if (q > 0 || out.length === 0) out.push(`${fixed(q, 0)} ${p.label}`);
  }
  return (seconds < 0 ? MINUS_SIGN : '') + out.join(' ');
}

export function formatDurationParts(seconds: number | null | undefined, opts: DurationFormatOptions = {}): MeasureParts {
  if (seconds == null || Number.isNaN(seconds)) return unknownParts();
  if (!Number.isFinite(seconds)) return infiniteParts(seconds, 's');
  const style = opts.style ?? 'auto';
  if (style === 'compound' && Math.abs(seconds) >= 1) {
    const text = formatCompoundDuration(seconds, opts.maxParts ?? 2);
    return { primary: { value: text, unit: '', unitName: '', text }, secondary: null, text };
  }
  let unitId: string = chooseDurationUnit(seconds);
  if (style === 'short' && unitId === 'yr') {
    const yr = Math.abs(seconds) / JULIAN_YEAR_S;
    if (yr >= 1e9) unitId = 'Gyr';
    else if (yr >= 1e6) unitId = 'Myr';
  }
  const parts = measure(seconds, unitId, null, opts.sigDigits);
  if (style === 'short' && (unitId === 'd' || unitId === 'yr')) {
    const unit = unitId === 'd' ? 'd' : 'yr';
    const text = `${parts.primary.value} ${unit}`;
    return { primary: { ...parts.primary, unit, text }, secondary: null, text };
  }
  if (style === 'short' && (unitId === 'Gyr' || unitId === 'Myr')) {
    const text = `${parts.primary.value} ${unitId}`;
    return { primary: { ...parts.primary, unit: unitId, text }, secondary: null, text };
  }
  return parts;
}

/** "8.33 s", "92.7 min", "23.9 h", "27.3 days", "11.9 years", "4.57 billion years" (style: see options). */
export function formatDuration(seconds: number | null | undefined, opts: DurationFormatOptions = {}): string {
  return formatDurationParts(seconds, opts).text;
}

// ── Velocity ─────────────────────────────────────────────────────────────────────────────────

export type VelocityUnitId = 'um/s' | 'mm/s' | 'cm/s' | 'm/s' | 'km/h' | 'km/s' | 'c';

export interface VelocityFormatOptions {
  unit?: VelocityUnitId | 'auto';
  /** 'auto' adds a fraction of light speed from 1% c; 'km/h' adds an everyday comparison. */
  secondary?: 'auto' | 'none' | 'km/h' | 'c';
  sigDigits?: number;
}

/** µm/s … mm/s (DART-scale Δv) … m/s … km/s (orbits, stars). */
export function chooseVelocityUnit(mps: number): VelocityUnitId {
  const a = Math.abs(mps);
  if (a === 0 || !Number.isFinite(a)) return 'm/s';
  if (a < 1e-3) return 'um/s';
  if (a < 0.1) return 'mm/s';
  if (a < 1e3) return 'm/s';
  return 'km/s';
}

function fractionOfLight(a: number): FormattedValue {
  const beta = a / C_M_PER_S;
  if (beta < 0.5) {
    const value = formatNumber(beta * 100, { sigDigits: 3, words: false });
    return { value, unit: '% of c', unitName: 'percent of the speed of light', text: `${value}% of c` };
  }
  const value = formatNumber(beta, { sigDigits: beta < 0.999 ? 3 : 6 });
  return { value, unit: 'c', unitName: 'times the speed of light', text: `${value} c` };
}

export function formatVelocityParts(mps: number | null | undefined, opts: VelocityFormatOptions = {}): MeasureParts {
  if (mps == null || Number.isNaN(mps)) return unknownParts();
  if (!Number.isFinite(mps)) return infiniteParts(mps, 'm/s');
  const a = Math.abs(mps);
  const unitId = opts.unit && opts.unit !== 'auto' ? opts.unit : chooseVelocityUnit(a);
  const primary = valueIn(mps, unitId, opts.sigDigits);
  let secondary: FormattedValue | null = null;
  const mode = opts.secondary ?? 'auto';
  if (mode === 'km/h' && unitId !== 'km/h') secondary = valueIn(mps, 'km/h', 3);
  else if ((mode === 'c' || (mode === 'auto' && a >= 0.01 * C_M_PER_S)) && unitId !== 'c') secondary = fractionOfLight(a);
  return { primary, secondary, text: secondary ? primary.text + SECONDARY_SEPARATOR + secondary.text : primary.text };
}

/** "2.70 mm/s", "7.66 km/s", "7,650 km/s · 2.55% of c". */
export function formatVelocity(mps: number | null | undefined, opts: VelocityFormatOptions = {}): string {
  return formatVelocityParts(mps, opts).text;
}

// ── Temperature ──────────────────────────────────────────────────────────────────────────────

/** Range (K) in which a Celsius comparison helps intuition (Mars, Earth, Venus, temperate exoplanets). */
export const CELSIUS_RANGE_K: readonly [number, number] = [150, 1_000];

export interface TemperatureFormatOptions {
  celsius?: 'auto' | 'always' | 'never';
  sigDigits?: number;
}

export function formatTemperatureParts(kelvin: number | null | undefined, opts: TemperatureFormatOptions = {}): MeasureParts {
  if (kelvin == null || Number.isNaN(kelvin) || kelvin < 0) return unknownParts();
  if (!Number.isFinite(kelvin)) return infiniteParts(kelvin, 'K');
  const value = formatNumber(kelvin, { sigDigits: opts.sigDigits });
  const primary: FormattedValue = { value, unit: 'K', unitName: 'kelvin', text: `${value} K` };
  const mode = opts.celsius ?? 'auto';
  const show = mode === 'always' || (mode === 'auto' && kelvin >= CELSIUS_RANGE_K[0] && kelvin <= CELSIUS_RANGE_K[1]);
  if (!show || /[a-z×]/.test(value)) return { primary, secondary: null, text: primary.text };
  const dot = value.indexOf('.');
  const decimals = dot < 0 ? 0 : value.length - dot - 1;
  const c = fixed(kelvin - 273.15, decimals);
  const secondary: FormattedValue = { value: c, unit: '°C', unitName: 'degrees Celsius', text: `${c} °C` };
  return { primary, secondary, text: primary.text + SECONDARY_SEPARATOR + secondary.text };
}

/** "255 K · −18 °C", "737 K · 464 °C", "5,772 K", "2.73 K". Negative kelvin → "Unknown". */
export function formatTemperature(kelvin: number | null | undefined, opts: TemperatureFormatOptions = {}): string {
  return formatTemperatureParts(kelvin, opts).text;
}

// ── Angles & sky coordinates ─────────────────────────────────────────────────────────────────

export type AngleUnitId = 'rad' | 'deg' | 'arcmin' | 'arcsec' | 'mas' | 'uas';

/** ° (≥ 1°), ′ (≥ 1′), ″ (≥ 1″), mas (parallaxes), µas (EHT-scale). */
export function chooseAngleUnit(rad: number): AngleUnitId {
  const a = Math.abs(rad);
  if (a === 0 || !Number.isFinite(a) || a >= DEG) return 'deg';
  if (a >= DEG / 60) return 'arcmin';
  if (a >= ARCSEC) return 'arcsec';
  if (a >= MAS) return 'mas';
  return 'uas';
}

/** "23.4°", "31.1′", "1.85″", "768 mas", "52.0 µas" (input in radians). */
export function formatAngle(rad: number | null | undefined, opts: { unit?: AngleUnitId | 'auto'; sigDigits?: number } = {}): string {
  if (rad == null || Number.isNaN(rad)) return UNKNOWN_TEXT;
  if (!Number.isFinite(rad)) return nonFinite(rad);
  const unitId = opts.unit && opts.unit !== 'auto' ? opts.unit : chooseAngleUnit(rad);
  return valueIn(rad, unitId, opts.sigDigits).text;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : String(n));

/** Split a non-negative number of (arc)seconds into whole units, minutes and a seconds string, rounding exactly. */
function sexagesimal(totalSeconds: number, decimals: number): [number, number, string] {
  const d = Math.max(0, Math.min(6, Math.round(decimals)));
  const f = 10 ** d;
  const ticks = Math.round(totalSeconds * f);
  const whole = Math.floor(ticks / (3_600 * f));
  const minutes = Math.floor((ticks - whole * 3_600 * f) / (60 * f));
  const secTicks = ticks - whole * 3_600 * f - minutes * 60 * f;
  const secText = (secTicks / f).toFixed(d).padStart(d > 0 ? 3 + d : 2, '0');
  return [whole, minutes, secText];
}

/** Right ascension (radians) → "14h 29m 43.0s". */
export function formatRightAscension(rad: number | null | undefined, secondsDecimals = 1): string {
  if (rad == null || !Number.isFinite(rad)) return UNKNOWN_TEXT;
  const hours = (((rad * 12) / Math.PI) % 24 + 24) % 24;
  const [h, m, s] = sexagesimal(hours * 3_600, secondsDecimals);
  return `${pad2(h % 24)}h ${pad2(m)}m ${s}s`;
}

/** Declination (radians) → "−62° 40′ 46″" (sign always shown). */
export function formatDeclination(rad: number | null | undefined, secondsDecimals = 0): string {
  if (rad == null || !Number.isFinite(rad)) return UNKNOWN_TEXT;
  const deg = rad / DEG;
  const [d, m, s] = sexagesimal(Math.abs(deg) * 3_600, secondsDecimals);
  const zero = d === 0 && m === 0 && Number(s) === 0;
  return `${deg < 0 && !zero ? MINUS_SIGN : '+'}${pad2(d)}° ${pad2(m)}′ ${s}″`;
}

/** Geodetic latitude (radians) → "24.45° N". */
export function formatLatitude(rad: number | null | undefined, decimals = 2): string {
  if (rad == null || !Number.isFinite(rad)) return UNKNOWN_TEXT;
  const deg = rad / DEG;
  const text = Math.abs(deg).toFixed(decimals);
  if (Number(text) === 0) return `${text}°`;
  return `${text}° ${deg > 0 ? 'N' : 'S'}`;
}

/** Longitude (radians) → "54.38° E", normalized to (−180°, 180°]. */
export function formatLongitude(rad: number | null | undefined, decimals = 2): string {
  if (rad == null || !Number.isFinite(rad)) return UNKNOWN_TEXT;
  let deg = (rad / DEG) % 360;
  if (deg > 180) deg -= 360;
  if (deg <= -180) deg += 360;
  const text = Math.abs(deg).toFixed(decimals);
  if (Number(text) === 0 || Number(text) === 180) return `${text}°`;
  return `${text}° ${deg > 0 ? 'E' : 'W'}`;
}

// ── Quantities (catalog values with provenance) ──────────────────────────────────────────────

export interface QuantityFormatOptions {
  /** Override the quantity's own sigDigits. */
  sigDigits?: number;
  /** Re-express in a context-appropriate unit of the same dimension (length/mass/time/velocity/angle). */
  smart?: boolean;
  /** Show the uncertainty / limit / range (default true). */
  showUncertainty?: boolean;
}

export interface QuantityParts {
  /** Full display text, e.g. "1.30 ± 0.02 pc", "< 1.3 M♃", "Unknown". */
  text: string;
  /** Number part including uncertainty, e.g. "1.30 ± 0.02". */
  value: string;
  /** Unit label actually used, e.g. "pc". */
  unit: string;
  /** Spoken unit name, e.g. "parsecs". */
  unitName: string;
  known: boolean;
  limit: 'upper' | 'lower' | null;
}

/**
 * Decimal places for an uncertainty following the Particle Data Group rule: keep two significant digits
 * when its three leading digits are 100–354, one digit for 355–949, and round 950–999 up to 1000 (two digits).
 */
function uncertaintyDecimals(sigma: number): number {
  const a = Math.abs(sigma);
  const e = exponentOf(a);
  const lead3 = Math.round(a / 10 ** (e - 2));
  // 355–949: one digit at 10^e. 950–999 rounds up to 10^(e+1) shown with two digits — the same decimal place.
  return lead3 <= 354 ? 1 - e : -e;
}

function scaleFor(a: number): { factor: number; suffix: string } {
  if (a >= 1e15 || (a > 0 && a < 1e-3)) {
    const e = exponentOf(a);
    return { factor: 10 ** e, suffix: ` ${TIMES} 10${toSuperscript(e)}` };
  }
  for (const s of WORD_SCALES) if (a >= s.factor) return { factor: s.factor, suffix: ` ${s.word}` };
  return { factor: 1, suffix: '' };
}

const validPositive = (x: number | undefined): x is number => typeof x === 'number' && Number.isFinite(x) && x > 0;

function formatMeasured(
  v: number, unc: Uncertainty | undefined, sig: number | undefined, u: DisplayUnit | undefined, rawId: string,
): { text: string; value: string; limit: 'upper' | 'lower' | null } {
  const plain = (): { text: string; value: string; limit: null } => {
    const value = formatNumber(v, { sigDigits: sig });
    return { text: joinUnit(value, u, rawId, false), value, limit: null };
  };
  if (!unc) return plain();

  if (unc.kind === 'limit') {
    const value = `${unc.type === 'upper' ? '<' : '>'} ${formatNumber(v, { sigDigits: sig })}`;
    const label = u?.label ?? rawId;
    const text = !label ? value : u && !u.spaced ? `${value}${label}` : `${value} ${label}`;
    return { text, value, limit: unc.type };
  }

  if (unc.kind === 'symmetric' || unc.kind === 'asymmetric') {
    const plus = unc.kind === 'symmetric' ? unc.sigma : unc.plus;
    const minus = unc.kind === 'symmetric' ? unc.sigma : unc.minus;
    if (!validPositive(plus) || !validPositive(minus)) return plain();
    const { factor, suffix } = scaleFor(Math.max(Math.abs(v), plus, minus));
    const d = Math.max(uncertaintyDecimals(plus / factor), uncertaintyDecimals(minus / factor));
    const vText = fixed(v / factor, d);
    const pText = fixed(plus / factor, d);
    const mText = fixed(minus / factor, d);
    const core = pText === mText ? `${vText} ${PLUS_MINUS} ${pText}` : `${vText} +${pText} / ${MINUS_SIGN}${mText}`;
    const value = suffix ? `(${core})${suffix}` : core;
    return { text: joinUnit(value, u, rawId, !suffix), value, limit: null };
  }

  // range
  const { min, max } = unc;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return plain();
  const { factor, suffix } = scaleFor(Math.max(Math.abs(v), Math.abs(min), Math.abs(max)));
  const half = (max - min) / 2 / factor;
  const d = half > 0 ? uncertaintyDecimals(half) : Math.max(0, sigDecimals(v / factor, sig ?? 3));
  const label = u?.label ?? rawId;
  const attach = (t: string): string => (u && !u.spaced && label ? `${t}${label}` : t);
  const vText = attach(fixed(v / factor, d));
  const rangeText = `${attach(fixed(min / factor, d))} ${EN_DASH} ${attach(fixed(max / factor, d))}`;
  const value = `${vText} (${rangeText})${suffix}`;
  const text = !label || (u && !u.spaced) ? value : `${value} ${label}`;
  return { text, value, limit: null };
}

function scaleUncertainty(unc: Uncertainty | undefined, f: number): Uncertainty | undefined {
  if (!unc) return undefined;
  switch (unc.kind) {
    case 'symmetric': return { kind: 'symmetric', sigma: unc.sigma * f };
    case 'asymmetric': return { kind: 'asymmetric', plus: unc.plus * f, minus: unc.minus * f };
    case 'range': return { kind: 'range', min: unc.min * f, max: unc.max * f };
    default: return unc;
  }
}

function smartUnitFor(u: DisplayUnit, si: number): string | null {
  switch (u.dimension) {
    case 'length': return chooseDistanceUnit(si);
    case 'mass': return chooseMassUnit(si);
    case 'time': return chooseDurationUnit(si);
    case 'velocity': return chooseVelocityUnit(si);
    case 'angle': return chooseAngleUnit(si);
    default: return null;
  }
}

export function formatQuantityParts(q: Quantity | null | undefined, opts: QuantityFormatOptions = {}): QuantityParts {
  const unknown: QuantityParts = { text: UNKNOWN_TEXT, value: UNKNOWN_TEXT, unit: '', unitName: '', known: false, limit: null };
  if (!q || q.value == null || !Number.isFinite(q.value)) return unknown;
  let unitId = q.unit ?? '';
  let value = q.value;
  let unc = opts.showUncertainty === false ? undefined : q.uncertainty;
  let u = getDisplayUnit(unitId);
  if (opts.smart && u && u.si != null) {
    const target = smartUnitFor(u, Math.abs(value * u.si));
    const tu = target ? UNIT_MAP.get(target) : undefined;
    if (tu && tu.si != null && tu.id !== u.id) {
      const f = u.si / tu.si;
      value *= f;
      unc = scaleUncertainty(unc, f);
      u = tu;
      unitId = tu.id;
    }
  }
  const sig = opts.sigDigits ?? q.sigDigits;
  const r = formatMeasured(value, unc, sig, u, unitId);
  const label = u ? (u.singular && r.value === '1' ? u.singular : u.label) : unitId;
  return { text: r.text, value: r.value, unit: label, unitName: u?.name ?? unitId, known: true, limit: r.limit };
}

/**
 * A catalog quantity as text: null → "Unknown"; "1.30 ± 0.02 pc"; "1.07 +0.05 / −0.03 M⊕";
 * "1.10 (0.90 – 1.40) AU"; "< 1.3 M♃"; "(4.30 ± 0.01) million M☉"; "(23.44 ± 0.01)°".
 * Uncertainties are rounded with the PDG rule and the value is rounded to the same decimal place.
 */
export function formatQuantity(q: Quantity | null | undefined, opts: QuantityFormatOptions = {}): string {
  return formatQuantityParts(q, opts).text;
}

/** Fact value for the inspector: its quantity, else its text, else "Unknown". */
export function formatFact(fact: Pick<Fact, 'quantity' | 'text'>, opts: QuantityFormatOptions = {}): string {
  if (fact.quantity) return formatQuantity(fact.quantity, opts);
  const t = fact.text?.trim();
  return t ? t : UNKNOWN_TEXT;
}

// ── Time, dates, rates, scale ────────────────────────────────────────────────────────────────

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MAX_DATE_MS = 8.64e15;

function isoYear(y: number, ascii: boolean): string {
  if (y >= 0 && y <= 9_999) return String(y).padStart(4, '0');
  if (y < 0) return (ascii ? '-' : MINUS_SIGN) + String(-y).padStart(4, '0');
  return `+${y}`;
}

export interface SimDateFormatOptions {
  /**
   * 'datetime' (default) "2026-10-16 20:15:03 UTC" · 'date' "2026-10-16" · 'time' "20:15:03 UTC" ·
   * 'long' "16 Oct 2026, 20:15 UTC" · 'iso' "2026-10-16T20:15:03Z".
   */
  style?: 'datetime' | 'date' | 'time' | 'long' | 'iso';
  /** Include seconds (default true; 'long' never shows seconds). */
  seconds?: boolean;
}

/**
 * Simulation time (Unix ms) in UTC, proleptic Gregorian calendar. Years outside 1–9999 use astronomical
 * numbering with a sign ("−0500-03-01"); the 'long' style writes "501 BCE".
 */
export function formatSimDate(ms: number | null | undefined, opts: SimDateFormatOptions = {}): string {
  if (ms == null || !Number.isFinite(ms) || Math.abs(ms) > MAX_DATE_MS) return UNKNOWN_TEXT;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const day = d.getUTCDate();
  const hh = pad2(d.getUTCHours());
  const mi = pad2(d.getUTCMinutes());
  const ss = pad2(d.getUTCSeconds());
  const style = opts.style ?? 'datetime';
  const seconds = opts.seconds ?? true;
  const time = seconds ? `${hh}:${mi}:${ss}` : `${hh}:${mi}`;
  const date = (ascii: boolean): string => `${isoYear(y, ascii)}-${pad2(mo + 1)}-${pad2(day)}`;
  switch (style) {
    case 'date': return date(false);
    case 'time': return `${time} UTC`;
    case 'iso': return `${date(true)}T${hh}:${mi}:${ss}Z`;
    case 'long': return `${day} ${MONTHS_SHORT[mo]} ${y >= 1 ? y : `${1 - y} BCE`}, ${hh}:${mi} UTC`;
    default: return `${date(false)} ${time} UTC`;
  }
}

const RATE_UNITS: ReadonlyArray<{ s: number; one: string; many: string }> = [
  { s: JULIAN_YEAR_S, one: 'yr', many: 'yr' },
  { s: SECONDS_PER_DAY, one: 'day', many: 'days' },
  { s: 3_600, one: 'h', many: 'h' },
  { s: 60, one: 'min', many: 'min' },
  { s: 1, one: 's', many: 's' },
];

/**
 * Simulation rate (sim seconds per real second): "Paused", "Real time", "10 s / s", "1 h / s",
 * "1 day / s", "116 days / s", "−1 yr / s".
 */
export function formatTimeRate(rate: number | null | undefined, paused = false): string {
  if (paused || rate === 0) return 'Paused';
  if (rate == null || !Number.isFinite(rate)) return UNKNOWN_TEXT;
  if (rate === 1) return 'Real time';
  const a = Math.abs(rate);
  const unit = RATE_UNITS.find((u) => a >= u.s) ?? RATE_UNITS[RATE_UNITS.length - 1];
  const v = a / unit.s;
  const value = v >= 100 ? fixed(Math.round(v), 0) : formatSig(v, 3, true, true);
  return `${rate < 0 ? MINUS_SIGN : ''}${value} ${value === '1' ? unit.one : unit.many} / s`;
}

/** Cosmic Ruler readout: 12 → "10¹² m" (`decimals` 1 → "10¹²·³ m"). */
export function formatScale(scaleLog10: number | null | undefined, opts: { decimals?: number } = {}): string {
  if (scaleLog10 == null || !Number.isFinite(scaleLog10)) return UNKNOWN_TEXT;
  return `${formatPowerOfTen(scaleLog10, opts.decimals ?? 0)} m`;
}

/** Ruler readout plus a friendly equivalent: { power: "10¹² m", friendly: "6.68 AU · 55.6 light-min" }. */
export function formatScaleParts(scaleLog10: number | null | undefined, opts: { decimals?: number } = {}): { power: string; friendly: string } {
  if (scaleLog10 == null || !Number.isFinite(scaleLog10)) return { power: UNKNOWN_TEXT, friendly: UNKNOWN_TEXT };
  return { power: formatScale(scaleLog10, opts), friendly: formatDistance(10 ** scaleLog10) };
}

/** Age of a dataset or observation in days → "today", "1 day ago", "3 months ago", "2 years ago". */
export function formatAgeDays(days: number | null | undefined): string {
  if (days == null || !Number.isFinite(days)) return UNKNOWN_TEXT;
  if (days < 1) return 'today';
  if (days < 60) {
    const n = Math.floor(days);
    return n === 1 ? '1 day ago' : `${n} days ago`;
  }
  if (days < 365.25) return `${Math.round(days / 30.4375)} months ago`;
  const years = Math.floor(days / 365.25);
  return years === 1 ? '1 year ago' : `${fixed(years, 0)} years ago`;
}
