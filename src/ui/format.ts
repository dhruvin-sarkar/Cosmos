/**
 * The HUD's single doorway to number formatting. Everything visible goes through src/data/format.ts (owned by the
 * data runtime); this adapter pins the handful of signatures the UI depends on so a change there is fixed here once.
 */
import {
  UNKNOWN_TEXT,
  formatAgeDays,
  formatDistance,
  formatDistanceParts,
  formatDuration,
  formatNumber,
  formatPowerOfTen,
  formatQuantityParts,
  formatSimDate,
  formatTimeRate,
  unitName,
} from '../data/format';
import type { Quantity } from '../data/provenance';

export { UNKNOWN_TEXT, formatDistance, formatDistanceParts, formatDuration, formatNumber, formatPowerOfTen, formatSimDate, formatTimeRate, unitName };

export interface QuantityDisplay {
  /** Full text, e.g. "0.920 ± 0.013 R⊕" or "Unknown". */
  text: string;
  /** Leading value without uncertainty, e.g. "0.920". */
  main: string;
  /** Uncertainty / range part including its leading space, e.g. " ± 0.013" (empty when none). */
  uncertainty: string;
  /** Unit label, e.g. "R⊕" (empty for dimensionless). */
  unit: string;
  /** Spoken form for assistive technology, e.g. "0.920 plus or minus 0.013 Earth radii". */
  spoken: string;
  known: boolean;
  limit: 'upper' | 'lower' | null;
  /** True when value and unit can be styled separately (spaced units such as "km"; not "°"). */
  splittable: boolean;
}

const UNCERTAINTY_SPLIT = /^(.*?)( ± .+| \+.+| \(.+\))$/;

function spoken(text: string, unitText: string, unitSpoken: string): string {
  let s = text.replace(/±/g, 'plus or minus').replace(/−/g, 'minus').replace(/ – /g, ' to ');
  s = s.replace(/^</, 'less than').replace(/^>/, 'more than');
  if (unitText && unitSpoken && unitSpoken !== unitText) s = s.replace(new RegExp(`${escapeRegExp(unitText)}$`), unitSpoken);
  return s;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Format a catalog quantity for display. `null` value → "Unknown" (never 0). */
export function displayQuantity(q: Quantity | null | undefined, opts: { smart?: boolean; sigDigits?: number; showUncertainty?: boolean } = {}): QuantityDisplay {
  let parts;
  try {
    parts = formatQuantityParts(q, opts);
  } catch {
    parts = { text: UNKNOWN_TEXT, value: UNKNOWN_TEXT, unit: '', unitName: '', known: false, limit: null };
  }
  if (!parts.known) {
    return { text: UNKNOWN_TEXT, main: UNKNOWN_TEXT, uncertainty: '', unit: '', spoken: 'Unknown', known: false, limit: null, splittable: false };
  }
  const splittable = parts.unit === '' || parts.text === `${parts.value} ${parts.unit}`;
  const m = UNCERTAINTY_SPLIT.exec(parts.value);
  const main = m && !parts.value.startsWith('(') ? m[1] : parts.value;
  const uncertainty = m && !parts.value.startsWith('(') ? m[2] : '';
  return {
    text: parts.text,
    main,
    uncertainty,
    unit: parts.unit,
    spoken: spoken(parts.text, parts.unit, parts.unitName),
    known: true,
    limit: parts.limit,
    splittable,
  };
}

/** "2026-10-16" from an ISO timestamp; "Unknown" when unparsable. */
export function formatIsoDate(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN_TEXT;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatSimDate(ms, { style: 'date' }) : UNKNOWN_TEXT;
}

/** "16 Oct 2026" from an ISO timestamp. */
export function formatIsoDateLong(iso: string | null | undefined): string {
  if (!iso) return UNKNOWN_TEXT;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return UNKNOWN_TEXT;
  const long = formatSimDate(ms, { style: 'long' });
  const comma = long.indexOf(',');
  return comma > 0 ? long.slice(0, comma) : long;
}

/** "3 days ago" for an ISO timestamp relative to `nowMs`. */
export function formatIsoAge(iso: string | null | undefined, nowMs: number = Date.now()): string {
  if (!iso) return UNKNOWN_TEXT;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? formatAgeDays((nowMs - ms) / 86_400_000) : UNKNOWN_TEXT;
}

/** Human file size: 1.2 MB. */
export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return UNKNOWN_TEXT;
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${formatNumber(v, { sigDigits: v < 10 ? 2 : 3 })} ${units[i]}`;
}
