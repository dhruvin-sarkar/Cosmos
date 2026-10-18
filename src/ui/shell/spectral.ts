import type { SpectralBandId } from '../../core/types';

export interface SpectralBandInfo {
  id: SpectralBandId;
  /** Short segment label. */
  short: string;
  label: string;
  /** Representative wavelength, log10 meters (for the log-wavelength axis). */
  log10Wavelength: number;
  /** Representative wavelength in words. */
  wavelength: string;
  survey: string;
  /** "What you are detecting", one plain sentence. */
  detecting: string;
}

/** Bands in wavelength order, longest first (radio → gamma), as the Light switcher draws them. */
export const SPECTRAL_BANDS: readonly SpectralBandInfo[] = [
  { id: 'radio', short: 'Radio', label: 'Radio', log10Wavelength: Math.log10(0.735), wavelength: '73 cm (408 MHz)', survey: 'Haslam et al. 408 MHz all-sky survey', detecting: 'Electrons spiralling in the Galaxy’s magnetic field (synchrotron radiation).' },
  { id: 'cmb', short: 'CMB', label: 'Cosmic microwave background', log10Wavelength: Math.log10(1.9e-3), wavelength: '1.9 mm peak', survey: 'Planck 2018 CMB map', detecting: 'The oldest light: the afterglow of the hot early universe, 380,000 years after the Big Bang.' },
  { id: 'microwave', short: 'Microwave', label: 'Microwave', log10Wavelength: -2, wavelength: '1 cm (30 GHz)', survey: 'Planck 30 GHz', detecting: 'Cold dust, synchrotron and free–free emission from the Milky Way.' },
  { id: 'far-infrared', short: 'Far-IR', label: 'Far infrared', log10Wavelength: -4, wavelength: '100 µm', survey: 'IRAS 100 µm', detecting: 'Cold dust a few tens of kelvin warm, where new stars form.' },
  { id: 'mid-infrared', short: 'Mid-IR', label: 'Mid infrared', log10Wavelength: Math.log10(12e-6), wavelength: '12 µm', survey: 'WISE 12 µm', detecting: 'Warm dust and complex molecules heated by starlight.' },
  { id: 'near-infrared', short: 'Near-IR', label: 'Near infrared', log10Wavelength: Math.log10(2.2e-6), wavelength: '2.2 µm', survey: '2MASS', detecting: 'Light from cool old stars, seen straight through most of the dust.' },
  { id: 'visible', short: 'Visible', label: 'Visible', log10Wavelength: Math.log10(550e-9), wavelength: '400–700 nm', survey: 'Gaia DR3 and optical all-sky mosaic', detecting: 'The light your eyes see: starlight, and dust lanes that block it.' },
  { id: 'h-alpha', short: 'H-alpha', label: 'Hydrogen-alpha', log10Wavelength: Math.log10(656.3e-9), wavelength: '656.3 nm', survey: 'Finkbeiner 2003 H-alpha composite', detecting: 'Glowing hydrogen gas ionised by hot young stars.' },
  { id: 'ultraviolet', short: 'UV', label: 'Ultraviolet', log10Wavelength: Math.log10(230e-9), wavelength: '230 nm', survey: 'GALEX', detecting: 'Hot, young, massive stars.' },
  { id: 'x-ray', short: 'X-ray', label: 'X-ray', log10Wavelength: Math.log10(1.2e-9), wavelength: '1.2 nm (1 keV)', survey: 'ROSAT All-Sky Survey', detecting: 'Million-degree gas: supernova remnants, galaxy clusters and accreting black holes.' },
  { id: 'gamma-ray', short: 'Gamma', label: 'Gamma ray', log10Wavelength: Math.log10(1.2e-15), wavelength: '1 GeV photons', survey: 'Fermi LAT', detecting: 'Cosmic rays striking gas, pulsars and blazar jets: the most energetic light.' },
];

export function bandInfo(id: SpectralBandId): SpectralBandInfo {
  return SPECTRAL_BANDS.find(b => b.id === id) ?? SPECTRAL_BANDS[6];
}
