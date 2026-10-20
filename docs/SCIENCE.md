# Cosmos: science notes

For each feature: the method, the data and its licence, the accuracy, and what is not modelled. The in-app **Sources** panel lists every dataset with version, retrieval date, licence, citation and limitations (full text in [DATA_SOURCES.md](DATA_SOURCES.md), per-domain notes in `docs/data/`). The snapshot date is 2026-10-17 to 2026-10-19; Cosmos does not change the data while running.

**Provenance marks** used on every fact sheet:

| Mark | Meaning |
| --- | --- |
| Observed | A measured value from a cited source |
| Derived | Computed from observed values with a stated model |
| Reconstructed | Inferred from data (for example a fitted shape) |
| Illustrative | Drawn for clarity; not measured |

A missing value is "Unknown", never 0.

## 1. Time and coordinates

- **Method.** Positions are in the ICRS/J2000 equatorial axes, in metres, with float64 numbers. The camera works in coordinates relative to itself, which avoids the loss of precision that large coordinates cause in 32-bit graphics hardware. Simulation time is UTC internally converted to TT/TDB where the ephemeris needs it.
- **Limits.** Time can run from real time to 10 million times faster, forward or backward. Far from today the ephemerides lose accuracy (section 2).

## 2. Planets, Sun, Moon

- **Method.** The Sun, planets and Moon are positioned with **astronomy-engine** (VSOP87 for the planets, a truncated ELP/MPP02 series for the Moon, IAU rotation models). Pluto uses astronomy-engine's Pluto integrator; the other dwarf planets use catalogue elements.
- **Data.** Physical parameters (radius, mass, density, gravity, albedo, rotation) are from the NASA NSSDCA planetary fact sheets, JPL SSD, and NAIF `pck00011.tpc` (IAU 2015 rotation elements and radii) and `gm_de440.tpc`. Standish approximate elements (JPL SSD) are the fallback. Licences: public domain (NASA, JPL); the astronomy-engine library is MIT.
- **Accuracy.** astronomy-engine states positions agree with JPL data to about an arcminute or better for the planets over several centuries around today, and the Moon is similar. That is far smaller than anything visible on screen. Standish elements are only arcminute-level.
- **Limits.** Dwarf-planet orbits other than Pluto are two-body and degrade over decades. Unknown rotation phases are marked. The science audit of 2026-10 corrected Pluto, Eris, Haumea and Makemake values to published sources (for example Eris radius 1163 km from the 2010 occultation, Haumea's triaxial shape from the 2017 occultation).

## 3. Exhibition scale versus true scale

- **Method.** Default "Exhibition scale" draws each body at a larger size so it is visible from far away. The drawn diameter is a smooth maximum of the true apparent diameter and a target of about 1.6% of the screen height multiplied by the square root of the body's radius relative to Earth's. The enlargement fades to exactly 1 within 40 radii and is fully on beyond 160. The Sun is capped so that its drawn radius never exceeds 0.3 of Mercury's perihelion distance. Moons, rings and artificial satellites are moved outward with their parent: a' = f·min(a,c) + max(a−c,0)·√f, where f is the parent's factor, a the true distance and c the parent's core (radius or outer ring edge). Satellite sizes are capped so they never touch the enlarged parent. Full laws: [design/VISUAL_SCALE.md](design/VISUAL_SCALE.md).
- **What is exact.** Heliocentric distances, angles, phases, eclipses at true scale, and orbital periods.
- **What is not.** Apparent sizes and the gap between a moon and its planet are exaggerated in Exhibition scale. The top bar always says so; "True scale" removes the exaggeration. At 4 AU in the inner-system overview, Earth is drawn about 448 times its true size (measured, VISUAL_SCALE.md).

## 4. Planet and moon surfaces

- **Method.** Surfaces are textured spheres lit by one light, the Sun. Rocky airless bodies use a lunar-Lambert style reflectance with relief from normal maps; gas giants have limb darkening; Earth, Venus, Titan and Mars have atmospheres computed from Rayleigh and Mie scattering. Night sides are black except for city lights, earthshine and planetshine. Output is linear light mapped to the screen with AgX tone mapping.
- **Data.**
  - Earth: NASA Black Marble 2016 (VIIRS, night lights); NASA Blue Marble Next Generation (day colour); Solar System Scope cloud map; NOAA ETOPO 2022 (elevation). Public domain except Solar System Scope (CC BY 4.0).
  - Moon: NASA SVS CGI Moon Kit (LRO LROC WAC colour) and LOLA elevation. Public domain.
  - Mercury: Solar System Scope colour (CC BY 4.0), USGS MESSENGER global DEM (public domain).
  - Mars: Solar System Scope colour (CC BY 4.0), MGS MOLA elevation (public domain).
  - Venus, Jupiter, Saturn, Uranus, Neptune: Solar System Scope (CC BY 4.0), made from spacecraft imagery.
  - Ceres: NASA Solar System Treks Dawn FC mosaic. Pluto, Charon and icy moons: USGS Astrogeology and NASA mosaics.
  - Required credit: "Textures: Solar System Scope (CC BY 4.0); NASA/GSFC/SVS, LRO, LOLA, MOLA, MESSENGER data (public domain)".
- **Albedo calibration.** Rocky-body maps are scaled so that their average linear brightness matches a published albedo (Moon 0.12, Mercury 0.11, Mars 0.18) (docs/data/textures-hd.md).
- **Limits and illustrative elements.**
  - Venus' visible surface is hidden under cloud; the radar-derived surface map is illustrative.
  - Gas-giant, Uranus and Neptune textures are published visual composites; their colours were matched to true-colour imagery by eye, not from calibrated photometry.
  - Fine surface detail seen very close up is procedurally generated and not real terrain. It only adds sharpness beyond the texture resolution.
  - Cloud motion on Jupiter, Saturn, Uranus, Neptune and Venus follows published zonal wind profiles over a fixed map; it shows how the winds behave, not today's storms.
  - Earth's clouds drift at average zonal winds; they are a fixed map, not live weather.
  - Relief on the Moon, Mercury and Mars is exaggerated (2.5, 3 and 4 times) to be visible.

## 5. Earth's aurora and space weather

- **Method.** Auroral ovals around both magnetic poles, on the night side only, are placed in the 85 to 400 km layer. Their latitude and strength depend on the geomagnetic Kp index. Kp is reconstructed from the NASA DONKI list of geomagnetic storms (2024-10 to 2026-10); between storms it is set to quiet Kp 2.
- **Data.** NASA DONKI (public domain), NOAA SWPC solar-cycle indices (public domain).
- **Limits.** Illustrative: the shape and curtain motion are drawn, not computed. The fact sheet says "illustrative, driven by observed Kp".

## 6. The Sun

- **Method.** A physically lit photosphere with limb darkening (Allen's table, by wavelength), differential rotation (Snodgrass and Ulrich), corona brightness profile (Baumbach), and animated granulation. Real sunspots, and the corona and prominences, come from the latest SDO images (HMI continuum; AIA 304, 171 and 193 Å) when seen from near Earth's direction.
- **Data.** SDO images from NASA (public domain; credit NASA/SDO and the instrument teams).
- **Limits.** Granulation is procedural. Seen from other directions, spots are procedural, not the far side of the Sun. SDO images are a snapshot, not live.

## 7. Moons

- **Method.** The four Galilean moons use astronomy-engine's JupiterMoons model (L1.2 theory, about an arcminute). All other moons use JPL SSD mean elements, with the mean longitude advancing at the sidereal rate and the periapsis and node precessing at the tabulated rates. The displayed period is the true sidereal period. Rotation follows IAU rotation models where one exists and tidal locking otherwise.
- **Data.** JPL SSD planetary satellite elements, physical parameters and discovery circumstances (NASA/JPL, public domain). The Phobos shape is the Gaskell stereophotoclinometry model from the NASA PDS, built by `scripts/data/moons/build-phobos-shape.mjs`.
- **Accuracy.** The code states that mean elements give plausible positions and good orbit lines, not precise positions; they include no perturbations from other moons.
- **Illustrative elements.** Enceladus' tiger-stripe jets, Io's volcanic plumes at Pele, Prometheus, Loki and Tvashtar (placed at catalogued coordinates), Titan's detached haze layer, and the irregular shapes of moons without a survey. Hyperion, Nix and Hydra tumble in a drawn, not computed, way. Himalia and Nereid spin at a steady illustrative rate. Each fact sheet states which parts are illustrative.

## 8. Saturn's rings

- **Method.** A radial strip texture, with the Cassini division, translucency that depends on the lit or unlit side, forward scattering, the planet's shadow on the rings and the rings' shadow on the planet.
- **Data.** Solar System Scope ring strip (CC BY 4.0). Ring dimensions used for scale (Saturn 136,775 km, Uranus epsilon ring 51,149 km, Neptune Adams ring 62,930 km) are from the visual-scale design notes.
- **Limits.** The ring strip is a single radial profile spun around the planet; there are no waves, spokes or particle sizes.

## 9. Surface features

- **Data.** Feature names and positions from the IAU Gazetteer of Planetary Nomenclature (USGS Astrogeology, public domain); landing sites from LROC coordinates (Wagner et al. 2017, Icarus 283). Planetocentric latitude, east-positive longitude.
- **Limits.** Gazetteer positions are centre points, not outlines.

## 10. Asteroids, comets, near-Earth objects

- **Method.** Each asteroid is a Keplerian ellipse evaluated on the GPU (Kepler's equation solved per vertex). Named bodies use full-precision elements and show a lit shape mesh; comets have an anti-sunward ion tail and a curved dust tail.
- **Data.** JPL Small-Body Database (SBDB) for numbered asteroids with H < 15 (75,855 drawn) and near-Earth objects (3,449); CNEOS close-approach data and Sentry risk table; real shape models and IAU spin states for famous bodies, built from mission shape models by `scripts/data/smallbodies/` (see `public/data/smallbodies/shapes/index.json` for each model's source); bodies without a model use a procedural shape marked illustrative. Public domain (NASA/JPL) for the orbit data.
- **Accuracy.** NEO elements in `neos.json` are rounded to 4 or 5 significant figures by the SBDB query API. They are fine for display and for about one year of propagation, but not for impact-probability work. Close-approach distances are the nominal CNEOS values with 3-sigma bounds. A NEO diameter estimated from the absolute magnitude H uses a fixed albedo of 0.14, so it can be wrong by a factor of about 2.
- **Limits.** Asteroids are drawn as points unless named. Two-body orbits ignore planetary perturbations; comet non-gravitational forces are not modelled. Comet tails are illustrative in length and shape.

## 11. Spacecraft

- **Method.** Positions are cubic Hermite interpolation of JPL Horizons position tracks for 2025 to 2030 (Voyager 1 and 2, New Horizons, Parker Solar Probe, Juno, Europa Clipper, Psyche, Lucy, Hera, JUICE, BepiColombo, JWST).
- **Data.** JPL Horizons (public NASA/JPL service; no licence stated, acknowledged in Sources).
- **Limits.** Coverage ends early for some craft (Parker to 2029-12-30, Juno to 2028-08-31, Psyche to 2029-02-09, Hera to 2026-11-02, BepiColombo to 2027-04-09) and positions are never extrapolated. Spacecraft models are stylised: the position is real, the shape is illustrative. Marked "Illustrative model, real position".

## 12. Satellites and orbital debris

- **Method.** About 31,800 objects are propagated with **SGP4/SDP4** (satellite.js 7) from CelesTrak mean elements, in a background worker. The ISS, Tiangong and Hubble are drawn at their propagated position with a stylised model. Altitudes in statistics are above a spherical Earth of radius 6378.135 km (the SGP4 constant).
- **Data.** CelesTrak GP element sets (OMM CSV) and SATCAT, retrieved 2026-10-16 to 2026-10-17. CelesTrak states no formal licence and makes the data freely available; Cosmos credits CelesTrak. Mean element sets are TEME mean elements, not osculating Keplerian ones.
- **Accuracy.** SGP4 error is of the order of a kilometre at epoch and grows by about 1 to 3 km per day. The median element age is 1.1 days; 703 objects were older than 7 days at retrieval. Of 31,839 objects with elements, 31,836 propagate at the reference time; 3 (low-perigee, decaying) fail. 3,481 catalogue objects have only SATCAT apogee and perigee and 332 have no orbit data, so the drawn population is not the whole catalogue.
- **Limits.** The catalogue lists only objects large enough to be tracked (about 10 cm in low Earth orbit). ESA estimates about 1.5 million objects of 1 to 10 cm and 230 million of 1 mm to 1 cm (MASTER-8, 02/2026) that are not shown. Debris and dots are rendered as points; they are not to scale. Starlink and other groups are drawn from the same catalogue.
- **Catalogue numbers.** CelesTrak announced that 5-digit catalogue numbers ran out on 2026-07-11. Cosmos stores NORAD ids as strings and handles 6-digit numbers.

## 13. Orbital debris lab

- **Method.** A simplified population model (in `src/labs/debris/model.ts`) in 50 km altitude shells. Shell densities come from the real catalogue; objects are added by launches, lost to atmospheric drag (depends on solar activity), removed by active debris removal, and multiplied by collisions at a rate proportional to density squared. Five policy scenarios (for example business as usual, and no further launches). The breakup view spreads fragments in the orbits of the Iridium 33 and Cosmos 2251 collision (2009) or the Fengyun-1C test (2007).
- **Output.** For example: business as usual reaches about 583,000 objects and 140 collisions a year by 2126; no more launches reduces the count to about 25,000 (−15%).
- **Limits.** This is a teaching model, not a forecast. It has no fragment-size spectrum, uses average drag, treats each shell independently and ignores the satellite manoeuvres that avoid collisions. Results change by large factors with the assumptions, which the lab shows as inputs.

## 14. Asteroid deflection lab

- **DART replay.** Impact on 26 September 2022 at 23:14:24 UTC using the Didymos and Dimorphos shape models. The orbit change uses the first-order relation ΔP ≈ 3PΔv/v, which gives −33.3 minutes against the measured −33.0 ± 1.0 minutes (Thomas et al. 2023, Nature). A full point-mass orbit calculation gives −31.8 minutes, just outside the measured range; the lab shows both and explains why. Facts: Daly et al. 2023; Cheng et al. 2023; Thomas et al. 2023 (Nature).
- **Defend Earth.** A hypothetical asteroid. The kinetic impactor changes the asteroid's velocity by Δv = β·m·v/M (β is the momentum enhancement factor). The lab computes the shift of the B-plane miss distance after the warning time and compares it with Earth's capture radius of 8,710 km, which includes gravitational focusing. A Monte Carlo run over uncertain β, mass and timing gives a success probability.
- **Limits.** Pure two-body motion, a spherical rigid target, no fragmentation or rotation. The scenario is fictional and is labelled that way. The real impact-risk table (Sentry) is not used for the scenario.

## 15. Outer Solar System

- **Kuiper belt.** 7,301 trans-Neptunian objects from JPL SBDB, propagated on the GPU. Class (classical, resonant, scattered, and so on) is a rule-based box in semimajor axis, eccentricity and inclination, marked as derived.
- **Heliosphere.** Termination shock and heliopause shells are fitted to the four Voyager crossings: shock at 94.0 au (Voyager 1) and 83.7 au (Voyager 2), heliopause at 121.6 au (Voyager 1) and 119 au (Voyager 2). The fitted shells pass within 1.5% of all four. The shape away from the Voyager directions is **reconstructed**, not measured.
- **Oort cloud.** 48,000 seeded random points between 2,000 and 100,000 au. It is **hypothesised and illustrative**: no Oort cloud object has been imaged.
- **Scale rings.** Light-hour, light-day and light-year rings.

## 16. Stars and constellations

- **Method.** 109,389 stars from the HYG v4.4 3D catalogue. Apparent magnitude is recomputed for the camera position from the star's absolute magnitude and distance. Colour is a softened blackbody from the colour index. The nearest stars draw as a lit photosphere with radius derived from L and Teff. Beyond about 300 AU the Sun is drawn as a star. The limiting magnitude rises as you leave the Solar System.
- **Data.** HYG v4.4 (CC BY-SA 4.0, derived from Hipparcos, Yale Bright Star and Gliese); Gaia Catalogue of Nearby Stars (GCNS, Gaia EDR3, within 100 pc; CC BY-NC 3.0 IGO); IAU Catalog of Star Names (WGSN); constellation lines from Stellarium modern_iau (CC BY-SA 4.0) and boundaries from VizieR VI/49.
- **Limits.** Distances come from parallaxes with statistical errors; stars with poor or missing parallax can be misplaced. Stars beyond a few hundred parsecs are not complete. Binary and variable stars are drawn as single constant points.

## 17. All-sky maps in other wavelengths

- **Method.** Survey images resampled to an all-sky sphere in Galactic and equatorial frames. Each band shows its own caption: survey, instrument, what it reveals, and caveats.
- **Data (14 bands).** Visible (Gaia DR3 flux map; CC BY-NC 3.0 IGO), near-infrared (2MASS), mid-infrared (unWISE), far-infrared (AKARI), submillimetre, microwave and the CMB (Planck PR3; CC BY-NC 3.0 IGO), radio at 408 MHz (Haslam, Remazeilles), neutral hydrogen (HI4PI), hydrogen-alpha (Finkbeiner 2003), ultraviolet (GALEX), X-ray (ROSAT and eROSITA-DE DR1), gamma ray (Fermi LAT).
- **Limits.** Colours in non-visible bands are false colour. The eROSITA map covers half the sky. Maps are down-sampled for the browser. The CMB map is the SMICA foreground-cleaned temperature map; as a band it is a sky texture, and in the cosmology view it is also drawn as the 3D last-scattering sphere (section 20).

## 18. Exoplanets

- **Data.** NASA Exoplanet Archive `pscomppars` snapshot of 2026-10-16: 6,451 confirmed planets around 4,847 host stars. Host stars are placed from their catalogue right ascension, declination and distance. Showcase systems (TRAPPIST-1, Proxima Centauri, Kepler-16, HR 8799 and others) draw planet orbits from the archive elements.
- **Limits.** Planet surfaces and colours are illustrative: no exoplanet has been imaged as a resolved disc. Missing elements are shown as "Unknown". The habitability lab is a simple energy-balance teaching model.

## 19. The Milky Way, Sagittarius A* and black holes

- **Milky Way.** A reconstruction, not a photograph: nobody has seen our Galaxy from outside. Distance to the centre R0 = 8,275.9 pc and Sgr A* mass 4.30 million solar masses (GRAVITY Collaboration 2024); spiral arms from Reid et al. 2019; bar from Wegg et al. 2015 and Portail et al. 2017; discs from Bland-Hawthorn and Gerhard 2016; dust from Drimmel and Spergel 2001. 157 globular clusters and 28 landmark objects are placed from their catalogue positions.
- **S-stars.** Kepler orbits from Gillessen et al. 2017, with S2 from the GRAVITY 2020 fit.
- **Black holes.** 13 objects with masses and distances from the cited papers (`public/data/blackholes/blackholes.json`). Lensing, accretion disks and jets are drawn from these parameters but their appearance is illustrative; the M87* image shown is the Event Horizon Telescope 2019 observation.

## 20. Galaxies, the cosmic web and the CMB

- **Nearby galaxies.** 869 galaxies of the Local Volume (Karachentsev, Makarov and Kaisina 2013) plus famous galaxies and structures (Local Group, Virgo, Laniakea) with per-object references.
- **Cosmic web.** 2MRS (Huchra et al. 2012; 43,508 galaxies) and DESI DR1 (1.8 million bright galaxies and 400,000 luminous red galaxies, random subsamples). Distances are comoving distances from redshift in flat ΛCDM with Planck 2018 parameters, so positions are in redshift space (clusters look stretched along the line of sight). The empty wedge behind the Milky Way's disc is the Zone of Avoidance, where surveys cannot see.
- **CMB.** The Planck PR3 SMICA temperature map, shown on a sphere at the comoving distance of last scattering.

## Citations

- Standish, E. M. and Williams, J. G., *Orbital Ephemerides of the Sun, Moon, and Planets* (Explanatory Supplement to the Astronomical Almanac), and JPL SSD "Approximate Positions of the Planets".
- Bretagnon, P. and Francou, G. 1988, A&A 202, 309 (VSOP87). Chapront-Touzé, M. and Chapront, J. (ELP/MPP02).
- Vallado, D. A., Crawford, P., Hujsak, R. and Kelso, T. S. 2006, *Revisiting Spacetrack Report #3*, AIAA 2006-6753 (SGP4).
- Archinal, B. A. et al. 2018, Celest. Mech. Dyn. Astron. 130, 22 (IAU WGCCRE report on rotation elements and radii).
- Thomas, C. A. et al. 2023, Nature 616, 448 (change of Dimorphos's orbit); Daly, R. T. et al. 2023, Nature 616, 443; Cheng, A. F. et al. 2023, Nature 616, 457.
- Sicardy, B. et al. 2011, Nature 478, 493 (Eris); Ortiz, J. L. et al. 2017, Nature 550, 219 (Haumea).
- Wagner, R. V. et al. 2017, Icarus 283, 92 (LROC coordinates of landing sites).
- Gaia Collaboration 2021, A&A 649, A1 (Gaia EDR3); Planck Collaboration 2020, A&A 641, A1.
- Stone, E. C. et al. 2013, Science 341, 150, and Stone et al. 2019, Nature Astronomy 3, 1013 (Voyager boundary crossings).
- ESA Space Debris Office, *ESA's Space Environment Report* and DISCOS statistics (MASTER-8 reference population).

Citation details for each dataset are in the Sources panel; verify any page numbers there before quoting them in a report.
