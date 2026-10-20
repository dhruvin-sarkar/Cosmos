/**
 * Compact moon strip: when a planet (or one of its moons / spacecraft) is in focus, a row of pills above the body
 * strip hops between the planet and its satellites ([ and ] step through them). Long names use a short alias (ISS)
 * and every pill carries the full name as a tooltip; the list fades at an edge that has more pills behind it.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { cx } from '../lib/dom';
import { useCosmos } from '../hooks';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Tooltip } from '../components/Tooltip';
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
  const at = items.findIndex(e => e.id === focusId);
  const step = (d: -1 | 1): void => {
    const n = items.length;
    const target = items[((at < 0 ? 0 : at) + d + n) % n];
    if (target) void focus(target.id);
  };
  return (
    <div className="cx-moonstrip-band">
      <nav className="cx-moonstrip" aria-label={`${sys.entity.name} system`}>
        <Tooltip content="Previous in this system" shortcut="[" side="top">
          <button type="button" className="cx-moonstrip__key cursor-target" aria-label="Previous in this system" aria-keyshortcuts="[" onClick={() => step(-1)}>
            <ChevronLeft size={16} aria-hidden />
          </button>
        </Tooltip>
        <ol ref={listRef} onScroll={updateEdges} className={cx(edges.left && 'fade-left', edges.right && 'fade-right')}>
          {items.map((e, i) => {
            const here = e.id === focusId;
            const label = pillLabel(e);
            return (
              <li key={e.id} className={cx(i === 0 && 'is-primary')}>
                <button
                  type="button"
                  className={cx('cx-moonstrip__item', 'cursor-target', here && 'is-here')}
                  data-cursor-label={here ? undefined : `Fly to ${e.name}`}
                  aria-current={here ? 'location' : undefined}
                  aria-label={label !== e.name ? e.name : undefined}
                  onClick={ev => {
                    // A mouse click should not leave a focus ring next to the "you are here" ring once [ ] move on.
                    if (ev.detail > 0) ev.currentTarget.blur();
                    void focus(e.id);
                  }}
                >
                  {e.kind === 'moon' || i === 0 ? <Thumb entity={e} size={24} /> : <span className="cx-nav-glyph" aria-hidden="true" />}
                  <span className="cx-moonstrip__name">{label}</span>
                </button>
              </li>
            );
          })}
        </ol>
        <Tooltip content="Next in this system" shortcut="]" side="top">
          <button type="button" className="cx-moonstrip__key cursor-target" aria-label="Next in this system" aria-keyshortcuts="]" onClick={() => step(1)}>
            <ChevronRight size={16} aria-hidden />
          </button>
        </Tooltip>
      </nav>
    </div>
  );
}
