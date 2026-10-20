/**
 * Entity provider: 'sys:<hostname>' (a planetary system, positioned at its host star) and 'exo:<pl_name>' (a planet
 * on its Keplerian orbit). Materialised lazily from the compact catalogue; fact sheets fetch the full archive rows.
 */
import * as THREE from 'three';
import { AU_M, PC_M } from '../../core/units';
import type { Capability, Entity, EntityProvider, SearchRecord } from '../../core/entity';
import { EXO_PREFIX, SYS_PREFIX, exoId, sysId, type ExoCatalog, type ExoIndex } from './catalog';
import { exoDetail } from './catalogClient';
import { planetFactSheet, systemFactSheet } from './facts';
import { VISUAL_TYPE_LABEL } from './physics';
import { getSystemModel, hostPlaceable, hostPosition, planetOffset, starOffsets } from './runtime';
import { SHOWCASE, SHOWCASE_BY_HOST } from './showcase';

const SYS_CAPS: Capability[] = ['focus', 'orbit', 'travel', 'bookmark', 'sources', 'related', 'experiment:habitability'];
const PLANET_CAPS: Capability[] = ['focus', 'orbit', 'follow', 'travel', 'show-orbit', 'bookmark', 'sources', 'related', 'experiment:habitability'];

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Inspect framing of a whole system: its widest orbit or habitable zone, whichever is larger. */
export function systemFramingM(c: ExoCatalog, host: number): number {
  const m = getSystemModel(c, host);
  const hzOut = m.hz.maximumGreenhouse.distanceM;
  return Math.max(m.extentM, Number.isFinite(hzOut) ? hzOut : 0, 20 * m.star.radiusM);
}

export function createExoProvider(c: ExoCatalog, index: ExoIndex): EntityProvider {
  const cache = new Map<string, Entity>();

  function systemEntity(host: number): Entity | undefined {
    if (!hostPlaceable(c, host)) return undefined;
    const name = c.hosts.name[host];
    const m = getSystemModel(c, host);
    const show = SHOWCASE_BY_HOST.get(name);
    const frame = systemFramingM(c, host);
    const dist = c.hosts.distPc[host];
    const id = sysId(name);
    return {
      id, name: show?.title ?? name,
      aliases: [name, ...(show?.aliases ?? []), c.hosts.hd[host], c.hosts.hip[host] > 0 ? `HIP ${c.hosts.hip[host]}` : ''].filter(Boolean),
      kind: 'stellar-system', domain: 'exoplanets', parentId: 'mw:galaxy',
      radiusM: m.star.radiusM,
      framingRadiusM: frame,
      position: (_t, out) => hostPosition(c, host, out),
      viewDistance: { min: 1.5 * m.star.radiusM, default: 2.6 * frame, max: 0.5 * PC_M },
      contextScaleMin: Math.log10(Math.max(dist, 1) * PC_M) - 0.5,
      tagline: show?.tagline ?? `${c.hosts.nPlanets[host]} known planet${c.hosts.nPlanets[host] === 1 ? '' : 's'} · ${c.hosts.spectype[host] || 'star'}`,
      capabilities: SYS_CAPS,
      importance: show?.importance ?? Math.min(40, 14 + 3 * c.hosts.nPlanets[host] + (dist < 20 ? 8 : 0)),
      representation: 'derived',
      facts: async () => systemFactSheet(id, m, await exoDetail(-1, host)),
    };
  }

  function planetEntity(i: number): Entity | undefined {
    const host = c.planets.host[i];
    if (host < 0 || !hostPlaceable(c, host)) return undefined;
    const m = getSystemModel(c, host);
    const p = m.planets.find((x) => x.index === i);
    if (!p) return undefined;
    const name = c.planets.name[i];
    const id = exoId(name);
    const show = SHOWCASE_BY_HOST.get(c.hosts.name[host]);
    return {
      id, name, aliases: [],
      kind: 'exoplanet', domain: 'exoplanets', parentId: sysId(c.hosts.name[host]),
      radiusM: p.radiusM,
      position(t, out) {
        // Planets orbit the barycentre (circumbinary) or the star; the star's reflex motion is ignored.
        hostPosition(c, host, out);
        planetOffset(m, p, t, tmpA);
        return out.add(tmpA);
      },
      viewDistance: { min: 1.25 * p.radiusM, default: 3.6 * p.radiusM, max: Math.max(3 * p.aM, 2 * AU_M) },
      contextScaleMin: Math.log10(Math.max(p.aM, p.radiusM * 10)) + 0.4,
      tagline: `${VISUAL_TYPE_LABEL[p.type]} · ${c.methodNames[c.planets.methodRaw[i]] || 'unknown method'}${c.planets.year[i] ? ` ${c.planets.year[i]}` : ''}`,
      capabilities: PLANET_CAPS,
      importance: show ? Math.max(30, show.importance - 6) : 12,
      representation: 'illustrative',
      facts: async () => planetFactSheet(id, m, p, await exoDetail(i, host)),
    };
  }

  const records: SearchRecord[] = [];
  for (let h = 0; h < c.hosts.count; h++) {
    if (!hostPlaceable(c, h)) continue;
    const name = c.hosts.name[h];
    const show = SHOWCASE_BY_HOST.get(name);
    records.push({
      id: sysId(name), name: show?.title ?? name,
      aliases: [name, ...(show?.aliases ?? []), c.hosts.hd[h]].filter(Boolean),
      kind: 'stellar-system', domain: 'exoplanets',
      importance: show?.importance ?? Math.min(40, 14 + 3 * c.hosts.nPlanets[h]),
      tagline: show?.tagline ?? `Planetary system · ${c.hosts.nPlanets[h]} planet${c.hosts.nPlanets[h] === 1 ? '' : 's'}`,
    });
  }
  for (let i = 0; i < c.planets.count; i++) {
    const h = c.planets.host[i];
    if (h < 0 || !hostPlaceable(c, h)) continue;
    const show = SHOWCASE_BY_HOST.has(c.hosts.name[h]);
    records.push({
      id: exoId(c.planets.name[i]), name: c.planets.name[i], aliases: [],
      kind: 'exoplanet', domain: 'exoplanets', importance: show ? 40 : 12,
      tagline: `Exoplanet · ${c.methodNames[c.planets.methodRaw[i]] || ''} ${c.planets.year[i] || ''}`.trim(),
    });
  }

  return {
    domain: 'exoplanets',
    resolve(id) {
      let e = cache.get(id);
      if (e) return e;
      if (id.startsWith(SYS_PREFIX)) {
        const h = index.hostByName.get(id.slice(SYS_PREFIX.length));
        if (h !== undefined) e = systemEntity(h);
      } else if (id.startsWith(EXO_PREFIX)) {
        const i = index.planetByName.get(id.slice(EXO_PREFIX.length));
        if (i !== undefined) e = planetEntity(i);
      }
      if (e) cache.set(id, e);
      return e;
    },
    searchRecords: () => records,
    resolveIdentifier(q) {
      const k = q.trim().toLowerCase().replace(/\s+/g, ' ');
      const out: string[] = [];
      const h = index.hostAlias.get(k) ?? index.hostAlias.get(k.replace(/^gliese /, 'gj ')) ?? SHOWCASE_ALIAS.get(k);
      if (h !== undefined) out.push(sysId(c.hosts.name[h]));
      for (const [name, i] of index.planetByName) if (name.toLowerCase() === k) out.push(exoId(c.planets.name[i]));
      return out;
    },
  };
}

const SHOWCASE_ALIAS = new Map<string, number>();
/** Fill the showcase alias table once the index exists (e.g. "proxima centauri" → host index). */
export function indexShowcaseAliases(index: ExoIndex): void {
  for (const s of SHOWCASE) {
    const h = index.hostByName.get(s.host);
    if (h === undefined) continue;
    SHOWCASE_ALIAS.set(s.title.toLowerCase(), h);
    for (const a of s.aliases) SHOWCASE_ALIAS.set(a.toLowerCase(), h);
  }
}

/** World position of a star in a system (0 = primary, 1 = companion). */
export function starWorldPosition(c: ExoCatalog, host: number, which: 0 | 1, tMs: number, out: THREE.Vector3): THREE.Vector3 {
  const m = getSystemModel(c, host);
  hostPosition(c, host, out);
  starOffsets(m, tMs, tmpA, tmpB);
  return out.add(which === 0 ? tmpA : tmpB);
}
