/**
 * Layer-label layout for the cutaway: pure geometry (no DOM), so it can be tested.
 *
 * Labels sit in an edge-aligned column beside the disc, in anchor order, never overlapping each other. For a ringed
 * body (Saturn) the column moves into the clear space above the ring's ellipse, so neither a label nor a leader line
 * crosses the rings; if that space is too small the column moves beyond the ring's outer edge instead.
 */
import type { CutawayBodyLayout } from './cutaway';

export const LABEL_GAP = 50;
export const LABEL_W = 200;
export const LABEL_H = 40;
const TOP = 92;
const BOTTOM_INSET = 120;

export interface PlacedLabel {
  ax: number;
  ay: number;
  visible: boolean;
  /** Label centre line (CSS px). */
  y: number;
}

export interface LabelLayout {
  items: PlacedLabel[];
  /** Left edge of the label column. */
  colX: number;
  /** x where the leader bends towards its label. */
  kneeX: number;
}

type Pt = { x: number; y: number; far: boolean };

function inPoly(poly: Pt[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** True when a screen point lies on a visible part of the ring (annulus minus the far half hidden behind the disc). */
export function onRing(body: CutawayBodyLayout, x: number, y: number): boolean {
  const ring = body.ring;
  if (!ring || !inPoly(ring.outer, x, y) || inPoly(ring.inner, x, y)) return false;
  const behindDisc = (x - body.cx) ** 2 + (y - body.cy) ** 2 < body.rPx * body.rPx && (ring.farUp ? y < body.cy : y > body.cy);
  return !behindDisc;
}

/** Samples a polyline and reports whether any sample falls on the visible ring. */
export function pathHitsRing(body: CutawayBodyLayout, pts: Array<[number, number]>): boolean {
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 6));
    for (let k = 0; k <= n; k++) {
      if (onRing(body, x0 + ((x1 - x0) * k) / n, y0 + ((y1 - y0) * k) / n)) return true;
    }
  }
  return false;
}

/** True when the label box (left edge x, centre line y) touches the visible ring. */
export function boxHitsRing(body: CutawayBodyLayout, x: number, y: number): boolean {
  for (let px = x - 4; px <= x + LABEL_W; px += 12) {
    for (let py = y - LABEL_H / 2 - 2; py <= y + LABEL_H / 2 + 2; py += 10) if (onRing(body, px, py)) return true;
  }
  return false;
}

function spread(shown: PlacedLabel[], top: number, bottom: number, gap: number): void {
  for (let k = 0; k < shown.length; k++) shown[k].y = Math.max(shown[k].ay, k > 0 ? shown[k - 1].y + gap : top);
  const over = shown.length ? shown[shown.length - 1].y - bottom : 0;
  if (over > 0) {
    for (let k = shown.length - 1; k >= 0; k--) {
      const limit = k < shown.length - 1 ? shown[k + 1].y - gap : bottom;
      shown[k].y = Math.min(shown[k].y, limit);
    }
  }
}

function leaderPoints(it: PlacedLabel, colX: number, kneeX: number): Array<[number, number]> {
  return [[it.ax, it.ay], [Math.max(kneeX, it.ax + 12), it.y], [colX - 8, it.y]];
}

export function layoutLabels(body: CutawayBodyLayout, count: number, width: number, height: number): LabelLayout {
  const items: PlacedLabel[] = body.anchors.slice(0, count).map(a => ({ ax: a.x, ay: a.y, visible: a.visible, y: a.y }));
  const shown = items.filter(it => it.visible).sort((p, q) => p.ay - q.ay);
  const bottom = height - BOTTOM_INSET;
  const maxCol = width - LABEL_W - 40;
  const ring = body.ring;
  const plainCol = Math.min(body.cx + body.rPx + 72, maxCol);
  const plainKnee = body.cx + body.rPx + 22;

  if (!ring || shown.length === 0) {
    spread(shown, TOP, bottom, LABEL_GAP);
    return { items, colX: plainCol, kneeX: plainKnee };
  }

  // 1) The clear band above the ring's ellipse, just right of the disc.
  let ringTop = Infinity;
  let ringRight = -Infinity;
  for (const p of ring.outer) {
    if (p.far && (p.x - body.cx) ** 2 + (p.y - body.cy) ** 2 < body.rPx ** 2) continue;
    ringTop = Math.min(ringTop, p.y);
    ringRight = Math.max(ringRight, p.x);
  }
  const zoneBottom = ringTop - LABEL_H / 2 - 22;
  const colTop = Math.min(body.cx + body.rPx + 28, maxCol);
  const kneeTop = body.cx + body.rPx + 10;
  const gap = shown.length > 1 ? Math.min(LABEL_GAP, (zoneBottom - TOP) / (shown.length - 1)) : LABEL_GAP;
  if (gap >= 44) {
    spread(shown, TOP, zoneBottom, gap);
    const clear = shown.every(it => !boxHitsRing(body, colTop, it.y) && !pathHitsRing(body, leaderPoints(it, colTop, kneeTop)));
    if (clear) return { items, colX: colTop, kneeX: kneeTop };
  }

  // 2) Beyond the ring's outer edge (leaders still have to cross the ring on the way out).
  spread(shown, TOP, bottom, LABEL_GAP);
  return { items, colX: Math.min(ringRight + 28, maxCol), kneeX: ringRight + 12 };
}

/** Lowest visible screen y of the ring (0 when the body has none): captions sit below it. */
export function ringBottom(body: CutawayBodyLayout): number {
  let y = 0;
  for (const p of body.ring?.outer ?? []) y = Math.max(y, p.y);
  return y;
}
