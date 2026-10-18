import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  columnIndex, DataFormatError, indexRowsBy, optionalColumn, parseInterleavedFloat32, rowsToObjects, rowToObject,
  validateInterleavedHeader, validateTable, type InterleavedHeader,
} from './binary';

function makeBuffer(values: number[]): ArrayBuffer {
  return new Float32Array(values).buffer;
}

const starHeader: InterleavedHeader = {
  count: 2, stride: 3, fields: ['xPc', 'yPc', 'absMagV'], dtype: 'float32', endianness: 'little', strideBytes: 12, byteLength: 24,
};

describe('parseInterleavedFloat32', () => {
  it('wraps the buffer zero-copy and exposes strided field accessors', () => {
    const buf = makeBuffer([1, 2, 3, 4, 5, 6]);
    const t = parseInterleavedFloat32(buf, starHeader);
    expect(t.data.buffer).toBe(buf);
    expect(t.count).toBe(2);
    expect(t.fieldNames).toEqual(['xPc', 'yPc', 'absMagV']);
    const mag = t.field('absMagV');
    expect(mag.offset).toBe(2);
    expect(mag.get(0)).toBe(3);
    expect(mag.get(1)).toBe(6);
    expect(Array.from(mag.toArray())).toEqual([3, 6]);
    expect(t.field('absMagV')).toBe(mag);
    expect(t.get(1, 'yPc')).toBe(5);
    expect(t.offsetOf('yPc')).toBe(1);
    expect(t.offsetOf('nope')).toBe(-1);
    expect(t.has('xPc')).toBe(true);
  });

  it('accepts {name, unit} field objects (galaxy headers) and reads units', () => {
    const header = {
      count: 1, stride: 2, encoding: 'float32 little-endian, interleaved records', file: 'cosmicweb.bin',
      fields: [{ name: 'xMpc', unit: 'Mpc', description: 'x' }, { name: 'redshift', unit: '1' }],
    };
    const t = parseInterleavedFloat32(makeBuffer([12.5, 0.01]), header);
    expect(t.field('xMpc').unit).toBe('Mpc');
    expect(t.field('redshift').get(0)).toBeCloseTo(0.01, 7);
  });

  it('reads units from a header-level units map', () => {
    const t = parseInterleavedFloat32(makeBuffer([1, 2, 3, 4, 5, 6]), { ...starHeader, units: { xPc: 'pc' } } as InterleavedHeader);
    expect(t.field('xPc').unit).toBe('pc');
    expect(t.field('yPc').unit).toBeNull();
  });

  it('decodes unaligned views by copying', () => {
    const src = new Uint8Array(1 + 24);
    src.set(new Uint8Array(makeBuffer([1, 2, 3, 4, 5, 6])), 1);
    const t = parseInterleavedFloat32(src.subarray(1), starHeader);
    expect(Array.from(t.data)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('rejects truncated or oversized buffers with byte counts', () => {
    expect(() => parseInterleavedFloat32(makeBuffer([1, 2, 3, 4, 5]), { ...starHeader, byteLength: undefined }))
      .toThrow(/truncated: expected 24 bytes .* got 20/);
    expect(() => parseInterleavedFloat32(makeBuffer([1, 2, 3, 4, 5, 6, 7]), { ...starHeader, byteLength: undefined }))
      .toThrow(/size mismatch/);
    const t = parseInterleavedFloat32(makeBuffer([1, 2, 3, 4, 5, 6, 7]), { ...starHeader, byteLength: undefined }, { allowTrailingBytes: true });
    expect(t.data.length).toBe(6);
  });

  it('validates headers strictly', () => {
    const bad = (patch: Partial<InterleavedHeader>) => () => validateInterleavedHeader({ ...starHeader, ...patch }, 'stars.bin');
    expect(bad({ fields: ['a', 'b'] })).toThrow('stars.bin: header lists 2 fields but stride is 3');
    expect(bad({ fields: ['a', 'a', 'b'] })).toThrow(/duplicate field "a"/);
    expect(bad({ strideBytes: 16 })).toThrow(/strideBytes/);
    expect(bad({ dtype: 'float64' })).toThrow(/dtype/);
    expect(bad({ endianness: 'big' })).toThrow(/endianness/);
    expect(bad({ encoding: 'float32 big-endian' })).toThrow(/little-endian/);
    expect(bad({ byteLength: 100 })).toThrow(/byteLength 100/);
    expect(bad({ count: -1 })).toThrow(/count/);
    expect(bad({ stride: 0, fields: [] })).toThrow(/stride/);
    expect(() => validateInterleavedHeader(null)).toThrow(DataFormatError);
  });

  it('reports unknown fields and non-finite required values', () => {
    const t = parseInterleavedFloat32(makeBuffer([1, 2, 3, 4, 5, 6]), starHeader);
    expect(() => t.field('teffK')).toThrow(/no field "teffK" \(fields: xPc, yPc, absMagV\)/);
    expect(() => parseInterleavedFloat32(makeBuffer([1, Number.NaN, 3, 4, 5, 6]), starHeader, { requireFinite: ['yPc'] }))
      .toThrow(/record 0 field "yPc" is not finite/);
    expect(() => parseInterleavedFloat32(makeBuffer([1, 2, Number.NaN, 4, 5, 6]), starHeader, { requireFinite: ['xPc', 'yPc'] }))
      .not.toThrow();
  });
});

describe('JSON tables', () => {
  const table = {
    fields: ['pl_name', 'pl_rade', 'disc_year', 'planetRows'],
    types: { pl_name: 'string', pl_rade: 'number', disc_year: 'int', planetRows: 'int[]' },
    rows: [
      ['TRAPPIST-1 e', 0.92, 2017, [4]],
      ['Proxima Cen b', null, 2016, [0, 1]],
    ],
  };

  it('validates structure and declared types', () => {
    const t = validateTable(table, { label: 'planets.json', requiredFields: ['pl_name'] });
    expect(t.rows.length).toBe(2);
    expect(() => validateTable({ ...table, rows: [['x', 1, 2]] }, { label: 'planets.json' }))
      .toThrow('planets.json: row 0 has 3 values, expected 4');
    expect(() => validateTable({ ...table, rows: [['x', 'big', 2.5, [1]]] }, { label: 'planets.json' }))
      .toThrow(/2 type error\(s\): row 0 field "pl_rade": expected number or null, got "big"; row 0 field "disc_year": expected int or null, got 2.5/);
    expect(() => validateTable({ ...table, rows: [['x', 'big', 2.5, [1]]] }, { checkTypes: false })).not.toThrow();
    expect(() => validateTable(table, { requiredFields: ['pl_bmasse'] })).toThrow(/missing required field "pl_bmasse"/);
    expect(() => validateTable({ fields: ['a', 'a'], rows: [] })).toThrow(/duplicate field "a"/);
    expect(() => validateTable({ fields: ['a'] })).toThrow(/"rows" must be an array/);
    expect(() => validateTable([])).toThrow(/not a JSON object/);
  });

  it('supports types given as an array aligned with fields', () => {
    expect(() => validateTable({ fields: ['a', 'b'], types: ['string', 'refIdx'], rows: [['x', -1]] }))
      .toThrow(/field "b": expected refIdx/);
  });

  it('builds column indices, row objects and key indices', () => {
    const c = columnIndex(table, ['pl_name', 'disc_year']);
    expect(c).toEqual({ pl_name: 0, disc_year: 2 });
    expect(columnIndex(table)).toEqual({ pl_name: 0, pl_rade: 1, disc_year: 2, planetRows: 3 });
    expect(() => columnIndex(table, ['pl_bmasse'], 'planets.json')).toThrow('planets.json: missing column "pl_bmasse"');
    expect(optionalColumn(table, 'pl_rade')).toBe(1);
    expect(optionalColumn(table, 'nope')).toBe(-1);
    expect(rowToObject(table, table.rows[1])).toEqual({ pl_name: 'Proxima Cen b', pl_rade: null, disc_year: 2016, planetRows: [0, 1] });
    expect(rowsToObjects(table, { fields: ['pl_name', 'pl_rade'] })).toEqual([
      { pl_name: 'TRAPPIST-1 e', pl_rade: 0.92 },
      { pl_name: 'Proxima Cen b', pl_rade: null },
    ]);
    expect(rowsToObjects(table).length).toBe(2);
    const idx = indexRowsBy(table, 'pl_name');
    expect(idx.get('Proxima Cen b')).toBe(1);
    expect(() => indexRowsBy({ fields: ['k'], rows: [['a'], ['a']] }, 'k')).toThrow(/duplicate key "a" in column "k" \(rows 0 and 1\)/);
    expect(indexRowsBy({ fields: ['k'], rows: [['a'], ['a'], [null]] }, 'k', { allowDuplicates: true }).size).toBe(1);
  });
});

describe('real offline snapshot tables', () => {
  const root = resolve(import.meta.dirname, '../../public/data');
  const planets = resolve(root, 'exoplanets/planets.json');
  const catalog = resolve(root, 'orbital/catalog.json');

  it.skipIf(!existsSync(planets))('exoplanets/planets.json passes strict validation', () => {
    const raw: unknown = JSON.parse(readFileSync(planets, 'utf8'));
    const t = validateTable(raw, { label: 'planets.json', requiredFields: ['pl_name', 'hostname', 'pl_orbper', 'pl_rade'] });
    expect(t.rows.length).toBeGreaterThan(5000);
    const byName = indexRowsBy(t, 'pl_name', { label: 'planets.json' });
    expect(byName.has('TRAPPIST-1 e')).toBe(true);
  });

  it.skipIf(!existsSync(catalog))('orbital/catalog.json has consistent rows', () => {
    const raw: unknown = JSON.parse(readFileSync(catalog, 'utf8'));
    const t = validateTable(raw, { label: 'catalog.json', requiredFields: ['norad', 'name'] });
    const c = columnIndex(t, ['norad', 'name'], 'catalog.json');
    const iss = t.rows.find((r) => r[c.norad] === '25544');
    expect(iss?.[c.name]).toMatch(/ISS/);
  });
});
