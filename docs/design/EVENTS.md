# What's up: sky events you can fly to

The "What's up" panel lists real sky events in the 24 months after the app time. Each event has a one-line
explanation, a note for the visitor's location, and a **Show me** button. Show me jumps the clock to the moment,
pauses there, and flies the camera to a view where the event is visible.

## Files

| Path | Role |
| --- | --- |
| `src/science/events.ts` | Pure computation (astronomy-engine and satellite.js). No DOM, no engine. |
| `src/science/events.test.ts` | Reference values: NASA eclipse catalogue, USNO seasons, IMO shower dates. |
| `src/ui/events/SkyEvents.tsx` | `<SkyEvents />`: the top-bar button, the panel and the caption card. |
| `src/ui/events/showMe.ts` | Turns an event's camera hint into a `CameraViewState` and flies there. |
| `src/ui/events/state.ts` | Panel-local state (open, observer in localStorage, shown event). |
| `src/ui/events/events.css` | Styles (faceplate, hairlines, 44 px targets; brass only on the expanded row's Show me). |
| `sandbox/sky-events.html` | Full app plus the panel; `window.__skyEvents.open()`, `.show(id)`, `.list()`. |

## What is computed

| Kind | Method | Window |
| --- | --- | --- |
| Solar eclipses | `SearchGlobalSolarEclipse` (greatest eclipse time and place); `SearchLocalSolarEclipse` for the visitor's view. Path countries and longest duration come from the NASA decade table. | 24 months |
| Lunar eclipses | `SearchLunarEclipse`; phase durations from the shadow semi-durations; Moon altitude at mid-eclipse for the visitor. | 24 months |
| Oppositions | `SearchRelativeLongitude(body, 0)` for Mars to Neptune (heliocentric relative longitude 0 means opposition). | 24 months |
| Greatest elongations | `SearchMaxElongation` for Mercury and Venus. | 24 months |
| Conjunctions | Daily scan of geocentric separations for Mercury, Venus, Mars, Jupiter and Saturn, then golden-section refinement to one minute. Reported under 2.5° and at least 12° from the Sun. | 24 months |
| Meteor showers | Ten major IAU showers. The peak is found with `SearchSunLongitude` at the IMO solar longitude, precessed from J2000 to the equinox of date. Moon phase at the peak is included. | 24 months |
| Equinoxes and solstices | `Seasons(year)`. | 24 months |
| ISS passes | SGP4 (satellite.js) from the orbital domain's CelesTrak snapshot, scanned every 30 s, maximum refined to 1 s. A pass counts as visible when the station is sunlit (cylindrical shadow) and the Sun is below −6°. Magnitude uses the −1.8 standard magnitude with a diffuse-sphere phase law. | 7 days, only within 14 days of the element epoch |

Accuracy, checked in tests: eclipse times of greatest eclipse are within 60 s of NASA (TD, all ten events from
2027 to 2028). The greatest eclipse of 2 Aug 2027 is placed at 25.5° N, 33.2° E (NASA gives 25°29′ N, 33°13′ E).
Seasons are within 2 min of USNO.

## Show me

| Event | View |
| --- | --- |
| Solar eclipse | Earth from the Sun's side, straight down the shadow axis (the DSCOVR view). The Moon's umbra and penumbra sit mid-disc. Switches to **true scale**, because eclipse shadows are only drawn with Earth and Moon at real size. The caption says so, and closing it restores the previous scale. |
| Lunar eclipse | The Moon seen from the Earth side, filling 60% of the frame, red in the umbra. Also switches to true scale. |
| Conjunction, opposition, elongation, meteor shower | Low orbit (1.12 R⊕) over the night or twilight side, looking along the target direction. Earth's limb is along the bottom and the targets sit just above it. For showers the camera looks at the radiant. |
| Equinox or solstice | Earth side-on to the Sun with ecliptic north up, so the terminator shows the axial tilt. |
| ISS pass | Behind the station, looking down past it toward the visitor's city. |

The clock is paused at the event. **Play** resumes it, so visitors can watch the Moon's shadow cross Earth.

## Mounting

`<SkyEvents />` renders a `cx-bar-btn` button labelled "What's up". The panel and caption are `position: fixed`, so the
component can sit anywhere inside `<AppContextProvider>`. The intended mount is one line in `TopBar`'s right-hand group,
next to `<NavigatorButton />`. Opening the panel closes the navigator; both use the same top-left slot.
