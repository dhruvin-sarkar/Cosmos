/**
 * Outer-system entities: Kuiper belt, scattered disk, heliosphere (termination shock, heliopause), Oort cloud, plus a lazy
 * provider for the ~45 named trans-Neptunian objects that no other domain draws. All are centred on the Sun.
 * Provenance: catalogued TNO orbits are observed; the heliosphere shells are reconstructed; the Oort cloud is illustrative.
 */
import * as THREE from 'three';
import type { Entity, EntityProvider, EntityRegistry, SearchRecord } from '../../core/entity';
import { derived, observed, type Fact, type FactSheet, type ProvenanceClass, type SourceRef } from '../../data/provenance';
import { AU_M, LY_M } from '../../core/units';
import { heliocentricIcrsM, jdTdbFromMs, perihelionAU, aphelionAU, periodDays } from '../smallbodies/orbits';
import { LINKED_TNOS, cleanName, loadTnos, newElements, tnoElements, tnoEntityId, type NamedTno, type TnoData } from './data';
import { CROSSINGS, HELIOPAUSE, INFLOW_SPEED_KMS, NOSE_ECLIPTIC_LAT_DEG, NOSE_ECLIPTIC_LON_DEG, OORT_HILLS_EDGE_AU, OORT_INNER_AU, OORT_OUTER_AU, TNO_CLASS_LABEL, TERMINATION_SHOCK } from './model';
import { sunSource, type PositionFn } from './sources';

export const SRC_TNO: SourceRef = { datasetId: 'jpl-sbdb-tnos' };
export const SRC_LIT: SourceRef = { datasetId: 'outer-literature' };

export const OUTER_IDS = {
  kuiper: 'outer:kuiper-belt',
  scattered: 'outer:scattered-disk',
  heliosphere: 'outer:heliosphere',
  terminationShock: 'outer:termination-shock',
  heliopause: 'outer:heliopause',
  oort: 'outer:oort-cloud',
} as const;

const fmtDate = (iso: string): string => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

interface SheetInput {
  id: string;
  summary: string;
  facts: Fact[];
  paragraphs?: string[];
  representation: { provenance: ProvenanceClass; description: string };
  sources: SourceRef[];
  missing?: string[];
  assumptions?: string[];
  epoch?: FactSheet['epoch'];
}

function sheet(s: SheetInput): FactSheet {
  return {
    entityId: s.id,
    summary: s.summary,
    sections: [{ id: 'properties', title: 'Properties', facts: s.facts, paragraphs: s.paragraphs }],
    representation: s.representation,
    sources: s.sources,
    missing: s.missing,
    assumptions: s.assumptions,
    epoch: s.epoch,
  };
}

const AU_KM = AU_M / 1000;
const q = (v: number, unit: string, p: ProvenanceClass = 'observed', src: SourceRef = SRC_LIT) =>
  p === 'derived' ? derived(v, unit, 'outer-model@1', src) : observed(v, unit, src);

function crossingFacts(): Fact[] {
  return CROSSINGS.map((c) => ({
    key: `${c.craftId}-${c.shell}`,
    label: `${c.craftId === 'voyager-1' ? 'Voyager 1' : 'Voyager 2'} crossed the ${c.shell === 'heliopause' ? 'heliopause' : 'termination shock'} (${fmtDate(c.dateIso)})`,
    quantity: observed(c.distanceAU, 'AU', { ...SRC_LIT, reference: c.citation }),
    text: fmtDate(c.dateIso),
    provenance: 'observed' as const,
  }));
}

export function createOuterEntities(registry: Pick<EntityRegistry, 'get'>): Entity[] {
  const sun: PositionFn = sunSource(registry);
  const base = (e: Omit<Entity, 'domain' | 'parentId' | 'position' | 'capabilities'> & Partial<Pick<Entity, 'capabilities'>>): Entity => ({
    domain: 'solar',
    parentId: 'sol:sun',
    position: (t, out) => sun(t, out),
    capabilities: ['focus', 'orbit', 'travel', 'sources'],
    ...e,
  });

  const kuiper = base({
    id: OUTER_IDS.kuiper,
    name: 'Kuiper Belt',
    aliases: ['Edgeworth–Kuiper belt', 'Kuiper belt', 'KBO', 'TNO', 'trans-Neptunian objects', 'classical belt', 'plutinos'],
    kind: 'region',
    radiusM: 50 * AU_M,
    framingRadiusM: 58 * AU_M,
    viewDistance: { min: 25 * AU_M, default: 150 * AU_M, max: 800 * AU_M },
    tagline: 'A vast ring of icy worlds beyond Neptune, 30–50 au from the Sun',
    importance: 62,
    representation: 'observed',
    facts: async () => {
      const d = await loadTnos().catch(() => null);
      const cc = d?.header.classCounts ?? {};
      const facts: Fact[] = [
        { key: 'range', label: 'Main extent', text: '≈ 30–50 au (classical belt 42–48 au)', provenance: 'observed', source: SRC_LIT },
        { key: 'catalogued', label: 'Catalogued objects drawn', quantity: d ? observed(d.count, '', SRC_TNO) : { value: null, unit: '', provenance: 'observed' }, provenance: 'observed', help: 'Every trans-Neptunian object in the JPL Small-Body Database, from Minor Planet Center observations. The real population is far larger: surveys only find the brightest.' },
        { key: 'plutinos', label: 'Plutinos (3:2 with Neptune)', quantity: observed(cc.plutino ?? null, '', SRC_TNO), provenance: 'derived', help: 'Classified by a heuristic on osculating semi-major axis, eccentricity and inclination.' },
        { key: 'cold', label: 'Cold classical', quantity: observed(cc['cold-classical'] ?? null, '', SRC_TNO), provenance: 'derived' },
        { key: 'hot', label: 'Hot classical', quantity: observed(cc['hot-classical'] ?? null, '', SRC_TNO), provenance: 'derived' },
        { key: 'big', label: 'Estimated objects > 100 km', text: 'at least ~100,000', provenance: 'derived', source: SRC_LIT, help: 'Survey-debiased estimate (Trujillo et al. 2001; Bernstein et al. 2004).' },
      ];
      return sheet({
        id: OUTER_IDS.kuiper,
        summary: 'The Kuiper belt is a doughnut-shaped zone of icy bodies left over from planet formation, orbiting beyond Neptune. Pluto, Haumea, Makemake and Arrokoth live here.',
        facts,
        paragraphs: [
          'Colours show dynamical classes: the dynamically cold classical belt (low inclination, very red surfaces), the hot classical belt, plutinos locked in a 3:2 resonance with Neptune, twotinos (2:1), and other resonant objects. Each dot is a real catalogued object on its real orbit.',
          'The catalogue is a biased sample: surveys detect bright, large, near-the-ecliptic objects near perihelion. The belt is far richer than the dots drawn.',
        ],
        representation: { provenance: 'observed', description: 'Each point is a catalogued object propagated from its osculating orbit (observed). Point size and colour are illustrative cues for brightness and dynamical class.' },
        sources: [SRC_TNO, SRC_LIT],
        assumptions: ['Positions use two-body propagation from per-object osculating elements; accuracy degrades decades from the element epoch.', 'Dynamical class is a heuristic box on a, e, i, not a formal classification.'],
      });
    },
  });

  const scattered = base({
    id: OUTER_IDS.scattered,
    name: 'Scattered Disk',
    aliases: ['scattered disc', 'SDO', 'scattered disk objects', 'detached objects', 'extreme TNO'],
    kind: 'region',
    radiusM: 100 * AU_M,
    framingRadiusM: 150 * AU_M,
    viewDistance: { min: 40 * AU_M, default: 380 * AU_M, max: 2500 * AU_M },
    tagline: 'Icy bodies flung onto eccentric, tilted orbits by Neptune, reaching hundreds of au',
    importance: 50,
    representation: 'observed',
    facts: async () => {
      const d = await loadTnos().catch(() => null);
      const cc = d?.header.classCounts ?? {};
      return sheet({
        id: OUTER_IDS.scattered,
        summary: 'The scattered disk holds icy bodies with perihelia near Neptune’s reach but orbits stretching far beyond it. Eris, the most massive known dwarf planet, belongs here.',
        facts: [
          { key: 'scattered', label: 'Catalogued scattered-disk objects', quantity: observed(cc.scattered ?? null, '', SRC_TNO), provenance: 'derived', help: 'Heuristic class: perihelion within Neptune’s gravitational reach, semi-major axis beyond ~48 au.' },
          { key: 'detached', label: 'Catalogued detached objects', quantity: observed(cc.detached ?? null, '', SRC_TNO), provenance: 'derived', help: 'Perihelia beyond ~40 au: too far out for Neptune to scatter them today. Sedna (perihelion ≈ 76 au) is the classic example.' },
          { key: 'eris', label: 'Eris semi-major axis', text: '≈ 68 au (perihelion 38 au, aphelion 98 au)', provenance: 'observed', source: SRC_TNO },
        ],
        paragraphs: ['Scattered-disk orbits are highly eccentric and often steeply inclined, so they appear as a puffed-up cloud above and below the Kuiper belt. Many were thrown outward during Neptune’s early migration.'],
        representation: { provenance: 'observed', description: 'Catalogued objects on their real orbits (same points as the Kuiper belt, shown in lilac for the scattered disk and pink for detached orbits).' },
        sources: [SRC_TNO],
        assumptions: ['Class boundaries are heuristic.'],
      });
    },
  });

  const heliosphere = base({
    id: OUTER_IDS.heliosphere,
    name: 'Heliosphere',
    aliases: ['heliosphere', 'solar wind bubble', 'Sun’s bubble', 'interstellar boundary'],
    kind: 'reference',
    radiusM: HELIOPAUSE.R * AU_M,
    framingRadiusM: 240 * AU_M,
    viewDistance: { min: 60 * AU_M, default: 520 * AU_M, max: 5000 * AU_M },
    tagline: 'The bubble the solar wind blows in interstellar space, about 120 au out where the Voyagers crossed it',
    importance: 66,
    representation: 'reconstructed',
    facts: () =>
      sheet({
        id: OUTER_IDS.heliosphere,
        summary: 'The heliosphere is the region of space dominated by the Sun’s wind and magnetic field. Its outer boundary, the heliopause, separates it from the interstellar medium. Voyager 1 and 2 are the only spacecraft to have crossed it.',
        facts: [
          { key: 'nose', label: 'Nose direction (upwind)', text: `ecliptic longitude ${NOSE_ECLIPTIC_LON_DEG.toFixed(1)}°, latitude +${NOSE_ECLIPTIC_LAT_DEG.toFixed(1)}° (toward Ophiuchus)`, provenance: 'observed', source: { ...SRC_LIT, reference: 'Bzowski et al. 2015, ApJS 220, 28 (IBEX-Lo interstellar helium flow)' } },
          { key: 'flow', label: 'Interstellar inflow speed', quantity: observed(INFLOW_SPEED_KMS, 'km/s', SRC_LIT), provenance: 'observed' },
          { key: 'hp-nose', label: 'Heliopause, model nose-ward distance', quantity: q(HELIOPAUSE.R, 'AU', 'derived'), provenance: 'derived', help: 'Fitted so the surface passes through the Voyager 1 and 2 crossings; the nose itself has never been visited.' },
          ...crossingFacts(),
        ],
        paragraphs: [
          'The shape is shown as a smooth, comet-like bubble elongated downwind (toward ecliptic longitude ≈ 76°). Where the real heliosphere is rounder, croissant-like or has a long tail is still debated, and no spacecraft has probed the flanks or tail.',
          'Only four points are measured: where Voyager 1 and Voyager 2 crossed each boundary. Everything else on the shells is a reconstruction.',
        ],
        representation: { provenance: 'reconstructed', description: 'Smooth shells fitted through the four Voyager crossings (observed) with an assumed elongated shape. Not a measured surface.' },
        sources: [SRC_LIT],
        assumptions: ['Axisymmetric elongation about the interstellar-flow direction plus a north–south asymmetry fitted to the two Voyager lines of sight.', 'Tail length is arbitrary and fades out.'],
      }),
  });

  const ts = base({
    id: OUTER_IDS.terminationShock,
    name: 'Termination Shock',
    aliases: ['heliospheric termination shock', 'solar wind termination shock'],
    kind: 'reference',
    radiusM: TERMINATION_SHOCK.R * AU_M,
    framingRadiusM: 160 * AU_M,
    viewDistance: { min: 40 * AU_M, default: 340 * AU_M, max: 3000 * AU_M },
    tagline: 'Where the solar wind slows from supersonic to subsonic: 94 au (Voyager 1), 84 au (Voyager 2)',
    importance: 55,
    representation: 'reconstructed',
    facts: () =>
      sheet({
        id: OUTER_IDS.terminationShock,
        summary: 'At the termination shock the supersonic solar wind abruptly slows and heats as it meets the pressure of the interstellar medium. It sits roughly 80–95 au from the Sun in the directions Voyager travelled.',
        facts: crossingFacts().filter((f) => f.key.endsWith('termination-shock')),
        paragraphs: ['The shock moves in and out with the solar cycle by several au, so the two crossings, three years and different directions apart, are not directly comparable.'],
        representation: { provenance: 'reconstructed', description: 'A fitted surface through the two Voyager crossings with assumed shape elsewhere.' },
        sources: [SRC_LIT],
      }),
  });

  const hp = base({
    id: OUTER_IDS.heliopause,
    name: 'Heliopause',
    aliases: ['heliospheric boundary', 'interstellar space boundary'],
    kind: 'reference',
    radiusM: HELIOPAUSE.R * AU_M,
    framingRadiusM: 240 * AU_M,
    viewDistance: { min: 60 * AU_M, default: 520 * AU_M, max: 5000 * AU_M },
    tagline: 'The edge of the Sun’s influence: crossed by Voyager 1 at 121.6 au (2012) and Voyager 2 at 119 au (2018)',
    importance: 58,
    representation: 'reconstructed',
    facts: () =>
      sheet({
        id: OUTER_IDS.heliopause,
        summary: 'The heliopause is the boundary where the solar wind’s pressure balances the interstellar medium. Beyond it a spacecraft is in interstellar space, though still deep inside the Sun’s gravitational domain.',
        facts: crossingFacts().filter((f) => f.key.endsWith('heliopause')),
        paragraphs: ['Crossing was recognised by a jump in plasma density (Voyager 1’s plasma-wave instrument, Voyager 2’s plasma instrument) and a change in cosmic-ray flux.'],
        representation: { provenance: 'reconstructed', description: 'A fitted surface through the two Voyager crossings with assumed shape elsewhere.' },
        sources: [SRC_LIT],
      }),
  });

  const oort = base({
    id: OUTER_IDS.oort,
    name: 'Oort Cloud',
    aliases: ['Oort cloud', 'Öpik–Oort cloud', 'Hills cloud', 'inner Oort cloud', 'comet reservoir'],
    kind: 'reference',
    radiusM: OORT_OUTER_AU * AU_M,
    framingRadiusM: OORT_OUTER_AU * 1.15 * AU_M,
    viewDistance: { min: 1500 * AU_M, default: 380_000 * AU_M, max: 3_000_000 * AU_M },
    tagline: 'Hypothesised shell of icy comet nuclei, ~2,000–100,000 au out: never directly observed',
    importance: 64,
    representation: 'illustrative',
    facts: () =>
      sheet({
        id: OUTER_IDS.oort,
        summary: 'The Oort cloud is a hypothesised, roughly spherical reservoir of icy bodies that supplies long-period comets. No Oort-cloud object has been seen in place; it is inferred from the orbits of comets that fall into the inner Solar System.',
        facts: [
          { key: 'inner', label: 'Inner (Hills) cloud', text: `≈ ${OORT_INNER_AU.toLocaleString('en-GB')}–${OORT_HILLS_EDGE_AU.toLocaleString('en-GB')} au, flattened toward the ecliptic`, provenance: 'illustrative', source: SRC_LIT },
          { key: 'outer', label: 'Outer cloud', text: `≈ ${OORT_HILLS_EDGE_AU.toLocaleString('en-GB')}–${OORT_OUTER_AU.toLocaleString('en-GB')} au (≈ 0.3–1.6 ly), roughly spherical`, provenance: 'illustrative', source: SRC_LIT },
          { key: 'edge', label: 'Outer edge used here', quantity: observed(OORT_OUTER_AU * AU_M / LY_M, 'ly', SRC_LIT), provenance: 'illustrative', help: 'The true edge is poorly known; 50,000–200,000 au appear in the literature.' },
          { key: 'sun', label: 'Distance to the nearest star', text: '≈ 4.25 ly (Proxima Centauri), just outside the cloud', provenance: 'observed' },
          { key: 'speed', label: 'Light-travel time to the outer edge', quantity: derived((OORT_OUTER_AU * AU_KM * 1000) / 299_792_458 / 86400 / 365.25, 'yr', 'light-time@1', SRC_LIT), provenance: 'derived' },
        ],
        paragraphs: ['The particles drawn are a seeded random sample, placed to show the idea: a toroidal inner cloud and a spherical outer one. They are not real objects and their positions carry no information.'],
        representation: { provenance: 'illustrative', description: 'Hypothesised, illustrative. A seeded random point cloud plus a faint boundary shell; no individual Oort-cloud object has been observed.' },
        sources: [SRC_LIT],
        missing: ['Total mass', 'True outer edge', 'Number of comet nuclei'],
        assumptions: ['Density falls as r⁻³·⁵ in the inner cloud; the outer cloud is isotropic.', 'Boundaries follow Oort (1950) and Hills (1981) as summarised by Dones et al. (2015).'],
      }),
  });

  return [kuiper, scattered, heliosphere, ts, hp, oort];
}

// ── Named trans-Neptunian objects (lazy provider) ──────────────────────────────────────────

const R_ASSUMED_UNKNOWN = null;

function tnoEntity(d: TnoData, n: NamedTno, sun: PositionFn): Entity {
  const id = tnoEntityId(n.name);
  const name = cleanName(n.name);
  const tmp = new THREE.Vector3();
  const el = newElements();
  tnoElements(d, n.i, el);
  const radiusM = n.diameterKm ? (n.diameterKm * 500) : R_ASSUMED_UNKNOWN;
  return {
    id,
    name,
    aliases: [n.pdes, `${n.pdes} ${name}`],
    kind: 'asteroid',
    domain: 'solar',
    parentId: 'sol:sun',
    radiusM,
    position: (tMs, out) => {
      sun(tMs, out);
      return out.add(heliocentricIcrsM(el, jdTdbFromMs(tMs), tmp));
    },
    viewDistance: { min: 2e6, default: 3e7, max: 5e9 },
    tagline: `${TNO_CLASS_LABEL[n.cls]} · a = ${n.aAU.toFixed(1)} au`,
    capabilities: ['focus', 'orbit', 'travel', 'sources', 'show-orbit'],
    importance: 36,
    representation: 'observed',
    facts: () => {
      const q0 = perihelionAU(el.aAU, el.e);
      const Q = aphelionAU(el.aAU, el.e);
      const per = periodDays(el.aAU, el.e);
      return sheet({
        id,
        summary: `${name} (${n.pdes}) is a trans-Neptunian object in the ${TNO_CLASS_LABEL[n.cls].toLowerCase()}. No spacecraft has visited it and its surface is not imaged; it appears here only as a point on its orbit.`,
        facts: [
          { key: 'a', label: 'Semi-major axis', quantity: observed(el.aAU, 'AU', SRC_TNO), provenance: 'observed' },
          { key: 'e', label: 'Eccentricity', quantity: observed(el.e, '', SRC_TNO), provenance: 'observed' },
          { key: 'i', label: 'Inclination', quantity: observed(el.iDeg, 'deg', SRC_TNO), provenance: 'observed' },
          { key: 'q', label: 'Perihelion', quantity: derived(q0, 'AU', 'kepler@1', SRC_TNO), provenance: 'derived' },
          { key: 'Q', label: 'Aphelion', quantity: derived(Q, 'AU', 'kepler@1', SRC_TNO), provenance: 'derived' },
          { key: 'P', label: 'Orbital period', quantity: derived(per === null ? null : per / 365.25, 'yr', 'kepler@1', SRC_TNO), provenance: 'derived' },
          { key: 'H', label: 'Absolute magnitude', quantity: observed(n.H, 'mag', SRC_TNO), provenance: 'observed' },
          { key: 'D', label: 'Diameter', quantity: n.diameterKm ? observed(n.diameterKm, 'km', SRC_TNO) : { value: null, unit: 'km', provenance: 'observed', source: SRC_TNO }, provenance: 'observed' },
        ],
        representation: { provenance: 'illustrative', description: 'A point marker on the catalogued orbit. Nothing is known about the surface appearance.' },
        sources: [SRC_TNO],
        missing: n.diameterKm ? [] : ['Diameter', 'Albedo', 'Surface colour'],
        epoch: { label: 'Osculating-element epoch', jd: el.epochJD },
      });
    },
  };
}

export function createTnoProvider(registry: Pick<EntityRegistry, 'get'>): EntityProvider & { load(): Promise<void> } {
  const sun = sunSource(registry);
  let data: TnoData | null = null;
  const byId = new Map<string, NamedTno>();
  const cache = new Map<string, Entity>();
  return {
    domain: 'solar',
    load: async () => {
      data = await loadTnos();
      for (const n of data.header.named) if (!(cleanName(n.name).toLowerCase() in LINKED_TNOS)) byId.set(tnoEntityId(n.name), n);
    },
    resolve(id) {
      if (!data) return undefined;
      const hit = cache.get(id);
      if (hit) return hit;
      const n = byId.get(id);
      if (!n) return undefined;
      const e = tnoEntity(data, n, sun);
      cache.set(id, e);
      return e;
    },
    searchRecords(): readonly SearchRecord[] {
      const out: SearchRecord[] = [];
      for (const [id, n] of byId) {
        out.push({ id, name: cleanName(n.name), aliases: [n.pdes], kind: 'asteroid', domain: 'solar', importance: 36, tagline: TNO_CLASS_LABEL[n.cls] });
      }
      return out;
    },
    resolveIdentifier(query) {
      const s = query.trim().toLowerCase();
      const out: string[] = [];
      for (const [id, n] of byId) if (n.pdes === s || cleanName(n.name).toLowerCase() === s) out.push(id);
      return out;
    },
  };
}
