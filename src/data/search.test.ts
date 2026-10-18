import { describe, expect, it } from 'vitest';
import type { DomainId, EntityKind, SearchRecord } from '../core/entity';
import {
  boundedDamerauLevenshtein,
  CONSTELLATIONS,
  constellationVariants,
  createSearchIndex,
  findConstellation,
  normalizeSearchText,
} from './search';

function rec(id: string, name: string, kind: EntityKind, domain: DomainId, importance: number, aliases: string[] = []): SearchRecord {
  return { id, name, aliases, kind, domain, importance };
}

const RECORDS: SearchRecord[] = [
  rec('sun', 'Sun', 'star', 'solar', 100),
  rec('earth', 'Earth', 'planet', 'earth', 100),
  rec('moon', 'Moon', 'moon', 'earth', 98),
  rec('mars', 'Mars', 'planet', 'solar', 90),
  rec('phobos', 'Phobos', 'moon', 'solar', 50),
  rec('europa', 'Europa', 'moon', 'solar', 70),
  rec('alpha-cen-a', 'Alpha Centauri A', 'star', 'stars', 80, ['Rigil Kentaurus', 'HIP 71683', 'α Cen A']),
  rec('alpha-cen-b', 'Alpha Centauri B', 'star', 'stars', 75, ['Toliman', 'HIP 71681']),
  rec('proxima', 'Proxima Centauri', 'star', 'stars', 85, ['GJ 551', 'HIP 70890']),
  rec('proxima-b', 'Proxima Centauri b', 'exoplanet', 'exoplanets', 70),
  rec('sgr-a', 'Sgr A*', 'black-hole', 'blackhole', 95),
  rec('m31', 'Andromeda Galaxy', 'galaxy', 'extragalactic', 90, ['M31', 'NGC 224']),
  rec('m33', 'Triangulum Galaxy', 'galaxy', 'extragalactic', 60, ['M33']),
  rec('andromedae-alpha', 'Alpheratz', 'star', 'stars', 30, ['Alpha Andromedae']),
  rec('trappist-1', 'TRAPPIST-1', 'stellar-system', 'exoplanets', 70),
  rec('trappist-1e', 'TRAPPIST-1 e', 'exoplanet', 'exoplanets', 60),
  rec('iss', 'ISS (ZARYA)', 'space-station', 'orbital', 90, ['NORAD 25544']),
  rec('debris-1', 'COSMOS 2251 DEB', 'debris', 'orbital', 10),
  rec('betelgeuse', 'Betelgeuse', 'star', 'stars', 60, ['Alpha Orionis']),
  rec('bootes-void', 'Boötes Void', 'void', 'extragalactic', 40),
  rec('cmb', 'Cosmic Microwave Background', 'cosmic-structure', 'cosmology', 90),
];

function idx() {
  const index = createSearchIndex();
  index.rebuild(RECORDS);
  return index;
}

function topId(query: string): string | undefined {
  return idx().query(query, 5)[0]?.record.id;
}

describe('normalizeSearchText', () => {
  it('strips diacritics, case and punctuation', () => {
    expect(normalizeSearchText('Boötes')).toBe('bootes');
    expect(normalizeSearchText('  TRAPPIST-1 ')).toBe('trappist 1');
  });
  it('spells out Greek letters and abbreviations', () => {
    expect(normalizeSearchText('α Cen')).toBe('alpha cen');
    expect(normalizeSearchText('alf Cen')).toBe('alpha cen');
  });
  it('splits designators and maps the asterisk', () => {
    expect(normalizeSearchText('M31')).toBe('m 31');
    expect(normalizeSearchText('Messier 31')).toBe('m 31');
    expect(normalizeSearchText('Sgr A*')).toBe('sgr a star');
  });
});

describe('constellations', () => {
  it('covers all 88 IAU constellations', () => {
    expect(CONSTELLATIONS.length).toBe(88);
    expect(new Set(CONSTELLATIONS.map(c => c.abbr.toLowerCase())).size).toBe(88);
  });
  it('maps abbreviations, names and genitives', () => {
    expect(findConstellation('Cen')?.genitive).toBe('Centauri');
    expect(findConstellation('centauri')?.abbr).toBe('Cen');
    expect(findConstellation('Sagittarius')?.abbr).toBe('Sgr');
    expect(constellationVariants('alpha cen')).toContain('alpha centauri');
  });
});

describe('boundedDamerauLevenshtein', () => {
  it('counts transpositions as one edit and bails out early', () => {
    expect(boundedDamerauLevenshtein('mars', 'mras', 2)).toBe(1);
    expect(boundedDamerauLevenshtein('kitten', 'sitting', 3)).toBe(3);
    expect(boundedDamerauLevenshtein('abcdef', 'uvwxyz', 1)).toBeGreaterThan(1);
  });
});

describe('createSearchIndex', () => {
  it('handles the tricky exhibition queries', () => {
    expect(topId('alpha cen')).toMatch(/^alpha-cen-/);
    expect(topId('rigil kentaurus')).toBe('alpha-cen-a');
    expect(topId('proxima')).toBe('proxima');
    expect(topId('sgr a*')).toBe('sgr-a');
    expect(topId('sagittarius a star')).toBe('sgr-a');
    expect(topId('andromeda')).toBe('m31');
    expect(topId('m31')).toBe('m31');
    expect(topId('Messier 31')).toBe('m31');
    expect(topId('trappist')).toBe('trappist-1');
    expect(topId('iss')).toBe('iss');
    expect(topId('international space station')).toBe('iss');
  });

  it('ranks exact names above prefixes and reports what matched', () => {
    const res = idx().query('earth', 5);
    expect(res[0].record.id).toBe('earth');
    expect(res[0].matched).toBe('name');
    const alias = idx().query('toliman', 5)[0];
    expect(alias.record.id).toBe('alpha-cen-b');
    expect(alias.matched).toBe('alias');
  });

  it('matches catalog identifiers', () => {
    const r = idx().query('HIP 70890', 3)[0];
    expect(r.record.id).toBe('proxima');
  });

  it('tolerates typos (fuzzy)', () => {
    expect(topId('betelguese')).toBe('betelgeuse');
    expect(topId('europe')).toBe('europa');
    expect(topId('bootes void')).toBe('bootes-void');
  });

  it('does not fuzz-match short queries', () => {
    expect(idx().query('mxq', 5).length).toBe(0);
  });

  it('answers category words with the right kinds', () => {
    const moons = idx().query('moons', 10);
    expect(moons.length).toBeGreaterThan(0);
    expect(moons.every(r => r.record.kind === 'moon')).toBe(true);
    expect(moons.some(r => r.matched === 'category')).toBe(true);
    expect(idx().query('black hole', 3)[0].record.id).toBe('sgr-a');
    expect(idx().query('galaxy', 5).some(r => r.record.id === 'm31')).toBe(true);
    expect(idx().query('debris', 5).some(r => r.record.id === 'debris-1')).toBe(true);
    expect(idx().query('exoplanet', 5).some(r => r.record.kind === 'exoplanet')).toBe(true);
  });

  it('respects the limit and returns empty for blank queries', () => {
    expect(idx().query('a', 2).length).toBeLessThanOrEqual(2);
    expect(idx().query('   ', 5)).toEqual([]);
    expect(idx().size).toBe(RECORDS.length);
  });

  it('is fast on a 20k-record index', () => {
    const big: SearchRecord[] = RECORDS.slice();
    for (let i = 0; i < 20000; i++) {
      big.push(rec(`hip-${i}`, `HIP ${100000 + i}`, 'star', 'stars', 5, [`HD ${200000 + i}`, `Star ${i} Centauri`]));
    }
    const index = createSearchIndex();
    index.rebuild(big);
    const queries = ['alpha cen', 'proxima', 'sgr a*', 'andromeda', 'betelguese', 'hip 100500', 'trappist', 'moons'];
    for (const q of queries) index.query(q, 10); // warm up
    const t0 = performance.now();
    const rounds = 10;
    for (let r = 0; r < rounds; r++) for (const q of queries) index.query(q, 10);
    const perQueryMs = (performance.now() - t0) / (rounds * queries.length);
    expect(index.query('proxima', 3)[0].record.id).toBe('proxima');
    expect(perQueryMs).toBeLessThan(5); // target < 2 ms; slack for CI noise
  });
});
