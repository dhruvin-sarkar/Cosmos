import { describe, expect, it } from 'vitest';
import type { CutawayBodyLayout, CutawayRingPoint } from './cutaway';
import { boxHitsRing, layoutLabels, LABEL_GAP, onRing, pathHitsRing } from './labelLayout';

/** A Saturn-like frame: disc radius 270 at (960, 540), camera 15 deg above the ring plane (flattened ellipse). */
function saturn(): CutawayBodyLayout {
  const cx = 960, cy = 540, r = 270;
  const ellipse = (k: number): CutawayRingPoint[] =>
    Array.from({ length: 72 }, (_, i) => {
      const t = (i / 72) * Math.PI * 2;
      return { x: cx + Math.cos(t) * 2.27 * r * k, y: cy + Math.sin(t) * 2.27 * r * k * 0.26, far: Math.sin(t) < 0 };
    });
  return {
    cx, cy, rPx: r, kmPerPx: 200,
    anchors: [
      { x: cx, y: cy, visible: true },
      { x: cx + 110, y: cy - 60, visible: true },
      { x: cx + 160, y: cy - 150, visible: true },
    ],
    ring: { outer: ellipse(1), inner: ellipse(74658 / 136775), farUp: true },
  };
}

describe('layoutLabels', () => {
  it('keeps plain bodies in a column right of the disc, one gap apart, in anchor order', () => {
    const b = saturn();
    delete b.ring;
    const { items, colX } = layoutLabels(b, 3, 1920, 1080);
    expect(colX).toBeGreaterThan(b.cx + b.rPx);
    const ys = items.map(it => it.y).sort((a, c) => a - c);
    for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(LABEL_GAP - 1e-6);
  });

  it('puts ringed-body labels and leaders in clear space (never on the rings)', () => {
    for (const [w, h] of [[1920, 1080], [1366, 768]]) {
      const b = saturn();
      const { items, colX, kneeX } = layoutLabels(b, 3, w, h);
      for (const it of items) {
        expect(boxHitsRing(b, colX, it.y)).toBe(false);
        const path: Array<[number, number]> = [[it.ax, it.ay], [Math.max(kneeX, it.ax + 12), it.y], [colX - 8, it.y]];
        expect(pathHitsRing(b, path)).toBe(false);
      }
      const ys = items.map(it => it.y).sort((a, c) => a - c);
      for (let i = 1; i < ys.length; i++) expect(ys[i] - ys[i - 1]).toBeGreaterThanOrEqual(43);
    }
  });

  it('treats the far half of the ring behind the disc as hidden', () => {
    const b = saturn();
    expect(onRing(b, b.cx + 1.6 * b.rPx, b.cy)).toBe(true); // visible ring, right of the disc
    expect(onRing(b, b.cx, b.cy - 0.5 * b.rPx)).toBe(false); // far side, behind the disc
    expect(onRing(b, b.cx, b.cy + 0.2 * b.rPx)).toBe(false); // inside the inner edge of the C ring
    expect(onRing(b, b.cx, b.cy + 0.45 * b.rPx)).toBe(true); // near half crosses in front of the disc
  });
});
