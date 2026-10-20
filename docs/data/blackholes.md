# Black holes: catalogue and rendering model

Data: `public/data/blackholes/blackholes.json` (curated by hand; every number carries a reference key). Domain:
`src/domains/blackholes/`. Shared renderer: `src/render/blackhole/`. Tables below are regenerated (and the file is
validated) by `node scripts/data/blackholes/build-doc.mjs`.

Conventions: 1-sigma errors unless a field note says otherwise (GW150914: 90 % credible intervals; Greene et al. 2001:
95 %). `null` means Unknown, never zero. Coordinates are ICRS decimal degrees (Gaia DR3 where available). A spin shown as
"> x" is a lower limit.

## Catalogue

<!-- AUTO:catalogue -->
| Object | Class | Mass | Spin a* | Distance | Companion | Period |
|---|---|---|---|---|---|---|
| Gaia BH1 | stellar-dormant | 9.62 ± 0.18 M☉ [elbadry2023a] | Unknown | 480 ± 5 pc [elbadry2023a] | Gaia BH1 (G dwarf) (G, 0.93 ± 0.05 M☉ [elbadry2023a]) | 185.59 ± 0.05 d [elbadry2023a] |
| Gaia BH2 | stellar-dormant | 8.94 ± 0.34 M☉ [elbadry2023b] | Unknown | 1160 ± 24 pc [elbadry2023b] | Gaia BH2 (red giant) (K giant (red giant branch), 1.07 ± 0.19 M☉ [elbadry2023b]) | 1276.7 ± 0.6 d [elbadry2023b] |
| Gaia BH3 | stellar-dormant | 32.7 ± 0.82 M☉ [panuzzo2024] | Unknown | 590.6 ± 5.7 pc [panuzzo2024] | Gaia BH3 (metal-poor giant) (G/K giant, very metal-poor halo star, 0.76 ± 0.05 M☉ [panuzzo2024]) | 4253.1 ± 98.5 d [panuzzo2024] |
| Cygnus X-1 | stellar-xrb | 21.2 ± 2.2 M☉ [millerjones2021] | > 0.9985 [zhao2021] | 2220 −170/+180 pc [millerjones2021] | HDE 226868 (O9.7 Iab, 40.6 −7.1/+7.7 M☉ [millerjones2021]) | 5.599829 d [brocksopp1999] |
| V404 Cygni | stellar-xrb | 9 −0.6/+0.2 M☉ [khargharia2010] | Unknown | 2390 ± 140 pc [millerjones2009] | V404 Cyg donor (K3 III, 0.54 M☉ [khargharia2010]) | 6.4714 d [casares1994] |
| A0620-00 | stellar-xrb | 6.61 ± 0.25 M☉ [cantrell2010] | 0.12 ± 0.19 [gou2010] | 1060 ± 120 pc [cantrell2010] | V616 Mon donor (K5 V, 0.4 ± 0.045 M☉ [cantrell2010]) | 0.323016 d [cantrell2010] |
| GRS 1915+105 | stellar-xrb | 12.4 −1.8/+2 M☉ [reid2014] | > 0.98 [mcclintock2006] | 8600 −1600/+2000 pc [reid2014] | GRS 1915+105 donor (K giant, 0.47 ± 0.27 M☉ [steeghs2013]) | 33.85 ± 0.16 d [steeghs2013] |
| GRO J1655-40 | stellar-xrb | 6.3 ± 0.5 M☉ [greene2001] | 0.7 ± 0.05 [shafee2006] | 3200 ± 200 pc [hjellming1995] | V1033 Sco (F6 IV, 2.4 M☉ [greene2001]) | 2.62168 ± 0.00014 d [vanderhooft1998] |
| XTE J1118+480 | stellar-xrb | 7.55 ± 0.65 M☉ [khargharia2013] | Unknown | 1720 ± 100 pc [gelino2006] | KV UMa donor (K7 V - M1 V, Unknown) | 0.16993 d [mcclintock2001] |
| MAXI J1820+070 | stellar-xrb | 8.48 −0.72/+0.79 M☉ [torres2020] | Unknown | 2960 ± 330 pc [atri2020] | MAXI J1820+070 donor (K3-5, 0.61 −0.12/+0.13 M☉ [torres2020]) | 0.68549 ± 0.00001 d [torres2019] |
| M31* | supermassive | 1.40×10^8 −30000000/+90000000 M☉ [bender2005] | Unknown | 7.85×10^5 ± 25000 pc [mcconnachie2005] | — | — |
| M87* | supermassive | 6.50×10^9 ± 700000000 M☉ [ehtVI] | Unknown | 1.68×10^7 −700000/+800000 pc [ehtVI] | — | — |
| GW150914 | merger | 62 ± 4 M☉ [abbott2016] | 0.67 −0.07/+0.05 [abbott2016] | 4.10×10^8 −180000000/+160000000 pc [abbott2016] | — | — |

### How each was found

- **Gaia BH1** (2022, Gaia astrometry + radial-velocity follow-up): Gaia saw a Sun-like star wobbling around an invisible partner, and telescopes on the ground confirmed the partner is a black hole. [elbadry2023a]
- **Gaia BH2** (2023, Gaia astrometry + radial-velocity follow-up): A bloated red giant star was caught circling an unseen heavy partner every three and a half years, which turned out to be a black hole. [elbadry2023b]
- **Gaia BH3** (2024, Gaia astrometry (pre-release DR4 validation)): While checking data for its next big release, the Gaia team spotted an old star being swung around by the heaviest stellar black hole yet found in our galaxy. [panuzzo2024]
- **Cygnus X-1** (1964, X-ray detector on a sounding rocket): A rocket carrying X-ray detectors found this source in 1964, and in 1972 astronomers showed its blue supergiant star orbits something too heavy to be anything but a black hole. [bowyer1965]
- **V404 Cygni** (1989, X-ray outburst (Ginga satellite)): It flared as a 'nova' in 1938, but only after its huge 1989 X-ray outburst did astronomers weigh it and find a black hole. [casares1992]
- **A0620-00** (1975, X-ray outburst (Ariel V satellite)): In 1975 it suddenly became the brightest X-ray source in the sky, revealing a black hole feeding on a small orange star. [elvis1975]
- **GRS 1915+105** (1992, X-ray all-sky monitor (WATCH on Granat)): Found in 1992 by an X-ray satellite, it soon shocked astronomers by shooting out blobs that seemed to move faster than light. [castrotirado1992]
- **GRO J1655-40** (1994, Hard X-ray outburst (BATSE on the Compton Gamma Ray Observatory)): A gamma-ray observatory caught it flaring in 1994, and radio telescopes then watched it shoot out jets at nearly the speed of light. [zhang1994]
- **XTE J1118+480** (2000, X-ray outburst (RXTE All-Sky Monitor)): An X-ray satellite spotted it in 2000 high above the plane of our galaxy, where little dust blocks the view. [remillard2000]
- **MAXI J1820+070** (2018, X-ray all-sky monitor (MAXI on the ISS)): In March 2018 a monitor on the International Space Station saw it light up in X-rays, and it became one of the brightest X-ray outbursts ever seen. [torres2019]
- **M31*** (1988, Stellar kinematics of the nucleus): In 1988 astronomers found that stars at the very centre of Andromeda move so fast that a giant hidden mass must be holding them in. [dressler1988]
- **M87*** (2019, Event Horizon Telescope image): In 2019 a planet-sized network of radio telescopes took the first-ever picture of a black hole's shadow, and this was it. [ehtI]
- **GW150914** (2015, Gravitational waves (LIGO Hanford + Livingston)): On 14 September 2015 the two LIGO detectors felt a tiny ripple in space itself, made when two black holes crashed together over a billion years ago. [abbott2016]

### References

- `elbadry2023a`: El-Badry et al. 2023, MNRAS 518, 1057. https://arxiv.org/abs/2209.06833
- `elbadry2023b`: El-Badry et al. 2023, MNRAS 521, 4323. https://arxiv.org/abs/2302.07880
- `panuzzo2024`: Gaia Collaboration, Panuzzo et al. 2024, A&A 686, L2. https://arxiv.org/abs/2404.10486
- `millerjones2021`: Miller-Jones et al. 2021, Science 371, 1046. https://arxiv.org/abs/2102.09091
- `zhao2021`: Zhao et al. 2021, ApJ 908, 117. https://ui.adsabs.harvard.edu/abs/2021ApJ...908..117Z
- `brocksopp1999`: Brocksopp et al. 1999, MNRAS 309, 1063. https://ui.adsabs.harvard.edu/abs/1999MNRAS.309.1063B
- `gaiadr3`: Gaia Collaboration, Vallenari et al. 2023, A&A 674, A1. https://arxiv.org/abs/2208.00211
- `bowyer1965`: Bowyer, Byram, Chubb & Friedman 1965, Science 147, 394. https://ui.adsabs.harvard.edu/abs/1965Sci...147..394B
- `webster1972`: Webster & Murdin 1972, Nature 235, 37. https://ui.adsabs.harvard.edu/abs/1972Natur.235...37W
- `khargharia2010`: Khargharia, Froning & Robinson 2010, ApJ 716, 1105. https://arxiv.org/abs/1004.5358
- `millerjones2009`: Miller-Jones et al. 2009, ApJ 706, L230. https://arxiv.org/abs/0910.5253
- `casares1994`: Casares & Charles 1994, MNRAS 271, L5. https://ui.adsabs.harvard.edu/abs/1994MNRAS.271L...5C
- `casares1992`: Casares, Charles & Naylor 1992, Nature 355, 614. https://ui.adsabs.harvard.edu/abs/1992Natur.355..614C
- `cantrell2010`: Cantrell et al. 2010, ApJ 710, 1127. https://arxiv.org/abs/1001.0261
- `gou2010`: Gou et al. 2010, ApJ 718, L122. https://arxiv.org/abs/1002.2211
- `elvis1975`: Elvis et al. 1975, Nature 257, 656. https://ui.adsabs.harvard.edu/abs/1975Natur.257..656E
- `reid2014`: Reid et al. 2014, ApJ 796, 2. https://arxiv.org/abs/1409.2453
- `steeghs2013`: Steeghs et al. 2013, ApJ 768, 185. https://arxiv.org/abs/1304.1808
- `mcclintock2006`: McClintock et al. 2006, ApJ 652, 518. https://arxiv.org/abs/astro-ph/0606076
- `mirabel1994`: Mirabel & Rodriguez 1994, Nature 371, 46. https://ui.adsabs.harvard.edu/abs/1994Natur.371...46M
- `castrotirado1992`: Castro-Tirado, Brandt & Lund 1992, IAU Circ. 5590, 2. https://ui.adsabs.harvard.edu/abs/1992IAUC.5590....2C
- `greene2001`: Greene, Bailyn & Orosz 2001, ApJ 554, 1290. https://arxiv.org/abs/astro-ph/0101337
- `hjellming1995`: Hjellming & Rupen 1995, Nature 375, 464. https://ui.adsabs.harvard.edu/abs/1995Natur.375..464H
- `shafee2006`: Shafee et al. 2006, ApJ 636, L113. https://arxiv.org/abs/astro-ph/0508302
- `vanderhooft1998`: van der Hooft et al. 1998, A&A 329, 538. https://ui.adsabs.harvard.edu/abs/1998A&A...329..538V
- `orosz1997`: Orosz & Bailyn 1997, ApJ 477, 876. https://arxiv.org/abs/astro-ph/9610211
- `zhang1994`: Zhang et al. 1994, IAU Circ. 6046, 1. https://ui.adsabs.harvard.edu/abs/1994IAUC.6046....1Z
- `khargharia2013`: Khargharia et al. 2013, AJ 145, 21. https://arxiv.org/abs/1211.2786
- `gelino2006`: Gelino et al. 2006, ApJ 642, 438. https://arxiv.org/abs/astro-ph/0601409
- `mcclintock2001`: McClintock et al. 2001, ApJ 551, L147. https://ui.adsabs.harvard.edu/abs/2001ApJ...551L.147M
- `remillard2000`: Remillard et al. 2000, IAU Circ. 7389, 2. https://ui.adsabs.harvard.edu/abs/2000IAUC.7389....2R
- `torres2019`: Torres et al. 2019, ApJ 882, L21. https://arxiv.org/abs/1907.00938
- `torres2020`: Torres et al. 2020, ApJ 893, L37. https://arxiv.org/abs/2003.02360
- `atri2020`: Atri et al. 2020, MNRAS 493, L81. https://arxiv.org/abs/1912.04525
- `bender2005`: Bender et al. 2005, ApJ 631, 280. https://arxiv.org/abs/astro-ph/0509839
- `mcconnachie2005`: McConnachie et al. 2005, MNRAS 356, 979. https://arxiv.org/abs/astro-ph/0410489
- `dressler1988`: Dressler & Richstone 1988, ApJ 324, 701. https://ui.adsabs.harvard.edu/abs/1988ApJ...324..701D
- `ehtI`: Event Horizon Telescope Collaboration 2019, ApJ 875, L1. https://arxiv.org/abs/1906.11238
- `ehtV`: Event Horizon Telescope Collaboration 2019, ApJ 875, L5. https://arxiv.org/abs/1906.11242
- `ehtVI`: Event Horizon Telescope Collaboration 2019, ApJ 875, L6. https://arxiv.org/abs/1906.11243
- `walker2018`: Walker et al. 2018, ApJ 855, 128. https://arxiv.org/abs/1802.06166
- `abbott2016`: Abbott et al. (LIGO/Virgo) 2016, PRL 116, 061102. https://arxiv.org/abs/1602.03837
<!-- /AUTO:catalogue -->

## How positions are built

- **Galactic black holes**: barycentre = RA/Dec/distance from the catalogue (ICRS, metres). Binaries move on their
  Keplerian orbit (period, eccentricity, inclination, argument of periastron from the cited orbit papers). Where the
  node (Ω) or the epoch of periastron is unpublished (most X-ray binaries) the orbit orientation on the sky and the
  phase are **illustrative**; the fact sheet says so.
- **M31\*** sits on the galaxies domain's `gal:m31` entity when that domain is loaded, else at its catalogue position.
- **M87\*** sits on `gal:m87` (Virgo cluster) when present, else at its catalogue position.
- **GW150914** has no precise sky position (LIGO 90 % area ~600 deg²); it is placed at a representative point in its
  localisation arc at the luminosity distance and is flagged illustrative.

## Rendering model (what is physics and what is display)

| Effect | Model | Class |
|---|---|---|
| Shadow, photon ring, secondary images, Einstein rings | Null geodesics in Schwarzschild, integrated per pixel inside 40 r_s (Binet form d²x/dλ² = −(3/2)h²x/r⁵, leapfrog); outside, the analytic weak-field deflection 2r_s/b | derived (exact for a = 0) |
| Spin | Lense–Thirring gravitomagnetic term added to the geodesic force (flattens and shifts the shadow) | approximate Kerr, labelled |
| Disc temperature | Novikov–Thorne / Shakura–Sunyaev T ∝ r^(−3/4)(1 − √(r_in/r))^(1/4) from the spin-dependent ISCO (Bardeen, Press & Teukolsky 1972) | derived shape |
| Disc colour/brightness | Display temperature T_peak·profile^0.75, brightness profile^1.35 (flattened like DNGR's Gargantua so one exposure shows the whole disc); the real inner-disc temperatures (10⁶–10⁷ K, X-ray) are in the fact sheets | illustrative mapping |
| Doppler beaming and gravitational redshift | g = 1/(u^t(1 − Ωλ)) for Kerr circular orbits; intensity ∝ g⁴, colour temperature × g | derived |
| Outer disc | fades to transparent where its visible emission vanishes (a cool outer disc is dark, not black-opaque on screen) | display choice |
| Jets | Doppler-boosted (δ³) emissivity along the spin axis; M87\* axis from EHT/VLBI (PA 288°, i = 17°); microquasar axes illustrative unless measured | illustrative morphology |
| Mass transfer | Roche-lobe overflow stream through L1 (Eggleton 1983 lobe radius) or a focused wind (Cygnus X-1) | illustrative |
| Companion stars | Roche-distorted, gravity- and limb-darkened sphere at the catalogue radius and T_eff | derived |
| Background | A cube-map capture of the real scene (stars, Milky Way, galaxies) taken from the black hole's position once per visit | observed scene, lensed |

References for the method: Luminet 1979, A&A 75, 228; James, von Tunzelmann, Franklin & Thorne 2015, CQG 32, 065001
(DNGR, "Interstellar"); Event Horizon Telescope Collaboration 2019, ApJ 875, L1–L6; Novikov & Thorne 1973; Shakura &
Sunyaev 1973, A&A 24, 337; Bardeen, Press & Teukolsky 1972, ApJ 178, 347; Eggleton 1983, ApJ 268, 368.

## Approach readout

For a static observer hovering at r: clock rate √(1 − r_s/r); gravitational redshift z = 1/√(1 − r_s/r) − 1; tidal
acceleration across a 2 m body Δa = 2GM·L/r³ (Newtonian, accurate outside a few r_s). Values in
`src/render/blackhole/physics.ts`, tested in `src/render/blackhole/physics.test.ts`.

## Quality presets

- Ultra (`blackHoleQuality: 'high'`): 320 adaptive steps, 1024² cube capture.
- Balanced / Performance (`'fast'`): 150 longer steps, 512² capture.
- The ray-march runs only for pixels inside the 40 r_s lensing sphere and only once that sphere is ≥ 1.5 px on screen;
  the whole effect hides below ~1 px. The background is captured once per black hole, never per frame.
