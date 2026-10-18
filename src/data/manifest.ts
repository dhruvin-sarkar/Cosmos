/**
 * Runtime access to the data-source registry (public/data/manifest.json, built by
 * scripts/data/build-manifest.mjs from each domain's manifest.part.json).
 *
 * The manifest answers "How do we know?" for every value the UI shows: a `SourceRef.datasetId` resolves here
 * to the dataset's name, organization, version, retrieval date, license and citation. Loading never throws —
 * a missing or malformed manifest yields `null` and the UI shows "Unknown" source details instead of failing.
 */
import { formatAgeDays, UNKNOWN_TEXT } from './format';
import type { DataManifest, DatasetRecord, ProvenanceClass, SourceRef } from './provenance';

/** JSON fetcher with the semantics of `AssetLoader.json`: path relative to the app base; rejects on failure. */
export type FetchJson = <T = unknown>(path: string) => Promise<T>;

export type ManifestDataset = DatasetRecord & { domain: string };

/** Path of the merged registry relative to the app base URL. */
export const MANIFEST_PATH = 'data/manifest.json';
/** Highest manifest schema this runtime understands. */
export const MANIFEST_SCHEMA_VERSION = 1;

const MS_PER_DAY = 86_400_000;
const PROVENANCE_CLASSES: readonly ProvenanceClass[] = ['observed', 'derived', 'reconstructed', 'illustrative'];

// ── URLs & fetching ──────────────────────────────────────────────────────────────────────────

function baseUrl(): string {
  try {
    const base = import.meta.env?.BASE_URL;
    return typeof base === 'string' && base.length > 0 ? base : '/';
  } catch {
    return '/';
  }
}

/** Resolve a public-folder path (e.g. 'data/manifest.json') against Vite's BASE_URL. Absolute URLs pass through. */
export function dataUrl(path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  const base = baseUrl();
  const rel = path.replace(/^\.?\/+/, '');
  return base.endsWith('/') ? base + rel : `${base}/${rel}`;
}

/** Error raised by `defaultFetchJson`; `status` is the HTTP status (0 for network/parse failures). */
export class DataLoadError extends Error {
  readonly status: number;
  readonly path: string;
  constructor(message: string, path: string, status: number) {
    super(message);
    this.name = 'DataLoadError';
    this.path = path;
    this.status = status;
  }
}

/** `fetch` + JSON parse relative to BASE_URL; rejects with a DataLoadError describing what went wrong. */
export const defaultFetchJson: FetchJson = async <T>(path: string): Promise<T> => {
  let res: Response;
  try {
    res = await fetch(dataUrl(path));
  } catch (err) {
    throw new DataLoadError(`Network error loading ${path}: ${errorText(err)}`, path, 0);
  }
  if (!res.ok) throw new DataLoadError(`HTTP ${res.status} loading ${path}`, path, res.status);
  try {
    return (await res.json()) as T;
  } catch (err) {
    throw new DataLoadError(`Invalid JSON in ${path}: ${errorText(err)}`, path, 0);
  }
};

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function looksAbsent(err: unknown): boolean {
  if (err instanceof DataLoadError) return err.status === 404;
  return /\b404\b|not found/i.test(errorText(err));
}

// ── Parsing & validation ─────────────────────────────────────────────────────────────────────

export interface ManifestParseResult {
  manifest: DataManifest | null;
  /** Human-readable problems (records dropped or fields defaulted). */
  warnings: string[];
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

const REQUIRED_TEXT_FIELDS = [
  'name', 'organization', 'purpose', 'mechanism', 'endpoint', 'version', 'retrieved', 'license', 'citation',
  'rateLimits', 'updateCadence', 'cachePolicy', 'normalization', 'fallback', 'limitations',
] as const;

/**
 * Normalize one registry entry. Missing text fields become "Unknown" (with a warning) so the UI never
 * renders `undefined`; entries without a usable id are dropped.
 */
function normalizeDataset(key: string, raw: unknown, warnings: string[]): ManifestDataset | null {
  if (!isRecord(raw)) {
    warnings.push(`dataset "${key}": not an object — dropped`);
    return null;
  }
  const id = str(raw.id) ?? key;
  if (!id) {
    warnings.push('dataset without id — dropped');
    return null;
  }
  if (str(raw.id) && raw.id !== key) warnings.push(`dataset "${key}": id "${String(raw.id)}" differs from its key; using the key`);
  const missing: string[] = [];
  const text = (field: (typeof REQUIRED_TEXT_FIELDS)[number]): string => {
    const v = str(raw[field]);
    if (v == null || v.trim() === '') {
      missing.push(field);
      return UNKNOWN_TEXT;
    }
    return v;
  };
  const record: Record<string, unknown> = { ...raw };
  for (const f of REQUIRED_TEXT_FIELDS) record[f] = text(f);
  record.id = key;
  record.domain = str(raw.domain) ?? UNKNOWN_TEXT;
  record.query = str(raw.query);
  record.licenseUrl = str(raw.licenseUrl);
  record.fieldsUsed = Array.isArray(raw.fieldsUsed) ? raw.fieldsUsed.filter((f): f is string => typeof f === 'string') : [];
  record.files = Array.isArray(raw.files)
    ? raw.files.flatMap((f) => {
      if (!isRecord(f) || typeof f.path !== 'string') return [];
      const file: { path: string; bytes?: number; records?: number } = { path: f.path };
      if (typeof f.bytes === 'number' && Number.isFinite(f.bytes)) file.bytes = f.bytes;
      if (typeof f.records === 'number' && Number.isFinite(f.records)) file.records = f.records;
      return [file];
    })
    : [];
  const pc = str(raw.provenanceClass);
  if (pc && (PROVENANCE_CLASSES as readonly string[]).includes(pc)) record.provenanceClass = pc;
  else {
    record.provenanceClass = 'observed';
    missing.push('provenanceClass');
  }
  if (missing.length > 0) warnings.push(`dataset "${key}": missing ${missing.join(', ')}`);
  return record as unknown as ManifestDataset;
}

/** Validate a parsed manifest.json; returns null (with warnings) when it is not a usable registry. */
export function parseManifest(raw: unknown): ManifestParseResult {
  const warnings: string[] = [];
  if (!isRecord(raw)) return { manifest: null, warnings: ['manifest is not a JSON object'] };
  const schemaVersion = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : NaN;
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    return { manifest: null, warnings: [`manifest schemaVersion ${String(raw.schemaVersion)} is invalid`] };
  }
  if (schemaVersion > MANIFEST_SCHEMA_VERSION) {
    warnings.push(`manifest schemaVersion ${schemaVersion} is newer than supported (${MANIFEST_SCHEMA_VERSION}); reading known fields only`);
  }
  if (!isRecord(raw.datasets)) return { manifest: null, warnings: [...warnings, 'manifest has no "datasets" object'] };
  const datasets: Record<string, ManifestDataset> = {};
  for (const [key, value] of Object.entries(raw.datasets)) {
    const ds = normalizeDataset(key, value, warnings);
    if (ds) datasets[key] = ds;
  }
  return {
    manifest: { schemaVersion, generated: str(raw.generated) ?? UNKNOWN_TEXT, datasets },
    warnings,
  };
}

// ── Loading ──────────────────────────────────────────────────────────────────────────────────

export type ManifestLoadStatus = 'ok' | 'absent' | 'invalid' | 'error';

export interface ManifestLoadResult extends ManifestParseResult {
  status: ManifestLoadStatus;
  /** Failure description for 'absent' / 'invalid' / 'error'. */
  error: string | null;
}

/** Load + validate the registry, reporting why it is unavailable (for notices / the debug overlay). */
export async function loadManifestDetailed(fetchJson: FetchJson = defaultFetchJson, path = MANIFEST_PATH): Promise<ManifestLoadResult> {
  let raw: unknown;
  try {
    raw = await fetchJson<unknown>(path);
  } catch (err) {
    return { manifest: null, warnings: [], status: looksAbsent(err) ? 'absent' : 'error', error: errorText(err) };
  }
  const parsed = parseManifest(raw);
  if (!parsed.manifest) return { ...parsed, status: 'invalid', error: parsed.warnings[0] ?? 'invalid manifest' };
  return { ...parsed, status: 'ok', error: null };
}

/**
 * Load the data-source registry ('data/manifest.json' relative to BASE_URL). Resolves to null when the
 * file is absent, unreachable or malformed — never rejects. Pass `svc.assets.json` to share its cache.
 */
export async function loadManifest(fetchJson?: FetchJson): Promise<DataManifest | null> {
  return (await loadManifestDetailed(fetchJson)).manifest;
}

// ── Queries ──────────────────────────────────────────────────────────────────────────────────

export function getDataset(manifest: DataManifest | null | undefined, id: string | null | undefined): ManifestDataset | undefined {
  if (!manifest || !id) return undefined;
  return Object.prototype.hasOwnProperty.call(manifest.datasets, id) ? manifest.datasets[id] : undefined;
}

/** All datasets (optionally of one domain), sorted by domain then id. */
export function listDatasets(manifest: DataManifest | null | undefined, domain?: string): ManifestDataset[] {
  if (!manifest) return [];
  return Object.values(manifest.datasets)
    .filter((d) => domain == null || d.domain === domain)
    .sort((a, b) => (a.domain === b.domain ? a.id.localeCompare(b.id) : a.domain.localeCompare(b.domain)));
}

/** Parse an ISO-8601 retrieval timestamp to Unix ms (null when missing or unparseable). */
export function retrievedMs(record: Pick<DatasetRecord, 'retrieved'> | null | undefined): number | null {
  if (!record || typeof record.retrieved !== 'string') return null;
  const ms = Date.parse(record.retrieved);
  return Number.isFinite(ms) ? ms : null;
}

/** Days since the dataset was retrieved (null when unknown; never negative). */
export function datasetAgeDays(record: Pick<DatasetRecord, 'retrieved'> | null | undefined, nowMs: number = Date.now()): number | null {
  const ms = retrievedMs(record);
  return ms == null ? null : Math.max(0, (nowMs - ms) / MS_PER_DAY);
}

/**
 * True when the dataset was retrieved more than `days` days ago. A record whose retrieval date is unknown
 * counts as stale: the UI should rather show a "snapshot age unknown" notice than imply freshness.
 */
export function isStale(record: Pick<DatasetRecord, 'retrieved'> | null | undefined, days: number, nowMs: number = Date.now()): boolean {
  const age = datasetAgeDays(record, nowMs);
  return age == null || age > days;
}

/** Everything a source tooltip / Sources tab needs, as plain text (never HTML). */
export interface SourceDescription {
  datasetId: string;
  /** False when the dataset id is not in the registry (fields then read "Unknown"). */
  found: boolean;
  /** Full dataset name. */
  title: string;
  /** Name shortened for compact UI ("NASA Exoplanet Archive: Planetary Systems Composite Parameters"). */
  shortTitle: string;
  organization: string;
  version: string;
  /** ISO-8601 retrieval timestamp, or "Unknown". */
  retrieved: string;
  /** "2026-10-16", or "Unknown". */
  retrievedDate: string;
  license: string;
  /** First sentence of the license text (≤ 140 chars). */
  licenseSummary: string;
  licenseUrl: string | null;
  citation: string;
  /** Days since retrieval (null when unknown). */
  ageDays: number | null;
  /** "today", "3 days ago", … or "Unknown". */
  ageText: string;
  domain: string | null;
  provenanceClass: ProvenanceClass | null;
  /** Echoed from the SourceRef. */
  field?: string;
  reference?: string;
  note?: string;
}

function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.lastIndexOf(' ', max - 1);
  return `${text.slice(0, cut > max * 0.6 ? cut : max - 1).replace(/[\s,;:–—-]+$/, '')}…`;
}

/** Shorten a long dataset name at its first parenthetical / clause break after a meaningful head. */
export function shortDatasetTitle(name: string, max = 72): string {
  const t = name.trim();
  const m = /\s\(|,\s|;\s|\s[—–]\s/.exec(t.slice(12));
  const head = m ? t.slice(0, 12 + m.index) : t;
  return shorten(head, max);
}

function firstSentence(text: string, max = 140): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return shorten(m ? m[1] : text.trim(), max);
}

/** Resolve a SourceRef to display text for tooltips; unknown datasets yield "Unknown" fields, never throw. */
export function describeSource(manifest: DataManifest | null | undefined, ref: SourceRef, nowMs: number = Date.now()): SourceDescription {
  const ds = getDataset(manifest, ref.datasetId);
  const extras = {
    ...(ref.field != null ? { field: ref.field } : {}),
    ...(ref.reference != null ? { reference: ref.reference } : {}),
    ...(ref.note != null ? { note: ref.note } : {}),
  };
  if (!ds) {
    return {
      datasetId: ref.datasetId, found: false, title: ref.datasetId || UNKNOWN_TEXT, shortTitle: ref.datasetId || UNKNOWN_TEXT,
      organization: UNKNOWN_TEXT, version: UNKNOWN_TEXT, retrieved: UNKNOWN_TEXT, retrievedDate: UNKNOWN_TEXT,
      license: UNKNOWN_TEXT, licenseSummary: UNKNOWN_TEXT, licenseUrl: null, citation: UNKNOWN_TEXT,
      ageDays: null, ageText: UNKNOWN_TEXT, domain: null, provenanceClass: null, ...extras,
    };
  }
  const ms = retrievedMs(ds);
  const ageDays = datasetAgeDays(ds, nowMs);
  return {
    datasetId: ds.id,
    found: true,
    title: ds.name,
    shortTitle: shortDatasetTitle(ds.name),
    organization: ds.organization,
    version: ds.version,
    retrieved: ms == null ? UNKNOWN_TEXT : ds.retrieved,
    retrievedDate: ms == null ? UNKNOWN_TEXT : new Date(ms).toISOString().slice(0, 10),
    license: ds.license,
    licenseSummary: firstSentence(ds.license),
    licenseUrl: ds.licenseUrl,
    citation: ds.citation,
    ageDays,
    ageText: formatAgeDays(ageDays),
    domain: ds.domain,
    provenanceClass: ds.provenanceClass,
    ...extras,
  };
}

/** One line for compact UI / aria-labels: "CelesTrak Satellite Catalog · retrieved 2026-10-16 (1 day ago)". */
export function sourceSummaryText(desc: SourceDescription): string {
  if (!desc.found) return `${desc.title} · source details unavailable`;
  const when = desc.retrievedDate === UNKNOWN_TEXT ? 'retrieval date unknown' : `retrieved ${desc.retrievedDate} (${desc.ageText})`;
  return `${desc.shortTitle} · ${when}`;
}

/** Describe each distinct dataset referenced by `refs` once (first occurrence order), e.g. for a Sources tab. */
export function describeSources(manifest: DataManifest | null | undefined, refs: readonly SourceRef[], nowMs: number = Date.now()): SourceDescription[] {
  const seen = new Set<string>();
  const out: SourceDescription[] = [];
  for (const ref of refs) {
    if (!ref || seen.has(ref.datasetId)) continue;
    seen.add(ref.datasetId);
    out.push(describeSource(manifest, { datasetId: ref.datasetId }, nowMs));
  }
  return out;
}
