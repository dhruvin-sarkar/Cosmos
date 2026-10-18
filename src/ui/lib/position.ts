/** Placement of floating elements (tooltips, popovers) next to an anchor, flipped and clamped into the viewport. */

export type Side = 'top' | 'bottom' | 'left' | 'right';
export type Align = 'start' | 'center' | 'end';

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Placement {
  x: number;
  y: number;
  side: Side;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function room(anchor: Rect, side: Side, vw: number, vh: number): number {
  switch (side) {
    case 'top': return anchor.top;
    case 'bottom': return vh - (anchor.top + anchor.height);
    case 'left': return anchor.left;
    case 'right': return vw - (anchor.left + anchor.width);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return hi < lo ? lo : Math.min(Math.max(v, lo), hi);
}

/**
 * Pure placement: preferred side unless it doesn't fit and the opposite side has more room; aligned along the
 * cross axis; clamped `margin` px inside the viewport.
 */
export function computePlacement(
  anchor: Rect,
  floating: { width: number; height: number },
  preferred: Side,
  align: Align,
  offset: number,
  viewport: { width: number; height: number },
  margin = 8,
): Placement {
  const { width: vw, height: vh } = viewport;
  const need = preferred === 'top' || preferred === 'bottom' ? floating.height + offset : floating.width + offset;
  let side = preferred;
  if (room(anchor, preferred, vw, vh) < need + margin && room(anchor, OPPOSITE[preferred], vw, vh) > room(anchor, preferred, vw, vh)) {
    side = OPPOSITE[preferred];
  }

  let x: number;
  let y: number;
  if (side === 'top' || side === 'bottom') {
    y = side === 'top' ? anchor.top - offset - floating.height : anchor.top + anchor.height + offset;
    if (align === 'start') x = anchor.left;
    else if (align === 'end') x = anchor.left + anchor.width - floating.width;
    else x = anchor.left + anchor.width / 2 - floating.width / 2;
  } else {
    x = side === 'left' ? anchor.left - offset - floating.width : anchor.left + anchor.width + offset;
    if (align === 'start') y = anchor.top;
    else if (align === 'end') y = anchor.top + anchor.height - floating.height;
    else y = anchor.top + anchor.height / 2 - floating.height / 2;
  }
  x = clamp(x, margin, vw - margin - floating.width);
  y = clamp(y, margin, vh - margin - floating.height);
  return { x: Math.round(x), y: Math.round(y), side };
}
