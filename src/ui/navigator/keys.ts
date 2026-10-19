/**
 * Navigator keyboard map: 0 Sun, 1–8 planets, 9 Pluto, [ and ] previous / next moon of the current planet,
 * Shift+[ and Shift+] previous / next planet, B opens the Solar System navigator. Uses KeyboardEvent.code for the
 * brackets so Shift (which turns them into braces on most layouts) and non-US layouts still work.
 */
import { useEffect } from 'react';
import type { AppCommands } from '../../app/commands';
import type { CosmosStore } from '../../state/store';
import type { EntityRegistry } from '../../core/entity';
import { isTypingTarget } from '../lib/dom';
import { buildSystemTree, candidateEntities, DIGIT_TARGETS, stepPlanet, stepSatellite, type SystemTree } from './tree';
import { isNavigatorOpen, navFocusId, setNavigatorOpen } from './state';

export interface NavKeyInput {
  key: string;
  code: string;
  shiftKey: boolean;
}

export type NavKeyAction = { type: 'travel'; id: string } | { type: 'toggle-navigator' } | { type: 'none' };

/** Pure key → action mapping (unit-tested). */
export function navKeyAction(e: NavKeyInput, tree: SystemTree, focusId: string | null): NavKeyAction {
  const digit = /^Digit([0-9])$/.exec(e.code)?.[1] ?? /^Numpad([0-9])$/.exec(e.code)?.[1] ?? (/^[0-9]$/.test(e.key) ? e.key : null);
  if (digit != null && !e.shiftKey) {
    const id = DIGIT_TARGETS[Number(digit)];
    return id && tree.index.has(id) ? { type: 'travel', id } : { type: 'none' };
  }
  const bracket = e.code === 'BracketLeft' || e.key === '[' || e.key === '{' ? -1 : e.code === 'BracketRight' || e.key === ']' || e.key === '}' ? 1 : 0;
  if (bracket !== 0) {
    const id = e.shiftKey ? stepPlanet(tree, focusId, bracket) : stepSatellite(tree, focusId, bracket);
    return id && id !== focusId ? { type: 'travel', id } : { type: 'none' };
  }
  if (!e.shiftKey && (e.key === 'b' || e.key === 'B')) return { type: 'toggle-navigator' };
  return { type: 'none' };
}

/**
 * Install the navigator shortcuts. Runs in the capture phase so [ and ] are claimed before the time-rate keys of
 * the global map (which moved to , and .).
 */
export function useNavigatorShortcuts(store: CosmosStore, commands: AppCommands, registry: EntityRegistry): void {
  useEffect(() => {
    let cached: { version: number; day: number; tree: SystemTree } | null = null;
    const treeNow = (): SystemTree => {
      const version = (registry as { version?: number }).version ?? -1;
      const day = Math.floor(store.getState().time.simTimeMs / 86_400_000);
      if (!cached || cached.version !== version || cached.day !== day || version < 0) {
        cached = { version, day, tree: buildSystemTree(candidateEntities(registry), day * 86_400_000) };
      }
      return cached.tree;
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTypingTarget(e.target)) return;
      const s = store.getState();
      if (s.ui.searchOpen || s.lab.active) return;
      const quick = /^(Digit|Numpad)[0-9]$|^Bracket(Left|Right)$|^KeyB$/.test(e.code) || /^[0-9[\]{}bB]$/.test(e.key);
      if (!quick) return;
      const action = navKeyAction(e, treeNow(), navFocusId(s));
      if (action.type === 'none') {
        // Swallow brackets anyway so they no longer change the time rate unexpectedly.
        if (/^Bracket(Left|Right)$/.test(e.code)) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
        return;
      }
      if (e.repeat) {
        e.preventDefault();
        return;
      }
      e.preventDefault();
      e.stopImmediatePropagation();
      if (action.type === 'toggle-navigator') setNavigatorOpen(!isNavigatorOpen());
      else void commands.focus(action.id);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store, commands, registry]);
}
