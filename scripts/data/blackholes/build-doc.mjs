#!/usr/bin/env node
/**
 * Validates public/data/blackholes/blackholes.json (every value has a resolvable reference, null = Unknown) and
 * regenerates the catalogue tables in docs/data/blackholes.md between the AUTO markers.
 *   node scripts/data/blackholes/build-doc.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const json = JSON.parse(readFileSync(resolve(root, 'public/data/blackholes/blackholes.json'), 'utf8'));
const docPath = resolve(root, 'docs/data/blackholes.md');
const refs = json.references;
const errors = [];

function q(v, unit = '') {
  if (!v || v.value == null) {
    if (v && v.lowerLimit != null) return `> ${v.lowerLimit}${unit} [${v.ref}]`;
    return 'Unknown';
  }
  if (v.ref && !refs[v.ref]) errors.push(`unknown ref ${v.ref}`);
  const e = v.errMinus != null && v.errPlus != null
    ? (v.errMinus === v.errPlus ? ` ± ${v.errPlus}` : ` −${v.errMinus}/+${v.errPlus}`)
    : '';
  return `${fmt(v.value)}${e}${unit}${v.ref ? ` [${v.ref}]` : ''}`;
}
function fmt(x) {
  if (Math.abs(x) >= 1e5) return x.toExponential(2).replace('e+', '×10^');
  return String(x);
}

const ids = new Set();
for (const o of json.objects) {
  if (ids.has(o.id)) errors.push(`duplicate id ${o.id}`);
  ids.add(o.id);
  if (o.massMsun?.value == null) errors.push(`${o.id}: mass missing`);
  if (o.class !== 'merger' && (o.raDeg == null || o.decDeg == null)) errors.push(`${o.id}: position missing`);
  if (o.positionRef && !refs[o.positionRef]) errors.push(`${o.id}: unknown positionRef ${o.positionRef}`);
}

const rows = json.objects.map((o) => {
  const c = o.companion;
  return `| ${o.name} | ${o.class} | ${q(o.massMsun, ' M☉')} | ${q(o.spin)} | ${q(o.distancePc, ' pc')} | ${c ? `${c.name} (${c.spectralType ?? 'Unknown'}, ${q(c.massMsun, ' M☉')})` : '—'} | ${o.orbit?.periodDays ? q(o.orbit.periodDays, ' d') : '—'} |`;
});
const disc = json.objects.map((o) => `- **${o.name}** (${o.discovery?.year ?? "Unknown"}, ${o.discovery?.method ?? "Unknown"}): ${o.discovery?.text ?? ""} [${o.discovery?.ref ?? "—"}]`);
const refList = Object.entries(refs).map(([k, r]) => `- \`${k}\`: ${r.citation}. ${r.url}`);

const table = [
  '| Object | Class | Mass | Spin a* | Distance | Companion | Period |',
  '|---|---|---|---|---|---|---|',
  ...rows,
  '',
  '### How each was found',
  '',
  ...disc,
  '',
  '### References',
  '',
  ...refList,
].join('\n');

const doc = readFileSync(docPath, 'utf8');
const start = '<!-- AUTO:catalogue -->';
const end = '<!-- /AUTO:catalogue -->';
const i = doc.indexOf(start);
const j = doc.indexOf(end);
if (i < 0 || j < 0) throw new Error('AUTO markers missing in docs/data/blackholes.md');
writeFileSync(docPath, `${doc.slice(0, i + start.length)}\n${table}\n${doc.slice(j)}`);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
console.log(`ok: ${json.objects.length} objects, ${Object.keys(refs).length} references`);
