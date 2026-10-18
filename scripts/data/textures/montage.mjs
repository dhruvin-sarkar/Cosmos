// Contact sheet for visual QA: node montage.mjs out.png file1 file2 ...  (labels via file name only in log)
import { sharp } from './lib.mjs';
const [out, ...files] = process.argv.slice(2);
const cols = 3, w = 512, h = 256;
const rows = Math.ceil(files.length / cols);
const comps = [];
for (let i = 0; i < files.length; i++) {
  const b = await sharp(files[i]).resize(w, h, { fit: 'fill' }).removeAlpha().png().toBuffer();
  const mid = await sharp({ create: { width: 1, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } }).png().toBuffer();
  comps.push({ input: b, left: (i % cols) * (w + 4), top: Math.floor(i / cols) * (h + 4) });
  comps.push({ input: mid, left: (i % cols) * (w + 4) + w / 2, top: Math.floor(i / cols) * (h + 4) }); // red line = lon 0
}
await sharp({ create: { width: cols * (w + 4), height: rows * (h + 4), channels: 3, background: '#222' } }).composite(comps).png().toFile(out);
console.log(files.map((f, i) => `${i}:${f.split('/').slice(-2).join('/')}`).join('  '));
