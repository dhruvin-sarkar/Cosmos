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

**Not built: network blocked.** During this run every outbound connection from the build machine timed out (curl, node fetch, WebFetch; 8.8.8.8 unreachable), so nothing could be downloaded. Prepared for the next online run:
- `fetch-wms.mjs <body> [width]` requests a server-side 8192x4096 render from the USGS Astrogeology WMS (same layers as the 4k maps, table in `wms-bodies.mjs`) for io, europa, ganymede, callisto, titan, enceladus, triton, pluto, charon. Post-process with the round-1 pull-push fill + coverage masks (`scripts/data/textures/process.mjs`), then write `hd2.<body>.json` fragments and run `finalize2.mjs` (appends to `hd.json`; never rewrites round 1).
- Still missing: Mimas/Tethys/Dione/Rhea/Iapetus, Vesta, Ceres 8k colour, DEM-based normals for Ceres/Vesta/Pluto/Charon, Earth 16k clouds (the only cloud source is the 8k Solar System Scope map; upsampling would be fake detail), Uranus/Neptune upgrades, Venus atmosphere 8k (only 4k cached).
- Disk: ~6.6 GB free when last checked; raw budget rules unchanged.
