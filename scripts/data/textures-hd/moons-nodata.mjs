// tex-moons: report per-latitude fraction of no-data (near-black) pixels in a map.   node moons-nodata.mjs file [thr]
import { sharp } from './lib.mjs';
const f = process.argv[2], thr = +(process.argv[3] ?? 6);
const { data, info } = await sharp(f, { limitInputPixels: false }).greyscale().resize(1440, 720, { fit: 'fill', kernel: 'nearest' }).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, rows = [];
for (let lat = 90; lat > -90; lat -= 5) {
  let n = 0, k = 0;
  for (let y = Math.floor(((90 - lat) / 180) * H); y < Math.floor(((95 - lat) / 180) * H); y++) for (let x = 0; x < W; x++) { k++; if (data[y * W + x] <= thr) n++; }
  rows.push(`${lat}:${Math.round((100 * n) / k)}`);
}
console.log(f, rows.filter((r) => !r.endsWith(':0')).join(' ') || 'no black');
