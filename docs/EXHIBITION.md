# Cosmos at SCI-FORGE 2026

## The pitch

Space is hard to picture because it covers too many scales. A satellite is metres across; Neptune is 4.5 billion kilometres away. Textbook diagrams give up and squash both onto one page.

Cosmos lets a visitor fly through those scales in one continuous move, with no cuts, in a browser. The positions are real: planets, moons, asteroids, spacecraft and about 31,800 satellites and pieces of debris are placed where they are today, from public NASA, JPL and CelesTrak data. Every number can be traced: click an object and each value carries a mark saying whether it was observed, derived, reconstructed or illustrative, with its source.

Two labs turn the picture into experiments:

- **Orbital debris lab**: how crowded low Earth orbit is, and how launch and removal policies change the next 100 years.
- **Asteroid deflection lab**: replay NASA's DART impact, then try to deflect a hypothetical asteroid.

Honesty about scale is part of the design. By default the planets are drawn larger than life so you can see them, and a label in the top bar says "Enlarged for visibility". One click switches to true scale.

## What is in the build

The Solar System journey is complete and tested. Exoplanet, Milky Way, galaxy and cosmic-web datasets are prepared in `public/data/` but not drawn yet, so the stand does not claim to visit them. Current content: Earth and the Moon, the Sun, 8 planets, 5 dwarf planets and their moons, 75,855 asteroids, 3,449 near-Earth objects, 12 spacecraft, 7,301 trans-Neptunian objects, the heliosphere, 109,389 stars, 88 constellations and 14 all-sky maps from radio to gamma rays.

## The journey

Planned golden route: Earth, orbital debris, the Solar System, asteroid deflection, nearby stars, exoplanets, the Milky Way, Sagittarius A*, galaxies, the cosmic web, the cosmic microwave background.

Status in this build:

| Stage | Status |
| --- | --- |
| Earth, ISS, orbital debris | Done, with the debris lab |
| Solar System, planets, moons | Done |
| Asteroid deflection | Done: DART replay and Defend Earth |
| Outer Solar System, Voyager 1 | Done |
| Nearby stars (star field, nearest stars) | Star field and constellations done; no guided chapter yet |
| Exoplanets, Milky Way, Sgr A*, galaxies, cosmic web | Data only, not yet drawn |
| CMB | Shown as an all-sky band (Light menu), not as a separate chapter |

The built-in tours cover the done parts: the 20-chapter **golden journey** tour (Earth to Voyager 1) and a 6-chapter **quick tour**.

## How the stand runs

**Hardware.** A laptop with an RTX 3050 (4 GB video memory) and 16 GB RAM, running `npm run preview` on the built app, in full-screen Chrome or Edge. Target: 60 frames per second on the Balanced preset.

**Set-up (before doors open).**
1. `npm install` once, then `npm run build`.
2. `npm run preview`, open `http://localhost:4173` in a full-screen browser window.
3. Open Settings: turn on **Exhibition mode** (larger type and touch targets) and check graphics quality (Auto is fine).
4. Press `N` to set the time to now. Press `Space` if time is paused.
5. Press `T` once to confirm the tour starts, then `T` again to exit.

**Visitor flow.**
1. Visitors start at Earth. The presenter shows drag (rotate), scroll (zoom) and click (select); `?` opens the Help panel.
2. Visitors free-explore, or press **Tour** for a guided flight. Arrow keys move between chapters.
3. In the inspector, a button opens a lab for related objects (satellites for the debris lab; Didymos, Dimorphos, Apophis or 2024 YR4 for the deflection lab).
4. `H` returns home to Earth, so the next visitor starts fresh. `Esc` closes whatever is open.

**Presenter shortcuts.** `T` tour, `Left`/`Right` chapters, `B` navigator, `1` to `8` planets, `[` and `]` moons, `Ctrl+K` search, `Shift+H` hide the interface for a clean screen, `?` help. The full list is in [USER_GUIDE.md](USER_GUIDE.md).

**If something goes wrong.** Reload the page (the whole app starts in seconds, all data local). If frame rate drops, Settings, Graphics quality, Performance. The backtick key shows a frame-rate readout.

## Offline operation

Cosmos does not need the internet at the stand.
- Every dataset is a versioned snapshot in `public/data/` (130 MB), listed in `public/data/manifest.json` with retrieval date, licence and citation (70 datasets).
- Textures are in `public/textures/` (227 MB). Fonts are installed from npm packages and bundled.
- The app source code makes no calls to outside servers.
- Because the data are snapshots, the satellite positions are propagated from the elements retrieved on 2026-10-16 to 2026-10-17. Satellite accuracy declines by a few kilometres per day away from those epochs (see [SCIENCE.md](SCIENCE.md) section 12). The planets and moons come from formulas and are good for any date near today.
- To refresh the data, run the scripts in `scripts/data/` while online, then `npm run data:manifest`, and rebuild. Do this at home, never at the stand.

## Sustainable Development Goals

**SDG 4, Quality Education.** Astronomy, orbital mechanics and data science are normally taught from static images and formulas. Cosmos lets students see an orbit, change a variable and watch the result. Every fact shows where it comes from, which teaches students to ask "how do we know?". The tours carry narration with sources. It runs in a browser and needs no account, so a school can run it from one laptop.

**SDG 17, Partnerships for the Goals.** Everything in Cosmos exists because institutions share data openly: NASA and JPL (ephemerides, small bodies, spacecraft, textures, solar images), ESA (Gaia, Planck), USGS Astrogeology (planetary names, maps), NOAA (space weather, elevation), CelesTrak (satellite catalogue), the IAU (names, nomenclature), CDS (SIMBAD, VizieR), DESI and many survey teams. The Sources panel lists each dataset and its licence. The debris lab makes a second point: orbital debris is a shared problem that no single country can solve alone.

## Team

| Role | Name |
| --- | --- |
| Project lead | _to be filled_ |
| 3D engine and rendering | _to be filled_ |
| Science and data | _to be filled_ |
| Interface and design | _to be filled_ |
| Labs (debris, deflection) | _to be filled_ |
| Documentation and presentation | _to be filled_ |
| Teacher / mentor | _to be filled_ |

## Three-minute demo script for judges

Before starting: the app is at Earth, time is "now", Exhibition mode is on, the interface is visible.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Stand at Earth. Slowly drag to rotate. | "This is Earth with today's clouds map, city lights on the night side and the Sun as the only light. Everything here is positioned from public data." |
| 0:20 | Press `Ctrl+K`, type ISS, Enter. The camera flies to the station. Point at the inspector. | "That is the International Space Station at its real position right now, propagated with the SGP4 method from CelesTrak data. Each fact has a mark: observed, derived, or illustrative." |
| 0:40 | Open Layers, turn on Satellites and Debris. Zoom out. | "These are about 31,800 tracked objects. The catalogue only lists what is larger than about 10 centimetres. ESA estimates 1.5 million objects between 1 and 10 centimetres that nobody can track." |
| 1:00 | In the inspector, open the **Orbital debris lab**. Pick business as usual, then no further launches. Show Growth. | "Our model shows what policy does: business as usual reaches about 583,000 objects by 2126; stopping launches gives about 25,000. It is a simplified teaching model, and the lab says so." Press `Esc`. |
| 1:30 | Press `5` (Jupiter), then `]` once or twice to step through moons. | "Every planet and moon is reachable by a key. Bodies are drawn bigger than life to be visible; this pill says so, and you can switch to true scale." Click the scale pill, then back. |
| 2:00 | Search "Dimorphos". Open the **Asteroid deflection lab**. Play the DART replay. | "In 2022 NASA hit the asteroid Dimorphos and changed its orbit around Didymos. Our model gives a change of 33.3 minutes; NASA measured 33.0, plus or minus 1." |
| 2:30 | Press `Esc`, then `T` to start the tour. | "Twenty chapters take you from Earth to Voyager 1, with sources for the narration." |
| 2:50 | Press `Shift+H` to hide the interface, hold on the view. | "Everything you saw comes from open data shared by NASA, ESA, USGS, NOAA, CelesTrak and others. Check Sources for the licence of every dataset." |

Likely judge questions and short answers:

- *Is it to scale?* Distances are exact. Sizes are enlarged by default and shrink to true size on approach; the pill says so and "True scale" shows real proportions.
- *How accurate are the positions?* Planets and Moon to about an arcminute; satellites to about a kilometre near the data epoch, getting worse by a few kilometres a day; see [SCIENCE.md](SCIENCE.md).
- *What is not real?* Marked illustrative: aurora shapes, Enceladus and Io plumes, comet tails, the Oort cloud, spacecraft models, irregular moon shapes without surveys, fine surface detail close up.
- *Does it need internet?* No.
- *What did you not finish?* Exoplanets, the Milky Way, galaxies and the cosmic web have data prepared but are not drawn yet.
