import { describe, expect, it } from 'vitest';
import { agxInverse, agxToneMap, oklchToLinearSrgb, sceneLinearForOklch } from './tonemap';

describe('AgX inverse', () => {
  it('round-trips display colours', () => {
    for (const t of [
      { r: 0.5, g: 0.5, b: 0.5 },
      { r: 0.5, g: 0.4, b: 0.2 },
      { r: 0.05, g: 0.05, b: 0.05 },
    ]) {
      const back = agxToneMap(agxInverse(t));
      expect(back.r).toBeCloseTo(t.r, 4);
      expect(back.g).toBeCloseTo(t.g, 4);
      expect(back.b).toBeCloseTo(t.b, 4);
    }
  });

  it('maps oklch white to linear white', () => {
    const w = oklchToLinearSrgb(1, 0, 0);
    expect(w.r).toBeCloseTo(1, 3);
    expect(w.g).toBeCloseTo(1, 3);
    expect(w.b).toBeCloseTo(1, 3);
  });

  it('brass token is reachable and lands on the token', () => {
    const brass = sceneLinearForOklch(0.85, 0.1, 88, 0.7);
    const d = oklchToLinearSrgb(0.85, 0.1, 88);
    const back = agxToneMap(brass);
    expect(back.r).toBeCloseTo(d.r * 0.7, 3);
    expect(back.g).toBeCloseTo(d.g * 0.7, 3);
    expect(back.b).toBeCloseTo(d.b * 0.7, 3);
    // Overlays must stay under the engine bloom threshold (luminance 1.5) so they never glow.
    expect(0.2126 * brass.r + 0.7152 * brass.g + 0.0722 * brass.b).toBeLessThan(1.5);
    console.log('brass scene-linear', brass, 'ink', sceneLinearForOklch(0.93, 0, 0, 0.3));
  });
});
