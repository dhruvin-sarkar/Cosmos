/**
 * Texture index resolver (public/textures/index.json, written by scripts/data/textures/).
 *
 * Expected index shape (docs/data/textures.md):
 *   { "bodies":  { "<bodyId>": { "<mapType>": { "ultra" | "high" | "low": "<path>" | { path, width?, height?, bytes?, credit? } } } },
 *     "credits": { "<path | dir/ | bodyId | bodyId/mapType | creditId>": "<text>" | { text?, title?, author?, source?, license?, … } },
 *     "convention": "equirectangular 2:1, x = 0 at 180°W, …" }
 * Paths are resolved to app-base-relative paths ('textures/earth/day_8k.jpg') ready for `AssetLoader.texture()`.
 * Body ids may be given with or without the entity namespace ('sol:earth' and 'earth' both resolve).
 * Missing tiers fall back gracefully (requested tier, then lower tiers, then higher); a missing index → null,
 * and callers keep their fallback colors.
 */
import { defaultFetchJson, type FetchJson } from './manifest';

export type TextureQuality = 'ultra' | 'high' | 'low';

export const TEXTURE_INDEX_PATH = 'textures/index.json';
export const TEXTURE_QUALITIES: readonly TextureQuality[] = ['low', 'high', 'ultra'];

/** Fallback order per requested tier: the requested one, then cheaper ones, then richer ones. */
const FALLBACK: Readonly<Record<TextureQuality, readonly TextureQuality[]>> = {
  ultra: ['ultra', 'high', 'low'],
  high: ['high', 'low', 'ultra'],
  low: ['low', 'high', 'ultra'],
};

/** Map types that stand in for each other when the requested one is absent (a body's base color map). */
const COLOR_MAP_ALIASES = ['color', 'albedo', 'diffuse', 'surface', 'day'];

export interface TextureVariant {
  /** App-base-relative path, e.g. 'textures/earth/day_8k.jpg'. */
  path: string;
  width?: number;
  height?: number;
  bytes?: number;
  format?: string;
  /** Credit id (key of `credits`) or free attribution text. */
  credit?: string;
}

export interface TextureCredit {
  /** One-line plain-text attribution for the UI. */
  text: string;
  title?: string;
  author?: string;
  source?: string;
  license?: string;
  licenseUrl?: string;
  url?: string;
}

export interface TextureIndex {
  bodies: Record<string, Record<string, Partial<Record<TextureQuality, TextureVariant>>>>;
  credits: Record<string, TextureCredit>;
  convention: string;
}

export interface ResolvedTexture {
  path: string;
  bodyId: string;
  mapType: string;
  /** Tier actually used. */
  quality: TextureQuality;
  requested: TextureQuality;
  /** True when a different tier (or an alias map type) had to be used. */
  fallback: boolean;
  variant: TextureVariant;
}

// ── Parsing ──────────────────────────────────────────────────────────────────────────────────

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const KNOWN_ROOTS = /^(textures|models|data)\//;

/** Normalize a path from the index to an app-base-relative path (relative paths resolve against the index directory). */
export function normalizeTexturePath(path: string, baseDir = 'textures/'): string {
  let p = path.trim().replace(/\\/g, '/');
  if (/^[a-z][a-z0-9+.-]*:/i.test(p)) return p;
  p = p.replace(/^\/+/, '').replace(/^public\//, '');
  if (!KNOWN_ROOTS.test(p)) p = baseDir.replace(/\/*$/, '/') + p.replace(/^\.\//, '');
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return out.join('/');
}

function tierOf(key: string): TextureQuality | null {
  const k = key.toLowerCase();
  if (k === 'ultra' || k === '8k' || k === '16k') return 'ultra';
  if (k === 'high' || k === '4k' || k === 'medium' || k === 'mid') return 'high';
  if (k === 'low' || k === '2k' || k === '1k' || k === 'preview') return 'low';
  return null;
}

function parseVariant(v: unknown, baseDir: string): TextureVariant | null {
  if (typeof v === 'string') return v.trim() ? { path: normalizeTexturePath(v, baseDir) } : null;
  if (!isObject(v)) return null;
  const p = [v.path, v.file, v.url].find((x): x is string => typeof x === 'string' && x.trim() !== '');
  if (!p) return null;
  const out: TextureVariant = { path: normalizeTexturePath(p, baseDir) };
  if (typeof v.width === 'number') out.width = v.width;
  if (typeof v.height === 'number') out.height = v.height;
  if (typeof v.bytes === 'number') out.bytes = v.bytes;
  if (typeof v.format === 'string') out.format = v.format;
  if (typeof v.credit === 'string') out.credit = v.credit;
  return out;
}

function parseTiers(v: unknown, baseDir: string, where: string, warnings: string[]): Partial<Record<TextureQuality, TextureVariant>> {
  const tiers: Partial<Record<TextureQuality, TextureVariant>> = {};
  const single = parseVariant(v, baseDir);
  if (typeof v === 'string' || (isObject(v) && single && !Object.keys(v).some((k) => tierOf(k)))) {
    if (single) tiers.high = single;
    return tiers;
  }
  const entries: [string, unknown][] = Array.isArray(v)
    ? v.flatMap((e): [string, unknown][] => (isObject(e) && typeof (e.quality ?? e.tier) === 'string' ? [[String(e.quality ?? e.tier), e]] : []))
    : isObject(v) ? Object.entries(v) : [];
  for (const [key, value] of entries) {
    const tier = tierOf(key);
    if (!tier) continue;
    const variant = parseVariant(value, baseDir);
    if (variant) tiers[tier] = variant;
    else warnings.push(`${where}.${key}: no usable path`);
  }
  return tiers;
}

function creditText(c: Record<string, unknown>): string {
  for (const k of ['text', 'credit', 'attribution', 'line']) {
    const v = c[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  const parts = ['title', 'author', 'creator', 'source', 'organization', 'license']
    .map((k) => c[k])
    .filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return parts.join(' · ');
}

function parseCredit(v: unknown): TextureCredit | null {
  if (typeof v === 'string') return v.trim() ? { text: v.trim() } : null;
  if (!isObject(v)) return null;
  const text = creditText(v);
  if (!text) return null;
  const out: TextureCredit = { text };
  const pick = (k: keyof TextureCredit, ...src: string[]): void => {
    const val = src.map((s) => v[s]).find((x): x is string => typeof x === 'string' && x.trim() !== '');
    if (val) (out as unknown as Record<string, string>)[k] = val;
  };
  pick('title', 'title', 'name');
  pick('author', 'author', 'creator');
  pick('source', 'source', 'organization');
  pick('license', 'license');
  pick('licenseUrl', 'licenseUrl', 'license_url');
  pick('url', 'url', 'sourceUrl', 'link');
  return out;
}

const looksLikePath = (key: string): boolean => /\/|\.[a-z0-9]{2,5}$/i.test(key) && !/^[a-z]+:[^/]/i.test(key);

export interface TextureIndexParseResult {
  index: TextureIndex | null;
  warnings: string[];
}

/** Validate + normalize a parsed index.json (tolerant of a few shape variants; see file header). */
export function parseTextureIndex(raw: unknown, indexPath = TEXTURE_INDEX_PATH): TextureIndexParseResult {
  const warnings: string[] = [];
  if (!isObject(raw)) return { index: null, warnings: ['texture index is not a JSON object'] };
  const baseDir = typeof raw.basePath === 'string'
    ? normalizeTexturePath(raw.basePath.replace(/\/*$/, '/') + 'x', '').replace(/x$/, '')
    : indexPath.slice(0, indexPath.lastIndexOf('/') + 1);
  if (!isObject(raw.bodies)) return { index: null, warnings: ['texture index has no "bodies" object'] };
  const bodies: TextureIndex['bodies'] = {};
  for (const [bodyId, maps] of Object.entries(raw.bodies)) {
    if (!isObject(maps)) {
      warnings.push(`bodies.${bodyId}: not an object`);
      continue;
    }
    const out: Record<string, Partial<Record<TextureQuality, TextureVariant>>> = {};
    for (const [mapType, tiersRaw] of Object.entries(maps)) {
      const tiers = parseTiers(tiersRaw, baseDir, `bodies.${bodyId}.${mapType}`, warnings);
      if (Object.keys(tiers).length > 0) out[mapType] = tiers;
    }
    if (Object.keys(out).length > 0) bodies[bodyId] = out;
  }
  const credits: Record<string, TextureCredit> = {};
  if (isObject(raw.credits)) {
    for (const [key, value] of Object.entries(raw.credits)) {
      const credit = parseCredit(value);
      if (!credit) {
        warnings.push(`credits.${key}: empty`);
        continue;
      }
      const isDir = key.endsWith('/');
      const k = looksLikePath(key) ? normalizeTexturePath(key, baseDir) + (isDir ? '/' : '') : key;
      credits[k] = credit;
      const listed = isObject(value) ? (value.files ?? value.paths) : undefined;
      if (Array.isArray(listed)) {
        for (const p of listed) if (typeof p === 'string') credits[normalizeTexturePath(p, baseDir)] = credit;
      }
    }
  }
  const convention = typeof raw.convention === 'string' ? raw.convention : raw.convention != null ? JSON.stringify(raw.convention) : '';
  return { index: { bodies, credits, convention }, warnings };
}

export interface TextureIndexLoadResult extends TextureIndexParseResult {
  status: 'ok' | 'error' | 'invalid';
  error: string | null;
}

export async function loadTextureIndexDetailed(fetchJson: FetchJson = defaultFetchJson, path = TEXTURE_INDEX_PATH): Promise<TextureIndexLoadResult> {
  let raw: unknown;
  try {
    raw = await fetchJson<unknown>(path);
  } catch (err) {
    return { index: null, warnings: [], status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
  const parsed = parseTextureIndex(raw, path);
  return parsed.index
    ? { ...parsed, status: 'ok', error: null }
    : { ...parsed, status: 'invalid', error: parsed.warnings[0] ?? 'invalid texture index' };
}

/** Load 'textures/index.json'. Resolves to null when missing or malformed — never rejects. */
export async function loadTextureIndex(fetchJson?: FetchJson): Promise<TextureIndex | null> {
  return (await loadTextureIndexDetailed(fetchJson)).index;
}

// ── Resolution ───────────────────────────────────────────────────────────────────────────────

function bodyKey(index: TextureIndex, bodyId: string): string | null {
  if (index.bodies[bodyId]) return bodyId;
  const bare = bodyId.slice(bodyId.indexOf(':') + 1);
  for (const candidate of [bare, bodyId.toLowerCase(), bare.toLowerCase()]) if (index.bodies[candidate]) return candidate;
  return null;
}

/** Resolve with full details (actual tier, whether a fallback was used). Null when the body/map is not indexed. */
export function resolveTextureInfo(
  index: TextureIndex | null | undefined, bodyId: string, mapType: string, quality: TextureQuality = 'high',
): ResolvedTexture | null {
  if (!index) return null;
  const key = bodyKey(index, bodyId);
  if (!key) return null;
  const maps = index.bodies[key];
  const order = FALLBACK[quality] ?? FALLBACK.high;
  const mapCandidates = [mapType, ...(COLOR_MAP_ALIASES.includes(mapType) ? COLOR_MAP_ALIASES.filter((m) => m !== mapType) : [])];
  for (const m of mapCandidates) {
    const tiers = maps[m];
    if (!tiers) continue;
    for (const tier of order) {
      const variant = tiers[tier];
      if (variant) {
        return { path: variant.path, bodyId: key, mapType: m, quality: tier, requested: quality, fallback: tier !== quality || m !== mapType, variant };
      }
    }
  }
  return null;
}

/** App-base-relative texture path for a body map at the requested tier (with tier fallback), or null. */
export function resolveTexture(index: TextureIndex | null | undefined, bodyId: string, mapType: string, quality: TextureQuality = 'high'): string | null {
  return resolveTextureInfo(index, bodyId, mapType, quality)?.path ?? null;
}

/** Map types indexed for a body (e.g. ['day', 'night', 'clouds', 'normal']). */
export function textureMapTypes(index: TextureIndex | null | undefined, bodyId: string): string[] {
  if (!index) return [];
  const key = bodyKey(index, bodyId);
  return key ? Object.keys(index.bodies[key]) : [];
}

/** Tiers available for a body map, ordered low → ultra. */
export function availableQualities(index: TextureIndex | null | undefined, bodyId: string, mapType: string): TextureQuality[] {
  if (!index) return [];
  const key = bodyKey(index, bodyId);
  const tiers = key ? index.bodies[key][mapType] : undefined;
  return tiers ? TEXTURE_QUALITIES.filter((q) => tiers[q]) : [];
}

interface Owner {
  bodyId: string;
  mapType: string;
  variant: TextureVariant;
}

const ownerCache = new WeakMap<TextureIndex, Map<string, Owner>>();

function owners(index: TextureIndex): Map<string, Owner> {
  let map = ownerCache.get(index);
  if (!map) {
    map = new Map();
    for (const [bodyId, maps] of Object.entries(index.bodies)) {
      for (const [mapType, tiers] of Object.entries(maps)) {
        for (const q of TEXTURE_QUALITIES) {
          const variant = tiers[q];
          if (variant && !map.has(variant.path)) map.set(variant.path, { bodyId, mapType, variant });
        }
      }
    }
    ownerCache.set(index, map);
  }
  return map;
}

/**
 * Attribution for a texture path: an exact path credit, the variant's own credit (id or text), the longest
 * directory credit ('textures/earth/'), then body-level credits ('earth/day', 'earth'). Null when uncredited.
 */
export function creditFor(index: TextureIndex | null | undefined, path: string): TextureCredit | null {
  if (!index || !path) return null;
  const p = normalizeTexturePath(path);
  const { credits } = index;
  if (credits[p]) return credits[p];
  const owner = owners(index).get(p);
  if (owner?.variant.credit) return credits[owner.variant.credit] ?? { text: owner.variant.credit };
  let best: string | null = null;
  for (const key of Object.keys(credits)) {
    if (key.endsWith('/') && p.startsWith(key) && (!best || key.length > best.length)) best = key;
  }
  if (best) return credits[best];
  if (owner) {
    const { bodyId, mapType } = owner;
    for (const key of [`${bodyId}/${mapType}`, `${bodyId}.${mapType}`, `${bodyId}:${mapType}`, bodyId]) if (credits[key]) return credits[key];
  }
  return null;
}
