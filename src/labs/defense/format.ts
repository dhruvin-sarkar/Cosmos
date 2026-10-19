/** Number formatting for the deflection lab (units always attached by the caller or here). */
const nf = (digits: number): Intl.NumberFormat => new Intl.NumberFormat('en-GB', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const cache = new Map<number, Intl.NumberFormat>();
export function fixed(v: number, digits = 0): string {
  if (!Number.isFinite(v)) return 'Unknown';
  let f = cache.get(digits);
  if (!f) cache.set(digits, (f = nf(digits)));
  return f.format(v).replace('-', '−');
}

/** Significant-figure formatting with thousands separators. */
export function sig(v: number, s = 3): string {
  if (!Number.isFinite(v)) return 'Unknown';
  if (v === 0) return '0';
  const mag = Math.floor(Math.log10(Math.abs(v)));
  return fixed(v, Math.max(0, s - 1 - mag));
}

/** Scientific notation "4.3 × 10⁹". */
export function sci(v: number, s = 2): string {
  if (!Number.isFinite(v)) return 'Unknown';
  if (v === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(v)));
  if (e >= -2 && e < 5) return sig(v, s);
  const m = v / 10 ** e;
  const sup = String(e).replace('-', '⁻').replace(/\d/g, d => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${fixed(m, s - 1)} × 10${sup}`;
}

/** Distance with a sensible unit: m, km, million km. */
export function dist(m: number): string {
  if (!Number.isFinite(m)) return 'Unknown';
  const a = Math.abs(m);
  if (a < 1000) return `${sig(m, 3)} m`;
  if (a < 1e9) return `${a < 1e4 ? sig(m / 1000, 3) : fixed(m / 1000, 0)} km`;
  return `${sig(m / 1e9, 3)} million km`;
}

/** Speed in mm/s, cm/s, m/s or km/s. */
export function speed(ms: number): string {
  if (!Number.isFinite(ms)) return 'Unknown';
  const a = Math.abs(ms);
  if (a < 0.01) return `${sig(ms * 1000, 3)} mm/s`;
  if (a < 1) return `${sig(ms * 100, 3)} cm/s`;
  if (a < 1000) return `${sig(ms, 3)} m/s`;
  return `${sig(ms / 1000, 3)} km/s`;
}

export function mass(kg: number): string {
  if (!Number.isFinite(kg)) return 'Unknown';
  if (kg < 1e5) return `${fixed(kg, kg < 1000 ? 1 : 0)} kg`;
  return `${sci(kg, 2)} kg`;
}

export function years(y: number): string {
  if (!Number.isFinite(y)) return 'Unknown';
  if (y < 1) return `${fixed(y * 12, 0)} months`;
  return `${sig(y, y < 10 ? 2 : 3)} ${y === 1 ? 'year' : 'years'}`;
}

export function percent(p: number): string {
  if (!Number.isFinite(p)) return 'Unknown';
  if (p > 0.995 && p < 1) return '>99';
  if (p > 0 && p < 0.005) return '<1';
  return fixed(p * 100, 0);
}

/** Signed minutes with a real minus sign. */
export function minutes(s: number, digits = 1): string {
  return `${fixed(s / 60, digits)} min`;
}

/** Replay clock: "T − 2 min 05 s", "T + 12 min 30 s", "T + 1 d 04 h". */
export function clock(ts: number): string {
  const sign = ts < 0 ? '−' : '+';
  const a = Math.abs(ts);
  if (a < 10) return `T ${sign} ${a.toFixed(1)} s`;
  if (a < 3600) {
    const m = Math.floor(a / 60), s = Math.floor(a % 60);
    return m > 0 ? `T ${sign} ${m} min ${String(s).padStart(2, '0')} s` : `T ${sign} ${s} s`;
  }
  const d = Math.floor(a / 86400), h = Math.floor((a % 86400) / 3600), m = Math.floor((a % 3600) / 60);
  return d > 0 ? `T ${sign} ${d} d ${String(h).padStart(2, '0')} h` : `T ${sign} ${h} h ${String(m).padStart(2, '0')} min`;
}

/** Signed difference a − b with a formatter; exact zero (or float noise) reads "None", positive values get "+". */
export function diff(a: number, b: number, f: (v: number) => string): string {
  const d = a - b;
  if (!Number.isFinite(d)) return 'Unknown';
  if (Math.abs(d) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b))) return 'None';
  const t = f(d);
  return d > 0 ? `+${t}` : t;
}
