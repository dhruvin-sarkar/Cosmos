import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import type { Entity, EntityKind } from '../entity';
import { createRegistry } from '../registry';
import { AU_M, KPC_M, MPC_M } from '../units';
import {
  CHAIN_BLEND_OFFSET_DECADES, FocusChainEvaluator, blendStartScale, chooseAnchor, contextCrumbs, createFocusChainState,
} from './focusChain';

interface Spec {
  id: string;
  parentId: string | null;
  pos: [number, number, number] | ((tMs: number, out: Vector3) => Vector3);
  radiusM?: number | null;
  kind?: EntityKind;
  contextScaleMin?: number;
}

function fixed(p: [number, number, number]) {
  return (_t: number, out: Vector3) => out.set(p[0], p[1], p[2]);
}

function entity(s: Spec): Entity {
  return {
    id: s.id, name: s.id.split(':')[1] ?? s.id, aliases: [], kind: s.kind ?? 'planet', domain: 'solar',
    parentId: s.parentId, radiusM: s.radiusM ?? null, capabilities: ['focus'], importance: 50,
    representation: 'observed', contextScaleMin: s.contextScaleMin,
    position: typeof s.pos === 'function' ? s.pos : fixed(s.pos),
    facts: () => ({ id: s.id, sections: [] }) as never,
  };
}

const GC_DIST = 8.2 * KPC_M;
// Galactic Center placed 8.2 kpc away; Local Group barycentre ~0.4 Mpc beyond.
function universe() {
  const reg = createRegistry();
  reg.register(entity({ id: 'cosmo:observable-universe', parentId: null, pos: [0, 0, 0], kind: 'reference', contextScaleMin: 24 }));
  reg.register(entity({ id: 'struct:local-group', parentId: 'cosmo:observable-universe', pos: [0.4 * MPC_M, 0, 0], kind: 'galaxy-group', contextScaleMin: 22.7 }));
  reg.register(entity({ id: 'mw:galaxy', parentId: 'struct:local-group', pos: [GC_DIST, 0, 0], kind: 'galaxy', contextScaleMin: 21 }));
  reg.register(entity({ id: 'sol:sun', parentId: 'mw:galaxy', pos: [0, 0, 0], kind: 'star', radiusM: 6.957e8 }));
  // Earth circles the Sun at 1 AU, one revolution per "year" of 1000 ms for the moving-target test.
  reg.register(entity({
    id: 'sol:earth', parentId: 'sol:sun', radiusM: 6.371e6,
    pos: (t, out) => out.set(AU_M * Math.cos((2 * Math.PI * t) / 1000), AU_M * Math.sin((2 * Math.PI * t) / 1000), 0),
  }));
  reg.register(entity({ id: 'sat:25544', parentId: 'sol:earth', kind: 'space-station', radiusM: 50, pos: (t, out) => {
    const e = AU_M * Math.cos((2 * Math.PI * t) / 1000), f = AU_M * Math.sin((2 * Math.PI * t) / 1000);
    return out.set(e + 6.78e6, f, 0);
  } }));
  return reg;
}

describe('blendStartScale', () => {
  it('is log10(separation) + 0.6 unless the parent sets a later contextScaleMin', () => {
    const sun = entity({ id: 'sol:sun', parentId: null, pos: [0, 0, 0] });
    expect(blendStartScale(AU_M, null, sun)).toBeCloseTo(Math.log10(AU_M) + CHAIN_BLEND_OFFSET_DECADES, 12);
    const gc = entity({ id: 'mw:galaxy', parentId: null, pos: [0, 0, 0], contextScaleMin: 21.5 });
    expect(blendStartScale(GC_DIST, null, gc)).toBe(21.5);
    expect(blendStartScale(GC_DIST, null, sun)).toBeCloseTo(Math.log10(GC_DIST) + 0.6, 12);
  });

  it('falls back to 100 child radii for co-located parents', () => {
    const child = entity({ id: 'x:a', parentId: 'x:b', pos: [0, 0, 0], radiusM: 1e9 });
    const parent = entity({ id: 'x:b', parentId: null, pos: [0, 0, 0] });
    expect(blendStartScale(0, child, parent)).toBeCloseTo(11 + CHAIN_BLEND_OFFSET_DECADES, 12);
  });
});

describe('FocusChainEvaluator', () => {
  const reg = universe();
  const ev = new FocusChainEvaluator(reg);
  const st = createFocusChainState();

  it('stays on the target when zoomed in', () => {
    ev.evaluate('sol:earth', 8, 0, st);
    expect(st.length).toBe(5);
    expect(st.point.x).toBe(AU_M);
    expect(st.links[st.dominantIndex].id).toBe('sol:earth');
  });

  it('blends Earth → Sun between ≈ 11.8 and 12.8 (spec default)', () => {
    const start = Math.log10(AU_M) + 0.6;
    expect(start).toBeGreaterThan(11.7);
    expect(start).toBeLessThan(11.9);
    ev.evaluate('sol:earth', start - 0.01, 0, st);
    expect(st.point.x).toBeCloseTo(AU_M, -3);
    ev.evaluate('sol:earth', start + 0.5, 0, st);
    expect(st.point.x / AU_M).toBeCloseTo(0.5, 6);
    ev.evaluate('sol:earth', start + 1.0, 0, st);
    expect(st.point.x).toBeCloseTo(0, 3);
    expect(st.links[st.dominantIndex].id).toBe('sol:sun');
  });

  it('hands the focus to the Galactic Center only from 10²¹ m', () => {
    ev.evaluate('sol:earth', 20.9, 0, st);
    expect(Math.abs(st.point.x)).toBeLessThan(1e-6 * GC_DIST);
    const mid = Math.max(Math.log10(GC_DIST) + 0.6, 21) + 0.5;
    ev.evaluate('sol:earth', mid, 0, st);
    expect(st.point.x / GC_DIST).toBeCloseTo(0.5, 9);
    ev.evaluate('sol:earth', 22.2, 0, st);
    expect(st.links[st.dominantIndex].id).toBe('mw:galaxy');
  });

  it('ends at the observer-centred root at cosmic scales', () => {
    ev.evaluate('sol:earth', 25.5, 0, st);
    expect(st.point.length()).toBeLessThan(1);
    expect(st.links[st.dominantIndex].id).toBe('cosmo:observable-universe');
  });

  it('is a pure function of scale: zooming back in returns to the target', () => {
    ev.evaluate('sat:25544', 26, 0, st);
    ev.evaluate('sat:25544', 6, 0, st);
    expect(st.point.x).toBe(AU_M + 6.78e6);
    expect(st.links[st.dominantIndex].id).toBe('sat:25544');
  });

  it('contributions sum to 1 and blend continuously across scales', () => {
    let prev = new Vector3();
    ev.evaluate('sat:25544', 5, 0, st);
    prev.copy(st.point);
    for (let s = 5; s <= 26; s += 0.01) {
      ev.evaluate('sat:25544', s, 0, st);
      let sum = 0;
      for (let i = 0; i < st.length; i++) sum += st.links[i].contribution;
      expect(sum).toBeCloseTo(1, 12);
      // A 0.01-decade step never moves the focus by more than ~5 % of the visible width.
      expect(st.point.distanceTo(prev)).toBeLessThan(0.05 * 10 ** s + 1e-3);
      prev = prev.copy(st.point);
    }
  });

  it('follows a moving target at the current time (no lag)', () => {
    ev.evaluate('sol:earth', 8, 250, st);
    expect(st.point.y).toBeCloseTo(AU_M, -2);
  });

  it('returns an empty chain for unknown ids', () => {
    ev.evaluate('nope:nothing', 10, 0, st);
    expect(st.length).toBe(0);
    expect(st.dominantIndex).toBe(-1);
  });

  it('skips ancestors whose position is not finite', () => {
    const r = createRegistry();
    r.register(entity({ id: 'a:root', parentId: null, pos: [0, 0, 0] }));
    r.register(entity({ id: 'a:bad', parentId: 'a:root', pos: [Number.NaN, 0, 0] }));
    r.register(entity({ id: 'a:leaf', parentId: 'a:bad', pos: [1e9, 0, 0] }));
    const e2 = new FocusChainEvaluator(r);
    const s2 = createFocusChainState();
    e2.evaluate('a:leaf', 12, 0, s2);
    expect(s2.length).toBe(2);
    expect(s2.links[1].id).toBe('a:root');
  });
});

describe('chooseAnchor', () => {
  it('keeps the current anchor while it holds ≥ 40 % (hysteresis), then takes the dominant one', () => {
    const reg = universe();
    const ev = new FocusChainEvaluator(reg);
    const st = createFocusChainState();
    const start = Math.log10(AU_M) + 0.6;
    ev.evaluate('sol:earth', start + 0.55, 0, st); // Earth contribution ≈ 0.42
    expect(chooseAnchor(st, 'sol:earth')).toBe('sol:earth');
    expect(chooseAnchor(st, null)).toBe('sol:sun');
    ev.evaluate('sol:earth', start + 0.8, 0, st);
    expect(chooseAnchor(st, 'sol:earth')).toBe('sol:sun');
  });
});

describe('contextCrumbs', () => {
  it('lists the context path root-first', () => {
    const crumbs = contextCrumbs(universe(), 'sol:earth').map(c => c.id);
    expect(crumbs).toEqual(['cosmo:observable-universe', 'struct:local-group', 'mw:galaxy', 'sol:sun', 'sol:earth']);
  });
});
