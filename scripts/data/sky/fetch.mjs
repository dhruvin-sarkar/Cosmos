#!/usr/bin/env node
// Cosmos / AstroNexus — "sky" domain ingestion.
// Renders all-sky multi-wavelength images (equirectangular, ICRS, RA increasing to the right, RA=0 at the left edge)
// from CDS HiPS surveys via the CDS hips2fits service, normalises them, and writes:
//   public/data/sky/<band>/...jpg|png|bin|json, public/data/sky/bands.json, public/data/sky/manifest.part.json
//
// Usage: node scripts/data/sky/fetch.mjs [--only=visible,cmb] [--refresh] [--no-ultra]
//   --refresh   re-download raw renders even if cached in data-raw/sky
//   --only      process only the listed band ids (bands.json/manifest are rebuilt from all bands that have outputs)
//   --no-ultra  skip the 8192x4096 "ultra" visible render
//
// Raw downloads are cached in data-raw/sky (gitignored) with *.meta.json sidecars (URL, retrieval time, sha256).

import fs from 'node:fs';
import path from 'node:path';
import {
  sharp, log, fail, ensureDir, RAW_DIR, OUT_DIR, ROOT, CDS_HOSTS, HIPS2FITS_PATH, MOCSERVER_PATH,
  mocRecord, hips2fits, readFits, stats, renderScalar, buildLut, COLORMAPS, makeStretch, topDown,
  encodePng16, writeJpeg, writeMaskPng, freeBytes,
} from './lib.mjs';
import { BANDS, SIZES } from './bands.config.mjs';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v ?? true];
  }),
);
const ONLY = args.only ? String(args.only).split(',') : null;
const REFRESH = !!args.refresh;
const NO_ULTRA = !!args['no-ultra'];

const Q = { ultra: 85, high: 88, low: 82 };
const rel = (p) => path.relative(`${ROOT}/public`, p).replace(/\\/g, '/');

function fileInfo(p, extra = {}) {
  return { path: rel(p), bytes: fs.statSync(p).size, ...extra };
}

function applyLevels(buf, channels, { black = 0, white = 255, gamma = 1 }) {
  const lut = new Uint8Array(256);
  for (let v = 0; v < 256; v++) {
    const t = Math.min(1, Math.max(0, (v - black) / (white - black)));
    lut[v] = Math.round(255 * t ** gamma);
  }
  for (let i = 0; i < buf.length; i++) if (channels === 3 || i % channels !== 3) buf[i] = lut[buf[i]];
}

/** Decode an image file to raw RGB (+ optional binary mask from alpha). Pixels with alpha=0 become black. */
async function decodeRgb(file) {
  const img = sharp(file, { limitInputPixels: false });
  const meta = await img.metadata();
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const n = info.width * info.height;
  const rgb = Buffer.alloc(n * 3);
  const mask = Buffer.alloc(n);
  let transparent = 0;
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3];
    if (a === 0) {
      transparent++;
      continue;
    }
    // composite over black (premultiply)
    rgb[i * 3] = Math.round((data[i * 4] * a) / 255);
    rgb[i * 3 + 1] = Math.round((data[i * 4 + 1] * a) / 255);
    rgb[i * 3 + 2] = Math.round((data[i * 4 + 2] * a) / 255);
    mask[i] = 255;
  }
  return { rgb, mask, width: info.width, height: info.height, transparent, hadAlpha: meta.hasAlpha === true };
}

function fitsSummary(s, scale = 1) {
  const f = (v) => (v == null ? null : +(v * scale).toPrecision(5));
  return { nan: s.nan, inf: s.inf, min: f(s.min), p01: f(s.p01), p50: f(s.p50), p99: f(s.p99), max: f(s.max) };
}

// ------------------------------------------------------------------------------------------------ per-kind processors
async function processRgb(band, dir) {
  const r = band.render;
  const ultraW = !NO_ULTRA && r.ultra ? r.ultra : null;
  const srcW = ultraW || SIZES.high;
  const dl = await hips2fits(band.hipsId, srcW, r.format, { dir: band.id, name: band.id, refresh: REFRESH });
  const dec = await decodeRgb(dl.path);
  if (dec.width !== srcW || dec.height !== srcW / 2) fail(`${band.id}: unexpected render size ${dec.width}x${dec.height}`);
  if (r.levels) applyLevels(dec.rgb, 3, r.levels);
  const raw = { width: dec.width, height: dec.height, channels: 3 };
  const files = {};
  if (ultraW) {
    const p = `${dir}/${band.id}_8k.jpg`;
    await writeJpeg(dec.rgb, raw, p, { quality: Q.ultra });
    files.ultra = fileInfo(p, { width: ultraW, height: ultraW / 2, mime: 'image/jpeg' });
  }
  const ph = `${dir}/${band.id}_4k.jpg`;
  await writeJpeg(dec.rgb, raw, ph, { quality: Q.high, resizeTo: srcW === SIZES.high ? undefined : SIZES.high });
  files.high = fileInfo(ph, { width: SIZES.high, height: SIZES.high / 2, mime: 'image/jpeg' });
  const pl = `${dir}/${band.id}_1k.jpg`;
  await writeJpeg(dec.rgb, raw, pl, { quality: Q.low, resizeTo: SIZES.low });
  files.low = fileInfo(pl, { width: SIZES.low, height: SIZES.low / 2, mime: 'image/jpeg' });
  let coverage = 1;
  if (r.mask) {
    const covered = dec.width * dec.height - dec.transparent;
    coverage = covered / (dec.width * dec.height);
    const pm = `${dir}/${band.id}_mask_2k.png`;
    await writeMaskPng(dec.mask, dec.width, dec.height, pm, 2048);
    files.mask = fileInfo(pm, { width: 2048, height: 1024, mime: 'image/png', meaning: '8-bit greyscale: 255 = survey data present, 0 = no data (rendered black in the colour images)' });
  }
  return {
    files,
    downloads: [dl],
    processing: {
      source: `hips2fits ${r.format.toUpperCase()} render of the survey's own colour HiPS (${srcW}x${srcW / 2}), used as delivered${r.levels ? ' except for a per-channel levels curve' : ''}.`,
      stretch: r.levels
        ? `levels per channel: out = 255 * clamp((in - ${r.levels.black}) / (${r.levels.white} - ${r.levels.black}), 0, 1) ^ ${r.levels.gamma}`
        : 'none by Cosmos (colour composite and stretch as published in the HiPS by its creator)',
      colormap: 'none (survey RGB composite)',
      alpha: dec.hadAlpha ? `transparent (no-data) pixels composited over black${r.mask ? '; see mask file' : ''}` : 'no alpha channel',
      resampling: `hips2fits reprojection from HEALPix to CAR; ${ultraW ? '8192 -> 4096 and ' : ''}${SIZES.high} -> ${SIZES.low} downsampling with Lanczos-3 (sharp)`,
    },
    coverageFraction: +coverage.toFixed(4),
  };
}

async function processScalar(band, dir) {
  const r = band.render;
  const dl = await hips2fits(band.hipsId, SIZES.high, 'fits', { dir: band.id, name: band.id, refresh: REFRESH });
  const fits = readFits(dl.path);
  if (fits.width !== SIZES.high || fits.height !== SIZES.high / 2) fail(`${band.id}: FITS size ${fits.width}x${fits.height}`);
  const s = stats(fits.data);
  log(`  ${band.id} FITS stats (${r.unit}):`, JSON.stringify(fitsSummary(s)));
  const out = renderScalar(fits, r);
  const raw = { width: out.width, height: out.height, channels: 3 };
  const ph = `${dir}/${band.id}_4k.jpg`;
  await writeJpeg(out.rgb, raw, ph, { quality: Q.high });
  const pl = `${dir}/${band.id}_1k.jpg`;
  await writeJpeg(out.rgb, raw, pl, { quality: Q.low, resizeTo: SIZES.low });
  const n = out.width * out.height;
  return {
    files: {
      high: fileInfo(ph, { width: SIZES.high, height: SIZES.high / 2, mime: 'image/jpeg' }),
      low: fileInfo(pl, { width: SIZES.low, height: SIZES.low / 2, mime: 'image/jpeg' }),
    },
    downloads: [dl],
    processing: {
      source: `hips2fits FITS render (float, ${r.unit}) of the survey HiPS at ${SIZES.high}x${SIZES.high / 2}; colourised by Cosmos.`,
      stretch: r.stretch === 'log10'
        ? `log10: t = (log10(v) - log10(${r.min})) / (log10(${r.max}) - log10(${r.min})), clipped to [0,1]; v <= 0 -> t = 0`
        : `${r.stretch} between ${r.min} and ${r.max} ${r.unit}`,
      colormap: `${r.colormap}: piecewise-linear sRGB interpolation through evenly spaced stops ${COLORMAPS[r.colormap].join(' ')}`,
      resampling: `hips2fits reprojection from HEALPix to CAR; ${SIZES.high} -> ${SIZES.low} Lanczos-3 (sharp)`,
      dataStats: { unit: r.unit, ...fitsSummary(s), clippedLowFraction: +(out.clipLo / n).toFixed(5), clippedHighFraction: +(out.clipHi / n).toFixed(5) },
    },
    colorScale: { quantity: r.unitLabel, unit: r.unit, stretch: r.stretch, min: r.min, max: r.max, colormap: r.colormap, stops: COLORMAPS[r.colormap] },
    coverageFraction: +(1 - out.nan / n).toFixed(4),
  };
}

async function processRgbFits(band, dir) {
  const r = band.render;
  const dls = [];
  const chans = [];
  for (const ch of r.channels) {
    const dl = await hips2fits(ch.hipsId, SIZES.high, 'fits', { dir: band.id, name: ch.name, refresh: REFRESH });
    dls.push(dl);
    const fits = readFits(dl.path);
    const s = stats(fits.data);
    log(`  ${band.id}/${ch.name} FITS stats (${ch.unit}):`, JSON.stringify(fitsSummary(s)));
    chans.push({ ch, fits, s });
  }
  const w = SIZES.high;
  const h = w / 2;
  const n = w * h;
  const planes = chans.map(({ ch, fits }) => {
    const f = makeStretch(ch);
    const td = topDown(fits);
    const p = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const v = td[i];
      p[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, f(v))) : 0;
    }
    return p;
  });
  // R = soft, B = hard, G = mean of the two (documented in processing.stretch)
  const rgb = Buffer.alloc(n * 3);
  for (let i = 0; i < n; i++) {
    const R = planes[0][i];
    const B = planes[1][i];
    const G = 0.5 * (R + B);
    rgb[i * 3] = Math.round(255 * R);
    rgb[i * 3 + 1] = Math.round(255 * G);
    rgb[i * 3 + 2] = Math.round(255 * B);
  }
  const raw = { width: w, height: h, channels: 3 };
  const ph = `${dir}/${band.id}_4k.jpg`;
  await writeJpeg(rgb, raw, ph, { quality: Q.high });
  const pl = `${dir}/${band.id}_1k.jpg`;
  await writeJpeg(rgb, raw, pl, { quality: Q.low, resizeTo: SIZES.low });
  return {
    files: {
      high: fileInfo(ph, { width: w, height: h, mime: 'image/jpeg' }),
      low: fileInfo(pl, { width: SIZES.low, height: SIZES.low / 2, mime: 'image/jpeg' }),
    },
    downloads: dls,
    processing: {
      source: `hips2fits FITS renders (float) of ${r.channels.map((c) => c.hipsId).join(' and ')} at ${w}x${h}; combined by Cosmos.`,
      stretch: r.channels
        .map((c) => `${c.role}: ${c.label} — ${c.stretch} t = asinh((v - ${c.min}) / ${c.softening}) / asinh((${c.max} - ${c.min}) / ${c.softening}) clipped to [0,1] (${c.unit})`)
        .join('; ') + '; green = (red + blue) / 2; channel value = round(255 * t)',
      colormap: 'none (two-band false-colour composite: red = soft, blue = hard, green = their mean)',
      resampling: `hips2fits reprojection from HEALPix to CAR; ${w} -> ${SIZES.low} Lanczos-3 (sharp)`,
      dataStats: chans.map(({ ch, s }) => ({ channel: ch.name, unit: ch.unit, ...fitsSummary(s) })),
    },
    coverageFraction: 1,
  };
}

async function processCmb(band, dir) {
  const r = band.render;
  const dl = await hips2fits(band.hipsId, SIZES.high, 'fits', { dir: band.id, name: band.id, refresh: REFRESH });
  const fits = readFits(dl.path);
  const w = fits.width;
  const h = fits.height;
  if (w !== SIZES.high || h !== SIZES.high / 2) fail(`cmb: FITS size ${w}x${h}`);
  const tK = topDown(fits); // K_CMB, top row = north
  const n = w * h;
  const s = stats(tK);
  log('  cmb FITS stats (uK):', JSON.stringify(fitsSummary(s, 1e6)));
  if (s.nan || s.inf) fail(`cmb: FITS contains ${s.nan} NaN / ${s.inf} Inf values`);

  // 1) 16-bit greyscale PNG: grey = clamp(round(dT_uK / ukPerLevel) + offset, 0, 65535)
  const { offset, ukPerLevel } = r.png16;
  const u16 = new Uint16Array(n);
  let clipLo = 0;
  let clipHi = 0;
  let sum = 0;
  let sum2 = 0;
  for (let i = 0; i < n; i++) {
    const uk = tK[i] * 1e6;
    sum += uk;
    sum2 += uk * uk;
    let g = Math.round(uk / ukPerLevel) + offset;
    if (g < 0) { g = 0; clipLo++; } else if (g > 65535) { g = 65535; clipHi++; }
    u16[i] = g;
  }
  const meanUk = sum / n;
  const rmsUk = Math.sqrt(sum2 / n - meanUk * meanUk);
  const minRep = (0 - offset) * ukPerLevel;
  const maxRep = (65535 - offset) * ukPerLevel;
  const p16 = `${dir}/cmb_smica_4k_u16.png`;
  const png = encodePng16(u16, w, h, {
    Title: 'Planck PR3 SMICA CMB temperature anisotropy (Cosmos equirectangular ICRS)',
    Description: `dT_uK = (grey - ${offset}) * ${ukPerLevel} ; representable range ${minRep} .. ${maxRep} uK (values outside are clipped to 0 / 65535). Pixel (x,y) centre: RA = 360*(x+0.5)/${w} deg, Dec = 90 - 180*(y+0.5)/${h} deg (ICRS).`,
    Source: `${band.hipsId} (COM_CMB_IQU-smica_2048_R3.00_full, I_STOKES) via CDS hips2fits`,
    Copyright: 'ESA, Planck Collaboration (CC BY-NC 3.0 IGO)',
  });
  fs.writeFileSync(p16, png);

  // 2) colour-mapped JPEGs
  const lut = buildLut(COLORMAPS[r.colormap]);
  const L = lut.length / 3 - 1;
  const rgb = Buffer.alloc(n * 3);
  let cClipLo = 0;
  let cClipHi = 0;
  for (let i = 0; i < n; i++) {
    let t = (tK[i] * 1e6 - r.minUk) / (r.maxUk - r.minUk);
    if (t < 0) { t = 0; cClipLo++; } else if (t > 1) { t = 1; cClipHi++; }
    const k = Math.round(t * L) * 3;
    rgb[i * 3] = lut[k];
    rgb[i * 3 + 1] = lut[k + 1];
    rgb[i * 3 + 2] = lut[k + 2];
  }
  const raw = { width: w, height: h, channels: 3 };
  const ph = `${dir}/cmb_4k.jpg`;
  await writeJpeg(rgb, raw, ph, { quality: Q.high });
  const pl = `${dir}/cmb_1k.jpg`;
  await writeJpeg(rgb, raw, pl, { quality: Q.low, resizeTo: SIZES.low });

  // 3) Float32 grid (block mean) for numeric read-outs without PNG decoding
  const fw = r.f32Width;
  const fh = fw / 2;
  const k = w / fw;
  const f32 = new Float32Array(fw * fh);
  for (let y = 0; y < fh; y++) {
    for (let x = 0; x < fw; x++) {
      let acc = 0;
      for (let dy = 0; dy < k; dy++) for (let dx = 0; dx < k; dx++) acc += tK[(y * k + dy) * w + x * k + dx];
      f32[y * fw + x] = (acc / (k * k)) * 1e6;
    }
  }
  const pb = `${dir}/cmb_smica_1k_f32.bin`;
  fs.writeFileSync(pb, Buffer.from(f32.buffer)); // little-endian on x86/ARM hosts
  const pbj = `${dir}/cmb_smica_1k_f32.json`;
  const binHeader = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    file: 'cmb_smica_1k_f32.bin',
    encoding: 'little-endian IEEE-754 Float32, no header, row-major',
    width: fw,
    height: fh,
    count: fw * fh,
    stride: 1,
    fields: ['deltaT_uK'],
    units: { deltaT_uK: 'microkelvin (K_CMB thermodynamic temperature difference from the 2.7255 K mean)' },
    layout: `index = y*${fw} + x; pixel centre RA = 360*(x+0.5)/${fw} deg, Dec = 90 - 180*(y+0.5)/${fh} deg (ICRS); row 0 = north`,
    derivation: `mean of ${k}x${k} blocks of the ${w}x${h} hips2fits FITS render of ${band.hipsId}`,
    nullPolicy: 'no missing values (full-sky map); NaN never written',
  };
  fs.writeFileSync(pbj, JSON.stringify(binHeader, null, 1));

  return {
    files: {
      high: fileInfo(ph, { width: w, height: h, mime: 'image/jpeg' }),
      low: fileInfo(pl, { width: SIZES.low, height: SIZES.low / 2, mime: 'image/jpeg' }),
      data16: fileInfo(p16, {
        width: w, height: h, mime: 'image/png', bitDepth: 16,
        decode: `dT_uK = (grey - ${offset}) * ${ukPerLevel}`, offset, ukPerLevel,
        representableRangeUk: [minRep, maxRep], clippedPixels: clipLo + clipHi,
      }),
      dataF32: fileInfo(pb, { width: fw, height: fh, mime: 'application/octet-stream', header: rel(pbj), unit: 'uK' }),
      dataF32Header: fileInfo(pbj, { mime: 'application/json' }),
    },
    downloads: [dl],
    processing: {
      source: `hips2fits FITS render (float32, K_CMB) of ${band.hipsId} at ${w}x${h}; converted to uK (x1e6).`,
      stretch: `colour JPEG: linear, t = (dT_uK - (${r.minUk})) / (${r.maxUk} - (${r.minUk})), clipped to [0,1]; 16-bit PNG: linear, dT_uK = (grey - ${offset}) * ${ukPerLevel}`,
      colormap: `${r.colormap}: piecewise-linear sRGB interpolation through evenly spaced stops ${COLORMAPS[r.colormap].join(' ')} (blue = colder, white = mean, red = warmer)`,
      resampling: `hips2fits reprojection from HEALPix (Nside 2048) to CAR ${w}x${h}; ${w} -> ${SIZES.low} Lanczos-3 for the preview; ${k}x${k} block mean for the Float32 grid`,
      dataStats: {
        unit: 'uK', meanUk: +meanUk.toFixed(3), rmsUk: +rmsUk.toFixed(3), ...fitsSummary(s, 1e6),
        png16ClippedPixels: clipLo + clipHi, colourClippedLowFraction: +(cClipLo / n).toFixed(5), colourClippedHighFraction: +(cClipHi / n).toFixed(5),
      },
    },
    colorScale: { quantity: 'CMB temperature anisotropy dT', unit: 'uK', stretch: 'linear', min: r.minUk, max: r.maxUk, colormap: r.colormap, stops: COLORMAPS[r.colormap] },
    coverageFraction: 1,
  };
}

// ------------------------------------------------------------------------------------------------ main
const PROCESSORS = { rgb: processRgb, scalar: processScalar, rgbFits: processRgbFits, cmb: processCmb };

async function main() {
  log(`root ${ROOT}; free disk ${(freeBytes() / 1e9).toFixed(2)} GB`);
  ensureDir(RAW_DIR);
  ensureDir(OUT_DIR);
  const statePath = `${RAW_DIR}/band-results.json`;
  const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {};
  for (const band of BANDS) {
    if (ONLY && !ONLY.includes(band.id)) continue;
    log(`== ${band.id} (${band.hipsId})`);
    const dir = `${OUT_DIR}/${band.id}`;
    ensureDir(dir);
    const moc = await mocRecord(band.hipsId, { refresh: REFRESH });
    const res = await PROCESSORS[band.render.kind](band, dir);
    // also fetch MocServer records for channel HiPS (rgbFits)
    const channelRecords = [];
    for (const ch of band.render.channels || []) {
      if (ch.hipsId === band.hipsId) continue;
      channelRecords.push((await mocRecord(ch.hipsId, { refresh: REFRESH })).record);
    }
    state[band.id] = { ...res, moc: { record: moc.record, retrieved: moc.meta.retrieved, query: moc.query }, channelRecords, builtAt: new Date().toISOString() };
    fs.writeFileSync(statePath, JSON.stringify(state));
    log(`  outputs: ${Object.values(res.files).map((f) => `${f.path} (${(f.bytes / 1e6).toFixed(2)} MB)`).join(', ')}`);
  }
  writeBandsJson(state);
  writeManifest(state);
  const total = dirSize(OUT_DIR);
  log(`done. public/data/sky total ${(total / 1e6).toFixed(1)} MB; free disk ${(freeBytes() / 1e9).toFixed(2)} GB`);
}

function dirSize(d) {
  let t = 0;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = `${d}/${e.name}`;
    t += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return t;
}

const CONVENTION =
  'All sky images are equirectangular (plate carree, CAR) all-sky maps in ICRS (J2000) equatorial coordinates with width W = 2 x height H. ' +
  'Pixel column x (0-based) has its centre at RA = 360*(x+0.5)/W degrees: RA increases to the RIGHT in the stored image and RA = 0 h lies on the left edge (RA = 360 on the right edge). ' +
  'Pixel row y (0-based from the top) has its centre at Dec = 90 - 180*(y+0.5)/H degrees: north celestial pole along the top edge, south celestial pole along the bottom. ' +
  'This is the view of the celestial sphere from OUTSIDE (like a globe texture); as seen from inside the sphere (the real sky), east is to the left, so a sky-sphere renderer must mirror the texture horizontally (or map it onto the inside of the sphere with u = RA/360 increasing eastward). ' +
  'Direction for a pixel: v = (cos Dec cos RA, cos Dec sin RA, sin Dec) in ICRS. Landmarks: Galactic Centre (RA 266.40, Dec -28.94) at x/W = 0.740, y/H = 0.661; LMC (RA 80.9, Dec -69.8) at x/W = 0.225, y/H = 0.888; Orion Nebula (RA 83.8, Dec -5.4) at x/W = 0.233, y/H = 0.530.';

function emLabel(rec) {
  const a = Number(rec.em_min);
  const b = Number(rec.em_max);
  return Number.isFinite(a) && Number.isFinite(b) ? { emMinM: a, emMaxM: b } : { emMinM: null, emMaxM: null };
}

function writeBandsJson(state) {
  const bands = [];
  for (const b of BANDS) {
    const s = state[b.id];
    if (!s) continue;
    bands.push({
      id: b.id,
      label: b.label,
      regime: b.regime,
      wavelengthLabel: b.wavelengthLabel,
      ...emLabel(s.moc.record),
      survey: b.survey,
      instrument: b.instrument,
      hipsId: b.hipsId,
      hipsChannels: (b.render.channels || []).map((c) => ({ role: c.role, hipsId: c.hipsId, label: c.label })),
      hipsServiceUrl: s.moc.record.hips_service_url ?? null,
      hipsReleaseDate: s.moc.record.hips_release_date ?? null,
      files: s.files,
      credit: b.credit,
      license: b.license,
      licenseUrl: b.licenseUrl,
      citation: b.citation,
      processing: s.processing,
      colorScale: s.colorScale ?? null,
      coverageFraction: s.coverageFraction,
      reveals: b.reveals,
      caveats: b.caveats,
      provenanceClass: b.provenanceClass,
      retrieved: s.downloads.map((d) => d.meta.retrieved).sort()[0],
    });
  }
  const doc = {
    schemaVersion: 1,
    generated: new Date().toISOString(),
    domain: 'sky',
    convention: CONVENTION,
    projection: { type: 'equirectangular (CAR)', frame: 'ICRS', aspect: '2:1', raOfPixelCenter: 'RA = 360*(x+0.5)/W', decOfPixelCenter: 'Dec = 90 - 180*(y+0.5)/H', raIncreases: 'right', raAtLeftEdgeDeg: 0 },
    pathsRelativeTo: 'public/ (prepend the app base URL, e.g. fetch(`${import.meta.env.BASE_URL}${file.path}`))',
    credits: {
      hips: 'HiPS: Fernique P. et al. 2015, A&A 578, A114 (IVOA HiPS standard); HiPS surveys distributed by CDS, Strasbourg Astronomical Observatory, France (CNRS/Unistra) unless stated otherwise.',
      hips2fits: 'All-sky reprojections made with hips2fits, a service provided by CDS (https://alasky.cds.unistra.fr/hips-image-services/hips2fits).',
    },
    bands,
  };
  fs.writeFileSync(`${OUT_DIR}/bands.json`, JSON.stringify(doc, null, 1));
  log(`wrote bands.json (${bands.length} bands)`);
}

function writeManifest(state) {
  const datasets = [];
  for (const b of BANDS) {
    const s = state[b.id];
    if (!s) continue;
    const rec = s.moc.record;
    const files = Object.values(s.files).map((f) => ({ path: f.path, bytes: f.bytes, records: f.width && f.height ? f.width * f.height : null }));
    const queries = s.downloads.map((d) => `GET ${CDS_HOSTS[0]}${HIPS2FITS_PATH}?${decodeURIComponent(d.query)}`);
    datasets.push({
      id: `sky-${b.id}`,
      name: `${b.label} all-sky map — ${b.survey}`,
      organization: rec.obs_copyright ? `${rec.obs_copyright}; HiPS by ${rec.hips_creator || rec.hips_copyright || 'CDS'}` : `${b.credit.split('.')[0]}; HiPS by ${rec.hips_creator || rec.hips_copyright || 'CDS'}`,
      purpose: b.id === 'cmb'
        ? 'Cosmology finale (CMB sphere) and the Microwave/CMB mode of the Spectral View Switcher; numeric temperature read-outs.'
        : `Spectral View Switcher: real ${b.wavelengthLabel} all-sky texture for the celestial sphere (not recoloured visible light).`,
      mechanism: `CDS hips2fits service (HTTP GET, explicit CAR/ICRS WCS JSON) -> ${s.downloads.map((d) => path.extname(d.path).slice(1).toUpperCase()).join(' + ')} -> sharp/Node normalisation -> JPEG/PNG${b.id === 'cmb' ? '/Float32' : ''}; HiPS discovered via the CDS MocServer`,
      endpoint: `${CDS_HOSTS[0]}${HIPS2FITS_PATH}`,
      query: queries.join(' ; '),
      version: `HiPS ${b.hipsId}${(b.render.channels || []).length ? ` (+ ${(b.render.channels || []).map((c) => c.hipsId).filter((x) => x !== b.hipsId).join(', ')})` : ''} released ${rec.hips_release_date || 'unknown'}${rec.hips_version ? ` (HiPS standard ${rec.hips_version})` : ''}; ${b.survey}`,
      retrieved: s.downloads.map((d) => d.meta.retrieved).sort()[0],
      license: b.license,
      licenseUrl: b.licenseUrl,
      citation: `${b.credit} ${b.citation} HiPS: Fernique et al. 2015, A&A 578, A114; reprojection: CDS hips2fits.`,
      rateLimits: 'hips2fits: not documented (max 50 million pixels per image; two independent endpoints alasky/alaskybis); MocServer: not documented. Cosmos throttles to >=1.1 s between requests per host, sequential, with retries/backoff.',
      fieldsUsed: b.render.kind === 'rgb' ? ['RGB colour HiPS tiles (8-bit)'] : b.render.kind === 'cmb' ? ['I_STOKES temperature (K_CMB) HiPS FITS tiles'] : ['HiPS FITS tiles (physical values)'],
      updateCadence: 'static survey release (re-render only if CDS re-publishes the HiPS)',
      cachePolicy: 'versioned offline snapshot; optional online refresh',
      normalization: 'scripts/data/sky/fetch.mjs',
      fallback: b.id === 'cmb'
        ? 'If missing, show the low-resolution preview (cmb_1k.jpg) or a labelled placeholder sphere; never synthesize a fake CMB pattern.'
        : 'If missing, fall back to the 1024x512 preview; if that is missing too, hide this band in the switcher (do not recolour another band).',
      files,
      limitations: b.caveats.join(' '),
      provenanceClass: b.provenanceClass,
    });
  }
  const doc = { domain: 'sky', datasets };
  fs.writeFileSync(`${OUT_DIR}/manifest.part.json`, JSON.stringify(doc, null, 1));
  log(`wrote manifest.part.json (${datasets.length} datasets)`);
}

main().catch((e) => {
  console.error(e.fatal ? e.message : e);
  process.exit(1);
});
