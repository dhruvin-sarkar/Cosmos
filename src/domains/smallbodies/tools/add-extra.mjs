// Appends small bodies that are not in public/data/solar/smallbodies.json to named.generated.json (idempotent), with
// FULL-PRECISION elements and physical parameters from the JPL SBDB API. Run after build-named.mjs.
// Usage: node src/domains/smallbodies/tools/add-extra.mjs   (cache in data-raw/solar/sbdb-fullprec/)
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../../..');
const CACHE = path.join(ROOT, 'data-raw/solar/sbdb-fullprec');
fs.mkdirSync(CACHE, { recursive: true });
const EXTRA = [{ id: 'tsuchinshan-atlas', sstr: 'C/2023 A3', kind: 'comet', role: 'notable', diameterKm: null, albedo: null }];
const EL = { a: 'aAU', e: 'e', i: 'iDeg', om: 'nodeDeg', w: 'argPeriDeg', ma: 'meanAnomalyDeg', q: 'qAU', per: 'periodDays', tp: 'tpJD' };
const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const dst = path.join(ROOT, 'src/domains/smallbodies/named.generated.json');
const named = JSON.parse(fs.readFileSync(dst, 'utf8'));

for (const x of EXTRA) {
  const file = path.join(CACHE, `${x.id}.json`);
  let j;
  if (fs.existsSync(file)) j = JSON.parse(fs.readFileSync(file, 'utf8'));
  else {
    const url = `https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=${encodeURIComponent(x.sstr)}&full-prec=1&phys-par=1`;
    const res = await fetch(url, { headers: { 'User-Agent': 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)' } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    j = await res.json();
    fs.writeFileSync(file, JSON.stringify(j));
  }
  const el = { epochJD: num(j.orbit.epoch) };
  const sg = {};
  for (const e of j.orbit.elements) if (EL[e.name]) { el[EL[e.name]] = num(e.value); sg[EL[e.name]] = num(e.sigma); }
  const phys = Object.fromEntries((j.phys_par ?? []).map((p) => [p.name, num(p.value)]));
  const rec = {
    id: x.id, name: j.object.fullname, fullname: j.object.fullname, designation: j.object.des, spkid: Number(j.object.spkid), kind: x.kind,
    orbitClass: j.object.orbit_class.code, neo: !!j.object.neo, pha: !!j.object.pha, H: phys.H ?? null, M1: phys.M1 ?? null, K1: phys.K1 ?? null,
    diameterKm: x.diameterKm, diameterSigmaKm: null, albedo: x.albedo, rotationPeriodH: null, spectralType: null, gmKm3s2: null, extentKm: null,
    elements: el, sigmas: sg, conditionCode: j.orbit.condition_code ?? null, dataArcDays: num(j.orbit.data_arc), nObsUsed: num(j.orbit.n_obs_used),
    moidAU: num(j.orbit.moid), solutionDate: j.orbit.soln_date ?? null, discovery: { by: null, date: null, site: null }, role: x.role, elementsFullPrecision: true,
  };
  const i = named.bodies.findIndex((b) => b.id === x.id);
  if (i >= 0) named.bodies[i] = rec; else named.bodies.push(rec);
  console.log(x.id, el.epochJD, el.e, el.qAU, el.tpJD);
}
fs.writeFileSync(dst, JSON.stringify(named));
