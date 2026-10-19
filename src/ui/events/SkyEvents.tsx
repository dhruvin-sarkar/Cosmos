/**
 * "What's up": real sky events you can fly to. Self-contained: <SkyEvents /> renders the top-bar button, the panel
 * (fixed under the top bar, left) and the caption card shown after "Show me". All astronomy lives in
 * src/science/events.ts; this file only renders and drives AppCommands. Mount once inside <AppContextProvider>.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import {
  ISS_SOURCE, computeSkyEvents, issPassEvents, type OmmElements, type SkyEvent, type SkyEventKind, type SkyObserver,
} from '../../science/events';
import notableJson from '../../domains/orbital/notable.generated.json';
import { useCommands, useCosmos, useReducedMotion, useRegistry, useStoreApi } from '../hooks';
import { setVisualScale } from '../../state/store';
import { cx } from '../lib/dom';
import { Tooltip } from '../components/Tooltip';
import { setNavigatorOpen } from '../navigator/state';
import { OBSERVER_PRESETS, getEventsUi, patchEventsUi, useEventsUi } from './state';
import { needsTrueScale, showEvent } from './showMe';
import './events.css';

const DAY_MS = 86_400_000;

// ── Data ──────────────────────────────────────────────────────────────────────────────────

/** ISS mean elements from the orbital domain's CelesTrak snapshot (null when the row is missing). */
function issElements(): OmmElements | null {
  const j = notableJson as { fields: string[]; rows: unknown[][] };
  const f = (name: string): number => j.fields.indexOf(name);
  const row = j.rows.find(r => r[f('norad')] === '25544');
  if (!row) return null;
  const n = (name: string): number => Number(row[f(name)]);
  return {
    name: String(row[f('name')]), norad: 25544, epochUtc: String(row[f('epochUTC')]),
    meanMotionRevPerDay: n('meanMotionRevPerDay'), eccentricity: n('eccentricity'), inclinationDeg: n('inclinationDeg'),
    raanDeg: n('raanDeg'), argPerigeeDeg: n('argPerigeeDeg'), meanAnomalyDeg: n('meanAnomalyDeg'), bstar: n('bstar'),
    meanMotionDot: n('meanMotionDot'), meanMotionDdot: n('meanMotionDdot'),
  };
}

interface EventList {
  events: SkyEvent[];
  issStale: boolean;
  issHidden: number;
  issEpoch: string | null;
}

const cache = new Map<string, EventList>();

function buildList(anchorMs: number, o: SkyObserver): EventList {
  const key = `${anchorMs}|${o.latDeg.toFixed(3)}|${o.lonDeg.toFixed(3)}|${o.name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const events = computeSkyEvents({ startMs: anchorMs, months: 24, observer: o });
  const iss = issElements();
  let issStale = true, issHidden = 0;
  if (iss) {
    const r = issPassEvents(iss, o, anchorMs, 7);
    issStale = r.stale;
    issHidden = r.hidden;
    events.push(...r.events);
    events.sort((a, b) => a.timeMs - b.timeMs);
  }
  const list = { events, issStale, issHidden, issEpoch: iss?.epochUtc ?? null };
  cache.set(key, list);
  return list;
}

/** Computed off the first frame (setTimeout) so opening the panel never blocks a render. */
function useEventList(anchorMs: number | null, observer: SkyObserver): EventList | null {
  const [list, setList] = useState<EventList | null>(null);
  useEffect(() => {
    if (anchorMs == null) return;
    setList(null);
    const id = window.setTimeout(() => setList(buildList(anchorMs, observer)), 30);
    return () => window.clearTimeout(id);
  }, [anchorMs, observer]);
  return list;
}

// ── Formatting ────────────────────────────────────────────────────────────────────────────

function dateParts(tMs: number, tz: string | null): { day: string; time: string; zone: string } {
  const opt = tz ? { timeZone: tz } : {};
  const day = new Intl.DateTimeFormat('en-GB', { ...opt, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }).format(tMs);
  const parts = new Intl.DateTimeFormat('en-GB', { ...opt, hour: '2-digit', minute: '2-digit', hour12: false, timeZoneName: 'short' }).formatToParts(tMs);
  const time = parts.filter(p => p.type === 'hour' || p.type === 'minute' || p.type === 'literal').map(p => p.value).join('').trim();
  const zone = parts.find(p => p.type === 'timeZoneName')?.value ?? '';
  return { day, time, zone };
}

function untilText(tMs: number, nowMs: number): string {
  const d = Math.round((tMs - nowMs) / DAY_MS);
  if (d < 0) return d === -1 ? 'yesterday' : `${-d} days ago`;
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d < 60) return `in ${d} days`;
  return `in ${Math.round(d / 30.44)} months`;
}

type Filter = 'all' | 'eclipses' | 'planets' | 'meteors' | 'seasons' | 'iss';

const FILTERS: { id: Filter; label: string; kinds: SkyEventKind[] }[] = [
  { id: 'all', label: 'All', kinds: [] },
  { id: 'eclipses', label: 'Eclipses', kinds: ['solar-eclipse', 'lunar-eclipse'] },
  { id: 'planets', label: 'Planets', kinds: ['conjunction', 'opposition', 'elongation'] },
  { id: 'meteors', label: 'Meteors', kinds: ['meteor-shower'] },
  { id: 'iss', label: 'ISS', kinds: ['iss-pass'] },
  { id: 'seasons', label: 'Seasons', kinds: ['season'] },
];

const KIND_LABEL: Record<SkyEventKind, string> = {
  'solar-eclipse': 'Solar eclipse', 'lunar-eclipse': 'Lunar eclipse', conjunction: 'Conjunction', opposition: 'Opposition',
  elongation: 'Elongation', 'meteor-shower': 'Meteor shower', season: 'Season', 'iss-pass': 'Space station',
};

// ── Components ────────────────────────────────────────────────────────────────────────────

export function SkyEventsButton() {
  const { open } = useEventsUi();
  const simTimeMs = useCosmos(s => s.time.simTimeMs);
  return (
    <Tooltip content="Eclipses, planets and meteor showers you can fly to" side="bottom">
      <button
        type="button"
        className={cx('cx-bar-btn', 'cx-ev-trigger', open && 'is-on')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          const s = getEventsUi();
          if (!s.open) setNavigatorOpen(false);
          patchEventsUi({ open: !s.open, anchorMs: s.anchorMs ?? Math.floor(simTimeMs / DAY_MS) * DAY_MS });
        }}
      >
        What’s up
      </button>
    </Tooltip>
  );
}

function ObserverPicker({ observer }: { observer: SkyObserver }) {
  const [editing, setEditing] = useState(false);
  const [lat, setLat] = useState(String(observer.latDeg));
  const [lon, setLon] = useState(String(observer.lonDeg));
  const presetIndex = OBSERVER_PRESETS.findIndex(p => p.name === observer.name && p.latDeg === observer.latDeg);
  const apply = (): void => {
    const la = Number(lat), lo = Number(lon);
    if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) return;
    patchEventsUi({ observer: { name: 'your location', latDeg: la, lonDeg: lo, heightM: 0, timeZone: null } });
    setEditing(false);
  };
  return (
    <div className="cx-ev-where">
      <label className="cx-ev-where__label" htmlFor="cx-ev-where-select">Seen from</label>
      <select
        id="cx-ev-where-select"
        className="cx-ev-where__select"
        value={presetIndex >= 0 ? String(presetIndex) : 'custom'}
        onChange={e => {
          if (e.target.value === 'custom') { setEditing(true); return; }
          const p = OBSERVER_PRESETS[Number(e.target.value)];
          if (p) { patchEventsUi({ observer: p }); setEditing(false); }
        }}
      >
        {OBSERVER_PRESETS.map((p, i) => <option key={p.name} value={String(i)}>{p.name}</option>)}
        <option value="custom">{presetIndex >= 0 ? 'Other…' : `${observer.latDeg.toFixed(2)}°, ${observer.lonDeg.toFixed(2)}°`}</option>
      </select>
      {editing && (
        <form className="cx-ev-where__custom" onSubmit={e => { e.preventDefault(); apply(); }}>
          <input aria-label="Latitude, degrees north" inputMode="decimal" value={lat} onChange={e => setLat(e.target.value)} />
          <input aria-label="Longitude, degrees east" inputMode="decimal" value={lon} onChange={e => setLon(e.target.value)} />
          <button type="submit" className="cx-ev-btn">Set</button>
        </form>
      )}
    </div>
  );
}

function EventRow({
  ev, observer, nowMs, expanded, onToggle, onShow,
}: {
  ev: SkyEvent; observer: SkyObserver; nowMs: number; expanded: boolean; onToggle(): void; onShow(): void;
}) {
  const when = dateParts(ev.timeMs, observer.timeZone);
  return (
    <li className={cx('cx-ev-item', ev.headline && 'is-headline', expanded && 'is-open')} data-ev-item>
      <button type="button" className="cx-ev-item__main" aria-expanded={expanded} onClick={onToggle}>
        <span className="cx-ev-item__when">
          <span className="cx-ev-item__day">{when.day}</span>
          <span className="cx-ev-item__time">{when.time} {when.zone}</span>
          <span className="cx-ev-item__until">{untilText(ev.timeMs, nowMs)}</span>
        </span>
        <span className="cx-ev-item__kind">{KIND_LABEL[ev.kind]}</span>
        <span className="cx-ev-item__title">{ev.title}</span>
        <span className="cx-ev-item__summary">{ev.summary}</span>
        {ev.local && <span className="cx-ev-item__local">{ev.local}</span>}
      </button>
      {expanded && (
        <div className="cx-ev-item__more">
          {ev.facts.length > 0 && (
            <dl className="cx-ev-facts">
              {ev.facts.map(f => (
                <div key={f.label} className="cx-ev-facts__row">
                  <dt>{f.label}</dt>
                  <dd>{f.value}</dd>
                </div>
              ))}
            </dl>
          )}
          <p className="cx-ev-item__source">Computed: {ev.source}</p>
        </div>
      )}
      <button type="button" className={cx('cx-ev-btn', 'cx-ev-show', expanded && 'is-primary')} onClick={onShow}>
        Show me
      </button>
    </li>
  );
}

export function SkyEventsPanel() {
  const { open, observer, anchorMs } = useEventsUi();
  const commands = useCommands();
  const registry = useRegistry();
  const store = useStoreApi();
  const reducedMotion = useReducedMotion();
  const simTimeMs = useCosmos(s => s.time.simTimeMs);
  const list = useEventList(open ? anchorMs : null, observer);
  const [filter, setFilter] = useState<Filter>('all');
  const [expanded, setExpanded] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    rootRef.current?.focus({ preventScroll: true });
    const onDown = (e: PointerEvent): void => {
      const t = e.target as Element | null;
      if (rootRef.current?.contains(t) || t?.closest?.('.cx-ev-trigger')) return;
      patchEventsUi({ open: false });
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const shown = useMemo(() => {
    if (!list) return [];
    const kinds = FILTERS.find(f => f.id === filter)?.kinds ?? [];
    return kinds.length ? list.events.filter(e => kinds.includes(e.kind)) : list.events;
  }, [list, filter]);
  const headline = useMemo(() => (filter === 'all' && list ? list.events.filter(e => e.headline).slice(0, 2) : []), [list, filter]);

  if (!open) return null;

  const show = (ev: SkyEvent): void => {
    const pending = getEventsUi().restoreScale;
    patchEventsUi({ open: false, shown: ev });
    void showEvent(ev, { commands, registry, store }, reducedMotion).then(prev => patchEventsUi({ restoreScale: pending ?? prev }));
  };
  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); patchEventsUi({ open: false }); }
  };
  const drifted = anchorMs != null && Math.abs(simTimeMs - anchorMs) > 2 * DAY_MS;
  const nowMs = anchorMs ?? simTimeMs;

  return (
    <div ref={rootRef} className="cx-ev" role="dialog" aria-label="Sky events" tabIndex={-1} onKeyDown={onKeyDown}>
      <header className="cx-ev__head">
        <h2 className="cx-ev__title">What’s up</h2>
        <span className="cx-ev__hint">Real events in the next two years</span>
        <button type="button" className="cx-ev__close" aria-label="Close sky events" onClick={() => patchEventsUi({ open: false })}>
          <X size={18} aria-hidden />
        </button>
      </header>
      <div className="cx-ev__bar">
        <ObserverPicker key={`${observer.latDeg},${observer.lonDeg}`} observer={observer} />
        <div className="cx-ev-filters" role="group" aria-label="Event type">
          {FILTERS.map(f => (
            <button key={f.id} type="button" className={cx('cx-ev-chip', filter === f.id && 'is-on')} aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
      </div>
      <div className="cx-ev__scroll">
        {!list && <p className="cx-ev__status">Working out the sky…</p>}
        {list && headline.length > 0 && (
          <section className="cx-ev-section" aria-label="Don’t miss">
            <h3 className="cx-ev-section__title">Don’t miss</h3>
            <ol className="cx-ev-list">
              {headline.map(ev => (
                <EventRow key={`h-${ev.id}`} ev={ev} observer={observer} nowMs={nowMs} expanded={expanded === `h-${ev.id}`}
                  onToggle={() => setExpanded(x => (x === `h-${ev.id}` ? null : `h-${ev.id}`))} onShow={() => show(ev)} />
              ))}
            </ol>
          </section>
        )}
        {list && (
          <section className="cx-ev-section" aria-label="All events">
            {headline.length > 0 && <h3 className="cx-ev-section__title">Coming up</h3>}
            {filter === 'iss' && list.issStale && (
              <p className="cx-ev__status">
                ISS passes need recent orbital elements. The snapshot from {list.issEpoch?.slice(0, 10) ?? 'Unknown'} only covers two weeks
                either side, so there are no predictions for this date.
              </p>
            )}
            {filter === 'iss' && !list.issStale && shown.length === 0 && (
              <p className="cx-ev__status">
                No visible ISS passes over {observer.name} in the next seven days.
                {list.issHidden > 0 && ` The station still crosses the sky ${list.issHidden} times, but always in daylight or in Earth’s shadow, where it cannot be seen.`}
              </p>
            )}
            <ol className="cx-ev-list">
              {shown.map(ev => (
                <EventRow key={ev.id} ev={ev} observer={observer} nowMs={nowMs} expanded={expanded === ev.id}
                  onToggle={() => setExpanded(x => (x === ev.id ? null : ev.id))} onShow={() => show(ev)} />
              ))}
            </ol>
          </section>
        )}
      </div>
      <footer className="cx-ev__foot">
        {drifted ? (
          <button type="button" className="cx-ev-btn" onClick={() => patchEventsUi({ anchorMs: Math.floor(simTimeMs / DAY_MS) * DAY_MS })}>
            List events from the current date
          </button>
        ) : (
          <span>Times for {observer.name}. ISS: {ISS_SOURCE.split(',')[0]}.</span>
        )}
      </footer>
    </div>
  );
}

/** Caption card shown after "Show me": what you are looking at, and a way back to the list. */
export function SkyEventCaption() {
  const { shown, open, observer, restoreScale } = useEventsUi();
  const commands = useCommands();
  const store = useStoreApi();
  const trueScale = useCosmos(s => s.visualScale === 'true');
  if (!shown || open) return null;
  const close = (reopen: boolean): void => {
    if (restoreScale) setVisualScale(store, restoreScale);
    patchEventsUi({ shown: null, restoreScale: null, open: reopen });
  };
  const when = dateParts(shown.timeMs, observer.timeZone);
  const hint = shown.kind === 'solar-eclipse'
    ? 'Clock held at greatest eclipse. Press play to watch the Moon’s shadow cross Earth.'
    : shown.kind === 'lunar-eclipse'
      ? 'Clock held at mid-eclipse. Press play to watch the Moon move through Earth’s shadow.'
      : shown.kind === 'iss-pass'
        ? 'Clock held at the highest point of the pass.'
        : 'Clock held at the moment of the event.';
  return (
    <aside className="cx-ev-caption" aria-live="polite">
      <span className="cx-ev-item__kind">{KIND_LABEL[shown.kind]}</span>
      <p className="cx-ev-caption__title">{shown.title}</p>
      <p className="cx-ev-caption__when">{when.day}, {when.time} {when.zone}</p>
      <p className="cx-ev-caption__summary">{shown.summary}</p>
      <p className="cx-ev-caption__hint">
        {hint}
        {needsTrueScale(shown) && trueScale && ' Shown at true scale, so the shadow is the real one.'}
      </p>
      <div className="cx-ev-caption__actions">
        <button type="button" className="cx-ev-btn" onClick={() => close(true)}>Back to events</button>
        <button type="button" className="cx-ev-btn" onClick={() => commands.resume()}>Play</button>
        <button type="button" className="cx-ev__close" aria-label="Close caption" onClick={() => close(false)}>
          <X size={18} aria-hidden />
        </button>
      </div>
    </aside>
  );
}

/** One-line mount: the top-bar button plus its panel and caption (both position: fixed). */
export function SkyEvents() {
  return (
    <>
      <SkyEventsButton />
      <SkyEventsPanel />
      <SkyEventCaption />
    </>
  );
}
