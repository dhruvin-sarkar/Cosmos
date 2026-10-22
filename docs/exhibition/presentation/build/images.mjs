// Copies the deck's screenshots from the capture runs into deck/img as 1920-wide JPEGs.
// node docs/exhibition/presentation/build/images.mjs   (run from the repo root)
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
const require = createRequire('C:/Projects/Cosmos/package.json');
const sharp = require('sharp');
const S = '.work/shots/';
const OUT = 'docs/exhibition/presentation/deck/img/';
const MAP = {
  'earth': 'final/journey/00.png', 'iss': 'final/journey/01.png', 'moon': 'final/journey/03.png', 'sun': 'final/journey/04.png',
  'inner-system': 'final/journey/05.png', 'jupiter': 'final/journey/06.png', 'saturn': 'final/journey/07.png',
  'didymos': 'final/journey/08.png', 'heliosphere': 'final/journey/09.png', 'oort': 'final/journey/10.png',
  'proxima': 'final/journey/11.png', 'trappist': 'final/journey/12.png', 'orion-arm': 'final/journey/13.png',
  'milky-way': 'final/journey/14.png', 'sgr-a': 'final/journey/15.png', 'black-hole': 'final/journey/16.png',
  'andromeda': 'final/journey/17.png', 'local-group': 'final/journey/18.png', 'laniakea': 'final/journey/19.png',
  'cosmic-web': 'final/journey/20.png', 'cmb': 'final/journey/21.png', 'cmb-sphere': 'final/journey/21.png',
  'app-ui': 'fix-3-ui-redesign/after-1920.png',
  'interior-earth': 'interiors/k-earth-temp.png', 'interior-compare': 'interiors/h-cmp-earth-mars.png',
  'lab-s2': 'galaxy/q-lab-s2.png', 'bh-cygnus': 'blackholes/o-cyg-close.png', 'bh-einstein': 'blackholes/m-gaia1-einstein.png',
  'lab-habitability': 'exoplanets/lab-trappist1e.png', 'exo-explorer': 'exoplanets/explorer.png',
  'lab-debris': 'labs-debris/result-1.png', 'lab-breakup': 'labs-debris/breakup-1.png',
  'lab-dart': 'fix-3-labs-defense/after-Orbit-change.png', 'lab-dart-impact': 'fix-3-labs-defense/after-impact2.png',
};
mkdirSync(OUT, { recursive: true });
// Crops (fractions of the source: x0, y0, x1, y1) that cut the app's side panels out of close-up figures.
const CROP = {
  'interior-earth': [0.36, 0.08, 1, 0.97], 'lab-s2': [0, 0.135, 0.765, 0.875], 'bh-cygnus': [0.02, 0.07, 0.7, 0.93],
  'lab-debris': [0.3, 0.09, 0.99, 0.86], 'cmb-sphere': [0.27, 0.15, 0.73, 0.835], 'bh-einstein': [0.3, 0.13, 0.7, 0.87], 'exo-explorer': [0.36, 0.16, 0.82, 0.93], 'lab-habitability': [0.36, 0.16, 0.82, 0.93],
};
for (const [name, src] of Object.entries(MAP)) {
  let img = sharp(S + src);
  const c = CROP[name];
  if (c) { const m = await img.metadata(); img = img.extract({ left: Math.round(c[0] * m.width), top: Math.round(c[1] * m.height), width: Math.round((c[2] - c[0]) * m.width), height: Math.round((c[3] - c[1]) * m.height) }); }
  const info = await img.resize({ width: c ? 1400 : 1920 }).jpeg({ quality: 84, mozjpeg: true }).toFile(OUT + name + '.jpg');
  console.log(name, info.width + 'x' + info.height, Math.round(info.size / 1024) + ' KB');
}
