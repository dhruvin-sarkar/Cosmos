# HD texture overlay (textures-hd)

Adds 8K colour maps and real-elevation relief normal maps beside the existing `public/textures/**` files (nothing existing was modified).
Index: `public/textures/hd.json` (`{ version: 1, bodies: { <body>: { color?: {"8k"}, surface?: {"8k"}, normal?: {"4k","2k"}, albedo?, normalInfo?, sources[], license } } }`; paths relative to `public/`).
Conventions are identical to `index.json`: equirectangular 2:1, x=0 at 180 W, east-positive, y=0 at 90 N. Colour = sRGB JPEG (progressive, mozjpeg q90, 4:2:0). Normals = linear, OpenGL tangent space (R=+east, G=+north, B=up), PNG.

| Body | New files | Source | Licence |
|---|---|---|---|
| Moon | `moon/color_8k.jpg` (6.0 MB), `moon/normal_hd_4k.png` (6.8 MB), `normal_hd_2k.png` | Colour: NASA SVS CGI Moon Kit a004720 `lroc_color_poles_8k` (LRO LROC WAC normalized reflectance + Kaguya poles); poleward of ~65 deg blended with Solar System Scope 8k Moon. Relief: LRO LOLA `LDEM_64` | PD; polar band CC BY 4.0 (SSS) |
| Mercury | `mercury/color_8k.jpg` (9.3 MB), `normal_hd_4k/2k.png` | Colour: Solar System Scope 8k (MESSENGER-derived). Relief: USGS MESSENGER Global DEM 665 m v2 | CC BY 4.0 (colour); PD (DEM) |
| Mars | `mars/color_8k.jpg` (5.6 MB), `normal_hd_4k/2k.png` | Colour: Solar System Scope 8k, desaturated x0.62 to match Viking/HST colour. Relief: MGS MOLA MEGDR 16 ppd | CC BY 4.0; PD |
| Venus | `venus/surface_8k.jpg` (8.4 MB; illustrative, hidden under clouds) | Solar System Scope 8k Venus surface (Magellan-derived) | CC BY 4.0 |
| Jupiter / Saturn | `jupiter/color_8k.jpg`, `saturn/color_8k.jpg` (unmodified SSS 8k) | Solar System Scope | CC BY 4.0 |

Required credit when shown: "Textures: Solar System Scope (CC BY 4.0); NASA/GSFC/SVS LRO, NASA/USGS LOLA, MOLA, MESSENGER data (public domain)".
Not upgraded (no good open source above 4k): Venus atmosphere (SSS max is 4k), Uranus/Neptune (SSS 2k), Earth (already 8k), Saturn rings (already `rings_8k.png`), Ceres/Pluto/Charon/icy moons (existing 4k; no better global mosaic).

## Albedo calibration (important for the materials)
`LitBodyMaterial` computes `L = albedo * E * cos / pi` with no extra gain, so rocky maps are scaled so that the mean **linear** luminance over |lat| < 60 deg equals a physical mean albedo
(scale applied in linear light, then re-encoded sRGB): Moon 0.12 (Bond 0.11; mean regolith normal albedo ~0.12), Mercury 0.11 (Bond 0.088, geometric 0.142), Mars 0.18 (Bond 0.25, geometric 0.17).
Pre-calibration the SSS/LROC maps were 0.23-0.29 (contrast-stretched for display); the old 4k Moon was 0.053 and old Mercury 0.06. Do not apply any additional brightness boost; use `uColor`/albedo = 1.
Gas giants and Venus are left as published (illustrative visual textures).

## Relief maps
Heights are box-filtered to the target size, slope computed with true metre spacing per latitude (east-west spacing = R cos(lat) 2pi/W, floored near the poles), slope exaggeration baked in (Moon x2.5, Mercury x3, Mars x4; per-pixel slope soft-limited to tan = 3), normalised.
Use `normalScale` (three.js) ~1 for the baked look; it is physically scaled slopes times the exaggeration, so reduce toward 0.5 for a subtler terminator. Orientation verified: Moon (Orientale, Mare Imbrium, LOLA maximum at 158.6 W / 5.4 N), Mars (Olympus Mons maximum at 133 W / 17 N, Valles Marineris, Hellas), Mercury (grad-magnitude correlation with the colour map 0.19 vs 0.00 for the un-rolled file).
Polar rows have horizontal streaking (pixel width collapses); the normal maps are best faded with latitude beyond ~80 deg if visible.

## Reproduce
```
node scripts/data/textures-hd/build-color.mjs [moon|mercury|mars|venus|jupiter|saturn]
node scripts/data/textures-hd/build-normals.mjs moon mars
python scripts/data/textures-hd/tiff_dem.py <mercury_dem_665m.tif> <out.f32>; MERCURY_F32=<out.f32> node scripts/data/textures-hd/build-normals.mjs mercury
node scripts/data/textures-hd/finalize.mjs
```
Raw inputs (data-raw/textures-hd/, retrieved 2026-10-18): `sss/*.jpg` from https://www.solarsystemscope.com/textures/ ; LROC 8k from https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_poles_8k.tif ; LDEM_64.IMG (imbrium.mit.edu/DATA/LOLA_GDR/CYLINDRICAL/IMG/) ; `megt90n000eb.img` (PDS Geosciences MOLA MEGDR) ; Mercury DEM `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/Mercury_Messenger_USGS_DEM_Global_665m_v2.tif` (USGS Astropedia mirror; ScienceBase is behind Cloudflare). The large raws (LDEM_64, Mercury DEM, LROC tif) were deleted after processing to keep the disk under its floor.

## Round 2 (2026-10-18/19)

**Built (offline, from cached raws)**
- `earth/day_16k.jpg` (16384x8192, 13.6 MB): NASA Blue Marble Next Generation Dec 2004 (21600x10800 source, public domain), lanczos3, q90 4:4:4. `hd.json` -> `bodies.earth.color["16k"]`. Ultra preset only: ~715 MB VRAM with mips; not for the 4 GB laptop alongside other large textures. It is the December composite, so Northern-Hemisphere seasonal snow is present (same as `day_8k`). Script: `build-earth16k.mjs`. Orientation verified against the 1024 preview (x=0 at 180W, north up, east-positive).

**Round 2b (2026-10-19, network back)**

| Body | Files (new, `public/textures/<body>/`) | Source (public domain, USGS Astrogeology / NASA) | Notes |
|---|---|---|---|
| Io, Europa, Ganymede, Callisto, Titan, Enceladus, Triton, Pluto, Charon | `color_8k.jpg` | USGS planetary WMS (same layers as the 4k maps), GetMap capped at 4096 px, so two 4096x4096 half-globe renders are stitched to 8192x4096 (`build-wms8k.mjs`) | Same data, tone and no-data handling as the 4k (unobserved area pull-push filled and faded to the mean; Europa/Ganymede/Callisto ~4 % , Triton 39 %, Pluto 32 %, Charon 34 % unobserved; use the existing `coverage_*.png`). Not re-calibrated: mean luma identical to the 4k, so existing tints stay valid. Seam at x=4096 checked (invisible). |
| Tethys, Dione, Rhea | `color_8k/4k/1k.jpg` | Cassini ISS (+Voyager) global mosaics 293 / 154 / 417 m/px (DLR, Roatsch et al.), GeoTIFF from the USGS S3 mosaic store (`build-usgs8k.mjs`) | Greyscale (Cassini clear filter), albedo-calibrated: mean linear luma 0.60 / 0.50 / 0.50 (LitBody has no gain). |
| Mimas, Iapetus | `color_4k/1k.jpg` | Cassini DLR Mimas basemap; Cassini+Voyager Iapetus 783 m/px | Source is only 5760 px wide, so no 8k tier (no upsampling). Iapetus: the label says positive-west but the data is east-positive (dark Cassini Regio at 90W verified). Calibrated 0.50 / 0.30 mean. |
| Ceres | `color_8k.jpg`, `normal_hd_4k/2k.png` | Dawn FC global mosaic 20 px/deg (7383 px, <=1.1x upsample to 8k); HAMO DTM 60 px/deg | Colour matched to the *existing* 4k mean (0.1646) so the solar-domain tint (0.58) still yields albedo 0.09. Existing `color_4k/1k` untouched. DTM heights are relative to a 470 km sphere: a least-squares quadric (oblate figure) is removed before differentiating. Exaggeration x3. |
| Vesta | `color_8k.jpg`, `normal_hd_4k/2k.png` | Dawn FC HAMO clear mosaic 74 px/deg (~60 m/px); HAMO DTM 48 px/deg | Colour matched to the existing 4k (0.1537). The winter north pole was never imaged (black). DTM is absolute radius: quadric detrended, exaggeration x2. IAU 2012 (Claudia) longitudes. |
| Pluto, Charon | `normal_hd_4k/2k.png` | New Horizons global DEMs 300 m/px (Schenk et al. 2018) | DEM exists only for the encounter hemisphere (46 % Pluto, 46 % Charon): unobserved area and a 3 px rim are forced flat (128,128,255), no invented relief. Exaggeration x3. |
| Phobos, Deimos, Hyperion | `color_4k/1k.jpg` | USGS WMS (Viking / Voyager 2) | Irregular bodies, draped equirectangular: expect stretching; low native resolution, labelled illustrative. Calibrated to 0.07 / 0.07 / 0.25. Phoebe was built and rejected (smeared, 21 % unobserved). |

`hd.json` tier keys: `color["8k"]` (Ultra), `color["4k"]` (High), `normal["4k"]`; Earth also `color["16k"]` (Ultra only). Bodies with only 4k (Mimas, Iapetus, Phobos, Deimos, Hyperion) rely on the High tier; no index.json entry exists for the new bodies. Orientation of every new map was verified on previews against known features (Occator on Ceres, Herschel on Mimas, Odysseus on Tethys, Sputnik Planitia/heart on Pluto at +-180). Normal maps: OpenGL tangent space, +Y up.

**Not built / why**
- Earth 16k clouds: the only global cloud composite reachable (NASA VE 57747 `cloud_combined_2048.jpg`, plus the 8k SSS map) is too small; upsampling would be fake detail. Earth 16k day map is the December composite (Northern snow).
- Uranus/Neptune and Venus atmosphere 8k: no source better than the existing maps exists (Voyager 2 did not map globally; the Venus cloud deck is featureless), so nothing was faked.
- Miranda/Ariel/Umbriel/Titania/Oberon/Proteus: not in the USGS WMS/S3 stores reachable here; the Uranian moons stay procedural.
- Normals for Europa/Ganymede/Io/Triton: no global DEMs exist.
- Pluto/Charon/other unobserved areas stay low-resolution/flat by construction.

**Reproduce**: `build-wms8k.mjs <bodies>`, `build-usgs8k.mjs <body>` (download the GeoTIFF named in its JOBS table from `https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/` into `data-raw/textures-hd/usgs2/`), `build-wms4k.mjs`, `build-normals2.mjs <body>` (DEM into `data-raw/textures-hd/dem2/`, reduced by `tiff_dem.py`, which now also reads float32 and an extra nodata value and writes a `.valid` mask), then `finalize2.mjs`. Raws were deleted after processing (disk). Licences: all public domain (NASA/USGS/DLR-released data distributed by USGS); credit "USGS Astrogeology Science Center".

## Polish round 1: seam repair
`scripts/data/textures-hd/fix-seams.mjs` repairs antimeridian-seam defects: Ceres/Vesta 4k/1k colour maps rebuilt from the clean 8k maps (old 4k/1k had black edge columns), Mercury 8k and Venus surface 4k edge columns interpolated across the wrap. All equirect colour maps were scanned for edge-column jumps; the remaining wraps (Moon 4k/Rhea/Tethys/Earth day) differ by 3-9 grey levels, consistent with real surface differences/mosaic edges.

## Polish round 2 – Europa / Io mosaic seams
`scripts/data/textures-hd/feather-mosaic.mjs` (originals kept in `data-raw/textures-hd/src/*_color_8k_orig.jpg`; idempotent).
- **Europa** `color_8k.jpg`: the WMS half-globe stitch column (x=4096) was half-dark and showed as a hard N–S line down the disc – interpolated from its neighbours.
  The Galileo (sharp) / Voyager (soft) resolution boundaries were hard edges – local detail is now faded smoothly (σ≈120 px ≈ 5° of longitude) approaching soft-data regions (`THR=50 SIG=120`).
  Remaining brightness steps between the source image footprints are inherent to the USGS mosaic. Unobserved areas stay illustrative.
- **Io** `color_8k.jpg`: the smeared, unobserved polar caps carried a hard colour step (x≈4230, lat>65°N) – blended to a heavily low-passed copy poleward of 50–68°.

## Moons, dwarf planets and small bodies (tex-moons)
Scripts: `scripts/data/textures-hd/{build-uranian,moons-index,moons-qa,moons-wrapfeather,moons-polarfill,moons-orient,build-moon-normals}.mjs`; raws and originals in `data-raw/big/tex-moons/` (`orig/` = pre-fix maps, `coverage/` = masks).
- **Uranian moons** (Miranda, Ariel, Umbriel, Titania, Oberon): `color_1k/2k.jpg` + `coverage_1k/2k.png` from the Voyager 2 ISS global mosaics (USGS Astrogeology, T. Becker) as distributed by the JPL Solar System Simulator (`https://space.jpl.nasa.gov/tmaps/pix/ura{1..5}vuu2.tif`, 1440x720, 4 px/deg; public domain, NASA/JPL-Caltech/USGS; retrieved 2026-10-19). Only the southern hemisphere (sub-solar latitude in 1986) was imaged: the unimaged north is filled with an albedo-matched neutral fill (no invented detail) and the `coverage` role (bound in `moonsLayer.ts`) records where data exists. Orientation verified against known features (Oberon's Hamlet ~41 E).
- **Index entries** added to `public/textures/index.json` for Phobos, Deimos, Mimas, Tethys, Dione, Rhea, Iapetus, Hyperion, the Uranian moons and a Charon normal map; `src/domains/moons/data.ts` keys and `moonMaterial.ts` gate the procedural specials (Iapetus, Miranda, Europa lineae) so they only apply to unmapped bodies.
- **Seams**: Rhea and Tethys 8k/4k/1k and Iapetus 4k/1k had a visible antimeridian step (35/42/18 grey levels); `moons-wrapfeather.mjs` blends it to ~1.3. Pluto's apparent edge step is the high-resolution encounter side at x=0 (real data, not a seam).
- **Poles**: Ceres south cap (< -78 deg, Dawn no-data/shadow) and Vesta north (polar night, > ~45 N) filled with albedo-matched neutral fill by `moons-polarfill.mjs`; masks archived.
- **Rejected**: Enceladus normal from the Bland et al. 2019 topography grid (noisy at 2.2 km, shading baked into the mosaic). No global USGS DEMs exist for the Galilean or Saturnian mid-size moons (bucket listing checked), so those keep detail-normal micro-relief only.
- **Small moons without global maps** (Amalthea, Thebe, Himalia, Proteus, Nereid, Janus, Epimetheus, ...) remain albedo-tinted procedural bodies with real shape and size, labelled illustrative in their FactSheets.
- **Not wired**: Vesta's colour map exists but `src/domains/smallbodies` has no texture support (contract change below).
