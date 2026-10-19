/**
 * Earth and Moon entities with fact sheets built from public/data/solar/bodies.json (JPL SSD / NAIF / NSSDCA,
 * see docs/data/solar.md) plus live, derived geometry (sub-solar point, Moon phase, distances).
 */
import type { Vector3 } from 'three';
import type { Entity } from '../../core/entity';
import { derived, observed, unknown, type Fact, type FactSheet, type SourceRef } from '../../data/provenance';
import { AU_M } from '../../core/units';
import {
  earthNorthPole, earthPosition, earthVelocity, evaluate, moonNorthPole, moonPhase, moonPosition, moonVelocity,
  subEarthPointOnMoon, sublunarPoint, subsolarPoint,
} from './ephemeris';

export const R_EARTH_M = 6_371_008.4;
export const R_MOON_M = 1_737_400;

const EPHEMERIS: SourceRef = { datasetId: 'astronomy-engine', note: 'astronomy-engine 2.x: VSOP87 (Earth), ELP/MPP02 truncated (Moon), IAU 2000B nutation' };
const src = (id: string | undefined): SourceRef | undefined => (id && id !== 'editorial' ? { datasetId: id.split('+')[0] } : undefined);

/** Bond albedo when bodies.json has none: NASA NSSDCA Planetary / Moon Fact Sheets (D. R. Williams). */
const BOND_FALLBACK: Record<string, number> = { earth: 0.306, moon: 0.11 };
const NSSDC_FACT_SHEET: SourceRef = { datasetId: 'nssdca-planetary-fact-sheets', reference: 'Williams, D. R., NASA NSSDCA Planetary Fact Sheet (nssdc.gsfc.nasa.gov/planetary/factsheet)' };

interface BodyRecord {
  id: string;
  name: string;
  summary?: string;
  radius?: { equatorialKm?: number | null; polarKm?: number | null; meanKm?: number | null };
  massKg?: number | null;
  densityKgM3?: number | null;
  surfaceGravityMs2?: number | null;
  escapeVelocityKms?: number | null;
  rotation?: { siderealPeriodHours?: number | null; model?: string } | null;
  obliquityDeg?: number | null;
  albedo?: { geometric?: number | null; bond?: number | null } | null;
  temperature?: { meanK?: number | null; minK?: number | null; maxK?: number | null } | null;
  atmosphere?: { surfacePressureBar?: number | null; composition?: string | null } | null;
  orbit?: { aAU?: number; e?: number; iDeg?: number; aKm?: number; periodDays?: number; model?: string } | null;
  sources?: Record<string, string>;
}

let bodiesPromise: Promise<Map<string, BodyRecord>> | null = null;
function loadBodies(): Promise<Map<string, BodyRecord>> {
  if (!bodiesPromise) {
    const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
    bodiesPromise = fetch(`${base}data/solar/bodies.json`)
      .then(r => (r.ok ? (r.json() as Promise<{ bodies: BodyRecord[] }>) : { bodies: [] }))
      .then(j => new Map(j.bodies.map(b => [b.id, b])))
      .catch(() => new Map());
  }
  return bodiesPromise;
}

const q = (v: number | null | undefined, unit: string, s?: SourceRef) => (v === null || v === undefined ? unknown(unit, s) : observed(v, unit, s));

function physicalFacts(b: BodyRecord | undefined): Fact[] {
  const s = b?.sources ?? {};
  const facts: Fact[] = [
    { key: 'radius', label: 'Mean radius', quantity: q(b?.radius?.meanKm, 'km', src(s.radius)), provenance: 'observed' },
    { key: 'radius-eq', label: 'Equatorial radius', quantity: q(b?.radius?.equatorialKm, 'km', src(s.radius)), provenance: 'observed' },
    { key: 'radius-pol', label: 'Polar radius', quantity: q(b?.radius?.polarKm, 'km', src(s.polarRadius ?? s.radius)), provenance: 'observed' },
    { key: 'mass', label: 'Mass', quantity: q(b?.massKg, 'kg', src(s.mass)), provenance: s.mass === 'derived-from-gm' ? 'derived' : 'observed' },
    { key: 'density', label: 'Mean density', quantity: q(b?.densityKgM3 != null ? b.densityKgM3 / 1000 : null, 'g/cm3', src(s.density ?? s.radius)), provenance: 'observed' },
    { key: 'gravity', label: 'Surface gravity', quantity: q(b?.surfaceGravityMs2, 'm/s2', src(s.gm)), provenance: 'derived', help: 'GM / R², non-rotating.' },
    { key: 'escape', label: 'Escape velocity', quantity: q(b?.escapeVelocityKms, 'km/s', src(s.gm)), provenance: 'derived' },
    { key: 'rotation', label: 'Sidereal rotation period', quantity: q(b?.rotation?.siderealPeriodHours, 'h', src(s.rotation)), provenance: 'observed' },
    { key: 'albedo-geo', label: 'Geometric albedo', quantity: q(b?.albedo?.geometric, '', src(s.albedo)), provenance: 'observed' },
    b?.albedo?.bond != null || !b || !BOND_FALLBACK[b.id]
      ? { key: 'albedo-bond', label: 'Bond albedo', quantity: q(b?.albedo?.bond, '', src(s.albedo)), provenance: 'observed' }
      : { key: 'albedo-bond', label: 'Bond albedo', quantity: observed(BOND_FALLBACK[b.id]!, '', NSSDC_FACT_SHEET), provenance: 'observed' },
  ];
  if (b?.temperature?.meanK != null) facts.push({ key: 'tmean', label: 'Mean surface temperature', quantity: observed(b.temperature.meanK, 'K', src(s.temperature)), provenance: 'observed' });
  if (b?.temperature?.minK != null) facts.push({ key: 'tmin', label: 'Minimum surface temperature', quantity: observed(b.temperature.minK, 'K', src(s.temperature)), provenance: 'observed' });
  if (b?.temperature?.maxK != null) facts.push({ key: 'tmax', label: 'Maximum surface temperature', quantity: observed(b.temperature.maxK, 'K', src(s.temperature)), provenance: 'observed' });
  if (b?.atmosphere) {
    facts.push({ key: 'pressure', label: 'Surface pressure', quantity: q(b.atmosphere.surfacePressureBar, 'bar', src(s.atmosphere)), provenance: 'observed' });
    if (b.atmosphere.composition) facts.push({ key: 'atm', label: 'Atmosphere', text: b.atmosphere.composition, provenance: 'observed', source: src(s.atmosphere) });
  }
  return facts;
}

const fmtLat = (d: number) => `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'N' : 'S'}`;
const fmtLon = (d: number) => `${Math.abs(d).toFixed(1)}° ${d >= 0 ? 'E' : 'W'}`;

function nowTimeMs(): number {
  return Date.now();
}

async function earthSheet(timeMs: () => number): Promise<FactSheet> {
  const bodies = await loadBodies();
  const b = bodies.get('earth');
  const t = timeMs();
  const s = evaluate(t);
  const sunDistM = s.sun.distanceTo(s.earth);
  const moonDistM = s.moon.distanceTo(s.earth);
  const ss = subsolarPoint(t);
  const sl = sublunarPoint(t);
  const ph = moonPhase(t);
  const iso = new Date(t).toISOString().replace('.000Z', 'Z');
  const o = b?.orbit;
  const os = src(b?.sources?.orbit);
  return {
    entityId: 'sol:earth',
    summary: b?.summary ?? 'Earth is the third planet from the Sun and the only world known to host life.',
    sections: [
      { id: 'properties', title: 'Physical properties', facts: physicalFacts(b) },
      {
        id: 'orbit',
        title: 'Orbit',
        facts: [
          { key: 'a', label: 'Semi-major axis', quantity: o?.aAU != null ? observed(o.aAU, 'AU', os) : unknown('AU', os), provenance: 'observed', help: 'Earth–Moon barycentre, JPL approximate elements (J2000).' },
          { key: 'e', label: 'Eccentricity', quantity: o?.e != null ? observed(o.e, '', os) : unknown('', os), provenance: 'observed' },
          { key: 'year', label: 'Sidereal year', quantity: observed(365.256363, 'd', os), provenance: 'observed' },
          { key: 'obliquity', label: 'Axial tilt', quantity: observed(23.4393, 'deg', { datasetId: 'iau-2006-precession', note: 'Mean obliquity of the ecliptic at J2000 (IAU 2006)' }), provenance: 'observed' },
        ],
      },
      {
        id: 'science',
        title: `Right now (${iso})`,
        paragraphs: [
          `The Sun is overhead at ${fmtLat(ss.latDeg)}, ${fmtLon(ss.lonDeg)}: local noon there; the day side is the hemisphere centred on that point and the terminator runs 90° from it.`,
          dayNightLine(ss.latDeg, ss.lonDeg),
          `The Moon is overhead at ${fmtLat(sl.latDeg)}, ${fmtLon(sl.lonDeg)}; it is ${(ph.illuminatedFraction * 100).toFixed(0)} % illuminated as seen from Earth.`,
        ],
        facts: [
          { key: 'subsolar-lat', label: 'Sub-solar latitude', quantity: derived(ss.latDeg, 'deg', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived', help: 'Where the Sun is directly overhead (planetocentric).' },
          { key: 'subsolar-lon', label: 'Sub-solar longitude', quantity: derived(ss.lonDeg, 'deg', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived', help: 'East-positive.' },
          { key: 'sun-dist', label: 'Distance to the Sun', quantity: derived(sunDistM / AU_M, 'AU', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived' },
          { key: 'moon-dist', label: 'Distance to the Moon', quantity: derived(moonDistM / 1000, 'km', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived', help: 'Centre to centre.' },
          { key: 'light-time', label: 'Sunlight travel time', quantity: derived(sunDistM / 299_792_458 / 60, 'min', 'light-time@1', EPHEMERIS), provenance: 'derived' },
        ],
      },
    ],
    representation: {
      provenance: 'observed',
      description:
        'Surface: NASA Blue Marble Next Generation (MODIS, December 2004 composite). Night lights: NASA/NOAA VIIRS Black Marble 2016 (derived, relative brightness only). ' +
        'Relief: NOAA ETOPO 2022 normals, slopes exaggerated ×3. Clouds: a static illustrative composite (Solar System Scope, CC BY 4.0), not today’s weather; ' +
        'it drifts slowly with climatological zonal-mean winds (trade easterlies, mid-latitude westerlies) — real weather is not modelled. ' +
        'Aurora: illustrative auroral ovals around the geomagnetic poles (IGRF-14 dipole), driven by the observed Kp index of NASA CCMC DONKI geomagnetic storms ' +
        '(quiet Kp ≈ 2 between storms); curtain shapes are procedural and brightened for display, like Earthshine. ' +
        'Atmosphere: physically based single-scattering model (Rayleigh + Mie), so the blue limb and red terminator are computed, not painted. ' +
        'Orientation, day/night and Moon shadows follow the simulation time. The haze strength and ocean colour are calibrated against DSCOVR EPIC photographs ' +
        'taken from the same direction; below ~3000 km altitude, fine cloud and terrain texture beyond the maps’ ~10 km resolution is procedural (illustrative).',
    },
    sources: [
      { datasetId: 'jpl-ssd-planet-phys-par' }, { datasetId: 'naif-pck00011' }, { datasetId: 'jpl-ssd-approx-pos' },
      { datasetId: 'nssdca-planetary-fact-sheets' }, { datasetId: 'textures-earth-blue-marble-ng' },
      { datasetId: 'textures-earth-black-marble-2016' }, { datasetId: 'textures-earth-etopo2022' },
      { datasetId: 'textures-earth-clouds-sss' },
      { datasetId: 'nasa-donki-space-weather', note: 'Geomagnetic storms (Kp) driving the illustrative aurora (public/data/solar/space-weather.json)' },
      { datasetId: 'textures-earth-epic', note: 'DSCOVR EPIC natural-colour frames used as the colour/haze calibration reference' }, EPHEMERIS,
    ],
    epoch: { label: 'Simulation time', iso },
    assumptions: [
      'Sub-solar point and distances: astronomy-engine geometric ephemeris (≈1′), Earth orientation from GAST with IAU 2000B nutation.',
      'Night-light brightness is relative; absolute radiance is not preserved.',
    ],
  };
}

/** Reference cities for the "day or night right now" line (WGS84 lat/lon, east-positive). */
const CITIES: readonly { name: string; lat: number; lon: number }[] = [
  { name: 'London', lat: 51.51, lon: -0.13 }, { name: 'New Delhi', lat: 28.61, lon: 77.21 }, { name: 'Kolkata', lat: 22.57, lon: 88.36 },
  { name: 'Tokyo', lat: 35.68, lon: 139.69 }, { name: 'Sydney', lat: -33.87, lon: 151.21 }, { name: 'New York', lat: 40.71, lon: -74.01 },
  { name: 'São Paulo', lat: -23.55, lon: -46.63 }, { name: 'Nairobi', lat: -1.29, lon: 36.82 },
];

/** Solar elevation (deg) at a site, from the sub-solar point on a sphere (refraction and parallax ignored, < 1°). */
export function solarElevationDeg(ssLatDeg: number, ssLonDeg: number, latDeg: number, lonDeg: number): number {
  const r = Math.PI / 180;
  const c = Math.sin(ssLatDeg * r) * Math.sin(latDeg * r) + Math.cos(ssLatDeg * r) * Math.cos(latDeg * r) * Math.cos((lonDeg - ssLonDeg) * r);
  return Math.asin(Math.max(-1, Math.min(1, c))) / r;
}

function dayNightLine(ssLat: number, ssLon: number): string {
  const day: string[] = [];
  const twilight: string[] = [];
  const night: string[] = [];
  for (const c of CITIES) {
    const e = solarElevationDeg(ssLat, ssLon, c.lat, c.lon);
    (e > 0 ? day : e > -18 ? twilight : night).push(c.name);
  }
  const part = (label: string, xs: string[]): string | null => (xs.length ? `${label}: ${xs.join(', ')}` : null);
  const greenwich = ((12 - ssLon / 15) % 24 + 24) % 24;
  const hh = Math.floor(greenwich);
  const mm = Math.floor((greenwich - hh) * 60);
  return [part('Daylight', day), part('Twilight', twilight), part('Night', night)].filter(Boolean).join('. ') +
    `. Apparent solar time at Greenwich: ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}.`;
}

async function moonSheet(timeMs: () => number): Promise<FactSheet> {
  const bodies = await loadBodies();
  const b = bodies.get('moon');
  const t = timeMs();
  const s = evaluate(t);
  const ph = moonPhase(t);
  const lib = subEarthPointOnMoon(t);
  const iso = new Date(t).toISOString().replace('.000Z', 'Z');
  const o = b?.orbit;
  const os = src(b?.sources?.orbit);
  return {
    entityId: 'sol:moon',
    summary: b?.summary ?? 'The Moon is Earth’s only natural satellite.',
    sections: [
      { id: 'properties', title: 'Physical properties', facts: physicalFacts(b) },
      {
        id: 'orbit',
        title: 'Orbit',
        facts: [
          { key: 'a', label: 'Semi-major axis', quantity: o?.aKm != null ? observed(o.aKm, 'km', os) : unknown('km', os), provenance: 'observed' },
          { key: 'e', label: 'Eccentricity', quantity: o?.e != null ? observed(o.e, '', os) : unknown('', os), provenance: 'observed' },
          { key: 'i', label: 'Inclination to the ecliptic', quantity: o?.iDeg != null ? observed(o.iDeg, 'deg', os) : unknown('deg', os), provenance: 'observed' },
          { key: 'period', label: 'Sidereal month', quantity: o?.periodDays != null ? observed(o.periodDays, 'd', os) : unknown('d', os), provenance: 'observed' },
          { key: 'synodic', label: 'Synodic month (phases)', quantity: observed(29.530589, 'd'), provenance: 'observed' },
        ],
      },
      {
        id: 'science',
        title: `Right now (${iso})`,
        paragraphs: [
          `Phase: ${(ph.illuminatedFraction * 100).toFixed(0)} % of the disc lit (phase angle ${ph.phaseAngleDeg.toFixed(0)}°). ` +
            `Libration tips the face toward Earth by ${fmtLat(lib.latDeg)}, ${fmtLon(lib.lonDeg)}, so over a month we see about 59 % of the surface.`,
        ],
        facts: [
          { key: 'illum', label: 'Illuminated fraction', quantity: derived(ph.illuminatedFraction, '', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived' },
          { key: 'phase', label: 'Phase angle', quantity: derived(ph.phaseAngleDeg, 'deg', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived' },
          { key: 'dist', label: 'Distance from Earth', quantity: derived(s.moon.distanceTo(s.earth) / 1000, 'km', 'astronomy-engine-ephemeris', EPHEMERIS), provenance: 'derived' },
          { key: 'lib-lat', label: 'Libration in latitude', quantity: derived(lib.latDeg, 'deg', 'iau-wgccre-2015', EPHEMERIS), provenance: 'derived' },
          { key: 'lib-lon', label: 'Libration in longitude', quantity: derived(lib.lonDeg, 'deg', 'iau-wgccre-2015', EPHEMERIS), provenance: 'derived' },
        ],
      },
    ],
    representation: {
      provenance: 'observed',
      description:
        'Albedo: LRO Wide Angle Camera normalized-reflectance mosaic with Kaguya poles (NASA SVS CGI Moon Kit; polar band blended with Solar System Scope, CC BY 4.0), ' +
        'calibrated to the Moon’s mean albedo 0.12 and gently warmed to its true tint. Relief: LRO LOLA LDEM_64 elevation normals (derived, slopes ×2.5). ' +
        'Shading: lunar-Lambert photometry with the opposition surge, so the full Moon looks flat like the real one. ' +
        'Earthshine and the copper umbra of lunar eclipses are computed from the real geometry but brightened so the eye can see them on screen.',
    },
    sources: [
      { datasetId: 'jpl-ssd-satellite-phys-par' }, { datasetId: 'jpl-ssd-satellite-mean-elements' }, { datasetId: 'naif-pck00011' },
      { datasetId: 'textures-usgs-planetary-wms', note: 'LROC WAC mosaic, LOLA elevation' },
      { datasetId: 'textures-sss-planets', note: 'NASA SVS CGI Moon Kit (svs.gsfc.nasa.gov/4720) + Solar System Scope polar band, via public/textures/hd.json' }, EPHEMERIS,
    ],
    epoch: { label: 'Simulation time', iso },
  };
}

export function createEarthEntities(timeMs: () => number = nowTimeMs): { earth: Entity; moon: Entity } {
  const earth: Entity & { northPole(tMs: number, out: Vector3): Vector3; soiRadiusM: number } = {
    id: 'sol:earth',
    name: 'Earth',
    aliases: ['Terra', 'Tellus', 'the Earth', 'home'],
    kind: 'planet',
    domain: 'earth',
    parentId: 'sol:sun',
    radiusM: R_EARTH_M,
    position: earthPosition,
    velocity: earthVelocity,
    northPole: earthNorthPole,
    soiRadiusM: 9.25e8,
    viewDistance: { min: R_EARTH_M * 1.02, default: R_EARTH_M * 3.2 },
    tagline: 'Our home planet — the only world known to host life',
    capabilities: ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'compare', 'bookmark', 'sources', 'surface-view'],
    importance: 100,
    representation: 'observed',
    facts: () => earthSheet(timeMs),
  };
  const moon: Entity & { northPole(tMs: number, out: Vector3): Vector3; soiRadiusM: number } = {
    id: 'sol:moon',
    name: 'Moon',
    aliases: ['Luna', 'Selene', 'the Moon'],
    kind: 'moon',
    domain: 'earth',
    parentId: 'sol:earth',
    radiusM: R_MOON_M,
    position: moonPosition,
    velocity: moonVelocity,
    northPole: moonNorthPole,
    soiRadiusM: 6.61e7,
    viewDistance: { min: R_MOON_M * 1.02, default: R_MOON_M * 3.4 },
    tagline: 'Earth’s natural satellite',
    capabilities: ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'compare', 'bookmark', 'sources'],
    importance: 95,
    representation: 'observed',
    facts: () => moonSheet(timeMs),
  };
  return { earth, moon };
}
