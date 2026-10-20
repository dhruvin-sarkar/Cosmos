/**
 * VRAM residency bookkeeping for HD texture tiers (pure logic; the TextureManager drives it once per tick).
 *
 * Each evictable HD texture is a Resident: its byte cost, the frame it was last drawn on (tracked by the manager),
 * and an optional on-screen priority (the body's disc size in px). When the resident total exceeds the budget the
 * least valuable tiers are dropped back to their preview tier; an evicted tier comes back once its body is drawn
 * again, large enough, and the budget has room.
 */

export interface ResidentState {
  id: number;
  bytes: number;
  /** Frame number the texture (or, once evicted, its preview) was last drawn on; -1 = never. */
  lastUsed: number;
  /** On-screen size in px (null = unknown). */
  priority: number | null;
  evicted: boolean;
}

/** Per-preset budget for HD tiers (bytes). The Balanced preset's 'high' leaves room on a 4 GB laptop GPU. */
export const HD_BUDGET_BYTES: Record<'low' | 'high' | 'ultra', number> = {
  low: 320 * 2 ** 20,
  high: 900 * 2 ** 20,
  ultra: 1600 * 2 ** 20,
};

/** Frames without a draw after which a tier counts as unused. */
export const IDLE_FRAMES = 90;
/** Below this on-screen size an HD tier is not needed (the preview tier is sharp enough). */
export const SMALL_PX = 96;
/** Restore an evicted tier only once its body is this large again. */
export const RESTORE_PX = 180;

/**
 * Pick the residents to evict so the total fits in `budget` (with 10% headroom once eviction starts).
 * Order: idle tiers first (oldest draw first), then drawn-but-small tiers (smallest first). Tiers drawn recently
 * with an unknown or large on-screen size are never evicted.
 */
export function chooseEvictions<T extends ResidentState>(residents: readonly T[], budget: number, frame: number): T[] {
  const live = residents.filter(r => !r.evicted);
  let total = live.reduce((s, r) => s + r.bytes, 0);
  if (total <= budget) return [];
  const target = budget * 0.9;
  const idle = live.filter(r => frame - r.lastUsed > IDLE_FRAMES).sort((a, b) => a.lastUsed - b.lastUsed);
  const small = live
    .filter(r => frame - r.lastUsed <= IDLE_FRAMES && r.priority !== null && r.priority < SMALL_PX)
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
  const out: T[] = [];
  for (const r of [...idle, ...small]) {
    if (total <= target) break;
    out.push(r);
    total -= r.bytes;
  }
  return out;
}

/** The evicted tier most worth restoring now (drawn this tick, large on screen, fits in the budget), or null. */
export function chooseRestore<T extends ResidentState>(residents: readonly T[], budget: number, frame: number): T | null {
  const total = residents.reduce((s, r) => s + (r.evicted ? 0 : r.bytes), 0);
  let best: T | null = null;
  for (const r of residents) {
    if (!r.evicted || frame - r.lastUsed > 2) continue;
    if (r.priority !== null && r.priority < RESTORE_PX) continue;
    if (total + r.bytes > budget) continue;
    if (!best || (r.priority ?? Infinity) > (best.priority ?? Infinity)) best = r;
  }
  return best;
}
