// NASA Solar System Treks (trek.nasa.gov) WMTS global mosaics -> equirect textures: Ceres and Vesta (Dawn Framing Camera).
// Tile matrix level 3 = 16x8 tiles of 256 px = 4096x2048, TopLeft (-180, 90), x east-positive (checked visually).
//   node scripts/data/textures/build-treks.mjs   (FORCE=1 to rebuild; ROLL_<BODY>=1 to roll half a turn)
import fs from 'node:fs';
import { RAW_DIR, TEX_DIR, log, relPublic, wmtsMosaic } from './lib.mjs';
import { toRaw, rollX, pullPushFill, writeVariants } from './process.mjs';
import { saveRecords } from './records.mjs';

const BODIES = {
  ceres: { layer: 'Ceres_Dawn_FC_DLR_global_59ppd_Feb2016', portal: 'Ceres', roll: false, credit: 'NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, Dawn Framing Camera global mosaic (DLR 59 ppd, Feb 2016), via NASA Solar System Treks', desc: 'Ceres Dawn FC global greyscale mosaic 59 ppd (~140 m/px)' },
  vesta: { layer: 'Vesta_Dawn_HAMO_Photo_DLR_global_74ppd_IAU', portal: 'Vesta', roll: false, blackNoData: true, credit: 'NASA/JPL-Caltech/UCLA/MPS/DLR/IDA, Dawn Framing Camera HAMO global mosaic (DLR 74 ppd), via NASA Solar System Treks', desc: 'Vesta Dawn FC HAMO global greyscale photo mosaic 74 ppd (IAU frame)' },
};
const only = process.argv.slice(2);
for (const [body, c] of Object.entries(BODIES)) {
  if (only.length && !only.includes(body)) continue;
  const base = `${TEX_DIR}/${body}/color`;
  if (fs.existsSync(`${base}_4k.jpg`) && !process.env.FORCE) { log(`skip ${body}`); continue; }
  const tpl = `https://trek.nasa.gov/tiles/${c.portal}/EQ/${c.layer}/1.0.0/default/default028mm/{TileMatrix}/{TileRow}/{TileCol}.jpg`;
  const png = await wmtsMosaic({ template: tpl, level: 3, cols: 16, rows: 8, label: body, cacheDir: `${RAW_DIR}/treks/${body}` });
  let img = await toRaw(png, { channels: 4 });
  if (c.blackNoData) for (let i = 0; i < img.data.length; i += 4) if (img.data[i] <= 2 && img.data[i + 1] <= 2 && img.data[i + 2] <= 2) img.data[i + 3] = 0; // unobserved (polar night) painted black
  let observed = 1, minA = 255;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < minA) minA = img.data[i];
  if (minA < 128) { const f = pullPushFill(img); img = f.img; observed = f.observedFraction; } else img = await toRaw(png, { channels: 3 });
  if (c.roll || process.env[`ROLL_${body.toUpperCase()}`]) img = rollX(img, img.width / 2);
  const ws = await writeVariants(img, [
    { file: `${base}_4k.jpg`, width: 4096, height: 2048, format: 'jpeg' },
    { file: `${base}_1k.jpg`, width: 1024, height: 512, format: 'jpeg' },
  ]);
  saveRecords('treks', [{ key: `${body}/color`, body, map: 'color', files: { high: relPublic(ws[0].file), low: relPublic(ws[1].file) }, credit: c.credit, license: 'Public domain (NASA); NASA Solar System Treks data are freely available. Credit: NASA/JPL-Caltech', source: `https://trek.nasa.gov/${c.portal.toLowerCase()}/ (layer ${c.layer})`, endpoint: tpl, provenanceClass: 'observed', retrieved: new Date().toISOString(), layer: c.layer, observedFraction: +observed.toFixed(4),
    notes: `${c.desc}. WMTS tile matrix level 3 (16x8 tiles of 256 px) assembled to 4096x2048; planetocentric east-positive longitude, ${c.roll ? 'rolled by 180 deg to put x=0 at 180W' : 'tiles already start at -180'}. Greyscale (no colour data). observedFraction=${observed.toFixed(3)}.`, bytes: ws.map((w) => w.bytes) }]);
}
log('treks done');
