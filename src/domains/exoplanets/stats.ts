/**
 * Explorer statistics over the compact catalogue (pure, allocation only on demand): counts by discovery method and by
 * year, filter predicates shared with the marker field, and a search over planet / host names and aliases.
 */
import { METHOD_GROUPS, type ExoCatalog, type ExoIndex } from './catalog';

export interface ExoFilter {
  methodMask: number;
  yearMin: number;
  yearMax: number;
}

/** Planet passes the method / year filter (unknown year passes only an unrestricted range). */
export function planetPasses(c: ExoCatalog, i: number, f: ExoFilter, fullRange: [number, number]): boolean {
  if (!((f.methodMask >> c.planets.method[i]) & 1)) return false;
  const y = c.planets.year[i];
  if (y === 0) return f.yearMin <= fullRange[0] && f.yearMax >= fullRange[1];
  return y >= f.yearMin && y <= f.yearMax;
}

export interface MethodYearCounts {
  /** Planets per method group (METHOD_GROUPS order). */
  byMethod: number[];
  /** First year of `byYear`. */
  year0: number;
  /** byYear[y − year0][method] = planets discovered that year by that method. */
  byYear: number[][];
  total: number;
  hosts: number;
}

export function countByMethodYear(c: ExoCatalog, f: ExoFilter, fullRange: [number, number]): MethodYearCounts {
  const nM = METHOD_GROUPS.length;
  const byMethod = new Array<number>(nM).fill(0);
  const year0 = fullRange[0];
  const byYear: number[][] = [];
  for (let y = fullRange[0]; y <= fullRange[1]; y++) byYear.push(new Array<number>(nM).fill(0));
  const hostSeen = new Uint8Array(c.hosts.count);
  let total = 0;
  let hosts = 0;
  for (let i = 0; i < c.planets.count; i++) {
    if (!planetPasses(c, i, f, fullRange)) continue;
    const m = c.planets.method[i];
    byMethod[m]++;
    total++;
    const y = c.planets.year[i];
    if (y >= year0 && y - year0 < byYear.length) byYear[y - year0][m]++;
    const h = c.planets.host[i];
    if (h >= 0 && !hostSeen[h]) {
      hostSeen[h] = 1;
      hosts++;
    }
  }
  return { byMethod, year0, byYear, total, hosts };
}

export interface SearchHit {
  kind: 'system' | 'planet';
  host: number;
  planet: number;
  label: string;
  detail: string;
}

/** Case-insensitive search: exact alias / name first, then prefix, then substring. At most `limit` hits. */
export function searchExo(c: ExoCatalog, index: ExoIndex, query: string, limit = 8): SearchHit[] {
  const q = query.trim().toLowerCase();
  if (q.length < 2) return [];
  const hits: SearchHit[] = [];
  const seen = new Set<string>();
  const push = (h: SearchHit): void => {
    const k = `${h.kind}:${h.host}:${h.planet}`;
    if (seen.has(k) || hits.length >= limit) return;
    seen.add(k);
    hits.push(h);
  };
  const sys = (host: number): SearchHit => ({
    kind: 'system', host, planet: -1, label: c.hosts.name[host],
    detail: `${c.hosts.nPlanets[host]} planet${c.hosts.nPlanets[host] === 1 ? '' : 's'}${Number.isFinite(c.hosts.distPc[host]) ? ` · ${(c.hosts.distPc[host] * 3.2616).toPrecision(3)} ly` : ''}`,
  });
  const alias = index.hostAlias.get(q);
  if (alias != null) push(sys(alias));
  const pExact = index.planetByName.get(query.trim());
  if (pExact != null) push({ kind: 'planet', host: c.planets.host[pExact], planet: pExact, label: c.planets.name[pExact], detail: 'Planet' });
  // Prefix then substring passes over hosts, then planets.
  for (const pass of [0, 1]) {
    for (let h = 0; h < c.hosts.count && hits.length < limit; h++) {
      const n = c.hosts.name[h].toLowerCase();
      if (pass === 0 ? n.startsWith(q) : n.includes(q)) push(sys(h));
    }
    for (let i = 0; i < c.planets.count && hits.length < limit; i++) {
      const n = c.planets.name[i].toLowerCase();
      if (pass === 0 ? n.startsWith(q) : n.includes(q)) {
        push({ kind: 'planet', host: c.planets.host[i], planet: i, label: c.planets.name[i], detail: `Planet · ${c.planets.year[i] || 'year unknown'}` });
      }
    }
  }
  return hits;
}
