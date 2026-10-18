// Discovery helper (run manually): caches OGC capabilities documents for the USGS Astrogeology planetary WMS
// and NASA Solar System Treks WMTS endpoints under data-raw/textures/caps/ and prints their layers, so that the
// layer choices in sources.mjs can be reviewed / re-verified. Not needed for a normal rebuild.
//   node scripts/data/textures/discover.mjs [wms|treks]
import fs from 'node:fs';
import { RAW_DIR, getBuffer, wmsCapabilitiesUrl, log, mkdirp } from './lib.mjs';

const CAPS = `${RAW_DIR}/caps`;
mkdirp(CAPS);

export const WMS_MAPS = {
  moon: '/maps/earth/moon_simp_cyl.map',
  mars: '/maps/mars/mars_simp_cyl.map',
  mercury: '/maps/mercury/mercury_simp_cyl.map',
  venus: '/maps/venus/venus_simp_cyl.map',
  io: '/maps/jupiter/io_simp_cyl.map',
  europa: '/maps/jupiter/europa_simp_cyl.map',
  ganymede: '/maps/jupiter/ganymede_simp_cyl.map',
  callisto: '/maps/jupiter/callisto_simp_cyl.map',
  titan: '/maps/saturn/titan_simp_cyl.map',
  enceladus: '/maps/saturn/enceladus_simp_cyl.map',
  triton: '/maps/neptune/triton_simp_cyl.map',
  pluto: '/maps/pluto/pluto_simp_cyl.map',
  charon: '/maps/pluto/charon_simp_cyl.map',
  ceres: '/maps/ceres/ceres_simp_cyl.map',
  vesta: '/maps/vesta/vesta_simp_cyl.map',
};

async function cachedText(url, file) {
  const p = `${CAPS}/${file}`;
  if (fs.existsSync(p) && fs.statSync(p).size > 200) return fs.readFileSync(p, 'utf8');
  const { buf } = await getBuffer(url, { label: file, timeoutMs: 60_000 });
  fs.writeFileSync(p, buf);
  return buf.toString('utf8');
}

function parseWmsLayers(xml) {
  const out = [];
  const re = /<Layer[^>]*>\s*<Name>([^<]+)<\/Name>\s*<Title>([^<]*)<\/Title>\s*(?:<Abstract>([\s\S]*?)<\/Abstract>)?/g;
  let m;
  while ((m = re.exec(xml))) out.push({ name: m[1], title: m[2], abstract: (m[3] || '').replace(/\s+/g, ' ').slice(0, 220) });
  const crs = [...new Set([...xml.matchAll(/<(?:CRS|SRS)>([^<]+)<\/(?:CRS|SRS)>/g)].map((x) => x[1]))];
  const maxW = xml.match(/<MaxWidth>(\d+)<\/MaxWidth>/)?.[1];
  return { layers: out, crs, maxW };
}

const mode = process.argv[2] || 'wms';
if (mode === 'wms') {
  for (const [body, map] of Object.entries(WMS_MAPS)) {
    try {
      const xml = await cachedText(wmsCapabilitiesUrl(map), `wms_${body}.xml`);
      const { layers, crs, maxW } = parseWmsLayers(xml);
      console.log(`\n## ${body} (${map}) CRS=${crs.join(',')} MaxWidth=${maxW ?? 'n/a'}`);
      for (const l of layers) console.log(`  - ${l.name} | ${l.title} | ${l.abstract}`);
    } catch (e) {
      console.log(`\n## ${body}: FAILED ${e.message}`);
    }
  }
} else if (mode === 'treks') {
  // NASA Solar System Treks catalogue search (Solr JSON). One portal per body.
  const portals = process.argv.slice(3).length ? process.argv.slice(3) : ['ceres', 'vesta'];
  for (const portal of portals) {
    const url = `https://trek.nasa.gov/${portal}/TrekServices/ws/index/eq/searchItems?start=0&rows=400&key=*&facetKeys=itemType&facetValues=product`;
    try {
      const txt = await cachedText(url, `treks_${portal}.json`);
      const docs = JSON.parse(txt).response.docs.filter((d) => d.itemType === 'product');
      console.log(`\n## treks ${portal}: ${docs.length} products`);
      for (const d of docs) {
        const cm = (d.projection || '').match(/central_meridian",\s*(-?[\d.]+)/)?.[1];
        const cov = (d.coverage || '').toLowerCase();
        if (!/global/.test(cov) && !/global/i.test(d.title)) continue;
        console.log(`  - ${d.productLabel} | ${d.title} | type=${d.productType || d.productCat2} | cov=${d.coverage} | res=${d.resolution} | cm=${cm ?? 'n/a'} | bbox=${d.bbox} | proj=${d.trekProjection} | tiles=${(d.thumbnailURLDir || '').replace(/\/thumbnail\/.*/, '')}`);
      }
    } catch (e) {
      console.log(`\n## treks ${portal}: FAILED ${e.message}`);
    }
  }
}
