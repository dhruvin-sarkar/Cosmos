# Exhibition scale (visual scale)

Owner's request: *"make the planets and sun bigger in scale like scale everything up"*. Cosmos defaults to **Exhibition scale**:
bodies are drawn enlarged so they read as discs at system scale, and shrink smoothly to their true size as the camera
approaches them. **True scale** (one click in the top bar, or Layers → Exhibition scale) draws everything at its real size.
Heliocentric distances never change.

Single source of truth: `src/core/visualScale.ts` (tests: `src/core/visualScale.test.ts`). Store: `visualScale:
'exhibition' | 'true'` in `src/state/store.ts`, changed with `setVisualScale(store, mode)` (which also mirrors the legacy
`'enlarge-bodies'` overlay for layers that have not migrated yet). HUD: `src/ui/shell/ScaleToggle.tsx` — the top-bar pill
"Exhibition scale · Enlarged for visibility" (dotted ring = illustrative, per the provenance mark language) / "True scale".

## The laws

All sizes are CSS px of a viewport of height H at the engine's px-per-radian (H / fovY, fovY = 50°).

| Law | Value | Why |
| --- | --- | --- |
| Target apparent diameter | T = H · 0.016 · √(R / R⊕), clamped per kind | square-root compression keeps the order readable: Earth ≈ 17 px at 1080 p, Jupiter ≈ 58 px (3.3 × Earth, not 11 ×), Mercury ≈ 11 px, Pluto ≈ 7 px |
| Kind clamps (fraction of H) | planet 0.008–0.06, dwarf planet 0.006–0.024, moon 0.003–0.02, asteroid/comet 0.0025–0.01; spacecraft 0.004, station 0.005, satellite 0.003, rocket body 0.0025, debris 0.002 (fixed); the Sun 0.05 | kinds not listed (catalog stars, galaxies, regions…) are never enlarged |
| Displayed diameter | D = (p⁴ + T⁴)^¼, p = true apparent diameter | smooth max: D → T far away, D → p close |
| Distance gate | enlargement × smoothstep(40 R, 160 R, d) | EXACTLY true size within 40 radii; C¹-smooth, no popping |
| Sun cap | R'☉ ≤ 0.3 × Mercury perihelion (1.38 × 10¹⁰ m) | big and glowing, never engulfing Mercury's orbit |
| Planet clearance | enlarged system (core + satellites) ≤ 0.1 × distance from the Sun | no overlaps between neighbours |
| Satellite offsets | a' = f · min(a, c) + max(a − c, 0) · √f | c = parent core (radius, or ring outer edge: Saturn 136,775 km, Uranus ε 51,149 km, Neptune Adams 62,930 km). Rings and ring-moons scale exactly ×f; the gap beyond grows by √f so the Moon stays near the Earth instead of flying out toward Venus. Identity at f = 1. |
| Satellite size cap | r' ≤ 0.35 × (a' − f · R_parent) | a satellite never touches or enters its enlarged parent |
| Mode switch | eased over 1.1 s (instant under reduced motion) | no pop when toggling |

Measured (headless Chrome, 1600 × 900): inner-system overview from 4 AU — Earth ×448, Venus ×475, Mars ×592, Sun ×19;
outer system from 40 AU — Jupiter ×529, Neptune ×3446, Pluto ×23506; Jupiter from 0.1 AU — Jupiter ×4.9, Galilean moons
mapped outside it; travel Sun → Earth: drawn size holds at ≈ 14 px, then grows with the true size (no frame where the drawn
size changes faster than the camera distance); travel to Phobos and to Charon lands at ×1.00 (true scale).

## Runtime: one registry-level hook

```ts
import {
  registerScaledBody, renderTransform, renderPosition, renderFactor, renderRadius,
  satelliteSystem, createSatelliteSystemTransform, applySatelliteSystem, satelliteOffsetScale, getScaleView,
} from '../../core/visualScale';
```

* `registerScaledBody(entity, opts?) → unregister` — opt a body in (once, e.g. in the layer's `init` or the domain's
  `create`). Defaults come from the entity (`kind`, `radiusM`, `parentId`); per-body tables provide ring cores and satellite
  system extents. A body is magnified around its parent **only if the parent is registered too**; planets (parent
  `sol:sun`) are never moved.
* `renderTransform(entity, tMs, out) → factor` — writes the DRAWN position (ICRS m, rel. SSB) and returns the radius factor
  (drawn radius = radiusM × factor). Cached per frame; unregistered entities are identity (true position, 1).
* The camera rig (`src/core/camera/rigImpl.ts`, `focusChain.ts`) and the picker (`src/core/picking.ts`) already use these
  render transforms, and the rig feeds the runtime every frame (`stepVisualScale`, `updateScaleView`) **before** layers
  update — so a layer's `ctx.cameraPosition` equals the runtime's camera, and what is drawn, what the camera travels to and
  what the cursor hits always agree.

### Rules for every domain

1. `entity.position()` stays **TRUE** (physics, distances in the inspector, BodyStrip, eclipses, lighting all need it).
   Never bake an enlargement or offset magnification into `position()`.
2. Draw at `renderTransform(...)`: mesh position = drawn position, mesh scale = `radiusM × factor`. Every shell that belongs
   to the body (clouds, atmosphere, haze, rings, plumes, night lights) scales by the same factor.
3. LOD / point fades / label offsets use the drawn size: `shownPx = ctx.pixelDiameter(radiusM * factor, distance)`.
4. Anything orbiting a registered parent (moons, artificial satellites, ring particles, moon orbit lines) is placed with
   the parent's satellite-system transform (`satelliteSystem`), never with a private factor.
5. Lighting stays physical: the Sun direction is computed from TRUE positions; eclipse/shadow casting only when both bodies
   have factor ≈ 1 (`factor < 1.001`), as today.
6. Remove the old `'enlarge-bodies'` overlay logic once migrated (the overlay remains only as a legacy mirror of the mode).
7. Pick and labels: layer `pick()` uses drawn position and drawn radius; labels anchor at the drawn position with
   `offsetPx = drawnPx / 2 + 3`.

## Adoption guide per domain

### solar (`src/domains/solar/`) — Sun, planets, dwarf planets, rings, heliocentric orbits

* Sun: `sunLayer.ts` already registers the Sun and draws with `renderTransform` ✓.
* `bodiesLayer.ts` init: `unregisters.push(registerScaledBody(v.entity))` for every planet and dwarf planet (the ring core
  radius for Saturn/Uranus/Neptune and the satellite-system extents come from the built-in tables; nothing to pass). Call the
  unregister functions in `dispose()`.
* `bodiesLayer.ts` update (around the current `v.enlarge = enlargeOn && …` line): replace the overlay rule with

  ```ts
  v.enlarge = renderFactor(v.entity, ctx.timeMs);   // planets are never moved: v.world from entity.position() is the drawn position
  v.shownPx = v.px * v.enlarge;
  ```

  The ring is a child of the body group, so it scales with `v.enlarge` automatically (rings must use EXACTLY the planet's
  factor — the satellite law maps everything inside the ring core by ×f). Keep the eclipse guard as `v.enlarge < 1.001`, and
  use `renderPosition(moon, …)` for the occluder moons (identical to true when the factor is 1).
* `orbitsLayer.ts`: heliocentric orbit lines are unchanged. Where it fades by body size, use the drawn size:
  `ctx.pixelDiameter(def.axesM[0] * renderFactor(v.entity, ctx.timeMs), d)`.

### earth (`src/domains/earth/`) — Earth + Moon

* In the layer's `init` (or `create`): `registerScaledBody(earthEntity)`, `registerScaledBody(moonEntity)` (Moon's parent
  `sol:earth` → its offset is magnified around the enlarged Earth and its size capped clear of it).
* `layer.ts placeBody` (currently `b.enlarge = ctx.overlays['enlarge-bodies'] ? …`): pass the entity and use

  ```ts
  b.enlarge = renderTransform(entity, ctx.timeMs, world);   // world := DRAWN position (Earth: unchanged; Moon: magnified offset)
  ```

  then everything below (mesh position, `scale.setScalar(radiusM * b.enlarge / mpu)`, point, labels, pick) already uses
  `world` and `b.enlarge`. Clouds / atmosphere / night shells scale with `b.enlarge`. Keep the eclipse guard
  (`earth.enlarge === 1 && moon.enlarge === 1` → use `< 1.001`). Delete `ENLARGE_TARGET_PX` / `MAX_ENLARGE`.
* Shader camera-local vectors already divide by `R × enlarge` ✓.

### moons (`src/domains/moons/`)

* `entities.ts`: remove `.multiplyScalar(moonOffsetFactor(rec.parent))` from `position()` — positions must stay TRUE.
* Register every moon once: `registerScaledBody(entity)` (parent from `entity.parentId`; the parent planet is registered
  by the solar/earth domains).
* `moonsLayer.ts` update (around `v.entity.position(ctx.timeMs, v.world)`):

  ```ts
  v.enlarge = renderTransform(v.entity, ctx.timeMs, v.world);           // drawn moon position + radius factor
  const parent = registry.get(PARENT_ENTITY[rec.parent]);
  if (parent) renderPosition(parent, ctx.timeMs, v.parentWorld); else v.parentWorld.copy(v.world).sub(off);
  v.distM = Math.max(v.world.distanceTo(ctx.cameraPosition), 1);
  v.px = ctx.pixelDiameter(v.radiusM, v.distM);
  v.shownPx = v.px * v.enlarge;
  const parentDist = Math.max(v.parentWorld.distanceTo(ctx.cameraPosition), 1);
  v.sepPx = (v.world.distanceTo(v.parentWorld) / parentDist) * ctx.pixelsPerRadian;   // drawn separation
  ```

  and drop `moonRadiusFactor` / `maxEnlarge` (the runtime caps the size against the gap to the parent).
* Moon orbit lines (centred on `v.parentWorld`): scale the ellipse uniformly by
  `satelliteOffsetScale(parentFactor, parentCoreM, v.aOrbitM)` where
  `parentFactor = renderFactor(parent, t)` and `parentCoreM` = `CORE_RADIUS_M[parent.id] ?? parent.radiusM`
  (exact for circular orbits, within a few % for the eccentric ones). Or sample the ellipse and map each vertex with
  `applySatelliteSystem` (exact).
* `scaleHooks.ts` becomes: `moonRadiusFactor → renderFactor(entity, t)`, `moonOffsetFactor → 1` (or delete the file).

### smallbodies (`src/domains/smallbodies/`)

* `bodiesLayer.ts`: `registerScaledBody(v.entity)` for each named asteroid/comet (kind asteroid / comet /
  interstellar-object). Replace the overlay rule `v.enlarge = ctx.overlays['enlarge-bodies'] && …` with
  `v.enlarge = renderTransform(v.entity, ctx.timeMs, v.world)` (asteroids are not moved; the factor is capped by the
  0.1 × heliocentric distance clearance). Keep `meanRadiusM * v.enlarge` for the mesh.
* `craftLayer.ts`: `registerScaledBody(e)` for every spacecraft entity (kind spacecraft → fixed 0.4 % of H). Spacecraft
  whose `parentId` is a registered planet (e.g. `sol:earth` for JWST/Hubble, any planet orbiter) are automatically placed in
  that planet's magnified satellite system, so they never end up inside the enlarged planet. Replace the overlay rule with
  `v.enlarge = renderTransform(v.entity, ctx.timeMs, v.world)`.
* `asteroidLayer.ts` (belt / NEO point clouds): no change — points have no radius.

### orbital (`src/domains/orbital/`) — artificial satellites, debris, ISS

* `scene.ts updateOrbitalScale`: replace the private `bodyScale` / `satelliteOffsetScale(f)` call (that one-argument call
  returns a uniform ×f, which would throw GEO out to thousands of Earth radii) with the Earth system transform:

  ```ts
  const sys = createSatelliteSystemTransform();            // module scope, allocate once
  // per frame
  satelliteSystem('sol:earth', ctx.timeMs, sys);           // false → Earth not registered → identity (true scale)
  orbitalScale.earthFactor = sys.factor;
  // per satellite (CPU):  applySatelliteSystem(sys, trueWorld, drawnWorld)
  ```

  On the GPU (instanced points), pass `uEarthDrawn` (render-space `sys.renderPosition`), `uEarthTrue` (render-space
  `sys.truePosition`), `uFactor`, `uCore` (`sys.coreRadiusM / mpu`), `uGap` (`sys.gapScale`) and map in the vertex shader:

  ```glsl
  vec3 rel = pTrue - uEarthTrue; float a = length(rel);
  float aDrawn = uFactor * min(a, uCore) + max(a - uCore, 0.0) * uGap;
  vec3 pDrawn = uEarthDrawn + (a > 0.0 ? rel * (aDrawn / a) : vec3(0.0));
  ```

* ISS / station meshes: `registerScaledBody(issEntity)` (kind space-station, parent `sol:earth`) and draw with
  `renderTransform`. Do NOT register Earth here (the earth domain does).

### stars, sky, galaxy, exoplanets, extragalactic

No change: never enlarged (kinds not in the law table). Exoplanet systems may opt in later with `registerScaledBody` and an
explicit `clearanceM`.

## Engine / shared code (integrator)

* `src/core/engine.ts occludeLabels` (≈ line 360): use `const f = renderTransform(e, ctx.timeMs, occWorld)` and
  `ctx.pixelDiameter(e.radiusM * f, d)`; for the occluded candidate use `renderPosition(ce, …)`.
* Inspector / BodyStrip / navigator distances keep using TRUE `entity.position()` ✓ (they show real distances).

## Verification

`sandbox/visual-scale.ts` installs on the real app and outlines every solar body's drawn disc (amber planets, cyan moons,
red dot = true position, label = factor), optionally travelling and tracing a body's drawn size:

```sh
MSYS_NO_PATHCONV=1 node tools/shot.mjs "http://localhost:5173/" out.png --wait 12000 \
  --eval "import('http://localhost:5173/sandbox/visual-scale.ts').then(m => m.install({ focus: 'sol:sun', dist: 6e11, travel: 'sol:earth', trace: 'sol:earth' }))"
```

Screenshots: `.work/shots/visual-scale/` (inner, outer, jupiter01, phobos, charon, inner-true, earth-approach).
