import { describe, expect, it } from 'vitest';
import { LABEL_VIEW_BUDGET, labelTier, labelViewBudget } from './labels';

const vp = (width: number, height: number) => ({ width, height, pixelRatio: 1 });

describe('label ranking tiers', () => {
  it('ranks Sun > planet > dwarf > moon > landmark > spacecraft > small body > debris > star > entity-less', () => {
    const order = [
      labelTier('sol:sun', 'star', 'body'),
      labelTier('sol:mars', 'planet', 'body'),
      labelTier('sol:pluto', 'dwarf-planet', 'body'),
      labelTier('sol:io', 'moon', 'body'),
      labelTier('feat:olympus-mons', 'region', 'landmark'),
      labelTier('sc:iss', 'space-station', 'spacecraft'),
      labelTier('sb:433-eros', 'asteroid', 'body'),
      labelTier('sat:1', 'debris', 'satellite'),
      labelTier('star:hip:32349', 'star', 'star'),
      labelTier(null, undefined, 'annotation'),
    ];
    for (let i = 1; i < order.length; i++) expect(order[i]).toBeLessThan(order[i - 1]);
  });
});

describe('label view budget', () => {
  it('is about 12 at the reference viewport and never exceeds the quality profile', () => {
    expect(labelViewBudget(vp(1600, 900), 80)).toBe(LABEL_VIEW_BUDGET);
    expect(labelViewBudget(vp(1600, 900), 6)).toBe(6);
    expect(labelViewBudget(vp(800, 450), 80)).toBe(8);
    expect(labelViewBudget(vp(3840, 2160), 120)).toBe(18);
  });
});
