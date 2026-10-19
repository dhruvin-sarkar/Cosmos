/**
 * Compact moon strip: when a planet (or one of its moons / spacecraft) is in focus, a row of pills above the body
 * strip hops between the planet and its satellites ([ and ] step through them).
 */
import { useEffect, useRef } from 'react';
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
  const listRef = useRef<HTMLOListElement | null>(null);
  const sys = systemBodyOf(tree, focusId);
  useEffect(() => {
    const here = listRef.current?.querySelector<HTMLElement>('[aria-current="location"]');
    const list = listRef.current;
    if (!here || !list) return;
    // Keep the current pill visible inside the (width-capped) strip without scrolling the page.
    list.scrollLeft = Math.max(0, here.offsetLeft - (list.clientWidth - here.offsetWidth) / 2);
  }, [focusId, sys]);
  if (!sys || sys.satellites.length === 0 || lab) return null;
  const items = [sys.entity, ...sys.satellites];
  return (
    <div className="cx-moonstrip-band">
      <nav className="cx-moonstrip" aria-label={`${sys.entity.name} system`}>
        <Kbd keys="[" size="sm" className="cx-moonstrip__key" />
        <ol ref={listRef}>
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
    </div>
  );
}
