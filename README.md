<h1 align="center"><a href="https://cosmos-sciforge.vercel.app"><img src="docs/media/banner.webp" width="880" alt="Cosmos. One continuous flight from low Earth orbit to the oldest light in the universe. A real-time render of Earth inside its cloud of tracked satellites and debris, above a logarithmic scale bar from 1 metre to 10 to the 27 metres marked with the ISS, Earth, the Moon, the Sun, Neptune, Proxima Centauri, Sagittarius A*, Andromeda, Laniakea and the cosmic microwave background."></a></h1>

<p align="center"><b>Every number traceable to its source.</b> Cosmos is a 3D universe explorer that runs in a web browser. It places about 31,800 satellites and pieces of debris, the planets and their moons, 75,855 asteroids, 109,389 stars, 6,451 exoplanets, a reconstructed Milky Way, 13 measured black holes and about 2.2 million galaxies where public catalogues say they are, and lets you move between them without a loading screen. Four labs turn the view into experiments, and every value carries a mark saying whether it was observed, derived, reconstructed or illustrative.<br><sub>Dhruvin Sarkar. Built for the SCI-FORGE 2026 student science exhibition. Runs fully offline.</sub></p>

<p align="center"><a href="https://cosmos-sciforge.vercel.app">Open&nbsp;Cosmos</a>&emsp;<a href="#the-golden-journey">The&nbsp;golden&nbsp;journey</a>&emsp;<a href="#four-labs">Labs</a>&emsp;<a href="#provenance-on-every-value">Provenance</a>&emsp;<a href="#data-sources-and-licences">Data&nbsp;and&nbsp;licences</a>&emsp;<a href="#at-the-exhibition">Kiosk&nbsp;mode</a>&emsp;<a href="#run-it-yourself">Run&nbsp;it</a>&emsp;<a href="docs/SCIENCE.md">Science&nbsp;notes</a></p>

<p align="center">
  <a href="https://cosmos-sciforge.vercel.app"><img alt="Live site" src="https://img.shields.io/badge/live-open%20Cosmos-0b0d12?style=flat-square&labelColor=0b0d12&color=e8c27a"></a>
  <img alt="three.js r186" src="https://img.shields.io/badge/three.js-r186-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="WebGL 2" src="https://img.shields.io/badge/WebGL-2-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="React 19" src="https://img.shields.io/badge/React-19-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="TypeScript strict" src="https://img.shields.io/badge/TypeScript-strict-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="Vite 8" src="https://img.shields.io/badge/Vite-8-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="715 unit tests passing" src="https://img.shields.io/badge/tests-715%20passing-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <img alt="Works offline" src="https://img.shields.io/badge/network-none%20needed-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b">
  <a href="LICENSE"><img alt="Apache-2.0" src="https://img.shields.io/badge/code-Apache--2.0-0b0d12?style=flat-square&labelColor=0b0d12&color=3a3f4b"></a>
</p>

<p align="center"><picture><source media="(prefers-color-scheme: light)" srcset="docs/media/hero-stats-light.webp"><img src="docs/media/hero-stats-dark.webp" width="880" alt="Cosmos at a glance: 31,800 satellites and pieces of debris propagated with SGP4; 75,855 numbered asteroids plus 3,449 near-Earth objects and 7,301 trans-Neptunian objects; 109,389 stars; 6,451 confirmed exoplanets around 4,847 host stars; 2.2 million galaxies in the cosmic web; view scales from 1 metre to 10 to the 27 metres in one coordinate system; 76 versioned datasets; zero requests to outside servers."></picture></p>

<!-- media:clip-hero -->
<p align="center"><img src="docs/media/clips/earth-to-solar-system.gif" width="880" alt="A real-time recording of Cosmos: a continuous camera move from Earth outward, with no cuts and no loading screens."></p>
<!-- /media:clip-hero -->

## Why it exists

Space is hard to picture because it covers too many scales. A satellite is a few metres across; Neptune is 4.5 billion kilometres away; the cosmic microwave background is about 45 billion light-years away. Textbook diagrams give up and squash all of it onto one page.

Cosmos keeps the distances honest and lets a visitor cross 27 orders of magnitude in one move, from a field of view one metre wide to the 8.8 × 10²⁶ m diameter of the observable universe: drag to orbit, scroll to zoom, click to ask what something is and how we know. The scene is one coordinate system, held in float64 metres on the ICRS/J2000 axes and drawn relative to the camera, with a logarithmic depth buffer so that a docking port on the ISS and a supercluster can share a frame without flicker.

## What is inside

| Scale | What you see | Source |
| --- | --- | --- |
| Earth | Day, night, cloud and relief maps; Rayleigh and Mie atmosphere; city lights; aurora driven by observed Kp; eclipses | NASA Blue Marble and Black Marble, NOAA ETOPO 2022, NASA DONKI |
| Earth orbit | About 31,800 tracked objects propagated with SGP4 in a worker, including the ISS, Hubble and Tiangong | CelesTrak GP elements and SATCAT |
| Sun and planets | The Sun with SDO sunspots and corona, 8 planets, 5 dwarf planets (Ceres, Pluto, Eris, Haumea, Makemake), Saturn's rings | astronomy-engine (VSOP87, ELP/MPP02), NAIF, NSSDCA, SDO |
| Moons | The moons of every planet on JPL mean elements; the Galilean moons on the L1.2 theory | JPL SSD, astronomy-engine |
| Small bodies | 75,855 numbered asteroids (H < 15), 3,449 near-Earth objects, 23 named asteroids and comets with mission shape models | JPL SBDB, CNEOS, NASA PDS, JAXA, ESA |
| Spacecraft | 12 missions on JPL Horizons tracks, from Voyager 1 to JWST | JPL Horizons |
| Outer system | 7,301 trans-Neptunian objects, a heliosphere fitted to the four Voyager crossings, an illustrative Oort cloud | JPL SBDB, Stone et al. 2013 and 2019 |
| Sky | 109,389 stars, 88 constellations, 14 all-sky maps from radio to gamma rays | HYG v4.4, Gaia, Stellarium, Planck, 2MASS, unWISE, AKARI, GALEX, ROSAT, eROSITA, Fermi |
| Exoplanets | 6,451 confirmed planets around 4,847 host stars, with orbit views of TRAPPIST-1, Proxima Centauri, Kepler-16, HR 8799 and others | NASA Exoplanet Archive |
| Milky Way | A reconstructed Galaxy, 157 globular clusters, 28 landmark nebulae and clusters, Sagittarius A* and the S-stars | GRAVITY 2024, Reid et al. 2019, Gillessen et al. 2017 |
| Black holes | 13 measured black holes, from Gaia BH1 to M87*, with lensing, disks and jets drawn from their parameters | Published papers, EHT 2019 |
| Galaxies | 869 galaxies of the Local Volume, the Local Group, Virgo and Laniakea | Karachentsev et al. 2013, curated references |
| Cosmic web | About 2.2 million galaxies: 2MRS plus DESI DR1 bright and luminous red galaxies | Huchra et al. 2012, DESI DR1 |
| Cosmology | The Planck map of the cosmic microwave background on the sphere of last scattering | Planck PR3 SMICA |

<!-- media:inside-chart -->
<p align="center"><img src="docs/media/charts/inside.svg" width="880" alt="What is inside Cosmos: a log-scale bar chart of every catalogue, from 2.2 million galaxies down to 13 measured black holes, each with its source."></p>
<!-- /media:inside-chart -->

## The golden journey

Press `T` and Cosmos flies the 23-chapter golden journey, each chapter with narration and sources: Earth, the ISS, the debris lab, the Moon, the Sun, the Sun's family of planets, Jupiter, Saturn, the DART lab, a look back from Voyager 1, the Oort cloud, Proxima Centauri, TRAPPIST-1, out of the Orion Arm, the Milky Way, Sagittarius A* and S2, a black hole, Andromeda, the Local Group, Virgo and Laniakea, the cosmic web, the cosmic microwave background, and home. The arrow keys step between chapters, any drag or scroll lets the visitor explore, and `R` returns to the chapter's view.

Two shorter tours ship alongside it: a 20-chapter Solar System tour and a 6-chapter quick tour of about three minutes.

<!-- media:journey -->
<table>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/earth-day.webp" width="280" alt="Earth. Day maps, clouds and a Rayleigh and Mie atmosphere, lit only by the Sun."><br><b>Earth</b><br><sub>Day maps, clouds and a Rayleigh and Mie atmosphere, lit only by the Sun.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/iss-closeup.webp" width="280" alt="The ISS. 109 m end to end, about 400 km up, at its SGP4 position."><br><b>The ISS</b><br><sub>109 m end to end, about 400 km up, at its SGP4 position.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/orbital-debris.webp" width="280" alt="Low Earth orbit. About 31,800 tracked satellites and pieces of debris, propagated with SGP4."><br><b>Low Earth orbit</b><br><sub>About 31,800 tracked satellites and pieces of debris, propagated with SGP4.</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/moon.webp" width="280" alt="The Moon. Placed by ELP/MPP02 and lit from the true direction of the Sun."><br><b>The Moon</b><br><sub>Placed by ELP/MPP02 and lit from the true direction of the Sun.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/sun.webp" width="280" alt="The Sun. Sunspots and corona from SDO imagery, the one light source in the scene."><br><b>The Sun</b><br><sub>Sunspots and corona from SDO imagery, the one light source in the scene.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/inner-solar-system.webp" width="280" alt="The inner Solar System. Planets where VSOP87 puts them; discs enlarged for visibility, as the app discloses."><br><b>The inner Solar System</b><br><sub>Planets where VSOP87 puts them; discs enlarged for visibility, as the app discloses.</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/jupiter.webp" width="280" alt="Jupiter. Limb-darkened cloud bands and the Galilean moons on the L1.2 theory."><br><b>Jupiter</b><br><sub>Limb-darkened cloud bands and the Galilean moons on the L1.2 theory.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/saturn-rings.webp" width="280" alt="Saturn. Translucent rings with the Cassini division, shadowed by the planet."><br><b>Saturn</b><br><sub>Translucent rings with the Cassini division, shadowed by the planet.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/dart-didymos.webp" width="280" alt="Didymos and Dimorphos. The DART target pair from its mission shape models."><br><b>Didymos and Dimorphos</b><br><sub>The DART target pair from its mission shape models.</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/heliosphere-boundary.webp" width="280" alt="The heliosphere. Its shape fitted to the four Voyager boundary crossings."><br><b>The heliosphere</b><br><sub>Its shape fitted to the four Voyager boundary crossings.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/nearest-stars-proxima.webp" width="280" alt="Proxima Centauri. The nearest star, its planets and its habitable zone."><br><b>Proxima Centauri</b><br><sub>The nearest star, its planets and its habitable zone.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/exoplanet-trappist-1.webp" width="280" alt="TRAPPIST-1. Seven planets on archive orbits; their surfaces are illustrative."><br><b>TRAPPIST-1</b><br><sub>Seven planets on archive orbits; their surfaces are illustrative.</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/milky-way.webp" width="280" alt="The Milky Way. Reconstructed from published models: no one has seen it from outside."><br><b>The Milky Way</b><br><sub>Reconstructed from published models: no one has seen it from outside.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/black-hole-m87.webp" width="280" alt="A black hole. Lensing, disk and jet drawn from measured parameters; appearance illustrative."><br><b>A black hole</b><br><sub>Lensing, disk and jet drawn from measured parameters; appearance illustrative.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/andromeda.webp" width="280" alt="Andromeda. Our nearest large galaxy, about 2.5 million light-years away."><br><b>Andromeda</b><br><sub>Our nearest large galaxy, about 2.5 million light-years away.</sub></td>
</tr>
<tr>
<td width="33%" valign="top"><img src="docs/media/screens/cosmic-web.webp" width="280" alt="The cosmic web. About 2.2 million galaxies from 2MRS and DESI DR1, in redshift space."><br><b>The cosmic web</b><br><sub>About 2.2 million galaxies from 2MRS and DESI DR1, in redshift space.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/cmb.webp" width="280" alt="The cosmic microwave background. The Planck map on the sphere of last scattering."><br><b>The cosmic microwave background</b><br><sub>The Planck map on the sphere of last scattering.</sub></td>
<td width="33%" valign="top"><img src="docs/media/screens/earth-night-lights.webp" width="280" alt="And home. The night side of Earth, lit by its cities."><br><b>And home</b><br><sub>The night side of Earth, lit by its cities.</sub></td>
</tr>
</table>
<p align="center"><img src="docs/media/charts/ladder.svg" width="880" alt="The golden journey on a log scale: distances from Earth to each stop, from the International Space Station at about 400 km to the cosmic microwave background at about 45 billion light-years."></p>
<!-- /media:journey -->

<!-- media:clips -->
<table>
<tr>
<td width="50%" valign="top"><img src="docs/media/clips/black-hole-orbit.gif" width="430" alt="Around a black hole. Recorded in real time from the running app."><br><b>Around a black hole</b><br><sub>Recorded in real time from the running app.</sub></td>
<td width="50%" valign="top"><img src="docs/media/clips/debris-lab.gif" width="430" alt="Orbital debris lab. Recorded in real time from the running app."><br><b>Orbital debris lab</b><br><sub>Recorded in real time from the running app.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/media/clips/interiors-wedge.gif" width="430" alt="Inside the Earth. Recorded in real time from the running app."><br><b>Inside the Earth</b><br><sub>Recorded in real time from the running app.</sub></td>
<td width="50%" valign="top"><img src="docs/media/clips/kiosk-tour.gif" width="430" alt="The tour in exhibition mode. Recorded in real time from the running app."><br><b>The tour in exhibition mode</b><br><sub>Recorded in real time from the running app.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/media/clips/milky-way-to-local-group.gif" width="430" alt="From the Milky Way to the Local Group. Recorded in real time from the running app."><br><b>From the Milky Way to the Local Group</b><br><sub>Recorded in real time from the running app.</sub></td>
</tr>
</table>

<sub>Full-quality video: <a href="docs/media/clips/black-hole-orbit.mp4">Around a black hole</a> · <a href="docs/media/clips/debris-lab.mp4">Orbital debris lab</a> · <a href="docs/media/clips/earth-to-solar-system.mp4">From Earth to the Solar System</a> · <a href="docs/media/clips/interiors-wedge.mp4">Inside the Earth</a> · <a href="docs/media/clips/kiosk-tour.mp4">The tour in exhibition mode</a> · <a href="docs/media/clips/milky-way-to-local-group.mp4">From the Milky Way to the Local Group</a></sub>
<!-- /media:clips -->

## Four labs

Each lab opens from a button in the inspector of a related object and closes with `Esc`.

**Orbital debris lab.** The 29,408 tracked objects in low Earth orbit by type and by 50 km altitude shell, then a population model with five policy scenarios, solar activity, active debris removal and a time horizon. Business as usual reaches about 583,000 objects and 140 collisions a year by 2126; stopping launches holds the count near 25,000. A breakup view spreads the fragments of the 2009 Iridium 33 and Cosmos 2251 collision or the 2007 Fengyun-1C test. It is a teaching model, and the lab says so.

**Asteroid deflection lab.** A 3D replay of NASA's DART impact on Dimorphos on 26 September 2022, built on the Didymos and Dimorphos shape models. The first-order relation ΔP ≈ 3PΔv/v gives an orbit change of −33.3 minutes against the measured −33.0 ± 1.0 (Thomas et al. 2023); a full point-mass calculation gives −31.8 and the lab shows both. *Defend Earth* then sets a hypothetical asteroid against a kinetic impactor and reports the miss distance against Earth's 8,710 km capture radius, with a Monte Carlo success probability.

**Habitability lab.** Pick a star, orbit, planet size and climate, or start from Earth or Venus, and read the surface and equilibrium temperature, the starlight relative to Earth, the Earth Similarity Index and the position in the habitable zone. A second view charts all 6,451 confirmed exoplanets and rings every host star in the 3D scene while it is open.

**Black hole lab.** Lower a clock towards Sagittarius A* past the photon sphere and the innermost stable orbit and watch it slow; plot time dilation against distance; follow S2 around its 16-year orbit and its measured gravitational redshift; then see the same distances drawn around the black hole in 3D. Readouts include the Schwarzschild radius, the shadow's size on our sky and the tidal stretch on a person at the horizon.

<!-- media:labs -->
<table>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/lab-debris.webp" width="430" alt="Orbital debris lab. Policy scenarios for the low-Earth-orbit population over a century."><br><b>Orbital debris lab</b><br><sub>Policy scenarios for the low-Earth-orbit population over a century.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/lab-defense-impact.webp" width="430" alt="Asteroid deflection lab. The DART impact replayed and a hypothetical asteroid to deflect."><br><b>Asteroid deflection lab</b><br><sub>The DART impact replayed and a hypothetical asteroid to deflect.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/lab-habitability.webp" width="430" alt="Habitability lab. Temperature, starlight and habitable zone for any star and planet."><br><b>Habitability lab</b><br><sub>Temperature, starlight and habitable zone for any star and planet.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/lab-relativity.webp" width="430" alt="Black hole lab. A clock lowered towards Sagittarius A*, and time dilation against distance."><br><b>Black hole lab</b><br><sub>A clock lowered towards Sagittarius A*, and time dilation against distance.</sub></td>
</tr>
</table>
<!-- /media:labs -->

## Inside the planets

The inspector of 18 bodies offers **Inside: cutaway**, a sliced view of the layers from the centre out: the Sun, the eight planets, the Moon, Ceres, Pluto, Io, Europa, Ganymede, Callisto, Enceladus and Titan. Layers are drawn at true proportion, except those thinner than 1.4% of the radius, which are drawn at 1.4% and labelled as thickened. `T` switches between material and model temperature on a logarithmic scale, `C` sets the body beside a comparison, and each boundary carries its provenance and the spread of published models. The data are checked by unit tests against headline values such as Earth's inner core at 1,221.5 km and outer core at 3,480 km (PREM) and the base of the Sun's convection zone at 0.713 solar radii ([docs/data/interiors.md](docs/data/interiors.md)).

<!-- media:interiors -->
<table>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/interior-earth.webp" width="430" alt="Earth, inside. Layers at true proportion from the centre out, each boundary with its provenance."><br><b>Earth, inside</b><br><sub>Layers at true proportion from the centre out, each boundary with its provenance.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/interior-jupiter.webp" width="430" alt="Jupiter, inside. Layers at true proportion from the centre out, each boundary with its provenance."><br><b>Jupiter, inside</b><br><sub>Layers at true proportion from the centre out, each boundary with its provenance.</sub></td>
</tr>
</table>
<!-- /media:interiors -->

## Black holes

Thirteen black holes with masses and distances from the papers that measured them: the dormant Gaia BH1, BH2 and BH3, Cygnus X-1, the merger GW150914, Sagittarius A*, M87* and others ([docs/data/blackholes.md](docs/data/blackholes.md)). Gravitational lensing, accretion disks and jets are rendered from those parameters; their appearance is marked illustrative, and the M87* image shown beside the model is the Event Horizon Telescope's 2019 observation.

<!-- media:blackholes -->
<table>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/lab-black-hole.webp" width="430" alt="Sagittarius A*. 4.30 million solar masses at the centre of the Milky Way, with its fact sheet."><br><b>Sagittarius A*</b><br><sub>4.30 million solar masses at the centre of the Milky Way, with its fact sheet.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/black-hole-m87.webp" width="430" alt="Seen edge-on. The far side of the disk lensed over the shadow."><br><b>Seen edge-on</b><br><sub>The far side of the disk lensed over the shadow.</sub></td>
</tr>
</table>
<!-- /media:blackholes -->

## Finding your way

`B` opens the Solar System navigator, `Ctrl+K` searches everything in the scene by name, the Cosmic Ruler on the right steps the view one power of ten at a time, and Settings holds graphics quality, view scale and simulation time. Double-click anything to fly there; the camera eases out, across and in, so the visitor never loses track of where they are.

<!-- media:interface -->
<table>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/ui-navigator.webp" width="430" alt="Navigator. Every planet, dwarf planet and moon, one key away."><br><b>Navigator</b><br><sub>Every planet, dwarf planet and moon, one key away.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/ui-search.webp" width="430" alt="Search. Planets, moons, satellites, stars, exoplanets, black holes and galaxies."><br><b>Search</b><br><sub>Planets, moons, satellites, stars, exoplanets, black holes and galaxies.</sub></td>
</tr>
<tr>
<td width="50%" valign="top"><img src="docs/media/screens/ui-settings.webp" width="430" alt="Settings. Graphics quality, view scale and simulation time."><br><b>Settings</b><br><sub>Graphics quality, view scale and simulation time.</sub></td>
<td width="50%" valign="top"><img src="docs/media/screens/tour-captions-jupiter.webp" width="430" alt="Tours. Narrated chapters with their sources."><br><b>Tours</b><br><sub>Narrated chapters with their sources.</sub></td>
</tr>
</table>
<!-- /media:interface -->

## Provenance on every value

Click any object and its fact sheet answers what it is, where it is, how far away and how we know. Each value carries one of four marks, and hovering a mark shows its source.

| Mark | Meaning | Example |
| --- | --- | --- |
| Observed | Measured, from a cited source | The ISS orbit elements from CelesTrak |
| Derived | Computed from observed values by a stated model | A near-Earth object's diameter from its absolute magnitude |
| Reconstructed | Inferred from data | The heliosphere's shape, fitted to the Voyager crossings |
| Illustrative | Drawn for clarity, not measured | The Oort cloud, comet tails, exoplanet surfaces |

A missing value is shown as "Unknown", never as 0. The **Sources** panel lists all 76 datasets with version, retrieval date, licence, citation and known limitations; the same registry is [public/data/manifest.json](public/data/manifest.json) and, in prose, [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).

<!-- media:ui-provenance -->
<p align="center"><img src="docs/media/screens/ui-inspector-provenance.webp" width="880" alt="The Cosmos inspector: a fact sheet in which every value carries an observed, derived, reconstructed or illustrative mark and its source."></p>
<!-- /media:ui-provenance -->

**Exhibition scale.** Real planets are invisible dots at Solar System distances, so by default Cosmos draws bodies larger than life and shrinks them smoothly to true size within 40 radii of the body. Distances never change; moons, rings and satellites are moved outward with their planet so nothing sits inside an enlarged body. The top bar always reads "Enlarged for visibility", and one click on it switches to true scale. At 4 au in the inner-system overview, Earth is drawn about 448 times its true size ([docs/design/VISUAL_SCALE.md](docs/design/VISUAL_SCALE.md)).

## How accurate it is

| What | Method | Accuracy |
| --- | --- | --- |
| Sun, planets, Moon | astronomy-engine: VSOP87, ELP/MPP02, IAU rotation models | About an arcminute or better over centuries around today |
| Galilean moons | L1.2 theory | About an arcminute |
| Other moons | JPL mean elements with precession | Plausible positions and good orbit lines, no mutual perturbations |
| Satellites and debris | SGP4/SDP4 from mean elements | About 1 km at epoch, growing by 1 to 3 km per day; median element age 1.1 days |
| Asteroids and comets | Two-body Kepler orbits solved per vertex on the GPU | Good for display and about a year of propagation |
| Spacecraft | Cubic Hermite interpolation of JPL Horizons tracks, 2025 to 2030 | Horizons accuracy; never extrapolated past the track |
| DART orbit change | ΔP ≈ 3PΔv/v | −33.3 min against the measured −33.0 ± 1.0 min |

Full methods, data, accuracy and what is not modelled, feature by feature: [docs/SCIENCE.md](docs/SCIENCE.md).

## Where it falls short

> [!NOTE]
> Cosmos is a snapshot, not a live feed. Every dataset was retrieved between 16 and 19 October 2026, so satellite positions drift by a few kilometres for each day away from their element epochs. The planets and moons come from formulas and stay good for any date near today.

- **Drawn, not measured:** aurora shapes, the plumes of Enceladus and Io, comet tails, the Oort cloud, spacecraft models (their positions are real), irregular moon shapes without a survey, unimaged hemispheres such as Triton's, fine surface detail seen very close up, the appearance of black-hole disks and jets, and every exoplanet surface.
- **Reconstructed:** the Milky Way seen from outside. Nobody has photographed our Galaxy from outside; its arms, bar and discs are built from published models.
- **Redshift space:** cosmic-web distances come from redshift in flat ΛCDM with Planck 2018 parameters, so clusters look stretched along the line of sight, and the empty wedge behind the Galactic disc is the Zone of Avoidance, where surveys cannot see.
- **Only what can be tracked:** the satellite catalogue lists objects larger than about 10 cm. ESA estimates about 1.5 million objects between 1 and 10 cm that are not shown.
- **Teaching models:** the debris, deflection and habitability labs are simplified models. Each states its assumptions as inputs, and results change by large factors when those assumptions change.

## Data sources and licences

Every dataset is a versioned snapshot in [public/data/](public/data/), fetched by a reproducible script in [scripts/data/](scripts/data/). The main providers and their terms:

| Provider | What Cosmos uses | Terms |
| --- | --- | --- |
| NASA / JPL SSD, CNEOS, Horizons | Planet and moon parameters, 75,855 asteroids, 3,449 NEOs, 7,301 TNOs, close approaches, Sentry, spacecraft tracks | U.S. Government public data; no licence stated; JPL API fair-use policy |
| NASA Exoplanet Archive | 6,451 planets and 4,847 host systems (`pscomppars`) | Public, no explicit licence; acknowledgement and citation requested |
| CelesTrak | GP/OMM element sets and SATCAT for about 31,800 objects | No formal licence; basic SSA data redistributable with citation |
| NAIF SPICE | `pck00011` rotation elements and radii, `gm_de440` masses | Free to use and redistribute |
| NASA (Blue Marble, Black Marble, EPIC, SDO, DONKI, NSSDCA, Treks, Hubble OPAL) | Earth maps, Sun images, space weather, fact sheets, Ceres and Vesta mosaics, giant-planet colour maps | Public domain |
| USGS Astrogeology | IAU Gazetteer of Planetary Nomenclature, planetary mosaics and elevation | Public domain |
| NOAA | ETOPO 2022 elevation, SWPC solar-cycle indices | Public domain |
| ESA Gaia | Visible all-sky map, Gaia Catalogue of Nearby Stars | CC BY-NC 3.0 IGO |
| ESA Planck | Microwave, submillimetre and CMB maps | CC BY-NC 3.0 IGO |
| HYG Database v4.4 | 109,389 stars and their names | CC BY-SA 4.0 |
| Stellarium | Constellation figures (`modern_iau`) | CC BY-SA 4.0 |
| CDS (SIMBAD, VizieR, HiPS) | Galaxy and landmark catalogues, constellation boundaries, all-sky tiles | Free with acknowledgement; HiPS tiles ODbL-1.0 |
| DESI DR1 | 1.8 million bright galaxies and 400,000 luminous red galaxies | CC BY 4.0 |
| 2MRS, UNGC (via VizieR) | 43,508 galaxies of the 2MASS Redshift Survey, 869 Local Volume galaxies | Free scientific use with acknowledgement |
| Solar System Scope | Planet colour maps, Earth clouds, ring strip | CC BY 4.0 |
| Event Horizon Telescope | The 2019 image of M87* | CC BY 4.0 |
| Mission shape models | Bennu, Eros, Itokawa, Didymos, Dimorphos, Arrokoth (NASA PDS); Ryugu (JAXA DARTS); 67P (ESA/Rosetta/NAVCAM) | Public domain; JAXA open data with credit; CC BY-SA 3.0 IGO |
| Published papers | Interiors, black holes, the Milky Way model, S-star orbits, dwarf-planet shapes | Facts cited per value; no text or figures reproduced |

Gaia and Planck data are licensed for non-commercial use only. Cosmos shows them for non-commercial education, with the required credit. The full registry of all 76 datasets is in the in-app Sources panel and [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md); per-domain notes are in [docs/data/](docs/data/).

## At the exhibition

The SCI-FORGE stand runs the production build on a laptop with an RTX 3050 (4 GB of video memory) and 16 GB of RAM, in full-screen Chrome or Edge, targeting 60 frames per second on the Balanced preset.

```bash
npm install && npm run build
npm run preview          # http://localhost:4173
```

Open `http://localhost:4173/?exhibition=1`. The `exhibition` flag puts the interface into exhibition mode from the start URL, with larger type and touch targets for a standing audience, overriding any saved preference, so a kiosk browser always boots the same way. Then press `N` to set the clock to now and `T` twice to check the tour.

Between visitors, `H` flies home to Earth, `Esc` closes whatever is open and `Shift+H` hides the whole interface for a clean picture. If the frame rate drops, Settings, Graphics quality, Fast; the backtick key shows a frame-rate readout. The three-minute demo script for judges, likely questions and the stand checklist are in [docs/EXHIBITION.md](docs/EXHIBITION.md).

<!-- media:ui-kiosk -->
<p align="center"><img src="docs/media/screens/ui-kiosk-exhibition.webp" width="880" alt="Cosmos in exhibition mode, with larger type and touch targets for a standing audience."></p>
<!-- /media:ui-kiosk -->

**SDG 4, Quality Education:** students change a variable and watch the result, and every fact teaches them to ask how we know. **SDG 17, Partnerships for the Goals:** everything here exists because NASA, ESA, USGS, NOAA, CelesTrak, the IAU, CDS, DESI and many survey teams share their data openly.

<!-- media:mobile -->
## On phones and tablets

The same build runs on phones and tablets with WebGL 2: drag to orbit, pinch to zoom across scales and drag with two fingers to pan, while the toolbar sheds its labels as the screen narrows.

<p align="center"><img src="docs/media/mobile/iphone15pro-earth.webp" width="150" alt="Cosmos on an iPhone 15 Pro: Earth and its satellites">&nbsp;<img src="docs/media/mobile/iphone15pro-saturn-inspector.webp" width="150" alt="Cosmos on an iPhone 15 Pro: Saturn and its fact sheet">&nbsp;<img src="docs/media/mobile/pixel8-lab-debris.webp" width="150" alt="Cosmos on a Pixel 8: the orbital debris lab">&nbsp;<img src="docs/media/mobile/iphone15pro-navigator.webp" width="150" alt="Cosmos on an iPhone 15 Pro: the Solar System navigator">&nbsp;<img src="docs/media/mobile/ipad-saturn-inspector.webp" width="244" alt="Cosmos on an iPad: Saturn and its fact sheet"></p>
<!-- /media:mobile -->

## Performance

Budgets, on the stand's RTX 3050 laptop: 60 frames per second, at least 45 sustained in the heaviest scenes, and no main-thread task over 50 ms during interaction. Four presets (Auto, Fast, Balanced, Ultra) set pixel ratio, bloom, anti-aliasing, texture tier and the star, galaxy, satellite and particle budgets; Auto adapts the resolution and steps between presets on sustained misses, and Ultra streams 8K maps for the body in focus.

<!-- media:performance -->
<p align="center"><img src="docs/media/charts/performance.svg" width="880" alt="Frame time per view on the RTX 3050 laptop at Ultra quality and 1920 by 1080: median GPU time per frame for every view of the golden journey, against the 16.7 ms budget for 60 frames per second."></p>
<!-- /media:performance -->

The work that would stall a frame is moved off it. Shaders, including those of off-screen passes, link in the background before they are first needed; SGP4 propagation, the 76,000-row asteroid orbit table and the Andromeda star cloud are built in web workers; textures ship as KTX2 alongside the original images; label layout is read after the frame instead of inside it. In the production build at 1920×1080 on Ultra, the worst frame of the flight to Andromeda fell from 204–265 ms to 108 ms, and a 643 ms first-use stall in the sky bake was removed. `node tools/perf-profile.mjs` reports GPU and CPU frame times per view, and with `--cpuprofile` names the call path behind each long task.

## Offline

Cosmos makes no request to an outside server. All 76 datasets, the textures (8K maps with KTX2 copies), the four bundled typefaces and the KTX2 transcoder are inside the project, and the built `dist/` folder is about 1.1 GB. Binary data files are served with a `.cbin` extension so download managers such as IDM do not intercept them. The claim is tested: with `COSMOS_E2E_OFFLINE=1` the end-to-end check blocks every non-local request while it visits every planet, moon, lab, tour, deep-space region and light band.

To refresh the data, run the scripts in `scripts/data/` while online, then `npm run data:manifest`, and rebuild.

## Architecture

```mermaid
flowchart LR
  subgraph pipeline["Offline data pipeline: scripts/data"]
    A["Official archives and APIs<br/>JPL, CelesTrak, NASA Exoplanet Archive,<br/>ESA, CDS, DESI, USGS, NOAA"] --> B["fetch, validate, normalise"]
    B --> C[("public/data<br/>76 versioned snapshots<br/>+ manifest.json")]
  end
  subgraph app["Browser app"]
    C --> D["Loaders and provenance"]
    W["Web workers<br/>SGP4, belt orbits, star clouds"] --> E
    D --> E["Domains, auto-discovered<br/>earth, solar, moons, small bodies, orbital,<br/>outer, stars, sky, exoplanets, galaxy,<br/>black holes, galaxies, cosmology"]
    E --> F["Engine<br/>float64 ICRS world, camera-relative render,<br/>log depth, LOD ladder, HDR and AgX"]
    F --> G(["WebGL 2 canvas"])
    H["React 19 interface<br/>inspector, labs, tours, ruler, search"] -->|"AppCommands"| S["zustand store"]
    S --> F
    S --> H
  end
```

- **One world frame.** Positions are float64 metres on the ICRS/J2000 axes. Each frame is rebased on the camera before anything reaches 32-bit GPU memory, and a logarithmic depth buffer covers the whole range in one pass.
- **Domains.** Each part of the universe is a folder under `src/domains/` with a `domain.ts`; the app finds it automatically. Every object has an id such as `sol:earth`, `sb:bennu`, `sc:iss` or `star:hip:32349`, and a fact sheet with provenance.
- **One way to change state.** The React interface and the tours change the scene only through `AppCommands` on a framework-free zustand store, and React never touches per-frame data.
- **Lighting by scale.** Physically lit bodies with Rayleigh and Mie atmospheres near the Sun; point-spread stars with magnitudes recomputed for the camera position; additive volumes for the Galaxy and the cosmic web; HDR output tone-mapped with AgX.

Engineering notes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Interface system: [docs/design/UI_SYSTEM.md](docs/design/UI_SYSTEM.md).

## Run it yourself

Requirements: Node.js 22 or newer and a browser with WebGL 2. Chrome or Edge on a discrete GPU is recommended.

```bash
npm install
npm run dev              # development server at http://localhost:5173
npm run build            # production build into dist/
npm run preview          # serve dist/ at http://localhost:4173
```

| URL flag | Effect |
| --- | --- |
| `?exhibition=1` | Start in exhibition mode (larger type and touch targets), overriding the saved preference |
| `?ktx2=0` | Turn off the compressed KTX2 texture path and load the original images, for comparisons and debugging |

<details>
<summary>Keyboard and mouse</summary>

Keys are ignored while you type in a text field. Press `?` in the app for the same list.

| Travel | |
| --- | --- |
| `B` | Solar System navigator |
| `0` | The Sun |
| `1` to `8` | Mercury to Neptune (`9` is Pluto) |
| `[` and `]` | Previous or next moon of the current planet |
| `Shift+[` and `Shift+]` | Previous or next planet |
| `H` | Home to Earth |
| `Backspace` | Go back |
| `F` | Follow the selected object |

| Explore and view | |
| --- | --- |
| `Ctrl+K` or `/` | Search planets, moons, satellites, stars, exoplanets, black holes, galaxies and structures |
| `Esc` | Close the top-most panel, then the lab, then clear the selection |
| `L`, `O`, `C` | Labels, orbits, constellations |
| `Shift+H` | Hide or show the whole interface |
| `?` | Help |
| `` ` `` | Frame-rate and memory readout |

| Time and scale | |
| --- | --- |
| `Space` | Play or pause |
| `,` and `.` | Slower or faster, from 1 second per second up to 10 million, forward or backward |
| `N` | Jump to now |
| `Up` and `Down` | Step the Cosmic Ruler one decade of scale, when it has focus |

| Tour | |
| --- | --- |
| `T` | Start or exit the golden journey |
| `Left` and `Right` | Previous or next chapter |
| `R` | Return to the chapter's view |

| Camera | |
| --- | --- |
| `W` `A` `S` `D` `Q` `E`, arrows, `+` and `-` | Move and zoom; hold `Shift` to go faster |
| Drag, scroll or pinch | Orbit, zoom across scales |
| Right-drag or two-finger drag | Pan |
| Click, double-click | Select, fly to |

In the planetary cutaway: `T` material or temperature, `C` compare, `+` and `-` zoom, `Left` and `Right` turn, `Up` and `Down` step through the layers.

The shipped key map lives in [src/ui/shell/shortcuts.ts](src/ui/shell/shortcuts.ts) and [src/ui/navigator/keys.ts](src/ui/navigator/keys.ts); camera keys in [src/core/camera/controls.ts](src/core/camera/controls.ts).

</details>

<details>
<summary>Scripts and checks</summary>

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | 715 unit tests in 70 files (Vitest), covering science, frames, scale, loaders, labs and interiors |
| `npm run test:e2e` | End-to-end health check against a running server (Playwright) |
| `npm run shot -- <url> <out.png>` | Headless screenshot of the running app |
| `npm run data:manifest` | Rebuild `public/data/manifest.json` from the `manifest.part.json` files |
| `node scripts/data/build-sources-doc.mjs` | Regenerate `docs/DATA_SOURCES.md` from the manifest |
| `node tools/perf-profile.mjs` | Per-view GPU and CPU frame-time profile of the running app |

`COSMOS_E2E_FULL=1` makes the end-to-end check visit every planet, moon, lab, tour, deep-space region and light band; `COSMOS_E2E_OFFLINE=1` blocks every non-local request; `COSMOS_URL=http://localhost:4173/` points it at the production preview.

</details>

## Project structure

```text
src/
  main.tsx          entry point
  app/              wiring: createCosmos, commands, tours
  core/             engine, camera, frames, time, labels, picking, textures, post-processing, visual scale
  render/           shared shaders and materials: stars, atmospheres, rings, orbit lines, exposure
  domains/          one folder per part of the universe, auto-discovered:
                    earth, solar, moons, smallbodies, orbital, outer, features, stars, sky,
                    exoplanets, galaxy (Milky Way), blackholes, galaxies, cosmology
  labs/             debris, defense, habitability and relativity (black hole) labs
  science/          physics and astronomy functions, each with unit tests
  data/             loading, provenance, manifest
  state/            the zustand store
  ui/               React interface: shell, navigator, inspector, labs, interiors, ruler, cursor
  content/tours/    tour chapters and narration
public/
  data/             versioned snapshots of every dataset, with manifest.json
  textures/         planet, moon and Earth maps, with KTX2 copies
scripts/data/       reproducible data and texture build scripts
tests/e2e/          end-to-end health and offline check
tools/              screenshot and performance tools
sandbox/            single-domain test pages for development
docs/               science, architecture, exhibition, data and design notes
```

## Documents

| Document | What it holds |
| --- | --- |
| [docs/EXHIBITION.md](docs/EXHIBITION.md) | Pitch, stand set-up, three-minute demo script, judge questions |
| [docs/USER_GUIDE.md](docs/USER_GUIDE.md) | Controls, panels, labs and tours |
| [docs/SCIENCE.md](docs/SCIENCE.md) | Method, data, accuracy and limits for every feature |
| [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) | All 76 datasets with version, retrieval date, licence and citation |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Frames, rendering, scale, time, provenance, performance |
| [docs/data/](docs/data/) | Per-domain data notes: solar, orbital, stars, sky, exoplanets, galactic, galaxies, black holes, interiors, textures |

## Posters and presentation

<!-- media:exhibition -->
The stand has its own printed matter, built from the same renders and the same numbers as the app.

- **Posters** ([docs/exhibition/posters/](docs/exhibition/posters/)): three A2 posters, [The whole universe, to scale, explorable](docs/exhibition/posters/pdf/cosmos-poster-1-hero-A2.pdf), [How do we know?](docs/exhibition/posters/pdf/cosmos-poster-2-how-do-we-know-A2.pdf), [Explore it](docs/exhibition/posters/pdf/cosmos-poster-3-explore-it-A2.pdf), as print PDFs with and without bleed, rebuilt with `node docs/exhibition/posters/build.mjs`.
- **Presentation** ([docs/exhibition/presentation/](docs/exhibition/presentation/)): the deck for judges, 15 slides at 1920 × 1080 that run in the browser from [deck/index.html](docs/exhibition/presentation/deck/index.html), exported as [PDF](docs/exhibition/presentation/export/Cosmos-SCI-FORGE-2026.pdf) and [PowerPoint](docs/exhibition/presentation/export/Cosmos-SCI-FORGE-2026.pptx); [facts.md](docs/exhibition/presentation/facts.md) traces every figure on the slides to a file in this repository.

<p align="center"><img src="docs/exhibition/posters/preview/cosmos-poster-1-hero.png" width="280" alt="Cosmos poster 1: The whole universe, to scale, explorable">&nbsp;<img src="docs/exhibition/posters/preview/cosmos-poster-2-how-do-we-know.png" width="280" alt="Cosmos poster 2: How do we know?">&nbsp;<img src="docs/exhibition/posters/preview/cosmos-poster-3-explore-it.png" width="280" alt="Cosmos poster 3: Explore it"></p>
<p align="center"><img src="docs/exhibition/presentation/export/slides/01.png" width="860" alt="The title slide of the Cosmos presentation."></p>
<!-- /media:exhibition -->

## Credits

Built by **Dhruvin Sarkar** ([@dhruvin-sarkar](https://github.com/dhruvin-sarkar)) for **SCI-FORGE 2026**.

Data and imagery from NASA (JPL SSD, CNEOS, Horizons, NAIF, NSSDCA, GSFC SVS, SDO, DONKI, EOSDIS, the Exoplanet Archive, LAMBDA, Solar System Treks), ESA (Gaia, Planck, Rosetta), JAXA (Hayabusa2), USGS Astrogeology, NOAA (NCEI, SWPC), CelesTrak and USSPACECOM, the IAU, CDS Strasbourg (SIMBAD, VizieR, HiPS), DESI, the 2MASS Redshift Survey, the Event Horizon Telescope, the GRAVITY Collaboration, the HYG Database, Stellarium and Solar System Scope. Textures: Solar System Scope (CC BY 4.0); NASA/GSFC/SVS, LRO, LOLA, MOLA and MESSENGER data (public domain).

Software: [three.js](https://threejs.org), [React](https://react.dev), [zustand](https://github.com/pmndrs/zustand), [astronomy-engine](https://github.com/cosinekitty/astronomy) (MIT), [satellite.js](https://github.com/shashwatak/satellite-js), [KaTeX](https://katex.org), [lucide](https://lucide.dev), [Vite](https://vite.dev), [Vitest](https://vitest.dev) and [Playwright](https://playwright.dev). The lock-on cursor is ported from [React Bits](https://reactbits.dev) `<TargetCursor />` by David Haz (MIT with Commons Clause). Typefaces: Inter, Mona Sans, Bodoni Moda and JetBrains Mono, bundled under their open licences.

### Citing this work

If you use Cosmos in teaching or a project, please cite the repository, and cite the data providers above for any values you take from it.

```bibtex
@software{sarkar_cosmos_2026,
  author = {Sarkar, Dhruvin},
  title  = {Cosmos: a continuous-scale 3D universe explorer with provenance on every value},
  year   = {2026},
  url    = {https://github.com/dhruvin-sarkar/Cosmos},
  note   = {Built for the SCI-FORGE 2026 student science exhibition}
}
```

## Licence

The code is released under the [Apache License 2.0](LICENSE). Data, textures and images keep the licences of their providers, listed above and in the Sources panel; Gaia and Planck data are for non-commercial use, and HYG and Stellarium derivatives are share-alike.
