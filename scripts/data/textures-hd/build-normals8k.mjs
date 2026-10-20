// tex-planets: 8192 x 4096 relief normal maps (Ultra tier) for the Moon, Mars and Mercury from the same public-domain
// elevation models as the 4k maps (build-normals.mjs), at higher source resolution where it exists:
//   moon    LRO LOLA LDEM_64 (64 px/deg, ~474 m/px)        -> 8k = 1.33 km/px
//   mars    MGS MOLA MEGDR meg032 (32 px/deg, ~1.85 km/px)  -> 8k = 2.6 km/px
//   mercury MESSENGER USGS global DEM 665 m v2             -> 8k = 1.87 km/px (area-averaged by tiff_dem.py)
// Same convention and exaggeration as the 4k maps (OpenGL tangent space R=+east G=+north B=up, linear), lossless WebP.
//   node scripts/data/textures-hd/build-normals8k.mjs [moon|mars|mercury]     raws: data-raw/big/tex-planets/dem/
// Then: node scripts/data/textures-hd/finalize2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { ROOT, RAW, TEX, rel, log, sharp, downsample, normalFromHeights } from './lib.mjs';

const DIR = path.join(ROOT, 'data-raw', 'big', 'tex-planets', 'dem');
const W = 8192, H = 4096;
const SRC = {
  moon: { file: 'LDEM_64.IMG', W: 23040, H: 11520, order: 'LE', scale: 0.5, radiusM: 1737400, ex: 2.5,
    name: 'LRO LOLA LDEM_64 gridded topography, 64 px/deg (Smith et al. 2010; NASA GSFC / PDS Geosciences Node)', url: 'https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img/ldem_64.img' },
  mars: { file: 'megt90n000fb.img', W: 11520, H: 5760, order: 'BE', scale: 1, radiusM: 3389500, ex: 4,
    name: 'MGS MOLA MEGDR megt90n000fb topography, 32 px/deg (Smith et al. 2003; NASA GSFC / PDS Geosciences Node)', url: 'https://pds-geosciences.wustl.edu/mgs/mgs-m-mola-5-megdr-l3-v1/mgsl_300x/meg032/megt90n000fb.img' },
  mercury: { file: 'Mercury_Messenger_USGS_DEM_Global_665m_v2.tif', tiff: true, radiusM: 2439400, ex: 3,
    name: 'MESSENGER USGS global DEM of Mercury, 665 m/px v2 (Becker et al. 2016; USGS Astrogeology)', url: 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif' },
};

function rollHalf(h) { // x = 0 at 0 E -> x = 0 at 180 W
  const out = new Float32Array(h.length), half = W >> 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out[y * W + ((x + half) % W)] = h[y * W + x];
  return out;
}

for (const body of process.argv.slice(2).length ? process.argv.slice(2) : ['moon', 'mars', 'mercury']) {
  const c = SRC[body];
  const f = path.join(DIR, c.file);
  let h;
  if (c.tiff) {
    const f32 = path.join(DIR, `${body}_8k.f32`);
    if (!fs.existsSync(f32)) execFileSync('python', ['-P', path.join(import.meta.dirname, 'tiff_dem.py'), f, f32, String(W), String(H)], { stdio: 'inherit' });
    const b = fs.readFileSync(f32);
    h = new Float32Array(b.buffer, b.byteOffset, W * H).slice();
  } else {
    const buf = fs.readFileSync(f);
    const N = c.W * c.H, src = new Float32Array(N);
    for (let i = 0; i < N; i++) src[i] = (c.order === 'LE' ? buf.readInt16LE(i * 2) : buf.readInt16BE(i * 2)) * c.scale;
    h = downsample(src, c.W, c.H, W, H);
  }
  h = rollHalf(h); // all three sources start at 0 E (as in build-normals.mjs)
  let mn = Infinity, mx = -Infinity;
  for (const v of h) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const { data } = normalFromHeights(h, W, H, { radiusM: c.radiusM, exaggeration: c.ex });
  const file = path.join(TEX, body, 'normal_hd_8k.webp');
  const r = await sharp(data, { raw: { width: W, height: H, channels: 3 } }).webp({ lossless: true, effort: 4 }).toFile(file);
  log(body, 'height', mn.toFixed(0), mx.toFixed(0), 'bytes', r.size);
  fs.writeFileSync(path.join(RAW, `hd2.tp-${body}-normal8k.json`), JSON.stringify([{ body, map: 'normal', tier: '8k', path: rel(file), bytes: r.size,
    source: { name: c.name, url: c.url, license: 'public domain (NASA/USGS)', retrieved: '2026-10-19' },
    note: `8192 x 4096 tangent-space normal map (OpenGL: R=+east, G=+north, B=up; linear; lossless WebP) differentiated from the elevation model area-averaged to 8k; slopes x${c.ex} exaggerated as in the 4k tier; height range ${mn.toFixed(0)}..${mx.toFixed(0)} m.` }], null, 1));
}
