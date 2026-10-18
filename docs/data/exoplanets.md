# Exoplanets data domain

<!-- BEGIN GENERATED:SCHEMA (scripts/data/exoplanets/build.mjs) -->

_Generated 2026-10-16T19:02:20.377Z from the snapshot retrieved 2026-10-16T18:28:50.774Z (latest PS default-row release date 2026-10-15)._

| file | records | bytes |
|---|---|---|
| `public/data/exoplanets/planets.json` | 6451 | 4583641 |
| `public/data/exoplanets/systems.json` | 4847 | 1885428 |
| `public/data/exoplanets/references.json` | 2456 | 305975 |

Count checks: PSCompPars rows = 6451; `count(*) from ps where default_flag=1` = 6451; distinct pl_name in PS default = 6451; distinct hostname in PS default = 4847; default-set solution types: Kepler Project Candidate (q1_q17_dr25_koi) = 69, Published Confirmed = 6378, TESS Project Candidate = 4.

### planets.json fields (130 columns per row, in this order)

| # | field | TS type | unit | description |
|---|---|---|---|---|
| 0 | `pl_name` | string | null | — | Planet name (most commonly used in the literature); unique key |
| 1 | `pl_letter` | string | null | — | Planet letter (b, c, ...) |
| 2 | `hostname` | string | null | — | Host star name; key into systems.json (hostname field) |
| 3 | `sy_snum` | number | null (integer) | — | Number of stars in the planetary system |
| 4 | `sy_pnum` | number | null (integer) | — | Number of confirmed planets in the system (counts planets of all stars of a multiple system, so it can exceed the number of rows with this hostname) |
| 5 | `sy_mnum` | number | null (integer) | — | Number of moons in the system |
| 6 | `cb_flag` | number | null (integer) | — | Circumbinary flag: 1 = planet orbits a binary star system, 0 = no |
| 7 | `pl_controv_flag` | number | null (integer) | — | Controversial flag: 1 = confirmation status has been questioned in the literature, 0 = no |
| 8 | `discoverymethod` | string | null | — | Method by which the planet was first identified (e.g. Transit, Radial Velocity, Microlensing, Imaging) |
| 9 | `disc_year` | number | null (integer) | — | Year of discovery (calendar year) |
| 10 | `disc_facility` | string | null | — | Facility (observatory / mission) of the discovery observations |
| 11 | `disc_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Discovery publication |
| 12 | `pl_orbper` | number | null | day | Orbital period |
| 13 | `pl_orbpererr1` | number | null | day | Upper (+) uncertainty of pl_orbper, same unit (>= 0; null if not given) |
| 14 | `pl_orbpererr2` | number | null | day | Lower (-) uncertainty of pl_orbper, same unit (<= 0; null if not given) |
| 15 | `pl_orbperlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_orbper |
| 16 | `pl_orbper_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_orbper (value, uncertainties and limit flag) |
| 17 | `pl_orbsmax` | number | null | au | Orbit semi-major axis (for microlensing and imaging planets often the projected separation) |
| 18 | `pl_orbsmaxerr1` | number | null | au | Upper (+) uncertainty of pl_orbsmax, same unit (>= 0; null if not given) |
| 19 | `pl_orbsmaxerr2` | number | null | au | Lower (-) uncertainty of pl_orbsmax, same unit (<= 0; null if not given) |
| 20 | `pl_orbsmaxlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_orbsmax |
| 21 | `pl_orbsmax_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_orbsmax (value, uncertainties and limit flag) |
| 22 | `pl_orbeccen` | number | null | dimensionless | Orbital eccentricity |
| 23 | `pl_orbeccenerr1` | number | null | dimensionless | Upper (+) uncertainty of pl_orbeccen, same unit (>= 0; null if not given) |
| 24 | `pl_orbeccenerr2` | number | null | dimensionless | Lower (-) uncertainty of pl_orbeccen, same unit (<= 0; null if not given) |
| 25 | `pl_orbeccenlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_orbeccen |
| 26 | `pl_orbeccen_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_orbeccen (value, uncertainties and limit flag) |
| 27 | `pl_orbincl` | number | null | deg | Orbital inclination relative to the plane of the sky (90 deg = edge-on) |
| 28 | `pl_orbinclerr1` | number | null | deg | Upper (+) uncertainty of pl_orbincl, same unit (>= 0; null if not given) |
| 29 | `pl_orbinclerr2` | number | null | deg | Lower (-) uncertainty of pl_orbincl, same unit (<= 0; null if not given) |
| 30 | `pl_orbincllim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_orbincl |
| 31 | `pl_orbincl_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_orbincl (value, uncertainties and limit flag) |
| 32 | `pl_orblper` | number | null | deg | Argument of periastron (sign/reference conventions vary between references) |
| 33 | `pl_orblpererr1` | number | null | deg | Upper (+) uncertainty of pl_orblper, same unit (>= 0; null if not given) |
| 34 | `pl_orblpererr2` | number | null | deg | Lower (-) uncertainty of pl_orblper, same unit (<= 0; null if not given) |
| 35 | `pl_orblperlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_orblper |
| 36 | `pl_orblper_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_orblper (value, uncertainties and limit flag) |
| 37 | `pl_tranmid` | number | null | day (Julian Date; time standard in pl_tranmid_systemref, normally BJD-TDB) | Time of conjunction / transit midpoint, as a Julian Date in the time standard given by pl_tranmid_systemref |
| 38 | `pl_tranmiderr1` | number | null | day (Julian Date; time standard in pl_tranmid_systemref, normally BJD-TDB) | Upper (+) uncertainty of pl_tranmid, same unit (>= 0; null if not given) |
| 39 | `pl_tranmiderr2` | number | null | day (Julian Date; time standard in pl_tranmid_systemref, normally BJD-TDB) | Lower (-) uncertainty of pl_tranmid, same unit (<= 0; null if not given) |
| 40 | `pl_tranmidlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_tranmid |
| 41 | `pl_tranmid_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_tranmid (value, uncertainties and limit flag) |
| 42 | `pl_tranmid_systemref` | string | null | — | Time standard of pl_tranmid as given by the archive: 'BJD-TDB', 'BJD', 'BJD-UTC', 'BJD-TT', 'HJD', 'HJD-UTC', 'HJD-TDB', 'JD' or null |
| 43 | `pl_rade` | number | null | Earth radius (R_earth) | Planet radius |
| 44 | `pl_radeerr1` | number | null | Earth radius (R_earth) | Upper (+) uncertainty of pl_rade, same unit (>= 0; null if not given) |
| 45 | `pl_radeerr2` | number | null | Earth radius (R_earth) | Lower (-) uncertainty of pl_rade, same unit (<= 0; null if not given) |
| 46 | `pl_radelim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_rade |
| 47 | `pl_rade_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_rade (value, uncertainties and limit flag) |
| 48 | `pl_bmasse` | number | null | Earth mass (M_earth) | Best available planet mass: true mass, minimum mass M*sin(i), or archive estimate from the mass-radius relation (see pl_bmassprov) |
| 49 | `pl_bmasseerr1` | number | null | Earth mass (M_earth) | Upper (+) uncertainty of pl_bmasse, same unit (>= 0; null if not given) |
| 50 | `pl_bmasseerr2` | number | null | Earth mass (M_earth) | Lower (-) uncertainty of pl_bmasse, same unit (<= 0; null if not given) |
| 51 | `pl_bmasselim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_bmasse |
| 52 | `pl_bmasse_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_bmasse (value, uncertainties and limit flag) |
| 53 | `pl_bmassprov` | string | null | — | Provenance of pl_bmasse: 'Mass' (true mass), 'Msini' (minimum mass), 'Msin(i)/sin(i)' (M*sin(i) divided by a measured sin(i)), 'M-R relationship' (archive estimate from pl_rade using Chen & Kipping 2017; not a measurement) |
| 54 | `pl_dens` | number | null | g/cm^3 | Planet bulk density |
| 55 | `pl_denserr1` | number | null | g/cm^3 | Upper (+) uncertainty of pl_dens, same unit (>= 0; null if not given) |
| 56 | `pl_denserr2` | number | null | g/cm^3 | Lower (-) uncertainty of pl_dens, same unit (<= 0; null if not given) |
| 57 | `pl_denslim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_dens |
| 58 | `pl_dens_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_dens (value, uncertainties and limit flag) |
| 59 | `pl_insol` | number | null | Earth flux (S_earth; 1 = solar flux at 1 au) | Insolation flux relative to the solar flux received by Earth |
| 60 | `pl_insolerr1` | number | null | Earth flux (S_earth; 1 = solar flux at 1 au) | Upper (+) uncertainty of pl_insol, same unit (>= 0; null if not given) |
| 61 | `pl_insolerr2` | number | null | Earth flux (S_earth; 1 = solar flux at 1 au) | Lower (-) uncertainty of pl_insol, same unit (<= 0; null if not given) |
| 62 | `pl_insollim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_insol |
| 63 | `pl_insol_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_insol (value, uncertainties and limit flag) |
| 64 | `pl_eqt` | number | null | K | Equilibrium temperature; albedo / heat-redistribution assumptions are those of the cited reference (archive-calculated values assume zero albedo and full redistribution; see docs) |
| 65 | `pl_eqterr1` | number | null | K | Upper (+) uncertainty of pl_eqt, same unit (>= 0; null if not given) |
| 66 | `pl_eqterr2` | number | null | K | Lower (-) uncertainty of pl_eqt, same unit (<= 0; null if not given) |
| 67 | `pl_eqtlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of pl_eqt |
| 68 | `pl_eqt_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for pl_eqt (value, uncertainties and limit flag) |
| 69 | `st_spectype` | string | null | — | Host star spectral type (MK classification) as published |
| 70 | `st_spectype_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_spectype |
| 71 | `st_teff` | number | null | K | Stellar effective temperature |
| 72 | `st_tefferr1` | number | null | K | Upper (+) uncertainty of st_teff, same unit (>= 0; null if not given) |
| 73 | `st_tefferr2` | number | null | K | Lower (-) uncertainty of st_teff, same unit (<= 0; null if not given) |
| 74 | `st_tefflim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_teff |
| 75 | `st_teff_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_teff (value, uncertainties and limit flag) |
| 76 | `st_rad` | number | null | solar radius (R_sun) | Stellar radius |
| 77 | `st_raderr1` | number | null | solar radius (R_sun) | Upper (+) uncertainty of st_rad, same unit (>= 0; null if not given) |
| 78 | `st_raderr2` | number | null | solar radius (R_sun) | Lower (-) uncertainty of st_rad, same unit (<= 0; null if not given) |
| 79 | `st_radlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_rad |
| 80 | `st_rad_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_rad (value, uncertainties and limit flag) |
| 81 | `st_mass` | number | null | solar mass (M_sun) | Stellar mass |
| 82 | `st_masserr1` | number | null | solar mass (M_sun) | Upper (+) uncertainty of st_mass, same unit (>= 0; null if not given) |
| 83 | `st_masserr2` | number | null | solar mass (M_sun) | Lower (-) uncertainty of st_mass, same unit (<= 0; null if not given) |
| 84 | `st_masslim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_mass |
| 85 | `st_mass_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_mass (value, uncertainties and limit flag) |
| 86 | `st_lum` | number | null | dex: log10(L/L_sun) | Stellar luminosity as log10(L/L_sun) |
| 87 | `st_lumerr1` | number | null | dex: log10(L/L_sun) | Upper (+) uncertainty of st_lum, same unit (>= 0; null if not given) |
| 88 | `st_lumerr2` | number | null | dex: log10(L/L_sun) | Lower (-) uncertainty of st_lum, same unit (<= 0; null if not given) |
| 89 | `st_lumlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_lum |
| 90 | `st_lum_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_lum (value, uncertainties and limit flag) |
| 91 | `st_met` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Stellar metallicity |
| 92 | `st_meterr1` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Upper (+) uncertainty of st_met, same unit (>= 0; null if not given) |
| 93 | `st_meterr2` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Lower (-) uncertainty of st_met, same unit (<= 0; null if not given) |
| 94 | `st_metlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_met |
| 95 | `st_met_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_met (value, uncertainties and limit flag) |
| 96 | `st_metratio` | string | null | — | Metallicity ratio used for st_met: '[Fe/H]', '[M/H]' or '[m/H]' (as given by the archive) |
| 97 | `st_age` | number | null | Gyr | Stellar age |
| 98 | `st_ageerr1` | number | null | Gyr | Upper (+) uncertainty of st_age, same unit (>= 0; null if not given) |
| 99 | `st_ageerr2` | number | null | Gyr | Lower (-) uncertainty of st_age, same unit (<= 0; null if not given) |
| 100 | `st_agelim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_age |
| 101 | `st_age_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_age (value, uncertainties and limit flag) |
| 102 | `st_logg` | number | null | dex: log10(g / (cm/s^2)) | Stellar surface gravity as log10(g / (cm s^-2)) |
| 103 | `st_loggerr1` | number | null | dex: log10(g / (cm/s^2)) | Upper (+) uncertainty of st_logg, same unit (>= 0; null if not given) |
| 104 | `st_loggerr2` | number | null | dex: log10(g / (cm/s^2)) | Lower (-) uncertainty of st_logg, same unit (<= 0; null if not given) |
| 105 | `st_logglim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_logg |
| 106 | `st_logg_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_logg (value, uncertainties and limit flag) |
| 107 | `ra` | number | null | deg (ICRS) | Right ascension, ICRS, decimal degrees. Epoch is that of the position source (ra_refIdx): J2015.5 for TIC v8 (about 95% of rows); not propagated to J2000 |
| 108 | `dec` | number | null | deg (ICRS) | Declination, ICRS, decimal degrees (same epoch convention as ra) |
| 109 | `ra_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Position reference (applies to ra and dec) |
| 110 | `sy_dist` | number | null | pc | Distance to the planetary system |
| 111 | `sy_disterr1` | number | null | pc | Upper (+) uncertainty of sy_dist, same unit (>= 0; null if not given) |
| 112 | `sy_disterr2` | number | null | pc | Lower (-) uncertainty of sy_dist, same unit (<= 0; null if not given) |
| 113 | `sy_dist_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for sy_dist (value, uncertainties and limit flag) |
| 114 | `sy_vmag` | number | null | mag (Johnson V) | Johnson V magnitude of the system |
| 115 | `sy_vmagerr1` | number | null | mag (Johnson V) | Upper (+) uncertainty of sy_vmag, same unit (>= 0; null if not given) |
| 116 | `sy_vmagerr2` | number | null | mag (Johnson V) | Lower (-) uncertainty of sy_vmag, same unit (<= 0; null if not given) |
| 117 | `sy_vmag_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for sy_vmag (value, uncertainties and limit flag) |
| 118 | `sy_kmag` | number | null | mag (2MASS Ks) | 2MASS Ks magnitude of the system |
| 119 | `sy_kmagerr1` | number | null | mag (2MASS Ks) | Upper (+) uncertainty of sy_kmag, same unit (>= 0; null if not given) |
| 120 | `sy_kmagerr2` | number | null | mag (2MASS Ks) | Lower (-) uncertainty of sy_kmag, same unit (<= 0; null if not given) |
| 121 | `sy_kmag_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for sy_kmag (value, uncertainties and limit flag) |
| 122 | `ps_pl_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference of the planet's default parameter set (PS table row with default_flag=1); composite values may come from other references, see the per-parameter *_refIdx |
| 123 | `ps_st_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Stellar-parameter reference of the default parameter set (PS table, default_flag=1) |
| 124 | `ps_sy_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | System-parameter reference of the default parameter set (PS table, default_flag=1) |
| 125 | `ps_soltype` | string | null | — | Solution type of the default parameter set: 'Published Confirmed', 'Kepler Project Candidate (q1_q17_dr25_koi)' or 'TESS Project Candidate' (the planet itself is confirmed in all cases) |
| 126 | `ps_pl_pubdate` | string | null | ISO-8601 date (YYYY-MM or YYYY-MM-DD) | Publication date of the default reference, ISO-8601 year-month (YYYY-MM) or calendar date (YYYY-MM-DD) |
| 127 | `ps_releasedate` | string | null | ISO-8601 date (YYYY-MM-DD) | Date the default parameter set was released by the archive, ISO-8601 calendar date (YYYY-MM-DD) |
| 128 | `ps_rowupdate` | string | null | ISO-8601 date (YYYY-MM-DD) | Date the default parameter set was last updated in the archive, ISO-8601 calendar date (YYYY-MM-DD) |
| 129 | `sysIdx` | number | null (integer) | integer row index into systems.json rows | Row index (0-based) of this planet's host in systems.json rows |

### systems.json fields (67 columns per row, in this order)

| # | field | TS type | unit | description |
|---|---|---|---|---|
| 0 | `hostname` | string | null | — | Host star name (archive hostname); unique key; matches planets.json hostname |
| 1 | `raDeg` | number | null | deg (ICRS) | Right ascension (archive ra), ICRS. Epoch: posEpochJyr |
| 2 | `decDeg` | number | null | deg (ICRS) | Declination (archive dec), ICRS. Epoch: posEpochJyr |
| 3 | `posEpochJyr` | number | null | Julian year | Epoch of raDeg/decDeg: 2015.5 when the position source is TIC v8 (Gaia DR2-based); null = epoch not stated by the source (literature positions, mostly microlensing hosts; proper motions negligible) |
| 4 | `distPc` | number | null | pc | Distance (archive sy_dist) |
| 5 | `distPcErr1` | number | null | pc | Upper (+) uncertainty of distPc (archive sy_disterr1) |
| 6 | `distPcErr2` | number | null | pc | Lower (-) uncertainty of distPc (archive sy_disterr2, <= 0) |
| 7 | `xPc` | number | null | pc | DERIVED ICRS Cartesian x = distPc*cos(dec)*cos(ra) (toward RA=0h, Dec=0); rounded to 1e-6 pc; null if distPc is null |
| 8 | `yPc` | number | null | pc | DERIVED ICRS Cartesian y = distPc*cos(dec)*sin(ra) (toward RA=6h, Dec=0); rounded to 1e-6 pc; null if distPc is null |
| 9 | `zPc` | number | null | pc | DERIVED ICRS Cartesian z = distPc*sin(dec) (toward the north celestial pole); rounded to 1e-6 pc; null if distPc is null |
| 10 | `nPlanets` | number | null (integer) | count | Number of planets.json rows with this hostname |
| 11 | `planetRows` | number[] | row indices | Indices (0-based) of this host's planets in planets.json rows, ordered by orbital period (nulls last); always contiguous and ascending |
| 12 | `sy_snum` | number | null (integer) | count | Number of stars in the planetary system |
| 13 | `sy_pnum` | number | null (integer) | count | Number of confirmed planets in the system (counts planets of all stars of a multiple system, so it can exceed the number of rows with this hostname) |
| 14 | `sy_mnum` | number | null (integer) | count | Number of moons in the system |
| 15 | `st_spectype` | string | null | — | Host star spectral type (MK classification) as published |
| 16 | `st_spectype_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_spectype |
| 17 | `st_teff` | number | null | K | Stellar effective temperature |
| 18 | `st_tefferr1` | number | null | K | Upper (+) uncertainty of st_teff |
| 19 | `st_tefferr2` | number | null | K | Lower (-) uncertainty of st_teff (<= 0) |
| 20 | `st_tefflim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_teff |
| 21 | `st_teff_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_teff |
| 22 | `st_rad` | number | null | solar radius (R_sun) | Stellar radius |
| 23 | `st_raderr1` | number | null | solar radius (R_sun) | Upper (+) uncertainty of st_rad |
| 24 | `st_raderr2` | number | null | solar radius (R_sun) | Lower (-) uncertainty of st_rad (<= 0) |
| 25 | `st_radlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_rad |
| 26 | `st_rad_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_rad |
| 27 | `st_mass` | number | null | solar mass (M_sun) | Stellar mass |
| 28 | `st_masserr1` | number | null | solar mass (M_sun) | Upper (+) uncertainty of st_mass |
| 29 | `st_masserr2` | number | null | solar mass (M_sun) | Lower (-) uncertainty of st_mass (<= 0) |
| 30 | `st_masslim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_mass |
| 31 | `st_mass_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_mass |
| 32 | `st_lum` | number | null | dex: log10(L/L_sun) | Stellar luminosity as log10(L/L_sun) |
| 33 | `st_lumerr1` | number | null | dex: log10(L/L_sun) | Upper (+) uncertainty of st_lum |
| 34 | `st_lumerr2` | number | null | dex: log10(L/L_sun) | Lower (-) uncertainty of st_lum (<= 0) |
| 35 | `st_lumlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_lum |
| 36 | `st_lum_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_lum |
| 37 | `st_met` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Stellar metallicity |
| 38 | `st_meterr1` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Upper (+) uncertainty of st_met |
| 39 | `st_meterr2` | number | null | dex ([Fe/H] or [M/H], see st_metratio) | Lower (-) uncertainty of st_met (<= 0) |
| 40 | `st_metlim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_met |
| 41 | `st_met_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_met |
| 42 | `st_metratio` | string | null | — | Metallicity ratio used for st_met: '[Fe/H]', '[M/H]' or '[m/H]' (as given by the archive) |
| 43 | `st_age` | number | null | Gyr | Stellar age |
| 44 | `st_ageerr1` | number | null | Gyr | Upper (+) uncertainty of st_age |
| 45 | `st_ageerr2` | number | null | Gyr | Lower (-) uncertainty of st_age (<= 0) |
| 46 | `st_agelim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_age |
| 47 | `st_age_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_age |
| 48 | `st_logg` | number | null | dex: log10(g / (cm/s^2)) | Stellar surface gravity as log10(g / (cm s^-2)) |
| 49 | `st_loggerr1` | number | null | dex: log10(g / (cm/s^2)) | Upper (+) uncertainty of st_logg |
| 50 | `st_loggerr2` | number | null | dex: log10(g / (cm/s^2)) | Lower (-) uncertainty of st_logg (<= 0) |
| 51 | `st_logglim` | number | null (integer) | flag: 1 = value is an upper limit, -1 = value is a lower limit, 0 = measured value (null when the value is null) | Limit flag of st_logg |
| 52 | `st_logg_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for st_logg |
| 53 | `ra_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Position reference (raDeg/decDeg) |
| 54 | `sy_dist_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Distance reference (distPc) |
| 55 | `sy_vmag` | number | null | mag (Johnson V) | Johnson V magnitude of the system |
| 56 | `sy_vmagerr1` | number | null | mag (Johnson V) | Upper (+) uncertainty of sy_vmag |
| 57 | `sy_vmagerr2` | number | null | mag (Johnson V) | Lower (-) uncertainty of sy_vmag |
| 58 | `sy_vmag_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for sy_vmag |
| 59 | `sy_kmag` | number | null | mag (2MASS Ks) | 2MASS Ks magnitude of the system |
| 60 | `sy_kmagerr1` | number | null | mag (2MASS Ks) | Upper (+) uncertainty of sy_kmag |
| 61 | `sy_kmagerr2` | number | null | mag (2MASS Ks) | Lower (-) uncertainty of sy_kmag |
| 62 | `sy_kmag_refIdx` | number | null (integer) | integer: 0-based row index into references.json rows (null = no reference given) | Reference for sy_kmag |
| 63 | `hd_name` | string | null | — | Henry Draper designation, e.g. 'HD 209458' (cross-match key) |
| 64 | `hip_name` | string | null | — | Hipparcos designation, e.g. 'HIP 70890' (cross-match key) |
| 65 | `gaia_dr3_id` | string | null | — | Gaia DR3 designation, e.g. 'Gaia DR3 5853498713190525696' (string: the source_id exceeds 2^53) |
| 66 | `stVarying` | string[] | — | Names of host-level parameters whose central values differ between this host's planet rows in PSCompPars (composite table); the value shown is the most frequent one (see docs). Empty array = consistent |

### references.json fields (4 columns per row)

| # | field | TS type | unit | description |
|---|---|---|---|---|
| 0 | `refstr` | string | null | — | Archive reference key (e.g. 'AGOL_ET_AL__2021', 'STASSUN_ET_AL__2019', 'CALCULATED_VALUE'); not unique on its own (same key can carry different labels, e.g. 'TICv8') |
| 1 | `label` | string | null | — | Display label (e.g. 'Agol et al. 2021', 'TICv8', 'Q1-Q17 DR25 KOI Table', 'Calculated Value') |
| 2 | `url` | string | null | — | Link to the reference (mostly NASA ADS abstract pages); null if none |
| 3 | `kind` | string | null | — | 'reference' (published value: paper or catalogue) or 'calculated' (computed by the archive, no uncertainties) |

<!-- END GENERATED:SCHEMA -->

<!-- BEGIN GENERATED:VALIDATION (scripts/data/exoplanets/validate.mjs) -->

_Generated 2026-10-17T06:13:35.701Z. Result: **FAIL** (1 failures, 2 warnings)._

#### Spot checks against published values

| check | actual | expected | tolerance | source | ok |
|---|---|---|---|---|---|
| TRAPPIST-1 planet count | 7 | 7 | 0 | Gillon et al. 2017; Agol et al. 2021 | yes |
| TRAPPIST-1 b period [d] | 1.510826 | 1.510826 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 c period [d] | 2.421937 | 2.421937 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 d period [d] | 4.049219 | 4.049219 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 e period [d] | 6.101013 | 6.101013 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 f period [d] | 9.20754 | 9.20754 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 g period [d] | 12.352446 | 12.352446 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 h period [d] | 18.772866 | 18.772866 | 0.001 | Agol et al. 2021, PSJ 2, 1 | yes |
| TRAPPIST-1 nPlanets (systems.json) | 7 | 7 | 0 | systems.json | yes |
| TRAPPIST-1 distance [pc] | 12.429889 | 12.43 | 0.2 | Gaia DR2 parallax 80.45 mas (Gaia Collaboration 2018) | yes |
| TRAPPIST-1 Teff [K] | 2566 | 2566 | 150 | Agol et al. 2021 (2566 +/- 26 K) | yes |
| Proxima Cen b present | true | true | — | Anglada-Escude et al. 2016, Nature 536, 437 | yes |
| Proxima Cen b period [d] | 11.18465 | 11.1846 | 0.005 | Faria et al. 2022 (11.18418 d) / Suarez Mascareno et al. 2025 (11.18465 d) | yes |
| Proxima Cen b discovery year | 2016 | 2016 | 0 | Anglada-Escude et al. 2016 | yes |
| Proxima Cen b discovery method | "Radial Velocity" | "Radial Velocity" | — | Anglada-Escude et al. 2016 | yes |
| Proxima Cen b M*sin(i) [M_earth] | 1.055 | 1.07 | 0.2 | Faria et al. 2022 (1.07 +/- 0.06) | yes |
| Proxima Cen distance [pc] | 1.30119 | 1.302 | 0.005 | Gaia DR3 parallax 768.07 mas -> 1.302 pc | yes |
| Proxima Cen RA [deg] | 217.39347 | 217.42894 | 0.05 | SIMBAD ICRS J2000 14h29m42.95s (pm moves it ~1 arcmin by J2015.5) | yes |
| Proxima Cen Dec [deg] | -62.676182 | -62.67949 | 0.05 | SIMBAD ICRS J2000 -62d40m46.2s | yes |
| Kepler-186 f present | true | true | — | Quintana et al. 2014 | yes |
| Kepler-186 f period [d] | 129.9441 | 129.9444 | 0.01 | Quintana et al. 2014 (129.9444 +/- 0.0007 d) | yes |
| Kepler-186 f radius [R_earth] | 1.17 | 1.15 | 0.25 | Quintana et al. 2014 (1.11 +/- 0.14); Torres et al. 2015 (1.17 +/- 0.08) | yes |
| Kepler-186 f discovery year | 2014 | 2014 | 0 | Quintana et al. 2014 | yes |
| Kepler-186 nPlanets | 5 | 5 | 0 | Quintana et al. 2014 (five planets) | yes |
| TOI-700 d present | true | true | — | Gilbert et al. 2020, AJ 160, 116 | yes |
| TOI-700 d period [d] | 37.423457 | 37.424 | 0.01 | Gilbert et al. 2020 (37.4260 d) / 2023 (37.42396 d) | yes |
| TOI-700 d radius [R_earth] | 1.145 | 1.13 | 0.2 | Gilbert et al. 2020 (1.19 +/- 0.11) / 2023 (1.073 +/- 0.059) | yes |
| TOI-700 distance [pc] | 31.1265 | 31.1 | 0.5 | Gaia DR2 (31.13 pc), Gilbert et al. 2020 | yes |
| TOI-700 d discovery year | 2020 | 2020 | 0 | Gilbert et al. 2020 | yes |
| 51 Peg b present | true | true | — | Mayor & Queloz 1995, Nature 378, 355 | yes |
| 51 Peg b period [d] | 4.2307966 | 4.2308 | 0.002 | Butler et al. 2006 (4.230785 d) | yes |
| 51 Peg b mass [M_earth] | 193.87533 | 148 | 20 | Butler et al. 2006 M sin i = 0.472 M_J; Birkby et al. 2017 M = 0.46 M_J | **NO** |
| 51 Peg b discovery year | 1995 | 1995 | 0 | Mayor & Queloz 1995 | yes |
| 51 Peg b discovery method | "Radial Velocity" | "Radial Velocity" | — | Mayor & Queloz 1995 | yes |
| 51 Peg distance [pc] | 15.4614 | 15.4 | 0.3 | Gaia DR2/DR3 parallax 64.6-65.1 mas | yes |
| 51 Peg RA [deg] | 344.36754 | 344.36659 | 0.05 | SIMBAD ICRS J2000 22h57m27.98s | yes |
| 51 Peg Dec [deg] | 20.769096 | 20.76883 | 0.05 | SIMBAD ICRS J2000 +20d46m07.8s | yes |
| 51 Peg xPc vs independent calc [pc] | 13.921922 | 13.921881 | 0.001 | x = d cos(dec) cos(ra) from SIMBAD position | yes |
| 51 Peg yPc vs independent calc [pc] | -3.895574 | -3.8958115 | 0.001 | y = d cos(dec) sin(ra) | yes |
| 51 Peg zPc vs independent calc [pc] | 5.482654 | 5.4825869 | 0.001 | z = d sin(dec) | yes |

#### Archive-calculated values reproduced with the archive formulas

| quantity | formula | n | median | 95th pct | max | fraction within tolerance |
|---|---|---|---|---|---|---|
| pl_eqt | Teq = Teff * sqrt(R*/(2a)) (zero albedo, full redistribution), R_sun = 695700 km, au = 149597870.7 km | 1090 | 5.66e-6 | 3.65e-5 | 1.36e-3 | 1 (1%) |
| st_lum | log10(L/Lsun) = log10((R/Rsun)^2 (Teff/5772 K)^4) | 162 | 5.97e-4 | 2.32e-3 | 5.50e-3 | 1 (0.01 dex) |
| pl_insol | S/S_earth = (L/Lsun) / (a/au)^2 | 1325 | 9.40e-6 | 2.15e-2 | Infinity | 0.9374 (1%) |
| pl_dens | rho = 3M/(4 pi R^3), M_earth = 5.9722e27 g, R_earth = 6.3781e8 cm | 4740 | 7.19e-4 | 2.49e-3 | 4.89e-3 | 1 (1%) |

#### Notes

- planets 6451, systems 4847, references 2456
- confirmed planets: 6451 (PSCompPars rows) = 6451 (count(*) from ps where default_flag=1); brief cited 6,445 on 2026-10-08
- xyz check: max |r - distPc| = 8.11e-7 pc, max angular error = 1.47e-5 deg; 28 hosts without distance (null xyz)
- spot checks: 39/40 passed
- calculated-value reproduction: Teq 1 within 1% (n=1090); L 1 within 0.01 dex (n=162); S 0.9374 within 1% (n=1325); rho 1 within 1% (n=4740)
- raw cross-checks: pl_rade/pl_radj median rel. diff from 11.2090 = 1.7e-6; |hypot(pmra,pmdec)-pm| max 0.044 mas/yr; TICv8 dist*plx/1000 median 0.9910
- coverage: Teq-lab inputs (Teff, R*, a) for 5628/6451 planets; measured radius + true mass for 1785; 62 hosts within 10 pc
- output size 6792174 bytes (84.9% of 8000000)

#### Warnings (catalogue oddities passed through unchanged)

- pl_denslim: 1 row(s) with undocumented limit value(s) 9 (TOI-431 d)
- physically odd values passed through unchanged: {"pl_insol":{"n":46,"examples":["1RXS J160929.1-210524 b=0","2MASS J01225093-2439505 b=0","2MASS J02192210-3925225 b=0"]}}

#### Coverage summary

```json
{
 "nonNullCounts": {
  "pl_orbper": 6097,
  "pl_orbsmax": 5956,
  "pl_orbeccen": 5383,
  "pl_orbincl": 4851,
  "pl_orblper": 2117,
  "pl_tranmid": 5152,
  "pl_rade": 6401,
  "pl_bmasse": 6421,
  "pl_dens": 6304,
  "pl_insol": 5855,
  "pl_eqt": 5911,
  "st_spectype": 2410,
  "st_teff": 6144,
  "st_rad": 6119,
  "st_mass": 6442,
  "st_lum": 6125,
  "st_met": 5752,
  "st_age": 4928,
  "st_logg": 6114,
  "sy_dist": 6423,
  "sy_vmag": 6138,
  "sy_kmag": 6152
 },
 "discoverymethod": {
  "Transit": 4785,
  "Radial Velocity": 1204,
  "Microlensing": 292,
  "Imaging": 98,
  "Transit Timing Variations": 29,
  "Eclipse Timing Variations": 17,
  "Orbital Brightness Modulation": 9,
  "Pulsar Timing": 8,
  "Astrometry": 6,
  "Pulsation Timing Variations": 2,
  "Disk Kinematics": 1
 },
 "pl_bmassprov": {
  "M-R relationship": 3035,
  "Mass": 2477,
  "Msini": 924,
  "Msin(i)/sin(i)": 15
 },
 "pl_tranmid_systemref": {
  "BJD": 2719,
  "JD": 1439,
  "null": 1349,
  "BJD-TDB": 790,
  "HJD": 87,
  "BJD-UTC": 41,
  "HJD-UTC": 24,
  "BJD-TT": 1,
  "HJD-TDB": 1
 },
 "ps_soltype": {
  "Published Confirmed": 6378,
  "Kepler Project Candidate (q1_q17_dr25_koi)": 69,
  "TESS Project Candidate": 4
 },
 "pl_eqt_topReferences": {
  "Q1-Q17 DR25 KOI Table": 2555,
  "Calculated Value": 1090,
  "null": 540,
  "ExoFOP": 247,
  "Livingston et al. 2018": 78,
  "Polanski et al. 2024": 71
 },
 "archiveCalculatedValueCounts": {
  "pl_rade": 1539,
  "pl_bmasse": 3035,
  "pl_dens": 4740,
  "pl_insol": 1325,
  "pl_eqt": 1090,
  "st_lum": 162
 },
 "controversialPlanets": 58,
 "circumbinaryPlanets": 53,
 "planetsWithTeffRstarA": 5628,
 "planetsWithMeasuredRadiusAndTrueMass": 1785,
 "systemMultiplicity": {
  "1": 3778,
  "2": 720,
  "3": 223,
  "4": 83,
  "5": 29,
  "6": 12,
  "7": 1,
  "8": 1
 },
 "hostsWithVaryingParams": 222,
 "hostPositionEpoch": {
  "J2015.5 (TIC v8)": 4550,
  "not stated": 297
 },
 "hostDistancePc": {
  "n": 4819,
  "min": 1.30119,
  "p50": 375.517,
  "p95": 3380,
  "max": 8500
 },
 "hostsWithin10pc": 62,
 "hostsWithin100pc": 1088,
 "discYearRange": [
  1992,
  2026
 ]
}
```

<!-- END GENERATED:VALIDATION -->
