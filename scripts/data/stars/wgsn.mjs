// Parser for the IAU Working Group on Star Names (WGSN) "IAU Catalog of Star Names" (IAU-CSN).
//
// Current list: https://exopla.net/star-names/modern-iau-star-names/ (the URL the IAU links to
// for the catalogue). It is published only as a server-rendered HTML table (wpDataTables
// "table_1"); the site's CSV/Excel buttons are generated client-side from that same table, and
// no server-side machine-readable file exists for the live list. We therefore read the <table>
// element (header names are checked so a layout change fails loudly).
//
// Fallback: the last machine-readable text edition (IAU-CSN.txt, "Last updated 2022-04-04").

import { stripTags, fail } from './lib.mjs';

const EXPECTED_HEADERS = ['proper names', 'Designation', 'HIP', 'Bayer ID', 'Constellation', 'Date of Adoption', 'RA', 'DEC', 'mag'];

function numOrNull(s) {
  if (s == null) return null;
  const t = String(s).trim();
  if (t === '' || t === '_' || t === '-') return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function strOrNull(s) {
  if (s == null) return null;
  const t = String(s).trim();
  return t === '' || t === '_' ? null : t;
}

/** Normalise a WGSN designation into catalogue keys we can match against HYG. */
export function designationKeys(designation) {
  const keys = {};
  if (!designation) return keys;
  const d = designation.replace(/\s+/g, ' ').trim();
  let m;
  if ((m = /^HR\s*(\d+)/i.exec(d))) keys.hr = Number(m[1]);
  if ((m = /^HD\s*(\d+)/i.exec(d))) keys.hd = Number(m[1]);
  if ((m = /^HIP\s*(\d+)/i.exec(d))) keys.hip = Number(m[1]);
  if ((m = /^(GJ|Gl|Gliese)\s*([0-9]+(?:\.[0-9]+)?)\s*([A-Z]*)/i.exec(d))) keys.gj = `${m[2]}${m[3] || ''}`.toUpperCase();
  return keys;
}

/**
 * Parse the current IAU-CSN HTML page.
 * Returns [{ name, designation, hip, bayer, con, raDeg, decDeg, mag, band, adopted }].
 */
export function parseWgsnHtml(html) {
  const start = html.search(/<table[^>]+id=["']table_1["']/);
  if (start < 0) fail('WGSN page: <table id="table_1"> not found - page layout changed.');
  const end = html.indexOf('</table>', start);
  const table = html.slice(start, end);
  const theadEnd = table.indexOf('</thead>');
  if (theadEnd < 0) fail('WGSN page: table header not found.');
  const headers = [...table.slice(0, theadEnd).matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/g)].map((m) => stripTags(m[1]));
  for (const h of EXPECTED_HEADERS) {
    if (!headers.includes(h)) fail(`WGSN page: expected column "${h}" missing; got [${headers.join(', ')}]`);
  }
  const col = Object.fromEntries(headers.map((h, i) => [h, i]));
  // Only <tbody> rows: the table also repeats its header row in <tfoot>.
  const tbStart = table.indexOf('<tbody', theadEnd);
  const tbEnd = table.indexOf('</tbody>', tbStart);
  if (tbStart < 0 || tbEnd < 0) fail('WGSN page: <tbody> not found.');
  const body = table.slice(tbStart, tbEnd);
  const rows = body.split(/<tr\b/).slice(1);
  const out = [];
  for (const r of rows) {
    const cells = [...r.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((m) => stripTags(m[1]));
    if (cells.length < headers.length) continue; // e.g. empty/footer rows
    const name = strOrNull(cells[col['proper names']]);
    if (!name) continue;
    const hipRaw = numOrNull(cells[col['HIP']]);
    out.push({
      name,
      designation: strOrNull(cells[col['Designation']]),
      hip: hipRaw != null && hipRaw > 0 ? Math.trunc(hipRaw) : null,
      bayer: strOrNull(cells[col['Bayer ID']]),
      con: strOrNull(cells[col['Constellation']]),
      raDeg: numOrNull(cells[col['RA']]),
      decDeg: numOrNull(cells[col['DEC']]),
      mag: numOrNull(cells[col['mag']]),
      band: col['band'] != null ? strOrNull(cells[col['band']]) : null,
      adopted: strOrNull(cells[col['Date of Adoption']])?.replace(/\//g, '-') ?? null,
    });
  }
  if (out.length < 400) fail(`WGSN page: only ${out.length} names parsed (expected >= 400) - layout changed?`);
  return out;
}

/**
 * Parse the legacy fixed-format IAU-CSN.txt (2022-04-04). Columns are tokenised from the right
 * because the name/designation columns may contain spaces.
 */
export function parseWgsnLegacyTxt(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#') || line.startsWith('$')) continue;
    const dm = /\s(\d{4}-\d{2}-\d{2})(?:\s|$)/.exec(line);
    if (!dm) continue;
    const date = dm[1];
    const before = line.slice(18, dm.index); // after the 18-char ASCII name column
    const tokens = before.trim().split(/\s+/);
    if (tokens.length < 13) continue;
    // Last 11 tokens: ID ID Con # WDS_J mag bnd HIP HD RA Dec (never contain spaces; "_" = empty)
    const fixed = tokens.slice(-11);
    const [id1, id2, con, , , mag, band, hip, , ra, dec] = fixed;
    // Remaining prefix = "<Name/Diacritics>   <Designation>" separated by >= 2 spaces.
    let prefix = before.trim();
    for (let k = 0; k < 11; k++) prefix = prefix.replace(/\s+\S+$/, '');
    const parts = prefix.trim().split(/\s{2,}/);
    const designation = parts.length > 1 ? parts.at(-1) : null;
    let bayer = null;
    if (id2 && id2 !== '_') bayer = id2;
    else if (id1 && id1 !== '_') bayer = id1;
    out.push({
      name: (parts[0] || line.slice(0, 18)).trim(),
      designation,
      hip: numOrNull(hip),
      bayer,
      con: strOrNull(con),
      raDeg: numOrNull(ra),
      decDeg: numOrNull(dec),
      mag: numOrNull(mag),
      band: strOrNull(band),
      adopted: date,
    });
  }
  if (out.length < 300) fail(`IAU-CSN legacy txt: only ${out.length} rows parsed.`);
  return out;
}
