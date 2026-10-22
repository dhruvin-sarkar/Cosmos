// Cosmos — exoplanets domain: small shared helpers (no network).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import {
  RAW_DIR, RAW_FILES, SNAPSHOT_FILE, ARCHIVE_BASE, GAIA_RAW_FILE, GAIA_META_FILE, GAIA_COLUMNS, LIVE_CHECK_FILE,
} from './config.mjs';

// Gaia DR3 designation as stored by the archive ("Gaia DR3 5853498713190525696") -> source_id string.
// Kept as a string: source_ids exceed 2^53 and would lose precision as JS numbers.
export function gaiaSourceId(designation) {
  if (designation == null) return null;
  const m = /^Gaia DR3 (\d{1,20})$/.exec(String(designation).trim());
  return m ? m[1] : null;
}

// Cached Gaia DR3 cross-check (written by fetch-gaia.mjs). Returns null when absent.
// Map: source_id (string) -> { ra, dec, pmra, pmdec, parallax, parallax_error, ref_epoch, phot_g_mean_mag } (numbers or null)
export async function loadGaia() {
  const p = `${RAW_DIR}/${GAIA_RAW_FILE}`;
  const mp = `${RAW_DIR}/${GAIA_META_FILE}`;
  if (!existsSync(p) || !existsSync(mp)) return null;
  const meta = JSON.parse(await readFile(mp, 'utf8'));
  const text = gunzipSync(await readFile(p)).toString('utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length);
  const header = lines[0].split(',');
  if (header.join(',') !== GAIA_COLUMNS.join(',')) throw new Error(`${p}: unexpected header ${lines[0]}`);
  const rows = new Map();
  for (const line of lines.slice(1)) {
    const v = line.split(',');
    if (v.length !== header.length) throw new Error(`${p}: bad CSV line ${line}`);
    if (!/^\d+$/.test(v[0])) throw new Error(`${p}: bad source_id ${v[0]}`);
    const o = {};
    for (let i = 1; i < header.length; i++) {
      const n = v[i] === '' ? null : Number(v[i]);
      if (n !== null && !Number.isFinite(n)) throw new Error(`${p}: non-numeric ${header[i]}=${v[i]}`);
      o[header[i]] = n;
    }
    rows.set(v[0], o);
  }
  if (rows.size !== meta.rowsReturned) throw new Error(`${p}: ${rows.size} rows but meta says ${meta.rowsReturned}`);
  return { meta, rows };
}

// Live freshness check result (written by fetch.mjs --check). Returns null when absent.
export async function loadLiveCheck() {
  const p = `${RAW_DIR}/${LIVE_CHECK_FILE}`;
  if (!existsSync(p)) return null;
  return JSON.parse(await readFile(p, 'utf8'));
}

export function fail(tag, msg) {
  console.error(`\n[exoplanets/${tag}] FATAL: ${msg}\n`);
  process.exit(1);
}

export async function loadSnapshot() {
  let snap;
  try {
    snap = JSON.parse(await readFile(`${RAW_DIR}/${SNAPSHOT_FILE}`, 'utf8'));
  } catch (e) {
    throw new Error(`no raw snapshot at ${RAW_DIR}/${SNAPSHOT_FILE} (${e.code || e.message}). Run: node scripts/data/exoplanets/fetch.mjs`);
  }
  return snap;
}

export async function loadRaw(name) {
  const spec = RAW_FILES[name];
  if (!spec) throw new Error(`unknown raw file ${name}`);
  const p = `${RAW_DIR}/${spec.file}`;
  let buf = await readFile(p);
  if (spec.file.endsWith('.gz')) buf = gunzipSync(buf);
  const data = JSON.parse(buf.toString('utf8'));
  if (!Array.isArray(data)) throw new Error(`${p}: expected a JSON array`);
  return data;
}

// --- HTML entity decoding (reference labels contain e.g. "Anglada-Escud&eacute;", "&#x131;") ---
const NAMED = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  iexcl: '¡', cent: '¢', pound: '£', curren: '¤', yen: '¥', brvbar: '¦', sect: '§', uml: '¨', copy: '©', ordf: 'ª',
  laquo: '«', not: '¬', shy: '­', reg: '®', macr: '¯', deg: '°', plusmn: '±', sup2: '²', sup3: '³', acute: '´',
  micro: 'µ', para: '¶', middot: '·', cedil: '¸', sup1: '¹', ordm: 'º', raquo: '»', frac14: '¼', frac12: '½',
  frac34: '¾', iquest: '¿', Agrave: 'À', Aacute: 'Á', Acirc: 'Â', Atilde: 'Ã', Auml: 'Ä', Aring: 'Å', AElig: 'Æ',
  Ccedil: 'Ç', Egrave: 'È', Eacute: 'É', Ecirc: 'Ê', Euml: 'Ë', Igrave: 'Ì', Iacute: 'Í', Icirc: 'Î', Iuml: 'Ï',
  ETH: 'Ð', Ntilde: 'Ñ', Ograve: 'Ò', Oacute: 'Ó', Ocirc: 'Ô', Otilde: 'Õ', Ouml: 'Ö', times: '×', Oslash: 'Ø',
  Ugrave: 'Ù', Uacute: 'Ú', Ucirc: 'Û', Uuml: 'Ü', Yacute: 'Ý', THORN: 'Þ', szlig: 'ß', agrave: 'à', aacute: 'á',
  acirc: 'â', atilde: 'ã', auml: 'ä', aring: 'å', aelig: 'æ', ccedil: 'ç', egrave: 'è', eacute: 'é', ecirc: 'ê',
  euml: 'ë', igrave: 'ì', iacute: 'í', icirc: 'î', iuml: 'ï', eth: 'ð', ntilde: 'ñ', ograve: 'ò', oacute: 'ó',
  ocirc: 'ô', otilde: 'õ', ouml: 'ö', divide: '÷', oslash: 'ø', ugrave: 'ù', uacute: 'ú', ucirc: 'û', uuml: 'ü',
  yacute: 'ý', thorn: 'þ', yuml: 'ÿ', OElig: 'Œ', oelig: 'œ', Scaron: 'Š', scaron: 'š', Yuml: 'Ÿ', circ: 'ˆ',
  tilde: '˜', ensp: ' ', emsp: ' ', thinsp: ' ', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’',
  sbquo: '‚', ldquo: '“', rdquo: '”', bdquo: '„', dagger: '†', Dagger: '‡', bull: '•', hellip: '…', permil: '‰',
  prime: '′', Prime: '″', lsaquo: '‹', rsaquo: '›', euro: '€', trade: '™', minus: '−',
  Zcaron: 'Ž', zcaron: 'ž', Ccaron: 'Č', ccaron: 'č', Rcaron: 'Ř', rcaron: 'ř', Ecaron: 'Ě', ecaron: 'ě',
  Ncaron: 'Ň', ncaron: 'ň', Lstrok: 'Ł', lstrok: 'ł', Sacute: 'Ś', sacute: 'ś', Zacute: 'Ź', zacute: 'ź',
  Cacute: 'Ć', cacute: 'ć', Nacute: 'Ń', nacute: 'ń', Zdot: 'Ż', zdot: 'ż', Aogon: 'Ą', aogon: 'ą', Eogon: 'Ę',
  eogon: 'ę', Scedil: 'Ş', scedil: 'ş', Gbreve: 'Ğ', gbreve: 'ğ', Idot: 'İ', imath: 'ı', inodot: 'ı',
  Odblac: 'Ő', odblac: 'ő', Udblac: 'Ű', udblac: 'ű', Uring: 'Ů', uring: 'ů', Dstrok: 'Đ', dstrok: 'đ',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι',
  kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ',
  upsilon: 'υ', phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', Alpha: 'Α', Beta: 'Β', Gamma: 'Γ', Delta: 'Δ',
  Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
export const unknownEntities = new Map();
export function decodeEntities(s) {
  if (s == null || s.indexOf('&') < 0) return s;
  return s.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (m, body) => {
    if (body[0] === '#') {
      const cp = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : m;
    }
    if (Object.prototype.hasOwnProperty.call(NAMED, body)) return NAMED[body];
    unknownEntities.set(body, (unknownEntities.get(body) || 0) + 1);
    return m;
  });
}

// --- Reference anchors: <a refstr=KEY href=URL target=ref>Label</a> ---
const ANCHOR_RE = /^<a\s+refstr=("?)([^"\s>]+)\1\s+href=("?)([^"\s>]+)\3(?:\s+target=("?)[^"\s>]*\5)?\s*>([\s\S]*?)<\/a>$/i;
export const nonAnchorRefs = new Map();
export function parseReflink(html) {
  if (html == null) return null;
  const s = String(html).trim();
  if (!s) return null;
  const m = ANCHOR_RE.exec(s);
  if (!m) {
    // Tolerant fallback: keep the text, no URL. Recorded so the build report can flag it.
    nonAnchorRefs.set(s, (nonAnchorRefs.get(s) || 0) + 1);
    return { refstr: null, label: decodeEntities(s.replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim(), url: null };
  }
  let url = decodeEntities(m[4]);
  if (url.startsWith('/')) url = ARCHIVE_BASE + url;
  const label = decodeEntities(m[6].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim();
  return { refstr: m[2], label, url };
}

// Dates: archive gives "YYYY-MM-DD", "YYYY-MM-DD HH:MM[:SS]" (no time zone) or "YYYY-MM" (pl_pubdate).
export function isoDate(s) {
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?$/.exec(String(s).trim());
  if (!m) throw new Error(`unrecognised date "${s}"`);
  return `${m[1]}-${m[2]}-${m[3]}`;
}
export function isoMonthOrDate(s) {
  if (s == null) return null;
  const m = /^(\d{4})-(\d{2})(?:-(\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2})?)?)?$/.exec(String(s).trim());
  if (!m) throw new Error(`unrecognised date "${s}"`);
  return m[3] ? `${m[1]}-${m[2]}-${m[3]}` : `${m[1]}-${m[2]}`;
}

export function cmpStr(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
