// Runs every galactic build step (idempotent; raw downloads are cached) and writes public/data/galactic/manifest.part.json.
//   node scripts/data/galactic/build.mjs [--manifest-only]
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { ROOT, OUT, nowIso, log } from './lib.mjs';

const steps = ['build-cosmology.mjs', 'build-sgra.mjs', 'build-milkyway.mjs', 'build-landmarks.mjs', 'build-messier.mjs'];
if (!process.argv.includes('--manifest-only')) {
  for (const s of steps) { log('running', s); execFileSync(process.execPath, [`${ROOT}/scripts/data/galactic/${s}`], { stdio: 'inherit' }); }
}
const rd = (n) => JSON.parse(fs.readFileSync(`${OUT}/${n}`, 'utf8'));
const file = (n, records) => ({ path: `data/galactic/${n}`, bytes: fs.statSync(`${OUT}/${n}`).size, records });
const retrieved = nowIso();
const UA_RATE = 'SIMBAD: max 6 queries/s per IP (CDS policy); this pipeline issues < 12 queries in total';
const common = { updateCadence: 'static snapshot (published literature values); re-run build.mjs to refresh', cachePolicy: 'versioned offline snapshot; optional online refresh', retrieved };

const ds = [
  {
    id: 'galactic-cosmology-planck2018', name: 'Planck 2018 cosmological parameters + CMB temperature and dipole', organization: 'ESA / Planck Collaboration; D. J. Fixsen (NASA/GSFC)',
    purpose: 'Cosmology finale: H0, density parameters, age, last-scattering distance, observable-universe radius, CMB dipole direction',
    mechanism: 'Numbers transcribed from the authors\' arXiv TeX source (Planck 2018 VI Table 2 column TT,TE,EE+lowE+lensing+BAO; Planck 2018 I dipole; Fixsen 2009), each asserted to occur literally in the source; distances/horizon integrated numerically',
    endpoint: 'https://arxiv.org/abs/1807.06209', query: 'arXiv e-print sources 1807.06209, 1807.06205, 0911.1955 via https://export.arxiv.org/src/<id>', version: 'A&A 641, A6 (2020) / A&A 641, A1 (2020) / ApJ 707, 916 (2009)',
    license: 'Published results (facts); arXiv e-print sources used for research extraction only and not redistributed. Cite the papers.', licenseUrl: 'https://arxiv.org/help/license',
    citation: 'Planck Collaboration 2020, A&A 641, A6; Planck Collaboration 2020, A&A 641, A1; Fixsen 2009, ApJ 707, 916',
    rateLimits: 'arXiv: 1 request / 3 s (API ToU); 3 requests made', fieldsUsed: ['H0', 'Omega_m', 'Omega_Lambda', 'Omega_b h2', 'Omega_c h2', 'n_s', 'sigma_8', 'tau', 'ln(10^10 A_s)', 'age', 'z*', 'r*', 'theta_MC', 'T_CMB', 'dipole amplitude/l/b'],
    normalization: 'scripts/data/galactic/build-cosmology.mjs', fallback: 'Hard-code the same values from docs/data/galactic.md', files: [file('cosmology.json', 1)],
    limitations: 'Derived distances assume flat LCDM with Neff = 3.046 massless-equivalent species; Monte-Carlo errors ignore parameter correlations. Particle horizon includes the radiation era.', provenanceClass: 'observed', ...common,
  },
  {
    id: 'galactic-sgra-sstars', name: 'Sagittarius A* black hole and S-star orbits', organization: 'GRAVITY Collaboration (ESO VLTI); Event Horizon Telescope Collaboration; MPE (Gillessen et al.)',
    purpose: 'Sgr A* black-hole lab: mass, distance, ring size, spin status, S2 and 40 S-star Keplerian orbits',
    mechanism: 'arXiv TeX tables (GRAVITY 2019/2020/2022/2024, EHT 2022 Paper I) verified literally; Gillessen+2017 table3.dat parsed from CDS ftp',
    endpoint: 'https://cdsarc.cds.unistra.fr/ftp/J/ApJ/837/30/table3.dat', query: 'static file; arXiv e-prints 2004.07187, 2409.12261, 2112.07478, 1904.05721, 2311.08680, 1611.09144', version: 'Gillessen 2017 ApJ 837, 30 (VizieR J/ApJ/837/30); GRAVITY 2024 A&A 692, A242',
    license: 'Published results; VizieR/CDS data free for research with acknowledgement', licenseUrl: 'https://cds.unistra.fr/vizier-org/licences_vizier.html',
    citation: 'GRAVITY Collaboration 2020 A&A 636 L5; 2022 A&A 657 L12; 2024 A&A 692 A242; Gillessen et al. 2017 ApJ 837 30; EHT Collaboration 2022 ApJL 930 L12; This research used VizieR (Ochsenbein et al. 2000)',
    rateLimits: 'not documented (CDS ftp); 1 file downloaded', fieldsUsed: ['M', 'R0', 'a', 'e', 'i', 'Omega', 'omega', 'tPeri', 'P', 'ring diameter'],
    normalization: 'scripts/data/galactic/build-sgra.mjs', fallback: 'Use S2 elements only (sgra.json blackHole + s2Gravity2020)', files: [file('sgra.json', 40)],
    limitations: 'S-star elements assume R0 = 8323 pc (Gillessen 2017); only S2 is GRAVITY-precision. Spin of Sgr A* is not measured. EHT mass estimate is far less precise than stellar orbits.', provenanceClass: 'observed', ...common,
  },
  {
    id: 'galactic-milkyway-model', name: 'Milky Way structure and kinematics model', organization: 'Reid et al. 2019 (BeSSeL); Bland-Hawthorn & Gerhard 2016; Wegg et al. 2015; Portail et al. 2017; Eilers et al. 2019; Bennett & Bovy 2019; Drimmel & Spergel 2001',
    purpose: 'Reconstructed Milky Way: Sun position/motion, spiral arms (Reid log-spirals with kinks), bar, bulge, disks, halo, dust, masses, frame rotation matrix',
    mechanism: 'arXiv TeX tables/text literal-verified; spiral centre lines generated from Table 2 parameters', endpoint: 'https://arxiv.org/abs/1910.03357', query: 'arXiv e-prints 1910.03357, 1602.07702, 1809.03507, 1504.01401, 1608.07954, 1810.09466, 0912.3693, 1407.1078, astro-ph/0101259, 1804.03064',
    version: 'see references block in milkyway.json', license: 'Published results (facts); cite the papers', licenseUrl: null,
    citation: 'Reid et al. 2019 ApJ 885, 131; Bland-Hawthorn & Gerhard 2016 ARA&A 54, 529; Wegg et al. 2015 MNRAS 450, 4050; Portail et al. 2017 MNRAS 465, 1621; Eilers et al. 2019 ApJ 871, 120; Bennett & Bovy 2019 MNRAS 482, 1417; Drimmel & Spergel 2001 ApJ 556, 181; ESA 1997 Hipparcos SP-1200',
    rateLimits: 'arXiv 1 request / 3 s', fieldsUsed: ['spiral arm parameters', 'R0', 'z_sun', 'Theta0', 'U,V,W', 'bar half-length/angle', 'disk scale lengths/heights', 'stellar mass'],
    normalization: 'scripts/data/galactic/build-milkyway.mjs', fallback: 'Draw a generic 4-arm logarithmic spiral', files: [file('milkyway.json', 1)],
    limitations: 'Reconstruction: spiral arm shape beyond the maser-sampled azimuth range and the far side of the Galaxy are inferred. Star count is illustrative. Quoted uncertainties are published statistical errors.', provenanceClass: 'reconstructed', ...common,
  },
  {
    id: 'galactic-landmarks', name: 'Milky Way landmarks (globular clusters, nebulae, clusters, black holes, pulsars)', organization: 'W. E. Harris (McMaster); H. Baumgardt & E. Vasiliev; CDS (SIMBAD, VizieR); T. Hunt & S. Reffert',
    purpose: 'Search/fly-to targets with 3D positions', mechanism: 'Harris 2010 catalogue text file + Baumgardt & Vasiliev table download; SIMBAD TAP ADQL for positions and mesDistance; VizieR ASU for Hunt & Reffert 2023',
    endpoint: 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync', query: 'see scripts/data/galactic/build-landmarks.mjs (ADQL JOIN ident/basic/mesDistance); https://physwww.mcmaster.ca/~harris/mwgc.dat; https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt; VizieR J/A+A/673/A114/clusters',
    version: 'SIMBAD/VizieR live state at retrieval; Harris Dec 2010; BV21', license: 'Free for research; acknowledge SIMBAD/VizieR (CDS), Harris 1996, Baumgardt & Vasiliev 2021', licenseUrl: 'https://cds.unistra.fr/vizier-org/licences_vizier.html',
    citation: 'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France (Wenger et al. 2000). Harris 1996 AJ 112, 1487 (2010 edition). Baumgardt & Vasiliev 2021 MNRAS 505, 5957. Hunt & Reffert 2023 A&A 673, A114. Kuhn et al. 2019 ApJ 870, 32. Zucker et al. 2020 A&A 633, A51.',
    rateLimits: UA_RATE, fieldsUsed: ['ra', 'dec', 'distance', 'distance error', 'otype', '[Fe/H]'], normalization: 'scripts/data/galactic/build-landmarks.mjs', fallback: 'Show only the 157 Harris globular clusters', files: [file('landmarks.json', rd('landmarks.json').count)],
    limitations: 'Distances are statistical-error-only; some curated distances (Horsehead, Crab, Arches/Quintuplet) are approximate by construction; nebula distances are those of their young clusters.', provenanceClass: 'observed', ...common,
  },
  {
    id: 'galactic-messier', name: 'Messier catalogue (110 objects)', organization: 'CDS (SIMBAD); M. Verga (OpenNGC)', purpose: 'Messier object search with positions, types, magnitudes and distances',
    mechanism: 'SIMBAD TAP sync ADQL -> JSON (basic, ident, mesDistance, allfluxes); OpenNGC CSV for missing magnitudes', endpoint: 'https://simbad.cds.unistra.fr/simbad/sim-tap/sync',
    query: 'SELECT ... FROM ident JOIN basic/mesDistance/allfluxes WHERE ident.id IN (\'M 1\',...,\'M 110\'); https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files/NGC.csv',
    version: 'SIMBAD live state at retrieval; OpenNGC master', license: 'SIMBAD: free with acknowledgement; OpenNGC: CC BY-SA 4.0 (magnitudes for gap objects only)', licenseUrl: 'https://creativecommons.org/licenses/by-sa/4.0/',
    citation: 'This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France (Wenger et al. 2000). OpenNGC by Mattia Verga (CC BY-SA 4.0).',
    rateLimits: UA_RATE, fieldsUsed: ['main_id', 'ra', 'dec', 'otype', 'morph_type', 'V', 'B', 'mesDistance'], normalization: 'scripts/data/galactic/build-messier.mjs', fallback: 'Use SIMBAD main ids only', files: [file('messier.json', rd('messier.json').count)],
    limitations: 'Distance = most recent literature entry with uncertainty (not a weighted mean); apparent magnitudes of extended objects are catalogue-dependent; M40/M45/M73/M24 are not ordinary deep-sky objects; some magnitudes are null.', provenanceClass: 'observed', ...common,
  },
];
fs.writeFileSync(`${OUT}/manifest.part.json`, JSON.stringify({ domain: 'galactic', datasets: ds }));
log('manifest.part.json written,', ds.length, 'datasets');
