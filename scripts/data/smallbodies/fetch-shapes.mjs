#!/usr/bin/env node
// Download the raw small-body shape models listed in sources.json into
// data-raw/smallbodies/<id>/<file>. Skips files that already exist (use --force to refetch).
// Usage: node scripts/data/smallbodies/fetch-shapes.mjs [id ...] [--force]
// Then:  python -P scripts/data/smallbodies/build-shapes.py
//        node scripts/data/smallbodies/verify-shapes.mjs
import { mkdir, stat, writeFile, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const { bodies } = JSON.parse(await readFile(join(here, 'sources.json'), 'utf8'));
const args = process.argv.slice(2);
const force = args.includes('--force');
const only = args.filter((a) => !a.startsWith('--'));

for (const [id, s] of Object.entries(bodies)) {
  if (only.length && !only.includes(id)) continue;
  const dest = join(root, 'data-raw', 'smallbodies', id, s.file);
  if (!force) {
    try {
      const st = await stat(dest);
      if (st.size > 0) { console.log(`[${id}] cached ${s.file} (${st.size} B)`); continue; }
    } catch { /* not cached */ }
  }
  await mkdir(dirname(dest), { recursive: true });
  process.stdout.write(`[${id}] GET ${s.url} ... `);
  const res = await fetch(s.url, { redirect: 'follow' });
  if (!res.ok) { console.log(`HTTP ${res.status}`); process.exitCode = 1; continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${buf.length} B`);
}
