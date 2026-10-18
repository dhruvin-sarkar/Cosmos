import { describe, expect, it, vi } from 'vitest';
import { Vector3 } from 'three';
import type { Entity, EntityProvider, SearchIndex, SearchRecord } from './entity';
import { createRegistry, createSimpleSearchIndex, normalizeSearchText } from './registry';

function entity(id: string, name: string, parentId: string | null = null, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    name,
    aliases: [],
    kind: 'planet',
    domain: 'solar',
    parentId,
    radiusM: 1,
    position: (_t: number, out: Vector3) => out.set(0, 0, 0),
    capabilities: ['focus'],
    importance: 50,
    representation: 'illustrative',
    facts: () => ({ entityId: id, summary: '', sections: [], representation: { provenance: 'illustrative', description: '' }, sources: [] }),
    ...extra,
  };
}

const flush = (): Promise<void> => new Promise(resolve => queueMicrotask(resolve));

describe('createRegistry', () => {
  it('registers, replaces and lists eager entities', () => {
    const r = createRegistry();
    const earth = entity('sol:earth', 'Earth');
    r.register(earth);
    r.register(entity('sol:moon', 'Moon', 'sol:earth'));
    expect(r.get('sol:earth')).toBe(earth);
    expect(r.list().map(e => e.id)).toEqual(['sol:earth', 'sol:moon']);
    const earth2 = entity('sol:earth', 'Earth v2');
    r.register(earth2);
    expect(r.get('sol:earth')).toBe(earth2);
    expect(r.list().map(e => e.name)).toEqual(['Earth v2', 'Moon']);
    expect(r.has('sol:moon')).toBe(true);
    expect(r.has('nope')).toBe(false);
  });

  it('resolves through providers in order and caches the result', () => {
    const r = createRegistry();
    const star = entity('star:hip:1', 'HIP 1');
    const resolveA = vi.fn((id: string) => (id === 'star:hip:1' ? star : undefined));
    const resolveB = vi.fn(() => undefined);
    r.registerProvider({ domain: 'stars', resolve: resolveA, searchRecords: () => [] });
    r.registerProvider({ domain: 'galaxy', resolve: resolveB, searchRecords: () => [] });
    expect(r.get('star:hip:1')).toBe(star);
    expect(r.get('star:hip:1')).toBe(star);
    expect(resolveA).toHaveBeenCalledTimes(1);
    expect(resolveB).not.toHaveBeenCalled();
    expect(r.get('gal:none')).toBeUndefined();
    expect(r.get('gal:none')).toBeUndefined();
    expect(resolveB).toHaveBeenCalledTimes(1);
  });

  it('isolates a throwing provider', () => {
    const r = createRegistry();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    r.registerProvider({ domain: 'stars', resolve: () => { throw new Error('boom'); }, searchRecords: () => { throw new Error('bad'); } });
    const ok = entity('ok:1', 'Okay');
    r.registerProvider({ domain: 'galaxy', resolve: id => (id === 'ok:1' ? ok : undefined), searchRecords: () => [] });
    expect(r.get('ok:1')).toBe(ok);
    expect(r.search('okay')).toEqual([]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('walks ancestors to the root and survives cycles and gaps', () => {
    const r = createRegistry();
    r.register(entity('a', 'A', 'b'));
    r.register(entity('b', 'B', 'c'));
    r.register(entity('c', 'C', null));
    expect(r.ancestors('a').map(e => e.id)).toEqual(['b', 'c']);
    expect(r.ancestors('c')).toEqual([]);
    expect(r.ancestors('missing')).toEqual([]);

    r.register(entity('x', 'X', 'y'));
    r.register(entity('y', 'Y', 'x'));
    expect(r.ancestors('x').map(e => e.id)).toEqual(['y']);

    r.register(entity('orphan', 'Orphan', 'not-registered'));
    expect(r.ancestors('orphan')).toEqual([]);
  });

  it('notifies listeners once per batch of changes', async () => {
    const r = createRegistry();
    const listener = vi.fn();
    const off = r.onChange(listener);
    const v0 = r.version;
    for (let i = 0; i < 50; i++) r.register(entity(`e:${i}`, `E${i}`));
    expect(listener).not.toHaveBeenCalled();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(r.version).toBe(v0 + 50);
    off();
    r.register(entity('e:late', 'Late'));
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('searches eager entities and provider records, identifier hits first', () => {
    const r = createRegistry();
    r.register(entity('sol:earth', 'Earth', null, { importance: 100, aliases: ['Terra'] }));
    r.register(entity('sol:moon', 'Moon', 'sol:earth', { importance: 95, kind: 'moon', aliases: ['Luna'] }));
    const records: SearchRecord[] = [
      { id: 'star:hip:71683', name: 'Rigil Kentaurus', aliases: ['α Centauri A', 'Alpha Cen A'], kind: 'star', domain: 'stars', importance: 60 },
    ];
    const provider: EntityProvider = {
      domain: 'stars',
      resolve: id => (id === 'star:hip:70890' ? entity(id, 'Proxima Centauri', null, { kind: 'star', domain: 'stars' }) : undefined),
      searchRecords: () => records,
      resolveIdentifier: q => (/^hip\s*70890$/i.test(q) ? ['star:hip:70890'] : []),
    };
    r.registerProvider(provider);

    expect(r.search('earth')[0].record.id).toBe('sol:earth');
    expect(r.search('terra')[0]).toMatchObject({ matched: 'alias', matchedText: 'Terra' });
    expect(r.search('alpha cen')[0].record.id).toBe('star:hip:71683');
    expect(r.search('α Cen')[0].record.id).toBe('star:hip:71683');

    const hits = r.search('HIP 70890');
    expect(hits[0]).toMatchObject({ matched: 'identifier', matchedText: 'HIP 70890' });
    expect(hits[0].record.name).toBe('Proxima Centauri');

    expect(r.search('moon', 5).map(h => h.record.id)).toContain('sol:moon');
    expect(r.search('   ')).toEqual([]);
  });

  it('uses an injected search index and rebuilds it only after changes', () => {
    const rebuild = vi.fn();
    const index: SearchIndex = {
      rebuild,
      query: (text, limit) => (text === 'x' ? [] : []).slice(0, limit),
    };
    const r = createRegistry(index);
    r.register(entity('a', 'A'));
    r.search('x');
    r.search('x');
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(rebuild.mock.calls[0][0].map((rec: SearchRecord) => rec.id)).toEqual(['a']);
    r.register(entity('b', 'B'));
    r.search('x');
    expect(rebuild).toHaveBeenCalledTimes(2);
  });
});

describe('default search index', () => {
  it('normalizes case, diacritics, Greek letters and punctuation', () => {
    expect(normalizeSearchText('  α-Cen ')).toBe('alpha cen');
    expect(normalizeSearchText('Barnard’s Star')).toBe('barnard s star');
    expect(normalizeSearchText('Sgr A*')).toBe('sgr a*');
    expect(normalizeSearchText('Ångström')).toBe('angstrom');
  });

  it('ranks exact > prefix > word > substring, boosted by importance', () => {
    const index = createSimpleSearchIndex();
    const rec = (id: string, name: string, importance = 50): SearchRecord => ({ id, name, aliases: [], kind: 'star', domain: 'stars', importance });
    index.rebuild([rec('1', 'Mars'), rec('2', 'Marseille Star'), rec('3', 'Big Mars Rock'), rec('4', 'Gemarsa')]);
    expect(index.query('mars', 10).map(r => r.record.id)).toEqual(['1', '2', '3', '4']);
    expect(index.query('star', 10).map(r => r.record.id)).toContain('2');
    expect(index.query('stars', 10).every(r => r.matched === 'category')).toBe(true);
  });
});
