// tex-planets: Earth night lights from NASA Earth Observatory "Earth at Night" Black Marble 2016 greyscale tiles
// (Suomi NPP VIIRS DNB, 15 arcsec = ~500 m/px; Roman et al. 2018; image record 144897). Replaces the GIBS-derived,
// colour-clamped map (blown-out yellow blobs) with the measured greyscale product: the earth shader takes luminance only
// and applies its own sodium/LED tint and contrast (earthMaterial.ts uLightsGamma), so the map stays neutral grey.
//   node scripts/data/textures-hd/build-night.mjs      (raws: data-raw/big/tex-planets/night/BlackMarble_2016_<A-D><1-2>_gray.jpg)
// Tiles: columns A-D = 180W-90W, 90W-0, 0-90E, 90E-180E; rows 1 = 90N-0, 2 = 0-90S; each 21600 x 21600 px.
// Same layout as this app's convention (x = 0 at 180 W, east-positive, north up), so tiles are box-filtered to
// 4096 x 4096 (~2.4 km/px) and joined; lower tiers are lanczos3 reductions of that 16k mosaic.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEX, log, sharp } from './lib.mjs';

const DIR = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'night');
const T = 4096;
const W = 4 * T, H = 2 * T;
const mosaic = Buffer.alloc(W * H);
for (const [col, c] of ['A', 'B', 'C', 'D'].entries()) {
  for (const row of [1, 2]) {
    const f = path.join(DIR, `BlackMarble_2016_${c}${row}_gray.jpg`);
    // Area average (point lights keep their integrated brightness rather than ringing).
    const tile = await sharp(f, { limitInputPixels: false }).greyscale().resize(T, T, { kernel: 'cubic', fastShrinkOnLoad: false }).raw().toBuffer();
    for (let y = 0; y < T; y++) tile.copy(mosaic, (row - 1) * T * W + y * W + col * T, y * T, (y + 1) * T);
    log('tile', c + row);
  }
}
let sum = 0, lit = 0;
for (const v of mosaic) { sum += v; if (v > 24) lit++; }
log('mean', (sum / mosaic.length).toFixed(2), 'lit fraction', (lit / mosaic.length).toFixed(4));
fs.writeFileSync(path.join(DIR, 'night_16k.gray'), mosaic);
for (const [w, name] of [[8192, 'night_8k.jpg'], [4096, 'night_4k.jpg'], [2048, 'night_2k.jpg']]) {
  const out = path.join(TEX, 'earth', name);
  const r = await sharp(mosaic, { raw: { width: W, height: H, channels: 1 } }).resize(w, w / 2, { kernel: 'lanczos3' })
    .jpeg({ quality: 92, mozjpeg: true }).toFile(out + '.tmp');
  fs.copyFileSync(out + '.tmp', out); fs.unlinkSync(out + '.tmp');
  log(name, r.width, r.height, r.size);
}

const idxFile = path.join(TEX, 'index.json');
const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
index.credits['earth/night'] = {
  credit: 'NASA Earth Observatory images by Joshua Stevens, using Suomi NPP VIIRS data from Miguel Roman, NASA GSFC (Black Marble 2016)',
  license: 'Public domain (NASA Earth Observatory; credit requested)',
  source: 'https://earthobservatory.nasa.gov/features/NightLights (image record 144897, BlackMarble_2016_<A-D><1-2>_gray.jpg, 500 m/px)',
  provenanceClass: 'observed',
  notes: 'Greyscale VIIRS Day/Night Band composite for 2016 (moonlight, clouds, aurora, fires and stray light removed by NASA), 15 arcsec tiles box-filtered to 16384 x 8192 then reduced to 8k/4k/2k (lanczos3, JPEG q92 greyscale). Relative brightness only (the product is a non-linear stretch of radiance); the shader supplies the light colour. Orientation as the app convention (x = 0 at 180 W, east-positive, north up).',
};
fs.writeFileSync(idxFile, JSON.stringify(index));
log('index.json credits updated');
