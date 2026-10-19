// Curated tables: famous.json (rich-reconstruction targets) and structures.json (groups/clusters/superclusters/voids).
// Values are literature values entered by hand (references per row); UNGC rows in local.json supply positions/sizes where `ungc` is set.
// Run after fetch-local.mjs.
import fs from 'node:fs';
import { OUT_DIR, writeOut, stringifyTableJson, isoNow, comovingDistanceSimpson, round, log, fail } from './lib.mjs';

const local = JSON.parse(fs.readFileSync(`${OUT_DIR}/local.json`, 'utf8'));
const lf = Object.fromEntries(local.fields.map((f, i) => [f, i]));
const byName = new Map(local.rows.map((r) => [r[lf.name], r]));
const U = 'Karachentsev et al. 2013, AJ 145, 101';
const MC = 'McConnachie 2012, AJ 144, 4';
const RC3 = 'de Vaucouleurs et al. 1991, RC3';

// id, name, aliases, ungc, morphology, [ra,dec] (if no ungc), dist [Mpc, err, ref], i, PA, orientationRef, diamKpc override, extra
const F = [
  ['m31', 'Andromeda Galaxy (M31)', ['NGC 224'], 'M31', 'SA(s)b spiral', null, [0.785, 0.025, MC], 77, 38, 'Walterbos & Kennicutt 1987 / RC3', null, { bhMassMsun: 1.4e8, bhRef: 'Bender et al. 2005, ApJ 631, 280' }],
  ['m33', 'Triangulum Galaxy (M33)', ['NGC 598'], 'M33', 'SA(s)cd spiral', null, [0.809, 0.024, MC], 56, 23, 'Regan & Vogel 1994', null, {}],
  ['lmc', 'Large Magellanic Cloud', ['LMC'], null, 'SB(s)m barred irregular', [80.894, -69.756], [0.04959, 0.00095, 'Pietrzynski et al. 2019, Nature 567, 200'], 34.7, 129.9, 'van der Marel & Cioni 2001, AJ 122, 1807 (PA = line of nodes)', 9.9, {}],
  ['smc', 'Small Magellanic Cloud', ['SMC'], null, 'dIrr / SB(s)m pec', [13.187, -72.829], [0.0621, 0.0019, 'Graczyk et al. 2020, ApJ 904, 13'], null, null, null, 4.2, {}],
  ['m32', 'M32', ['NGC 221'], 'M32', 'cE2 compact elliptical', null, [0.805, 0.04, MC], null, null, null, null, {}],
  ['m81', "Bode's Galaxy (M81)", ['NGC 3031'], 'M81', 'SA(s)ab spiral', null, [3.63, 0.15, U], 59, 157, RC3, null, { bhMassMsun: 7e7, bhRef: 'Devereux et al. 2003, AJ 126, 1262' }],
  ['m82', 'Cigar Galaxy (M82)', ['NGC 3034'], 'M82', 'I0 starburst', null, [3.53, 0.15, U], 77, 65, RC3, null, {}],
  ['m87', 'Virgo A (M87)', ['NGC 4486'], null, 'E0-1 giant elliptical (cD)', [187.70593, 12.39112], [16.5, 1.1, 'Blakeslee et al. 2009, ApJ 694, 556 (SBF; EHT 2019 adopts 16.8 Mpc)'], null, null, null, 40, { bhMassMsun: 6.5e9, bhRef: 'EHT Collaboration 2019, ApJ 875, L1 (6.5 +/- 0.7 e9 Msun)' }],
  ['cena', 'Centaurus A', ['NGC 5128'], 'NGC 5128', 'S0 pec (merger remnant), radio galaxy', null, [3.8, 0.1, 'Harris, Rejkuba & Harris 2010, PASA 27, 457'], null, 35, 'Israel 1998, A&ARv 8, 237 (major axis)', null, { bhMassMsun: 5.5e7, bhRef: 'Cappellari et al. 2009, MNRAS 394, 660' }],
  ['m51', 'Whirlpool Galaxy (M51a)', ['NGC 5194'], 'NGC 5194', 'SA(s)bc pec grand-design spiral', null, [8.58, 0.10, 'McQuinn et al. 2016, ApJ 826, 21 (TRGB)'], 22, 173, 'Colombo et al. 2014 (PAWS), ApJ 784, 3', null, {}],
  ['m104', 'Sombrero Galaxy (M104)', ['NGC 4594'], 'NGC 4594', 'SA(s)a edge-on spiral with prominent bulge', null, [9.3, 0.4, U], 84, 89, RC3, null, { bhMassMsun: 1e9, bhRef: 'Kormendy et al. 1996, ApJ 473, L91' }],
  ['m101', 'Pinwheel Galaxy (M101)', ['NGC 5457'], 'M101', 'SAB(rs)cd face-on spiral', null, [7.38, 0.3, U], 18, 39, RC3, null, {}],
  ['ngc1300', 'NGC 1300', [], null, 'SB(rs)bc barred spiral', [49.9208, -19.4111], [20.0, 1.5, 'Fornax-cluster distance, Blakeslee et al. 2009 (association assumed)'], null, null, null, 40, {}],
  ['m64', 'Black Eye Galaxy (M64)', ['NGC 4826'], 'NGC 4826', '(R)SA(rs)ab spiral', null, [4.37, 0.2, U], 60, 121, RC3, null, {}],
  ['m100', 'M100', ['NGC 4321'], null, 'SAB(s)bc grand-design spiral', [185.7287, 15.8223], [16.1, 1.3, 'Ferrarese et al. 1996, ApJ 464, 568 (Cepheids)'], 30, 153, RC3, 55, {}],
  ['ngc253', 'Sculptor Galaxy (NGC 253)', ['Silver Coin'], 'NGC 253', 'SAB(s)c starburst, nearly edge-on', null, [3.94, 0.2, U], 78, 45, RC3, null, {}],
  ['ic342', 'IC 342', ['Caldwell 5'], 'IC 342', 'SAB(rs)cd face-on spiral', null, [3.28, 0.2, U], 31, 37, 'Crosthwaite et al. 2000, AJ 119, 1223', null, {}],
  ['maffei1', 'Maffei 1', [], 'Maffei1', 'E giant elliptical behind the Zone of Avoidance', null, [3.01, 0.3, U], null, null, null, null, {}],
  ['maffei2', 'Maffei 2', [], 'Maffei2', 'SAB(rs)bc spiral behind the Zone of Avoidance', null, [2.8, 0.3, U], 63, null, null, null, {}],
  ['antennae', 'Antennae Galaxies (NGC 4038/4039)', ['Arp 244'], null, 'Interacting pair, merger', [180.4713, -18.8689], [22, 3, 'Whitmore et al. 2010, AJ 140, 75 (alternative TRGB value 13.3 Mpc, Schweizer et al. 2008)'], null, null, null, 30, {}],
  ['m83', 'Southern Pinwheel (M83)', ['NGC 5236'], 'NGC 5236', 'SAB(s)c barred grand-design spiral', null, [4.92, 0.25, U], 24, 45, 'Comte 1981 / RC3', null, {}],
  ['m106', 'M106', ['NGC 4258'], 'NGC 4258', 'SAB(s)bc Seyfert 2 / LINER spiral', null, [7.60, 0.17, 'Humphreys et al. 2013, ApJ 775, 13 (water maser)'], 72, 150, RC3, null, { bhMassMsun: 3.9e7, bhRef: 'Herrnstein et al. 1999, Nature 400, 539' }],
  ['ngc891', 'NGC 891', [], 'NGC 891', 'SA(s)b edge-on spiral', null, [9.77, 0.5, U], 90, 22, RC3, null, {}],
  ['ngc6946', 'Fireworks Galaxy (NGC 6946)', [], 'NGC 6946', 'SAB(rs)cd spiral', null, [5.89, 0.3, U], null, null, null, null, {}],
  ['ngc2403', 'NGC 2403', [], 'NGC 2403', 'SAB(s)cd spiral', null, [3.18, 0.2, U], null, null, null, null, {}],
  ['ngc55', 'NGC 55', [], 'NGC 55', 'SB(s)m edge-on barred irregular', null, [2.13, 0.1, U], null, null, null, null, {}],
  ['ngc300', 'NGC 300', [], 'NGC 300', 'SA(s)d spiral', null, [2.15, 0.1, U], null, null, null, null, {}],
  ['ngc7793', 'NGC 7793', [], 'NGC 7793', 'SA(s)d spiral', null, [3.91, 0.2, U], null, null, null, null, {}],
  ['ic10', 'IC 10', [], 'IC 10', 'dIrr starburst (nearest starburst dwarf)', null, [0.79, 0.04, MC], null, null, null, null, {}],
  ['m94', "Cat's Eye Galaxy (M94)", ['NGC 4736'], 'NGC 4736', '(R)SA(r)ab ringed spiral', null, [4.66, 0.2, U], 35, 105, RC3, null, {}],
  ['sculptor', 'Sculptor Dwarf Spheroidal', ['Scl dSph'], null, 'dSph', [15.0392, -33.7089], [0.086, 0.006, MC], null, null, null, null, {}],
  ['sagdsph', 'Sagittarius Dwarf Spheroidal', ['Sgr dSph'], null, 'dSph (tidally disrupting, with stellar stream)', [283.8313, -30.5453], [0.026, 0.002, MC], null, null, null, null, {}],
  ['leo1', 'Leo I', [], null, 'dSph', [152.1171, 12.3064], [0.254, 0.018, MC], null, null, null, null, {}],
  ['fornax-dsph', 'Fornax Dwarf Spheroidal', [], null, 'dSph', [39.9971, -34.4492], [0.147, 0.012, MC], null, null, null, null, {}],
  ['draco', 'Draco Dwarf', [], null, 'dSph', [260.0517, 57.9153], [0.076, 0.006, MC], null, null, null, null, {}],
  ['umi', 'Ursa Minor Dwarf', [], null, 'dSph', [227.2854, 67.2225], [0.076, 0.003, MC], null, null, null, null, {}],
  ['carina', 'Carina Dwarf', [], null, 'dSph', [100.4029, -50.9661], [0.105, 0.006, MC], null, null, null, null, {}],
];
const ff = ['id', 'name', 'aliases', 'raDeg', 'decDeg', 'distMpc', 'distErrMpc', 'distRef', 'morphology', 'tType', 'majorAxisArcmin', 'majorAxisKpc', 'inclinationDeg', 'positionAngleDeg', 'orientationRef', 'absMagB', 'logMstarMsun', 'vHelioKms', 'bhMassMsun', 'bhRef', 'ungcName'];
const frows = [];
for (const [id, name, aliases, ungc, morph, pos, [d, de, dref], inc, pa, oref, diamOverride, extra] of F) {
  let r = null;
  if (ungc) { r = byName.get(ungc); if (!r) fail('UNGC row missing: ' + ungc); }
  const g = (k) => (r ? r[lf[k]] : null);
  const ra = r ? g('raDeg') : pos[0], dec = r ? g('decDeg') : pos[1];
  frows.push([id, name, aliases, ra, dec, d, de, dref, morph, g('tType'), g('majorAxisArcmin'), diamOverride ?? g('majorAxisKpc'), inc, pa, oref ?? null,
    g('absMagB'), g('logMstarMsun'), g('vHelioKms'), extra.bhMassMsun ?? null, extra.bhRef ?? null, ungc ?? null]);
}
const note = 'Orientation (inclination/position angle) is the best available literature value; null = not reliably known (renderer should use an illustrative orientation). Distances: preferred primary indicators; majorAxisKpc is the UNGC Holmberg diameter (A26) unless overridden (LMC/SMC/M87/NGC 1300/M100/Antennae sizes are approximate). absMagB is derived from apparent B and distance without extinction correction; logMstarMsun is derived from Ks luminosity with an assumed M/L_K=0.6 (illustrative).';
const wf = writeOut('famous.json', stringifyTableJson({ schemaVersion: 1, generated: isoNow(), note, fields: ff, rows: frows }));
log('famous', frows.length, wf.bytes);

// ---- structures
const dz = (z) => round(comovingDistanceSimpson(z), 1);
// id, name, kind, ra, dec, z|null, distMpc|null, radiusMpc, members, memberNote, posQuality, desc, refs
const S = [
  ['local-group', 'Local Group', 'group', 10.0, 40.0, null, 0.45, 1.2, 80, 'approx.; dominated by Milky Way and M31', 'approximate', 'Gravitationally bound group containing the Milky Way, M31 and M33; ~1.2 Mpc radius (zero-velocity surface). Centre placed along the MW-M31 line at the barycentre.', ['McConnachie 2012, AJ 144, 4', 'Courteau & van den Bergh 1999, AJ 118, 337']],
  ['m81-group', 'M81 Group', 'group', 148.89, 69.07, null, 3.63, 1.0, 36, 'approx.', 'catalogued', 'Nearest group beyond the Local Group, around M81, M82 and NGC 3077; shows tidal streams (HI bridge).', [U]],
  ['sculptor-group', 'Sculptor Group', 'group', 11.89, -25.29, null, 3.9, 1.0, 19, 'approx.', 'catalogued', 'Loose filament of galaxies (NGC 253, NGC 55, NGC 300, NGC 7793) at ~2-4 Mpc.', [U]],
  ['cena-m83-group', 'Centaurus A / M83 Group', 'group', 201.37, -43.02, null, 3.8, 1.0, 30, 'approx.', 'catalogued', 'Dominant group at ~4 Mpc around Cen A and M83.', [U, 'Harris et al. 2010, PASA 27, 457']],
  ['virgo', 'Virgo Cluster', 'cluster', 187.7059, 12.3911, null, 16.5, 1.7, 1300, 'Virgo Cluster Catalog members (Binggeli+1985 list ~2000 incl. likely members)', 'catalogued', 'Nearest rich cluster, centred on M87; the Local Group falls towards it.', ['Mei et al. 2007, ApJ 655, 144 (16.5 Mpc)', 'Binggeli, Sandage & Tammann 1985, AJ 90, 1681']],
  ['fornax', 'Fornax Cluster', 'cluster', 54.6209, -35.4503, null, 20.0, 0.7, 340, 'Ferguson 1989 FCC members', 'catalogued', 'Compact southern cluster around NGC 1399.', ['Blakeslee et al. 2009, ApJ 694, 556', 'Ferguson 1989, AJ 98, 367']],
  ['coma', 'Coma Cluster (Abell 1656)', 'cluster', 194.953, 27.981, 0.0231, null, 2.9, 1000, 'bright members; ~10,000 incl. dwarfs', 'catalogued', 'Rich, nearly relaxed cluster; velocity dispersion ~1000 km/s; centre of the CfA Great Wall.', ['Abell 1958', 'Lokas & Mamon 2003, MNRAS 343, 401']],
  ['perseus', 'Perseus Cluster (Abell 426)', 'cluster', 49.951, 41.512, 0.0179, null, 2.0, null, null, 'catalogued', 'Brightest X-ray cluster, centred on NGC 1275; at the end of the Perseus-Pisces chain.', ['Abell 1958']],
  ['norma', 'Norma Cluster (Abell 3627)', 'cluster', 243.56, -60.91, 0.0157, null, 1.5, null, null, 'catalogued', 'Rich cluster hidden in the Zone of Avoidance, at the core of the Great Attractor region.', ['Kraan-Korteweg et al. 1996, Nature 379, 519']],
  ['centaurus', 'Centaurus Cluster (Abell 3526)', 'cluster', 192.2, -41.3, 0.0114, null, 1.5, null, null, 'approximate', 'Nearby cluster, part of the Hydra-Centaurus region flowing toward the Great Attractor.', ['Abell, Corwin & Olowin 1989']],
  ['hydra', 'Hydra Cluster (Abell 1060)', 'cluster', 159.178, -27.528, 0.0126, null, 1.2, null, null, 'approximate', 'Nearby cluster in the Hydra-Centaurus supercluster.', ['Abell 1958']],
  ['shapley', 'Shapley Supercluster', 'supercluster', 202.5, -31.0, 0.048, null, 60, null, null, 'approximate', 'Largest concentration of clusters in the nearby universe (~200 Mpc away); contributes to the Local Group motion.', ['Shapley 1930', 'Proust et al. 2006, ESO Messenger 124, 30']],
  ['laniakea', 'Laniakea Supercluster', 'supercluster', 243.56, -60.91, 0.0157, null, 80, 100000, 'approx. (Tully+2014)', 'approximate', 'Basin of attraction of ~1e17 Msun containing the Local Group, Virgo, Hydra-Centaurus; ~160 Mpc across. Centre approximated by the Great Attractor/Norma region (the flow convergence).', ['Tully et al. 2014, Nature 513, 71']],
  ['perseus-pisces', 'Perseus-Pisces Supercluster', 'supercluster', 20.0, 30.0, 0.018, null, 50, null, null, 'approximate', 'Filamentary chain spanning RA ~22h-4h at cz ~5000-6000 km/s.', ['Haynes & Giovanelli 1986, ApJ 306, L55']],
  ['hercules', 'Hercules Supercluster', 'supercluster', 241.5, 17.8, 0.037, null, 40, null, null, 'approximate', 'Supercluster including Abell 2147, 2151, 2152.', ['Abell 1958']],
  ['local-void', 'Local Void', 'void', 285.0, 0.0, null, 25, 23, null, null, 'approximate', 'Large nearly empty region adjacent to the Local Sheet (~45 Mpc across); the Local Group is receding from it. Position is approximate.', ['Tully et al. 2008, ApJ 676, 184', 'Tully & Fisher 1987, Nearby Galaxies Atlas']],
  ['bootes-void', 'Bootes Void', 'void', 222.5, 46.0, 0.05, null, 50, null, null, 'approximate', 'Giant void (~100 Mpc across).', ['Kirshner et al. 1981, ApJ 248, L57']],
  ['cfa2-great-wall', 'CfA2 Great Wall (Coma Wall)', 'wall', 192.0, 30.0, 0.03, null, 125, null, null, 'approximate', 'Sheet of galaxies ~170 h^-1 Mpc long, running through the Coma Cluster.', ['Geller & Huchra 1989, Science 246, 897']],
  ['sloan-great-wall', 'Sloan Great Wall', 'wall', 180.0, 0.0, 0.073, null, 210, null, null, 'approximate', 'Filamentary wall ~1.37 Gly long found in SDSS redshifts. Position is approximate.', ['Gott et al. 2005, ApJ 624, 463']],
];
const sf = ['id', 'name', 'kind', 'raDeg', 'decDeg', 'redshift', 'distMpc', 'radiusMpc', 'members', 'membersNote', 'positionQuality', 'description', 'refs'];
const srows = S.map(([id, name, kind, ra, dec, z, d, rad, mem, mnote, q, desc, refs]) => [id, name, kind, ra, dec, z, d ?? dz(z), rad, mem, mnote, q, desc, refs]);
const ws = writeOut('structures.json', stringifyTableJson({ schemaVersion: 1, generated: isoNow(),
  note: 'distMpc is comoving (Planck 2018 flat LCDM, H0=67.66, Om=0.3111) when derived from redshift, otherwise the literature distance. radiusMpc is a characteristic (virial/zero-velocity/half-extent) size. Redshift is the cluster mean (CMB/helio difference << quoted precision).',
  fields: sf, rows: srows }));
log('structures', srows.length, ws.bytes);
