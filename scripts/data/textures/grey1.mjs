// Re-encode Earth specular/height PNGs as true 1-channel 8-bit greyscale (they were RGB with equal channels).
import fs from 'node:fs';
import { TEX_DIR, sharp, log } from './lib.mjs';
for (const f of fs.readdirSync(`${TEX_DIR}/earth`).filter((n) => /^(specular|height)_.*\.png$/.test(n))) {
  const p = `${TEX_DIR}/earth/${f}`;
  const m = await sharp(p).metadata();
  if (m.channels === 1 && !m.isPalette && m.space === 'b-w') continue;
  const r = await sharp(p).extractChannel(0).raw().toBuffer({ resolveWithObject: true });
  const b = await sharp(r.data, { raw: { width: r.info.width, height: r.info.height, channels: 1 } }).toColourspace('b-w').png({ compressionLevel: 9, effort: 10, palette: false }).toBuffer();
  fs.writeFileSync(p, b);
  const m2 = await sharp(p).metadata();
  log(f, m.channels, '->', m2.channels, `${(b.length / 2 ** 20).toFixed(2)} MB`);
}
