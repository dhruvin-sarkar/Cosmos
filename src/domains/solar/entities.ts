/**
 * Solar-domain entities (Sun, planets, dwarf planets) with IAU orientation helpers the camera rig uses
 * (northPole) and fact sheets built from public/data/solar/bodies.json.
 */
import * as THREE from 'three';
import type { Capability, Entity, EntityRegistry } from '../../core/entity';
import { AU_M, C_M_PER_S, LIGHT_MINUTE_M } from '../../core/units';
import { derived, observed, unknown, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { SOLAR_BODIES, type SolarBodyDef } from './constants';
import { bodyNorthPole, bodyOrientation, bodyPosition, bodyVelocity } from './ephemeris';

interface BodyRecord {
  id: string;
  name: string;
  radius?: { equatorialKm: number | null; polarKm: number | null; meanKm: number | null };
  massKg?: number | null;
  densityKgM3?: number | null;
  surfaceGravityMs2?: number | null;
  escapeVelocityKms?: number | null;
  rotation?: { siderealPeriodHours: number | null; model?: string; note?: string } | null;
  obliquityDeg?: number | null;
  albedo?: { geometric: number | null; bond: number | null } | null;
  temperature?: { meanK?: number | null; effectiveK?: number | null; note?: string } | null;
  luminosityW?: number | null;
  spectralType?: string | null;
  atmosphere?: { surfacePressureBar: number | null; composition: string | null } | null;
  orbit?: { model: string; epochJD: number; aAU: number; e: number; iDeg: number; periodDays?: number } | null;
  discovery?: { by: string; year: number } | null;
  summary?: string;
  sources?: Record<string, string>;
}

let bodiesPromise: Promise<Map<string, BodyRecord>> | null = null;

function loadBodies(): Promise<Map<string, BodyRecord>> {
  if (!bodiesPromise) {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    bodiesPromise = fetch(`${base}data/solar/bodies.json`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`bodies.json: HTTP ${r.status}`))))
      .then((j: { bodies: BodyRecord[] }) => new Map(j.bodies.map((b) => [b.id, b])))
      .catch((err) => {
        bodiesPromise = null;
        throw err;
      });
  }
  return bodiesPromise;
}

const EPHEMERIS_SRC: SourceRef = { datasetId: 'astronomy-engine', note: 'VSOP87 planetary theory / Pluto integration via astronomy-engine' };
const KEPLER_SRC: SourceRef = { datasetId: 'jpl-sbdb-notable-small-bodies', note: 'Two-body propagation of JPL SBDB osculating elements' };

const src = (rec: BodyRecord | undefined, group: string, fallback = 'jpl-ssd-planet-phys-par'): SourceRef => ({
  datasetId: rec?.sources?.[group] ?? fallback,
});

function sigFig(v: number, digits = 4): number {
  return Number(v.toPrecision(digits));
}

export interface SolarFactsContext {
  registry: EntityRegistry;
  nowMs(): number;
}

const scratchA = new THREE.Vector3();
const scratchB = new THREE.Vector3();

async function buildSheet(def: SolarBodyDef, fctx: SolarFactsContext): Promise<FactSheet> {
  let rec: BodyRecord | undefined;
  try {
    rec = (await loadBodies()).get(def.key);
  } catch {
    rec = undefined;
  }
  const props: Fact[] = [];
  const missing: string[] = [];
  const r = rec?.radius;
  const q = (key: string, label: string, value: number | null | undefined, unit: string, group: string, help?: string): void => {
    if (value === null || value === undefined) {
      missing.push(label);
      props.push({ key, label, quantity: unknown(unit, src(rec, group)), provenance: 'observed', help });
    } else {
      props.push({ key, label, quantity: observed(value, unit, src(rec, group)), provenance: 'observed', help });
    }
  };
  q('radius', 'Mean radius', r?.meanKm ?? def.meanRadiusM / 1000, 'km', 'radius');
  if (def.id === 'sol:haumea') {
    props.push({ key: 'shape', label: 'Shape (semi-axes)', text: '1161 × 852 × 513 km triaxial ellipsoid', provenance: 'observed', source: { datasetId: 'ortiz-2017-haumea', reference: 'Ortiz et al. 2017, Nature 550, 219' } });
  } else if (r?.polarKm && r.equatorialKm && r.polarKm !== r.equatorialKm) {
    q('radius-eq', 'Equatorial radius', r.equatorialKm, 'km', 'radius');
    q('radius-pol', 'Polar radius', r.polarKm, 'km', 'polarRadius');
  }
  q('mass', 'Mass', rec?.massKg, 'kg', 'mass');
  if (def.kind !== 'star') q('density', 'Mean density', rec?.densityKgM3 ? rec.densityKgM3 / 1000 : rec?.densityKgM3, 'g/cm3', 'mass');
  q('gravity', 'Surface gravity', rec?.surfaceGravityMs2, 'm/s2', 'mass', def.surface === 'giant' ? 'At the 1-bar cloud level (no solid surface).' : undefined);
  q('escape', 'Escape velocity', rec?.escapeVelocityKms, 'km/s', 'mass');
  const period = rec?.rotation?.siderealPeriodHours;
  if (period !== null && period !== undefined) {
    const days = Math.abs(period) >= 48;
    props.push({
      key: 'rotation', label: 'Sidereal day', provenance: 'observed', source: src(rec, 'rotation', 'naif-pck00011'),
      quantity: observed(sigFig(days ? Math.abs(period) / 24 : Math.abs(period), 5), days ? 'd' : 'h', src(rec, 'rotation', 'naif-pck00011')),
      help: period < 0 ? 'Retrograde: it spins backwards relative to its orbit.' : undefined,
    });
  } else missing.push('Rotation period');
  if (rec?.obliquityDeg !== undefined && rec?.obliquityDeg !== null) q('obliquity', 'Axial tilt', rec.obliquityDeg, 'deg', 'obliquity');
  if (def.kind !== 'star') {
    q('albedo', 'Geometric albedo', rec?.albedo?.geometric, '', 'albedo', 'Brightness at full phase relative to a white flat disc.');
    const tK = rec?.temperature?.meanK;
    q('temperature', 'Mean temperature', tK, 'K', 'temperature', rec?.temperature?.note);
    if (rec?.atmosphere?.composition) {
      props.push({ key: 'atmosphere', label: 'Atmosphere', text: rec.atmosphere.composition, provenance: 'observed', source: src(rec, 'atmosphere') });
    }
  } else {
    q('teff', 'Effective temperature', rec?.temperature?.effectiveK ?? 5772, 'K', 'temperature');
    q('luminosity', 'Luminosity', rec?.luminosityW ?? 3.828e26, 'W', 'luminosity');
    props.push({ key: 'spectral', label: 'Spectral type', text: rec?.spectralType ?? 'G2V', provenance: 'observed' });
  }

  // Orbit and live distances (derived at the current simulation time).
  const orbit: Fact[] = [];
  const now = fctx.nowMs();
  bodyPosition(def, now, scratchA);
  const earth = fctx.registry.get('sol:earth');
  if (def.id !== 'sol:sun') {
    const sun = SOLAR_BODIES[0];
    bodyPosition(sun, now, scratchB);
    orbit.push({
      key: 'sun-distance', label: 'Distance from the Sun now', provenance: 'derived',
      quantity: derived(sigFig(scratchA.distanceTo(scratchB) / AU_M, 5), 'AU', def.aeBody ? 'astronomy-engine@2' : 'kepler-two-body@1', def.aeBody ? EPHEMERIS_SRC : KEPLER_SRC),
    });
    if (rec?.orbit) {
      orbit.push({ key: 'a', label: 'Semi-major axis', quantity: observed(rec.orbit.aAU, 'AU', src(rec, 'orbit')), provenance: 'observed' });
      orbit.push({ key: 'e', label: 'Eccentricity', quantity: observed(rec.orbit.e, '', src(rec, 'orbit')), provenance: 'observed' });
      orbit.push({ key: 'i', label: 'Inclination to the ecliptic', quantity: observed(rec.orbit.iDeg, 'deg', src(rec, 'orbit')), provenance: 'observed' });
    }
    orbit.push({ key: 'period', label: 'Orbital period', quantity: derived(sigFig(def.periodDays / 365.25, 4), 'yr', 'kepler-third-law@1', src(rec, 'orbit', 'jpl-ssd-approx-pos')), provenance: 'derived' });
  }
  if (earth && def.id !== 'sol:earth') {
    earth.position(now, scratchB);
    const d = scratchA.distanceTo(scratchB);
    orbit.push({ key: 'earth-distance', label: 'Distance from Earth now', provenance: 'derived', quantity: derived(sigFig(d / AU_M, 5), 'AU', 'astronomy-engine@2', EPHEMERIS_SRC) });
    const lightMin = d / LIGHT_MINUTE_M;
    orbit.push({
      key: 'light-time', label: 'Light travel time from Earth', provenance: 'derived',
      quantity: lightMin < 120 ? derived(sigFig(lightMin, 3), 'min', 'light-time@1') : derived(sigFig(d / C_M_PER_S / 3600, 3), 'h', 'light-time@1'),
      help: 'What you see of this body left it this long ago.',
    });
  }

  const sources: SourceRef[] = [];
  const seen = new Set<string>();
  for (const id of Object.values(rec?.sources ?? {})) {
    if (id === 'editorial' || seen.has(id)) continue;
    seen.add(id);
    sources.push({ datasetId: id });
  }
  sources.push(def.aeBody ? EPHEMERIS_SRC : KEPLER_SRC);
  if (def.colorMap) sources.push({ datasetId: 'textures-sss-planets', note: def.appearanceNote });

  const sections = [
    { id: 'properties', title: 'Properties', facts: props },
    ...(orbit.length ? [{ id: 'orbit', title: 'Orbit and distance', facts: orbit }] : []),
  ];
  if (rec?.discovery) {
    sections.push({ id: 'overview', title: 'Discovery', facts: [{ key: 'discovery', label: 'Discovered', text: `${rec.discovery.year} by ${rec.discovery.by}`, provenance: 'observed' }] });
  }
  const assumptions = ['Positions and distances are computed for the current simulation time.'];
  if (def.rotation.illustrativePole) assumptions.push('No IAU pole orientation exists for this body; it is drawn spinning about the ecliptic pole (illustrative).');
  return {
    entityId: def.id,
    summary: rec?.summary ?? def.tagline,
    sections,
    representation: { provenance: def.appearance, description: def.appearanceNote },
    sources,
    epoch: rec?.orbit ? { label: 'Orbital elements epoch', jd: rec.orbit.epochJD } : undefined,
    missing: missing.length ? missing : undefined,
    assumptions,
  };
}

const CAPS: Capability[] = ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'compare', 'bookmark', 'sources'];

export type SolarEntity = Entity & {
  northPole(tMs: number, out: THREE.Vector3): THREE.Vector3;
  /**
   * Camera arrival hint (duck-typed like northPole): unit ICRS vector from the body toward the side worth seeing
   * (Pluto: the New Horizons encounter hemisphere centred on Tombaugh Regio), or null for no preference.
   */
  preferredViewDir(tMs: number, out: THREE.Vector3): THREE.Vector3 | null;
  def: SolarBodyDef;
};

const viewQ = new THREE.Quaternion();
/** Body-fixed unit vector of the best-imaged hemisphere's centre, in ICRS at tMs (null when the body has none). */
function hemisphereDir(def: SolarBodyDef, tMs: number, out: THREE.Vector3): THREE.Vector3 | null {
  const cap = def.resolutionCap;
  if (!cap) return null;
  const lon = (cap.lonDeg * Math.PI) / 180;
  const lat = (cap.latDeg * Math.PI) / 180;
  out.set(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  return out.applyQuaternion(bodyOrientation(def.rotation, tMs, viewQ));
}

export function createSolarEntities(fctx: SolarFactsContext): SolarEntity[] {
  return SOLAR_BODIES.map((def): SolarEntity => {
    const a = def.axesM[0];
    const isSun = def.kind === 'star';
    return {
      id: def.id,
      name: def.name,
      aliases: def.aliases,
      kind: def.kind,
      domain: 'solar',
      parentId: isSun ? 'mw:galaxy' : 'sol:sun',
      // Equatorial (largest) semi-axis so framing and the camera's surface clamp never cut into an oblate body.
      radiusM: a,
      position: (tMs, out) => bodyPosition(def, tMs, out),
      velocity: (tMs, out) => bodyVelocity(def, tMs, out),
      northPole: (tMs, out) => bodyNorthPole(def.rotation, tMs, out),
      preferredViewDir: (tMs, out) => hemisphereDir(def, tMs, out),
      ...(def.rings ? { framingRadiusM: Math.max(...def.rings.map((r) => r.outerM)) } : {}),
      viewDistance: { min: a * (isSun ? 1.15 : 1.08), default: a * (isSun ? 4.5 : def.rings ? 6.5 : 3.4) },
      tagline: def.tagline,
      capabilities: isSun ? CAPS.filter((c) => c !== 'show-orbit') : CAPS,
      importance: def.importance,
      representation: def.appearance,
      facts: () => buildSheet(def, fctx),
      def,
    };
  });
}
