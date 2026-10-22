// Builds export/Cosmos-SCI-FORGE-2026.pptx: one full-bleed slide image per slide (export/slides/NN.png) with its speaker notes.
//   node docs/exhibition/presentation/build/pptx.mjs     (run from the repo root after build/render.mjs; pptxgenjs lives in .work/deck-tools)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve('.work/deck-tools/package.json'));
const PptxGenJS = require('pptxgenjs');
const ROOT = resolve('docs/exhibition/presentation');
const { titles, notes } = JSON.parse(readFileSync(resolve(ROOT, 'export/notes.json'), 'utf8'));

const pptx = new PptxGenJS();
pptx.layout = 'LAYOUT_WIDE'; // 13.333 x 7.5 in, 16:9
pptx.title = 'Cosmos · SCI-FORGE 2026';
pptx.subject = 'Cosmos: a continuous-scale 3D universe explorer';
titles.forEach((title, i) => {
  const slide = pptx.addSlide();
  slide.background = { color: '000000' };
  slide.addImage({ path: resolve(ROOT, 'export/slides', `${String(i + 1).padStart(2, '0')}.png`), x: 0, y: 0, w: 13.333, h: 7.5, altText: title });
  slide.addNotes(`${title}\n\n${notes[i]}`);
});
await pptx.writeFile({ fileName: resolve(ROOT, 'export/Cosmos-SCI-FORGE-2026.pptx') });
console.log('pptx', titles.length, 'slides');
