import { describe, expect, it } from 'vitest';
import {
  createQualityController,
  pickInitialQuality,
  QUALITY_PRESETS,
  QUALITY_TIERS,
  type FrameTiming,
  type QualityController,
} from './quality';

/** Feed `durationMs` of frames with fixed timing; returns the time after the run. */
function run(q: QualityController, startMs: number, durationMs: number, timing: FrameTiming): number {
  let now = startMs;
  const end = startMs + durationMs;
  while (now < end) {
    now += timing.intervalMs;
    q.sample(timing, now);
  }
  return now;
}

const gpu = (ms: number): FrameTiming => ({ intervalMs: Math.max(ms, 16.7), cpuMs: 3, gpuMs: ms });

describe('quality presets', () => {
  it('are complete, ordered and valid', () => {
    for (const tier of QUALITY_TIERS) {
      const p = QUALITY_PRESETS[tier];
      expect(p.preset).toBe(tier);
      expect(p.renderScale).toBe(1);
      expect([0, 2, 4]).toContain(p.msaaSamples);
      expect(p.maxPixelRatio).toBeGreaterThanOrEqual(1);
    }
    const [lo, mid, hi] = QUALITY_TIERS.map(t => QUALITY_PRESETS[t]);
    for (const key of ['starBudget', 'galaxyBudget', 'satelliteBudget', 'particleBudget', 'labelBudget'] as const) {
      expect(lo[key]).toBeLessThan(mid[key]);
      expect(mid[key]).toBeLessThan(hi[key]);
    }
    expect(lo.bloom).toBe(false);
    expect(Object.isFrozen(mid)).toBe(true);
  });
});

describe('pickInitialQuality', () => {
  const cases: Array<[string, string]> = [
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 Ti Direct3D11 vs_5_0 ps_5_0, D3D11)', 'balanced'],
    ['ANGLE (NVIDIA, NVIDIA GeForce MX450 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'performance'],
    ['ANGLE (Intel, Intel(R) UHD Graphics 620 Direct3D11 vs_5_0 ps_5_0, D3D11)', 'performance'],
    ['ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'balanced'],
    ['ANGLE (AMD, AMD Radeon(TM) 780M Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'balanced'],
    ['ANGLE (AMD, AMD Radeon RX 7800 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'ultra'],
    ['ANGLE (AMD, AMD Radeon RX 6500 XT Direct3D11 vs_5_0 ps_5_0, D3D11)', 'balanced'],
    ['ANGLE (AMD, AMD Radeon(TM) Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)', 'performance'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)', 'ultra'],
    ['ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)', 'balanced'],
    ['ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)', 'performance'],
    ['Mali-G78', 'performance'],
    ['', 'balanced'],
    ['Some Future GPU 9000', 'balanced'],
  ];
  it.each(cases)('%s → %s', (gpuString, expected) => {
    expect(pickInitialQuality({ gpu: gpuString })).toBe(expected);
  });

  it('caps by device memory and mobile form factor', () => {
    const rtx = 'NVIDIA GeForce RTX 4090';
    expect(pickInitialQuality({ gpu: rtx, deviceMemoryGB: 2 })).toBe('performance');
    expect(pickInitialQuality({ gpu: rtx, deviceMemoryGB: 4 })).toBe('balanced');
    expect(pickInitialQuality({ gpu: rtx, mobile: true })).toBe('balanced');
    expect(pickInitialQuality({ gpu: rtx, deviceMemoryGB: 16 })).toBe('ultra');
  });
});

describe('createQualityController', () => {
  it('fixed presets never adapt', () => {
    const q = createQualityController({ preset: 'ultra', autoBase: 'balanced' });
    const before = q.profile;
    run(q, 0, 20_000, gpu(40));
    expect(q.profile).toBe(before);
    expect(q.effective).toBe('ultra');
    expect(q.profile.renderScale).toBe(1);
  });

  it('auto lowers resolution quickly, then steps the preset down after sustained misses', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    let now = run(q, 0, 2500, gpu(26));
    expect(q.effective).toBe('balanced');
    expect(q.profile.renderScale).toBeCloseTo(0.6, 9);
    now = run(q, now, 1500, gpu(26));
    expect(q.effective).toBe('performance');
    run(q, now, 10_000, gpu(26));
    expect(q.effective).toBe('performance');
    expect(q.profile.renderScale).toBeGreaterThanOrEqual(0.6);
  });

  it('ignores a brief spike', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    let now = run(q, 0, 2000, gpu(8));
    now = run(q, now, 300, gpu(45));
    run(q, now, 5000, gpu(8));
    expect(q.effective).toBe('balanced');
  });

  it('recovers resolution, then upgrades cautiously; a failed upgrade is not retried soon', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    let now = run(q, 0, 1200, gpu(21));
    expect(q.profile.renderScale).toBeLessThan(1);
    now = run(q, now, 8000, gpu(9));
    expect(q.profile.renderScale).toBe(1);
    expect(q.effective).toBe('balanced');
    now = run(q, now, 11_000, gpu(6));
    expect(q.effective).toBe('ultra');

    now = run(q, now, 4000, gpu(30));
    expect(q.effective).toBe('balanced');
    now = run(q, now, 30_000, gpu(6));
    expect(q.effective).toBe('balanced');
    run(q, now, 45_000, gpu(6));
    expect(q.effective).toBe('ultra');
  });

  it('never trades resolution for CPU-bound frames', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    run(q, 0, 6000, { intervalMs: 20, cpuMs: 19, gpuMs: 5 });
    expect(q.profile.renderScale).toBe(1);
  });

  it('ignores loading hitches (long main-thread tasks)', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    let now = 0;
    for (let i = 0; i < 40; i++) {
      now = run(q, now, 100, gpu(6));
      now += 400;
      q.sample({ intervalMs: 400, cpuMs: 380, gpuMs: 6 }, now);
    }
    expect(q.profile.renderScale).toBe(1);
    expect(q.effective).not.toBe('performance');
  });

  it('works without a GPU timer using the frame interval', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    let now = run(q, 0, 1500, { intervalMs: 33.3, cpuMs: 4, gpuMs: null });
    expect(q.profile.renderScale).toBeLessThan(1);
    now = run(q, now, 15_000, { intervalMs: 16.7, cpuMs: 3, gpuMs: null });
    expect(q.profile.renderScale).toBe(1);
    run(q, now, 15_000, { intervalMs: 16.7, cpuMs: 12, gpuMs: null });
    expect(q.effective).toBe('balanced');
  });

  it('setPreset switches immediately and returns to the auto base', () => {
    const q = createQualityController({ preset: 'auto', autoBase: 'balanced' });
    run(q, 0, 2000, gpu(30));
    expect(q.setPreset('ultra')).toBe(true);
    expect(q.effective).toBe('ultra');
    expect(q.profile.renderScale).toBe(1);
    expect(q.profile.msaaSamples).toBe(4);
    expect(q.setPreset('ultra')).toBe(false);
    q.setPreset('auto');
    expect(q.preset).toBe('auto');
    expect(q.effective).toBe('balanced');
  });
});
