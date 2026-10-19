/**
 * Catalog-backed entities: any tracked object resolves lazily as 'sat:<norad>' (name, class, orbit and provenance
 * from the CelesTrak snapshot), plus two group entities with fact sheets: 'sat:group:starlink' (the Starlink
 * constellation, highlighted when selected) and 'sat:group:tracked' (the whole tracked population / debris field).
 */
import * as THREE from 'three';
import type { Entity, EntityKind, EntityProvider } from '../../core/entity';
import type { Fact, FactSheet, SourceRef } from '../../data/provenance';
import { derived, observed } from '../../data/provenance';
import {
  CLASS_MASK, CLASS_PAYLOAD, F, FLAG_ACTIVE, FLAG_RECONSTRUCTED, FLAG_STARLINK, REGIME_NAMES, type CatalogRow,
} from './catalogTypes';
import { ELEMENT_STRIDE } from './kepler';
import { GP_SOURCE, SATCAT_SOURCE } from './notable';
import type { Population } from './population';
import { R_EARTH_EQ_M, R_EARTH_M, earthDrawPosition, offsetScale } from './scene';

const STATS_SOURCE: SourceRef = { datasetId: 'orbital-population-statistics', reference: 'Cosmos orbital build (scripts/data/orbital/build.mjs) from CelesTrak GP + SATCAT' };
const CLASS_LABEL = ['Payload', 'Rocket body', 'Debris', 'Unknown'];
const CLASS_KIND: EntityKind[] = ['satellite', 'rocket-body', 'debris', 'debris'];

function baseUrl(): string {
  return (import.meta.env?.BASE_URL as string | undefined) ?? '/';
}

let lookups: Promise<{ ownerCodes?: Record<string, unknown> } | null> | null = null;
function loadLookups(): Promise<{ ownerCodes?: Record<string, unknown> } | null> {
  lookups ??= fetch(`${baseUrl()}data/orbital/lookups.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return lookups;
}
let summary: Promise<Record<string, unknown> | null> | null = null;
function loadSummary(): Promise<Record<string, unknown> | null> {
  summary ??= fetch(`${baseUrl()}data/orbital/summary.json`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return summary;
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function ownerName(codes: Record<string, unknown> | undefined, code: string | null): string | null {
  if (!code) return null;
  const e = codes?.[code];
  if (typeof e === 'string') return `${e} (${code})`;
  if (e && typeof e === 'object' && 'name' in e) return `${String((e as { name: unknown }).name)} (${code})`;
  return code;
}

async function objectSheet(pop: Population, i: number, id: string): Promise<FactSheet> {
  const [row, lk] = await Promise.all([pop.row(i), loadLookups()]);
  const meta = pop.meta;
  const flags = meta?.flags[i] ?? 0;
  const cls = flags & CLASS_MASK;
  const reconstructed = (flags & FLAG_RECONSTRUCTED) !== 0;
  const r = row ?? ([] as CatalogRow);
  const overview: Fact[] = [
    { key: 'class', label: 'Object class', text: CLASS_LABEL[cls], provenance: 'observed', source: SATCAT_SOURCE },
    { key: 'norad', label: 'NORAD catalog number', text: String(meta?.norad[i] ?? ''), provenance: 'observed', source: SATCAT_SOURCE },
    { key: 'status', label: 'Status', text: flags & FLAG_ACTIVE ? 'Active' : r[F.isActive] === false ? 'Inactive' : 'Unknown', provenance: 'observed', source: SATCAT_SOURCE },
  ];
  if (r[F.intlDes]) overview.push({ key: 'cospar', label: 'International designator', text: String(r[F.intlDes]), provenance: 'observed', source: SATCAT_SOURCE });
  const owner = ownerName(lk?.ownerCodes, (r[F.owner] as string | null) ?? null);
  overview.push({ key: 'owner', label: 'Owner (SATCAT source code)', text: owner ?? 'Unknown', provenance: 'observed', source: SATCAT_SOURCE });
  overview.push({ key: 'launch', label: 'Launch date', text: r[F.launchDate] ? String(r[F.launchDate]) : 'Unknown', provenance: 'observed', source: SATCAT_SOURCE });
  if (r[F.rcsSize]) overview.push({ key: 'rcs', label: 'Radar size class', text: String(r[F.rcsSize]), provenance: 'observed', source: SATCAT_SOURCE });
  const src = reconstructed ? SATCAT_SOURCE : GP_SOURCE;
  const orbit: Fact[] = [
    { key: 'regime', label: 'Orbit regime', text: REGIME_NAMES[meta?.regime[i] ?? 4], provenance: 'derived', source: STATS_SOURCE },
    { key: 'perigee', label: 'Perigee altitude', quantity: observed(num(r[F.perigeeKm]), 'km', src), provenance: 'observed' },
    { key: 'apogee', label: 'Apogee altitude', quantity: observed(num(r[F.apogeeKm]), 'km', src), provenance: 'observed' },
    { key: 'inc', label: 'Inclination', quantity: observed(num(r[F.inc]), 'deg', src), provenance: 'observed' },
    { key: 'period', label: 'Orbital period', quantity: observed(num(r[F.periodMin]), 'min', src), provenance: 'observed' },
  ];
  const sheet: FactSheet = {
    entityId: id,
    summary: `${meta?.names[i] ?? id}: a tracked ${CLASS_LABEL[cls].toLowerCase()} in ${REGIME_NAMES[meta?.regime[i] ?? 4]}, one of ${meta?.count.toLocaleString('en-US') ?? 'about 35,000'} catalogued objects in Earth orbit.`,
    sections: [
      { id: 'overview', title: 'Overview', facts: overview },
      { id: 'orbit', title: 'Orbit', facts: orbit, paragraphs: [reconstructed
        ? 'No public element set: only the orbit shape (perigee, apogee, inclination) is known. The orbit orientation and the position along it are illustrative.'
        : 'Mean-element orbit from the CelesTrak GP snapshot, propagated with SGP4 (≈1 km at epoch, degrading by km per day).'] },
    ],
    representation: { provenance: reconstructed ? 'reconstructed' : 'observed', description: reconstructed ? 'Point on a reconstructed orbit (shape real, placement illustrative).' : 'Point at the SGP4-propagated position.' },
    sources: [src, SATCAT_SOURCE],
  };
  if (r[F.epochUTC]) sheet.epoch = { label: 'Orbital elements epoch', iso: String(r[F.epochUTC]) };
  return sheet;
}

/** Starlink shells from the live element buffer: counts and median altitude by inclination bin. */
function starlinkShells(pop: Population): { count: number; shells: { incDeg: number; n: number; altKm: number }[] } {
  const meta = pop.meta, el = pop.elements;
  if (!meta || !el) return { count: 0, shells: [] };
  const bins = new Map<number, number[]>();
  let count = 0;
  for (let i = 0; i < meta.count; i++) {
    if (!(meta.flags[i] & FLAG_STARLINK)) continue;
    count++;
    const o = i * ELEMENT_STRIDE;
    if (!(el[o + 8] > 0)) continue;
    const px = el[o], py = el[o + 1], pz = el[o + 2], qx = el[o + 3], qy = el[o + 4], qz = el[o + 5];
    const hx = py * qz - pz * qy, hy = pz * qx - px * qz, hz = px * qy - py * qx;
    const inc = (Math.acos(hz / Math.hypot(hx, hy, hz)) * 180) / Math.PI;
    const key = Math.round(inc);
    const alt = (Math.hypot(px, py, pz) - R_EARTH_EQ_M) / 1000;
    let b = bins.get(key);
    if (!b) bins.set(key, (b = []));
    b.push(alt);
  }
  const shells = [...bins.entries()]
    .filter(([, a]) => a.length >= 20)
    .map(([incDeg, a]) => { a.sort((x, y) => x - y); return { incDeg, n: a.length, altKm: Math.round(a[a.length >> 1]) }; })
    .sort((a, b) => b.n - a.n);
  return { count, shells };
}

export interface OrbitalProvider extends EntityProvider {
  groups: Entity[];
}

export function createOrbitalProvider(pop: Population, heroIds: ReadonlyMap<number, string>, resolveHero: (id: string) => Entity | undefined): OrbitalProvider {
  const cache = new Map<string, Entity>();
  const rel = new THREE.Vector3();

  function objectEntity(i: number): Entity {
    const meta = pop.meta!;
    const norad = meta.norad[i];
    const id = `sat:${norad}`;
    const flags = meta.flags[i];
    const cls = flags & CLASS_MASK;
    return {
      id,
      name: meta.names[i],
      aliases: [`NORAD ${norad}`, String(norad)],
      kind: CLASS_KIND[cls],
      domain: 'orbital',
      parentId: 'sol:earth',
      radiusM: null,
      position(tMs, out) {
        earthDrawPosition(tMs, out);
        if (pop.position(i, tMs, rel)) out.addScaledVector(rel, offsetScale(rel.length()));
        return out;
      },
      velocity(tMs, out) {
        if (pop.velocity(i, tMs, out) && pop.position(i, tMs, rel)) out.multiplyScalar(offsetScale(rel.length())); else out.set(0, 0, 0);
        return out;
      },
      viewDistance: { min: 20, default: 400, max: 5e7 },
      contextScaleMin: Math.log10(R_EARTH_M * 1.5),
      tagline: `Tracked ${CLASS_LABEL[cls].toLowerCase()} · NORAD ${norad}`,
      capabilities: ['focus', 'orbit', 'follow', 'travel', 'sources', 'experiment:debris'],
      importance: cls === CLASS_PAYLOAD ? 8 : 4,
      representation: flags & FLAG_RECONSTRUCTED ? 'reconstructed' : 'observed',
      facts: () => objectSheet(pop, i, id),
    };
  }

  const starlink: Entity = {
    id: 'sat:group:starlink',
    name: 'Starlink constellation',
    aliases: ['Starlink', 'SpaceX Starlink'],
    kind: 'reference',
    domain: 'orbital',
    parentId: 'sol:earth',
    radiusM: R_EARTH_M + 560e3,
    position: (tMs, out) => earthDrawPosition(tMs, out),
    framingRadiusM: R_EARTH_M + 600e3,
    viewDistance: { min: R_EARTH_M * 1.6, default: R_EARTH_M * 3.6, max: R_EARTH_M * 30 },
    tagline: 'SpaceX\'s broadband constellation: the largest satellite fleet ever flown',
    capabilities: ['focus', 'orbit', 'travel', 'sources'],
    importance: 55,
    representation: 'observed',
    facts: async () => {
      const { count, shells } = starlinkShells(pop);
      const facts: Fact[] = [
        { key: 'count', label: 'Starlink satellites in the catalog', quantity: derived(count || null, '', 'catalog-count@1', GP_SOURCE), provenance: 'derived' },
        { key: 'operator', label: 'Operator', text: 'SpaceX', provenance: 'observed', source: SATCAT_SOURCE },
      ];
      for (const s of shells.slice(0, 6)) {
        facts.push({ key: `shell-${s.incDeg}`, label: `Shell at ${s.incDeg}° inclination`, text: `${s.n.toLocaleString('en-US')} satellites, median altitude ${s.altKm} km`, provenance: 'derived', source: GP_SOURCE });
      }
      return {
        entityId: 'sat:group:starlink',
        summary: 'Thousands of flat-panel broadband satellites in shells about 340–570 km up. Selecting the constellation highlights every Starlink satellite in the tracked-object cloud.',
        sections: [{ id: 'overview', title: 'Constellation', facts, paragraphs: ['Shells are grouped here by rounded inclination from the live SGP4 states; altitudes are medians of the osculating semi-major axis above a 6378 km Earth.'] }],
        representation: { provenance: 'observed', description: 'Each point is a real Starlink satellite at its SGP4-propagated position.' },
        sources: [GP_SOURCE, SATCAT_SOURCE],
      };
    },
  };

  const tracked: Entity = {
    id: 'sat:group:tracked',
    name: 'Tracked objects in Earth orbit',
    aliases: ['Space debris', 'Orbital debris', 'Debris field', 'Satellites'],
    kind: 'reference',
    domain: 'orbital',
    parentId: 'sol:earth',
    radiusM: 42_164e3,
    position: (tMs, out) => earthDrawPosition(tMs, out),
    framingRadiusM: 44_000e3,
    viewDistance: { min: R_EARTH_M * 2, default: R_EARTH_M * 16, max: 1e9 },
    tagline: 'Every catalogued satellite, rocket body and debris fragment around Earth',
    capabilities: ['focus', 'orbit', 'travel', 'sources', 'experiment:debris'],
    importance: 50,
    representation: 'observed',
    facts: async () => {
      const s = (await loadSummary()) as { counts?: Record<string, unknown>; referenceFigures?: Record<string, Record<string, unknown>> } | null;
      const c = (s?.counts ?? {}) as { total?: number; active?: number; byClass?: Record<string, number>; byRegime?: Record<string, number> };
      const esa = s?.referenceFigures?.esaSpaceDebrisByTheNumbers ?? {};
      const q = (v: unknown) => observed(num(v), '', STATS_SOURCE);
      const facts: Fact[] = [
        { key: 'total', label: 'Tracked objects in this snapshot', quantity: q(c.total), provenance: 'observed' },
        { key: 'active', label: 'Active satellites', quantity: q(c.active), provenance: 'observed' },
        { key: 'payload', label: 'Payloads (satellites)', quantity: q(c.byClass?.payload), provenance: 'observed' },
        { key: 'rb', label: 'Rocket bodies', quantity: q(c.byClass?.['rocket-body']), provenance: 'observed' },
        { key: 'debris', label: 'Debris fragments', quantity: q(c.byClass?.debris), provenance: 'observed' },
        { key: 'leo', label: 'In low Earth orbit (< 2000 km)', quantity: q(c.byRegime?.LEO), provenance: 'derived' },
        { key: 'meo', label: 'In medium Earth orbit (GNSS)', quantity: q(c.byRegime?.MEO), provenance: 'derived' },
        { key: 'geo', label: 'In the geostationary belt', quantity: q(c.byRegime?.GEO), provenance: 'derived' },
      ];
      const ctx: Fact[] = [];
      const esaSrc: SourceRef = { datasetId: 'orbital-population-statistics', reference: 'ESA Space Debris Office, "Space environment statistics" (sdup.esoc.esa.int/discosweb/statistics)' };
      if (num(esa.masterModelObjectsLargerThan10cm) != null) ctx.push({ key: 'esa10', label: 'Estimated objects > 10 cm (ESA MASTER-8)', quantity: observed(num(esa.masterModelObjectsLargerThan10cm), '', esaSrc), provenance: 'reconstructed' });
      if (num(esa.masterModelObjects1to10cm) != null) ctx.push({ key: 'esa1', label: 'Estimated objects 1–10 cm', quantity: observed(num(esa.masterModelObjects1to10cm), '', esaSrc), provenance: 'reconstructed' });
      if (num(esa.masterModelObjects1mmTo1cm) != null) ctx.push({ key: 'esa01', label: 'Estimated objects 1 mm – 1 cm', quantity: observed(num(esa.masterModelObjects1mmTo1cm), '', esaSrc), provenance: 'reconstructed' });
      if (num(esa.totalMassInOrbitTonnes) != null) ctx.push({ key: 'mass', label: 'Total mass in orbit', quantity: observed(num(esa.totalMassInOrbitTonnes), 't', esaSrc), provenance: 'reconstructed' });
      return {
        entityId: 'sat:group:tracked',
        summary: 'Every object large enough to be tracked by radar (about 10 cm and up), propagated to the current time. Blue: satellites; amber: spent rocket stages; red: debris fragments. Most crowd low Earth orbit; navigation satellites form a shell near 20,000 km and geostationary satellites a thin ring at 35,786 km.',
        sections: [
          { id: 'overview', title: 'Tracked population', facts },
          ...(ctx.length ? [{ id: 'science', title: 'The untracked majority', facts: ctx, paragraphs: ['The public catalogue sees only objects larger than about 10 cm. Statistical models estimate far more smaller fragments, each still able to damage a spacecraft at ~10 km/s.'] }] : []),
        ],
        representation: { provenance: 'observed', description: 'Points at SGP4-propagated positions (CelesTrak GP); ~10 % with only an orbit shape are placed illustratively along their real orbit shape. Points are not to scale.' },
        sources: [GP_SOURCE, SATCAT_SOURCE, STATS_SOURCE],
      };
    },
  };

  return {
    domain: 'orbital',
    groups: [starlink, tracked],
    resolve(id) {
      if (!id.startsWith('sat:') || id.startsWith('sat:group:')) return undefined;
      const norad = Number(id.slice(4));
      if (!Number.isInteger(norad)) return undefined;
      const hero = heroIds.get(norad);
      if (hero) return resolveHero(hero);
      const i = pop.indexOfNorad(norad);
      if (i < 0) return undefined;
      let e = cache.get(id);
      if (!e) {
        e = objectEntity(i);
        cache.set(id, e);
      }
      return e;
    },
    searchRecords: () => [],
    resolveIdentifier(query) {
      const m = /^\s*(?:norad\s*(?:id)?\s*#?\s*)?(\d{1,9})\s*$/i.exec(query);
      if (!m) return [];
      const norad = Number(m[1]);
      const hero = heroIds.get(norad);
      if (hero) return [hero];
      return pop.indexOfNorad(norad) >= 0 ? [`sat:${norad}`] : [];
    },
  };
}

