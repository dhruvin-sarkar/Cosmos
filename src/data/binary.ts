/**
 * Decoders for the two compact catalog formats of the offline snapshot (docs/ARCHITECTURE.md §12):
 *
 *  1. Interleaved little-endian Float32 binaries with a JSON header — large point catalogs (stars, galaxies):
 *       header: { count, stride, fields: (string | { name, unit?, description? })[], byteLength?, strideBytes?,
 *                 dtype?: 'float32', endianness?: 'little', encoding?: 'float32 little-endian, …' }
 *       record i, field f  →  data[i * stride + offset(f)]
 *  2. Row-oriented JSON tables { fields: string[], rows: unknown[][], types?, units? } — metadata catalogs
 *     (exoplanets, orbital elements, references). Missing values are `null`, never 0.
 *
 * Decoders validate strictly and throw `DataFormatError` with the file label and the exact problem, so a
 * truncated download or a schema drift fails loudly at load time instead of rendering garbage.
 */

export class DataFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DataFormatError';
  }
}

function fail(label: string, message: string): never {
  throw new DataFormatError(`${label}: ${message}`);
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const groupDigits = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');

// ── Interleaved Float32 binaries ─────────────────────────────────────────────────────────────

export interface BinaryFieldSpec {
  name: string;
  unit?: string | null;
  description?: string;
}

export interface InterleavedHeader {
  count: number;
  stride: number;
  /** One entry per float in a record, in record order. */
  fields: ReadonlyArray<string | BinaryFieldSpec>;
  byteLength?: number;
  strideBytes?: number;
  dtype?: string;
  endianness?: string;
  encoding?: string;
  /** Used in error messages when no explicit label is given. */
  file?: string;
}

export interface InterleavedParseOptions {
  /** Name used in error messages (defaults to header.file, else "binary"). */
  label?: string;
  /** Allow bytes after the last record (default false: the size must match exactly). */
  allowTrailingBytes?: boolean;
  /** Fields that must be finite in every record (NaN/±Infinity → error). Costs one pass per field. */
  requireFinite?: readonly string[];
}

/** Strided view of one field: value of record i = data[i * stride + offset]. */
export interface FieldAccessor {
  readonly name: string;
  readonly offset: number;
  readonly stride: number;
  readonly unit: string | null;
  get(index: number): number;
  /** Copy the column into a new Float32Array (allocates). */
  toArray(): Float32Array;
}

export interface InterleavedFloat32 {
  readonly data: Float32Array;
  readonly count: number;
  readonly stride: number;
  readonly fieldNames: readonly string[];
  /** Field accessor (cached; safe to call during setup, then keep the accessor or its offset). Throws for unknown names. */
  field(name: string): FieldAccessor;
  /** Offset of a field within a record, or -1 when absent. */
  offsetOf(name: string): number;
  has(name: string): boolean;
  /** data[index * stride + offset(name)] — convenience for non-hot paths. */
  get(index: number, name: string): number;
}

const LITTLE_ENDIAN_HOST = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

function fieldName(f: string | BinaryFieldSpec, i: number, label: string): string {
  const name = typeof f === 'string' ? f : isObject(f) && typeof f.name === 'string' ? f.name : null;
  if (!name || !name.trim()) fail(label, `field ${i} has no name`);
  return name;
}

function fieldUnit(f: string | BinaryFieldSpec, units: unknown): string | null {
  if (typeof f !== 'string' && typeof f.unit === 'string') return f.unit;
  const name = typeof f === 'string' ? f : f.name;
  return isObject(units) && typeof units[name] === 'string' ? (units[name] as string) : null;
}

function bytesOf(buffer: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (buffer instanceof ArrayBuffer) return new Uint8Array(buffer);
  if (ArrayBuffer.isView(buffer)) return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  throw new DataFormatError('expected an ArrayBuffer or typed-array view');
}

/** Validate a binary header (also usable before fetching the binary, e.g. to size progress bars). */
export function validateInterleavedHeader(header: unknown, label = 'binary'): InterleavedHeader {
  if (!isObject(header)) fail(label, 'header is not an object');
  const h = header as unknown as InterleavedHeader;
  if (!Number.isInteger(h.count) || h.count < 0) fail(label, `header.count must be a non-negative integer (got ${String(h.count)})`);
  if (!Number.isInteger(h.stride) || h.stride < 1) fail(label, `header.stride must be a positive integer (got ${String(h.stride)})`);
  if (!Array.isArray(h.fields)) fail(label, 'header.fields must be an array');
  if (h.fields.length !== h.stride) fail(label, `header lists ${h.fields.length} fields but stride is ${h.stride}`);
  const seen = new Set<string>();
  h.fields.forEach((f, i) => {
    const name = fieldName(f, i, label);
    if (seen.has(name)) fail(label, `duplicate field "${name}"`);
    seen.add(name);
  });
  if (h.strideBytes != null && h.strideBytes !== h.stride * 4) fail(label, `header.strideBytes ${h.strideBytes} ≠ stride ${h.stride} × 4`);
  if (h.dtype != null && String(h.dtype).toLowerCase() !== 'float32') fail(label, `unsupported dtype "${h.dtype}" (expected float32)`);
  if (h.endianness != null && String(h.endianness).toLowerCase() !== 'little') fail(label, `unsupported endianness "${h.endianness}" (expected little)`);
  if (h.encoding != null) {
    const enc = String(h.encoding).toLowerCase();
    if (!enc.includes('float32')) fail(label, `unsupported encoding "${h.encoding}" (expected float32)`);
    if (enc.includes('big')) fail(label, `unsupported encoding "${h.encoding}" (expected little-endian)`);
  }
  const expected = h.count * h.stride * 4;
  if (h.byteLength != null && h.byteLength !== expected) {
    fail(label, `header.byteLength ${groupDigits(h.byteLength)} ≠ count ${groupDigits(h.count)} × stride ${h.stride} × 4 = ${groupDigits(expected)}`);
  }
  return h;
}

/**
 * Wrap an interleaved little-endian Float32 buffer described by `header`. Zero-copy when the buffer is
 * 4-byte aligned on a little-endian host (every browser in practice); otherwise decodes into a new array.
 */
export function parseInterleavedFloat32(
  buffer: ArrayBuffer | ArrayBufferView,
  header: InterleavedHeader,
  opts: InterleavedParseOptions = {},
): InterleavedFloat32 {
  const label = opts.label ?? (typeof header?.file === 'string' ? header.file : 'binary');
  const h = validateInterleavedHeader(header, label);
  const bytes = bytesOf(buffer);
  const expected = h.count * h.stride * 4;
  if (bytes.byteLength < expected) {
    fail(label, `truncated: expected ${groupDigits(expected)} bytes (count ${groupDigits(h.count)} × stride ${h.stride} × 4), got ${groupDigits(bytes.byteLength)}`);
  }
  if (bytes.byteLength > expected && !opts.allowTrailingBytes) {
    fail(label, `size mismatch: expected ${groupDigits(expected)} bytes (count ${groupDigits(h.count)} × stride ${h.stride} × 4), got ${groupDigits(bytes.byteLength)}`);
  }
  const n = h.count * h.stride;
  let data: Float32Array;
  if (LITTLE_ENDIAN_HOST && bytes.byteOffset % 4 === 0) {
    data = new Float32Array(bytes.buffer, bytes.byteOffset, n);
  } else if (LITTLE_ENDIAN_HOST) {
    data = new Float32Array(n);
    new Uint8Array(data.buffer).set(bytes.subarray(0, expected));
  } else {
    data = new Float32Array(n);
    const view = new DataView(bytes.buffer, bytes.byteOffset, expected);
    for (let i = 0; i < n; i++) data[i] = view.getFloat32(i * 4, true);
  }

  const names = h.fields.map((f, i) => fieldName(f, i, label));
  const units = (header as unknown as Record<string, unknown>).units;
  const offsets = new Map<string, number>();
  names.forEach((name, i) => offsets.set(name, i));
  const accessors = new Map<string, FieldAccessor>();
  const stride = h.stride;
  const count = h.count;

  const field = (name: string): FieldAccessor => {
    const cached = accessors.get(name);
    if (cached) return cached;
    const offset = offsets.get(name);
    if (offset == null) fail(label, `no field "${name}" (fields: ${names.join(', ')})`);
    const accessor: FieldAccessor = {
      name,
      offset,
      stride,
      unit: fieldUnit(h.fields[offset], units),
      get: (index: number) => data[index * stride + offset],
      toArray: () => {
        const out = new Float32Array(count);
        for (let i = 0, j = offset; i < count; i++, j += stride) out[i] = data[j];
        return out;
      },
    };
    accessors.set(name, accessor);
    return accessor;
  };

  for (const name of opts.requireFinite ?? []) {
    const { offset } = field(name);
    for (let i = 0, j = offset; i < count; i++, j += stride) {
      if (!Number.isFinite(data[j])) fail(label, `record ${i} field "${name}" is not finite (${data[j]})`);
    }
  }

  return {
    data,
    count,
    stride,
    fieldNames: names,
    field,
    offsetOf: (name) => offsets.get(name) ?? -1,
    has: (name) => offsets.has(name),
    get: (index, name) => data[index * stride + field(name).offset],
  };
}

// ── {fields, rows} JSON tables ───────────────────────────────────────────────────────────────

export interface JsonTable<Row extends readonly unknown[] = unknown[]> {
  fields: string[];
  rows: Row[];
  /** Per-field type names (object keyed by field, or array aligned with fields). */
  types?: Record<string, string> | string[];
  units?: Record<string, string | null> | (string | null)[];
  [extra: string]: unknown;
}

export interface TableValidateOptions {
  /** Name used in error messages (default "table"). */
  label?: string;
  /** Fields that must be present. */
  requiredFields?: readonly string[];
  /**
   * Check every value against `types` (when the table declares them). Known type names: string, int, number,
   * bool/boolean, refIdx (non-negative int), int[], number[], string[]; others are not checked. null always passes.
   * Default true.
   */
  checkTypes?: boolean;
  /** Stop after this many type errors and report them together (default 8). */
  maxErrors?: number;
}

function typeOk(type: string, v: unknown): boolean {
  if (v === null) return true;
  switch (type) {
    case 'string': return typeof v === 'string';
    case 'number': case 'float': case 'double': return typeof v === 'number' && Number.isFinite(v);
    case 'int': case 'integer': return Number.isInteger(v);
    case 'refIdx': return Number.isInteger(v) && (v as number) >= 0;
    case 'bool': case 'boolean': return typeof v === 'boolean';
    case 'int[]': return Array.isArray(v) && v.every((x) => Number.isInteger(x));
    case 'number[]': return Array.isArray(v) && v.every((x) => typeof x === 'number' && Number.isFinite(x));
    case 'string[]': return Array.isArray(v) && v.every((x) => typeof x === 'string');
    default: return true;
  }
}

function describeValue(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v);
  if (Array.isArray(v)) return `array(${v.length})`;
  return String(v);
}

/** Validate `{fields, rows}` structure (and declared value types); returns the table typed. Throws DataFormatError. */
export function validateTable<Row extends readonly unknown[] = unknown[]>(raw: unknown, opts: TableValidateOptions = {}): JsonTable<Row> {
  const label = opts.label ?? 'table';
  if (!isObject(raw)) fail(label, 'not a JSON object');
  const { fields, rows } = raw;
  if (!Array.isArray(fields)) fail(label, '"fields" must be an array of names');
  const seen = new Set<string>();
  fields.forEach((f, i) => {
    if (typeof f !== 'string' || !f) fail(label, `fields[${i}] is not a non-empty string`);
    if (seen.has(f)) fail(label, `duplicate field "${f}"`);
    seen.add(f);
  });
  for (const req of opts.requiredFields ?? []) if (!seen.has(req)) fail(label, `missing required field "${req}"`);
  if (!Array.isArray(rows)) fail(label, '"rows" must be an array');
  const width = fields.length;
  for (let r = 0; r < rows.length; r++) {
    const row: unknown = rows[r];
    if (!Array.isArray(row)) fail(label, `row ${r} is not an array`);
    if (row.length !== width) fail(label, `row ${r} has ${row.length} values, expected ${width}`);
  }

  const types = raw.types;
  if (opts.checkTypes !== false && types != null) {
    const typeList: (string | null)[] = (fields as string[]).map((f, i) => {
      const t = Array.isArray(types) ? types[i] : isObject(types) ? types[f] : null;
      return typeof t === 'string' ? t : null;
    });
    const errors: string[] = [];
    const max = Math.max(1, opts.maxErrors ?? 8);
    outer: for (let c = 0; c < width; c++) {
      const t = typeList[c];
      if (!t) continue;
      for (let r = 0; r < rows.length; r++) {
        const v = (rows[r] as unknown[])[c];
        if (!typeOk(t, v)) {
          errors.push(`row ${r} field "${fields[c]}": expected ${t} or null, got ${describeValue(v)}`);
          if (errors.length >= max) break outer;
        }
      }
    }
    if (errors.length > 0) fail(label, `${errors.length >= max ? `${max}+` : errors.length} type error(s): ${errors.join('; ')}`);
  }
  return raw as unknown as JsonTable<Row>;
}

/**
 * Column indices by name: `const c = columnIndex(table, ['pl_name', 'pl_rade']); row[c.pl_rade]`.
 * Throws when a requested column is missing. With no names, maps every column.
 */
export function columnIndex<K extends string>(table: { fields: readonly string[] }, names?: readonly K[], label = 'table'): Record<K, number> {
  const index = new Map<string, number>();
  table.fields.forEach((f, i) => index.set(f, i));
  const out = {} as Record<K, number>;
  const wanted = (names ?? (table.fields as readonly string[])) as readonly K[];
  for (const name of wanted) {
    const i = index.get(name);
    if (i == null) fail(label, `missing column "${name}"`);
    out[name] = i;
  }
  return out;
}

/** Index of an optional column, or -1. */
export function optionalColumn(table: { fields: readonly string[] }, name: string): number {
  return table.fields.indexOf(name);
}

/** One row as an object keyed by field name (allocates; for inspectors and small tables). */
export function rowToObject<T = Record<string, unknown>>(table: { fields: readonly string[] }, row: readonly unknown[]): T {
  const out: Record<string, unknown> = {};
  const { fields } = table;
  for (let i = 0; i < fields.length; i++) out[fields[i]] = row[i] ?? null;
  return out as T;
}

/** All rows (or a subset of fields) as objects. Allocates one object per row — avoid for very large tables. */
export function rowsToObjects<T = Record<string, unknown>>(
  table: { fields: readonly string[]; rows: readonly (readonly unknown[])[] },
  opts: { fields?: readonly string[]; label?: string } = {},
): T[] {
  if (!opts.fields) return table.rows.map((row) => rowToObject<T>(table, row));
  const picked = opts.fields;
  const cols = columnIndex(table, picked, opts.label);
  return table.rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const f of picked) out[f] = row[cols[f]] ?? null;
    return out as T;
  });
}

/** Map a key column to row indices (e.g. pl_name → row). Throws on duplicate non-null keys unless allowDuplicates. */
export function indexRowsBy(
  table: { fields: readonly string[]; rows: readonly (readonly unknown[])[] },
  keyField: string,
  opts: { label?: string; allowDuplicates?: boolean } = {},
): Map<string, number> {
  const label = opts.label ?? 'table';
  const c = columnIndex(table, [keyField], label)[keyField];
  const out = new Map<string, number>();
  for (let r = 0; r < table.rows.length; r++) {
    const v = table.rows[r][c];
    if (v == null) continue;
    const key = String(v);
    if (out.has(key)) {
      if (!opts.allowDuplicates) fail(label, `duplicate key "${key}" in column "${keyField}" (rows ${out.get(key)} and ${r})`);
      continue;
    }
    out.set(key, r);
  }
  return out;
}
