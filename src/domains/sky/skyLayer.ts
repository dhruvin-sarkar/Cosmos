/**
 * Milky Way backdrop layer ('sky:backdrop'): the all-sky survey map for the selected spectral band, drawn at infinity
 * in ICRS orientation. Loads public/data/sky/bands.json, bakes each band (star removal, black point, saturation) on the
 * GPU at load, loads the low tier first and upgrades to the quality profile's tier, cross-fades between bands with
 * per-band exposure, and fades out between 50 pc and 500 pc from the Sun (the maps are the sky as seen from here).
 * Degrades gracefully: without bands.json or a band's files the backdrop is simply absent (one console note).
 */
import * as THREE from 'three';
import type { EngineServices, FrameContext, Layer, QualityProfile, SpectralBandId } from '../../core/types';
import { PC_M } from '../../core/units';
import { bakeSkyMap } from './bake';
import {
  BANDS_JSON_PATH,
  bandDisplay,
  captionFor,
  resolveBand,
  tiersFor,
  type SkyBandCaption,
  type SkyBandRecord,
  type SkyBandsFile,
} from './bands';
import { SkyBackdropMaterial, makeSkyQuad } from './skyMaterial';

export const SKY_BACKDROP_LAYER_ID = 'sky:backdrop';
/** Distance from the Sun (m) where the Earth-centred maps start / finish fading out. */
export const SKY_FADE_START_M = 50 * PC_M;
export const SKY_FADE_END_M = 500 * PC_M;
const FADE_IN_SEC = 1.4;
const CROSS_FADE_SEC = 1.1;
const MAX_CACHED = 3;

interface Baked {
  dataId: string;
  rt: THREE.WebGLRenderTarget;
  tier: number;
  lastUsed: number;
}

interface Slot {
  baked: Baked;
  exposure: number;
  everywhere: boolean;
}

export interface SkyRuntime {
  /** bands.json once loaded (null before / when missing). */
  readonly bands: SkyBandsFile | null;
  /** Caption for a band (null when that band has no data). */
  caption(band: SpectralBandId): SkyBandCaption | null;
  /** Band currently on screen (after cross-fade starts), null before the first map. */
  readonly shownBand: SpectralBandId | null;
  /** 0..1 distance fade of the Earth-centred maps. */
  readonly distanceFade: number;
  /** Optional multiplier on all band exposures (tuning / UI brightness control). */
  exposureScale: number;
}

export function createSkyBackdropLayer(): { layer: Layer; runtime: SkyRuntime } {
  let svc: EngineServices | null = null;
  let mesh: THREE.Mesh<THREE.BufferGeometry, SkyBackdropMaterial> | null = null;
  let bands: SkyBandsFile | null = null;
  let bandsTried = false;
  let disposed = false;
  const cache = new Map<string, Baked>();
  const loading = new Set<string>();
  const failed = new Set<string>();
  let active: Slot | null = null;
  let outgoing: Slot | null = null;
  let fadeT = 1;
  let fadeSec = FADE_IN_SEC;
  let desiredBand: SpectralBandId = 'visible';
  let shownBand: SpectralBandId | null = null;
  let quality: QualityProfile['textureQuality'] = 'high';
  let distanceFade = 1;
  let lastRetryMs = 0;

  const runtime: SkyRuntime = {
    get bands() {
      return bands;
    },
    caption(band) {
      const rec = resolveBand(bands, band);
      return rec ? captionFor(band, rec, bandDisplay(rec.id).everywhere === true || distanceFade > 0.01) : null;
    },
    get shownBand() {
      return shownBand;
    },
    get distanceFade() {
      return distanceFade;
    },
    exposureScale: 1,
  };

  async function loadBandsJson(): Promise<void> {
    if (!svc) return;
    bandsTried = true;
    try {
      const file = await svc.assets.json<SkyBandsFile>(BANDS_JSON_PATH);
      if (!file || !Array.isArray(file.bands)) throw new Error('bands.json has no "bands" array');
      bands = file;
    } catch (err) {
      console.info(`[sky] ${BANDS_JSON_PATH} not available yet; no Milky Way backdrop (${(err as Error).message})`);
    }
  }

  function evict(): void {
    if (cache.size <= MAX_CACHED) return;
    const inUse = new Set([active?.baked, outgoing?.baked]);
    const victims = [...cache.values()].filter((b) => !inUse.has(b)).sort((a, b) => a.lastUsed - b.lastUsed);
    while (cache.size > MAX_CACHED && victims.length) {
      const v = victims.shift()!;
      cache.delete(v.dataId);
      v.rt.dispose();
    }
  }

  function show(band: SpectralBandId, rec: SkyBandRecord, baked: Baked): void {
    const disp = bandDisplay(rec.id);
    baked.lastUsed = performance.now();
    if (active && active.baked.dataId === rec.id) return;
    // The map that currently dominates the screen becomes the outgoing one.
    outgoing = !outgoing || fadeT >= 0.5 ? active : outgoing;
    active = { baked, exposure: disp.exposure, everywhere: disp.everywhere === true };
    fadeSec = outgoing ? CROSS_FADE_SEC : FADE_IN_SEC;
    fadeT = 0;
    shownBand = band;
  }

  async function loadBand(band: SpectralBandId, rec: SkyBandRecord): Promise<void> {
    if (!svc || loading.has(rec.id)) return;
    const tiers = tiersFor(rec, quality);
    const have = cache.get(rec.id);
    const start = have ? have.tier + 1 : 0;
    if (start >= tiers.length) return;
    loading.add(rec.id);
    const renderer = svc.renderer;
    const disp = bandDisplay(rec.id);
    try {
      for (let i = start; i < tiers.length && !disposed; i++) {
        const tex = await svc.assets.textureAsync(tiers[i].path, { colorSpace: 'srgb' });
        if (disposed) {
          tex.dispose();
          return;
        }
        const rt = bakeSkyMap(renderer, tex, { starless: disp.starless, saturation: disp.saturation, blackPoint: disp.blackPoint, smooth: disp.smooth, gamma: disp.gamma });
        tex.dispose();
        const prev = cache.get(rec.id);
        if (prev) {
          // Same band, sharper tier: swap in place (no fade), free the old target.
          const old = prev.rt;
          prev.rt = rt;
          prev.tier = i;
          old.dispose();
        } else {
          const baked: Baked = { dataId: rec.id, rt, tier: i, lastUsed: performance.now() };
          cache.set(rec.id, baked);
          if (desiredBand === band) show(band, rec, baked);
          evict();
        }
      }
    } catch (err) {
      failed.add(rec.id);
      console.info(`[sky] band '${rec.id}' could not be loaded: ${(err as Error).message}`);
    } finally {
      loading.delete(rec.id);
    }
  }

  const layer: Layer = {
    id: SKY_BACKDROP_LAYER_ID,
    init(services) {
      svc = services;
      const mat = new SkyBackdropMaterial();
      mesh = makeSkyQuad(mat, -1000);
      mesh.name = 'sky-backdrop';
      mesh.visible = false;
      services.groups.background.add(mesh);
      void loadBandsJson();
    },
    update(ctx: FrameContext) {
      if (!mesh) return;
      quality = ctx.quality.textureQuality;
      desiredBand = ctx.spectralBand;

      // Distance validity (log-space smoothstep 50 → 500 pc from the Sun ≈ SSB).
      const d = ctx.cameraPosition.length();
      const x = Math.min(1, Math.max(0, Math.log(d / SKY_FADE_START_M) / Math.log(SKY_FADE_END_M / SKY_FADE_START_M)));
      distanceFade = d <= SKY_FADE_START_M ? 1 : 1 - x * x * (3 - 2 * x);

      if (!bands) {
        // bands.json may land while the app runs (data team): retry every 20 s.
        const now = performance.now();
        if (bandsTried && now - lastRetryMs > 20000) {
          lastRetryMs = now;
          void loadBandsJson();
        }
        mesh.visible = false;
        return;
      }

      const rec = resolveBand(bands, desiredBand);
      if (rec && !failed.has(rec.id)) {
        const baked = cache.get(rec.id);
        if (baked) {
          show(desiredBand, rec, baked);
          if (baked.tier + 1 < tiersFor(rec, quality).length && !loading.has(rec.id)) void loadBand(desiredBand, rec);
        } else if (!loading.has(rec.id)) {
          void loadBand(desiredBand, rec);
        }
      }

      if (fadeT < 1) {
        fadeT = ctx.reducedMotion ? 1 : Math.min(1, fadeT + ctx.dtRealSec / fadeSec);
        if (fadeT >= 1) outgoing = null;
      }
      const s = fadeT * fadeT * (3 - 2 * fadeT);
      const u = mesh.material.uniforms;
      const k = runtime.exposureScale;
      const fadeFor = (slot: Slot): number => (slot.everywhere ? 1 : distanceFade);
      u.uMapB.value = active ? active.baked.rt.texture : null;
      u.uWeightB.value = active ? active.exposure * k * fadeFor(active) * s : 0;
      u.uMapA.value = outgoing ? outgoing.baked.rt.texture : null;
      u.uWeightA.value = outgoing ? outgoing.exposure * k * fadeFor(outgoing) * (1 - s) : 0;
      mesh.visible = u.uWeightA.value > 0 || u.uWeightB.value > 0;
    },
    dispose() {
      disposed = true;
      for (const b of cache.values()) b.rt.dispose();
      cache.clear();
      mesh?.material.dispose();
      mesh?.removeFromParent();
      mesh = null;
    },
  };
  return { layer, runtime };
}
