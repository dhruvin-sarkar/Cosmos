# Solar System data (domain `solar`)

All files live in `public/data/solar/` (served as `/data/solar/...`). Everything is bundled offline; every number is traceable via the `sources` / `source` fields and `manifest.part.json` (dataset records). Snapshot retrieved 2026-10-16..18 (see `retrieved` in each file).

Pipeline (re-runnable, idempotent, raw cache in `data-raw/solar/`, gitignored):

| Step | Script | Output |
|---|---|---|
| reference pages/kernels | `scripts/data/solar/fetch-ref.mjs` | cache only |
| SBDB notable bodies | `fetch-smallbodies.mjs` -> `build-smallbodies.mjs` | `smallbodies.json` |
| planets/moons | `build-bodies.mjs` (needs the two steps above) | `bodies.json` |
| asteroid point cloud | `fetch-asteroids.mjs` | `asteroids.bin`, `asteroids.json` |
| NEOs/PHAs | `fetch-neos.mjs` (needs smallbodies.json) | `neos.json` |
| close approaches | `fetch-cad.mjs` | `close-approaches.json` |
| Sentry | `fetch-sentry.mjs` | `sentry.json` |
| spacecraft | `fetch-spacecraft.mjs` | `spacecraft.json` |
| space weather | `fetch-space-weather.mjs` | `space-weather.json` |

Shared helpers: `lib.mjs` (polite cached fetch, >=1.1 s per host, User-Agent `Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)`), `parsers.mjs`, `astro.mjs`. `--refresh` re-downloads.

## Sources, licences, credits

| Dataset id | Source | Terms |
|---|---|---|
| jpl-ssd-planet-phys-par, jpl-ssd-satellite-phys-par, jpl-ssd-satellite-mean-elements, jpl-ssd-satellite-discovery, jpl-ssd-approx-pos | NASA JPL Solar System Dynamics (ssd.jpl.nasa.gov) HTML tables | US Government work, no restrictions stated; do not imply endorsement. Credit: "NASA/JPL Solar System Dynamics". |
| jpl-sbdb-notable-small-bodies, jpl-sbdb-numbered-asteroids, jpl-sbdb-neos-phas | JPL SBDB API / Query API | JPL SSD/CNEOS API fair-use policy (one request at a time, cache). Credit: "NASA/JPL Small-Body Database". |
| cneos-cad-close-approaches, cneos-sentry | CNEOS CAD and Sentry APIs | same. Credit: "NASA/JPL-Caltech CNEOS". |
| jpl-horizons-spacecraft | JPL Horizons API | same. Credit: "NASA/JPL Horizons". |
| naif-pck00011, naif-gm-de440 | NAIF generic kernels | free to use and redistribute unmodified; cite Archinal et al. 2018 (CeMDA 130:22) and Park et al. 2021 (AJ 161:105). |
| nssdca-planetary-fact-sheets | NASA GSFC NSSDCA fact sheets | NASA content, not copyrighted; credit NASA. |
| nasa-donki-space-weather | NASA CCMC DONKI via api.nasa.gov | NASA content; credit "NASA CCMC DONKI". |
| noaa-swpc-solar-cycle-indices | NOAA SWPC JSON | US Government work; sunspot numbers originate from SILSO / Royal Observatory of Belgium. |

Dimorphos / DART literature: Thomas et al. 2023, Nature 616:448; Cheng et al. 2023, Nature 616:457; impact-parameter table of the DART papers (Nature 616, 2023). Hera status: ESA, "ESA's Hera targets early arrival at Didymos asteroids" (Oct 2025).

Provenance classes: planet/moon physical values `observed`; derived quantities (gravity, escape speed, moon masses from GM, `diameterEstKm`) are labelled in field notes as derived.

## Conventions

- Missing = `null` (never 0; JPL's "0" for unknown moon GM is converted to `null`).
- Angles degrees; distances km or AU as in field names; time scale of all JDs is TDB unless a field says UTC. Heliocentric orbital elements are ecliptic J2000; spacecraft vectors are ICRF (equatorial J2000 axes).
- Large tables are `{schemaVersion, generated, fields:[...], rows:[[...]]}`; row order = `fields` order.

## bodies.json

`{schemaVersion, generated, notes, bodies:[Body...]}` with 38 bodies: sun; mercury..neptune; ceres, pluto, eris, haumea, makemake; moon; phobos, deimos; io, europa, ganymede, callisto, amalthea; mimas, enceladus, tethys, dione, rhea, titan, hyperion, iapetus; miranda, ariel, umbriel, titania, oberon; triton, nereid; charon.

Body fields:

- `id` lowercase; `name`; `kind` `star|planet|dwarf-planet|moon`; `parentId` (`sun`, planet id, or `pluto`; Sun null); `naifId` (planets: 199..899 body ids; Pluto 999; Ceres 2000001; Eris/Haumea/Makemake 2136199/2136108/2136472).
- `radius {equatorialKm, polarKm, meanKm, triaxialKm?}`; moons: triaxial [a,b,c] from PCK where available; `polarKm` null if unknown.
- `massKg`, `massSigmaKg?`, `gmKm3s2` (+`gmSigmaKm3s2` moons), `densityKgM3`.
- `surfaceGravityMs2` = GM/R_eq^2 (moons: mean radius), `escapeVelocityKms` = sqrt(2GM/R_mean). Derived, non-rotating; gas/ice giants refer to the 1-bar level.
- `rotation`: `{siderealPeriodHours, poleRaDeg, poleDecDeg, poleRaRateDegPerCentury, poleDecRateDegPerCentury, w0Deg, wDotDegPerDay, wDotDotDegPerDay2?, poleRateSecondDegPerCentury2?, periodicTerms?, model, note}`. IAU WGCCRE 2015 (Archinal et al. 2018) via NAIF `pck00011.tpc`. `pole(T)=pole0+rate*T` (T Julian centuries from J2000), `W(d)=w0+wDot*d+wDotDot*d^2` (d days from J2000 TDB). Negative `siderealPeriodHours` = W decreasing (Venus, Uranus). `periodicTerms` (bodies with nutation/precession terms: Mercury, Mars, Jupiter, Neptune, Moon, Phobos, Amalthea, ...) = `{system, angleNames[], anglesDeg:[[theta0, rate_deg_per_century],...], raSinDeg[], decCosDeg[], wSinDeg[]}`: RA += sum raSin_k*sin(theta_k), Dec += sum decCos_k*cos(theta_k), W += sum wSin_k*sin(theta_k), with theta_k = theta0_k + rate_k*T. Dwarf planets Eris/Haumea/Makemake and Hyperion, Nereid have no IAU pole; only a period (if any) with pole fields null. Pluto/Charon: IAU positive pole convention (period positive, obliquity 119.5 deg).
- `obliquityDeg` (axial tilt to orbit; NSSDCA; null for most moons).
- `albedo {geometric, bond}` (null if unknown), `temperature {meanK|minK|maxK|effectiveK, note?}`, `atmosphere {surfacePressureBar, composition}` (null if none known; `surfacePressureBar` null for gas giants).
- `orbit`:
  - planets: `{model, refPlane:"ecliptic J2000", epochJD:2451545, timeScale, aAU, e, iDeg, LDeg (mean longitude), lonPeriDeg (longitude of perihelion), nodeDeg, aAUPerCentury, ePerCentury, iDegPerCentury, LDegPerCentury, lonPeriDegPerCentury, nodeDegPerCentury}` (Standish Table 1, 1800-2050; Earth row = Earth-Moon barycentre). Argument of perihelion = lonPeri - node; mean anomaly = L - lonPeri.
  - dwarf planets: SBDB osculating `{epochJD, aAU, e, iDeg, nodeDeg, argPeriDeg, meanAnomalyDeg, periodDays}`.
  - moons: `{epochJD (TDB, 2000-01-01.5 for most), aKm, e, iDeg, nodeDeg, periDeg (argument of periapsis), meanAnomalyDeg, periodDays, refPlane:"laplace"|"ecliptic"|"equatorial", laplacePoleRaDeg, laplacePoleDecDeg, laplaceTiltDeg, ephemeris}` relative to the parent. `laplace`: reference plane is the one whose pole is (RA,Dec) in ICRF; `equatorial`: parent equator J2000; `ecliptic`: ecliptic J2000. Mean elements for drawing orbit lines, not precise positions (and `nodeDeg` of an `equatorial`/`laplace` frame is measured in that plane).
  - Sun: `orbit: null`.
- `discovery {by, year}` (null for classical planets, Moon).
- `summary` (editorial, 1-2 sentences). `sources {fieldGroup: datasetId}` (ids from `manifest.part.json`; `literature`, `iau-2015-b3-*` denote values taken from the IAU 2015 Resolution B3 nominal constants / cited papers).
- Sun extras: `luminosityW`, `spectralType`.

## smallbodies.json

`{schemaVersion, generated, retrieved, notes, bodies:[...]}`, 28 records: 23 notable bodies (Ceres, Vesta, Pallas, Hygiea, Psyche, Eros, Bennu, Ryugu, Itokawa, Apophis, Didymos, 2024 YR4, Phaethon, 1P/Halley, 2P/Encke, 9P/Tempel 1, 67P, C/1995 O1, 1I, 2I, 3I/ATLAS, Arrokoth, Sedna), 4 `role:"dwarf-planet-orbit-only"` (pluto, eris, haumea, makemake) and `dimorphos` (`role:"literature"`).

Fields: `id, name, fullname, designation, spkid, kind (asteroid|comet|interstellar|asteroid-moon), orbitClass, neo, pha, H, M1, K1 (comet magnitudes), diameterKm, diameterSigmaKm, albedo, rotationPeriodH, spectralType, gmKm3s2, extentKm, elements {epochJD, aAU, e, iDeg, nodeDeg, argPeriDeg, meanAnomalyDeg, qAU, periodDays, tpJD}, sigmas {same keys, 1-sigma, null if absent}, conditionCode, dataArcDays, nObsUsed, moidAU, solutionDate, discovery {by,date,site}, role, source`. Elements are osculating heliocentric ecliptic J2000, JD TDB; hyperbolic orbits have negative `aAU` (and `periodDays` null); `3i-atlas` e = 6.14 is hyperbolic.

`dimorphos`: `binaryOrbit {aboutId, semiMajorAxisKm 1.19, periodPreImpactH 11.921, periodPostImpactH 11.372, periodChangeMin -33.0, periodChangeSigmaMin3 1.0, ...refs}`, `dart {massAtImpactKg 579.4 (+/-0.7), impactSpeedKms 6.1449 (+/-0.0003), kineticEnergyGJ 10.94, beta 3.61 (+0.19/-0.25) at assumed density 2400 kg/m3, betaRange [2.2,4.9] for 1500-3300 kg/m3, alongTrackVelocityChangeMmS -2.7 +/-0.1}`, `volumeKm3 0.00181 (+/-10%)`, `massKgEstimate 4.3e9` (derived, not measured), `hera {...}`. Verification status: the -33.0 +/- 1.0 min (3 sigma) period change, beta and its density assumption, DART mass/speed/energy and Dimorphos volume were confirmed against the abstracts / Nature impact-parameter table; the 11.921 h and 11.372 h periods and the 1.19 km orbit radius come from the task brief, are consistent (difference 32.9 min) but were not confirmed in the full paper text (paywalled). Hera: launched 2024-10-07; ESA announced (Oct 2025) arrival in November 2026; Horizons coverage for Hera also ends 2026-11-04. As of 2026-10-16 no change of schedule was found; arrival has not yet happened.

## asteroids.bin / asteroids.json

`asteroids.json` header: `{count 75855, stride 9, strideBytes 36, byteLength, dtype "float32", endianness "little", fields:[{name,unit}], epochBaseJD 2461200.5, hMax 15, classCodes {MBA:0,...}, classCounts, order, selection, note}`. Body i occupies floats `[i*9, i*9+9)`: `aAU, e, iDeg, nodeDeg, argPeriDeg, meanAnomalyDeg, epochOffsetDays, H, classCode`. JD TDB of the osculating epoch = `epochBaseJD + epochOffsetDays` (per-body epoch; most equal the base). Sorted by H ascending. Selection: numbered asteroids with H < 15 (SBDB Query API `sb-ns=n`, `H|LT|15`), rows with any missing element dropped (none were). Class counts: MBA 58458, OMB 5277, TJN 10175, TNO 1049, CEN 209, IMB 243, MCA 380, AMO 27, APO 21, ATE 2, AST 14. Float32 precision is ~1e-7 relative: adequate for point rendering and propagation to a few years.

## neos.json

`{schemaVersion, generated, retrieved, notes, assumedAlbedoForEstimate 0.14, fields, rows}`; 3449 rows (all 2550 PHAs + NEAs with H<18 + notable NEOs), sorted by H ascending. Fields (units): `spkid, fullname, designation, orbitClass, pha (bool), H (mag), diameterKm (measured or null), diameterSigmaKm, diameterEstKm (DERIVED: 1329/sqrt(0.14)*10^(-H/5), 4 sig. digits, factor ~2 uncertain), albedo, rotationPeriodH, moidAU (Earth MOID), epochJD (TDB), aAU, e, iDeg, nodeDeg, argPeriDeg, meanAnomalyDeg, tpJD, periodDays, sigmaAAU, sigmaE, sigmaIDeg, sigmaNodeDeg, sigmaArgPeriDeg, sigmaMeanAnomalyDeg, conditionCode (0-9, lower is better), dataArcDays, nObsUsed`.

## close-approaches.json

`{schemaVersion, generated, source, retrieved, window, notes, fields, rows}`; fields `des, fullname, cdTDB ("YYYY-Mon-DD HH:MM" TDB), jdTDB, distAU (nominal geocentric centre-to-centre), distMinAU, distMaxAU (3-sigma), vRelKms, hMag, diameterKm, diameterSigmaKm, timeSigma (CAD t_sigma_f string)`. Earth approaches < 0.05 AU, 2026-10-16..2036-10-16, plus Apophis 2029-04-13 (0.000254 AU, 7.42 km/s; checked against the published ~38,000 km from centre).

## sentry.json

`{schemaVersion, generated, source, retrieved, notes, fields, rows}`; fields `des, fullname, ipCumulative (cumulative impact probability 0-1), psCum, psMax (Palermo), tsMax (Torino 0-10), nImp, yearMin, yearMax, hMag, diameterKm, massKg, vInfKms, lastObs, lastObsJD`; sorted by `ipCumulative` descending.

## spacecraft.json

`{schemaVersion, generated, retrieved, notes, craft:[...]}`; per craft `{id, name, naifId, centerId ("sun"|"earth"), frame "ICRF", units "km", timeScale "TDB (JD)", startJD, stepDays, count, coverage {requested, delivered, trimmed}, samples:[x,y,z,...] (length 3*count), mission {agency, launchDateUTC, status, summary}, source, retrieved}`. Sample i at JD(TDB) = `startJD + i*stepDays`. Craft: voyager-1, voyager-2, new-horizons (5-day step), parker-solar-probe, juno, europa-clipper, psyche, lucy, hera, juice, bepicolombo (1-day), jwst (centre Earth, 500@399). Trimmed coverage (Horizons has no ephemeris beyond): Parker to 2029-12-30, Juno to 2028-08-31, Psyche to 2029-02-09, Hera to 2026-11-02, BepiColombo to 2027-04-09. Do not extrapolate. Mission status strings are editorial, dated October 2026.

## space-weather.json

`{schemaVersion, generated, retrieved, window{from,to}, notes, flares, cmes, geomagneticStorms, solarCycle}`; flares >= M1.0: `{id, beginTimeUTC, peakTimeUTC, endTimeUTC, classType, peakFluxWm2, activeRegion, sourceLocation}`; CMEs: `{id, startTimeUTC, sourceLocation, activeRegion, speedKms, halfAngleDeg, type, latitudeDeg, longitudeDeg, note}` (from the most-accurate DONKI analysis, null if none); storms: `{id, startTimeUTC, maxKp, maxKpTimeUTC, nKpSamples}`; `solarCycle {source, fields:["month","ssn","smoothedSsn","f107Sfu","smoothedF107Sfu"], rows}` monthly from 1950-01 (null for missing). See "Status" below if the DONKI part is absent.

## Validation performed

- Counts: bodies 38, smallbodies 28, asteroids 75,855, NEOs 3,449 (2,550 PHAs), spacecraft 12, all files scanned for NaN/Infinity (writers assert finite numbers).
- Spot checks against published values (script asserts): Earth mean radius 6371.0 km, mass 5.9722e24 kg, g 9.80 m/s2, v_esc 11.19 km/s; Sun mass 1.98841e30 kg, v_esc 617.6 km/s; Jupiter mass 1.8981e27 kg; Moon mass 7.346e22 kg, g 1.62; Titan radius 2574.7 km; sidereal rotation Mars 24.6229 h, Earth 23.9345 h, Venus -5832.5 h, Pluto 153.29 h, Neptune 15.966 h (IAU 2015; NSSDCA still lists the older 16.11 h); Triton period 5.877 d; Mars a 1.5237 AU; Uranus obliquity 97.77 deg; Apophis a = 0.922 AU, 2029-04-13 distance 0.000254 AU, 7.42 km/s; Voyager 1 at 165.7 AU and Voyager 2 at 138.5 AU on 2025-01-01; Parker Solar Probe minimum 9.86 solar radii.
- Known differences: NSSDCA Mercury pole/period vs IAU: periods derived from the IAU W rate (e.g. Mercury 1407.5 h).

## Known limitations

- Planet elements (Standish) are approximations (arcminute-level); use astronomy-engine for runtime positions.
- Moon elements are mean elements at one epoch; orbit lines only.
- Eris/Haumea/Makemake: no IAU rotation pole, large mass/radius uncertainties; Ceres/Pluto SBDB orbits are osculating.
- NEO diameters without measurement use an H-based estimate with fixed albedo 0.14 (factor ~2); Sentry probabilities change as orbits improve.
- Spacecraft tracks are predictions; Parker 1-day sampling undersamples perihelion.
- Asteroid belt sample is limited to H<15 and does not include unnumbered objects.
- Titan surface pressure (1.467 bar) comes from the Huygens literature, not from the fetched NSSDCA sheets.
- Hera arrival (November 2026) is a plan as of 2026-10-16.

## Status of space weather

INCOMPLETE: NASA DONKI (api.nasa.gov and the keyless CCMC host) returned HTTP 503 / was unreachable throughout ingestion on 2026-10-18. `space-weather.json` therefore has `donkiStatus` starting with "unavailable", EMPTY `flares`, `cmes`, `geomagneticStorms` arrays (empty means not fetched, not zero activity) and a valid `solarCycle` series (last month 2026-09: SSN 60.3, F10.7 105.4 sfu). Re-run `node scripts/data/solar/fetch-space-weather.mjs` when DONKI recovers; it caches per half-year chunk in `data-raw/solar/donki/`, needs no code changes, and also adds the `nasa-donki-space-weather` manifest record. The NASA key is read only from `.env.ingest.local` inside the script and never logged.
