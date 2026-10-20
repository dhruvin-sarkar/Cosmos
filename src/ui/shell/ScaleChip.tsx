import { useCosmos, useStoreApi } from '../hooks';
import { Tooltip } from '../components/Tooltip';
import { setVisualScale } from '../../state/store';
import { cx } from '../lib/dom';

const EXHIBITION_TIP =
  'Planets, moons and the Sun are drawn larger than life so they can be seen across the Solar System. ' +
  'Each body shrinks back to its true size as you approach it. Distances are never changed. Click for true scale.';
const TRUE_TIP = 'Everything is drawn at its real size: most bodies are far smaller than a pixel from afar. Click to enlarge for visibility.';

/**
 * Always-visible view-scale disclosure beside the search field (docs/design/VISUAL_SCALE.md, scientific-honesty contract).
 * Reads store.visualScale and toggles it. The ring follows the provenance mark language: dotted = illustrative (drawn
 * size, not measured size), solid = true size.
 */
export function ScaleChip() {
  const store = useStoreApi();
  const exhibition = useCosmos(s => s.visualScale === 'exhibition');
  return (
    <Tooltip content={exhibition ? EXHIBITION_TIP : TRUE_TIP} side="bottom">
      <button
        type="button"
        className={cx('cx-scalechip', 'cursor-target', exhibition ? 'cx-scalechip--exhibition' : 'cx-scalechip--true')}
        data-cursor-label={exhibition ? 'Switch to true scale' : 'Enlarge for visibility'}
        aria-pressed={!exhibition}
        aria-label={exhibition ? 'Exhibition scale: bodies enlarged for visibility. Switch to true scale' : 'True scale. Switch to exhibition scale'}
        onClick={() => setVisualScale(store, exhibition ? 'true' : 'exhibition')}
      >
        <span className="cx-scalechip__mark" aria-hidden="true" />
        <span className="cx-scalechip__text">
          <span className="cx-scalechip__mode">{exhibition ? 'Exhibition scale' : 'True scale'}</span>
          {exhibition && <span className="cx-scalechip__note">Enlarged for visibility</span>}
        </span>
      </button>
    </Tooltip>
  );
}
