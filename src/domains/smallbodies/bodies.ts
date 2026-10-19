/**
 * Entities for the named small bodies (sb:<id>): heliocentric two-body position on top of the Sun's registry position,
 * physical model (triaxial semi-axes, shape recipe, surface class) for the renderer, and FactSheets with provenance.
 * Dimorphos orbits Didymos using the measured pre/post-DART periods (phase and orbit-plane orientation illustrative).
 */
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { derived, observed, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { AU_M, DEG, GM_SUN } from '../../core/units';
import { eclipticToIcrs } from '../../core/frames';
import {
  EDITORIAL, ORBIT_CLASS_NAMES, SB_KIND_TO_ENTITY, SB_RECORDS, SB_RETRIEVED, type Editorial, type SbRecord, type ShapeRecipe, type SurfaceClass,
} from './catalog';
import { aphelionAU, heliocentricIcrsM, heliocentricVelocityIcrs, jdTdbFromMs, perihelionAU, periodDays, type HelioElements } from './orbits';
import { loadCloseApproaches, loadSentry, normalizeDesignation } from './neoApi';
import { sunSource, type PositionFn } from './sources';

export const SB_ENTITY_PREFIX = 'sb:';
export const sbEntityId = (id: string): string => `${SB_ENTITY_PREFIX}${id}`;

export interface SmallBodyModel {
  id: string;
  entityId: string;
  record: SbRecord;
  editorial: Editorial;
  /** Semi-axes in metres [a (long), b, c (short)]. */
  axesM: [number, number, number];
  meanRadiusM: number;
  /** True when the size comes from H and a fixed albedo rather than a measurement. */
  sizeFromH: boolean;
  recipe: ShapeRecipe;
  surface: SurfaceClass;
  isComet: boolean;
  isInterstellar: boolean;
  /** Rotation period in hours, or null. */
  spinPeriodH: number | null;
  elements: HelioElements | null;
  activity: number;
}

export const SRC_SBDB: SourceRef = { datasetId: 'jpl-sbdb-notable-small-bodies', note: 'JPL SBDB API, osculating elements retrieved with full-prec=1' };
const SRC_CAD: SourceRef = { datasetId: 'cneos-cad-close-approaches' };
const SRC_SENTRY: SourceRef = { datasetId: 'cneos-sentry' };

/** Diameter (km) estimated from absolute magnitude with the albedo fixed at 0.14 (Harris & Lagerros 2002; factor ≈ 2). */
export function diameterFromHKm(H: number, albedo = 0.14): number {
  return (1329 / Math.sqrt(albedo)) * Math.pow(10, -H / 5);
}

function parseExtentKm(s: string | null): number[] | null {
  if (!s) return null;
  const nums = s.split(/x/i).map((v) => Number(v.trim()));
  return nums.length >= 2 && nums.every((v) => Number.isFinite(v) && v > 0) ? nums : null;
}

function buildModel(rec: SbRecord): SmallBodyModel | null {
  const ed = EDITORIAL[rec.id];
  if (!ed) return null;
  let axesKm: [number, number, number] | null = ed.axesKm ?? null;
  let sizeFromH = false;
  if (!axesKm) {
    const ext = parseExtentKm(rec.extentKm);
    if (ext) {
      const [x, y, z] = ext;
      axesKm = [x / 2, y / 2, (z ?? y) / 2];
    }
  }
  if (!axesKm) {
    let d = rec.diameterKm;
    if (d === null && rec.H !== null) {
      d = diameterFromHKm(rec.H, rec.albedo ?? 0.14);
      sizeFromH = true;
    }
    const r = (d ?? 1) / 2;
    // A published diameter on a non-spherical recipe: keep the volume-equivalent radius, add an illustrative aspect.
    const f: [number, number, number] =
      ed.shape === 'peanut' ? [1.3, 0.86, 0.78] : ed.shape === 'shard' ? [1.25, 0.9, 0.75] : ed.shape === 'elongated' ? [1.6, 0.8, 0.8] : [1, 1, 1];
    const norm = Math.cbrt(f[0] * f[1] * f[2]);
    axesKm = [(r * f[0]) / norm, (r * f[1]) / norm, (r * f[2]) / norm];
  }
  const axesM: [number, number, number] = [axesKm[0] * 1000, axesKm[1] * 1000, axesKm[2] * 1000];
  // Order so axes[0] ≥ axes[1] ≥ axes[2].
  axesM.sort((a, b) => b - a);
  const mean = Math.cbrt(axesM[0] * axesM[1] * axesM[2]);
  const isComet = rec.kind === 'comet' || rec.id === 'borisov' || rec.id === '3i-atlas';
  return {
    id: rec.id, entityId: sbEntityId(rec.id), record: rec, editorial: ed, axesM, meanRadiusM: mean, sizeFromH,
    recipe: ed.shape, surface: ed.surface, isComet, isInterstellar: rec.kind === 'interstellar',
    spinPeriodH: rec.rotationPeriodH, elements: rec.elements, activity: ed.activity ?? 0,
  };
}

export const SMALL_BODY_MODELS: SmallBodyModel[] = SB_RECORDS.map(buildModel).filter((m): m is SmallBodyModel => m !== null);
export const MODEL_BY_ENTITY_ID = new Map(SMALL_BODY_MODELS.map((m) => [m.entityId, m]));

// ── Dimorphos around Didymos ─────────────────────────────────────────────────────────────────────────────────────

const DART_IMPACT_MS = Date.UTC(2022, 8, 26, 23, 14, 24);
const DIDYMOS_POLE_ECL_LON = 310 * DEG; // approximate spin pole (retrograde), Naidu et al. 2020; orbit assumed equatorial
const DIDYMOS_POLE_ECL_LAT = -84 * DEG;
const poleIcrs = eclipticToIcrs(
  { x: Math.cos(DIDYMOS_POLE_ECL_LAT) * Math.cos(DIDYMOS_POLE_ECL_LON), y: Math.cos(DIDYMOS_POLE_ECL_LAT) * Math.sin(DIDYMOS_POLE_ECL_LON), z: Math.sin(DIDYMOS_POLE_ECL_LAT) },
  new Vector3(),
).normalize();
const orbU = new Vector3().crossVectors(poleIcrs, new Vector3(0, 0, 1)).normalize();
const orbV = new Vector3().crossVectors(poleIcrs, orbU).normalize();

/** Dimorphos position relative to Didymos (m, ICRS) at Unix-ms `tMs`. Pre/post-impact periods are the measured ones. */
export function dimorphosOffsetM(tMs: number, aKm: number, preH: number, postH: number, out: Vector3): Vector3 {
  const periodMs = (tMs < DART_IMPACT_MS ? preH : postH) * 3.6e6;
  const theta = (2 * Math.PI * (tMs - DART_IMPACT_MS)) / periodMs;
  const c = Math.cos(theta) * aKm * 1000, s = Math.sin(theta) * aKm * 1000;
  return out.set(orbU.x * c + orbV.x * s, orbU.y * c + orbV.y * s, orbU.z * c + orbV.z * s);
}

// ── Fact sheets ──────────────────────────────────────────────────────────────────────────────────────────────────

export const obs = (key: string, label: string, v: number | null, unit: string, help?: string, src: SourceRef = SRC_SBDB, sigma?: number | null): Fact => ({
  key, label, provenance: 'observed', help,
  quantity: observed(v, unit, src, sigma !== null && sigma !== undefined && sigma > 0 ? { kind: 'symmetric', sigma } : undefined),
});
export const der = (key: string, label: string, v: number | null, unit: string, model: string, help?: string): Fact => ({
  key, label, provenance: 'derived', help, quantity: derived(v, unit, model, SRC_SBDB),
});

function elementFacts(m: SmallBodyModel): Fact[] {
  const el = m.elements!;
  const facts: Fact[] = [
    { key: 'class', label: 'Orbit class', text: ORBIT_CLASS_NAMES[m.record.orbitClass ?? ''] ?? m.record.orbitClass ?? 'Unknown', provenance: 'observed', source: SRC_SBDB },
    obs('a', 'Semi-major axis', el.aAU, 'AU', el.aAU < 0 ? 'Negative: the orbit is a hyperbola (unbound).' : undefined),
    obs('e', 'Eccentricity', el.e, '', el.e >= 1 ? 'e > 1: unbound hyperbolic orbit — the object came from, and returns to, interstellar space.' : undefined),
    obs('i', 'Inclination to the ecliptic', el.iDeg, 'deg'),
    obs('q', 'Perihelion distance', perihelionAU(el.aAU, el.e), 'AU'),
  ];
  const Q = aphelionAU(el.aAU, el.e);
  if (Q !== null) facts.push(obs('Q', 'Aphelion distance', Q, 'AU'));
  const P = periodDays(el.aAU, el.e);
  facts.push(P !== null ? der('period', 'Orbital period', P / 365.25, 'yr', 'kepler-third-law@1', 'From the semi-major axis and the Sun\'s GM.') : { key: 'period', label: 'Orbital period', text: 'Not periodic (hyperbolic)', provenance: 'derived' });
  if (m.record.moidAU !== null) facts.push(obs('moid', 'Closest approach to Earth\'s orbit (MOID)', m.record.moidAU, 'AU', 'Minimum orbit intersection distance: how close the two orbits come, not how close the bodies get.'));
  return facts;
}

function physicalFacts(m: SmallBodyModel): { facts: Fact[]; missing: string[] } {
  const r = m.record;
  const facts: Fact[] = [];
  const missing: string[] = [];
  if (r.diameterKm !== null) facts.push(obs('diameter', 'Diameter', r.diameterKm, 'km', undefined, SRC_SBDB, r.diameterSigmaKm));
  else if (m.sizeFromH && r.H !== null) facts.push(der('diameter', 'Diameter (estimated)', diameterFromHKm(r.H, r.albedo ?? 0.14), 'km', 'h-albedo-diameter@1', 'Estimated from the absolute magnitude H with an assumed albedo of 0.14; uncertain by about a factor of two.'));
  else missing.push('Diameter');
  if (r.extentKm) facts.push({ key: 'extent', label: 'Dimensions', text: `${r.extentKm} km`, provenance: 'observed', source: SRC_SBDB });
  if (r.H !== null) facts.push(obs('H', 'Absolute magnitude (H)', r.H, 'mag', 'Brightness at 1 au from Sun and observer at zero phase.'));
  if (r.albedo !== null) facts.push(obs('albedo', 'Geometric albedo', r.albedo, ''));
  else missing.push('Albedo');
  if (r.rotationPeriodH !== null) facts.push(obs('rotation', 'Rotation period', r.rotationPeriodH, 'h'));
  else missing.push('Rotation period');
  if (r.spectralType) facts.push({ key: 'spectral', label: 'Spectral type', text: r.spectralType, provenance: 'observed', source: SRC_SBDB });
  if (r.gmKm3s2 !== null) facts.push(obs('gm', 'Gravitational parameter GM', r.gmKm3s2, 'km3/s2'));
  return { facts, missing };
}

function binaryFacts(rec: SbRecord): Fact[] {
  const out: Fact[] = [];
  if (rec.binaryOrbit) {
    const b = rec.binaryOrbit;
    out.push(obs('sep', 'Orbit radius around Didymos', b.semiMajorAxisKm, 'km', undefined, { datasetId: 'jpl-sbdb-notable-small-bodies', reference: 'Daly et al. 2023, Nature 616:443' }));
    out.push(obs('p-pre', 'Orbital period before DART', b.periodPreImpactH, 'h'));
    out.push(obs('p-post', 'Orbital period after DART', b.periodPostImpactH, 'h'));
    out.push({
      key: 'dp', label: 'Period change', provenance: 'observed', help: b.periodChangeRef,
      quantity: observed(b.periodChangeMin, 'min', { datasetId: 'jpl-sbdb-notable-small-bodies', reference: b.periodChangeRef }, { kind: 'symmetric', sigma: b.periodChangeSigmaMin3 / 3 }),
    });
  }
  if (rec.dart) {
    const d = rec.dart;
    out.push(obs('dart-mass', 'DART mass at impact', d.massAtImpactKg, 'kg', undefined, { datasetId: 'jpl-sbdb-notable-small-bodies', reference: d.ref }));
    out.push(obs('dart-v', 'DART impact speed', d.impactSpeedKms, 'km/s', undefined, { datasetId: 'jpl-sbdb-notable-small-bodies', reference: d.ref }));
    out.push({
      key: 'beta', label: 'Momentum enhancement β', provenance: 'derived', help: `β = ${d.beta} (+${d.betaSigmaPlus}/−${d.betaSigmaMinus}) for an assumed density of ${d.betaAssumedDensityKgM3} kg/m³; ${d.betaRange[0]}–${d.betaRange[1]} over plausible densities.`,
      quantity: derived(d.beta, '', 'cheng-2023-beta@1', { datasetId: 'jpl-sbdb-notable-small-bodies', reference: d.betaRef }, { kind: 'asymmetric', plus: d.betaSigmaPlus, minus: d.betaSigmaMinus }),
    });
  }
  return out;
}

const dateOf = (jd: number): string => new Date((jd - 2440587.5) * 86400000).toISOString().slice(0, 10);

async function observationFacts(m: SmallBodyModel): Promise<{ facts: Fact[]; paragraphs: string[]; sources: SourceRef[] }> {
  const facts: Fact[] = [];
  const d = m.record.discovery;
  if (d && (d.by || d.date)) facts.push({ key: 'discovery', label: 'Discovery', text: [d.date, d.by, d.site].filter(Boolean).join(' · '), provenance: 'observed', source: SRC_SBDB });
  if (m.record.dataArcDays !== null) facts.push(obs('arc', 'Observation arc', m.record.dataArcDays / 365.25, 'yr', 'The longer the observed arc, the better the orbit is known.'));
  const tables = await tableFacts(m.record.designation, m.record.neo);
  return { facts: [...facts, ...tables.facts], paragraphs: tables.paragraphs, sources: tables.sources };
}

/** Earth close approaches (CAD) and Sentry risk entry for a designation, as facts. Shared with the NEO provider. */
export async function tableFacts(designation: string, isNeo: boolean): Promise<{ facts: Fact[]; paragraphs: string[]; sources: SourceRef[] }> {
  const des = normalizeDesignation(designation);
  const facts: Fact[] = [];
  const paragraphs: string[] = [];
  const sources: SourceRef[] = [];
  try {
    const [cad, sentry] = await Promise.all([loadCloseApproaches(), loadSentry()]);
    const mine = cad.filter((c) => normalizeDesignation(c.designation) === des);
    if (mine.length) {
      sources.push(SRC_CAD);
      for (const c of mine.slice(0, 3)) {
        facts.push({
          key: `cad-${c.jdTDB.toFixed(0)}`, label: `Earth approach ${dateOf(c.jdTDB)}`, provenance: 'observed', source: SRC_CAD,
          text: `${(c.distAU * 149597870.7).toLocaleString('en-US', { maximumFractionDigits: 0 })} km from Earth\'s centre (${c.distAU.toFixed(5)} au), ${c.vRelKms.toFixed(2)} km/s`,
          help: `Nominal CAD value; 3σ range ${((c.distMinAU ?? c.distAU) * 149597870.7).toLocaleString('en-US', { maximumFractionDigits: 0 })}–${((c.distMaxAU ?? c.distAU) * 149597870.7).toLocaleString('en-US', { maximumFractionDigits: 0 })} km.`,
        });
      }
    }
    const s = sentry.find((x) => normalizeDesignation(x.designation) === des);
    if (s) {
      sources.push(SRC_SENTRY);
      facts.push({
        key: 'sentry', label: 'Sentry impact risk', provenance: 'observed', source: SRC_SENTRY,
        text: `${(s.ipCumulative * 100).toPrecision(2)} % cumulative over ${s.nImp} virtual impactors (${s.yearMin ?? '?'}–${s.yearMax ?? '?'}); Torino ${s.tsMax ?? 0}`,
        help: 'NASA/JPL Sentry list. Probabilities change as new observations arrive and often fall to zero.',
      });
    } else if (isNeo) {
      paragraphs.push('Not on the NASA/JPL Sentry risk list (no impact solutions found) as of the snapshot.');
    }
  } catch {
    paragraphs.push('Close-approach and Sentry tables could not be loaded.');
  }
  return { facts, paragraphs, sources };
}

function cometTailNote(m: SmallBodyModel): string {
  return 'Comet appearance (illustrative): the ion tail points directly away from the Sun; the dust tail curves behind the comet along its orbit. Lengths scale with a heuristic activity ∝ r⁻² inside 3 au (fading to nothing beyond ~4 au) times a per-comet size factor — physically oriented, not a simulation of the coma.';
}

function buildFactSheet(m: SmallBodyModel): FactSheet {
  const ed = m.editorial;
  const rec = m.record;
  const phys = physicalFacts(m);
  const sections = [
    { id: 'properties', title: 'Properties', facts: phys.facts },
    ...(m.elements ? [{ id: 'orbit', title: 'Orbit', facts: elementFacts(m), paragraphs: ['Two-body (Keplerian) propagation of osculating elements; planetary perturbations are not modelled, so positions drift with distance in time from the element epoch.'] }] : []),
  ];
  const paragraphs = [...ed.paragraphs];
  if (m.isComet) paragraphs.push(cometTailNote(m));
  if (rec.id === 'dimorphos') {
    sections.push({ id: 'science', title: 'DART and the orbit change', facts: binaryFacts(rec) });
    sections.shift();
    sections.unshift({ id: 'properties', title: 'Properties', facts: [...phys.facts, { key: 'size', label: 'Dimensions', text: '≈ 177 × 174 × 116 m', provenance: 'observed', source: { datasetId: 'jpl-sbdb-notable-small-bodies', reference: 'Daly et al. 2023' } }] });
  } else if (rec.id === 'didymos' && rec.dart) {
    sections.push({ id: 'science', title: 'DART', facts: [] });
  }
  const sheet: FactSheet = {
    entityId: m.entityId,
    summary: ed.summary,
    sections: sections.map((s) => ({ ...s, paragraphs: 'paragraphs' in s ? (s as { paragraphs?: string[] }).paragraphs : undefined })),
    representation: {
      provenance: 'illustrative',
      description: m.isComet
        ? `Illustrative nucleus (${m.recipe} shape from published dimensions) with a procedural surface and physically oriented tails. Not an image of ${ed.name}.`
        : `Triaxial model from ${m.editorial.axesPublished || rec.extentKm ? 'published dimensions' : 'a diameter estimate'} with procedurally generated relief. Not a shape model of ${ed.name}.`,
    },
    sources: [SRC_SBDB, { datasetId: 'jpl-sbdb-notable-small-bodies', note: `snapshot ${SB_RETRIEVED}` }],
    epoch: m.elements ? { label: 'Osculating elements', jd: m.elements.epochJD, iso: dateOf(m.elements.epochJD) } : undefined,
    missing: phys.missing.length ? phys.missing : undefined,
    assumptions: [
      'Orbit: two-body propagation from the osculating epoch (no planetary perturbations).',
      m.sizeFromH ? 'Size: from H with an assumed albedo of 0.14.' : 'Shape: ellipsoid-based recipe, illustrative.',
      ...(rec.id === 'dimorphos' ? ['Orbital phase and orbit-plane orientation are illustrative; the pre/post-DART periods are measured.'] : []),
    ],
  };
  for (const r of ed.refs) sheet.sources.push({ datasetId: 'literature', reference: r.label, note: r.note });
  if (paragraphs.length) sheet.sections.push({ id: 'overview', title: 'About', facts: [], paragraphs });
  return sheet;
}

export function createSmallBodyEntities(registry: Pick<EntityRegistry, 'get'>): { entities: Entity[]; models: SmallBodyModel[] } {
  const sun = sunSource(registry);
  const helio = new Vector3();
  const sunScratch = new Vector3();
  const byId = new Map<string, Entity>();
  const entities: Entity[] = [];

  const absolute = (el: HelioElements, sunFn: PositionFn): PositionFn => (tMs, out) => {
    heliocentricIcrsM(el, jdTdbFromMs(tMs), helio);
    return sunFn(tMs, out).add(helio);
  };

  for (const m of SMALL_BODY_MODELS) {
    const ed = m.editorial;
    const isMoon = m.id === 'dimorphos';
    const bin = m.record.binaryOrbit;
    let position: PositionFn;
    if (isMoon && bin) {
      position = (tMs, out) => {
        byId.get('sb:didymos')!.position(tMs, out);
        return out.add(dimorphosOffsetM(tMs, bin.semiMajorAxisKm, bin.periodPreImpactH, bin.periodPostImpactH, sunScratch));
      };
    } else {
      position = absolute(m.elements!, sun);
    }
    const velocity = m.elements && !isMoon
      ? (tMs: number, out: Vector3): Vector3 => heliocentricVelocityIcrs(m.elements!, jdTdbFromMs(tMs), out)
      : undefined;
    const minView = m.meanRadiusM * 2.6;
    const entity: Entity = {
      id: m.entityId,
      name: ed.name,
      aliases: ed.aliases,
      kind: SB_KIND_TO_ENTITY[m.record.kind],
      domain: 'solar',
      parentId: isMoon ? 'sb:didymos' : 'sol:sun',
      radiusM: m.meanRadiusM,
      position,
      velocity,
      viewDistance: { min: minView, default: ed.viewDistanceM ?? Math.max(m.meanRadiusM * 4.2, minView * 1.2) },
      tagline: ed.tagline,
      capabilities: ['focus', 'orbit', 'travel', 'follow', ...(isMoon ? [] : (['show-orbit'] as const)), 'sources',
        ...((['apophis', 'didymos', 'dimorphos', '2024-yr4'].includes(m.id) ? ['experiment:defense'] : []) as ('experiment:defense')[])],
      importance: ed.importance,
      representation: 'illustrative',
      facts: async () => {
        const sheet = buildFactSheet(m);
        const o = await observationFacts(m);
        if (o.facts.length || o.paragraphs.length) sheet.sections.push({ id: 'observations', title: 'Observations', facts: o.facts, paragraphs: o.paragraphs.length ? o.paragraphs : undefined });
        for (const s of o.sources) sheet.sources.push(s);
        return sheet;
      },
    };
    byId.set(entity.id, entity);
    entities.push(entity);
  }
  return { entities, models: SMALL_BODY_MODELS };
}

/** Heliocentric distance of the Sun-centred two-body position, au (helper for the comet activity heuristic). */
export function sunDistanceAuOf(positionM: Vector3, sunM: Vector3): number {
  return positionM.distanceTo(sunM) / AU_M;
}

export { GM_SUN };
