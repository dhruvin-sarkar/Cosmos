/**
 * The golden journey: the exhibition's signature tour (TopBar's Tour button, id 'golden-journey'), from Earth to the
 * oldest light in the universe and back home. Twenty-three chapters, about nine minutes, four lab moments (debris,
 * asteroid deflection, habitability, black hole).
 *
 * Solar System chapters are shared with the grand tour (./steps.ts); the chapters beyond the heliosphere live here.
 * Voice and rules as in ./steps.ts: plain, specific, every number cited in the comment above its step; illustrative
 * or reconstructed visuals are called out in the narration. Interstellar and extragalactic framing comes from each
 * entity's own approach view (travelTo with its default distance; the galaxies and cosmology domains set side-on
 * approach directions) or from the galaxy domain's named views, which are built from its Galactocentric frame.
 */
import type { Tour, TourAction, TourStep } from '../../app/tours';
import { galaxyView } from '../../domains/galaxy/views';
import { DART, DEBRIS, EARTH, ISS, JUPITER, LOOKING_BACK, MOON, SATURN, SUN, TOUR_BASELINE } from './steps';

/** Every chapter starts from the shared baseline and with no lab open (lab chapters open theirs after a pause). */
const JOURNEY_BASELINE: TourAction[] = [...TOUR_BASELINE, { type: 'lab', lab: null }];

/** Real-time pause before a lab opens (it covers the chapter text), long enough to read the narration first. */
const LAB_DELAY_MS = 15000;

// Tracked objects: 29,408 below 2,000 km in the app's CelesTrak SATCAT snapshot of 2026-10-17 (src/labs/debris, "Real state").
// Kessler syndrome: a collisional cascade that sustains itself once fragments are made faster than drag removes
// them (Kessler & Cour-Palais 1978, JGR 83, 2637). Orbital speed in LEO ≈ 7.7 km/s (see ISS in ./steps.ts).
const DEBRIS_LAB: TourStep = {
  ...DEBRIS,
  id: 'debris',
  narration:
    'Every dot here is a tracked object: working satellites, dead ones, spent rocket stages, and fragments from collisions and missile tests: about 29,000 in low orbit alone. At 7.7 km/s, even a fragment the size of a marble can wreck a satellite. In the Orbital debris lab, see what happens if collisions start making fragments faster than the thin upper air can drag them down: the Kessler syndrome.',
  hint: 'Try the "All launches stop" scenario in the lab.',
  actions: [...DEBRIS.actions, { type: 'wait', ms: LAB_DELAY_MS }, { type: 'lab', lab: 'debris' }],
};

// Light time: 1 AU / c = 499.0 s = 8 min 19 s (IAU 2012 au, c exact); Neptune a = 30.07 AU → 4 h 10 min
// (NASA Planetary Fact Sheet). Exhibition scale enlarges bodies only (docs/design/VISUAL_SCALE.md); positions are
// the real heliocentric positions for today.
const PLANETS: TourStep = {
  id: 'planets',
  title: 'The Sun’s family',
  narration:
    'Eight planets circle the Sun: four small rocky worlds close in, then the giants Jupiter and Saturn, and far out the ice giants Uranus and Neptune. Every planet is where it really is today, and the distances are true; only the planets are drawn larger, so you can see them. Sunlight takes 8 minutes 19 seconds to reach Earth and more than 4 hours to reach Neptune.',
  scaleLog10: 12.2,
  waitForTravel: true,
  actions: [
    { type: 'view-from', anchorId: 'sol:sun', distanceM: 1.6e12, elevationDeg: 38, azimuthDeg: 0, durationSec: 7 },
    { type: 'wait', ms: 9000 },
    // Pull back past Neptune's orbit (4.5 × 10¹² m).
    { type: 'view-from', anchorId: 'sol:sun', distanceM: 1.0e13, elevationDeg: 42, azimuthDeg: 10, durationSec: 8 },
  ],
};

// DART: see ./steps.ts. The Asteroid deflection lab replays the impact and lets visitors deflect an asteroid.
const DART_LAB: TourStep = {
  ...DART,
  narration:
    'On 26 September 2022, NASA’s DART spacecraft crashed into Dimorphos, a moonlet about 150 m wide that circles the asteroid Didymos. The impact shortened its orbit by 33 minutes, from 11 h 55 min to 11 h 22 min: the first time people moved an asteroid on purpose. In the Asteroid deflection lab, replay the impact, then try steering an asteroid away from Earth.',
  hint: 'Switch the lab to “Earth” to deflect an incoming asteroid.',
  actions: [...DART.actions, { type: 'wait', ms: LAB_DELAY_MS }, { type: 'lab', lab: 'defense', params: { part: 'dart' } }],
};

// Oort cloud: proposed by Oort (1950, BAN 11, 91) from the orbits of long-period comets; never observed directly;
// "billions, maybe even trillions" of icy bodies (NASA Science, "Oort Cloud"). Inner edge 2,000–5,000 AU, outer
// 10,000–100,000 AU, i.e. up to about 1.6 light-years (1 ly = 63,241 AU) (NASA Science). Voyager 1: about 300 years
// to reach the inner edge, possibly about 30,000 years to fly beyond it (NASA/JPL Voyager mission status pages).
const OORT: TourStep = {
  id: 'oort-cloud',
  title: 'The Oort cloud',
  narration:
    'Out to more than a light-year from the Sun there is thought to be a vast cloud of icy bodies, billions or even trillions of them: the Oort cloud. No one has ever seen it; we infer it from comets that fall in on long orbits from every direction. The ring marks one light-year, and Voyager 1 needs about 300 years just to reach the cloud’s inner edge. The nearest star, Proxima Centauri, lies more than four times farther out.',
  scaleLog10: 16.6,
  waitForTravel: true,
  actions: [
    { type: 'visual-scale', mode: 'true' },
    // The Sun, the 1-light-year scale ring (src/domains/outer scaleRings) and Proxima / Alpha Centauri in one frame.
    // The outer domain's Oort particle model fades out at this scale, which suits a cloud nobody has seen.
    { type: 'view-from', anchorId: 'sol:sun', distanceM: 4.5e16, elevationDeg: 24, azimuthDeg: 20, durationSec: 9 },
  ],
};

// Proxima Centauri: parallax 768.07 mas → 1.302 pc = 4.25 ly (Gaia DR3, Gaia Collaboration 2023, A&A 674, A1); radius
// 0.154 R☉ (Boyajian et al. 2012, ApJ 757, 112); frequent strong flares (Howard et al. 2018, ApJL 860, L30). Proxima b:
// minimum mass 1.07 Earth masses, period 11.19 d, a = 0.0486 AU (Faria et al. 2022, A&A 658, A115); in the habitable
// zone (Anglada-Escudé et al. 2016, Nature 536, 437). Voyager 1 at 16.9 km/s: 4.25 ly / 16.9 km/s ≈ 75,000 years.
const PROXIMA: TourStep = {
  id: 'proxima',
  title: 'The nearest star',
  narration:
    'Proxima Centauri is the closest star to the Sun, 4.25 light-years away: Voyager 1 would need about 75,000 years to get here. It is a small red dwarf, only about 15 % of the Sun’s width, that often erupts in violent flares. Its planet Proxima b has at least the mass of Earth and circles in just 11.2 days, inside the zone where liquid water could exist on its surface. No one knows what it looks like: the surface drawn here is imagined.',
  scaleLog10: 10.4,
  waitForTravel: true,
  actions: [
    // The habitable-zone band would wash the close-up green; the narration names the zone instead.
    { type: 'overlay', id: 'habitable-zones', on: false },
    { type: 'travel', id: 'sys:Proxima Cen' },
    { type: 'wait', ms: 7000 },
    // From beyond the planet looking back toward its star, swung 24° off the line: a sunlit crescent with the red
    // dwarf beside it.
    { type: 'view-toward', anchorId: 'exo:Proxima Cen b', towardId: 'star:hip:70890', away: true, distanceM: 7.0e7, azimuthOffsetDeg: 24, elevationOffsetDeg: 6, durationSec: 6 },
  ],
};

// TRAPPIST-1: 12.47 pc = 40.7 ly (Gaia DR3); seven transiting planets, e, f and g in the habitable zone (Gillon et
// al. 2017, Nature 542, 456); radii 0.76–1.13 Earth, b's year 1.51 d, h at 0.062 AU vs Mercury's 0.387 AU (Agol et
// al. 2021, PSJ 2, 1). JWST found no thick atmosphere on b (Greene et al. 2023, Nature 618, 39).
const TRAPPIST: TourStep = {
  id: 'trappist-1',
  title: 'TRAPPIST-1',
  narration:
    'Forty-one light-years away, seven rocky planets about the size of Earth circle a cool red dwarf, TRAPPIST-1. All seven orbit closer to their star than Mercury is to the Sun; a year on the innermost lasts a day and a half. Three of them, e, f and g, lie in the habitable zone, shown in green. The Habitability lab estimates how warm planet e could be, with and without an atmosphere.',
  scaleLog10: 9.9,
  waitForTravel: true,
  actions: [
    { type: 'overlay', id: 'habitable-zones', on: true },
    { type: 'travel', id: 'sys:TRAPPIST-1' },
    { type: 'wait', ms: LAB_DELAY_MS },
    { type: 'lab', lab: 'habitability', params: { entityId: 'exo:TRAPPIST-1 e' } },
  ],
};

// Local (Orion) arm: about 0.31 kpc ≈ 1,000 ly wide, between the Sagittarius–Carina and Perseus arms (Reid et al.
// 2019, ApJ 885, 131). Sun–Galactic Centre distance R0 = 8.276 kpc = 27,000 ly (GRAVITY Collaboration 2024, A&A 692,
// A242). Galactic orbit about 230 million years (NASA Science, "Milky Way Galaxy"). The view is from 5 kpc (16,000 ly)
// above the Sun (src/domains/galaxy/views.ts 'sun').
const ORION_ARM: TourStep = {
  id: 'orion-arm',
  title: 'Out of the Orion Arm',
  narration:
    'Rise 16,000 light-years above the Galaxy and every star we have visited shrinks into one patch of the Orion Arm, a lane of young stars and glowing gas about 1,000 light-years wide. The Sun is about 27,000 light-years from the centre of the Milky Way and takes about 230 million years to go once around it.',
  scaleLog10: 20.2,
  waitForTravel: true,
  actions: [
    { type: 'view', view: () => galaxyView('sun'), fallbackId: 'mw:arm:local', durationSec: 10 },
  ],
};

// Milky Way: "100 to 400 billion stars", disc about 100,000 light-years across (NASA Science, "Milky Way Galaxy");
// bar of old stars (Wegg et al. 2015, MNRAS 450, 4050). No image from outside exists: the model is a reconstruction
// (src/domains/galaxy FactSheet). The view is from 62 kpc ≈ 200,000 ly above the plane (views.ts 'above').
const MILKY_WAY: TourStep = {
  id: 'milky-way',
  title: 'The Milky Way',
  narration:
    'This is our galaxy, the Milky Way, from 200,000 light-years above. No camera has ever left it, so this is a reconstruction from star maps, but the spiral arms are traced from real measured stars. Its disc of 100 to 400 billion stars is about 100,000 light-years across, with a bar of old stars at the centre. The Sun is the marked dot two-thirds of the way out.',
  scaleLog10: 21.3,
  waitForTravel: true,
  actions: [
    { type: 'view', view: () => galaxyView('above'), fallbackId: 'mw:galaxy', durationSec: 9 },
  ],
};

// S2: period 16.05 yr, pericentre 120 AU, 7,650 km/s = 2.55 % of c (GRAVITY Collaboration 2018, A&A 615, L15); the
// Black hole lab's GRAVITY 2024 elements give 7,760 km/s (2.59 %), hence "about 7,700 km/s, 2.6 %".
// Mass 4.30 million M☉ (GRAVITY Collaboration 2024, A&A 692, A242). Nobel Prize in Physics 2020 to Genzel and Ghez
// "for the discovery of a supermassive compact object at the centre of our galaxy" (nobelprize.org).
// Time rate 10⁷ s/s: one year every 3.2 s, one S2 orbit in about 51 s.
const SGR_A: TourStep = {
  id: 'sgr-a',
  title: 'Sagittarius A* and S2',
  narration:
    'At the centre of the Galaxy, stars whip around something we cannot see. The star S2 circles it every 16 years, passing within 120 AU at about 7,700 km/s, 2.6 % of the speed of light. Only a black hole of 4.3 million Suns, Sagittarius A*, fits in so small a space; its discovery won the 2020 Nobel Prize in Physics. Time now runs ten million times faster.',
  scaleLog10: 14.8,
  waitForTravel: true,
  actions: [
    { type: 'view', view: () => galaxyView('sstars'), fallbackId: 'mw:s-stars', durationSec: 10 },
    { type: 'time-rate', rate: 1e7 },
  ],
};

// Schwarzschild radius 2GM/c² for 4.30 × 10⁶ M☉ = 1.27 × 10⁷ km → 25 million km across; Mercury's orbit radius
// 57.9 million km (NASA Mercury Fact Sheet). EHT image of Sgr A*, 12 May 2022 (EHT Collaboration 2022, ApJL 930, L12).
// The disc is illustrative (src/domains/galaxy blackHoleLayer FactSheet); the light bending is ray-traced.
const BLACK_HOLE: TourStep = {
  id: 'black-hole',
  title: 'The black hole',
  narration:
    'Closer in, the black hole’s event horizon is about 25 million km across, small enough to fit inside Mercury’s orbit. The glowing disc of gas is illustrative, but the way gravity bends its light is computed: the far side of the disc appears lifted over the dark shadow. In 2022 the Event Horizon Telescope captured the real ring of light. In the Black hole lab, drop a clock toward the horizon and watch its time slow down.',
  scaleLog10: 11.8,
  waitForTravel: true,
  actions: [
    { type: 'view', view: () => galaxyView('bh'), fallbackId: 'mw:sgr-a*', durationSec: 8 },
    { type: 'wait', ms: LAB_DELAY_MS },
    { type: 'lab', lab: 'relativity' },
  ],
};

// M31: 0.77 Mpc = 2.5 million ly (app data famous.json; Li et al. 2021, ApJ 920, 84: 761 kpc); about a trillion stars
// (NASA Science, "Andromeda Galaxy"); approaching the Milky Way at 109 km/s (van der Marel et al. 2012, ApJ 753, 8);
// merger within 10 billion years about 50 % likely (Sawala et al. 2025, Nature Astronomy). Homo sapiens: about 300,000 years (Hublin et al. 2017, Nature 546, 289).
const ANDROMEDA: TourStep = {
  id: 'andromeda',
  title: 'Andromeda',
  narration:
    'Andromeda is the nearest big galaxy, 2.5 million light-years away: the light we see from it left before our own species existed. It holds about a trillion stars and is falling toward the Milky Way at 109 km/s. The latest measurements give the two galaxies about even odds of merging within the next 10 billion years.',
  scaleLog10: 21.9,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'gal:m31' },
  ],
};

// Local Group: more than 80 known member galaxies, mostly dwarfs (McConnachie 2012, AJ 144, 4, and later
// discoveries); M33 is the third spiral; the Magellanic Clouds orbit the Milky Way (Kallivayalil et al. 2013).
// Drawn at true size (src/domains/galaxies).
const LOCAL_GROUP: TourStep = {
  id: 'local-group',
  title: 'The Local Group',
  narration:
    'The Milky Way and Andromeda are the two giants of the Local Group, a family of more than 80 known galaxies. Most are dwarfs, like the Large and Small Magellanic Clouds that circle our own galaxy; the Triangulum Galaxy is the third spiral. Every galaxy here is drawn at its true size and true distance.',
  scaleLog10: 22.8,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'struct:local-group' },
  ],
};

// Virgo Cluster: 16.5 Mpc = 54 million ly (Mei et al. 2007, ApJ 655, 144); about 1,300 member galaxies (Binggeli et
// al. 1985, AJ 90, 1681); M87* 6.5 billion M☉, first black hole image, 10 Apr 2019 (EHT Collaboration 2019, ApJL 875,
// L1/L6). Laniakea: 160 Mpc = 520 million ly across, about 100,000 galaxies, mapped from galaxy peculiar velocities;
// Hawaiian for "immeasurable heaven" (Tully et al. 2014, Nature 513, 71).
const LANIAKEA: TourStep = {
  id: 'laniakea',
  title: 'Virgo and Laniakea',
  narration:
    'Fifty-four million light-years away lies the Virgo Cluster, about 1,300 galaxies held together by gravity; at its heart, M87’s black hole was the first ever photographed, in 2019. Pull back and Virgo becomes one knot in Laniakea, our home supercluster: about 100,000 galaxies across 520 million light-years. It was mapped by how galaxies move, and its name is Hawaiian for “immeasurable heaven”.',
  scaleLog10: 24.4,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'struct:virgo-cluster' },
    { type: 'wait', ms: 8000 },
    { type: 'travel', id: 'struct:laniakea', options: { durationSec: 7 } },
  ],
};

// Galaxy maps: 43,508 galaxies of the 2MASS Redshift Survey (Huchra et al. 2012, ApJS 199, 26) and 2.2 million drawn
// from DESI DR1's 6.1 million BGS + LRG galaxies (DESI Collaboration 2026, AJ 171, 285) (docs/data/galaxies.md). Placed
// by redshift; velocities inside clusters stretch them along the line of sight ("fingers of God", Jackson 1972,
// MNRAS 156, 1P). 2 Gpc = 6.5 billion ly.
const COSMIC_WEB: TourStep = {
  id: 'cosmic-web',
  title: 'The cosmic web',
  narration:
    'On the largest scales, galaxies are not scattered evenly: they gather along filaments and walls around vast, nearly empty voids. Every dot here is a real galaxy, placed by its redshift, from the 2MASS Redshift Survey and the Dark Energy Spectroscopic Instrument, which has measured millions. The short streaks pointing back at us are not real shapes: the motions of galaxies inside clusters add to their redshifts.',
  scaleLog10: 25.8,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'struct:laniakea', options: { distanceM: 6.0e25, durationSec: 9 } },
  ],
};

// Released about 380,000 years after the Big Bang (z ≈ 1090); age of the universe 13.8 billion years (Planck
// Collaboration 2020, A&A 641, A6). Temperature 2.7255 K (Fixsen 2009, ApJ 707, 916); variations about 1 part in
// 100,000 (Smoot et al. 1992, ApJL 396, L1). Comoving distance to last scattering 13.9 Gpc ≈ 45 billion ly (Planck
// 2018 ΛCDM; the app's CMB sphere: 4.28 × 10²⁶ m).
const CMB: TourStep = {
  id: 'cmb',
  title: 'The oldest light',
  narration:
    'This is the oldest light in the universe, the cosmic microwave background. It was set free 380,000 years after the Big Bang, when the universe cooled enough to turn transparent, and has been travelling for 13.8 billion years. Its spots are temperature differences of about 1 part in 100,000: the seeds of every galaxy we just flew past. Space has stretched while the light travelled, so that shell is now about 45 billion light-years away, the farthest anything can be seen.',
  scaleLog10: 26.6,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'cosmo:cmb', options: { durationSec: 9 } },
  ],
};

// Light time from the CMB: 13.8 billion years (above). Earth: see ./steps.ts.
const HOME: TourStep = {
  id: 'home',
  title: 'Home',
  narration:
    'And back home. Everything we passed, from the space station to that oldest light, is seen from here, a rocky planet 12,742 km wide circling an ordinary star. Earth is still the only place in the universe where we know life exists.',
  scaleLog10: 7.4,
  waitForTravel: true,
  actions: [
    { type: 'travel', id: 'sol:earth', options: { durationSec: 12 } },
    { type: 'view-phase', anchorId: 'sol:earth', distanceM: 2.6e7, phaseDeg: 62, elevationDeg: 14, durationSec: 4 },
  ],
};

export const GOLDEN_JOURNEY: Tour = {
  id: 'golden-journey',
  title: 'The golden journey',
  description: 'From Earth to the oldest light in the universe and back: the Solar System, the nearest stars, the heart of the Milky Way, the cosmic web and the CMB.',
  baseline: JOURNEY_BASELINE,
  steps: [
    EARTH, ISS, DEBRIS_LAB, MOON, SUN, PLANETS, JUPITER, SATURN, DART_LAB, LOOKING_BACK, OORT, PROXIMA,
    TRAPPIST, ORION_ARM, MILKY_WAY, SGR_A, BLACK_HOLE, ANDROMEDA, LOCAL_GROUP, LANIAKEA, COSMIC_WEB, CMB, HOME,
  ],
};
