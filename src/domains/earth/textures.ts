/**
 * Texture resolution for the Earth and Moon: public/textures/index.json (data team) + public/textures/hd.json
 * (HD overlay) when present, else the file-name convention. Never throws: a missing index or file just means a
 * lower tier (or the fallback colour) stays in place.
 *
 * Progressive loading: the lowest tier is requested first so the first frame shows real imagery quickly; the
 * tier allowed by QualityProfile.textureQuality (low 2K, high 4K, ultra 8K) is loaded afterwards and swapped in,
 * and the superseded GPU texture is released.
 */
import * as THREE from 'three';
import type { AssetLoader, QualityProfile } from '../../core/types';
import { getTextureManager } from '../../core/textures';

/** 'max' = the 16K tier (Ultra preset only, and only while the body fills the screen at close range; ~700 MB VRAM). */
export type Tier = 'low' | 'high' | 'ultra' | 'max';
export const TIER_ORDER: readonly Tier[] = ['low', 'high', 'ultra', 'max'];

export type MapKind = 'day' | 'night' | 'clouds' | 'specular' | 'normal' | 'height' | 'color';

/** body → map → tier → path (relative to the app base). */
export type TextureTable = Record<string, Partial<Record<string, Partial<Record<Tier, string>>>>>;

interface IndexJson {
  bodies?: Record<string, Record<string, Record<string, string>>>;
}
interface HdJson {
  version?: number;
  bodies?: Record<string, Record<string, Record<string, string> | string | undefined>>;
}

/** File-name convention when no index is available. */
const CONVENTION: TextureTable = {
  earth: {
    day: { low: 'textures/earth/day_2k.jpg', high: 'textures/earth/day_4k.jpg', ultra: 'textures/earth/day_8k.jpg' },
    night: { low: 'textures/earth/night_2k.jpg', high: 'textures/earth/night_4k.jpg', ultra: 'textures/earth/night_8k.jpg' },
    clouds: { low: 'textures/earth/clouds_2k.jpg', high: 'textures/earth/clouds_4k.jpg', ultra: 'textures/earth/clouds_8k.jpg' },
    specular: { low: 'textures/earth/specular_2k.png', high: 'textures/earth/specular_4k.png', ultra: 'textures/earth/specular_8k.png' },
    normal: { low: 'textures/earth/normal_2k.png', high: 'textures/earth/normal_4k.png', ultra: 'textures/earth/normal_8k.webp' },
  },
  moon: {
    color: { low: 'textures/moon/color_1k.jpg', high: 'textures/moon/color_4k.jpg' },
    normal: { low: 'textures/moon/normal_1k.png', high: 'textures/moon/normal_4k.png' },
  },
};

const HD_SIZE_TO_TIER: Record<string, Tier> = { '2k': 'low', '1k': 'low', '4k': 'high', '8k': 'ultra', '16k': 'max' };
/** hd.json map names → this domain's map names, per body (hd.json calls the Earth's day map 'color'). */
const HD_MAP_ALIAS: Record<string, Record<string, string>> = { earth: { color: 'day' } };

/** Path suffix '<path>@<width>': decode the image and downscale it to <width> before upload. */
export const DOWNSCALE_MARK = '@';

/** Split 'path@4096' into the path and the maximum width (null = native). */
export function parseTexturePath(p: string): { path: string; maxWidth: number | null } {
  const m = /^(.*)@(\d+)$/.exec(p);
  return m ? { path: m[1]!, maxWidth: Number(m[2]) } : { path: p, maxWidth: null };
}

/** Merge index.json and hd.json over the convention (pure; exported for tests). */
export function mergeTextureTables(index: IndexJson | null, hd: HdJson | null): TextureTable {
  const out: TextureTable = JSON.parse(JSON.stringify(CONVENTION)) as TextureTable;
  for (const body of ['earth', 'moon']) {
    const fromIndex = index?.bodies?.[body];
    if (fromIndex) {
      for (const [map, tiers] of Object.entries(fromIndex)) {
        if (!tiers || typeof tiers !== 'object') continue;
        const slot = (out[body][map] ??= {});
        for (const t of TIER_ORDER) if (typeof tiers[t] === 'string') slot[t] = tiers[t];
      }
    }
    const fromHd = hd?.bodies?.[body];
    if (fromHd) {
      for (const [map, sizes] of Object.entries(fromHd)) {
        if (!sizes || typeof sizes !== 'object') continue;
        const target = HD_MAP_ALIAS[body]?.[map] ?? (map === 'bump' ? 'height' : map);
        const slot = (out[body][target] ??= {});
        const hdTiers = new Set<Tier>();
        for (const [size, path] of Object.entries(sizes)) {
          const tier = HD_SIZE_TO_TIER[size.toLowerCase()];
          if (tier && typeof path === 'string') {
            slot[tier] = path.replace(/^\/+/, '');
            hdTiers.add(tier);
          }
        }
        // An HD map that only ships at 8K: serve it downscaled for the 4K tier too, so all close-range tiers share one
        // source (the older 4K file may differ, e.g. a shaded Moon mosaic instead of a calibrated albedo map).
        if (hdTiers.has('ultra') && !hdTiers.has('high') && slot.ultra) slot.high = `${slot.ultra}${DOWNSCALE_MARK}4096`;
      }
    }
  }
  return out;
}

export async function loadTextureTable(assets: AssetLoader): Promise<TextureTable> {
  const [index, hd] = await Promise.all([
    assets.json<IndexJson>('textures/index.json').catch(() => null),
    assets.json<HdJson>('textures/hd.json').catch(() => null),
  ]);
  return mergeTextureTables(index, hd);
}

export function maxTierFor(quality: QualityProfile['textureQuality']): Tier {
  return quality === 'ultra' ? 'max' : quality === 'high' ? 'high' : 'low';
}

/** Tiers available for a map, lowest first, capped at `max`. */
export function tiersUpTo(table: TextureTable, body: string, map: string, max: Tier): { tier: Tier; path: string }[] {
  const slot = table[body]?.[map];
  if (!slot) return [];
  const limit = TIER_ORDER.indexOf(max);
  const out: { tier: Tier; path: string }[] = [];
  for (let i = 0; i <= limit; i++) {
    const t = TIER_ORDER[i];
    const p = slot[t];
    if (p) out.push({ tier: t, path: p });
  }
  return out;
}

/**
 * A texture uniform that upgrades itself tier by tier. `apply` receives each better texture as it arrives;
 * the previous one is disposed (its GPU memory released). Requests are sequential (lowest first) so the
 * first frame is never blocked behind an 8K decode.
 */
export class ProgressiveMap {
  current: THREE.Texture | null = null;
  currentTier: Tier | null = null;
  private wanted: Tier = 'low';
  private loading = false;
  private disposed = false;

  constructor(
    private readonly assets: AssetLoader,
    private readonly table: TextureTable,
    private readonly body: string,
    private readonly map: string,
    private readonly colorSpace: 'srgb' | 'linear',
    private readonly apply: (tex: THREE.Texture, tier: Tier) => void,
    private readonly anisotropy = 16,
  ) {}

  /** Request up to `max` (call whenever the quality profile changes). */
  request(max: Tier): void {
    this.wanted = max;
    void this.pump();
  }

  /**
   * Drop back to at most `max` when the current texture is above it (frees the 16K tier's VRAM once the camera leaves).
   * The lower tier is loaded first and swapped in, so nothing ever renders with a missing map.
   */
  cap(max: Tier): void {
    this.wanted = max;
    const rank = TIER_ORDER.indexOf(max);
    if (!this.currentTier || TIER_ORDER.indexOf(this.currentTier) <= rank || this.loading || this.disposed) return;
    const list = tiersUpTo(this.table, this.body, this.map, max);
    const target = list[list.length - 1];
    if (!target) return;
    this.loading = true;
    void this.load(target.path)
      .then(tex => {
        if (this.disposed) { tex?.dispose(); return; }
        if (!tex) return;
        const prev = this.current;
        this.current = tex;
        this.currentTier = target.tier;
        this.applyTex(tex, target.tier);
        if (prev && prev !== tex) prev.dispose();
      })
      .finally(() => { this.loading = false; void this.pump(); });
  }

  private async load(p: string): Promise<THREE.Texture | null> {
    try {
      // GPU-compressed KTX2 twin when converted (src/core/textures; keys include the '@<width>' downscales).
      const k = await getTextureManager(this.assets).loadKtx2(p, { colorSpace: this.colorSpace, anisotropy: this.anisotropy });
      if (k) return k;
      const { path, maxWidth } = parseTexturePath(p);
      return maxWidth
        ? await this.loadDownscaled(path, maxWidth)
        : await this.assets.textureAsync(path, { colorSpace: this.colorSpace, anisotropy: this.anisotropy });
    } catch {
      return null; // keep the current tier; the loader already pushed a notice
    }
  }

  get available(): boolean {
    return (this.table[this.body]?.[this.map] ?? null) !== null;
  }

  /** apply() without a second GPU upload when the texture was already uploaded with the same sampler state. */
  private applyTex(tex: THREE.Texture, tier: Tier): void {
    const v = tex.version, ws = tex.wrapS, wt = tex.wrapT;
    this.apply(tex, tier);
    if ((tex as THREE.CompressedTexture).isCompressedTexture && tex.wrapS === ws && tex.wrapT === wt) tex.version = v;
  }

  private async pump(): Promise<void> {
    if (this.loading || this.disposed) return;
    this.loading = true;
    try {
      for (;;) {
        const list = tiersUpTo(this.table, this.body, this.map, this.wanted);
        const currentRank = this.currentTier ? TIER_ORDER.indexOf(this.currentTier) : -1;
        const next = list.find(e => TIER_ORDER.indexOf(e.tier) > currentRank);
        if (!next) break;
        const tex = await this.load(next.path);
        if (this.disposed) { tex?.dispose(); return; }
        if (!tex) {
          // Skip a failed tier but keep climbing.
          this.currentTier = next.tier;
          continue;
        }
        const prev = this.current;
        this.current = tex;
        this.currentTier = next.tier;
        this.applyTex(tex, next.tier);
        if (prev && prev !== tex) prev.dispose();
      }
    } finally {
      this.loading = false;
    }
    // A cap() that arrived mid-climb was deferred: apply it now that the in-flight tier has landed.
    if (!this.disposed && this.currentTier && TIER_ORDER.indexOf(this.currentTier) > TIER_ORDER.indexOf(this.wanted)) {
      this.cap(this.wanted);
    }
  }

  /** Decode off the main thread and resample to `maxWidth` (2:1 equirectangular) before the GPU upload. */
  private async loadDownscaled(path: string, maxWidth: number): Promise<THREE.Texture> {
    const buf = await this.assets.binary(path);
    const bitmap = await createImageBitmap(new Blob([buf]), {
      resizeWidth: maxWidth,
      resizeHeight: maxWidth / 2,
      resizeQuality: 'high',
      imageOrientation: 'flipY',
      colorSpaceConversion: 'none',
    });
    const tex = new THREE.Texture(bitmap as unknown as HTMLImageElement);
    tex.flipY = false; // already flipped by createImageBitmap
    tex.colorSpace = this.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tex.anisotropy = this.anisotropy;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const dispose = tex.dispose.bind(tex);
    tex.dispose = () => { dispose(); bitmap.close(); };
    return tex;
  }

  dispose(): void {
    this.disposed = true;
    this.current?.dispose();
    this.current = null;
  }
}
