/**
 * Search index (implements `SearchIndex` from src/core/entity.ts; injected into the entity registry).
 *
 * Normalization makes visitor spellings meet catalogue spellings:
 *   - NFKD + diacritic stripping, case folding, punctuation → spaces ("Boötes" → "bootes", "TRAPPIST-1" → "trappist 1")
 *   - Greek letters and their 3-letter catalogue abbreviations spelled out ("α Cen", "alf Cen" → "alpha cen")
 *   - letter/digit boundaries split ("M31" → "m 31", "HIP70890" → "hip 70890"); "Messier" → "m"; "Gliese"/"Gl" → "gj"
 *   - "*" → "star" ("Sgr A*" → "sgr a star")
 * At index time each key also gets constellation variants (abbreviation ⇄ nominative ⇄ genitive for all 88 IAU
 * constellations), so "alpha cen" finds "Alpha Centauri" and "sagittarius a star" finds "Sgr A*".
 *
 * Scoring tiers (before importance weighting): exact name > alias exact > name prefix > word prefix > alias prefix >
 * substring > fuzzy (Damerau–Levenshtein ≤ 1 for length ≥ 4, ≤ 2 for length ≥ 8) > category word.
 * Final score = tier score × (0.75 + 0.25 × importance/100), so importance re-orders within a tier and only nudges
 * across neighbouring tiers.
 */
import type { EntityKind, SearchIndex, SearchRecord, SearchResult } from '../core/entity';

// ── Normalization ────────────────────────────────────────────────────────────────────────────

const GREEK_LETTERS: Record<string, string> = {
  α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ϵ: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta', ϑ: 'theta',
  ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', ο: 'omicron', π: 'pi', ρ: 'rho', σ: 'sigma', ς: 'sigma',
  τ: 'tau', υ: 'upsilon', φ: 'phi', ϕ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

export const GREEK_NAMES: readonly string[] = [
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda', 'mu',
  'nu', 'xi', 'omicron', 'pi', 'rho', 'sigma', 'tau', 'upsilon', 'phi', 'chi', 'psi', 'omega',
];
const GREEK_NAME_SET = new Set(GREEK_NAMES);

/** Catalogue (SIMBAD/Bayer) abbreviations of Greek letter names. 'del' is handled contextually (vs Delphinus). */
const GREEK_ABBREVIATIONS: Record<string, string> = {
  alf: 'alpha', alp: 'alpha', bet: 'beta', gam: 'gamma', eps: 'epsilon', zet: 'zeta', tet: 'theta', tht: 'theta',
  iot: 'iota', kap: 'kappa', lam: 'lambda', ksi: 'xi', omi: 'omicron', sig: 'sigma', ups: 'upsilon', ome: 'omega',
};

const TOKEN_SYNONYMS: Record<string, string> = { messier: 'm', gliese: 'gj', gl: 'gj' };

const COMBINING_MARKS = /[̀-ͯ]/g;

function isDesignatorToken(t: string | undefined): boolean {
  return t !== undefined && (GREEK_NAME_SET.has(t) || /^\d+$/.test(t) || t.length === 1);
}

/**
 * Canonical search form: lower-case ASCII words separated by single spaces. Pure and idempotent
 * (normalizeSearchText(normalizeSearchText(x)) === normalizeSearchText(x)).
 */
export function normalizeSearchText(text: string): string {
  if (!text) return '';
  let s = text.toLowerCase();
  s = s.replace(/[α-ωϑϕϵ]/g, ch => ` ${GREEK_LETTERS[ch] ?? ch} `);
  s = s.normalize('NFKD').replace(COMBINING_MARKS, '');
  s = s.replace(/['’]s\b/g, '').replace(/['’]/g, '');
  s = s.replace(/\*/g, ' star ').replace(/&/g, ' and ');
  s = s.replace(/[^a-z0-9]+/g, ' ');
  s = s.replace(/([a-z])(\d)/g, '$1 $2').replace(/(\d)([a-z])/g, '$1 $2');
  const tokens = s.trim().split(' ');
  if (tokens.length === 1 && tokens[0] === '') return '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const syn = TOKEN_SYNONYMS[t] ?? GREEK_ABBREVIATIONS[t];
    if (syn) tokens[i] = syn;
    else if (t === 'del' && i < tokens.length - 1 && !isDesignatorToken(tokens[i - 1])) tokens[i] = 'delta';
  }
  return tokens.join(' ');
}

// ── Constellations (all 88 IAU): abbreviation, nominative, genitive ─────────────────────────

export interface ConstellationName {
  abbr: string;
  name: string;
  genitive: string;
}

const CONSTELLATION_TABLE =
  'And|Andromeda|Andromedae;Ant|Antlia|Antliae;Aps|Apus|Apodis;Aqr|Aquarius|Aquarii;Aql|Aquila|Aquilae;Ara|Ara|Arae;' +
  'Ari|Aries|Arietis;Aur|Auriga|Aurigae;Boo|Boötes|Boötis;Cae|Caelum|Caeli;Cam|Camelopardalis|Camelopardalis;' +
  'Cnc|Cancer|Cancri;CVn|Canes Venatici|Canum Venaticorum;CMa|Canis Major|Canis Majoris;CMi|Canis Minor|Canis Minoris;' +
  'Cap|Capricornus|Capricorni;Car|Carina|Carinae;Cas|Cassiopeia|Cassiopeiae;Cen|Centaurus|Centauri;Cep|Cepheus|Cephei;' +
  'Cet|Cetus|Ceti;Cha|Chamaeleon|Chamaeleontis;Cir|Circinus|Circini;Col|Columba|Columbae;Com|Coma Berenices|Comae Berenices;' +
  'CrA|Corona Australis|Coronae Australis;CrB|Corona Borealis|Coronae Borealis;Crv|Corvus|Corvi;Crt|Crater|Crateris;' +
  'Cru|Crux|Crucis;Cyg|Cygnus|Cygni;Del|Delphinus|Delphini;Dor|Dorado|Doradus;Dra|Draco|Draconis;Equ|Equuleus|Equulei;' +
  'Eri|Eridanus|Eridani;For|Fornax|Fornacis;Gem|Gemini|Geminorum;Gru|Grus|Gruis;Her|Hercules|Herculis;' +
  'Hor|Horologium|Horologii;Hya|Hydra|Hydrae;Hyi|Hydrus|Hydri;Ind|Indus|Indi;Lac|Lacerta|Lacertae;Leo|Leo|Leonis;' +
  'LMi|Leo Minor|Leonis Minoris;Lep|Lepus|Leporis;Lib|Libra|Librae;Lup|Lupus|Lupi;Lyn|Lynx|Lyncis;Lyr|Lyra|Lyrae;' +
  'Men|Mensa|Mensae;Mic|Microscopium|Microscopii;Mon|Monoceros|Monocerotis;Mus|Musca|Muscae;Nor|Norma|Normae;' +
  'Oct|Octans|Octantis;Oph|Ophiuchus|Ophiuchi;Ori|Orion|Orionis;Pav|Pavo|Pavonis;Peg|Pegasus|Pegasi;Per|Perseus|Persei;' +
  'Phe|Phoenix|Phoenicis;Pic|Pictor|Pictoris;Psc|Pisces|Piscium;PsA|Piscis Austrinus|Piscis Austrini;Pup|Puppis|Puppis;' +
  'Pyx|Pyxis|Pyxidis;Ret|Reticulum|Reticuli;Sge|Sagitta|Sagittae;Sgr|Sagittarius|Sagittarii;Sco|Scorpius|Scorpii;' +
  'Scl|Sculptor|Sculptoris;Sct|Scutum|Scuti;Ser|Serpens|Serpentis;Sex|Sextans|Sextantis;Tau|Taurus|Tauri;' +
  'Tel|Telescopium|Telescopii;Tri|Triangulum|Trianguli;TrA|Triangulum Australe|Trianguli Australis;Tuc|Tucana|Tucanae;' +
  'UMa|Ursa Major|Ursae Majoris;UMi|Ursa Minor|Ursae Minoris;Vel|Vela|Velorum;Vir|Virgo|Virginis;Vol|Volans|Volantis;' +
  'Vul|Vulpecula|Vulpeculae';

export const CONSTELLATIONS: readonly ConstellationName[] = CONSTELLATION_TABLE.split(';').map(row => {
  const [abbr, name, genitive] = row.split('|');
  return { abbr, name, genitive };
});

interface ConstellationForms {
  abbr: string;
  name: string;
  genitive: string;
}

const CONSTELLATION_FORMS: ConstellationForms[] = CONSTELLATIONS.map(c => ({
  abbr: normalizeSearchText(c.abbr),
  name: normalizeSearchText(c.name),
  genitive: normalizeSearchText(c.genitive),
}));

/** normalized phrase → [constellation index, form]. Abbreviations are only trusted in designation context. */
const PHRASE_TO_CONSTELLATION = new Map<string, { idx: number; form: 'abbr' | 'name' | 'genitive' }>();
CONSTELLATION_FORMS.forEach((f, idx) => {
  PHRASE_TO_CONSTELLATION.set(f.name, { idx, form: 'name' });
  PHRASE_TO_CONSTELLATION.set(f.genitive, { idx, form: 'genitive' });
  if (!PHRASE_TO_CONSTELLATION.has(f.abbr)) PHRASE_TO_CONSTELLATION.set(f.abbr, { idx, form: 'abbr' });
});

/** Constellation lookup by abbreviation / nominative / genitive in any case or spelling ("cen", "Centauri", "Boötes"). */
export function findConstellation(text: string): ConstellationName | undefined {
  const hit = PHRASE_TO_CONSTELLATION.get(normalizeSearchText(text));
  return hit ? CONSTELLATIONS[hit.idx] : undefined;
}

/**
 * Alternative spellings of a normalized key with its (first) constellation reference swapped for the other two forms:
 * "alpha centauri" → ["alpha cen", "alpha centaurus"]; "sgr a star" → ["sagittarius a star", "sagittarii a star"].
 */
export function constellationVariants(key: string): string[] {
  const tokens = key.split(' ');
  for (let i = 0; i < tokens.length; i++) {
    // Try two-word phrases first ("canis majoris"), then single words.
    for (const span of [2, 1]) {
      if (i + span > tokens.length) continue;
      const phrase = span === 2 ? `${tokens[i]} ${tokens[i + 1]}` : tokens[i];
      const hit = PHRASE_TO_CONSTELLATION.get(phrase);
      if (!hit) continue;
      if (hit.form === 'abbr') {
        const contextual = isDesignatorToken(tokens[i - 1]) || (tokens[i + span] !== undefined && tokens[i + span].length === 1);
        if (!contextual) continue;
      }
      const f = CONSTELLATION_FORMS[hit.idx];
      const before = tokens.slice(0, i).join(' ');
      const after = tokens.slice(i + span).join(' ');
      const out: string[] = [];
      for (const form of [f.abbr, f.name, f.genitive]) {
        if (form === phrase) continue;
        const v = [before, form, after].filter(Boolean).join(' ');
        if (v !== key && !out.includes(v)) out.push(v);
      }
      return out;
    }
  }
  return [];
}

// ── Well-known extra aliases (keyed by a normalized name or alias that may appear in records) ──

const EXTRA_ALIASES: Record<string, readonly string[]> = {
  'iss zarya': ['ISS', 'International Space Station', 'Space Station'],
  'iss': ['International Space Station'],
  'international space station': ['ISS'],
  'css tianhe': ['Tiangong', 'Chinese Space Station', 'CSS'],
  'tiangong': ['CSS', 'Chinese Space Station'],
  'hst': ['Hubble', 'Hubble Space Telescope'],
  'hubble space telescope': ['HST', 'Hubble'],
  'jwst': ['James Webb Space Telescope', 'Webb'],
  'james webb space telescope': ['JWST', 'Webb'],
  'sun': ['Sol', 'The Sun'],
  'moon': ['Luna', 'The Moon'],
  'earth': ['Terra', 'Home'],
  'sgr a star': ['Sagittarius A*', 'Milky Way black hole', 'Galactic Center black hole'],
  'sagittarius a star': ['Sgr A*', 'Milky Way black hole'],
  'm 31': ['Andromeda', 'Andromeda Galaxy', 'NGC 224'],
  'andromeda galaxy': ['M31', 'Messier 31', 'NGC 224', 'Andromeda'],
  'm 33': ['Triangulum Galaxy', 'NGC 598'],
  'triangulum galaxy': ['M33', 'NGC 598'],
  'large magellanic cloud': ['LMC'],
  'small magellanic cloud': ['SMC'],
  'milky way': ['The Galaxy', 'Milky Way Galaxy'],
  'rigil kentaurus': ['Alpha Centauri A', 'α Cen A', 'Rigel Kentaurus'],
  'alpha centauri a': ['Rigil Kentaurus'],
  'toliman': ['Alpha Centauri B', 'α Cen B'],
  'alpha centauri b': ['Toliman'],
  'proxima centauri': ['Proxima', 'Alpha Centauri C', 'GJ 551'],
  'm 42': ['Orion Nebula', 'Great Orion Nebula', 'NGC 1976'],
  'orion nebula': ['M42', 'NGC 1976'],
  'm 45': ['Pleiades', 'Seven Sisters'],
  'pleiades': ['M45', 'Seven Sisters'],
  'm 87': ['Virgo A', 'NGC 4486'],
  'cosmic microwave background': ['CMB'],
  'cmb': ['Cosmic Microwave Background'],
};

// ── Category words ──────────────────────────────────────────────────────────────────────────

export const CATEGORY_WORDS: Readonly<Record<string, readonly EntityKind[]>> = {
  'star': ['star'], 'stars': ['star'], 'sun': ['star'],
  'planet': ['planet', 'dwarf-planet', 'exoplanet'], 'planets': ['planet', 'dwarf-planet', 'exoplanet'],
  'dwarf planet': ['dwarf-planet'], 'dwarf planets': ['dwarf-planet'],
  'exoplanet': ['exoplanet'], 'exoplanets': ['exoplanet'], 'extrasolar planet': ['exoplanet'],
  'moon': ['moon'], 'moons': ['moon'], 'satellite': ['satellite', 'space-station'], 'satellites': ['satellite', 'space-station'],
  'natural satellite': ['moon'],
  'asteroid': ['asteroid'], 'asteroids': ['asteroid'], 'comet': ['comet'], 'comets': ['comet'],
  'interstellar': ['interstellar-object'], 'interstellar object': ['interstellar-object'],
  'spacecraft': ['spacecraft', 'space-station'], 'probe': ['spacecraft'], 'probes': ['spacecraft'],
  'space station': ['space-station'], 'station': ['space-station'],
  'debris': ['debris', 'rocket-body'], 'space debris': ['debris', 'rocket-body'], 'junk': ['debris', 'rocket-body'],
  'space junk': ['debris', 'rocket-body'], 'rocket body': ['rocket-body'], 'rocket': ['rocket-body'],
  'black hole': ['black-hole'], 'black holes': ['black-hole'], 'blackhole': ['black-hole'],
  'galaxy': ['galaxy'], 'galaxies': ['galaxy'], 'galaxy group': ['galaxy-group'], 'galaxy cluster': ['galaxy-cluster'],
  'supercluster': ['supercluster'], 'void': ['void'], 'voids': ['void'],
  'nebula': ['nebula'], 'nebulae': ['nebula'], 'nebulas': ['nebula'],
  'cluster': ['star-cluster', 'galaxy-cluster'], 'star cluster': ['star-cluster'], 'clusters': ['star-cluster', 'galaxy-cluster'],
  'constellation': ['constellation'], 'constellations': ['constellation'],
  'system': ['stellar-system'], 'star system': ['stellar-system'], 'planetary system': ['stellar-system'],
};

// ── Damerau–Levenshtein (optimal string alignment), bounded ─────────────────────────────────

let rowPrev2 = new Int32Array(64);
let rowPrev = new Int32Array(64);
let rowCur = new Int32Array(64);

/** OSA distance between a and b, or maxDist + 1 as soon as it is certain to exceed maxDist. */
export function boundedDamerauLevenshtein(a: string, b: string, maxDist: number): number {
  const n = a.length;
  const m = b.length;
  if (Math.abs(n - m) > maxDist) return maxDist + 1;
  if (n === 0 || m === 0) return Math.max(n, m);
  if (rowCur.length < m + 1) {
    rowPrev2 = new Int32Array(m + 1);
    rowPrev = new Int32Array(m + 1);
    rowCur = new Int32Array(m + 1);
  }
  for (let j = 0; j <= m; j++) rowPrev[j] = j;
  for (let i = 1; i <= n; i++) {
    rowCur[0] = i;
    let rowMin = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= m; j++) {
      const cb = b.charCodeAt(j - 1);
      const cost = ca === cb ? 0 : 1;
      let v = Math.min(rowPrev[j] + 1, rowCur[j - 1] + 1, rowPrev[j - 1] + cost);
      if (i > 1 && j > 1 && ca === b.charCodeAt(j - 2) && a.charCodeAt(i - 2) === cb) {
        v = Math.min(v, rowPrev2[j - 2] + 1);
      }
      rowCur[j] = v;
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > maxDist) return maxDist + 1;
    const t = rowPrev2;
    rowPrev2 = rowPrev;
    rowPrev = rowCur;
    rowCur = t;
  }
  return rowPrev[m];
}

function fuzzyBudget(len: number): number {
  return len >= 8 ? 2 : len >= 4 ? 1 : 0;
}

// ── Index ───────────────────────────────────────────────────────────────────────────────────

const KeyKind = { Name: 0, Alias: 1, Identifier: 2 } as const;
type KeyKind = (typeof KeyKind)[keyof typeof KeyKind];

interface KeyEntry {
  key: string;
  rec: number;
  kind: KeyKind;
  /** Original (display) text that produced this key. */
  text: string;
  /** Constellation-variant spelling of the original (small penalty). */
  variant: boolean;
}

const TIER = {
  exactName: 1000,
  exactAlias: 900,
  prefixName: 800,
  wordPrefix: 700,
  prefixAlias: 650,
  wordPrefixAlias: 600,
  substring: 500,
  fuzzy1: 320,
  fuzzy2: 260,
  category: 150,
} as const;
const VARIANT_PENALTY = 40;

function importanceFactor(importance: number): number {
  const imp = Number.isFinite(importance) ? Math.min(100, Math.max(0, importance)) : 0;
  return 0.75 + 0.25 * (imp / 100);
}

function looksLikeIdentifier(normalized: string): boolean {
  return /\d/.test(normalized);
}

export interface CosmosSearchIndex extends SearchIndex {
  /** Number of indexed records. */
  readonly size: number;
}

export function createSearchIndex(): CosmosSearchIndex {
  let records: SearchRecord[] = [];
  let factors = new Float64Array(0);
  let entries: KeyEntry[] = [];
  /** key → entry indices (exact lookups). */
  let exact = new Map<string, number[]>();
  /**
   * Fuzzy targets (digit-free whole keys and words of 4+ chars), bucketed by length then first character. Restricting
   * candidates to the query's first or second character keeps fuzzy matching sub-millisecond on 20k records; it
   * misses typos in the very first letter, which visitors rarely make (and prefix/substring tiers still apply).
   */
  let fuzzyBuckets: Map<number, Map<string, number[]>>[] = [];
  /** All distinct keys joined by newlines, scanned with native indexOf for prefix / word-prefix / substring tiers. */
  let haystack = '';
  /** haystackOffsets[k] = start of key k in haystack; one extra sentinel at the end. */
  let haystackOffsets = new Int32Array(1);
  let haystackEntries: number[][] = [];
  /** kind → record indices sorted by importance desc. */
  let byKind = new Map<EntityKind, number[]>();

  let best = new Float64Array(0);
  let bestEntry = new Int32Array(0);
  let bestMatched = new Uint8Array(0); // 0 = entry-based, 1 = category
  let bestCategory: string[] = [];
  const touched: number[] = [];
  const topK: number[] = [];

  function addFuzzyTarget(s: string, entryIdx: number): void {
    const len = s.length;
    if (len < 4 || /\d/.test(s)) return;
    let byChar = fuzzyBuckets[len];
    if (!byChar) fuzzyBuckets[len] = byChar = new Map();
    const c0 = s.charCodeAt(0);
    let bucket = byChar.get(c0);
    if (!bucket) byChar.set(c0, bucket = new Map());
    const list = bucket.get(s);
    if (list) {
      if (list[list.length - 1] !== entryIdx) list.push(entryIdx);
    } else bucket.set(s, [entryIdx]);
  }

  function addKey(rec: number, text: string, kind: KeyKind, seen: Set<string>): void {
    const key = normalizeSearchText(text);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const k = kind === KeyKind.Alias && looksLikeIdentifier(key) ? KeyKind.Identifier : kind;
    const push = (s: string, variant: boolean): void => {
      const idx = entries.length;
      entries.push({ key: s, rec, kind: k, text, variant });
      const list = exact.get(s);
      if (list) list.push(idx);
      else exact.set(s, [idx]);
      addFuzzyTarget(s, idx);
      if (s.indexOf(' ') >= 0) for (const w of s.split(' ')) addFuzzyTarget(w, idx);
    };
    push(key, false);
    for (const v of constellationVariants(key)) {
      if (seen.has(v)) continue;
      seen.add(v);
      push(v, true);
    }
  }

  function consider(rec: number, score: number, entryIdx: number): void {
    if (best[rec] < 0) touched.push(rec);
    if (score > best[rec]) {
      best[rec] = score;
      bestEntry[rec] = entryIdx;
      bestMatched[rec] = 0;
    }
  }

  function scoreEntry(entryIdx: number, base: number, bonus = 0): void {
    const e = entries[entryIdx];
    const tier = base - (e.variant ? VARIANT_PENALTY : 0) + bonus;
    consider(e.rec, tier * factors[e.rec], entryIdx);
  }

  return {
    get size() {
      return records.length;
    },

    rebuild(input: readonly SearchRecord[]): void {
      records = input.slice();
      factors = new Float64Array(records.length);
      entries = [];
      exact = new Map();
      fuzzyBuckets = [];
      byKind = new Map();
      for (let r = 0; r < records.length; r++) {
        const rec = records[r];
        factors[r] = importanceFactor(rec.importance);
        const seen = new Set<string>();
        addKey(r, rec.name, KeyKind.Name, seen);
        const aliases = Array.isArray(rec.aliases) ? rec.aliases : [];
        for (const a of aliases) if (typeof a === 'string') addKey(r, a, KeyKind.Alias, seen);
        // Extra aliases are looked up from the record's own keys (normalized), not by id, so they survive id changes.
        for (const own of [rec.name, ...aliases]) {
          const extra = typeof own === 'string' ? EXTRA_ALIASES[normalizeSearchText(own)] : undefined;
          if (extra) for (const a of extra) addKey(r, a, KeyKind.Alias, seen);
        }
        let list = byKind.get(rec.kind);
        if (!list) byKind.set(rec.kind, list = []);
        list.push(r);
      }
      for (const list of byKind.values()) list.sort((a, b) => records[b].importance - records[a].importance);
      best = new Float64Array(records.length).fill(-1);
      bestEntry = new Int32Array(records.length);
      bestMatched = new Uint8Array(records.length);
      bestCategory = new Array<string>(records.length);
      const keys = Array.from(exact.keys());
      haystackEntries = keys.map(k => exact.get(k) as number[]);
      haystackOffsets = new Int32Array(keys.length + 1);
      let off = 0;
      for (let k = 0; k < keys.length; k++) {
        haystackOffsets[k] = off;
        off += keys[k].length + 1;
      }
      haystackOffsets[keys.length] = off;
      haystack = keys.join('\n');
    },

    query(text: string, limit: number): SearchResult[] {
      const q = normalizeSearchText(typeof text === 'string' ? text : '');
      if (!q || records.length === 0 || !(limit > 0)) return [];
      touched.length = 0;

      // Exact (name / alias / identifier).
      const exactHits = exact.get(q);
      if (exactHits) {
        for (const idx of exactHits) scoreEntry(idx, entries[idx].kind === KeyKind.Name ? TIER.exactName : TIER.exactAlias);
      }

      // Prefix, word prefix and substring in one pass.
      const qLen = q.length;
      const allowSubstring = qLen >= 3;
      const nKeys = haystackEntries.length;
      let k = 0;
      for (let p = haystack.indexOf(q); p >= 0; p = haystack.indexOf(q, p + 1)) {
        if (p >= haystackOffsets[k + 1]) {
          let lo = k + 1;
          let hi = nKeys - 1;
          while (lo < hi) {
            const mid = (lo + hi + 1) >> 1;
            if (haystackOffsets[mid] <= p) lo = mid;
            else hi = mid - 1;
          }
          k = lo;
        }
        const start = haystackOffsets[k];
        const keyLen = haystackOffsets[k + 1] - 1 - start;
        if (keyLen <= qLen) continue; // equal-length matches were handled by the exact lookup
        const extra = Math.min(30, keyLen - qLen);
        let nameTier: number;
        let aliasTier: number;
        let bonus: number;
        if (p === start) {
          nameTier = TIER.prefixName;
          aliasTier = TIER.prefixAlias;
          // Prefer completions that end at a word boundary, then shorter ones.
          bonus = (haystack.charCodeAt(p + qLen) === 32 ? 15 : 0) - extra;
        } else if (haystack.charCodeAt(p - 1) === 32) {
          nameTier = TIER.wordPrefix;
          aliasTier = TIER.wordPrefixAlias;
          bonus = -extra / 2;
        } else if (allowSubstring) {
          nameTier = aliasTier = TIER.substring;
          bonus = -extra / 2;
        } else continue;
        for (const idx of haystackEntries[k]) scoreEntry(idx, entries[idx].kind === KeyKind.Name ? nameTier : aliasTier, bonus);
      }

      // Fuzzy, only for queries long enough to be unambiguous.
      const budget = /\d/.test(q) ? 0 : fuzzyBudget(qLen);
      const c0 = q.charCodeAt(0);
      const c1 = q.charCodeAt(1);
      for (let len = qLen - budget; budget > 0 && len <= qLen + budget; len++) {
        const byChar = fuzzyBuckets[len];
        if (!byChar) continue;
        for (let pass = 0; pass < 2; pass++) {
          if (pass === 1 && c1 === c0) break;
          const bucket = byChar.get(pass === 0 ? c0 : c1);
          if (!bucket) continue;
          for (const [target, idxs] of bucket) {
            if (target === q) continue;
            const d = boundedDamerauLevenshtein(q, target, budget);
            if (d > budget) continue;
            const base = d <= 1 ? TIER.fuzzy1 : TIER.fuzzy2;
            for (const idx of idxs) {
              // A word-level fuzzy hit inside a longer key scores a little lower than a whole-key one.
              scoreEntry(idx, base, entries[idx].key === target ? 0 : -20);
            }
          }
        }
      }

      // Category words ("galaxy", "black hole", "moons", "debris").
      const kinds = CATEGORY_WORDS[q];
      if (kinds) {
        for (const kind of kinds) {
          const list = byKind.get(kind);
          if (!list) continue;
          const n = Math.min(list.length, limit * 4);
          for (let i = 0; i < n; i++) {
            const r = list[i];
            const s = TIER.category * factors[r];
            if (best[r] < 0) touched.push(r);
            if (s > best[r]) {
              best[r] = s;
              bestMatched[r] = 1;
              bestCategory[r] = q;
            }
          }
        }
      }

      // Top-k selection: broad queries ("star", "cen") can touch tens of thousands of records; a full sort would dominate.
      const cmp = (a: number, b: number): number =>
        best[b] - best[a] || records[b].importance - records[a].importance || (records[a].name < records[b].name ? -1 : 1);
      const lim = Math.floor(limit) || 1;
      const top = topK;
      top.length = 0;
      for (const r of touched) {
        if (top.length === lim && cmp(r, top[lim - 1]) >= 0) continue;
        let i = top.length < lim ? top.length : lim - 1;
        while (i > 0 && cmp(r, top[i - 1]) < 0) {
          top[i] = top[i - 1];
          i--;
        }
        top[i] = r;
      }
      const n = top.length;
      const out: SearchResult[] = new Array<SearchResult>(n);
      for (let i = 0; i < n; i++) {
        const r = top[i];
        if (bestMatched[r] === 1) {
          out[i] = { record: records[r], score: best[r], matched: 'category', matchedText: bestCategory[r] };
        } else {
          const e = entries[bestEntry[r]];
          const matched: SearchResult['matched'] = e.kind === KeyKind.Name ? 'name' : e.kind === KeyKind.Identifier ? 'identifier' : 'alias';
          out[i] = { record: records[r], score: best[r], matched, matchedText: e.text };
        }
      }
      for (const r of touched) best[r] = -1;
      touched.length = 0;
      return out;
    },
  };
}
