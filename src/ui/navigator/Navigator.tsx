/**
 * Solar System navigator: a faceplate list of the Sun, every planet and dwarf planet with their moons and notable
 * spacecraft, real-texture thumbnails, distance from the camera and light-time. One click (or Enter) travels there
 * with the cinematic camera. Opened from the top bar ("Planets", B).
 */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Orbit, X } from 'lucide-react';
import type { Entity } from '../../core/entity';
import { useAppContext, useUiExtensions } from '../context';
import { useInterval } from '../hooks';
import { cx } from '../lib/dom';
import { formatDistance, formatDuration } from '../format';
import { Kbd } from '../components/Kbd';
import { Tooltip } from '../components/Tooltip';
import { classify, DIGIT_TARGETS, systemBodyOf, type NavBody } from './tree';
import { setNavigatorOpen, useNavFocusId, useNavigatorOpen, useSystemTree, useThumbnail } from './state';
import { useNavigatorShortcuts } from './keys';
import { useLabelTravel } from './labelTravel';
import { useFocusFramed } from './framing';
import { hasInterior } from '../interiors/data';
import './navigator.css';

const C = 299_792_458;

export function Thumb({ entity, size }: { entity: Entity; size: number }) {
  const url = useThumbnail(entity);
  return (
    <span className="cx-nav-thumb" style={{ width: size, height: size }} aria-hidden="true">
      {url && <img src={url} alt="" width={size} height={size} draggable={false} />}
    </span>
  );
}

function digitOf(id: string): string | null {
  const i = DIGIT_TARGETS.indexOf(id);
  return i >= 0 ? String(i) : null;
}

/** "1.52 AU · 12.7 min light" — distance from the camera now; Unknown when the engine cannot say. */
function DistanceLine({ id, tick }: { id: string; tick: number }) {
  const ext = useUiExtensions();
  void tick;
  const d = ext.cameraDistanceM?.(id) ?? null;
  if (d == null) return <span className="cx-nav-row__dist is-unknown">Distance unknown</span>;
  return (
    <span className="cx-nav-row__dist">
      {formatDistance(d, { secondary: 'none', sigDigits: 3 })}
      <span className="cx-nav-row__sep" aria-hidden="true"> · </span>
      {formatDuration(d / C, { style: 'short', sigDigits: 3 })} light
    </span>
  );
}

function BodyRow({ entity, parent, focusId, tick, onGo }: { entity: Entity; parent?: Entity | null; focusId: string | null; tick: number; onGo(id: string): void }) {
  const digit = digitOf(entity.id);
  const here = focusId === entity.id;
  return (
    <button
      type="button"
      data-nav-item=""
      className={cx('cx-nav-row', here && 'is-here')}
      aria-current={here ? 'location' : undefined}
      onClick={() => onGo(entity.id)}
    >
      <Thumb entity={entity} size={40} />
      <span className="cx-nav-row__text">
        <span className="cx-nav-row__name">{entity.name}</span>
        <span className="cx-nav-row__meta">
          {classify(entity, parent)}
          <span className="cx-nav-row__sep" aria-hidden="true"> · </span>
          <DistanceLine id={entity.id} tick={tick} />
        </span>
      </span>
      {digit && <Kbd keys={digit} size="sm" className="cx-nav-row__key" />}
    </button>
  );
}

function SatelliteChip({ entity, focusId, onGo }: { entity: Entity; focusId: string | null; onGo(id: string): void }) {
  const here = focusId === entity.id;
  const artificial = entity.kind !== 'moon';
  return (
    <li>
      <button
        type="button"
        data-nav-item=""
        className={cx('cx-nav-chip', here && 'is-here', artificial && 'is-artificial')}
        aria-current={here ? 'location' : undefined}
        onClick={() => onGo(entity.id)}
      >
        {artificial ? <span className="cx-nav-glyph" aria-hidden="true" /> : <Thumb entity={entity} size={22} />}
        <span>{entity.name}</span>
      </button>
    </li>
  );
}

function SystemSection({ body, focusId, tick, onGo }: { body: NavBody; focusId: string | null; tick: number; onGo(id: string): void }) {
  return (
    <li className="cx-nav-system">
      <BodyRow entity={body.entity} focusId={focusId} tick={tick} onGo={onGo} />
      {body.satellites.length > 0 && (
        <ul className="cx-nav-chips" aria-label={`${body.entity.name}: moons and spacecraft`}>
          {body.satellites.map(s => (
            <SatelliteChip key={s.id} entity={s} focusId={focusId} onGo={onGo} />
          ))}
        </ul>
      )}
    </li>
  );
}

/** "Inside the worlds": opens the interior cutaway (src/ui/interiors) of every body with interior data. */
function InsideSection({ tree }: { tree: ReturnType<typeof useSystemTree> }) {
  const worlds = [tree.sun, ...tree.bodies.flatMap(b => [b.entity, ...b.satellites])].filter(
    (e): e is Entity => e != null && hasInterior(e.id),
  );
  if (worlds.length === 0) return null;
  const open = (id: string): void => {
    setNavigatorOpen(false);
    void import('../interiors/open').then(m => m.openInterior(id));
  };
  return (
    <section className="cx-nav__group" data-testid="nav-inside">
      <h3 className="cx-nav__group-title">Inside the worlds</h3>
      <ul className="cx-nav-chips">
        {worlds.map(e => (
          <li key={e.id}>
            <button type="button" data-nav-item="" className="cx-nav-chip" aria-label={`See inside ${e.name}`} onClick={() => open(e.id)}>
              <Thumb entity={e} size={22} />
              <span>{e.name}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function moveFocus(root: HTMLElement, dir: 1 | -1): void {
  const items = Array.from(root.querySelectorAll<HTMLElement>('[data-nav-item]'));
  if (items.length === 0) return;
  const i = items.indexOf(document.activeElement as HTMLElement);
  const next = items[i < 0 ? 0 : Math.max(0, Math.min(items.length - 1, i + dir))];
  next.focus();
  next.scrollIntoView({ block: 'nearest' });
}

export function NavigatorPanel() {
  // The tree and distances are only computed while the panel is open (closed, it re-rendered on every registry/travel change).
  return useNavigatorOpen() ? <OpenNavigatorPanel /> : null;
}

function OpenNavigatorPanel() {
  const open = true;
  const focus = useFocusFramed();
  const tree = useSystemTree();
  const focusId = useNavFocusId();
  const tick = useInterval(500, open);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const here = root.querySelector<HTMLElement>('[aria-current="location"]') ?? root.querySelector<HTMLElement>('[data-nav-item]');
    here?.focus({ preventScroll: true });
    here?.scrollIntoView({ block: 'center' });
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (root.contains(t) || t?.closest?.('.cx-nav-trigger')) return;
      setNavigatorOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const go = (id: string): void => {
    setNavigatorOpen(false);
    void focus(id);
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      setNavigatorOpen(false);
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      if (rootRef.current) moveFocus(rootRef.current, e.key === 'ArrowDown' ? 1 : -1);
    }
  };
  const current = systemBodyOf(tree, focusId);

  return (
    <div ref={rootRef} className="cx-nav" role="dialog" aria-label="Solar System navigator" onKeyDown={onKeyDown}>
      <header className="cx-nav__head">
        <h2 className="cx-nav__title">Solar System</h2>
        <span className="cx-nav__spacer" />
        <button type="button" className="cx-nav__close" aria-label="Close navigator" onClick={() => setNavigatorOpen(false)}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="cx-nav__scroll">
        <ol className="cx-nav__list">
          {tree.sun && (
            <li className="cx-nav-system">
              <BodyRow entity={tree.sun} focusId={focusId} tick={tick} onGo={go} />
            </li>
          )}
          {tree.bodies.map(b => (
            <SystemSection key={b.entity.id} body={b} focusId={focusId} tick={tick} onGo={go} />
          ))}
        </ol>
        <InsideSection tree={tree} />
        {tree.spacecraft.length > 0 && (
          <section className="cx-nav__group">
            <h3 className="cx-nav__group-title">Spacecraft</h3>
            <ul className="cx-nav-chips">
              {tree.spacecraft.map(e => (
                <SatelliteChip key={e.id} entity={e} focusId={focusId} onGo={go} />
              ))}
            </ul>
          </section>
        )}
        {tree.smallBodies.length > 0 && (
          <section className="cx-nav__group">
            <h3 className="cx-nav__group-title">Asteroids and comets</h3>
            <ul className="cx-nav-chips">
              {tree.smallBodies.map(e => (
                <SatelliteChip key={e.id} entity={e} focusId={focusId} onGo={go} />
              ))}
            </ul>
          </section>
        )}
      </div>
      <p className="cx-nav__hint" aria-hidden="true">
        <span><Kbd keys="0" size="sm" />–<Kbd keys="9" size="sm" /> planets</span>
        <span><Kbd keys="[" size="sm" /><Kbd keys="]" size="sm" /> moons</span>
        <span><Kbd keys="Escape" size="sm" /> close</span>
      </p>
      <p className="cx-nav__foot">
        {current ? `In the ${current.entity.name} system.` : 'Pick a world to fly there.'} Distances are from the camera; light-time is how long its light takes to reach you.
      </p>
    </div>
  );
}

/** Top-bar trigger. */
export function NavigatorButton() {
  const open = useNavigatorOpen();
  return (
    <Tooltip content="Travel to a planet or moon" shortcut="B" side="bottom">
      <button
        type="button"
        className={cx('cx-bar-btn', 'cx-nav-trigger', 'cursor-target', open && 'is-on')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setNavigatorOpen(!open)}
      >
        <Orbit size={18} aria-hidden className="cx-bar-btn__icon" />
        <span className="cx-bar-btn__label">Planets</span>
      </button>
    </Tooltip>
  );
}

/** Always-mounted host: keyboard shortcuts, clickable labels and the panel. Mount once inside the HUD. */
export function NavigatorHost() {
  const { store, commands, registry } = useAppContext();
  useNavigatorShortcuts(store, commands, registry);
  useLabelTravel(commands, registry, store);
  return <NavigatorPanel />;
}
