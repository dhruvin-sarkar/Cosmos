// tex-planets: Saturn ring strip from Cassini RSS radio occultation data (PDS Ring-Moon Systems Node).
// Output: public/textures/saturn/rings_16k.png (16384 x 4 RGBA; x = radius 74,500 -> 140,220 km = the solar domain's
// ring span, 4.01 km/px). Alpha = 1 - <exp(-tau_normal)> per pixel (transmission averaged in each 4 km bin) from the
// Rev 7 egress X-band 1 km profile; tau above the per-sample detection threshold (opaque B-ring core) is held at the
// threshold. RGB = per-region particle colour/brightness: region means of the previous (Solar System Scope, Cassini-
// derived) strip sampled inside each ring region and feathered over ~150 km at the real region edges, so the shader's
// albedo calibration is unchanged while every edge, gap and ringlet comes from the occultation.
//   node scripts/data/textures-hd/build-rings.mjs      (raw: data-raw/big/tex-planets/rings/RSS_2005_123_X43_E_TAU_01KM.TAB)
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEX, RAW, rel, log, sharp, srgbToLinearLut, linearToSrgb8 } from './lib.mjs';

const R0 = 74500, R1 = 140220, W = 16384, H = 4;
const tab = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'rings', 'RSS_2005_123_X43_E_TAU_01KM.TAB');
const lines = fs.readFileSync(tab, 'utf8').split('\n');
const trans = new Float64Array(W), cnt = new Float64Array(W);
for (const ln of lines) {
  if (!ln) continue;
  const c = ln.split(',');
  const r = +c[0], tau = +c[6], thr = +c[8];
  if (!(r >= R0 && r < R1)) continue;
  const t = Math.max(0, Math.min(Number.isFinite(tau) ? tau : thr, thr));
  const x = Math.floor(((r - R0) / (R1 - R0)) * W);
  trans[x] += Math.exp(-t); cnt[x]++;
}
// Fill empty bins (if any) by nearest neighbours.
let last = 1;
for (let x = 0; x < W; x++) { if (cnt[x]) { trans[x] /= cnt[x]; last = trans[x]; } else trans[x] = last; }

// F ring: below the X-band detection limit (dusty), so it is added from published visible-light parameters: core at
// a = 140,221 km (Bosh et al. 2002), ~2 km wide with tau ~ 0.5, inside a ~500 km dusty envelope with tau ~ 0.02
// (Showalter et al. 1992; Cassini VIMS/UVIS). Only the inner half lies inside the strip (the strip ends at 140,220 km).
for (let x = 0; x < W; x++) {
  const r = R0 + ((x + 0.5) / W) * (R1 - R0), d = r - 140221;
  const tauF = 0.5 * (2 / ((R1 - R0) / W)) * Math.exp(-0.5 * (d / 4) ** 2) + 0.02 * Math.exp(-0.5 * (d / 120) ** 2);
  trans[x] *= Math.exp(-tauF);
}

// Region colours: means of the old strip inside each region (core only, away from its misregistered edges).
const old = await sharp(path.join(TEX, 'saturn', 'rings_8k.png')).raw().toBuffer({ resolveWithObject: true });
const OW = old.info.width;
const oldMean = (a, b) => {
  const s = [0, 0, 0]; let n = 0;
  for (let x = Math.floor(((a - R0) / (R1 - R0)) * OW); x < ((b - R0) / (R1 - R0)) * OW; x++) {
    const i = (OW + x) * 4; if (old.data[i + 3] < 8) continue;
    for (let k = 0; k < 3; k++) s[k] += old.data[i + k]; n++;
  }
  return s.map((v) => v / n);
};
// Ring boundaries (km): C 74,490-91,980; B 91,980-117,580; Cassini Division 117,580-122,170; A 122,170-136,775;
// Roche division to the F ring (140,180). Colfax/French et al.; Cuzzi et al. 2009 (Saturn from Cassini-Huygens).
const C = oldMean(80000, 90000), B = oldMean(96000, 116000), CD = oldMean(119000, 121000), A = oldMean(124000, 135000);
const F = [(A[0] + C[0]) / 2, (A[1] + C[1]) / 2, (A[2] + C[2]) / 2];
const regions = [[R0, C], [91980, B], [117580, CD], [122170, A], [136775, F]];
const smooth = (e0, e1, x) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const colourAt = (r) => {
  let col = regions[0][1];
  for (let k = 1; k < regions.length; k++) {
    const w = smooth(regions[k][0] - 75, regions[k][0] + 75, r);
    col = col.map((v, i) => v * (1 - w) + regions[k][1][i] * w);
  }
  return col;
};

// Brightness: invert the ring shader's lit-face model (src/domains/solar/ringMaterial.ts: Chandrasekhar single
// scattering x HG phase x multiple-scattering factor, albedoScale 2.5, tint luminance 0.846, dust 0.08) against the
// Voyager 2 ISS lit-side I/F profile (VG_2810 IS2_P0001, 4 km sampling, ~5 km resolution; phase 47, incidence 81.95,
// emission 66.7 deg - almost today's 8 deg solar elevation), using the RSS optical depth: per-pixel effective particle
// albedo = I/F / model(tau). Both profiles are smoothed over ~20 km first (different epochs: eccentric ringlets move)
// and the ratio is clamped to 0.3-2.5x the region median; where tau < 0.03 the region median is used.
const vg = fs.readFileSync(path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'rings', 'IS2_P0001_V01_KM004.TAB'), 'utf8').trim().split(/\r?\n/).map((l) => l.split(',').map(Number));
const ifAt = (r) => { const i = (r - 74000) / 4; if (i < 0 || i >= vg.length - 1) return NaN; const k = Math.floor(i), t = i - k; return vg[k][1] * (1 - t) + vg[k + 1][1] * t; };
const box = (a, n) => { const o = new Float64Array(a.length); let acc = 0; const q = []; for (let i = 0; i < a.length; i++) { acc += a[i]; q.push(a[i]); if (q.length > n) acc -= q.shift(); o[Math.max(0, i - (n >> 1))] = acc / q.length; } for (let i = a.length - (n >> 1); i < a.length; i++) o[i] = o[a.length - (n >> 1) - 1]; return o; };
const tauPix = Float64Array.from(trans, (t) => -Math.log(Math.max(t, 1e-4)));
const ifPix = new Float64Array(W);
for (let x = 0; x < W; x++) ifPix[x] = ifAt(R0 + ((x + 0.5) / W) * (R1 - R0));
const tauS = box(tauPix, 5), ifS = box(Float64Array.from(ifPix, (v) => (Number.isFinite(v) ? Math.max(0, v) : 0)), 5);
const muS = Math.cos((81.95 * Math.PI) / 180), muV = Math.cos((66.7 * Math.PI) / 180);
const hg = (c, g) => (1 - g * g) / Math.pow(Math.max(1 + g * g - 2 * g * c, 1e-4), 1.5);
const cph = -Math.cos((47 * Math.PI) / 180);
const phase = hg(cph, -0.35) * 0.92 + hg(cph, 0.75) * 0.08;
const model = (tau) => phase * 0.25 * (muS / (muS + muV)) * (1 - Math.exp(-tau * (1 / muS + 1 / muV))) * (1 + 0.9 * (1 - Math.exp(-tau)));
const albRaw = new Float64Array(W).fill(NaN);
for (let x = 0; x < W; x++) if (tauS[x] >= 0.03 && Number.isFinite(ifPix[x])) albRaw[x] = ifS[x] / model(tauS[x]);
const edges = [R0, 91980, 117580, 122170, 136775, R1];
const regionOf = (r) => { let k = 0; while (k < 4 && r >= edges[k + 1]) k++; return k; };
const med = [0, 1, 2, 3, 4].map((k) => { const v = []; for (let x = 0; x < W; x++) { const r = R0 + ((x + 0.5) / W) * (R1 - R0); if (regionOf(r) === k && Number.isFinite(albRaw[x])) v.push(albRaw[x]); } v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : NaN; });
med[4] = med[3]; // Roche division + F ring: no reliable I/F (empty / beyond the Voyager profile) - use the A-ring value.
const alb = new Float64Array(W);
for (let x = 0; x < W; x++) { const r = R0 + ((x + 0.5) / W) * (R1 - R0); const m = med[regionOf(r)]; const v = regionOf(r) === 4 ? NaN : albRaw[x]; alb[x] = Number.isFinite(v) ? Math.max(0.3 * m, Math.min(2.5 * m, v)) : m; }
const albS = box(alb, 3);
log('albedo medians C,B,CD,A,F', med.map((v) => v.toFixed(3)).join(' '));
const S2L = srgbToLinearLut, TINT_LUM = 0.2126 * 0.92 + 0.7152 * 0.84 + 0.0722 * 0.7;
const out = Buffer.alloc(W * H * 4);
for (let x = 0; x < W; x++) {
  const r = R0 + ((x + 0.5) / W) * (R1 - R0);
  const col = colourAt(r).map((v) => S2L[Math.round(v)]);
  const lum = 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2];
  const L = Math.min(0.95, albS[x]) / (2.5 * TINT_LUM);
  const rgb = col.map((v) => linearToSrgb8((v / lum) * L));
  const a = Math.round(Math.max(0, Math.min(1, 1 - trans[x])) * 255);
  for (let y = 0; y < H; y++) { const o = (y * W + x) * 4; out[o] = rgb[0]; out[o + 1] = rgb[1]; out[o + 2] = rgb[2]; out[o + 3] = a; }
}
const file = path.join(TEX, 'saturn', 'rings_16k.png');
await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png({ compressionLevel: 9 }).toFile(file);
const bytes = fs.statSync(file).size;
log('rings_16k', bytes, 'bytes; region colours C', C.map(Math.round), 'B', B.map(Math.round), 'CD', CD.map(Math.round), 'A', A.map(Math.round));
for (const r of [76000, 85000, 100000, 110000, 117700, 119500, 123000, 133589, 136530, 138000, 140180]) {
  const x = Math.floor(((r - R0) / (R1 - R0)) * W); log(r, 'alpha', (1 - trans[x]).toFixed(3));
}
fs.writeFileSync(path.join(RAW, 'hd2.tp-saturn-rings.json'), JSON.stringify([{
  body: 'saturn', map: 'rings', tier: '8k', path: rel(file), bytes,
  source: { name: 'Cassini RSS Rev 7 egress X-band ring occultation, normal optical depth at 1 km resolution (Marouf et al.; PDS Ring-Moon Systems Node CORSS_8001 RSS_2005_123_X43_E_TAU_01KM); brightness from the Voyager 2 ISS lit-side I/F profile (Showalter & Gordon 2004, PDS VG_2810 IS2_P0001); region hues from the Solar System Scope Cassini-derived strip', url: 'https://pds-rings.seti.org/holdings/volumes/CORSS_8xxx/CORSS_8001/data/Rev007/Rev007E/Rev007E_RSS_2005_123_X43_E/', license: 'public domain (NASA/JPL PDS); region hues CC BY 4.0 Solar System Scope', retrieved: '2026-10-19' },
  note: '16384 x 4 RGBA strip under the 8k (ultra) key: x = 74,500 -> 140,220 km (4.0 km/px), alpha = 1 - mean transmission at normal incidence from the X-band (3.6 cm) optical depth; tau above the detection threshold (~4, opaque B-ring core) is held at the threshold. Shows the Colombo/Maxwell/Huygens gaps, Cassini Division, Encke (133,589 km) and Keeler (136,530 km) gaps and the F ring (modelled from published visible parameters: core a = 140,221 km, Bosh et al. 2002; envelope tau ~0.02, Showalter et al. 1992 - not detected at X band). RGB luminance = effective particle albedo obtained by inverting the ring shader against the Voyager lit-side I/F at 47 deg phase (so the renderer reproduces the measured brightness at that geometry). Radio tau underestimates visible tau slightly in dusty regions (C ring, Cassini Division, F ring).',
}], null, 1));
