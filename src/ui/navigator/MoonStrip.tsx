/**
 * Compact moon strip: when a planet (or one of its moons / spacecraft) is in focus, a row of pills above the body
 * strip hops between the planet and its satellites ([ and ] step through them). Long names use a short alias (ISS)
 * and every pill carries the full name as a tooltip; the list fades at an edge that has more pills behind it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '../lib/dom';
import { useCosmos } from '../hooks';
import { Kbd } from '../components/Kbd';
import { pillLabel, systemBodyOf } from './tree';
import { useNavFocusId, useSystemTree } from './state';
import { useFocusFramed } from './framing';
import { Thumb } from './Navigator';

export function MoonStrip() {
  const focus = useFocusFramed();
  const tree = useSystemTree();
  const focusId = useNavFocusId();
  const lab = useCosmos(s => s.lab.active != null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const sys = systemBodyOf(tree, focusId);
  const updateEdges = useCallback(() => {
    const l = listRef.current;
    if (!l) return;
    const left = l.scrollLeft > 1;
    const right = l.scrollLeft + l.clientWidth < l.scrollWidth - 1;
    setEdges(prev => (prev.left === left && prev.right === right ? prev : { left, right }));
  }, []);
  useEffect(() => {
    const list = listRef.current;
    const here = list?.querySelector<HTMLElement>('[aria-current="location"]');
    if (list && here) {
      // Keep the current pill visible inside the (width-capped) strip without scrolling the page.
      list.scrollLeft = Math.max(0, here.offsetLeft - (list.clientWidth - here.offsetWidth) / 2);
    }
    updateEdges();
  }, [focusId, sys, updateEdges]);
  useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(updateEdges);
    ro.observe(list);
    return () => ro.disconnect();
  }, [sys, updateEdges]);
  if (!sys || sys.satellites.length === 0 || lab) return null;
  const items = [sys.entity, ...sys.satellites];
  return (
    <div className="cx-moonstrip-band">
      <nav className="cx-moonstrip" aria-label={`${sys.entity.name} system`}>
        <Kbd keys="[" size="sm" className="cx-moonstrip__key" />
        <ol ref={listRef} onScroll={updateEdges} className={cx(edges.left && 'fade-left', edges.right && 'fade-right')}>
          {items.map((e, i) => {
            const here = e.id === focusId;
            const label = pillLabel(e);
            return (
              <li key={e.id} className={cx(i === 0 && 'is-primary')}>
                <button
                  type="button"
                  className={cx('cx-moonstrip__item', here && 'is-here')}
                  aria-current={here ? 'location' : undefined}
                  aria-label={label !== e.name ? e.name : undefined}
                  title={e.name}
                  onClick={ev => {
                    // A mouse click should not leave a focus ring next to the "you are here" ring once [ ] move on.
                    if (ev.detail > 0) ev.currentTarget.blur();
                    void focus(e.id);
                  }}
                >
                  {e.kind === 'moon' || i === 0 ? <Thumb entity={e} size={22} /> : <span className="cx-nav-glyph" aria-hidden="true" />}
                  <span className="cx-moonstrip__name">{label}</span>
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
