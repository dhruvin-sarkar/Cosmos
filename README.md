# Cosmos / AstroNexus

Cosmos is a 3D universe explorer that runs in a web browser. You can fly from low Earth orbit past the planets and their moons to the edge of the Solar System, without a loading screen between scales. It is built for the SCI-FORGE 2026 student science exhibition. Positions come from published ephemerides and public catalogues, and every value in the interface shows where it came from.

Two interactive labs sit on top of the explorer:

- **Orbital debris lab**: how crowded low Earth orbit is today, how policy choices change its future, and what one collision does.
- **Asteroid deflection lab**: a replay of NASA's DART impact on Dimorphos, then a "Defend Earth" experiment.

Documents: [docs/EXHIBITION.md](docs/EXHIBITION.md) (pitch, demo script), [docs/USER_GUIDE.md](docs/USER_GUIDE.md) (controls), [docs/SCIENCE.md](docs/SCIENCE.md) (methods, data, accuracy), [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) (engineering), [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md) (every dataset).

## What is in the build today

| Area | Content |
| --- | --- |
| Earth and Moon | Day, night, cloud and relief maps; atmosphere; aurora driven by observed Kp; city lights; eclipses |
| Sun and planets | The Sun, 8 planets, 5 dwarf planets (Ceres, Pluto, Eris, Haumea, Makemake), Saturn's rings, orbits |
| Moons | Moons of every planet with true orbital elements; textured where a global map exists |
| Small bodies | 75,855 asteroids, 3,449 near-Earth objects, 23 named asteroids and comets, 12 spacecraft |
| Earth orbit | About 31,800 tracked objects from CelesTrak (SGP4), including the ISS, Hubble and Tiangong |
| Outer system | 7,301 trans-Neptunian objects, heliosphere, Oort cloud (illustrative) |
| Sky | 109,389 stars, 88 constellations, 14 all-sky maps from radio to gamma rays |
| Guided tours | A 20-chapter Solar System tour and a 6-chapter quick tour |

Datasets for exoplanets, the Milky Way, galaxies and the cosmic web are stored in `public/data/` and documented in `docs/data/`, but they are not yet drawn in the app. The tours therefore end at Voyager 1 and the outer Solar System.

## Run it

Requirements: Node.js 22 or newer, and a browser with WebGL 2 (Chrome or Edge recommended). The stand laptop is an RTX 3050 with 4 GB of video memory.

```bash
npm install
npm run dev          # development server at http://localhost:5173
```

Production build, which is what the exhibition stand should run:

```bash
npm run build        # writes dist/
npm run preview      # serves dist/ at http://localhost:4173
```

All data, textures and fonts are inside the project, so the built app needs no internet connection.

Other scripts:

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | TypeScript strict check |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end health check (needs Playwright's browser) |
| `npm run shot -- <url> <out.png>` | Headless screenshot |
| `npm run data:manifest` | Rebuild `public/data/manifest.json` from the `manifest.part.json` files |

## Project structure

```
src/
  main.tsx          entry point
  app/              wiring: createCosmos, commands, tours, keyboard
  core/             engine, camera, frames, time, labels, picking, post-processing, visual scale
  render/           shared shaders and materials (stars, atmosphere, rings, orbit lines)
  domains/          one folder per part of the universe, auto-discovered:
                    earth, solar, moons, smallbodies, orbital, outer, features, stars, sky
  labs/             debris and defense labs
  science/          physics and astronomy functions with unit tests
  data/             data loading, provenance, manifest
  state/            the zustand store
  ui/               React interface: shell, navigator, inspector, labs, ruler
  content/tours/    tour chapters and narration
public/
  data/             versioned snapshots of every dataset (with manifest.json)
  textures/         planet, moon and Earth maps
scripts/data/       reproducible data and texture build scripts
docs/               documentation
sandbox/            single-domain test pages for development
```

A domain is added by creating `src/domains/<name>/domain.ts`; the app finds it automatically. Every object has an id such as `sol:earth`, `sol:io`, `sb:bennu`, `sc:iss` or `star:hip:32349`, and a fact sheet with provenance.

## Honesty rules

- Distances are never changed. By default the Sun, planets and moons are drawn larger than life so they are visible from far away; they shrink to true size as you approach. The top bar always says "Enlarged for visibility", and one click switches to true scale.
- Every value is marked observed, derived, reconstructed or illustrative.
- Unknown values are shown as "Unknown", never as 0.
- Data are fixed snapshots with a retrieval date, listed under **Sources** in the app.

## Credits

Data and imagery come from NASA (JPL, SSD, NAIF, NSSDCA, GSFC SVS, SDO, DONKI, Exoplanet Archive, LAMBDA), ESA (Gaia, Planck), USGS Astrogeology, NOAA (SWPC, NCEI), CelesTrak, the IAU, CDS (SIMBAD, VizieR), DESI, Solar System Scope (textures, CC BY 4.0) and others. The full list, with licences and citations, is in [docs/SCIENCE.md](docs/SCIENCE.md) and in the in-app Sources panel.

Software: three.js, React, zustand, astronomy-engine, satellite.js, Vite, Vitest, KaTeX, lucide-react. Fonts: Inter, Mona Sans, Bodoni Moda, JetBrains Mono (open licences, bundled).

Some datasets (Gaia, Planck) are licensed CC BY-NC 3.0 IGO. They are used here for non-commercial, educational display with the required credit.
