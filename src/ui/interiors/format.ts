import type { InteriorBody, InteriorLayer, InteriorMaterial, InteriorProvenance } from './data';

const NBSP = ' ';
const MINUS = '−';

/** A number for display: 3 significant figures, thousands separators, "million" above 10^6, true minus sign. */
export function fmtNum(x: number): string {
  const sign = x < 0 ? MINUS : '';
  const a = Math.abs(x);
  if (a >= 1e6) return `${sign}${Number((a / 1e6).toPrecision(3)).toLocaleString('en-US')} million`;
  if (a >= 100) return sign + (a < 1e4 ? Math.round(a * 10) / 10 : Math.round(a)).toLocaleString('en-US');
  if (a >= 1) return sign + Number(a.toPrecision(3)).toLocaleString('en-US');
  if (a === 0) return '0';
  return sign + Number(a.toPrecision(2)).toString();
}

export function fmtRange(r: [number, number] | null, unit: string): string {
  if (!r) return 'Unknown';
  const [a, b] = r[0] <= r[1] ? r : [r[1], r[0]];
  if (a === b) return `${fmtNum(a)}${NBSP}${unit}`;
  return `${fmtNum(a)}–${fmtNum(b)}${NBSP}${unit}`;
}

export function fmtKm(km: number): string {
  return `${fmtNum(km)}${NBSP}km`;
}

/** Depth range of a layer below the surface, e.g. "2,890–5,150 km deep". */
export function depthText(body: InteriorBody, layer: InteriorLayer): string {
  const top = Math.max(0, body.radiusKm - layer.outerKm);
  const bottom = body.radiusKm - layer.innerKm;
  if (layer.innerKm === 0) return `From ${fmtKm(top)} deep to the centre`;
  if (top < 0.5) return `Surface to ${fmtKm(bottom)} deep`;
  return `${fmtNum(top)}–${fmtNum(bottom)}${NBSP}km deep`;
}

export const PROVENANCE_TEXT: Record<InteriorProvenance, string> = {
  observed: 'Measured directly',
  derived: 'Derived from measurements',
  model: 'Model estimate',
};

export const PROVENANCE_CLASS: Record<InteriorProvenance, 'observed' | 'derived' | 'reconstructed'> = {
  observed: 'observed',
  derived: 'derived',
  model: 'reconstructed',
};

/** Swatch colours for the layer list (sRGB, close to how each material renders). */
export const MATERIAL_SWATCH: Record<InteriorMaterial, string> = {
  rock: '#7a5a3c',
  crust: '#8f7860',
  metal: '#e0a050',
  'metallic-hydrogen': '#9fb0c8',
  gas: '#c9a77c',
  ice: '#d8e8f2',
  ocean: '#1f4f9a',
  plasma: '#ffb347',
  'fluid-ices': '#3f9aa4',
  'rock-ice': '#8d8a86',
  melt: '#c8461c',
  'dilute-core': '#a08a78',
  photosphere: '#ffc266',
};

/** A "nice" scale-bar length (1, 2 or 5 x 10^n km) close to target km. */
export function niceKm(target: number): number {
  if (!(target > 0)) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  const m = target / p;
  return (m >= 5 ? 5 : m >= 2 ? 2 : 1) * p;
}
