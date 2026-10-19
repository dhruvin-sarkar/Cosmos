/** Number formatting and colour helpers for the debris lab (en-US grouping, honest precision). */
import { CATALOG } from './model';

/** Calendar year of the catalogue snapshot: year 0 of every scenario. */
export const BASE_YEAR = Number(CATALOG.catalogGenerated.slice(0, 4)) || 2026;

const nf = new Intl.NumberFormat('en-US');

/** Exact count (catalogue values). */
export function fmtExact(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? 'Unknown' : nf.format(Math.round(v));
}

/** Model output: three significant figures ("988,000"); below 10 keeps one decimal. */
export function fmtCount(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Unknown';
  if (Math.abs(v) < 10) return (Math.round(v * 10) / 10).toString();
  const p = 10 ** Math.max(0, Math.floor(Math.log10(Math.abs(v))) - 2);
  return nf.format(Math.round(v / p) * p);
}

/** Rates: two significant figures ("1.2", "360"). */
export function fmtRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return 'Unknown';
  if (v === 0) return '0';
  const d = Math.floor(Math.log10(Math.abs(v)));
  const p = 10 ** (d - 1);
  const r = Math.round(v / p) * p;
  return d >= 1 ? nf.format(r) : r.toFixed(Math.max(0, 1 - d));
}

/** Ratio as "×3.4" / "×0.62". */
export function fmtFactor(v: number): string {
  if (!Number.isFinite(v)) return 'Unknown';
  return `×${v >= 10 ? nf.format(Math.round(v)) : v.toPrecision(2)}`;
}

const SUP: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };

/** Powers of ten for axes: 1, 10, 100, 1,000, then 10⁴, 10⁵ … */
export function fmtPow10(v: number): string {
  const d = Math.round(Math.log10(v));
  if (d >= 0 && d <= 3) return nf.format(10 ** d);
  return `10${String(d).split('').map(c => SUP[c] ?? c).join('')}`;
}

/** Time since a breakup: "45 s", "12 min", "3.5 h", "2 d 6 h". */
export function fmtElapsed(s: number): string {
  if (!Number.isFinite(s)) return 'Unknown';
  if (s < 60) return `${Math.round(s)} s`;
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${(s / 3600).toFixed(s < 36000 ? 1 : 0)} h`;
  const d = Math.floor(s / 86400), h = Math.round((s - d * 86400) / 3600);
  return h === 24 ? `${d + 1} d` : h ? `${d} d ${h} h` : `${d} d`;
}

// Magma colormap (matplotlib, van der Walt & Smith), 9 stops.
const MAGMA = ['#000004', '#1c1044', '#4f127b', '#812581', '#b5367a', '#e55064', '#fb8761', '#fec287', '#fcfdbf'].map(h => [
  parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16),
]);

export function magmaCss(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (MAGMA.length - 1);
  const i = Math.min(MAGMA.length - 2, Math.floor(x)), f = x - i;
  const a = MAGMA[i], b = MAGMA[i + 1];
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * f)},${Math.round(a[1] + (b[1] - a[1]) * f)},${Math.round(a[2] + (b[2] - a[2]) * f)})`;
}
