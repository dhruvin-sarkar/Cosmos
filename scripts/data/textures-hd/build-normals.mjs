// Relief normal maps from real elevation data (public domain NASA/USGS).
//   node scripts/data/textures-hd/build-normals.mjs [moon|mars|mercury]  (mercury: first run tiff_dem.py on the USGS GeoTIFF)
// Writes public/textures/<body>/normal_hd_4k.png + normal_hd_2k.png and data-raw/textures-hd/normals.<body>.json (stats for hd.json).
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, rel, log, downsample, normalFromHeights, writeNormalPng } from './lib.mjs';

const SRC = {
  moon: {
    file: path.join(RAW, 'dem', 'LDEM_64.IMG'), W: 23040, H: 11520, order: 'LE', scale: 0.5, startLon: 0, radiusM: 1737400, ex: 2.5,
    source: 'LRO LOLA LDEM_64 (64 px/deg, int16 x0.5 m, vs 1737.4 km sphere)', url: 'https://imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/LDEM_64.IMG',
  },
  mars: {
    file: path.join(RAW, 'dem', 'megt90n000eb.img'), W: 5760, H: 2880, order: 'BE', scale: 1, startLon: 0, radiusM: 3389500, ex: 4,
    source: 'MGS MOLA MEGDR megt90n000eb (16 px/deg, int16 metres)', url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg016/megt90n000eb.img',
  },
  mercury: {
    file: process.env.MERCURY_F32 || path.join(RAW, 'usgs', 'mercury_8k.f32'), W: 8192, H: 4096, order: 'F32', scale: 1, startLon: 0, radiusM: 2439400, ex: 3,
    source: 'MESSENGER USGS Global DEM 665 m v2 (64 px/deg, int16 metres)', url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif',
  },
};

async function loadHeights(c) {
  const N = c.W * c.H;
  const h = new Float32Array(N);
  if (c.order === 'F32') { const b = fs.readFileSync(c.file); return new Float32Array(b.buffer, b.byteOffset, N).slice(); } // from tiff_dem.py
  const buf = fs.readFileSync(c.file);
  for (let i = 0; i < N; i++) h[i] = (c.order === 'LE' ? buf.readInt16LE(i * 2) : buf.readInt16BE(i * 2)) * c.scale;
  return h;
}

function rollHalf(h, W, H) { // lon 0..360 (x=0 -> 0E) -> -180..180 (x=0 -> 180W)
  const out = new Float32Array(h.length), half = W >> 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + (x + half) % W] = h[y * W + x];
  return out;
}

export async function build(body, { skipRoll = false } = {}) {
  const c = SRC[body];
  let h = await loadHeights(c);
  if (!skipRoll && c.startLon === 0) h = rollHalf(h, c.W, c.H);
  let mn = Infinity, mx = -Infinity, imx = 0;
  for (let i = 0; i < h.length; i++) { if (h[i] < mn) mn = h[i]; if (h[i] > mx) { mx = h[i]; imx = i; } }
  log(body, 'height range', mn, mx, 'max at lon', (-180 + (360 * ((imx % c.W) + 0.5)) / c.W).toFixed(1), 'lat', (90 - (180 * (Math.floor(imx / c.W) + 0.5)) / c.H).toFixed(1));
  const out = {};
  for (const [W, tag] of [[4096, '4k'], [2048, '2k']]) {
    const H = W / 2;
    const hs = downsample(h, c.W, c.H, W, H);
    const { data, maxSlope } = normalFromHeights(hs, W, H, { radiusM: c.radiusM, exaggeration: c.ex });
    const file = path.join(TEX, body, `normal_hd_${tag}.png`);
    const size = await writeNormalPng(data, W, H, file);
    out[tag] = { path: rel(file), bytes: size, maxRawSlopeDeg: +((Math.atan(maxSlope / c.ex) * 180) / Math.PI).toFixed(1) };
    log(body, tag, size, 'bytes');
  }
  fs.writeFileSync(path.join(RAW, `normals.${body}.json`), JSON.stringify({ body, exaggeration: c.ex, heightRangeM: [mn, mx], source: c.source, url: c.url, files: out }, null, 1));
}

if (process.argv[1].endsWith('build-normals.mjs')) for (const b of process.argv.slice(2).length ? process.argv.slice(2) : ['moon', 'mars']) await build(b);
