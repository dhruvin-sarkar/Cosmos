/**
 * Surface-feature records (built by scripts/data/features/build-features.mjs from the IAU/USGS Gazetteer of Planetary
 * Nomenclature plus published landing-site coordinates). Coordinates: planetocentric latitude, east-positive longitude
 * in (-180, 180], degrees. The same table ships as public/data/features/features.json for the data runtime.
 */
import raw from './features.generated.json';

export type FeatureCategory = 'feature' | 'landing-site' | 'atmospheric';

export interface FeatureMission {
  name: string;
  agency: string;
  /** Landing date (UTC, YYYY-MM-DD). */
  date: string;
  coordinateSource: string;
}

export interface FeatureDynamic {
  /** Jupiter System II longitude (deg, west-positive) at `epoch`. */
  systemIILonDeg: number;
  epoch: string;
  driftDegPerMonth: number;
}

export interface FeatureRecord {
  /** 'feat:<body>:<slug>' */
  id: string;
  /** Body key, e.g. 'moon', 'mars', 'titan'. */
  body: string;
  name: string;
  aliases: string[];
  category: FeatureCategory;
  /** Gazetteer descriptor term (e.g. 'Crater', 'Mons', 'Mare') or 'Landing site'. */
  type: string;
  code: string | null;
  latDeg: number;
  /** East longitude; null when the drawn position is taken from the renderer (Great Red Spot). */
  lonDeg: number | null;
  diameterKm: number | null;
  origin: string | null;
  approval: string | null;
  approvalDate: string | null;
  gazetteerId: number | null;
  link: string | null;
  /** Editorial rank 0..100 (label declutter + search). */
  importance: number;
  tagline: string | null;
  source: 'gazetteer' | 'mission' | 'literature';
  reference?: string;
  mission?: FeatureMission;
  dynamic?: FeatureDynamic;
}

interface RawRecord extends Omit<FeatureRecord, 'latDeg' | 'lonDeg'> {
  lat: number;
  lon: number | null;
}

interface RawFile {
  version: number;
  generated: string;
  retrieved: string;
  features: RawRecord[];
}

const file = raw as unknown as RawFile;

export const FEATURES_RETRIEVED = file.retrieved;

/** Popular names visitors type into search (informal; never shown as the feature's name). */
const EXTRA_ALIASES: Record<string, string[]> = {
  'feat:enceladus:baghdad-sulcus': ['Tiger stripes'],
  'feat:enceladus:damascus-sulcus': ['Tiger stripes'],
  'feat:enceladus:alexandria-sulcus': ['Tiger stripes'],
  'feat:enceladus:cairo-sulcus': ['Tiger stripes'],
  'feat:pluto:tombaugh-regio': ["Pluto's heart", 'The heart'],
  'feat:pluto:sputnik-planitia': ["Pluto's heart (western lobe)"],
  'feat:mars:valles-marineris': ['Mariner Valley', 'Grand Canyon of Mars'],
  'feat:mars:olympus-mons': ['Tallest volcano'],
  'feat:mercury:caloris-planitia': ['Caloris'],
  'feat:io:loki-patera': ['Loki'],
};

export const FEATURE_RECORDS: readonly FeatureRecord[] = file.features.map(({ lat, lon, ...r }) => ({
  ...r,
  aliases: EXTRA_ALIASES[r.id] ? [...r.aliases, ...EXTRA_ALIASES[r.id]] : r.aliases,
  latDeg: lat,
  lonDeg: lon,
}));

export const FEATURE_IDS: string[] = FEATURE_RECORDS.map((r) => r.id);

export const GAZETTEER_DATASET = 'iau-usgs-gazetteer';
export const SITES_DATASET = 'features-landing-sites';

/** Great Red Spot System II longitude (deg, west-positive, 0..360) at `tMs` from a linear drift model. */
export function systemIILongitude(d: FeatureDynamic, tMs: number): number {
  const months = (tMs - Date.parse(d.epoch)) / (86_400_000 * 30.4375);
  const l = d.systemIILonDeg + d.driftDegPerMonth * months;
  return ((l % 360) + 360) % 360;
}
