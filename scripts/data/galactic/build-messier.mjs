// messier.json — the 110 Messier objects from SIMBAD (CDS) TAP: position, type, morphology, apparent magnitude, aliases, best literature distance.
import { cached, tapQuery, rowsToObjects, writeOut, nowIso, log, fail, sig, round, icrsToGalactic, SIMBAD_TAP } from './lib.mjs';
import { refsFor } from './refs.mjs';
import fs from 'node:fs';
import { OUT } from './lib.mjs';
import * as Astronomy from 'astronomy-engine';

const ids = Array.from({ length: 110 }, (_, i) => `M ${i + 1}`);
const inList = ids.map((s) => `'${s}'`).join(',');
const norm = (s) => s.replace(/\s+/g, ' ').trim();

const basic = rowsToObjects(await tapQuery(SIMBAD_TAP,
  `SELECT i.id AS qid, b.oid, b.main_id, b.ra, b.dec, b.otype, b.morph_type, b.galdim_majaxis, b.galdim_minaxis, b.rvz_redshift FROM ident AS i JOIN basic AS b ON i.oidref=b.oid WHERE i.id IN (${inList})`,
  'simbad/messier_basic.json'));
const alias = rowsToObjects(await tapQuery(SIMBAD_TAP,
  `SELECT i.id AS qid, i2.id AS alias FROM ident AS i JOIN ident AS i2 ON i2.oidref=i.oidref WHERE i.id IN (${inList}) AND (i2.id LIKE 'NGC %' OR i2.id LIKE 'IC %' OR i2.id LIKE 'NAME %' OR i2.id LIKE 'M %' OR i2.id LIKE 'Cl Melotte%' OR i2.id LIKE 'UGC %')`,
  'simbad/messier_alias.json'));
const dist = rowsToObjects(await tapQuery(SIMBAD_TAP,
  `SELECT i.id AS qid, d.dist, d.unit, d.minus_err, d.plus_err, d.method, d.bibcode FROM ident AS i JOIN mesDistance AS d ON d.oidref=i.oidref WHERE i.id IN (${inList})`,
  'simbad/messier_dist.json'));
const flux = rowsToObjects(await tapQuery(SIMBAD_TAP,
  `SELECT i.id AS qid, f.V, f.B FROM ident AS i JOIN allfluxes AS f ON f.oidref=i.oidref WHERE i.id IN (${inList})`,
  'simbad/messier_flux.json'));

const byQ = (rows) => { const m = new Map(); for (const r of rows) { const k = norm(r.qid); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; };
const bQ = byQ(basic), aQ = byQ(alias), dQ = byQ(dist), fQ = byQ(flux);
const unit2pc = { pc: 1, kpc: 1e3, Mpc: 1e6, Gpc: 1e9 };

const GAL = new Set(['G', 'GiP', 'GiG', 'GiC', 'BiC', 'AGN', 'Sy1', 'Sy2', 'SyG', 'LIN', 'Bla', 'rG', 'SBG', 'H2G', 'LSB', 'EmG', 'BClG', 'GrG', 'ClG', 'QSO', 'Seyfert_1', 'Seyfert_2', 'RadioG']);
function simpleType(ot) {
  if (GAL.has(ot)) return 'galaxy';
  const m = { GlC: 'globular-cluster', OpC: 'open-cluster', 'Cl*': 'open-cluster', 'As*': 'asterism', 'err': 'asterism', '?': 'double-star', PN: 'planetary-nebula', SNR: 'supernova-remnant', HII: 'emission-nebula', RNe: 'reflection-nebula', Cl: 'cluster', As: 'asterism', '**': 'double-star', 'Cl*...': 'open-cluster', MoC: 'molecular-cloud', 'ISM': 'nebula', Neb: 'nebula', 'Psr': 'pulsar', 'Cld': 'cloud' };
  return m[ot] ?? 'other';
}

// ---- OpenNGC (mattiaverga/OpenNGC, CC-BY-SA-4.0): magnitudes + Messier cross-ids to fill gaps in SIMBAD
const ONGC = 'https://raw.githubusercontent.com/mattiaverga/OpenNGC/master/database_files';
const ongc = new Map();
for (const fn of ['NGC.csv', 'addendum.csv']) {
  const txt = (await cached('openngc/' + fn, `${ONGC}/${fn}`)).text.split('\n').map((l) => l.replace(/\r$/, '')).filter(Boolean);
  const head = txt[0].split(';'); const col = (n) => head.indexOf(n);
  const cT = col('Type'), cC = col('Common names'), cM = col('M'), cB = col('B-Mag'), cV = col('V-Mag'), cN = col('Name');
  if (cM < 0 || cB < 0 || cV < 0) fail('OpenNGC header changed: ' + txt[0]);
  for (const l of txt.slice(1)) { const t = l.split(';'); const m = parseInt(t[cM], 10); if (m >= 1 && m <= 110 && !ongc.has(m)) ongc.set(m, { type: t[cT], common: (t[cC] ?? '').split(',')[0].trim() || null, name: t[cN], V: t[cV] === '' ? null : +t[cV], B: t[cB] === '' ? null : +t[cB] }); }
}
log('OpenNGC Messier cross-ids:', ongc.size);
const lm = JSON.parse(fs.readFileSync(`${OUT}/landmarks.json`, 'utf8')).objects; // globular-cluster / M42 distances for rows SIMBAD lacks
// Preferred popular names (display name only; all SIMBAD NAME aliases stay in commonNames)
const PREFERRED = { 1: 'Crab Nebula', 8: 'Lagoon Nebula', 11: 'Wild Duck Cluster', 13: 'Hercules Cluster', 16: 'Eagle Nebula', 17: 'Omega Nebula', 20: 'Trifid Nebula', 27: 'Dumbbell Nebula', 31: 'Andromeda Galaxy', 32: null, 33: 'Triangulum Galaxy', 42: 'Orion Nebula', 44: 'Beehive Cluster', 45: 'Pleiades', 51: 'Whirlpool Galaxy', 57: 'Ring Nebula', 63: 'Sunflower Galaxy', 64: 'Black Eye Galaxy', 81: "Bode's Galaxy", 82: 'Cigar Galaxy', 83: 'Southern Pinwheel Galaxy', 87: 'Virgo A', 101: 'Pinwheel Galaxy', 104: 'Sombrero Galaxy' };
for (const k of Object.keys(PREFERRED)) if (PREFERRED[k] === null) delete PREFERRED[k];
// Harris 1996 (2010 ed.) Part II: integrated V magnitude (Vt) for globular clusters lacking SIMBAD/OpenNGC magnitudes
const hl = fs.readFileSync("data-raw/galactic/harris/mwgc.dat", "utf8").split(String.fromCharCode(10)).map((x) => x.trimEnd());
const hVt = new Map();
for (const l of hl.slice(hl.findIndex((x) => x.includes('Part II:')), hl.findIndex((x) => x.includes('Part III:')))) {
  const t = l.trim().split(/\s+/); const mm = /^(NGC|IC|Pal|Terzan|Ter|Djorg|ESO|Lynga|UKS|BH|FSR|Arp|Pyxis|AM|Whiting|HP|Liller|E)$/.test(t[0]) ? `${t[0]} ${t[1]}` : null;
  if (mm && t.length >= 8 && /^-?\d/.test(t[2]) && +t[7] > 0 && +t[7] < 30) hVt.set(mm, +t[7]);
}
const rows = [];
const warn = [];
for (let n = 1; n <= 110; n++) {
  const q = `M ${n}`;
  const b = bQ.get(q)?.[0]; if (!b) { fail(`SIMBAD returned nothing for ${q}`); }
  // distance: most recent entry with an uncertainty, else the most recent entry
  const cands = (dQ.get(q) ?? []).map((d) => {
    const f = unit2pc[(d.unit ?? '').trim()]; if (!f || !(d.dist > 0)) return null;
    const minus = d.minus_err != null ? Math.abs(d.minus_err) * f : null, plus = d.plus_err != null ? d.plus_err * f : null;
    const err = [minus, plus].filter((x) => x != null);
    return { pc: d.dist * f, minus, plus, err: err.length ? err.reduce((a, c) => a + c, 0) / err.length : null, year: +String(d.bibcode ?? '0000').slice(0, 4), bibcode: d.bibcode, method: (d.method ?? '').trim() || null };
  }).filter(Boolean);
  const withErr = cands.filter((c) => c.err != null);
  const pool = withErr.length ? withErr : cands;
  pool.sort((a, c) => c.year - a.year || (a.err ?? 1e99) / a.pc - (c.err ?? 1e99) / c.pc);
  const best = pool[0] ?? null;
  const allPc = cands.map((c) => c.pc).sort((a, c) => a - c);
  const median = allPc.length ? (allPc.length % 2 ? allPc[(allPc.length - 1) / 2] : (allPc[allPc.length / 2 - 1] + allPc[allPc.length / 2]) / 2) : null;
  const fl = fQ.get(q)?.[0];
  const vmag = fl?.v ?? fl?.V ?? null, bmag = fl?.b ?? fl?.B ?? null;
  let mag = vmag ?? bmag; let magBand = vmag != null ? 'V' : bmag != null ? 'B' : null; let magSrc = mag != null ? 'SIMBAD' : null;
  const on = ongc.get(n);
  // SIMBAD V for planetary nebulae is the central star: prefer OpenNGC integrated magnitude
  const usePN = on && b.otype === 'PN' && (on.V ?? on.B) != null;
  if ((mag == null || usePN) && on && (on.V ?? on.B) != null) { mag = on.V ?? on.B; magBand = on.V != null ? 'V' : 'B'; magSrc = 'OpenNGC (CC-BY-SA-4.0)'; }
  if (mag == null && b.otype === 'GlC') { const nid = [...(aQ.get(q) ?? [])].map((a) => norm(a.alias)).find((a) => hVt.has(a)); if (nid) { mag = hVt.get(nid); magBand = 'V'; magSrc = 'Harris 1996 (2010 ed.) integrated Vt'; } }
  const names = [...new Set((aQ.get(q) ?? []).map((a) => norm(a.alias)))];
  const common = names.filter((s) => s.startsWith('NAME ')).map((s) => s.slice(5).replace(/[*]$/, '').trim()).filter((s) => !/^M [0-9]+$/.test(s));
  const catalog = names.filter((s) => /^(NGC|IC|UGC|Cl Melotte)/.test(s));
  const gal = icrsToGalactic(b.ra, b.dec);
  const con = Astronomy.Constellation(b.ra / 15, b.dec);
  rows.push({
    messier: n, id: `m${n}`, designation: q, name: PREFERRED[n] ?? common[0] ?? ongc.get(n)?.common ?? null, commonNames: common,
    ngcIc: catalog.filter((s) => /^(NGC|IC) /.test(s)), aliases: names.filter((s) => s !== q && !s.startsWith('NAME ')),
    simbadMainId: norm(b.main_id), simbadType: b.otype, type: simpleType(b.otype), morphology: b.morph_type?.trim() || null,
    constellation: con.name, constellationAbbr: con.symbol,
    raDeg: sig(b.ra, 9), decDeg: sig(b.dec, 9), lDeg: round(gal.l, 4), bDeg: round(gal.b, 4),
    apparentMag: mag != null ? round(mag, 2) : null, apparentMagBand: magBand, apparentMagSource: magSrc,
    angularSizeArcmin: b.galdim_majaxis != null ? { major: b.galdim_majaxis, minor: b.galdim_minaxis ?? null } : null,
    redshift: b.rvz_redshift ?? null,
    distPc: best ? sig(best.pc, 6) : null, distMpc: best && best.pc >= 1e5 ? sig(best.pc / 1e6, 5) : null,
    distErrPc: best?.err != null ? sig(best.err, 3) : null, distErrMinusPc: best?.minus != null ? sig(best.minus, 3) : null, distErrPlusPc: best?.plus != null ? sig(best.plus, 3) : null,
    distMethod: best?.method ?? null, distRef: best ? `bibcode:${best.bibcode}` : null,
    distMedianPc: median != null ? sig(median, 5) : null, distEntries: cands.length,
  });
  if (best == null) warn.push(q);
}

// ---- distance gap-fill: globular clusters from Harris/Baumgardt & Vasiliev (landmarks.json); M43 shares the Orion Nebula distance; M73 is a chance asterism
for (const r of rows) {
  if (r.designation === 'M 73') { Object.assign(r, { distPc: null, distMpc: null, distErrPc: null, distErrMinusPc: null, distErrPlusPc: null, distMethod: null, distRef: null, distMedianPc: null, distNote: 'asterism of unrelated stars: no meaningful distance' }); continue; }
  if (r.distPc != null && r.type !== 'globular-cluster') continue;
  let src = null;
  if (r.type === 'globular-cluster' && r.ngcIc[0]) src = lm.find((o) => o.type === 'globular-cluster' && o.id === 'gc-' + r.ngcIc[0].toLowerCase().replace(/[^a-z0-9]+/g, '-'));
  if (r.designation === 'M 43') src = lm.find((o) => o.id === 'm42');
  if (src) Object.assign(r, { distPc: src.distPc, distMpc: null, distErrPc: src.distErrPc, distErrMinusPc: src.distErrMinusPc, distErrPlusPc: src.distErrPlusPc, distMethod: src.distMethod, distRef: src.distRef, distNote: `from landmarks.json (${src.id})` });
}

// ---- sanity checks vs. well-known values
const get = (n) => rows[n - 1];
function expect(cond, msg) { if (!cond) fail('Messier sanity: ' + msg); }
expect(get(31).type === 'galaxy' && Math.abs(get(31).raDeg - 10.6847) < 0.01 && Math.abs(get(31).decDeg - 41.2688) < 0.01, 'M31 position');
expect(get(31).distPc > 6e5 && get(31).distPc < 9.5e5, 'M31 distance ' + get(31).distPc);
expect(get(1).type === 'supernova-remnant' && get(1).constellation === 'Taurus', 'M1');
expect(get(42).constellation === 'Orion', 'M42 constellation');
expect(get(45).type === 'open-cluster', 'M45 type ' + get(45).type);
expect(get(13).type === 'globular-cluster' && get(13).constellation === 'Hercules', 'M13');
expect(get(87).distPc > 1.2e7 && get(87).distPc < 2.3e7, 'M87 dist ' + get(87).distPc);
expect(get(51).constellation === 'Canes Venatici', 'M51 constellation');
expect(rows.every((r) => Number.isFinite(r.raDeg) && Number.isFinite(r.decDeg)), 'coordinates');
log('no distance:', warn.join(', ') || 'none', '| no magnitude:', rows.filter((r) => r.apparentMag == null).map((r) => r.designation).join(', ') || 'none');
log('types:', JSON.stringify(rows.reduce((a, r) => (a[r.type] = (a[r.type] ?? 0) + 1, a), {})));

const doc = {
  schemaVersion: 1, generated: nowIso(), domain: 'galactic', dataset: 'messier', count: rows.length,
  notes: [
    'Positions: SIMBAD ICRS J2000, epoch 2000 (degrees).',
    'distPc: SIMBAD mesDistance — the most recent literature entry that carries an uncertainty (else the most recent entry); distMedianPc is the median of all distEntries entries. Galaxy distances are redshift-independent (Cepheids, TRGB, SBF, ...) where available; uncertainties are as published and ignore systematics.',
    'apparentMag: SIMBAD V magnitude (B if V is missing); planetary nebulae and objects without SIMBAD flux use OpenNGC integrated magnitudes (see apparentMagSource) — for extended objects this is an integrated magnitude from the cited catalogue and varies by source.',
    'M40 is the double star Winnecke 4, M45 the Pleiades, M73 an asterism and M24 a Milky Way star cloud; M102 is usually identified with M101 or NGC 5866 (SIMBAD resolves it as listed here).',
  ],
  objects: rows,
};
doc.references = refsFor(['simbad', 'cosmosDerived'])
doc.references.openngc = 'OpenNGC (M. Verga et al., github.com/mattiaverga/OpenNGC), CC BY-SA 4.0: supplies integrated magnitudes where apparentMagSource says OpenNGC (all planetary nebulae and objects SIMBAD lacks) and some common names. ShareAlike applies to those values; attribution required.';
const r = writeOut('messier.json', doc);
log('messier.json', r.bytes, 'B,', rows.length, 'objects');
