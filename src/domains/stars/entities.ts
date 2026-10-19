/**
 * Stars entity provider: 'star:hip:<n>' (any of the ~107k Hipparcos stars in the field), 'star:hyg:<id>' (named
 * stars without a HIP number) and 'const:<Abbr>' (the 88 IAU constellations). Entities are built lazily from the
 * catalogue buffers; search records cover proper names, Bayer/Flamsteed designations and nearby Gliese stars.
 */
import * as THREE from 'three';
import type { Capability, Entity, EntityProvider, SearchRecord } from '../../core/entity';
import { PC_M, R_SUN_M } from '../../core/units';
import type { Fact, FactSheet, SourceRef } from '../../data/provenance';
import { normalizeGl, type ConstellationRecord, type NamedStar, type StarCatalog } from './catalog';
import { bayerShort, displayName, indexForStarId, starIdForIndex } from './ids';
import { luminosityLsun } from './photometry';

const HYG_SRC: SourceRef = { datasetId: 'stars-hyg-field', note: 'HYG Database v4.4 (Hipparcos 2007, Yale BSC 5, Gliese 3), CC BY-SA 4.0' };
const NAMES_SRC: SourceRef = { datasetId: 'iau-wgsn-star-names', note: 'IAU Catalog of Star Names (WGSN)' };
const LINES_SRC: SourceRef = { datasetId: 'constellation-figures-boundaries', note: 'Stellarium "modern_iau" sky culture, CC BY-SA 4.0' };
const BOUNDS_SRC: SourceRef = { datasetId: 'constellation-figures-boundaries', note: 'Davenhall & Leggett (1989), CDS VI/49' };
const IAU_NAMES_SRC: SourceRef = { datasetId: 'constellation-figures-boundaries', note: 'IAU, "The Constellations"' };

const STAR_CAPS: Capability[] = ['focus', 'travel', 'orbit', 'bookmark', 'sources', 'sky-view', 'compare'];

const LIGHT_YEARS_PER_PC = 3.261_563_777;

function spectralClassText(sp: string | null): string {
  if (!sp) return 'star';
  const cls = sp.trim()[0]?.toUpperCase();
  const lum = /(Ia|Ib|III|II|IV|V|VI|VII)/.exec(sp)?.[1];
  const color: Record<string, string> = {
    O: 'blue', B: 'blue-white', A: 'white', F: 'yellow-white', G: 'yellow', K: 'orange', M: 'red',
  };
  const lumText: Record<string, string> = {
    Ia: 'supergiant', Ib: 'supergiant', II: 'bright giant', III: 'giant', IV: 'subgiant', V: 'main-sequence star',
    VI: 'subdwarf', VII: 'white dwarf',
  };
  if (cls === 'D') return 'white dwarf';
  const c = color[cls ?? ''];
  return `${c ? c + ' ' : ''}${lum ? lumText[lum] : 'star'}`;
}

function q(value: number | null, unit: string, provenance: Fact['provenance'], sigDigits: number, source?: SourceRef, model?: string) {
  return { value: value !== null && Number.isFinite(value) ? value : null, unit, provenance, sigDigits, source, model };
}

export interface StarsProviderOptions {
  catalog: StarCatalog;
}

export function createStarsProvider(opts: StarsProviderOptions): EntityProvider {
  const cat = opts.catalog;
  const d = cat.details!;
  const cache = new Map<string, Entity>();
  const constByAbbr = new Map<string, ConstellationRecord>(d.constellations.map((k) => [k.abbr.toLowerCase(), k]));
  const genitiveOf = new Map<string, string>(d.constellations.map((k) => [k.abbr, k.genitive]));
  let records: SearchRecord[] | null = null;

  const aliasesFor = (row: NamedStar | undefined, hip: number, name: string): string[] => {
    const out: string[] = [];
    const add = (s: string | null | undefined): void => {
      if (s && s !== name && !out.includes(s)) out.push(s);
    };
    if (row?.bayerFlamsteed) {
      add(row.bayerFlamsteed);
      add(bayerShort(row.bayerFlamsteed));
      // "α CMa" → "α Canis Majoris" (the search normaliser spells Greek letters out).
      const m = /^(?:\d+\s+)?(\S+)\s+([A-Z][a-z]{2})$/.exec(row.bayerFlamsteed.trim());
      const gen = m ? genitiveOf.get(m[2]) : undefined;
      if (m && gen) add(`${m[1]} ${gen}`);
    }
    if (hip > 0) add(`HIP ${hip}`);
    if (row?.hd) add(`HD ${row.hd}`);
    if (row?.hr) add(`HR ${row.hr}`);
    if (row?.gl) {
      add(row.gl);
      add(`GJ ${normalizeGl(row.gl)}`);
    }
    if (row?.variableName && row.constellation) add(`${row.variableName} ${row.constellation}`);
    return out;
  };

  function buildStar(i: number): Entity {
    const row = d.namedByIndex.get(i);
    const hip = cat.hipOf[i];
    const id = starIdForIndex(cat, i)!;
    const name = displayName(row, hip);
    const aliases = aliasesFor(row, hip, name);
    const p = cat.positionsM;
    const R = cat.radiusRsun[i] * R_SUN_M;
    const distPc = cat.distPc[i];
    const appMag = cat.absMag[i] + 5 * Math.log10(distPc) - 5;
    const teff = cat.teffK[i] > 0 ? cat.teffK[i] : null;
    const kindText = spectralClassText(row?.spectralType ?? null);
    const ly = distPc * LIGHT_YEARS_PER_PC;
    const tagline = `${kindText[0].toUpperCase()}${kindText.slice(1)}, ${ly < 100 ? ly.toFixed(1) : Math.round(ly)} light-years away`;
    const importance = row?.properName ? Math.max(25, Math.min(80, 62 - 6 * appMag)) : Math.max(5, Math.min(30, 30 - 2 * appMag));
    return {
      id,
      name,
      aliases,
      kind: 'star',
      domain: 'stars',
      parentId: 'mw:galaxy',
      radiusM: R,
      position(_t: number, out: THREE.Vector3): THREE.Vector3 {
        return out.set(p[3 * i], p[3 * i + 1], p[3 * i + 2]);
      },
      viewDistance: { min: 1.3 * R, default: 7 * R, max: 2 * PC_M },
      contextScaleMin: Math.log10(Math.max(distPc, 1) * PC_M) - 0.5,
      tagline,
      capabilities: STAR_CAPS,
      importance,
      representation: 'derived',
      facts: () => starFacts(i, id, name, row),
    };
  }

  function starFacts(i: number, id: string, name: string, row: NamedStar | undefined): FactSheet {
    const distPc = cat.distPc[i];
    const absMag = cat.absMag[i];
    const appMag = row?.apparentMag ?? absMag + 5 * Math.log10(distPc) - 5;
    const teff = cat.teffK[i] > 0 ? cat.teffK[i] : null;
    const bv = Number.isFinite(cat.bv[i]) ? cat.bv[i] : null;
    const L = teff !== null ? luminosityLsun(absMag, teff) : null;
    const sys = d.systemOf.get(i);
    const snapped = cat.snappedToPrimary.has(i);
    const props: Fact[] = [
      { key: 'distance', label: 'Distance from the Sun', quantity: q(distPc * PC_M, 'm', 'derived', 3, HYG_SRC, 'parallax-inverse@1'), provenance: 'derived', source: HYG_SRC, help: snapped ? 'Set to the primary star’s distance: the two parallaxes differ by more than the true separation.' : 'Distance = 1 / parallax (Hipparcos 2007 reduction where available).' },
      { key: 'appMag', label: 'Apparent magnitude (V, from Earth)', quantity: q(appMag, '', 'observed', 3, HYG_SRC), provenance: 'observed', source: HYG_SRC },
      { key: 'absMag', label: 'Absolute magnitude (V)', quantity: q(absMag, '', 'derived', 3, HYG_SRC, 'distance-modulus@1'), provenance: 'derived', help: 'Brightness the star would have at 10 parsecs; no correction for interstellar dust.' },
      { key: 'spectralType', label: 'Spectral type', text: row?.spectralType ?? 'Unknown', provenance: 'observed', source: HYG_SRC },
      { key: 'bv', label: 'Colour index B−V', quantity: q(bv, '', 'observed', 3, HYG_SRC), provenance: 'observed' },
      { key: 'teff', label: 'Temperature (from colour)', quantity: q(teff, 'K', 'derived', 2, HYG_SRC, 'ballesteros-2012@1'), provenance: 'derived', help: 'Blackbody temperature from B−V (Ballesteros 2012). A rendering aid, not a spectroscopic temperature.' },
      { key: 'luminosity', label: 'Luminosity', quantity: q(L, 'L_sun', 'derived', 2, HYG_SRC, 'bc-torres-2010@1'), provenance: 'derived', help: 'Bolometric luminosity from the absolute magnitude and the Flower (1996) / Torres (2010) bolometric correction.' },
      { key: 'radius', label: 'Radius', quantity: q(teff !== null ? cat.radiusRsun[i] : null, 'R_sun', 'derived', 2, HYG_SRC, 'stefan-boltzmann@1'), provenance: 'derived', help: 'From luminosity and temperature via the Stefan–Boltzmann law (R ∝ √L / T²).' },
    ];
    const ids: Fact[] = [];
    const idText = (key: string, label: string, v: string | number | null | undefined): void => {
      if (v !== null && v !== undefined && v !== '') ids.push({ key, label, text: String(v), provenance: 'observed', source: HYG_SRC });
    };
    if (row?.properName) idText('properName', 'Proper name', row.properName);
    idText('bayer', 'Bayer / Flamsteed', row?.bayerFlamsteed);
    idText('hip', 'Hipparcos', cat.hipOf[i] > 0 ? `HIP ${cat.hipOf[i]}` : null);
    idText('hd', 'Henry Draper', row?.hd ? `HD ${row.hd}` : null);
    idText('hr', 'Bright Star Catalogue', row?.hr ? `HR ${row.hr}` : null);
    idText('gl', 'Gliese', row?.gl);
    idText('constellation', 'Constellation', row?.constellation ? constByAbbr.get(row.constellation.toLowerCase())?.name ?? row.constellation : null);
    const sections: FactSheet['sections'] = [
      { id: 'properties', title: 'Properties', facts: props },
      { id: 'observations', title: 'Identifiers', facts: ids },
    ];
    if (sys && sys.members.length > 1) {
      sections.push({
        id: 'science',
        title: `Star system ${sys.base}`,
        facts: sys.members.map((m, k) => ({
          key: `member-${k}`,
          label: m.properName ?? m.gl ?? `Component ${k + 1}`,
          text: m.apparentMag !== null ? `magnitude ${m.apparentMag.toFixed(2)}` : 'magnitude Unknown',
          provenance: 'observed' as const,
          source: HYG_SRC,
        })),
      });
    }
    const ly = distPc * LIGHT_YEARS_PER_PC;
    const kindText = spectralClassText(row?.spectralType ?? null);
    const sources = [HYG_SRC];
    if (row?.properNameSource === 'iau-wgsn') sources.push(NAMES_SRC);
    return {
      entityId: id,
      summary: `${name} is a ${kindText} ${ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString('en')} light-years from the Sun. Its light left it ${ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString('en')} years ago.`,
      sections,
      representation: {
        provenance: 'derived',
        description: 'Point of light: brightness from the catalogue magnitude and your current distance, colour from B−V as a blackbody. Close-up: photosphere at the derived radius and temperature; the granulation pattern is illustrative.',
      },
      sources,
      epoch: { label: 'Positions J2000.0 (ICRS); proper motion not applied', iso: '2000-01-01T12:00:00Z', jd: 2_451_545 },
      missing: [teff === null ? 'Temperature' : '', bv === null ? 'Colour index' : '', row?.spectralType ? '' : 'Spectral type'].filter(Boolean),
      assumptions: ['No interstellar extinction correction.', 'Positions are not propagated from J2000 by proper motion.'],
    };
  }

  function buildConstellation(k: ConstellationRecord): Entity {
    const stars = new Set<number>();
    for (const [a, b] of k.lines) {
      const ia = d.hipToIndex.get(a), ib = d.hipToIndex.get(b);
      if (ia !== undefined) stars.add(ia);
      if (ib !== undefined) stars.add(ib);
    }
    let brightest = -1;
    let bm = 99;
    for (const i of stars) {
      const m = cat.absMag[i] + 5 * Math.log10(cat.distPc[i]) - 5;
      if (m < bm) {
        bm = m;
        brightest = i;
      }
    }
    const ra = (k.labelRaDeg * Math.PI) / 180, dec = (k.labelDecDeg * Math.PI) / 180;
    const R = 100 * PC_M;
    const pos = new THREE.Vector3(Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec)).multiplyScalar(R);
    const bName = brightest >= 0 ? displayName(d.namedByIndex.get(brightest), cat.hipOf[brightest]) : null;
    return {
      id: `const:${k.abbr}`,
      name: k.name,
      aliases: [k.abbr, k.genitive, ...(k.englishName ? [k.englishName] : [])],
      kind: 'constellation',
      domain: 'stars',
      parentId: null,
      radiusM: null,
      position: (_t, out) => out.copy(pos),
      tagline: k.englishName ? `Constellation — the ${k.englishName}` : 'Constellation',
      capabilities: ['sources', 'related'],
      importance: 35,
      representation: 'observed',
      facts: (): FactSheet => ({
        entityId: `const:${k.abbr}`,
        summary: `${k.name}${k.englishName ? ` (the ${k.englishName})` : ''} is one of the 88 constellations: a region of Earth’s sky, not a group of related stars. Its stars lie at very different distances, so the figure only holds from near the Sun.`,
        sections: [
          {
            id: 'properties',
            title: 'Properties',
            facts: [
              { key: 'abbr', label: 'IAU abbreviation', text: k.abbr, provenance: 'observed', source: IAU_NAMES_SRC },
              { key: 'genitive', label: 'Genitive', text: k.genitive, provenance: 'observed', source: IAU_NAMES_SRC },
              { key: 'area', label: 'Area of sky', quantity: q(k.areaDeg2, 'deg2', 'derived', 4, BOUNDS_SRC), provenance: 'derived' },
              { key: 'figureStars', label: 'Stars in the figure', quantity: q(stars.size || null, '', 'observed', 3, LINES_SRC), provenance: 'observed' },
              { key: 'brightest', label: 'Brightest figure star', text: bName ? `${bName} (mag ${bm.toFixed(2)})` : 'Unknown', provenance: 'observed', source: HYG_SRC },
            ],
          },
        ],
        representation: { provenance: 'observed', description: 'Figure lines join the real 3-D positions of the stars (Stellarium modern IAU figures); boundaries are the official IAU borders on the sky.' },
        sources: [IAU_NAMES_SRC, LINES_SRC, BOUNDS_SRC, HYG_SRC],
      }),
    };
  }

  function buildRecords(): SearchRecord[] {
    const out: SearchRecord[] = [];
    for (const row of d.named) {
      if (row.index === null) continue;
      const notable = row.properName || row.bayerFlamsteed || (row.gl && row.distPc !== null && row.distPc < 25);
      if (!notable) continue;
      const id = starIdForIndex(cat, row.index);
      if (!id) continue;
      const hip = cat.hipOf[row.index];
      const name = displayName(row, hip);
      const appMag = row.apparentMag ?? 99;
      out.push({
        id,
        name,
        aliases: aliasesFor(row, hip, name),
        kind: 'star',
        domain: 'stars',
        importance: row.properName ? Math.max(25, Math.min(80, 62 - 6 * appMag)) : Math.max(5, Math.min(30, 30 - 2 * appMag)),
        tagline: spectralClassText(row.spectralType),
      });
    }
    for (const k of d.constellations) {
      out.push({ id: `const:${k.abbr}`, name: k.name, aliases: [k.abbr, k.genitive, ...(k.englishName ? [k.englishName] : [])], kind: 'constellation', domain: 'stars', importance: 35, tagline: 'Constellation' });
    }
    return out;
  }

  return {
    domain: 'stars',
    resolve(id: string): Entity | undefined {
      const hit = cache.get(id);
      if (hit) return hit;
      let e: Entity | undefined;
      if (id.startsWith('const:')) {
        const k = constByAbbr.get(id.slice(6).toLowerCase());
        if (k) e = buildConstellation(k);
      } else if (id.startsWith('star:')) {
        const i = indexForStarId(cat, id);
        if (i >= 0 && starIdForIndex(cat, i) === id) e = buildStar(i);
      }
      if (e) cache.set(id, e);
      return e;
    },
    searchRecords(): readonly SearchRecord[] {
      records ??= buildRecords();
      return records;
    },
    resolveIdentifier(query: string): string[] {
      const s = query.trim();
      const m = /^(hip|hd|hr|gl|gj|gliese)\s*([0-9]+(?:\.[0-9]+)?\s*[a-z]?)$/i.exec(s);
      if (!m) return [];
      const cat2 = m[1].toLowerCase();
      let i: number | undefined;
      if (cat2 === 'hip') i = d.hipToIndex.get(Number(m[2]));
      else if (cat2 === 'hd') i = d.hdToIndex.get(Number(m[2]));
      else if (cat2 === 'hr') i = d.hrToIndex.get(Number(m[2]));
      else i = d.glToIndex.get(normalizeGl(m[2])) ?? d.glToIndex.get(normalizeGl(m[2]) + 'A');
      if (i === undefined) return [];
      const id = starIdForIndex(cat, i);
      return id ? [id] : [];
    },
  };
}

