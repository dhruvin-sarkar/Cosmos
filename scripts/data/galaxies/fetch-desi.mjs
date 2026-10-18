#!/usr/bin/env node
// DESI Data Release 1 large-scale-structure "clustering" catalogs (LSScats v1.5)
//   BGS_BRIGHT (NGC+SGC)  -> public/data/galaxies/cosmicweb-deep.bin      (+ .json header)
//   LRG        (NGC+SGC)  -> public/data/galaxies/cosmicweb-deep-lrg.bin  (+ .json header)
//
// Pipeline per FITS file: HEAD (size) -> free-disk check -> streamed download to data-raw/galaxies/desi/
// -> minimal FITS BINTABLE reader -> compact Float32 extraction cache (*.f32 + .json)
// -> raw FITS deleted when > 200 MB (project rule). Re-runs reuse the extraction cache (no re-download).
// Then: seeded uniform random down-sampling, CMB-frame redshift, flat-LCDM comoving distance, ICRS xyz.
//
// Usage: node scripts/data/galaxies/fetch-desi.mjs [--bgs=1800000] [--lrg=400000] [--keep-raw] [--refresh]

import fs from 'node:fs';
import {
  log, fail, RAW_DIR, ROOT, ensureDir, downloadFile, readFitsBintableHeader, forEachFitsRow, fmtBytes,
  makeComovingTable, zHelioToCmb, DEG, COSMO, CMB_DIPOLE, CMB_APEX_RADEC, HUBBLE_DISTANCE_MPC, mulberry32,
  writeOut, writeMeta, isoNow, round, freeBytes, readSidecar, sha256File, fetchTextCached,
} from './lib.mjs';

const BASE = 'https://data.desi.lbl.gov/public/dr1/survey/catalogs/dr1/LSS/iron/LSScats/v1.5';
const VERSION = 'DESI DR1 (iron) LSS catalogs v1.5 - clustering .dat files';
const RAW_BUDGET = 1.2 * 1024 ** 3;
const DELETE_ABOVE = 200 * 1024 ** 2;
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? Number(a.split('=')[1]) : d; };
const TARGET = { BGS_BRIGHT: arg('bgs', 1800000), LRG: arg('lrg', 400000) };
const SEED = { BGS_BRIGHT: 20250210, LRG: 20250211 };
const KEEP_RAW = process.argv.includes('--keep-raw');

const TRACERS = {
  BGS_BRIGHT: {
    files: ['BGS_BRIGHT_NGC_clustering.dat.fits', 'BGS_BRIGHT_SGC_clustering.dat.fits'],
    cols: [['RA', 'D'], ['DEC', 'D'], ['Z', 'D'], ['flux_g_dered', 'E'], ['flux_r_dered', 'E'], ['flux_z_dered', 'E']],
  },
  LRG: {
    files: ['LRG_NGC_clustering.dat.fits', 'LRG_SGC_clustering.dat.fits'],
    cols: [['RA', 'D'], ['DEC', 'D'], ['Z', 'D']],
  },
};

const DESI_DIR = `${RAW_DIR}/desi`;
const SHA_FILE = 'dr1_survey_catalogs_dr1_LSS_iron_LSScats_v1.5.sha256sum';
let officialSha = null;

/** Official DESI checksum list for the LSScats v1.5 directory ("<sha256>  <file>" per line). */
async function loadOfficialSha() {
  if (officialSha) return officialSha;
  const { text } = await fetchTextCached(`${BASE}/${SHA_FILE}`, `desi/${SHA_FILE}`);
  officialSha = new Map();
  for (const line of text.split(String.fromCharCode(10))) {
    const m = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/);
    if (m) officialSha.set(m[2].trim(), m[1]);
  }
  if (!officialSha.size) fail(`could not parse ${SHA_FILE}`);
  return officialSha;
}

/** Download (if needed) + extract one FITS file into a Float32 cache. Returns cache descriptor. */
async function extract(file, cols) {
  ensureDir(DESI_DIR);
  const stem = file.replace(/\.fits$/, '');
  const cachePath = `${DESI_DIR}/${stem}.f32`;
  const cacheMetaPath = `${cachePath}.json`;
  if (!process.argv.includes('--refresh') && fs.existsSync(cachePath) && fs.existsSync(cacheMetaPath)) {
    const m = JSON.parse(fs.readFileSync(cacheMetaPath, 'utf8'));
    if (fs.statSync(cachePath).size === m.nRows * m.columns.length * 4) {
      log(`extraction cache hit: ${stem} (${m.nRows} rows)`);
      return { ...m, cachePath };
    }
  }
  const url = `${BASE}/${file}`;
  const fitsPath = `${DESI_DIR}/${file}`;
  const dl = await downloadFile(url, fitsPath, { budgetBytes: RAW_BUDGET });
  const shaMap = await loadOfficialSha();
  const expected = shaMap.get(file);
  if (!expected) fail(`${file} not listed in ${SHA_FILE}`);
  const actual = sha256File(fitsPath);
  if (actual !== expected) {
    fs.rmSync(fitsPath, { force: true });
    fail(`SHA-256 mismatch for ${file}: got ${actual}, official ${expected} (corrupt download deleted; re-run)`);
  }
  log(`sha256 OK for ${file} (matches official ${SHA_FILE})`);
  const desc = readFitsBintableHeader(fitsPath);
  const byName = Object.fromEntries(desc.cols.map((c) => [c.name, c]));
  const use = cols.map(([name, code]) => {
    const c = byName[name];
    if (!c) fail(`${file}: missing column ${name}; available: ${desc.cols.map((x) => x.name).join(',')}`);
    if (c.code !== code || c.repeat !== 1) fail(`${file}: column ${name} has TFORM ${c.form}, expected 1${code}`);
    return c;
  });
  const nc = use.length;
  const out = new Float32Array(desc.nRows * nc);
  const t0 = Date.now();
  await forEachFitsRow(desc, (buf, o, i) => {
    const base = i * nc;
    for (let k = 0; k < nc; k++) {
      const c = use[k];
      out[base + k] = c.code === 'D' ? buf.readDoubleBE(o + c.offset) : buf.readFloatBE(o + c.offset);
    }
  });
  fs.writeFileSync(cachePath, Buffer.from(out.buffer));
  const sc = readSidecar(fitsPath) || dl.meta || {};
  const meta = {
    file, url, nRows: desc.nRows, rowBytes: desc.rowBytes, columns: use.map((c) => c.name),
    fitsColumns: desc.cols.map((c) => `${c.name}:${c.form}${c.unit ? `[${c.unit}]` : ''}`),
    extname: desc.header.EXTNAME ?? null, desidr: desc.header.DESIDR ?? null,
    bytes: dl.bytes, sha256: actual, sha256VerifiedAgainst: `${BASE}/${SHA_FILE}`, lastModified: dl.head.lastModified, etag: dl.head.etag,
    retrieved: sc.retrieved ?? isoNow(), extractedSeconds: Math.round((Date.now() - t0) / 1000),
  };
  fs.writeFileSync(cacheMetaPath, JSON.stringify(meta, null, 1));
  log(`extracted ${file}: ${desc.nRows} rows x ${nc} cols in ${meta.extractedSeconds}s -> ${fmtBytes(out.byteLength)}`);
  if (dl.bytes > DELETE_ABOVE || !KEEP_RAW) {
    // > 200 MB must go (project rule); smaller files are also removed unless --keep-raw, because
    // the extraction cache already guarantees idempotent re-runs and disk is shared and tight.
    fs.rmSync(fitsPath, { force: true });
    fs.rmSync(`${fitsPath}.meta.json`, { force: true });
    log(`deleted raw ${file} (${fmtBytes(dl.bytes)}); free disk now ${fmtBytes(freeBytes(ROOT))}`);
  }
  return { ...meta, cachePath };
}

function loadCache(m) {
  const b = fs.readFileSync(m.cachePath);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** Footprint occupancy accumulator: 2-deg RA/Dec bitmask (base64) + area estimate from 0.5-deg cells. */
function makeFootprint() {
  const fine = new Uint8Array(720 * 360);
  const coarse = new Uint8Array(180 * 90);
  return {
    add(ra, dec) {
      fine[Math.min(719, Math.floor(ra / 0.5)) + 720 * Math.min(359, Math.floor((dec + 90) / 0.5))] = 1;
      coarse[Math.min(179, Math.floor(ra / 2)) + 180 * Math.min(89, Math.floor((dec + 90) / 2))] = 1;
    },
    result() { return footprintResult(fine, coarse); },
  };
}

function footprintResult(fine, coarse) {
  let areaSr = 0;
  for (let j = 0; j < 360; j++) {
    const d1 = (-90 + j * 0.5) * DEG;
    const d2 = (-90 + (j + 1) * 0.5) * DEG;
    const cellSr = 0.5 * DEG * (Math.sin(d2) - Math.sin(d1));
    for (let i = 0; i < 720; i++) if (fine[i + 720 * j]) areaSr += cellSr;
  }
  const bits = new Uint8Array(Math.ceil(coarse.length / 8));
  for (let k = 0; k < coarse.length; k++) if (coarse[k]) bits[k >> 3] |= 1 << (k & 7);
  return {
    approxAreaDeg2: Math.round(areaSr / (DEG * DEG)),
    areaMethod: 'sum of occupied 0.5x0.5-deg RA/Dec cells (overestimates edges slightly)',
    grid: {
      encoding: 'base64 bitmask, LSB-first within each byte; bit index k = raCell + 180*decCell; raCell = floor(RA/2deg) (0..179), decCell = floor((Dec+90)/2deg) (0..89); bit=1 means at least one galaxy in the cell',
      cellDeg: 2, nRa: 180, nDec: 90, base64: Buffer.from(bits).toString('base64'),
    },
  };
}

async function buildTracer(name, tab) {
  const spec = TRACERS[name];
  const parts = [];
  for (const f of spec.files) parts.push(await extract(f, spec.cols));
  const nc = spec.cols.length;
  const arrays = parts.map(loadCache);
  const total = parts.reduce((s, p) => s + p.nRows, 0);
  const hasFlux = nc === 6;

  // Candidate pool (exclude rows lacking positive g & r flux only if colour is required).
  const pool = new Uint32Array(total);
  const partOf = new Uint8Array(total);
  let np = 0;
  let badFlux = 0;
  let zmin = Infinity, zmax = -Infinity;
  const fp = makeFootprint();
  let gi = 0;
  arrays.forEach((arr, pi) => {
    for (let r = 0; r < parts[pi].nRows; r++, gi++) {
      const ra = arr[r * nc];
      const dec = arr[r * nc + 1];
      const z = arr[r * nc + 2];
      if (!Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(z)) fail(`${name}: non-finite RA/DEC/Z in ${parts[pi].file} row ${r}`);
      zmin = Math.min(zmin, z); zmax = Math.max(zmax, z);
      fp.add(ra, dec);
      partOf[gi] = pi;
      if (hasFlux) {
        const fg = arr[r * nc + 3];
        const fr = arr[r * nc + 4];
        if (!(fg > 0) || !(fr > 0)) { badFlux++; continue; }
      }
      pool[np++] = gi;
    }
  });
  const offsets = [];
  let acc = 0;
  for (const p of parts) { offsets.push(acc); acc += p.nRows; }

  const K = Math.min(TARGET[name], np);
  // Partial Fisher-Yates: the first K entries become a uniform random sample in random order.
  const rand = mulberry32(SEED[name]);
  for (let i = 0; i < K; i++) {
    const j = i + Math.floor(rand() * (np - i));
    const t = pool[i]; pool[i] = pool[j]; pool[j] = t;
  }
  const STRIDE = hasFlux ? 5 : 4;
  const out = new Float32Array(K * STRIDE);
  let dmin = Infinity, dmax = 0, cmin = Infinity, cmax = -Infinity, zcmin = Infinity, zcmax = -Infinity;
  let nonPos = 0;
  const perCap = new Array(parts.length).fill(0);
  for (let i = 0; i < K; i++) {
    const g = pool[i];
    const pi = partOf[g];
    const r = g - offsets[pi];
    const arr = arrays[pi];
    const ra = arr[r * nc];
    const dec = arr[r * nc + 1];
    const zh = arr[r * nc + 2];
    const zc = zHelioToCmb(zh, ra, dec);
    if (!(zc > 0)) { nonPos++; fail(`${name}: non-positive CMB redshift ${zc} (unexpected for DESI clustering samples)`); }
    const d = tab.dc(zc);
    const cd = Math.cos(dec * DEG);
    out[i * STRIDE] = d * cd * Math.cos(ra * DEG);
    out[i * STRIDE + 1] = d * cd * Math.sin(ra * DEG);
    out[i * STRIDE + 2] = d * Math.sin(dec * DEG);
    out[i * STRIDE + 3] = zc;
    if (hasFlux) {
      const col = -2.5 * Math.log10(arr[r * nc + 3] / arr[r * nc + 4]);
      out[i * STRIDE + 4] = col;
      cmin = Math.min(cmin, col); cmax = Math.max(cmax, col);
    }
    dmin = Math.min(dmin, d); dmax = Math.max(dmax, d);
    zcmin = Math.min(zcmin, zc); zcmax = Math.max(zcmax, zc);
    perCap[pi]++;
  }
  for (let i = 0; i < out.length; i++) if (!Number.isFinite(out[i])) fail(`${name}: non-finite output value at ${i}`);
  return { name, parts, total, np, badFlux, K, STRIDE, out, zmin, zmax, zcmin, zcmax, dmin, dmax, cmin, cmax, nonPos, perCap, fp: fp.result() };
}

function header(res, file, tab) {
  const isBgs = res.name === 'BGS_BRIGHT';
  const fields = [
    { name: 'xMpc', unit: 'Mpc', description: 'comoving x: towards RA=0h, Dec=0 (ICRS)' },
    { name: 'yMpc', unit: 'Mpc', description: 'comoving y: towards RA=6h, Dec=0 (ICRS)' },
    { name: 'zMpc', unit: 'Mpc', description: 'comoving z: towards Dec=+90 (ICRS north pole)' },
    { name: 'redshift', unit: '1', description: 'CMB-frame redshift z_cmb used for the distance (input Z is solar-system-barycentric)' },
  ];
  if (isBgs) fields.push({ name: 'colorOrMag', unit: 'mag (AB)', description: 'g-r colour, observed frame, from Galactic-extinction-corrected Legacy Surveys DR9 fluxes: -2.5*log10(flux_g_dered/flux_r_dered). Typical range ~0.2 (blue, star-forming) to ~1.8 (red, passive, higher z).' });
  const capNames = res.parts.map((p) => (p.file.includes('_NGC_') ? 'NGC (north Galactic cap)' : 'SGC (south Galactic cap)'));
  return {
    schemaVersion: 1,
    generated: isoNow(),
    file,
    description: isBgs
      ? 'DESI DR1 Bright Galaxy Survey (BGS_BRIGHT, r<19.5) clustering sample, randomly down-sampled, as 3D points in comoving space: the main cosmic-web reveal.'
      : 'DESI DR1 Luminous Red Galaxy (LRG) clustering sample (0.4<z<1.1), randomly down-sampled: a deep, sparse shell showing the survey reach out to ~3.6 Gpc comoving.',
    encoding: 'float32 little-endian, interleaved records',
    count: res.K,
    stride: res.STRIDE,
    strideBytes: res.STRIDE * 4,
    byteLength: res.K * res.STRIDE * 4,
    fields,
    nullHandling: isBgs
      ? `No nulls/NaN. ${res.badFlux} catalogue rows with non-positive g or r flux (colour undefined) were excluded from the sampling pool before down-sampling.`
      : 'No nulls/NaN. The LRG clustering catalogue carries no photometry, so this file has no colour column (stride 4).',
    order: `Uniform random sample drawn with a seeded partial Fisher-Yates shuffle (mulberry32 seed ${SEED[res.name]}); records are in random order, so any prefix of N records is itself a uniform random subsample (use for progressive loading / level of detail).`,
    coordinateFrame: {
      axes: 'ICRS (J2000) equatorial Cartesian; x=(cos dec cos ra), y=(cos dec sin ra), z=(sin dec) times comoving distance',
      origin: 'observer (solar-system barycentre); the Milky Way is at the origin',
      distance: 'line-of-sight comoving distance D_C(z_cmb)',
      positionsAre: 'redshift-space (derived): peculiar velocities not removed (Fingers of God in clusters, Kaiser flattening).',
    },
    redshiftFrame: {
      used: 'CMB rest frame',
      inputFrame: 'solar-system barycentric (DESI Redrock Z, as stored in the LSS catalogues)',
      conversion: '1+z_cmb = (1+z_bary) * gamma * (1 + beta*cos(theta)); beta = v/c, theta = angle to CMB dipole apex',
      cmbDipole: { ...CMB_DIPOLE, apexRaDeg: round(CMB_APEX_RADEC[0], 4), apexDecDeg: round(CMB_APEX_RADEC[1], 4) },
    },
    cosmology: {
      ...COSMO,
      hubbleDistanceMpc: round(HUBBLE_DISTANCE_MPC, 4),
      integration: 'D_C(z) = (c/H0) * int_0^z dz/sqrt(Om(1+z)^3 + OL); cumulative composite Simpson on a uniform grid dz=1e-5, linear interpolation (error < 1e-6 Mpc)',
      checkComovingDistanceMpcAtZ0p1: round(tab.dc(0.1), 3),
    },
    source: {
      release: VERSION,
      dataReleasePaper: 'DESI Collaboration et al. 2026, AJ 171, 285: "Data Release 1 of the Dark Energy Spectroscopic Instrument"',
      catalogPapers: ['Ross A.J. et al. 2025, JCAP 01, 125 (construction of DESI LSS catalogs)', 'DESI Collaboration 2025, JCAP 07, 017 (DESI 2024 II: sample definitions, characteristics and two-point clustering statistics)'],
      files: res.parts.map((p, i) => ({ url: p.url, cap: capNames[i], rows: p.nRows, bytes: p.bytes, lastModified: p.lastModified, etag: p.etag, retrieved: p.retrieved, columnsRead: p.columns })),
      license: 'CC BY 4.0 (DESI Data License); changes: columns subset, frame change, distance computation, random down-sampling',
    },
    sampling: {
      catalogRows: res.total,
      poolRows: res.np,
      excludedNoColour: res.badFlux,
      sampled: res.K,
      fraction: round(res.K / res.np, 6),
      perCap: Object.fromEntries(res.parts.map((p, i) => [capNames[i], res.perCap[i]])),
      seed: SEED[res.name],
      weightsIgnored: 'Clustering weights (WEIGHT, WEIGHT_FKP, completeness) are NOT applied: points are galaxies, not a density estimator.',
    },
    selection: {
      tracer: res.name,
      targetSelection: isBgs ? 'BGS BRIGHT: r < 19.5 (Legacy Surveys DR9), flux-limited -> number density falls steeply with redshift' : 'LRG: colour-selected luminous red galaxies, approximately volume-limited 0.4<z<0.8, declining to z=1.1',
      catalogRedshiftRangeBarycentric: [round(res.zmin, 5), round(res.zmax, 5)],
      sampleRedshiftRangeCmb: [round(res.zcmin, 5), round(res.zcmax, 5)],
      distanceRangeMpc: [round(res.dmin, 2), round(res.dmax, 2)],
      ...(isBgs ? { colourRangeMag: [round(res.cmin, 3), round(res.cmax, 3)] } : {}),
    },
    footprint: {
      summary: 'Partial sky: two caps. The NGC footprint spans roughly RA 110-270 deg (Dec ~ -10 to +80); the SGC footprint wraps through RA 0 (roughly RA 300-360 and 0-50 deg, Dec ~ -20 to +35). Rendered in 3D the survey appears as two thick wedge-shaped cones with the observer at the apex; empty directions are unobserved sky (DR1 = first year of DESI), not voids.',
      ...res.fp,
    },
    caveats: [
      'Wedges: DR1 covers only part of the sky; edges of the cones are survey boundaries.',
      'Flux limit (BGS r<19.5): point density thins strongly beyond z~0.3; this is selection, not a real decline.',
      'Redshift-space distortions: clusters stretched radially (Fingers of God), large-scale walls flattened (Kaiser effect).',
      'Fibre-assignment incompleteness in DR1 is patchy (tile overlap pattern); weights that correct it are not applied.',
    ],
  };
}

async function main() {
  log(`targets: BGS_BRIGHT ${TARGET.BGS_BRIGHT}, LRG ${TARGET.LRG}; free disk ${fmtBytes(freeBytes(ROOT))}`);
  const tab = makeComovingTable(1.5, 1e-5);
  const outputs = [];
  const metaFiles = {};
  for (const [name, file] of [['BGS_BRIGHT', 'cosmicweb-deep'], ['LRG', 'cosmicweb-deep-lrg']]) {
    const res = await buildTracer(name, tab);
    const bin = writeOut(`${file}.bin`, Buffer.from(res.out.buffer));
    const hdr = header(res, `${file}.bin`, tab);
    if (hdr.byteLength !== bin.bytes) fail(`${file}: byteLength mismatch ${hdr.byteLength} vs ${bin.bytes}`);
    const js = writeOut(`${file}.json`, JSON.stringify(hdr, null, 1) + '\n');
    log(`${name}: sampled ${res.K} of ${res.np} (pool) / ${res.total} (catalogue); z_cmb ${res.zcmin.toFixed(4)}–${res.zcmax.toFixed(4)}; D ${res.dmin.toFixed(1)}–${res.dmax.toFixed(1)} Mpc; footprint ~${res.fp.approxAreaDeg2} deg2`);
    outputs.push(bin, js);
    metaFiles[name] = { files: [bin, js].map((f) => ({ path: f.rel, bytes: f.bytes })), records: res.K, catalogRows: res.total, sources: res.parts.map((p) => ({ url: p.url, retrieved: p.retrieved, rows: p.nRows, bytes: p.bytes, lastModified: p.lastModified })) };
  }
  writeMeta('desi-dr1-lss-bgs-bright', { ...metaFiles.BGS_BRIGHT, version: VERSION, endpoint: BASE });
  writeMeta('desi-dr1-lss-lrg', { ...metaFiles.LRG, version: VERSION, endpoint: BASE });
  log(`done: ${outputs.map((o) => `${o.rel} (${fmtBytes(o.bytes)})`).join(', ')}`);
}

main().catch((e) => { console.error(e.stack || e.message); process.exit(1); });
