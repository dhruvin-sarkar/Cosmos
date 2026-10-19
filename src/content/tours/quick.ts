/** A six-chapter tour for busy visitors (about three minutes): Earth, the ISS, the Sun, Jupiter, Saturn, looking back. */
import type { Tour } from '../../app/tours';
import { EARTH, ISS, JUPITER, LOOKING_BACK, SATURN, SUN, TOUR_BASELINE } from './steps';

export const QUICK_TOUR: Tour = {
  id: 'quick',
  title: 'Quick tour',
  description: 'Six stops in about three minutes: Earth, the space station, the Sun, Jupiter, Saturn and the view from Voyager 1.',
  baseline: TOUR_BASELINE,
  steps: [EARTH, ISS, SUN, JUPITER, SATURN, LOOKING_BACK],
};
