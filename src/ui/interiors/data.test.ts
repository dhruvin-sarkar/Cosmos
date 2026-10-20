import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { drawnRadii, findBody, hasInterior, INTERIOR_ENTITY_IDS, MIN_DRAWN_FRACTION, type InteriorsData } from './data';

const root = resolve(__dirname, '../../..');
const data = JSON.parse(readFileSync(resolve(root, 'public/data/interiors/interiors.json'), 'utf8')) as InteriorsData;
const solar = JSON.parse(readFileSync(resolve(root, 'public/data/solar/bodies.json'), 'utf8')) as {
  bodies: { id: string; radius?: { meanKm?: number | null } }[];
};
const meanRadius = new Map(solar.bodies.map(b => [b.id, b.radius?.meanKm ?? null]));

describe('interiors.json', () => {
  it('covers exactly the entities the Inspector offers', () => {
    expect(data.bodies.map(b => b.id).sort()).toEqual([...INTERIOR_ENTITY_IDS].sort());
    for (const id of INTERIOR_ENTITY_IDS) expect(hasInterior(id)).toBe(true);
    expect(hasInterior('sol:phobos')).toBe(false);
    expect(hasInterior(null)).toBe(false);
  });

  it.each(data.bodies.map(b => [b.body, b] as const))('%s: radius matches public/data/solar/bodies.json', (key, b) => {
    const r = meanRadius.get(key);
    expect(r, `${key} mean radius`).toBeTypeOf('number');
    expect(b.radiusKm).toBeCloseTo(r!, 3);
    expect(Math.abs(b.layers[b.layers.length - 1].outerKm - r!) / r!).toBeLessThan(0.001);
  });

  it.each(data.bodies.map(b => [b.body, b] as const))('%s: layers are contiguous and monotonic, centre to surface', (_key, b) => {
    let prev = 0;
    for (const l of b.layers) {
      expect(l.innerKm).toBeCloseTo(prev, 6);
      expect(l.outerKm).toBeGreaterThan(prev);
      expect(Math.abs(l.thicknessKm - (l.outerKm - prev))).toBeLessThanOrEqual(1e-4 * (l.outerKm - prev) + 1e-6); // 5 significant digits
      expect(l.fraction).toBeCloseTo(l.outerKm / b.radiusKm, 4);
      if (l.outerRangeKm) {
        expect(l.outerRangeKm[0]).toBeLessThanOrEqual(l.outerKm);
        expect(l.outerRangeKm[1]).toBeGreaterThanOrEqual(l.outerKm);
      }
      prev = l.outerKm;
    }
  });

  it('cites a known reference for every layer and every "how we know" entry', () => {
    for (const b of data.bodies) {
      for (const l of b.layers) {
        expect(l.sources.length, `${b.body}/${l.id}`).toBeGreaterThan(0);
        for (const s of l.sources) expect(data.references[s], `${b.body}/${l.id} -> ${s}`).toBeDefined();
        expect(l.plain.length).toBeGreaterThan(20);
      }
      expect(b.howWeKnow.length).toBeGreaterThan(0);
      for (const h of b.howWeKnow) for (const s of h.sources) expect(data.references[s], `${b.body} -> ${s}`).toBeDefined();
    }
  });

  it('keeps physical ranges ordered and plausible (null = unknown, never 0)', () => {
    for (const b of data.bodies) {
      for (const l of b.layers) {
        for (const range of [l.densityKgM3, l.temperatureK]) {
          if (range === null) continue;
          expect(range[0]).toBeGreaterThan(0);
          expect(range[1]).toBeGreaterThanOrEqual(range[0]);
        }
      }
    }
  });

  // Reference values. PREM: Dziewonski & Anderson 1981, PEPI 25, 297. Mars: Stähler et al. 2021, Science 373, 443
  // (1830 km) and Khan et al. 2023, Nature 622, 718 (1650-1675 km).
  // Helioseismology: Christensen-Dalsgaard et al. 1991, ApJ 378, 413 (base of the convection zone 0.713 R_sun).
  it('matches the headline published boundaries', () => {
    const earth = findBody(data, 'earth')!;
    expect(earth.layers.find(l => l.id === 'inner-core')!.outerKm).toBeCloseTo(1221.5, 1);
    expect(earth.layers.find(l => l.id === 'outer-core')!.outerKm).toBeCloseTo(3480, 0);
    const mars = findBody(data, 'sol:mars')!;
    const core = mars.layers[0];
    expect(core.outerKm).toBeGreaterThanOrEqual(1600); // Khan et al. 2023 revise the core to ~1650 km beneath a molten silicate layer
    expect(core.outerKm).toBeLessThan(1900);
    const sun = findBody(data, 'sun')!;
    const conv = sun.layers.find(l => l.id === 'convective')!;
    expect(conv.innerKm / sun.radiusKm).toBeCloseTo(0.713, 2);
  });
});

describe('drawnRadii', () => {
  it('keeps every drawn layer at least MIN_DRAWN_FRACTION thick and flags the widened ones', () => {
    for (const b of data.bodies) {
      const { radii, exaggerated } = drawnRadii(b);
      expect(radii[radii.length - 1]).toBe(1);
      let prev = 0;
      for (let i = 0; i < radii.length; i++) {
        expect(radii[i] - prev).toBeGreaterThanOrEqual(MIN_DRAWN_FRACTION - 1e-9);
        prev = radii[i];
      }
      // Earth's crust (24 km of 6371) has to be widened; its inner core does not.
      if (b.body === 'earth') {
        expect(exaggerated[b.layers.length - 1]).toBe(true);
        expect(exaggerated[0]).toBe(false);
      }
    }
  });
});
