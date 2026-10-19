# Orbital data (CelesTrak GP + SATCAT)

Domain `orbital` -> `public/data/orbital/`. Provenance: GP rows **observed** (SGP4 mean elements); SATCAT-shape rows **reconstructed** (orbit shape only; RAAN, argument of perigee and phase are illustrative); shell statistics **derived**.

## Sources and licence

| Source | Endpoint | Notes |
|---|---|---|
| CelesTrak GP (OMM CSV) | `https://celestrak.org/NORAD/elements/gp.php?GROUP=<g>&FORMAT=CSV` (also `SPECIAL=`, `NAME=`) | 46 groups, 3 SPECIAL sets (GPZ, GPZ-PLUS, DECAYING), `NAME=DEB`, `NAME=R/B`, 14 `NAME=` family searches. No credentials. |
| CelesTrak SATCAT | `https://celestrak.org/pub/satcat.csv` | All objects; we keep those with no decay date. |
| SATCAT code tables | celestrak.org SATCAT documentation pages (owner and launch-site codes) | Parsed from HTML (no structured form exists). Text kept as published. |

- **Licence:** there is no formal open-data licence. The data is "basic SSA data" from USSPACECOM (18th/19th Space Defense Squadrons) via Space-Track.org. The Space-Track User Agreement grants blanket approval for redistribution conditioned on citation. CelesTrak usage policy: https://celestrak.org/usage-policy.php
- **Required credit:** "Orbital data: CelesTrak (Dr T.S. Kelso, https://celestrak.org), GP element sets and SATCAT; source data: U.S. Space Force 18th & 19th Space Defense Squadrons / USSPACECOM via Space-Track.org."
- **Rate limits (checked 2026-10-18):**
  - Download each data set at most once per update. CelesTrak checks for new GP only every 2 h, and 18 SDS GP updates only 2-3x per day.
  - A repeat request before the next update returns HTTP 403.
  - Stop on any 301/403/404 response. More than 50 such errors in 2 h can get the IP firewalled.
  - The pipeline waits 2.5 s between requests and never re-downloads cached files. Raw cache lives in `data-raw/orbital/` (gitignored, ~13 MB).
- **Full catalog without credentials?** Effectively yes for GP. The union of `active`, the debris and special groups, `analyst` and the NAME searches covers 31,839 of 35,652 on-orbit objects. The rest have no public GP at CelesTrak (about 800 are "NEA", no elements available). The complete Space-Track `gp` class needs an account. **Never embed credentials.** A server-side Space-Track backend is a future option only.

## Catalog-number claim (verified 2026-10-16 and 2026-10-18)

The claim is **accurate, with one correction**.
- celestrak.org banner: "We ran out of 5-digit catalog numbers on 2026-07-11." The SATCAT is now at 101074.
- The 5-digit ceiling for ordinary entries is **69999**, not 99999. Last 5-digit entry: 69999 VANGUARD DEB. First 6-digit entry: 100000 SARAMAGO. 70000-99999 are not used in SATCAT; 80000-89999 is the 18 SDS analyst range.
- The TLE format cannot carry numbers above 99999. CelesTrak states that new objects have no TLE, only CSV, JSON and XML. Analyst numbers up to 9 digits exist (e.g. 7995xxxxx; Starlink SupGP uses 799xxxxxx).
- CelesTrak's default format changed to CSV on 2026-05-09. CSV is its internal format. JSON is about 3x larger.
- **Cosmos:** NORAD ids are strings, only OMM CSV is parsed, and TLE fixed-width fields are never used. Catalog contains 1075 six-digit SATCAT entries (1428 rows with 6 or more digits, including analyst objects).

## Files

### `catalog.json` (~9.1 MB)
`{"schemaVersion":1,"generated":ISO,"epochNote":str,"counts":{...},"fields":[27 names],"rows":[[...]]}`. 35,652 rows, positional by `fields`, sorted by NORAD number. The first 24 fields are the contract; the last 3 are extensions.

| # | field | type / unit |
|---|---|---|
|0|norad|string, decimal digits (up to 9)|
|1|name|string|
|2|intlDes|string, COSPAR id e.g. `1998-067A`, or null|
|3|objectClass|`payload`\|`rocket-body`\|`debris`\|`unknown` (SATCAT PAY/R/B/DEB/UNK; analyst objects: see summary definitions)|
|4|isActive|true if SATCAT status in {+,P,B,S,X}, or status blank and in the `active` group; false if status `-` or debris/rocket body; else null|
|5|owner|SATCAT owner code (see `lookups.ownerCodes`), or null|
|6|launchDate|`YYYY-MM-DD` UTC, or null|
|7|rcsSize|`SMALL`\|`MEDIUM`\|`LARGE`\|null (about 58% null)|
|8|groups|array of CelesTrak group tags (see `lookups.groupTags`); `[]` if none|
|9|hasElements|bool; true iff elementSource is `celestrak-gp`|
|10|epochUTC|ISO-8601 UTC with Z, null when no GP|
|11|meanMotionRevPerDay|rev/day, Kozai mean motion (SGP4 input)|
|12|eccentricity|dimensionless|
|13|inclinationDeg|deg (GP: TEME of epoch; satcat-shape: SATCAT)|
|14|raanDeg|deg|
|15|argPerigeeDeg|deg|
|16|meanAnomalyDeg|deg|
|17|bstar|1/earth-radii|
|18|meanMotionDot|rev/day^2 (TLE convention)|
|19|meanMotionDdot|rev/day^3|
|20|apogeeKm|km above a sphere of R=6378.135 km (mean apsis altitude)|
|21|perigeeKm|same|
|22|periodMin|minutes|
|23|elementSource|`celestrak-gp`\|`satcat-shape`\|null (no orbit data at all, 332 rows)|
|24|launchSite|SATCAT site code (see `lookups.launchSiteCodes`)|
|25|opsStatusCode|SATCAT `OPS_STATUS_CODE` (`+ - P B S X D ?`) or null|
|26|rcsM2|m^2, null if absent|

- **Null handling:** missing means null, never 0. `satcat-shape` rows have null for eccentricity, RAAN, argument of perigee, mean anomaly, bstar, mean-motion derivatives and epoch. Use only inclination, perigee, apogee and period.
- **Propagation:** GP rows are SGP4/SDP4 mean elements in TEME. Propagate with SGP4 (e.g. satellite.js `json2satrec`) from `epochUTC`. Do not treat them as osculating Keplerian elements. The accuracy and display-honesty rules are in `epochNote`.
- **Counts:** total 35,652; withElements 31,839; satcatShapeOnly 3,481; noOrbitData 332; payload 20,163; rocket-body 2,297; debris 12,543; unknown 649 (includes 594 analyst objects not in SATCAT); active 17,264; docked 14.

### `summary.json` (~19 KB)
Keys: `snapshot` (retrieval times and element-age statistics), `definitions` (class, isActive and regime rules), `counts` (including `byRegime` and `byRegimeAndClass`), `altitudeShells`, `notableObjects`, `catalogNumbers`, `referenceFigures`, `qualityNotes`.
- **Regimes** (mean apsis altitudes, tested in this order):
  1. GEO: mean altitude 35786 ± 200 km and e < 0.01.
  2. LEO: apogee < 2000 km.
  3. MEO: perigee ≥ 2000 km and apogee ≤ 31570 km.
  4. HEO_OTHER: all remaining objects with a known orbit.
  5. UNKNOWN: no orbit information.
- `altitudeShells`: 50-km bins from 200 to 2000 km, with `edgesKm`, `series` (by class), `countsByMeanAltitude`, `timeWeightedObjects` (fraction of period spent in each shell), `spatialDensityPerKm3` and `shellVolumesKm3`.
- `notableObjects`: ISS 25544, CSS Tianhe 48274, HST 20580, LAGEOS-1 8820, Vanguard 1 5, and others. Each entry has `present` and its orbit values.
- `referenceFigures`: external comparison values (CelesTrak boxscore, ESA).

### `lookups.json`
Code tables: `objectClasses`, `opsStatusCodes`, `rcsSizeClasses`, `elementSources`, `regimes`, `groupTags` (tag -> label, section, source), `ownerCodes`, `launchSiteCodes`, `sources`.

### `manifest.part.json`
Four DatasetRecords: `celestrak-gp-omm`, `celestrak-satcat`, `celestrak-satcat-code-tables`, `orbital-population-statistics`.

## Processing (`scripts/data/orbital/`)
- `fetch.mjs` + `datasets.mjs` + `lib.mjs`: cached, throttled downloads; a log is written to `data-raw/orbital/fetch-log.jsonl`.
- `build.mjs`:
  1. Parse the OMM CSV groups and merge by `NORAD_CAT_ID`. When an object appears in several files the latest EPOCH wins (2,178 epoch conflicts resolved) and group tags are unioned.
  2. Join with SATCAT (no decay date).
  3. Compute apsides exactly as SGP4 initialises them (Kozai to Brouwer mean motion).
  4. Classify regimes and bin shells.
- `validate.mjs`: writes `data-raw/orbital/validation-report.json`.
- `starlink` is not downloaded as its own group, because it is a subset of `active`. The Starlink tag is derived from the name plus the payload class.
- Re-run: `node scripts/data/orbital/fetch.mjs && node scripts/data/orbital/build.mjs && node scripts/data/orbital/validate.mjs`. Fetch is cache-aware; delete cached files only after the CelesTrak update interval has passed.

## Validation (passed, 0 failures, 0 warnings)

| Check | Result |
|---|---|
| ISS 25544 | i = 51.6317°, 15.489 rev/day, 416 x 425 km, period 92.97 min |
| CSS Tianhe 48274 | i = 41.47°, 15.61 rev/day |
| HST 20580 | i = 28.47°, 15.32 rev/day, ~473 km |
| Vanguard 1 (id 5) | e = 0.184, perigee 653 km, apogee 3822 km, period 132.6 min |
| LAGEOS-1 8820 | i = 109.8°, period 225 min |
| GPS | ~2 rev/day |
| GEO | ~1 rev/day |
| Starlink mean altitude | median 463 km (p10 450, p90 485) |
| Totals vs CelesTrak boxscore (2026-10-15) | 35,652 here vs 35,360 on-orbit there. The boxscore includes ~300 non-Earth-orbit objects and excludes analyst objects. Payloads 20,163 vs 20,327; active 17,264 vs 17,324. |
| SGP4 propagation | 31,836 of 31,839 propagate at the reference time; 3 fail (low-perigee, decaying) |
| Apsis method | Median abs. difference vs SATCAT 0.55 km (Kepler/Kozai) |
| NaN/Infinity | none |
| Duplicate or invalid ids | none |
| Active-flag conflicts with the `active` group | 0 |

## Limitations
- Epochs differ per object: median age at retrieval is 1.14 d, p95 3.67 d, and 703 objects are older than 7 d. SGP4 error is about 1 km at epoch and grows by km/day. Objects may have manoeuvred or decayed since the snapshot.
- 3,481 objects (`satcat-shape`) have only a rounded orbit shape; 332 have no orbit data.
- The public catalogue covers objects larger than about 10 cm. Real debris counts (ESA models) are far higher; label statistics "tracked objects".
- SATCAT `owner` is the source code, not necessarily the operator. 594 analyst objects are not in SATCAT, so class and owner are heuristic for them.
- Code tables are parsed from HTML.
