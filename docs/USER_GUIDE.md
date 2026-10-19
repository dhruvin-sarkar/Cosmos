# Cosmos user guide

Cosmos starts at Earth. You can drag, scroll and click, or let a tour fly you around. Press `?` at any time to open the Help panel, which lists the same keys as this page.

## Moving around

| Action | Mouse or touch |
| --- | --- |
| Orbit around what you are looking at | Drag |
| Zoom (the scale changes by many powers of ten) | Scroll, or pinch |
| Pan | Right-drag, or two-finger drag |
| Select an object (opens the inspector) | Click |
| Fly to an object | Double-click it, or click its label |
| Scrub through scale | Drag the Cosmic Ruler |

Camera modes are *orbit* (default), *free* and *follow*. Press `F` with an object selected to follow it. Flights ease in and out and approach with the Sun lighting part of the body.

## Keyboard

Keys are ignored while you type in a text field.

**Travel**

| Key | Action |
| --- | --- |
| `B` | Solar System navigator |
| `0` | The Sun |
| `1` to `8` | Mercury to Neptune (`9` is Pluto) |
| `[` and `]` | Previous or next moon of the current planet |
| `Shift+[` and `Shift+]` | Previous or next planet |
| `H` | Home (Earth) |
| `Backspace` | Go back |
| `F` | Follow the selected object |

**Search and panels**

| Key | Action |
| --- | --- |
| `Ctrl+K` or `/` | Search |
| `Esc` | Close the top-most panel, then the lab, then clear the selection |
| `?` | Help |
| `` ` `` | Debug readout (frame rate, memory) |
| `Shift+H` | Hide or show the whole interface |

**Time**

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `,` and `.` | Slower or faster (steps from 1 second per second up to 10 million, forward or backward) |
| `N` | Jump to now |

**View**

| Key | Action |
| --- | --- |
| `L` | Labels |
| `O` | Orbits |
| `C` | Constellations |

**Tour**

| Key | Action |
| --- | --- |
| `T` | Start or exit the tour |
| `Left` and `Right` arrows | Previous or next chapter |
| `R` | Restart the current chapter |

## The top bar

- **Breadcrumb** (left): where you are, for example Solar System, Jupiter, Io.
- **Search**: finds planets, moons, asteroids, spacecraft, satellites, stars and constellations.
- **Scale pill**: shows "Exhibition scale, Enlarged for visibility" or "True scale". Click to switch. See below.
- **Navigator**: a tree of the Solar System. Click a planet to fly there; moons appear in a strip. Moons are reachable one by one.
- **Layers**: switches for labels, orbits, satellites, debris, spacecraft, asteroids, constellations, equatorial, ecliptic and galactic grids, habitable zones, and the Milky Way reconstruction.
- **Light**: choose a wavelength band for the sky (see below).
- **Tour**: starts the guided tour.
- **Sources**: every dataset with version, retrieval date, licence, citation and limitations.
- **Settings**, **Help**.

## Exhibition scale and true scale

Real planets are tiny compared with the distances between them. If everything were drawn at true size, planets would be invisible dots from far away. By default Cosmos draws bodies larger than life, then shrinks them smoothly to true size as you come within about 40 radii of the body. Distances between objects never change. Moons, rings and satellites are moved outward with their planet so that they never sit inside the enlarged body. The pill stays visible so nobody mistakes the drawing for a to-scale picture. Choose **True scale** to see real proportions; from the inner Solar System the planets then become very small.

## Reading the inspector

Click an object to see its fact sheet. Each value has a mark showing where it came from:

- **Observed**: measured.
- **Derived**: computed from observed values by a stated model.
- **Reconstructed**: inferred from data, for example the heliosphere shape fitted to Voyager crossings.
- **Illustrative**: drawn for clarity, for example a plume, an irregular moon shape without a survey, or the Oort cloud.

Hover a mark to see the source. A missing value is shown as "Unknown".

## Light bands

The **Light** menu changes the all-sky background to other wavelengths: visible, near-infrared, mid-infrared, far-infrared, submillimetre, microwave, radio, hydrogen-alpha, neutral hydrogen, ultraviolet, X-ray (ROSAT and eROSITA), gamma ray and the cosmic microwave background. Each band shows a caption with the survey, instrument and what it reveals.

## Labs

Labs open from a button in the inspector. The debris lab is offered for satellites, the ISS and other tracked Earth-orbit objects; the deflection lab for Didymos, Dimorphos, Apophis and 2024 YR4. Press `Esc` to close a lab.

**Orbital debris lab.** Shows the 29,408 tracked objects in low Earth orbit by type, and a chart of objects per 50 km of altitude. Choose a policy scenario, solar activity, the number of debris removals per year and the time horizon. Views: Growth (log-scale lines for each scenario), By altitude (heat map), Around Earth (a density glow with a year slider), and Breakup (the Iridium 33 and Cosmos 2251 collision, or the Fengyun-1C test). The result and a side-by-side table update as you change inputs. The future is a simplified model; the lab says so.

**Asteroid deflection lab.** Two parts.
1. *DART replay*: a 3D replay of the impact on 26 September 2022, in three chapters (Approach, Impact and ejecta, Orbit change), with a scrubber. You can change the momentum enhancement factor beta, spacecraft mass, impact speed and Dimorphos density, and see the effect on the orbit period.
2. *Defend Earth*: a hypothetical scenario. Set the asteroid size and density, the warning time, and the impactor mass, speed and beta. The lab shows the miss distance against Earth's capture radius, success probability from a Monte Carlo run, and a plain-language verdict. No real asteroid is predicted to hit Earth in this scenario.

## Tours

Press `T` or use the Tour button.

- **The golden journey** (default): 20 chapters from Earth to Voyager 1: Earth, the ISS, orbital debris, the Moon, the Sun, Mercury, Venus, Mars, Ceres, DART, Jupiter, Io, Europa, Saturn, Titan, Enceladus, Uranus, Neptune, Pluto, and a look back from Voyager 1. Each chapter has narration with sources.
- **Quick tour**: six chapters in about three minutes: Earth, the ISS, the Sun, Jupiter, Saturn, and the view from Voyager 1.

Use the arrow keys to move between chapters; any drag or scroll lets you explore, and `R` returns to the chapter's view. `T` exits.

## Settings

- **Graphics quality**: Auto, Performance, Balanced or Ultra. Auto lowers detail to hold 60 frames per second. Ultra loads the 8K textures for the focused body.
- **Label density**.
- **Reduce motion**: camera travel becomes a short crossfade.
- **Sound**: quiet interface sounds.
- **Exhibition mode**: larger type and touch targets for a standing audience.

## Troubleshooting

- *Black or slow screen*: open Settings and choose Performance. Check that the browser uses the discrete GPU.
- *An object is missing*: check Layers (satellites, debris, asteroids and spacecraft are separate switches).
- *Time is stuck*: press `Space` to unpause, or `N` for now.
- *Panels in the way*: `Shift+H` hides the interface.
