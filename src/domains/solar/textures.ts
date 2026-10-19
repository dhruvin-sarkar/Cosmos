/**
 * Texture resolver for the solar domain: public/textures/index.json (data team) + public/textures/hd.json (HD
 * overlay) when present, else the file convention. Loads the low tier first, then the best tier the
 * QualityProfile allows (ultra 8K, high 4K, low 1K/2K), handing each texture to `apply` as it arrives (materials
 * just rebind a uniform). Never throws; a missing tier keeps the previous one (or the material's flat colour).
 * Textures belong to the engine's AssetLoader cache, which disposes them.
 */
import * as THREE from 'three';
import type { AssetLoader, QualityProfile } from '../../core/types';
import { configureEquirect } from '../../render/textures';

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
  let preview = idx?.low ?? idx?.high;
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

/**
 * Resolve a body map. `apply` is called with the preview texture and again with the full-resolution one.
 * Returns a promise that settles when loading has finished (true if any image arrived).
 */
export async function resolveBodyTexture(
  assets: AssetLoader,
  renderer: THREE.WebGLRenderer,
  body: string,
  role: string,
  quality: QualityProfile['textureQuality'],
  colorSpace: 'srgb' | 'linear',
  apply: (tex: THREE.Texture, info: { path: string; hd: boolean }) => void,
  opts: { strip?: boolean; isCancelled?: () => boolean } = {},
): Promise<boolean> {
  const { paths: plan, hd } = await texturePlanInfo(assets, body, role, quality);
  let any = false;
  for (const path of plan) {
    try {
      const t = await assets.textureAsync(path, { colorSpace, anisotropy: 16 });
      if (opts.isCancelled?.()) return any;
      if (opts.strip) {
        t.wrapS = THREE.ClampToEdgeWrapping;
        t.wrapT = THREE.ClampToEdgeWrapping;
        t.anisotropy = 1;
      } else {
        const flipY = t.flipY;
        configureEquirect(t, renderer, { colorSpace, anisotropy: 16 });
        t.flipY = flipY;
      }
      apply(t, { path, hd: hd.has(path) });
      any = true;
    } catch {
      // Missing tier: keep the previous one.
    }
  }
  return any;
}
