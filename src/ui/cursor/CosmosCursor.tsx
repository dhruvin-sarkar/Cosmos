import { TargetCursor } from './TargetCursor';

/** Interactive DOM (class "cursor-target") plus the engine's 3D body labels. */
const TARGETS = '.cursor-target, .cosmos-label.is-shown .cosmos-label__text';
const LIVE = '.cosmos-label__text';

/** Label kinds that only name a region or a marker: a click selects them instead of travelling (labelTravel.ts). */
const NO_TRAVEL = new Set(['constellation', 'structure', 'annotation', 'landmark', 'reference', 'region']);

function labelFor(el: Element): string {
  if (!el.classList.contains('cosmos-label__text')) return '';
  const name = el.textContent?.trim();
  if (!name) return '';
  const kind = (el.closest('.cosmos-label') as HTMLElement | null)?.dataset.kind ?? '';
  return NO_TRAVEL.has(kind) ? name : `Fly to ${name}`;
}

/**
 * The Cosmos configuration of the lock-on cursor (docs/design/UI_SYSTEM.md, "Cursor"): thin white brackets glued to the
 * pointer, a calm six-second spin while roaming, a quick 0.16 s snap, a plain reticle while the visitor drags the 3D view.
 * White stays legible over black space and over a bright planet thanks to a one-pixel dark outline drawn behind each
 * bracket; blending is normal (a blend mode over the full-screen WebGL canvas costs a composite every frame).
 */
export function CosmosCursor() {
  return (
    <TargetCursor
      targetSelector={TARGETS}
      liveSelector={LIVE}
      dragSurfaceSelector=".cx-viewport"
      labelFor={labelFor}
      cursorColor="oklch(1 0 0 / 0.9)"
      cursorColorOnTarget="oklch(1 0 0)"
      outlineColor="oklch(0 0 0 / 0.5)"
      spinDuration={6}
      hoverDuration={0.16}
      parallaxOn
      hideDefaultCursor
      size={28}
      dragSize={18}
      cornerSize={8}
      thickness={1.5}
      padding={6}
      matchRadius
      dotSize={3}
      showLabel
      clickEffect
    />
  );
}
