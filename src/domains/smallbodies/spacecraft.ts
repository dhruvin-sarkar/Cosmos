/**
 * Spacecraft: the sc:* entities, their mission metadata, FactSheets and trajectories.
 *
 * Trajectories are JPL Horizons state vectors for whole missions (craftTracks.ts: non-uniform samples with velocities,
 * cubic Hermite, centre body per craft — Juno around Jupiter, Cassini around Saturn, DART around Didymos, JWST around
 * Earth, the rest around the Sun). The older uniform 2025–2030 samples (public/data/solar/spacecraft.json, `CraftTrack`)
 * remain as the fallback. Outside the delivered coverage a track is held at its end point — never extrapolated — and the
 * FactSheet says so. Cassini and DART are historic: drawn only inside their mission window (see craftLayer).
 */
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { observed, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { SECONDS_PER_DAY } from '../../core/units';
import craftMeta from './craft.generated.json';
import { jdTdbFromMs, msFromJdTdb } from './orbits';
import { HermiteTrack, loadCraftTrackJson, type CraftCenterId } from './craftTracks';
import { CENTER_ENTITY, centerSource, type PositionFn } from './craftSources';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

/** Legacy uniform-sample record (public/data/solar/spacecraft.json). */
export interface CraftData {
  id: string;
  name: string;
  naifId: number;
  centerId: 'sun' | 'earth';
  startJD: number;
  stepDays: number;
  count: number;
  coverage: { requested: [string, string]; delivered: [string, string]; trimmed: boolean };
  samples?: number[];
  mission: { agency: string; launchDateUTC: string; status: string; summary: string };
  source: string;
  retrieved: string;
}

/** Bundled mission metadata (craft.generated.json, written by scripts/data/smallbodies/craft-tracks.mjs). */
export interface CraftMeta {
  id: string;
  name: string;
  naifId: number;
  centerId: CraftCenterId;
  startJD: number;
  endJD: number;
  historic?: boolean;
  coverage: { requested: [string, string]; delivered: [string, string]; trimmed: boolean };
  mission: { agency: string; launchDateUTC: string; status: string; summary: string };
  source: string;
  retrieved: string;
}

/** Uniform-step track (legacy data; kept for the fallback path and its tests). */
export class CraftTrack {
  readonly id: string;
  readonly centerId: 'sun' | 'earth';
  readonly startJD: number;
  readonly stepDays: number;
  readonly count: number;
  /** km, xyz interleaved. */
  readonly samples: Float64Array;

  constructor(d: CraftData) {
    this.id = d.id;
    this.centerId = d.centerId;
    this.startJD = d.startJD;
    this.stepDays = d.stepDays;
    this.count = d.count;
    this.samples = Float64Array.from(d.samples ?? []);
  }

  get endJD(): number {
    return this.startJD + (this.count - 1) * this.stepDays;
  }

  covers(jd: number): boolean {
    return jd >= this.startJD && jd <= this.endJD;
  }

  private tangent(i: number, k: number): number {
    const s = this.samples;
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, this.count - 1);
    return (s[3 * b + k] - s[3 * a + k]) / ((b - a) * this.stepDays);
  }

  positionM(jd: number, out: Vector3): Vector3 {
    const u = Math.min(Math.max((jd - this.startJD) / this.stepDays, 0), this.count - 1);
    const i = Math.min(Math.floor(u), this.count - 2);
    const t = u - i;
    const t2 = t * t, t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1, h10 = t3 - 2 * t2 + t, h01 = -2 * t3 + 3 * t2, h11 = t3 - t2;
    const h = this.stepDays;
    const s = this.samples;
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      c[k] = (h00 * s[3 * i + k] + h10 * h * this.tangent(i, k) + h01 * s[3 * (i + 1) + k] + h11 * h * this.tangent(i + 1, k)) * 1000;
    }
    return out.set(c[0], c[1], c[2]);
  }

  velocityMs(jd: number, out: Vector3): Vector3 {
    const u = Math.min(Math.max((jd - this.startJD) / this.stepDays, 0), this.count - 1);
    const i = Math.min(Math.floor(u), this.count - 2);
    const t = u - i;
    const t2 = t * t;
    const d00 = 6 * t2 - 6 * t, d10 = 3 * t2 - 4 * t + 1, d01 = -6 * t2 + 6 * t, d11 = 3 * t2 - 2 * t;
    const h = this.stepDays;
    const s = this.samples;
    const c = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      c[k] = ((d00 * s[3 * i + k] + d01 * s[3 * (i + 1) + k]) / h + d10 * this.tangent(i, k) + d11 * this.tangent(i + 1, k)) * 1000 / SECONDS_PER_DAY;
    }
    return out.set(c[0], c[1], c[2]);
  }
}

// ── Loading ─────────────────────────────────────────────────────────────────────────────────────────────────────

let craftPromise: Promise<CraftData[]> | null = null;
/** Fetch the legacy spacecraft.json once (≈ 0.9 MB). */
export function loadCraftData(): Promise<CraftData[]> {
  craftPromise ??= fetch(`${BASE}data/solar/spacecraft.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`spacecraft.json: HTTP ${r.status}`);
      return r.json() as Promise<{ craft: CraftData[] }>;
    })
    .then((j) => j.craft);
  return craftPromise;
}

/** Shared, mutable table of loaded tracks (filled when the data arrives). */
export const TRACKS = new Map<string, HermiteTrack>();

let allPromise: Promise<void> | null = null;
/** Load craft-tracks.json into TRACKS; craft missing from it fall back to the legacy uniform samples. */
export function loadAllTracks(): Promise<void> {
  allPromise ??= loadCraftTrackJson().then(async (rows) => {
    for (const j of rows) if (j.t.length >= 2) TRACKS.set(j.id, HermiteTrack.fromJson(j));
    if (CRAFT_META.every((m) => TRACKS.has(m.id))) return;
    try {
      for (const d of await loadCraftData()) {
        if (!TRACKS.has(d.id) && d.samples && d.samples.length >= 6) TRACKS.set(d.id, HermiteTrack.fromUniform(d));
      }
    } catch {
      /* no ephemeris: craft stay at their centre body */
    }
  });
  return allPromise;
}

// ── Static description of each craft ────────────────────────────────────────────────────────────────────────────

export type CraftModelId =
  | 'voyager' | 'new-horizons' | 'parker' | 'juno' | 'clipper' | 'psyche' | 'lucy' | 'hera' | 'juice' | 'bepicolombo'
  | 'jwst' | 'solar-orbiter' | 'cassini' | 'dart';

export interface CraftInfo {
  id: string;
  model: CraftModelId;
  /** Framing radius, m (about half the largest true dimension). */
  radiusM: number;
  tagline: string;
  /** Extra editorial text (mission facts that are not in the dataset). */
  paragraphs: string[];
  /** Key specifications [label, value] from the agency mission pages. */
  specs: [string, string][];
  /** Agency mission page (citation). */
  page: string;
  importance: number;
  /** Attitude: antenna (+Z) toward Earth, or shield (+Z) toward the Sun. */
  attitude: 'earth' | 'sun';
  /** Days of recent path drawn as the trail. */
  trailDays: number;
}

const SRC_HORIZONS: SourceRef = { datasetId: 'jpl-horizons-spacecraft' };

export const CRAFT_INFO: Record<string, CraftInfo> = {
  'voyager-1': {
    id: 'voyager-1', model: 'voyager', radiusM: 6, tagline: 'The most distant human-made object', importance: 92, attitude: 'earth', trailDays: 3650,
    page: 'NASA/JPL Voyager mission site, science.nasa.gov/mission/voyager',
    paragraphs: ['Voyager 1 crossed the heliopause in August 2012 and is now in interstellar space, about 170 au from the Sun — nearly 24 light-hours, reaching one light-day from Earth in November 2026. It still returns data through its 3.7 m dish.'],
    specs: [['Launch mass', '825.5 kg'], ['High-gain antenna', '3.66 m diameter'], ['Power', '3 radioisotope thermoelectric generators (≈ 470 W at launch)'], ['Magnetometer boom', '13 m']],
  },
  'voyager-2': {
    id: 'voyager-2', model: 'voyager', radiusM: 6, tagline: 'The only spacecraft to visit Uranus and Neptune', importance: 88, attitude: 'earth', trailDays: 3650,
    page: 'NASA/JPL Voyager mission site, science.nasa.gov/mission/voyager',
    paragraphs: ['Voyager 2 flew past Jupiter (1979), Saturn (1981), Uranus (1986) and Neptune (1989), then crossed the heliopause in November 2018.'],
    specs: [['Launch mass', '825.5 kg'], ['High-gain antenna', '3.66 m diameter'], ['Power', '3 radioisotope thermoelectric generators'], ['Magnetometer boom', '13 m']],
  },
  'new-horizons': {
    id: 'new-horizons', model: 'new-horizons', radiusM: 2.2, tagline: 'First flyby of Pluto; later Arrokoth', importance: 80, attitude: 'earth', trailDays: 3650,
    page: 'NASA / JHU-APL New Horizons, science.nasa.gov/mission/new-horizons',
    paragraphs: ['New Horizons passed Pluto on 14 July 2015 and the Kuiper-belt object Arrokoth on 1 January 2019. It continues outward through the Kuiper belt.'],
    specs: [['Launch mass', '478 kg'], ['High-gain antenna', '2.1 m diameter'], ['Power', '1 radioisotope thermoelectric generator (≈ 245 W at launch)'], ['Pluto flyby', '12,500 km from the surface, 14 July 2015']],
  },
  'parker-solar-probe': {
    id: 'parker-solar-probe', model: 'parker', radiusM: 1.8, tagline: 'Closest spacecraft to the Sun', importance: 82, attitude: 'sun', trailDays: 88,
    page: 'NASA / JHU-APL Parker Solar Probe, science.nasa.gov/mission/parker-solar-probe',
    paragraphs: ['Parker reaches perihelion about 9.86 solar radii (6.9 million km) from the Sun’s centre at about 190 km/s — the fastest object ever built — hiding behind an 11.4 cm carbon-composite heat shield whose sunward face reaches about 1,400 °C while the instruments behind it stay near room temperature.'],
    specs: [['Launch mass', '685 kg'], ['Heat shield', '2.3 m diameter, 11.43 cm thick'], ['Closest perihelion', '9.86 solar radii from the centre (≈ 6.1 million km above the surface)'], ['Top speed', '≈ 192 km/s']],
  },
  juno: {
    id: 'juno', model: 'juno', radiusM: 10, tagline: 'Polar orbiter at Jupiter', importance: 72, attitude: 'earth', trailDays: 40,
    page: 'NASA/JPL Juno mission, science.nasa.gov/mission/juno',
    paragraphs: ['Juno has orbited Jupiter in a polar orbit since July 2016 (53 days at first, shortened to about 33 days by moon flybys), diving to within a few thousand kilometres of the cloud tops at each perijove to map Jupiter’s gravity, magnetic field and deep atmosphere. It spins twice a minute.'],
    specs: [['Launch mass', '3,625 kg'], ['Solar arrays', '3 wings, each ≈ 8.9 × 2.7 m (18,698 cells)'], ['Span', '≈ 20 m'], ['Power at Jupiter', '≈ 500 W']],
  },
  'europa-clipper': {
    id: 'europa-clipper', model: 'clipper', radiusM: 15, tagline: 'Flyby mission to Jupiter’s moon Europa', importance: 78, attitude: 'earth', trailDays: 365,
    page: 'NASA/JPL Europa Clipper, science.nasa.gov/mission/europa-clipper',
    paragraphs: ['Launched in October 2024, Europa Clipper uses a Mars flyby (2025) and an Earth flyby (December 2026) to reach Jupiter in 2030, then makes about 50 close passes of Europa.'],
    specs: [['Launch mass', '6,065 kg'], ['Solar-array span', '30.5 m'], ['High-gain antenna', '3 m diameter'], ['Magnetometer boom', '8.5 m']],
  },
  psyche: {
    id: 'psyche', model: 'psyche', radiusM: 12, tagline: 'En route to the metal-rich asteroid 16 Psyche', importance: 66, attitude: 'earth', trailDays: 365,
    page: 'NASA/JPL Psyche, science.nasa.gov/mission/psyche',
    paragraphs: ['Psyche uses solar-electric (Hall-thruster) propulsion and a Mars gravity assist (May 2026) to reach asteroid (16) Psyche in 2029.'],
    specs: [['Launch mass', '2,608 kg'], ['Solar arrays', 'two cross-shaped wings, 24.8 m tip to tip'], ['Propulsion', 'SPT-140 Hall-effect thrusters (xenon)']],
  },
  lucy: {
    id: 'lucy', model: 'lucy', radiusM: 7.5, tagline: 'Tour of the Jupiter Trojan asteroids', importance: 64, attitude: 'earth', trailDays: 365,
    page: 'NASA / SwRI Lucy, science.nasa.gov/mission/lucy',
    paragraphs: ['Lucy flew past the main-belt asteroids Dinkinesh (2023) and Donaldjohanson (2025), and will visit several Jupiter Trojans from 2027.'],
    specs: [['Launch mass', '1,550 kg'], ['Solar arrays', 'two circular UltraFlex wings, 7.3 m diameter each'], ['High-gain antenna', '2 m diameter']],
  },
  hera: {
    id: 'hera', model: 'hera', radiusM: 6, tagline: 'ESA’s follow-up survey of the DART impact site', importance: 80, attitude: 'earth', trailDays: 120,
    page: 'ESA Hera, esa.int/Space_Safety/Hera',
    paragraphs: ['Hera, launched 7 October 2024, rendezvous with Didymos and Dimorphos to measure Dimorphos’ mass and the crater DART left. As of this snapshot its arrival is planned for late 2026; the delivered ephemeris ends in early November 2026.'],
    specs: [['Launch mass', '1,128 kg'], ['CubeSats carried', 'Milani and Juventas'], ['Solar-array span', '≈ 11.5 m']],
  },
  juice: {
    id: 'juice', model: 'juice', radiusM: 14, tagline: 'ESA mission to Jupiter’s icy moons', importance: 66, attitude: 'earth', trailDays: 365,
    page: 'ESA JUICE, esa.int/Science_Exploration/Space_Science/Juice',
    paragraphs: ['JUICE launched in April 2023 and arrives at Jupiter in July 2031; it will orbit Ganymede from 2034.'],
    specs: [['Launch mass', '6,070 kg'], ['Solar arrays', '85 m² (10 panels), ≈ 27 m span'], ['Radar antenna', '16 m'], ['Magnetometer boom', '10.6 m']],
  },
  bepicolombo: {
    id: 'bepicolombo', model: 'bepicolombo', radiusM: 15, tagline: 'ESA/JAXA Mercury orbiter mission', importance: 64, attitude: 'sun', trailDays: 120,
    page: 'ESA BepiColombo, esa.int/Science_Exploration/Space_Science/BepiColombo',
    paragraphs: ['BepiColombo launched in October 2018, made six Mercury flybys, and enters orbit around Mercury in November 2026, where its two orbiters (ESA’s MPO and JAXA’s Mio) separate.'],
    specs: [['Launch mass', '4,100 kg'], ['Stack height', '6.4 m'], ['Transfer-module arrays', '≈ 30 m span']],
  },
  'solar-orbiter': {
    id: 'solar-orbiter', model: 'solar-orbiter', radiusM: 9, tagline: 'First close-up views of the Sun’s poles', importance: 74, attitude: 'sun', trailDays: 180,
    page: 'ESA Solar Orbiter, esa.int/Science_Exploration/Space_Science/Solar_Orbiter',
    paragraphs: ['Solar Orbiter swings as close as 0.28 au to the Sun behind a titanium heat shield coated with black calcium phosphate (burnt bone charcoal). Repeated Venus flybys tilt its orbit out of the ecliptic so it can image the Sun’s polar regions for the first time.'],
    specs: [['Launch mass', '1,800 kg'], ['Heat shield', '3.1 × 2.4 m'], ['Solar-array span', '18 m'], ['Closest approach', '≈ 0.28 au']],
  },
  jwst: {
    id: 'jwst', model: 'jwst', radiusM: 11, tagline: 'Infrared space telescope at the Sun–Earth L2 point', importance: 86, attitude: 'sun', trailDays: 180,
    page: 'NASA / ESA / CSA JWST, science.nasa.gov/mission/webb',
    paragraphs: [
      'JWST loops around the Sun–Earth L2 point about 1.5 million km from Earth on a halo orbit (period about six months; drawn here in the rotating Sun–Earth frame so its loop reads as a ring around L2).',
      'The five-layer sunshield keeps the Sun, Earth and Moon always on one side: the telescope and its gold mirror sit permanently in shade at about −233 °C, so up close they are seen unlit, exactly as they are in space.',
    ],
    specs: [['Launch mass', '6,161 kg'], ['Sunshield', '21.2 × 14.2 m, five layers of aluminised Kapton'], ['Primary mirror', '6.5 m, 18 gold-coated beryllium hexagons'], ['Distance from Earth', '≈ 1.5 million km']],
  },
  cassini: {
    id: 'cassini', model: 'cassini', radiusM: 6, tagline: 'Thirteen years at Saturn (2004–2017)', importance: 76, attitude: 'earth', trailDays: 30,
    page: 'NASA / ESA / ASI Cassini–Huygens, science.nasa.gov/mission/cassini',
    paragraphs: ['Cassini entered orbit around Saturn on 1 July 2004, released the Huygens probe to Titan, discovered the water plumes of Enceladus, and ended its mission on 15 September 2017 by diving into Saturn so it could never contaminate a potentially habitable moon. It is shown only between launch and that final plunge.'],
    specs: [['Launch mass', '5,712 kg (with Huygens)'], ['Height', '6.8 m'], ['High-gain antenna', '4 m diameter'], ['Power', '3 radioisotope thermoelectric generators (≈ 885 W at launch)']],
  },
  dart: {
    id: 'dart', model: 'dart', radiusM: 9.5, tagline: 'Planetary-defence impactor (2022)', importance: 84, attitude: 'earth', trailDays: 30,
    page: 'NASA / JHU-APL DART, science.nasa.gov/mission/dart',
    paragraphs: ['DART struck Dimorphos, the moonlet of asteroid Didymos, on 26 September 2022 at 23:14 UTC at about 6.1 km/s. The impact shortened Dimorphos’ 11 h 55 min orbit by about 33 minutes — the first time humanity changed the motion of a celestial body. It is shown only during its flight; afterwards it no longer exists.'],
    specs: [['Mass at impact', '≈ 580 kg'], ['Solar arrays', '2 roll-out arrays, 8.5 m each'], ['Impact speed', '6.1 km/s'], ['Orbit change', '−33 ± 1 min (Thomas et al. 2023)']],
  },
};

const ILLUSTRATIVE_LABEL = 'Illustrative model · real position';

function buildSheet(d: CraftMeta, info: CraftInfo, hasTrack: boolean): FactSheet {
  const pageSrc: SourceRef = { datasetId: 'jpl-horizons-spacecraft', reference: info.page, note: 'Mission specifications' };
  const facts: Fact[] = [
    { key: 'agency', label: 'Agency', text: d.mission.agency, provenance: 'observed', source: SRC_HORIZONS },
    { key: 'launch', label: 'Launch', text: d.mission.launchDateUTC, provenance: 'observed', source: SRC_HORIZONS },
    { key: 'status', label: d.historic ? 'Status' : 'Status (Oct 2026)', text: d.mission.status, provenance: 'observed', source: SRC_HORIZONS, help: 'Editorial status line dated October 2026.' },
    ...info.specs.map(([label, text], i): Fact => ({ key: `spec${i}`, label, text, provenance: 'observed', source: pageSrc })),
  ];
  const held = d.coverage.trimmed
    ? `JPL Horizons has no ephemeris beyond ${d.coverage.delivered[1]} UTC; outside the delivered window the craft is held at its end point rather than extrapolated.`
    : 'Outside the delivered window the craft is held at its end point rather than extrapolated.';
  return {
    entityId: `sc:${d.id}`,
    summary: d.mission.summary,
    sections: [
      { id: 'overview', title: 'Mission', facts, paragraphs: info.paragraphs },
      {
        id: 'orbit', title: 'Trajectory', facts: [
          { key: 'cov', label: 'Ephemeris coverage', text: `${d.coverage.delivered[0]} → ${d.coverage.delivered[1]}`, provenance: 'observed', source: SRC_HORIZONS },
          { key: 'centre', label: 'Reference', text: `${d.centerId === 'didymos' ? 'Didymos' : d.centerId[0].toUpperCase() + d.centerId.slice(1)}-centred, ICRF axes`, provenance: 'observed', source: SRC_HORIZONS },
          { key: 'naif', label: 'NAIF ID', quantity: observed(d.naifId, '', SRC_HORIZONS), provenance: 'observed' },
        ],
        paragraphs: [
          held,
          'Positions are JPL Horizons state vectors (position and velocity) interpolated with a cubic Hermite spline; samples are dense around flybys, perijoves and perihelia.',
          ...(hasTrack ? [] : ['The trajectory file has not loaded; the craft is shown at its centre body.']),
        ],
      },
    ],
    representation: {
      provenance: 'illustrative',
      description: `${ILLUSTRATIVE_LABEL}: simplified procedural model of ${d.name} at true proportions and size (real colours: gold and silver multilayer insulation, white radiators and dishes, dark solar cells), oriented ${info.attitude === 'sun' ? 'with its heat shield toward the Sun' : 'with its high-gain antenna toward Earth'}. The position is JPL Horizons ephemeris data; the model and attitude are illustrative.`,
    },
    sources: [SRC_HORIZONS],
    epoch: { label: 'Ephemeris retrieved', iso: d.retrieved.slice(0, 10) },
  };
}

/** Mission metadata of every craft (no state vectors), available synchronously. */
export const CRAFT_META = (craftMeta as unknown as { craft: CraftMeta[] }).craft.filter((m) => CRAFT_INFO[m.id] !== undefined);

/** Parent entity of a craft (the body its track is centred on). */
export const craftParentId = (m: Pick<CraftMeta, 'centerId'>): string => CENTER_ENTITY[m.centerId];

/** Window in which a historic craft exists (JD TDB); null for active missions. */
export function historicWindow(m: CraftMeta): [number, number] | null {
  return m.historic ? [m.startJD, m.endJD] : null;
}

/** Create the sc:* entities (metadata is bundled; state vectors arrive via loadAllTracks → TRACKS). */
export function createCraftEntities(registry: Pick<EntityRegistry, 'get'>, metas: readonly CraftMeta[] = CRAFT_META): Entity[] {
  const tmp = new Vector3();
  const tmp2 = new Vector3();
  const entities: Entity[] = [];
  for (const d of metas) {
    const info = CRAFT_INFO[d.id];
    if (!info) continue;
    const center: PositionFn = centerSource(registry, d.centerId);
    // DART: the last hour of the approach is eased onto the drawn Dimorphos, so the impact happens exactly on the moonlet
    // (whose orbital phase in this app is illustrative; the correction is ≈ 1 km against a 22,000 km approach hour).
    let dimorphos: Entity | undefined;
    const dartFix = d.id === 'dart'
      ? (tMs: number, jd: number, tr: HermiteTrack, out: Vector3): void => {
        const w = Math.min(Math.max((jd - (tr.endJD - 1 / 24)) * 24, 0), 1);
        if (w <= 0) return;
        dimorphos ??= registry.get('sb:dimorphos');
        if (!dimorphos) return;
        const tEnd = Math.min(tMs, msFromJdTdb(tr.endJD));
        dimorphos.position(tEnd, tmp2);
        center(tEnd, tmp);
        tmp2.sub(tmp); // Dimorphos relative to Didymos at impact (or now, before it)
        tr.positionM(tr.endJD, tmp);
        out.addScaledVector(tmp2.sub(tmp), w * w * (3 - 2 * w));
      }
      : null;
    entities.push({
      id: `sc:${d.id}`,
      name: d.name,
      aliases: [d.id.replace(/-/g, ' '), ...(d.id === 'jwst' ? ['Webb', 'JWST'] : [])],
      kind: 'spacecraft',
      domain: 'solar',
      parentId: craftParentId(d),
      radiusM: info.radiusM,
      position: (tMs, out) => {
        center(tMs, out);
        const tr = TRACKS.get(d.id);
        if (tr) {
          const jd = jdTdbFromMs(tMs);
          out.add(tr.positionM(jd, tmp));
          dartFix?.(tMs, jd, tr, out);
        }
        return out;
      },
      velocity: (tMs, out) => {
        const tr = TRACKS.get(d.id);
        return tr ? tr.velocityMs(jdTdbFromMs(tMs), out) : out.set(0, 0, 0);
      },
      viewDistance: { min: info.radiusM * 2.2, default: info.radiusM * 5.5 },
      tagline: `${info.tagline} · ${ILLUSTRATIVE_LABEL}`,
      capabilities: ['focus', 'orbit', 'travel', 'follow', 'show-orbit', 'sources'],
      importance: info.importance,
      representation: 'illustrative',
      facts: () => buildSheet(d, info, TRACKS.has(d.id)),
    });
  }
  return entities;
}

export { msFromJdTdb, ILLUSTRATIVE_LABEL };
