# small-bodies domain (`id: 'small-bodies'`, order 34)

Entities: `sb:<slug>` (vesta, pallas, hygiea, psyche, eros, bennu, ryugu, itokawa, apophis, didymos, dimorphos, 2024-yr4, phaethon,
halley, encke, tempel-1, 67p, hale-bopp, oumuamua, borisov, 3i-atlas, arrokoth, sedna), 3,449 NEOs via a lazy provider
(`sb:<designation-slug>`, registered once neos.json arrives), `sc:<slug>` spacecraft (voyager-1/2, new-horizons, parker-solar-probe, juno,
europa-clipper, psyche, lucy, hera, juice, bepicolombo, jwst).
Layers: `asteroid-cloud` (75,855 GPU-Kepler points, NEO/PHA highlight via `setNeoHighlight`), `small-bodies`, `spacecraft`.
Overlays: `asteroids` (cloud; also shown automatically while an `sb:*` body is focused/selected), `spacecraft`, `orbits`, `enlarge-bodies`.

## Comet tail heuristic (illustrative, stated in comet FactSheets)
activity f(r) = smoothstep(4.0→2.2 au)·min(1, 1.2/r²)·size. Ion tail: straight, exactly anti-sunward, blue, length 0.9 au·f. Dust tail: 0.45× as
long, yellow-white, curved toward the trailing side of the orbit (−v component ⟂ anti-sun axis). Coma radius 6·10⁷ m·f. Ribbon meshes with a
soft analytic profile (no particles); coma and tails fade when the camera is inside the near field of the nucleus.

## Defence-lab API (`neoApi.ts`, pure data, no rendering)
`loadNeoCatalog()` → `NeoRow[]` (orbital elements, H, diameter, PHA flag, MOID) · `loadCloseApproaches()` → `CloseApproach[]` (JPL CAD) ·
`loadSentry()` → `SentryRow[]` (impact-risk table) · `findNeo(query)` · `nextApproaches(fromMs, toMs, maxAU?, limit?)` · `sentryFor(designation)` ·
`neoElements(row)` / `propagateNeoHeliocentricM(row, tMs, out)` (two-body, ICRS m) · `minApproachKm(a)`.
Orbit maths in `orbits.ts` (`heliocentricIcrsM`, `heliocentricVelocityIcrs`, `sampleOrbitIcrsM`, `jdTdbFromMs`); `dimorphosOffsetM` in `bodies.ts`
(Dimorphos' orbit about Didymos with the DART period change).

## Spacecraft
`spacecraft.json` (Horizons, 2025-01-01 → 2030-12-31, JPL has no predictions beyond; Hera ends 2026-11-02, Psyche 2029-02-09) is interpolated with a
cubic Hermite spline (`CraftTrack`); outside the window the craft is held at its end point. Models are illustrative (`craftModels.ts`).
