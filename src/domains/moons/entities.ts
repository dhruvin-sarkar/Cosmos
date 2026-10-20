/**
 * Moon entities: positions are the parent's runtime position (from the registry, so a moon sits exactly on its planet)
 * plus the moon's offset; fact sheets carry radius, mass, density, discovery, orbit and an honest rotation/appearance note.
 */
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { G_SI } from '../../core/units';
import { derived, observed, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { MOON_LOOKS, MOON_RECORDS, PARENT_ENTITY, PARENT_INFO, moonEntityId, type MoonRecord } from './data';
import { IMAGED_FRACTION, coverageClock, hasPartialCoverage, southPoleDirection } from './coverage';
import { fallbackParentPosition, moonOffset, moonRelativeVelocity } from './ephemeris';

const SRC_PHYS: SourceRef = { datasetId: 'jpl-ssd-satellite-phys-par', note: 'JPL SSD Planetary Satellite Physical Parameters' };
const SRC_ELEM: SourceRef = { datasetId: 'jpl-ssd-satellite-mean-elements', note: 'JPL SSD Planetary Satellite Mean Elements (epoch J2000)' };
const SRC_DISC: SourceRef = { datasetId: 'jpl-ssd-satellite-discovery', note: 'JPL SSD Planetary Satellite Discovery Circumstances' };
const SRC_ROT: SourceRef = { datasetId: 'naif-pck00011', note: 'IAU WGCCRE 2015 rotational elements (Archinal et al. 2018)' };
const SRC_TEX: SourceRef = { datasetId: 'textures-usgs-planetary-wms', note: 'USGS Astrogeology planetary map (public domain)' };

/** Mean radius from the triaxial semi-axes (cube root of the product). */
export function meanRadiusM(rec: MoonRecord): number {
  const [a, b, c] = rec.radiiKm;
  return Math.cbrt(a * b * c) * 1000;
}

const parentName = (rec: MoonRecord): string => PARENT_INFO[rec.parent].name;

function rotationFact(rec: MoonRecord): Fact {
  const look = MOON_LOOKS[rec.id];
  if (rec.rotation) {
    return { key: 'rotation', label: 'Rotation', text: `Tidally locked: one rotation per orbit (${(360 / Math.abs(rec.rotation.wd)).toFixed(3)} d), same face toward ${parentName(rec)}`, provenance: 'observed', source: SRC_ROT };
  }
  if (look.spin) return { key: 'rotation', label: 'Rotation', text: look.spin.note, provenance: look.spin.kind === 'sync' ? 'derived' : 'illustrative' };
  return { key: 'rotation', label: 'Rotation', text: 'Assumed tidally locked (no published rotation model)', provenance: 'derived' };
}

/** Voyager 2 saw only the southern hemisphere; say what the Sun lights today (sub-solar latitude of the latest frame). */
function coverageFact(id: string): Fact {
  const pct = Math.round((IMAGED_FRACTION[id] ?? 0) * 100);
  const lat = coverageClock.sunLatDeg;
  const now = !Number.isFinite(lat)
    ? ''
    : lat > 5
      ? `The Sun is now over the northern hemisphere (sub-solar latitude ${lat.toFixed(0)}° N), which Voyager 2 never imaged: the sunlit face you see is illustrative fill.`
      : lat < -5
        ? `The Sun is now over the southern hemisphere (sub-solar latitude ${Math.abs(lat).toFixed(0)}° S), the one Voyager 2 imaged.`
        : 'The Sun is near the equator, lighting both hemispheres.';
  return {
    key: 'coverage',
    label: 'Imaged by Voyager 2',
    text: `About ${pct} % of the surface (the southern hemisphere, January 1986); the rest is an albedo-matched procedural fill (illustrative). ${now}`.trim(),
    provenance: 'reconstructed',
  };
}

function buildFacts(rec: MoonRecord): FactSheet {
  const look = MOON_LOOKS[rec.id];
  const o = rec.orbit;
  const [ra, rb, rc] = rec.radiiKm;
  const meanKm = meanRadiusM(rec) / 1000;
  const irregular = Math.abs(ra - rc) / meanKm > 0.02;
  const gravity = (rec.gm * 1e9) / Math.pow(meanKm * 1000, 2);
  const escape = Math.sqrt((2 * rec.gm * 1e9) / (meanKm * 1000)) / 1000;
  const props: Fact[] = [
    { key: 'radius', label: 'Mean radius', quantity: observed(+meanKm.toFixed(irregular ? 1 : 2), 'km', SRC_PHYS), provenance: 'observed' },
  ];
  if (irregular) {
    props.push({ key: 'axes', label: 'Semi-axes', text: `${ra} × ${rb} × ${rc} km`, provenance: 'observed', source: SRC_PHYS, help: 'Triaxial semi-axes: toward the planet × along the orbit × polar.' });
  }
  props.push(
    { key: 'mass', label: 'Mass', quantity: observed(rec.massKg, 'kg', SRC_PHYS), provenance: 'observed', help: 'From the measured GM of the moon divided by G.' },
    { key: 'density', label: 'Mean density', quantity: rec.rho === null ? { value: null, unit: 'kg/m3', provenance: 'observed', source: SRC_PHYS } : observed(rec.rho, 'kg/m3', SRC_PHYS), provenance: 'observed' },
    { key: 'gravity', label: 'Surface gravity', quantity: derived(+gravity.toPrecision(3), 'm/s2', 'GM/r²', SRC_PHYS), provenance: 'derived', help: 'Non-rotating, at the mean radius.' },
    { key: 'escape', label: 'Escape velocity', quantity: derived(+escape.toPrecision(3), 'km/s', '√(2GM/r)', SRC_PHYS), provenance: 'derived' },
    { key: 'albedo', label: 'Geometric albedo', quantity: observed(look.albedo, '', SRC_PHYS), provenance: 'observed' },
  );
  const planeLabel = o.frame === 'laplace' ? `${parentName(rec)}’s Laplace plane` : o.frame === 'equatorial' ? `${parentName(rec)}’s equator` : 'the ecliptic';
  const orbit: Fact[] = [
    { key: 'a', label: 'Distance from ' + parentName(rec), quantity: derived(o.aKm, 'km', 'JPL mean elements', SRC_ELEM), provenance: 'derived', help: 'Semi-major axis of the mean orbit.' },
    { key: 'period', label: 'Orbital period', quantity: derived(+(rec.id === 'triton' ? 5.876854 : o.periodDays).toPrecision(7), 'd', 'JPL mean elements', SRC_ELEM), provenance: 'derived', help: rec.id === 'triton' ? 'Triton orbits retrograde (opposite to Neptune’s spin).' : undefined },
    { key: 'e', label: 'Eccentricity', quantity: derived(o.e, '', 'JPL mean elements', SRC_ELEM), provenance: 'derived' },
    { key: 'i', label: 'Inclination', quantity: derived(o.iDeg, 'deg', 'JPL mean elements', SRC_ELEM), provenance: 'derived', help: `Relative to ${planeLabel}.` },
    rotationFact(rec),
    { key: 'discovery', label: 'Discovered', text: rec.disc.by ? `${rec.disc.year}, ${rec.disc.by}` : String(rec.disc.year), provenance: 'observed', source: SRC_DISC },
  ];
  const galilean = ['io', 'europa', 'ganymede', 'callisto'].includes(rec.id);
  const missing: string[] = [];
  if (rec.rotation === null && look.spin && look.spin.kind !== 'sync') missing.push('Rotation state');
  if (look.irregular && look.representation === 'illustrative' && ['nereid', 'himalia'].includes(rec.id)) missing.push('Shape');
  const assumptions = [
    galilean
      ? 'Position from the L1.2 Galilean-satellite theory (via astronomy-engine), relative to Jupiter’s position; accurate to about an arcminute.'
      : 'Position from JPL mean orbital elements (epoch J2000) propagated linearly, with precession: good for the orbit’s shape and approximate phase, not a precision ephemeris (errors of several degrees over decades).',
  ];
  const sections: FactSheet['sections'] = [
    { id: 'properties', title: 'Properties', facts: props },
    { id: 'orbit', title: 'Orbit & rotation', facts: orbit },
  ];
  if (hasPartialCoverage(rec.id)) sections.push({ id: 'coverage', title: 'Imagery coverage', facts: [coverageFact(rec.id)] });
  return {
    entityId: moonEntityId(rec.id),
    summary: rec.summary,
    sections,
    representation: { provenance: look.representation, description: look.imagery },
    sources: look.texture ? [SRC_PHYS, SRC_ELEM, SRC_DISC, SRC_ROT, SRC_TEX] : [SRC_PHYS, SRC_ELEM, SRC_DISC, SRC_ROT],
    epoch: { label: 'Mean orbital elements', iso: o.epochJD === 2451545 ? '2000-01-01T12:00:00Z' : '2020-01-01T00:00:00Z', jd: o.epochJD },
    missing: missing.length ? missing : undefined,
    assumptions,
  };
}

/** Same value G_SI is used for mass; exported for tests. */
export const G = G_SI;

export function createMoonEntities(registry: Pick<EntityRegistry, 'get'>): Entity[] {
  return MOON_RECORDS.map((rec) => {
    const look = MOON_LOOKS[rec.id];
    const parentId = PARENT_ENTITY[rec.parent];
    let parent: Entity | undefined;
    const off = new Vector3();
    const scratch = new Vector3();
    const R = meanRadiusM(rec);
    const rMax = Math.max(rec.radiiKm[0], rec.radiiKm[1], rec.radiiKm[2]) * 1000;
    const entity: Entity = {
      id: moonEntityId(rec.id),
      name: look.name,
      aliases: look.aliases,
      kind: 'moon',
      domain: 'solar',
      parentId,
      radiusM: R,
      position(tMs, out) {
        parent ??= registry.get(parentId);
        if (parent) parent.position(tMs, out);
        else fallbackParentPosition(rec.parent, tMs, out);
        return out.add(moonOffset(rec, tMs, off));
      },
      velocity(tMs, out) {
        if (parent?.velocity) parent.velocity(tMs, out);
        else out.set(0, 0, 0);
        return out.add(moonRelativeVelocity(rec, tMs, off, scratch));
      },
      viewDistance: { min: rMax * 1.15, default: rMax * 3.6 },
      // Approach from the imaged (south) side so the Voyager 2 terrain is the part in view.
      ...(hasPartialCoverage(rec.id) ? { approachDir: southPoleDirection(rec) } : {}),
      tagline: look.tagline,
      capabilities: ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'sources', 'related'],
      importance: look.importance,
      representation: look.representation,
      facts: () => buildFacts(rec),
    };
    return entity;
  });
}
