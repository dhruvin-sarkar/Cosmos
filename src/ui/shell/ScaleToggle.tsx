import { useCosmos, useStoreApi } from '../hooks';
import { Tooltip } from '../components/Tooltip';
import { setVisualScale } from '../../state/store';
import { cx } from '../lib/dom';
import './scaleToggle.css';

const EXHIBITION_TIP =
  'Planets, moons and the Sun are drawn larger than life so they can be seen across the Solar System. ' +
  'Each body shrinks back to its true size as you approach it. Distances are never changed. Click for true scale.';
const TRUE_TIP = 'Everything is drawn at its real size: most bodies are far smaller than a pixel from afar. Click to enlarge for visibility.';

/**
 * Exhibition / True scale switch with the always-visible "Enlarged for visibility" disclosure (docs/design/VISUAL_SCALE.md).
 * The dotted ring follows the provenance mark language: dotted = illustrative (drawn size, not measured size).
 */
export function ScaleToggle() {
  const store = useStoreApi();
  const mode = useCosmos(s => s.visualScale);
  const exhibition = mode === 'exhibition';
  return (
    <Tooltip content={exhibition ? EXHIBITION_TIP : TRUE_TIP} side="bottom">
      <button
        type="button"
        className={cx('cx-scale', exhibition ? 'cx-scale--exhibition' : 'cx-scale--true')}
        aria-pressed={!exhibition}
        aria-label={exhibition ? 'Exhibition scale: bodies enlarged for visibility. Switch to true scale' : 'True scale. Switch to exhibition scale'}
        onClick={() => setVisualScale(store, exhibition ? 'true' : 'exhibition')}
      >
        <span className="cx-scale__mode">{exhibition ? 'Exhibition scale' : 'True scale'}</span>
        {exhibition && <span className="cx-scale__note">Enlarged for visibility</span>}
      </button>
    </Tooltip>
  );
}
