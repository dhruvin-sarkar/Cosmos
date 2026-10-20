/** Full archive rows for one planet / host, as field → value records, plus the literature references they cite. */
import type { RawTable } from './catalog';

export interface DetailTables {
  planets: RawTable;
  systems: RawTable;
  refs: RawTable;
}

export interface RefInfo {
  label: string;
  url: string | null;
  kind: string;
}

export interface ExoDetail {
  planet: Record<string, unknown> | null;
  host: Record<string, unknown> | null;
  refs: Record<number, RefInfo>;
}

function record(t: RawTable, i: number): Record<string, unknown> | null {
  const r = t.rows[i];
  if (!r) return null;
  const o: Record<string, unknown> = {};
  for (let k = 0; k < t.fields.length; k++) o[t.fields[k]] = r[k];
  return o;
}

export function detailFor(t: DetailTables, planet: number, host: number): ExoDetail {
  const p = planet >= 0 ? record(t.planets, planet) : null;
  const h = host >= 0 ? record(t.systems, host) : null;
  const refs: Record<number, RefInfo> = {};
  const fl = t.refs.fields;
  const iLabel = fl.indexOf('label'), iUrl = fl.indexOf('url'), iKind = fl.indexOf('kind');
  for (const rec of [p, h]) {
    if (!rec) continue;
    for (const [k, v] of Object.entries(rec)) {
      if (!k.endsWith('_refIdx') || typeof v !== 'number' || refs[v]) continue;
      const row = t.refs.rows[v];
      if (row) refs[v] = { label: String(row[iLabel] ?? ''), url: typeof row[iUrl] === 'string' ? (row[iUrl] as string) : null, kind: String(row[iKind] ?? '') };
    }
  }
  return { planet: p, host: h, refs };
}
