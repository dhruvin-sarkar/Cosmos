// tex-moons: probe the antimeridian wrap for column offsets / duplication: prints mean |diff| of col 0 vs cols near
// W-1 and of col W-1 vs cols near 0, plus a vertical-shift scan.   node moons-wrapprobe.mjs file
import { sharp } from './lib.mjs';
const f = process.argv[2];
const { data, info } = await sharp(f, { limitInputPixels: false }).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, y0 = Math.floor(H * 0.15), y1 = Math.floor(H * 0.85);
const d = (a, b, dy = 0) => { let s = 0; for (let y = y0; y < y1; y++) s += Math.abs(data[y * W + a] - data[(y + dy) * W + b]); return (s / (y1 - y0)).toFixed(1); };
console.log(f, 'col0 vs W-1-k', [0, 1, 2, 3, 4, 6, 8, 16].map((k) => d(0, W - 1 - k)).join(' '));
console.log('colW-1 vs k   ', [0, 1, 2, 3, 4, 6, 8, 16].map((k) => d(W - 1, k)).join(' '));
console.log('col0 vs W-1 dy', [-4, -2, -1, 0, 1, 2, 4].map((dy) => d(0, W - 1, dy)).join(' '));
console.log('mid  ref      ', d(W / 2, W / 2 - 1), d(W / 2, W / 2 - 2), d(W / 2, W / 2 - 4));
