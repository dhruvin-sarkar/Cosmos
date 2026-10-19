import { describe, expect, it } from 'vitest';
import type { Vector3 } from 'three';
import type { Entity, EntityKind } from '../../core/entity';
import { buildSystemTree, stepPlanet, stepSatellite, systemBodyOf } from './tree';
import { navKeyAction } from './keys';

function ent(id: string, kind: EntityKind, parentId: string | null, pos: [number, number, number], importance = 50): Entity {
  return {
    id, name: id.split(':')[1], aliases: [], kind, domain: 'solar', parentId, radiusM: 1, capabilities: ['focus'], importance,
    representation: 'observed',
    position: (_t: number, out: Vector3) => out.set(...pos),
    facts: () => ({}) as never,
  };
}

const AU = 1.496e11;
const entities: Entity[] = [
  ent('sol:sun', 'star', null, [0, 0, 0]),
  ent('sol:jupiter', 'planet', 'sol:sun', [5.2 * AU, 0, 0]),
  ent('sol:earth', 'planet', 'sol:sun', [AU, 0, 0]),
  ent('sol:mars', 'planet', 'sol:sun', [1.5 * AU, 0, 0]),
  ent('sol:pluto', 'dwarf-planet', 'sol:sun', [39 * AU, 0, 0]),
  ent('sol:callisto', 'moon', 'sol:jupiter', [5.2 * AU + 1.88e9, 0, 0]),
  ent('sol:io', 'moon', 'sol:jupiter', [5.2 * AU + 4.2e8, 0, 0]),
  ent('sol:europa', 'moon', 'sol:jupiter', [5.2 * AU + 6.7e8, 0, 0]),
  ent('sol:moon', 'moon', 'sol:earth', [AU + 3.84e8, 0, 0]),
  ent('sat:25544', 'space-station', 'sol:earth', [AU + 6.8e6, 0, 0], 70),
  ent('sat:99999', 'satellite', 'sol:earth', [AU + 7e6, 0, 0], 5),
  ent('sb:apophis', 'asteroid', 'sol:sun', [AU, 1e9, 0], 60),
];

describe('navigator tree', () => {
  const tree = buildSystemTree(entities, 0);

  it('orders planets by mean distance and moons by distance from the parent', () => {
    expect(tree.bodies.map(b => b.entity.id)).toEqual(['sol:earth', 'sol:mars', 'sol:jupiter', 'sol:pluto']);
    expect(tree.bodies[2].satellites.map(s => s.id)).toEqual(['sol:io', 'sol:europa', 'sol:callisto']);
  });

  it('lists natural moons before stations and drops unimportant satellites', () => {
    expect(tree.bodies[0].satellites.map(s => s.id)).toEqual(['sol:moon', 'sat:25544']);
    expect(tree.smallBodies.map(e => e.id)).toEqual(['sb:apophis']);
  });

  it('steps moons within a system, wrapping through the planet', () => {
    expect(stepSatellite(tree, 'sol:jupiter', 1)).toBe('sol:io');
    expect(stepSatellite(tree, 'sol:io', 1)).toBe('sol:europa');
    expect(stepSatellite(tree, 'sol:callisto', 1)).toBe('sol:jupiter');
    expect(stepSatellite(tree, 'sol:jupiter', -1)).toBe('sol:callisto');
    expect(stepSatellite(tree, 'sol:mars', 1)).toBeNull();
    expect(systemBodyOf(tree, 'sat:25544')?.entity.id).toBe('sol:earth');
  });

  it('steps planets and clamps at the ends', () => {
    expect(stepPlanet(tree, 'sol:io', 1)).toBe('sol:pluto');
    expect(stepPlanet(tree, 'sol:earth', -1)).toBe('sol:earth');
    expect(stepPlanet(tree, 'sol:sun', 1)).toBe('sol:earth');
    expect(stepPlanet(tree, 'sol:mars', 1, false)).toBe('sol:jupiter');
  });

  it('maps keys to travel actions', () => {
    expect(navKeyAction({ key: '0', code: 'Digit0', shiftKey: false }, tree, null)).toEqual({ type: 'travel', id: 'sol:sun' });
    expect(navKeyAction({ key: '3', code: 'Digit3', shiftKey: false }, tree, null)).toEqual({ type: 'travel', id: 'sol:earth' });
    // Mercury is not registered in this fixture.
    expect(navKeyAction({ key: '1', code: 'Digit1', shiftKey: false }, tree, null)).toEqual({ type: 'none' });
    expect(navKeyAction({ key: ']', code: 'BracketRight', shiftKey: false }, tree, 'sol:earth')).toEqual({ type: 'travel', id: 'sol:moon' });
    expect(navKeyAction({ key: '{', code: 'BracketLeft', shiftKey: true }, tree, 'sol:jupiter')).toEqual({ type: 'travel', id: 'sol:mars' });
    expect(navKeyAction({ key: 'b', code: 'KeyB', shiftKey: false }, tree, null)).toEqual({ type: 'toggle-navigator' });
  });
});
