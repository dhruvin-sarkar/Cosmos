// Moon (LOLA) and Mars (MOLA) relief -> tangent-space normal maps (derived), via USGS WMS grey elevation layers.
//   node scripts/data/textures/build-topo.mjs [moon|mars]     (FORCE=1 to rebuild)
import fs from 'node:fs';
import { RAW_DIR, TEX_DIR, wmsGetMapUrl, download, log, relPublic, sharp } from './lib.mjs';
import { writeVariants, normalMapFromHeights } from './process.mjs';
import { saveRecords } from './records.mjs';

const LIC = 'Public domain (U.S. Government work; NASA/USGS data products). Credit: USGS Astrogeology Science Center';
// grey stretch ranges are approximate (WMS 8-bit stretch of full elevation range); exaggeration chosen for visible relief
const B = {
  moon: { map: '/maps/earth/moon_simp_cyl.map', layer: 'LOLA_bw', radiusM: 1737400, lo: -9150, hi: 10760, ex: 1.5, blur: 3, credit: 'NASA/GSFC LRO LOLA global elevation (via USGS Astrogeology)' },
  mars: { map: '/maps/mars/mars_simp_cyl.map', layer: 'MOLA_bw', radiusM: 3389500, lo: -8200, hi: 21200, ex: 3, blur: 1.6, credit: 'NASA/GSFC Mars Global Surveyor MOLA global elevation (via USGS Astrogeology)' },
};
const only = process.argv.slice(2);
for (const [body, c] of Object.entries(B)) {
  if (only.length && !only.includes(body)) continue;
  if (fs.existsSync(`${TEX_DIR}/${body}/normal_4k.png`) && !process.env.FORCE) { log(`skip ${body}`); continue; }
  const raw = `${RAW_DIR}/wms/${body}_${c.layer}.png`;
  const url = wmsGetMapUrl({ mapfile: c.map, layer: c.layer, width: 4096, height: 2048, format: 'image/png' });
  await download(url, raw, { expectType: /^image\//, minBytes: 20000, skipHead: true, label: `${body}/${c.layer}` });
  const W = 4096, H = 2048;
  // grey, light blur to remove 8-bit terracing
  const g = await sharp(raw).removeAlpha().toColourspace('b-w').blur(c.blur).raw().toBuffer({ resolveWithObject: true });
  const ch = g.info.channels, hts = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) hts[i] = c.lo + (g.data[i * ch] / 255) * (c.hi - c.lo);
  const { img, maxSlope } = normalMapFromHeights(hts, W, H, { radiusM: c.radiusM, exaggeration: c.ex });
  log(`${body}: max exaggerated slope ${maxSlope.toFixed(3)}`);
  const w = await writeVariants(img, [
    { file: `${TEX_DIR}/${body}/normal_4k.png`, width: 4096, height: 2048, format: 'png' },
    { file: `${TEX_DIR}/${body}/normal_1k.png`, width: 1024, height: 512, format: 'png' },
  ]);
  saveRecords('wms', [{
    key: `${body}/normal`, body, map: 'normal', files: { high: relPublic(w[0].file), low: relPublic(w[1].file) },
    credit: c.credit, license: LIC, source: url,
    notes: `Tangent-space normal map (OpenGL: R=+east, G=+north, B=up; linear data) derived from the 8-bit grey elevation layer ${c.layer} (stretch approx ${c.lo}..${c.hi} m, so absolute heights are approximate), ${c.blur} px blur, slope exaggeration x${c.ex}. Same x/y convention as the colour maps.`,
    provenanceClass: 'derived', retrieved: new Date().toISOString(), layer: c.layer, mapfile: c.map, bytes: w.map((x) => x.bytes),
  }]);
}
