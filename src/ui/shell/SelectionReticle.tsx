import { useEffect, useRef } from 'react';
import { useCosmos } from '../hooks';
import { useUiExtensions } from '../context';

const MIN_BOX_PX = 40;
/** Bracket arms never exceed this fraction of the box side, so small boxes stay four corners, not a closed square. */
const ARM_FRACTION = 0.28;
const PAD_PX = 10;

/**
 * Four brass corner brackets around the selected object's screen bounds ("under observation"). Positioned with
 * requestAnimationFrame from ext.screenBounds(); hidden when the engine does not provide bounds or the object is
 * off-screen. Contracts from 1.3× to 1× when the selection changes.
 */
export function SelectionReticle() {
  const id = useCosmos(s => s.selection.id);
  const ext = useUiExtensions();
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    const bounds = ext.screenBounds;
    if (!el || !id || !bounds) return;
    el.classList.remove('is-settled');
    let raf = 0;
    let first = true;
    const loop = (): void => {
      let b: ReturnType<typeof bounds> = null;
      try {
        b = bounds(id);
      } catch {
        b = null;
      }
      if (!b) {
        el.style.visibility = 'hidden';
      } else {
        const w = Math.max(MIN_BOX_PX, b.width + PAD_PX * 2);
        const h = Math.max(MIN_BOX_PX, b.height + PAD_PX * 2);
        el.style.visibility = 'visible';
        el.style.transform = `translate3d(${(b.x + b.width / 2 - w / 2).toFixed(1)}px, ${(b.y + b.height / 2 - h / 2).toFixed(1)}px, 0)`;
        el.style.width = `${w.toFixed(1)}px`;
        el.style.height = `${h.toFixed(1)}px`;
        el.style.setProperty('--bracket-arm', `${Math.min(14, Math.min(w, h) * ARM_FRACTION).toFixed(1)}px`);
        if (first) {
          first = false;
          requestAnimationFrame(() => el.classList.add('is-settled'));
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [id, ext]);

  if (!id || !ext.screenBounds) return null;
  return (
    <div ref={ref} className="cx-reticle" aria-hidden="true" style={{ visibility: 'hidden' }}>
      <span className="cx-reticle__inner">
        <i /><i /><i /><i />
      </span>
    </div>
  );
}
