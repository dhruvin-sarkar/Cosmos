// USGS Astrogeology WMS layer table (same layers as scripts/data/textures/build-wms.mjs, which built the 4k maps).
export const WMS_BODIES = {
  io: { map: '/maps/jupiter/io_simp_cyl.map', layer: 'SSI_VGR_color', credit: 'NASA/JPL/USGS Galileo SSI + Voyager merged colour mosaic' },
  europa: { map: '/maps/jupiter/europa_simp_cyl.map', layer: 'GALILEO_VOYAGER', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', blackNoData: true },
  ganymede: { map: '/maps/jupiter/ganymede_simp_cyl.map', layer: 'GALILEO_VOYAGER', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', blackNoData: true },
  callisto: { map: '/maps/jupiter/callisto_simp_cyl.map', layer: 'GALILEO_VOYAGER', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', blackNoData: true },
  titan: { map: '/maps/saturn/titan_simp_cyl.map', layer: 'CASSINI', credit: 'NASA/JPL-Caltech/SSI Cassini ISS global map PIA19658; USGS' },
  enceladus: { map: '/maps/saturn/enceladus_simp_cyl.map', layer: 'CASSINI', credit: 'NASA/JPL-Caltech/SSI/USGS Cassini Enceladus global mosaic' },
  triton: { map: '/maps/neptune/triton_simp_cyl.map', layer: 'TRITON_VOYAGER2', credit: 'NASA/JPL/USGS Voyager 2 Triton colour mosaic (P. Schenk, LPI)' },
  pluto: { map: '/maps/pluto/pluto_simp_cyl.map', layer: 'NEWHORIZONS_PLUTO_MOSAIC', credit: 'NASA/JHUAPL/SwRI New Horizons LORRI/MVIC mosaic (2017); USGS' },
  charon: { map: '/maps/pluto/charon_simp_cyl.map', layer: 'NEWHORIZONS_CHARON_MOSAIC', credit: 'NASA/JHUAPL/SwRI New Horizons mosaic (2017); USGS' },
};
