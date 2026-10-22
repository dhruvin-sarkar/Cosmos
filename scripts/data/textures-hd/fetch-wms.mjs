// Fetch USGS Astrogeology WMS GetMap renders at high resolution into data-raw/textures-hd/wms2/.
//   node scripts/data/textures-hd/fetch-wms.mjs <body> [width=8192] [layer override]
import fs from 'node:fs';
import path from 'node:path';
import { RAW, log } from './lib.mjs';
import { WMS_BODIES } from './wms-bodies.mjs';

const USGS_WMS = 'https://planetarymaps.usgs.gov/cgi-bin/mapserv';
export function wmsUrl({ map, layer, width, height, bbox = [-180, -90, 180, 90], format = 'image/png' }) {
  const q = new URLSearchParams({ map, SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: layer, STYLES: '', SRS: 'EPSG:4326', BBOX: bbox.join(','), WIDTH: String(width), HEIGHT: String(height), FORMAT: format, TRANSPARENT: 'TRUE' });
  return `${USGS_WMS}?${q.toString().replace(/%2F/g, '/').replace(/%2C/g, ',')}`;
}

export async function fetchWms(body, width = 8192, { layer, map, tag = '' } = {}) {
  const c = WMS_BODIES[body];
  const url = wmsUrl({ map: map ?? c.map, layer: layer ?? c.layer, width, height: width / 2 });
  const dir = path.join(RAW, 'wms2');
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${body}${tag}_${width}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) { log('cached', dest); return dest; }
  for (let attempt = 1; attempt <= 3; attempt++) {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 600_000);
    try {
      log(`fetch ${body} ${width} attempt ${attempt}`);
      const res = await fetch(url, { signal: ac.signal, headers: { 'User-Agent': 'Cosmos/0.1 (educational SCI-FORGE 2026 project)' } });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/^image\//.test(type)) { const txt = (await res.text()).slice(0, 300); throw new Error(`HTTP ${res.status} ${type} ${txt}`); }
      const buf = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(dest, buf);
      log(`ok ${dest} ${(buf.length / 1e6).toFixed(1)} MB`);
      return dest;
    } catch (e) { log('fail', e.message); } finally { clearTimeout(t); }
  }
  throw new Error(`failed ${body}`);
}

if (process.argv[1]?.endsWith('fetch-wms.mjs')) {
  const [body, w, layer] = process.argv.slice(2);
  await fetchWms(body, Number(w) || 8192, { layer });
}
