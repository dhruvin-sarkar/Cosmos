/**
 * TEMPORARY placeholder entities (sol:sun, sol:earth, sol:moon) so the engine, camera, labels and UI can be
 * exercised across scales before the real solar/earth domains land. Physical values are IAU 2015 nominal
 * constants; the visuals are procedural and therefore labelled illustrative.
 */
import type { Entity } from '../../core/entity';
import { observed, type FactSheet } from '../../data/provenance';
import { AU_M, LUNAR_DISTANCE_M, M_EARTH_KG, M_SUN_KG, R_EARTH_MEAN_M, R_SUN_M } from '../../core/units';
import { placeholderPosition, type PlaceholderBody } from './ephemeris';

export const R_MOON_M = 1.7374e6;
const M_MOON_KG = 7.346e22;
const SOURCE = { datasetId: 'iau-2015-nominal', note: 'IAU 2015 Resolution B3 nominal values (placeholder domain)' };
const EPHEMERIS = { datasetId: 'astronomy-engine', note: 'VSOP87 / ELP series via astronomy-engine (placeholder domain)' };

function sheet(id: string, summary: string, facts: FactSheet['sections'][number]['facts']): FactSheet {
  return {
    entityId: id,
    summary,
    sections: [{ id: 'properties', title: 'Properties', facts }],
    representation: {
      provenance: 'illustrative',
      description: 'Temporary procedural appearance used while the real imagery-based domain is being built. Not an image of this body.',
    },
    sources: [SOURCE, EPHEMERIS],
  };
}

function body(
  key: PlaceholderBody,
  e: Omit<Entity, 'position' | 'representation' | 'domain' | 'facts'> & { facts: () => FactSheet },
): Entity {
  return {
    ...e,
    domain: 'solar',
    representation: 'illustrative',
    position: (tMs, out) => placeholderPosition(key, tMs, out),
  };
}

export function createPlaceholderEntities(): Entity[] {
  const sun = body('sun', {
    id: 'sol:sun',
    name: 'Sun',
    aliases: ['Sol'],
    kind: 'star',
    parentId: 'mw:galaxy',
    radiusM: R_SUN_M,
    viewDistance: { min: R_SUN_M * 1.2, default: R_SUN_M * 4 },
    tagline: 'The star at the centre of the Solar System',
    capabilities: ['focus', 'orbit', 'travel', 'sources'],
    importance: 100,
    facts: () =>
      sheet('sol:sun', 'The Sun is a G2 V main-sequence star that holds 99.86 % of the Solar System’s mass.', [
        { key: 'radius', label: 'Radius', quantity: observed(R_SUN_M / 1000, 'km', SOURCE), provenance: 'observed' },
        { key: 'mass', label: 'Mass', quantity: observed(M_SUN_KG, 'kg', SOURCE), provenance: 'observed' },
        { key: 'spectral', label: 'Spectral type', text: 'G2 V', provenance: 'observed' },
      ]),
  });
  const earth = body('earth', {
    id: 'sol:earth',
    name: 'Earth',
    aliases: ['Terra'],
    kind: 'planet',
    parentId: 'sol:sun',
    radiusM: R_EARTH_MEAN_M,
    viewDistance: { min: R_EARTH_MEAN_M * 1.05, default: R_EARTH_MEAN_M * 3.2 },
    tagline: 'Our home planet',
    capabilities: ['focus', 'orbit', 'travel', 'show-orbit', 'sources'],
    importance: 100,
    facts: () =>
      sheet('sol:earth', 'Earth is the third planet from the Sun and the only world known to host life.', [
        { key: 'radius', label: 'Mean radius', quantity: observed(R_EARTH_MEAN_M / 1000, 'km', SOURCE), provenance: 'observed' },
        { key: 'mass', label: 'Mass', quantity: observed(M_EARTH_KG, 'kg', SOURCE), provenance: 'observed' },
        { key: 'a', label: 'Distance from the Sun', quantity: observed(AU_M / 1000, 'km', SOURCE), provenance: 'observed', help: 'Semi-major axis, 1 au by definition of the unit.' },
      ]),
  });
  const moon = body('moon', {
    id: 'sol:moon',
    name: 'Moon',
    aliases: ['Luna'],
    kind: 'moon',
    parentId: 'sol:earth',
    radiusM: R_MOON_M,
    viewDistance: { min: R_MOON_M * 1.05, default: R_MOON_M * 3.4 },
    tagline: 'Earth’s natural satellite',
    capabilities: ['focus', 'orbit', 'travel', 'show-orbit', 'sources'],
    importance: 95,
    facts: () =>
      sheet('sol:moon', 'The Moon is Earth’s only natural satellite, about a quarter of Earth’s width.', [
        { key: 'radius', label: 'Mean radius', quantity: observed(R_MOON_M / 1000, 'km', SOURCE), provenance: 'observed' },
        { key: 'mass', label: 'Mass', quantity: observed(M_MOON_KG, 'kg', SOURCE), provenance: 'observed' },
        { key: 'a', label: 'Mean distance from Earth', quantity: observed(LUNAR_DISTANCE_M / 1000, 'km', SOURCE), provenance: 'observed' },
      ]),
  });
  return [sun, earth, moon];
}
