// Round 2: 8192x4096 colour maps from USGS Astrogeology WMS. The server caps GetMap at 4096 px, so the globe is
// rendered as two 4096x4096 half-globe tiles (west/east, server-side resampling of the full-res mosaic) and stitched.
// Unobserved (pure-black / transparent) areas are pull-push filled and faded toward the mean observed colour (as in the 4k build).
//   node scripts/data/textures-hd/build-wms8k.mjs <body ...>
import fs from 'node:fs';
import path from 'node:path';
import { RAW, TEX, rel, log, sharp } from './lib.mjs';
import { WMS_BODIES } from './wms-bodies.mjs';
import { wmsUrl } from './fetch-wms.mjs';
import { toRaw } from '../textures/process.mjs';
import { pullPushFill } from '../textures/process.mjs';

const UA = { 'User-Agent': 'Cosmos/0.1 (educational SCI-FORGE 2026 project)' };
async function getTile(body, c, i) {
  const dir = path.join(RAW, 'wms2'); fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${body}_t${i}.png`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 50000) return dest;
  const url = wmsUrl({ map: c.map, layer: c.layer, width: 4096, height: 4096, bbox: i === 0 ? [-180, -90, 0, 90] : [0, -90, 180, 90] });
  for (let a = 1; a <= 4; a++) {
    try {
      const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(400_000) });
      const type = res.headers.get('content-type') || '';
      if (!res.ok || !/^image\//.test(type)) throw new Error(`HTTP ${res.status} ${type} ${(await res.text()).slice(0, 200)}`);
      fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer())); return dest;
    } catch (e) { log(body, 'tile', i, 'attempt', a, e.message); }
  }
  throw new Error(`failed ${body} tile ${i}`);
}

for (const body of process.argv.slice(2)) {
  const c = WMS_BODIES[body];
  const tiles = await Promise.all([0, 1].map((i) => getTile(body, c, i)));
  const W = 8192, H = 4096;
  const data = Buffer.alloc(W * H * 4);
  for (let t = 0; t < 2; t++) {
    const r = await toRaw(tiles[t], { channels: 4 }); // 4096x4096 RGBA
    for (let y = 0; y < H; y++) r.data.copy(data, (y * W + t * 4096) * 4, y * 4096 * 4, (y + 1) * 4096 * 4);
  }
  let img = { data, width: W, height: H, channels: 4 };
  if (c.blackNoData) for (let i = 0; i < data.length; i += 4) if (data[i] <= 2 && data[i + 1] <= 2 && data[i + 2] <= 2) data[i + 3] = 0;
  let nodata = 0; for (let i = 3; i < data.length; i += 4) if (data[i] < 128) nodata++;
  let observed = 1;
  if (nodata > 0) {
    const f = pullPushFill(img); img = f.img; observed = f.observedFraction; const cov = f.coverage;
    if (observed < 0.9) {
      const m = [0, 0, 0]; let n = 0;
      for (let i = 0; i < W * H; i++) if (cov[i]) { m[0] += img.data[i * 3]; m[1] += img.data[i * 3 + 1]; m[2] += img.data[i * 3 + 2]; n++; }
      const wb = await sharp(Buffer.from(cov.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } }).blur(20).raw().toBuffer();
      for (let i = 0; i < W * H; i++) { const k = cov[i] ? 1 : Math.min(1, (wb[i] / 255) * 1.5) * 0.6; if (k < 1) for (let ch = 0; ch < 3; ch++) img.data[i * 3 + ch] = Math.round(img.data[i * 3 + ch] * k + (m[ch] / n) * (1 - k)); }
    }
  } else {
    const rgb = Buffer.alloc(W * H * 3); for (let i = 0; i < W * H; i++) { rgb[i * 3] = data[i * 4]; rgb[i * 3 + 1] = data[i * 4 + 1]; rgb[i * 3 + 2] = data[i * 4 + 2]; }
    img = { data: rgb, width: W, height: H, channels: 3 };
  }
  const out = path.join(TEX, body, 'color_8k.jpg');
  const info = await sharp(img.data, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(out);
  const frag = { body, map: 'color', tier: '8k', path: rel(out), bytes: info.size,
    source: { name: `USGS Astrogeology planetary WMS ${c.layer} - ${c.credit}`, url: `https://planetarymaps.usgs.gov/cgi-bin/mapserv?map=${c.map}`, license: 'public domain (NASA/USGS)', retrieved: '2026-10-19' },
    note: `GetMap EPSG:4326 as two 4096x4096 half-globe tiles stitched to 8192x4096. observedFraction=${observed.toFixed(3)}${observed < 0.999 ? '; unobserved area filled smoothly and faded to mean colour (illustrative, no real detail); see coverage_* mask' : ''}` };
  fs.writeFileSync(path.join(RAW, `hd2.${body}.json`), JSON.stringify(frag, null, 1));
  log(body, 'ok', info.size, 'observed', observed.toFixed(3));
  for (const t of tiles) fs.unlinkSync(t);
}
