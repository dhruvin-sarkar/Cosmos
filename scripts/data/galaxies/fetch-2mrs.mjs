#!/usr/bin/env node
// 2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26; VizieR J/ApJS/199/26/table3)
// -> public/data/galaxies/cosmicweb-2mrs.bin (+ .json header, + -meta.json IDs)
//
// Positions: comoving Cartesian Mpc, ICRS equatorial axes, observer (Sun) at origin,
// from CMB-frame redshift with flat LambdaCDM Planck 2018 (see lib.mjs COSMO/CMB_DIPOLE).
// Usage: node scripts/data/galaxies/fetch-2mrs.mjs [--refresh]

import {
  log, fail, fetchTextCached, parseVizierTsv, num, str, COSMO, CMB_DIPOLE, CMB_APEX_RADEC,
  zHelioToCmb, makeComovingTable, C_KMS, DEG, writeOut, writeMeta, isoNow, round, stringifyTableJson,
  mulberry32, shuffleInPlace, HUBBLE_DISTANCE_MPC, vizierAsuUrl,
} from './lib.mjs';

const DATASET_ID = 'huchra-2012-2mrs';
const SOURCE = 'J/ApJS/199/26/table3';
// RAdeg/DEdeg are not emitted by VizieR -out; positions come from the computed _RAJ2000/_DEJ2000 (decimal deg).
const COLS = ['ID', 'GLON', 'GLAT', 'Kcmag', 'e_Kcmag', 'Ktmag', 'type', 'cz', 'e_cz', 'n_cz', 'r_cz'];
const URL_ = vizierAsuUrl(SOURCE, COLS);
const SEED = 20121226; // fixed shuffle seed (reproducible ordering)

async function main() {
  const { text, meta, fromCache } = await fetchTextCached(URL_, '2mrs/J_ApJS_199_26_table3_radec.tsv', { minIntervalMs: 1500 });
  log(`2MRS table3 ${fromCache ? '(cached)' : '(downloaded)'}; retrieved ${meta?.retrieved}`);
  const { rows, columns } = parseVizierTsv(text, '2MRS table3');
  for (const c of ['_RAJ2000', '_DEJ2000', ...COLS]) if (!columns.includes(c)) fail(`2MRS: column ${c} missing from VizieR output (${columns.join(',')})`);
  if (rows.length !== 44599) fail(`2MRS: expected 44599 rows (ReadMe), got ${rows.length}`);

  const tab = makeComovingTable(0.5, 1e-5);
  const kept = [];
  const stats = { input: rows.length, noRedshift: 0, nonPositiveZcmb: 0, kept: 0, zcmbBelow0p003: 0 };
  for (const r of rows) {
    const ra = num(r._RAJ2000);
    const dec = num(r._DEJ2000);
    const cz = num(r.cz); // c*z, heliocentric (solar-system barycentre), km/s
    if (ra == null || dec == null) fail(`2MRS: missing coordinates for ${r.ID}`);
    if (cz == null) { stats.noRedshift++; continue; }
    const zHel = cz / C_KMS;
    const zCmb = zHelioToCmb(zHel, ra, dec);
    if (!(zCmb > 0)) { stats.nonPositiveZcmb++; continue; }
    if (zCmb < 0.003) stats.zcmbBelow0p003++;
    const d = tab.dc(zCmb);
    const cd = Math.cos(dec * DEG);
    kept.push({
      x: d * cd * Math.cos(ra * DEG), y: d * cd * Math.sin(ra * DEG), z: d * Math.sin(dec * DEG),
      zCmb, k: num(r.Kcmag), id: str(r.ID), cz, ecz: num(r.e_cz), glat: num(r.GLAT), glon: num(r.GLON), type: str(r.type),
    });
  }
  stats.kept = kept.length;
  // Shuffle so that any prefix is a uniform random subsample (progressive rendering / LOD).
  shuffleInPlace(kept, mulberry32(SEED));

  const STRIDE = 5;
  const f32 = new Float32Array(kept.length * STRIDE);
  let minD = Infinity, maxD = 0, minZ = Infinity, maxZ = 0, minK = Infinity, maxK = -Infinity;
  const bounds = { xMpc: [Infinity, -Infinity], yMpc: [Infinity, -Infinity], zMpc: [Infinity, -Infinity] };
  kept.forEach((g, i) => {
    if (g.k == null) fail(`2MRS: missing Kcmag for ${g.id}`);
    f32[i * STRIDE] = g.x; f32[i * STRIDE + 1] = g.y; f32[i * STRIDE + 2] = g.z;
    f32[i * STRIDE + 3] = g.zCmb; f32[i * STRIDE + 4] = g.k;
    const d = Math.hypot(g.x, g.y, g.z);
    minD = Math.min(minD, d); maxD = Math.max(maxD, d);
    minZ = Math.min(minZ, g.zCmb); maxZ = Math.max(maxZ, g.zCmb);
    minK = Math.min(minK, g.k); maxK = Math.max(maxK, g.k);
    bounds.xMpc = [Math.min(bounds.xMpc[0], g.x), Math.max(bounds.xMpc[1], g.x)];
    bounds.yMpc = [Math.min(bounds.yMpc[0], g.y), Math.max(bounds.yMpc[1], g.y)];
    bounds.zMpc = [Math.min(bounds.zMpc[0], g.z), Math.max(bounds.zMpc[1], g.z)];
  });
  for (let i = 0; i < f32.length; i++) if (!Number.isFinite(f32[i])) fail(`2MRS: non-finite output at ${i}`);

  const zs = kept.map((g) => g.zCmb).sort((a, b) => a - b);
  const median = zs[Math.floor(zs.length / 2)];
  const binOut = writeOut('cosmicweb-2mrs.bin', Buffer.from(f32.buffer));

  const generated = isoNow();
  const header = {
    schemaVersion: 1,
    generated,
    file: 'cosmicweb-2mrs.bin',
    description: '2MASS Redshift Survey galaxies (Ks<=11.75, |b|>=5 deg, >=8 deg towards the bulge) as 3D points in comoving space for the cosmic-web view.',
    encoding: 'float32 little-endian, interleaved records',
    count: kept.length,
    stride: STRIDE,
    strideBytes: STRIDE * 4,
    byteLength: binOut.bytes,
    fields: [
      { name: 'xMpc', unit: 'Mpc', description: 'comoving x: towards RA=0h, Dec=0 (ICRS)' },
      { name: 'yMpc', unit: 'Mpc', description: 'comoving y: towards RA=6h, Dec=0 (ICRS)' },
      { name: 'zMpc', unit: 'Mpc', description: 'comoving z: towards Dec=+90 (ICRS north pole)' },
      { name: 'redshift', unit: '1', description: 'CMB-frame redshift z_cmb used for the distance (see redshiftFrame)' },
      { name: 'kMag', unit: 'mag (Vega)', description: '2MRS Kcmag: extinction-corrected 2MASS Ks isophotal magnitude (K=20 mag/arcsec^2 isophote)' },
    ],
    nullHandling: 'No nulls: galaxies without a redshift (or with z_cmb<=0) are excluded and counted in selection.',
    order: `Randomly shuffled (mulberry32 seed ${SEED}); any prefix of N records is a uniform random subsample. Row i corresponds to row i of cosmicweb-2mrs-meta.json.`,
    coordinateFrame: {
      axes: 'ICRS (J2000) equatorial Cartesian; x=(cos dec cos ra), y=(cos dec sin ra), z=(sin dec) times comoving distance',
      origin: 'observer (solar-system barycentre); the Milky Way is at the origin',
      distance: 'line-of-sight comoving distance D_C(z_cmb)',
      positionsAre: 'redshift-space (derived): peculiar velocities are not removed; clusters appear elongated along the line of sight (Fingers of God), and very nearby galaxies (z_cmb<0.003, D<~13 Mpc) have large relative distance errors.',
    },
    redshiftFrame: {
      used: 'CMB rest frame',
      inputFrame: 'heliocentric / solar-system barycentric (2MRS cz column)',
      conversion: '1+z_cmb = (1+z_hel) * gamma * (1 + beta*cos(theta)); beta = v/c, theta = angle to CMB dipole apex',
      cmbDipole: { ...CMB_DIPOLE, apexRaDeg: round(CMB_APEX_RADEC[0], 4), apexDecDeg: round(CMB_APEX_RADEC[1], 4) },
    },
    cosmology: {
      ...COSMO,
      hubbleDistanceMpc: round(HUBBLE_DISTANCE_MPC, 4),
      integration: 'D_C(z) = (c/H0) * int_0^z dz/sqrt(Om(1+z)^3 + OL); cumulative composite Simpson on a uniform grid dz=1e-5, linear interpolation (error < 1e-6 Mpc); cross-checked against direct Simpson with 2e5 panels',
      checkComovingDistanceMpcAtZ0p1: round(tab.dc(0.1), 3),
    },
    selection: {
      survey: '2MASS Redshift Survey (2MRS) main catalog (Huchra et al. 2012)',
      magnitudeLimit: 'Kcmag <= 11.75',
      skyCoverage: '~91% of the sky: all-sky except the Zone of Avoidance |b|<5 deg, widened to |b|<8 deg for |l|<30 deg (Galactic bulge)',
      ...stats,
      medianRedshift: round(median, 5),
    },
    stats: {
      redshiftRange: [round(minZ, 6), round(maxZ, 6)],
      distanceRangeMpc: [round(minD, 3), round(maxD, 3)],
      kMagRange: [round(minK, 3), round(maxK, 3)],
      boundsMpc: Object.fromEntries(Object.entries(bounds).map(([k, v]) => [k, v.map((x) => round(x, 3))])),
    },
    zoneOfAvoidance: 'No galaxies at |b|<5 deg (|b|<8 deg towards the bulge): renderers will see an empty wedge/disc-shaped gap aligned with the Milky Way plane. This is an observational selection effect (dust extinction and stellar confusion), not a real void.',
    redshiftSpaceDistortions: 'Distances are inferred from redshift. Random velocities in clusters stretch them radially ("Fingers of God"); coherent infall flattens large structures (Kaiser effect). The magnitude-limited selection makes the density of points fall with distance (Malmquist-type bias) - do not read the outer thinning as fewer galaxies in reality.',
    source: {
      catalog: 'Huchra J.P. et al. 2012, ApJS 199, 26 (2MRS); VizieR J/ApJS/199/26/table3',
      url: URL_,
      retrieved: meta?.retrieved ?? null,
      license: 'VizieR: free for scientific/educational use with citation; original tables (c) AAS (pre-2021 AAS copyright)',
    },
  };
  const hdrOut = writeOut('cosmicweb-2mrs.json', JSON.stringify(header, null, 1) + '\n');

  const metaTable = {
    schemaVersion: 1,
    generated,
    description: 'Per-galaxy identifiers and raw heliocentric redshifts for cosmicweb-2mrs.bin (same row order).',
    fields: ['id2mass', 'czHelioKms', 'czErrKms', 'morphTypeZcat'],
    units: [null, 'km/s (c*z, solar-system barycentre)', 'km/s', 'ZCAT type code'],
    rows: kept.map((g) => [g.id, g.cz, g.ecz, g.type]),
  };
  const metaOut = writeOut('cosmicweb-2mrs-meta.json', stringifyTableJson(metaTable));

  writeMeta(DATASET_ID, {
    retrieved: meta?.retrieved ?? generated, endpoint: URL_, query: `-source=${SOURCE}&-out=${COLS.join(',')}&-out.max=unlimited`,
    files: [binOut, hdrOut, metaOut].map((f) => ({ path: f.rel, bytes: f.bytes })), records: kept.length, stats,
  });
  log(`2MRS: kept ${kept.length} of ${rows.length} (no cz ${stats.noRedshift}, z_cmb<=0 ${stats.nonPositiveZcmb}); median z_cmb ${median.toFixed(4)}; D range ${minD.toFixed(2)}–${maxD.toFixed(1)} Mpc`);
  log(`wrote ${binOut.rel} (${binOut.bytes} B), ${hdrOut.rel}, ${metaOut.rel} (${metaOut.bytes} B)`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
