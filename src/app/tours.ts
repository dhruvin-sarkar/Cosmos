/**
 * Guided tours / exhibition mode (docs/ARCHITECTURE.md §13): data-driven steps executed through
 * AppCommands, so a tour can do nothing a visitor could not do by hand.
 *
 * Each step runs its actions in order. Camera actions ('focus', 'travel') are awaited only when the step
 * sets `waitForTravel`; otherwise they start and the remaining actions run immediately. Going to another
 * step (next/prev/restart/exit) cancels the in-flight one: its pending actions are skipped.
 */
import type { LabId } from '../core/entity';
import * as THREE from 'three';
import type { CameraViewState, OverlayId, SpectralBandId, TravelOptions } from '../core/types';
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
  | { type: 'select'; id: string | null }
  /** Orbit-frame the anchor from above the ecliptic: elevation and azimuth (ecliptic longitude) in degrees. */
  | { type: 'view-from'; anchorId: string; distanceM: number; elevationDeg: number; azimuthDeg: number; durationSec?: number };

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

const OBLIQUITY_J2000_RAD = (23.439281 * Math.PI) / 180;
const _x = new THREE.Vector3();
const _y = new THREE.Vector3();
const _z = new THREE.Vector3();
const _n = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();

/** Camera view looking at `anchorId` from the given ecliptic elevation/azimuth (ICRS axes), ecliptic north up. */
export function eclipticViewFrom(anchorId: string, distanceM: number, elevationDeg: number, azimuthDeg: number): CameraViewState {
  const el = (elevationDeg * Math.PI) / 180;
  const az = (azimuthDeg * Math.PI) / 180;
  const ce = Math.cos(OBLIQUITY_J2000_RAD);
  const se = Math.sin(OBLIQUITY_J2000_RAD);
  // Ecliptic → ICRS: rotate about +X by the obliquity.
  const xe = Math.cos(el) * Math.cos(az);
  const ye = Math.cos(el) * Math.sin(az);
  const ze = Math.sin(el);
  _z.set(xe, ye * ce - ze * se, ye * se + ze * ce); // camera +Z points away from the target
  _n.set(0, -se, ce); // ecliptic north
  _x.crossVectors(_n, _z).normalize();
  _y.crossVectors(_z, _x);
  _q.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
  return {
    anchorId,
    offset: [_z.x * distanceM, _z.y * distanceM, _z.z * distanceM],
    quaternion: [_q.x, _q.y, _q.z, _q.w],
    mode: 'orbit',
    focusId: anchorId,
    scaleLog10: Math.log10(distanceM),
  };
}

export function createTourRunner(opts: {
  store: CosmosStore;
  commands: () => TourCommands;
  setView?: (view: CameraViewState, travel?: TravelOptions) => Promise<void>;
}): TourRunner {
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
      case 'view-from': {
        if (!opts.setView) return;
        const p = opts.setView(eclipticViewFrom(action.anchorId, action.distanceM, action.elevationDeg, action.azimuthDeg), { durationSec: action.durationSec });
        if (wait) await p;
        else p.catch(() => undefined);
        return;
      }
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

const SATURN_RINGS_OPEN_MS = Date.UTC(2017, 4, 1, 12); // rings near maximum tilt (~26.6°), Cassini Grand Finale year

/**
 * Exhibition chapter 1–3: Earth → Moon → Sun → planets → the edge of the Solar System. True sizes and distances;
 * camera framing comes from each entity's inspect view (0.60 W, 50–70° phase).
 */
export const SOLAR_SYSTEM_TOUR: Tour = {
  id: 'solar-system',
  title: 'The Solar System',
  description: 'From the blue marble out past Pluto to Voyager 1, every body at its real size, place and lighting today.',
  steps: [
    {
      id: 'earth',
      title: 'Earth',
      narration: 'Earth as it is right now: the Sun lights it from its true direction, and the night side glows with city lights.',
      scaleLog10: 7,
      waitForTravel: true,
      actions: [
        { type: 'time-jump', ms: 'now' },
        { type: 'time-rate', rate: 1 },
        { type: 'overlay', id: 'orbits', on: true },
        { type: 'select', id: 'sol:earth' },
        { type: 'focus', id: 'sol:earth' },
      ],
    },
    {
      id: 'moon',
      title: 'The Moon',
      narration: 'The Moon is a dark world, about as reflective as worn asphalt. On its night side, faint earthshine lights the ground.',
      scaleLog10: 6.5,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:moon' }, { type: 'focus', id: 'sol:moon' }],
    },
    {
      id: 'earth-moon',
      title: 'Earth and Moon',
      narration: 'The Moon orbits about 384,400 km away. Thirty Earths would fit in the gap.',
      scaleLog10: 9,
      actions: [{ type: 'select', id: 'sol:earth' }, { type: 'focus', id: 'sol:earth', options: { distanceM: 1.1e9 } }],
      waitForTravel: true,
    },
    {
      id: 'sun',
      title: 'The Sun',
      narration: 'The Sun holds 99.86 % of the Solar System’s mass. Its light takes 8 minutes 20 seconds to reach Earth.',
      scaleLog10: 9.5,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:sun' }, { type: 'focus', id: 'sol:sun' }],
    },
    {
      id: 'inner-system',
      title: 'The inner planets',
      narration: 'Mercury, Venus, Earth and Mars circle close to the Sun. Beyond them lies the main asteroid belt.',
      scaleLog10: 11.8,
      actions: [
        { type: 'overlay', id: 'asteroids', on: true },
        { type: 'select', id: 'sol:sun' },
        { type: 'view-from', anchorId: 'sol:sun', distanceM: 6.5e11, elevationDeg: 38, azimuthDeg: 200 },
      ],
    },
    {
      id: 'mars',
      title: 'Mars',
      narration: 'Mars has the largest volcano in the Solar System, Olympus Mons, and a canyon, Valles Marineris, as long as the United States is wide.',
      scaleLog10: 7,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:mars' }, { type: 'focus', id: 'sol:mars' }],
    },
    {
      id: 'jupiter-system',
      title: 'Jupiter and its moons',
      narration: 'Io, Europa and Ganymede strung out beside Jupiter, as Galileo first saw them in 1610. Europa hides an ocean under its ice.',
      scaleLog10: 9.3,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:jupiter' }, { type: 'focus', id: 'sol:jupiter', options: { distanceM: 2.6e9 } }],
    },
    {
      id: 'jupiter',
      title: 'Jupiter',
      narration: 'Jupiter is eleven Earths wide. Its belts and zones are clouds of ammonia ice, and the Great Red Spot is a storm larger than Earth.',
      scaleLog10: 8.2,
      waitForTravel: true,
      actions: [{ type: 'focus', id: 'sol:jupiter' }],
    },
    {
      id: 'saturn',
      title: 'Saturn in 2017',
      narration: 'In 2017, when Cassini made its final dives, Saturn’s rings were tilted wide open. The planet casts its shadow across them.',
      scaleLog10: 8.5,
      waitForTravel: true,
      actions: [
        { type: 'time-jump', ms: SATURN_RINGS_OPEN_MS },
        { type: 'select', id: 'sol:saturn' },
        { type: 'focus', id: 'sol:saturn' },
      ],
    },
    {
      id: 'saturn-today',
      title: 'Saturn today',
      narration: 'Today the rings are nearly edge-on to the Sun and to us. They are hundreds of thousands of kilometres wide but mostly only about ten metres thick.',
      scaleLog10: 8.5,
      actions: [{ type: 'time-jump', ms: 'now' }],
    },
    {
      id: 'titan',
      title: 'Titan',
      narration: 'Titan, Saturn’s largest moon, is wrapped in a thick orange haze. Beneath it lie lakes of liquid methane.',
      scaleLog10: 6.9,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:titan' }, { type: 'focus', id: 'sol:titan' }],
    },
    {
      id: 'uranus',
      title: 'Uranus',
      narration: 'Uranus rolls around the Sun on its side, tilted 98 degrees. Methane gas gives it a pale cyan colour.',
      scaleLog10: 7.8,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:uranus' }, { type: 'focus', id: 'sol:uranus' }],
    },
    {
      id: 'neptune',
      title: 'Neptune',
      narration: 'Neptune, thirty times farther from the Sun than Earth, has the fastest winds measured on any planet: up to 2,100 km/h.',
      scaleLog10: 7.8,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:neptune' }, { type: 'focus', id: 'sol:neptune' }],
    },
    {
      id: 'pluto',
      title: 'Pluto and Charon',
      narration: 'Pluto and its moon Charon, mapped by New Horizons in 2015. Charon is so large that the pair orbit a point in the space between them.',
      scaleLog10: 7.6,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sol:pluto' }, { type: 'focus', id: 'sol:pluto', options: { distanceM: 6e7 } }],
    },
    {
      id: 'voyager-1',
      title: 'Voyager 1',
      narration: 'Launched in 1977, Voyager 1 is now about 170 times farther from the Sun than Earth, the most distant human-made object.',
      scaleLog10: 2,
      waitForTravel: true,
      actions: [{ type: 'select', id: 'sc:voyager-1' }, { type: 'focus', id: 'sc:voyager-1' }],
    },
    {
      id: 'heliosphere',
      title: 'The whole Solar System',
      narration: 'From here the Sun is just the brightest star. Its planets fit inside Neptune’s orbit, 60 AU across.',
      scaleLog10: 13.4,
      actions: [{ type: 'select', id: 'sol:sun' }, { type: 'scale', scaleLog10: 13.4 }],
    },
  ],
};
