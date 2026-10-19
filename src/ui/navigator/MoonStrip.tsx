/**
 * Compact moon strip: when a planet (or one of its moons / spacecraft) is in focus, a row of pills above the body
 * strip hops between the planet and its satellites ([ and ] step through them).
 */
import { cx } from '../lib/dom';
import { useCommands, useCosmos } from '../hooks';
import { Kbd } from '../components/Kbd';
import { systemBodyOf } from './tree';
import { useNavFocusId, useSystemTree } from './state';
import { Thumb } from './Navigator';

export function MoonStrip() {
  const commands = useCommands();
  const tree = useSystemTree();
  const focusId = useNavFocusId();
  const lab = useCosmos(s => s.lab.active != null);
  const sys = systemBodyOf(tree, focusId);
  if (!sys || sys.satellites.length === 0 || lab) return null;
  const items = [sys.entity, ...sys.satellites];
  return (
    <nav className="cx-moonstrip" aria-label={`${sys.entity.name} system`}>
      <Kbd keys="[" size="sm" className="cx-moonstrip__key" />
      <ol>
        {items.map((e, i) => {
          const here = e.id === focusId;
          return (
            <li key={e.id} className={cx(i === 0 && 'is-primary')}>
              <button
                type="button"
                className={cx('cx-moonstrip__item', here && 'is-here')}
                aria-current={here ? 'location' : undefined}
                onClick={() => void commands.focus(e.id)}
              >
                {e.kind === 'moon' || i === 0 ? <Thumb entity={e} size={22} /> : <span className="cx-nav-glyph" aria-hidden="true" />}
                <span>{e.name}</span>
              </button>
            </li>
          );
        })}
      </ol>
      <Kbd keys="]" size="sm" className="cx-moonstrip__key" />
    </nav>
  );
}
