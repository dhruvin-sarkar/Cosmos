// Registry of every upstream request made by the orbital pipeline.
// One entry = one HTTP GET, downloaded at most once per upstream update (CelesTrak policy).

import { RAW_DIR } from './lib.mjs';

export const CELESTRAK = 'https://celestrak.org';
export const GP_ENDPOINT = `${CELESTRAK}/NORAD/elements/gp.php`;
export const SATCAT_URL = `${CELESTRAK}/pub/satcat.csv`;

const H = 3_600_000;

// CelesTrak GP groups as listed on https://celestrak.org/NORAD/elements/ (checked 2026-10-16).
// [exact GROUP value (case-sensitive), short tag used in catalog.json, label, CelesTrak section]
// NOTE: "starlink" is deliberately NOT downloaded: CelesTrak's documentation says downloading
// Active and Starlink together is redundant (Starlink is a subset of Active). The 'starlink'
// tag is derived from OBJECT_NAME instead (see build.mjs).
export const GP_GROUPS = [
  ['active', 'active', 'Active Satellites', 'Special-Interest'],
  ['fengyun-1c-debris', 'fengyun-1c-debris', 'Chinese ASAT Test Debris (FENGYUN 1C)', 'Special-Interest'],
  ['cosmos-2251-debris', 'cosmos-2251-debris', 'COSMOS 2251 Debris', 'Special-Interest'],
  ['iridium-33-debris', 'iridium-33-debris', 'IRIDIUM 33 Debris', 'Special-Interest'],
  ['analyst', 'analyst', 'Analyst Satellites (not in SATCAT)', 'Special-Interest'],
  ['last-30-days', 'last-30-days', "Last 30 Days' Launches", 'Special-Interest'],
  ['stations', 'stations', 'Space Stations', 'Special-Interest'],
  ['visual', 'visual', '100 (or so) Brightest', 'Special-Interest'],
  ['weather', 'weather', 'Weather', 'Weather & Earth Resources'],
  ['resource', 'resource', 'Earth Resources', 'Weather & Earth Resources'],
  ['sar', 'sar', 'Synthetic Aperture Radar', 'Weather & Earth Resources'],
  ['sarsat', 'sarsat', 'Search & Rescue (SARSAT)', 'Weather & Earth Resources'],
  ['dmc', 'dmc', 'Disaster Monitoring', 'Weather & Earth Resources'],
  ['tdrss', 'tdrss', 'Tracking and Data Relay Satellite System', 'Weather & Earth Resources'],
  ['argos', 'argos', 'ARGOS Data Collection System', 'Weather & Earth Resources'],
  ['planet', 'planet', 'Planet', 'Weather & Earth Resources'],
  ['spire', 'spire', 'Spire', 'Weather & Earth Resources'],
  ['geo', 'geo', 'Active Geosynchronous', 'Communications'],
  ['intelsat', 'intelsat', 'Intelsat', 'Communications'],
  ['ses', 'ses', 'SES', 'Communications'],
  ['eutelsat', 'eutelsat', 'Eutelsat', 'Communications'],
  ['telesat', 'telesat', 'Telesat', 'Communications'],
  ['oneweb', 'oneweb', 'OneWeb', 'Communications'],
  ['qianfan', 'qianfan', 'Qianfan', 'Communications'],
  ['hulianwang', 'hulianwang', 'Hulianwang Digui', 'Communications'],
  ['kuiper', 'kuiper', 'Kuiper', 'Communications'],
  ['iridium-NEXT', 'iridium-next', 'Iridium NEXT', 'Communications'],
  ['orbcomm', 'orbcomm', 'Orbcomm', 'Communications'],
  ['globalstar', 'globalstar', 'Globalstar', 'Communications'],
  ['amateur', 'amateur', 'Amateur Radio', 'Communications'],
  ['satnogs', 'satnogs', 'SatNOGS', 'Communications'],
  ['x-comm', 'x-comm', 'Experimental Comm', 'Communications'],
  ['other-comm', 'other-comm', 'Other Comm', 'Communications'],
  ['gnss', 'gnss', 'GNSS', 'Navigation'],
  ['gps-ops', 'gps-ops', 'GPS Operational', 'Navigation'],
  ['glo-ops', 'glo-ops', 'GLONASS Operational', 'Navigation'],
  ['galileo', 'galileo', 'Galileo', 'Navigation'],
  ['beidou', 'beidou', 'Beidou', 'Navigation'],
  ['sbas', 'sbas', 'Satellite-Based Augmentation System', 'Navigation'],
  ['science', 'science', 'Space & Earth Science', 'Scientific'],
  ['geodetic', 'geodetic', 'Geodetic', 'Scientific'],
  ['engineering', 'engineering', 'Engineering', 'Scientific'],
  ['education', 'education', 'Education', 'Scientific'],
  ['military', 'military', 'Miscellaneous Military', 'Miscellaneous'],
  ['radar', 'radar', 'Radar Calibration', 'Miscellaneous'],
  ['cubesat', 'cubesat', 'CubeSats', 'Miscellaneous'],
];

// SPECIAL data sets (gp.php?SPECIAL=...)
export const GP_SPECIALS = [
  ['GPZ', 'gpz', 'GEO Protected Zone (all objects, any status)'],
  ['GPZ-PLUS', 'gpz-plus', 'GEO Protected Zone Plus'],
  ['DECAYING', 'decaying', 'Potential Decays'],
];

// Extended-coverage NAME searches (documented gp.php?NAME= partial-name query). CelesTrak
// publishes no "all objects" GP data set and no group for NON-active payloads, so these
// searches fetch element sets that no published group covers: debris, rocket bodies and the
// largest name families of dead payloads (chosen from SATCAT: on-orbit payloads with no
// DATA_STATUS_CODE, i.e. elements should exist, that no group/special set contained;
// counts below are those candidates in the 2026-10-15 SATCAT). They produce no group tag;
// they only add element sets. Each is downloaded once per update like everything else.
// [exact NAME value, purpose]
export const GP_NAME_QUERIES = [
  ['DEB', 'All objects whose name contains "DEB" (debris)'],
  ['R/B', 'All objects whose name contains "R/B" (rocket bodies)'],
  ['COSMOS', 'Inactive-payload family: COSMOS (Soviet/Russian satellites; 956 candidates)'],
  ['OPS', 'Inactive-payload family: OPS (US military satellites 1960s-80s; 128 candidates)'],
  ['USA', 'Inactive-payload family: USA (US government satellites; 76 candidates)'],
  ['GLOBALSTAR', 'Inactive-payload family: GLOBALSTAR (first-generation, disposal orbits; 57 candidates)'],
  ['METEOR', 'Inactive-payload family: METEOR (Soviet/Russian weather satellites; 47 candidates)'],
  ['INTELSAT', 'Inactive-payload family: INTELSAT (retired GEO comsats; 45 candidates)'],
  ['ORBCOMM', 'Inactive-payload family: ORBCOMM (first generation; 43 candidates)'],
  ['NAVSTAR', 'Inactive-payload family: NAVSTAR (retired GPS satellites in disposal orbits; 40 candidates)'],
  ['EUTELSAT', 'Inactive-payload family: EUTELSAT (retired GEO comsats; 30 candidates)'],
  ['IRIDIUM', 'Inactive-payload family: IRIDIUM (first-generation Iridium; 24 candidates)'],
  ['EXPLORER', 'Inactive-payload family: EXPLORER (historic US science satellites; 16 candidates)'],
  ['NOAA', 'Inactive-payload family: NOAA (retired polar weather satellites; 14 candidates)'],
  ['ASTRA', 'Inactive-payload family: ASTRA (retired GEO comsats; 14 candidates)'],
  ['VANGUARD', 'Historic family: VANGUARD (Vanguard 1, the oldest object in orbit, and siblings)'],
];

// Tags that are derived locally (not downloaded as CelesTrak groups)
export const DERIVED_TAGS = {
  starlink: 'Starlink payloads: OBJECT_NAME starts with "STARLINK" and SATCAT OBJECT_TYPE is PAY (derived locally; CelesTrak says its starlink group is a subset of active, so it is not downloaded separately).',
  docked: 'SATCAT ORBIT_TYPE = DOC: object is docked to/attached to another catalogued object (host NORAD id in the catalog.json header map "dockedTo").',
};

const safe = (s) => s.replace(/[^A-Za-z0-9._-]+/g, '_');

export function gpRequests() {
  const items = [];
  for (const [group, tag, label, section] of GP_GROUPS) {
    items.push({
      id: `gp-group-${group}`,
      kind: 'gp',
      query: `GROUP=${group}&FORMAT=CSV`,
      url: `${GP_ENDPOINT}?GROUP=${encodeURIComponent(group)}&FORMAT=CSV`,
      file: `${RAW_DIR}/gp/group-${safe(group)}.csv`,
      tag,
      label,
      section,
      required: group === 'active',
      maxAgeMs: 2 * H,
    });
  }
  for (const [special, tag, label] of GP_SPECIALS) {
    items.push({
      id: `gp-special-${special}`,
      kind: 'gp',
      query: `SPECIAL=${special}&FORMAT=CSV`,
      url: `${GP_ENDPOINT}?SPECIAL=${encodeURIComponent(special)}&FORMAT=CSV`,
      file: `${RAW_DIR}/gp/special-${safe(special)}.csv`,
      tag,
      label,
      section: 'Special data sets',
      required: false,
      maxAgeMs: 2 * H,
    });
  }
  return items;
}

export function gpNameRequests() {
  return GP_NAME_QUERIES.map(([name, label]) => ({
    id: `gp-name-${safe(name)}`,
    kind: 'gp',
    query: `NAME=${name}&FORMAT=CSV`,
    url: `${GP_ENDPOINT}?NAME=${encodeURIComponent(name)}&FORMAT=CSV`,
    file: `${RAW_DIR}/gp/name-${safe(name)}.csv`,
    tag: null,
    label,
    section: 'Extended coverage (NAME search)',
    required: false,
    maxAgeMs: 2 * H,
  }));
}

export const SATCAT_REQUEST = {
  id: 'satcat',
  kind: 'satcat',
  query: null,
  url: SATCAT_URL,
  file: `${RAW_DIR}/satcat/satcat.csv`,
  required: true,
  maxAgeMs: 12 * H, // CelesTrak: SATCAT updated manually once or twice daily
};

export const LOOKUP_REQUESTS = [
  {
    id: 'lookup-sources',
    kind: 'html',
    query: null,
    url: `${CELESTRAK}/satcat/sources.php`,
    file: `${RAW_DIR}/lookups/sources.html`,
    required: false,
    maxAgeMs: 7 * 24 * H,
  },
  {
    id: 'lookup-launchsites',
    kind: 'html',
    query: null,
    url: `${CELESTRAK}/satcat/launchsites.php`,
    file: `${RAW_DIR}/lookups/launchsites.html`,
    required: false,
    maxAgeMs: 7 * 24 * H,
  },
];

export const GP_REQUIRED_COLUMNS = [
  'OBJECT_NAME', 'OBJECT_ID', 'EPOCH', 'MEAN_MOTION', 'ECCENTRICITY', 'INCLINATION',
  'RA_OF_ASC_NODE', 'ARG_OF_PERICENTER', 'MEAN_ANOMALY', 'NORAD_CAT_ID', 'BSTAR',
  'MEAN_MOTION_DOT', 'MEAN_MOTION_DDOT',
];

export const SATCAT_REQUIRED_COLUMNS = [
  'OBJECT_NAME', 'OBJECT_ID', 'NORAD_CAT_ID', 'OBJECT_TYPE', 'OPS_STATUS_CODE', 'OWNER',
  'LAUNCH_DATE', 'LAUNCH_SITE', 'DECAY_DATE', 'PERIOD', 'INCLINATION', 'APOGEE', 'PERIGEE',
  'RCS', 'DATA_STATUS_CODE', 'ORBIT_CENTER', 'ORBIT_TYPE',
];
