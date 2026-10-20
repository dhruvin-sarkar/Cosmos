import { describe, expect, it } from 'vitest';
import { HD_BUDGET_BYTES, IDLE_FRAMES, chooseEvictions, chooseRestore, type ResidentState } from './budget';
import { compressedMipBytes, parseKtx2Manifest, rgbaBytes } from './manifest';

const MB = 2 ** 20;
const r = (id: number, bytes: number, lastUsed: number, priority: number | null = null, evicted = false): ResidentState => ({ id, bytes, lastUsed, priority, evicted });

describe('manifest', () => {
  it('parses entries, normalises keys and drops bad ones', () => {
    const m = parseKtx2Manifest({
      version: 1,
      entries: {
        '/textures/mars/color_8k.jpg': { ktx2: 'textures/mars/color_8k.ktx2', codec: 'uastc', colorSpace: 'srgb', width: 8192, height: 4096, bytes: 2e7, srcBytes: 5602273 },
        'textures/moon/color_8k.jpg@4096': { ktx2: '/textures/moon/color_8k.ktx2', codec: 'etc1s', colorSpace: 'srgb', width: 4096, height: 2048, skipLevels: 1 },
        'textures/bad.jpg': { ktx2: 'textures/bad.png', width: 1, height: 1 },
        'textures/bad2.jpg': null,
      },
    });
    expect(m.entries.size).toBe(2);
    expect(m.entries.get('textures/mars/color_8k.jpg')?.srcBytes).toBe(5602273);
    const moon = m.entries.get('textures/moon/color_8k.jpg@4096')!;
    expect(moon.ktx2).toBe('textures/moon/color_8k.ktx2');
    expect(moon.skipLevels).toBe(1);
    expect(m.entries.get('textures/mars/color_8k.jpg')?.skipLevels).toBe(0);
    expect(moon.codec).toBe('etc1s');
    expect(moon.vramBytes).toBe(compressedMipBytes(4096, 2048));
  });

  it('never throws on garbage', () => {
    expect(parseKtx2Manifest(null).entries.size).toBe(0);
    expect(parseKtx2Manifest({ entries: 3 }).entries.size).toBe(0);
  });

  it('estimates GPU bytes: BC7 is 1 byte/px, RGBA8 4 bytes/px, mips add 1/3', () => {
    // 8192x4096 level 0 = 32 MiB; full chain ≈ 4/3 of that (plus the 4x4-block padding of the tiny levels).
    const bc7 = compressedMipBytes(8192, 4096);
    expect(bc7).toBeGreaterThan(32 * MB * 1.333);
    expect(bc7).toBeLessThan(32 * MB * 1.334);
    expect(rgbaBytes(8192, 4096)).toBeCloseTo(4 * bc7, -6);
    expect(compressedMipBytes(1, 1)).toBe(16);
  });
});

describe('VRAM budget', () => {
  it('does nothing while under budget', () => {
    expect(chooseEvictions([r(1, 100 * MB, 0), r(2, 100 * MB, 0)], 300 * MB, 1000)).toEqual([]);
  });

  it('evicts idle tiers first, oldest first, down to 90% of the budget', () => {
    const now = 1000;
    const a = r(1, 300 * MB, now - IDLE_FRAMES - 500); // idle longest
    const b = r(2, 300 * MB, now - IDLE_FRAMES - 10); // idle
    const c = r(3, 300 * MB, now); // drawn, size unknown: protected
    const out = chooseEvictions([c, b, a], 500 * MB, now);
    expect(out.map(x => x.id)).toEqual([1, 2]);
  });

  it('evicts drawn-but-tiny tiers only after idle ones, never large or unknown-size drawn ones', () => {
    const now = 500;
    const tiny = r(1, 400 * MB, now, 20);
    const big = r(2, 400 * MB, now, 600);
    const unknown = r(3, 400 * MB, now, null);
    expect(chooseEvictions([big, tiny, unknown], 900 * MB, now).map(x => x.id)).toEqual([1]);
    expect(chooseEvictions([big, unknown], 500 * MB, now)).toEqual([]);
  });

  it('restores the largest wanted evicted tier that fits', () => {
    const now = 100;
    const res = [r(1, 200 * MB, now, 400, true), r(2, 200 * MB, now, 900, true), r(3, 200 * MB, now - 50, 900, true), r(4, 500 * MB, now, null)];
    expect(chooseRestore(res, 800 * MB, now)?.id).toBe(2);
    expect(chooseRestore(res, 600 * MB, now)).toBeNull(); // no room
    expect(chooseRestore([r(5, 10 * MB, now, 50, true)], 800 * MB, now)).toBeNull(); // still tiny on screen
  });

  it('budgets grow with the preset', () => {
    expect(HD_BUDGET_BYTES.low).toBeLessThan(HD_BUDGET_BYTES.high);
    expect(HD_BUDGET_BYTES.high).toBeLessThan(HD_BUDGET_BYTES.ultra);
  });
});
