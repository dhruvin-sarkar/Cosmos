// 8k colour maps. Rocky bodies are albedo-calibrated: the map's mean linear luminance (|lat|<60) is scaled to a
// physical mean albedo, because LitBodyMaterial computes L = albedo * E * cos / pi with no extra gain.
//   node scripts/data/textures-hd/build-color.mjs [moon|mercury|mars|venus|jupiter|saturn]
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, rel, log, readRgb, meanLinearLuma, adjustRgb, writeJpeg, blendPoles } from './lib.mjs';

const SSS = (n) => path.join(RAW, 'sss', n);
// calibrate: target mean linear albedo. Moon: Bond 0.11, mean regolith normal albedo ~0.12 (Vasavada 2012; Heiken 1991).
// Mercury: Bond 0.088, geometric 0.142 (Mallama 2002) -> 0.11. Mars: Bond 0.25, geometric 0.17 (Mallama 2007) -> 0.18 away from caps.
const JOBS = {
  moon: { src: path.join(RAW, 'svs', 'lroc_color_poles_8k.tif'), out: 'moon/color_8k.jpg', target: 0.12, saturation: 1, poleFill: SSS('8k_moon.jpg'),
    source: 'NASA SVS CGI Moon Kit (a004720) lroc_color_poles_8k: LRO LROC WAC normalized-reflectance mosaic + Kaguya poles; poleward of ~65 deg blended with the Solar System Scope 8k Moon (CC BY 4.0) to hide the flat polar fill', license: 'public domain (NASA/GSFC/SVS); polar band CC BY 4.0 Solar System Scope', url: 'https://svs.gsfc.nasa.gov/4720/' },
  mercury: { src: SSS('8k_mercury.jpg'), out: 'mercury/color_8k.jpg', target: 0.11, saturation: 1,
    source: 'Solar System Scope 8k Mercury (derived from MESSENGER MDIS imagery), albedo-calibrated', license: 'CC BY 4.0 Solar System Scope', url: 'https://www.solarsystemscope.com/textures/' },
  mars: { src: SSS('8k_mars.jpg'), out: 'mars/color_8k.jpg', target: 0.18, saturation: 0.62,
    source: 'Solar System Scope 8k Mars (derived from Viking/MGS imagery), desaturated x0.62 toward Viking/HST colour and albedo-calibrated', license: 'CC BY 4.0 Solar System Scope', url: 'https://www.solarsystemscope.com/textures/' },
  venus: { src: SSS('8k_venus_surface.jpg'), out: 'venus/surface_8k.jpg', target: null, saturation: 1,
    source: 'Solar System Scope 8k Venus surface (Magellan SAR-derived, colourised; illustrative, hidden beneath the cloud deck)', license: 'CC BY 4.0 Solar System Scope', url: 'https://www.solarsystemscope.com/textures/' },
  jupiter: { src: SSS('8k_jupiter.jpg'), out: 'jupiter/color_8k.jpg', copy: true,
    source: 'Solar System Scope 8k Jupiter (Cassini/Juno-derived, illustrative)', license: 'CC BY 4.0 Solar System Scope', url: 'https://www.solarsystemscope.com/textures/' },
  saturn: { src: SSS('8k_saturn.jpg'), out: 'saturn/color_8k.jpg', copy: true,
    source: 'Solar System Scope 8k Saturn (Cassini-derived, illustrative)', license: 'CC BY 4.0 Solar System Scope', url: 'https://www.solarsystemscope.com/textures/' },
};

async function main() {
  const names = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(JOBS);
  const stats = {};
  for (const n of names) {
    const j = JOBS[n];
    const out = path.join(TEX, j.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    if (j.copy) { fs.copyFileSync(j.src, out); stats[n] = { path: rel(out), bytes: fs.statSync(out).size }; log(n, 'copied', stats[n].bytes); continue; }
    const img = await readRgb(j.src);
    if (j.saturation !== 1) adjustRgb(img, { saturation: j.saturation, gain: 1 });
    if (j.poleFill) log(n, 'pole fill gain', blendPoles(img, await readRgb(j.poleFill), { fillSaturation: 0.4 }).toFixed(3));
    const before = meanLinearLuma(img);
    let gain = 1;
    if (j.target) { gain = j.target / before; adjustRgb(img, { saturation: 1, gain }); }
    const after = meanLinearLuma(img);
    const bytes = await writeJpeg(img, out, 90);
    stats[n] = { path: rel(out), bytes, width: img.width, height: img.height, meanAlbedoBefore: +before.toFixed(3), gain: +gain.toFixed(3), meanAlbedo: +after.toFixed(3) };
    log(n, JSON.stringify(stats[n]));
  }
  fs.writeFileSync(path.join(RAW, 'color.stats.json'), JSON.stringify({ ...(fs.existsSync(path.join(RAW, 'color.stats.json')) ? JSON.parse(fs.readFileSync(path.join(RAW, 'color.stats.json'), 'utf8')) : {}), ...stats }, null, 1));
}
if (process.argv[1].endsWith('build-color.mjs')) await main();
export { JOBS };
