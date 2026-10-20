/**
 * Interior-structure data for the cutaway view. Built by scripts/data/interiors/build.mjs into
 * public/data/interiors/interiors.json (every layer cited; see docs/data/interiors.md). This module is tiny and
 * three.js-free so the Inspector can import it eagerly to decide whether to show the "See inside" control.
 */

export type InteriorMaterial =
  | 'rock' | 'crust' | 'metal' | 'metallic-hydrogen' | 'gas' | 'ice' | 'ocean' | 'plasma' | 'fluid-ices'
  | 'rock-ice' | 'melt' | 'dilute-core' | 'photosphere';

export type InteriorProvenance = 'observed' | 'derived' | 'model';

export interface InteriorLayer {
  id: string;
  name: string;
  /** Outer radius of the layer from the body centre, km. */
  outerKm: number;
  /** Spread of published models for the outer radius, km (model-dependent boundaries only). */
  outerRangeKm?: [number, number];
  innerKm: number;
  thicknessKm: number;
  /** outerKm / body mean radius. */
  fraction: number;
  fractionRange?: [number, number];
  state: string;
  composition: string;
  densityKgM3: [number, number] | null;
  temperatureK: [number, number] | null;
  material: InteriorMaterial;
  /** True when the boundary or values depend on an interior model rather than a direct measurement. */
  model: boolean;
  provenance: InteriorProvenance;
  /** Plain-language description for 12-18 year olds. */
  plain: string;
  sources: string[];
}

export interface InteriorMethod {
  method: string;
  text: string;
  sources: string[];
}

export interface InteriorBody {
  /** Texture folder / bodies.json id ('earth'). */
  body: string;
  /** Entity id ('sol:earth'). */
  id: string;
  name: string;
  classification: string;
  /** Texture folder under public/textures, or null for a procedural surface (the Sun). */
  texture: string | null;
  lede: string;
  howWeKnow: InteriorMethod[];
  uncertainty?: string;
  /** Default partner in compare mode (body key). */
  compareWith: string;
  radiusKm: number;
  /** Centre -> surface. */
  layers: InteriorLayer[];
}

export interface InteriorReference {
  cite: string;
  doi?: string;
}

export interface InteriorsData {
  schemaVersion: 1;
  generated: string;
  notes: string[];
  references: Record<string, InteriorReference>;
  bodies: InteriorBody[];
}

/** Entity ids that have interior data (kept in sync with the JSON by data.test.ts). */
export const INTERIOR_ENTITY_IDS: readonly string[] = [
  'sol:sun', 'sol:mercury', 'sol:venus', 'sol:earth', 'sol:moon', 'sol:mars', 'sol:jupiter', 'sol:saturn',
  'sol:uranus', 'sol:neptune', 'sol:ceres', 'sol:pluto', 'sol:io', 'sol:europa', 'sol:ganymede', 'sol:callisto',
  'sol:enceladus', 'sol:titan',
];

const IDS = new Set(INTERIOR_ENTITY_IDS);

export function hasInterior(entityId: string | null | undefined): boolean {
  return entityId != null && IDS.has(entityId);
}

function baseUrl(): string {
  return (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
}

let cache: Promise<InteriorsData> | null = null;

/** Fetches interiors.json once; a failed fetch clears the cache so the next open retries. */
export function loadInteriors(): Promise<InteriorsData> {
  cache ??= fetch(`${baseUrl()}data/interiors/interiors.json`)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.json() as Promise<InteriorsData>;
    })
    .catch((e: unknown) => {
      cache = null;
      throw e;
    });
  return cache;
}

export function findBody(data: InteriorsData, idOrKey: string): InteriorBody | undefined {
  return data.bodies.find(b => b.id === idOrKey || b.body === idOrKey);
}

/** Minimum drawn thickness of a layer as a fraction of the body radius; thinner layers are drawn this thick. */
export const MIN_DRAWN_FRACTION = 0.014;

/**
 * Drawn outer radii (fraction of the body radius) for each layer, centre -> surface. True proportions except that
 * layers thinner than MIN_DRAWN_FRACTION are widened (pushing the boundaries below them inward) so they stay visible.
 */
export function drawnRadii(body: InteriorBody): { radii: number[]; exaggerated: boolean[] } {
  const n = body.layers.length;
  const radii = body.layers.map(l => Math.min(1, l.outerKm / body.radiusKm));
  radii[n - 1] = 1;
  const exaggerated = new Array<boolean>(n).fill(false);
  for (let i = n - 2; i >= 0; i--) {
    const maxOuter = radii[i + 1] - MIN_DRAWN_FRACTION;
    if (radii[i] > maxOuter) {
      radii[i] = maxOuter;
      exaggerated[i + 1] = true;
    }
  }
  if (radii[0] < MIN_DRAWN_FRACTION) {
    radii[0] = MIN_DRAWN_FRACTION;
    exaggerated[0] = true;
  }
  return { radii, exaggerated };
}

/** Linear temperature through a layer: hottest at its inner edge. */
export function layerTemperatureAt(layer: InteriorLayer, t01FromInner: number): number | null {
  if (!layer.temperatureK) return null;
  const [lo, hi] = layer.temperatureK;
  return hi + (lo - hi) * Math.min(1, Math.max(0, t01FromInner));
}
