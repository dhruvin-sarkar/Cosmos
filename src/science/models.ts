/**
 * Model registry — the single place the UI's "show calculation" reads from.
 *
 * Every scientific model in src/science documents itself as a {@link ModelInfo} next to its implementation
 * (e.g. `EXOPLANET_MODELS` in exoplanets.ts) and is collected here. Derived quantities reference a model by its
 * key `"<id>@<version>"` (e.g. `Quantity.model = 'teq-blackbody@1'`); a model's behaviour never changes without
 * a version bump, so a stored key always identifies the exact equation used.
 *
 * Science modules import only *types* from this file, so there is no runtime import cycle.
 */
import { ORBIT_MODELS } from './orbits';
import { PHOTOMETRY_MODELS } from './photometry';
import { EXOPLANET_MODELS } from './exoplanets';
import { RELATIVITY_MODELS } from './relativity';
import { IMPACT_MODELS } from './impact';
import { DEBRIS_MODELS } from './debris';
import { COSMOLOGY_MODELS } from './cosmology';

export interface ModelVariable {
  /** KaTeX symbol, e.g. 'T_\\star'. */
  symbol: string;
  /** Plain-language meaning. */
  meaning: string;
  /** Display unit id (see Quantity.unit), '' for dimensionless. */
  unit: string;
}

export interface ModelReference {
  /** Human-readable citation, e.g. 'Kopparapu et al. 2014, ApJL 787, L29'. */
  citation: string;
  doi?: string;
  bibcode?: string;
  url?: string;
}

/**
 * 'derived' = a physical model whose output is a scientific estimate;
 * 'illustrative' = a visualization heuristic that must be labelled as such wherever its output is shown.
 */
export type ModelKind = 'derived' | 'illustrative';

export interface ModelInfo {
  /** Stable kebab-case id, e.g. 'teq-blackbody'. */
  id: string;
  /** Integer version; bump when the equation or coefficients change. */
  version: number;
  title: string;
  /** 1–2 plain-language sentences: what the model computes and why it is useful. */
  summary: string;
  /** Main equation as a KaTeX string. */
  latex: string;
  /** Supporting equations (KaTeX), shown under the main one. */
  extraLatex?: string[];
  variables: ModelVariable[];
  assumptions: string[];
  /** Domain of validity (parameter ranges, regimes). */
  validity: string;
  /** Expected accuracy versus reality or a higher-fidelity model, when known. */
  accuracy?: string;
  kind: ModelKind;
  references: ModelReference[];
}

export type ModelKey = `${string}@${number}`;

export function modelKey(m: Pick<ModelInfo, 'id' | 'version'>): ModelKey {
  return `${m.id}@${m.version}`;
}

function buildRegistry(groups: readonly (readonly ModelInfo[])[]): Readonly<Record<string, ModelInfo>> {
  const out: Record<string, ModelInfo> = {};
  for (const group of groups) {
    for (const m of group) {
      const key = modelKey(m);
      if (out[key]) throw new Error(`Duplicate science model key ${key}`);
      out[key] = Object.freeze(m);
    }
  }
  return Object.freeze(out);
}

/** All registered models keyed by `"<id>@<version>"`. */
export const MODEL_REGISTRY: Readonly<Record<string, ModelInfo>> = buildRegistry([
  ORBIT_MODELS,
  PHOTOMETRY_MODELS,
  EXOPLANET_MODELS,
  RELATIVITY_MODELS,
  IMPACT_MODELS,
  DEBRIS_MODELS,
  COSMOLOGY_MODELS,
]);

/**
 * Look up a model by full key ('teq-blackbody@1') or bare id ('teq-blackbody' → highest registered version).
 * Returns undefined for unknown models (the UI then hides "show calculation").
 */
export function getModel(keyOrId: string): ModelInfo | undefined {
  const exact = MODEL_REGISTRY[keyOrId];
  if (exact) return exact;
  let best: ModelInfo | undefined;
  for (const key in MODEL_REGISTRY) {
    const m = MODEL_REGISTRY[key];
    if (m.id === keyOrId && (!best || m.version > best.version)) best = m;
  }
  return best;
}

export function listModels(): readonly ModelInfo[] {
  return Object.values(MODEL_REGISTRY);
}
