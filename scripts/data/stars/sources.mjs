// Single source of truth for the "stars" domain: upstream pins, raw cache file names and the
// provenance / licence / citation metadata reused by build headers, manifest.part.json and docs.

/** Upstream pins. Update deliberately (then re-run run-all.mjs + validate.mjs). */
export const PINS = {
  hyg: {
    version: 'HYG v4.4',
    repo: 'https://codeberg.org/astronexus/hyg',
    commit: '53e3df311869e813ace5f1ad2ec4ce909f13256c', // 2026-07-12 "Add p Eridani labeling change to HYG gzip"
    path: 'data/hyg/CURRENT/hyg_v44.csv.gz',
    lfsSha256: '00b349893b9a53106dd488d8371e8d2fa586043e500bb3cdb8bff3931682197d',
    bytes: 13636362,
  },
  stellarium: {
    repo: 'https://github.com/Stellarium/stellarium',
    commit: 'dc5679c9723685585196c4d6ecd7ffd33da59ecd', // 2026-06-18, last change to skycultures/modern_iau/index.json
    culture: 'modern_iau',
  },
  vi49: { base: 'https://cdsarc.cds.unistra.fr/ftp/VI/49/' },
  wgsn: {
    current: 'https://exopla.net/star-names/modern-iau-star-names/',
    legacyTxt: 'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
  },
  gcns: {
    tap: 'https://gea.esac.esa.int/tap-server/tap',
    table: 'external.gaiaedr3_gcns_main_1',
    expectedRows: 331312,
  },
};

export const RAW = {
  hyg: 'hyg_v44.csv.gz',
  stellariumIndex: 'stellarium_modern_iau_index.json',
  stellariumDescription: 'stellarium_modern_iau_description.md',
  vi49Bound20: 'vi49_bound_20.dat.gz',
  vi49ReadMe: 'vi49_ReadMe.txt',
  wgsnHtml: 'iau_csn_wgsn_current.html',
  wgsnLegacyTxt: 'iau_csn_legacy_2022.txt',
  gcnsCsv: 'gcns_gaia_archive.csv',
};

export const GCNS_COLUMNS = [
  'source_id', 'ra', 'dec', 'parallax', 'parallax_error',
  'phot_g_mean_mag', 'phot_bp_mean_mag', 'phot_rp_mean_mag',
  'dist_16', 'dist_50', 'dist_84', 'gcns_prob', 'wd_prob', 'ruwe',
];
export const GCNS_QUERY = `SELECT ${GCNS_COLUMNS.join(', ')} FROM ${PINS.gcns.table}`;

export const OUT = {
  starsBin: 'stars.bin',
  starsHeader: 'stars.json',
  named: 'stars-named.json',
  hipIndex: 'hip-index.json',
  systems: 'star-systems.json',
  constellations: 'constellations.json',
  gcnsBin: 'gaia-gcns.bin',
  gcnsHeader: 'gaia-gcns.json',
  manifest: 'manifest.part.json',
};

export const HYG_CITATION =
  'HYG Database v4.4, David Nash / Astronexus (https://codeberg.org/astronexus/hyg), licensed CC BY-SA 4.0. ' +
  'Compiled from the Hipparcos catalogue (ESA 1997; new reduction van Leeuwen 2007), the Yale Bright Star Catalogue (5th ed.) ' +
  'and the Gliese Catalogue of Nearby Stars (3rd ed.).';

export const STELLARIUM_CITATION =
  'Constellation figures: Stellarium sky culture "modern_iau" (Stellarium team; figures after the IAU / Sky & Telescope ' +
  'constellation charts by Roger Sinnott, Rick Fienberg and Alan MacRobert), CC BY-SA 4.0, https://github.com/Stellarium/stellarium.';

export const VI49_CITATION =
  'Constellation boundaries: Davenhall A.C., Leggett S.K. 1989, "Catalogue of Constellation Boundary Data", CDS VizieR VI/49 ' +
  '(1997yCat.6049....0D), after Delporte E. 1930, "Delimitation scientifique des constellations". This research has made use of ' +
  'the VizieR catalogue access tool, CDS, Strasbourg, France (DOI: 10.26093/cds/vizier).';

export const WGSN_CITATION =
  'Star names: IAU Catalog of Star Names (IAU-CSN), IAU Division C Working Group on Star Names (WGSN), ' +
  'https://exopla.net/star-names/modern-iau-star-names/ (linked from iau.org).';

export const IAU_NAMES_CITATION =
  'Constellation names, abbreviations and genitives: International Astronomical Union, "The Constellations", ' +
  'https://iauarchive.eso.org/public/themes/constellations/.';

export const GCNS_CITATION =
  'Gaia Collaboration, Smart R.L., Sarro L.M., et al. 2021, "Gaia Early Data Release 3: The Gaia Catalogue of Nearby Stars", ' +
  'A&A 649, A6 (doi:10.1051/0004-6361/202039498). Credit: ESA/Gaia/DPAC. This work has made use of data from the European ' +
  'Space Agency (ESA) mission Gaia (https://www.cosmos.esa.int/gaia), processed by the Gaia Data Processing and Analysis ' +
  'Consortium (DPAC, https://www.cosmos.esa.int/web/gaia/dpac/consortium). Funding for the DPAC has been provided by national ' +
  'institutions, in particular the institutions participating in the Gaia Multilateral Agreement.';
