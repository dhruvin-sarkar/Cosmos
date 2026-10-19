// Extracts the catalog rows of the notable satellites into ../notable.generated.json (same snapshot as catalog.json),
// so their entities can be propagated with SGP4 on the main thread without loading the 9 MB catalog first.
// Run: node src/domains/orbital/tools/extract-notable.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..', '..');
const cat = JSON.parse(readFileSync(join(root, 'public/data/orbital/catalog.json'), 'utf8'));
const NORADS = [
  '25544', '48274', '20580', '49260', '25994', '27424', '40697', '42063', '60989', '43013', '60133', '51850',
  '55268', '67588', '43564', '46805', '43001', '42915', '27386', '5', '43613',
];
const byId = new Map(cat.rows.map((r) => [r[0], r]));
const rows = [];
for (const n of NORADS) {
  const r = byId.get(n);
  if (!r) { console.error('missing', n); continue; }
  if (r[23] !== 'celestrak-gp') console.error('no GP for', n, r[1]);
  rows.push(r);
}
writeFileSync(join(here, '..', 'notable.generated.json'), JSON.stringify({ generated: cat.generated, fields: cat.fields, rows }) + '\n');
console.log('wrote', rows.length, 'rows;', rows.map((r) => r[1]).join(', '));
