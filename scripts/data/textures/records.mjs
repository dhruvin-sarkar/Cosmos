// Per-group build records (small JSON in data-raw/textures/records/) merged by finalize.mjs.
import fs from 'node:fs';
import { RAW_DIR, mkdirp } from './lib.mjs';

export function saveRecords(group, recs) {
  mkdirp(`${RAW_DIR}/records`);
  const p = `${RAW_DIR}/records/${group}.json`;
  let cur = {};
  try { cur = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { /* new */ }
  for (const r of recs) cur[r.key] = r;
  fs.writeFileSync(p, JSON.stringify(cur, null, 1));
}

export function loadAllRecords() {
  const d = `${RAW_DIR}/records`;
  const all = [];
  if (!fs.existsSync(d)) return all;
  for (const f of fs.readdirSync(d)) all.push(...Object.values(JSON.parse(fs.readFileSync(`${d}/${f}`, 'utf8'))));
  return all;
}
