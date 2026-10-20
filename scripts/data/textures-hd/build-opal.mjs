// tex-planets: true-colour global maps of Uranus and Neptune from Hubble OPAL (Outer Planet Atmospheres Legacy,
// PI A. Simon; STScI MAST HLSP, doi:10.17909/T9G593). FITS mosaics per filter (2 px/deg, Minnaert-corrected, scale
// factors -> I/F from the per-epoch README), R = F657N, G = F547M, B = F467M.
//   node scripts/data/textures-hd/build-opal.mjs            (raws: data-raw/big/tex-planets/opal/)
// Processing:
// - Source: rows north (+90, IAU north) -> south, planetographic latitude; x = 0 at 360 W, W longitude decreasing to the
//   right (= east-positive). Output: x = 0 at 180 W, east-positive, north up, planetocentric latitude.
// - Colour: per-channel factors fixed once from Uranus so its observed |lat|<40 mean matches the Voyager 2 / HST true
//   colour sRGB (172, 208, 214) (src/domains/solar/constants.ts; Irwin et al. 2024, MNRAS 527, 11521); the SAME factors
//   are applied to Neptune, so Neptune's colour relative to Uranus is measured, not chosen.
// - Albedo: luminance scaled so the mean linear luminance (|lat|<60) equals the geometric albedo (0.51 / 0.41).
// - Unobserved latitudes (Uranus south of ~-32 deg in Nov 2024; Neptune north of ~+70 deg in Aug 2025) are filled with
//   the zonal-mean profile mirrored from the opposite hemisphere (Uranus: Voyager 2 saw the mirror-image south polar
//   brightening in 1986) or the nearest observed row (Neptune), feathered over 6 deg; recorded as coverage.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEX, RAW, rel, log, sharp, srgbToLinearLut as S2L, linearToSrgb8 } from './lib.mjs';

const DIR = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'opal');
const JOBS = {
  uranus: { filters: ['f657n', 'f547m', 'f467m'], OW: 1440, trimDeg: 18, epoch: 'uranus-2024a', a: 25559, b: 24973, albedo: 0.51, scale: { f657n: 0.00442, f547m: 0.00267, f467m: 0.00318 }, fill: 'mirror', date: 'HST WFC3/UVIS 2024-11-09' },
  neptune: { filters: ['f657n', 'f547m', 'f467m'], OW: 1440, trimDeg: 18, epoch: 'neptune-2025b', a: 24764, b: 24341, albedo: 0.41, scale: { f657n: 0.00413, f547m: 0.00257, f467m: 0.00496 }, fill: 'nearest', date: 'HST WFC3/UVIS 2025-08-24' },
  // Giants: R = F631N, G = F502N, B = F467M; colour/albedo reference = the current app look (mean of the Solar System
  // Scope map x the art-directed tint in constants.ts), so only the structure and the relative band colours change.
  jupiter: { filters: ['f631n', 'f502n', 'f467m'], OW: 4096, trimDeg: 6, epoch: 'jupiter-2025a', a: 71492, b: 66854, scale: { f631n: 0.00383, f502n: 0.00386, f467m: 0.00376 }, fill: 'nearest', date: 'HST WFC3/UVIS 2025', contrast: 1.7, ref: { file: 'jupiter/color_4k.jpg', tint: [1.04, 1.0, 0.86] } },
  saturn: { filters: ['f631n', 'f502n', 'f467m'], OW: 2048, trimDeg: 6, epoch: 'saturn-2025a', a: 60268, b: 54364, scale: { f631n: 0.00362, f502n: 0.00285, f467m: 0.00507 }, fill: 'nearest', date: 'HST WFC3/UVIS 2025-08-29', ref: { file: 'saturn/color_4k.jpg', tint: [0.82, 0.74, 0.56] } },
};
const URANUS_REF = [172, 208, 214].map((v) => S2L[v]);

function readFits(file) {
  const b = fs.readFileSync(file);
  let off = 0, W = 0, H = 0;
  for (;;) {
    const blk = b.subarray(off, off + 2880).toString('latin1'); off += 2880;
    const cards = blk.match(/.{80}/g);
    for (const c of cards) { const m = /^(NAXIS[12])\s*=\s*(\d+)/.exec(c); if (m) { if (m[1] === 'NAXIS1') W = +m[2]; else H = +m[2]; } }
    if (cards.some((c) => /^END\s*$/.test(c))) break;
  }
  const d = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) d[i] = b.readFloatBE(off + i * 4);
  return { d, W, H };
}

function build(body) {
  const j = JOBS[body];
  const ch = j.filters.map((f) => {
    const { d, W, H } = readFits(path.join(DIR, `hlsp_opal_hst_wfc3-uvis_${j.epoch}_${f}_v1_globalmap.fits`));
    for (let i = 0; i < d.length; i++) d[i] = Number.isFinite(d[i]) && d[i] > 0 ? d[i] * j.scale[f] : NaN;
    return { d, W, H };
  });
  const { W: SW, H: SH } = ch[0];
  const valid = (i) => ch.every((c) => Number.isFinite(c.d[i]));
  // Output grid (planetocentric): ~2x the source sampling for the ice giants, ~source sampling for the gas giants.
  const ppd = (SW - 1) / 360;
  const OW = j.OW, OH = OW / 2;
  const img = [new Float32Array(OW * OH), new Float32Array(OW * OH), new Float32Array(OW * OH)];
  const obs = new Uint8Array(OW * OH);
  const k2 = (j.a / j.b) ** 2;
  for (let y = 0; y < OH; y++) {
    const latC = 90 - ((y + 0.5) * 180) / OH;
    const latG = (Math.atan(Math.tan((latC * Math.PI) / 180) * k2) * 180) / Math.PI;
    const sy = Math.max(0, Math.min(SH - 1.001, (90 - latG) * ppd));
    const y0 = Math.floor(sy), ty = sy - y0;
    for (let x = 0; x < OW; x++) {
      const lonE = -180 + ((x + 0.5) * 360) / OW;
      const sx = (((lonE % 360) + 360) % 360) * ppd;
      const x0 = Math.floor(sx) % (SW - 1), x1 = (x0 + 1) % (SW - 1), tx = sx - Math.floor(sx);
      const idx = [[y0 * SW + x0, (1 - tx) * (1 - ty)], [y0 * SW + x1, tx * (1 - ty)], [(y0 + 1) * SW + x0, (1 - tx) * ty], [(y0 + 1) * SW + x1, tx * ty]];
      if (!idx.every(([i, w]) => w === 0 || valid(i))) continue;
      for (let c = 0; c < 3; c++) { let s = 0; for (const [i, w] of idx) if (w) s += ch[c].d[i] * w; img[c][y * OW + x] = s; }
      obs[y * OW + x] = 1;
    }
  }
  // Limb trim: Minnaert-corrected data blow up (and the filters misregister) near the limb / terminator, so keep a
  // pixel only if everything within 10 deg of latitude is observed too (erosion along latitude; poles count as observed).
  const T = Math.round((j.trimDeg * OH) / 180);
  const keep = new Uint8Array(OW * OH);
  for (let x = 0; x < OW; x++) {
    let last = -1e9;
    const up = new Int32Array(OH);
    for (let y = 0; y < OH; y++) { if (!obs[y * OW + x]) last = y; up[y] = y - last; }
    last = 1e9;
    for (let y = OH - 1; y >= 0; y--) { if (!obs[y * OW + x]) last = y; keep[y * OW + x] = Math.min(up[y], last - y) > T ? 1 : 0; }
  }
  obs.set(keep);
  // Zonal means of observed pixels; fill.
  const zonal = [];
  for (let y = 0; y < OH; y++) {
    const s = [0, 0, 0]; let n = 0;
    for (let x = 0; x < OW; x++) if (obs[y * OW + x]) { for (let c = 0; c < 3; c++) s[c] += img[c][y * OW + x]; n++; }
    zonal.push(n > OW * 0.5 ? s.map((v) => v / n) : null);
  }
  const firstObs = zonal.findIndex((z) => z), lastObs = OH - 1 - [...zonal].reverse().findIndex((z) => z);
  const fillRow = (y) => {
    if (zonal[y]) return zonal[y];
    if (j.fill === 'mirror' && zonal[OH - 1 - y]) return zonal[OH - 1 - y];
    return zonal[y < firstObs ? firstObs : lastObs];
  };
  // Per-column feather: blend observed data into the fill over 8 deg (32 rows) measured from that column's coverage edge.
  const F = Math.round((8 * OH) / 180);
  let observedPx = 0;
  for (let x = 0; x < OW; x++) {
    const dist = new Int32Array(OH).fill(1e6);
    let last = -1e6;
    for (let y = 0; y < OH; y++) { if (!obs[y * OW + x]) last = y; else dist[y] = Math.min(dist[y], y - last); }
    last = 1e6;
    for (let y = OH - 1; y >= 0; y--) { if (!obs[y * OW + x]) last = y; else dist[y] = Math.min(dist[y], last - y); }
    for (let y = 0; y < OH; y++) {
      const i = y * OW + x, fr = fillRow(y);
      if (!obs[i]) { for (let c = 0; c < 3; c++) img[c][i] = fr[c]; continue; }
      observedPx++;
      const t = Math.min(1, dist[y] / F), w = t * t * (3 - 2 * t);
      if (w < 1) for (let c = 0; c < 3; c++) img[c][i] = img[c][i] * w + fr[c] * (1 - w);
    }
  }
  return { img, OW, OH, obs, observed: observedPx / (OW * OH), latRange: [90 - (firstObs * 180) / OH, 90 - (lastObs * 180) / OH] };
}

const meanBand = (img, OW, OH, maxLat, obs) => {
  const s = [0, 0, 0]; let wsum = 0;
  for (let y = 0; y < OH; y++) {
    const lat = 90 - ((y + 0.5) * 180) / OH; if (Math.abs(lat) > maxLat) continue;
    const w = Math.cos((lat * Math.PI) / 180);
    for (let x = 0; x < OW; x++) { const i = y * OW + x; if (obs && !obs[i]) continue; for (let c = 0; c < 3; c++) s[c] += img[c][i] * w; wsum += w; }
  }
  return s.map((v) => v / wsum);
};

const which = process.argv.slice(2);
const want = (b) => which.length === 0 || which.includes(b);
const writeMaps = async (body, buf, OW, OH, tiers, srcName, note, albedo) => {
  const frags = [];
  for (const [Wt, tag] of tiers) {
    const file = path.join(TEX, body, `color_hd_${tag}.jpg`);
    const r = await sharp(buf, { raw: { width: OW, height: OH, channels: 3 } }).resize(Wt, Wt / 2, { kernel: Wt > OW ? 'mitchell' : 'lanczos3' })
      .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);
    frags.push({ body, map: 'color', tier: tag, path: rel(file), bytes: r.size,
      source: { name: srcName, url: `https://archive.stsci.edu/hlsps/opal/cycle32/${body}/`, license: 'public domain (NASA/ESA HST data via STScI MAST; acknowledge the OPAL program, doi:10.17909/T9G593)', retrieved: '2026-10-19' },
      note, extra: { albedo: { meanLinear: +albedo.toFixed(3), note: 'Map is albedo-calibrated: mean linear luminance (|lat|<60) equals this albedo; do not scale again in the material. Colour = sRGB.' } } });
  }
  fs.writeFileSync(path.join(RAW, `hd2.tp-${body}.json`), JSON.stringify(frags, null, 1));
};

for (const body of ['jupiter', 'saturn']) {
  if (!want(body)) continue;
  const j = JOBS[body];
  const R = build(body);
  const { img, OW, OH } = R;
  const ref = await sharp(path.join(TEX, j.ref.file)).resize(1024, 512).raw().toBuffer({ resolveWithObject: true });
  const refImg = [0, 1, 2].map((c) => Float32Array.from({ length: 1024 * 512 }, (_, i) => S2L[ref.data[i * 3 + c]] * j.ref.tint[c]));
  const target = meanBand(refImg, 1024, 512, 60, null);
  const m = meanBand(img, OW, OH, 60, null);
  const K2 = target.map((t, c) => t / m[c]);
  // Optional contrast stretch about the per-channel mean (linear light): the Minnaert-corrected HST maps are softer than
  // Cassini/Juno true-colour views (luminance CV 0.12 vs ~0.2-0.35); documented in the note.
  const kc = j.contrast ?? 1;
  if (kc !== 1) for (let c = 0; c < 3; c++) for (let i = 0; i < img[c].length; i++) img[c][i] = Math.max(0, m[c] + kc * (img[c][i] - m[c]));
  const buf = Buffer.alloc(OW * OH * 3);
  for (let i = 0; i < OW * OH; i++) for (let c = 0; c < 3; c++) buf[i * 3 + c] = linearToSrgb8(img[c][i] * K2[c]);
  const albedo = 0.2126 * target[0] + 0.7152 * target[1] + 0.0722 * target[2];
  log(body, 'observed', R.observed.toFixed(3), 'lat', R.latRange.map((v) => v.toFixed(1)).join('..'), 'factors', K2.map((v) => v.toFixed(2)).join(','), 'mean sRGB', target.map((v) => linearToSrgb8(v)).join(','), 'albedo', albedo.toFixed(3));
  const tiers = body === 'jupiter' ? [[4096, '4k'], [1024, '1k']] : [[4096, '4k'], [1024, '1k']];
  await writeMaps(body, buf, OW, OH, tiers, `Hubble OPAL ${j.epoch} global maps (${j.date}; F631N/F502N/F467M, Minnaert-corrected, ${Math.round((OW / 360) * 10) / 10} px/deg; Simon et al., STScI MAST HLSP OPAL)`,
    `Current-epoch true colour: per-channel factors set so the |lat|<60 mean colour equals the app's art-directed mean (previous map x tint ${j.ref.tint.join(',')}); band-to-band colour and all structure are measured${j.contrast ? `; contrast stretched x${j.contrast} about the mean in linear light (HST maps are softer than Cassini/Juno true-colour views)` : ''}. Albedo-calibrated (mean linear luminance ${albedo.toFixed(3)}); use hdTint [1,1,1]. Planetographic -> planetocentric latitude. Observed fraction ${R.observed.toFixed(2)} (latitudes ${R.latRange.map((v) => v.toFixed(0)).join(' to ')}); polar caps beyond are the nearest observed zonal mean (illustrative fill). System III longitudes (epoch ${j.date}).`, albedo);
}

if (!want('uranus') && !want('neptune')) process.exit(0);
const U = build('uranus');
const uMean = meanBand(U.img, U.OW, U.OH, 40, U.obs);
const refLum = 0.2126 * URANUS_REF[0] + 0.7152 * URANUS_REF[1] + 0.0722 * URANUS_REF[2];
const uLum = 0.2126 * uMean[0] + 0.7152 * uMean[1] + 0.0722 * uMean[2];
// Hue-only channel factors (luminance handled by the albedo calibration below).
const K = URANUS_REF.map((r, c) => (r / refLum) / (uMean[c] / uLum));
log('channel factors', K.map((v) => v.toFixed(3)).join(' '));

for (const [body, R] of [['uranus', U], ['neptune', build('neptune')]]) {
  const j = JOBS[body];
  const { img, OW, OH } = R;
  for (let c = 0; c < 3; c++) for (let i = 0; i < img[c].length; i++) img[c][i] *= K[c];
  const m = meanBand(img, OW, OH, 60, null);
  const gain = j.albedo / (0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]);
  const buf = Buffer.alloc(OW * OH * 3);
  for (let i = 0; i < OW * OH; i++) for (let c = 0; c < 3; c++) buf[i * 3 + c] = linearToSrgb8(img[c][i] * gain);
  const centre = meanBand([img[0], img[1], img[2]].map((a) => a.map((v) => v * gain)), OW, OH, 20, R.obs).map((v) => linearToSrgb8(v));
  log(body, 'observed', R.observed.toFixed(3), 'lat', R.latRange.map((v) => v.toFixed(1)).join('..'), 'albedo gain', gain.toFixed(3), 'equatorial sRGB', centre.join(','));
  const frags = [];
  for (const [Wt, tag] of [[4096, '4k'], [1024, '1k']]) {
    const file = path.join(TEX, body, `color_hd_${tag}.jpg`);
    const r = await sharp(buf, { raw: { width: OW, height: OH, channels: 3 } }).resize(Wt, Wt / 2, { kernel: Wt > OW ? 'mitchell' : 'lanczos3' })
      .jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);
    frags.push({ body, map: 'color', tier: tag, path: rel(file), bytes: r.size,
      source: { name: `Hubble OPAL ${j.epoch} global maps (${j.date}; F657N/F547M/F467M, Minnaert-corrected, 2 px/deg; Simon et al., STScI MAST HLSP OPAL)`, url: `https://archive.stsci.edu/hlsps/opal/cycle32/${body}/`, license: 'public domain (NASA/ESA HST data via STScI MAST; acknowledge the OPAL program, doi:10.17909/T9G593)', retrieved: '2026-10-19' },
      note: `True colour: channel factors fixed on Uranus (sRGB 172,208,214 reference), same factors for Neptune; albedo-calibrated (mean linear luminance |lat|<60 = ${j.albedo}); hue+albedo already in the map (use hdTint [1,1,1]). Native resolution 0.5 deg/px (~${Math.round((2 * Math.PI * j.a) / 720)} km/px), smoothly upsampled. Observed fraction ${R.observed.toFixed(2)} (latitudes ${R.latRange.map((v) => v.toFixed(0)).join(' to ')}); the rest is ${j.fill === 'mirror' ? 'the zonal-mean profile mirrored from the north (illustrative fill)' : 'the nearest observed zonal mean (illustrative fill)'}. Longitudes are System III, not tied to fixed features.`,
      extra: { albedo: { meanLinear: j.albedo, note: 'Map is albedo-calibrated: mean linear luminance (|lat|<60) equals this geometric albedo; do not scale again in the material. Colour = sRGB.' } } });
  }
  fs.writeFileSync(path.join(RAW, `hd2.tp-${body}.json`), JSON.stringify(frags, null, 1));
}
