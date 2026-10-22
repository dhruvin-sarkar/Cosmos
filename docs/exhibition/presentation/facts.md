# Where every number in the deck comes from

Each figure on the slides, with the file in this repository it was taken from. Re-check these before presenting if the data snapshot is refreshed.

| Slide | Figure | Source in the repo |
| --- | --- | --- |
| 2 | ISS 109 m end to end, about 400 km up, one orbit about every 92 min | `src/content/tours/steps.ts` (ISS comment) |
| 2 | Sun 1.39 million km wide, 109 Earths | `src/content/tours/steps.ts` (IAU 2015 nominal radius) |
| 2, 4 | Neptune at 30.07 AU; 1 AU = 149,597,870.7 km | `src/content/tours/steps.ts`, `docs/` |
| 2, 5 | Proxima Centauri 4.25 ly (Gaia DR3); Andromeda 2.5 million ly; CMB shell about 45 billion ly (4.28 × 10²⁶ m) | `src/content/tours/goldenJourney.ts` |
| 2 | ISS (109 m) to CMB shell (4.28 × 10²⁶ m): a factor of about 4 × 10²⁴, about 25 powers of ten | computed from the two values above |
| 4 | Moon 384,400 km mean distance (NASA NSSDCA) | `src/domains/earth` |
| 4 | Voyager 1 at 172 AU on 2026-10-19; radio signals take about 23.9 h | `src/content/tours/steps.ts` |
| 5 | Oort cloud up to about 1.6 ly, illustrative; TRAPPIST-1 40.7 ly; Sun 27,000 ly from the Galactic Centre; Milky Way disc about 100,000 ly; Laniakea 520 million ly; cosmic-web view 6.5 billion ly | `src/content/tours/goldenJourney.ts` |
| 3, 6 | about 31,800 satellites and debris, 75,855 asteroids, 3,449 NEOs, 7,301 TNOs, 109,389 stars, 88 constellations, 14 all-sky maps, 6,451 exoplanets around 4,847 stars, 157 globular clusters, 13 black holes, 869 nearby galaxies, about 2.2 million cosmic-web galaxies | `docs/EXHIBITION.md` "What is in the build", `docs/SCIENCE.md` |
| 6 | 76 datasets, each with retrieval date, licence and citation | `public/data/manifest.json` (76 entries) |
| 6 | Provenance marks Observed / Derived / Reconstructed / Illustrative; "Unknown", never 0 | `docs/SCIENCE.md` |
| 6 | Earth drawn about 448× its true size at 4 AU in Exhibition scale; enlargement fades to 1 within 40 radii | `docs/SCIENCE.md` §3 |
| 7 | PREM: inner core 1,221.5 km, outer core 3,480 km (liquid), D″ 3,630 km, lower mantle 5,701 km, upper mantle 6,346.6 km, crust to 6,371 km; inner-core density 12,760–13,090 kg/m³, 5,700–6,500 K | `docs/data/interiors.md` (Earth table) |
| 7 | 18 bodies, 67 layers, 50 references in the cutaway | `.work/swarm/reports/interiors.md` |
| 8 | S2: period 16.05 yr, pericentre 120 AU, 7,650 km/s = 2.55 % of c (GRAVITY 2018); about 7,700 km/s with the lab's GRAVITY 2024 elements; 12′ precession per orbit; about 200 km/s redshift at pericentre; next pericentre 2034; Sgr A* 4.30 million M☉; R0 = 8,275.9 pc; Nobel Prize 2020 | `src/content/tours/goldenJourney.ts`, `src/labs/relativity/model.test.ts`, `docs/SCIENCE.md` §19 |
| 9 | Ray-marched lensing against a captured background; shadow, photon ring, Einstein rings, Doppler beaming; costs about 0–4 ms GPU on Balanced; Sgr A* horizon about 25 million km across | `.work/swarm/reports/blackholes.md`, `src/content/tours/goldenJourney.ts` |
| 10 | Habitable zone of the Sun 0.95–1.67 AU conservative (Kopparapu et al. 2014); Earth T_eq 255 K, surface 288 K; TRAPPIST-1 e in the conservative zone (Agol et al. 2021); 14 showcase systems | `src/labs/habitability/model.test.ts`, `.work/swarm/reports/exoplanets.md` |
| 11 | Debris lab: business as usual about 583,000 objects and 140 collisions a year by 2126; no more launches about 25,000; 29,408 tracked objects below 2,000 km | `docs/SCIENCE.md` §13, `src/content/tours/goldenJourney.ts` |
| 11 | DART: model −33.3 min vs measured −33.0 ± 1.0 min (Thomas et al. 2023) | `docs/SCIENCE.md` §14 |
| 12 | `render = (world − camera) / metersPerUnit` in float64; metersPerUnit 10⁻³ to 10³⁰; logarithmic depth | `docs/ARCHITECTURE.md` §5 |
| 12 | KTX2 vs JPEG (nine-body tour): VRAM estimate 603 vs 1,155 MB; frames over 100 ms 13 vs 33; 63 KTX2 files | `.work/swarm/reports/gpu-textures.md` |
| 12 | Andromeda flight worst frame 204–265 ms → 108 ms; 643 ms sky-bake stall removed; SGP4, 76,000-row asteroid table and Andromeda star cloud in workers | `README.md` Performance, `.work/swarm/reports/fix-3-perf-2.md` |
| 12 | Golden-journey capture, production build, 1920×1080 Ultra, headless Chrome on the RTX 3050: 22 of 23 chapters at 97–100 fps, slowest (Orion Arm) 65 fps | `.work/shots/final/journey/log.json` |
| 12 | about 72,000 lines of TypeScript (excluding tests); 635 unit tests in 70 files | `src/` line and test count, 2026-10-22 |
| 13 | `?exhibition=1` kiosk start URL; Reduce motion turns travel into a crossfade; Shift+H, H, Esc, T, 1–8, [ ], Ctrl+K | `README.md`, `docs/USER_GUIDE.md`, `docs/EXHIBITION.md` |
| 13 | No request to an outside server, tested with `COSMOS_E2E_OFFLINE=1` | `docs/EXHIBITION.md` "Offline operation" |
