/**
 * Guided tours / exhibition mode (docs/ARCHITECTURE.md §13): data-driven steps executed through
 * AppCommands, so a tour can do nothing a visitor could not do by hand.
 *
 * Each step runs its actions in order. Camera actions ('focus', 'travel') are awaited only when the step
 * sets `waitForTravel`; otherwise they start and the remaining actions run immediately. Going to another
 * step (next/prev/restart/exit) cancels the in-flight one: its pending actions are skipped.
 */
import type { LabId } from '../core/entity';
import type { OverlayId, SpectralBandId, TravelOptions } from '../core/types';
import type { CosmosStore } from '../state/store';
import type { AppCommands } from './commands';

export type TourAction =
  | { type: 'focus'; id: string; options?: TravelOptions }
  | { type: 'travel'; id: string; options?: TravelOptions }
  | { type: 'scale'; scaleLog10: number; animate?: boolean }
  | { type: 'overlay'; id: OverlayId; on: boolean }
  | { type: 'spectral'; band: SpectralBandId }
  | { type: 'time-rate'; rate: number }
  /** Absolute Unix ms, or 'now'. */
  | { type: 'time-jump'; ms: number | 'now' }
  | { type: 'lab'; lab: LabId | null; params?: Record<string, unknown> }
  | { type: 'select'; id: string | null };

export interface TourStep {
  id: string;
  title: string;
  /** One to three sentences of plain-language narration (plain text, never HTML). */
  narration: string;
  /** Order of magnitude shown as the chapter index ("10⁷ m"), per VISUAL_DIRECTION; optional. */
  scaleLog10?: number;
  actions: TourAction[];
  /** Await camera travel before running the following actions. */
  waitForTravel?: boolean;
}

export interface Tour {
  id: string;
  title: string;
  description: string;
  steps: TourStep[];
}

/** Subset of AppCommands a tour may drive (tours never call tour commands themselves). */
export type TourCommands = Pick<
  AppCommands,
  'focus' | 'travelTo' | 'setScale' | 'setOverlay' | 'setSpectralBand' | 'setTimeRate' | 'jumpToTime' | 'timeToNow' | 'openLab' | 'closeLab' | 'select'
>;

export interface TourRunner {
  register(tour: Tour): void;
  get(id: string): Tour | undefined;
  list(): readonly Tour[];
  /** Currently active step, or null. */
  currentStep(): TourStep | null;
  start(id: string): boolean;
  next(): void;
  prev(): void;
  restartStep(): void;
  exit(): void;
}

export function createTourRunner(opts: { store: CosmosStore; commands: () => TourCommands }): TourRunner {
  const tours = new Map<string, Tour>();
  let active: Tour | null = null;
  let stepIndex = 0;
  let runToken = 0;

  const publish = (): void => {
    opts.store.setState({
      tour: active ? { activeId: active.id, step: stepIndex, stepCount: active.steps.length } : { activeId: null, step: 0, stepCount: 0 },
    });
  };

  const runAction = async (action: TourAction, wait: boolean): Promise<void> => {
    const c = opts.commands();
    switch (action.type) {
      case 'focus': {
        const p = c.focus(action.id, action.options);
        if (wait) await p;
        else p.catch(() => undefined);
        return;
      }
      case 'travel': {
        const p = c.travelTo(action.id, action.options);
        if (wait) await p;
        else p.catch(() => undefined);
        return;
      }
      case 'scale':
        c.setScale(action.scaleLog10, { animate: action.animate ?? true });
        return;
      case 'overlay':
        c.setOverlay(action.id, action.on);
        return;
      case 'spectral':
        c.setSpectralBand(action.band);
        return;
      case 'time-rate':
        c.setTimeRate(action.rate);
        return;
      case 'time-jump':
        if (action.ms === 'now') c.timeToNow();
        else c.jumpToTime(action.ms);
        return;
      case 'lab':
        if (action.lab) c.openLab(action.lab, action.params);
        else c.closeLab();
        return;
      case 'select':
        c.select(action.id);
        return;
    }
  };

  const runStep = async (): Promise<void> => {
    if (!active) return;
    const token = ++runToken;
    const step = active.steps[stepIndex];
    publish();
    for (const action of step.actions) {
      if (token !== runToken) return;
      try {
        await runAction(action, !!step.waitForTravel);
      } catch (err) {
        console.warn(`[cosmos] tour step '${step.id}' action '${action.type}' failed`, err);
      }
    }
  };

  const goTo = (index: number): void => {
    if (!active) return;
    stepIndex = Math.max(0, Math.min(active.steps.length - 1, index));
    void runStep();
  };

  return {
    register(tour: Tour): void {
      if (tour.steps.length === 0) throw new Error(`Tour '${tour.id}' has no steps`);
      tours.set(tour.id, tour);
    },
    get: id => tours.get(id),
    list: () => [...tours.values()],
    currentStep: () => (active ? active.steps[stepIndex] : null),

    start(id: string): boolean {
      const tour = tours.get(id);
      if (!tour) return false;
      active = tour;
      goTo(0);
      return true;
    },
    next(): void {
      if (!active) return;
      if (stepIndex >= active.steps.length - 1) return;
      goTo(stepIndex + 1);
    },
    prev(): void {
      if (active) goTo(stepIndex - 1);
    },
    restartStep(): void {
      if (active) goTo(stepIndex);
    },
    exit(): void {
      runToken++;
      active = null;
      stepIndex = 0;
      publish();
    },
  };
}

/**
 * TEMPORARY demo tour over the placeholder entities (sol:earth, sol:moon, sol:sun). The real golden-journey
 * content replaces it once the domains land.
 */
export const GOLDEN_JOURNEY_PREVIEW: Tour = {
  id: 'golden-journey-preview',
  title: 'Golden journey preview',
  description: 'A short preview of the route from Earth outward, using the temporary placeholder bodies.',
  steps: [
    {
      id: 'earth',
      title: 'Earth',
      narration: 'Our home planet, lit by the Sun from its real direction at the current date.',
      scaleLog10: 7,
      waitForTravel: true,
      actions: [{ type: 'time-rate', rate: 1 }, { type: 'focus', id: 'sol:earth' }],
    },
    {
      id: 'moon',
      title: 'Moon',
      narration: 'The Moon orbits about 384,400 km away, roughly thirty Earth diameters.',
      scaleLog10: 8.6,
      waitForTravel: true,
      actions: [{ type: 'focus', id: 'sol:moon' }],
    },
    {
      id: 'earth-moon',
      title: 'Earth and Moon',
      narration: 'Zoomed out, the Earth–Moon system fits in a field about a million kilometres wide.',
      scaleLog10: 9,
      actions: [{ type: 'select', id: 'sol:earth' }, { type: 'scale', scaleLog10: 9.1 }],
    },
    {
      id: 'sun',
      title: 'Sun',
      narration: 'The Sun holds 99.86 % of the Solar System’s mass. Light from it reaches Earth in about 8 minutes 20 seconds.',
      scaleLog10: 10,
      waitForTravel: true,
      actions: [{ type: 'travel', id: 'sol:sun' }, { type: 'select', id: 'sol:sun' }],
    },
  ],
};
