// Round 2: small irregular moons that have no map yet - USGS WMS single 4096x2048 render (+ 1024x512), albedo-calibrated.
//   node scripts/data/textures-hd/build-wms4k.mjs <phobos|deimos|phoebe|hyperion ...>
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, rel, log, sharp, meanLinearLuma, adjustRgb } from './lib.mjs';
import { wmsUrl } from './fetch-wms.mjs';
import { toRaw, pullPushFill } from '../textures/process.mjs';

const J = {
  phobos: { map: '/maps/mars/phobos_simp_cyl.map', layer: 'VIKING', target: 0.07, name: 'Viking Orbiter mosaic of Phobos (USGS Astrogeology WMS VIKING)' },
  deimos: { map: '/maps/mars/deimos_simp_cyl.map', layer: 'VIKING', target: 0.07, name: 'Viking Orbiter mosaic of Deimos (USGS Astrogeology WMS VIKING)' },
  phoebe: { map: '/maps/saturn/phoebe_simp_cyl.map', layer: 'CASSINI', target: 0.08, name: 'Cassini ISS mosaic of Phoebe (USGS Astrogeology WMS CASSINI)' },
  hyperion: { map: '/maps/saturn/hyperion_simp_cyl.map', layer: 'VOYAGER2', target: 0.25, name: 'Voyager 2 / Cassini mosaic of Hyperion (USGS Astrogeology WMS VOYAGER2)' },
};
for (const body of process.argv.slice(2)) {
  const c = J[body];
  const dir = path.join(RAW, 'wms2'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${body}_4096.png`);
  if (!fs.existsSync(dest)) {
    const res = await fetch(wmsUrl({ map: c.map, layer: c.layer, width: 4096, height: 2048 }), { signal: AbortSignal.timeout(300_000) });
    if (!res.ok || !/^image\//.test(res.headers.get('content-type') || '')) throw new Error(`${body}: ${res.status} ${(await res.text()).slice(0, 200)}`);
    fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
  }
  let img = await toRaw(dest, { channels: 4 });
  const W = 4096, H = 2048;
  let nodata = 0; for (let i = 3; i < img.data.length; i += 4) if (img.data[i] < 128) nodata++;
  for (let i = 0; i < img.data.length; i += 4) if (img.data[i] <= 2 && img.data[i + 1] <= 2 && img.data[i + 2] <= 2 && img.data[i + 3] >= 128) { img.data[i + 3] = 0; nodata++; }
  let observed = 1;
  if (nodata) { const f = pullPushFill(img); img = f.img; observed = f.observedFraction; } else img = await toRaw(dest, { channels: 3 });
  const m0 = meanLinearLuma({ data: img.data, width: W, height: H }); const gain = c.target / m0;
  adjustRgb({ data: img.data }, { saturation: 1, gain });
  const frags = [];
  for (const [w, tag] of [[4096, '4k'], [1024, '1k']]) {
    const buf = w === W ? img.data : await sharp(img.data, { raw: { width: W, height: H, channels: 3 } }).resize(w, w / 2, { kernel: 'lanczos3' }).raw().toBuffer();
    const file = path.join(TEX, body, `color_${tag}.jpg`); fs.mkdirSync(path.dirname(file), { recursive: true });
    const r = await sharp(buf, { raw: { width: w, height: w / 2, channels: 3 } }).jpeg({ quality: 86, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(file);
    frags.push({ body, map: 'color', tier: tag, path: rel(file), bytes: r.size, source: { name: c.name, url: `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=${c.map}`, license: 'public domain (NASA/USGS)', retrieved: '2026-10-19' },
      note: `Equirectangular map of an irregular body (draped on the sphere/shape model by the app: expect distortion). observedFraction=${observed.toFixed(3)}${observed < 0.999 ? ', unobserved area filled smoothly (illustrative)' : ''}; albedo-calibrated x${gain.toFixed(3)} to mean ${c.target}` });
    log(body, tag, r.size, 'observed', observed.toFixed(3), 'gain', gain.toFixed(3));
  }
  fs.writeFileSync(path.join(RAW, `hd2.${body}.json`), JSON.stringify(frags, null, 1));
}
