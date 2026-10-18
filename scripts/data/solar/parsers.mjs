// Source-specific parsers for the solar domain. Each parser works on raw text
// cached under data-raw/solar/ and fails loudly (DataError) when the upstream
// layout no longer matches what the parser expects.
//
// Parsing HTML is used ONLY for official JPL SSD / NSSDCA reference tables that
// have no machine-readable (API / text) equivalent as of 2026-10-16. The NAIF
// SPICE text kernels are parsed with a minimal SPICE text-kernel reader.

import { DataError, assert, num } from './lib.mjs';

// ---------------------------------------------------------------- HTML helpers
const ENTITIES = {
  nbsp: ' ', plusmn: '±', times: '×', deg: '°', lt: '<', gt: '>', amp: '&', quot: '"', apos: "'",
  mdash: '—', ndash: '–', minus: '-', omega: 'ω', Omega: 'Ω', dagger: '†', micro: 'µ', mu: 'µ',
  rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', hellip: '…', prime: '′', Prime: '″', middot: '·',
  straightphi: 'φ', lambda: 'λ', rho: 'ρ', alpha: 'α', delta: 'δ', beta: 'β', sim: '~', asymp: '≈',
};

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => (n in ENTITIES ? ENTITIES[n] : m));
}

/** Strip HTML to plain text: <sub>x</sub> -> x, <sup>x</sup> -> ^x, cells -> ' | ', rows/blocks -> '\n'. */
export function htmlToText(html) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<sub>\s*([\s\S]*?)\s*<\/sub>/gi, '$1')
      .replace(/<sup>\s*([\s\S]*?)\s*<\/sup>/gi, '^$1')
      .replace(/<\/(td|th)>/gi, ' | ')
      .replace(/<(br|\/tr|\/p|\/div|\/li|\/h\d|\/pre|\/table|tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{2,}/g, '\n');
}

/** Cell HTML -> trimmed text (sub/sup handled, whitespace collapsed). */
export function cellText(html) {
  return decodeEntities(
    html
      .replace(/<sub>\s*([\s\S]*?)\s*<\/sub>/gi, '$1')
      .replace(/<sup>\s*([\s\S]*?)\s*<\/sup>/gi, '^$1')
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[\s ]+/g, ' ')
    .trim();
}

/**
 * Parse all (non-nested) HTML tables into arrays of rows of cell texts.
 * Tolerates unclosed <td> elements (cells are split at each <td/<th start tag).
 * @returns {{attrs:string, rows:string[][]}[]}
 */
export function parseHtmlTables(html) {
  const tables = [];
  const re = /<table\b([^>]*)>([\s\S]*?)<\/table>/gi;
  let m;
  while ((m = re.exec(html))) {
    const body = m[2];
    const rows = [];
    for (const rowChunk of body.split(/<tr\b[^>]*>/i).slice(1)) {
      const rowHtml = rowChunk.split(/<\/tr>/i)[0];
      const parts = rowHtml.split(/<t[dh]\b/i).slice(1);
      const cells = parts.map((p) => cellText(p.slice(p.indexOf('>') + 1).replace(/<\/t[dh]>[\s\S]*$/i, '')));
      if (cells.length) rows.push(cells);
    }
    tables.push({ attrs: m[1], rows });
  }
  return tables;
}

/** Parse "value [REF] ±sigma" cells used by the JPL SSD planets phys_par page. */
export function parseValueRefSigma(cell) {
  const s = cell.replace(/,/g, '');
  const vm = s.match(/^\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
  const rm = s.match(/\[\s*([^\]]+?)\s*\]/);
  const sm = s.match(/±\s*([-+]?\d*\.?\d+(?:[eE][-+]?\d+)?)/);
  return { value: vm ? num(vm[1]) : null, ref: rm ? rm[1] : null, sigma: sm ? num(sm[1]) : null };
}

// ---------------------------------------------------------------- SPICE text kernel
/**
 * Minimal SPICE text-kernel parser: reads only \begindata ... \begintext blocks.
 * Supports NAME = value, NAME = ( v1 v2 ... ), NAME += (...), D/E exponents, quoted strings.
 * @returns {Map<string, (number|string)[]>}
 */
export function parseSpiceKernel(text) {
  const lines = text.split(/\r?\n/);
  let inData = false;
  const data = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === '\\begindata') { inData = true; continue; }
    if (t === '\\begintext') { inData = false; continue; }
    if (inData) data.push(line);
  }
  const src = data.join('\n');
  const out = new Map();
  const re = /([A-Za-z0-9_]+)\s*(\+?=)\s*(\([\s\S]*?\)|'[^']*'|[^\s()]+)/g;
  let m;
  while ((m = re.exec(src))) {
    const [, name, op, rawVal] = m;
    let vals;
    if (rawVal.startsWith('(')) {
      const inner = rawVal.slice(1, -1);
      vals = [];
      const tokRe = /'([^']*)'|([^\s,]+)/g;
      let t;
      while ((t = tokRe.exec(inner))) vals.push(t[1] !== undefined ? t[1] : spiceNum(t[2]));
    } else if (rawVal.startsWith("'")) {
      vals = [rawVal.slice(1, -1)];
    } else {
      vals = [spiceNum(rawVal)];
    }
    if (op === '+=' && out.has(name)) out.set(name, out.get(name).concat(vals));
    else out.set(name, vals);
  }
  assert(out.size > 0, 'SPICE kernel contained no \\begindata assignments');
  return out;
}

function spiceNum(tok) {
  const n = Number(String(tok).replace(/[dD]/, 'E'));
  if (!Number.isFinite(n)) throw new DataError(`Bad numeric token in SPICE kernel: "${tok}"`);
  return n;
}

/**
 * Extract IAU rotation elements for a NAIF body from a parsed PCK map.
 * Returns null when the PCK has no POLE_RA for the body.
 */
export function pckRotation(pck, naifId) {
  const ra = pck.get(`BODY${naifId}_POLE_RA`);
  const dec = pck.get(`BODY${naifId}_POLE_DEC`);
  const pm = pck.get(`BODY${naifId}_PM`);
  if (!ra || !dec || !pm) return null;
  const nra = pck.get(`BODY${naifId}_NUT_PREC_RA`) ?? null;
  const ndec = pck.get(`BODY${naifId}_NUT_PREC_DEC`) ?? null;
  const npm = pck.get(`BODY${naifId}_NUT_PREC_PM`) ?? null;
  let periodic = null;
  const hasTerms = [nra, ndec, npm].some((a) => a && a.some((v) => v !== 0));
  if (hasTerms) {
    const sys = naifId >= 100 && naifId < 1000 ? Math.floor(naifId / 100) : null;
    assert(sys !== null, `periodic terms for unexpected body ${naifId}`);
    const flat = pck.get(`BODY${sys}_NUT_PREC_ANGLES`);
    assert(flat, `missing BODY${sys}_NUT_PREC_ANGLES for body ${naifId}`);
    const deg = (pck.get(`BODY${sys}_MAX_PHASE_DEGREE`) ?? [1])[0];
    const width = deg + 1;
    assert(flat.length % width === 0, `NUT_PREC_ANGLES length for system ${sys} not a multiple of ${width}`);
    const angles = [];
    for (let i = 0; i < flat.length; i += width) angles.push(flat.slice(i, i + width));
    const n = Math.max(nra?.length ?? 0, ndec?.length ?? 0, npm?.length ?? 0);
    assert(n <= angles.length, `body ${naifId}: more nut/prec coefficients (${n}) than angles (${angles.length})`);
    const pad = (a) => Array.from({ length: n }, (_, i) => (a && i < a.length ? a[i] : 0));
    // Keep only angles that are actually referenced by a non-zero coefficient.
    const used = [];
    const raS = pad(nra), decC = pad(ndec), wS = pad(npm);
    for (let i = 0; i < n; i++) if (raS[i] !== 0 || decC[i] !== 0 || wS[i] !== 0) used.push(i);
    periodic = {
      system: sys,
      angleNames: used.map((i) => `${sysLetter(sys)}${i + 1}`),
      anglesDeg: used.map((i) => angles[i]),
      raSinDeg: used.map((i) => raS[i]),
      decCosDeg: used.map((i) => decC[i]),
      wSinDeg: used.map((i) => wS[i]),
    };
  }
  return {
    poleRa: ra, // [deg, deg/century, deg/century^2]
    poleDec: dec, // [deg, deg/century, deg/century^2]
    pm: pm, // [deg, deg/day, deg/day^2]
    periodic,
  };
}

function sysLetter(sys) {
  return { 1: 'M', 3: 'E', 4: 'M', 5: 'J', 6: 'S', 7: 'U', 8: 'N' }[sys] ?? `S${sys}_`;
}

// ---------------------------------------------------------------- JPL SSD planets/phys_par
const PLANET_COLS = ['equatorialRadiusKm', 'meanRadiusKm', 'mass', 'densityGcm3', 'siderealRotationDays', 'siderealOrbitYears', 'v10Mag', 'geometricAlbedo', 'equatorialGravityMs2', 'escapeVelocityKms'];

/** @returns {Map<string, object>} keyed by lowercase body name; mass converted to kg. */
export function parseJplPlanetPhysPar(html) {
  const tables = parseHtmlTables(html).filter((t) => /planet-phys-par/.test(t.attrs));
  assert(tables.length === 2, `planets/phys_par: expected 2 tables (planets, dwarf planets), found ${tables.length}`);
  const out = new Map();
  for (const t of tables) {
    const header = t.rows.slice(0, 2).map((r) => r.join(' ')).join(' ');
    const em = header.match(/×10\^(\d+)\s*kg/);
    assert(em, `planets/phys_par: cannot find mass unit in header "${header.slice(0, 200)}"`);
    const massScale = 10 ** Number(em[1]);
    assert(/Equatorial Radius.*Mean Radius.*Mass.*Bulk Density.*Sidereal Rotation Period.*Sidereal Orbital Period.*V\(1,0\).*Geometric Albedo.*Equatorial Gravity.*Escape Velocity/s.test(header),
      `planets/phys_par: unexpected column order: ${header.slice(0, 300)}`);
    for (const row of t.rows.slice(2)) {
      if (row.length !== 11) continue;
      const name = row[0].trim();
      const rec = { name, massUnitKg: massScale };
      PLANET_COLS.forEach((k, i) => { rec[k] = parseValueRefSigma(row[i + 1]); });
      rec.massKg = rec.mass.value == null ? null : rec.mass.value * massScale;
      rec.massSigmaKg = rec.mass.sigma == null ? null : rec.mass.sigma * massScale;
      out.set(name.toLowerCase(), rec);
    }
  }
  assert(out.has('earth') && out.has('ceres') && out.has('makemake'), 'planets/phys_par: missing expected rows');
  return out;
}

// ---------------------------------------------------------------- JPL SSD sats/phys_par
/** @returns {Map<number, object>} keyed by NAIF code. */
export function parseJplSatPhysPar(html) {
  const t = parseHtmlTables(html).find((x) => /id="sat_phys_par"/.test(x.attrs));
  assert(t, 'sats/phys_par: table #sat_phys_par not found');
  const head = t.rows.slice(0, 2).map((r) => r.join(' ')).join(' ');
  assert(/GM.*Mean Radius.*Mean Density/.test(head), `sats/phys_par: unexpected header ${head}`);
  const out = new Map();
  for (const r of t.rows.slice(2)) {
    if (r.length < 12) continue;
    const code = num(r[2]);
    if (code == null) continue;
    out.set(code, {
      planet: r[0], name: r[1], code,
      gm: { value: num(r[3]), sigma: num(r[4]), ref: r[5] || null },
      meanRadiusKm: { value: num(r[6]), sigma: num(r[7]), ref: r[8] || null },
      densityGcm3: { value: num(r[9]), sigma: num(r[10]), ref: r[11] || null },
    });
  }
  assert(out.has(301) && out.has(606) && out.has(901), 'sats/phys_par: missing Moon/Titan/Charon');
  return out;
}

// ---------------------------------------------------------------- JPL SSD sats/elem
/** @returns {Map<number, object>} keyed by NAIF code. */
export function parseJplSatElem(html) {
  const t = parseHtmlTables(html).find((x) => /id="sat_elem"/.test(x.attrs));
  assert(t, 'sats/elem: table #sat_elem not found');
  const head = t.rows[0].join(' ');
  assert(/ID Planet Satellite Code Ephemeris Frame Epoch.*a.*e.*ω.*M.*i.*node.*P.*apsis.*node.*R\.A\..*Dec\..*Tilt.*Ref/s.test(head),
    `sats/elem: unexpected header: ${head}`);
  const out = new Map();
  for (const r of t.rows.slice(1)) {
    if (r.length < 19) continue;
    const code = num(r[3]);
    if (code == null) continue;
    out.set(code, {
      planet: r[1], name: r[2], code, ephemeris: r[4], frame: r[5].toLowerCase(), epoch: r[6],
      aKm: num(r[7]), e: num(r[8]), periDeg: num(r[9]), meanAnomalyDeg: num(r[10]), iDeg: num(r[11]), nodeDeg: num(r[12]),
      periodDays: num(r[13]), apsisPeriodYears: num(r[14]), nodePeriodYears: num(r[15]),
      laplaceRaDeg: num(r[16]), laplaceDecDeg: num(r[17]), tiltDeg: num(r[18]),
    });
  }
  assert(out.has(301) && out.has(401) && out.has(801), 'sats/elem: missing Moon/Phobos/Triton');
  return out;
}

/** "2000-01-01.5" (TDB calendar date with fractional day) -> JD (TDB). */
export function calFracToJD(s) {
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(\.\d+)?$/);
  if (!m) throw new DataError(`Unparseable epoch "${s}"`);
  const [, y, mo, d, frac] = m;
  const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d));
  return ms / 86400000 + 2440587.5 + (frac ? Number(frac) : 0);
}

// ---------------------------------------------------------------- JPL SSD sats/discovery
/** @returns {Map<string, {name, number, provisional, year, by, ref}>} keyed by lowercase name. */
export function parseJplSatDiscovery(html) {
  const t = parseHtmlTables(html).find((x) => /sat-discovery/.test(x.attrs));
  assert(t, 'sats/discovery: table not found');
  const out = new Map();
  for (const r of t.rows) {
    if (r.length < 5) continue;
    const year = num(r[3]);
    if (year == null) continue;
    out.set(r[1].toLowerCase(), { number: r[0] || null, name: r[1], provisional: r[2] || null, year, by: r[4], ref: r[5] || null });
  }
  assert(out.has('titan') && out.has('charon'), 'sats/discovery: missing Titan/Charon');
  return out;
}

// ---------------------------------------------------------------- JPL SSD approx_pos (Standish)
/**
 * Parse Table 1 (1800-2050 AD) Keplerian elements + rates from the <pre> block of
 * https://ssd.jpl.nasa.gov/planets/approx_pos.html.
 * @returns {Map<string, {a,e,I,L,lonPeri,node, aDot,eDot,IDot,LDot,lonPeriDot,nodeDot}>}
 */
export function parseApproxPosTable1(html) {
  const text = htmlToText(html);
  const start = text.indexOf('Table 1');
  const end = text.indexOf('Table 2a');
  assert(start >= 0 && end > start, 'approx_pos: Table 1 / Table 2a markers not found');
  const block = text.slice(start, end);
  assert(/valid for the time-interval 1800\s*AD\s*-\s*2050\s*AD/.test(block), 'approx_pos: Table 1 validity text changed');
  assert(/a e I L long\.peri\. long\.node\./.test(block), 'approx_pos: Table 1 column header changed');
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const out = new Map();
  const numRe = /^[-+]?\d+\.\d+$/;
  for (let i = 0; i < lines.length - 1; i++) {
    const m = lines[i].match(/^(Mercury|Venus|EM Bary|Mars|Jupiter|Saturn|Uranus|Neptune)\s+(.*)$/);
    if (!m) continue;
    const v = m[2].split(/\s+/);
    const r = lines[i + 1].split(/\s+/);
    assert(v.length === 6 && r.length === 6 && [...v, ...r].every((x) => numRe.test(x)), `approx_pos: bad rows for ${m[1]}`);
    const [a, e, I, L, lonPeri, node] = v.map(Number);
    const [aDot, eDot, IDot, LDot, lonPeriDot, nodeDot] = r.map(Number);
    out.set(m[1], { a, e, I, L, lonPeri, node, aDot, eDot, IDot, LDot, lonPeriDot, nodeDot });
  }
  assert(out.size === 8, `approx_pos: expected 8 rows in Table 1, got ${out.size}`);
  return out;
}

// ---------------------------------------------------------------- NSSDCA
/** NSSDCA planetary fact sheet summary table -> Map(label -> {MERCURY: '0.330', ...}). */
export function parseNssdcaSummary(html) {
  const t = parseHtmlTables(html)[0];
  assert(t && t.rows.length > 10, 'NSSDCA summary: table not found');
  const cols = t.rows[0].slice(1).map((c) => c.trim().toUpperCase());
  assert(cols.join(',') === 'MERCURY,VENUS,EARTH,MOON,MARS,JUPITER,SATURN,URANUS,NEPTUNE,PLUTO', `NSSDCA summary: unexpected columns ${cols}`);
  const out = new Map();
  for (const r of t.rows.slice(1)) {
    const label = r[0].trim();
    if (!label) continue;
    const vals = {};
    cols.forEach((c, i) => { vals[c] = (r[i + 1] ?? '').trim(); });
    out.set(label, vals);
  }
  return out;
}

/** Find a label in an NSSDCA sheet's text and return the first number that follows it. */
export function sheetNumber(text, labelRe) {
  const re = new RegExp(`${labelRe.source}[^\\n]*?(?:\\|\\s*|\\s)([-+]?\\d[\\d,]*\\.?\\d*)`, labelRe.flags.includes('i') ? 'i' : '');
  const m = text.match(re);
  return m ? num(m[1].replace(/,/g, '')) : null;
}

/** Raw text of "Label: value" lines in NSSDCA sheets. */
export function sheetLine(text, labelRe) {
  const re = new RegExp(`${labelRe.source}\\s*:?\\s*([^\\n|]+)`, labelRe.flags.includes('i') ? 'i' : '');
  const m = text.match(re);
  return m ? m[1].trim() : null;
}

/** NSSDCA satellite fact sheets: bulk-parameter table rows -> Map(lowercase name -> {albedoText}). */
export function parseNssdcaSatBulk(html) {
  const out = new Map();
  for (const t of parseHtmlTables(html)) {
    const head = t.rows.map((r) => r.join(' ')).join(' ');
    if (!/Visual geometric albedo/i.test(head)) continue;
    for (const r of t.rows) {
      if (r.length < 5) continue;
      const nm = r[0].replace(/\(.*$/, '').trim().toLowerCase();
      if (!nm) continue;
      out.set(nm, { massE20Kg: r[1], radiusKm: r[2], densityKgM3: r[3], albedoText: r[4] });
    }
  }
  assert(out.size > 0, 'NSSDCA satellite sheet: bulk parameter table not found');
  return out;
}

/** NSSDCA "Small Worlds" (galileanfact_table) -> Map(UPPERCASE body -> mean temperature C). */
export function parseNssdcaSmallWorlds(html) {
  const t = parseHtmlTables(html).find((x) => x.rows.some((r) => /Mean Temperature/.test(r[0] ?? '')));
  assert(t, 'NSSDCA small worlds: table not found');
  const cols = t.rows[0].map((c) => c.trim().toUpperCase());
  const row = t.rows.find((r) => /Mean Temperature \(C\)/.test(r[0]));
  const out = new Map();
  cols.forEach((c, i) => { if (i > 0 && c) out.set(c, num(row[i])); });
  assert(out.has('TITAN') && out.has('TRITON'), 'NSSDCA small worlds: expected TITAN/TRITON columns');
  return out;
}
