# Surface features (features domain)

Named surface features, mission landing sites and a few informal/dynamic features, shown as surface labels and inspectable
entities (`feat:<body>:<slug>`) by `src/domains/features`.

## Sources

- **Gazetteer of Planetary Nomenclature** — IAU WGPSN / USGS Astrogeology Science Center, https://planetarynames.wr.usgs.gov
  (public domain). Feature centre-point exports (KMZ) downloaded from https://planetarynames.wr.usgs.gov/GIS_Downloads,
  retrieved 2026-10-19T07:28:27Z. Coordinates are planetocentric latitude and east-positive longitude (0-360 in the export,
  stored here in (-180, 180]). Each record keeps its Gazetteer feature id and URL.
- **Landing sites** — LROC coordinates of anthropogenic features (Wagner et al. 2017, Icarus 283, 92-103) and LROC news
  releases for the Moon; NASA NSSDCA and mission papers for Mars, Venus, Titan and Eros (cited per record in the fact sheet).
- **Informal / dynamic** — South Pole-Aitken basin (Garrick-Bethell & Zuber 2009), Charon's Mordor Macula (Grundy et al. 2016),
  Jupiter's Great Red Spot (System II longitude 91° on 2026-06-01 drifting +1.75°/month from JUPOS via Sky & Telescope;
  labelled "drifts; position approximate").

## Contents

293 records: 250 Gazetteer features, 40 landing sites, 3 informal/dynamic.

| Body | Records |
| --- | --- |
| moon | 69 |
| mars | 50 |
| venus | 19 |
| mercury | 18 |
| titan | 17 |
| pluto | 16 |
| io | 12 |
| ceres | 10 |
| triton | 10 |
| enceladus | 9 |
| europa | 8 |
| ganymede | 8 |
| vesta | 8 |
| charon | 7 |
| callisto | 5 |
| iapetus | 5 |
| eros | 4 |
| miranda | 4 |
| rhea | 3 |
| ariel | 2 |
| dione | 2 |
| tethys | 2 |
| titania | 2 |
| jupiter | 1 |
| mimas | 1 |
| phobos | 1 |

## Pipeline

```
python -I scripts/data/features/fetch_gazetteer.py      # once: data-raw/features/*.kmz + retrieval.json
python -I scripts/data/features/parse_gazetteer.py      # -> data-raw/features/gazetteer_all.json
node scripts/data/features/build-features.mjs           # curated selection -> public/data/features/, src/domains/features/
```

The curated selection (names, importance ranks 0-100, one-line descriptions) lives in `build-features.mjs`.

## Limitations

- Centre points only; features are placed on a sphere of the body's mean radius (irregular bodies: Eros, Vesta's south pole).
- Venera and Luna 9 positions are approximate (≈1°). The Great Red Spot longitude is extrapolated.
- Jupiter's map is an illustrative composite whose Great Red Spot is fixed in the texture; the label follows the drawn spot
  and the fact sheet gives the real System II longitude for the current date.
