// Validates all galaxies outputs and writes public/data/galaxies/manifest.part.json.
import fs from 'node:fs';
import { OUT_DIR, comovingDistanceSimpson, log, fail, isoNow } from './lib.mjs';

const rd = (n) => JSON.parse(fs.readFileSync(`${OUT_DIR}/${n}`, 'utf8'));
const size = (n) => fs.statSync(`${OUT_DIR}/${n}`).size;

// ---- validation
const d01 = comovingDistanceSimpson(0.1);
log('D_C(z=0.1) =', d01.toFixed(2), 'Mpc (Planck18 H0=67.66 Om=0.3111)');
if (Math.abs(d01 - 432.6) > 1.5) fail('comoving distance check failed');

for (const n of ['cosmicweb-2mrs', 'cosmicweb-deep', 'cosmicweb-deep-lrg']) {
  const h = rd(`${n}.json`);
  const buf = fs.readFileSync(`${OUT_DIR}/${h.file}`);
  if (buf.length !== h.byteLength || h.count * h.stride * 4 !== buf.length) fail(`${n}: size mismatch`);
  const f = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
  let bad = 0, maxR = 0, zmax = 0, zmin = 1e9;
  for (let i = 0; i < h.count; i++) {
    const o = i * h.stride;
    const r = Math.hypot(f[o], f[o + 1], f[o + 2]);
    for (let k = 0; k < h.stride; k++) if (!Number.isFinite(f[o + k])) bad++;
    maxR = Math.max(maxR, r); zmax = Math.max(zmax, f[o + 3]); zmin = Math.min(zmin, f[o + 3]);
    // radial distance must equal D_C(z) (checked on a subsample)
    if (i % 5003 === 0) {
      const dc = comovingDistanceSimpson(f[o + 3]);
      if (Math.abs(dc - r) > 0.01 * dc + 0.05) fail(`${n}: |r|=${r} != D_C(z)=${dc} at ${i}`);
    }
  }
  if (bad) fail(`${n}: ${bad} non-finite values`);
  log(n, h.count, 'pts; zmin', zmin.toFixed(4), 'zmax', zmax.toFixed(3), 'maxR', maxR.toFixed(0), 'Mpc');
}
const loc = rd('local.json'), li = Object.fromEntries(loc.fields.map((f, i) => [f, i]));
const m31 = loc.rows.find((r) => r[0] === 'M31');
if (Math.abs(m31[li.distMpc] - 0.77) > 0.02) fail('M31 distance');
const fam = rd('famous.json'), st = rd('structures.json');
const virgo = st.rows.find((r) => r[0] === 'virgo');
if (virgo[6] !== 16.5) fail('Virgo distance');
const m87 = fam.rows.find((r) => r[0] === 'm87');
if (m87[5] !== 16.5) fail('M87 distance');
for (const t of [loc, fam, st]) for (const r of t.rows) if (r.length !== t.fields.length) fail('row length mismatch');
log('validation OK: local', loc.rows.length, 'famous', fam.rows.length, 'structures', st.rows.length);

// ---- manifest
const now = isoNow();
const UA = 'Cosmos/0.1';
const vizier = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';
const ungcMeta = JSON.parse(fs.readFileSync(`${OUT_DIR}/../../../data-raw/galaxies/_meta/ungc.json`, 'utf8'));
const hu = JSON.parse(fs.readFileSync(`${OUT_DIR}/../../../data-raw/galaxies/_meta/huchra-2012-2mrs.json`, 'utf8'));
const desiFiles = (n) => [{ path: `data/galaxies/${n}.bin`, bytes: size(`${n}.bin`), records: rd(`${n}.json`).count }, { path: `data/galaxies/${n}.json`, bytes: size(`${n}.json`), records: null }];
const DESI_LICENSE = 'DESI DR1 public data: Creative Commons Attribution 4.0 (CC BY 4.0) per the DESI DR1 data-release terms (https://data.desi.lbl.gov/doc/acknowledgments/); acknowledge DESI as requested.';
const DESI_CITE = 'DESI Collaboration et al. 2026, AJ 171, 285 (Data Release 1 of DESI); Ross et al. 2025, JCAP 01, 125. This research used data obtained with the Dark Energy Spectroscopic Instrument (DESI); see https://data.desi.lbl.gov/doc/acknowledgments/.';
const common = { retrieved: now, provenanceClass: 'observed' };
const manifest = {
  domain: 'galaxies',
  datasets: [
    { id: 'ungc-local-volume', name: 'Updated Nearby Galaxy Catalog (UNGC)', organization: 'Karachentsev, Makarov & Kaisina (SAO RAS) via CDS VizieR',
      purpose: 'Local-volume galaxy impostors (~11 Mpc) with positions, distances, sizes, inclinations, velocities',
      mechanism: 'VizieR ASU TSV (J/AJ/145/101/catalog) -> JSON table', endpoint: vizier,
      query: ungcMeta.urls[0].replace(vizier + '?', ''), version: 'J/AJ/145/101 (Karachentsev et al. 2013)', retrieved: ungcMeta.retrieved,
      license: 'CDS VizieR catalogue data: free scientific use with acknowledgement of the original paper and CDS.', licenseUrl: 'https://cds.unistra.fr/vizier-org/licences_vizier.html',
      citation: 'Karachentsev, Makarov & Kaisina 2013, AJ 145, 101; data via VizieR (Ochsenbein et al. 2000, A&AS 143, 23).',
      rateLimits: 'not documented (queried once, cached)', fieldsUsed: ['Name', 'RAJ2000', 'DEJ2000', 'a26', 'Bmag', 'Kmag', 'W50', 'TT', 'Mcl', 'HRV', 'Dist', 'A26', 'i', 'M26', 'MHI', 'Vlg', 'Ti1', 'SimbadName', 'NEDname'],
      updateCadence: 'static (published 2013)', cachePolicy: 'versioned offline snapshot; optional online refresh', normalization: 'scripts/data/galaxies/fetch-local.mjs',
      fallback: 'Render only the famous.json galaxies', files: [{ path: 'data/galaxies/local.json', bytes: size('local.json'), records: loc.rows.length }],
      limitations: 'Distances have heterogeneous methods (TRGB, Cepheids, SBF, Tully-Fisher, velocity) and no per-object error in this table; absMagB derived from apparent B without extinction correction; logMstar assumes M/L_K=0.6 (illustrative); no group membership (tidalIndex only).',
      provenanceClass: 'observed' },
    { id: 'galaxies-famous-curated', name: 'Curated famous galaxies', organization: 'Cosmos project (literature compilation)',
      purpose: 'Orientation, size and distance for the rich procedural reconstructions', mechanism: 'hand-entered literature values; UNGC positions where available',
      endpoint: 'literature (per-row references in the file)', query: null, version: 'compiled 2026-10', retrieved: now,
      license: 'Facts from published papers, cited per row; compilation CC0.', licenseUrl: null,
      citation: 'See distRef / orientationRef / bhRef per row (McConnachie 2012; Karachentsev+2013; Pietrzynski+2019; EHT 2019; others).',
      rateLimits: 'n/a', fieldsUsed: [], updateCadence: 'static', cachePolicy: 'bundled', normalization: 'scripts/data/galaxies/build-curated.mjs',
      fallback: 'use local.json rows', files: [{ path: 'data/galaxies/famous.json', bytes: size('famous.json'), records: fam.rows.length }],
      limitations: 'Inclination/PA are single literature values (mixed methods); null where not reliably known. Not re-verified against the original papers in this run beyond recall - treat as best-effort.',
      provenanceClass: 'observed' },
    { id: 'galaxies-structures-curated', name: 'Groups, clusters, superclusters and voids', organization: 'Cosmos project (literature compilation)',
      purpose: 'Labels for large-scale structure at multiple scales', mechanism: 'hand-entered literature values', endpoint: 'literature (refs per row)', query: null,
      version: 'compiled 2026-10', retrieved: now, license: 'Facts from published papers, cited per row; compilation CC0.', licenseUrl: null,
      citation: 'See refs per row (Abell 1958; Tully+2014; Kraan-Korteweg+1996; Geller & Huchra 1989; Gott+2005; ...)', rateLimits: 'n/a', fieldsUsed: [],
      updateCadence: 'static', cachePolicy: 'bundled', normalization: 'scripts/data/galaxies/build-curated.mjs', fallback: 'hide labels',
      files: [{ path: 'data/galaxies/structures.json', bytes: size('structures.json'), records: st.rows.length }],
      limitations: 'Centres of voids, superclusters and walls are approximate (positionQuality="approximate"); membership counts are indicative. Distances from redshift use the Planck18 comoving distance.',
      provenanceClass: 'derived' },
    { id: 'galaxies-2mrs', name: '2MASS Redshift Survey (2MRS)', organization: 'Huchra et al. (CfA/2MASS) via CDS VizieR',
      purpose: 'Local cosmic-web point cloud (z<~0.1)', mechanism: 'VizieR ASU TSV (J/ApJS/199/26/table3) -> comoving Cartesian Float32',
      endpoint: vizier, query: hu.query, version: 'J/ApJS/199/26', retrieved: hu.retrieved,
      license: 'CDS VizieR catalogue data: free scientific use with acknowledgement of the original paper and CDS.', licenseUrl: 'https://cds.unistra.fr/vizier-org/licences_vizier.html',
      citation: 'Huchra et al. 2012, ApJS 199, 26; Skrutskie et al. 2006 (2MASS); data via VizieR.', rateLimits: 'not documented (queried once, cached)',
      fieldsUsed: ['ID', 'GLON', 'GLAT', 'Kcmag', 'Ktmag', 'cz'], updateCadence: 'static', cachePolicy: 'versioned offline snapshot; optional online refresh',
      normalization: 'scripts/data/galaxies/fetch-2mrs.mjs', fallback: 'use the deep DESI sample only',
      files: [{ path: 'data/galaxies/cosmicweb-2mrs.bin', bytes: size('cosmicweb-2mrs.bin'), records: 43508 }, { path: 'data/galaxies/cosmicweb-2mrs.json', bytes: size('cosmicweb-2mrs.json'), records: null }, { path: 'data/galaxies/cosmicweb-2mrs-meta.json', bytes: size('cosmicweb-2mrs-meta.json'), records: null }],
      limitations: 'Zone of Avoidance (|b|<5 deg) empty; redshift-space distortions (fingers of God); distances from CMB-frame redshift, unreliable below z~0.003 (peculiar velocities); magnitude-limited (Ks<=11.75).',
      provenanceClass: 'observed' },
    { id: 'galaxies-desi-dr1-bgs', name: 'DESI DR1 BGS Bright clustering catalogue (sampled)', organization: 'DESI Collaboration / NOIRLab-LBNL',
      purpose: 'Deep cosmic-web reveal (0.01<z<0.6, ~1.8 M galaxies)', mechanism: 'HTTP download of LSS clustering .dat FITS (NGC+SGC) -> comoving Cartesian Float32, random subsample',
      endpoint: 'https://data.desi.lbl.gov/public/dr1/survey/catalogs/dr1/LSS/iron/LSScats/v1.5/', query: 'BGS_BRIGHT_{NGC,SGC}_clustering.dat.fits columns RA,DEC,Z,flux_{g,r,z}_dered',
      version: 'DESI DR1 (iron) LSS catalogs v1.5', retrieved: '2026-10-17T06:37:58Z', license: DESI_LICENSE, licenseUrl: 'https://data.desi.lbl.gov/doc/acknowledgments/',
      citation: DESI_CITE, rateLimits: 'not documented (4 files downloaded, SHA-256 verified)', fieldsUsed: ['RA', 'DEC', 'Z', 'flux_g_dered', 'flux_r_dered', 'flux_z_dered'],
      updateCadence: 'per data release', cachePolicy: 'versioned offline snapshot', normalization: 'scripts/data/galaxies/fetch-desi.mjs',
      fallback: 'use 2MRS cloud', files: desiFiles('cosmicweb-deep'),
      limitations: 'Partial sky (two caps -> wedges); clustering weights/completeness not applied; random subsample 45.5%; redshift-space distortions; BGS colour field is g-r AB (see header).',
      provenanceClass: 'observed' },
    { id: 'galaxies-desi-dr1-lrg', name: 'DESI DR1 LRG clustering catalogue (sampled)', organization: 'DESI Collaboration / NOIRLab-LBNL',
      purpose: 'Deeper cosmic-web layer (0.4<z<1.1 luminous red galaxies)', mechanism: 'HTTP download of LSS clustering .dat FITS (NGC+SGC) -> comoving Cartesian Float32, random subsample',
      endpoint: 'https://data.desi.lbl.gov/public/dr1/survey/catalogs/dr1/LSS/iron/LSScats/v1.5/', query: 'LRG_{NGC,SGC}_clustering.dat.fits columns RA,DEC,Z',
      version: 'DESI DR1 (iron) LSS catalogs v1.5', retrieved: '2026-10-17T06:39:27Z', license: DESI_LICENSE, licenseUrl: 'https://data.desi.lbl.gov/doc/acknowledgments/',
      citation: DESI_CITE, rateLimits: 'not documented', fieldsUsed: ['RA', 'DEC', 'Z'], updateCadence: 'per data release', cachePolicy: 'versioned offline snapshot',
      normalization: 'scripts/data/galaxies/fetch-desi.mjs', fallback: 'omit layer', files: desiFiles('cosmicweb-deep-lrg'),
      limitations: 'Partial sky; weights not applied; random subsample 18.7%.', provenanceClass: 'observed' },
  ].map((d) => ({ ...common, ...d })),
};
fs.writeFileSync(`${OUT_DIR}/manifest.part.json`, JSON.stringify(manifest));
log('manifest written;', manifest.datasets.length, 'datasets');
