/**
 * Clickable 3D labels: a single click on a body's label travels there with the cinematic camera (the label manager
 * itself only selects on click and focuses on double-click). Implemented as capture-phase delegation on window, so
 * no engine change is needed; the label manager's own select still runs afterwards and is harmless. The
 * double-click that follows a click is swallowed so it does not restart the flight.
 */
import { useEffect } from 'react';
import type { AppCommands } from '../../app/commands';
import type { EntityKind, EntityRegistry } from '../../core/entity';
import type { CosmosStore } from '../../state/store';
import { focusFramed } from './framing';

/** Labels that only name a region of the sky or a scale marker keep select-on-click. */
const NO_TRAVEL: ReadonlySet<EntityKind> = new Set(['constellation', 'reference', 'region', 'cosmic-structure', 'void']);

function labelId(target: EventTarget | null): string | null {
  const el = (target as Element | null)?.closest?.('.cosmos-label') as HTMLElement | null;
  return el?.dataset.entityId ?? null;
}

export function useLabelTravel(commands: AppCommands, registry: EntityRegistry, store: CosmosStore): void {
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
      const id = labelId(e.target);
      if (!id) return;
      let kind: EntityKind | undefined;
      try {
        kind = registry.get(id)?.kind;
      } catch {
        kind = undefined;
      }
      if (!kind || NO_TRAVEL.has(kind)) return;
      void focusFramed(commands, registry, store, id);
    };
    const onDblClick = (e: MouseEvent): void => {
      const id = labelId(e.target);
      if (!id) return;
      let kind: EntityKind | undefined;
      try {
        kind = registry.get(id)?.kind;
      } catch {
        kind = undefined;
      }
      if (kind && !NO_TRAVEL.has(kind)) e.stopPropagation();
    };
    window.addEventListener('click', onClick, true);
    window.addEventListener('dblclick', onDblClick, true);
    return () => {
      window.removeEventListener('click', onClick, true);
      window.removeEventListener('dblclick', onDblClick, true);
    };
  }, [commands, registry]);
}
