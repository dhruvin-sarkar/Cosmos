// tex-moons: colour (greyscale) maps of the five major Uranian moons from the Voyager 2 USGS mosaics distributed by the
// JPL Solar System Simulator (space.jpl.nasa.gov/tmaps, 1440x720 simple cylindrical, 4 px/deg, x=0 at 180 W, east-positive;
// orientation verified against our Ganymede/Callisto maps of the same series and Oberon's dark-floored Hamlet/Othello at ~44 E).
// Voyager 2 flew past at southern summer (subsolar latitude ~ -81 deg), so only the southern hemispheres were imaged:
// the unimaged north is filled with an albedo-matched neutral tone (mean of the observed surface) via a smooth pull-push
// ramp, recorded in coverage_* masks. No detail is invented.
//   node scripts/data/textures-hd/build-uranian.mjs [miranda ariel umbriel titania oberon]
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TEX, rel, log, sharp } from './lib.mjs';
import { pullPushFill } from '../textures/process.mjs';

const SRC = path.join(ROOT, 'data-raw', 'big', 'tex-moons', 'jpl');
const FRAG = path.join(ROOT, 'data-raw', 'textures-hd');
const BODIES = {
  ariel: { file: 'ura1vuu2', name: 'Ariel' },
  umbriel: { file: 'ura2vuu2', name: 'Umbriel' },
  titania: { file: 'ura3vuu2', name: 'Titania' },
  oberon: { file: 'ura4vuu2', name: 'Oberon' },
  miranda: { file: 'ura5vuu2', name: 'Miranda' },
};

async function source(body) {
  const f = path.join(SRC, `${BODIES[body].file}.tif`);
  if (!fs.existsSync(f)) {
    fs.mkdirSync(SRC, { recursive: true });
    const res = await fetch(`https://space.jpl.nasa.gov/tmaps/pix/${BODIES[body].file}.tif`);
    if (!res.ok) throw new Error(`download ${body}: HTTP ${res.status}`);
    fs.writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  return f;
}

/** Erode a 0/1 mask by r pixels (box, horizontal wrap). */
function erode(mask, W, H, r) {
  let m = mask;
  for (let it = 0; it < r; it++) {
    const o = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!m[i]) continue;
      const l = y * W + ((x + W - 1) % W), rr = y * W + ((x + 1) % W);
      const u = y > 0 ? i - W : i, d = y < H - 1 ? i + W : i;
      o[i] = m[l] && m[rr] && m[u] && m[d] ? 1 : 0;
    }
    m = o;
  }
  return m;
}

async function build(body) {
  const { data: g, info } = await sharp(await source(body)).greyscale().raw().toBuffer({ resolveWithObject: true });
  const W0 = info.width, H0 = info.height;
  // The last source column is a dark mosaic edge: replace it by the mean of its neighbours across the wrap.
  for (let y = 0; y < H0; y++) { const r = y * W0; if (g[r + W0 - 1] > 1) g[r + W0 - 1] = Math.round((g[r + W0 - 2] + g[r]) / 2); }
  let mask = new Uint8Array(W0 * H0);
  // No-data = the zero-valued region connected to the unimaged north (flood fill from the top row, horizontal wrap).
  // Enclosed zero pixels inside the imaged hemisphere are real dark terrain clipped to 0 (e.g. Hamlet's floor on Oberon):
  // they are kept as data at the darkest observed level.
  const isVoid = new Uint8Array(W0 * H0);
  {
    const stack = [];
    for (let x = 0; x < W0; x++) if (g[x] <= 1) { isVoid[x] = 1; stack.push(x); }
    while (stack.length) {
      const i = stack.pop(), x = i % W0, y = (i - x) / W0;
      const nb = [y * W0 + ((x + 1) % W0), y * W0 + ((x + W0 - 1) % W0), y > 0 ? i - W0 : -1, y < H0 - 1 ? i + W0 : -1];
      for (const j of nb) if (j >= 0 && !isVoid[j] && g[j] <= 1) { isVoid[j] = 1; stack.push(j); }
    }
  }
  let darkest = 255; for (let i = 0; i < W0 * H0; i++) if (g[i] > 1 && g[i] < darkest) darkest = g[i];
  for (let i = 0; i < W0 * H0; i++) { mask[i] = isVoid[i] ? 0 : 1; if (!isVoid[i] && g[i] <= 1) g[i] = darkest; }
  mask = erode(mask, W0, H0, 3); // drop the ragged limb/terminator rim of the mosaic
  // Within ~16 px (4 deg) of the coverage edge the frames sit at the terminator / limb: drop pixels much darker than the
  // observed median there (terminator shading and mosaic seams, not albedo), then erode again.
  {
    const vals = []; for (let i = 0; i < W0 * H0; i += 7) if (mask[i]) vals.push(g[i]);
    vals.sort((a, b) => a - b); const med = vals[vals.length >> 1];
    const inner = erode(mask, W0, H0, 16);
    for (let i = 0; i < W0 * H0; i++) if (mask[i] && !inner[i] && g[i] < 0.62 * med) mask[i] = 0;
    mask = erode(mask, W0, H0, 2);
  }
  // Clip saturated outliers (limb glints) to the 99.7th percentile of the observed surface.
  const hist = new Uint32Array(256); let n = 0;
  for (let i = 0; i < W0 * H0; i++) if (mask[i]) { hist[g[i]]++; n++; }
  let acc = 0, p997 = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc >= n * 0.997) { p997 = v; break; } }
  // Upsample grey + mask to the 2k working grid (lanczos for the image, bilinear for the mask).
  const W = 2048, H = 1024;
  const gc = Buffer.alloc(W0 * H0); for (let i = 0; i < W0 * H0; i++) gc[i] = Math.min(g[i], p997);
  // Resample with horizontal wrap padding so the antimeridian stays seamless.
  const wrapResize = async (buf, kernel) => {
    const P = 8, Wp = W0 + 2 * P, padded = Buffer.alloc(Wp * H0);
    for (let y = 0; y < H0; y++) for (let x = 0; x < Wp; x++) padded[y * Wp + x] = buf[y * W0 + ((x - P + W0) % W0)];
    const po = Math.round((P * W) / W0);
    return sharp(padded, { raw: { width: Wp, height: H0, channels: 1 } }).resize(W + 2 * po, H, { kernel, fit: 'fill' })
      .extract({ left: po, top: 0, width: W, height: H }).toColourspace('b-w').raw().toBuffer();
  };
  const up = await wrapResize(gc, 'lanczos3');
  const mUp = await wrapResize(Buffer.from(mask.map((v) => v * 255)), 'linear');
  const rgba = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = up[i]; rgba[i * 4 + 3] = mUp[i] >= 250 ? 255 : 0; }
  const f = pullPushFill({ data: rgba, width: W, height: H, channels: 4 });
  const cov = f.coverage;
  // Albedo-matched neutral: cos(lat)-weighted mean of the observed pixels.
  let ms = 0, mw = 0;
  for (let y = 0; y < H; y++) { const w = Math.cos(((90 - (180 * (y + 0.5)) / H) * Math.PI) / 180); for (let x = 0; x < W; x++) { const i = y * W + x; if (cov[i]) { ms += f.img.data[i * 3] * w; mw += w; } } }
  const mean = ms / mw;
  // Smooth ramp (~4 deg) from the observed edge into the flat neutral fill.
  const wb = await sharp(Buffer.from(cov.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } }).blur(12).toColourspace('b-w').raw().toBuffer();
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const k = cov[i] ? 1 : Math.min(1, (wb[i] / 255) * 2) * 0.7;
    out[i] = f.img.data[i * 3] * k + mean * (1 - k);
  }
  // Clean poles: within 2 deg of each pole converge each row to its mean (no pinched swirl at the singularity).
  const band = Math.round((2 / 180) * H);
  for (let y = 0; y < H; y++) {
    const dp = Math.min(y, H - 1 - y);
    if (dp >= band) continue;
    let rs = 0; for (let x = 0; x < W; x++) rs += out[y * W + x];
    const rm = rs / W, t = 1 - dp / band;
    for (let x = 0; x < W; x++) out[y * W + x] = out[y * W + x] * (1 - t) + rm * t;
  }
  const grey = Buffer.alloc(W * H); for (let i = 0; i < W * H; i++) grey[i] = Math.max(0, Math.min(255, Math.round(out[i])));
  const observed = cov.reduce((a, v, i) => a + v * Math.cos(((90 - (180 * (Math.floor(i / W) + 0.5)) / H) * Math.PI) / 180), 0) / cov.reduce((a, _v, i) => a + Math.cos(((90 - (180 * (Math.floor(i / W) + 0.5)) / H) * Math.PI) / 180), 0);
  const dir = path.join(TEX, body); fs.mkdirSync(dir, { recursive: true });
  const frags = [];
  const src = { name: `Voyager 2 ISS global mosaic of ${BODIES[body].name} (USGS Astrogeology; T. Becker), 4 px/deg simple cylindrical, distributed by the JPL Solar System Simulator`, url: `https://space.jpl.nasa.gov/tmaps/pix/${BODIES[body].file}.tif`, license: 'public domain (NASA/JPL-Caltech/USGS)', retrieved: '2026-10-19' };
  const note = `Greyscale Voyager 2 mosaic (source 1440x720, 4 px/deg; 2k is a 1.42x lanczos upsample, no added detail). Only the southern hemisphere was sunlit during the 1986 flyby: observed (area-weighted) fraction ${observed.toFixed(3)}; the unimaged north is an albedo-matched neutral fill (mean observed grey ${mean.toFixed(1)}/255) ramped over ~4 deg - illustrative, no real detail; see coverage_*.png.`;
  for (const [tier, w] of [['2k', 2048], ['1k', 1024]]) {
    const p = path.join(dir, `color_${tier}.jpg`);
    const info2 = await sharp(grey, { raw: { width: W, height: H, channels: 1 } }).resize(w, w / 2, { kernel: 'lanczos3' }).toColourspace('srgb').jpeg({ quality: 92, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(p);
    frags.push({ body, map: 'color', tier, path: rel(p), bytes: info2.size, source: src, note });
    const c = path.join(dir, `coverage_${tier}.png`);
    const info3 = await sharp(Buffer.from(cov.map((v) => (v ? 255 : 0))), { raw: { width: W, height: H, channels: 1 } }).resize(w, w / 2, { kernel: 'linear' }).png({ compressionLevel: 9 }).toFile(c);
    frags.push({ body, map: 'coverage', tier, path: rel(c), bytes: info3.size, source: src, note: '1 = imaged by Voyager 2, 0 = neutral fill' });
  }
  fs.writeFileSync(path.join(FRAG, `hd2.moons-${body}.json`), JSON.stringify(frags, null, 1));
  log(body, 'observed', observed.toFixed(3), 'mean', mean.toFixed(1), 'p99.7', p997);
}

for (const b of process.argv.length > 2 ? process.argv.slice(2) : Object.keys(BODIES)) await build(b);
