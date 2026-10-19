/** Star entity ids and display names ('star:hip:<n>', or 'star:hyg:<id>' for named stars without a HIP number). */
import type { StarCatalog, NamedStar } from './catalog';

export function starIdForIndex(cat: StarCatalog, i: number): string | null {
  const hip = cat.hipOf[i];
  if (hip > 0) return `star:hip:${hip}`;
  const row = cat.details?.namedByIndex.get(i);
  return row && row.hygId !== null ? `star:hyg:${row.hygId}` : null;
}

/** Star index for an entity id, or −1 (unknown id, or a star the catalogue cannot place in 3-D). */
export function indexForStarId(cat: StarCatalog, id: string): number {
  if (id.startsWith('star:hip:')) {
    const hip = Number(id.slice(9));
    return cat.details?.hipToIndex.get(hip) ?? -1;
  }
  if (id.startsWith('star:hyg:')) {
    const row = cat.details?.namedByHyg.get(Number(id.slice(9)));
    return row && row.index !== null ? row.index : -1;
  }
  return -1;
}

/** Bayer designation without the Flamsteed number ("9 α CMa" → "α CMa"); Flamsteed-only kept ("61 Cyg"). */
export function bayerShort(bf: string | null): string | null {
  if (!bf) return null;
  const m = /^\d+\s+(\S.*)$/.exec(bf.trim());
  return m && /[^\x00-\x7f]/.test(m[1]) ? m[1] : bf.trim();
}

export function displayName(row: NamedStar | undefined, hip: number): string {
  if (row?.properName) return row.properName;
  const b = bayerShort(row?.bayerFlamsteed ?? null);
  if (b) return b;
  if (row?.gl) return row.gl.replace(/^Gl\s*/, 'Gliese ');
  if (hip > 0) return `HIP ${hip}`;
  if (row?.hd) return `HD ${row.hd}`;
  return 'Star';
}
