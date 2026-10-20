/**
 * Shared galaxy-domain runtime: the Galactocentric frame, the S-star elements and the landmark catalogue (Messier +
 * globular clusters + curated nebulae/clusters/black holes), loaded once and shared by the entities and the layers.
 */
import { PC_M } from '../../core/units';
import { raDecDistToIcrs } from '../../core/frames';
import type { EntityKind } from '../../core/entity';
import {
  S2_GRAVITY2020, SGRA_DEC_DEG, SGRA_RA_DEG, buildGalacticFrame, decimalYear, metresPerMas, offsetMasToIcrs, sStarOffsetMas,
  skyBasisAt, worldToGalKpc, type GalacticFrame, type SStarElements, type SkyBasis, type V3,
} from './model';
import { loadLandmarks, loadMessier, loadSgra, parseSStars, type LandmarkJson, type MessierJson } from './data';

export interface LandmarkRecord {
  /** Entity id, e.g. 'mw:m13', 'mw:gc-ngc-104', 'mw:carina-nebula'. */
  id: string;
  name: string;
  aliases: string[];
  kind: EntityKind;
  /** Landmark/Messier type string ('globular-cluster', 'emission-nebula', …). */
  type: string;
  /** World position (ICRS m from the SSB). */
  world: V3;
  /** Galactocentric kpc. */
  gal: V3;
  distPc: number;
  importance: number;
  landmark: LandmarkJson | null;
  messier: MessierJson | null;
}

export interface GalaxyRuntime {
  frame: GalacticFrame;
  sky: SkyBasis;
  mPerMas: number;
  sStars: SStarElements[];
  landmarks: LandmarkRecord[];
  byId: Map<string, LandmarkRecord>;
  /** Resolves when sgra.json + landmarks + messier are in (rejections are swallowed: the runtime keeps defaults). */
  ready: Promise<void>;
  loaded: boolean;
  /** Bumped whenever the catalogues change (layers rebuild on change). */
  version: number;
  /** S-star world position (ICRS m from the SSB) at Unix ms. NaN when unbound. */
  sStarWorld(el: SStarElements, tMs: number, out: V3): V3;
}

const KIND_OF: Record<string, EntityKind | null> = {
  'emission-nebula': 'nebula', 'dark-nebula': 'nebula', 'planetary-nebula': 'nebula', 'supernova-remnant': 'nebula',
  'reflection-nebula': 'nebula', pulsar: 'star', 'star-forming-region': 'region', 'open-cluster': 'star-cluster',
  'globular-cluster': 'star-cluster', 'black-hole': 'black-hole', 'galactic-centre': null, galaxy: null, 'double-star': null,
  asterism: null,
};

const IMPORTANCE: Record<string, number> = {
  'emission-nebula': 45, 'planetary-nebula': 38, 'supernova-remnant': 45, 'dark-nebula': 35, 'reflection-nebula': 30, pulsar: 40,
  'star-forming-region': 35, 'open-cluster': 35, 'globular-cluster': 26, 'black-hole': 42,
};

let singleton: GalaxyRuntime | null = null;

export function galaxyRuntime(): GalaxyRuntime {
  if (singleton) return singleton;
  const frame = buildGalacticFrame();
  const sky = skyBasisAt(SGRA_RA_DEG, SGRA_DEC_DEG);
  const mPerMas = metresPerMas();
  const off: V3 = { x: 0, y: 0, z: 0 };
  const rt: GalaxyRuntime = {
    frame,
    sky,
    mPerMas,
    sStars: [S2_GRAVITY2020],
    landmarks: [],
    byId: new Map(),
    ready: Promise.resolve(),
    loaded: false,
    version: 0,
    sStarWorld(el, tMs, out) {
      sStarOffsetMas(el, decimalYear(tMs), off);
      offsetMasToIcrs(sky, off, mPerMas, out);
      out.x += frame.origin.x; out.y += frame.origin.y; out.z += frame.origin.z;
      return out;
    },
  };
  rt.ready = Promise.allSettled([loadSgra(), loadLandmarks(), loadMessier()]).then(([sg, lm, ms]) => {
    if (sg.status === 'fulfilled') rt.sStars = parseSStars(sg.value, S2_GRAVITY2020);
    rt.landmarks = buildLandmarks(frame, lm.status === 'fulfilled' ? lm.value.objects : [], ms.status === 'fulfilled' ? ms.value.objects : []);
    rt.byId = new Map(rt.landmarks.map((l) => [l.id, l]));
    rt.loaded = true;
    rt.version++;
  });
  singleton = rt;
  return rt;
}

const ngcKey = (s: string): string | null => {
  const m = /^(NGC|IC)\s*(\d+)/i.exec(s.trim());
  return m ? `${m[1]!.toLowerCase()}-${m[2]}` : null;
};
const mKey = (s: string): number | null => {
  const m = /^M\s*(\d+)$/i.exec(s.trim());
  return m ? Number(m[1]) : null;
};

/** Merge the curated landmarks and the galactic Messier objects into one list (one entity per physical object). */
export function buildLandmarks(frame: GalacticFrame, lms: readonly LandmarkJson[], mss: readonly MessierJson[]): LandmarkRecord[] {
  const byMessier = new Map<number, MessierJson>();
  const messierByNgc = new Map<string, MessierJson>();
  for (const m of mss) {
    byMessier.set(m.messier, m);
    for (const n of m.ngcIc) { const k = ngcKey(n); if (k) messierByNgc.set(k, m); }
  }
  const used = new Set<number>();
  const out: LandmarkRecord[] = [];
  const add = (l: LandmarkJson | null, m: MessierJson | null): void => {
    const type = l?.type ?? m!.type;
    const kind = KIND_OF[type] ?? null;
    if (!kind) return;
    const distPc = l?.distPc ?? m?.distPc ?? null;
    if (!(distPc !== null && distPc > 0)) return;
    const ra = l?.raDeg ?? m!.raDeg, dec = l?.decDeg ?? m!.decDeg;
    const world = raDecDistToIcrs(ra, dec, distPc * PC_M, { x: 0, y: 0, z: 0 });
    const gal = worldToGalKpc(frame, world, { x: 0, y: 0, z: 0 });
    const name = m ? (m.name ? `${m.name} (M${m.messier})` : `M${m.messier}`) : l!.name;
    const aliases = new Set<string>([...(l?.aliases ?? []), ...(m ? [m.designation, `M${m.messier}`, ...m.ngcIc, ...m.commonNames, ...m.aliases] : [])]);
    if (l && m) aliases.add(l.name);
    aliases.delete(name);
    const id = m ? `mw:m${m.messier}` : `mw:${l!.id}`;
    out.push({ id, name, aliases: [...aliases], kind, type, world, gal, distPc, importance: (IMPORTANCE[type] ?? 30) + (m ? 8 : 0), landmark: l, messier: m });
  };
  for (const l of lms) {
    if (l.type === 'galactic-centre') continue;
    let m: MessierJson | null = null;
    const direct = /^m(\d+)$/.exec(l.id);
    if (direct) m = byMessier.get(Number(direct[1])) ?? null;
    if (!m) for (const a of [l.name, ...l.aliases]) {
      const n = mKey(a) ?? mKey(a.replace(/[()]/g, ''));
      if (n !== null) { m = byMessier.get(n) ?? null; break; }
      const parts = /\(M\s*(\d+)\)/.exec(a);
      if (parts) { m = byMessier.get(Number(parts[1])) ?? null; break; }
    }
    if (!m) {
      const k = ngcKey(l.name) ?? ngcKey(l.id.replace(/^gc-/, '').replace('-', ' '));
      if (k) m = messierByNgc.get(k) ?? null;
    }
    if (m) used.add(m.messier);
    add(l, m);
  }
  for (const m of mss) if (!used.has(m.messier)) add(null, m);
  return out;
}
