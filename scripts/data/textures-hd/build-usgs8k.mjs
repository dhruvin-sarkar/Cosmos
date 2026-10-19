// Round 2: colour maps from USGS Astrogeology GeoTIFF global mosaics (public domain), resampled to 8192x4096 / 4096x2048 / 1024x512.
// Output convention: x=0 at 180W, east-positive, north up. Per-job fix-ups: roll (source starts at 0E), flipX (positive-west source).
//   node scripts/data/textures-hd/build-usgs8k.mjs <body ...>      raws in data-raw/textures-hd/usgs2/
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, rel, log, sharp, meanLinearLuma, adjustRgb } from './lib.mjs';

const B = 'https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/';
const PD = 'public domain (NASA/USGS)';
export const JOBS = {
  tethys: { target: 0.6, file: 'Tethys_Cassini_mosaic_global_293m.tif', sizes: [8192, 4096, 1024], name: 'Cassini ISS global mosaic of Tethys, 293 m/px (USGS Astrogeology; Roatsch et al., DLR)' },
  dione: { target: 0.5, file: 'Dione_Cassini_Voyager_mosaic_global_154m.tif', sizes: [8192, 4096, 1024], name: 'Cassini ISS + Voyager global mosaic of Dione, 154 m/px (USGS Astrogeology; Roatsch et al., DLR)' },
  rhea: { target: 0.5, file: 'Rhea_Cassini_Voyager_mosaic_global_417m.tif', sizes: [8192, 4096, 1024], name: 'Cassini ISS + Voyager global mosaic of Rhea, 417 m/px (USGS Astrogeology; Roatsch et al., DLR)' },
  iapetus: { target: 0.3, file: 'Iapetus_Cassini_Voyager_mosaic_global_783m.tif', sizes: [4096, 1024], name: 'Cassini ISS + Voyager global mosaic of Iapetus, 783 m/px (USGS Astrogeology; label says positive-west but dark Cassini Regio sits at 90W, i.e. the data is east-positive)' },
  ceres: { target: 0.1646, file: 'Ceres_Dawn_FC_DLR_global_20ppd_Oct2015.tif', sizes: [8192], roll: true, name: 'Dawn FC global mosaic of Ceres, 20 px/deg (DLR; USGS Astrogeology), upsampled <=1.1x to 8k' },
  vesta: { target: 0.1537, file: 'Vesta_Dawn_FC_HAMO_Mosaic_Global_74ppd.tif', sizes: [8192], name: 'Dawn FC HAMO clear-filter global mosaic of Vesta, 74 px/deg (~60 m/px; DLR; USGS Astrogeology)' },
  mimas: { target: 0.5, file: 'mimas_x/Cassini_DLR/MI_170630_DLR_basemap_degrees.tif', sizes: [4096, 1024], name: 'Cassini ISS global mosaic of Mimas (DLR; USGS Astrogeology)', url: B + 'Mimas/Cassini_DLR_Mimas.zip' },
};
const tag = { 8192: '8k', 4096: '4k', 1024: '1k' };

for (const body of process.argv.slice(2)) {
  const j = JOBS[body];
  const src = path.join(RAW, 'usgs2', j.file);
  const meta = await sharp(src, { limitInputPixels: false }).metadata();
  let pipe = sharp(src, { limitInputPixels: false }).toColourspace('srgb').removeAlpha();
  if (meta.width > 8192) pipe = pipe.resize(8192, 4096, { kernel: 'lanczos3', fit: 'fill' }); // huge sources: reduce straight from the file
  let { data, info } = await pipe.raw().toBuffer({ resolveWithObject: true });
  let gain = null;
  let img = { data, width: info.width, height: info.height, channels: 3 };
  log(body, 'source', img.width, 'x', img.height);
  const frags = [];
  for (const W of j.sizes) {
    const H = W / 2;
    const { data: d } = await sharp(img.data, { raw: { width: img.width, height: img.height, channels: 3 } }).resize(W, H, { kernel: W < img.width ? 'lanczos3' : 'lanczos3', fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    let out = d;
    if (j.roll) { out = Buffer.alloc(d.length); const half = (W / 2) * 3; for (let y = 0; y < H; y++) { d.copy(out, y * W * 3 + half, y * W * 3, y * W * 3 + half); d.copy(out, y * W * 3, y * W * 3 + half, (y + 1) * W * 3); } }
    if (j.flipX) { const o2 = Buffer.alloc(out.length); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) out.copy(o2, (y * W + x) * 3, (y * W + (W - 1 - x)) * 3, (y * W + (W - x)) * 3); out = o2; }
    if (j.target) { const m0 = meanLinearLuma({ data: out, width: W, height: H, channels: 3 }); if (gain === null) gain = j.target / m0; adjustRgb({ data: out, width: W, height: H }, { saturation: 1, gain }); }
    const file = path.join(TEX, body, `color_${tag[W]}.jpg`);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = await sharp(out, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: W >= 8192 ? 88 : 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);
    const meanL = meanLinearLuma({ data: out, width: W, height: H, channels: 3 });
    log(body, tag[W], r.size, 'bytes, mean linear luma', meanL.toFixed(3));
    frags.push({ body, map: 'color', tier: tag[W], path: rel(file), bytes: r.size, meanLinearLuma: +meanL.toFixed(3),
      source: { name: j.name, url: j.url ?? B + j.file, license: PD, retrieved: '2026-10-19' },
      note: `Single-band mosaic rendered as neutral grey (no colour in this product)${j.target ? `; albedo-calibrated: mean linear luminance (|lat|<60) scaled x${gain.toFixed(3)} to ${j.target} (LitBody has no extra gain)` : ''}` });
  }
  fs.writeFileSync(path.join(RAW, `hd2.${body}.json`), JSON.stringify(frags, null, 1));
}
