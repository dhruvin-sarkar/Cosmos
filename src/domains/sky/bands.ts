/**
 * Sky-band catalogue: the schema of public/data/sky/bands.json (written by scripts/data/sky/), the mapping from the
 * app's SpectralBandId to the data band ids, per-band display settings and the UI captions.
 */
import type { QualityProfile, SpectralBandId } from '../../core/types';

export interface SkyBandFile {
  path: string;
  bytes?: number;
  width: number;
  height: number;
  mime?: string;
}

export interface SkyBandRecord {
  id: string;
  label: string;
  regime?: string;
  wavelengthLabel?: string;
  survey?: string;
  instrument?: string;
  files: Partial<Record<'ultra' | 'high' | 'low', SkyBandFile>> & Record<string, unknown>;
  credit?: string;
  license?: string;
  licenseUrl?: string;
  citation?: string;
  colorScale?: { quantity: string; unit: string; min: number; max: number; stops: string[] } | null;
  coverageFraction?: number;
  reveals?: string;
  caveats?: string[];
  provenanceClass?: 'observed' | 'derived' | 'reconstructed' | 'illustrative';
}

export interface SkyBandsFile {
  schemaVersion: number;
  bands: SkyBandRecord[];
}

export const BANDS_JSON_PATH = 'data/sky/bands.json';

/** App spectral band → bands.json id (first available wins). */
export const BAND_DATA_IDS: Record<SpectralBandId, readonly string[]> = {
  visible: ['visible'],
  'h-alpha': ['halpha'],
  ultraviolet: ['uv'],
  'near-infrared': ['nir'],
  'mid-infrared': ['mir'],
  'far-infrared': ['fir'],
  'x-ray': ['xray', 'xray-erosita'],
  'gamma-ray': ['gamma'],
  microwave: ['microwave', 'submm'],
  cmb: ['cmb'],
  radio: ['radio-408', 'radio-hi'],
};

export interface BandDisplay {
  /** Linear multiplier on the map (scene-linear radiance before the cinematic exposure). */
  exposure: number;
  /** 0 = greyscale, 1 = as delivered. */
  saturation: number;
  /** Remove isolated point sources at load (catalogue stars supply the points). */
  starless: boolean;
  /** Linear black point subtracted after decoding (removes residual survey sky floor). */
  blackPoint: number;
  /** 0..1 blend toward a 3×3 blur at bake time (survey noise). */
  smooth?: number;
  /** 0..1 noise-adaptive smoothing of the faint sky at bake time. */
  denoise?: number;
  /** Luminance power after the black point (< 1 lifts faint diffuse light such as the Magellanic Clouds). */
  gamma?: number;
  /** Visible regardless of the camera's distance from the Sun (the CMB is effectively at infinity). */
  everywhere?: boolean;
}

/**
 * Visible: the Gaia DR3 colour flux map is a strongly stretched, very saturated composite; at saturation ~0.5 its
 * hues fall to the warm-white core and brown dust lanes of a long-exposure dark-site photograph. It is kept dim
 * (subtle at default exposure) so the catalogue stars dominate. Other bands are false-colour instrument views
 * the visitor has explicitly chosen, so they are shown brighter.
 */
export const BAND_DISPLAY: Record<string, BandDisplay> = {
  visible: { exposure: 0.04, saturation: 0.4, starless: true, blackPoint: 0.014, smooth: 0.6, gamma: 0.78, denoise: 1 },
  halpha: { exposure: 0.4, saturation: 1, starless: true, blackPoint: 0.004 },
  uv: { exposure: 0.55, saturation: 1, starless: true, blackPoint: 0.002 },
  nir: { exposure: 0.5, saturation: 0.9, starless: true, blackPoint: 0.004 },
  mir: { exposure: 0.5, saturation: 1, starless: true, blackPoint: 0.004 },
  fir: { exposure: 0.5, saturation: 1, starless: false, blackPoint: 0.002 },
  xray: { exposure: 0.4, saturation: 1, starless: false, blackPoint: 0.01, smooth: 1 },
  'xray-erosita': { exposure: 0.4, saturation: 1, starless: false, blackPoint: 0.01, smooth: 1 },
  gamma: { exposure: 0.45, saturation: 1, starless: false, blackPoint: 0.002, smooth: 0.5 },
  microwave: { exposure: 0.55, saturation: 1, starless: false, blackPoint: 0.002 },
  submm: { exposure: 0.55, saturation: 1, starless: false, blackPoint: 0.002 },
  cmb: { exposure: 0.4, saturation: 1, starless: false, blackPoint: 0, everywhere: true },
  'radio-408': { exposure: 0.55, saturation: 1, starless: false, blackPoint: 0.002 },
  'radio-hi': { exposure: 0.55, saturation: 1, starless: false, blackPoint: 0.002 },
};

const DEFAULT_DISPLAY: BandDisplay = { exposure: 0.5, saturation: 1, starless: false, blackPoint: 0.002 };
export const bandDisplay = (dataId: string): BandDisplay => BAND_DISPLAY[dataId] ?? DEFAULT_DISPLAY;

export function resolveBand(file: SkyBandsFile | null, band: SpectralBandId): SkyBandRecord | null {
  if (!file) return null;
  for (const id of BAND_DATA_IDS[band] ?? []) {
    const rec = file.bands.find((b) => b.id === id);
    if (rec && (rec.files.high || rec.files.low || rec.files.ultra)) return rec;
  }
  return null;
}

/** Tiers to load, smallest first, ending at the one the quality profile asks for. */
export function tiersFor(rec: SkyBandRecord, quality: QualityProfile['textureQuality']): SkyBandFile[] {
  const want = quality === 'ultra' ? ['low', 'high', 'ultra'] : quality === 'high' ? ['low', 'high'] : ['low'];
  const out: SkyBandFile[] = [];
  for (const k of want) {
    const f = rec.files[k as 'low' | 'high' | 'ultra'];
    if (f && typeof f === 'object' && typeof f.path === 'string') out.push(f);
  }
  if (out.length === 0) {
    const any = rec.files.high ?? rec.files.low ?? rec.files.ultra;
    if (any) out.push(any);
  }
  return out;
}

/** What the UI shows under the Light switcher for the band on screen. */
export interface SkyBandCaption {
  band: SpectralBandId;
  dataId: string;
  label: string;
  wavelength: string | null;
  survey: string | null;
  instrument: string | null;
  reveals: string | null;
  caveats: string[];
  credit: string | null;
  license: string | null;
  licenseUrl: string | null;
  citation: string | null;
  provenance: SkyBandRecord['provenanceClass'] | null;
  /** Fraction of the sky with data (null = unknown). */
  coverage: number | null;
  /** Colour bar for quantitative maps (e.g. the CMB in µK), null for colour composites. */
  colorScale: SkyBandRecord['colorScale'] | null;
  /** False when the camera is too far from the Sun for this Earth-centred map (fades 50–500 pc). */
  validHere: boolean;
}

export function captionFor(band: SpectralBandId, rec: SkyBandRecord, validHere: boolean): SkyBandCaption {
  return {
    band,
    dataId: rec.id,
    label: rec.label,
    wavelength: rec.wavelengthLabel ?? null,
    survey: rec.survey ?? null,
    instrument: rec.instrument ?? null,
    reveals: rec.reveals ?? null,
    caveats: rec.caveats ?? [],
    credit: rec.credit ?? null,
    license: rec.license ?? null,
    licenseUrl: rec.licenseUrl ?? null,
    citation: rec.citation ?? null,
    provenance: rec.provenanceClass ?? null,
    coverage: typeof rec.coverageFraction === 'number' ? rec.coverageFraction : null,
    colorScale: rec.colorScale ?? null,
    validHere,
  };
}
