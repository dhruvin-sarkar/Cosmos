/**
 * Texture resolver for the solar domain: public/textures/index.json (data team) + public/textures/hd.json (HD
 * overlay) when present, else the file convention. Loads the low tier first, then the best tier the
 * QualityProfile allows (ultra 8K, high 4K, low 1K/2K), handing each texture to `apply` as it arrives (materials
 * just rebind a uniform). Never throws; a missing tier keeps the previous one (or the material's flat colour).
 * Textures belong to the engine's AssetLoader cache, which disposes them.
 */
import * as THREE from 'three';
import type { AssetLoader, QualityProfile } from '../../core/types';
import { getTextureManager } from '../../core/textures';

type Tier = 'low' | 'high' | 'ultra';
type TierPaths = Partial<Record<string, string>>;

interface TextureIndex {
  bodies?: Record<string, Record<string, TierPaths>>;
}
interface HdIndex {
  bodies?: Record<string, Record<string, unknown>>;
}

let indexPromise: Promise<{ index: TextureIndex | null; hd: HdIndex | null }> | null = null;

function loadIndexes(assets: AssetLoader): Promise<{ index: TextureIndex | null; hd: HdIndex | null }> {
  if (!indexPromise) {
    const get = <T,>(p: string): Promise<T | null> => assets.json<T>(p).catch(() => null);
    indexPromise = Promise.all([get<TextureIndex>('textures/index.json'), get<HdIndex>('textures/hd.json')]).then(([index, hd]) => ({ index, hd }));
  }
  return indexPromise;
}

/** Ordered tiers to load: [preview, best] (deduplicated). Exported for tests. */
export async function texturePlan(assets: AssetLoader, body: string, role: string, quality: QualityProfile['textureQuality']): Promise<string[]> {
  return (await texturePlanInfo(assets, body, role, quality)).paths;
}

/** Plan plus the set of paths that come from hd.json (albedo-calibrated HD maps). */
export async function texturePlanInfo(assets: AssetLoader, body: string, role: string, quality: QualityProfile['textureQuality']): Promise<{ paths: string[]; hd: Set<string> }> {
  const { index, hd } = await loadIndexes(assets);
  const idx = index?.bodies?.[body]?.[role];
  const hdRole = hd?.bodies?.[body]?.[role] as TierPaths | undefined;
  const best: string[] = [];
  const hdPaths = new Set<string>();
  if (hdRole && typeof hdRole === 'object') {
    if (quality === 'ultra' && typeof hdRole['8k'] === 'string') best.push(hdRole['8k']);
    if (quality !== 'low' && typeof hdRole['4k'] === 'string') best.push(hdRole['4k']);
    for (const p of best) hdPaths.add(p);
  }
  const rank: Tier[] = quality === 'ultra' ? ['ultra', 'high', 'low'] : quality === 'high' ? ['high', 'low'] : ['low'];
  if (idx) for (const t of rank) if (idx[t]) best.push(idx[t]!);
  // Preview: the index's low tier, else hd.json's own small tier (fast first frame; JPEG, so pixel reads work).
  const hdSmall = hdRole && typeof hdRole === 'object' ? (typeof hdRole['1k'] === 'string' ? hdRole['1k'] : typeof hdRole['2k'] === 'string' ? hdRole['2k'] : undefined) : undefined;
  let preview = idx?.low ?? hdSmall ?? idx?.high;
  if (!index) {
    // No index: the documented file convention.
    const ext = role === 'normal' || role === 'rings' || role === 'coverage' ? 'png' : 'jpg';
    preview = `textures/${body}/${role}_${role === 'rings' ? '2k' : '1k'}.${ext}`;
    if (quality !== 'low') best.push(`textures/${body}/${role}_${role === 'rings' ? '8k' : '4k'}.${ext}`);
  }
  const plan: string[] = [];
  if (preview) plan.push(preview);
  if (best[0] && best[0] !== preview) plan.push(best[0]);
  return { paths: plan, hd: hdPaths };
}

/** The texture currently bound per (body, role, owner) slot: an older tier that was superseded is never re-applied. */
const currentBySlot = new Map<string, THREE.Texture>();

/**
 * Resolve a body map. `apply` is called with the preview texture and again with the full-resolution one.
 * Returns a promise that settles when loading has finished (true if any image arrived).
 *
 * Loads go through the shared texture manager (src/core/textures): GPU-compressed KTX2 when converted, else the
 * image; uploads are spread across frames. The full-resolution tier is registered for VRAM-budget eviction (it drops
 * back to the preview while unused or tiny on screen, `opts.screenPx`, and is restored when wanted).
 */
export async function resolveBodyTexture(
  assets: AssetLoader,
  renderer: THREE.WebGLRenderer,
  body: string,
  role: string,
  quality: QualityProfile['textureQuality'],
  colorSpace: 'srgb' | 'linear',
  apply: (tex: THREE.Texture, info: { path: string; hd: boolean }) => void,
  opts: { strip?: boolean; isCancelled?: () => boolean; screenPx?: () => number; slot?: string } = {},
): Promise<boolean> {
  const { paths: plan, hd } = await texturePlanInfo(assets, body, role, quality);
  const mgr = getTextureManager(assets, renderer);
  const slot = `${body}|${role}|${opts.slot ?? 'default'}`;
  let any = false;
  let skippedPreview = false;
  let preview: { tex: THREE.Texture; path: string } | null = null;
  for (let i = 0; i < plan.length; i++) {
    const path = plan[i];
    try {
      const t = await mgr.load(path, { colorSpace, anisotropy: 16, wrap: opts.strip ? 'clamp' : 'equirect', priority: i === 0 ? 1 : 0, wanted: opts.screenPx });
      if (opts.isCancelled?.()) return any;
      const info = { path, hd: hd.has(path) };
      // Upgrading a slot that already shows a texture: keep it up until the better tier lands (no blurry flash).
      if (i === 0 && plan.length > 1 && currentBySlot.has(slot)) { preview = { tex: t, path }; skippedPreview = true; continue; }
      apply(t, info);
      currentBySlot.set(slot, t);
      any = true;
      skippedPreview = false;
      if (i === 0) {
        preview = { tex: t, path };
      } else if (preview && preview.tex !== t) {
        const pv = preview;
        let shown = t;
        const isCurrent = (): boolean => currentBySlot.get(slot) === shown || currentBySlot.get(slot) === pv.tex;
        mgr.register(t, {
          preview: pv.tex,
          label: path,
          screenPx: opts.screenPx,
          alive: () => !opts.isCancelled?.() && isCurrent(),
          evict: () => {
            apply(pv.tex, { path: pv.path, hd: hd.has(pv.path) });
            currentBySlot.set(slot, pv.tex);
          },
          restore: async () => {
            const r = await mgr.load(path, { colorSpace, anisotropy: 16, wrap: opts.strip ? 'clamp' : 'equirect' });
            if (opts.isCancelled?.() || currentBySlot.get(slot) !== pv.tex) return null;
            apply(r, info);
            currentBySlot.set(slot, r);
            shown = r;
            return r;
          },
        });
      }
    } catch {
      // Missing tier: keep the previous one.
    }
  }
  if (skippedPreview && preview && !opts.isCancelled?.()) {
    apply(preview.tex, { path: preview.path, hd: hd.has(preview.path) });
    currentBySlot.set(slot, preview.tex);
    any = true;
  }
  return any;
}
