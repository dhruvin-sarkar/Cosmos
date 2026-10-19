// montage.mjs out.png w img1 img2 ... : tiles images (resized to width w), 2 columns
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const sharp = require('sharp');
const [out, w, ...files] = process.argv.slice(2);
const W = +w;
const tiles = [];
for (const f of files) {
  const b = await sharp(f).resize({ width: W, height: W / 2, fit: 'fill' }).removeAlpha().toColourspace('srgb').jpeg({ quality: 90 }).toBuffer();
  tiles.push(b);
}
const cols = 2, rows = Math.ceil(tiles.length / cols);
await sharp({ create: { width: W * cols, height: (W / 2) * rows, channels: 3, background: '#202020' } })
  .composite(tiles.map((input, i) => ({ input, left: (i % cols) * W, top: Math.floor(i / cols) * (W / 2) })))
  .jpeg({ quality: 88 }).toFile(out);
console.log('ok', out);
