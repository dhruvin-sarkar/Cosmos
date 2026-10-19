/**
 * EntityProvider for the 3,449 near-Earth objects of neos.json: ids 'sb:<designation-slug>' ('sb:99942', 'sb:2004-mn4'),
 * resolved lazily into entities with a two-body position and a FactSheet. Named bodies (Apophis, Bennu, …) keep their
 * hand-built entities; their numeric ids resolve to those.
 */
import { Vector3 } from 'three';
import type { Entity, EntityProvider, EntityRegistry, SearchRecord } from '../../core/entity';
import { derived, observed, type Fact, type FactSheet } from '../../data/provenance';
import { SB_RECORDS } from './catalog';
import { diameterFromHKm, obs, SRC_SBDB, tableFacts } from './bodies';
import { heliocentricIcrsM, heliocentricVelocityIcrs, jdTdbFromMs, perihelionAU, aphelionAU } from './orbits';
import { neoElements, normalizeDesignation, type NeoRow } from './neoApi';
import { sunSource } from './sources';
import { ORBIT_CLASS_NAMES } from './catalog';

const NAMED_BY_DESIGNATION = new Map(SB_RECORDS.map((r) => [normalizeDesignation(r.designation), r.id]));

/** Stable entity id of a NEO row ('sb:apophis' for named bodies, 'sb:99942'/'sb:2024-yr4' otherwise). */
export function neoEntityId(r: NeoRow): string {
  const named = NAMED_BY_DESIGNATION.get(normalizeDesignation(r.designation));
  if (named) return `sb:${named}`;
  return `sb:${r.designation.trim().toLowerCase().replace(/\s+/g, '-')}`;
}

function displayName(r: NeoRow): string {
  // fullname: "1036 Ganymed (A924 UB)" or "(2026 TE2)" → drop the redundant parentheses around a bare designation
  return r.fullname.replace(/^\((.+)\)$/, '$1');
}

function importanceOf(r: NeoRow): number {
  const d = r.diameterKm ?? r.diameterEstKm ?? 0.05;
  return Math.max(6, Math.min(44, 14 + 10 * Math.log10(d + 0.01) + (r.pha ? 4 : 0)));
}

const ROWS_BY_ID = new Map<string, NeoRow>();
/** NEO catalog row behind a provider-resolved entity id (undefined for named bodies or unknown ids). */
export function lookupNeoRow(id: string): NeoRow | undefined {
  return ROWS_BY_ID.get(id);
}

export function createNeoProvider(registry: Pick<EntityRegistry, 'get'>, rows: readonly NeoRow[]): EntityProvider {
  const sun = sunSource(registry);
  const helio = new Vector3();
  const byId = new Map<string, NeoRow>();
  for (const r of rows) if (!NAMED_BY_DESIGNATION.has(normalizeDesignation(r.designation))) byId.set(neoEntityId(r), r);
  for (const [id, r] of byId) ROWS_BY_ID.set(id, r);
  const cache = new Map<string, Entity>();
  let records: SearchRecord[] | null = null;

  const build = (id: string, r: NeoRow): Entity => {
    const el = neoElements(r);
    const diameterKm = r.diameterKm ?? r.diameterEstKm ?? 0.1;
    const radius = (diameterKm * 1000) / 2;
    const cls = ORBIT_CLASS_NAMES[r.orbitClass] ?? r.orbitClass;
    return {
      id,
      name: displayName(r),
      aliases: [r.designation],
      kind: 'asteroid',
      domain: 'solar',
      parentId: 'sol:sun',
      radiusM: radius,
      position: (tMs, out) => {
        heliocentricIcrsM(el, jdTdbFromMs(tMs), helio);
        return sun(tMs, out).add(helio);
      },
      velocity: (tMs, out) => heliocentricVelocityIcrs(el, jdTdbFromMs(tMs), out),
      viewDistance: { min: radius * 2.6, default: Math.max(radius * 4.5, 40) },
      tagline: `${r.pha ? 'Potentially hazardous ' : ''}${cls}${r.H !== null ? ` · H ${r.H.toFixed(1)}` : ''}`,
      capabilities: ['focus', 'orbit', 'travel', 'follow', 'show-orbit', 'sources'],
      importance: importanceOf(r),
      representation: 'illustrative',
      facts: async (): Promise<FactSheet> => {
        const physical: Fact[] = [];
        if (r.diameterKm !== null) physical.push(obs('diameter', 'Diameter', r.diameterKm, 'km', undefined, SRC_SBDB, r.diameterSigmaKm));
        else if (r.diameterEstKm !== null) {
          physical.push({
            key: 'diameter', label: 'Diameter (estimated)', provenance: 'derived',
            help: 'Estimated from the absolute magnitude H with an assumed albedo of 0.14; uncertain by about a factor of two.',
            quantity: derived(r.diameterEstKm, 'km', 'h-albedo-diameter@1', SRC_SBDB),
          });
        }
        if (r.H !== null) physical.push(obs('H', 'Absolute magnitude (H)', r.H, 'mag'));
        if (r.albedo !== null) physical.push(obs('albedo', 'Geometric albedo', r.albedo, ''));
        if (r.rotationPeriodH !== null) physical.push(obs('rotation', 'Rotation period', r.rotationPeriodH, 'h'));
        const orbit: Fact[] = [
          { key: 'class', label: 'Orbit class', text: cls + (r.pha ? ' (PHA)' : ''), provenance: 'observed', source: SRC_SBDB },
          obs('a', 'Semi-major axis', r.aAU, 'AU'),
          obs('e', 'Eccentricity', r.e, ''),
          obs('i', 'Inclination to the ecliptic', r.iDeg, 'deg'),
          obs('q', 'Perihelion distance', perihelionAU(r.aAU, r.e), 'AU'),
        ];
        const Q = aphelionAU(r.aAU, r.e);
        if (Q !== null) orbit.push(obs('Q', 'Aphelion distance', Q, 'AU'));
        if (r.moidAU !== null) orbit.push(obs('moid', 'Closest approach to Earth\'s orbit (MOID)', r.moidAU, 'AU'));
        const t = await tableFacts(r.designation, true);
        const observations: Fact[] = [...t.facts];
        if (r.dataArcDays !== null) observations.unshift(obs('arc', 'Observation arc', r.dataArcDays / 365.25, 'yr'));
        return {
          entityId: id,
          summary: `${displayName(r)} is a ${cls.toLowerCase()}${r.pha ? ' classed as potentially hazardous (it can approach Earth\'s orbit within 0.05 au and is larger than ~140 m)' : ''}.`,
          sections: [
            { id: 'properties', title: 'Properties', facts: physical },
            { id: 'orbit', title: 'Orbit', facts: orbit, paragraphs: ['Elements are rounded to ~4–5 significant figures in this snapshot and propagated as a two-body orbit: fine for display, not for impact analysis.'] },
            { id: 'observations', title: 'Observations', facts: observations, paragraphs: t.paragraphs.length ? t.paragraphs : undefined },
          ],
          representation: { provenance: 'illustrative', description: 'Generic irregular body scaled to the catalogued or estimated size. Not a shape model.' },
          sources: [{ datasetId: 'jpl-sbdb-neos-phas' }, ...t.sources],
          epoch: { label: 'Osculating elements', jd: r.epochJD },
          assumptions: ['Orbit: two-body propagation from the osculating epoch.', ...(r.diameterKm === null ? ['Size: from H with an assumed albedo of 0.14.'] : [])],
          missing: r.diameterKm === null && r.diameterEstKm === null ? ['Diameter'] : undefined,
        };
      },
    };
  };

  void observed;
  void diameterFromHKm;
  return {
    domain: 'solar',
    resolve(id: string): Entity | undefined {
      const hit = cache.get(id);
      if (hit) return hit;
      const row = byId.get(id);
      if (!row) return undefined;
      const e = build(id, row);
      cache.set(id, e);
      return e;
    },
    searchRecords(): readonly SearchRecord[] {
      records ??= [...byId.entries()].map(([id, r]) => ({
        id, name: displayName(r), aliases: [r.designation], kind: 'asteroid' as const, domain: 'solar' as const,
        importance: importanceOf(r), tagline: `${r.pha ? 'PHA · ' : ''}${ORBIT_CLASS_NAMES[r.orbitClass] ?? r.orbitClass}`,
      }));
      return records;
    },
    resolveIdentifier(query: string): string[] {
      const q = normalizeDesignation(query);
      if (!q) return [];
      const named = NAMED_BY_DESIGNATION.get(q);
      if (named) return [`sb:${named}`];
      const out: string[] = [];
      for (const [id, r] of byId) if (normalizeDesignation(r.designation) === q) out.push(id);
      return out;
    },
  };
}
