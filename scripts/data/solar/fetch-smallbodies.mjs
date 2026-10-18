// JPL SBDB API -> raw cache + public/data/solar/smallbodies.json (notable bodies; dimorphos is added by build-smallbodies.mjs)
import { fetchJSON, qs, slug, num, log, assert, writeJSON, OUT_DIR, RAW_DIR } from './lib.mjs';
import fs from 'node:fs';

export const TARGETS = [
  // [id, sstr, kind]
  ['ceres', '1', 'asteroid'], ['vesta', '4', 'asteroid'], ['pallas', '2', 'asteroid'], ['hygiea', '10', 'asteroid'], ['psyche', '16', 'asteroid'],
  ['eros', '433', 'asteroid'], ['bennu', '101955', 'asteroid'], ['ryugu', '162173', 'asteroid'], ['itokawa', '25143', 'asteroid'],
  ['apophis', '99942', 'asteroid'], ['didymos', '65803', 'asteroid'], ['2024-yr4', '2024 YR4', 'asteroid'], ['phaethon', '3200', 'asteroid'],
  ['halley', '1P', 'comet'], ['encke', '2P', 'comet'], ['tempel-1', '9P', 'comet'], ['67p', '67P', 'comet'], ['hale-bopp', 'C/1995 O1', 'comet'],
  ['oumuamua', '1I', 'interstellar'], ['borisov', '2I', 'interstellar'], ['3i-atlas', '3I', 'interstellar'],
  ['arrokoth', '486958', 'asteroid'], ['sedna', '90377', 'asteroid'],
  // dwarf-planet orbits (used by bodies.json)
  ['pluto', '134340', 'asteroid'], ['eris', '136199', 'asteroid'], ['haumea', '136108', 'asteroid'], ['makemake', '136472', 'asteroid'],
];
const URL_ = 'https://ssd-api.jpl.nasa.gov/sbdb.api';
const EL = { a: 'aAU', e: 'e', i: 'iDeg', om: 'nodeDeg', w: 'argPeriDeg', ma: 'meanAnomalyDeg', q: 'qAU', per: 'periodDays', tp: 'tpJD' };

const out = []; let retrieved = null;
for (const [id, sstr, kind] of TARGETS) {
  const url = `${URL_}?${qs({ sstr, 'phys-par': 1, discovery: 1 })}`;
  const r = await fetchJSON(url, { cache: `sbdb/${slug(id)}.json`, okStatus: [200, 300] });
  retrieved = r.retrieved;
  let j = r.json;
  if (j.list && !j.object) { // ambiguous: pick the first
    log('ambiguous', sstr, JSON.stringify(j.list.slice(0, 3)));
    const r2 = await fetchJSON(`${URL_}?${qs({ sstr: j.list[0].pdes, 'phys-par': 1, discovery: 1 })}`, { cache: `sbdb/${slug(id)}-2.json` });
    j = r2.json;
  }
  assert(j.object && j.orbit, `SBDB: no object/orbit for ${sstr}: ${JSON.stringify(j).slice(0, 200)}`);
  const el = {}, sg = {};
  for (const e of j.orbit.elements) if (EL[e.name]) { el[EL[e.name]] = num(e.value); sg[EL[e.name]] = num(e.sigma); }
  const epochJD = num(j.orbit.epoch);
  const pp = {}; for (const p of j.phys_par ?? []) pp[p.name] = p;
  const gm = num(pp.GM?.value);
  const rec = {
    id, name: j.object.shortname ?? j.object.fullname, fullname: j.object.fullname, designation: j.object.des, spkid: num(j.object.spkid),
    kind, orbitClass: j.object.orbit_class?.code ?? null, neo: !!j.object.neo, pha: !!j.object.pha,
    H: num(pp.H?.value), M1: num(pp.M1?.value), K1: num(pp.K1?.value),
    diameterKm: num(pp.diameter?.value), diameterSigmaKm: num(pp.diameter?.sigma),
    albedo: num(pp.albedo?.value), rotationPeriodH: num(pp.rot_per?.value), spectralType: pp.spec_B?.value ?? pp.spec_T?.value ?? null,
    gmKm3s2: gm, extentKm: pp.extent?.value ?? null,
    elements: { epochJD, ...el }, sigmas: { epochJD: null, ...sg },
    conditionCode: j.orbit.condition_code ?? null, dataArcDays: num(j.orbit.data_arc), nObsUsed: num(j.orbit.n_obs_used),
    moidAU: num(j.orbit.moid), solutionDate: j.orbit.soln_date ?? null,
    discovery: j.discovery ? { by: j.discovery.who ?? null, date: j.discovery.date ?? null, site: j.discovery.location ?? null } : null,
    source: `JPL SBDB API sbdb.api?sstr=${sstr} (orbit solution ${j.orbit.source ?? 'JPL'}, orbit_id ${j.orbit.orbit_id})`,
  };
  out.push(rec);
  log(id, rec.fullname, 'a=', el.aAU, 'e=', el.e, 'H=', rec.H, 'D=', rec.diameterKm, 'cc=', rec.conditionCode);
}
fs.mkdirSync(RAW_DIR + '/sbdb', { recursive: true });
fs.writeFileSync(RAW_DIR + '/sbdb/_assembled.json', JSON.stringify({ retrieved, out }));
log('assembled', out.length);
