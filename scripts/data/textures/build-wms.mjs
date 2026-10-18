// USGS Astrogeology planetary WMS -> equirect textures (4096x2048 + 1024x512), x=0 at 180W, east-positive.
//   node scripts/data/textures/build-wms.mjs [body ...]     (FORCE=1 to rebuild)
import fs from 'node:fs';
import { RAW_DIR, TEX_DIR, wmsGetMapUrl, download, log, relPublic } from './lib.mjs';
import { toRaw, pullPushFill, writeVariants } from './process.mjs';
import { saveRecords } from './records.mjs';

const USGS_LIC = 'Public domain (U.S. Government work; NASA/USGS data products). Credit: USGS Astrogeology Science Center';
const BODIES = {
  moon: { map: '/maps/earth/moon_simp_cyl.map', layer: 'LROC_WAC', slot: 'color', credit: 'NASA/GSFC/Arizona State University (LRO WAC global mosaic, 2013, edges fixed 2016); hosted by USGS Astrogeology', pc: 'observed' },
  mars: { map: '/maps/mars/mars_simp_cyl.map', layer: 'MDIM21_color', slot: 'color', credit: 'USGS Astrogeology / NASA Viking MDIM 2.1 colorized (NASA/JPL/USGS)', pc: 'observed' },
  mercury: { map: '/maps/mercury/mercury_simp_cyl.map', layer: 'MESSENGER', slot: 'color', credit: 'NASA/Johns Hopkins APL/Carnegie Institution of Washington, MESSENGER MDIS BDR basemap (May 2016); mosaic by USGS', pc: 'observed' },
  venus: { map: '/maps/venus/venus_simp_cyl.map', layer: 'MAGELLAN_color', slot: 'surface', credit: 'NASA/JPL Magellan SAR mosaic, colorized (Venera-derived colour ramp), USGS Astrogeology', pc: 'derived' },
  io: { map: '/maps/jupiter/io_simp_cyl.map', layer: 'SSI_VGR_color', slot: 'color', credit: 'NASA/JPL/USGS Galileo SSI + Voyager merged colour mosaic', pc: 'observed' },
  europa: { map: '/maps/jupiter/europa_simp_cyl.map', layer: 'GALILEO_VOYAGER', slot: 'color', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', pc: 'observed', blackNoData: true },
  ganymede: { map: '/maps/jupiter/ganymede_simp_cyl.map', layer: 'GALILEO_VOYAGER', slot: 'color', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', pc: 'observed', blackNoData: true },
  callisto: { map: '/maps/jupiter/callisto_simp_cyl.map', layer: 'GALILEO_VOYAGER', slot: 'color', credit: 'NASA/JPL/USGS Galileo SSI + Voyager global mosaic', pc: 'observed', blackNoData: true },
  titan: { map: '/maps/saturn/titan_simp_cyl.map', layer: 'CASSINI', slot: 'color', credit: 'NASA/JPL-Caltech/Space Science Institute, Cassini ISS global map PIA19658 (Oct 2015); USGS', pc: 'observed' },
  enceladus: { map: '/maps/saturn/enceladus_simp_cyl.map', layer: 'CASSINI', slot: 'color', credit: 'NASA/JPL-Caltech/SSI/USGS Cassini Enceladus global mosaic', pc: 'observed' },
  triton: { map: '/maps/neptune/triton_simp_cyl.map', layer: 'TRITON_VOYAGER2', slot: 'color', credit: 'NASA/JPL/USGS Voyager 2 Triton colour mosaic (P. Schenk, LPI)', pc: 'observed' },
  pluto: { map: '/maps/pluto/pluto_simp_cyl.map', layer: 'NEWHORIZONS_PLUTO_MOSAIC', slot: 'color', credit: 'NASA/Johns Hopkins APL/Southwest Research Institute New Horizons LORRI/MVIC mosaic (2017); USGS', pc: 'observed' },
  charon: { map: '/maps/pluto/charon_simp_cyl.map', layer: 'NEWHORIZONS_CHARON_MOSAIC', slot: 'color', credit: 'NASA/JHUAPL/SwRI New Horizons mosaic (2017); USGS', pc: 'observed' },
};

const only = process.argv.slice(2);
for (const [body, c] of Object.entries(BODIES)) {
  if (only.length && !only.includes(body)) continue;
  const outDir = `${TEX_DIR}/${body}`;
  const base = `${outDir}/${c.slot}`;
  if (fs.existsSync(`${base}_4k.jpg`) && !process.env.FORCE) { log(`skip ${body} (exists)`); continue; }
  const raw = `${RAW_DIR}/wms/${body}_${c.layer}.png`;
  const endpoint = wmsGetMapUrl({ mapfile: c.map, layer: c.layer, width: 4096, height: 2048, format: 'image/png', transparent: true });
  await download(endpoint, raw, { expectType: /^image\//, minBytes: 20000, skipHead: true, label: `${body}/${c.layer}` });
  let img = await toRaw(raw, { channels: 4 });
  let observed = 1;
  if (c.blackNoData) for (let i = 0; i < img.data.length; i += 4) if (img.data[i] <= 2 && img.data[i + 1] <= 2 && img.data[i + 2] <= 2) img.data[i + 3] = 0; // source paints unobserved areas pure black
  let minA = 255;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < minA) minA = img.data[i];
  if (minA < 128) {
    const f = pullPushFill(img);
    img = f.img; observed = f.observedFraction;
    log(`  ${body}: observed fraction ${(observed * 100).toFixed(1)}% (rest filled smoothly)`);
  } else img = await toRaw(raw, { channels: 3 });
  const w = await writeVariants(img, [
    { file: `${base}_4k.jpg`, width: 4096, height: 2048, format: 'jpeg' },
    { file: `${base}_1k.jpg`, width: 1024, height: 512, format: 'jpeg' },
  ]);
  saveRecords('wms', [{
    key: `${body}/${c.slot}`, body, map: c.slot, files: { high: relPublic(w[0].file), low: relPublic(w[1].file) },
    credit: c.credit, license: USGS_LIC, source: endpoint,
    notes: `USGS planetary WMS 1.1.1 layer ${c.layer}, GetMap EPSG:4326 BBOX -180,-90,180,90 at 4096x2048; planetocentric east-positive longitude; observedFraction=${observed.toFixed(3)}${observed < 0.999 ? ' (unobserved regions filled by smooth pull-push interpolation: illustrative, not data)' : ''}`,
    provenanceClass: c.pc, observedFraction: +observed.toFixed(4), retrieved: new Date().toISOString(), layer: c.layer, mapfile: c.map,
    bytes: w.map((x) => x.bytes),
  }]);
}
log('done');
