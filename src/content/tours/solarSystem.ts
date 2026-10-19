/**
 * The grand tour: Earth → Earth orbit → the Moon → the Sun → the planets and their moons → the asteroids DART
 * moved → Pluto → Voyager 1 looking back. Twenty chapters; narration and sources live in ./steps.ts.
 */
import type { Tour } from '../../app/tours';
import {
  CERES, DART, DEBRIS, EARTH, ENCELADUS, EUROPA, IO, ISS, JUPITER, LOOKING_BACK, MARS, MERCURY, MOON, NEPTUNE, PLUTO,
  SATURN, SUN, TITAN, TOUR_BASELINE, URANUS, VENUS,
} from './steps';

export const SOLAR_SYSTEM_TOUR: Tour = {
  id: 'solar-system',
  title: 'The Solar System',
  description: 'From Earth and its crowded orbits out past Pluto to Voyager 1, every body lit by the Sun from where it really is today.',
  baseline: TOUR_BASELINE,
  steps: [
    EARTH, ISS, DEBRIS, MOON, SUN, MERCURY, VENUS, MARS, CERES, DART,
    JUPITER, IO, EUROPA, SATURN, TITAN, ENCELADUS, URANUS, NEPTUNE, PLUTO, LOOKING_BACK,
  ],
};

/**
 * The exhibition's golden journey (TopBar's Tour button, id 'golden-journey'). Its first part is the Solar System
 * tour; chapters beyond (nearby stars, exoplanets, the Milky Way, galaxies, the CMB) append here as they land.
 */
export const GOLDEN_JOURNEY: Tour = {
  ...SOLAR_SYSTEM_TOUR,
  id: 'golden-journey',
  title: 'The golden journey',
  description: 'Part one: the Solar System, from Earth to Voyager 1 at the edge of interstellar space.',
};
