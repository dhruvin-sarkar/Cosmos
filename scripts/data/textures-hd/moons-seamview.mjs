import { sharp } from './lib.mjs';
const [f, out] = process.argv.slice(2);
const m = await sharp(f, { limitInputPixels: false }).metadata();
const w = 384;
const L = await sharp(f, { limitInputPixels: false }).extract({ left: m.width - w, top: 0, width: w, height: m.height }).toBuffer();
const R = await sharp(f, { limitInputPixels: false }).extract({ left: 0, top: 0, width: w, height: m.height }).toBuffer();
await sharp({ create: { width: 2 * w, height: m.height, channels: 3, background: '#000' } }).composite([{ input: L, left: 0, top: 0 }, { input: R, left: w, top: 0 }]).png().toBuffer().then((b) => sharp(b, { limitInputPixels: false }).resize({ height: 1400 }).jpeg().toFile(out));
