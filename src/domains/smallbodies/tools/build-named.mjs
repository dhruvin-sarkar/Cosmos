// Builds src/domains/smallbodies/named.generated.json: public/data/solar/smallbodies.json (physical data) merged with
// FULL-PRECISION osculating elements from the JPL SBDB API (full-prec=1). The shipped smallbodies.json elements are
// rounded to 3 significant figures by the API default (Apophis M = 175 deg instead of 175.3304 deg = ~1e6 km position error).
// Usage: node src/domains/smallbodies/tools/build-named.mjs   (polite: 1 request per 1.2 s, cache in data-raw/solar/sbdb-fullprec/)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const SRC = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/data/solar/smallbodies.json'), 'utf8'));
const CACHE = path.join(ROOT, 'data-raw/solar/sbdb-fullprec');
fs.mkdirSync(CACHE, { recursive: true });
const SSTR = { vesta: '4', pallas: '2', hygiea: '10', psyche: '16', eros: '433', bennu: '101955', ryugu: '162173', itokawa: '25143', apophis: '99942', didymos: '65803', '2024-yr4': '2024 YR4', phaethon: '3200', halley: '1P', encke: '2P', 'tempel-1': '9P', '67p': '67P', 'hale-bopp': 'C/1995 O1', oumuamua: '1I', borisov: '2I', '3i-atlas': '3I', arrokoth: '486958', sedna: '90377' };
const EL = { a: 'aAU', e: 'e', i: 'iDeg', om: 'nodeDeg', w: 'argPeriDeg', ma: 'meanAnomalyDeg', q: 'qAU', per: 'periodDays', tp: 'tpJD' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));

const out = [];
for (const b of SRC.bodies) {
  if (b.role === 'dwarf-planet-orbit-only' || b.id === 'ceres') continue;
  const rec = { ...b };
  delete rec.source;
  if (SSTR[b.id]) {
    const file = path.join(CACHE, `${b.id}.json`);
    let j;
    if (fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, 'utf8'));
    else {
      const url = `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(SSTR[b.id])}&full-prec=1`;
      const res = await fetch(url, { headers: { 'User-Agent': 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)' } });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      j = await res.json();
      if (!j.orbit) throw new Error(`no orbit for ${b.id}: ${JSON.stringify(j).slice(0, 200)}`);
      fs.writeFileSync(file, JSON.stringify(j));
      await sleep(1200);
    }
    const el = { epochJD: num(j.orbit.epoch) };
    const sg = {};
    for (const e of j.orbit.elements) if (EL[e.name]) { el[EL[e.name]] = num(e.value); sg[EL[e.name]] = num(e.sigma); }
    rec.elements = el;
    rec.sigmas = sg;
    rec.elementsFullPrecision = true;
    console.log(b.id, el.epochJD, el.aAU, el.e, el.meanAnomalyDeg);
  }
  out.push(rec);
}
const dst = path.join(ROOT, 'src/domains/smallbodies/named.generated.json');
fs.writeFileSync(dst, JSON.stringify({ generated: new Date().toISOString().slice(0, 10), retrieved: SRC.retrieved, source: 'JPL SBDB API sbdb.api?full-prec=1 (elements) + public/data/solar/smallbodies.json (physical)', bodies: out }));
console.log('wrote', dst, out.length);
