// Earth ultra tier: 16384x8192 day map from NASA Blue Marble Next Generation (Dec 2004, 21600x10800 source, 500 m/px).
// Source is cached by scripts/data/textures/build-earth.mjs in data-raw/textures/earth/.
//   node scripts/data/textures-hd/build-earth16k.mjs
import fs from 'node:fs';
import path from 'node:path';
import { sharp, ROOT, TEX, rel, log } from './lib.mjs';

const src = path.join(ROOT, 'data-raw', 'textures', 'earth', 'bmng_200412_21600.jpg');
const out = path.join(TEX, 'earth', 'day_16k.jpg');
sharp.cache(false);
await sharp(src, { limitInputPixels: false }).resize(16384, 8192, { kernel: 'lanczos3' })
  .jpeg({ quality: 90, progressive: true, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(out);
const bytes = fs.statSync(out).size;
log('earth day_16k', rel(out), bytes);
fs.writeFileSync(path.join(ROOT, 'data-raw', 'textures-hd', 'earth16k.stats.json'), JSON.stringify({ path: rel(out), bytes, width: 16384, height: 8192 }, null, 1));
