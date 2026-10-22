// Cosmos — exoplanets domain: shared configuration.
//
// Source: NASA Exoplanet Archive (Caltech/IPAC, NASA Exoplanet Exploration Program)
//   TAP sync endpoint: https://exoplanetarchive.ipac.caltech.edu/TAP/sync
//   Tables: pscomppars (Planetary Systems Composite Parameters, one row per confirmed planet)
//           ps         (Planetary Systems, one row per planet per reference; default_flag=1 = default set)
//
// Everything that defines *what* is downloaded lives here so that fetch.mjs (network),
// build.mjs (offline normalisation) and validate.mjs (offline checks) agree exactly.

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, '..', '..', '..').split(path.sep).join('/');
export const RAW_DIR = `${REPO_ROOT}/data-raw/exoplanets`;
export const OUT_DIR = `${REPO_ROOT}/public/data/exoplanets`;
export const DOC_PATH = `${REPO_ROOT}/docs/data/exoplanets.md`;

export const DOMAIN = 'exoplanets';
export const USER_AGENT = 'Cosmos/0.1 (educational SCI-FORGE 2026 project)';
export const TAP_SYNC = 'https://exoplanetarchive.ipac.caltech.edu/TAP/sync';
export const ARCHIVE_BASE = 'https://exoplanetarchive.ipac.caltech.edu';

// Politeness / safety limits. The archive's TAP documentation does not publish a rate limit;
// we keep >= 1.5 s between requests to the same host and make only ~9 requests per full run.
export const MIN_REQUEST_INTERVAL_MS = 1500;
export const REQUEST_TIMEOUT_MS = 5 * 60 * 1000;
export const MAX_RESPONSE_BYTES = 200 * 1024 * 1024; // hard cap on a single (decompressed) response
export const RAW_BUDGET_BYTES = 50_000_000; // domain raw-download budget (stored bytes; decimal MB, conservative)
export const OUTPUT_BUDGET_BYTES = 8_000_000; // domain output budget (decimal MB, conservative)
export const MIN_FREE_DISK_BYTES = 3.5 * 1024 ** 3; // never let C: drop below this
export const FREE_DISK_MARGIN_BYTES = 0.3 * 1024 ** 3;

// ---------------------------------------------------------------------------------------------
// Column selection (PSCompPars). Each parameter: [column, hasErr, hasLim, refColumn|null]
// Error columns are <column>err1 (upper, +) and <column>err2 (lower, -, usually negative).
// Limit columns are <column>lim: 1 = value is an upper limit, -1 = lower limit, 0 = measured.
// Reference columns (*_reflink / disc_refname) are HTML anchors; build.mjs turns them into
// integer indices into references.json.
// ---------------------------------------------------------------------------------------------
export const PLANET_ID_COLUMNS = [
  'pl_name', 'pl_letter', 'hostname', 'sy_snum', 'sy_pnum', 'sy_mnum', 'cb_flag', 'pl_controv_flag',
  'discoverymethod', 'disc_year', 'disc_facility',
];
export const DISC_REF_COLUMN = 'disc_refname';

export const ORBIT_PARAMS = [
  ['pl_orbper', true, true, 'pl_orbper_reflink'],
  ['pl_orbsmax', true, true, 'pl_orbsmax_reflink'],
  ['pl_orbeccen', true, true, 'pl_orbeccen_reflink'],
  ['pl_orbincl', true, true, 'pl_orbincl_reflink'],
  ['pl_orblper', true, true, 'pl_orblper_reflink'],
  ['pl_tranmid', true, true, 'pl_tranmid_reflink'],
];
export const PLANET_PHYS_PARAMS = [
  ['pl_rade', true, true, 'pl_rade_reflink'],
  ['pl_bmasse', true, true, 'pl_bmasse_reflink'],
  ['pl_dens', true, true, 'pl_dens_reflink'],
  ['pl_insol', true, true, 'pl_insol_reflink'],
  ['pl_eqt', true, true, 'pl_eqt_reflink'],
];
export const STELLAR_PARAMS = [
  ['st_teff', true, true, 'st_teff_reflink'],
  ['st_rad', true, true, 'st_rad_reflink'],
  ['st_mass', true, true, 'st_mass_reflink'],
  ['st_lum', true, true, 'st_lum_reflink'],
  ['st_met', true, true, 'st_met_reflink'],
  ['st_age', true, true, 'st_age_reflink'],
  ['st_logg', true, true, 'st_logg_reflink'],
];
export const SYSTEM_PARAMS = [
  ['sy_dist', true, false, 'sy_dist_reflink'],
  ['sy_plx', true, false, 'sy_plx_reflink'],
  ['sy_vmag', true, false, 'sy_vmag_reflink'],
  ['sy_kmag', true, false, 'sy_kmag_reflink'],
  ['sy_gaiamag', true, false, 'sy_gaiamag_reflink'],
];
// System-level parameters are constant for all planets of a host (verified in validate.mjs).
// Published per planet (planets.json) and per host (systems.json): sy_dist, sy_vmag, sy_kmag.
// sy_plx, sy_gaiamag and the proper motions are fetched for validation (plx/distance and
// proper-motion consistency checks) but not published, to keep the domain inside its 8 MB budget.
export const PLANET_ROW_SYSTEM_PARAMS = ['sy_dist', 'sy_vmag', 'sy_kmag'];
export const VALIDATION_ONLY_COLUMNS = [
  'sy_plx', 'sy_plxerr1', 'sy_plxerr2', 'sy_plx_reflink', 'sy_gaiamag', 'sy_gaiamagerr1', 'sy_gaiamagerr2', 'sy_gaiamag_reflink',
  'sy_pmra', 'sy_pmraerr1', 'sy_pmraerr2', 'sy_pmdec', 'sy_pmdecerr1', 'sy_pmdecerr2', 'sy_pm', 'sy_pm_reflink',
  'pl_radj', 'pl_bmassj', 'tic_id',
];
// Extra raw columns: used for systems.json and for validation only.
export const EXTRA_RAW_COLUMNS = [
  'pl_tranmid_systemref', 'pl_bmassprov', 'st_spectype', 'st_spectype_reflink', 'st_metratio',
  'ra', 'dec', 'ra_reflink',
  'sy_pmra', 'sy_pmraerr1', 'sy_pmraerr2', 'sy_pmdec', 'sy_pmdecerr1', 'sy_pmdecerr2', 'sy_pm', 'sy_pm_reflink',
  'hd_name', 'hip_name', 'tic_id', 'gaia_dr3_id',
  // pl_radj / pl_bmassj are fetched only to verify they are pure unit conversions of pl_rade / pl_bmasse
  'pl_radj', 'pl_bmassj',
];

function expandParam([col, hasErr, hasLim, ref]) {
  const cols = [col];
  if (hasErr) cols.push(`${col}err1`, `${col}err2`);
  if (hasLim) cols.push(`${col}lim`);
  if (ref) cols.push(ref);
  return cols;
}

export const ALL_PARAMS = [...ORBIT_PARAMS, ...PLANET_PHYS_PARAMS, ...STELLAR_PARAMS, ...SYSTEM_PARAMS];

export const PSCOMPPARS_COLUMNS = [...new Set([
  ...PLANET_ID_COLUMNS, DISC_REF_COLUMN,
  ...ALL_PARAMS.flatMap(expandParam),
  ...EXTRA_RAW_COLUMNS,
])];

export const PS_DEFAULT_COLUMNS = [
  'pl_name', 'hostname', 'default_flag', 'soltype', 'pl_refname', 'st_refname', 'sy_refname',
  'pl_pubdate', 'releasedate', 'rowupdate',
];

// ---------------------------------------------------------------------------------------------
// Requests (ADQL, single line as the archive requires). Order matters: schema first, so that a
// missing column fails loudly before the large download.
// ---------------------------------------------------------------------------------------------
export const ADQL = {
  schema: "select table_name,column_name,datatype,unit,description from TAP_SCHEMA.columns where table_name like 'pscomppars' or table_name like 'ps'",
  countPscomppars: 'select count(*) as n from pscomppars',
  countPsDefault: 'select count(*) as n from ps where default_flag=1',
  countPsDefaultDistinct: 'select count(distinct pl_name) as n from ps where default_flag=1',
  countPsDefaultBySoltype: 'select soltype,count(*) as n from ps where default_flag=1 group by soltype',
  countPsDefaultHosts: 'select count(distinct hostname) as n from ps where default_flag=1',
  pscomppars: `select ${PSCOMPPARS_COLUMNS.join(',')} from pscomppars`,
  psDefault: `select ${PS_DEFAULT_COLUMNS.join(',')} from ps where default_flag=1`,
};

// Raw cache layout: one file per request. Large ones are gzip-compressed (byte-exact archive
// response, compressed only to respect the raw-disk budget).
export const RAW_FILES = {
  schema: { file: 'tap_schema_columns.json.gz', query: ADQL.schema },
  countPscomppars: { file: 'count_pscomppars.json', query: ADQL.countPscomppars },
  countPsDefault: { file: 'count_ps_default.json', query: ADQL.countPsDefault },
  countPsDefaultDistinct: { file: 'count_ps_default_distinct.json', query: ADQL.countPsDefaultDistinct },
  countPsDefaultBySoltype: { file: 'count_ps_default_by_soltype.json', query: ADQL.countPsDefaultBySoltype },
  countPsDefaultHosts: { file: 'count_ps_default_hosts.json', query: ADQL.countPsDefaultHosts },
  pscomppars: { file: 'pscomppars.json.gz', query: ADQL.pscomppars },
  psDefault: { file: 'ps_default.json.gz', query: ADQL.psDefault },
};
export const SNAPSHOT_FILE = 'snapshot.json'; // written last by fetch.mjs; marks a complete, consistent snapshot

export function tapUrl(query, format = 'json') {
  const u = new URL(TAP_SYNC);
  u.searchParams.set('query', query);
  u.searchParams.set('format', format);
  return u.toString();
}

// ---------------------------------------------------------------------------------------------
// Units (explicit; cross-checked against TAP_SCHEMA units in build.mjs where the archive gives one).
// ---------------------------------------------------------------------------------------------
export const BASE_UNITS = {
  pl_orbper: 'day',
  pl_orbsmax: 'au',
  pl_orbeccen: 'dimensionless',
  pl_orbincl: 'deg',
  pl_orblper: 'deg',
  pl_tranmid: 'day (Julian Date; time standard in pl_tranmid_systemref, normally BJD-TDB)',
  pl_rade: 'Earth radius (R_earth)',
  pl_bmasse: 'Earth mass (M_earth)',
  pl_dens: 'g/cm^3',
  pl_insol: 'Earth flux (S_earth; 1 = solar flux at 1 au)',
  pl_eqt: 'K',
  st_teff: 'K',
  st_rad: 'solar radius (R_sun)',
  st_mass: 'solar mass (M_sun)',
  st_lum: 'dex: log10(L/L_sun)',
  st_met: 'dex ([Fe/H] or [M/H], see st_metratio)',
  st_age: 'Gyr',
  st_logg: 'dex: log10(g / (cm/s^2))',
  sy_dist: 'pc',
  sy_plx: 'mas',
  sy_vmag: 'mag (Johnson V)',
  sy_kmag: 'mag (2MASS Ks)',
  sy_gaiamag: 'mag (Gaia G)',
  sy_pmra: 'mas/yr (mu_alpha* = mu_alpha cos(dec))',
  sy_pmdec: 'mas/yr',
  ra: 'deg (ICRS)',
  dec: 'deg (ICRS)',
};
// Archive TAP_SCHEMA unit strings we accept as equivalent to the units above (for drift detection).
export const ARCHIVE_UNIT_ALIASES = {
  pl_orbper: ['days'], pl_orbsmax: ['au', null], pl_orbeccen: [null], pl_orbincl: ['deg'], pl_orblper: ['deg'],
  pl_tranmid: ['days'], pl_rade: ['Earth Radius'], pl_bmasse: ['Earth Mass'], pl_dens: ['g/cm**3'],
  pl_insol: ['Earth Flux'], pl_eqt: ['K'], st_teff: ['K'], st_rad: ['Solar Radius'], st_mass: ['Solar mass'],
  st_lum: ['log(Solar)', 'log10(Solar)'], st_met: ['dex'], st_age: ['Gyr'], st_logg: ['log10(cm/s**2)'],
  sy_dist: ['pc'], sy_plx: ['mas'], sy_vmag: [null, 'mag'], sy_kmag: [null, 'mag'], sy_gaiamag: [null, 'mag'],
  sy_pmra: ['mas/yr'], sy_pmdec: ['mas/yr'], ra: ['deg'], dec: ['deg'],
};

// ---------------------------------------------------------------------------------------------
// Live freshness check (fetch.mjs --check): cheap aggregate query compared with the cached snapshot.
// ---------------------------------------------------------------------------------------------
export const ADQL_LIVE_CHECK =
  'select count(*) as n, max(rowupdate) as maxrowupdate, max(releasedate) as maxreleasedate from ps where default_flag=1';
export const LIVE_CHECK_FILE = 'live-check.json';

// ---------------------------------------------------------------------------------------------
// Gaia DR3 cross-check (fetch-gaia.mjs). VALIDATION ONLY: used to determine empirically the epoch of
// the archive's ra/dec (posEpochJyr in systems.json) and to cross-check positions/distances.
// No Gaia values are copied into the published files.
// ---------------------------------------------------------------------------------------------
export const GAIA_TAP_SYNC = 'https://gea.esac.esa.int/tap-server/tap/sync';
export const GAIA_TABLE = 'gaiadr3.gaia_source';
export const GAIA_COLUMNS = ['source_id', 'ra', 'dec', 'pmra', 'pmdec', 'parallax', 'parallax_error', 'ref_epoch', 'phot_g_mean_mag'];
export const GAIA_CHUNK = 500; // source_ids per synchronous request (keeps each result far below any sync row limit)
export const GAIA_MIN_REQUEST_INTERVAL_MS = 1500;
export const GAIA_RAW_FILE = 'gaia_dr3_hosts.csv.gz';
export const GAIA_META_FILE = 'gaia_dr3_hosts.meta.json';
export const gaiaQuery = (ids) => `SELECT ${GAIA_COLUMNS.join(', ')} FROM ${GAIA_TABLE} WHERE source_id IN (${ids.join(', ')})`;
export const GAIA_QUERY_TEMPLATE = `SELECT ${GAIA_COLUMNS.join(', ')} FROM ${GAIA_TABLE} WHERE source_id IN (<${GAIA_CHUNK} ids per request>)`;
export const GAIA_ACK =
  'This work has made use of data from the European Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national institutions, in particular the institutions participating in the Gaia Multilateral Agreement.';
export const GAIA_CITATION = 'Gaia Collaboration, Vallenari, A., et al. 2023, A&A, 674, A1 (Gaia DR3); Gaia Collaboration, Prusti, T., et al. 2016, A&A, 595, A1';
export const GAIA_LICENSE = 'Gaia data are distributed under the CC BY-NC 3.0 IGO license (ESA). Used here for non-commercial educational validation only; no Gaia values are redistributed.';
export const GAIA_LICENSE_URL = 'https://www.cosmos.esa.int/web/gaia-users/license';

// Position-epoch determination: an archive position "matches" Gaia DR3 at a trial epoch when the on-sky
// distance to the Gaia position propagated (linearly, with Gaia proper motions) to that epoch is <= this.
export const EPOCH_MATCH_MAS = 100;
export const EPOCH_FIT_MIN_SHIFT_MAS = 200; // a fitted epoch is only reported if it moves the star by more than this
export const GAIA_EPOCH = 2016.0; // Gaia DR3 reference epoch (verified per row via ref_epoch)

export const LIM_UNIT = 'flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null)';
export const REF_UNIT = 'integer: 0-based row index into references.json rows (null = no reference given)';

// ---------------------------------------------------------------------------------------------
// Citation / licence text recorded in the manifest and docs.
// ---------------------------------------------------------------------------------------------
export const ACKNOWLEDGEMENT =
  'This research has made use of the NASA Exoplanet Archive, which is operated by the California Institute of Technology, under contract with the National Aeronautics and Space Administration under the Exoplanet Exploration Program.';
export const CITATION_PAPER =
  'Christiansen, J. L., et al. 2025, "The NASA Exoplanet Archive and Exoplanet Follow-up Observing Program: Data, Tools, and Usage", Planetary Science Journal, 6, 186, doi:10.3847/PSJ/ade3c2';
export const DOI_PSCOMPPARS = '10.26133/NEA13';
export const DOI_PS = '10.26133/NEA12';
export const LICENSE_TEXT =
  'No explicit licence is published by the NASA Exoplanet Archive. The data are publicly and freely accessible (NASA-funded archive operated by Caltech/IPAC); the archive requests its standard acknowledgement, citation of Christiansen et al. (2025) and the table DOIs, and credit to the original literature references (linked per parameter in references.json). No redistribution restriction is documented; this snapshot is redistributed unmodified in value for non-commercial educational display with full attribution.';
export const LICENSE_URL = 'https://exoplanetarchive.ipac.caltech.edu/docs/acknowledge.html';
