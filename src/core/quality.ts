/**
 * Quality presets and the Auto quality controller (docs/ARCHITECTURE.md §14).
 *
 * Fixed presets (performance / balanced / ultra) never change at runtime. Auto starts from a GPU-string
 * heuristic and then adapts on two time scales:
 *  - fast: dynamic resolution (renderScale in [0.6, 1.0], 0.05 steps) steered by a frame-cost EMA
 *    toward the 16.7 ms budget;
 *  - slow: preset step-down after ~3 s sustained above 22 ms, cautious step-up after ~10 s below 12 ms
 *    at full resolution. An upgrade that is followed by a step-down within its probation window is
 *    remembered and not retried for a minute (hysteresis against oscillation).
 *
 * Frame cost: with a GPU timer, dynamic resolution follows GPU time alone (pixel count changes GPU cost only,
 * so a CPU-bound frame must never cost resolution) and preset steps follow max(CPU, GPU). Without a timer, the
 * rAF interval — which vsync caps at the refresh period — so headroom is then inferred from a steady interval
 * plus a light main thread. Hitches (a main-thread task over HITCH_CPU_MS: texture decode, shader compile, GC)
 * are not load and are skipped unless they persist.
 */
import type { EffectiveQuality, QualityPreset, QualityProfile } from './types';

export const QUALITY_TIERS: readonly EffectiveQuality[] = ['performance', 'balanced', 'ultra'];

export const QUALITY_PRESETS: Readonly<Record<EffectiveQuality, Readonly<QualityProfile>>> = Object.freeze({
  performance: Object.freeze<QualityProfile>({
    preset: 'performance',
    maxPixelRatio: 1,
    renderScale: 1,
    bloom: false,
    bloomStrength: 0,
    msaaSamples: 0,
    textureQuality: 'low',
    starBudget: 25_000,
    galaxyBudget: 40_000,
    satelliteBudget: 6_000,
    particleBudget: 100_000,
    blackHoleQuality: 'fast',
    labelBudget: 40,
    shadowQuality: 'off',
  }),
  balanced: Object.freeze<QualityProfile>({
    preset: 'balanced',
    maxPixelRatio: 1.5,
    renderScale: 1,
    bloom: true,
    bloomStrength: 0.85,
    msaaSamples: 2,
    textureQuality: 'high',
    starBudget: 80_000,
    galaxyBudget: 150_000,
    satelliteBudget: 20_000,
    particleBudget: 400_000,
    blackHoleQuality: 'fast',
    labelBudget: 80,
    shadowQuality: 'low',
  }),
  ultra: Object.freeze<QualityProfile>({
    preset: 'ultra',
    maxPixelRatio: 2,
    renderScale: 1,
    bloom: true,
    bloomStrength: 1,
    msaaSamples: 4,
    textureQuality: 'ultra',
    starBudget: 120_000,
    galaxyBudget: 400_000,
    satelliteBudget: 40_000,
    particleBudget: 1_000_000,
    blackHoleQuality: 'high',
    labelBudget: 120,
    shadowQuality: 'high',
  }),
});

/** A fresh, mutable copy of a preset's profile with the given dynamic-resolution multiplier. */
export function qualityProfile(preset: EffectiveQuality, renderScale = 1): QualityProfile {
  return { ...QUALITY_PRESETS[preset], renderScale };
}

export interface GpuInfo {
  /** Unmasked renderer string, e.g. "ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU Direct3D11 …)". */
  gpu: string;
  /** navigator.deviceMemory (GB) when exposed. */
  deviceMemoryGB?: number | null;
  /** Coarse-pointer / small-screen device. */
  mobile?: boolean;
}

/** Initial effective preset from the GPU string (Auto mode starts here, then adapts). */
export function pickInitialQuality(info: GpuInfo): EffectiveQuality {
  const tier = tierFromGpuString(info.gpu);
  let cap = 2;
  if (info.mobile) cap = Math.min(cap, 1);
  if (info.deviceMemoryGB != null) {
    if (info.deviceMemoryGB <= 2) cap = 0;
    else if (info.deviceMemoryGB <= 4) cap = Math.min(cap, 1);
  }
  return QUALITY_TIERS[Math.min(QUALITY_TIERS.indexOf(tier), cap)];
}

function tierFromGpuString(raw: string): EffectiveQuality {
  const gpu = raw.toLowerCase();
  if (!gpu.trim()) return 'balanced';
  if (/swiftshader|llvmpipe|softpipe|basic render|software|microsoft basic/.test(gpu)) return 'performance';
  if (/mali|adreno|powervr|videocore|tegra|apple gpu/.test(gpu)) return 'performance';

  const rtx = /rtx\s*(\d{4})/.exec(gpu);
  // RTX xx50 and up: Ultra measured at 3.6–6.2 ms GPU (1600×900) on the exhibition RTX 3050 Laptop; Auto steps down if needed.
  if (rtx && !/rtx\s*a\d/.test(gpu)) return Number(rtx[1]) % 100 >= 50 ? 'ultra' : 'balanced';
  if (/\bgtx\b|quadro|rtx\s*a\d|tesla|titan/.test(gpu)) return 'balanced';
  if (/\bmx\s*\d{3}\b/.test(gpu)) return 'performance';

  const rx = /\brx\s*(\d{4})/.exec(gpu);
  if (rx) {
    const n = Number(rx[1]);
    if (n >= 6000) return n % 1000 >= 600 ? 'ultra' : 'balanced';
    return 'balanced';
  }
  if (/radeon[^,]*\b\d{3}m\b/.test(gpu)) return 'balanced';
  if (/vega|radeon\s*(\(tm\)\s*)?graphics/.test(gpu)) return 'performance';

  const apple = /apple\s*m(\d)/.exec(gpu);
  if (apple) return /m\d\s*(pro|max|ultra)/.test(gpu) ? 'ultra' : 'balanced';

  if (/intel/.test(gpu)) return /\barc\b|iris(\(r\))?\s*xe/.test(gpu) ? 'balanced' : 'performance';
  return 'balanced';
}

export interface FrameTiming {
  /** Real time since the previous frame, ms (rAF interval). */
  intervalMs: number;
  /** Main-thread time spent producing the frame, ms. */
  cpuMs: number;
  /** Most recent GPU frame time from a timer query, ms; null when no timer is available. */
  gpuMs: number | null;
}

export interface AutoQualityTuning {
  targetMs: number;
  emaTimeConstantMs: number;
  minRenderScale: number;
  maxRenderScale: number;
  renderScaleStep: number;
  scaleDownAboveMs: number;
  scaleUpBelowMs: number;
  scaleDownCooldownMs: number;
  scaleUpCooldownMs: number;
  tierDownAboveMs: number;
  tierDownAfterMs: number;
  tierUpBelowMs: number;
  tierUpAfterMs: number;
  /** A step-down this soon after an upgrade marks the upgrade as failed. */
  upgradeProbationMs: number;
  /** How long a failed upgrade is not retried. */
  failedUpgradeBackoffMs: number;
}

export const DEFAULT_AUTO_TUNING: Readonly<AutoQualityTuning> = Object.freeze({
  targetMs: 16.7,
  emaTimeConstantMs: 500,
  minRenderScale: 0.6,
  maxRenderScale: 1,
  renderScaleStep: 0.05,
  scaleDownAboveMs: 18.5,
  scaleUpBelowMs: 14,
  scaleDownCooldownMs: 500,
  scaleUpCooldownMs: 1500,
  tierDownAboveMs: 22,
  tierDownAfterMs: 3000,
  tierUpBelowMs: 12,
  tierUpAfterMs: 10_000,
  upgradeProbationMs: 8000,
  failedUpgradeBackoffMs: 60_000,
});

export interface QualityController {
  /** User-selected preset (may be 'auto'). */
  readonly preset: QualityPreset;
  /** Preset currently in effect. */
  readonly effective: EffectiveQuality;
  /** Current profile; a new object whenever anything changes (compare by reference). */
  readonly profile: QualityProfile;
  /** Smoothed frame cost, ms (debug overlay). */
  readonly frameCostMs: number;
  /** Returns true when the profile changed. */
  setPreset(preset: QualityPreset): boolean;
  /** Feed one frame's timing (Auto only). Returns true when the profile changed. */
  sample(timing: FrameTiming, nowMs: number): boolean;
}

export interface QualityControllerOptions {
  preset: QualityPreset;
  /** Starting tier for Auto (usually pickInitialQuality()). */
  autoBase: EffectiveQuality;
  tuning?: Partial<AutoQualityTuning>;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;

/** Main-thread time above which a frame is a hitch (asset decode, shader compile, GC), not sustained load. */
export const HITCH_CPU_MS = 45;
/** Consecutive hitch frames after which they count as real load. */
const HITCH_PERSIST_FRAMES = 20;

export function createQualityController(opts: QualityControllerOptions): QualityController {
  const k: AutoQualityTuning = { ...DEFAULT_AUTO_TUNING, ...opts.tuning };
  let preset: QualityPreset = opts.preset;
  let tier = QUALITY_TIERS.indexOf(preset === 'auto' ? opts.autoBase : preset);
  let renderScale = 1;
  let profile = qualityProfile(QUALITY_TIERS[tier], renderScale);

  let emaLoad = 0;
  let emaRes = 0;
  let emaCpu = 0;
  let hitchRun = 0;
  let lastSampleAt = Number.NaN;
  let lastScaleChangeAt = Number.NEGATIVE_INFINITY;
  let severeSince: number | null = null;
  let idleSince: number | null = null;
  let lastUpgradeAt: number | null = null;
  let upgradeBlockedUntil = Number.NEGATIVE_INFINITY;

  const resetAdaptation = (): void => {
    lastSampleAt = Number.NaN;
    lastScaleChangeAt = Number.NEGATIVE_INFINITY;
    severeSince = null;
    idleSince = null;
    lastUpgradeAt = null;
  };

  const rebuild = (): void => {
    profile = qualityProfile(QUALITY_TIERS[tier], renderScale);
  };

  return {
    get preset() {
      return preset;
    },
    get effective() {
      return QUALITY_TIERS[tier];
    },
    get profile() {
      return profile;
    },
    get frameCostMs() {
      return emaLoad;
    },

    setPreset(next: QualityPreset): boolean {
      if (next === preset) return false;
      preset = next;
      tier = QUALITY_TIERS.indexOf(next === 'auto' ? opts.autoBase : next);
      renderScale = 1;
      upgradeBlockedUntil = Number.NEGATIVE_INFINITY;
      resetAdaptation();
      rebuild();
      return true;
    },

    sample(timing: FrameTiming, now: number): boolean {
      if (preset !== 'auto') return false;
      const interval = Math.min(Math.max(timing.intervalMs, 0), 250);
      const hasGpuTimer = timing.gpuMs !== null;
      const cpu = Math.min(Math.max(timing.cpuMs, 0), 250);
      const gpuMs = Math.min(Math.max(timing.gpuMs ?? 0, 0), 250);
      // Hitch: a long main-thread task, a GPU spike (8K texture upload) or, without a timer, a stalled interval.
      const hitch = cpu > HITCH_CPU_MS || gpuMs > HITCH_CPU_MS || (!hasGpuTimer && interval > HITCH_CPU_MS);
      if (hitch && ++hitchRun < HITCH_PERSIST_FRAMES) {
        // A one-off stall: the next frame's interval is not representative either; restart the EMA clock.
        if (!Number.isNaN(lastSampleAt)) lastSampleAt = now;
        return false;
      }
      if (!hitch) hitchRun = 0;
      const load = Math.min(hasGpuTimer ? Math.max(cpu, gpuMs) : interval, 250);
      // Resolution only changes GPU cost: steer it by GPU time when a timer exists.
      const resLoad = hasGpuTimer ? gpuMs : load;

      if (Number.isNaN(lastSampleAt)) {
        emaLoad = load;
        emaRes = resLoad;
        emaCpu = cpu;
      } else {
        const alpha = 1 - Math.exp(-Math.max(0, now - lastSampleAt) / k.emaTimeConstantMs);
        emaLoad += alpha * (load - emaLoad);
        emaRes += alpha * (resLoad - emaRes);
        emaCpu += alpha * (cpu - emaCpu);
      }
      lastSampleAt = now;

      const meetsVsync = emaLoad <= k.targetMs * 1.08;
      const over = emaRes > k.scaleDownAboveMs;
      const under = hasGpuTimer ? emaRes < k.scaleUpBelowMs : meetsVsync && emaCpu < k.targetMs * 0.5;
      const severe = emaLoad > k.tierDownAboveMs;
      const idle = hasGpuTimer ? emaLoad < k.tierUpBelowMs : meetsVsync && emaCpu < k.targetMs * 0.4;

      let changed = false;
      const step = k.renderScaleStep;
      const floorToStep = (x: number): number => Math.floor(x / step + 1e-6) * step;

      // Pixel count ∝ renderScale², and a fill-bound frame's cost ∝ pixel count, so with a GPU timer the
      // scale that meets a budget is predicted as scale·√(budget/cost); without one, step blindly.
      if (over && renderScale > k.minRenderScale && now - lastScaleChangeAt >= k.scaleDownCooldownMs) {
        const predicted = hasGpuTimer
          ? renderScale * Math.sqrt((k.targetMs * 0.9) / emaRes)
          : renderScale - (emaLoad > k.targetMs * 1.5 ? 2 : 1) * step;
        const next = Math.min(renderScale - step, Math.max(renderScale - 4 * step, floorToStep(predicted)));
        renderScale = Math.max(k.minRenderScale, round2(next));
        lastScaleChangeAt = now;
        changed = true;
      } else if (!over && under && renderScale < k.maxRenderScale && now - lastScaleChangeAt >= k.scaleUpCooldownMs) {
        const predicted = hasGpuTimer ? renderScale * Math.sqrt((k.targetMs * 0.8) / Math.max(emaRes, 1)) : renderScale + step;
        const next = Math.max(renderScale + step, Math.min(renderScale + 4 * step, floorToStep(predicted)));
        renderScale = Math.min(k.maxRenderScale, round2(next));
        lastScaleChangeAt = now;
        changed = true;
      }

      severeSince = severe ? (severeSince ?? now) : null;
      if (severeSince !== null && now - severeSince >= k.tierDownAfterMs && tier > 0) {
        if (lastUpgradeAt !== null && now - lastUpgradeAt <= k.upgradeProbationMs + k.tierDownAfterMs) {
          upgradeBlockedUntil = now + k.failedUpgradeBackoffMs;
        }
        tier -= 1;
        severeSince = null;
        idleSince = null;
        lastUpgradeAt = null;
        changed = true;
      }

      const atFullResolution = renderScale >= k.maxRenderScale - 1e-9;
      idleSince = idle && atFullResolution ? (idleSince ?? now) : null;
      if (idleSince !== null && now - idleSince >= k.tierUpAfterMs && tier < QUALITY_TIERS.length - 1 && now >= upgradeBlockedUntil) {
        tier += 1;
        idleSince = null;
        lastUpgradeAt = now;
        changed = true;
      }

      if (changed) rebuild();
      return changed;
    },
  };
}
