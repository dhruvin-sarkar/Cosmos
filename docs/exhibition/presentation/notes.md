# Cosmos · speaker notes

15 slides, about 973 words: roughly 7–8 minutes at a calm speaking pace. Generated from the deck (`deck/index.html`, the `<aside class="notes">` of each slide) by `build/render.mjs`; edit the deck, not this file.

## 1. Cosmos

Good morning. We built Cosmos: a way to fly, in one unbroken move, from the International Space Station to the oldest light in the universe. Everything you will see today is running live in a browser on that laptop, from real, public data.

## 2. The problem

The trouble with space is scale. The space station is 109 metres long. The farthest thing we can see, the cosmic microwave background, is about 45 billion light-years away. That is twenty-five powers of ten. A page in a textbook can show maybe two before things shrink to nothing or fall off the edge, so diagrams squash everything together and the feeling of distance is lost.

## 3. What Cosmos is

Cosmos is a 3D explorer that keeps one continuous camera across all of those scales, and puts each object where the data says it is right now: the planets from ephemeris formulas, and 31,800 satellites propagated from this week's orbital elements. Click anything and every number tells you how we know it. It runs offline: all 76 datasets are on the laptop.

## 4. The journey: home to the heliopause

This is the golden journey: 23 chapters, about nine minutes. We start 400 kilometres up at the space station, step out to the Moon at 384,400 kilometres, then the Sun at one astronomical unit, Jupiter at 5.2 and Saturn at 9.5 AU. Then we look back from Voyager 1, 172 AU out: its radio signals now take almost a full day to reach us.

## 5. The journey: to the oldest light

Then we leave. The Oort cloud, which nobody has ever seen, so it is marked illustrative. Proxima Centauri at 4.25 light-years, and TRAPPIST-1 with its seven rocky planets at 41. The Milky Way, with the Sun 27,000 light-years from the centre and a black hole of 4.3 million Suns waiting there. Andromeda at 2.5 million light-years, 2.2 million real galaxies of the cosmic web, and finally the cosmic microwave background: light that has travelled for 13.8 billion years.

## 6. Science and provenance

We care about how we know. Everything here comes from 76 datasets, each with its date, licence and citation: tens of thousands of satellites and asteroids, over a hundred thousand stars, 2.2 million galaxies. Every value carries one of four marks: observed, derived, reconstructed or illustrative. Missing data says Unknown, never zero. And because a true-size Earth would be invisible from the outer planets, bodies are drawn larger by default. A label says so the whole time, and one click shows true scale.

## 7. Inside the Earth

Click inside a world and it opens as a cutaway. Earth's layers come from PREM, the reference model built from earthquake waves: a solid inner core 1,221 kilometres in radius, and a liquid outer core out to 3,480. We know it is liquid because shear waves cannot pass through it. The same view covers 18 bodies and 67 layers, every one cited from 50 references.

## 8. S2 and Sagittarius A*

At the centre of our galaxy, the star S2 orbits something invisible every 16 years, swinging past at 120 AU and 7,700 kilometres per second, 2.6 percent of the speed of light. Only a black hole of 4.3 million Suns fits. In the black hole lab you can watch the orbit turn by 12 arcminutes each loop, and see S2's light shifted by about 200 kilometres per second at closest approach: the relativity that won the 2020 Nobel Prize. Its next close pass is in 2034.

## 9. Ray-marched black holes

To show a black hole we do not paint it, we trace light. The shader marches rays past the hole and bends the real sky behind it, which gives the dark shadow, the photon ring and Einstein rings, like this one around Gaia BH1. The glowing disc is illustrative and labelled that way; the bending is computed. All of this costs under four milliseconds a frame on our Balanced setting.

## 10. Exoplanets and habitability

We include every one of the 6,451 confirmed exoplanets. The habitability lab asks whether a world could keep liquid water. It reproduces Earth: 255 kelvin without an atmosphere, 288 with one. And it places TRAPPIST-1 e inside its star's conservative habitable zone, as the published studies do. The planet surfaces are artist's impressions, and the app says so.

## 11. The labs

Two more labs. The debris lab starts from the real catalogue and shows what policy does over a century: business as usual reaches about 583,000 objects by 2126, while stopping launches leaves about 25,000. The deflection lab replays NASA's DART impact. Our model gives a 33.3 minute change in Dimorphos' orbit; NASA measured 33.0, plus or minus one. These are teaching models, and each one says so on screen.

## 12. Engineering

Under the hood: a 32-bit float cannot hold a 109-metre station and a 45-billion-light-year shell, so positions stay in 64-bit, the camera always sits at the origin, and a logarithmic depth buffer keeps near and far in order. Textures stream as compressed KTX2 under a memory budget, which nearly halved video memory, from 1,155 to 603 megabytes. Heavy work runs in background workers. On the stand's RTX 3050 laptop, 22 of the 23 chapters ran at 97 to 100 frames per second, and the slowest at 65.

## 13. Accessibility and kiosk mode

It is built for an exhibition floor. A kiosk address starts it with large type and touch targets. Every chapter, planet and moon has a key, and reduce-motion turns flights into crossfades. Quality adapts to hold 60 frames per second. And it never touches the internet; we have a test that proves it.

## 14. What we learned

What did we learn? Precision is a design problem. Honesty needs interface, not footnotes. Test against published numbers: 635 tests check things like the DART result and S2's orbit. Measure before you optimise; the profiler found a stall we never would have guessed. And none of this exists without open data from NASA, ESA, USGS, NOAA, CelesTrak and many survey teams.

## 15. Thank you

Thank you. Scan the code to fly it yourself on your phone or laptop, or come and press T at our stand. We are happy to take questions.
