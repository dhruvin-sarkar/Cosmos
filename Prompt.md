# Cosmos / AstroNexus: Deep Research Brief and Master Context Prompt for Claude Opus 5.5

## Research synthesis

The strongest version of this project is not simply a larger Solar System Scope. It is a **multi-scale scientific universe explorer, visualization engine, interactive simulation laboratory, and STEM education platform** that lets a user move continuously from Earth to the observable universe while preserving scientific provenance, visual quality, intuitive navigation, and meaningful interaction.

Solar System Scope is a good interaction reference because it presents a real-time 3D model of the Solar System and night sky, including planets, dwarf planets, comets, stars, and constellations, while using NASA-derived planetary data and orbital information. citeturn0search0turn0search10 But there are substantially more ambitious systems worth treating as architectural references.

OpenSpace is particularly relevant. It is an open-source astrovisualization system designed around real scientific data, and explicitly supports visualization from spacecraft-scale environments through galactic structure and outward toward the observable universe. Its catalog ecosystem already demonstrates confirmed exoplanets, quasars, small bodies, Planck Cosmic Microwave Background data, and other astronomical datasets. citeturn10search0turn10search4turn10search8 WorldWide Telescope is another important reference because it focuses on navigating and storytelling across scientific astronomical datasets, while providing web, JavaScript/TypeScript, Python, and desktop tooling. citeturn0search2turn0search9turn11search5 NASA's Eyes demonstrates another piece of the target experience: an accessible browser-based 3D Solar System that combines NASA mission data, spacecraft, planets, moons, asteroids, comets, and controllable time. citeturn15search1turn15search5turn15search17 Universe Sandbox contributes the interaction philosophy, where gravity, collisions, climate, and planetary properties become things the user can manipulate rather than merely read about. citeturn10search3

The most useful product synthesis is therefore:

> **Solar System Scope accessibility + OpenSpace scale and scientific grounding + WorldWide Telescope survey visualization + NASA Eyes mission data + Universe Sandbox experimentation, wrapped in a substantially more coherent modern UI/UX and designed specifically for learning.**

That distinction matters for SCI-FORGE. The project becomes much more compelling when judges do not merely see an impressive model of the universe. They should be able to **perform experiments inside it**, understand the underlying science, modify variables, observe consequences, compare results against real missions and measurements, and move between physical scales without losing context.

### Important research-driven corrections

Several parts of the initial concept should be upgraded before they become architectural assumptions.

| Initial idea | Research-backed refinement |
|---|---|
| "30,000+ tracked debris objects" | Use a live or versioned count rather than hard-coding 30,000. ESA reported roughly 40,000 tracked space objects in its 2025 environment report, with roughly 11,000 active payloads. citeturn1search1 |
| Store orbital debris as ordinary TLEs | Do not make legacy TLE the canonical architecture. CelesTrak reported that five-digit catalog identifiers were exhausted on July 11, 2026, and its current formats support larger catalog numbers through newer representations. citeturn1search14turn1search23 |
| ESI = habitability | ESI is an Earth-similarity metric, not evidence that a planet is habitable. That distinction should be explicit in the UI. citeturn14search1turn14search18 |
| Planet color directly proves climate | Equilibrium temperature is an informative approximation whose assumptions include radiative balance and choices about albedo and heat redistribution. Atmospheric composition, clouds, circulation, greenhouse effects, and other physics require richer models. citeturn18search12turn18search15turn18search13 |
| "Render every star as a 3D sphere" | Multi-billion-object catalogs demand hierarchical representations. Distant objects should become points, sprites, aggregates, density fields, tiles, or other representations and refine as needed. This is the same fundamental reason HLOD systems exist for massive spatial datasets. citeturn16search2turn16search10turn17search1turn17search2 |
| One global coordinate system | Cosmic scale requires hierarchical coordinate frames and precision management. Existing large-scale astronomical visualization systems explicitly address double precision and scale-related rendering concerns. citeturn10search9 |
| Gaia DR4 should be the catalog | As of October 16, 2026, Gaia DR4 is still scheduled for December 2, 2026. Build around currently available Gaia data and create an ingestion adapter so DR4 can replace or supplement it when released. citeturn3search0turn3search18 |
| Scrape astronomy sites directly | Prefer official APIs, archival standards, catalog services, and versioned datasets. NASA Exoplanet Archive, JPL services, SIMBAD, NED, SPICE, HiPS, Space-Track, and comparable services already provide structured scientific information. citeturn2search2turn15search2turn5search11turn1search2 |

There is also a conceptual limit worth making explicit: **no application can contain a literal object-by-object model of "everything in the universe."** Astronomy does not provide that information. A scientifically honest universe explorer therefore needs multiple data classes rather than pretending generated content is observation.

The ideal distinction is:

**Observed** means directly represented by a catalog, survey, mission, or measurement.

**Derived** means calculated from measured quantities using a documented physical model.

**Reconstructed** means a spatial or visual representation inferred from scientific data.

**Illustrative** means procedural or artistically generated context used where observations cannot specify an object's exact appearance or location.

That provenance should be visible to the user. A beautiful procedural planet should never silently masquerade as a directly imaged exoplanet.

## Scientific and data foundation

The project becomes feasible when the universe is treated as a **federation of scientific datasets at different scales**, rather than one enormous database.

### Earth and orbital space

For Earth orbit, the application should separate active spacecraft, rocket bodies, debris, stations, and illustrative objects. ESA's 2025 environment reporting placed the tracked population at about 40,000 objects while also stressing that far larger populations of smaller fragments exist below routine tracking thresholds. NASA likewise notes that enormous numbers of smaller debris objects cannot all be individually tracked yet remain capable of spacecraft damage. citeturn1search1turn1search12

Space-Track exposes programmatic orbital data and publishes API usage limits. CelesTrak offers another widely used distribution route and has updated its formats as catalog numbers exceed the traditional TLE identification range. citeturn1search2turn1search14turn1search17turn1search23

The exhibit should therefore use a pipeline resembling:

**orbital catalog source → normalized orbital records → SGP4 or appropriate propagator → Earth-centered inertial coordinates → renderable object stream → selectable scientific metadata**

Orbital decay should not be presented as perfectly deterministic. Atmospheric density, solar activity, attitude, area-to-mass ratio, drag coefficient, maneuvering, and incomplete object properties introduce uncertainty. The simulation can offer an educational approximation while identifying its assumptions.

The proposed Kessler Syndrome experience becomes stronger if it includes both a real catalog mode and a sandbox mode. The real mode shows observed tracked populations and orbital shells. The sandbox mode lets students deliberately increase debris density, create fragmentation events, alter disposal compliance, remove selected objects, or compare mitigation policies.

The simulator should also avoid implying that speculative ideas such as laser nudging are already routine operational debris-removal systems. Mitigation scenarios can be labelled experimental, conceptual, demonstrated, proposed, or operational according to evidence.

### Solar System and planetary defense

JPL's Small-Body Database and CNEOS ecosystem provide the appropriate foundation for asteroid and comet information, near-Earth objects, close approaches, and related planetary-defense data. citeturn2search3turn2search15 NASA's Eyes on Asteroids demonstrates that real tracked asteroids and comets can already be made understandable through an interactive browser-based 3D Solar System. citeturn15search17

For higher precision Solar System geometry and spacecraft context, NASA/JPL's SPICE system is particularly important. SPICE kernels carry spacecraft and planetary ephemerides, orientations, reference-frame information, instrument geometry, and time-conversion data used in scientific and mission-engineering workflows. citeturn15search2turn15search26turn15search30

The kinetic impactor experiment has a real educational anchor. NASA's DART mission deliberately struck Dimorphos and changed its orbital period, demonstrating kinetic impact as a planetary-defense technique. Subsequent analysis measured an orbital-period reduction of roughly 33 minutes and found momentum enhancement from ejecta, commonly represented through the parameter β. citeturn2search1turn13search3turn13search9

A useful educational first-order model is:

\[
\Delta \vec{v}_{asteroid}
\approx
\beta
\frac{m_{impactor}}{M_{asteroid}}
\vec{v}_{rel}
\]

The experience should then propagate the altered orbit forward and visualize how a seemingly tiny velocity difference accumulates into a substantial position difference after months or years. It should expose uncertainty rather than offering false precision.

A "DART preset" would be especially powerful. Students could first reproduce the general idea behind the real mission, then change mass, velocity, geometry, lead time, β, asteroid mass, and encounter timing.

### Stars and exoplanets

The NASA Exoplanet Archive should be a primary exoplanet source. Its current interfaces use the Planetary Systems tables rather than older retired confirmed-planets interfaces, and the archive contains planetary, stellar, orbital, discovery, light-curve, spectral, and related information. citeturn2search2turn2search14turn2search20 On October 8, 2026, the archive announced a total of 6,445 confirmed exoplanets, including the thousandth planet discovered by TESS, illustrating how quickly this dataset evolves and why the application should not freeze a count into the UI. citeturn2search5

SIMBAD is useful for cross-identification and metadata on astronomical objects outside the Solar System. As of October 15, 2026, its public statistics reported more than 22 million objects and more than 73 million identifiers. citeturn3search2 Gaia remains fundamental for stellar positions, distances, motion, and stellar populations, but Gaia DR4 is not yet available on the project's current date, October 16, 2026. Its release is scheduled for December 2, 2026, so the data layer should be deliberately versionable. citeturn3search0turn3search18

The proposed equilibrium-temperature interaction is scientifically useful:

\[
T_{eq}
=
T_\star
\sqrt{\frac{R_\star}{2a}}
(1-A)^{1/4}
\]

but the UI must communicate that it is a simplified radiative-equilibrium estimate rather than a climate simulation. NASA Exoplanet Archive documentation similarly attaches explicit assumptions to equilibrium-temperature calculations, including blackbody behavior, Bond albedo, and redistribution of energy. citeturn18search12turn18search15

The ESI should likewise be presented as **Earth similarity**, not a "habitability percentage." NASA Astrobiology describes ESI as a physical similarity metric typically built from quantities such as radius, density, escape velocity, and temperature, with modified formulations used when exoplanet measurements are incomplete. The Planetary Habitability Laboratory also explicitly cautions against equating ESI with habitability. citeturn14search18turn14search1

That makes a much better educational visualization:

> **Observed parameters → simplified model → derived temperature/ESI → illustrative visual response → explanation of what the calculation does not tell us.**

### Galactic, extragalactic, and cosmological space

The application should not attempt to upload billions of individual stellar objects into a browser scene graph. It should spatially partition the catalogs and stream them according to camera scale, direction, importance, selection, and density.

SIMBAD, Gaia, and curated catalogs handle local and stellar information. At extragalactic scales, NASA/IPAC Extragalactic Database provides galaxy and extragalactic-source information, redshifts, classifications, bibliography, and other measurements. Its current architecture is also a reminder to use modern interfaces because NED states that legacy APIs cannot access data ingested after January 2026. citeturn3search14turn3search17

DESI is exceptionally useful for demonstrating the large-scale structure of the universe. Its first public data release contains spectra for more than 18 million targets, and by April 2026 the collaboration reported mapping more than 47 million galaxies and quasars alongside more than 20 million Milky Way stars. citeturn12search0turn12search9turn12search18 A downsampled or tiled DESI-derived visualization could therefore make galaxy filaments and cosmic structure one of the project's strongest visual moments.

2MASS provides another huge all-sky dataset, with more than 500 million point sources and roughly 1.6 million extended sources in its major catalogs. citeturn12search1

At the outermost conceptual scale, Planck Cosmic Microwave Background products give the project a scientifically meaningful endpoint rather than an arbitrary invisible wall. Planck maps characterize temperature fluctuations in the oldest observable electromagnetic radiation, and OpenSpace itself uses CMB data as a representation at the boundary of its observable-universe visualization. citeturn12search2turn12search11turn10search28

The user should never be told they are physically "outside the universe." Instead, the interface can transition into a **cosmological overview mode** explaining the observable universe, lookback time, redshift, comoving distance, and the limits imposed by observation.

### Multi-wavelength astronomy

The proposed spectral switcher is excellent because it demonstrates that astronomical objects do not have one universal appearance.

The International Virtual Observatory Alliance's HiPS standard provides hierarchical, multi-resolution tiling for astronomical surveys, making it suitable for progressive sky visualization rather than downloading enormous monolithic images. citeturn5search11 CDS maintains public HiPS datasets spanning multiple wavelength regimes, while Aladin Lite demonstrates interactive web visualization of sky imagery and overlays. citeturn5search1turn5search5

Potential data families include visible-light survey imagery, near-infrared data from 2MASS, infrared imagery from WISE/NEOWISE archives, X-ray surveys from systems such as ROSAT and eROSITA, and microwave CMB maps from Planck. citeturn5search12turn5search7turn5search13turn5search15turn12search2

This should not merely recolor the screen with a filter. When possible, the spectral switcher should switch actual survey datasets and explain what physical processes become visible in each wavelength.

## Architecture and experience direction

The scale jump from Earth to the observable universe is fundamentally an architecture problem.

No single floating-point coordinate frame, mesh representation, lighting solution, or camera controller is appropriate at every scale. A planet seen from its surface, an asteroid viewed from a few kilometers away, the Milky Way seen from tens of thousands of light-years away, and cosmic-web structure observed at gigaparsec scales require different representations.

A serious implementation should therefore be designed around **semantic zoom and hierarchical coordinate systems**.

### Scale architecture

The universe can be treated as nested spatial domains:

| Domain | Typical context | Representative frame |
|---|---|---|
| Surface | meters to thousands of kilometers | local tangent / Earth-fixed |
| Earth orbit | thousands to hundreds of thousands of kilometers | geocentric inertial / Earth-fixed |
| Planetary systems | kilometers to AU | body-centered / heliocentric |
| Nearby stellar space | light-years to kiloparsecs | barycentric / galactic |
| Galaxy | parsecs to tens of kiloparsecs | galactocentric |
| Nearby galaxies | kiloparsecs to megaparsecs | extragalactic |
| Cosmic structure | megaparsecs to gigaparsecs | cosmological / comoving representation |

The camera can continuously appear to travel between them even though the renderer silently re-anchors coordinates, changes representations, rebases origins, changes clipping strategy, and swaps datasets.

This is precisely the class of problem that globe and astronomy engines solve with hierarchical representations and precision strategies. OpenSpace discusses double-precision requirements across astronomical scales, while Cesium's large-world tooling uses origin-shifting and reference-frame techniques for global rendering. citeturn10search9turn16search6

### Rendering architecture

WebGPU is now a serious candidate for high-performance browser rendering and compute. The W3C's current September 15, 2026 specification describes it as a GPU API designed to map efficiently to modern GPU hardware. citeturn16search1turn16search4 It should not, however, become a requirement that makes the experience unavailable on school hardware. Three.js's current WebGPURenderer can target WebGPU while falling back to WebGL 2, providing one possible progressive-enhancement strategy. citeturn17search0

Three.js also provides instanced rendering specifically to reduce draw calls for large populations sharing geometry and material, plus conventional LOD mechanisms. citeturn17search1turn17search2 For the Earth-scale geospatial layer, CesiumJS and the OGC 3D Tiles ecosystem are worth benchmarking because 3D Tiles uses a hierarchical spatial tree and HLOD to stream massive datasets according to required detail. citeturn16search2turn16search10

The best architecture should therefore be selected through a **prototype benchmark**, not ideology. Reasonable candidates include:

| Candidate | Strength |
|---|---|
| Three.js WebGPU/WebGL hybrid | Maximum control over cosmic rendering, shaders, custom particles, and interaction |
| CesiumJS plus custom cosmic renderer | Very strong Earth and geospatial foundation |
| Fully custom WebGPU engine | Maximum long-term flexibility, highest engineering cost |
| Existing astronomy engine integration | Strong science foundations, potentially harder to radically redesign |

A school competition prototype should strongly favor the option that maximizes **visible quality per engineering hour** while retaining a credible path to the long-term vision.

### Cosmic LOD

A star should not have one permanent renderer.

At immense distance, an entire galaxy may be one luminous point. Closer, it may become a textured billboard or volumetric sprite. Closer still, it can resolve into a statistical stellar cloud. Specific catalogued stars can then emerge as individually selectable particles. A selected nearby star can finally become an actual 3D stellar object with corona, surface effects, planets, and orbital visualization.

The same principle applies to galaxies, planets, asteroids, satellites, and debris.

An approximate representation ladder might be:

`cluster density → galaxy points → galaxy impostors → galaxy volume/mesh → stellar density field → catalog stars → selected stellar systems → bodies → detailed body meshes`

Cross-fades should hide the boundaries.

### The Cosmic Ruler

The proposed logarithmic scale scrubber should become one of the application's defining interactions.

It should simultaneously be:

1. A measure of current scale.
2. A navigation control.
3. A contextual breadcrumb.
4. An educational visualization of orders of magnitude.
5. A mechanism for skipping uninteresting empty travel.

The ruler can transition through:

`m → km → Earth radii → lunar distance → AU → light-hours → light-days → ly → pc → kpc → Mpc → Gpc`

It should mark major reference scales such as Earth, Moon, Sun, outer planets, heliosphere, nearest stars, Milky Way diameter, Local Group, clusters, superclusters, and the observable-universe scale.

### UI and UX

The interface should not resemble a dashboard placed over a 3D visualization. The universe itself should remain the primary interface.

A strong layout would use a mostly unobstructed viewport with a restrained HUD: search/command interface near the top, scale ruler along the bottom, compact time controls, wavelength controls, object breadcrumbs, contextual inspection panel, and optional science-lab workspace.

Selecting an object should answer five questions immediately:

**What is this? Where am I? How far away is it? How do we know about it? What can I do with it?**

The user should be able to click Earth, an ISS-like spacecraft, a piece of debris, an asteroid, Jupiter, an exoplanet, a star, Sagittarius A*, a galaxy, or a galaxy cluster and encounter the same fundamental interaction grammar.

That consistency is what will make an enormous universe feel intuitive.

## Exhibition strategy and scope

The highest-risk mistake would be interpreting the long-term vision as the competition MVP.

A literal implementation of billions of astronomical objects, perfect Earth visualization, every known spacecraft, every spectral survey, physically accurate relativistic rendering, planetary climate modeling, orbital debris dynamics, asteroid deflection, exoplanet systems, galaxy catalogs, cosmology, and flawless multi-scale transitions is a research-platform-scale undertaking.

The SCI-FORGE prototype should instead demonstrate that the **architecture and interaction model can eventually support that universe**.

The right competition strategy is a "golden journey":

> **Earth → orbital debris → Solar System → asteroid defense experiment → nearby stellar neighborhood → exoplanet experiment → Milky Way → Sagittarius A* → nearby galaxies → cosmic web → CMB / observable-universe overview**

Every stage demonstrates something different.

Earth orbit demonstrates real-time data and sustainability.

The asteroid lab demonstrates applied physics and planetary defense.

The exoplanet lab demonstrates astronomy, thermodynamics, data interpretation, and uncertainty.

Sagittarius A* demonstrates relativity.

The cosmic web demonstrates astronomical survey science and extremely large datasets.

The CMB endpoint demonstrates cosmology and the limits of observation.

That path lets the team show scientific understanding, engineering innovation, prototype performance, real-world problem solving, educational impact, visual presentation, and future extensibility within one coherent demonstration.

The SDG relationship is also stronger than simply displaying SDG logos. UN SDG 4 includes educational skills and education for sustainable development, with specific emphasis on relevant technical skills and knowledge. SDG 17 emphasizes knowledge, technology, expertise, international cooperation, and partnerships. citeturn8search13turn8search6 The UAE's National Space Strategy 2030 explicitly seeks to strengthen the national space sector and the UAE's regional and international role, while MBRSC combines national space exploration with educational and STEM-oriented activities. citeturn9search1turn8search1turn8search8

AstroNexus therefore has a credible SDG story:

**SDG 4:** turn difficult astronomy, physics, orbital mechanics, cosmology, and scientific data into an experiential learning environment.

**SDG 17:** demonstrate how discoveries become possible through shared international scientific missions, open datasets, observatories, catalog services, research institutions, and cross-border collaboration.

The project should not exaggerate those links. Its strongest sustainability argument is education, scientific literacy, and collaborative scientific infrastructure.

## Master context prompt for Claude Opus 5.5

The following is the context I would actually give the coding agent. It deliberately gives Claude a mission, constraints, scientific baseline, decision authority, research procedure, quality bar, and execution philosophy without attempting to dictate every implementation detail before it sees the repository.

### BEGIN MASTER CONTEXT

You are taking principal ownership of a project currently referred to as **Cosmos / AstroNexus**.

Treat **Cosmos** as the working platform/product name and **AstroNexus: Exploring the Cosmic Frontier** as a potential SCI-FORGE presentation identity unless the existing repository establishes a different naming decision. Do not perform unnecessary renaming if established project files already use another canonical name.

You are not being asked to make a normal astronomy website.

You are being asked to architect and build toward a **scientifically grounded, visually exceptional, open-world 3D exploration platform for the universe**.

The long-term product should allow someone to begin at Earth, understand Earth in its astronomical context, travel through orbital space and the Solar System, explore stars and exoplanets throughout the Milky Way, move outward through galaxies, galaxy groups, clusters, superclusters and large-scale structure, and eventually reach a meaningful representation of the observable universe.

The universe is not simply scenery.

Every important object should become an entry point into data, science, interaction, simulation, comparison, experimentation, and discovery.

The goal is to make astronomy feel explorable.

### Why this project exists

The initial version is being created for **SCI-FORGE 2026**, a student science exhibition centered around transforming scientific understanding into working prototypes that address meaningful real-world challenges.

The project will be evaluated around qualities including scientific understanding, innovation, prototype performance, problem-solving impact, relevance, presentation quality, connection to sustainability, and future potential.

This means visual spectacle alone is insufficient.

The judges must be able to see genuine science happening inside the system.

At the same time, a scientifically rigorous application with poor interaction or mediocre visuals will not achieve the intended result either.

The target is the intersection of:

**scientific credibility + engineering ambition + interaction design + visual beauty + educational value + demonstrable real-world relevance.**

The primary SDG relationships are:

**SDG 4, Quality Education:** use interactive scientific visualization to make astronomy, physics, orbital mechanics, planetary science, cosmology, and scientific datasets understandable through exploration.

**SDG 17, Partnerships for the Goals:** show that modern astronomy and space science are inherently collaborative, relying on international observatories, shared datasets, scientific archives, agencies, researchers, and open standards. UN descriptions of SDG 17 explicitly emphasize sharing knowledge, expertise and technology. citeturn8search6

The project also exists in a UAE context. The UAE National Space Strategy 2030 seeks to strengthen the national space sector and the country's regional and global role, while MBRSC participates in exploration and STEM-oriented education. citeturn9search1turn8search1turn8search8

Do not turn these connections into marketing fluff. Build experiences that genuinely support them.

### Product north star

Imagine combining the best properties of:

**Solar System Scope**, for approachable interactive navigation.

**OpenSpace**, for scientific accuracy and movement across enormous astronomical scales.

**WorldWide Telescope**, for astronomical imagery, survey data, and educational exploration.

**NASA's Eyes**, for mission-driven real-data 3D visualization.

**Universe Sandbox**, for experimentation and physically meaningful manipulation.

Then make the resulting experience more cohesive, more modern, more intuitive, more visually polished, and specifically optimized for astronomy education and scientific experimentation.

Solar System Scope already demonstrates accessible real-time Solar System and night-sky visualization. citeturn0search0turn0search10 OpenSpace demonstrates scientifically grounded visualization spanning from spacecraft environments into galactic and cosmological scales. citeturn10search0turn10search4 NASA's Eyes demonstrates browser-accessible 3D exploration of planets, moons, asteroids, comets, spacecraft, and time-dependent Solar System states using NASA information. citeturn15search1turn15search17

Study these products as reference systems.

Do not clone their UI.

Determine what each gets right and wrong.

Build an interaction language suited to Cosmos.

### The experience

A user should be able to open the platform and immediately encounter Earth suspended in space.

They can orbit it.

They can approach it.

They can pull away.

They can alter time.

They can search.

They can select objects.

They can inspect scientific information.

They can reveal orbital infrastructure.

They can jump to another world.

They can fly manually when flight is enjoyable.

They can use intelligent travel when distances make manual flight meaningless.

They can continuously zoom outward and always understand what scale they are looking at.

At no point should they feel as though they have entered a completely unrelated application just because the current scale changed.

The same conceptual navigation system must extend from kilometers to astronomical units, light-years, kiloparsecs, megaparsecs, and gigaparsecs.

The illusion should be one continuous universe even if the engine internally transitions between coordinate systems, renderers, catalogs, representations, and spatial hierarchies.

### The non-negotiable experience qualities

**Beautiful.** This should be one of the most visually memorable projects at the exhibition. Lighting, atmosphere, stars, surfaces, shadows, scattering, volumetrics, orbit lines, labels, transitions, typography, information hierarchy, animation and sound should all feel deliberate.

**Fast.** Visual ambition cannot excuse a sluggish interface. Performance is a feature.

**Intuitive.** A person unfamiliar with astronomy should be able to start exploring without a tutorial manual.

**Deep.** Someone who already likes astronomy should continue discovering information and scientific tools.

**Scientific.** Never silently substitute cinematic fiction for measured science.

**Explainable.** Equations, assumptions and data provenance should be available without overwhelming casual users.

**Continuous.** Earth, the Solar System, stellar space and cosmology should feel like scales of one platform.

**Interactive.** Do not build a glorified video or slideshow.

**Resilient.** The critical exhibition path must work without depending on perfect venue Wi-Fi.

### Do not confuse realism with scientific honesty

Not every object in astronomy has a known 3D appearance.

Not every exoplanet has an image.

Not every star has every physical property measured.

Not every galaxy has a precise three-dimensional position.

Not every region of interstellar space has been mapped.

Therefore define and visibly preserve a provenance model.

At minimum, Cosmos needs distinctions equivalent to:

**Observed:** directly catalogued or measured.

**Derived:** calculated from measured values using a defined model.

**Reconstructed:** inferred or reconstructed from observational data.

**Illustrative:** generated for communication, aesthetics or continuity where observations are insufficient.

Never allow an illustrative exoplanet surface to imply that astronomers have actually photographed that surface.

Never let an interpolated value look identical to a precise measurement without exposing uncertainty.

Every inspectable scientific object should be capable of exposing something equivalent to:

`source`

`dataset`

`dataset version`

`observation or reference epoch`

`last ingestion date`

`measured properties`

`derived properties`

`uncertainties`

`missing values`

`model assumptions`

`representation type`

The UI does not need to show all of this simultaneously. The data model must retain it.

### Research before architecture

Before making irreversible architectural choices, inspect the entire repository and understand what already exists.

Do not blindly replace working systems.

Determine:

the existing stack,

rendering engine,

application architecture,

asset pipeline,

data pipeline,

state management,

UI architecture,

performance characteristics,

deployment target,

testing strategy,

existing documentation,

and unfinished experiments.

Then perform targeted technical research using current official documentation and primary scientific sources.

Prefer original sources such as NASA, JPL, ESA, NAIF, NASA Exoplanet Archive, Gaia/ESA, CDS/SIMBAD, IVOA, NED, DESI, Planck, OGC, W3C and official library documentation.

Do not use random blogs as the scientific source of truth when a primary source exists.

Do not scrape a website merely because scraping is possible.

The priority order should generally be:

**official API → official bulk dataset → astronomical standard/service → machine-readable archive → documented public endpoint → compliant scraping only when truly necessary**

Respect licenses, robots requirements, API limits and terms of service.

Record where data came from.

Cache responsibly.

Do not repeatedly hit public science services during every render frame or every user interaction.

### Current scientific baseline

Treat this section as a starting point to verify, not eternal truth.

The current project date is **October 16, 2026**.

For orbital objects, do not hard-code "30,000 pieces of debris." ESA's 2025 environment report described roughly 40,000 tracked space objects and approximately 11,000 active payloads, while the true debris population is much larger when objects below routine tracking thresholds are considered. citeturn1search1turn1search12

Space-Track and CelesTrak are relevant current orbital-data services. Space-Track publishes programmatic-access rules and rate limits. citeturn1search2

Do not create an architecture dependent on traditional fixed-width legacy TLE identifiers. CelesTrak reports that five-digit catalog numbers were exhausted on July 11, 2026 and supports modern representations capable of larger identifiers. citeturn1search14turn1search23

For Solar System bodies and near-Earth objects, investigate JPL Small-Body Database, CNEOS, Horizons and SPICE. SPICE provides mission-quality geometry through kernels describing spacecraft and planetary ephemerides, orientation, reference frames and related ancillary information. citeturn2search3turn2search15turn15search2turn15search26

For exoplanets, use the current NASA Exoplanet Archive interfaces. Older confirmed-planets interfaces have been retired in favor of current Planetary Systems tables such as `PS` and `PSCompPars`. citeturn2search2turn2search20

Do not hard-code an exoplanet count either. The archive reported 6,445 confirmed exoplanets on October 8, 2026. citeturn2search5

For stellar catalogs, research Gaia and SIMBAD.

Do not assume Gaia DR4 exists today. As of October 16, 2026, Gaia DR4 is planned for December 2, 2026. Build a data-adapter architecture that can incorporate it after release without rewriting the renderer. citeturn3search0turn3search18

SIMBAD currently contains more than 22 million astronomical objects and tens of millions of identifiers, illustrating why catalog streaming and spatial indexing are necessary. citeturn3search2

For galaxies and extragalactic objects, investigate NED, DESI and relevant catalogs. NED has modern interfaces that should be preferred over legacy endpoints that no longer expose all post-January-2026 data. citeturn3search17

DESI is particularly interesting for a visual representation of large-scale structure. Its first data release includes spectra for more than 18 million targets, while by April 2026 the survey reported maps involving more than 47 million galaxies and quasars. citeturn12search0turn12search9

For full-sky imagery and spectral exploration, research IVOA HiPS and HEALPix-based spatial tiling rather than treating enormous surveys as single textures. HiPS is explicitly designed as a hierarchical multi-resolution sky representation. citeturn5search11 HEALPix provides hierarchical indexing of positions over the sphere and is used in astronomical sky products. citeturn15search3turn15search15

For a cosmological outer layer, investigate Planck CMB data. The CMB provides a scientifically meaningful representation of the earliest electromagnetic light accessible to observation rather than an invented wall at the edge of space. citeturn12search2turn12search11

### Architecture principle: one perceived universe, multiple internal spaces

Do not attempt to represent the entire application with a single conventional float-based Cartesian world.

Design a hierarchy of coordinate spaces and reference frames.

Potential domains include:

`LocalSurfaceSpace`

`BodyFixedSpace`

`BodyCenteredInertialSpace`

`EarthCenteredInertialSpace`

`HeliocentricSpace`

`SolarSystemBarycentricSpace`

`GalacticSpace`

`ExtragalacticSpace`

`CosmologicalSpace`

Those names are illustrative, not mandatory.

Investigate appropriate standards and reference frames before implementation.

Coordinate conversion should be explicit and testable.

The camera should be able to move apparently continuously while its local origin and reference frame change beneath it.

Consider:

camera-relative rendering,

floating origins,

origin rebasing,

CPU-side double precision,

split high/low coordinate representations where appropriate,

hierarchical scene graphs,

scale-specific near/far planes,

reversed depth where supported,

logarithmic depth only when justified,

and transitions between render domains.

Do not cargo-cult these techniques. Benchmark them.

OpenSpace's experience with universe-scale precision is relevant to the problem. citeturn10search9

### Rendering strategy

Research WebGPU, WebGL 2, Three.js, CesiumJS and any other relevant technologies against the actual repository requirements before making the final renderer decision.

The current W3C WebGPU specification is dated September 15, 2026 and is intended to expose modern GPU rendering and computation to the web. citeturn16search1

Three.js WebGPURenderer currently supports a WebGPU path with WebGL 2 fallback and options including reversed and logarithmic depth buffers. citeturn17search0

Three.js `InstancedMesh` exists specifically to reduce draw calls for large populations sharing geometry and material. citeturn17search1

Cesium and 3D Tiles should be studied for Earth-scale streaming. The OGC 3D Tiles specification uses hierarchical level of detail, and Cesium's implementation streams massive spatial datasets based on required resolution. citeturn16search2turn16search10

Do not assume one of these options is automatically correct.

Build a small benchmark if necessary.

A hybrid architecture may be justified.

### Representation must depend on scale

Do not render ten million distant stars as ten million full sphere meshes.

Develop a representation ladder.

For example:

At extreme distance, galaxy populations may be density fields or clustered point representations.

At nearer scales, galaxies may become individually rendered points or splats.

At intermediate range, a galaxy may become an impostor, sprite, volumetric representation or procedural reconstruction.

At close range, important galaxies may reveal structure and catalog stars.

Individual stars at distant scale should generally be particles or point representations.

A selected nearby star can transition into a detailed stellar renderer.

Distant planets can be points.

Mid-distance planets become sphere meshes.

Close planets gain high-resolution textures, terrain or atmosphere as available.

Space debris should use batched or instanced representations.

Orbit lines should be generated only where meaningful and visible.

Labels should be aggressively culled and prioritized.

Use screen-space importance rather than distance alone.

Transitions should cross-fade or otherwise hide representation boundaries.

### Performance is a specification

Establish explicit budgets.

The exhibition build should target smooth 60 FPS interaction on the actual demonstration hardware whenever practical.

Measure:

CPU frame time,

GPU frame time,

draw calls,

triangle count,

particle count,

VRAM use,

RAM use,

JavaScript heap,

network transfer,

time to first interactive frame,

data-decode latency,

worker utilization,

shader compilation stalls,

scene-transition latency,

and worst-case frame-time spikes.

Do not celebrate an average 60 FPS if scene transitions cause multi-second freezes.

Create repeatable benchmark scenes.

At minimum:

Earth close view,

Earth with a dense orbital-object population,

full Solar System,

dense Milky Way catalog view,

galaxy/cosmic-web view,

black-hole effect,

and rapid Cosmic Ruler transitions.

Performance regressions should be detectable.

### Streaming and data processing

Scientific datasets and rendering assets must be separate concerns.

Create an ingestion pipeline that can:

fetch,

validate,

normalize,

version,

transform coordinates,

calculate derived fields,

generate indexes,

partition spatially,

produce render-optimized chunks,

compress,

cache,

and attach provenance.

The runtime should consume application-optimized representations rather than parsing enormous raw research archives on every launch.

Investigate spatial structures appropriate to each domain:

HEALPix or HiPS for celestial-sphere imagery and direction-indexed datasets.

Quadtrees for appropriate planetary surfaces.

Octrees or other hierarchical 3D structures for volumetric catalogs.

HLOD trees for complex models.

Morton/Z-order or comparable spatial indexing where useful.

Chunked binary structures for huge point datasets.

Do not choose any of these without matching it to the actual query pattern.

Data loading must be progressive.

A user should see something meaningful immediately rather than staring at a loading screen until every catalog finishes.

### Time architecture

Time is a first-class dimension of the platform.

Separate:

**wall-clock time**

**simulation time**

**dataset epoch**

**observation time**

**ephemeris time**

where relevant.

The user should be able to:

pause,

resume,

accelerate,

reverse where mathematically supported,

jump to a date,

return to now,

and reset an experiment.

Do not conflate an object's catalog epoch with its rendered current position.

### Navigation

The user requires both exploration and efficiency.

Support at least the conceptual equivalents of:

free flight,

orbit target,

follow target,

surface-relative movement where applicable,

select and focus,

search and teleport,

cinematic travel,

history/back navigation,

bookmarks,

guided tours,

and Cosmic Ruler navigation.

Travel speed should respond intelligently to scale and target distance.

Flying from Earth to Mars should feel expansive.

Flying manually for years of simulated empty distance to reach another star should not be required.

Long-distance travel should become a visual transition that preserves a sense of scale without wasting time.

Never let the user become permanently lost.

Always make current context recoverable.

### The Cosmic Ruler

Implement the **Cosmic Ruler** as a central interaction model.

It is not merely a scale label.

It is a logarithmic navigation timeline covering astronomical orders of magnitude.

It should transition through suitable units such as:

meters,

kilometers,

Earth radii,

lunar distance,

astronomical units,

light-minutes,

light-hours,

light-days,

light-years,

parsecs,

kiloparsecs,

megaparsecs,

gigaparsecs.

Show contextual landmarks along the ruler.

The user should be able to scrub from:

Earth

to Earth orbit

to the Moon

to the Solar System

to nearby stars

to the Milky Way

to the Local Group

to large-scale structure

to the observable universe.

The 3D scene should respond continuously enough that this feels like semantic zoom rather than a collection of disconnected pages.

### Object interaction grammar

Every selectable object should use a consistent inspection model.

Selecting something should reveal:

name,

object type,

distance,

current or reference position,

size/scale,

important physical properties,

brief explanation,

source/provenance,

available actions,

and related scientific experiences.

Available actions may include:

Focus

Orbit

Follow

Travel To

Open Data

Show Orbit

Compare

Run Experiment

View Spectrum

Show Related Objects

Bookmark

Open Source Details

Not every object supports every action.

### Search

Search must be excellent.

The user should be able to search for:

Earth,

ISS,

Moon,

Mars,

Voyager,

Apophis,

Proxima Centauri,

TRAPPIST-1,

Kepler systems,

Sagittarius A*,

Andromeda,

Messier objects,

galaxy clusters,

constellations,

object catalog identifiers,

and scientific categories.

Search results should understand aliases.

SIMBAD's extensive cross-identification system shows why astronomical objects commonly have many identifiers. citeturn3search2

Results should be grouped by object class and ranked intelligently.

Selecting a result should provide scale context before or during travel.

### UI philosophy

The viewport is the product.

Avoid surrounding it with permanent giant panels.

Use progressive disclosure.

The default experience should feel cinematic and calm.

Advanced scientific controls should appear when needed.

A possible interface grammar is:

Top area: search, location breadcrumbs, application controls.

Bottom center: Cosmic Ruler.

Bottom or side hotbar: time, orbit overlays, wavelength mode, labels, educational layers.

Context panel: appears when an object is selected.

Science Lab: expands when entering an experiment.

Do not treat this as a mandatory layout. Improve it if the implementation reveals a better solution.

Design desktop-first for the exhibition hardware while maintaining responsive behavior where reasonably achievable.

Support keyboard and mouse exceptionally well.

Touch should be considered if tablets are plausible.

Accessibility matters. Respect reduced-motion preferences and avoid relying exclusively on color to communicate scientific state.

### Visual design

Aim for scientific elegance rather than generic "futuristic sci-fi HUD."

Avoid filling the screen with neon lines simply because the subject is space.

Use sophisticated typography, spacing, depth, animation and translucency.

Glass effects are acceptable only when legibility and performance remain excellent.

Orbit paths, labels, grid systems and measurement overlays should feel like scientific instruments.

Transition animation should communicate scale.

Selection animation should communicate relationship.

Scientific overlays should look distinct from natural scenery.

The visual system should make a clear distinction between:

physical objects,

scientific annotations,

interactive controls,

experimental changes,

and uncertain or illustrative information.

### Lighting and astronomical appearance

Do not use a single lighting model for the entire universe.

Planetary scenes may require physically inspired direct stellar illumination, night-side treatment, atmosphere and eclipses.

Stars are emissive objects and should not behave like ordinary externally lit spheres.

Black holes require specialized rendering.

Nebulae and galactic dust may require volumetric or billboard-based approaches.

Galaxy fields may use points, splats or procedural representations.

Keep an explicit distinction between physically motivated rendering and visual exaggeration used to make faint structures visible.

When enhancement is used, say so.

### Earth orbital environment laboratory

This is the first major science module.

Show active satellites, stations, rocket bodies and tracked debris around Earth using current structured orbital data where licensing and access permit.

Do not represent every point identically.

Allow filtering by:

object class,

orbital regime,

altitude,

inclination,

ownership/operator where data permits,

launch period,

risk category,

and selected constellations.

Support LEO, MEO, GEO and other useful orbital context.

Let the user click an object and inspect its orbital elements and derived trajectory.

Animate propagation.

Offer time acceleration.

Visualize orbital density.

Explain that the tracked catalog is not the full debris population.

The simulator should include an educational **Kessler Syndrome sandbox**.

Possible experiments:

inject a collision,

increase/decrease debris population,

change mitigation compliance,

remove selected debris,

introduce hypothetical cleanup capacity,

show cascading collision risk,

compare before/after orbital-shell density.

Avoid pretending that a simple sandbox is an operational conjunction prediction model.

Clearly mark assumptions.

### Debris mitigation experiment

Allow selected mitigation concepts to be explored.

Possible concepts include:

controlled deorbit,

drag augmentation,

deorbit tethers,

active debris removal,

collision avoidance,

and conceptual contactless nudging approaches.

If laser nudging is included, label its maturity correctly rather than presenting it as an established fleet-scale operational system.

Show:

what variable the intervention changes,

the resulting orbital change,

the time horizon,

energy or delta-v scale where appropriate,

and uncertainty.

Make the learning objective explicit:

**small orbital changes applied sufficiently early can create large later positional separation.**

### Planetary defense laboratory

Build a second major interactive experiment around a near-Earth asteroid.

Use real NEO data from JPL sources when available. citeturn2search3turn2search15

Allow the user to choose an asteroid.

Show its measured orbit.

Allow a kinetic impactor to be configured using parameters such as:

spacecraft mass \(m_i\),

relative impact velocity \(v_{rel}\),

impact direction,

asteroid mass \(M_a\),

impact time,

and momentum-enhancement factor \(\beta\).

A useful first-order educational relationship is:

\[
\Delta \vec v_a
\approx
\beta
\frac{m_i}{M_a}
\vec v_{rel}
\]

Do not pretend this equation captures the entire physics of a real impact.

Propagate the resulting trajectory.

Show the unmodified and modified orbits simultaneously.

Display separation growth over time.

Show Earth encounter geometry.

Show a miss-distance timeline.

Where appropriate, visualize uncertainty.

Include a **DART reference preset**.

NASA's DART mission successfully changed Dimorphos's orbital period by roughly 33 minutes and demonstrated kinetic impact as a deflection technique. citeturn13search3turn13search9

Use the real mission as calibration and educational context.

### Exoplanet exploration

A discovered exoplanet should not be represented as merely another sphere.

The user should be able to inspect:

host star,

stellar classification,

stellar temperature,

stellar radius,

planet radius,

mass where known,

orbital period,

semi-major axis,

eccentricity,

discovery method,

discovery year,

equilibrium temperature where available,

and relevant uncertainties.

Missing data should remain missing rather than being silently invented.

Use NASA Exoplanet Archive as a primary source and design around its current TAP/Planetary Systems ecosystem. citeturn2search2turn2search14

Because most exoplanets are not directly imaged as resolved worlds, visual planet appearances should be explicitly classified as illustrative unless actual imagery exists.

### Exoplanet habitability laboratory

This should be one of the showcase interactions.

Expose stellar temperature:

\[
T_\star
\]

stellar radius:

\[
R_\star
\]

orbital distance:

\[
a
\]

Bond albedo:

\[
A
\]

and calculate a simplified equilibrium temperature:

\[
T_{eq}
=
T_\star
\sqrt{\frac{R_\star}{2a}}
(1-A)^{1/4}
\]

State the model assumptions.

Do not call this exact surface temperature.

NASA archive documentation similarly treats equilibrium temperature as an approximation under assumptions about radiative equilibrium, blackbody behavior, albedo and heat redistribution. citeturn18search12turn18search15

Allow parameter manipulation.

As parameters change, make the illustrative planet shader respond.

Possible states include:

ice coverage,

liquid-water-like appearance,

dry/hot appearance,

cloud changes,

runaway-greenhouse visualization.

But show an **Illustrative Visualization** indicator.

Do not claim that moving a slider has scientifically predicted the actual climate appearance.

If time permits, separate:

**equilibrium temperature**

**habitable-zone position**

**Earth Similarity Index**

**atmospheric assumptions**

rather than merging them into one "habitability score."

### Earth Similarity Index

If ESI is implemented, treat it carefully.

ESI measures similarity to Earth according to selected physical quantities.

It is not a probability that life exists.

It is not a probability of habitability.

It is not a substitute for atmospheric measurements.

NASA Astrobiology and the Planetary Habitability Laboratory both describe ESI in terms of physical similarity rather than proof of habitability. citeturn14search18turn14search1

The UI should literally say something equivalent to:

> "Earth Similarity Index estimates physical similarity to Earth. A high value does not demonstrate habitability or life."

That sentence is important.

### Stellar visualization

Do not make every star an identical glowing sphere scaled by catalog radius.

Far stars should be photometrically and visually represented according to available properties.

Where data supports it, consider:

temperature,

spectral type,

luminosity,

absolute/apparent magnitude,

distance,

color index,

radius,

mass,

metallicity,

proper motion.

Do not load the complete stellar catalog at full detail.

Spatially tile and progressively stream.

At sufficiently distant scales, density representations may be more scientifically and computationally useful than discrete stars.

### Constellations

Constellations are observer-dependent patterns projected on the celestial sphere, not physically bound star groups.

Support:

constellation lines,

constellation boundaries if data is available,

traditional names,

major stars,

and Earth-sky view.

A useful educational interaction is to leave Earth and reveal the three-dimensional separation of stars that appear adjacent in a constellation from Earth's viewpoint.

This is an excellent example of something a 3D Cosmos platform can teach better than a flat star map.

### Milky Way mode

The Milky Way should transition from individual local catalog stars into larger-scale structural context.

Represent:

disk,

bulge,

spiral structure,

stellar density,

dust,

selected nebulae,

star-forming regions,

globular clusters,

and important landmarks.

Do not imply that every decorative star in a procedural background corresponds to an individually measured source.

Provide a toggle or metadata mode that distinguishes catalog stars from procedural context.

### Sagittarius A* and black-hole laboratory

Sagittarius A* should be a flagship destination.

Use reliable current measurements for its parameters.

The first educational model can treat the black hole as Schwarzschild for clarity.

The Schwarzschild radius is:

\[
r_s = \frac{2GM}{c^2}
\]

and is approximately proportional to mass. citeturn7search0turn7search12

NASA/JPL material places the Schwarzschild radius of Sagittarius A* at roughly 12 million kilometers, while ESO material places the Galactic Center at approximately 26,000 light-years from Earth. citeturn6search0turn6search5

Implement two conceptual rendering levels if feasible:

**Educational Fast Mode**

Approximate gravitational lensing with a performant shader or screen-space technique.

Show event horizon.

Show Schwarzschild radius.

Show selected orbit/reference markers.

Display gravitational time dilation.

Remain responsive on exhibition hardware.

**Relativistic High-Fidelity Mode**

Investigate physically based null-geodesic or ray-tracing methods.

Potentially account for a rotating Kerr black hole.

Use this only if performance and development time justify it.

Do not claim that a Schwarzschild visualization is an exact physical rendering of a rotating astrophysical black hole.

### Time dilation

Include a live comparison:

**Spacecraft elapsed time**

versus

**distant observer / Earth reference time**

For the simplified non-rotating case, derive the appropriate relationship from Schwarzschild spacetime and clearly identify assumptions.

Gravitational time dilation means clocks deeper in a gravitational field run more slowly relative to distant clocks. citeturn7search1

The educational experience should let the user move radially and watch the clocks diverge.

Prevent the interface from suggesting a physically meaningful stationary observer inside the event horizon.

### Gravitational lensing

Background stars and galaxies should visibly distort when seen around the black hole.

NASA educational materials explicitly describe black holes bending background light through gravitational lensing. citeturn6search4

The visual effect should be connected to explanation, not used only as decoration.

Where the render model is approximate, label it approximate.

### Galaxies

When leaving the Milky Way, transition to catalogued galaxies and aggregate large-scale structures.

Use real positional/redshift information where practical.

For close famous galaxies, provide richer representations.

For immense populations, use point rendering, splats, HLOD, density structures or other optimized methods.

Do not instantiate one React component or heavyweight scene object per galaxy.

The renderer should consume packed data buffers.

### Cosmic web

Create a scale at which filaments, clusters and voids become visually legible.

Investigate DESI as a potential data source.

DESI's current datasets are enormous, so preprocess and downsample or tile them appropriately rather than serving every record directly to the exhibition browser. citeturn12search0turn12search9

The purpose is not merely to show millions of dots.

Teach what redshift surveys reveal about large-scale structure.

### Observable-universe boundary

Do not build a literal glass sphere called "the edge of the universe."

Instead create an educational cosmology mode.

Explain:

observable universe,

lookback time,

redshift,

expansion,

comoving distance,

CMB,

and why looking farther also means looking further back in time.

Use Planck CMB data for the final all-sky context if licensing and implementation permit. citeturn12search2turn12search11

OpenSpace provides a useful conceptual precedent by placing a CMB representation at the outer cosmological scale of its universe visualization. citeturn10search28

### Spectral View Switcher

Implement wavelength exploration as science, not Instagram filters.

Target modes such as:

**Visible**

**Infrared**

**X-Ray**

**Microwave / CMB**

Potentially add:

**Radio**

**Ultraviolet**

later if datasets and storytelling justify them.

When possible, each mode should use actual scientific survey imagery or catalog data appropriate to that wavelength.

Investigate HiPS as a delivery mechanism because it provides hierarchical multi-resolution tiling for astronomical surveys. citeturn5search11

Potential source families include 2MASS, WISE/NEOWISE, ROSAT/eROSITA and Planck. citeturn5search12turn5search7turn5search13turn5search15turn12search2

When changing wavelength, explain what the user is now detecting.

For example:

infrared can reveal structures hidden by dust,

X-ray views highlight high-energy processes,

microwave CMB mapping reveals early-universe temperature anisotropies.

Use actual data rather than recoloring visible imagery whenever reasonably possible.

### Information architecture

Avoid encyclopedia dumping.

The first object panel should contain a concise explanation.

Then allow layers of depth.

A useful hierarchy is:

**Overview**

What is it?

Why does it matter?

**Properties**

Measurements and units.

**Orbit / Position**

Spatial and temporal data.

**Science**

Underlying concepts.

**Observations**

How humans detected or measured it.

**Sources**

Dataset provenance.

**Experiment**

Interactive tools, when available.

This lets a casual visitor understand something in ten seconds while still serving a technical user.

### Units

Units are part of the educational experience.

Support context-appropriate values.

Distance may transition between:

meters,

kilometers,

Earth radii,

AU,

light-seconds,

light-minutes,

light-hours,

light-years,

parsecs,

kiloparsecs,

megaparsecs.

Mass may display useful comparisons.

Velocity may show km/s and contextual equivalents.

Do not dump absurd scientific notation into the primary UI when a human-friendly unit communicates better.

Advanced panels can expose raw values.

### Scientific equations

Whenever an experiment uses an equation:

show the equation,

define its variables,

show units,

state assumptions,

expose source references,

and explain what the result means.

Allow an optional "show calculation" view.

Do not use equations as decoration.

### Data schema

Develop a coherent typed scientific object model rather than allowing every data source to leak its own schema into the UI.

A conceptual base model might contain:

```ts
interface CelestialEntity {
  id: string;
  canonicalName: string;
  aliases: string[];

  entityType: CelestialEntityType;

  coordinateState: CoordinateState;
  physicalProperties: PhysicalProperties;

  observation?: ObservationMetadata;
  provenance: ProvenanceRecord[];

  uncertainty?: UncertaintyModel;

  representations: RenderRepresentation[];

  relationships: EntityRelationship[];

  capabilities: EntityCapability[];
}
```

This is conceptual.

Do not implement it verbatim before understanding the actual data.

Different classes such as debris objects, spacecraft, planets, stars, exoplanets, black holes, galaxies and clusters should retain domain-specific fields rather than being forced into one giant nullable interface.

Use typed composition or discriminated unions as appropriate.

### Derived-value engine

Keep scientific derivations separate from UI components and shaders.

A scientific calculation should be:

pure where practical,

unit-tested,

dimensionally explicit,

documented,

versioned if the model changes,

and reproducible.

For example:

`calculateEquilibriumTemperature()`

`calculateSchwarzschildRadius()`

`calculateSimplifiedTimeDilation()`

`calculateImpactDeltaV()`

`calculateESI()`

should not secretly live inside React event handlers.

### Units and numerical safety

Do not pass untyped bare numbers throughout scientific code.

Use a disciplined unit strategy.

At minimum, naming and APIs should make units unambiguous.

Prefer calculations in SI internally unless the scientific library or dataset demands another convention.

Convert at boundaries.

Test conversions.

Astronomical-unit mistakes can silently produce absurd output while still looking plausible.

### Scientific uncertainty

Uncertainty should become a first-class design concept.

Not every value deserves the same number of decimal places.

Where catalog uncertainties exist, preserve them.

Where a derived result depends strongly on uncertain inputs, expose that fact.

Possible representations:

error bars,

ranges,

cones,

translucent orbit regions,

uncertainty bands,

confidence labels,

or "estimated" indicators.

Do not create false precision.

### Provenance UI

Create a consistent way of answering:

**Where did this number come from?**

A user should eventually be able to trace an object or value back through:

object,

property,

source catalog,

dataset release,

ingestion date,

original reference or archive.

This feature strongly differentiates Cosmos from purely entertainment-oriented universe software.

### Data freshness

Do not make every page load dependent on live third-party APIs.

Use a versioned snapshot architecture.

For the exhibition build:

prepare known-good local data,

record when it was obtained,

allow optional online refresh,

and make the core demo deterministic offline.

This is mandatory for reliability.

Venue connectivity must not be capable of destroying the presentation.

### Exhibition mode

Implement an **Exhibition / Guided Demo Mode**.

It should be possible for a presenter to trigger a polished sequence without fighting free-flight controls under pressure.

A target demonstration path is:

**Earth**

↓  
Reveal the scale of orbital infrastructure and debris.

↓  
Open the debris/Kessler laboratory.

↓  
Zoom to Solar System scale.

↓  
Select a real near-Earth asteroid.

↓  
Run kinetic-deflection experiment.

↓  
Travel outward through nearby stellar space.

↓  
Visit a real exoplanet system.

↓  
Run equilibrium-temperature / ESI experiment.

↓  
Expand to Milky Way scale.

↓  
Travel to Sagittarius A*.

↓  
Enable relativistic lensing and time-dilation visualization.

↓  
Zoom outward to Local Group and galaxy surveys.

↓  
Reveal the cosmic web.

↓  
Reach CMB / observable-universe educational view.

The entire sequence should communicate:

**we began with a human-scale problem around Earth and ended by understanding our place in the observable cosmos.**

### Free exploration must still work

Guided Demo Mode cannot be a video masquerading as an application.

After or during the demonstration, judges should be able to grab the mouse and explore.

The presenter should be able to recover easily if someone flies somewhere unexpected.

Implement an obvious "return to demo" or target reset capability.

### MVP philosophy

The long-term product vision is enormous.

Do not attempt to finish the observable universe before creating a beautiful Earth.

Do not create fifty half-working modules.

Prioritize a vertical slice that proves the fundamental architecture.

A sensible order is:

**Foundation**

render loop,

camera,

scale architecture,

object selection,

data model,

UI shell,

performance instrumentation.

**Earth**

beautiful Earth,

atmosphere,

Sun lighting,

Moon,

basic time,

orbital objects.

**Orbital science**

debris visualization and experiment.

**Solar System**

planetary travel,

orbits,

NEO pipeline,

planetary-defense experiment.

**Stellar**

catalog stars,

search,

nearby systems,

exoplanets.

**Exoplanet lab**

temperature and ESI educational interaction.

**Galactic**

Milky Way scale transition and Sagittarius A*.

**Cosmological teaser**

galaxies, DESI-derived structure and CMB endpoint.

Reorder where existing repository progress makes another path more efficient.

### What must look exceptionally good

For the exhibition build, spend disproportionate polish on the views that judges will actually see:

Earth from orbit.

Orbital-debris reveal.

Transition from Earth to Solar System.

Asteroid deflection before/after orbit.

Arrival at an exoplanet.

Live planet shader response during experiment.

Milky Way scale transition.

Sagittarius A* lensing.

Cosmic-web reveal.

CMB / observable-universe finale.

It is acceptable for secondary objects to use simpler visualizations if these hero experiences are excellent.

### Shader philosophy

Shaders should communicate physical phenomena.

Potential systems include:

Earth atmosphere scattering,

night-side city-light layer if appropriate,

cloud layer,

planetary atmospheres,

gas-giant banding,

ring systems,

stellar corona,

black-hole accretion visualization,

gravitational lensing,

galactic dust,

nebulae,

point-star scintillation or bloom appropriate to camera context,

exoplanet state transitions.

Do not stack expensive effects without profiling.

A shader that looks 5 percent better but cuts the frame rate in half is probably not worth it in the exhibition build.

### Asset authenticity

Use scientifically appropriate planetary texture and elevation sources where licensing permits.

Solar System Scope itself notes that its planetary maps rely on NASA imagery/elevation sources, demonstrating the benefit of anchoring presentation in mission data. citeturn0search10

For objects without observed surface imagery, use procedural or artistic materials and label them illustrative.

### Constellation, orbit and annotation layers

Scientific overlays should be toggles, not permanent clutter.

Potential overlays:

planet names,

moon names,

orbits,

orbital planes,

constellation lines,

constellation boundaries,

coordinate grids,

habitable zones,

asteroid trajectories,

debris shells,

mission trajectories,

light travel distance,

galactic plane,

cluster labels,

cosmological scale markers.

Use semantic decluttering.

Do not render every available label at once.

### Educational mode and expert depth

Design for two layers of user.

A casual exhibition visitor should understand the interface rapidly.

A technically curious visitor should be able to go deeper.

Use progressive disclosure rather than creating separate "kids mode" and "expert mode" applications unless research shows that is necessary.

### Storytelling

Cosmos should quietly teach through exploration.

When leaving Earth, communicate how quickly familiar geography disappears.

When reaching lunar distance, contextualize light travel time.

When reaching the Solar System, show how tiny planetary sizes are relative to orbital distance.

When reaching nearby stars, show how empty interstellar space is.

When leaving the Milky Way, reveal that its familiar stars collapse into one galaxy.

When revealing millions of galaxies, communicate cosmic structure.

When showing the CMB, explain that greater distance corresponds to deeper lookback time.

Do not overwhelm the user with popups.

Let scale itself tell part of the story.

### Science Lab UI

Experiments should use a consistent UI grammar.

Each lab should have:

**Real State**

Current/reference scientific values.

**Variables**

What the user can change.

**Visualization**

Immediate spatial response.

**Result**

Numerical outcome.

**Explanation**

Why it changed.

**Assumptions**

What the model ignores.

**Compare**

Real vs modified.

**Reset**

Return to reality.

The "Reset to Real Data" control is especially important.

Users should always know when they are looking at reality and when they are looking at a sandbox scenario.

### Experiment state must not contaminate the real universe

Keep modified simulation state separate from source data.

Never permanently mutate the canonical object record because a student changed a slider.

Conceptually:

`ObservedState`

plus

`ScenarioOverrides`

produces

`ScenarioState`.

Resetting the experiment should be exact.

### Testing scientific correctness

Write unit tests for formulas and transformations.

Create reference cases.

Examples:

Earth/Sun equilibrium-temperature sanity check.

Schwarzschild radius for the Sun and known black-hole parameters.

Known coordinate conversions.

Known orbital-propagation checkpoints.

DART-like delta-v directionality.

Known astronomical-unit conversions.

Known light-year/parsec relationships.

Use tolerances appropriate to each model.

Do not compare approximations against high-precision ephemerides and then pretend tiny disagreement is a bug.

Document expected accuracy.

### Testing visuals

Use visual regression tests for hero scenes where practical.

Capture:

Earth view,

orbit lines,

debris visualization,

representative planet,

exoplanet shader states,

black-hole view,

galaxy field,

Cosmic Ruler milestones.

This catches accidental changes to tone mapping, camera parameters, post-processing and shaders.

### Testing performance

Maintain reproducible stress scenes.

Do not optimize randomly.

Profile first.

Look for:

too many draw calls,

allocation during frame loops,

React rerenders affecting canvas performance,

CPU/GPU synchronization,

expensive transparency,

oversized textures,

shader overdraw,

excessive post-processing,

too many orbit-line vertices,

unbounded labels,

catalog data copied unnecessarily,

blocking parsing,

garbage-collection spikes,

and asset requests during critical transitions.

Move expensive catalog processing into workers where appropriate.

### Main-thread discipline

A giant astronomical dataset should never freeze the interface because JSON parsing, coordinate transformation or spatial-index generation happens synchronously on the main thread.

Investigate:

Web Workers,

transferable buffers,

SharedArrayBuffer where deployment security headers permit,

binary formats,

streaming decode,

background preparation,

and GPU-side calculation where WebGPU genuinely helps.

Do not add complexity simply because these technologies exist.

Measure the bottleneck first.

### Caching

Develop layered caching.

Potential levels:

static build assets,

preprocessed scientific data,

HTTP/CDN cache,

browser Cache Storage,

IndexedDB for catalog chunks,

memory cache,

GPU-resource cache.

Version cached scientific datasets.

Ensure a schema change does not leave the application using incompatible stale data.

### Offline competition build

Produce a deterministic offline-capable package containing everything required for the golden-path demonstration.

That includes:

critical textures,

models,

catalog excerpts,

orbit data snapshot,

NEO experiment dataset,

selected exoplanets,

selected stellar catalog region,

Sagittarius A* configuration,

galaxy/cosmic-web sample,

CMB representation,

fonts,

UI assets.

Online mode may expose broader live data.

Offline mode must remain impressive.

### Browser and hardware degradation

Detect capabilities.

A high-end GPU may receive:

higher star counts,

more volumetric effects,

higher texture resolution,

advanced black-hole rendering,

larger particle budgets.

A weaker device may receive:

lower-resolution textures,

fewer particles,

simpler volumetrics,

approximate lensing,

reduced post-processing.

Do not simply let weak hardware run the same workload at 15 FPS.

Create quality presets if useful:

`Auto`

`Performance`

`Balanced`

`Ultra`

Auto should be competent.

### WebGPU strategy

WebGPU can be a major advantage for future versions, but do not make unsupported hardware a dead end.

Three.js currently demonstrates one possible strategy by offering WebGPU rendering with WebGL 2 fallback. citeturn17search0

Architect capabilities rather than assuming one backend everywhere.

The final decision depends on repository state and benchmark results.

### Code quality

Treat this as a real engineering project.

Prefer:

strict TypeScript where applicable,

clear module boundaries,

scientific logic separated from rendering,

rendering separated from UI,

data ingestion separated from runtime models,

small stable APIs,

explicit units,

good error handling,

instrumentation,

tests,

and documented decisions.

Avoid:

god classes,

global mutable state,

random magic constants,

scientific calculations inside JSX,

one-off coordinate hacks,

hard-coded object lists scattered around the codebase,

runtime scraping from random websites,

and giant files mixing data fetching, simulation, rendering and UI.

### Do not overengineer

Architecture is valuable only if it helps ship the project.

Do not spend the entire schedule creating a general-purpose universe ECS, custom compiler, custom database and new graphics engine before Earth appears on screen.

Prefer reversible decisions early.

Validate the hardest risks with vertical prototypes.

The dangerous unknowns are likely:

multi-scale coordinate precision,

smooth scale transitions,

huge catalog rendering,

Earth-to-cosmos rendering compatibility,

scientific-data normalization,

black-hole rendering performance,

and overall visual polish under exhibition hardware constraints.

Prototype those risks early.

### Failure states

The application must fail gracefully.

If an online catalog is unavailable:

show cached data.

If a texture cannot load:

show a fallback.

If WebGPU fails:

fall back if architecture supports it.

If a dataset property is missing:

show Unknown, not zero.

If an experiment receives impossible input:

validate it.

If a source is stale:

show its snapshot date.

A judge should never see a blank screen because an external API timed out.

### Logging and diagnostics

Provide a developer/debug overlay capable of showing:

FPS,

frame time,

renderer backend,

draw calls,

triangles/points,

loaded object counts,

current scale,

coordinate frame,

camera origin,

quality level,

memory statistics where available,

active data chunks,

network queue,

simulation time,

selected-object ID.

This will be invaluable when debugging universe-scale problems.

Keep it hidden in normal presentation mode.

### Data-source registry

Create and maintain a data-source registry as the project grows.

For every integration record:

source name,

maintaining organization,

purpose,

API/dataset mechanism,

license/usage conditions,

rate limits,

data fields used,

update cadence,

cache policy,

normalization module,

fallback behavior,

current dataset version,

known scientific limitations.

Likely organizations/services to investigate include:

NASA,

JPL,

CNEOS,

NASA Exoplanet Archive,

NAIF/SPICE,

ESA,

Gaia,

Space-Track,

CelesTrak,

CDS/SIMBAD,

NED,

DESI,

2MASS,

WISE,

HEASARC,

Planck,

IVOA HiPS,

and other official scientific services needed by specific features.

Do not blindly integrate all of them.

Choose sources based on actual product requirements.

### External research discipline

When researching implementation details:

prefer current official documentation,

record publication/update date when relevant,

check whether an API has been deprecated,

verify licenses,

verify authentication requirements,

verify CORS constraints,

verify rate limits,

verify whether redistribution is allowed,

verify whether an offline snapshot may be packaged,

and distinguish research prototypes from production services.

An API existing does not automatically mean the application may mirror its entire database.

### Security

Never expose private API keys in the client bundle.

Services requiring credentials should go through an appropriate backend/proxy or offline ingestion workflow.

Use least-privilege credentials.

Rate-limit backend proxy endpoints.

Validate external data.

Do not render arbitrary HTML from scientific metadata.

### Collaboration

This project is likely being produced by a team.

Make subsystem boundaries that allow different members to work without constantly colliding.

Potential ownership areas include:

core renderer,

Earth/atmosphere,

data pipeline,

orbital simulation,

Solar System,

exoplanets,

black holes,

cosmology,

UI/UX,

science validation,

presentation/storytelling,

testing/performance.

Do not mechanically impose this structure if the actual team organization differs.

### Documentation

You have authority to create the repository documentation required to make future development coherent.

Do not create documents simply to satisfy a checklist.

However, the repository should eventually have clearly discoverable documentation covering at least:

product vision,

architecture,

scientific models,

data sources/provenance,

coordinate systems,

rendering/LOD strategy,

UX principles,

performance budgets,

competition MVP,

roadmap,

setup/development workflow,

testing,

and the exhibition demo.

Create or consolidate documents based on what already exists.

Avoid maintaining five documents that repeat the same information.

Keep decisions close to implementation.

### Decision records

For major irreversible decisions, preserve concise rationale.

Examples:

Why Three.js vs Cesium vs another renderer?

Why WebGPU or not?

How does origin rebasing work?

How are catalogs spatially indexed?

What is the canonical coordinate system within each domain?

How does the Cosmic Ruler map camera scale?

How is scientific provenance represented?

How does offline mode work?

What accuracy does orbital propagation target?

Do not rely on future developers remembering why something was chosen.

### Competition pitch

The final pitch should not be:

> "We made a 3D model of space."

It should be closer to:

> **AstroNexus turns the universe into an interactive scientific laboratory. Instead of reading about orbital debris, planetary defense, exoplanets, relativity and cosmology as disconnected topics, students can travel through one continuous universe, inspect real scientific data, manipulate physical variables and immediately observe their consequences across scales ranging from kilometers to billions of light-years.**

The visual experience earns attention.

The experiments demonstrate science.

The architecture demonstrates innovation.

The datasets demonstrate authenticity.

The educational model supports SDG 4.

The international scientific-data ecosystem supports SDG 17.

### The judges should remember specific moments

Design the project so they remember:

seeing thousands of orbital objects suddenly appear around Earth,

realizing how crowded near-Earth space is,

deflecting an asteroid with a tiny velocity change years before encounter,

changing an exoplanet's stellar/orbital parameters and watching calculated conditions respond,

approaching Sagittarius A* and seeing background space distort,

watching two clocks diverge under gravitational time dilation,

pulling back until the Milky Way becomes one galaxy,

revealing millions of galaxies arranged in cosmic structure,

and finally reaching a CMB representation while being told they are looking toward the earliest electromagnetic light we can observe.

Those memories matter more than having 200 unfinished menu items.

### Product success criteria

The prototype is successful when a judge can:

open it without instructions,

understand where they are,

navigate confidently,

select astronomical objects,

see real scientific information,

understand which information is measured versus illustrative,

perform at least several meaningful experiments,

observe cause and effect,

travel across radically different scales,

experience consistently smooth performance,

and come away understanding astronomy better than before.

The engineering is successful when:

the renderer remains stable across scale transitions,

precision errors are controlled,

large datasets stream progressively,

scientific logic is testable,

data provenance is preserved,

the application can run its key path offline,

performance budgets are measurable,

and future datasets can be added without rewriting the entire system.

The exhibition is successful when:

the prototype is reliable,

the golden path is polished,

the team can explain the science,

the team can explain the engineering,

the team can explain the assumptions,

and the project clearly feels like the beginning of a platform rather than a one-off animation.

### Immediate operating procedure

Begin by inspecting the repository completely.

Understand what exists before changing it.

Then establish the current state of:

architecture,

rendering,

data,

UI,

performance,

documentation,

and unfinished work.

Research only the decisions that actually require research.

Build a concise project understanding.

Identify technical risks.

Identify the fastest route to the first polished vertical slice.

Create or revise the documentation you need.

Then execute.

Do not spend the entire first phase writing speculative documentation.

Do not begin by implementing every dataset.

Do not rewrite functioning code without evidence.

Do not accept visual mediocrity.

Do not accept scientific misinformation.

Do not hide performance problems.

Do not hard-code temporary assumptions into foundational architecture when a small abstraction can prevent it.

When choosing between breadth and excellence for the SCI-FORGE build, prefer a smaller number of extraordinary, deeply interactive experiences connected by a convincing universal architecture.

### Your decision authority

You may challenge assumptions in this context.

You may replace proposed libraries.

You may alter feature order.

You may simplify models for performance.

You may create better interaction patterns.

You may discover that a proposed data source is inappropriate.

You may create intermediate tools, converters and data pipelines.

You may revise architecture when benchmarks contradict assumptions.

You should not mechanically execute this prompt when evidence suggests a better solution.

However, preserve the fundamental product intent:

**one explorable universe, real science, continuous scale, exceptional visuals, exceptional UI/UX, meaningful experiments, excellent performance, scientific provenance, and a competition-ready vertical slice.**

### Final standard

Do not think of Cosmos as "a website about astronomy."

Think of it as:

**an interactive scientific universe engine.**

A student should be able to ask:

"What surrounds Earth?"

"What happens if orbital debris keeps accumulating?"

"Can we move an asteroid?"

"Why does a tiny delta-v matter years later?"

"What would change the equilibrium temperature of an exoplanet?"

"Does Earth-like mean habitable?"

"What would the sky look like near a black hole?"

"How does gravity affect time?"

"What does the Milky Way look like from outside?"

"How are galaxies distributed?"

"What changes when we observe infrared instead of visible light?"

"How far can we see?"

"What does the edge of the observable universe actually mean?"

and instead of receiving only text, **travel to the relevant place, manipulate the relevant physics, inspect the relevant data, and see the answer happen.**

That is the project.

Build toward that.

### END MASTER CONTEXT

## Recommended target architecture and competition definition

The master prompt intentionally gives the coding agent freedom, but the research points toward a fairly clear product architecture.

A useful conceptual separation is:

```text
COSMOS
│
├── Experience Layer
│   ├── Navigation
│   ├── Cosmic Ruler
│   ├── Search
│   ├── Object Inspector
│   ├── Science Labs
│   ├── Tours / Exhibition Mode
│   └── Spectral Views
│
├── Universe Runtime
│   ├── Camera + Scale Manager
│   ├── Coordinate Frames
│   ├── Time Controller
│   ├── Entity Registry
│   ├── Selection / Picking
│   ├── Scene Streaming
│   └── Capability / Quality Manager
│
├── Render Domains
│   ├── Earth Renderer
│   ├── Orbital Object Renderer
│   ├── Solar System Renderer
│   ├── Stellar Renderer
│   ├── Galactic Renderer
│   ├── Extragalactic Renderer
│   └── Cosmological Renderer
│
├── Scientific Simulation
│   ├── Orbital Propagation
│   ├── Debris Sandbox
│   ├── Asteroid Deflection
│   ├── Exoplanet Physics
│   ├── Relativistic Models
│   └── Scientific Units / Uncertainty
│
├── Scientific Data
│   ├── Source Connectors
│   ├── Normalization
│   ├── Provenance
│   ├── Coordinate Conversion
│   ├── Derived Values
│   ├── Spatial Indexing
│   └── Offline Snapshots
│
└── Infrastructure
    ├── Workers
    ├── Binary Streaming
    ├── Caching
    ├── Performance Telemetry
    ├── Tests
    └── Deployment
```

This separation avoids a common failure mode in graphics applications where the React/UI tree, scientific calculations, API fetching, and Three.js scene objects become tightly coupled.

The most important architectural concept is that **the renderer should consume a normalized universe model, not raw NASA/SIMBAD/JPL response objects**. APIs change. NASA Exoplanet Archive has already retired older planet-table interfaces, CelesTrak has had to move beyond legacy identifier assumptions, and NED has changed which interfaces expose newly ingested data. citeturn2search20turn1search14turn3search17 A normalization layer turns those external changes into connector problems rather than application-wide rewrites.

Likewise, the Cosmic Ruler should not literally scale one enormous scene from \(10^3\) meters to \(10^{26}\) meters. It should control a **scale state machine** that determines current reference frame, camera dynamics, visible catalogs, renderer, annotation hierarchy, precision strategy, and representation level.

A conceptual flow is:

```text
Camera scale changes
        ↓
Scale Manager
        ↓
Determine active spatial domains
        ↓
Request appropriate data tiles
        ↓
Choose representation LOD
        ↓
Rebase coordinate origin if required
        ↓
Cross-fade old/new representation
        ↓
Update units + labels + Cosmic Ruler
```

The same concept applies to the spectral switcher:

```text
Object/sky direction
        ↓
Spectral mode
        ↓
Relevant scientific dataset
        ↓
HiPS / tiled survey retrieval
        ↓
Instrument-aware visualization
        ↓
Educational explanation
```

That is materially better than applying an orange shader and calling it "infrared." HiPS was specifically designed for progressive hierarchical sky imagery, making actual dataset substitution technically plausible. citeturn5search11turn5search5

### Recommended competition vertical slice

For SCI-FORGE, I would define the first "complete" version as seven polished connected moments rather than the entire eventual platform.

| Experience | What it proves |
|---|---|
| Earth and orbital environment | Core renderer, visual quality, data integration |
| Space debris/Kessler lab | Real-world problem, Earth sustainability, simulation |
| Solar System travel | Multi-scale navigation |
| NEO/DART lab | Applied physics and planetary defense |
| Exoplanet system and lab | Stellar data, thermodynamics, astrobiology education |
| Sagittarius A* | Relativity, advanced shader work, visual spectacle |
| Galaxies → cosmic web → CMB | Massive-data architecture and cosmic scale |

The competition build can have fewer individually detailed destinations while the architecture supports future expansion. That is preferable to claiming to support the entire universe while every destination is shallow.

### Performance definition

"Optimized" should become measurable rather than subjective. WebGPU, instancing and LOD are useful techniques, but none guarantee performance automatically. WebGPU is designed around modern GPU capabilities, Three.js instancing reduces draw calls for repeated geometry, and OGC 3D Tiles demonstrates hierarchical streaming for massive spatial datasets. citeturn16search1turn17search1turn16search2

I would give the exhibition build targets similar to:

| Metric | Desired exhibition target |
|---|---:|
| Interaction frame rate | 60 FPS target on demo hardware |
| Minimum acceptable sustained frame rate | 45 FPS in hero scenes |
| Major interaction latency | Visually immediate |
| Long main-thread stalls | Treat as defects |
| Scale transition | No blocking loading screen |
| Core demo network dependency | None |
| External API failure | Never breaks golden path |
| Data loading | Progressive |
| Quality | Automatic hardware adaptation |
| Scientific calculations | Unit-tested |
| Hero-scene regressions | Visually testable |

These are project requirements rather than claims about universal performance.

The developer should instrument the application early. Otherwise the team will discover too late that a beautiful black-hole shader, orbit renderer, bloom pass, enormous labels layer, React update loop, or catalog parser destroys the frame budget.

### The deeper product opportunity

The most important idea hidden inside the original request is that Cosmos can have **two simultaneous modes of truth**:

```text
EXPLORE REALITY
       ↕
EXPERIMENT WITH REALITY
```

In Explore Reality, users see the best reconstruction supported by actual measurements.

In Experiment With Reality, users intentionally change parameters and explore "what if?" scenarios.

That division solves several design problems at once.

It lets an exoplanet have a catalog-backed state and a modified experimental state.

It lets an asteroid have its measured orbit and a deflected sandbox orbit.

It lets Earth orbit contain the actual tracked population and hypothetical Kessler scenarios.

It lets a black hole begin with measured mass and then permit controlled parameter experimentation.

It prevents simulations from becoming misinformation because the interface can always expose **Real**, **Modified**, and **Difference**.

That can become a defining feature of AstroNexus.

The final product vision is therefore larger than "Google Earth for space." It is closer to:

> **A scientifically traceable digital universe in which every scale can become a laboratory.**

That is a much stronger project thesis for both SCI-FORGE 2026 and any serious development that continues afterward.


This is to be a open world exploration platform completely open we start on earth we get info on earth in the context of space and astronomics then we can move to solar system u can fly or move around the solar system and see any and all info abt the stars or constellations or each of the notable thigns like asteroids and the ISS and the other things then we can move to the milky way and the other galaxies then the galaxy clusters superclusters then the observable universe, and what not all the way out and this includs everything like black holes planets etc whatever we have science and data on exoplanets and stars everything is too look extremely good and rendered perfectly with lighting and etc everything is to be 3d intuitive and interactable it must be extremely optimized to run perfectly and not poor performance obviosly as mentioned must be intuitive so the ui/ux must be through the roof as good as it gets https://www.solarsystemscope.com/ Inspo it has basicly what we are going for but very small scoped as compared to ours 

the context behind this project is SCI-FORGE 2026 is more than just a science exhibition. It is a platform for students to think like scientists, transform ideas into working models or prototypes and apply scientific principles to meaningful real-world problems. Through investigation, experimentation and innovation, students will bring their scientific ideas to life and explore how science can shape the future. 
1. Earth Scale — Space Debris & Kessler Syndrome Simulator: Don't just show the ISS; visualize the 30,000+ tracked pieces of orbital debris threatening global satellites. Let judges click a piece of debris to calculate its orbital decay or test mitigation strategies (such as laser nudging or de-orbit tethers) to clear safe launch corridors.
2. Solar System Scale — Planetary Defense & Asteroid Deflection Lab: Pull real data on Near-Earth Objects (NEOs). Allow the user to simulate a kinetic impactor (like NASA's DART mission) by adjusting spacecraft mass and impact velocity ($\Delta v$) to see in real time how a tiny nudge shifts an asteroid's orbital trajectory away from Earth over several years.
3. Milky Way Scale — Exoplanet Habitability Calculator: When visiting an exoplanet, let users tweak stellar classification, orbital distance ($a$), and planetary albedo ($A$) to dynamically calculate the Planetary Equilibrium Temperature and Earth Similarity Index (ESI):
   $$T_{eq} = T_{\star} \sqrt{\frac{R_{\star}}{2a}} (1 - A)^{1/4}$$
   Visually update the planet's 3D shader in real time (freezing over, developing liquid oceans, or turning into a runaway greenhouse like Venus) as the user changes parameters.
4. Deep Space Scale — Relativistic Black Hole Lens: When flying near black holes like Sagittarius A*, include a toggleable "Relativistic Physics Engine" that visualizes the Schwarzschild radius ($r_s = \frac{2GM}{c^2}$), gravitational lensing of background galaxies, and a live "Time Dilation Clock" comparing elapsed time on the user's spacecraft versus Earth.
5. Logarithmic Scale Scrubber ("The Cosmic Ruler"): Instead of forcing users to fly manually for hours through empty space, build a sleek bottom timeline/scale bar that smoothly transitions coordinate systems from Kilometers (km) → Astronomical Units (AU) → Light-Years (ly) → Megaparsecs (Mpc).
6. Dynamic Level-of-Detail (LOD) & GPU Instancing: Render millions of stars and galaxy clusters at 60+ FPS by rendering distant galaxies as GPU-instanced point-cloud particles that seamlessly cross-fade into procedural 3D meshes and volumetric shaders only when the camera approaches.
7. Spectral View Switcher: Add a hotbar that lets the user view the universe across different wavelengths—Visible Light, Infrared (JWST style), X-Ray, and Microwave (Cosmic Microwave Background)—teaching students how astronomers see hidden structures through cosmic dust.
What the event entails:
Students will choose one arena of interest and collaborate in house-wise teams (groups with minimum 8 to maximum 10 members) to:
- Design and develop a working model or prototype addressing a real-world challenge.
- Demonstrate the scientific principles and technological concepts behind their innovation.
- Establish a meaningful connection between their project and the UAE Sustainable Development Goals (SDGs).
- Showcase their innovation through live demonstrations, presentations and discussions with judges.
Evaluation criteria

. Scientific Insight

. Innovation
Quotient

. Prototype
Performance

. Problem-Solving
Impact

.
Relevance

Pitch &
Presentation

SDG & Future

.AstroNexus – Exploring the Cosmic Frontier
SDG 4 – Quality Education – astronomy and STEM learning
SDG 17 – Partnerships for the Goals – international space research and collaboration

You are on opus 5.5 max on ultracode so use dev tools chrome mcps skills etc to ur advantage especially using multiple agent swarms