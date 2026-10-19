/**
 * Solar System tour chapters, shared by the grand tour (solarSystem.ts) and the quick tour (quick.ts).
 *
 * Voice: docs/design/VISUAL_DIRECTION.md §Voice (plain, specific, active; no hype words; numbers with units).
 * Every number in the narration is cited in the comment above its step. Framing: the camera views come from
 * the Sun's real direction at the current simulation time ('view-phase' = Sun–body–camera angle), so the
 * terminator is always in view; distances are well outside every body (≥ 3 radii, exactly true size there under
 * exhibition scale, which enlarges bodies only beyond 40 radii — docs/design/VISUAL_SCALE.md).
 */
import type { TourAction, TourStep } from '../../app/tours';

/** Run at the start of every chapter: each chapter then sets what it needs on top. */
export const TOUR_BASELINE: TourAction[] = [
  { type: 'select', id: null },
  // Chapters with fast time (Earth orbit, Jupiter) leave the clock ahead; every chapter starts from today.
  { type: 'time-jump', ms: 'now' },
  { type: 'spectral', band: 'visible' },
  { type: 'visual-scale', mode: 'exhibition' },
  { type: 'time-rate', rate: 1 },
  { type: 'overlay', id: 'orbits', on: true },
  { type: 'overlay', id: 'labels', on: true },
];

// Earth mean radius 6,371.0 km (NASA Earth Fact Sheet). 100 km: the Kármán line, the conventional edge of space
// (FAI); more than 99.99 % of the atmosphere's mass lies below it (US Standard Atmosphere 1976).
export const EARTH: TourStep = {
  id: 'earth',
  title: 'Earth',
  narration:
    'This is Earth right now, lit by the Sun from its true direction. The line between day and night is the terminator; past it, the night side glows with city lights. Almost all of our air lies within 100 km of the ground: the thin blue rim at the edge.',
  scaleLog10: 7.4,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:earth', distanceM: 2.6e7, phaseDeg: 62, elevationDeg: 14 },
  ],
};

// ISS: 109 m end to end, about 400 km altitude, one orbit about every 92 minutes, about 16 sunrises a day
// (NASA, "International Space Station Facts and Figures", nasa.gov/international-space-station/space-station-facts-and-figures).
// 7.7 km/s: circular speed sqrt(GM/r) at 400 km = 7.67 km/s (GM = 398,600 km³/s²).
export const ISS: TourStep = {
  id: 'iss',
  title: 'The International Space Station',
  narration:
    'The ISS flies about 400 km above the ground at 7.7 km/s, once around Earth every 92 minutes. Its crew sees about 16 sunrises a day. At 109 m end to end, it is the largest thing people have built in space.',
  scaleLog10: 2.4,
  waitForTravel: true,
  actions: [
    { type: 'overlay', id: 'satellites', on: true },
    // Wind the clock (at most one 92-minute orbit) until the ISS is 60° from the subsolar point, out of Earth's
    // shadow, then look down past it onto the sunlit Earth, turned 30° toward the Sun (a 30° phase angle).
    { type: 'time-align', anchorId: 'sol:earth', satelliteId: 'sc:iss', sunAngleDeg: 60, windowHours: 1.6 },
    { type: 'view-toward', anchorId: 'sc:iss', towardId: 'sol:earth', away: true, sunwardDeg: 30, distanceM: 240 },
  ],
};

// Low Earth orbit: below 2,000 km altitude; geostationary orbit: 35,786 km altitude (ESA Space Environment
// Report 2025, "orbital regimes"). Fengyun-1C (2007 anti-satellite test) and the 2009 Iridium 33 / Cosmos 2251
// collision each left thousands of tracked fragments (ESA, NASA Orbital Debris Quarterly News 11-2, 13-2).
export const DEBRIS: TourStep = {
  id: 'debris',
  title: 'A crowded orbit',
  narration:
    'Every dot here is a tracked object: working satellites, dead ones, spent rocket stages, and fragments from collisions and missile tests. Most crowd into low orbit, below 2,000 km. Much farther out, 35,786 km up, geostationary satellites keep pace with Earth’s turn. Time runs 60 times faster.',
  scaleLog10: 7.6,
  waitForTravel: true,
  actions: [
    { type: 'overlay', id: 'satellites', on: true },
    { type: 'overlay', id: 'debris', on: true },
    { type: 'view-phase', anchorId: 'sol:earth', distanceM: 4.5e7, phaseDeg: 40, elevationDeg: 30 },
    { type: 'time-rate', rate: 60 },
  ],
};

// Moon mean radius 1,737.4 km → 3,474.8 km wide; Earth 12,742 km → 27 % (NASA Moon and Earth Fact Sheets).
// Twelve moonwalkers, Apollo 11 (20 Jul 1969) to Apollo 17 (Dec 1972) (NASA History Office).
export const MOON: TourStep = {
  id: 'moon',
  title: 'The Moon',
  narration:
    'The Moon is 3,475 km wide, about a quarter of Earth’s width. The dark plains are old lava flows; the bright highlands are older still and crowded with craters. Twelve astronauts walked here between 1969 and 1972; the labels mark where they landed.',
  scaleLog10: 6.8,
  waitForTravel: true,
  actions: [
    // The near side, which always faces Earth, turned toward the Sun so the maria are lit.
    { type: 'view-toward', anchorId: 'sol:moon', towardId: 'sol:earth', sunwardDeg: 40, distanceM: 6.4e6, elevationOffsetDeg: 4 },
  ],
};

// Sun: IAU 2015 nominal radius 695,700 km → 1.39 million km wide = 109 Earth diameters (IAU Resolution B3).
// Granules about 1,000 km across, lasting about 8–20 minutes (Hathaway, "The Solar Granulation", NASA MSFC / NSO).
// SDO/AIA 171 Å (17.1 nm, Fe IX) images plasma near 600,000 K (Lemen et al. 2012, Solar Physics 275, 17).
export const SUN: TourStep = {
  id: 'sun',
  title: 'The Sun',
  narration:
    'The Sun is 1.39 million km wide: 109 Earths would fit across it. Its surface is a seething pattern of granules, each about 1,000 km across and lasting about ten minutes. Then the view switches to ultraviolet light at 17.1 nm, as NASA’s Solar Dynamics Observatory sees it: loops of gas at about 600,000 K trace the magnetic field.',
  scaleLog10: 9.4,
  waitForTravel: true,
  actions: [
    { type: 'view-from', anchorId: 'sol:sun', distanceM: 3.0e9, elevationDeg: 18, azimuthDeg: 0 },
    { type: 'wait', ms: 9000 },
    { type: 'spectral', band: 'ultraviolet' },
    // Push in so the ultraviolet disc and its limb loops fill the frame.
    { type: 'view-from', anchorId: 'sol:sun', distanceM: 2.2e9, elevationDeg: 18, azimuthDeg: 0, durationSec: 6 },
  ],
};

// Mercury diameter 4,879 km (NASA Mercury Fact Sheet). Day 430 °C, night −180 °C (NASA Science, "Mercury: Facts").
// MESSENGER orbited Mercury from 18 March 2011 to 30 April 2015 (NASA/JHUAPL mission page).
export const MERCURY: TourStep = {
  id: 'mercury',
  title: 'Mercury',
  narration:
    'Mercury, the smallest planet, is 4,879 km wide and the closest to the Sun. With almost no air to hold heat, its days reach 430 °C and its nights fall to −180 °C. NASA’s MESSENGER mapped it from orbit between 2011 and 2015.',
  scaleLog10: 7,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:mercury', distanceM: 9.5e6, phaseDeg: 70, elevationDeg: 10 },
  ],
};

// Venus radius 6,051.8 km = 0.95 Earth; surface pressure 92 bar; CO₂ 96.5 %; mean surface temperature 464 °C
// (NASA Venus Fact Sheet). Clouds of sulfuric acid (NASA Science, "Venus: Facts"). Lead melts at 327 °C.
export const VENUS: TourStep = {
  id: 'venus',
  title: 'Venus',
  narration:
    'Venus is almost Earth’s size, but clouds of sulfuric acid hide its ground completely. Below them the air is 96 % carbon dioxide and presses down 92 times harder than on Earth. The surface is 464 °C, hot enough to melt lead.',
  scaleLog10: 7.4,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:venus', distanceM: 2.3e7, phaseDeg: 55, elevationDeg: 8 },
  ],
};

// Mars mean radius 3,389.5 km = 0.53 Earth (NASA Mars Fact Sheet). Phobos 27 × 22 × 18 km; orbit radius 9,376 km
// → about 6,000 km above the surface; period 7 h 39 min vs a 24 h 37 min sol → three orbits a Martian day
// (NASA Mars Satellite Fact Sheet). Breaks apart or hits Mars in about 50 million years (NASA Science, "Phobos").
export const MARS: TourStep = {
  id: 'mars',
  title: 'Mars and Phobos',
  narration:
    'Mars is about half Earth’s width, coloured by rust-red iron oxide in its dust. Its little moon Phobos, 27 km long, orbits only 6,000 km above the surface, three times every Martian day. Phobos is slowly spiralling inward and will break apart or crash in about 50 million years.',
  scaleLog10: 4.8,
  waitForTravel: true,
  actions: [
    // Wind the clock (at most one 7.7 h orbit) until Phobos is 50° from Mars' noon, so that from just behind Phobos
    // both are sunlit, Phobos at a 25° phase angle and Mars beyond it at about 50°.
    { type: 'time-align', anchorId: 'sol:mars', satelliteId: 'sol:phobos', sunAngleDeg: 50, windowHours: 8 },
    { type: 'view-phase', anchorId: 'sol:mars', distanceM: 1.3e7, phaseDeg: 55, elevationDeg: 12 },
    { type: 'wait', ms: 7000 },
    { type: 'view-toward', anchorId: 'sol:phobos', towardId: 'sol:mars', away: true, sunwardDeg: 25, distanceM: 6.0e4 },
  ],
};

// More than a million asteroids larger than 1 km; typical spacing about a million km (NASA Science, "Asteroids";
// NASA/JPL "Dawn" mission FAQ). Ceres mean diameter 939.4 km (Park et al. 2016, Nature 537, 515). Bright deposits
// in Occator crater are mostly sodium carbonate (De Sanctis et al. 2016, Nature 536, 54).
export const CERES: TourStep = {
  id: 'ceres',
  title: 'Ceres and the asteroid belt',
  narration:
    'Between Mars and Jupiter lies the main asteroid belt: more than a million rocks wider than 1 km, yet so spread out that the big ones are typically a million kilometres apart. Ceres, 939 km wide, is the largest, a dwarf planet. NASA’s Dawn found bright salt deposits in its crater Occator.',
  scaleLog10: 6.2,
  waitForTravel: true,
  actions: [
    { type: 'overlay', id: 'asteroids', on: true },
    { type: 'view-phase', anchorId: 'sol:ceres', distanceM: 1.8e6, phaseDeg: 60, elevationDeg: 10 },
  ],
};

// DART impact 26 Sep 2022 23:14 UTC (NASA). Dimorphos about 150 m wide (Daly et al. 2023, Nature 616, 443).
// Orbital period 11.921 h → 11.372 h, a change of −33.0 ± 1.0 min (Thomas et al. 2023, Nature 616, 448).
export const DART: TourStep = {
  id: 'dart',
  title: 'Didymos and Dimorphos',
  narration:
    'On 26 September 2022, NASA’s DART spacecraft crashed into Dimorphos, a moonlet about 150 m wide that circles the asteroid Didymos. The impact shortened its orbit by 33 minutes, from 11 h 55 min to 11 h 22 min. It was the first test of moving an asteroid on purpose, a rehearsal for defending Earth.',
  scaleLog10: 3.6,
  waitForTravel: true,
  actions: [
    // Down Dimorphos' orbit normal, tipped toward the Sun: Dimorphos (1.19 km out) always within 18° of Didymos.
    { type: 'view-orbit-normal', anchorId: 'sb:didymos', satelliteId: 'sb:dimorphos', distanceM: 3800, tiltDeg: 50 },
  ],
};

// Jupiter equatorial radius 71,492 km = 11.2 Earth; mass 1,898 × 10²⁴ kg vs 768 × 10²⁴ kg for the other seven
// planets together (NASA Planetary Fact Sheet). Rotation 9 h 55.5 min → one turn per 60 s at 600×.
// Great Red Spot about 16,000 km wide in 2017 (Simon et al. 2018, AJ 155, 151), wider than Earth (12,742 km).
export const JUPITER: TourStep = {
  id: 'jupiter',
  title: 'Jupiter',
  narration:
    'Jupiter is 11 Earths wide and holds more than twice the mass of all the other planets together. Its stripes are bands of ammonia cloud driven by jet streams. Time runs 600 times faster here, so the planet turns once a minute and brings round the Great Red Spot, a storm wider than Earth.',
  scaleLog10: 8.4,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:jupiter', distanceM: 2.4e8, phaseDeg: 50, elevationDeg: 6 },
    { type: 'time-rate', rate: 600 },
  ],
};

// About 400 active volcanoes (NASA Science, "Io: Facts"). Pele's plume about 300 km high (Strom et al. 1979,
// Nature 280, 733; Spencer et al. 1997). Sulfur and SO₂ frost colour the surface.
export const IO: TourStep = {
  id: 'io',
  title: 'Io',
  narration:
    'Io is the most volcanic world known, with about 400 active volcanoes. Jupiter’s tides flex the moon and keep its interior molten. Plumes from volcanoes such as Pele rise about 300 km and fall back as sulfur frost, painting the ground yellow, orange and red.',
  scaleLog10: 6.8,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:io', distanceM: 6.0e6, phaseDeg: 80, elevationDeg: 6 },
  ],
};

// Europa radius 1,560.8 km vs the Moon's 1,737.4 km (NASA Jovian Satellite Fact Sheet). Ice shell 15–25 km;
// ocean may hold twice the water of Earth's oceans (NASA Science, "Europa: Facts"). Europa Clipper launched
// 14 Oct 2024, arrives April 2030 (NASA/JPL).
export const EUROPA: TourStep = {
  id: 'europa',
  title: 'Europa',
  narration:
    'Europa is a little smaller than our Moon, sealed under a cracked shell of ice 15 to 25 km thick. Beneath it lies a salty ocean that may hold twice as much water as all of Earth’s oceans. NASA’s Europa Clipper, launched in 2024, arrives in 2030 to study it.',
  scaleLog10: 6.8,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:europa', distanceM: 5.4e6, phaseDeg: 60, elevationDeg: 8 },
  ],
};

// F ring radius 140,180 km → about 280,000 km across; main rings typically about 10 m thick; Cassini Division
// about 4,800 km wide (NASA Science, "Saturn's rings"; Saturnian Rings Fact Sheet).
export const SATURN: TourStep = {
  id: 'saturn',
  title: 'Saturn’s rings',
  narration:
    'Saturn’s rings are about 280,000 km across but mostly only about 10 m thick, made of countless pieces of water ice. The dark gap is the Cassini Division, 4,800 km wide. Look for the planet’s shadow falling across the rings.',
  scaleLog10: 8.6,
  waitForTravel: true,
  actions: [
    // Down Tethys' orbit normal (≈ Saturn's equator pole, 1.1° off), tipped 62° toward the Sun: the sunlit face of
    // the rings seen from about 28° above the ring plane, even near ring-plane crossing.
    { type: 'view-orbit-normal', anchorId: 'sol:saturn', satelliteId: 'sol:tethys', distanceM: 3.6e8, tiltDeg: 62 },
  ],
};

// Titan surface pressure 1.47 bar (Fulchignoni et al. 2005, Nature 438, 785, Huygens HASI). Methane rain, rivers,
// lakes and seas (Stofan et al. 2007; NASA Science, "Titan: Facts"). Huygens landed 14 Jan 2005 (ESA).
export const TITAN: TourStep = {
  id: 'titan',
  title: 'Titan',
  narration:
    'Titan, Saturn’s largest moon, is the only moon with a thick atmosphere: the pressure at its surface is 1.5 times Earth’s. An orange haze of organic molecules hides a surface where methane rain fills rivers, lakes and seas. ESA’s Huygens probe landed there in 2005.',
  scaleLog10: 7,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:titan', distanceM: 9.0e6, phaseDeg: 115, elevationDeg: 6 },
  ],
};

// Enceladus mean radius 252.1 km → 504 km wide (NASA Saturnian Satellite Fact Sheet); geometric albedo about 1.4,
// among the highest in the Solar System (Verbiscer et al. 2007, Science 315, 815). South-polar jets (Porco et al.
// 2006, Science 311, 1393); salt (Postberg et al. 2009, Nature 459, 1098) and organics (Postberg et al. 2018).
export const ENCELADUS: TourStep = {
  id: 'enceladus',
  title: 'Enceladus',
  narration:
    'Enceladus is only 504 km wide, but its fresh snow makes it one of the most reflective objects in the Solar System. From cracks near its south pole, jets spray water vapour and ice grains into space. Cassini flew through them and found salt and organic molecules from an ocean below.',
  scaleLog10: 6,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:enceladus', distanceM: 1.1e6, phaseDeg: 135, elevationDeg: -30 },
  ],
};

// Obliquity 97.8°; orbital period 84.0 years → each pole about 42 years of sunlight, then 42 of darkness
// (NASA Uranus Fact Sheet). Methane absorbs red light (NASA Science, "Uranus: Facts"). Voyager 2 flyby 24 Jan 1986.
export const URANUS: TourStep = {
  id: 'uranus',
  title: 'Uranus',
  narration:
    'Uranus spins on its side, its axis tipped 98° from upright, so each pole gets about 42 years of daylight followed by 42 years of night. Methane in its air absorbs red light, leaving the planet pale cyan. Only one spacecraft has visited: Voyager 2, in 1986.',
  scaleLog10: 8,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:uranus', distanceM: 1.3e8, phaseDeg: 50, elevationDeg: 10 },
  ],
};

// Neptune semi-major axis 30.07 AU; winds up to about 2,100 km/h (NASA Science, "Neptune: Facts"). Triton orbits
// retrograde (NASA Neptunian Satellite Fact Sheet), probably a captured Kuiper belt object (Agnor & Hamilton 2006,
// Nature 441, 192). Voyager 2 imaged active plumes in 1989 (Soderblom et al. 1990, Science 250, 410).
export const NEPTUNE: TourStep = {
  id: 'neptune',
  title: 'Neptune and Triton',
  narration:
    'Neptune is 30 times farther from the Sun than Earth, and its winds are the fastest measured on any planet: up to 2,100 km/h. Its largest moon, Triton, circles it backwards, against the planet’s spin, so it was probably captured from the Kuiper belt. Voyager 2 saw nitrogen plumes rising from Triton in 1989.',
  scaleLog10: 7,
  waitForTravel: true,
  actions: [
    { type: 'view-phase', anchorId: 'sol:neptune', distanceM: 1.25e8, phaseDeg: 45, elevationDeg: 10 },
    { type: 'wait', ms: 7000 },
    // Over Sipapu Planitia, in the 40 % of Triton that Voyager 2 imaged in 1989 (NASA Science, "Triton"; the rest is unmapped), tipped
    // south toward the polar cap.
    { type: 'view-toward', anchorId: 'sol:triton', towardId: 'feat:triton:sipapu-planitia', sunwardDeg: 30, distanceM: 6.0e6, elevationOffsetDeg: -12 },
  ],
};

/** New Horizons' closest approach to Pluto, 14 Jul 2015 11:49:57 UTC (Stern et al. 2015, Science 350, aad1815). */
const NEW_HORIZONS_FLYBY_MS = Date.UTC(2015, 6, 14, 11, 50);

// Pluto radius 1,188.3 km = 0.68 of the Moon's; Charon 606 km = 0.51 of Pluto's (Stern et al. 2015, Science 350;
// Nimmo et al. 2017). New Horizons flyby 14 Jul 2015. Tombaugh Regio; its western lobe Sputnik Planitia is
// nitrogen ice (Moore et al. 2016, Science 351, 1284). The barycentre lies outside Pluto (NASA Science, "Charon").
export const PLUTO: TourStep = {
  id: 'pluto',
  title: 'Pluto and Charon',
  narration:
    'Pluto, a dwarf planet two-thirds the width of our Moon, is one of thousands of icy worlds in the Kuiper belt. This is 14 July 2015, the day New Horizons flew past and found a bright heart-shaped region, Tombaugh Regio, half of it a plain of frozen nitrogen. Charon is half Pluto’s width, so the pair circle a point in the space between them.',
  scaleLog10: 6.7,
  waitForTravel: true,
  actions: [
    { type: 'time-jump', ms: NEW_HORIZONS_FLYBY_MS },
    { type: 'wait', ms: 300 },
    // Straight down onto Tombaugh Regio (its gazetteer point, so the heart is centred whatever Pluto's rotation
    // model), turned 35° toward the Sun so the heart is lit as New Horizons saw it on approach.
    { type: 'view-toward', anchorId: 'sol:pluto', towardId: 'feat:pluto:tombaugh-regio', sunwardDeg: 35, distanceM: 5.0e6, elevationOffsetDeg: 4 },
    { type: 'wait', ms: 8000 },
    // Then pull back over the sunlit pole of Charon's orbit (radius 19,596 km, Brozović et al. 2015, Icarus 246, 317)
    // so the pair sit side by side, both lit.
    { type: 'view-orbit-normal', anchorId: 'sol:pluto', satelliteId: 'sol:charon', distanceM: 3.2e7, tiltDeg: 10, durationSec: 6 },
  ],
};

// Voyager 1 launched 5 Sep 1977; more than 170 AU from the Sun in 2026 (JPL Horizons; the app's own trajectory
// gives 172 AU on 2026-10-19), so radio signals take almost a day (172 AU × 499 s/AU ≈ 23.9 h). Heliopause crossing
// 25 Aug 2012 at 121.6 AU (Stone et al. 2013, Science 341, 150). Pale Blue Dot: 14 Feb 1990 from about 6 billion km
// (40 AU); Earth spans 0.12 pixel (NASA/JPL PIA00452).
export const LOOKING_BACK: TourStep = {
  id: 'looking-back',
  title: 'Looking back',
  narration:
    'Voyager 1, launched in 1977, is now more than 170 times farther from the Sun than Earth; its radio signals take almost a day to reach us. In 2012 it crossed the heliopause, where the Sun’s wind gives way to interstellar space. Shown at true size, every planet from here is far smaller than one pixel. In 1990, from 40 AU, Voyager turned around and caught Earth as a pale blue dot.',
  scaleLog10: 13.5,
  waitForTravel: true,
  actions: [
    { type: 'visual-scale', mode: 'true' },
    { type: 'overlay', id: 'spacecraft', on: true },
    { type: 'view-toward', anchorId: 'sol:sun', towardId: 'sc:voyager-1', distanceM: 5.0e13, azimuthOffsetDeg: -28, elevationOffsetDeg: 18 },
  ],
};
