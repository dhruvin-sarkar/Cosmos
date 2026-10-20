// tex-planets: make the measured (OPAL) giant-planet maps the only maps at every quality tier, so the low preset, the
// preview tier and the HD tier agree (same colour calibration, same Great Red Spot position):
// - copies color_hd_1k/4k over the index.json tiers (jupiter color_1k/4k; uranus/neptune color_1k/2k),
// - drops hd.json jupiter.color["8k"] (the Solar System Scope map, really 4096 px) so Ultra picks the OPAL map,
// - rewrites the index.json credits for those maps.
// Run after build-opal.mjs + finalize2.mjs:  node scripts/data/textures-hd/apply-tp.mjs
import fs from 'node:fs';
import path from 'node:path';
import { TEX, log, sharp } from './lib.mjs';

const OPAL = {
  credit: 'NASA/ESA Hubble Space Telescope, OPAL program (A. Simon, NASA GSFC; M. Wong, UC Berkeley; G. Orton, JPL) - STScI MAST HLSP OPAL, doi:10.17909/T9G593',
  license: 'Public domain (NASA/ESA HST data via STScI MAST); acknowledge the OPAL program',
  provenanceClass: 'observed',
};
const jobs = {
  jupiter: { tiers: { low: ['color_1k.jpg', 1024], high: ['color_4k.jpg', 4096] }, src: 'color_hd_4k.jpg', note: 'Hubble OPAL 2025 (cycle 32, rotation a) F631N/F502N/F467M global maps, 10 px/deg, Minnaert-corrected; true colour calibrated to the previous art-directed mean colour, contrast x1.7 in linear light; planetocentric latitude, System III longitude (Great Red Spot at map lon +38 E, lat -20). Poleward of ~77 deg: nearest observed zonal mean (illustrative fill).' },
  uranus: { tiers: { low: ['color_1k.jpg', 1024], high: ['color_2k.jpg', 2048] }, src: 'color_hd_4k.jpg', note: 'Hubble OPAL 2024 F657N/F547M/F467M global maps, 2 px/deg, Minnaert-corrected; true colour (Uranus disc reference sRGB 172,208,214), albedo 0.51. Observed north of ~1 S; the south is the mirrored zonal-mean profile (illustrative fill).' },
  neptune: { tiers: { low: ['color_1k.jpg', 1024], high: ['color_2k.jpg', 2048] }, src: 'color_hd_4k.jpg', note: 'Hubble OPAL 2025 F657N/F547M/F467M global maps, 2 px/deg, Minnaert-corrected; colour from the same channel factors as Uranus (so Neptune\'s slightly bluer hue is measured; Irwin et al. 2024), albedo 0.41. Observed south of ~49 N; the north polar cap is the nearest observed zonal mean (illustrative fill).' },
};

const idxFile = path.join(TEX, 'index.json');
const index = JSON.parse(fs.readFileSync(idxFile, 'utf8'));
for (const [body, j] of Object.entries(jobs)) {
  const src = path.join(TEX, body, j.src);
  if (!fs.existsSync(src)) { log('skip', body); continue; }
  for (const [tier, [name, w]] of Object.entries(j.tiers)) {
    await sharp(src).resize(w, w / 2, { kernel: 'lanczos3' }).jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(path.join(TEX, body, name + '.tmp'));
    fs.copyFileSync(path.join(TEX, body, name + '.tmp'), path.join(TEX, body, name)); fs.unlinkSync(path.join(TEX, body, name + '.tmp'));
    index.bodies[body].color[tier] = `textures/${body}/${name}`;
  }
  index.credits[`${body}/color`] = { ...OPAL, source: `https://archive.stsci.edu/hlsps/opal/cycle32/${body}/`, notes: j.note };
  log(body, 'tiers replaced');
}
fs.writeFileSync(idxFile, JSON.stringify(index));

const hdFile = path.join(TEX, 'hd.json');
const hd = JSON.parse(fs.readFileSync(hdFile, 'utf8'));
const jup = hd.bodies.jupiter;
if (jup?.color?.['8k']) {
  delete jup.color['8k'];
  if (jup.bytes) delete jup.bytes.color_8k;
  jup.sources = (jup.sources ?? []).filter((s) => !(s.map === 'color' && !s.tier));
  jup.license = [...new Set(jup.sources.map((s) => s.license))].join('; ');
  jup.source = jup.sources.map((s) => s.name).join(' | ');
  fs.writeFileSync(hdFile, JSON.stringify(hd, null, 1));
  log('hd.json: dropped jupiter color 8k');
}
