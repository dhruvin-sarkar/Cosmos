// Round 2: APPEND entries to public/textures/hd.json (never rewrites round-1 data) from data-raw/textures-hd/hd2.*.json fragments.
// Fragment: { body, map: 'color'|'normal'|'bump'|'surface'|'clouds', tier: '16k'|'8k'|'4k', path, bytes, source: {name,url,license,retrieved}, note?, extra? (merged into body) }
//   node scripts/data/textures-hd/finalize2.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, log } from './lib.mjs';

const file = path.join(TEX, 'hd.json');
const hd = JSON.parse(fs.readFileSync(file, 'utf8'));
for (const f of fs.readdirSync(RAW).filter((n) => /^hd2\..+\.json$/.test(n)).sort()) {
  const frags = [].concat(JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8')));
  for (const fr of frags) {
    if (!fs.existsSync(path.join(TEX, '..', fr.path))) { log('skip (missing file)', fr.path); continue; }
    const b = (hd.bodies[fr.body] ??= { sources: [] });
    b[fr.map] = { ...(b[fr.map] ?? {}), [fr.tier]: fr.path };
    b.bytes = { ...(b.bytes ?? {}), [`${fr.map}_${fr.tier}`]: fr.bytes };
    b.sources = (b.sources ?? []).filter((s) => !(s.map === fr.map && s.tier === fr.tier));
    b.sources.push({ map: fr.map, tier: fr.tier, ...fr.source });
    if (fr.extra) Object.assign(b, fr.extra);
    if (fr.note) (b.notes ??= {})[`${fr.map}_${fr.tier}`] = fr.note;
    b.license = [...new Set(b.sources.map((s) => s.license))].join('; ');
    b.source = b.sources.map((s) => s.name).join(' | ');
  }
}
hd.generated2 = new Date().toISOString();
fs.writeFileSync(file, JSON.stringify(hd, null, 1));
log('hd.json bodies:', Object.keys(hd.bodies).join(','));
