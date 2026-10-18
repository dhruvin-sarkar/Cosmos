/**
 * DOM label manager (docs/ARCHITECTURE.md §5.6, §5.7).
 *
 * Layers submit LabelCandidates each frame; this module declutters them greedily by priority on a coarse
 * screen grid (exact rectangle overlap tests per cell) and renders a pooled set of absolutely positioned
 * divs moved with `translate3d` — no React, no layout reads per frame (text widths come from a cached
 * canvas measurement). Selected and hovered labels are boosted, always shown and styled distinctly.
 * Only the label text receives pointer events: clicking selects, double-clicking focuses.
 */
import type { LabelCandidate, LabelKind, Viewport } from './types';
import './labels.css';

export interface LabelFrameInfo {
  selectedId: string | null;
  hoveredId: string | null;
  viewport: Viewport;
  /** Maximum labels drawn (selected/hovered labels do not count against it). */
  budget: number;
  /** The 'labels' overlay; when off only the selected and hovered labels are drawn. */
  enabled: boolean;
  /** Wall-clock ms (performance.now) used for fade bookkeeping. */
  nowMs: number;
}

export interface LabelManagerOptions {
  /** Element the label layer is appended to (positioned above the canvas). */
  parent: HTMLElement;
  onSelect?(entityId: string): void;
  onFocus?(entityId: string): void;
  onHover?(entityId: string | null): void;
  /** Wheel events over label text are re-dispatched here so zooming never stalls over a label. */
  wheelTarget?: HTMLElement | null;
}

export interface LabelManager {
  readonly element: HTMLDivElement;
  update(candidates: readonly LabelCandidate[], frame: LabelFrameInfo): void;
  /** True when the entity's label was drawn in the last update. */
  isShown(entityId: string): boolean;
  /** Number of labels drawn in the last update. */
  shownCount(): number;
  /** Hide every label (e.g. while the WebGL context is lost). */
  clear(): void;
  dispose(): void;
}

type LabelFamily = 'ui' | 'mono' | 'atlas';

interface KindStyle {
  sizePx: number;
  weight: number;
  trackingEm: number;
  family: LabelFamily;
  italic: boolean;
}

/**
 * Keep in sync with labels.css (used for declutter measurement). Per docs/design/VISUAL_DIRECTION.md:
 * sky labels speak in the Instrument voice (Inter 13 px / 500 + halo), constellation names in Atlas italic
 * (15 px minimum), identifiers in Catalogue mono. Sentence case only — never uppercase.
 */
const KIND_STYLES: Record<LabelKind, KindStyle> = {
  body: { sizePx: 13, weight: 500, trackingEm: 0, family: 'ui', italic: false },
  star: { sizePx: 12, weight: 450, trackingEm: 0.005, family: 'ui', italic: false },
  satellite: { sizePx: 12, weight: 450, trackingEm: 0.005, family: 'ui', italic: false },
  spacecraft: { sizePx: 12.5, weight: 500, trackingEm: 0, family: 'ui', italic: false },
  galaxy: { sizePx: 12.5, weight: 450, trackingEm: 0.005, family: 'ui', italic: false },
  structure: { sizePx: 12.5, weight: 450, trackingEm: 0.01, family: 'ui', italic: false },
  constellation: { sizePx: 15, weight: 400, trackingEm: 0.08, family: 'atlas', italic: true },
  landmark: { sizePx: 12, weight: 500, trackingEm: 0.005, family: 'ui', italic: false },
  annotation: { sizePx: 11.5, weight: 400, trackingEm: 0, family: 'mono', italic: false },
};

const PAD_X = 5;
const PAD_Y = 2;
const DETAIL_LINE_PX = 14;
const GAP_PX = 6;
const OVERLAP_PAD = 2;
const CELL = 64;
const ANCHOR_MARGIN = 48;
const RELEASE_AFTER_MS = 400;
/** A non-forced label whose anchor lies this close to an already placed one is dropped (co-located bodies). */
const ANCHOR_MERGE_PX = 4;
const SELECTED_BOOST = 1e12;
const HOVERED_BOOST = 1e11;

const SIDE_RIGHT = 0;
const SIDE_LEFT = 1;
const SIDE_TOP = 2;
const SIDE_BOTTOM = 3;
const SIDE_CLASSES = ['side-right', 'side-left', 'side-top', 'side-bottom'];

const FLAG_SELECTED = 1;
const FLAG_HOVERED = 2;

interface Slot {
  el: HTMLDivElement;
  textEl: HTMLSpanElement;
  detailEl: HTMLSpanElement;
  key: string | null;
  text: string;
  detail: string;
  kind: string;
  side: number;
  x: number;
  y: number;
  opacity: number;
  flags: number;
  shown: boolean;
  usedFrame: number;
  hiddenAt: number;
}

export function createLabelManager(opts: LabelManagerOptions): LabelManager {
  const root = document.createElement('div');
  root.className = 'cosmos-labels';
  // Labels duplicate what search and the inspector expose accessibly; a constantly moving DOM would be noise.
  root.setAttribute('aria-hidden', 'true');
  opts.parent.appendChild(root);

  const pool: Slot[] = [];
  const free: Slot[] = [];
  const byKey = new Map<string, Slot>();
  const widthCache = new Map<string, number>();
  let frameNo = 0;
  let shown = 0;

  // ── Text measurement ──────────────────────────────────────────────────────────────────────
  const measureCtx = document.createElement('canvas').getContext('2d');
  let uiFamily = "'Inter Variable', Inter, system-ui, sans-serif";
  let monoFamily = "'JetBrains Mono', ui-monospace, monospace";
  let atlasFamily = "'Bodoni Moda Variable', 'Bodoni Moda', Didot, serif";
  const readFonts = (): void => {
    const cs = getComputedStyle(root);
    uiFamily = cs.getPropertyValue('--cosmos-font-ui').trim() || uiFamily;
    monoFamily = cs.getPropertyValue('--cosmos-font-mono').trim() || monoFamily;
    atlasFamily = cs.getPropertyValue('--cosmos-font-atlas').trim() || cs.getPropertyValue('--font-atlas').trim() || atlasFamily;
    widthCache.clear();
  };
  readFonts();
  const onFontsLoaded = (): void => readFonts();
  document.fonts?.addEventListener?.('loadingdone', onFontsLoaded);

  const measure = (text: string, kind: LabelKind): number => {
    const key = kind + '\u0000' + text;
    const cached = widthCache.get(key);
    if (cached !== undefined) return cached;
    const s = KIND_STYLES[kind] ?? KIND_STYLES.body;
    let w = text.length * s.sizePx * 0.56;
    if (measureCtx) {
      const family = s.family === 'mono' ? monoFamily : s.family === 'atlas' ? atlasFamily : uiFamily;
      measureCtx.font = `${s.italic ? 'italic ' : ''}${s.weight} ${s.sizePx}px ${family}`;
      w = measureCtx.measureText(text).width;
    }
    w += text.length * s.trackingEm * s.sizePx + 2 * PAD_X;
    if (widthCache.size > 4000) widthCache.clear();
    widthCache.set(key, w);
    return w;
  };

  // ── Coarse grid of placed rectangles (linked lists in typed arrays) ───────────────────────
  let cols = 0;
  let rows = 0;
  let cellHead = new Int32Array(0);
  let entryRect = new Int32Array(512);
  let entryNext = new Int32Array(512);
  let entryCount = 0;
  let rects = new Float32Array(4 * 256);
  let rectCount = 0;
  let gridW = 0;
  let gridH = 0;

  const resetGrid = (w: number, h: number): void => {
    if (w !== gridW || h !== gridH) {
      gridW = w;
      gridH = h;
      cols = Math.max(1, Math.ceil(w / CELL));
      rows = Math.max(1, Math.ceil(h / CELL));
      cellHead = new Int32Array(cols * rows);
    }
    cellHead.fill(-1);
    entryCount = 0;
    rectCount = 0;
  };

  const cellRange = (x0: number, y0: number, x1: number, y1: number, out: Int32Array): void => {
    out[0] = Math.max(0, Math.min(cols - 1, Math.floor(x0 / CELL)));
    out[1] = Math.max(0, Math.min(rows - 1, Math.floor(y0 / CELL)));
    out[2] = Math.max(0, Math.min(cols - 1, Math.floor(x1 / CELL)));
    out[3] = Math.max(0, Math.min(rows - 1, Math.floor(y1 / CELL)));
  };
  const range = new Int32Array(4);

  const overlaps = (x0: number, y0: number, x1: number, y1: number): boolean => {
    cellRange(x0, y0, x1, y1, range);
    for (let cy = range[1]; cy <= range[3]; cy++) {
      for (let cx = range[0]; cx <= range[2]; cx++) {
        for (let e = cellHead[cy * cols + cx]; e >= 0; e = entryNext[e]) {
          const r = entryRect[e] * 4;
          if (x0 < rects[r + 2] + OVERLAP_PAD && x1 > rects[r] - OVERLAP_PAD && y0 < rects[r + 3] + OVERLAP_PAD && y1 > rects[r + 1] - OVERLAP_PAD) {
            return true;
          }
        }
      }
    }
    return false;
  };

  const insertRect = (x0: number, y0: number, x1: number, y1: number): void => {
    if ((rectCount + 1) * 4 > rects.length) {
      const grown = new Float32Array(rects.length * 2);
      grown.set(rects);
      rects = grown;
    }
    const r = rectCount++;
    rects[r * 4] = x0;
    rects[r * 4 + 1] = y0;
    rects[r * 4 + 2] = x1;
    rects[r * 4 + 3] = y1;
    cellRange(x0, y0, x1, y1, range);
    for (let cy = range[1]; cy <= range[3]; cy++) {
      for (let cx = range[0]; cx <= range[2]; cx++) {
        if (entryCount >= entryRect.length) {
          const er = new Int32Array(entryRect.length * 2);
          er.set(entryRect);
          entryRect = er;
          const en = new Int32Array(entryNext.length * 2);
          en.set(entryNext);
          entryNext = en;
        }
        const cell = cy * cols + cx;
        entryRect[entryCount] = r;
        entryNext[entryCount] = cellHead[cell];
        cellHead[cell] = entryCount++;
      }
    }
  };

  // ── Slots ───────────────────────────────────────────────────────────────────────────────
  const createSlot = (): Slot => {
    const el = document.createElement('div');
    el.className = 'cosmos-label side-right';
    const box = document.createElement('div');
    box.className = 'cosmos-label__box';
    const textEl = document.createElement('span');
    textEl.className = 'cosmos-label__text';
    const detailEl = document.createElement('span');
    detailEl.className = 'cosmos-label__detail';
    box.append(textEl, detailEl);
    el.appendChild(box);
    root.appendChild(el);
    const slot: Slot = {
      el, textEl, detailEl, key: null, text: '', detail: '', kind: '', side: SIDE_RIGHT,
      x: Number.NaN, y: Number.NaN, opacity: -1, flags: 0, shown: false, usedFrame: -1, hiddenAt: 0,
    };
    pool.push(slot);
    return slot;
  };

  const unbind = (slot: Slot): void => {
    if (slot.key !== null) {
      if (byKey.get(slot.key) === slot) byKey.delete(slot.key);
      slot.key = null;
      delete slot.el.dataset.entityId;
      free.push(slot);
    }
  };

  const acquire = (key: string): Slot => {
    let slot = byKey.get(key);
    if (slot) return slot;
    slot = free.pop();
    while (slot && slot.key !== null) slot = free.pop();
    slot ??= createSlot();
    slot.key = key;
    byKey.set(key, slot);
    return slot;
  };

  const hide = (slot: Slot, nowMs: number): void => {
    if (!slot.shown) return;
    slot.shown = false;
    slot.hiddenAt = nowMs;
    slot.el.classList.remove('is-shown');
  };

  const apply = (slot: Slot, c: LabelCandidate, side: number, ax: number, ay: number, flags: number, showDetail: boolean): void => {
    const el = slot.el;
    if (slot.text !== c.text) {
      slot.text = c.text;
      slot.textEl.textContent = c.text;
    }
    const detail = showDetail ? (c.detail ?? '') : '';
    if (slot.detail !== detail) {
      slot.detail = detail;
      slot.detailEl.textContent = detail;
    }
    if (slot.kind !== c.kind) {
      slot.kind = c.kind;
      el.dataset.kind = c.kind;
    }
    if (c.entityId) {
      if (el.dataset.entityId !== c.entityId) el.dataset.entityId = c.entityId;
    } else if (el.dataset.entityId !== undefined) {
      delete el.dataset.entityId;
    }
    if (slot.side !== side) {
      el.classList.remove(SIDE_CLASSES[slot.side]);
      el.classList.add(SIDE_CLASSES[side]);
      slot.side = side;
    }
    if (slot.flags !== flags) {
      el.classList.toggle('is-selected', (flags & FLAG_SELECTED) !== 0);
      el.classList.toggle('is-hovered', (flags & FLAG_HOVERED) !== 0);
      slot.flags = flags;
    }
    if (!(Math.abs(slot.x - ax) <= 0.05 && Math.abs(slot.y - ay) <= 0.05)) {
      slot.x = ax;
      slot.y = ay;
      el.style.transform = `translate3d(${ax.toFixed(1)}px,${ay.toFixed(1)}px,0)`;
    }
    const opacity = Math.round(Math.min(1, Math.max(0, c.opacity ?? 1)) * 40) / 40;
    if (slot.opacity !== opacity) {
      slot.opacity = opacity;
      el.style.setProperty('--label-opacity', String(opacity));
    }
    if (!slot.shown) {
      slot.shown = true;
      el.classList.add('is-shown');
    }
  };

  // ── Placement ───────────────────────────────────────────────────────────────────────────
  /** Scratch result of `place()`: anchor x/y of the label element, then the rect's top-left x/y. */
  const placed = new Float64Array(4);

  /** Rect of a label of size w×h placed on `side` of anchor (x, y) at radial distance r → `placed`. */
  const layoutSide = (side: number, x: number, y: number, r: number, w: number, h: number): void => {
    if (side === SIDE_RIGHT) {
      placed[0] = x + r; placed[1] = y; placed[2] = x + r; placed[3] = y - h / 2;
    } else if (side === SIDE_LEFT) {
      placed[0] = x - r; placed[1] = y; placed[2] = x - r - w; placed[3] = y - h / 2;
    } else if (side === SIDE_TOP) {
      placed[0] = x; placed[1] = y - r; placed[2] = x - w / 2; placed[3] = y - r - h;
    } else {
      placed[0] = x; placed[1] = y + r; placed[2] = x - w / 2; placed[3] = y + r;
    }
  };

  /** Attempt order: the label's previous side first (temporal stability), then right, left, top, bottom. */
  const sideForAttempt = (attempt: number, preferred: number): number => {
    if (attempt === 0) return preferred;
    return attempt <= preferred ? attempt - 1 : attempt;
  };

  /** Greedy placement against already placed labels; returns the side or -1 (result in `placed`). */
  const place = (x: number, y: number, r: number, w: number, h: number, preferred: number, vw: number, vh: number): number => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const side = sideForAttempt(attempt, preferred);
      layoutSide(side, x, y, r, w, h);
      const x0 = placed[2];
      const y0 = placed[3];
      if (x0 >= 0 && y0 >= 0 && x0 + w <= vw && y0 + h <= vh && !overlaps(x0, y0, x0 + w, y0 + h)) return side;
    }
    return -1;
  };

  // ── Per-frame update ────────────────────────────────────────────────────────────────────
  let anchors = new Float64Array(256);
  let anchorCount = 0;
  let order: number[] = [];
  let prio = new Float64Array(256);
  const byPriority = (a: number, b: number): number => prio[b] - prio[a];

  const sortByPriority = (candidates: readonly LabelCandidate[], f: LabelFrameInfo): void => {
    const n = candidates.length;
    if (prio.length < n) prio = new Float64Array(Math.max(n, prio.length * 2));
    order.length = n;
    for (let i = 0; i < n; i++) {
      const c = candidates[i];
      let p = c.priority;
      if (c.entityId !== null && c.entityId === f.selectedId) p += SELECTED_BOOST;
      else if (c.entityId !== null && c.entityId === f.hoveredId) p += HOVERED_BOOST;
      prio[i] = p;
      order[i] = i;
    }
    order.sort(byPriority);
  };

  const anchorOnScreen = (c: LabelCandidate, vw: number, vh: number): boolean =>
    c.x > -ANCHOR_MARGIN && c.x < vw + ANCHOR_MARGIN && c.y > -ANCHOR_MARGIN && c.y < vh + ANCHOR_MARGIN;

  /** Place and draw one candidate; returns false when it was dropped. */
  const placeCandidate = (c: LabelCandidate, f: LabelFrameInfo, forced: boolean, flags: number): boolean => {
    const vw = f.viewport.width;
    const vh = f.viewport.height;
    if (!anchorOnScreen(c, vw, vh)) return false;
    const key = c.entityId ?? c.text;
    const existing = byKey.get(key);
    if (existing?.usedFrame === frameNo) return false;
    if (!forced) {
      for (let i = 0; i < anchorCount; i++) {
        if (Math.abs(anchors[2 * i] - c.x) < ANCHOR_MERGE_PX && Math.abs(anchors[2 * i + 1] - c.y) < ANCHOR_MERGE_PX) return false;
      }
    }

    const kind: LabelKind = KIND_STYLES[c.kind] ? c.kind : 'body';
    const showDetail = forced && !!c.detail;
    const w = Math.max(measure(c.text, kind), showDetail ? measure(c.detail ?? '', 'annotation') : 0);
    const h = KIND_STYLES[kind].sizePx * 1.3 + 2 * PAD_Y + (showDetail ? DETAIL_LINE_PX : 0);
    const r = Math.max(0, c.offsetPx ?? 0) + GAP_PX;

    let side = place(c.x, c.y, r, w, h, existing ? existing.side : SIDE_RIGHT, vw, vh);
    if (side < 0) {
      if (!forced) return false;
      side = SIDE_RIGHT;
      layoutSide(side, c.x, c.y, r, w, h);
    }
    insertRect(placed[2], placed[3], placed[2] + w, placed[3] + h);
    if (2 * anchorCount + 2 > anchors.length) {
      const grown = new Float64Array(anchors.length * 2);
      grown.set(anchors);
      anchors = grown;
    }
    anchors[2 * anchorCount] = c.x;
    anchors[2 * anchorCount + 1] = c.y;
    anchorCount++;
    const slot = acquire(key);
    apply(slot, c, side, placed[0], placed[1], flags, showDetail);
    slot.usedFrame = frameNo;
    return true;
  };

  const update = (candidates: readonly LabelCandidate[], f: LabelFrameInfo): void => {
    frameNo += 1;
    anchorCount = 0;
    shown = 0;
    resetGrid(f.viewport.width, f.viewport.height);
    sortByPriority(candidates, f);

    let budgetUsed = 0;
    for (const index of order) {
      const c = candidates[index];
      if (!c.text) continue;
      const isSelected = c.entityId !== null && c.entityId === f.selectedId;
      const isHovered = c.entityId !== null && c.entityId === f.hoveredId;
      const forced = isSelected || isHovered;
      if (!forced && (!f.enabled || budgetUsed >= f.budget || (c.opacity ?? 1) <= 0.02)) continue;
      const flags = (isSelected ? FLAG_SELECTED : 0) | (isHovered ? FLAG_HOVERED : 0);
      if (!placeCandidate(c, f, forced, flags)) continue;
      shown += 1;
      if (!forced) budgetUsed += 1;
    }

    for (const slot of pool) {
      if (slot.key === null || slot.usedFrame === frameNo) continue;
      if (slot.shown) hide(slot, f.nowMs);
      else if (f.nowMs - slot.hiddenAt > RELEASE_AFTER_MS) unbind(slot);
    }
  };

  // ── Interaction (event delegation on the layer root) ─────────────────────────────────────
  const idFromEvent = (e: Event): string | null => {
    const target = e.target as Element | null;
    const label = target?.closest?.('.cosmos-label') as HTMLElement | null;
    return label?.dataset.entityId ?? null;
  };
  const onClick = (e: MouseEvent): void => {
    const id = idFromEvent(e);
    if (id) {
      e.stopPropagation();
      opts.onSelect?.(id);
    }
  };
  const onDblClick = (e: MouseEvent): void => {
    const id = idFromEvent(e);
    if (id) {
      e.stopPropagation();
      opts.onFocus?.(id);
    }
  };
  let hoverId: string | null = null;
  const onPointerOver = (e: PointerEvent): void => {
    const id = idFromEvent(e);
    if (id && id !== hoverId) {
      hoverId = id;
      opts.onHover?.(id);
    }
  };
  const onPointerOut = (e: PointerEvent): void => {
    if (!hoverId) return;
    const next = (e.relatedTarget as Element | null)?.closest?.('.cosmos-label') as HTMLElement | null;
    if (next?.dataset.entityId === hoverId) return;
    hoverId = null;
    opts.onHover?.(null);
  };
  const stop = (e: Event): void => {
    if (idFromEvent(e) !== null || (e.target as Element | null)?.closest?.('.cosmos-label')) e.stopPropagation();
  };
  const onWheel = (e: WheelEvent): void => {
    if (!opts.wheelTarget) return;
    e.preventDefault();
    e.stopPropagation();
    opts.wheelTarget.dispatchEvent(new WheelEvent(e.type, e));
  };
  root.addEventListener('click', onClick);
  root.addEventListener('dblclick', onDblClick);
  root.addEventListener('pointerover', onPointerOver);
  root.addEventListener('pointerout', onPointerOut);
  root.addEventListener('pointerdown', stop);
  root.addEventListener('pointerup', stop);
  root.addEventListener('wheel', onWheel, { passive: false });

  return {
    element: root,
    update,
    isShown(entityId: string): boolean {
      const slot = byKey.get(entityId);
      return !!slot && slot.shown && slot.usedFrame === frameNo;
    },
    shownCount(): number {
      return shown;
    },
    clear(): void {
      const now = performance.now();
      for (const slot of pool) hide(slot, now);
      shown = 0;
      frameNo += 1;
    },
    dispose(): void {
      root.removeEventListener('click', onClick);
      root.removeEventListener('dblclick', onDblClick);
      root.removeEventListener('pointerover', onPointerOver);
      root.removeEventListener('pointerout', onPointerOut);
      root.removeEventListener('pointerdown', stop);
      root.removeEventListener('pointerup', stop);
      root.removeEventListener('wheel', onWheel);
      document.fonts?.removeEventListener?.('loadingdone', onFontsLoaded);
      root.remove();
      pool.length = 0;
      free.length = 0;
      byKey.clear();
      order = [];
    },
  };
}
