/**
 * Spacecraft tracks (JPL Horizons vectors, ICRF, km) with cubic Hermite interpolation, and the sc:* entities.
 *
 * Samples are heliocentric (Sun centre) for every craft except JWST (Earth-centred). Tangents are central differences of the
 * neighbouring samples (one-sided at the ends), so the interpolant is C¹; at the 5-day sample step the interpolation error for
 * the deep-space craft is far below a pixel. Parker's 1-day step undersamples perihelion (the hairpin turn lasts hours).
 * Outside the delivered coverage the track is held at its first/last sample — never extrapolated — and the FactSheet says so.
 */
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { observed, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { JD_UNIX_EPOCH, SECONDS_PER_DAY } from '../../core/units';
import craftMeta from './craft.generated.json';
import { jdTdbFromMs, msFromJdTdb } from './orbits';
import { earthSource, sunSource, type PositionFn } from './sources';

const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';

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

  /** True when `jd` lies inside the delivered coverage. */
  covers(jd: number): boolean {
    return jd >= this.startJD && jd <= this.endJD;
  }

  private tangent(i: number, k: number): number {
    const s = this.samples;
    const a = Math.max(i - 1, 0), b = Math.min(i + 1, this.count - 1);
    return (s[3 * b + k] - s[3 * a + k]) / ((b - a) * this.stepDays);
  }

  /** Position (metres, relative to the track's centre body) at JD TDB; clamped to the coverage. */
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

  /** Velocity (m/s) from the Hermite derivative. */
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
/** Fetch spacecraft.json once (≈ 0.9 MB). */
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
export const TRACKS = new Map<string, CraftTrack>();

// ── Static description of each craft ────────────────────────────────────────────────────────────────────────────

export type CraftModelId = 'voyager' | 'new-horizons' | 'parker' | 'juno' | 'clipper' | 'psyche' | 'lucy' | 'hera' | 'juice' | 'bepicolombo' | 'jwst';

export interface CraftInfo {
  id: string;
  model: CraftModelId;
  /** Bounding radius for framing, m. */
  radiusM: number;
  tagline: string;
  /** Extra editorial text (mission facts that are not in the dataset). */
  paragraphs: string[];
  importance: number;
}

const SRC_HORIZONS: SourceRef = { datasetId: 'jpl-horizons-spacecraft' };

export const CRAFT_INFO: Record<string, CraftInfo> = {
  'voyager-1': { id: 'voyager-1', model: 'voyager', radiusM: 7, tagline: 'The most distant human-made object', importance: 92, paragraphs: ['Voyager 1 crossed the heliopause in August 2012 and is now in interstellar space, more than 165 au from the Sun — over 23 light-hours. It still returns data through its 3.7 m dish.'] },
  'voyager-2': { id: 'voyager-2', model: 'voyager', radiusM: 7, tagline: 'The only spacecraft to visit Uranus and Neptune', importance: 88, paragraphs: ['Voyager 2 flew past Jupiter (1979), Saturn (1981), Uranus (1986) and Neptune (1989), then crossed the heliopause in November 2018.'] },
  'new-horizons': { id: 'new-horizons', model: 'new-horizons', radiusM: 3, tagline: 'First flyby of Pluto; later Arrokoth', importance: 80, paragraphs: ['New Horizons passed Pluto on 14 July 2015 and the Kuiper-belt object Arrokoth on 1 January 2019. It continues outward through the Kuiper belt.'] },
  'parker-solar-probe': { id: 'parker-solar-probe', model: 'parker', radiusM: 3, tagline: 'Closest spacecraft to the Sun', importance: 82, paragraphs: ['Parker reaches perihelion about 9.86 solar radii (6.9 million km) from the Sun’s centre at ~190 km/s, protected by a 11.4 cm carbon-composite heat shield. Its 1-day sampling here cannot resolve the few hours around perihelion.'] },
  juno: { id: 'juno', model: 'juno', radiusM: 12, tagline: 'Polar orbiter at Jupiter', importance: 72, paragraphs: ['Juno has orbited Jupiter in a 53-day polar orbit since July 2016, mapping its gravity, magnetic field and deep atmosphere.'] },
  'europa-clipper': { id: 'europa-clipper', model: 'clipper', radiusM: 16, tagline: 'Flyby mission to Jupiter’s moon Europa', importance: 78, paragraphs: ['Launched in October 2024, Europa Clipper uses a Mars flyby (2025) and an Earth flyby (2026) to reach Jupiter in 2030, then makes ~50 close passes of Europa.'] },
  psyche: { id: 'psyche', model: 'psyche', radiusM: 13, tagline: 'En route to the metal-rich asteroid 16 Psyche', importance: 66, paragraphs: ['Psyche uses solar-electric (Hall-thruster) propulsion and a Mars gravity assist (May 2026) to reach asteroid (16) Psyche in 2029.'] },
  lucy: { id: 'lucy', model: 'lucy', radiusM: 9, tagline: 'Tour of the Jupiter Trojan asteroids', importance: 64, paragraphs: ['Lucy flew past the main-belt asteroid Dinkinesh (and its contact-binary moonlet Selam) in November 2023, and will visit several Jupiter Trojans from 2027.'] },
  hera: { id: 'hera', model: 'hera', radiusM: 7, tagline: 'ESA’s follow-up survey of the DART impact site', importance: 80, paragraphs: ['Hera, launched 7 October 2024, will rendezvous with Didymos and Dimorphos to measure Dimorphos’ mass and the crater DART left. As of this snapshot its arrival is planned for November 2026; the delivered ephemeris ends on 2026-11-02.'] },
  juice: { id: 'juice', model: 'juice', radiusM: 30, tagline: 'ESA mission to Jupiter’s icy moons', importance: 66, paragraphs: ['JUICE launched in April 2023 and arrives at Jupiter in July 2031; it will orbit Ganymede from 2034.'] },
  bepicolombo: { id: 'bepicolombo', model: 'bepicolombo', radiusM: 12, tagline: 'ESA/JAXA Mercury orbiter mission', importance: 64, paragraphs: ['BepiColombo launched in October 2018, makes six Mercury flybys, and enters orbit around Mercury in November 2026 (two orbiters: ESA MPO and JAXA Mio).'] },
  jwst: { id: 'jwst', model: 'jwst', radiusM: 12, tagline: 'Infrared space telescope at the Sun–Earth L2 point', importance: 86, paragraphs: ['JWST orbits the Sun–Earth L2 point about 1.5 million km from Earth, shielded from sunlight by a tennis-court-sized five-layer sunshield. Its position here is Earth-centred.'] },
};

const dateOfJd = (jd: number): string => new Date((jd - JD_UNIX_EPOCH) * 86400000).toISOString().slice(0, 10);

function buildSheet(d: CraftData, info: CraftInfo): FactSheet {
  const facts: Fact[] = [
    { key: 'agency', label: 'Agency', text: d.mission.agency, provenance: 'observed', source: SRC_HORIZONS },
    { key: 'launch', label: 'Launch', text: d.mission.launchDateUTC, provenance: 'observed', source: SRC_HORIZONS },
    { key: 'status', label: 'Status (Oct 2026)', text: d.mission.status, provenance: 'observed', source: SRC_HORIZONS, help: 'Editorial status line dated October 2026.' },
    { key: 'size', label: 'Approximate extent', quantity: observed(info.radiusM * 2, 'm', SRC_HORIZONS), provenance: 'illustrative', help: 'Bounding size of the stylised model, rounded.' },
  ];
  return {
    entityId: `sc:${d.id}`,
    summary: d.mission.summary,
    sections: [
      { id: 'overview', title: 'Mission', facts, paragraphs: info.paragraphs },
      {
        id: 'orbit', title: 'Trajectory', facts: [
          { key: 'cov', label: 'Ephemeris coverage', text: `${d.coverage.delivered[0]} → ${d.coverage.delivered[1]}`, provenance: 'observed', source: SRC_HORIZONS },
          { key: 'step', label: 'Sample step', quantity: observed(d.stepDays, 'd', SRC_HORIZONS), provenance: 'observed' },
          { key: 'frame', label: 'Reference', text: d.centerId === 'sun' ? 'Sun-centred, ICRF axes' : 'Earth-centred, ICRF axes', provenance: 'observed', source: SRC_HORIZONS },
        ],
        paragraphs: [d.coverage.trimmed ? `JPL Horizons has no predicted ephemeris beyond ${d.coverage.delivered[1]}; outside the delivered window the marker is held at its end point rather than extrapolated.` : 'Outside the delivered window the marker is held at its end point rather than extrapolated.', 'Positions are Horizons state vectors interpolated with a cubic Hermite spline.'],
      },
    ],
    representation: { provenance: 'illustrative', description: `Stylised model of ${d.name} (simplified geometry at roughly true proportions), oriented with its antenna toward Earth or its shield toward the Sun. The position is observed/predicted ephemeris data; the appearance is illustrative.` },
    sources: [SRC_HORIZONS],
    epoch: { label: 'Ephemeris retrieved', iso: d.retrieved.slice(0, 10) },
  };
}

/** Mission metadata of every craft (no state vectors), available synchronously. */
export const CRAFT_META = (craftMeta as unknown as { craft: CraftData[] }).craft;

/** Create the sc:* entities (metadata is bundled; state vectors arrive via loadCraftData → TRACKS). */
export function createCraftEntities(registry: Pick<EntityRegistry, 'get'>, stubs: readonly CraftData[] = CRAFT_META): Entity[] {
  const sun = sunSource(registry);
  const earth = earthSource(registry);
  const tmp = new Vector3();
  const entities: Entity[] = [];
  for (const d of stubs) {
    const info = CRAFT_INFO[d.id];
    if (!info) continue;
    const center: PositionFn = d.centerId === 'earth' ? earth : sun;
    entities.push({
      id: `sc:${d.id}`,
      name: d.name,
      aliases: [d.id.replace(/-/g, ' ')],
      kind: 'spacecraft',
      domain: 'solar',
      parentId: d.centerId === 'earth' ? 'sol:earth' : 'sol:sun',
      radiusM: info.radiusM,
      position: (tMs, out) => {
        center(tMs, out);
        const tr = TRACKS.get(d.id);
        if (tr) out.add(tr.positionM(jdTdbFromMs(tMs), tmp));
        return out;
      },
      velocity: (tMs, out) => {
        const tr = TRACKS.get(d.id);
        return tr ? tr.velocityMs(jdTdbFromMs(tMs), out) : out.set(0, 0, 0);
      },
      viewDistance: { min: info.radiusM * 2.2, default: info.radiusM * 5.5 },
      tagline: info.tagline,
      capabilities: ['focus', 'orbit', 'travel', 'follow', 'show-orbit', 'sources'],
      importance: info.importance,
      representation: 'illustrative',
      facts: () => buildSheet(d, info),
    });
  }
  return entities;
}

export { msFromJdTdb };
