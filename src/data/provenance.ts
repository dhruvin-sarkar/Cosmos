/**
 * Scientific provenance model.
 *
 * Every value or visual Cosmos shows must answer "Where did this come from?". Four classes:
 *  - observed:      directly catalogued or measured (catalog value, survey image, mission measurement)
 *  - derived:       calculated from measured values with a documented model (e.g. Teq from T★, R★, a, A)
 *  - reconstructed: a spatial/visual representation inferred from data (e.g. Milky Way spiral-arm model)
 *  - illustrative:  generated for communication/continuity where observations are insufficient
 *                   (e.g. an exoplanet's surface appearance) — must ALWAYS be labelled as such in the UI.
 *
 * Rules (enforced by review, see docs/ARCHITECTURE.md §Provenance):
 *  - Unknown values are `null`, displayed as "Unknown" — never 0, never invented.
 *  - Derived values name their model (`model: 'teq-blackbody@1'`) and list assumptions.
 *  - Scientific metadata is rendered as plain text — never as HTML.
 */

export type ProvenanceClass = 'observed' | 'derived' | 'reconstructed' | 'illustrative';

export const PROVENANCE_LABEL: Record<ProvenanceClass, string> = {
  observed: 'Observed',
  derived: 'Derived',
  reconstructed: 'Reconstructed',
  illustrative: 'Illustrative',
};

export const PROVENANCE_DESCRIPTION: Record<ProvenanceClass, string> = {
  observed: 'Directly catalogued or measured by a survey, mission or observatory.',
  derived: 'Calculated from measured quantities using a documented physical model.',
  reconstructed: 'A spatial or visual representation inferred from scientific data.',
  illustrative: 'Generated for visual communication where observations cannot specify the appearance or exact location.',
};

/** Reference to a dataset in the data-source registry (public/data/manifest.json → DataManifest.datasets[datasetId]). */
export interface SourceRef {
  datasetId: string;
  /** Source column / field name, e.g. 'pl_eqt'. */
  field?: string;
  /** Literature reference for this specific value (bibcode, DOI or citation string), e.g. a planet's pl_refname. */
  reference?: string;
  note?: string;
}

export type Uncertainty =
  | { kind: 'symmetric'; sigma: number }
  /** `plus`/`minus` are positive magnitudes: value +plus −minus. */
  | { kind: 'asymmetric'; plus: number; minus: number }
  | { kind: 'range'; min: number; max: number }
  /** The value is an upper/lower limit rather than a measurement. */
  | { kind: 'limit'; type: 'upper' | 'lower' };

/**
 * A number with unit, uncertainty and provenance. `unit` is a display/unit id such as
 * 'm', 'km', 'AU', 'pc', 'ly', 'K', 'kg', 'M_earth', 'R_earth', 'M_sun', 'R_sun', 'L_sun', 'd', 'h', 'yr',
 * 'deg', 'km/s', 'm/s', 'mm/s', 'bar', 'g/cm3', 'W/m2', 'S_earth' (insolation relative to Earth), '' (dimensionless).
 */
export interface Quantity {
  /** null = unknown / not measured. Never use 0 as a stand-in for missing data. */
  value: number | null;
  unit: string;
  uncertainty?: Uncertainty;
  provenance: ProvenanceClass;
  source?: SourceRef;
  /** For derived values: model id + version, e.g. 'teq-blackbody@1'. */
  model?: string;
  /** Significant digits appropriate for display (avoid false precision). */
  sigDigits?: number;
}

export interface Fact {
  /** Stable key, e.g. 'radius', 'mass', 'teq'. */
  key: string;
  /** Human label, e.g. "Radius". */
  label: string;
  quantity?: Quantity;
  /** Textual value when not numeric (e.g. spectral type "M8V", discovery method "Transit"). */
  text?: string;
  provenance: ProvenanceClass;
  source?: SourceRef;
  /** Short explanation shown on hover / "what is this?". Plain text. */
  help?: string;
}

export type FactSectionId = 'overview' | 'properties' | 'orbit' | 'science' | 'observations' | 'sources' | 'experiment';

export interface FactSection {
  id: FactSectionId | string;
  title: string;
  facts: Fact[];
  /** Plain-text paragraphs (never HTML). */
  paragraphs?: string[];
}

export interface RepresentationInfo {
  /** How the VISUAL itself should be read (e.g. a textured Earth is 'observed' imagery; an exoplanet surface is 'illustrative'). */
  provenance: ProvenanceClass;
  /** e.g. "Surface: NASA Blue Marble Next Generation mosaic" or "Appearance generated from radius & temperature class". */
  description: string;
}

export interface FactSheet {
  entityId: string;
  /** 1–3 sentence plain-language overview: what is it, why does it matter. */
  summary: string;
  sections: FactSection[];
  representation: RepresentationInfo;
  /** Datasets used; resolve names/versions/retrieval dates/licenses via the manifest. */
  sources: SourceRef[];
  /** Reference epoch of the underlying data (e.g. orbital-element epoch), distinct from current simulation time. */
  epoch?: { label: string; iso?: string; jd?: number };
  /** Notable properties that are unknown (shown explicitly as Unknown). */
  missing?: string[];
  /** Model assumptions behind derived values on this sheet. */
  assumptions?: string[];
}

/** One entry of the data-source registry (written by scripts/data/<domain>/ into manifest.part.json, merged into manifest.json). */
export interface DatasetRecord {
  id: string;
  name: string;
  organization: string;
  purpose: string;
  mechanism: string;
  endpoint: string;
  query: string | null;
  version: string;
  /** ISO-8601 UTC timestamp of retrieval, e.g. "2026-10-16T20:00:00Z". */
  retrieved: string;
  license: string;
  licenseUrl: string | null;
  citation: string;
  rateLimits: string;
  fieldsUsed: string[];
  updateCadence: string;
  cachePolicy: string;
  normalization: string;
  fallback: string;
  /** Paths relative to public/ (e.g. "data/exoplanets/planets.json"). */
  files: { path: string; bytes?: number; records?: number }[];
  limitations: string;
  provenanceClass: ProvenanceClass;
}

export interface DataManifest {
  schemaVersion: number;
  generated: string;
  datasets: Record<string, DatasetRecord & { domain: string }>;
}

// ── Small constructors (keep call sites terse and consistent) ─────────────────────────────

export function observed(value: number | null, unit: string, source?: SourceRef, uncertainty?: Uncertainty): Quantity {
  return { value, unit, provenance: 'observed', source, uncertainty };
}

export function derived(value: number | null, unit: string, model: string, source?: SourceRef, uncertainty?: Uncertainty): Quantity {
  return { value, unit, provenance: 'derived', model, source, uncertainty };
}

export function unknown(unit: string, source?: SourceRef): Quantity {
  return { value: null, unit, provenance: 'observed', source };
}
