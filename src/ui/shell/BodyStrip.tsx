import { useMemo, useRef } from 'react';
import { Vector3 } from 'three';
import type { Entity, EntityRegistry } from '../../core/entity';
import { useCommands, useCosmos, useRegistry, useRegistryVersion, safeGetEntity } from '../hooks';
import { useUiExtensions } from '../context';
import { cx, useElementWidth } from '../lib/dom';
import { MoonStrip } from '../navigator/MoonStrip';

const SOLAR_BODIES = ['sol:mercury', 'sol:venus', 'sol:earth', 'sol:mars', 'sol:jupiter', 'sol:saturn', 'sol:uranus', 'sol:neptune'];
const PRIMARY_KINDS = new Set(['star', 'stellar-system', 'black-hole']);
const MIN_GAP_PX = 84;
const DAY_MS = 86_400_000;

/** The system whose bodies the strip shows: the focus itself when it is a star, else the nearest star ancestor. */
function systemOf(registry: EntityRegistry, focus: Entity | undefined): Entity | undefined {
  if (!focus) return undefined;
  if (PRIMARY_KINDS.has(focus.kind)) return focus;
  let id = focus.parentId;
  for (let i = 0; i < 6 && id; i++) {
    const e = safeGetEntity(registry, id);
    if (!e) return undefined;
    if (PRIMARY_KINDS.has(e.kind)) return e;
    id = e.parentId;
  }
  return undefined;
}

interface StripBody {
  entity: Entity;
  distanceM: number | null;
}

function scratchDistance(a: Entity, b: Entity, tMs: number, pa: Vector3, pb: Vector3): number | null {
  try {
    a.position(tMs, pa);
    b.position(tMs, pb);
    const d = pa.distanceTo(pb);
    return Number.isFinite(d) && d > 0 ? d : null;
  } catch {
    return null;
  }
}

/** Bodies of the current system on a log-distance axis; focused body in a pill, named previous / next. */
export function BodyStrip() {
  const registry = useRegistry();
  const version = useRegistryVersion();
  const ext = useUiExtensions();
  const commands = useCommands();
  const focusId = useCosmos(s => s.selection.id ?? s.camera.focusId);
  const dayMs = useCosmos(s => Math.floor(s.time.simTimeMs / DAY_MS) * DAY_MS);
  const trackRef = useRef<HTMLOListElement | null>(null);
  const width = useElementWidth(trackRef);

  const { bodies, focusIndex } = useMemo(() => {
    const focus = focusId ? safeGetEntity(registry, focusId) : undefined;
    const system = systemOf(registry, focus);
    if (!system) return { bodies: [] as StripBody[], focusIndex: -1 };
    const ids = ext.systemBodies?.(system.id) ?? (system.id === 'sol:sun' ? SOLAR_BODIES : []);
    const pa = new Vector3();
    const pb = new Vector3();
    const list: StripBody[] = [];
    for (const id of ids) {
      const e = safeGetEntity(registry, id);
      if (e) list.push({ entity: e, distanceM: scratchDistance(e, system, dayMs, pa, pb) });
    }
    list.sort((a, b) => (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity));
    // Focus on a moon highlights its planet.
    let fi = list.findIndex(b => b.entity.id === focusId);
    if (fi < 0 && focus?.parentId) fi = list.findIndex(b => b.entity.id === focus.parentId);
    return { bodies: list, focusIndex: fi };
  }, [registry, version, focusId, dayMs, ext]);

  const positions = useMemo(() => {
    const n = bodies.length;
    if (n === 0 || width <= 0) return [];
    const logs = bodies.map(b => (b.distanceM ? Math.log10(b.distanceM) : NaN));
    const finite = logs.filter(Number.isFinite);
    const even = bodies.map((_, i) => (n === 1 ? 0.5 : i / (n - 1)));
    if (finite.length !== n) return even;
    const lo = Math.min(...finite);
    const hi = Math.max(...finite);
    if (!(hi > lo)) return even;
    const t = logs.map(l => (l - lo) / (hi - lo));
    const collide = t.some((v, i) => i > 0 && (v - t[i - 1]) * width < MIN_GAP_PX);
    return collide ? even : t;
  }, [bodies, width]);

  if (bodies.length === 0) return <div className="cx-strip cx-strip--empty"><MoonStrip /></div>;
  const prev = focusIndex > 0 ? bodies[focusIndex - 1] : undefined;
  const next = focusIndex >= 0 && focusIndex < bodies.length - 1 ? bodies[focusIndex + 1] : undefined;

  return (
    <nav className="cx-strip" aria-label="Bodies in this system">
      <MoonStrip />
      <button type="button" className="cx-strip__step" disabled={!prev} onClick={() => prev && void commands.focus(prev.entity.id)} aria-label={prev ? `Previous: ${prev.entity.name}` : 'No previous body'}>
        {prev ? `‹ ${prev.entity.name}` : ''}
      </button>
      <ol ref={trackRef} className="cx-strip__track">
        <span className="cx-strip__axis" aria-hidden="true" />
        {bodies.map((b, i) => (
          <li key={b.entity.id} style={{ left: `${(positions[i] ?? 0) * 100}%` }}>
            <button
              type="button"
              className={cx('cx-strip__body', i === focusIndex && 'is-focus')}
              aria-current={i === focusIndex ? 'true' : undefined}
              onClick={() => void commands.focus(b.entity.id)}
            >
              {b.entity.name}
            </button>
          </li>
        ))}
      </ol>
      <button type="button" className="cx-strip__step cx-strip__step--next" disabled={!next} onClick={() => next && void commands.focus(next.entity.id)} aria-label={next ? `Next: ${next.entity.name}` : 'No next body'}>
        {next ? `${next.entity.name} ›` : ''}
      </button>
    </nav>
  );
}
