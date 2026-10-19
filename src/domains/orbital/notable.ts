/**
 * Notable Earth satellites as hero entities ('sc:iss', 'sat:<norad>') with fact sheets. Positions: SGP4 from the
 * catalog snapshot rows in notable.generated.json (same CelesTrak GP data as catalog.json; regenerate with
 * tools/extract-notable.mjs), relative to Earth's entity at runtime, satellite offsets magnified by Earth's visual factor.
 */
import * as THREE from 'three';
import type { Entity, EntityKind } from '../../core/entity';
import type { Fact, FactSheet, SourceRef } from '../../data/provenance';
import { derived, observed } from '../../data/provenance';
import { F, type CatalogRow } from './catalogTypes';
import notableJson from './notable.generated.json';
import { earthDrawPosition, offsetScale, R_EARTH_EQ_M, R_EARTH_M } from './scene';
import { TrackedSat, satrecFromRow } from './sgp4';

export type SatModel = 'iss' | 'tiangong' | 'hubble' | 'glint';

export interface NotableInfo {
  norad: string;
  id: string;
  name: string;
  aliases: string[];
  kind: EntityKind;
  model: SatModel;
  /** Approximate bounding radius (m) for framing. */
  radiusM: number;
  operator: string;
  purpose: string;
  tagline: string;
  summary: string;
  /** Approximate dimensions (text). */
  size?: string;
  massKg?: number;
  importance: number;
  reference: string;
  /** Glint colour hint (linear reflectance-ish). */
  tint?: [number, number, number];
}

export const GP_SOURCE: SourceRef = { datasetId: 'celestrak-gp-omm', reference: 'CelesTrak GP element sets (T.S. Kelso); USSPACECOM via Space-Track.org' };
export const SATCAT_SOURCE: SourceRef = { datasetId: 'celestrak-satcat', reference: 'CelesTrak SATCAT' };

export const NOTABLE: NotableInfo[] = [
  {
    norad: '25544', id: 'sc:iss', name: 'International Space Station', aliases: ['ISS', 'ISS (ZARYA)', 'Zarya'], kind: 'space-station', model: 'iss',
    radiusM: 55, operator: 'NASA, Roscosmos, ESA, JAXA, CSA', purpose: 'Crewed orbital laboratory (continuously inhabited since November 2000)',
    tagline: 'Crewed laboratory circling Earth every ~93 minutes', importance: 92,
    summary: 'The largest structure humans have put in space: a laboratory the size of a football field, crewed without interruption since 2 November 2000. It orbits about 420 km up at 7.66 km/s, circling Earth roughly every 93 minutes.',
    size: 'Truss 109 m; arrays span ~73 m; pressurised volume 916 m³', massKg: 419_725,
    reference: 'NASA, "International Space Station Facts and Figures" (nasa.gov/international-space-station/space-station-facts-and-figures)',
  },
  {
    norad: '48274', id: 'sat:48274', name: 'Tiangong space station', aliases: ['CSS', 'CSS (TIANHE)', 'Tianhe', 'Chinese Space Station'], kind: 'space-station', model: 'tiangong',
    radiusM: 30, operator: 'China Manned Space Agency (CMSA)', purpose: 'Crewed orbital laboratory (core module Tianhe, labs Wentian and Mengtian)',
    tagline: "China's three-module crewed space station", importance: 80,
    summary: "China's modular space station: the Tianhe core module (2021) with the Wentian and Mengtian laboratory modules (2022) in a T shape, permanently crewed by three taikonauts at about 390 km.",
    size: 'T-shaped, ~55 m across the lab modules\' arrays',
    reference: 'China Manned Space Agency (cmse.gov.cn)',
  },
  {
    norad: '20580', id: 'sat:20580', name: 'Hubble Space Telescope', aliases: ['HST', 'Hubble'], kind: 'satellite', model: 'hubble',
    radiusM: 8, operator: 'NASA / ESA', purpose: 'Ultraviolet, visible and near-infrared space telescope (2.4 m mirror)',
    tagline: 'The 2.4 m space telescope, observing since 1990', importance: 85,
    summary: 'Launched in 1990 from Space Shuttle Discovery and serviced five times by astronauts, Hubble has made more than 1.6 million observations from about 475 km above Earth\'s atmosphere.',
    size: '13.2 m long, 4.2 m diameter', massKg: 11_110,
    reference: 'NASA, "Hubble Space Telescope" mission pages (science.nasa.gov/mission/hubble)',
  },
  {
    norad: '49260', id: 'sat:49260', name: 'Landsat 9', aliases: ['LANDSAT 9'], kind: 'satellite', model: 'glint', radiusM: 5,
    operator: 'NASA / USGS', purpose: 'Land imaging (Operational Land Imager 2, Thermal Infrared Sensor 2)', importance: 45,
    tagline: 'Continues the 50-year Landsat record of Earth\'s land surface',
    summary: 'The latest of the Landsat satellites, which have imaged Earth\'s land continuously since 1972. Sun-synchronous orbit at ~705 km, 16-day repeat.',
    reference: 'NASA/USGS Landsat 9 (landsat.gsfc.nasa.gov/satellites/landsat-9)',
  },
  {
    norad: '25994', id: 'sat:25994', name: 'Terra', aliases: ['TERRA', 'EOS AM-1'], kind: 'satellite', model: 'glint', radiusM: 5,
    operator: 'NASA', purpose: 'Earth Observing System flagship (MODIS, ASTER, CERES, MISR, MOPITT)', importance: 45,
    tagline: 'NASA\'s Earth Observing System morning flagship (1999)',
    summary: 'Terra has measured Earth\'s land, oceans, atmosphere and energy balance since 1999; its MODIS imagery underlies the Blue Marble mosaics used for the Earth in this app.',
    massKg: 4_864, reference: 'NASA Terra (terra.nasa.gov)',
  },
  {
    norad: '27424', id: 'sat:27424', name: 'Aqua', aliases: ['AQUA', 'EOS PM-1'], kind: 'satellite', model: 'glint', radiusM: 5,
    operator: 'NASA', purpose: 'Earth\'s water cycle (MODIS, AIRS, CERES, AMSU)', importance: 40,
    tagline: 'NASA\'s water-cycle observatory (2002)',
    summary: 'Aqua observes evaporation, clouds, precipitation, sea ice and snow cover; with Terra it provides twice-daily global MODIS coverage.',
    reference: 'NASA Aqua (aqua.nasa.gov)',
  },
  ...(['40697:Sentinel-2A:2015', '42063:Sentinel-2B:2017', '60989:Sentinel-2C:2024'].map((s): NotableInfo => {
    const [norad, name, yr] = s.split(':');
    return {
      norad, id: `sat:${norad}`, name, aliases: [name.toUpperCase()], kind: 'satellite', model: 'glint', radiusM: 4,
      operator: 'ESA / European Commission (Copernicus)', purpose: 'Multispectral land imaging (13 bands, 10 m resolution)', importance: 38,
      tagline: `Copernicus multispectral imager (${yr})`,
      summary: `${name} is one of the Copernicus Sentinel-2 twins imaging land and coastal waters every five days in 13 spectral bands from a sun-synchronous orbit at ~786 km.`,
      reference: 'ESA Sentinel-2 mission (esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-2)',
    };
  })),
  {
    norad: '43013', id: 'sat:43013', name: 'NOAA-20', aliases: ['NOAA 20', 'JPSS-1', 'NOAA 20 (JPSS-1)'], kind: 'satellite', model: 'glint', radiusM: 4,
    operator: 'NOAA / NASA', purpose: 'Polar-orbiting weather satellite (VIIRS, CrIS, ATMS)', importance: 38,
    tagline: 'Polar weather satellite (JPSS)',
    summary: 'First of the Joint Polar Satellite System series; its VIIRS instrument also provides the city-lights imagery used for Earth\'s night side.',
    reference: 'NOAA JPSS (nesdis.noaa.gov/our-satellites/currently-flying/joint-polar-satellite-system)',
  },
  {
    norad: '60133', id: 'sat:60133', name: 'GOES-19 (GOES-East)', aliases: ['GOES 19', 'GOES-U', 'GOES-East'], kind: 'satellite', model: 'glint', radiusM: 6,
    operator: 'NOAA / NASA', purpose: 'Geostationary weather satellite over the Americas (75.2° W)', importance: 42,
    tagline: 'Geostationary weather watch over the Americas',
    summary: 'GOES-19 became the operational GOES-East satellite in 2025, imaging the Western Hemisphere every 10 minutes from 35,786 km above the equator.',
    reference: 'NOAA GOES-R series (goes-r.gov)',
  },
  {
    norad: '51850', id: 'sat:51850', name: 'GOES-18 (GOES-West)', aliases: ['GOES 18', 'GOES-T', 'GOES-West'], kind: 'satellite', model: 'glint', radiusM: 6,
    operator: 'NOAA / NASA', purpose: 'Geostationary weather satellite over the Pacific (137.0° W)', importance: 40,
    tagline: 'Geostationary weather watch over the Pacific',
    summary: 'GOES-18 is the operational GOES-West satellite, covering the western US, Alaska, Hawaii and the Pacific from geostationary orbit.',
    reference: 'NOAA GOES-R series (goes-r.gov)',
  },
  {
    norad: '55268', id: 'sat:55268', name: 'GPS III SV06', aliases: ['NAVSTAR 82', 'USA 343', 'NAVSTAR 82 (USA 343)'], kind: 'satellite', model: 'glint', radiusM: 4,
    operator: 'U.S. Space Force', purpose: 'Global Positioning System navigation (GPS III)', importance: 34,
    tagline: 'GPS navigation satellite, ~20,200 km up',
    summary: 'One of ~31 operational GPS satellites in six orbital planes at ~20,200 km, each circling Earth twice a sidereal day.',
    reference: 'GPS.gov space segment (gps.gov/systems/gps/space)',
  },
  {
    norad: '67588', id: 'sat:67588', name: 'NAVSTAR 85 (GPS)', aliases: ['NAVSTAR 85', 'USA 581', 'NAVSTAR 85 (USA 581)'], kind: 'satellite', model: 'glint', radiusM: 4,
    operator: 'U.S. Space Force', purpose: 'Global Positioning System navigation', importance: 30,
    tagline: 'GPS navigation satellite launched January 2026',
    summary: 'A GPS navigation satellite launched on 28 January 2026 into the ~20,200 km, 55° GPS orbit.',
    reference: 'GPS.gov space segment (gps.gov/systems/gps/space)',
  },
  {
    norad: '43564', id: 'sat:43564', name: 'Galileo 25 (GSAT0221)', aliases: ['GSAT0221', 'GALILEO 25', 'GSAT0221 (GALILEO 25)'], kind: 'satellite', model: 'glint', radiusM: 3,
    operator: 'European Union / ESA', purpose: 'Galileo global navigation', importance: 30,
    tagline: 'European navigation satellite, ~23,200 km up',
    summary: 'A Galileo Full Operational Capability satellite in Europe\'s navigation constellation (three planes inclined 56° at 23,222 km).',
    reference: 'EUSPA Galileo constellation (euspa.europa.eu)',
  },
  {
    norad: '46805', id: 'sat:46805', name: 'GLONASS-K (Kosmos 2547)', aliases: ['COSMOS 2547', 'Kosmos 2547', 'COSMOS 2547 [GLONASS-K]'], kind: 'satellite', model: 'glint', radiusM: 3,
    operator: 'Roscosmos', purpose: 'GLONASS global navigation', importance: 28,
    tagline: 'Russian navigation satellite, ~19,100 km up',
    summary: 'A GLONASS-K navigation satellite; GLONASS uses three planes inclined 64.8° at ~19,100 km.',
    reference: 'Information and Analysis Center for Positioning, Navigation and Timing (glonass-iac.ru)',
  },
  {
    norad: '43001', id: 'sat:43001', name: 'BeiDou-3 M1', aliases: ['BEIDOU-3 M1'], kind: 'satellite', model: 'glint', radiusM: 3,
    operator: 'China Satellite Navigation Office', purpose: 'BeiDou global navigation (medium Earth orbit)', importance: 28,
    tagline: 'Chinese navigation satellite, ~21,500 km up',
    summary: 'The first BeiDou-3 medium-Earth-orbit satellite (2017); the BeiDou system combines MEO, geostationary and inclined geosynchronous satellites.',
    reference: 'BeiDou Navigation Satellite System (en.beidou.gov.cn)',
  },
  {
    norad: '42915', id: 'sat:42915', name: 'TDRS-13', aliases: ['TDRS 13', 'TDRS-M'], kind: 'satellite', model: 'glint', radiusM: 8,
    operator: 'NASA', purpose: 'Tracking and Data Relay Satellite (relays ISS and Hubble communications)', importance: 32,
    tagline: 'Geostationary relay that links the ISS and Hubble to the ground',
    summary: 'Part of NASA\'s Space Network: geostationary relays that keep the ISS, Hubble and other low-orbit spacecraft in near-continuous contact with the ground.',
    reference: 'NASA Space Network / TDRS (nasa.gov/directorates/somd/space-communications-navigation-program)',
  },
  {
    norad: '27386', id: 'sat:27386', name: 'Envisat (defunct)', aliases: ['ENVISAT'], kind: 'satellite', model: 'glint', radiusM: 13,
    operator: 'ESA (contact lost 2012)', purpose: 'Former environmental satellite; now one of the largest derelict objects in LEO', importance: 30,
    tagline: 'An 8-tonne derelict satellite, a major debris risk',
    summary: 'ESA\'s Envisat stopped responding in April 2012. At 8.2 tonnes and ~26 m long it is among the most hazardous derelict objects in low Earth orbit and will remain there for about 150 years.',
    massKg: 8_211, reference: 'ESA, "Envisat" (esa.int)',
  },
  {
    norad: '5', id: 'sat:5', name: 'Vanguard 1', aliases: ['VANGUARD 1'], kind: 'satellite', model: 'glint', radiusM: 1,
    operator: 'U.S. Navy (Naval Research Laboratory)', purpose: 'Early test satellite; first solar-powered satellite', importance: 36,
    tagline: 'The oldest human-made object still in orbit (1958)',
    summary: 'Launched 17 March 1958, the grapefruit-sized Vanguard 1 is the oldest artificial object still in orbit and the first satellite powered by solar cells.',
    size: '16.5 cm sphere', massKg: 1.47, reference: 'NASA NSSDCA Master Catalog, Vanguard 1 (1958-002B)',
  },
  {
    norad: '43613', id: 'sat:43613', name: 'ICESat-2', aliases: ['ICESAT-2'], kind: 'satellite', model: 'glint', radiusM: 3,
    operator: 'NASA', purpose: 'Laser altimetry of ice sheets, sea ice and vegetation (ATLAS lidar)', importance: 34,
    tagline: 'Measures polar ice height with laser pulses',
    summary: 'ICESat-2 fires 10,000 laser pulses a second and times their return to measure the height of ice sheets, sea ice and forests to centimetre precision.',
    reference: 'NASA ICESat-2 (icesat-2.gsfc.nasa.gov)',
  },
];

const ROWS = new Map<string, CatalogRow>((notableJson as { rows: CatalogRow[] }).rows.map((r) => [String(r[F.norad]), r]));
export const NOTABLE_GENERATED = (notableJson as { generated: string }).generated;

export interface NotableSat {
  info: NotableInfo;
  row: CatalogRow | null;
  track: TrackedSat;
  entity: Entity;
}

const scratch = new THREE.Vector3();
const scratchV = new THREE.Vector3();

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function sheet(s: NotableSat, timeMs: () => number): FactSheet {
  const { info, row, track } = s;
  const t = timeMs();
  const overview: Fact[] = [
    { key: 'operator', label: 'Operator', text: info.operator, provenance: 'observed', source: { datasetId: 'celestrak-satcat', reference: info.reference } },
    { key: 'purpose', label: 'Purpose', text: info.purpose, provenance: 'observed', source: { datasetId: 'celestrak-satcat', reference: info.reference } },
    { key: 'norad', label: 'NORAD catalog number', text: info.norad, provenance: 'observed', source: SATCAT_SOURCE },
  ];
  if (row?.[F.intlDes]) overview.push({ key: 'cospar', label: 'International designator', text: String(row[F.intlDes]), provenance: 'observed', source: SATCAT_SOURCE });
  if (row?.[F.launchDate]) overview.push({ key: 'launch', label: 'Launch date', text: String(row[F.launchDate]), provenance: 'observed', source: SATCAT_SOURCE });
  const props: Fact[] = [];
  if (info.size) props.push({ key: 'size', label: 'Size', text: info.size, provenance: 'observed', source: { datasetId: 'celestrak-satcat', reference: info.reference } });
  if (info.massKg != null) props.push({ key: 'mass', label: 'Mass', quantity: observed(info.massKg, 'kg', { datasetId: 'celestrak-satcat', reference: info.reference }), provenance: 'observed' });
  const rcs = num(row?.[F.rcsM2]);
  if (rcs != null) props.push({ key: 'rcs', label: 'Radar cross-section', quantity: observed(rcs, 'm2', SATCAT_SOURCE), provenance: 'observed', help: 'How large the object looks to tracking radars.' });
  const orbit: Fact[] = [];
  const peri = num(row?.[F.perigeeKm]), apo = num(row?.[F.apogeeKm]);
  orbit.push({ key: 'perigee', label: 'Perigee altitude', quantity: observed(peri, 'km', GP_SOURCE), provenance: 'observed' });
  orbit.push({ key: 'apogee', label: 'Apogee altitude', quantity: observed(apo, 'km', GP_SOURCE), provenance: 'observed' });
  orbit.push({ key: 'inc', label: 'Inclination', quantity: observed(num(row?.[F.inc]), 'deg', GP_SOURCE), provenance: 'observed' });
  orbit.push({ key: 'period', label: 'Orbital period', quantity: observed(num(row?.[F.periodMin]), 'min', GP_SOURCE), provenance: 'observed' });
  if (track.position(t, scratch)) {
    track.velocity(t, scratchV);
    orbit.push({ key: 'alt', label: 'Current altitude', quantity: { ...derived(Math.round((scratch.length() - R_EARTH_EQ_M) / 100) / 10, 'km', 'sgp4@satellite.js-7', GP_SOURCE), sigDigits: 4 }, provenance: 'derived', help: 'Above a spherical Earth of 6378 km radius, at the current simulation time.' });
    orbit.push({ key: 'speed', label: 'Orbital speed', quantity: { ...derived(Math.round(scratchV.length()) / 1000, 'km/s', 'sgp4@satellite.js-7', GP_SOURCE), sigDigits: 3 }, provenance: 'derived' });
  }
  const epoch = row?.[F.epochUTC] ? String(row[F.epochUTC]) : undefined;
  const modelDesc = info.model === 'glint'
    ? 'Shown as a sunlit point (no 3D model); the position is real (SGP4 from CelesTrak elements).'
    : 'Illustrative 3D model at true proportions; the position and orbit are real (SGP4 from CelesTrak elements), orientation follows the local orbital frame.';
  return {
    entityId: info.id,
    summary: info.summary,
    sections: [
      { id: 'overview', title: 'Overview', facts: overview },
      ...(props.length ? [{ id: 'properties', title: 'Spacecraft', facts: props }] : []),
      { id: 'orbit', title: 'Orbit', facts: orbit, paragraphs: ['Mean-element orbit from the CelesTrak GP snapshot, propagated with SGP4. Accuracy is about 1 km at the element epoch and degrades by a few km per day; manoeuvres after the snapshot are not included.'] },
    ],
    representation: { provenance: info.model === 'glint' ? 'observed' : 'illustrative', description: modelDesc },
    sources: [GP_SOURCE, SATCAT_SOURCE, { datasetId: 'celestrak-satcat', reference: info.reference }],
    epoch: epoch ? { label: 'Orbital elements epoch', iso: epoch } : undefined,
    assumptions: ['SGP4 mean-element propagation (Vallado et al. 2006) of the CelesTrak GP snapshot; TEME rotated to ICRS with IAU precession–nutation.'],
  };
}

/** Build the notable satellites; positions are Earth's entity position + offset × (SGP4 offset). */
export function createNotableSats(timeMs: () => number): NotableSat[] {
  const out: NotableSat[] = [];
  for (const info of NOTABLE) {
    const row = ROWS.get(info.norad) ?? null;
    const track = new TrackedSat(row ? satrecFromRow(row) : null);
    const s = { info, row, track } as NotableSat;
    const rel = new THREE.Vector3();
    const vel = new THREE.Vector3();
    const peri = num(row?.[F.perigeeKm]) ?? 400;
    s.entity = {
      id: info.id,
      name: info.name,
      aliases: [...info.aliases, `NORAD ${info.norad}`],
      kind: info.kind,
      domain: 'orbital',
      parentId: 'sol:earth',
      radiusM: info.radiusM,
      // Models are wider than their bounding radius along the diagonal (solar wings): fit the whole craft in the inspect view.
      framingRadiusM: info.model === 'glint' ? undefined : info.radiusM * 1.3,
      position(tMs, o) {
        earthDrawPosition(tMs, o);
        if (track.position(tMs, rel)) o.addScaledVector(rel, offsetScale(rel.length()));
        return o;
      },
      velocity(tMs, o) {
        // Earth's heliocentric motion is irrelevant for following at these scales; Earth-relative velocity.
        if (track.velocity(tMs, vel) && track.position(tMs, rel)) o.copy(vel).multiplyScalar(offsetScale(rel.length())); else o.set(0, 0, 0);
        return o;
      },
      viewDistance: { min: info.radiusM * 1.5, default: info.model === 'glint' ? 400 : info.radiusM * 3.2, max: (R_EARTH_M + peri * 1000) * 12 },
      contextScaleMin: Math.log10((R_EARTH_M + peri * 1000) * 1.2),
      tagline: info.tagline,
      capabilities: ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'bookmark', 'sources', 'experiment:debris'],
      importance: info.importance,
      representation: info.model === 'glint' ? 'observed' : 'illustrative',
      facts: () => sheet(s, timeMs),
    };
    out.push(s);
  }
  return out;
}
