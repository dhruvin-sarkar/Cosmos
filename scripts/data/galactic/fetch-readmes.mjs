// One-off helper (idempotent): cache the CDS ReadMe files of every VizieR catalogue used by the galactic domain.
// Usage: node scripts/data/galactic/fetch-readmes.mjs
import { cached, CDSARC, log } from './lib.mjs';
export const CATALOGUES = ['VII/202', 'J/ApJ/837/30', 'J/ApJ/885/131', 'J/ApJ/870/32', 'J/A+A/656/A51', 'J/A+A/673/A114', 'J/ApJ/944/94', 'J/MNRAS/505/5978'];
export const catDir = (cat) => `vizier/${cat.replace(/[/+]/g, (c) => (c === '/' ? '_' : '+'))}`;
for (const cat of CATALOGUES) {
  const r = await cached(`${catDir(cat)}/ReadMe`, `${CDSARC}/${cat}/ReadMe`);
  log(cat, r.text.length, 'bytes', r.text.split('\n')[0]);
}
