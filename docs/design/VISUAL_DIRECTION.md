# Visual direction

Authoritative for every visual decision in Cosmos: HUD, inspector, 3D presentation, labs, tour and exhibition mode.
It distils the team's reference board ([REFERENCES.md](REFERENCES.md)) into decisions. Where an agent's taste
disagrees with this document, the document wins. Where this document disagrees with scientific accuracy, accuracy wins
and the document gets corrected.

## The idea

Cosmos is an atlas you can fly through and an instrument you can experiment with. The universe is the only picture.
The interface is typography and hairlines laid on the sky, the way titles sit on film.

Real objects speak in an engraved-atlas serif. The instrument speaks in a quiet grotesque. Experiments speak in an
expanded technical face. Catalogues speak in monospace. Everything that spans orders of magnitude is drawn on one
logarithmic rule with slide-rule ticks, the Cosmic Ruler, and that rule is the single bold element on screen.

## Principles

1. **The universe supplies the colour.** The UI is monochrome ink on true black. Hue appears only for brass
   (attention), blue and orange (real versus modified, in labs) and rare status messages.
2. **We never fake the light; we choose where to stand.** Illumination is physically based: the real Sun direction,
   real phases, filmic tone mapping. Drama comes from camera placement and framing, never from cheating light or colour.
3. **Type on the sky, not boxes on the sky.** Reading columns sit on edge scrims. Only dense instruments get a
   faceplate. No frosted glass.
4. **Every structural device carries information.** Line texture encodes provenance. Corner brackets mean "under
   observation". Numbering appears only on true sequences. The label above a name is real taxonomy.
5. **Real numbers only.** Every coordinate, figure, tile and readout comes from data with a source. No decorative
   barcodes, fake telemetry, random hex or invented coordinates.
6. **One bold thing per screen.** While travelling it is the ruler's magnitude; while inspecting it is the object's
   name. Everything else recedes.
7. **Legible at three metres.** Exhibition screens are read standing, in bright halls. The floors below are minimums.

## Four voices (type)

| Voice | Face | Speaks | Never |
| --- | --- | --- | --- |
| Atlas | Bodoni Moda Variable, optical size auto, weight 400 (450 at 20–32 px) | Proper names of real objects and places, tour chapter titles, the ruler's magnitude, constellation names on the sky (italic) | UI labels, body copy, lab values, anything under 20 px except constellation names (15 px minimum) |
| Instrument | Inter Variable (opsz), `cv05` `cv08`, tabular figures for numbers | All interface text: body, fact labels and values, buttons, 3D labels, charts | Display names |
| Experiment | Mona Sans Variable, width 125 weight 300 at 48 px and up; width 112 weight 450 at 24–47 px | Lab results and modified-scenario readouts | Exploration views of the real sky |
| Catalogue | JetBrains Mono 400 | Literal identifiers (NORAD 25544, HIP 71683, NAIF 301, Gaia DR3 source ids), epochs, source field names | Labels or prose |

Why these faces:

- **Bodoni Moda.** Didone lettering is the voice of nineteenth-century celestial cartography and scientific plates.
  Its high contrast reads as the engraved name of a real place. The optical-size axis thickens hairlines as text gets
  smaller, so one face holds from 15 px constellation labels to 160 px readouts. Its math subset carries α to ω, so
  Bayer designations (α Centauri A, τ Ceti) set in the same face without a fallback.
- **Inter.** Kept for function, not fashion. It has Greek for Bayer labels, `cv05` and `cv08` to separate l, I and 1 in
  catalogue names, and tabular figures. It is the most legible small-size face we can bundle.
- **Mona Sans Expanded.** It gives the calm, wide numerals of the technical references without sci-fi chrome. Switching
  to it tells visitors they are looking at an experiment, not the real sky: typography reinforces Real versus Modified.
- **JetBrains Mono.** Identifiers are exact strings; monospace makes that visible.

### Scale

Reference frame 1920 × 1080. Fluid sizes clamp between 1280 and 3840 px widths. Exhibition mode multiplies Instrument
sizes by 1.25 (body never below 18 px).

| Token | Size / line height | Face | Use |
| --- | --- | --- | --- |
| `--type-atlas-xl` | clamp(72px, 6.2vw, 128px) / 0.95 | Atlas 400 | Inspector title, names up to 10 characters |
| `--type-atlas-l` | clamp(52px, 4.2vw, 88px) / 1.0 | Atlas 400 | Longer names, tour chapter titles |
| `--type-atlas-m` | 36px / 1.05 | Atlas 450 | Lab subject, search hero result |
| `--type-ruler` | clamp(96px, 7.5vw, 160px) / 1 | Atlas 400 | Ruler magnitude while travelling |
| `--type-ruler-rest` | 40px / 1 | Atlas 400 | Compact readout while inspecting |
| `--type-constellation` | 15px, italic, tracking 0.08em | Atlas italic 400 | Constellation names on the sky, 45% ink |
| `--type-exp-xl` | clamp(72px, 5.5vw, 112px) / 1 | Experiment 125 / 300 | Lab headline result |
| `--type-exp-m` | 32px / 1.1 | Experiment 112 / 450 | Secondary lab values |
| `--type-lede` | 19px / 1.5 (22px exhibition) | Instrument 400 | Inspector lede, tour narration |
| `--type-body` | 15px / 1.55 | Instrument 400 | Explanations |
| `--type-value` | 17px / 1.25 | Instrument 500, tabular | Fact values |
| `--type-label` | 12.5px / 1.25 | Instrument 450 | Fact labels, captions |
| `--type-3d-label` | 13px / 1 | Instrument 500 + halo | Labels on the sky |
| `--type-mono` | 12.5px / 1.3 | Catalogue 400 | Identifiers |

### Typographic rules

- Sentence case everywhere. No all-caps labels and no tracked-out eyebrows. Acronyms keep their capitals (JWST, CMB).
- Proper names are never truncated. Long names wrap with `text-wrap: balance`; the size steps down from `atlas-xl` to
  `atlas-l` above 10 characters.
- Numbers: tabular figures in readouts and grids; a true minus (−) and multiplication sign (×); real superscripts for
  exponents (7.346 × 10²² kg); a no-break space before units; precision from `Quantity.sigDigits`; uncertainty as
  `± 0.3` in secondary ink.
- Unknown values read "Unknown" in tertiary ink. Never 0, never blank.
- Prose runs 36–60 characters per line; ledes stay under 44.

## Colour

Built on the ramp already in `src/styles/tokens.css` (chroma-0 neutrals, brass, real and scenario hues), with the
changes listed at the end of this document.

| Role | Value | Hex | Notes |
| --- | --- | --- | --- |
| Space | `#000` | `#000000` | Renderer clear colour. True black for OLED and projectors. |
| Ink primary | `oklch(0.93 0 0)` | `#E8E8E8` | Lowered from 0.965 to reduce halation of hairlines on pure black |
| Ink secondary | `oklch(0.80 0 0)` | `#BEBEBE` | Labels, captions |
| Ink tertiary | `oklch(0.70 0 0)` | `#9E9E9E` | Unknown values, de-emphasised metadata |
| Ink disabled | `oklch(0.50 0 0)` | `#636363` | Solid backgrounds only |
| Hairline | `oklch(1 0 0 / 0.14)` | | One device pixel |
| Brass | `oklch(0.85 0.10 88)` | `#E9CA80` | Attention only: focus, selection reticle, ruler cursor, the one primary action, focused orbit. The brass of orreries and telescope fittings. |
| Real | `oklch(0.80 0.085 235)` | `#86C7ED` | Real data in lab comparisons |
| Modified | `oklch(0.78 0.14 52)` | `#FD9C5D` | Scenario values; blue and orange stay distinct for colour-blind visitors |

Data colour (charts, maps) follows scientific practice: perceptually uniform maps (viridis, cividis, magma) for
continuous data, the Okabe–Ito palette for categories, blackbody colour for stars. The provenance hues in
`tokens.css` remain available only for charts where several provenance classes share one plot.

### Contrast floors (WCAG 2, computed)

| Ink | On black | Over a pure-white background under black scrim α 0.60 | α 0.72 | α 0.85 |
| --- | --- | --- | --- | --- |
| Primary | 17.1 | 4.7 | 7.5 | 12.3 |
| Secondary | 11.2 | 3.1 | 4.9 | 8.1 |
| Tertiary | 7.9 | 2.2 | 3.5 | 5.7 |
| Brass | 13.3 | 3.6 | 5.8 | 9.5 |
| Real | 11.4 | 3.1 | 5.0 | 8.2 |
| Modified | 10.1 | 2.8 | 4.4 | 7.2 |

Rule: any text over the live universe sits on a scrim of at least α 0.72 (primary, secondary, brass, real) or 0.85
(tertiary, modified at small sizes), so it passes even if the Sun is directly behind it. Disabled text never sits on
the universe. 3D labels have no scrim; they carry the halo and the label manager keeps them off the solar disc.

## Surfaces

- **Scrim column**, the default for reading. No box, just a gradient from the screen edge that holds α ≥ 0.74 across
  the whole text column: `linear-gradient(90deg, oklch(0 0 0 / 0.88) 0, oklch(0 0 0 / 0.76) var(--column-w),
  oklch(0 0 0 / 0) calc(var(--column-w) + 200px))`. Mirrored for the ruler band; vertical for the bottom band.
- **Faceplate** for dense instruments (time control, lab panels, search, menus): `oklch(0.13 0 0 / 0.94)`, one
  hairline border, radius 2 px, no backdrop blur.
- **Popover and tooltip**: `oklch(0.17 0 0 / 0.98)`, radius 2 px.
- **No `backdrop-filter`.** It re-samples the live canvas every frame (costly on 4K exhibition displays), it is the
  generic premium-UI look, and over black space it adds nothing.
- **Radius hierarchy**: 0 for scrims and rules; 2 px for faceplates, cards and inputs; 999 px for chips, segmented
  selectors and the body-strip pill; 50% for circular transport buttons.
- **No drop shadows.** They do not read on black. Separation comes from hairlines and scrims.

## Line and mark language

- **Hairlines** are one device pixel, ink at 14–40% depending on role.
- **Provenance texture** wherever a line, frame or glyph represents data (UI, 2D charts, 3D overlays where provenance
  varies), following the geological-map convention: solid where located, dashed where approximate, dotted where
  conjectural.

  | Class | Line | Badge glyph |
  | --- | --- | --- |
  | Observed | Solid | Filled dot |
  | Derived | Solid with ring markers at computed points | Ring with centre dot |
  | Reconstructed | Dashed 9 / 6 | Dashed ring |
  | Illustrative | Dotted 1.5 / 5, round caps | Dotted ring |

  Hatching at −45° (5 px) marks hypothetical regions and appears only inside labs. Badges show glyph and word the first
  time a class appears in a view; dense fact grids may use the glyph alone with the legend within reach.
- **Corner brackets** mean "under observation": the selection reticle around the selected object (brass, 14 px arms,
  box never smaller than 28 px) and lab viewports (ink 60%). Never decoration on ordinary cards.
- **Réseau crosses** (+, 7 px, ink 10%, 48 px grid), after the fiducial crosses on Apollo Hasselblad frames, appear only
  in lab viewports and the ruler's measure mode.
- **Leader lines** for surface callouts: 1 px ink 40%, a 3 px anchor dot on the feature, a horizontal run to an
  edge-aligned label column. Occluded features hide. At most five at once.
- **Orbits**: 1 px hairlines. Planets ink 30%, minor bodies 18%, the focused body's orbit brass 70%. Density fades in
  screen space. No glow.
- **Slide-rule ticks**: a major tick at each power of ten, minor ticks at 2–9 spaced logarithmically, so tick density
  itself shows the scale. Used by the Cosmic Ruler, log sliders in labs and log chart axes.

## Composition and camera framing

- **Inspect framing**: body centre at 0.60 W and 0.50 H, between the reading column and the ruler band; apparent
  diameter 0.80–0.92 H. The disc never passes under the reading column. It may pass under the ruler band only while
  that band's scrim holds α ≥ 0.72.
- **Approach geometry**: the default approach puts the camera at a Sun–body–camera phase angle of 50–70°, so the
  terminator is visible. Relief reads in the shadows and the body reads as a sphere, with the light still true.
- **Horizon shot** for Earth and the cold open: camera near 400 km altitude looking along the limb, the planet filling
  the bottom 35–45% of the frame.
- **Scale shots** are deliberate: a tiny body in an empty frame only when the point is scale, and then the ruler is
  prominent.
- Text never sits over a bright limb; a hero body is never centred behind the reading column.

## Layout

Reference 1920 × 1080. Regions: top band 48 px; left reading column 440 px; right ruler band 160 px; bottom band 72 px;
the universe everywhere else.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Milky Way / Solar System / Earth / Moon                       Search    Menu │
│                                                                       10¹⁰ ┤ │
│ ─── Natural satellite of Earth                                             ┤ │
│ Moon                                   ( body framed at 0.60 W )      10⁹  ┤ │
│ Two-sentence lede                                                          ┤ │
│                                                                      ━━━━●   │
│ Mean radius       Distance from Earth                                 10⁸  ┤ │
│ 1,737.4 km        384,400 km                                               ┤ │
│                                                                   10⁸ m     │
│ What  Where  How far  How do we know  What can I do                         │
│ ‹ Earth     Mercury  Venus  (Earth)  Mars  Jupiter …     Mars ›   ▶  1 day/s │
└──────────────────────────────────────────────────────────────────────────────┘
```

Below 900 px wide the inspector becomes a bottom sheet (title at 44 px), the ruler becomes a horizontal strip under the
top band, and the body strip scrolls.

## Components

**Inspector plate** (refs 01, 02, 03). The focus chain as a slash-separated breadcrumb whose segments zoom out. A
classification line (real taxonomy: "Terrestrial planet", "M5.5 V red dwarf", "Barred spiral galaxy") led by a 40 px
rule drawn in the object's position-provenance texture. The name in Atlas. A lede of at most two sentences. A two-column
fact grid with the label above the value. Identifiers in Catalogue. Then five sections answering What, Where, How far,
How do we know and What can I do. They are not a sequence, so they are not numbered. Visuals that are illustrative say
"Illustrative" in words next to the name.

**Cosmic Ruler** (the bold element). A vertical slide-rule scale in the right band from 10⁰ to 10²⁷ m. A brass cursor
marks the camera's distance to its focus. Landmarks are labelled in Instrument (Moon's distance, 1 AU, the heliopause,
Proxima Centauri, the Galactic Centre, Andromeda, the CMB). While travelling, the magnitude appears in `--type-ruler`
(an homage to the Eameses' *Powers of Ten*) with a plain-language line beneath ("4.24 light-years from the Sun"). At
rest it shrinks to `--type-ruler-rest`. Clicking a landmark travels there; arrow keys step a decade; measure mode adds
réseau crosses and a two-point readout.

**Body strip** (ref 03). The bodies of the current system along a log-distance axis, so the strip doubles as a ruler.
Spacing falls back to even when labels would collide. The focused body sits in a pill; previous and next carry their
names ("‹ Earth", "Mars ›").

**Feature callouts** (ref 04). Surface features from the IAU planetary nomenclature (craters, maria, landing sites)
connected by leader lines to an edge-aligned label column. A red Moon appears only during a real lunar eclipse.

**Selection reticle** (ref 09). Four brass corner brackets around the selected object's screen bounds.

**Lab** (refs 06, 09). The left column holds Real state and Variables (log sliders use slide-rule ticks). The
Visualization sits in a bracketed viewport with réseau crosses. The Result reads in Experiment type, with a Real /
Modified / Difference row beneath in blue, orange and ink. Explanation and Assumptions open as sections. "Reset to real
data" is always visible.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ Debris lab / Low Earth orbit                                 Reset to real data │
│ Real state            ┌                                                  ┐   │
│ (catalog values)       +        +        +        +        +                 │
│ Variables              +   visualization: live view or chart         +        │
│ Launch rate  ──●───    +        +        +        +        +                 │
│ Mitigation   ────●─   └                                                  ┘   │
│                         Chance of a catastrophic collision, 10 years          │
│ Assumptions             3.1%                                                   │
│ Explanation             Real 1.2%     Modified 3.1%     Difference +1.9 points │
└──────────────────────────────────────────────────────────────────────────────┘
```

(The figures above show layout only; they are not data.)

**Composition tiles** (ref 06). Periodic-table-style tiles for measured composition only: a planet's atmosphere, a
JWST transmission-spectrum detection. Each shows the formula large, the abundance, the provenance glyph and the
reference. No tile without a source.

**Tour chapter** (refs 02, 04, 08). Chapters are a true sequence, so they are indexed, by their order of magnitude
("10⁷ m") instead of 01 / 02. The title is in `--type-atlas-l` with one to three lines of narration in `--type-lede`.
Progress shows as ticks on the Cosmic Ruler. In exhibition mode "Return to demo" is always on screen.

**Spectral bands**. A segmented control in wavelength order (radio to gamma) on a log-wavelength axis, matching the
ruler. The active survey's name and band appear beneath in Instrument.

**Time**. Date and time in tabular Instrument, the rate in words ("1 day per second"), a circular play/pause button
and "Now".

**Search**. A faceplate palette at top centre. Results show the name in Instrument, the classification and distance in
secondary ink, and identifiers and aliases in Catalogue ("Polaris", "α Ursae Minoris", "HIP 11767").

## Motion

- The camera is the motion. The UI moves only in answer to the visitor. The inspector slides 24 px and fades in
  (200 ms, ease-out) on selection. The reticle contracts from 1.3× to 1× (200 ms). The ruler's exponent rolls when it
  changes (160 ms). Lab results count to the new value (at most 400 ms).
- **One orchestrated moment**: the cold open. Black, stars fade in, Earth's limb rises with the sunrise along the
  terminator, the title appears in Atlas, then "Touch to begin".
- **Reduced motion** (OS setting or in-app): camera travel becomes a cut with a 300 ms crossfade, no rolls or
  count-ups, static grain.

## Texture and post-processing

- Filmic tone mapping (AgX) that keeps true black.
- Blue-noise dithering always, to stop banding in dark gradients. Visible grain at most 1.5% luminance, attenuated in
  highlights, static under reduced motion.
- Bloom only from physically bright sources, thresholded above display white, never on UI.
- No lens flares, chrome gradients or neon glow.
- Wireframe meshes only when they are a real surface: the spacetime embedding in the relativity lab, potential wells,
  terrain from elevation data.

## Voice

- Plain, specific, active, sentence case. No exclamation marks. No "stunning", "amazing" or "incredible".
- Numbers carry units and honest precision. Give students comparisons: "about a quarter of Earth's width".
- Buttons say what happens: "Fly to Mars", "Reset to real data", "Return to demo". No trailing arrows.
- Errors say what happened and what happens next: "Couldn't load the Gaia star tiles. Showing the bright-star catalogue
  instead."

## Do and don't

Do

- Frame bodies like an editor: large, off-centre, lit by the real Sun, terminator in view.
- Set real names in Atlas and let them be big.
- Draw anything that spans decades on slide-rule ticks.
- Encode provenance in texture, and say "Illustrative" in words when a visual is.
- Keep one brass element per view, plus keyboard focus.

Don't

- Frosted-glass panels, neon outlines, glow, lens flares, chrome or gradient type.
- Barcodes, fake telemetry, random coordinates, or wireframes that are not a real surface.
- All-caps labels, tracked-out eyebrows, middle-dot meta strings, arrows on buttons.
- 01 / 02 numbering on things that are not a sequence.
- Text on a bright limb or the Sun without a scrim.
- Emoji or cartoon icons. Lucide icons at 1.5 px stroke, always with a text label in exhibition mode.

## Acceptance checks

Reviewers run these against `sandbox/style.html` (a specimen built from `tokens.css`) and the live app.

1. The computed font of the inspector title and tour titles is Bodoni Moda Variable, of lab results Mona Sans Variable,
   of identifiers JetBrains Mono, and of everything else Inter Variable.
2. `grep` finds no `text-transform: uppercase` and no `backdrop-filter` in `src/`.
3. Rendering the HUD over a pure-white canvas, every text run keeps at least 4.5:1 contrast (axe or pixel sampling).
4. Every rendered Fact shows a provenance glyph. Every illustrative visual shows the word "Illustrative".
5. Hit targets are at least 44 px (56 px in exhibition mode).
6. With reduced motion emulated, no CSS transition exceeds 0 ms except the camera crossfade.
7. The specimen shows all four voices, the ink ramp, provenance textures, the ruler, the reticle and a lab card;
   screenshots are compared before and after visual changes.

## Fonts to bundle (offline, all SIL OFL 1.1)

| Package | Import | Covers |
| --- | --- | --- |
| `@fontsource-variable/bodoni-moda` | `opsz.css`, `opsz-italic.css` | Latin, Latin Extended, math (α–ω), symbols |
| `@fontsource-variable/inter` | `opsz.css` | Latin, Greek, Cyrillic |
| `@fontsource-variable/mona-sans` | `wdth.css` | Latin, Latin Extended |
| `@fontsource/jetbrains-mono` | `400.css`, `500.css` | Latin, Greek, Cyrillic |

## Changes to `src/styles/tokens.css`

1. Add `--font-atlas: 'Bodoni Moda Variable', 'Bodoni Moda', Didot, serif;` and
   `--font-experiment: 'Mona Sans Variable', 'Mona Sans', var(--font-ui);` next to `--font-ui` and `--font-mono`.
2. Replace the 21 px inspector name (`--fs-2xl`) with the Atlas tokens above; add the Experiment and ruler tokens.
3. `--text-primary` 0.965 → 0.93; secondary 0.80; tertiary 0.70.
4. `--panel-blur: none` everywhere. Panels become faceplates at α 0.94. Add `--scrim-left`, `--scrim-right` and
   `--scrim-bottom` gradients.
5. Radii: panels, cards and inputs 2 px; keep the pill; add `--r-round: 50%`.
6. Provenance badges become monochrome glyphs (table above); keep the provenance hues for charts only. Line styles stay
   as they are (observed and derived solid, reconstructed dashed, illustrative dotted).
7. `--cosmos-label-size` 12 → 13 px.
