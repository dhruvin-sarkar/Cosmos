import { describe, expect, it } from 'vitest';
import { Vector3 } from 'three';
import { createMoonEntities } from './entities';
import { MOON_RECORDS, moonEntityId } from './data';
import type { FactSheet } from '../../data/provenance';

const registry = { get: () => undefined };
const T = Date.parse('2026-10-18T12:00:00Z');

describe('moon entities', () => {
  const entities = createMoonEntities(registry);

  it('provides every moon with parent, radius and a fact sheet with sources', async () => {
    expect(entities.length).toBe(MOON_RECORDS.length);
    for (const e of entities) {
      expect(e.id).toBe(moonEntityId(e.id.slice(4)));
      expect(e.kind).toBe('moon');
      expect(e.parentId).toMatch(/^sol:(mars|jupiter|saturn|uranus|neptune|pluto)$/);
      expect(e.radiusM).toBeGreaterThan(5_000);
      const f = (await e.facts!()) as FactSheet;
      expect(f.sources.length).toBeGreaterThan(2);
      expect(f.sections.length).toBeGreaterThan(0);
    }
  });

  it('moves each moon at roughly its mean orbital speed relative to the planet', () => {
    for (const rec of MOON_RECORDS) {
      const e = entities.find((x) => x.id === moonEntityId(rec.id))!;
      // The registry is empty here, so the parent's velocity is zero and the speed is the moon's relative orbital speed.
      const speed = e.velocity!(T, new Vector3()).length();
      const mean = (2 * Math.PI * rec.orbit.aKm * 1000) / ((rec.orbit.periodDays || 1) * 86400);
      expect(speed).toBeGreaterThan(mean * 0.6);
      expect(speed).toBeLessThan(mean * 1.6);
    }
  });
});
