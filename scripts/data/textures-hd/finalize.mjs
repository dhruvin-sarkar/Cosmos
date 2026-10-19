// Writes public/textures/hd.json from the build stats (data-raw/textures-hd/{color.stats,normals.*}.json).
//   node scripts/data/textures-hd/finalize.mjs
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, log } from './lib.mjs';
import { JOBS } from './build-color.mjs';

const colorStats = JSON.parse(fs.readFileSync(path.join(RAW, 'color.stats.json'), 'utf8'));
const RETRIEVED = '2026-10-18';
const bodies = {};
const SSS_LIC = 'CC BY 4.0 - Solar System Scope (https://www.solarsystemscope.com/textures/), attribution required';
const entry = (b) => (bodies[b] ??= { sources: [] });

for (const [name, j] of Object.entries(JOBS)) {
  const st = colorStats[name];
  if (!st) continue;
  const body = j.out.split('/')[0];
  const e = entry(body);
  const key = body === 'venus' ? 'surface' : 'color';
  e[key] = { '8k': st.path };
  e.bytes = { ...(e.bytes ?? {}), [`${key}_8k`]: st.bytes };
  if (st.meanAlbedo) e.albedo = { meanLinear: st.meanAlbedo, note: 'Map is albedo-calibrated: mean linear luminance (|lat|<60) equals this physical mean albedo; do not scale again in the material. Colour = sRGB.' };
  e.sources.push({ map: key, name: j.source, url: j.url, license: j.license, retrieved: RETRIEVED });
}
const NORMAL_NOTE = {
  moon: 'LRO LOLA (NASA/GSFC) LDEM_64, public domain. Slopes x2.5 exaggerated; box-filtered to 4096x2048 (2.7 km/px) and 2048x1024.',
  mars: 'MGS MOLA MEGDR 16 ppd (NASA/GSFC), public domain. Slopes x4 exaggerated (Mars relief is gentle at 5 km/px).',
  mercury: 'MESSENGER USGS Global DEM 665 m v2 (USGS Astrogeology), public domain. Slopes x3 exaggerated. Source DEM has residual noise near the poles.',
};
for (const body of ['moon', 'mars', 'mercury']) {
  const f = path.join(RAW, `normals.${body}.json`);
  if (!fs.existsSync(f)) continue;
  const n = JSON.parse(fs.readFileSync(f, 'utf8'));
  const e = entry(body);
  e.normal = { '4k': n.files['4k'].path, '2k': n.files['2k'].path };
  e.bytes = { ...(e.bytes ?? {}), normal_4k: n.files['4k'].bytes, normal_2k: n.files['2k'].bytes };
  e.normalInfo = { convention: 'OpenGL tangent space (R=+east, G=+north, B=up), linear data, PNG', exaggeration: n.exaggeration, heightRangeM: n.heightRangeM, note: NORMAL_NOTE[body] };
  e.sources.push({ map: 'normal', name: n.source, url: n.url, license: 'public domain (NASA/USGS)', retrieved: RETRIEVED });
}
for (const e of Object.values(bodies)) e.license = e.sources.some((s) => /CC BY/.test(s.license)) ? SSS_LIC + '; elevation data public domain' : 'public domain (NASA/USGS)';
for (const b of Object.keys(bodies)) bodies[b].source = bodies[b].sources.map((s) => s.name).join(' | ');
const out = {
  version: 1,
  generated: new Date().toISOString(),
  convention: 'Equirectangular 2:1, x=0 at 180W, east-positive, y=0 at 90N (same as index.json). Colour maps sRGB; normals linear OpenGL tangent-space. Paths relative to public/.',
  bodies,
};
fs.writeFileSync(path.join(TEX, 'hd.json'), JSON.stringify(out, null, 1));
log('hd.json', Object.keys(bodies).join(','));
