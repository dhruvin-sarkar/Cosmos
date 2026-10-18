// Output schema of public/data/orbital/catalog.json (shared by build.mjs and validate.mjs).

// The 24 columns specified for the Cosmos orbital layer, in the specified order.
export const SPEC_FIELDS = [
  'norad', 'name', 'intlDes', 'objectClass', 'isActive', 'owner', 'launchDate', 'rcsSize', 'groups',
  'hasElements', 'epochUTC', 'meanMotionRevPerDay', 'eccentricity', 'inclinationDeg', 'raanDeg',
  'argPerigeeDeg', 'meanAnomalyDeg', 'bstar', 'meanMotionDot', 'meanMotionDdot', 'apogeeKm',
  'perigeeKm', 'periodMin', 'elementSource',
];

// Extension columns appended AFTER the specified ones (spec indices 0-23 unchanged).
export const EXTRA_FIELDS = ['launchSite', 'opsStatusCode', 'rcsM2'];

export const CATALOG_FIELDS = [...SPEC_FIELDS, ...EXTRA_FIELDS];

export const FIELD_UNITS = {
  norad: 'string (NORAD/USSF catalog number, decimal digits, up to 9; never a number)',
  epochUTC: 'ISO-8601 UTC timestamp (GP EPOCH, microsecond precision, suffix Z)',
  meanMotionRevPerDay: 'rev/day (Kozai mean motion, SGP4 input MEAN_MOTION)',
  eccentricity: 'dimensionless (SGP4 mean eccentricity)',
  inclinationDeg: 'deg (TEME of epoch for GP rows; SATCAT value for satcat-shape rows)',
  raanDeg: 'deg (right ascension of ascending node, TEME of epoch)',
  argPerigeeDeg: 'deg',
  meanAnomalyDeg: 'deg',
  bstar: '1/earth-radii (SGP4 B* drag term, earth radius 6378.135 km)',
  meanMotionDot: 'rev/day^2 (OMM MEAN_MOTION_DOT = first derivative of mean motion / 2, TLE convention)',
  meanMotionDdot: 'rev/day^3 (OMM MEAN_MOTION_DDOT = second derivative of mean motion / 6, TLE convention)',
  apogeeKm: 'km above a spherical Earth of radius 6378.135 km (mean apsis altitude)',
  perigeeKm: 'km above a spherical Earth of radius 6378.135 km (mean apsis altitude)',
  periodMin: 'minutes',
  launchDate: 'YYYY-MM-DD (UTC calendar date)',
  rcsM2: 'm^2 (radar cross-section as published in SATCAT)',
};
