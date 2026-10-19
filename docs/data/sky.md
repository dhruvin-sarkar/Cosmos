# Sky data (all-sky spectral maps, Planck CMB)

Output: `public/data/sky/` (about 46 MB). Script: `scripts/data/sky/fetch.mjs` (config in `bands.config.mjs`, helpers in `lib.mjs`).
Re-run: `node scripts/data/sky/fetch.mjs [--only=id,id] [--refresh]`. Raw downloads are cached in `data-raw/sky/` (gitignored).
Everything is rendered by the CDS **hips2fits** service (https://alasky.cds.unistra.fr/hips-image-services/hips2fits) from HiPS surveys
discovered through the CDS **MocServer**. No API key. Requests are throttled to >= 1.1 s per host.

## Image convention (all bands)
Equirectangular (plate carree), ICRS/J2000, width W = 2 x height H. Pixel column x centre: RA = 360*(x+0.5)/W degrees; RA increases to the
RIGHT, RA = 0 at the left edge. Row y centre: Dec = 90 - 180*(y+0.5)/H, north at top. This is the globe-from-outside view: a renderer
that maps the texture onto the inside of a sphere must mirror horizontally (u = RA/360 increasing eastward).
Verified landmarks (visible band, viewed): Galactic Centre at x/W ~ 0.740, y/H ~ 0.661; LMC at (0.225, 0.888); SMC bottom-left.

## Index: `public/data/sky/bands.json`
`{schemaVersion, generated, domain, convention, projection, pathsRelativeTo:"public/", credits, bands:[...]}`.
Each band: `id, label, regime, wavelengthLabel, emMinM, emMaxM (metres), survey, instrument, hipsId, files{ultra?,high,low,mask?,...}`
(each file `{path,bytes,width,height,mime}`), `credit, license, licenseUrl, citation, provenanceClass, reveals (educational text),
caveats[], processing{source,stretch,colormap,alpha,resampling}, coverageFraction`.
Sizes: `high` 4096x2048 JPEG; `low` 1024x512 JPEG; `ultra` 8192x4096 JPEG (visible only).
`mask` (uv, xray-erosita): 2048x1024 8-bit PNG, 255 = data, 0 = no data (those pixels are black in the colour images).

| id | survey (HiPS id) | coverage | notes |
|---|---|---|---|
| visible | Gaia DR3 colour flux map (CDS/P/DM/flux-color-Rp-G-Bp/I/355/gaiadr3) | 100% | derived from star catalogue, levels black 40, gamma 1.6; no diffuse nebulae |
| halpha | Finkbeiner 2003 (CDS/P/Finkbeiner) | 100% | log10 rayleigh 0.5-500, red colormap |
| nir | 2MASS J/H/Ks colour (CDS/P/2MASS/color) | 100% | survey RGB as published |
| mir | unWISE W1/W2 colour (CDS/P/unWISE/color-W2-W1W2-W1) | 100% | |
| fir | AKARI FIS 65/90/140 um colour (CDS/P/AKARI/FIS/Color) | 100% | few scan-gap streaks |
| uv | GALEX GR6/7 colour (CDS/P/GALEXGR6_7/color) | 79.75% | plane and Magellanic Clouds missing; see mask |
| xray | ROSAT RASS soft (red) + hard (blue) (ov-gso/P/RASS/*) | 100% | counts-based, scan stripes and bright sources (Sco X-1, Vela) dominate; asinh stretch |
| xray-erosita | eROSITA-DE DR1 RGB (erosita/dr1/rate/rgb) | 62.7% | only western Galactic hemisphere public; see mask |
| gamma | Fermi LAT colour (CDS/P/Fermi/color) | 100% | |
| microwave | Planck PR3 LFI 30/44/70 GHz (CDS/P/PLANCK/R3/LFI/color) | 100% | |
| submm | Planck PR3 HFI 353/545/857 GHz (CDS/P/PLANCK/R3/HFI/color) | 100% | HiPS colour composite is somewhat blocky |
| cmb | Planck PR3 SMICA CMB (CDS/P/PLANCK/R3/CMB) | 100% | see below |
| radio-408 | Haslam 408 MHz, Remazeilles 2015 (CDS/P/Haslam408/v2) | 100% | log10 K 10-1000, magma |
| radio-hi | HI4PI NHI (CDS/P/HI4PI/NHI) | 100% | log10 cm^-2 1e19-3e22, blue ramp |

## CMB files (`public/data/sky/cmb/`)
- `cmb_4k.jpg`, `cmb_1k.jpg`: colormapped, linear -300..+300 uK, diverging blue-white-red (rdbu11r).
- `cmb_smica_4k_u16.png`: 4096x2048 16-bit greyscale PNG. **dT_uK = (grey - 32768) * 0.03125** (32 grey levels per uK, range -1024..+1023.97 uK, 40 pixels clipped).
- `cmb_smica_1k_f32.bin` + `.json`: 1024x512 little-endian Float32, no header, row-major, `index = y*1024+x`, unit microkelvin
  (K_CMB difference from 2.7255 K). No NaN. Stats (4k): mean -1.9 uK, rms 106 uK, p01/p99 -249/+247 uK.
Monopole and dipole are removed (SMICA PR3). Residual Galactic-plane contamination and point sources remain.

## Licenses and credits
- HiPS tiles / hips2fits: CDS, ODbL-1.0. Cite Fernique et al. 2015, A&A 578, A114.
- Gaia: CC BY-NC 3.0 IGO, credit "ESA/Gaia/DPAC" (non-commercial exhibition use is fine).
- Planck: ESA Planck Legacy Archive, credit "ESA, Planck Collaboration" (CC BY-NC 3.0 IGO style terms).
- 2MASS, WISE, GALEX, Fermi, Haslam/LAMBDA, ROSAT: public NASA/MPE data, acknowledgement text per band in `bands.json` (`credit`).
- AKARI (JAXA), eROSITA (MPE/IKI), Finkbeiner, HI4PI: free for research/education with citation (see `citation`).
Show `credit` text in the UI wherever a band is displayed.

## Validation
Orientation verified by viewing the 8k/4k visible map (GC, LMC, SMC positions) and a contact sheet of all 1k previews; CMB stats
checked (rms ~106 uK as expected for Planck); no NaN written; coverage fractions computed from alpha masks.

## Known limitations
Visible is a Gaia star-flux composite (no HII regions, bright stars G<3 missing). UV and eROSITA are partial sky. RASS shows scan
artefacts. Provenance classes: visible/CMB/HI "derived", others "observed".

## Sun (SDO) — `public/data/sky/sun/`
Script `scripts/data/sky/sun.mjs`. Five 1024x1024 JPEGs (`aia171|aia193|aia304|aia1600|hmi-continuum_1024.jpg`) from
https://sdo.gsfc.nasa.gov/assets/img/latest/ plus `sun.json` = `{schemaVersion, generated, note, credit, license, items:[{id,label,wavelength,shows,file,bytes,width,height,imageTimeUtc,retrieved,source}]}`.
`imageTimeUtc` is HTTP Last-Modified (approximate). Sun centred, north up. Public domain; credit "NASA/SDO and the AIA, EVE, and HMI science teams".


## Fix-pass notes
- Mask PNGs (`*_mask*.png`) are 3-channel RGB with identical channels (values 0/255): decode the red channel only.
- ROSAT X-ray: scan/exposure streaks converging on the ecliptic poles and low-exposure dark gaps are instrumental artefacts (see bands.json caveat).
- SDO: `imageTimeUtc` in sun.json may differ by minutes from the timestamp text burned into the image; the burned-in label is part of the image.
- UV (GALEX) band is patchy inside its coverage mask; use the mask.
