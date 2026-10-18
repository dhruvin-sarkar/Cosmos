// Bibliography for the galactic domain. Every number in the galactic outputs carries one of these keys.
// DOIs / bibcodes were checked against Crossref / ADS / arXiv at retrieval time (see docs/data/galactic.md).
// `arxiv` ids are used by verify-sources.mjs to confirm transcribed literals against the authors' TeX source.

export const REFS = {
  // ---------------------------------------------------------------- Sgr A* / S-stars
  gravity2024: {
    short: 'GRAVITY Collaboration 2024',
    citation: 'GRAVITY Collaboration: Abd El Dayem K., Abuter R., Aimar N., et al. 2024, "Improving constraints on the extended mass distribution in the Galactic Center with stellar orbits", A&A, 692, A242',
    doi: '10.1051/0004-6361/202452274', bibcode: '2024A&A...692A.242G', arxiv: '2409.12261',
  },
  gravity2022: {
    short: 'GRAVITY Collaboration 2022',
    citation: 'GRAVITY Collaboration: Abuter R., Aimar N., Amorim A., et al. 2022, "Mass distribution in the Galactic Center based on interferometric astrometry of multiple stellar orbits", A&A, 657, L12',
    doi: '10.1051/0004-6361/202142465', bibcode: '2022A&A...657L..12G', arxiv: '2112.07478',
  },
  gravity2021: {
    short: 'GRAVITY Collaboration 2021',
    citation: 'GRAVITY Collaboration: Abuter R., Amorim A., Bauböck M., et al. 2021, "Improved GRAVITY astrometric accuracy from modeling optical aberrations", A&A, 647, A59',
    doi: '10.1051/0004-6361/202040208', bibcode: '2021A&A...647A..59G', arxiv: '2101.12098',
  },
  gravity2020: {
    short: 'GRAVITY Collaboration 2020',
    citation: 'GRAVITY Collaboration: Abuter R., Amorim A., Bauböck M., et al. 2020, "Detection of the Schwarzschild precession in the orbit of the star S2 near the Galactic centre massive black hole", A&A, 636, L5',
    doi: '10.1051/0004-6361/202037813', bibcode: '2020A&A...636L...5G', arxiv: '2004.07187',
  },
  gravity2019: {
    short: 'GRAVITY Collaboration 2019',
    citation: 'GRAVITY Collaboration: Abuter R., Amorim A., Bauböck M., et al. 2019, "A geometric distance measurement to the Galactic center black hole with 0.3% uncertainty", A&A, 625, L10',
    doi: '10.1051/0004-6361/201935656', bibcode: '2019A&A...625L..10G', arxiv: '1904.05721',
  },
  gillessen2017: {
    short: 'Gillessen et al. 2017',
    citation: 'Gillessen S., Plewa P. M., Eisenhauer F., et al. 2017, "An Update on Monitoring Stellar Orbits in the Galactic Center", ApJ, 837, 30 (VizieR J/ApJ/837/30)',
    doi: '10.3847/1538-4357/aa5c41', bibcode: '2017ApJ...837...30G', arxiv: '1611.09144',
  },
  do2019: {
    short: 'Do et al. 2019',
    citation: 'Do T., Hees A., Ghez A., et al. 2019, "Relativistic redshift of the star S0-2 orbiting the Galactic Center supermassive black hole", Science, 365, 664',
    doi: '10.1126/science.aav8137', bibcode: '2019Sci...365..664D', arxiv: '1907.10731',
  },
  eht2022a: {
    short: 'EHT Collaboration 2022, Paper I',
    citation: 'Event Horizon Telescope Collaboration: Akiyama K., Alberdi A., Alef W., et al. 2022, "First Sagittarius A* Event Horizon Telescope Results. I. The Shadow of the Supermassive Black Hole in the Center of the Milky Way", ApJL, 930, L12',
    doi: '10.3847/2041-8213/ac6674', bibcode: '2022ApJ...930L..12E', arxiv: '2311.08680',
  },
  eht2022e: {
    short: 'EHT Collaboration 2022, Paper V',
    citation: 'Event Horizon Telescope Collaboration: Akiyama K., et al. 2022, "First Sagittarius A* Event Horizon Telescope Results. V. Testing Astrophysical Models of the Galactic Center Black Hole", ApJL, 930, L16',
    doi: '10.3847/2041-8213/ac6672', bibcode: '2022ApJ...930L..16E', arxiv: '2311.09478',
  },
  eht2022f: {
    short: 'EHT Collaboration 2022, Paper VI',
    citation: 'Event Horizon Telescope Collaboration: Akiyama K., et al. 2022, "First Sagittarius A* Event Horizon Telescope Results. VI. Testing the Black Hole Metric", ApJL, 930, L17',
    doi: '10.3847/2041-8213/ac6756', bibcode: '2022ApJ...930L..17E', arxiv: '2311.09484',
  },
  reidBrunthaler2004: {
    short: 'Reid & Brunthaler 2004',
    citation: 'Reid M. J., Brunthaler A. 2004, "The Proper Motion of Sagittarius A*. II. The Mass of Sagittarius A*", ApJ, 616, 872',
    doi: '10.1086/424960', bibcode: '2004ApJ...616..872R', arxiv: 'astro-ph/0408107',
  },
  reidBrunthaler2020: {
    short: 'Reid & Brunthaler 2020',
    citation: 'Reid M. J., Brunthaler A. 2020, "The Proper Motion of Sagittarius A*. III. The Case for a Supermassive Black Hole", ApJ, 892, 39',
    doi: '10.3847/1538-4357/ab76cd', bibcode: '2020ApJ...892...39R', arxiv: '2001.04386',
  },
  codata2018: {
    short: 'CODATA 2018',
    citation: 'Tiesinga E., Mohr P. J., Newell D. B., Taylor B. N. 2021, "CODATA recommended values of the fundamental physical constants: 2018", Rev. Mod. Phys., 93, 025010',
    doi: '10.1103/RevModPhys.93.025010', bibcode: '2021RvMP...93b5010T', arxiv: null,
  },
  iau2015b3: {
    short: 'IAU 2015 Resolution B3',
    citation: 'Prša A., Harmanec P., Torres G., et al. 2016, "Nominal Values for Selected Solar and Planetary Quantities: IAU 2015 Resolution B3", AJ, 152, 41',
    doi: '10.3847/0004-6256/152/2/41', bibcode: '2016AJ....152...41P', arxiv: '1605.09788',
  },
  iau2012b2: {
    short: 'IAU 2012 Resolution B2',
    citation: 'IAU 2012 Resolution B2 on the re-definition of the astronomical unit of length (au = 149 597 870 700 m exactly); parsec defined by IAU 2015 Resolution B2 (1 pc = 648000/pi au)',
    doi: null, bibcode: null, arxiv: null, url: 'https://www.iau.org/static/resolutions/IAU2012_English.pdf',
  },

  // ---------------------------------------------------------------- Milky Way structure
  reid2019: {
    short: 'Reid et al. 2019',
    citation: 'Reid M. J., Menten K. M., Brunthaler A., et al. 2019, "Trigonometric Parallaxes of High-mass Star-forming Regions: Our View of the Milky Way", ApJ, 885, 131',
    doi: '10.3847/1538-4357/ab4a11', bibcode: '2019ApJ...885..131R', arxiv: '1910.03357',
  },
  bennettBovy2019: {
    short: 'Bennett & Bovy 2019',
    citation: 'Bennett M., Bovy J. 2019, "Vertical waves in the solar neighbourhood in Gaia DR2", MNRAS, 482, 1417',
    doi: '10.1093/mnras/sty2813', bibcode: '2019MNRAS.482.1417B', arxiv: '1809.03507',
  },
  schoenrich2010: {
    short: 'Schönrich, Binney & Dehnen 2010',
    citation: 'Schönrich R., Binney J., Dehnen W. 2010, "Local kinematics and the local standard of rest", MNRAS, 403, 1829',
    doi: '10.1111/j.1365-2966.2010.16253.x', bibcode: '2010MNRAS.403.1829S', arxiv: '0912.3693',
  },
  eilers2019: {
    short: 'Eilers et al. 2019',
    citation: 'Eilers A.-C., Hogg D. W., Rix H.-W., Ness M. K. 2019, "The Circular Velocity Curve of the Milky Way from 5 to 25 kpc", ApJ, 871, 120',
    doi: '10.3847/1538-4357/aaf648', bibcode: '2019ApJ...871..120E', arxiv: '1810.09466',
  },
  wegg2015: {
    short: 'Wegg, Gerhard & Portail 2015',
    citation: "Wegg C., Gerhard O., Portail M. 2015, \"The structure of the Milky Way's bar outside the bulge\", MNRAS, 450, 4050",
    doi: '10.1093/mnras/stv745', bibcode: '2015MNRAS.450.4050W', arxiv: '1504.01401',
  },
  portail2017: {
    short: 'Portail et al. 2017',
    citation: "Portail M., Gerhard O., Wegg C., Ness M. 2017, \"Dynamical modelling of the galactic bulge and bar: the Milky Way's pattern speed, stellar and dark matter mass distribution\", MNRAS, 465, 1621",
    doi: '10.1093/mnras/stw2819', bibcode: '2017MNRAS.465.1621P', arxiv: '1608.07954',
  },
  bhg2016: {
    short: 'Bland-Hawthorn & Gerhard 2016',
    citation: 'Bland-Hawthorn J., Gerhard O. 2016, "The Galaxy in Context: Structural, Kinematic, and Integrated Properties", ARA&A, 54, 529',
    doi: '10.1146/annurev-astro-081915-023441', bibcode: '2016ARA&A..54..529B', arxiv: '1602.07702',
  },
  licquiaNewman2015: {
    short: 'Licquia & Newman 2015',
    citation: "Licquia T. C., Newman J. A. 2015, \"Improved Estimates of the Milky Way's Stellar Mass and Star Formation Rate from Hierarchical Bayesian Meta-Analysis\", ApJ, 806, 96",
    doi: '10.1088/0004-637X/806/1/96', bibcode: '2015ApJ...806...96L', arxiv: '1407.1078',
  },
  deason2019: {
    short: 'Deason, Belokurov & Sanders 2019',
    citation: 'Deason A. J., Belokurov V., Sanders J. L. 2019, "The total stellar halo mass of the Milky Way", MNRAS, 490, 3426',
    doi: '10.1093/mnras/stz2793', bibcode: '2019MNRAS.490.3426D', arxiv: '1908.02763',
  },
  drimmelSpergel2001: {
    short: 'Drimmel & Spergel 2001',
    citation: 'Drimmel R., Spergel D. N. 2001, "Three-dimensional Structure of the Milky Way Disk: The Distribution of Stars and Dust beyond 0.35 R_sun", ApJ, 556, 181',
    doi: '10.1086/321556', bibcode: '2001ApJ...556..181D', arxiv: 'astro-ph/0101259',
  },
  lopezCorredoira2018: {
    short: 'López-Corredoira et al. 2018',
    citation: 'López-Corredoira M., Allende Prieto C., Garzón F., et al. 2018, "Disk stars in the Milky Way detected beyond 25 kpc from its center", A&A, 612, L8',
    doi: '10.1051/0004-6361/201832880', bibcode: '2018A&A...612L...8L', arxiv: '1804.03064',
  },
  hipparcos1997: {
    short: 'ESA 1997 (Hipparcos)',
    citation: 'ESA 1997, The Hipparcos and Tycho Catalogues, ESA SP-1200, Vol. 1, Section 1.5.3 (Galactic coordinates), Eq. 1.5.11',
    doi: null, bibcode: '1997ESASP1200.....E', arxiv: null, url: 'https://www.cosmos.esa.int/web/hipparcos/catalogues',
  },

  // ---------------------------------------------------------------- catalogues
  harris1996: {
    short: 'Harris 1996 (2010 edition)',
    citation: 'Harris W. E. 1996, "A Catalog of Parameters for Globular Clusters in the Milky Way", AJ, 112, 1487 — 2010 edition (arXiv:1012.3224), file mwgc.dat (revision December 2010)',
    doi: '10.1086/118116', bibcode: '1996AJ....112.1487H', arxiv: null, url: 'https://physics.mcmaster.ca/~harris/mwgc.dat',
  },
  baumgardtVasiliev2021: {
    short: 'Baumgardt & Vasiliev 2021',
    citation: 'Baumgardt H., Vasiliev E. 2021, "Accurate distances to Galactic globular clusters through a combination of Gaia EDR3, HST, and literature data", MNRAS, 505, 5957 (values from the Baumgardt et al. Galactic globular cluster database, 4th version, Mar 2023)',
    doi: '10.1093/mnras/stab1474', bibcode: '2021MNRAS.505.5957B', arxiv: '2105.09526', url: 'https://people.smp.uq.edu.au/HolgerBaumgardt/globular/',
  },
  huntReffert2023: {
    short: 'Hunt & Reffert 2023',
    citation: 'Hunt E. L., Reffert S. 2023, "Improving the open cluster census. II. An all-sky cluster catalogue with Gaia DR3", A&A, 673, A114 (VizieR J/A+A/673/A114)',
    doi: '10.1051/0004-6361/202346285', bibcode: '2023A&A...673A.114H', arxiv: '2303.13424',
  },
  kuhn2019: {
    short: 'Kuhn et al. 2019',
    citation: 'Kuhn M. A., Hillenbrand L. A., Sills A., Feigelson E. D., Getman K. V. 2019, "Kinematics in Young Star Clusters and Associations with Gaia DR2", ApJ, 870, 32 (VizieR J/ApJ/870/32)',
    doi: '10.3847/1538-4357/aaef8c', bibcode: '2019ApJ...870...32K', arxiv: '1807.02115',
  },
  tully2023: {
    short: 'Tully et al. 2023 (Cosmicflows-4)',
    citation: 'Tully R. B., Kourkchi E., Courtois H. M., et al. 2023, "Cosmicflows-4", ApJ, 944, 94 (VizieR J/ApJ/944/94)',
    doi: '10.3847/1538-4357/ac94d8', bibcode: '2023ApJ...944...94T', arxiv: '2209.11238',
  },
  gonzalezSantamaria2021: {
    short: 'González-Santamaría et al. 2021',
    citation: 'González-Santamaría I., Manteiga M., Manchado A., Ulla A., Dafonte C., López Varela P. 2021, "Planetary nebulae in Gaia EDR3: Central star identification, properties, and binarity", A&A, 656, A51 (VizieR J/A+A/656/A51)',
    doi: '10.1051/0004-6361/202141916', bibcode: '2021A&A...656A..51G', arxiv: '2109.12114',
  },
  simbad: {
    short: 'SIMBAD (Wenger et al. 2000)',
    citation: 'Wenger M., Ochsenbein F., Egret D., et al. 2000, "The SIMBAD astronomical database. The CDS reference database for astronomical objects", A&AS, 143, 9 — queried via SIMBAD TAP',
    doi: '10.1051/aas:2000332', bibcode: '2000A&AS..143....9W', arxiv: null, url: 'https://simbad.cds.unistra.fr/simbad/',
  },
  vizier: {
    short: 'VizieR (Ochsenbein et al. 2000)',
    citation: 'Ochsenbein F., Bauer P., Marcout J. 2000, "The VizieR database of astronomical catalogues", A&AS, 143, 23 (DOI of the service: 10.26093/cds/vizier)',
    doi: '10.1051/aas:2000169', bibcode: '2000A&AS..143...23O', arxiv: null, url: 'https://vizier.cds.unistra.fr/',
  },
  roman1987: {
    short: 'Roman 1987',
    citation: 'Roman N. G. 1987, "Identification of a Constellation From a Position", PASP, 99, 695 (IAU constellation boundaries, VizieR VI/42) — evaluated with astronomy-engine Constellation()',
    doi: '10.1086/132034', bibcode: '1987PASP...99..695R', arxiv: null,
  },

  // ---------------------------------------------------------------- cosmology
  planck2018vi: {
    short: 'Planck Collaboration 2020 (2018 results VI)',
    citation: 'Planck Collaboration: Aghanim N., Akrami Y., Ashdown M., et al. 2020, "Planck 2018 results. VI. Cosmological parameters", A&A, 641, A6 (Table 2)',
    doi: '10.1051/0004-6361/201833910', bibcode: '2020A&A...641A...6P', arxiv: '1807.06209',
  },
  planck2018i: {
    short: 'Planck Collaboration 2020 (2018 results I)',
    citation: 'Planck Collaboration: Aghanim N., Akrami Y., Arroja F., et al. 2020, "Planck 2018 results. I. Overview and the cosmological legacy of Planck", A&A, 641, A1',
    doi: '10.1051/0004-6361/201833880', bibcode: '2020A&A...641A...1P', arxiv: '1807.06205',
  },
  fixsen2009: {
    short: 'Fixsen 2009',
    citation: 'Fixsen D. J. 2009, "The Temperature of the Cosmic Microwave Background", ApJ, 707, 916',
    doi: '10.1088/0004-637X/707/2/916', bibcode: '2009ApJ...707..916F', arxiv: '0911.1955',
  },
  cosmosDerived: {
    short: 'Cosmos derived (this pipeline)',
    citation: 'Derived by the Cosmos galactic pipeline (scripts/data/galactic) from the cited input parameters; method documented in docs/data/galactic.md',
    doi: null, bibcode: null, arxiv: null,
  },
};

export function refUrl(r) {
  if (r.url) return r.url;
  if (r.doi) return `https://doi.org/${r.doi}`;
  if (r.bibcode) return `https://ui.adsabs.harvard.edu/abs/${encodeURIComponent(r.bibcode)}`;
  return null;
}

/** Returns the subset of REFS (plus extra) used by a dataset, with resolved url. */
export function refsFor(keys, extra = {}) {
  const all = { ...REFS, ...extra };
  const out = {};
  for (const k of [...new Set(keys)].sort()) {
    const r = all[k];
    if (!r) throw new Error(`[galactic] unknown reference key: ${k}`);
    out[k] = { short: r.short, citation: r.citation, doi: r.doi ?? null, bibcode: r.bibcode ?? null, arxiv: r.arxiv ?? null, url: refUrl(r) };
  }
  return out;
}
