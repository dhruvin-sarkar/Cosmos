// landmarks.json — notable Milky Way objects with 3D positions.
//  * 157 globular clusters: Harris 1996 (2010 ed.) positions + distances, distances replaced by Baumgardt & Vasiliev 2021 where available
//  * curated nebulae / star-forming regions / clusters / stellar-mass black holes / pulsars: positions from SIMBAD TAP, distances from
//    SIMBAD mesDistance (one preferred bibcode per object), Hunt & Reffert 2023 (Gaia DR3) or a cited literature value.
import fs from 'node:fs';
import { cached, tapQuery, rowsToObjects, vizierTsv, writeOut, nowIso, log, fail, sig, round, helioGalXYZ, icrsToGalactic, RAW, SIMBAD_TAP, DEG, ICRS_TO_GAL, matVec } from './lib.mjs';
import { refsFor } from './refs.mjs';

const R0_PC = 8275.9;
const gal2icrs = (l, b) => {
  const inv = [0, 1, 2].map((j) => ICRS_TO_GAL.map((r) => r[j]));
  const v = matVec(inv, [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)]);
  let ra = Math.atan2(v[1], v[0]) / DEG; if (ra < 0) ra += 360;
  return [ra, Math.asin(v[2]) / DEG];
};

// ------------------------------------------------------------------ curated list
const S = (bib) => ({ mode: 'simbad', bib });
const H = (name) => ({ mode: 'hr23', name });
const M = (pc, minus, plus, method, ref, note) => ({ mode: 'manual', pc, minus, plus, method, ref, note });
const Z = '2020A&A...633A..51Z', K = '2019ApJ...870...32K';
// pos: simbad id, or [raDeg, decDeg] literature position, or {gal:[l,b]}
const OBJ = [
  { id: 'sgr-a-star', name: 'Sagittarius A*', aliases: ['Sgr A*'], type: 'galactic-centre', pos: 'NAME Sgr A*', dist: M(8275.9, 8.6, 8.6, 'S2 stellar orbit (GRAVITY 2024)', 'bibcode:2024A&A...692A.242G', 'see sgra.json'), summary: 'The compact radio source at the centre of the Milky Way, coincident with a 4.3 million solar-mass black hole whose mass is measured from stellar orbits.', sizePc: null },
  // nebulae
  { id: 'm42', name: 'Orion Nebula', aliases: ['M 42', 'NGC 1976'], type: 'emission-nebula', pos: 'M 42', dist: S(Z), summary: 'The nearest massive star-forming region, an HII region lit by the young Trapezium stars; visible to the naked eye in Orion\'s sword.', sizePc: null },
  { id: 'm16', name: 'Eagle Nebula', aliases: ['M 16', 'NGC 6611'], type: 'emission-nebula', pos: 'M 16', dist: S(Z), summary: 'HII region and young open cluster in Serpens, home of the "Pillars of Creation" imaged by the Hubble Space Telescope in 1995.', sizePc: null },
  { id: 'm8', name: 'Lagoon Nebula', aliases: ['M 8', 'NGC 6523'], type: 'emission-nebula', pos: 'M 8', dist: S(Z), summary: 'Large emission nebula and star-forming region in Sagittarius, ionised by the young cluster NGC 6530.', sizePc: null },
  { id: 'm17', name: 'Omega Nebula', aliases: ['M 17', 'Swan Nebula', 'NGC 6618'], type: 'emission-nebula', pos: 'NGC  6618', dist: S(Z), summary: 'Bright HII region in Sagittarius, one of the most active star-forming regions of the Milky Way.', sizePc: null },
  { id: 'm20', name: 'Trifid Nebula', aliases: ['M 20', 'NGC 6514'], type: 'emission-nebula', pos: 'M 20', dist: S(Z), summary: 'Star-forming nebula in Sagittarius combining an emission nebula, a reflection nebula and dark dust lanes that split it into three lobes.', sizePc: null },
  { id: 'carina-nebula', name: 'Carina Nebula', aliases: ['NGC 3372', 'Eta Carinae Nebula'], type: 'emission-nebula', pos: 'NGC  3372', dist: S(K), summary: 'One of the largest and brightest star-forming nebulae in the sky, containing the massive star Eta Carinae and the young clusters Trumpler 14 and 16.', sizePc: null },
  { id: 'rosette-nebula', name: 'Rosette Nebula', aliases: ['NGC 2237', 'Caldwell 49'], type: 'emission-nebula', pos: 'NAME Rosette Nebula', dist: S(K), summary: 'Large circular HII region in Monoceros, ionised by the open cluster NGC 2244.', sizePc: null },
  { id: 'ngc7000', name: 'North America Nebula', aliases: ['NGC 7000', 'Caldwell 20'], type: 'emission-nebula', pos: 'NGC  7000', dist: S(Z), summary: 'Large emission nebula in Cygnus whose outline resembles the North American continent.', sizePc: null },
  { id: 'horsehead-nebula', name: 'Horsehead Nebula', aliases: ['Barnard 33', 'IC 434 (backdrop)'], type: 'dark-nebula', pos: 'NAME Horsehead Nebula', dist: M(400, null, null, 'approximate: Orion B molecular cloud distance (literature range ~350–450 pc)', 'illustrative', 'no precise individual distance; value illustrative'), summary: 'A pillar of cold dust and gas silhouetted against the emission nebula IC 434 in Orion.', sizePc: null },
  { id: 'm57', name: 'Ring Nebula', aliases: ['M 57', 'NGC 6720'], type: 'planetary-nebula', pos: 'M 57', dist: S('2020yCat.1350....0G'), summary: 'Planetary nebula in Lyra: the glowing shell of gas shed by a dying Sun-like star.', sizePc: null },
  { id: 'helix-nebula', name: 'Helix Nebula', aliases: ['NGC 7293', 'Caldwell 63'], type: 'planetary-nebula', pos: 'NGC  7293', dist: S('2020yCat.1350....0G'), summary: 'One of the nearest planetary nebulae to the Sun, in Aquarius.', sizePc: null },
  { id: 'm1', name: 'Crab Nebula', aliases: ['M 1', 'NGC 1952', 'Taurus A'], type: 'supernova-remnant', pos: 'M 1', dist: M(2000, null, null, 'literature estimate ~2 kpc (Trimble 1973), uncertainty not given', 'bibcode:1973PASP...85..579T', 'distance only approximately known; commonly quoted 1.7–2.2 kpc'), summary: 'Remnant of the supernova recorded in 1054 CE, powered by the Crab pulsar at its centre.', sizePc: null },
  { id: 'crab-pulsar', name: 'Crab Pulsar', aliases: ['PSR J0534+2200', 'PSR B0531+21'], type: 'pulsar', pos: 'PSR J0534+2200', dist: M(2000, null, null, 'associated with the Crab Nebula (~2 kpc)', 'bibcode:1973PASP...85..579T', null), summary: 'Neutron star left by the 1054 CE supernova, spinning about 30 times per second.', sizePc: null },
  // star-forming regions
  { id: 'cygnus-x', name: 'Cygnus X', aliases: ['Cyg X'], type: 'star-forming-region', pos: 'NAME Cygnus X', dist: M(1400, 70, 80, 'maser trigonometric parallax', 'bibcode:2012A&A...539A..79R', 'Rygl et al. 2012: 1.40 (+0.08, -0.07) kpc; not machine-verified'), summary: 'One of the most massive star-forming complexes within 2 kpc of the Sun, containing the Cygnus OB2 association.', sizePc: null },
  { id: 'w49a', name: 'W49A', aliases: ['W 49'], type: 'star-forming-region', pos: [287.5559, 9.0990], dist: M(11100, 500, 600, 'water-maser trigonometric parallax', 'bibcode:2013ApJ...775...79Z', 'Zhang et al. 2013: 11.1 (+0.6, -0.5) kpc; not machine-verified'), summary: 'One of the most luminous star-forming regions of the Milky Way, on the far side of the Galaxy.', sizePc: null },
  { id: 'sgr-b2', name: 'Sagittarius B2', aliases: ['Sgr B2'], type: 'star-forming-region', pos: 'NAME Sgr B2', dist: M(8340, 160, 160, 'maser trigonometric parallax', 'bibcode:2009ApJ...705.1548R', 'Reid et al. 2009: 8.34 ± 0.16 kpc; not machine-verified'), summary: 'The most massive and active molecular-cloud complex near the Galactic Centre, about 100 pc from Sgr A* in projection.', sizePc: null },
  // open clusters
  { id: 'pleiades', name: 'Pleiades', aliases: ['M 45', 'Seven Sisters', 'Melotte 22'], type: 'open-cluster', pos: 'Cl Melotte   22', dist: H('Melotte_22'), summary: 'The nearest rich open cluster, about 100 million years old, with several hundred stars and a reflection nebula around its brightest members.', sizePc: null },
  { id: 'hyades', name: 'Hyades', aliases: ['Melotte 25', 'Caldwell 41'], type: 'open-cluster', pos: 'Cl Melotte   25', dist: H('Melotte_25'), summary: 'The nearest open cluster to the Sun, in Taurus, roughly 600–700 million years old.', sizePc: null },
  { id: 'praesepe', name: 'Beehive Cluster', aliases: ['M 44', 'NGC 2632', 'Praesepe'], type: 'open-cluster', pos: 'NGC  2632', dist: H('NGC_2632'), summary: 'Rich open cluster in Cancer, similar in age to the Hyades.', sizePc: null },
  { id: 'westerlund-1', name: 'Westerlund 1', aliases: ['Wd 1'], type: 'open-cluster', pos: 'Cl Westerlund    1', dist: M(4050, 200, 200, 'Gaia EDR3 parallaxes + eclipsing binary W36 (weighted mean)', 'arxiv:2204.09414', 'Navarete et al. 2022: d = 4.05 ± 0.20 kpc'), summary: 'One of the most massive young star clusters known in the Milky Way, heavily obscured by dust in Ara.', sizePc: null },
  { id: 'arches-cluster', name: 'Arches Cluster', aliases: [], type: 'open-cluster', pos: 'NAME Arches Cluster', dist: M(R0_PC, null, null, 'assumed at the Galactic Centre distance (R0, GRAVITY 2024); true line-of-sight offset unknown', 'bibcode:2024A&A...692A.242G', 'lies ~26 pc in projection from Sgr A*'), summary: 'Dense young massive star cluster in the Galactic Centre region, rich in very massive stars.', sizePc: null },
  { id: 'quintuplet-cluster', name: 'Quintuplet Cluster', aliases: [], type: 'open-cluster', pos: 'NAME Quintuplet Cluster', dist: M(R0_PC, null, null, 'assumed at the Galactic Centre distance (R0, GRAVITY 2024); true line-of-sight offset unknown', 'bibcode:2024A&A...692A.242G', null), summary: 'Young massive star cluster in the Galactic Centre region, near the Arches Cluster.', sizePc: null },
  // stellar-mass black holes
  { id: 'cygnus-x1', name: 'Cygnus X-1', aliases: ['V1357 Cyg', 'HDE 226868'], type: 'black-hole', pos: 'V* V1357 Cyg', dist: M(2220, 170, 180, 'radio VLBA trigonometric parallax', 'arxiv:2102.09091', 'Miller-Jones et al. 2021: 2.22 (+0.18, -0.17) kpc; black hole mass 21.2 ± 2.2 Msun'), massMsun: { value: 21.2, err: 2.2, ref: 'arxiv:2102.09091' }, summary: 'The first X-ray source widely accepted to be a black hole: a 21-solar-mass black hole orbiting a blue supergiant.', sizePc: null },
  { id: 'gaia-bh1', name: 'Gaia BH1', aliases: ['Gaia DR3 4373465352415301632'], type: 'black-hole', pos: 'Gaia DR3 4373465352415301632', dist: M(480, null, null, 'Gaia astrometric orbit / parallax', 'arxiv:2209.06833', 'El-Badry et al. 2023: d = 480 pc; error not quoted in the abstract'), massMsun: { value: 9.62, err: 0.18, ref: 'arxiv:2209.06833' }, summary: 'A dormant black hole of about 9.6 solar masses orbiting a Sun-like star, discovered with Gaia; the nearest known black hole at the time of its discovery.', sizePc: null },
  { id: 'gaia-bh2', name: 'Gaia BH2', aliases: ['Gaia DR3 5870569352746779008'], type: 'black-hole', pos: 'Gaia DR3 5870569352746779008', dist: M(1160, null, null, 'Gaia astrometric orbit / parallax', 'arxiv:2302.07880', 'El-Badry et al. 2023: d = 1.16 kpc'), summary: 'A dormant black hole orbiting a red giant, found from Gaia astrometry.', sizePc: null },
  { id: 'gaia-bh3', name: 'Gaia BH3', aliases: ['Gaia DR3 4318465066420528000'], type: 'black-hole', pos: 'Gaia DR3 4318465066420528000', dist: M(590, null, null, 'Gaia astrometric orbit / parallax', 'arxiv:2404.10486', 'Gaia Collaboration 2024: d = 590 pc'), summary: 'A dormant black hole of about 33 solar masses, the most massive stellar-origin black hole known in the Milky Way at its discovery, orbiting a metal-poor halo giant.', sizePc: null },
  { id: 'v404-cygni', name: 'V404 Cygni', aliases: ['GS 2023+338'], type: 'black-hole', pos: 'V* V404 Cyg', dist: M(2390, 140, 140, 'radio VLBA trigonometric parallax', 'bibcode:2009ApJ...706L.230M', 'Miller-Jones et al. 2009: 2.39 ± 0.14 kpc; not machine-verified'), summary: 'A low-mass X-ray binary hosting a black hole of roughly nine solar masses, known for violent outbursts.', sizePc: null },
];

// ------------------------------------------------------------------ SIMBAD (positions + preferred distances)
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const simbadIds = [...new Set(OBJ.filter((o) => typeof o.pos === 'string').map((o) => o.pos))];
const sq = `SELECT i.id AS qid, b.main_id, b.ra, b.dec, b.otype, d.dist, d.unit, d.minus_err, d.plus_err, d.method, d.bibcode FROM ident AS i JOIN basic AS b ON i.oidref=b.oid LEFT JOIN mesDistance AS d ON d.oidref=b.oid WHERE i.id IN (${simbadIds.map((s) => `'${s}'`).join(',')})`;
const sres = await tapQuery(SIMBAD_TAP, sq, 'simbad/landmarks_curated.json');
const sRows = rowsToObjects(sres).map((o) => ({ ...o, qid: norm(o.qid) }));
const unit2pc = { pc: 1, kpc: 1000, Mpc: 1e6 };

const out = [];
for (const o of OBJ) {
  let ra, dec, mainId = null, otype = null;
  if (typeof o.pos === 'string') {
    const rows = sRows.filter((r) => r.qid === norm(o.pos));
    if (!rows.length) fail(`SIMBAD has no ${o.pos} (${o.id})`);
    ra = rows[0].ra; dec = rows[0].dec; mainId = rows[0].main_id.replace(/\s+/g, ' '); otype = rows[0].otype;
  } else { [ra, dec] = o.pos; }
  let d; // {pc, minus, plus, method, ref, note}
  if (o.dist.mode === 'simbad') {
    const row = sRows.find((r) => r.qid === norm(o.pos) && r.bibcode === o.dist.bib && r.dist != null);
    if (!row) fail(`SIMBAD mesDistance row ${o.dist.bib} not found for ${o.id}`);
    const f = unit2pc[row.unit.trim()]; if (!f) fail(`unit ${row.unit}`);
    d = { pc: row.dist * f, minus: row.minus_err != null ? -row.minus_err * f : null, plus: row.plus_err != null ? row.plus_err * f : null, method: `SIMBAD mesDistance (${(row.method ?? 'literature').trim() || 'literature'})`, ref: `bibcode:${row.bibcode}`, note: null };
  } else if (o.dist.mode === 'hr23') {
    const r = await vizierTsv({ '-source': 'J/A+A/673/A114/clusters', Name: o.dist.name, '-out': 'Name,dist16,dist50,dist84,Ndist,r50pc', '-out.max': '2' }, `vizier/hr23/q_${o.dist.name}.tsv`);
    const row = r.rows.find((x) => x.Name === o.dist.name); if (!row) fail(`HR23 lacks ${o.dist.name}`);
    const p50 = +row.dist50;
    d = { pc: p50, minus: p50 - +row.dist16, plus: +row.dist84 - p50, method: `Gaia DR3 maximum-likelihood distance, Hunt & Reffert 2023 (${row.Ndist} stars; statistical errors only)`, ref: 'bibcode:2023A&A...673A.114H', note: null };
    o.sizePc = round(+row.r50pc, 2); o.sizeNote = 'radius containing 50% of members (Hunt & Reffert 2023)';
  } else d = o.dist;
  const gal = icrsToGalactic(ra, dec);
  const errs = [d.minus, d.plus].filter((x) => x != null).map(Math.abs);
  out.push({
    id: o.id, name: o.name, aliases: o.aliases, type: o.type, simbadMainId: mainId,
    raDeg: sig(ra, 9), decDeg: sig(dec, 9), lDeg: round(gal.l, 4), bDeg: round(gal.b, 4),
    distPc: sig(d.pc, 6), distErrPc: errs.length ? sig(errs.reduce((a, b) => a + b, 0) / errs.length, 3) : null,
    distErrMinusPc: d.minus != null ? sig(Math.abs(d.minus), 3) : null, distErrPlusPc: d.plus != null ? sig(d.plus, 3) : null,
    distMethod: d.method, distRef: d.ref, distNote: d.note ?? null,
    xyzHelioPc: helioGalXYZ(ra, dec, d.pc).map((x) => round(x, 1)),
    sizePc: o.sizePc ?? null, sizeNote: o.sizeNote ?? null, massMsun: o.massMsun ?? null,
    summary: o.summary, source: 'position: SIMBAD (CDS) ICRS J2000' + (typeof o.pos === 'string' ? '' : ' / literature'), provenanceClass: 'observed',
  });
}

// ------------------------------------------------------------------ globular clusters: Harris 1996 (2010) + Baumgardt & Vasiliev 2021
const HARRIS_URL = 'https://physwww.mcmaster.ca/~harris/mwgc.dat';
const harris = (await cached('harris/mwgc.dat', HARRIS_URL)).text.split(/\r?\n/);
const iI = harris.findIndex((l) => l.includes('Part I:')), iII = harris.findIndex((l) => l.includes('Part II:')), iIII = harris.findIndex((l) => l.includes('Part III:'));
const sx = (s, isRa) => { const [a, b, c] = s.map(Number); const sign = (s[0].trim().startsWith('-') ? -1 : 1); const v = Math.abs(a) + b / 60 + c / 3600; return isRa ? v * 15 : sign * v; };
const gcs = new Map();
for (const line of harris.slice(iI, iII)) {
  const t = line.trim().split(/\s+/);
  if (t.length < 14 || !/^\d{2}$/.test(t[t.length - 13]) || !/^[-+]?\d{2}$/.test(t[t.length - 10])) continue;
  const tail = t.slice(-13);
  const idStr = line.slice(0, 11).trim();
  const head = line.trim().slice(0).split(/\s+/).slice(0, t.length - 13).join(' ');
  const nm = head.startsWith(idStr) ? head.slice(idStr.length).trim() : head;
  const [rh, rm, rs, dd, dm, ds, L, B, Rs, Rg, X, Y, Z2] = tail;
  gcs.set(idStr, { id: idStr, name: nm || null, ra: sx([rh, rm, rs], true), dec: sx([dd, dm, ds], false), l: +L, b: +B, rSunKpc: +Rs, rGcKpc: +Rg });
}
for (const line of harris.slice(iII, iIII)) {
  const id = line.slice(0, 11).trim(); const g = gcs.get(id); if (!g) continue;
  const t = line.slice(11).trim().split(/\s+/); if (t.length && /^-?\d/.test(t[0])) g.feh = +t[0];
}
if (gcs.size !== 157) fail(`expected 157 Harris clusters, got ${gcs.size}`);
// Baumgardt & Vasiliev 2021
const bvTxt = (await cached('baumgardt/orbits_table.txt', 'https://people.smp.uq.edu.au/HolgerBaumgardt/globular/orbits_table.txt')).text.split(/\r?\n/).filter((l) => l && !l.startsWith('#'));
const key = (s) => s.toLowerCase().replace(/[\s_]+/g, '');
const bv = new Map();
for (const l of bvTxt) { const t = l.trim().split(/\s+/); bv.set(key(t[0]), { name: t[0], ra: +t[1], dec: +t[2], rSun: +t[5], dR: +t[6] }); }
let nBv = 0; const unmatched = [];
for (const g of gcs.values()) {
  const b = bv.get(key(g.id)) ?? bv.get(key((g.name ?? '').split(/\s+/)[0] ?? ''));
  const gal = icrsToGalactic(g.ra, g.dec);
  let distPc = g.rSunKpc * 1000, err = null, method = 'Harris 1996 (2010 edition) distance (typically ±~10%; no individual error published)', ref = 'bibcode:1996AJ....112.1487H';
  if (b && Number.isFinite(b.rSun)) { distPc = b.rSun * 1000; err = b.dR * 1000; method = 'Baumgardt & Vasiliev 2021: mean of HST/Gaia/literature distance measurements'; ref = 'bibcode:2021MNRAS.505.5957B'; nBv++; if (Math.abs(b.rSun - g.rSunKpc) > Math.max(0.35 * g.rSunKpc, 1.0)) log('WARN large Harris/BV distance difference', g.id, g.rSunKpc, b.rSun); }
  else unmatched.push(g.id);
  out.push({
    id: 'gc-' + g.id.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name: g.name ? `${g.id} (${g.name})` : g.id, aliases: g.name ? [g.name] : [], type: 'globular-cluster', simbadMainId: null,
    raDeg: round(g.ra, 5), decDeg: round(g.dec, 5), lDeg: round(gal.l, 4), bDeg: round(gal.b, 4),
    distPc: sig(distPc, 5), distErrPc: err != null ? sig(err, 3) : null, distErrMinusPc: err != null ? sig(err, 3) : null, distErrPlusPc: err != null ? sig(err, 3) : null,
    distMethod: method, distRef: ref, distNote: b ? `Harris 2010: ${g.rSunKpc} kpc` : null,
    xyzHelioPc: helioGalXYZ(g.ra, g.dec, distPc).map((x) => round(x, 1)),
    sizePc: null, sizeNote: null, massMsun: null, metallicityFeH: g.feh ?? null,
    summary: `Globular cluster${g.feh != null ? ` with [Fe/H] = ${g.feh}` : ''}, ${(distPc / 1000).toFixed(1)} kpc from the Sun and ${g.rGcKpc} kpc from the Galactic Centre (Harris, R0 = 8.0 kpc).`,
    source: 'position, [Fe/H]: Harris 1996 (2010 edition) via McMaster; distance: ' + (b ? 'Baumgardt & Vasiliev 2021' : 'Harris 1996'), provenanceClass: 'observed',
  });
}
log('Harris GCs', gcs.size, 'with BV21 distance', nBv, 'unmatched:', unmatched.join(', '));

// ------------------------------------------------------------------ checks (published values)
const byId = Object.fromEntries(out.map((x) => [x.id, x]));
const expect = (id, lo, hi) => { const d = byId[id]?.distPc; if (!(d >= lo && d <= hi)) fail(`sanity: ${id} dist ${d} not in [${lo},${hi}]`); };
expect('gc-ngc-104', 4300, 4700); expect('gc-ngc-5139', 5000, 5600); expect('pleiades', 130, 140); expect('hyades', 45, 49); expect('m42', 380, 520); expect('sgr-a-star', 8200, 8350);
expect('gc-ngc-6397', 2000, 2800);
if (Math.abs(byId['m1'].raDeg - 83.63) > 0.05) fail('M1 position');

const doc = {
  schemaVersion: 1, generated: nowIso(), domain: 'galactic', dataset: 'landmarks', count: out.length,
  frames: 'raDeg/decDeg: ICRS J2000 (SIMBAD) or FK5 J2000 (Harris); lDeg/bDeg: Galactic from the Hipparcos matrix; xyzHelioPc: Sun-centred Galactic Cartesian (x toward GC, y toward l=90°, z toward NGP), pc',
  distanceNote: 'distErrPc is the mean of the minus/plus errors; null where the source gives none. SIMBAD/HR23/BV21 distances are statistical-error-only; zero-point systematics (e.g. Gaia ~0.01–0.02 mas) are not included.',
  objects: out,
};
doc.references = refsFor(['harris1996', 'baumgardtVasiliev2021', 'huntReffert2023', 'kuhn2019', 'simbad', 'vizier', 'gravity2024']);
const r = writeOut('landmarks.json', doc);
log('landmarks.json', r.bytes, 'B,', out.length, 'objects');
