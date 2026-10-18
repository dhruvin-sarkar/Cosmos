// Download (once) the TeX sources of the papers whose tables are transcribed; only .tex/.bbl are kept.
import { arxivSource, log } from './lib.mjs';
for (const id of process.argv.slice(2)) { const s = await arxivSource(id); log(id, s.files.length, 'tex files', s.text.length, 'chars'); }
