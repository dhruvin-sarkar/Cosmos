// Solar System Scope textures (CC BY 4.0, credit "Solar System Scope / INOVE") for bodies without a NASA/USGS global map:
// Venus atmosphere, Jupiter, Saturn (+ring strip), Uranus, Neptune. Illustrative cloud-top textures.
//   node scripts/data/textures/build-sss.mjs   (FORCE=1 to rebuild)
import fs from 'node:fs';
import { RAW_DIR, TEX_DIR, download, log, relPublic, sharp } from './lib.mjs';
import { toRaw, writeVariants } from './process.mjs';
import { saveRecords } from './records.mjs';

const BASE = 'https://www.solarsystemscope.com/textures/download/';
const CREDIT = 'Solar System Scope / INOVE (https://www.solarsystemscope.com/textures/), textures based on NASA spacecraft imagery';
const LIC = 'CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution required';
const BODIES = [
  { body: 'venus', slot: 'atmosphere', file: '4k_venus_atmosphere.jpg', w: 4096, notes: 'Venus cloud-top (UV-like/visible) texture; artistic composite, not a calibrated observation. Static; real cloud tops change.' },
  { body: 'jupiter', slot: 'color', file: '8k_jupiter.jpg', w: 4096, notes: 'Jupiter cloud bands (source file is 4096x2048 despite its 8k name). Illustrative: zonal band + Great Red Spot placement are not tied to an epoch or System III longitude.' },
  { body: 'saturn', slot: 'color', file: '8k_saturn.jpg', w: 4096, notes: 'Saturn cloud bands (source 4096x2048). Illustrative; no meaningful longitude reference.' },
  { body: 'uranus', slot: 'color', file: '2k_uranus.jpg', w: 2048, notes: 'Uranus: near-featureless cyan disk with faint banding (source 2048x1024, not upscaled). Illustrative; no meaningful longitude reference.' },
  { body: 'neptune', slot: 'color', file: '2k_neptune.jpg', w: 2048, notes: 'Neptune cloud-top texture (source 2048x1024, not upscaled). Illustrative; no meaningful longitude reference.' },
];

for (const c of BODIES) {
  const outDir = `${TEX_DIR}/${c.body}`;
  const hiTag = c.w === 4096 ? '4k' : '2k';
  const hi = `${outDir}/${c.slot}_${hiTag}.jpg`;
  if (fs.existsSync(hi) && !process.env.FORCE) { log(`skip ${c.body}/${c.slot}`); continue; }
  const raw = `${RAW_DIR}/sss/${c.file}`;
  const meta = await download(BASE + c.file, raw, { expectType: /image\//, minBytes: 20000, skipHead: true, label: c.file });
  const img = await toRaw(raw, { channels: 3 });
  const vs = [{ file: hi, width: c.w, height: c.w / 2, format: 'jpeg' }, { file: `${outDir}/${c.slot}_1k.jpg`, width: 1024, height: 512, format: 'jpeg' }];
  const ws = await writeVariants(img, vs);
  saveRecords('sss', [{ key: `${c.body}/${c.slot}`, body: c.body, map: c.slot, files: { high: relPublic(ws[0].file), low: relPublic(ws[1].file) }, credit: CREDIT, license: LIC, source: BASE + c.file, endpoint: BASE + c.file, provenanceClass: 'illustrative', retrieved: meta.retrieved, notes: c.notes, bytes: ws.map((w) => w.bytes) }]);
}

// Saturn rings: radial RGBA strip. x = radial position (0 = inner end, 1 = outer end), alpha = opacity.
{
  const outDir = `${TEX_DIR}/saturn`;
  const hi = `${outDir}/rings_8k.png`;
  if (!fs.existsSync(hi) || process.env.FORCE) {
    const url = BASE + '8k_saturn_ring_alpha.png';
    const raw = `${RAW_DIR}/sss/8k_saturn_ring_alpha.png`;
    const meta = await download(url, raw, { expectType: /image\/png/, minBytes: 1000, skipHead: true, label: 'saturn rings' });
    // collapse the (constant) tangential axis: average all 500 rows -> 1 px high profile, premultiplied-correct
    const { data, info } = await sharp(raw).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const W = info.width, H = info.height;
    const prof = Buffer.alloc(W * 4 * 4);
    for (let x = 0; x < W; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = 0; y < H; y++) { const i = (y * W + x) * 4, al = data[i + 3]; r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; }
      const o = x * 4, A = a / H;
      const px = [a ? r / a : 0, a ? g / a : 0, a ? b / a : 0, A].map((v) => Math.round(v));
      for (let row = 0; row < 4; row++) for (let c = 0; c < 4; c++) prof[(row * W + x) * 4 + c] = px[c];
      void o;
    }
    const img = { data: prof, width: W, height: 4, channels: 4 };
    const ws = await writeVariants(img, [
      { file: `${outDir}/rings_8k.png`, width: 8192, height: 4, format: 'png' },
      { file: `${outDir}/rings_2k.png`, width: 2048, height: 4, format: 'png' },
    ]);
    saveRecords('sss', [{ key: 'saturn/rings', body: 'saturn', map: 'rings', files: { ultra: relPublic(ws[0].file), low: relPublic(ws[1].file) }, credit: CREDIT, license: LIC, source: url, endpoint: url, provenanceClass: 'illustrative', retrieved: meta.retrieved,
      notes: 'RGBA PNG strip 8192x4 (and 2048x4), straight (non-premultiplied) alpha. x = radial position from inner end (x=0) to outer end (x=1); the 4 rows are identical (tangential axis collapsed). Radial range is NOT stated by the source: assumed 74,500 km (C-ring inner edge) to 140,220 km (F ring); verified by the Cassini Division (alpha minimum) lying at x~0.65-0.7 which matches 117,580 km. Map x to radius for a RingGeometry UV remap. Colour/opacity are an artistic profile from Cassini data, not calibrated optical depth.', bytes: ws.map((w) => w.bytes) }]);
  }
}
log('sss done');
