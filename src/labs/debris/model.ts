/**
 * Orbital debris lab: pure logic (no DOM, no three.js).
 *  - Real state: today's tracked LEO objects binned by altitude shell from the catalogue snapshot
 *    (catalogShells.generated.json ← public/data/orbital/catalog.json, CelesTrak GP + SATCAT).
 *  - Scenarios: the shell source–sink model (src/science/debris.ts 'debris-shell-source-sink@1') seeded with those
 *    counts, run for each policy; per-shell snapshots for the chart and the 3D density field.
 *  - Breakups: two real events (Iridium 33 / Cosmos 2251, 2009; Fengyun-1C ASAT test, 2007) as fragment clouds from
 *    the simplified NASA Standard Breakup Model, each fragment a Kepler orbit with secular J2 drift (src/science/orbits.ts).
 * Units: SI internally; the population clock is in years (names say so).
 */
import { GM_EARTH } from '../../core/units';
import {
  SHELL_SCENARIOS, SOLAR_ACTIVITY_FACTOR, sampleBreakupFragments, shellScenarioParams, simulateShellModel,
  type CollisionPair, type PopulationTriple, type ShellModelParams, type ShellScenarioId,
} from '../../science/debris';
import { j2SecularRates, stateFromTrueAnomaly, stateToElements, meanToTrueAnomaly, type KeplerElements } from '../../science/orbits';
import { createRng, sampleUnitSphere } from '../../science/rng';
import catalogJson from './catalogShells.generated.json';

// ── Real state (catalogue snapshot) ─────────────────────────────────────────────────────────

export interface CatalogShells {
  catalogGenerated: string;
  source: string;
  shellMinKm: number;
  shellMaxKm: number;
  shellStepKm: number;
  totals: { total: number; byClass: Record<string, number>; active: number; activePayloads: number };
  leoCount: number;
  leoBelowMinShell: number;
  shells: { activePayload: number[]; inactivePayload: number[]; rocketBody: number[]; debris: number[]; unknown: number[] };
  breakupDebris: { totals: Record<string, number>; shells: Record<string, number[]> };
}

export const CATALOG: CatalogShells = catalogJson as unknown as CatalogShells;

/** WGS-72 equatorial radius: the catalogue's altitude reference (docs/data/orbital.md). */
export const R_EARTH_ALT_REF_M = 6_378_135;

export function shellEdgesM(c: CatalogShells = CATALOG): number[] {
  const edges: number[] = [];
  for (let h = c.shellMinKm; h <= c.shellMaxKm + 1e-9; h += c.shellStepKm) edges.push(h * 1000);
  return edges;
}

export const SHELL_EDGES_M: readonly number[] = shellEdgesM();
export const SHELL_COUNT = SHELL_EDGES_M.length - 1;

/** Model populations from catalogue classes: active payloads; derelicts = dead payloads + rocket bodies; debris = debris + unknown. */
export function catalogInitialPopulation(c: CatalogShells = CATALOG): PopulationTriple<number[]> {
  const s = c.shells;
  return {
    active: s.activePayload.slice(),
    derelict: s.inactivePayload.map((v, i) => v + (s.rocketBody[i] ?? 0)),
    debris: s.debris.map((v, i) => v + (s.unknown[i] ?? 0)),
  };
}

export interface RealStateSummary {
  /** All catalogued objects (any orbit). */
  total: number;
  leo: number;
  activePayloadsLeo: number;
  deadPayloadsLeo: number;
  rocketBodiesLeo: number;
  debrisLeo: number;
  unknownLeo: number;
  /** Shell index with the most objects, and its centre altitude (km). */
  busiestShell: number;
  busiestShellKm: number;
  busiestShellCount: number;
  snapshotUtc: string;
}

const sum = (a: readonly number[]): number => a.reduce((x, y) => x + y, 0);

export function realStateSummary(c: CatalogShells = CATALOG): RealStateSummary {
  const s = c.shells;
  let best = 0, bestN = -1;
  for (let i = 0; i < s.debris.length; i++) {
    const n = s.activePayload[i] + s.inactivePayload[i] + s.rocketBody[i] + s.debris[i] + s.unknown[i];
    if (n > bestN) { bestN = n; best = i; }
  }
  return {
    total: c.totals.total,
    leo: c.leoCount,
    activePayloadsLeo: sum(s.activePayload),
    deadPayloadsLeo: sum(s.inactivePayload),
    rocketBodiesLeo: sum(s.rocketBody),
    debrisLeo: sum(s.debris),
    unknownLeo: sum(s.unknown),
    busiestShell: best,
    busiestShellKm: c.shellMinKm + (best + 0.5) * c.shellStepKm,
    busiestShellCount: bestN,
    snapshotUtc: c.catalogGenerated,
  };
}

// ── Scenarios ───────────────────────────────────────────────────────────────────────────────

export type SolarLevel = keyof typeof SOLAR_ACTIVITY_FACTOR;

export interface ScenarioInputs {
  scenario: ShellScenarioId;
  solar: SolarLevel;
  horizonYears: number;
  /** Derelicts removed per year (only used by the 'adr' scenario). */
  adrPerYear: number;
}

/** "Real data": today's policy mix (business as usual), average solar activity, 100-year horizon. */
export const REAL_INPUTS: ScenarioInputs = { scenario: 'business-as-usual', solar: 'moderate', horizonYears: 100, adrPerYear: 5 };
export const HORIZON_MIN_YEARS = 50;
export const HORIZON_MAX_YEARS = 200;
export const ADR_MAX_PER_YEAR = 50;
/** Per-shell snapshot spacing: 5 years up to a 100-year horizon, else 10. */
export const snapshotStepYears = (horizonYears: number): number => (horizonYears <= 100 ? 5 : 10);
/**
 * Integration step. The model's RK4 step is explicit and the lowest shells have drag residence times of weeks: at
 * 0.25 y the debris totals oscillate wildly between steps (89k ↔ 17k after 10 years); at ≤ 0.05 y results converge
 * (end-of-century totals within 0.1% of dt = 0.02 y).
 */
export const DT_YEARS = 0.05;

/** True when a "real" value changed (scenario policy, solar activity, ADR rate). The horizon is a viewing choice, not a value. */
export function inputsModified(a: ScenarioInputs, real: ScenarioInputs = REAL_INPUTS): boolean {
  return a.scenario !== real.scenario || a.solar !== real.solar ||
    (a.scenario === 'adr' && a.adrPerYear !== real.adrPerYear);
}

export function scenarioParams(inp: ScenarioInputs): ShellModelParams {
  return shellScenarioParams(inp.scenario, {
    shellEdgesAltitudeM: SHELL_EDGES_M,
    initial: catalogInitialPopulation(),
    solarActivityFactor: SOLAR_ACTIVITY_FACTOR[inp.solar],
    adrPerYear: inp.adrPerYear,
  });
}

export interface ScenarioRun {
  inputs: ScenarioInputs;
  timesYears: Float64Array;
  /** All tracked-size objects (active + derelict + debris ≥ 10 cm) at each output time. */
  total: Float64Array;
  active: Float64Array;
  derelict: Float64Array;
  debris: Float64Array;
  collisionsPerYear: Float64Array;
  cumulativeCollisions: Float64Array;
  /** Years of the per-shell snapshots (0, 5, 10 … horizon; 10-year spacing beyond a 100-year horizon). */
  snapshotYears: number[];
  /** Per snapshot: objects per shell (all populations). */
  shellTotals: Float64Array[];
  /** Per snapshot: debris per shell. */
  shellDebris: Float64Array[];
}

export interface ScenarioSummary {
  totalStart: number;
  totalEnd: number;
  debrisStart: number;
  debrisEnd: number;
  collisionsPerYearStart: number;
  collisionsPerYearEnd: number;
  cumulativeCollisions: number;
  /** Net change of the debris population (≥ 10 cm) over the horizon: fragments made minus fragments decayed. */
  netDebrisChange: number;
  horizonYears: number;
}

/** Totals over time plus per-shell snapshots (independent runs from t = 0, see snapshotStepYears). */
export function runScenario(inp: ScenarioInputs, withShells = true): ScenarioRun {
  const params = scenarioParams(inp);
  const horizon = Math.max(1, inp.horizonYears);
  const r = simulateShellModel(params, horizon, DT_YEARS);
  const n = r.timesYears.length;
  const total = new Float64Array(n);
  for (let j = 0; j < n; j++) total[j] = r.totals.active[j] + r.totals.derelict[j] + r.totals.debris[j];
  const snapshotYears: number[] = [];
  const shellTotals: Float64Array[] = [];
  const shellDebris: Float64Array[] = [];
  if (withShells) {
    const init = params.initial;
    for (let y = 0; y <= horizon + 1e-9; y += snapshotStepYears(horizon)) {
      snapshotYears.push(y);
      const t = new Float64Array(SHELL_COUNT), d = new Float64Array(SHELL_COUNT);
      if (y === 0) {
        for (let i = 0; i < SHELL_COUNT; i++) {
          d[i] = init.debris[i] ?? 0;
          t[i] = (init.active[i] ?? 0) + (init.derelict[i] ?? 0) + d[i];
        }
      } else {
        const s = y >= horizon - 1e-9 ? r : simulateShellModel(params, y, DT_YEARS);
        for (let i = 0; i < SHELL_COUNT; i++) {
          d[i] = s.final.debris[i];
          t[i] = s.final.active[i] + s.final.derelict[i] + d[i];
        }
      }
      shellTotals.push(t);
      shellDebris.push(d);
    }
    if (snapshotYears[snapshotYears.length - 1] < horizon - 1e-9) {
      snapshotYears.push(horizon);
      const t = new Float64Array(SHELL_COUNT), d = new Float64Array(SHELL_COUNT);
      for (let i = 0; i < SHELL_COUNT; i++) { d[i] = r.final.debris[i]; t[i] = r.final.active[i] + r.final.derelict[i] + d[i]; }
      shellTotals.push(t);
      shellDebris.push(d);
    }
  }
  return {
    inputs: { ...inp },
    timesYears: r.timesYears,
    total,
    active: r.totals.active,
    derelict: r.totals.derelict,
    debris: r.totals.debris,
    collisionsPerYear: r.collisionRatePerYear,
    cumulativeCollisions: r.cumulativeCollisions,
    snapshotYears,
    shellTotals,
    shellDebris,
  };
}

export function summarize(run: ScenarioRun): ScenarioSummary {
  const n = run.timesYears.length - 1;
  const cum = run.cumulativeCollisions[n];
  return {
    totalStart: run.total[0],
    totalEnd: run.total[n],
    debrisStart: run.debris[0],
    debrisEnd: run.debris[n],
    collisionsPerYearStart: run.collisionsPerYear[0],
    collisionsPerYearEnd: run.collisionsPerYear[n],
    cumulativeCollisions: cum,
    netDebrisChange: run.debris[n] - run.debris[0],
    horizonYears: run.timesYears[n],
  };
}

/** Per-shell values at an arbitrary year, linearly interpolated between snapshots (writes into `out`). */
export function shellsAtYear(run: ScenarioRun, year: number, which: 'total' | 'debris', out: Float64Array): Float64Array {
  const snaps = which === 'total' ? run.shellTotals : run.shellDebris;
  const ys = run.snapshotYears;
  if (snaps.length === 0) return out.fill(0);
  let k = 0;
  while (k < ys.length - 2 && ys[k + 1] < year) k++;
  const y0 = ys[k], y1 = ys[Math.min(k + 1, ys.length - 1)];
  const w = y1 > y0 ? Math.min(1, Math.max(0, (year - y0) / (y1 - y0))) : 0;
  const a = snaps[k], b = snaps[Math.min(k + 1, snaps.length - 1)];
  for (let i = 0; i < out.length; i++) out[i] = (a[i] ?? 0) * (1 - w) + (b[i] ?? 0) * w;
  return out;
}

/** Spatial density per shell, objects per km³ (writes into `out`). */
export function shellDensityPerKm3(counts: ArrayLike<number>, out: Float64Array, edgesM: readonly number[] = SHELL_EDGES_M): Float64Array {
  for (let i = 0; i < out.length; i++) {
    const r0 = (R_EARTH_ALT_REF_M + edgesM[i]) / 1000, r1 = (R_EARTH_ALT_REF_M + edgesM[i + 1]) / 1000;
    const v = (4 / 3) * Math.PI * (r1 ** 3 - r0 ** 3);
    out[i] = v > 0 ? (counts[i] ?? 0) / v : 0;
  }
  return out;
}

export const SCENARIO_TITLES: Record<ShellScenarioId, string> = Object.fromEntries(SHELL_SCENARIOS.map(s => [s.id, s.title])) as Record<ShellScenarioId, string>;

// ── Breakup events ──────────────────────────────────────────────────────────────────────────

export type BreakupEventId = 'iridium-cosmos-2009' | 'fengyun-1c-2007';

export interface BreakupParent {
  name: string;
  norad: string;
  massKg: number;
  inclinationDeg: number;
  altitudeKm: number;
  /** Moving north at the moment of the breakup (ascending half of the orbit). */
  northbound: boolean;
}

export interface BreakupEvent {
  id: BreakupEventId;
  title: string;
  short: string;
  dateUtc: string;
  latDeg: number;
  lonDeg: number;
  /** True when the geographic location is approximate. */
  locationApprox: boolean;
  parents: BreakupParent[];
  /** Mass of the ASAT kill vehicle when it was the projectile (not a tracked parent). */
  projectileMassKg?: number;
  projectileNote?: string;
  impactSpeedMS: number;
  /** Catalogue group tags of the event's debris (catalogShells breakupDebris). */
  catalogGroups: string[];
  /** What was observed (catalogued fragments), in words. */
  observed: string;
  sources: string[];
}

export const BREAKUP_EVENTS: readonly BreakupEvent[] = [
  {
    id: 'iridium-cosmos-2009',
    title: 'Iridium 33 and Cosmos 2251 collide',
    short: 'Iridium–Cosmos, 2009',
    dateUtc: '2009-02-10T16:56:00Z',
    latDeg: 72.5,
    lonDeg: 97.9,
    locationApprox: false,
    parents: [
      { name: 'Iridium 33', norad: '24946', massKg: 560, inclinationDeg: 86.4, altitudeKm: 789, northbound: true },
      { name: 'Cosmos 2251', norad: '22675', massKg: 900, inclinationDeg: 74.0, altitudeKm: 789, northbound: false },
    ],
    impactSpeedMS: 11_700,
    catalogGroups: ['iridium-33-debris', 'cosmos-2251-debris'],
    observed: 'More than 2,000 fragments were catalogued in the years after the collision, the first accidental collision between two intact satellites.',
    sources: [
      'NASA Orbital Debris Quarterly News 13(2), April 2009: "Satellite collision leaves significant debris clouds"',
      'Kelso, T. S. (2009), Analysis of the Iridium 33–Cosmos 2251 collision, AMOS conference',
    ],
  },
  {
    id: 'fengyun-1c-2007',
    title: 'Fengyun-1C destroyed by an anti-satellite test',
    short: 'Fengyun-1C, 2007',
    dateUtc: '2007-01-11T22:26:00Z',
    latDeg: 28,
    lonDeg: 102,
    locationApprox: true,
    parents: [{ name: 'Fengyun-1C', norad: '25730', massKg: 880, inclinationDeg: 98.6, altitudeKm: 865, northbound: true }],
    projectileMassKg: 100,
    projectileNote: 'The kill vehicle\'s mass is not public; the model assumes 100 kg (illustrative). The result barely depends on it.',
    impactSpeedMS: 9_000,
    catalogGroups: ['fengyun-1c-debris'],
    observed: 'More than 3,000 fragments were catalogued: the largest debris-creating event on record.',
    sources: [
      'NASA Orbital Debris Quarterly News 11(2), April 2007: "Chinese anti-satellite test creates most severe orbital debris cloud in history"',
      'Johnson, N. L. et al. (2008), The characteristics and consequences of the break-up of the Fengyun-1C spacecraft, Acta Astronautica 63, 128',
    ],
  },
];

export function breakupEvent(id: BreakupEventId): BreakupEvent {
  return BREAKUP_EVENTS.find(e => e.id === id) ?? BREAKUP_EVENTS[0];
}

/** Greenwich mean sidereal time, rad (IAU 1982, low precision; adequate for placing a breakup on the globe). */
export function gmstRad(unixMs: number): number {
  const d = unixMs / 86_400_000 + 2_440_587.5 - 2_451_545.0;
  const deg = 280.460_618_37 + 360.985_647_366_29 * d;
  return (((deg % 360) + 360) % 360) * (Math.PI / 180);
}

/**
 * Circular orbit of inclination i through the point (declination δ, right ascension α) at the breakup instant.
 * Returns the elements (ω = 0, M = argument of latitude u) and the ICRS state [x y z vx vy vz] (Earth-centred, m, m/s).
 */
export function orbitThroughPoint(p: BreakupParent, decRad: number, raRad: number, out: Float64Array = new Float64Array(6)): { elements: KeplerElements; state: Float64Array } {
  const inc = p.inclinationDeg * (Math.PI / 180);
  const s = Math.max(-1, Math.min(1, Math.sin(decRad) / Math.sin(inc)));
  const u0 = Math.asin(s);
  const u = p.northbound ? u0 : Math.PI - u0;
  const raan = raRad - Math.atan2(Math.cos(inc) * Math.sin(u), Math.cos(u));
  const a = R_EARTH_ALT_REF_M + p.altitudeKm * 1000;
  const el: KeplerElements = { semiMajorAxisM: a, eccentricity: 0, inclinationRad: inc, raanRad: ((raan % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI), argPeriapsisRad: 0, meanAnomalyRad: u };
  stateFromTrueAnomaly(el, u, GM_EARTH, out, 0);
  return { elements: el, state: out };
}

/** Fragment element record stride: a, e, i, Ω0, ω0, M0, dΩ/dt, dω/dt, dM/dt, parent index. */
export const FRAG_STRIDE = 10;

export interface BreakupCloud {
  event: BreakupEvent;
  eventTimeMs: number;
  /** Fragments ≥ 10 cm predicted by the model (power law). */
  expectedCount: number;
  /** Fragments kept (bound orbits with perigee above the re-entry altitude). */
  count: number;
  /** Fragments whose new orbit dips below 100 km: they re-enter within hours. */
  reenteredCount: number;
  /** Float64 element records (FRAG_STRIDE per fragment). */
  elements: Float64Array;
  /** Characteristic length per fragment, m. */
  sizeM: Float32Array;
  /** Parent orbits (for drawing). */
  parentElements: KeplerElements[];
  /** Breakup point, Earth-centred ICRS, m. */
  point: [number, number, number];
  /** Δv statistics, m/s. */
  medianDeltaVMS: number;
  /** Apogee/perigee altitude ranges of the fragments, km. */
  minPerigeeKm: number;
  maxApogeeKm: number;
}

const REENTRY_PERIGEE_M = 100e3;

export function buildBreakupCloud(id: BreakupEventId, opts: { maxFragments?: number; seed?: string } = {}): BreakupCloud {
  const ev = breakupEvent(id);
  const tMs = Date.parse(ev.dateUtc);
  const dec = ev.latDeg * (Math.PI / 180);
  const ra = gmstRad(tMs) + ev.lonDeg * (Math.PI / 180);
  const parents = ev.parents.map(p => orbitThroughPoint(p, dec, ra));
  const collision: CollisionPair = ev.parents.length >= 2
    ? { projectileMassKg: Math.min(ev.parents[0].massKg, ev.parents[1].massKg), targetMassKg: Math.max(ev.parents[0].massKg, ev.parents[1].massKg), impactSpeedMS: ev.impactSpeedMS }
    : { projectileMassKg: ev.projectileMassKg ?? 100, targetMassKg: ev.parents[0].massKg, impactSpeedMS: ev.impactSpeedMS };
  const seed = opts.seed ?? ev.id;
  const frags = sampleBreakupFragments({ kind: 'collision', collision, lcMinM: 0.1, lcMaxM: 1, maxFragments: opts.maxFragments ?? 4000, seed });
  const rng = createRng(`${seed}:directions`);
  const massTotal = ev.parents.reduce((s, p) => s + p.massKg, 0);
  const elements = new Float64Array(frags.sampledCount * FRAG_STRIDE);
  const sizeM = new Float32Array(frags.sampledCount);
  const st = new Float64Array(6);
  const dir = new Float64Array(3);
  const el: KeplerElements = { semiMajorAxisM: 0, eccentricity: 0, inclinationRad: 0, raanRad: 0, argPeriapsisRad: 0, meanAnomalyRad: 0 };
  const rates = { raanRateRadS: 0, argPeriapsisRateRadS: 0, meanAnomalyRateRadS: 0 };
  let kept = 0, reentered = 0, minPer = Infinity, maxApo = -Infinity;
  const dvs: number[] = [];
  for (let j = 0; j < frags.sampledCount; j++) {
    // Each fragment comes from one parent, chosen in proportion to mass, and inherits that parent's velocity.
    let pi = 0;
    if (ev.parents.length > 1) pi = rng.next() * massTotal < ev.parents[0].massKg ? 0 : 1;
    const ps = parents[pi].state;
    sampleUnitSphere(rng, dir, 0);
    const dv = frags.deltaVMS[j];
    dvs.push(dv);
    for (let k = 0; k < 3; k++) { st[k] = ps[k]; st[k + 3] = ps[k + 3] + dir[k] * dv; }
    stateToElements(st, GM_EARTH, el);
    const e = el.eccentricity, a = el.semiMajorAxisM;
    if (!(e < 1) || !(a > 0) || !Number.isFinite(el.meanAnomalyRad)) { reentered++; continue; }
    const perigee = a * (1 - e) - R_EARTH_ALT_REF_M;
    if (perigee < REENTRY_PERIGEE_M) { reentered++; continue; }
    j2SecularRates(el, {}, rates);
    const o = kept * FRAG_STRIDE;
    elements[o] = a; elements[o + 1] = e; elements[o + 2] = el.inclinationRad;
    elements[o + 3] = el.raanRad; elements[o + 4] = el.argPeriapsisRad; elements[o + 5] = el.meanAnomalyRad;
    elements[o + 6] = rates.raanRateRadS; elements[o + 7] = rates.argPeriapsisRateRadS; elements[o + 8] = rates.meanAnomalyRateRadS;
    elements[o + 9] = pi;
    sizeM[kept] = frags.characteristicLengthM[j];
    minPer = Math.min(minPer, perigee);
    maxApo = Math.max(maxApo, a * (1 + e) - R_EARTH_ALT_REF_M);
    kept++;
  }
  dvs.sort((x, y) => x - y);
  const p0 = parents[0].state;
  return {
    event: ev,
    eventTimeMs: tMs,
    expectedCount: frags.expectedCount,
    count: kept,
    reenteredCount: reentered,
    elements: elements.subarray(0, kept * FRAG_STRIDE),
    sizeM: sizeM.subarray(0, kept),
    parentElements: parents.map(p => p.elements),
    point: [p0[0], p0[1], p0[2]],
    medianDeltaVMS: dvs.length ? dvs[dvs.length >> 1] : NaN,
    minPerigeeKm: Number.isFinite(minPer) ? minPer / 1000 : NaN,
    maxApogeeKm: Number.isFinite(maxApo) ? maxApo / 1000 : NaN,
  };
}

const TWO_PI = 2 * Math.PI;

/** Earth-centred ICRS position (m) of fragment `i` at `tS` seconds after the breakup (Kepler + secular J2). */
export function fragmentPosition(cloud: BreakupCloud, i: number, tS: number, out: Float64Array, offset = 0): Float64Array {
  const o = i * FRAG_STRIDE, E = cloud.elements;
  const el: KeplerElements = {
    semiMajorAxisM: E[o], eccentricity: E[o + 1], inclinationRad: E[o + 2],
    raanRad: (E[o + 3] + E[o + 6] * tS) % TWO_PI, argPeriapsisRad: (E[o + 4] + E[o + 7] * tS) % TWO_PI, meanAnomalyRad: (E[o + 5] + E[o + 8] * tS) % TWO_PI,
  };
  stateFromTrueAnomaly(el, meanToTrueAnomaly(el.meanAnomalyRad, el.eccentricity), GM_EARTH, SCRATCH6, 0);
  out[offset] = SCRATCH6[0]; out[offset + 1] = SCRATCH6[1]; out[offset + 2] = SCRATCH6[2];
  return out;
}
const SCRATCH6 = new Float64Array(6);

export interface CloudSpread {
  /** Fraction of fragments within ±10° (along the orbit) of the original breakup point's moving position. */
  clumpedFraction: number;
  /** Smallest arc of the parent orbit that holds 90% of the fragments, deg (360 = wrapped all the way round). */
  arc90Deg: number;
}

/**
 * How far the cloud has spread along the orbit at `tS`: fragments' arguments of latitude relative to the main parent's.
 * Allocation-light (one sort of ≤ count numbers); call at a few Hz, not per frame.
 */
export function cloudSpread(cloud: BreakupCloud, tS: number, scratch?: Float64Array): CloudSpread {
  const n = cloud.count;
  if (n === 0) return { clumpedFraction: NaN, arc90Deg: NaN };
  const p = cloud.parentElements[0];
  const n0 = Math.sqrt(GM_EARTH / p.semiMajorAxisM ** 3);
  const uRef = p.meanAnomalyRad + n0 * tS;
  const d = scratch && scratch.length >= n ? scratch.subarray(0, n) : new Float64Array(n);
  let clumped = 0;
  const E = cloud.elements;
  for (let i = 0; i < n; i++) {
    const o = i * FRAG_STRIDE;
    const M = E[o + 5] + E[o + 8] * tS;
    const u = E[o + 4] + E[o + 7] * tS + meanToTrueAnomaly(M % TWO_PI, E[o + 1]);
    let du = (u - uRef) % TWO_PI;
    if (du < 0) du += TWO_PI;
    d[i] = du;
    const s = du > Math.PI ? TWO_PI - du : du;
    if (s < (10 * Math.PI) / 180) clumped++;
  }
  d.sort();
  // Largest empty gap on the circle → smallest arc holding everything; for 90%, slide a window of 0.9·n points.
  const k = Math.max(1, Math.ceil(0.9 * n));
  let best = TWO_PI;
  for (let i = 0; i < n; i++) {
    const j = i + k - 1;
    const end = j < n ? d[j] : d[j - n] + TWO_PI;
    best = Math.min(best, end - d[i]);
  }
  return { clumpedFraction: clumped / n, arc90Deg: (best * 180) / Math.PI };
}

/** Orbital period of the main parent, s. */
export function parentPeriodS(cloud: BreakupCloud): number {
  const a = cloud.parentElements[0].semiMajorAxisM;
  return TWO_PI * Math.sqrt(a ** 3 / GM_EARTH);
}

/** Relative density (1 = today's densest shell) at which the shell glow saturates; BAU reaches ~20× in a century. */
export const GLOW_SATURATION_REL = 30;
/**
 * Overlay brightness level 0…1 for a shell's density relative to today's densest shell: logarithmic so that both today's
 * sparse shells and a 20× future stay readable, and bounded so the glow never becomes an opaque wash over Earth.
 */
export function shellGlowLevel(relDensity: number): number {
  if (!(relDensity > 0)) return 0;
  return Math.min(1, Math.log1p(relDensity) / Math.log1p(GLOW_SATURATION_REL));
}
