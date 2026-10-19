// Local galaxies (<= ~11 Mpc +): Karachentsev et al. 2013 Updated Nearby Galaxy Catalog (VizieR J/AJ/145/101).
// Output: public/data/galaxies/local.json  (see docs/data/galaxies.md)
import { fetchTextCached, parseVizierTsv, vizierAsuUrl, num, str, round, writeOut, writeMeta, stringifyTableJson, isoNow, log, fail } from './lib.mjs';

const T1 = ['Name', 'a26', 'Bmag', 'Kmag', 'W50', 'TT', 'Mcl', 'Tdw', 'HRV', 'Dist', 'A26', 'i', 'M26', 'MHI', 'l_MHI', 'Vlg', 'Ti1', 'f_Dist', 'MD', 'SimbadName', 'NEDname'];
const u1 = vizierAsuUrl('J/AJ/145/101/catalog', T1);
const r1 = await fetchTextCached(u1, 'ungc/catalog.tsv', { describeBody: 'ASU catalog' });
const t1 = parseVizierTsv(r1.text, 'UNGC');
// table6: per-object distance-modulus measurements (DM, e_DM, method n_DM); pick the one matching the adopted Dist.
const u6 = vizierAsuUrl('J/AJ/145/101/table6', ['Name', 'DM', 'e_DM', 'n_DM'], { withRaDe: false });
const r6 = await fetchTextCached(u6, 'ungc/table6.tsv', { describeBody: 'ASU table6' });
const t6 = parseVizierTsv(r6.text, 'UNGC-T6');
const dmBy = new Map();
for (const r of t6.rows) { const k = r.Name.trim(); if (!dmBy.has(k)) dmBy.set(k, []); dmBy.get(k).push({ dm: num(r.DM), e: num(r.e_DM) }); }
log('rows', t1.rows.length);
const fields = ['name', 'aliases', 'raDeg', 'decDeg', 'distMpc', 'morphology', 'tType', 'majorAxisArcmin', 'majorAxisKpc', 'inclinationDeg', 'distErrMpc', 'distMethod', 'mainDisturber',
  'absMagB', 'logMstarMsun', 'logMHIMsun', 'logMHolmbergMsun', 'vHelioKms', 'vLgKms', 'bMag', 'kMag', 'tidalIndex', 'w50Kms'];
const pretty = (n) => n.replace(/^MESSIER0*(\d+)$/, 'M$1').replace(/^(NGC|IC)0*(\d+)$/, '$1 $2').replace(/^(UGC|UGCA|ESO)(\d)/, '$1 $2');
const rows = [];
const ttMorph = (t) => (t == null ? null : t <= -4 ? "E" : t <= -1 ? "S0" : t <= 9 ? "S" : "Irr"); // coarse fallback when Mcl is blank
for (const r of t1.rows) {
  const ra = num(r._RAJ2000), de = num(r._DEJ2000), d = num(r.Dist);
  if (ra == null || de == null || d == null) continue;
  const dm = 5 * Math.log10(d * 1e5);
  const B = num(r.Bmag), K = num(r.Kmag);
  const nm = r.Name.trim(), pn = pretty(nm);
  let derr = null;
  { const c = (dmBy.get(nm) || []).filter((x) => x.dm != null && x.e != null).map((x) => ({ ...x, dd: Math.abs(10 ** ((x.dm - 25) / 5) - d) })).sort((a, b) => a.dd - b.dd)[0];
    if (c && c.dd < 0.06 * d + 0.01) derr = round(d * Math.LN10 / 5 * c.e, 3); }
  const al = [nm, r.SimbadName, r.NEDname].map(str).filter((x) => x && x !== pn);
  const lk = K != null ? -0.4 * (K - dm - 3.28) : null; // log10 L_K / Lsun (no extinction correction)
  const mhi = r.l_MHI ? null : num(r.MHI);
  rows.push([pn, [...new Set(al)], round(ra, 5), round(de, 5), d, str(r.Mcl) ?? ttMorph(num(r.TT)), num(r.TT), num(r.a26), num(r.A26), num(r.i), derr, str(r.f_Dist), str(r.MD),
    B != null ? round(B - dm, 2) : null, lk != null ? round(lk + Math.log10(0.6), 2) : null, mhi, num(r.M26), (nm === "Milky Way" ? null : num(r.HRV)), num(r.Vlg), B, K, num(r.Ti1), num(r.W50)]);
}
if (rows.length < 800) fail('too few rows ' + rows.length);
const out = { schemaVersion: 1, generated: isoNow(), source: 'Karachentsev et al. 2013, AJ 145, 101 (VizieR J/AJ/145/101, tables 1+2)',
  epoch: 'J2000 (ICRS-compatible)', fields, rows };
const w = writeOut('local.json', stringifyTableJson(out));
writeMeta('ungc', { retrieved: isoNow(), urls: [u1], rows: rows.length, bytes: w.bytes });
log('wrote', w.rel, rows.length, w.bytes);
