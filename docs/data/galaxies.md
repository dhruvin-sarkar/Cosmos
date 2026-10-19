# Galaxies data domain (`public/data/galaxies/`)

Local-volume galaxies, famous galaxies, large-scale-structure labels and the cosmic-web point clouds.
Everything is a static snapshot (exhibition runs offline). Scripts: `scripts/data/galaxies/` (`fetch-local.mjs`, `build-curated.mjs`, `fetch-2mrs.mjs`, `fetch-desi.mjs`, `build-manifest.mjs`, shared `lib.mjs`). Raw downloads: `data-raw/galaxies/` (gitignored). Manifest fragment: `public/data/galaxies/manifest.part.json`.

Re-run order: `fetch-local` -> `build-curated` -> `fetch-2mrs` -> `fetch-desi` -> `build-manifest` (validates).

## Conventions
- Positions: ICRS/J2000, degrees. Distances Mpc. Missing = `null` (never 0).
- Tables: `{"schemaVersion":1,"generated":ISO,"fields":[...],"rows":[[...]]}`; row order = `fields` order.
- Cosmology (all redshift -> distance): flat LCDM, Planck 2018 (TT,TE,EE+lowE+lensing+BAO), H0 = 67.66 km/s/Mpc, Omega_m = 0.3111. D_C(z) = (c/H0) * integral_0^z dz'/sqrt(Om(1+z')^3 + OL), composite Simpson, dz = 1e-5. **D_C(z=0.1) = 432.57 Mpc** (the often-quoted ~418 Mpc is for H0=70, Om=0.3; not Planck18).
- Redshift frame for the point clouds: CMB rest frame (barycentric z converted with the Planck CMB dipole, 369.82 km/s towards l=264.021, b=48.253).

## Sources and credits
| Dataset | Source | License / credit |
|---|---|---|
| local.json | Karachentsev, Makarov & Kaisina 2013, AJ 145, 101 (VizieR J/AJ/145/101, `catalog` table = table1+2 merged), retrieved via VizieR ASU | VizieR/CDS: free scientific use, cite the paper and CDS (Ochsenbein+2000) |
| famous.json | McConnachie 2012 (AJ 144, 4), UNGC, RC3, Pietrzynski+2019, EHT 2019, ... (per-row refs) | facts; cite per-row refs |
| structures.json | Abell 1958, Tully+2014, Kraan-Korteweg+1996, Geller & Huchra 1989, Gott+2005, ... (per-row refs) | facts; cite refs |
| cosmicweb-2mrs | Huchra et al. 2012, ApJS 199, 26 (VizieR J/ApJS/199/26 table3) | VizieR/CDS terms; cite Huchra+2012, Skrutskie+2006 |
| cosmicweb-deep, cosmicweb-deep-lrg | DESI DR1 (iron) LSS catalogs v1.5, `*_clustering.dat.fits` | **CC BY 4.0**. Acknowledge: "This research used data obtained with the Dark Energy Spectroscopic Instrument (DESI)"; cite DESI Collaboration et al. 2026, AJ 171, 285; Ross et al. 2025, JCAP 01, 125. https://data.desi.lbl.gov/doc/acknowledgments/ |

## local.json (869 rows, 0.1 MB)
Fields in order (units): `name` (pretty, e.g. "M31", "NGC 253"), `aliases` (string[]; UNGC original form e.g. "MESSIER031", SIMBAD and NED names), `raDeg`, `decDeg`, `distMpc` (UNGC `Dist`, rounded to 0.01 Mpc in the source, so for objects <2 Mpc (LMC 0.05, M31 0.77, M33 0.85) prefer famous.json), `morphology` (UNGC class Mcl: dE, Im, Sph, ...; where blank a coarse fallback from tType: E/S0/S/Irr; null in 1 row), `tType` (RC3 T-type -3..11), `majorAxisArcmin` (Holmberg, B 26.5 mag/arcsec2), `majorAxisKpc` (linear Holmberg diameter from catalog A26, computed with the unrounded distance, so it can differ from distMpc x arcmin for nearby objects), `inclinationDeg` (0=face-on), `absMagB` (**derived**: Bmag - DM, no extinction correction), `logMstarMsun` (**derived**: from Ks luminosity, M_K,sun=3.28, M/L_K=0.6 - illustrative), `logMHIMsun` (null for upper limits), `logMHolmbergMsun` (UNGC M26 dynamical mass), `vHelioKms`, `vLgKms` (Local-Group frame), `bMag`, `kMag` (2MASS Ks), `tidalIndex` (Theta_1; group membership proxy - larger = bound to a neighbour), `w50Kms` (HI width), `distErrMpc` (1-sigma = d*ln10/5*e_DM from the matching table6 measurement; null where none published), `distMethod` (UNGC f_Dist code, e.g. TRGB, Cep, TF), `mainDisturber` (UNGC "MD": dominant neighbour, a group-membership proxy; no group names in the source). No positionAngleDeg column (UNGC lists none; see famous.json). The "Milky Way" row is a placeholder (vHelioKms null). DESI BGS g-r has outliers (-1.2..3.8): clamp to ~0.2-1.9 in colour maps.

## famous.json (37 rows)
Fields: `id`, `name`, `aliases`, `raDeg`, `decDeg`, `distMpc`, `distErrMpc`, `distRef`, `morphology` (string), `tType`, `majorAxisArcmin`, `majorAxisKpc`, `inclinationDeg` (0 face-on, 90 edge-on), `positionAngleDeg` (major axis, N through E; for the LMC the line of nodes), `orientationRef`, `absMagB`, `logMstarMsun`, `vHelioKms`, `bhMassMsun` (M31, M81, M87 6.5e9 EHT, Cen A, M104, M106), `bhRef`, `ungcName` (row key in local.json, or null).
Includes M31, M33, LMC, SMC, M32, M81, M82, M87, Cen A, M51, M104, M101, NGC 1300, M64, M100, NGC 253, IC 342, Maffei 1/2, Antennae, M83, M106, NGC 891, NGC 6946, NGC 2403, NGC 55, NGC 300, NGC 7793, IC 10, M94, and dwarfs Sculptor, Sagittarius dSph, Leo I, Fornax, Draco, Ursa Minor, Carina (McConnachie 2012). Orientation `null` means "unknown": renderer should pick an illustrative orientation. LMC/SMC/M87/NGC 1300/M100/Antennae sizes (`majorAxisKpc`) are approximate hand values; the Antennae distance is contested (22 Mpc used, 13.3 Mpc alternative).

## structures.json (19 rows)
Fields: `id`, `name`, `kind` (group|cluster|supercluster|void|wall), `raDeg`, `decDeg`, `redshift` (null for nearby), `distMpc` (literature distance, or comoving Planck18 from `redshift`), `radiusMpc` (characteristic size), `members` (indicative or null), `membersNote`, `positionQuality` ("catalogued" | "approximate" - voids, superclusters and walls are approximate/illustrative centres), `description`, `refs` (string[]).
Local Group, M81, Sculptor, Cen A/M83, Virgo, Fornax, Coma, Perseus, Norma, Centaurus, Hydra, Shapley, Laniakea (centre approximated by the Great Attractor/Norma region), Perseus-Pisces, Hercules, Local Void, Bootes Void, CfA2 Great Wall, Sloan Great Wall.

## Point clouds (`*.bin` + `*.json` header)
Little-endian Float32, interleaved records, `stride` floats per record: `[xMpc, yMpc, zMpc, redshift, colorOrMag]` (2MRS: `kMag`, Ks mag). Axes: x toward RA=0h/Dec=0, y toward RA=6h, z toward the north celestial pole (ICRS), observer (Milky Way) at the origin; radius = comoving D_C(z_cmb). Header JSON documents fields, footprint, sampling, nulls (none). Positions are in **redshift space** (fingers-of-God, Kaiser flattening are not removed).

| File | Count | Notes |
|---|---|---|
| cosmicweb-2mrs.bin | 43,508 | 2MRS (Ks<=11.75), z_cmb ~0.003-0.17, max radius 729 Mpc. 1,066 sources lack cz and 25 have z_cmb<=0: dropped. Zone of Avoidance (|b|<5 deg, 8 deg toward the bulge) is empty; z_cmb < 0.003 (216 objects) unreliable (peculiar velocities). `cosmicweb-2mrs-meta.json` (1.5 MB) holds per-point IDs/names in the same order. |
| cosmicweb-deep.bin | 1,800,000 | DESI DR1 BGS_BRIGHT (3,957,865 galaxies, NGC+SGC), uniform random 45.5% sample (seed 20250210), z_cmb 0.009-0.50, 39-1953 Mpc; field 5 = g-r colour (AB, extinction-corrected). Records are randomly ordered: any prefix is a uniform subsample (use for progressive loading). |
| cosmicweb-deep-lrg.bin | 400,000 | DESI DR1 LRG (2,138,627), 18.7% sample (seed 20250211), z 0.40-1.10 (to 3.6 Gpc); 4 floats/record (no colour). |

Footprint: DESI is partial-sky; NGC covers roughly RA 110-270 deg, Dec -10..+80; SGC wraps RA 300-360 & 0-50 deg, Dec -20..+35. In 3D it appears as two thick wedges. Clustering weights/completeness are NOT applied (points are galaxies, not a density estimator). Combined, the two DESI files are 42 MB.

Raw FITS were SHA-256 verified against the official sha256sum file and deleted after extraction (640 MB downloaded in total); f32 extraction caches remain in `data-raw/galaxies/desi/`.

## Validation performed (`build-manifest.mjs`)
- D_C(z=0.1) = 432.57 Mpc (expected 432.6 for Planck18 H0=67.66, Om=0.3111).
- All Float32 values finite; byteLength == count*stride*4; for a subsample of points |r| equals D_C(z) within 1%.
- M31 0.77 Mpc (UNGC) and 0.785 Mpc (McConnachie 2012: 785 +/- 25 kpc); M87 16.5 Mpc (Blakeslee+2009), Virgo 16.5 Mpc (Mei+2007); Coma z=0.0231 -> 101.8 Mpc; LMC 49.6 kpc (Pietrzynski+2019).
- Every table row has `fields.length` entries; no NaN.

## Known limitations
- local.json distances are UNGC adopted values to 0.01-0.02 Mpc resolution: unusable for the Magellanic Clouds (0.05 vs 0.0496 Mpc) - use famous.json. Sky positions of nearby dwarfs are fine.
- No SIMBAD TAP cross-match was run; aliases come from the SimbadName/NEDname columns VizieR already adds.
- Curated tables (famous, structures) were compiled from published values and not re-verified against the papers programmatically; treat "approximate" structure centres as illustrative. Cosmicflows-4 and Tully+2014 galaxy-level data are not included.
- Redshift-space distortions make clusters elongated along the line of sight; the magnitude-limited 2MRS and flux-limited BGS density falls with distance.
