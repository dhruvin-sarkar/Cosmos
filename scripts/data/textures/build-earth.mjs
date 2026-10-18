// Earth maps: NASA Blue Marble NG (day), NASA Black Marble 2016 via GIBS (night), clouds (Solar System Scope, CC BY 4.0),
// ETOPO 2022 via OPeNDAP (ocean/specular mask, height, normal). Output convention: x=0 at 180W, east-positive, y=0 at 90N.
//   node scripts/data/textures/build-earth.mjs [day|night|clouds|topo ...]   (FORCE=1 to rebuild)
import fs from 'node:fs';
import { RAW_DIR, TEX_DIR, download, getBuffer, log, relPublic, sharp, mkdirp } from './lib.mjs';
import { toRaw, writeVariants, normalMapFromHeights } from './process.mjs';
import { saveRecords } from './records.mjs';

const only = process.argv.slice(2);
const want = (k) => !only.length || only.includes(k);
const OUT = `${TEX_DIR}/earth`;
const RAW = `${RAW_DIR}/earth`;
mkdirp(OUT); mkdirp(RAW);
const exists = (f) => fs.existsSync(f) && !process.env.FORCE;
const PD = 'Public domain (NASA imagery; NASA media usage guidelines permit reuse with credit)';
const SIZES = [['ultra', 8192, 4096, '8k'], ['high', 4096, 2048, '4k'], ['low', 2048, 1024, '2k']];
const variants = (slot, ext, extra = {}) => SIZES.map(([, w, h, tag]) => ({ file: `${OUT}/${slot}_${tag}.${ext}`, width: w, height: h, format: ext === 'jpg' ? 'jpeg' : ext, ...extra }));
const fileMap = (ws) => Object.fromEntries(SIZES.map(([k], i) => [k, relPublic(ws[i].file)]));

// ------------------------------------------------------------------ day
if (want('day') && !exists(`${OUT}/day_8k.jpg`)) {
  const url = 'https://eoimages.gsfc.nasa.gov/images/imagerecords/74000/74218/world.200412.3x21600x10800.jpg';
  const raw = `${RAW}/bmng_200412_21600.jpg`;
  const meta = await download(url, raw, { expectType: /image\/jpeg/, minBytes: 5e6, label: 'BlueMarbleNG 2004-12' });
  const big = await sharp(raw, { limitInputPixels: false }).resize(8192, 4096, { kernel: 'lanczos3' }).png({ compressionLevel: 1 }).toBuffer();
  const img = await toRaw(big, { channels: 3 });
  const ws = await writeVariants(img, variants('day', 'jpg'));
  saveRecords('earth', [{ key: 'earth/day', body: 'earth', map: 'day', files: fileMap(ws), credit: 'NASA Earth Observatory (Reto Stockli, Robert Simmon), Blue Marble: Next Generation, December 2004 composite (MODIS)', license: PD, source: url, provenanceClass: 'observed', retrieved: meta.retrieved, endpoint: url, notes: 'Source 21600x10800 (500 m/px) JPEG, lon -180..180 left to right, resized with lanczos3. Monthly MODIS composite (December 2004), includes seasonal snow of that month.', bytes: ws.map((w) => w.bytes) }]);
}

// ------------------------------------------------------------------ night (Black Marble 2016, GIBS WMS)
if (want('night') && !exists(`${OUT}/night_8k.jpg`)) {
  const url = 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetMap&LAYERS=VIIRS_Black_Marble&STYLES=&SRS=EPSG:4326&BBOX=-180,-90,180,90&WIDTH=8192&HEIGHT=4096&FORMAT=image/png&TRANSPARENT=FALSE&TIME=2016-01-01';
  const raw = `${RAW}/blackmarble2016_8192.png`;
  const meta = await download(url, raw, { expectType: /image\/png/, minBytes: 1e6, skipHead: true, label: 'Black Marble 2016 (GIBS)' });
  const img = await toRaw(raw, { channels: 3 });
  // GIBS renders land/ice with a dim blue-grey base tint; remove it so the map is an emissive 'lights only' layer (black where no lights).
  const d = img.data;
  for (let i = 0; i < d.length; i += 3) {
    const B = d[i + 2];
    d[i] = Math.max(0, Math.min(255, (d[i] - 0.65 * B) * 2.5));
    d[i + 1] = Math.max(0, Math.min(255, (d[i + 1] - 0.65 * B) * 2.5));
    d[i + 2] = Math.max(0, Math.min(255, (B - 0.95 * B) * 2.5));
  }
  const ws = await writeVariants(img, variants('night', 'jpg'));
  saveRecords('earth', [{ key: 'earth/night', body: 'earth', map: 'night', files: fileMap(ws), credit: 'NASA Earth Observatory / NOAA NGDC; Suomi NPP VIIRS Black Marble 2016 (Roman Miguel et al., NASA GSFC) via NASA GIBS', license: PD + '; NASA EOSDIS data are open (https://www.earthdata.nasa.gov/engage/open-data-services-and-software/data-and-information-policy)', source: 'https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi (layer VIIRS_Black_Marble)', provenanceClass: 'derived', retrieved: meta.retrieved, endpoint: url, notes: 'GIBS WMS 1.1.1 GetMap EPSG:4326 at 8192x4096 (server resamples from ~500 m tile pyramid), time 2016-01-01 (annual 2016 composite). DERIVED lights-only emissive map: GIBS base tint removed per pixel (R,G: (c-0.65*B)*2.5; B: (B-0.95*B)*2.5; clamped), so unlit land/ocean/ice are ~black and city lights are warm yellow-white. Use as emissiveMap (sRGB colour JPEG). Absolute radiances are NOT preserved.', bytes: ws.map((w) => w.bytes) }]);
}

// ------------------------------------------------------------------ clouds (Solar System Scope, CC BY 4.0)
if (want('clouds') && !exists(`${OUT}/clouds_8k.jpg`)) {
  const url = 'https://www.solarsystemscope.com/textures/download/8k_earth_clouds.jpg';
  const raw = `${RAW}/sss_8k_earth_clouds.jpg`;
  const meta = await download(url, raw, { expectType: /image\//, minBytes: 1e5, skipHead: true, label: 'SSS 8k clouds' });
  const buf = await sharp(raw, { limitInputPixels: false }).resize(8192, 4096, { fit: 'fill' }).toColourspace('b-w').png().toBuffer();
  const img = await toRaw(buf, { channels: 1 });
  const ws = await writeVariants(img, variants('clouds', 'jpg', { grey: true }));
  saveRecords('earth', [{ key: 'earth/clouds', body: 'earth', map: 'clouds', files: fileMap(ws), credit: 'Solar System Scope / INOVE (textures based on NASA satellite imagery)', license: 'CC BY 4.0', source: 'https://www.solarsystemscope.com/textures/', provenanceClass: 'illustrative', retrieved: meta.retrieved, endpoint: url, notes: 'Greyscale cloud-cover composite (white = opaque cloud); use as alpha/opacity map. A static composite, NOT the real current cloud field. Greyscale JPEG (1 channel).', bytes: ws.map((w) => w.bytes) }]);
}

// ------------------------------------------------------------------ topography: ETOPO 2022 (OPeNDAP) -> specular, height, normal
function boxResample(src, sw, sh, dw, dh) {
  // area-average (separable fractional box filter), src Float32Array sw x sh -> Float32Array dw x dh
  const tmp = new Float32Array(dw * sh);
  const xr = sw / dw;
  for (let x = 0; x < dw; x++) {
    const a = x * xr, b = (x + 1) * xr, i0 = Math.floor(a), i1 = Math.min(sw - 1, Math.ceil(b) - 1);
    for (let y = 0; y < sh; y++) {
      let s = 0, ws = 0;
      for (let i = i0; i <= i1; i++) { const w = Math.min(b, i + 1) - Math.max(a, i); s += src[y * sw + i] * w; ws += w; }
      tmp[y * dw + x] = s / ws;
    }
  }
  const out = new Float32Array(dw * dh);
  const yr = sh / dh;
  for (let y = 0; y < dh; y++) {
    const a = y * yr, b = (y + 1) * yr, j0 = Math.floor(a), j1 = Math.min(sh - 1, Math.ceil(b) - 1);
    for (let x = 0; x < dw; x++) {
      let s = 0, ws = 0;
      for (let j = j0; j <= j1; j++) { const w = Math.min(b, j + 1) - Math.max(a, j); s += tmp[j * dw + x] * w; ws += w; }
      out[y * dw + x] = s / ws;
    }
  }
  return out;
}

async function loadEtopo() {
  const base = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc.dods';
  const SW = 10800, SH = 5400, CHUNK = 900; // stride 2 over 21600 x 10800
  const grid = new Float32Array(SW * SH); // row 0 = south (lat ascending in file) -> flipped later
  for (let r0 = 0, k = 0; r0 < SH; r0 += CHUNK, k++) {
    const rows = Math.min(CHUNK, SH - r0);
    const q = `?z.z[${r0 * 2}:2:${(r0 + rows - 1) * 2}][0:2:21598]`;
    const p = `${RAW}/etopo2022_60s_s2_${k}.dods`;
    if (!fs.existsSync(p)) {
      const { buf } = await getBuffer(base + q, { label: `ETOPO2022 rows ${r0}+${rows}`, timeoutMs: 600_000 });
      fs.writeFileSync(p, buf);
    }
    const buf = fs.readFileSync(p);
    const marker = Buffer.from('\nData:\n');
    const at = buf.indexOf(marker);
    if (at < 0) throw new Error(`bad DODS response in ${p}: ${buf.toString('utf8', 0, 200)}`);
    let o = at + marker.length;
    const n1 = buf.readUInt32BE(o), n2 = buf.readUInt32BE(o + 4);
    if (n1 !== rows * SW || n2 !== n1) throw new Error(`DODS count ${n1} != ${rows * SW}`);
    o += 8;
    for (let i = 0; i < n1; i++) grid[r0 * SW + i] = buf.readFloatBE(o + i * 4);
    log(`  ETOPO rows ${r0}..${r0 + rows - 1} ok`);
  }
  // check lat ordering from the lat coordinate (first row)
  const { buf } = await getBuffer(base + '?lat[0:1:1]', { label: 'ETOPO lat probe' });
  const at = buf.indexOf(Buffer.from('\nData:\n')) + 7;
  const lat0 = buf.readDoubleBE(at + 8), lat1 = buf.readDoubleBE(at + 16);
  log(`  ETOPO lat[0..1] = ${lat0}, ${lat1}`);
  if (!(lat1 > lat0)) throw new Error('ETOPO lat axis is descending; script assumes ascending');
  // flip to north-up
  const out = new Float32Array(SW * SH);
  for (let y = 0; y < SH; y++) out.set(grid.subarray((SH - 1 - y) * SW, (SH - y) * SW), y * SW);
  return { data: out, w: SW, h: SH };
}

if (want('topo') && !(exists(`${OUT}/specular_8k.png`) && exists(`${OUT}/normal_4k.png`))) {
  const { data: z, w: SW, h: SH } = await loadEtopo();
  let bad = 0; for (let i = 0; i < z.length; i++) if (!Number.isFinite(z[i])) { bad++; z[i] = 0; }
  log(`  ETOPO non-finite cells: ${bad}`);
  const retrieved = new Date().toISOString();
  const srcUrl = 'https://www.ngdc.noaa.gov/thredds/dodsC/global/ETOPO2022/60s/60s_surface_elev_netcdf/ETOPO_2022_v1_60s_N90W180_surface.nc (OPeNDAP, variable z, stride 2)';
  const credit = 'NOAA National Centers for Environmental Information, ETOPO 2022 15 Arc-Second Global Relief Model (60 arc-second surface-elevation grid), doi:10.25921/fd45-gt74';
  const lic = 'Public domain (NOAA NCEI open data, no restrictions on use)';
  const specFiles = {}, heightFiles = {}, normFiles = {};
  const bytes = { spec: [], height: [], norm: [] };
  for (const [key, W, H, tag] of SIZES) {
    const zs = boxResample(z, SW, SH, W, H);
    // specular / ocean mask: ocean (z<0) = 255, land = 0, with 1-pixel soft edge (by resampling a binary grid at source res)
    const sea = new Float32Array(z.length); for (let i = 0; i < z.length; i++) sea[i] = z[i] < 0 ? 1 : 0;
    const seaS = boxResample(sea, SW, SH, W, H);
    const spec = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) spec[i] = Math.round(seaS[i] * 255);
    let f = `${OUT}/specular_${tag}.png`;
    const [sw] = await writeVariants({ data: spec, width: W, height: H, channels: 1 }, [{ file: f, width: W, height: H, format: 'png', grey: true }]);
    specFiles[key] = relPublic(f); bytes.spec.push(sw.bytes);
    // height (8-bit, land elevation 0..~6000 m mapped via sqrt for bump use; sea = 0). Only at high/low.
    if (key !== 'ultra') {
      const hm = Buffer.alloc(W * H);
      for (let i = 0; i < W * H; i++) { const e = Math.max(0, zs[i]); hm[i] = Math.round(Math.min(1, Math.sqrt(e / 6000)) * 255); }
      f = `${OUT}/height_${tag}.png`;
      const [hw] = await writeVariants({ data: hm, width: W, height: H, channels: 1 }, [{ file: f, width: W, height: H, format: 'png', grey: true }]);
      heightFiles[key] = relPublic(f); bytes.height.push(hw.bytes);
    }
    // normal map (OpenGL tangent space), flat over open ocean
    const zl = Float32Array.from(zs, (v) => Math.max(0, v)); // land relief only; sea level flat
    const { img, maxSlope } = normalMapFromHeights(zl, W, H, { radiusM: 6371000, exaggeration: 6 });
    f = `${OUT}/normal_${tag}.png`;
    if (key === 'ultra') { // 8k PNG normal would be huge: store lossless WebP instead
      f = `${OUT}/normal_${tag}.webp`;
      const [nw] = await writeVariants(img, [{ file: f, width: W, height: H, format: 'webp', lossless: true }]);
      bytes.norm.push(nw.bytes);
    } else {
      const [nw] = await writeVariants(img, [{ file: f, width: W, height: H, format: 'png' }]);
      bytes.norm.push(nw.bytes);
    }
    normFiles[key] = relPublic(f);
    log(`  normal ${key}: max slope (exaggerated) ${maxSlope.toFixed(3)}`);
  }
  const common = { body: 'earth', retrieved, endpoint: srcUrl, license: lic, credit };
  saveRecords('earth', [
    { ...common, key: 'earth/specular', map: 'specular', files: specFiles, provenanceClass: 'derived', source: srcUrl, notes: 'Ocean mask derived from ETOPO 2022 surface elevation (z < 0 m = ocean). 8-bit greyscale PNG, linear data: 255 = ocean (specular/glossy), 0 = land. Includes below-sea-level inland basins (Caspian Sea, Dead Sea, etc.) as ocean; ice shelves count as land. 1-px anti-aliased edge via area resampling.', bytes: bytes.spec },
    { ...common, key: 'earth/height', map: 'height', files: heightFiles, provenanceClass: 'derived', source: srcUrl, notes: '8-bit greyscale PNG, linear data: value = round(255*min(1,sqrt(max(0,elev_m)/6000))); sea level and bathymetry = 0. Invert: elev_m = 6000*(v/255)^2 (saturates at 6000 m). Only high and low sizes.', bytes: bytes.height },
    { ...common, key: 'earth/normal', map: 'normal', files: normFiles, provenanceClass: 'derived', source: srcUrl, notes: 'Tangent-space normal map, OpenGL convention (R=+east, G=+north, B=up; three.js normalMap default). Computed from land elevation (ocean flat) on R=6371 km sphere with slope EXAGGERATION x6 (set material.normalScale to 1/6 ~ 0.17 for true slopes; default 1 gives pleasing relief). Ultra size is lossless WebP, others PNG. Linear data (no sRGB).', bytes: bytes.norm },
  ]);
}
log('earth done');
