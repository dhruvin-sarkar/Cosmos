// tex-moons: stack the top and bottom latitude strips (default 6 deg) of maps for a quick pole check.
//   node moons-polestrip.mjs out.jpg file ...
import { sharp } from './lib.mjs';
const [out, ...files] = process.argv.slice(2);
const parts = [];
for (const f of files) {
  const m = await sharp(f, { limitInputPixels: false }).metadata();
  const h = Math.round(m.height / 30);
  for (const top of [0, m.height - h]) parts.push(await sharp(f, { limitInputPixels: false }).extract({ left: 0, top, width: m.width, height: h }).resize(2048, 68, { fit: 'fill' }).removeAlpha().png().toBuffer());
}
await sharp({ create: { width: 2048, height: 72 * parts.length, channels: 3, background: '#f00' } }).composite(parts.map((input, i) => ({ input, left: 0, top: i * 72 }))).jpeg().toFile(out);
