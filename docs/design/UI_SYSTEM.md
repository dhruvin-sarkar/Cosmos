# UI system

The interface layer of Cosmos: type, colour roles, spacing, radii, elevation, motion, icons, states, density and the
lock-on cursor. [VISUAL_DIRECTION.md](VISUAL_DIRECTION.md) stays authoritative for the look of the universe, the
Cosmic Ruler, labs and provenance; this document is the component-level system that implements it. Tokens live in
`src/styles/tokens.css`; the shell chrome in `src/styles/shell.css`; HUD panels in `src/styles/hud.css`; primitives in
`src/styles/components.css`. When a value here and a token disagree, fix the token.

## Intent

A scientific instrument laid over the sky, read standing 1–2 m from a 1920 × 1080 touchscreen and at arm's length on a
laptop. The universe supplies the colour and the drama; the UI is quiet ink, hairlines and one brass accent. It should
feel engraved and machined, never like a dashboard template: no gradients on controls, no glows, no frosted glass, no
drop shadows (they do not read on black), no emoji, no neon.

## Type

Four voices, all self-hosted under `public/fonts/` (`src/styles/fonts.css`, `font-display: swap`, latin + latin-ext
subsets plus Greek/Cyrillic fallbacks). The app works fully offline.

| Voice | Face | Speaks |
| --- | --- | --- |
| Atlas | Bodoni Moda Variable (opsz) | Names of real objects, tour chapter titles, panel titles, the ruler magnitude |
| Instrument | Mona Sans Variable, wdth 100 (Inter Variable fills Greek and Cyrillic) | Every other piece of interface text |
| Experiment | Mona Sans Variable, wdth 112–125 | Lab results and modified-scenario readouts |
| Catalogue | JetBrains Mono 400/500 | Literal identifiers only (NORAD 25544, HIP 71683), epochs, field names |

Why Mona Sans replaced Inter for Instrument: one family now carries both the instrument and the experiment voices (the
width axis is the switch between real and modified), its figures are wider and calmer at distance, and its grotesque
details pair with Bodoni's contrast without the "default web app" read of Inter. Inter stays in the stack only as the
Greek/Cyrillic fallback for Bayer letters.

Scale (reference 1920 × 1080; exhibition mode in brackets):

| Role | Size / weight | Use |
| --- | --- | --- |
| Atlas XL | clamp(72, 6.2vw, 128) / 400 | Inspector name |
| Atlas L | clamp(52, 4.2vw, 88) / 400 | Tour chapter title |
| Atlas M | 28–36 / 450 | Sheet and navigator titles |
| Lede | 19 (22) / 400, 1.5 | Inspector and tour narration |
| Body | 15 (18) / 400, 1.55 | Paragraphs, prose fact values |
| Value | 17 (21) / 500 | Fact values with units |
| Control | 14 (17) / 500 | Buttons, toolbar, strips |
| Label | 12.5 (15.5) / 450 | Fact labels, metadata, key hints |
| Overline | 11.5 / 500, +0.08em, uppercase | Group titles in the search palette only |
| Mono | 12.5 (15.5) / 400 | Identifiers |

Rules: numbers use tabular figures; never below 12 px on desktop or 15 px in exhibition mode; names are never
truncated (the inspector name steps its size down to fit); prose max 44–46 ch; `text-wrap: balance` on titles and
`pretty` on prose.

## Colour roles (dark only, true black)

| Role | Token | Notes |
| --- | --- | --- |
| Space | `--ink-space` #000 | The canvas; no UI surface is lighter than oklch 0.16 |
| Text | `--text-primary` 0.93 · `--text-secondary` 0.80 · `--text-tertiary` 0.70 | All ≥ 4.5 : 1 on capsules and plates |
| Hairlines | `--hairline` 14 % · `--hairline-strong` 26 % · `--hairline-bold` 40 % | Structure is drawn, not filled |
| Accent (brass) | `--accent` oklch(0.85 0.1 88) | Attention only: focus ring, selection, the current planet, the active tab, the primary action, paused time, the cursor |
| Real / Modified | `--real` blue · `--modified` orange | Labs only |
| Status | `--info` `--warning` `--danger` `--success` | Rare, as a 2 px mark, never a filled banner |

Brass on black is 11.9 : 1; secondary text on `--capsule` over a sunlit limb stays ≥ 4.6 : 1 because capsules are
84 % opaque.

## Spacing and layout

4 px grid (`--sp-1` … `--sp-16`). HUD gutter 24 px (20 below 1440, 16 below 1200).

- **Top band** (`--topbar-h` 64 / 76): breadcrumb top-left, search field top-centre with the **view-scale chip**
  beside it (src/ui/shell/ScaleChip.tsx: "Exhibition scale · Enlarged for visibility" with a dotted ring, or
  "True scale" with a solid ring; click toggles store.visualScale; always visible, the scientific-honesty disclosure
  of docs/design/VISUAL_SCALE.md; below 1200 px only "Enlarged for visibility" remains), then one toolbar capsule
  top-right in three groups (travel: Planets, What's up · view: Layers, Light, Tour ·
  utilities: Sources, Settings, Help).
- **Settings** also holds the view scale ("View scale": Enlarged for visibility / True scale, with a one-line explanation)
  and the full time controls ("Time": play/pause, the UTC date and clock, the rate stepper in words with reverse,
  Live/Now, Go to a date). Keyboard shortcuts (Space, comma, full stop, N) work everywhere; tours still drive time.
- **Time status chip** (`--timebar-h` 34 / 42 reserved) top-left under the breadcrumb, shown ONLY while the sky is
  not "now": paused ("Paused · 1990-02-14 06:17 UTC"), sped up or reversed ("1 day/s · 2027-03-02") or jumped. Clicking
  it opens Settings at Time (`openSettingsAt(store, 'time')`, src/ui/shell/settingsNav.ts). When live, nothing
  time-related is on screen.
- **Left column** (`--column-w` 440 / 380 / 340; labs `--lab-w` 520 / 460 / 420) starts at `--hud-top`: inspector,
  tour card, lab panels, navigator. Sits on an edge scrim, not a box. At < 1440 px the inspector's two long tab names
  set on two balanced lines so all five tabs stay visible; segmented-control labels never wrap.
- **Right edge**: the Cosmic Ruler (`--ruler-w`). Discreet when idle (dim, slim ticks, decade numbers only, small
  quiet readout, lighter scrim); bright with every landmark and the emphasised readout while the visitor zooms, hovers,
  drags or focuses it or the camera travels, easing back 1.5 s (`RULER_IDLE_MS`) after activity stops. Opacity and
  transform only; reduced motion swaps the states without easing.
- **Bottom band**: the planet rail (Sun excluded, prev/next steps naming the neighbours) and, centred above it, the
  satellite strip for the focused system. Both are bounded between the left column and the ruler, so nothing overlaps
  from 1280 to 3840 px; the toolbar sheds labels at < 1680 px and the rail sheds step names at < 1440 px.
- **Toasts** top-centre under the search field; the bottom band belongs to the rails.

## Radii (concentric)

| Token | Value | Use |
| --- | --- | --- |
| `--r-pill` | 999 | Floating instruments: toolbar, time capsule, strips, chips, segmented controls, search trigger |
| `--r-panel` | 14 | Popovers, palette, navigator, sheets, toasts, lab plates |
| `--r-plate` | 8 | Rows, inputs and cards inside a panel (panel radius minus its 6 px inset) |
| `--r-xs` | 4 | Key caps, small marks |
| 0 | — | Scrims, rules, the ruler |

## Elevation (with restraint)

Three levels, no blur, no shadows:

1. **On the sky**: type with `--text-halo` over edge scrims (inspector, tour, labels).
2. **Capsule** `--capsule` (0.11 @ 84 %) + `--edge` (1 px inner ring + 1 px top highlight): floating instruments.
3. **Plate** `--popover` (0.155 @ 97 %) / sheets (0.125 @ 98.5 %) + `--edge-strong`: anything you read at length.

Modal surfaces (palette, help) dim the scene with a 60 % black scrim; nothing re-samples the canvas.

## Motion

The camera is the motion; the UI moves only in answer to the visitor.

| Token | ms | Use |
| --- | --- | --- |
| `--dur-instant` | 80 | Press feedback |
| `--dur-fast` | 140 | Hover, colour |
| `--dur-base` | 200 | Popovers, tabs |
| `--dur-slow` | 320 | Panels, sheets, the rail, palette entrance |

Easings: `--ease-out` for entrances, `--ease-settle` (no overshoot) for panels and layout shifts. Entrances move at most
`--enter-shift` (24 px) plus opacity; nothing animates width/height/top/left except the bottom band's `left`, which
follows the column. Reduced motion (OS or Settings → `[data-reduced-motion]`) zeroes every duration, stops the boot
orbit and the cursor spin.

## Iconography

`lucide-react`, 1.5 stroke (`--icon-stroke`), 16 px in controls, 18 px in the palette and toolbar, `currentColor`.
Astronomy glyphs lucide lacks (asteroid, comet, debris, galaxy, black hole, station, habitable zone) live in
`src/ui/icons.tsx` and follow the same grid. Entity kinds map through `kindIcon()` / `kindLabel()`; provenance through
`PROVENANCE_ICON`. Icon-only buttons always carry `aria-label` and a tooltip with the shortcut.

## States

| State | Treatment |
| --- | --- |
| Rest | Secondary ink; capsule fill |
| Hover | Primary ink + `--surface-hover` (7 % white) |
| Pressed | `--surface-pressed` (12 %), `scale(0.96)` on round transport buttons |
| Selected / current | Brass: ring on the rail mark, inset 2 px bar in lists, 2 px underline on tabs, brass name |
| Open (toolbar toggle) | `--surface-active` + primary ink |
| Focus (keyboard) | 2 px brass ring, 2 px offset, `:focus-visible` only |
| Disabled | `--text-disabled` on solid backgrounds; never the only signal |
| Unknown value | The word "Unknown" in tertiary ink, never 0 or a dash |

## Density

- **Desktop** (default): 44 px hit targets, 14 px controls, 15 px body.
- **Exhibition** (`[data-exhibition='true']`, Settings → Kiosk sizing, or the kiosk URL flag): Instrument sizes × 1.25,
  body ≥ 18 px, 56 px targets, taller top band, time chip and rail. Designed to be read from 1–2 m.
- Touch kiosks keep native pointer behaviour (no custom cursor, see below).

## Lock-on cursor

`src/ui/cursor/TargetCursor.tsx` is a TypeScript port of React Bits' `<TargetCursor />` (React Bits by David Haz,
reactbits.dev, MIT + Commons Clause; credited in Sources → Interface credits). `CosmosCursor.tsx` configures it once
in the app shell:

- Thin WHITE corner brackets (`thickness 1.5`, `cornerSize 8`, `size 28`, `padding 6`, `dotSize 3`), each drawn
  twice: a 1 px dark outline (::before) under the white stroke (::after), so they read over black space and over a
  sunlit limb. No blend modes and no CSS filters: over a full-screen WebGL canvas either forces an extra composite every
  frame.
- Main-thread budget < 0.2 ms per frame (measured with .work/ui/cursor-trace.mjs: mean ≈ 0.11-0.14 ms including the
  pointer handlers, no forced layout inside the frame, updated on every displayed frame). The frame only writes
  transforms and opacity; bracket geometry and lock colour are custom properties/classes written when the lock state
  flips. A static target's rect is cached (re-measured on lock, scroll, resize, ResizeObserver size change, and the
  end of its CSS transitions/animations); a moving 3D label is followed by reading the engine's inline translate3d as
  an offset from the rect measured at lock time. Pointer coordinates come from `pointerrawupdate` where available.
- Roaming brackets are glued to the pointer (no follow lag); a 40 ms critically damped catch-up after leaving a
  target. Calm 6 s spin while roaming, 0.16 s snap onto targets, parallax, `matchRadius` (brackets follow the target's radius),
  click squeeze, and a label above locked targets ("Fly to Mars").
- Targets: any element with class `cursor-target` (all `Button`/`IconButton`s, toolbar, breadcrumb, time chip,
  rail and strip items, search rows, navigator rows) plus the engine's DOM body labels. `data-cursor-label` overrides
  the label; 3D labels get "Fly to <name>" unless they only name a region.
- Only for fine pointers with hover (`(hover: hover) and (pointer: fine)`); touch keeps native behaviour. Reduced
  motion removes the spin and makes snaps instant. Idle (no movement) costs no frames: the rAF loop stops once springs
  settle. Dragging the 3D view (`.cx-viewport`) shows a small plain reticle that never spins or snaps.

## Accessibility floor

Visible keyboard focus everywhere; every control reachable by keyboard (Tab order follows the visual bands:
breadcrumb → time chip (when shown) → search → toolbar → column → strips); dialogs trap focus and return it to their trigger; contrast
AA for all text; reduced motion honoured; targets ≥ 44 px (56 px in exhibition mode); live regions for the tour and
toasts; the custom cursor is decorative (`aria-hidden`) and never replaces focus indication.
