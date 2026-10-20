// Interior-structure dataset for the cutaway view (src/ui/interiors). Hand-curated from the cited literature.
// build.mjs reads this, adds radius fractions from public/data/solar/bodies.json and writes
// public/data/interiors/interiors.json. Every layer cites its sources; model-dependent values carry a range and
// "model": true. Radii are outer radii of each layer measured from the centre, in km. Layers run centre -> surface.
// Ranges are the spread of published models, not formal error bars, unless the note says otherwise.

export const REFERENCES = {
  prem: { cite: 'Dziewonski, A. M. & Anderson, D. L. (1981). Preliminary reference Earth model. Phys. Earth Planet. Inter. 25, 297-356', doi: '10.1016/0031-9201(81)90046-7' },
  anzellini2013: { cite: 'Anzellini, S. et al. (2013). Melting of iron at Earth\'s inner core boundary based on fast X-ray diffraction. Science 340, 464-466', doi: '10.1126/science.1233514' },
  lay2008: { cite: 'Lay, T., Hernlund, J. & Buffett, B. A. (2008). Core-mantle boundary heat flow. Nature Geoscience 1, 25-32', doi: '10.1038/ngeo.2007.44' },
  weber2011: { cite: 'Weber, R. C. et al. (2011). Seismic detection of the lunar core. Science 331, 309-312', doi: '10.1126/science.1199375' },
  wieczorek2013: { cite: 'Wieczorek, M. A. et al. (2013). The crust of the Moon as seen by GRAIL. Science 339, 671-675', doi: '10.1126/science.1231530' },
  briaud2023: { cite: 'Briaud, A. et al. (2023). The lunar solid inner core and the mantle overturn. Nature 617, 743-746', doi: '10.1038/s41586-023-05935-7' },
  stahler2021: { cite: 'Stähler, S. C. et al. (2021). Seismic detection of the martian core. Science 373, 443-448', doi: '10.1126/science.abi7730' },
  knapmeyer2021: { cite: 'Knapmeyer-Endrun, B. et al. (2021). Thickness and structure of the martian crust from InSight seismic data. Science 373, 438-443', doi: '10.1126/science.abf8966' },
  khan2023: { cite: 'Khan, A. et al. (2023). Evidence for a liquid silicate layer atop the Martian core. Nature 622, 718-723', doi: '10.1038/s41586-023-06586-4' },
  samuel2023: { cite: 'Samuel, H. et al. (2023). Geophysical evidence for an enriched molten silicate layer above Mars\'s core. Nature 622, 712-717', doi: '10.1038/s41586-023-06601-8' },
  hauck2013: { cite: 'Hauck, S. A. et al. (2013). The curious case of Mercury\'s internal structure. J. Geophys. Res. Planets 118, 1204-1220', doi: '10.1002/jgre.20091' },
  genova2019: { cite: 'Genova, A. et al. (2019). Geodetic evidence that Mercury has a solid inner core. Geophys. Res. Lett. 46, 3625-3633', doi: '10.1029/2018GL081135' },
  padovan2015: { cite: 'Padovan, S. et al. (2015). Thickness of the crust of Mercury from geoid-to-topography ratios. Geophys. Res. Lett. 42, 1029-1038', doi: '10.1002/2014GL062487' },
  margot2021: { cite: 'Margot, J.-L. et al. (2021). Spin state and moment of inertia of Venus. Nature Astronomy 5, 676-683', doi: '10.1038/s41550-021-01339-7' },
  james2013: { cite: 'James, P. B., Zuber, M. T. & Phillips, R. J. (2013). Crustal thickness and support of topography on Venus. J. Geophys. Res. Planets 118, 859-875', doi: '10.1029/2012JE004237' },
  wahl2017: { cite: 'Wahl, S. M. et al. (2017). Comparing Jupiter interior structure models to Juno gravity measurements and the role of a dilute core. Geophys. Res. Lett. 44, 4649-4659', doi: '10.1002/2017GL073160' },
  militzer2022: { cite: 'Militzer, B. et al. (2022). Juno spacecraft measurements of Jupiter\'s gravity imply a dilute core. Planet. Sci. J. 3, 185', doi: '10.3847/PSJ/ac7ec8' },
  guillot2005: { cite: 'Guillot, T. (2005). The interiors of giant planets: models and outstanding questions. Annu. Rev. Earth Planet. Sci. 33, 493-530', doi: '10.1146/annurev.earth.32.101802.120325' },
  mankovich2021: { cite: 'Mankovich, C. R. & Fuller, J. (2021). A diffuse core in Saturn revealed by ring seismology. Nature Astronomy 5, 1103-1109', doi: '10.1038/s41550-021-01448-3' },
  hedman2013: { cite: 'Hedman, M. M. & Nicholson, P. D. (2013). Kronoseismology: using density waves in Saturn\'s C ring to probe the planet\'s interior. Astron. J. 146, 12', doi: '10.1088/0004-6256/146/1/12' },
  nettelmann2013: { cite: 'Nettelmann, N. et al. (2013). New indication for a dichotomy in the interior structure of Uranus and Neptune from the application of modified shape and rotation data. Planet. Space Sci. 77, 143-151', doi: '10.1016/j.pss.2012.06.019' },
  helled2020: { cite: 'Helled, R. & Fortney, J. J. (2020). The interiors of Uranus and Neptune: current understanding and open questions. Phil. Trans. R. Soc. A 378, 20190474', doi: '10.1098/rsta.2019.0474' },
  bahcall2005: { cite: 'Bahcall, J. N., Serenelli, A. M. & Basu, S. (2005). New solar opacities, abundances, helioseismology, and neutrino fluxes. Astrophys. J. 621, L85-L88', doi: '10.1086/428929' },
  jcd1996: { cite: 'Christensen-Dalsgaard, J. et al. (1996). The current state of solar modeling (Model S). Science 272, 1286-1292', doi: '10.1126/science.272.5266.1286' },
  basu1997: { cite: 'Basu, S. & Antia, H. M. (1997). Seismic measurement of the depth of the solar convection zone. Mon. Not. R. Astron. Soc. 287, 189-198', doi: '10.1093/mnras/287.1.189' },
  charbonneau1999: { cite: 'Charbonneau, P. et al. (1999). Helioseismic constraints on the structure of the solar tachocline. Astrophys. J. 527, 445-460', doi: '10.1086/308050' },
  prsa2016: { cite: 'Prša, A. et al. (2016). Nominal values for selected solar and planetary quantities: IAU 2015 Resolution B3. Astron. J. 152, 41', doi: '10.3847/0004-6256/152/2/41' },
  borexino2020: { cite: 'Borexino Collaboration (2020). Experimental evidence of neutrinos produced in the CNO fusion cycle in the Sun. Nature 587, 577-582', doi: '10.1038/s41586-020-2934-0' },
  park2016: { cite: 'Park, R. S. et al. (2016). A partially differentiated interior for (1) Ceres deduced from its gravity field and shape. Nature 537, 515-517', doi: '10.1038/nature18955' },
  ermakov2017: { cite: 'Ermakov, A. I. et al. (2017). Constraints on Ceres\' internal structure and evolution from its shape and gravity measured by the Dawn spacecraft. J. Geophys. Res. Planets 122, 2267-2293', doi: '10.1002/2017JE005302' },
  raymond2020: { cite: 'Raymond, C. A. et al. (2020). Impact-driven mobilization of deep crustal brines on dwarf planet Ceres. Nature Astronomy 4, 741-747', doi: '10.1038/s41550-020-1168-2' },
  nimmo2016: { cite: 'Nimmo, F. et al. (2016). Reorientation of Sputnik Planitia implies a subsurface ocean on Pluto. Nature 540, 94-96', doi: '10.1038/nature20148' },
  mckinnon2017: { cite: 'McKinnon, W. B. et al. (2017). Origin of the Pluto-Charon system: constraints from the New Horizons flyby (internal structure). Icarus 287, 2-11', doi: '10.1016/j.icarus.2016.11.019' },
  anderson2001io: { cite: 'Anderson, J. D. et al. (2001). Io\'s gravity field and interior structure. J. Geophys. Res. 106, 32963-32969', doi: '10.1029/2000JE001367' },
  khurana2011: { cite: 'Khurana, K. K. et al. (2011). Evidence of a global magma ocean in Io\'s interior. Science 332, 1186-1189', doi: '10.1126/science.1201425' },
  park2025: { cite: 'Park, R. S. et al. (2025). Io\'s tidal response precludes a shallow magma ocean. Nature 638, 69-73', doi: '10.1038/s41586-024-08442-5' },
  anderson1998: { cite: 'Anderson, J. D. et al. (1998). Europa\'s differentiated internal structure: inferences from four Galileo encounters. Science 281, 2019-2022', doi: '10.1126/science.281.5385.2019' },
  kivelson2000: { cite: 'Kivelson, M. G. et al. (2000). Galileo magnetometer measurements: a stronger case for a subsurface ocean at Europa. Science 289, 1340-1343', doi: '10.1126/science.289.5483.1340' },
  howell2021: { cite: 'Howell, S. M. (2021). The likely thickness of Europa\'s icy shell. Planet. Sci. J. 2, 129', doi: '10.3847/PSJ/abfe10' },
  anderson1996: { cite: 'Anderson, J. D. et al. (1996). Gravitational constraints on the internal structure of Ganymede. Nature 384, 541-543', doi: '10.1038/384541a0' },
  kivelson1996: { cite: 'Kivelson, M. G. et al. (1996). Discovery of Ganymede\'s magnetic field by the Galileo spacecraft. Nature 384, 537-541', doi: '10.1038/384537a0' },
  saur2015: { cite: 'Saur, J. et al. (2015). The search for a subsurface ocean in Ganymede with Hubble Space Telescope observations of its auroral ovals. J. Geophys. Res. Space Physics 120, 1715-1737', doi: '10.1002/2014JA020778' },
  vance2018: { cite: 'Vance, S. D. et al. (2018). Geophysical investigations of habitability in ice-covered ocean worlds. J. Geophys. Res. Planets 123, 180-205', doi: '10.1002/2017JE005341' },
  anderson2001callisto: { cite: 'Anderson, J. D. et al. (2001). Shape, mean radius, gravity field, and interior structure of Callisto. Icarus 153, 157-161', doi: '10.1006/icar.2001.6664' },
  zimmer2000: { cite: 'Zimmer, C., Khurana, K. K. & Kivelson, M. G. (2000). Subsurface oceans on Europa and Callisto: constraints from Galileo magnetometer observations. Icarus 147, 329-347', doi: '10.1006/icar.2000.6456' },
  iess2014: { cite: 'Iess, L. et al. (2014). The gravity field and interior structure of Enceladus. Science 344, 78-80', doi: '10.1126/science.1250551' },
  thomas2016: { cite: 'Thomas, P. C. et al. (2016). Enceladus\'s measured physical libration requires a global subsurface ocean. Icarus 264, 37-47', doi: '10.1016/j.icarus.2015.08.037' },
  cadek2016: { cite: 'Čadek, O. et al. (2016). Enceladus\'s internal ocean and ice shell constrained from Cassini gravity, shape, and libration data. Geophys. Res. Lett. 43, 5653-5660', doi: '10.1002/2016GL068634' },
  iess2010: { cite: 'Iess, L. et al. (2010). Gravity field, shape, and moment of inertia of Titan. Science 327, 1367-1369', doi: '10.1126/science.1182583' },
  iess2012: { cite: 'Iess, L. et al. (2012). The tides of Titan. Science 337, 457-459', doi: '10.1126/science.1219631' },
};

const ROCK = 'rock', CRUST = 'crust', METAL = 'metal', METALLIC_H = 'metallic-hydrogen', GAS = 'gas', ICE = 'ice',
  OCEAN = 'ocean', PLASMA = 'plasma', ICES = 'fluid-ices', MIXED = 'rock-ice', MELT = 'melt', DILUTE = 'dilute-core',
  PHOTOSPHERE = 'photosphere';

/** @typedef {{ id: string, name: string, outerKm: number, outerRangeKm?: [number, number], state: string, composition: string,
 *  densityKgM3: [number, number] | null, temperatureK: [number, number] | null, material: string, model: boolean,
 *  provenance: 'observed' | 'derived' | 'model', plain: string, sources: string[] }} Layer */

export const BODIES = [
  {
    body: 'sun', id: 'sol:sun', name: 'Sun', classification: 'G2 V main-sequence star', texture: null,
    lede: 'A ball of hot plasma that makes its own light. Energy made in the core takes over 100,000 years to reach the surface.',
    howWeKnow: [
      { method: 'Helioseismology', text: 'Millions of sound waves ring the Sun. Their frequencies, measured from Doppler shifts at the surface, map sound speed and rotation with depth. They put the base of the convection zone at 0.713 of the radius.', sources: ['basu1997', 'jcd1996'] },
      { method: 'Solar neutrinos', text: 'Neutrinos escape the core directly. Detectors such as Borexino count the ones from fusion, confirming the core temperature the models predict.', sources: ['borexino2020', 'bahcall2005'] },
    ],
    compareWith: 'jupiter',
    layers: [
      { id: 'core', name: 'Core', outerKm: 173925, outerRangeKm: [139140, 194800], state: 'Plasma', composition: 'Hydrogen fusing into helium (about two-thirds helium by mass at the centre)', densityKgM3: [20000, 150000], temperatureK: [7000000, 15700000], material: PLASMA, model: true, provenance: 'model', plain: 'Where the Sun\'s energy is made. Every second about 600 million tonnes of hydrogen fuse into helium here.', sources: ['bahcall2005', 'jcd1996', 'borexino2020'] },
      { id: 'radiative', name: 'Radiative zone', outerKm: 468900, outerRangeKm: [462000, 475000], state: 'Plasma', composition: 'Hydrogen and helium plasma', densityKgM3: [200, 20000], temperatureK: [2000000, 7000000], material: PLASMA, model: true, provenance: 'model', plain: 'Energy creeps outward as light that is absorbed and re-emitted again and again. This random walk is what makes the journey so slow.', sources: ['jcd1996', 'charbonneau1999'] },
      { id: 'tachocline', name: 'Tachocline', outerKm: 496000, outerRangeKm: [495300, 496700], state: 'Plasma', composition: 'Hydrogen and helium plasma', densityKgM3: [150, 250], temperatureK: [1900000, 2300000], material: PLASMA, model: false, provenance: 'observed', plain: 'A thin shear layer where the solidly rotating interior meets the convection zone, whose equator spins faster than its poles. It is thought to help drive the Sun\'s magnetic cycle.', sources: ['charbonneau1999', 'basu1997'] },
      { id: 'convective', name: 'Convection zone', outerKm: 695200, outerRangeKm: [695100, 695300], state: 'Plasma', composition: 'Hydrogen and helium plasma', densityKgM3: [0.0002, 200], temperatureK: [5800, 2000000], material: PLASMA, model: false, provenance: 'observed', plain: 'Here the gas boils. Hot plumes rise, cool and sink, carrying energy to the surface in about a week to a month.', sources: ['basu1997', 'jcd1996'] },
      { id: 'photosphere', name: 'Photosphere', outerKm: 695700, state: 'Plasma (thin gas)', composition: 'Hydrogen and helium; the layer that emits the light we see', densityKgM3: [0.00002, 0.0003], temperatureK: [4400, 6400], material: PHOTOSPHERE, model: false, provenance: 'observed', plain: 'The visible surface, about 500 km deep. Its effective temperature is 5772 K. The granules are the tops of convection cells.', sources: ['prsa2016', 'jcd1996'] },
    ],
  },
  {
    body: 'mercury', id: 'sol:mercury', name: 'Mercury', classification: 'Terrestrial planet', texture: 'mercury',
    lede: 'A small planet with a giant metal core that fills about 83% of its radius.',
    howWeKnow: [
      { method: 'Gravity and spin', text: 'MESSENGER tracked how Mercury\'s gravity pulls on the spacecraft and how much the planet wobbles (librates). Together they give the moment of inertia and the size of the core.', sources: ['hauck2013', 'genova2019'] },
      { method: 'Magnetic field', text: 'Mercury has a weak global magnetic field, so part of its core must still be liquid metal.', sources: ['hauck2013'] },
    ],
    compareWith: 'earth',
    layers: [
      { id: 'inner-core', name: 'Solid inner core', outerKm: 1000, outerRangeKm: [600, 1400], state: 'Solid', composition: 'Iron-nickel alloy', densityKgM3: [7500, 9500], temperatureK: [1800, 2300], material: METAL, model: true, provenance: 'model', plain: 'Gravity data from MESSENGER show a solid inner core, but its exact size is still uncertain.', sources: ['genova2019'] },
      { id: 'outer-core', name: 'Liquid outer core', outerKm: 2024, outerRangeKm: [1999, 2049], state: 'Liquid', composition: 'Iron with silicon and sulfur', densityKgM3: [6700, 7500], temperatureK: [1700, 2100], material: METAL, model: false, provenance: 'derived', plain: 'Swirling liquid metal makes Mercury\'s magnetic field.', sources: ['genova2019', 'hauck2013'] },
      { id: 'mantle', name: 'Mantle', outerKm: 2404, outerRangeKm: [2386, 2422], state: 'Solid', composition: 'Silicate rock', densityKgM3: [3200, 3600], temperatureK: [700, 1700], material: ROCK, model: true, provenance: 'model', plain: 'A thin rocky mantle, only about 380 km thick.', sources: ['hauck2013'] },
      { id: 'crust', name: 'Crust', outerKm: 2439.4, state: 'Solid', composition: 'Silicate rock, low in iron', densityKgM3: [2800, 3100], temperatureK: [100, 700], material: CRUST, model: true, provenance: 'derived', plain: 'About 35 km thick on average (models span 17 to 53 km).', sources: ['padovan2015'] },
    ],
  },
  {
    body: 'venus', id: 'sol:venus', name: 'Venus', classification: 'Terrestrial planet', texture: 'venus',
    lede: 'Earth\'s near twin in size. No spacecraft has measured its interior directly, so its layers come from models.',
    howWeKnow: [
      { method: 'Spin and moment of inertia', text: 'Radar echoes from Earth timed Venus\'s slow spin and wobble, giving the first moment of inertia (0.337 ± 0.024). It implies an iron core about 3500 km in radius, with large uncertainty.', sources: ['margot2021'] },
      { method: 'Gravity and topography', text: 'Magellan mapped gravity and topography. Comparing them constrains the thickness of the crust.', sources: ['james2013'] },
    ],
    uncertainty: 'Model-based: Venus has no seismic or detailed tidal data yet. Whether its core is liquid or has a solid inner part is unknown.',
    compareWith: 'earth',
    layers: [
      { id: 'core', name: 'Iron core', outerKm: 3500, outerRangeKm: [3000, 4000], state: 'Unknown (probably liquid)', composition: 'Iron-nickel with lighter elements', densityKgM3: [9500, 12500], temperatureK: [4000, 6000], material: METAL, model: true, provenance: 'model', plain: 'Probably similar to Earth\'s core, but Venus has no magnetic field, so the core may not be convecting.', sources: ['margot2021'] },
      { id: 'mantle', name: 'Mantle', outerKm: 6031.8, outerRangeKm: [6001.8, 6043.8], state: 'Solid', composition: 'Silicate rock', densityKgM3: [3300, 5500], temperatureK: [1000, 4000], material: ROCK, model: true, provenance: 'model', plain: 'A rocky mantle like Earth\'s. Hot plumes may still rise through it and feed volcanoes.', sources: ['margot2021'] },
      { id: 'crust', name: 'Crust', outerKm: 6051.8, state: 'Solid', composition: 'Basaltic rock', densityKgM3: [2800, 3000], temperatureK: [740, 1100], material: CRUST, model: true, provenance: 'model', plain: 'Basalt crust about 8 to 50 km thick. The surface itself is 740 K, hot enough to melt lead.', sources: ['james2013'] },
    ],
  },
  {
    body: 'earth', id: 'sol:earth', name: 'Earth', classification: 'Terrestrial planet', texture: 'earth',
    lede: 'The best-known interior in the universe, mapped by the earthquake waves that pass through it.',
    howWeKnow: [
      { method: 'Seismology', text: 'Earthquake waves speed up, slow down and bend at each boundary. S waves cannot cross the liquid outer core, which casts a shadow on the far side of the planet. PREM is the reference model built from these travel times.', sources: ['prem'] },
      { method: 'Mineral physics', text: 'Laboratory experiments squeeze iron to core pressures. The melting point at the inner-core boundary gives its temperature, about 6200 K.', sources: ['anzellini2013'] },
    ],
    compareWith: 'mars',
    layers: [
      { id: 'inner-core', name: 'Inner core', outerKm: 1221.5, state: 'Solid', composition: 'Iron-nickel alloy', densityKgM3: [12760, 13090], temperatureK: [5700, 6500], material: METAL, model: false, provenance: 'observed', plain: 'A ball of solid metal as hot as the Sun\'s surface. It stays solid because the pressure is over 3 million times that at the surface.', sources: ['prem', 'anzellini2013'] },
      { id: 'outer-core', name: 'Outer core', outerKm: 3480, state: 'Liquid', composition: 'Liquid iron-nickel with light elements', densityKgM3: [9900, 12170], temperatureK: [3800, 6200], material: METAL, model: false, provenance: 'observed', plain: 'Flowing liquid metal. Its currents generate Earth\'s magnetic field.', sources: ['prem', 'anzellini2013'] },
      { id: 'd-double-prime', name: 'D″ layer', outerKm: 3630, outerRangeKm: [3530, 3780], state: 'Solid', composition: 'Silicate rock, including post-perovskite', densityKgM3: [5400, 5570], temperatureK: [2600, 4000], material: ROCK, model: false, provenance: 'observed', plain: 'The bottom few hundred km of the mantle, where heat flows out of the core.', sources: ['prem', 'lay2008'] },
      { id: 'lower-mantle', name: 'Lower mantle', outerKm: 5701, state: 'Solid', composition: 'Bridgmanite and ferropericlase', densityKgM3: [4380, 5400], temperatureK: [1900, 2600], material: ROCK, model: false, provenance: 'observed', plain: 'Solid rock that still creeps a few centimetres a year, slowly stirring the planet.', sources: ['prem'] },
      { id: 'upper-mantle', name: 'Upper mantle', outerKm: 6346.6, state: 'Solid (slowly flowing)', composition: 'Peridotite: olivine and pyroxene', densityKgM3: [3380, 3990], temperatureK: [600, 1900], material: ROCK, model: false, provenance: 'observed', plain: 'The tectonic plates ride on its softer upper part, the asthenosphere.', sources: ['prem'] },
      { id: 'crust', name: 'Crust', outerKm: 6371.0, state: 'Solid', composition: 'Granite (continents) and basalt (ocean floor)', densityKgM3: [2600, 2900], temperatureK: [288, 1000], material: CRUST, model: false, provenance: 'observed', plain: 'The thin rocky skin we live on: 5 to 10 km under the oceans and 30 to 70 km under the continents.', sources: ['prem'] },
    ],
  },
  {
    body: 'moon', id: 'sol:moon', name: 'Moon', classification: 'Natural satellite of Earth', texture: 'moon',
    lede: 'Apollo seismometers still tell us about the Moon\'s small iron core, decades after the astronauts left.',
    howWeKnow: [
      { method: 'Seismology', text: 'Apollo astronauts left seismometers that recorded moonquakes until 1977. Reprocessed records reveal reflections from a solid inner core and a liquid outer core.', sources: ['weber2011'] },
      { method: 'Gravity (GRAIL)', text: 'The twin GRAIL spacecraft mapped the Moon\'s gravity in detail, giving the crust\'s thickness and density.', sources: ['wieczorek2013', 'briaud2023'] },
    ],
    compareWith: 'earth',
    layers: [
      { id: 'inner-core', name: 'Solid inner core', outerKm: 240, outerRangeKm: [218, 298], state: 'Solid', composition: 'Iron', densityKgM3: [7800, 8200], temperatureK: [1600, 1800], material: METAL, model: false, provenance: 'derived', plain: 'A ball of iron about 480 km across. A 2023 study combining gravity and laser ranging found a similar size.', sources: ['weber2011', 'briaud2023'] },
      { id: 'outer-core', name: 'Liquid outer core', outerKm: 330, outerRangeKm: [310, 350], state: 'Liquid', composition: 'Liquid iron with sulfur', densityKgM3: [5000, 5200], temperatureK: [1600, 1800], material: METAL, model: false, provenance: 'derived', plain: 'Still partly molten, but no longer strong enough to make a magnetic field.', sources: ['weber2011'] },
      { id: 'melt-layer', name: 'Partially molten layer', outerKm: 480, outerRangeKm: [460, 500], state: 'Partly molten', composition: 'Silicate rock with a little melt', densityKgM3: [3300, 3500], temperatureK: [1600, 1700], material: MELT, model: false, provenance: 'derived', plain: 'A slushy layer at the base of the mantle.', sources: ['weber2011'] },
      { id: 'mantle', name: 'Mantle', outerKm: 1699, outerRangeKm: [1694, 1703], state: 'Solid', composition: 'Silicate rock: olivine and pyroxene', densityKgM3: [3300, 3400], temperatureK: [250, 1600], material: ROCK, model: true, provenance: 'model', plain: 'Solid rock. The dark maria on the near side are lava that rose from it billions of years ago.', sources: ['weber2011'] },
      { id: 'crust', name: 'Crust', outerKm: 1737.4, state: 'Solid', composition: 'Anorthosite (light, aluminium-rich rock)', densityKgM3: [2500, 2600], temperatureK: [100, 400], material: CRUST, model: false, provenance: 'derived', plain: 'On average 34 to 43 km thick, thicker on the far side.', sources: ['wieczorek2013'] },
    ],
  },
  {
    body: 'mars', id: 'sol:mars', name: 'Mars', classification: 'Terrestrial planet', texture: 'mars',
    lede: 'InSight listened to marsquakes for four years and measured the crust and core of another planet for the first time.',
    howWeKnow: [
      { method: 'Seismology (InSight)', text: 'Marsquake waves reflected off the crust layers and the core. The first analysis put the core edge at 1830 km.', sources: ['knapmeyer2021', 'stahler2021'] },
      { method: 'Re-analysis, 2023', text: 'Waves that crossed the core showed a molten rock layer about 150 km thick sitting on top of it. The liquid iron core is then smaller, about 1650 km, and denser.', sources: ['khan2023', 'samuel2023'] },
    ],
    compareWith: 'earth',
    layers: [
      { id: 'core', name: 'Liquid core', outerKm: 1650, outerRangeKm: [1630, 1675], state: 'Liquid', composition: 'Iron with sulfur, oxygen, carbon and hydrogen', densityKgM3: [6000, 6700], temperatureK: [2000, 2400], material: METAL, model: false, provenance: 'derived', plain: 'Liquid iron rich in lighter elements. With no dynamo today, Mars lost its global magnetic field long ago.', sources: ['khan2023', 'samuel2023', 'stahler2021'] },
      { id: 'molten-silicate', name: 'Molten silicate layer', outerKm: 1830, outerRangeKm: [1790, 1870], state: 'Liquid', composition: 'Molten iron-rich silicate rock', densityKgM3: [4000, 4300], temperatureK: [1900, 2100], material: MELT, model: true, provenance: 'model', plain: 'A layer of melted rock wrapped around the core. In 2021 its top was taken to be the core\'s surface.', sources: ['khan2023', 'samuel2023'] },
      { id: 'mantle', name: 'Mantle', outerKm: 3345, outerRangeKm: [3318, 3366], state: 'Solid', composition: 'Iron-rich silicate rock', densityKgM3: [3300, 4000], temperatureK: [500, 1900], material: ROCK, model: true, provenance: 'model', plain: 'Solid rock that fed giant volcanoes such as Olympus Mons.', sources: ['khan2023', 'knapmeyer2021'] },
      { id: 'crust', name: 'Crust', outerKm: 3389.5, state: 'Solid', composition: 'Basaltic rock', densityKgM3: [2600, 3100], temperatureK: [210, 500], material: CRUST, model: false, provenance: 'derived', plain: 'Between 24 and 72 km thick on average, measured from marsquake echoes.', sources: ['knapmeyer2021'] },
    ],
  },
  {
    body: 'jupiter', id: 'sol:jupiter', name: 'Jupiter', classification: 'Gas giant', texture: 'jupiter',
    lede: 'No solid surface: the gas gets denser with depth until hydrogen turns into a liquid metal. Juno found the core is fuzzy, not a hard ball.',
    howWeKnow: [
      { method: 'Gravity field (Juno)', text: 'Juno measured tiny ripples in Jupiter\'s gravity. Only models with heavy elements spread through a large dilute core fit them.', sources: ['wahl2017', 'militzer2022'] },
      { method: 'Physics of hydrogen', text: 'Experiments and quantum simulations show that hydrogen becomes an electrical conductor at about 1 to 2 million times Earth\'s air pressure.', sources: ['guillot2005'] },
    ],
    compareWith: 'earth',
    layers: [
      { id: 'dilute-core', name: 'Dilute core', outerKm: 41950, outerRangeKm: [20970, 48940], state: 'Fluid', composition: 'Rock and ice dissolved in metallic hydrogen', densityKgM3: [3000, 5000], temperatureK: [15000, 25000], material: DILUTE, model: true, provenance: 'model', plain: 'Heavy elements spread out over up to half or more of the radius instead of sitting in a small rocky ball.', sources: ['militzer2022', 'wahl2017'] },
      { id: 'metallic-hydrogen', name: 'Metallic hydrogen', outerKm: 55930, outerRangeKm: [52430, 62920], state: 'Liquid metal', composition: 'Hydrogen and helium', densityKgM3: [1000, 3000], temperatureK: [6000, 15000], material: METALLIC_H, model: true, provenance: 'model', plain: 'Hydrogen squeezed until it conducts electricity like a metal. Its flow powers the strongest magnetic field of any planet.', sources: ['guillot2005', 'militzer2022'] },
      { id: 'molecular', name: 'Molecular envelope', outerKm: 69911, state: 'Gas becoming supercritical fluid', composition: 'Molecular hydrogen and helium, with ammonia and water clouds near the top', densityKgM3: [0.16, 1000], temperatureK: [165, 6000], material: GAS, model: true, provenance: 'model', plain: 'The outer layer, whose colourful cloud bands are all we can see.', sources: ['guillot2005'] },
    ],
  },
  {
    body: 'saturn', id: 'sol:saturn', name: 'Saturn', classification: 'Gas giant', texture: 'saturn',
    lede: 'Saturn\'s rings act as a seismometer: waves inside the planet tug on ring particles and reveal a large diffuse core.',
    howWeKnow: [
      { method: 'Ring seismology', text: 'Oscillations inside Saturn shift its gravity slightly. Cassini saw the patterns they carve into the C ring.', sources: ['hedman2013', 'mankovich2021'] },
      { method: 'Gravity field (Cassini Grand Finale)', text: 'Cassini dived between the planet and the rings in 2017 and measured the gravity field precisely.', sources: ['mankovich2021'] },
    ],
    compareWith: 'earth',
    layers: [
      { id: 'diffuse-core', name: 'Diffuse core', outerKm: 34940, outerRangeKm: [32030, 37850], state: 'Fluid, stably layered', composition: 'Rock and ice (about 17 Earth masses) mixed with hydrogen and helium', densityKgM3: [2500, 9000], temperatureK: [8000, 12000], material: DILUTE, model: true, provenance: 'model', plain: 'A gradual mix of heavy elements that reaches about 60% of the way out.', sources: ['mankovich2021'] },
      { id: 'metallic-hydrogen', name: 'Metallic hydrogen', outerKm: 40760, outerRangeKm: [36100, 43670], state: 'Liquid metal', composition: 'Hydrogen and helium; helium may rain out here', densityKgM3: [800, 2500], temperatureK: [5500, 8000], material: METALLIC_H, model: true, provenance: 'model', plain: 'A shell of metallic hydrogen generates Saturn\'s magnetic field.', sources: ['guillot2005', 'mankovich2021'] },
      { id: 'molecular', name: 'Molecular envelope', outerKm: 58232, state: 'Gas becoming supercritical fluid', composition: 'Molecular hydrogen and helium with ammonia clouds', densityKgM3: [0.19, 800], temperatureK: [134, 5500], material: GAS, model: true, provenance: 'model', plain: 'Saturn is so light overall that it would float in a big enough bath of water.', sources: ['guillot2005'] },
    ],
  },
  {
    body: 'uranus', id: 'sol:uranus', name: 'Uranus', classification: 'Ice giant', texture: 'uranus',
    lede: 'An ice giant: most of its mass is a hot, dense fluid of water, ammonia and methane, not frozen ice.',
    howWeKnow: [
      { method: 'Gravity and shape', text: 'Only Voyager 2 has visited, in 1986. Its gravity data and ring-orbit precession allow many interior models.', sources: ['nettelmann2013', 'helled2020'] },
      { method: 'Magnetic field', text: 'The field is tilted and off-centre, so it is likely made in a thin conducting shell of ionic water, not a deep core.', sources: ['helled2020'] },
    ],
    uncertainty: 'Layer boundaries differ widely between models; the layers may also blend gradually.',
    compareWith: 'neptune',
    layers: [
      { id: 'core', name: 'Rocky core', outerKm: 5070, outerRangeKm: [2540, 7610], state: 'Solid or fluid', composition: 'Rock and iron', densityKgM3: [6000, 10000], temperatureK: [5000, 8000], material: ROCK, model: true, provenance: 'model', plain: 'A rocky centre perhaps the size of Earth or smaller.', sources: ['nettelmann2013', 'helled2020'] },
      { id: 'ices', name: 'Icy mantle', outerKm: 19020, outerRangeKm: [17750, 21560], state: 'Hot dense fluid; possibly superionic', composition: 'Water, ammonia and methane', densityKgM3: [1500, 4000], temperatureK: [2000, 5000], material: ICES, model: true, provenance: 'model', plain: 'The "ices" are hot fluids under enormous pressure. Water may even become superionic.', sources: ['nettelmann2013', 'helled2020'] },
      { id: 'envelope', name: 'Hydrogen-helium envelope', outerKm: 25362, state: 'Gas', composition: 'Hydrogen, helium and methane (the methane gives the cyan colour)', densityKgM3: [0.42, 1000], temperatureK: [76, 2000], material: GAS, model: true, provenance: 'model', plain: 'A deep atmosphere that blends into the icy mantle below.', sources: ['nettelmann2013'] },
    ],
  },
  {
    body: 'neptune', id: 'sol:neptune', name: 'Neptune', classification: 'Ice giant', texture: 'neptune',
    lede: 'Uranus\'s near twin in size, but with a hot interior that drives the fastest winds in the Solar System.',
    howWeKnow: [
      { method: 'Gravity and shape', text: 'Voyager 2 flew past in 1989. Its gravity data, with the planet\'s shape, constrain models of the layers.', sources: ['nettelmann2013', 'helled2020'] },
    ],
    uncertainty: 'Layer boundaries differ widely between models; the layers may also blend gradually.',
    compareWith: 'uranus',
    layers: [
      { id: 'core', name: 'Rocky core', outerKm: 6160, outerRangeKm: [2460, 7390], state: 'Solid or fluid', composition: 'Rock and iron', densityKgM3: [6000, 10000], temperatureK: [5000, 8000], material: ROCK, model: true, provenance: 'model', plain: 'A rocky centre perhaps about Earth\'s size.', sources: ['nettelmann2013', 'helled2020'] },
      { id: 'ices', name: 'Icy mantle', outerKm: 20930, outerRangeKm: [19700, 22160], state: 'Hot dense fluid; possibly superionic', composition: 'Water, ammonia and methane', densityKgM3: [1500, 4000], temperatureK: [2000, 5000], material: ICES, model: true, provenance: 'model', plain: 'Most of Neptune\'s mass is this hot, electrically conducting fluid, which makes its magnetic field.', sources: ['nettelmann2013', 'helled2020'] },
      { id: 'envelope', name: 'Hydrogen-helium envelope', outerKm: 24622, state: 'Gas', composition: 'Hydrogen, helium and methane', densityKgM3: [0.45, 1000], temperatureK: [72, 2000], material: GAS, model: true, provenance: 'model', plain: 'Methane absorbs red light and gives Neptune its blue colour.', sources: ['nettelmann2013'] },
    ],
  },
  {
    body: 'ceres', id: 'sol:ceres', name: 'Ceres', classification: 'Dwarf planet', texture: 'ceres',
    lede: 'The largest body in the asteroid belt has a muddy, salty interior with pockets of brine.',
    howWeKnow: [
      { method: 'Gravity and shape (Dawn)', text: 'Dawn orbited Ceres from 2015 to 2018. Its gravity field shows a light crust over a denser, water-rich rocky mantle.', sources: ['park2016', 'ermakov2017'] },
      { method: 'Bright salt deposits', text: 'Salts in Occator crater came up from a deep brine reservoir.', sources: ['raymond2020'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'mantle', name: 'Rocky mantle', outerKm: 428.7, outerRangeKm: [424, 432], state: 'Solid, partly hydrated', composition: 'Hydrated rock with salty brine near the top', densityKgM3: [2350, 2500], temperatureK: [180, 270], material: ROCK, model: true, provenance: 'model', plain: 'Rock altered by water. A layer of brine may still sit at its top.', sources: ['park2016', 'ermakov2017', 'raymond2020'] },
      { id: 'crust', name: 'Crust', outerKm: 469.7, state: 'Solid', composition: 'Ice, salts, clays and hydrates', densityKgM3: [1200, 1350], temperatureK: [110, 240], material: MIXED, model: true, provenance: 'derived', plain: 'About 41 km thick and lighter than rock: a frozen mix of ice, salts and clay.', sources: ['ermakov2017'] },
    ],
  },
  {
    body: 'pluto', id: 'sol:pluto', name: 'Pluto', classification: 'Dwarf planet', texture: 'pluto',
    lede: 'Beneath Pluto\'s nitrogen glaciers there is probably an ocean of liquid water.',
    howWeKnow: [
      { method: 'Density and shape (New Horizons)', text: 'Pluto\'s size and mass give a mean density of 1854 kg/m³: about two-thirds rock and one-third ice.', sources: ['mckinnon2017'] },
      { method: 'Sputnik Planitia', text: 'The giant ice-filled basin sits almost exactly opposite Charon. That is easiest to explain if a dense ocean lies beneath it.', sources: ['nimmo2016'] },
    ],
    uncertainty: 'The ocean is inferred, not observed directly; its thickness is a model estimate.',
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Rocky core', outerKm: 850, outerRangeKm: [800, 900], state: 'Solid', composition: 'Silicate rock', densityKgM3: [2800, 3200], temperatureK: [400, 1000], material: ROCK, model: true, provenance: 'model', plain: 'A rocky core about 1700 km across.', sources: ['mckinnon2017'] },
      { id: 'ocean', name: 'Subsurface ocean', outerKm: 1000, outerRangeKm: [950, 1050], state: 'Liquid', composition: 'Salty water, possibly with ammonia', densityKgM3: [1000, 1100], temperatureK: [255, 273], material: OCEAN, model: true, provenance: 'model', plain: 'An ocean perhaps more than 100 km deep, kept liquid by heat from the rocky core.', sources: ['nimmo2016', 'mckinnon2017'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 1188.3, state: 'Solid', composition: 'Water ice under nitrogen, methane and carbon monoxide ices', densityKgM3: [920, 1000], temperatureK: [40, 255], material: ICE, model: true, provenance: 'model', plain: 'A thick shell of water ice, hard as rock at −230 °C.', sources: ['mckinnon2017', 'nimmo2016'] },
    ],
  },
  {
    body: 'io', id: 'sol:io', name: 'Io', classification: 'Moon of Jupiter', texture: 'io',
    lede: 'The most volcanic world known. Tides from Jupiter knead its interior and keep it hot.',
    howWeKnow: [
      { method: 'Gravity (Galileo)', text: 'Galileo\'s flybys showed an iron core and a rocky mantle.', sources: ['anderson2001io'] },
      { method: 'Magnetic induction and tides', text: 'Galileo saw a magnetic signal suggesting a partly molten layer. In 2024 Juno measured how much Io flexes and ruled out a shallow, fully liquid magma ocean.', sources: ['khurana2011', 'park2025'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Iron core', outerKm: 800, outerRangeKm: [650, 950], state: 'Probably liquid', composition: 'Iron and iron sulfide', densityKgM3: [5150, 8000], temperatureK: [1600, 2000], material: METAL, model: true, provenance: 'derived', plain: 'Its size depends on how much sulfur it holds: 650 km for pure iron, 950 km for iron sulfide.', sources: ['anderson2001io'] },
      { id: 'mantle', name: 'Mantle', outerKm: 1720, outerRangeKm: [1690, 1760], state: 'Solid', composition: 'Silicate rock', densityKgM3: [3200, 3400], temperatureK: [1400, 1700], material: ROCK, model: true, provenance: 'model', plain: 'Hot rock heated by tides, not by radioactivity alone.', sources: ['anderson2001io', 'park2025'] },
      { id: 'melt-layer', name: 'Partially molten layer', outerKm: 1780, outerRangeKm: [1760, 1795], state: 'Partly molten', composition: 'Silicate rock with some melt', densityKgM3: [3000, 3300], temperatureK: [1400, 1600], material: MELT, model: true, provenance: 'model', plain: 'Rock with pockets of magma that feed more than 400 active volcanoes.', sources: ['khurana2011', 'park2025'] },
      { id: 'crust', name: 'Crust', outerKm: 1821.5, state: 'Solid', composition: 'Silicate lava and sulfur compounds', densityKgM3: [2900, 3200], temperatureK: [110, 1400], material: CRUST, model: true, provenance: 'model', plain: 'A rigid lid a few tens of km thick, constantly resurfaced by lava.', sources: ['khurana2011'] },
    ],
  },
  {
    body: 'europa', id: 'sol:europa', name: 'Europa', classification: 'Moon of Jupiter', texture: 'europa',
    lede: 'A global ocean with about twice the water of all Earth\'s oceans lies under Europa\'s ice.',
    howWeKnow: [
      { method: 'Gravity (Galileo)', text: 'Galileo\'s flybys showed a dense centre and a water layer about 80 to 170 km thick on top.', sources: ['anderson1998'] },
      { method: 'Magnetic induction', text: 'Jupiter\'s changing field induces a magnetic signal in Europa. Only a salty, electrically conducting ocean explains it.', sources: ['kivelson2000'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Iron core', outerKm: 600, outerRangeKm: [400, 700], state: 'Solid or liquid', composition: 'Iron and iron sulfide', densityKgM3: [5150, 8000], temperatureK: [1000, 1700], material: METAL, model: true, provenance: 'model', plain: 'A metal core probably 800 to 1400 km across.', sources: ['anderson1998'] },
      { id: 'mantle', name: 'Rocky mantle', outerKm: 1430, outerRangeKm: [1390, 1480], state: 'Solid', composition: 'Silicate rock', densityKgM3: [3000, 3500], temperatureK: [300, 1000], material: ROCK, model: true, provenance: 'model', plain: 'If the seafloor is volcanically active, it could supply chemical energy for life.', sources: ['anderson1998', 'vance2018'] },
      { id: 'ocean', name: 'Ocean', outerKm: 1536, outerRangeKm: [1520, 1557], state: 'Liquid', composition: 'Salty water', densityKgM3: [1000, 1100], temperatureK: [260, 273], material: OCEAN, model: true, provenance: 'derived', plain: 'Perhaps about 100 km deep, ten times deeper than Earth\'s deepest trench.', sources: ['kivelson2000', 'anderson1998'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 1560.8, state: 'Solid', composition: 'Water ice', densityKgM3: [920, 940], temperatureK: [100, 260], material: ICE, model: true, provenance: 'model', plain: 'Probably more than 20 km thick (estimates range from a few km to about 40 km).', sources: ['howell2021'] },
    ],
  },
  {
    body: 'ganymede', id: 'sol:ganymede', name: 'Ganymede', classification: 'Moon of Jupiter', texture: 'ganymede',
    lede: 'The largest moon in the Solar System is the only one with its own magnetic field, and it hides a salty ocean.',
    howWeKnow: [
      { method: 'Gravity and magnetic field', text: 'Galileo found that Ganymede is fully separated into layers and makes its own magnetic field, so it has a liquid iron core.', sources: ['anderson1996', 'kivelson1996'] },
      { method: 'Aurora (Hubble)', text: 'Ganymede\'s aurorae rock back and forth less than expected. A salty ocean under the ice dampens the motion.', sources: ['saur2015'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Iron core', outerKm: 700, outerRangeKm: [500, 900], state: 'Liquid (at least the outer part)', composition: 'Iron and iron sulfide', densityKgM3: [5150, 8000], temperatureK: [1500, 1900], material: METAL, model: true, provenance: 'model', plain: 'A liquid metal core that makes the moon\'s own magnetic field.', sources: ['anderson1996', 'kivelson1996'] },
      { id: 'mantle', name: 'Rocky mantle', outerKm: 1820, outerRangeKm: [1700, 1900], state: 'Solid', composition: 'Silicate rock', densityKgM3: [3000, 3600], temperatureK: [300, 1500], material: ROCK, model: true, provenance: 'model', plain: 'A rocky layer under hundreds of km of water and ice.', sources: ['anderson1996', 'vance2018'] },
      { id: 'hp-ice', name: 'High-pressure ice', outerKm: 2330, outerRangeKm: [2200, 2430], state: 'Solid', composition: 'Dense ice phases (ice V and VI)', densityKgM3: [1200, 1400], temperatureK: [260, 300], material: ICE, model: true, provenance: 'model', plain: 'Ice so compressed that it is denser than water and sinks.', sources: ['vance2018'] },
      { id: 'ocean', name: 'Ocean', outerKm: 2480, outerRangeKm: [2430, 2530], state: 'Liquid', composition: 'Salty water', densityKgM3: [1000, 1200], temperatureK: [250, 270], material: OCEAN, model: true, provenance: 'derived', plain: 'A salty ocean sandwiched between two layers of ice.', sources: ['saur2015', 'vance2018'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 2631.2, state: 'Solid', composition: 'Water ice (ice I)', densityKgM3: [920, 940], temperatureK: [110, 250], material: ICE, model: true, provenance: 'model', plain: 'An outer shell of ordinary ice about 150 km thick.', sources: ['saur2015', 'vance2018'] },
    ],
  },
  {
    body: 'callisto', id: 'sol:callisto', name: 'Callisto', classification: 'Moon of Jupiter', texture: 'callisto',
    lede: 'Callisto\'s rock and ice never fully separated, yet it may still hide a thin ocean.',
    howWeKnow: [
      { method: 'Gravity (Galileo)', text: 'Callisto\'s moment of inertia, 0.355, is too high for a fully layered body: rock and ice are only partly separated.', sources: ['anderson2001callisto'] },
      { method: 'Magnetic induction', text: 'Galileo detected an induced magnetic signal consistent with a salty ocean, though Callisto\'s ionosphere may contribute too.', sources: ['zimmer2000'] },
    ],
    uncertainty: 'The ocean is debated, and the boundary between the rock-ice interior and the ice is gradual.',
    compareWith: 'moon',
    layers: [
      { id: 'interior', name: 'Rock-ice interior', outerKm: 2150, outerRangeKm: [2050, 2250], state: 'Solid', composition: 'Mixed rock and ice, rockier towards the centre', densityKgM3: [1900, 3200], temperatureK: [250, 600], material: MIXED, model: true, provenance: 'model', plain: 'A mixture of rock and ice that only partly separated.', sources: ['anderson2001callisto'] },
      { id: 'ocean', name: 'Possible ocean', outerKm: 2260, outerRangeKm: [2200, 2300], state: 'Liquid (if present)', composition: 'Salty water', densityKgM3: [1000, 1200], temperatureK: [250, 270], material: OCEAN, model: true, provenance: 'model', plain: 'A layer of salty water could exist here. It is not certain.', sources: ['zimmer2000'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 2410.3, state: 'Solid', composition: 'Water ice and dark dust', densityKgM3: [920, 1000], temperatureK: [80, 250], material: ICE, model: true, provenance: 'model', plain: 'An ancient, heavily cratered crust of ice more than 100 km thick.', sources: ['zimmer2000', 'anderson2001callisto'] },
    ],
  },
  {
    body: 'enceladus', id: 'sol:enceladus', name: 'Enceladus', classification: 'Moon of Saturn', texture: 'enceladus',
    lede: 'A small moon with a global ocean that sprays out into space through cracks at its south pole.',
    howWeKnow: [
      { method: 'Gravity (Cassini)', text: 'Cassini flybys showed a light rocky core and dense water beneath the south pole.', sources: ['iess2014'] },
      { method: 'Libration', text: 'Enceladus wobbles too much for its ice to be attached to the core. The ice must float on a global ocean.', sources: ['thomas2016', 'cadek2016'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Porous rocky core', outerKm: 190, outerRangeKm: [185, 205], state: 'Solid, porous', composition: 'Rock soaked with water', densityKgM3: [2300, 2500], temperatureK: [273, 400], material: ROCK, model: true, provenance: 'model', plain: 'A loose, water-filled rocky core where tides create heat.', sources: ['iess2014', 'cadek2016'] },
      { id: 'ocean', name: 'Ocean', outerKm: 231, outerRangeKm: [228, 235], state: 'Liquid', composition: 'Salty water with silica, hydrogen and organic molecules', densityKgM3: [1000, 1040], temperatureK: [273, 275], material: OCEAN, model: true, provenance: 'derived', plain: 'Cassini flew through the plumes and tasted salts, silica and organic molecules from this ocean.', sources: ['thomas2016', 'cadek2016'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 252.1, state: 'Solid', composition: 'Water ice', densityKgM3: [920, 940], temperatureK: [70, 273], material: ICE, model: true, provenance: 'model', plain: 'About 20 km thick on average, but only a few km at the south pole where the jets erupt.', sources: ['cadek2016'] },
    ],
  },
  {
    body: 'titan', id: 'sol:titan', name: 'Titan', classification: 'Moon of Saturn', texture: 'titan',
    lede: 'Titan has rain and lakes of methane on top and a salty water ocean below.',
    howWeKnow: [
      { method: 'Gravity (Cassini)', text: 'Titan\'s moment of inertia, about 0.34, shows rock and ice only partly separated.', sources: ['iess2010'] },
      { method: 'Tides', text: 'Saturn\'s pull raises tides on Titan about 10 m high, far more than solid ice allows. A liquid ocean must lie under the ice.', sources: ['iess2012'] },
    ],
    compareWith: 'moon',
    layers: [
      { id: 'core', name: 'Rocky core', outerKm: 2050, outerRangeKm: [1950, 2150], state: 'Solid', composition: 'Hydrated silicate rock', densityKgM3: [2500, 2700], temperatureK: [300, 900], material: ROCK, model: true, provenance: 'model', plain: 'A rock core that may still contain water in its minerals.', sources: ['iess2010', 'vance2018'] },
      { id: 'hp-ice', name: 'High-pressure ice', outerKm: 2250, outerRangeKm: [2150, 2350], state: 'Solid', composition: 'Dense ice phases', densityKgM3: [1200, 1350], temperatureK: [260, 300], material: ICE, model: true, provenance: 'model', plain: 'Dense ice sitting on the rock core.', sources: ['vance2018'] },
      { id: 'ocean', name: 'Ocean', outerKm: 2475, outerRangeKm: [2400, 2525], state: 'Liquid', composition: 'Water, possibly with ammonia and salts', densityKgM3: [1000, 1300], temperatureK: [250, 270], material: OCEAN, model: true, provenance: 'derived', plain: 'A deep ocean, possibly very salty.', sources: ['iess2012', 'vance2018'] },
      { id: 'ice-shell', name: 'Ice shell', outerKm: 2574.76, state: 'Solid', composition: 'Water ice under a thick nitrogen atmosphere', densityKgM3: [920, 940], temperatureK: [94, 250], material: ICE, model: true, provenance: 'model', plain: 'An ice shell about 50 to 200 km thick. The surface is 94 K.', sources: ['iess2012', 'vance2018'] },
    ],
  },
];
