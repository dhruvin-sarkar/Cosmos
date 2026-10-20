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
 * The Cosmos configuration of the lock-on cursor (docs/design/UI_SYSTEM.md, "Cursor"): thin brass brackets, a calm
 * six-second spin while roaming, a quick 0.18 s snap, a plain reticle while the visitor drags the 3D view.
 * Brass stays legible over black space and over a bright planet thanks to its night-hairline halo, so the blend mode
 * is normal (difference would turn brass blue over a sunlit limb).
 */
export function CosmosCursor() {
  return (
    <TargetCursor
      targetSelector={TARGETS}
      liveSelector={LIVE}
      dragSurfaceSelector=".cx-viewport"
      labelFor={labelFor}
      cursorColor="oklch(0.85 0.1 88 / 0.78)"
      cursorColorOnTarget="oklch(0.88 0.1 88)"
      spinDuration={6}
      hoverDuration={0.18}
      parallaxOn
      hideDefaultCursor
      size={28}
      dragSize={18}
      cornerSize={8}
      thickness={1.5}
      padding={6}
      matchRadius
      dotSize={3}
      blendMode="normal"
      showLabel
      clickEffect
    />
  );
}
