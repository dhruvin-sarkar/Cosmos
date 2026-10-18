/** Pure Cosmic Ruler math: range, graduations, unit bands and plain-language comparisons. */
import { LENGTH_UNITS } from '../../core/units';
import { formatDistance, formatNumber } from '../format';
import { RULER_LANDMARKS, SMALL_COMPARISONS } from './landmarks';

export const RULER_MIN_LOG10 = 0;
export const RULER_MAX_LOG10 = 27;

export function clampScale(log10: number): number {
  if (!Number.isFinite(log10)) return RULER_MIN_LOG10;
  return Math.min(RULER_MAX_LOG10, Math.max(RULER_MIN_LOG10, log10));
}

export interface RulerTick {
  log10: number;
  major: boolean;
  /** Exponent for major ticks. */
  exponent: number;
}

/** Slide-rule graduations between two log10 values: majors at powers of ten, minors at 2–9. */
export function rulerTicks(fromLog10: number, toLog10: number): RulerTick[] {
  const lo = Math.max(RULER_MIN_LOG10, Math.min(fromLog10, toLog10));
  const hi = Math.min(RULER_MAX_LOG10, Math.max(fromLog10, toLog10));
  const out: RulerTick[] = [];
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (let m = 1; m <= 9; m++) {
      const v = e + Math.log10(m);
      if (v < lo - 1e-9 || v > hi + 1e-9) continue;
      out.push({ log10: v, major: m === 1, exponent: e });
    }
  }
  return out;
}

export interface UnitBand {
  id: string;
  label: string;
  name: string;
  log10: number;
}

/** Unit bands drawn on the ruler (each at the log10 of one unit). Light-second sits on LD, so it is skipped. */
export const UNIT_BANDS: readonly UnitBand[] = LENGTH_UNITS.filter(u => u.id !== 'ls' && u.id !== 'm').map(u => ({
  id: u.id,
  label: u.label,
  name: u.name,
  log10: Math.log10(u.meters),
}));

/** The comparison phrase for a field width: "about Earth's diameter", "about 3 times the Moon's orbit". */
export function comparisonFor(widthM: number): string {
  if (!(widthM > 0) || !Number.isFinite(widthM)) return '';
  const all = [...SMALL_COMPARISONS, ...RULER_LANDMARKS.map(l => ({ widthM: l.widthM, the: l.the }))].sort((a, b) => a.widthM - b.widthM);
  let best = all[0];
  for (const c of all) if (c.widthM <= widthM * 1.25) best = c;
  const ratio = widthM / best.widthM;
  if (ratio < 1.25) return `about ${best.the}`;
  const n = ratio < 2 ? Math.round(ratio * 10) / 10 : ratio < 10 ? Math.round(ratio) : Number(ratio.toPrecision(2));
  return `about ${formatNumber(n, { sigDigits: 2, trimZeros: true })} times ${best.the}`;
}

/** "Field of view ≈ 12,700 km, about Earth's diameter". */
export function fieldOfViewLine(scaleLog10: number): string {
  if (!Number.isFinite(scaleLog10)) return 'Field of view unknown';
  const w = 10 ** scaleLog10;
  const cmp = comparisonFor(w);
  return `Field of view ≈ ${formatDistance(w, { sigDigits: 2, secondary: 'none' })}${cmp ? `, ${cmp}` : ''}`;
}

/** Integer decade shown by the magnitude readout. */
export function decadeOf(scaleLog10: number): number {
  return Math.floor(clampScale(scaleLog10) + 1e-9);
}
