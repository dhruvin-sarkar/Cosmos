# Cosmos — Architecture

> **One explorable universe, real science, continuous scale.** Cosmos is an interactive scientific universe
> engine: travel from Earth to the CMB without ever leaving one continuous 3D space, inspect real data with
> visible provenance, and run experiments (debris, planetary defense, exoplanet climate, relativity) whose
> results are computed by tested scientific models.

This document is the contract between subsystems. Decisions with lasting consequences are summarized in
[§16 Decision records](#16-decision-records). Shared TypeScript contracts live in:

| Contract | File |
|---|---|
| Constants & units (SI) | `src/core/units.ts` |
| Provenance, facts, data-source registry types | `src/data/provenance.ts` |
| Entities, providers, search, registry | `src/core/entity.ts` |
| Engine: Layer, FrameContext, services, quality, time, camera | `src/core/types.ts` |
| App state (zustand vanilla store) | `src/state/store.ts` |
| Command surface for UI / tours | `src/app/commands.ts` |

---

## 1. Product slice (SCI-FORGE 2026)

The competition build is a **golden journey** through seven polished, connected experiences, all reachable by
free exploration as well as by the guided Exhibition Mode:

1. **Earth & orbital environment** — photoreal Earth, real tracked population (CelesTrak snapshot).
2. **Debris / Kessler lab** — shell-density model, fragmentation events, mitigation policies.
3. **Solar System travel** — true-scale system with real ephemerides; Cosmic Ruler zoom.
4. **Planetary-defense lab** — real NEO orbits, kinetic impactor with β, DART calibration preset.
5. **Exoplanet system + habitability lab** — NASA Exoplanet Archive data; Teq / HZ / ESI kept separate.
6. **Sagittarius A\*** — S-star orbits, lensing (fast + high-fidelity), live time-dilation clocks.
7. **Galaxies → cosmic web → CMB** — Local Group, redshift-survey structure, Planck CMB finale.

Two modes of truth run through everything: **Explore Reality** (best reconstruction supported by data) and
**Experiment With Reality** (explicit what-if scenarios showing Real / Modified / Difference, with exact reset).

## 2. Stack

| Concern | Choice | Why (short) |
|---|---|---|
| Rendering | three.js r186 `WebGLRenderer` (WebGL 2), GLSL `ShaderMaterial` | Universal school-hardware support, mature post-processing, full shader control. See ADR-001. |
| Depth | Logarithmic depth buffer | One scene spanning 30 orders of magnitude without z-fighting; works with the default framebuffer. ADR-003. |
| UI | React 19 overlay (DOM), `lucide-react` icons, KaTeX equations | HUD is DOM over the canvas; React never touches per-frame data. |
| State | zustand vanilla store + `AppCommands` | Framework-free store shared by engine & UI; commands are the only mutation path from UI/tours. |
| Ephemerides | `astronomy-engine` (VSOP87-based, ~1′ accuracy, offline) | Planet/Moon positions, rotation axes, sidereal time, Galilean moons. |
| Orbit propagation | `satellite.js` v7 (`json2satrec` on OMM JSON; IDs > 5 digits OK) | SGP4 for selected objects; GPU two-body+J2 approximation for bulk display. |
| Build / test | Vite 8, TypeScript 7 (strict), Vitest 5, Playwright (screenshots, smoke, perf) | |

## 3. Repository layout & ownership

```
src/
  core/        engine spine: engine loop, camera rig, scale/focus chain, time, registry, picking, labels,
               post-processing, quality, perf, assets, frames (coordinate conversions), units
  app/         composition root: createCosmos() boots engine + domains + labs, implements AppCommands, tours
  state/       zustand store
  data/        runtime data access: manifest, typed loaders, texture resolver, formatting, search index
  science/     PURE scientific models (unit-tested; no three.js, no DOM)
  domains/     render domains — one folder each: earth, orbital, solar, stars, exoplanets, galaxy,
               blackhole, extragalactic, cosmology, sky
  labs/        experiments — one folder each: debris, defense, habitability, relativity
               (model.ts pure state logic, layer.ts visualization, Panel.tsx UI)
  ui/          React HUD: shell, design system components, ruler, search, inspector, labs drawer, tours
  styles/      design tokens + base CSS
sandbox/       isolated dev pages per module (served by the dev server; not in production build)
scripts/data/  ingestion pipeline (fetch → validate → normalize → manifest part) per domain
public/data/   versioned offline data snapshot + manifest.json (data-source registry)
public/textures/, public/models/  imagery and models with credits in index.json
tools/         shot.mjs (screenshots), perf tooling
docs/          this file, SCIENCE.md, DATA_SOURCES.md, EXHIBITION.md, data/<domain>.md, decisions
```

Each domain/lab folder is owned by one developer (or agent) and exposes **one entry point**
(`src/domains/<d>/index.ts` exporting `create<D>Domain(...)` → `{ layers: Layer[], providers: EntityProvider[],
entities?: Entity[] }`; labs similarly export their layer(s) + panel). The composition root is the only place
that imports all of them — subsystems never import each other's internals.

## 4. Coordinates, frames and precision

### 4.1 Canonical world frame
**World = ICRS axes (≈ J2000 equatorial), meters, origin at the Solar System barycenter (SSB), float64.**
Every `Entity.position(tMs, out)` returns this. JS numbers are IEEE-754 doubles (ε ≈ 2.2·10⁻¹⁶), so:

| Where | Typical magnitude | Absolute precision | Needed |
|---|---|---|---|
| Satellite near Earth (via Earth pos.) | 1.5·10¹¹ m | ~3·10⁻⁵ m | < 1 m ✓ |
| Exoplanet at TRAPPIST-1 | 3.8·10¹⁷ m | ~80 m | ≪ planet radius ✓ |
| Sgr A\* region | 2.6·10²⁰ m | ~6·10⁴ m | ≪ r_s = 1.3·10¹⁰ m ✓ |
| Cosmic web edge | 1·10²⁵ m | ~2·10⁹ m | ≪ galaxy size ✓ |
| Last-scattering surface | 4.3·10²⁶ m | ~10¹¹ m | ≪ any visible feature ✓ |

So a single float64 world frame is sufficient on the CPU; **precision is lost only when coordinates reach the
GPU as float32**. That is solved by camera-relative rendering (§5.1), not by many CPU frames.

### 4.2 Named frames (explicit, tested conversions in `src/core/frames.ts`)
| Frame | Use | Conversion |
|---|---|---|
| ICRS / SSB (world) | everything | identity |
| Body-centered inertial (BCI) | moons, satellites, local offsets | translate by body position |
| ECI (GCRS≈ICRS) & TEME | SGP4 output (TEME, km) | TEME→ICRS via precession-nutation (`Rotation_EQD_EQJ`) + translate by Earth |
| Body-fixed (e.g. ITRF / IAU rotation models) | surface textures, ground points, Earth night lights | IAU WGCCRE pole + prime meridian W(t); Earth via sidereal time |
| Local tangent (ENU) | surface-relative camera, observer sky view | geodetic → ECEF → ICRS |
| Ecliptic J2000 | orbit elements (planets, small bodies) | rotation by ε₀ = 23.4392911° |
| Galactic | Milky Way model, landmarks | ICRS↔Galactic matrix (Hipparcos 1997 definition) |
| Supergalactic | large-scale-structure labels | Galactic↔Supergalactic (de Vaucouleurs) |
| Comoving cosmological | redshift surveys | comoving distance χ(z) (flat ΛCDM, Planck 2018) along (RA, Dec) |

`frames.ts` exports pure functions (`raDecDistToIcrs`, `icrsToRaDec`, `eclipticToIcrs`, `icrsToGalactic`,
`galacticToIcrs`, `bodyFixedToIcrs`, `temeToIcrs`, `geodeticToEcef`, …) each with unit tests against known values.

### 4.3 Camera anchoring (origin rebasing)
The camera never stores an absolute position. It stores **`anchorId` + `offset` (m, ICRS axes)**; its world
position each frame is `anchor.position(t) + offset`. When the camera moves to another context (travel, scale
scrub, free flight into a new sphere of influence) it **re-anchors**: compute the current world position, pick
the new anchor, set `offset = world − newAnchor.position(t)` — invisible to the user, but at 1 day/s simulation
rate the camera now moves with the right body.

## 5. Rendering

### 5.1 Render space (floating origin)
`render = (world − cameraWorld) / metersPerUnit` computed in float64 on the CPU each frame (`ctx.toRender`).
The three.js camera sits at the origin. `metersPerUnit = clamp(focusDistance / 1000, 1e-3, 1e30)` — the focus
target is ~1000 render units away. Layers must hide content whose render coordinates would exceed ~1e15 units
(their scale range is inactive). Large point clouds store float32 positions **relative to a chunk origin**
(split high/low): the chunk's `Object3D.position = ctx.toRender(chunkOriginWorld)`.

### 5.2 Depth
Logarithmic depth buffer (`logarithmicDepthBuffer: true`). Every custom shader includes the log-depth chunks
(see header of `src/core/types.ts`). Points/lines that only need to be occluded by planets use
`depthWrite=false, depthTest=true`. Sky backdrops use `depthTest=false`.

### 5.3 Render groups & order
`background(-100)` → `main(0)` opaque bodies → `far(5)` point clouds (after opaque so planets occlude stars) →
`transparent(10)` atmospheres, rings, glows → `overlay(20)` scientific annotations. (`Group.renderOrder`.)

### 5.4 HDR, exposure, post-processing
Linear HDR rendering into a HalfFloat target → optional MSAA → domain post passes (e.g. lensing) → bloom
(`UnrealBloomPass`, quality-dependent) → `OutputPass` (tone mapping AgX/ACES + sRGB). Emissive objects (Sun,
stars, accretion flows) write HDR values; bloom makes them glow. Exposure follows context (bright near the
Sun, deeper in interstellar space).

### 5.5 Lighting models (not one model for the universe)
- **Planets/moons**: single directional light from the Sun computed per body (`body→Sun` in render space),
  physically-inspired diffuse + specular oceans (Earth), night-side emission (city lights), atmospheric
  scattering approximation (Rayleigh/Mie), analytic eclipses (Earth↔Moon) and ring shadows (Saturn).
- **Stars**: emissive; color from Teff via blackbody → linear sRGB; limb darkening + granulation for close-ups.
- **Point stars**: photometric — per-vertex apparent magnitude `m = M + 5·log10(d_pc) − 5`, flux
  `∝ 10^(−0.4(m − m_lim))` → point size/alpha; constant exposure parameter adjusted by context.
- **Galaxies / nebulae / dust**: additive points, splats, procedural volumes; **enhancement for visibility is
  labelled** in the representation info.
- **Black hole**: dedicated lensing (screen-space fast mode; ray-traced Schwarzschild geodesics against a
  captured environment cube map in high mode).

### 5.6 Representation ladder (LOD) — screen-space importance, cross-faded
Driven by `ctx.pixelDiameter(radius, distance)` and scale, never distance alone:

| Pixel diameter | Body representation |
|---|---|
| < 1.5 px | photometric point (+ label if prioritized) |
| 1.5 – 4 px | point fading out, low-poly sphere fading in |
| 4 – 12 px | textured low-res sphere |
| > 12 px | full shader (high-res textures, atmosphere, normals) |
| > 400 px | surface extras (cloud detail, terminator glow) |

Galaxies: survey point (cosmic web) → impostor sprite (oriented, type-based) → procedural volume (famous
galaxies) → Milky Way reconstruction + catalog stars when inside. Cross-fades over ranges; no popping.
Labels: a global budget, priority = importance × screen salience; selected/hovered always shown.

### 5.7 Picking & labels
Layers implement `pick()` against their own CPU-side data (projected candidates near the cursor);
the engine merges hits (nearest in px within radius, then front-most, then priority). Labels: layers submit
`LabelCandidate`s; the core `LabelManager` declutters (greedy placement by priority on a screen grid) and
renders a pooled set of DOM labels via `transform: translate3d` (no React per frame).

### 5.8 Environment capture & post passes
`svc.captureEnvironment(world, size, hide)` renders a cube map from any world point (used by the black-hole
high-fidelity mode); `svc.addPostPass(pass, order)` inserts screen-space effects before bloom.

## 6. Scale, the Cosmic Ruler and navigation

### 6.1 Scale definition
`scaleLog10 = log10(2 · d · tan(fovY/2))` — the visible vertical extent (m) at focus distance `d`.
Range ≈ 1 (10 m) … 27 (observable universe, Ø ≈ 8.8·10²⁶ m).

### 6.2 Focus chain (semantic zoom)
Zooming (mouse wheel, pinch, keyboard, ruler drag) changes `scaleLog10` continuously while keeping the view
direction. The **focus point** is a blend along the focus entity's ancestor chain
(e.g. ISS → Earth → Sun → Galactic Center → Local Group → observer/origin):
for each step child→parent with separation `s`, the focus blends from child to parent as scale goes from
`max(log10(s)+0.6, parent.contextScaleMin)` to that +1.0 (smoothstep). Camera position = focusPoint −
viewDir·d(scale). Defaults: Earth→Sun ≈ 11.8–12.8; Sun→Galactic Center from 21.0; GC→Local Group from 22.7;
Local Group→observer (all redshift surveys and the CMB are observer-centered) from 24.0.
Zooming back in returns along the same chain to the selected target. The camera anchor switches to the
dominant chain element so time-driven motion stays correct.

### 6.3 Ruler UI
Logarithmic track with unit bands (m, km, R⊕, LD, light-s/min, AU, light-h/d, ly, pc, kpc, Mpc, Gpc) and
landmarks (Earth, GEO, Moon orbit, Sun, Earth orbit, Neptune orbit, heliopause ~120 AU, Oort cloud, Proxima,
local bubble, Milky Way disk, Local Group, Virgo cluster, Laniakea, observable universe). Dragging scrubs the
scale; clicking a landmark travels/zooms there. It is simultaneously a measure, a control, a breadcrumb and an
orders-of-magnitude lesson.

### 6.4 Camera modes & travel
- **Orbit** (default): left-drag orbits the focus, right-drag looks around, wheel/pinch = scale. Up vector blends
  from the body's pole (close-up) → ecliptic north (system scales) → galactic north (> 10¹⁹ m). Zoom acts on
  altitude above the surface near bodies (surface-relative clamp at 1.02 R).
- **Free flight**: WASD/QE + mouse look; speed ∝ 10^scale (crossing the view in ~2 s); auto re-anchor to the
  body whose sphere of influence contains the camera.
- **Follow**: like orbit but offset expressed in the target's radial/along-track/cross-track frame.
- **Travel** is expressed as (focus point, scale, view direction) keyframes: zoom out to a common context scale
  (≈ log10(separation)+0.3), pan the focus at that scale, zoom in to the arrival scale. Duration 1.5–9 s
  (≈ 2 s + 0.35 s per order of magnitude); arrival direction gives lit bodies a gibbous phase; reduced-motion
  users get a short cross-fade cut. History (`back()`), bookmarks, and `home()` always recover the user.

## 7. Time
Separate concepts: **wall-clock** (`Date.now()`), **simulation time** (`TimeController.nowMs`, Unix ms UTC),
**ephemeris time** (TDB, derived via astronomy-engine for ephemerides), **dataset epoch** (manifest/entity
facts, e.g. GP element epoch) and **observation time** (per measurement). Users can pause, resume, change rate
(±1 … ±10⁷ ×, reverse), jump to a date, return to now. Models declare validity bounds; out-of-range jumps clamp
with a notice. Never conflate a catalog epoch with the rendered current position.

## 8. Entities, providers, search
See `src/core/entity.ts`. A few hundred hero entities are registered eagerly; catalogs (stars, satellites,
exoplanets, galaxies) register `EntityProvider`s that materialize entities lazily and expose only named/notable
records to search. `resolveIdentifier` handles catalog IDs (HIP/HD/Gliese/NORAD/Messier/NGC) without indexing
every row. Search (`src/data/search.ts`) normalizes diacritics/case/punctuation ("alpha cen" = "α Cen" =
"Rigil Kentaurus"), ranks by match quality × importance, groups results by kind, and shows scale context.

## 9. Provenance (non-negotiable)
`src/data/provenance.ts` defines Observed / Derived / Reconstructed / Illustrative, `Quantity` (value|null, unit,
uncertainty, provenance, source, model), `FactSheet` and the data-source registry (`DatasetRecord`).
UI rules: every inspector value shows a provenance badge (icon + text, never color alone); Unknown is shown as
"Unknown"; uncertainty shown as ± or range with sensible significant digits; derived values expose the model,
equation and assumptions ("show calculation"); the representation itself is labelled (e.g. "Illustrative
visualization — not an image of this planet"); sources resolve to name, version, retrieval date, license via
the manifest. Scientific metadata is rendered as text, never HTML.

## 10. Laboratories (Experiment With Reality)
Each lab: `model.ts` — `ObservedState` (from data, immutable) + `ScenarioOverrides` (user variables) →
`computeScenario()` → `ScenarioState` (pure, unit-tested); `layer.ts` visualizes Real vs Modified in 3D;
`Panel.tsx` uses the shared **LabShell** grammar: *Real State · Variables · Visualization · Result ·
Explanation · Assumptions · Compare (Real / Modified / Difference) · Reset to Real Data*. Resetting is exact
(overrides cleared); canonical records are never mutated. Equations are shown with KaTeX, variables defined,
units shown, references linked.

## 11. Science library (`src/science/`)
Pure functions, explicit units in parameter names, SI internally, documented model ids/versions, Vitest
reference cases (Earth Teq ≈ 255 K at A=0.3; r_s(Sun) ≈ 2.95 km; r_s(Sgr A\*) ≈ 1.27·10¹⁰ m; DART-like Δv
direction; 1 pc = 206264.806 AU; 1 ly = 63241.077 AU; Kepler-solver round trips…). Tolerances match each model's
stated accuracy — never compare an approximation to a precise ephemeris and call the difference a bug.

## 12. Data pipeline & offline snapshot
`scripts/data/<domain>/*.mjs`: fetch (official APIs first, polite, cached in `data-raw/`) → validate →
normalize → `public/data/<domain>/…` + `manifest.part.json` → `npm run data:manifest` merges into
`public/data/manifest.json` (the machine-readable data-source registry). The app loads **only local
snapshots** for the golden path (deterministic offline); optional online refresh (e.g. CelesTrak) falls back to
the snapshot and shows its date. Large catalogs are compact JSON rows or little-endian Float32 binaries with
JSON headers; heavy decoding happens off the main thread.

## 13. UI / UX
- The viewport is the product; HUD is restrained and progressive: **top** search (Ctrl+K / `/`) + breadcrumbs +
  app menu; **bottom center** Cosmic Ruler; **bottom left** time controls; **left hotbar** overlays & spectral
  band; **right** inspector (on selection); **Science Lab** drawer when a lab is open; **tour card** in
  Exhibition Mode with presenter controls and "Return to demo".
- Inspector answers: What is this? Where am I? How far? How do we know? What can I do? Tabs: Overview,
  Properties, Orbit/Position, Science, Observations, Sources, Experiment.
- Scientific elegance, not sci-fi neon: neutral translucent surfaces, hairline borders, precise typography
  (Inter + JetBrains Mono, tabular numerals), one restrained accent, annotations visually distinct from scenery,
  provenance icons. Motion communicates scale/relationship; `prefers-reduced-motion` respected.
- Keyboard-first: Space pause · `[`/`]` time rate · Backspace back · H home · F focus selection · Esc close ·
  Ctrl+K / `/` search · G tour · L labels · O orbits · 1–4 spectral bands · `` ` `` debug overlay · ? help.
- Accessibility: focus rings, ARIA labels/roles, contrast ≥ 4.5:1 for text, no color-only encodings.

## 14. Performance
Budgets (reference: RTX 3050 Laptop / Ryzen 7 6800HS, Chrome): 60 FPS target, ≥ 45 FPS sustained in hero scenes,
no main-thread task > 50 ms during interaction, no blocking loading screens on transitions, first meaningful
frame < 2 s from cache. Instrumentation (`src/core/perf.ts`): CPU/GPU frame time (EXT_disjoint_timer_query_webgl2),
worst frame per second, draw calls, triangles/points/lines, textures, JS heap, long tasks. Quality presets
Auto/Performance/Balanced/Ultra adjust pixel ratio, bloom, MSAA, texture tier, star/galaxy/satellite/particle
budgets, black-hole mode and label budget; Auto adapts dynamic resolution and steps presets on sustained misses.
Benchmark scenes: Earth close-up; Earth + full orbital population; full Solar System; dense Milky Way catalog;
cosmic web; black-hole lensing; rapid Cosmic Ruler sweep.

## 15. Failure states & testing
Online source unavailable → snapshot + date notice. Texture fails → fallback color, notice. WebGL2 missing →
explanatory screen. Missing property → "Unknown". Invalid experiment input → validation message, no NaN in UI.
Tests: Vitest for science/frames/scale/format/search/loaders; Playwright smoke (boot, no console errors, golden
journey steps) and screenshot baselines for hero scenes; perf scenes with recorded budgets.

## 16. Decision records
- **ADR-001 Renderer: three.js WebGLRenderer (WebGL 2) for the competition build.** WebGPURenderer requires
  porting every custom shader to TSL and its WebGL-2 fallback lags; our bottlenecks are shader/fill-rate, not
  draw-call overhead. Shaders are isolated per domain so a later WebGPU/TSL port is incremental.
- **ADR-002 Precision: single float64 ICRS/SSB world frame + camera-relative rendering + chunk-relative float32
  point clouds + anchored camera.** Analysis in §4.1; avoids frame-tree complexity while meeting precision at
  every scale; named frames exist as explicit, tested conversions.
- **ADR-003 Depth: logarithmic depth buffer.** Universally available, compatible with the default framebuffer
  and built-in materials; reversed-Z (needs EXT_clip_control + float depth targets) recorded as a future
  optimization to benchmark.
- **ADR-004 Cosmic Ruler = scale state machine** (focus chain + context bands), not a scaled scene (§6.2).
- **ADR-005 Offline-first versioned snapshots** with a merged manifest as the data-source registry (§12).
- **ADR-006 Orbital propagation accuracy**: bulk display uses a GPU two-body + J2-secular approximation of GP
  mean elements (km-level near epoch, labelled approximate); the selected object uses full SGP4 on the CPU.
