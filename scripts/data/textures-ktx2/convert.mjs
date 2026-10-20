#!/usr/bin/env node
/**
 * KTX2 / Basis Universal conversion of the HD texture tiers (>= 4096 px wide) the app can actually load.
 *
 *   node scripts/data/textures-ktx2/convert.mjs            # convert new / changed maps, rewrite the manifest
 *   node scripts/data/textures-ktx2/convert.mjs --list     # print the plan (codec, estimated size), convert nothing
 *   node scripts/data/textures-ktx2/convert.mjs --only mars,earth/day --force --jobs 2
 *
 * Tool: KTX-Software `ktx create` (Apache-2.0, https://github.com/KhronosGroup/KTX-Software), unpacked into
 * data-raw/big/tools/ktx/ (override with KTX_BIN). Output: public/textures/<body>/<name>.ktx2 next to the source and
 * the manifest public/textures/ktx2.json, which src/core/textures/ reads at runtime (missing entry -> JPEG/PNG path).
 *
 * Which files: the tiers the resolvers reach (src/domains/solar/textures.ts: best of hd.json 8k/4k + index.json
 * ultra/high; src/domains/earth/textures.ts: the merged Earth/Moon table incl. '<path>@4096' downscales). Codecs:
 *   - data maps (normal/specular/clouds/height): UASTC (+RDO, zstd), linear;
 *   - a body's top colour tier: UASTC (+RDO, zstd), sRGB  -> BC7 on desktop GPUs, near-lossless;
 *   - lower colour tiers (4K under an 8K): ETC1S / BasisLZ, sRGB -> small files for distant bodies.
 * Every file carries a full mip chain (wrap filtering: the antimeridian has no seam) and bottom-left texcoord origin
 * (three uploads compressed data without flipY; this matches the ImageBitmap path's flipped orientation).
 * Incremental: a file is re-encoded only when its source size/mtime changed (or with --force).
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const PUB = path.join(ROOT, 'public');
const TEX = path.join(PUB, 'textures');
const MANIFEST = path.join(TEX, 'ktx2.json');
const TMP = path.join(ROOT, 'data-raw/big/ktx2-tmp');
const KTX = process.env.KTX_BIN ?? path.join(ROOT, 'data-raw/big/tools/ktx/bin/ktx.exe');

const args = process.argv.slice(2);
const flag = (n) => args.includes(n);
const opt = (n, d) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : d; };
const LIST = flag('--list');
const ETC1S = flag('--etc1s');
const FORCE = flag('--force');
const ONLY = opt('--only', '')?.split(',').filter(Boolean) ?? [];
const JOBS = Number(opt('--jobs', '2'));
const THREADS = Number(opt('--threads', '8'));
const MIN_WIDTH = Number(opt('--min-width', '4096'));

const EARTH_MOON_ROLES = new Set(['day', 'night', 'clouds', 'specular', 'normal', 'color']);
const DATA_ROLES = new Set(['normal', 'specular', 'clouds', 'height', 'bump', 'coverage']);
const readJson = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };

// ---------------------------------------------------------------------------------------------- reachable set
function earthMoonTable(index, hd) {
  // Mirrors mergeTextureTables() in src/domains/earth/textures.ts.
  const t = {
    earth: {
      day: { low: 'textures/earth/day_2k.jpg', high: 'textures/earth/day_4k.jpg', ultra: 'textures/earth/day_8k.jpg' },
      night: { low: 'textures/earth/night_2k.jpg', high: 'textures/earth/night_4k.jpg', ultra: 'textures/earth/night_8k.jpg' },
      clouds: { low: 'textures/earth/clouds_2k.jpg', high: 'textures/earth/clouds_4k.jpg', ultra: 'textures/earth/clouds_8k.jpg' },
      specular: { low: 'textures/earth/specular_2k.png', high: 'textures/earth/specular_4k.png', ultra: 'textures/earth/specular_8k.png' },
      normal: { low: 'textures/earth/normal_2k.png', high: 'textures/earth/normal_4k.png', ultra: 'textures/earth/normal_8k.webp' },
    },
    moon: {
      color: { low: 'textures/moon/color_1k.jpg', high: 'textures/moon/color_4k.jpg' },
      normal: { low: 'textures/moon/normal_1k.png', high: 'textures/moon/normal_4k.png' },
    },
  };
  const SIZE = { '1k': 'low', '2k': 'low', '4k': 'high', '8k': 'ultra', '16k': 'max' };
  for (const body of ['earth', 'moon']) {
    for (const [map, tiers] of Object.entries(index?.bodies?.[body] ?? {})) {
      if (!tiers || typeof tiers !== 'object') continue;
      const slot = (t[body][map] ??= {});
      for (const k of ['low', 'high', 'ultra', 'max']) if (typeof tiers[k] === 'string') slot[k] = tiers[k];
    }
    for (const [map, sizes] of Object.entries(hd?.bodies?.[body] ?? {})) {
      if (!sizes || typeof sizes !== 'object' || Array.isArray(sizes)) continue;
      const target = body === 'earth' && map === 'color' ? 'day' : map === 'bump' ? 'height' : map;
      const slot = (t[body][target] ??= {});
      const got = new Set();
      for (const [size, p] of Object.entries(sizes)) {
        const tier = SIZE[size.toLowerCase()];
        if (tier && typeof p === 'string') { slot[tier] = p.replace(/^\/+/, ''); got.add(tier); }
      }
      if (got.has('ultra') && !got.has('high') && slot.ultra) slot.high = `${slot.ultra}@4096`;
    }
  }
  return t;
}

function reachable() {
  const index = readJson(path.join(TEX, 'index.json'));
  const hd = readJson(path.join(TEX, 'hd.json'));
  /** key -> { body, role } */
  const out = new Map();
  const add = (p, body, role) => { if (p && !out.has(p)) out.set(p, { body, role }); };
  const em = earthMoonTable(index, hd);
  for (const [body, maps] of Object.entries(em)) {
    for (const [role, tiers] of Object.entries(maps)) {
      if (!EARTH_MOON_ROLES.has(role)) continue; // the maps src/domains/earth/layer.ts actually binds
      for (const k of ['high', 'ultra', 'max']) add(tiers[k], body, role);
    }
  }
  const bodies = new Set([...Object.keys(index?.bodies ?? {}), ...Object.keys(hd?.bodies ?? {})]);
  for (const body of bodies) {
    if (body === 'earth') continue; // the Moon is also listed below: the moons domain may resolve it through solar/textures
    for (const role of ['color', 'atmosphere', 'normal']) { // the roles bodiesLayer/moonsLayer resolve
      const h = hd?.bodies?.[body]?.[role];
      const idx = index?.bodies?.[body]?.[role];
      const hdRole = h && typeof h === 'object' && !Array.isArray(h) ? h : {};
      // Mirrors texturePlanInfo() in src/domains/solar/textures.ts.
      const ultra = [hdRole['8k'], hdRole['4k'], idx?.ultra, idx?.high].find((p) => typeof p === 'string');
      const high = [hdRole['4k'], idx?.high].find((p) => typeof p === 'string');
      add(ultra, body, role);
      add(high, body, role);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------- planning
async function plan() {
  const keys = reachable();
  const items = [];
  for (const [key, { body, role }] of keys) {
    const m = /^(.*)@(\d+)$/.exec(key);
    const src = m ? m[1] : key;
    const width = m ? Number(m[2]) : null;
    const file = path.join(PUB, src);
    if (!fs.existsSync(file)) continue;
    let meta;
    try { meta = await sharp(file, { limitInputPixels: false }).metadata(); } catch { continue; }
    const outW = width ?? meta.width;
    if (outW < MIN_WIDTH) continue;
    const outH = Math.round((meta.height * outW) / meta.width);
    const skip = width ? Math.log2(meta.width / width) : 0;
    if (width && Number.isInteger(skip) && skip > 0 && meta.width >= MIN_WIDTH) {
      // A power-of-two downscale of a converted map: the runtime uploads the KTX2's mip chain from level `skip`.
      const base0 = path.basename(src).replace(/\.[^.]+$/, '');
      items.push({ key, src, dst: path.posix.join(path.posix.dirname(src), `${base0}.ktx2`), body, role, width: outW, height: outH, meta, linear: DATA_ROLES.has(role), alias: src, skipLevels: skip });
      if (!keys.has(src)) keys.set(src, { body, role });
      continue;
    }
    const base = path.basename(src).replace(/\.[^.]+$/, '');
    const dst = path.posix.join(path.posix.dirname(src), `${base}${width ? `.w${width}` : ''}.ktx2`);
    items.push({ key, src, dst, body, role, width: outW, height: outH, meta, linear: DATA_ROLES.has(role) });
  }
  // Top colour tier per body/role -> UASTC; lower colour tiers -> ETC1S.
  const top = new Map();
  for (const it of items) top.set(`${it.body}/${it.role}`, Math.max(top.get(`${it.body}/${it.role}`) ?? 0, it.width));
  for (const it of items) {
    // UASTC throughout: ETC1S's coarse chroma tints near-neutral surfaces (Moon, icy moons) yellow-green. --etc1s
    // brings it back for 4K colour tiers under an 8K tier when disk space matters more than fidelity.
    it.codec = !ETC1S || it.linear || it.body === 'earth' || it.width >= 8192 || it.width >= top.get(`${it.body}/${it.role}`) ? 'uastc' : 'etc1s';
    it.rdo = it.role === 'normal' ? 1.0 : it.linear ? 2.0 : 3.0;
  }
  return items.filter((it) => ONLY.length === 0 || ONLY.some((o) => it.key.includes(o)));
}

// ---------------------------------------------------------------------------------------------- conversion
function run(cmd, argv) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, argv, { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    p.stdout.on('data', () => {});
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(cmd)} exited ${code}: ${err.slice(-400)}`))));
  });
}

/** ktx create reads 8-bit RGB PNG/JPEG; anything else (WebP, 16-bit, grey, alpha, downscale) goes through sharp. */
async function prepareInput(it) {
  const m = it.meta;
  const direct = (m.format === 'jpeg' || m.format === 'png') && m.channels === 3 && m.depth === 'uchar' && it.width === m.width;
  if (direct) return { input: path.join(PUB, it.src), tmp: null };
  fs.mkdirSync(TMP, { recursive: true });
  const tmp = path.join(TMP, `${it.dst.replace(/[\\/]/g, '_')}.png`);
  let img = sharp(path.join(PUB, it.src), { limitInputPixels: false }).removeAlpha();
  if (m.channels < 3) img = img.toColourspace('srgb');
  if (it.width !== m.width) img = img.resize(it.width, it.height, { kernel: 'lanczos3' });
  await img.toColourspace(m.depth === 'ushort' ? 'srgb' : 'srgb').png({ compressionLevel: 1 }).toFile(tmp);
  return { input: tmp, tmp };
}

async function convert(it) {
  const { input, tmp } = await prepareInput(it);
  const out = path.join(PUB, it.dst);
  const part = `${out}.part`;
  const argv = ['create', '--format', it.linear ? 'R8G8B8_UNORM' : 'R8G8B8_SRGB', '--assign-tf', it.linear ? 'linear' : 'srgb',
    '--generate-mipmap', '--mipmap-wrap', 'wrap', '--convert-texcoord-origin', 'bottom-left', '--threads', String(THREADS)];
  if (it.codec === 'uastc') argv.push('--encode', 'uastc', '--uastc-quality', '1', '--uastc-rdo', '--uastc-rdo-l', String(it.rdo), '--uastc-rdo-d', '8192', '--zstd', '20');
  else argv.push('--encode', 'basis-lz', '--clevel', '2', '--qlevel', '255');
  argv.push(input, part);
  try {
    await run(KTX, argv);
    fs.renameSync(part, out);
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
    fs.rmSync(part, { force: true });
  }
}

/** Estimated GPU bytes after transcoding (BC7 = 1 byte/px for both codecs on desktop) incl. the mip chain. */
const vramBytes = (w, h) => { let s = 0; for (let x = w, y = h; ; x = Math.max(1, x >> 1), y = Math.max(1, y >> 1)) { s += Math.ceil(x / 4) * Math.ceil(y / 4) * 16; if (x === 1 && y === 1) break; } return s; };

async function main() {
  if (!LIST && !fs.existsSync(KTX)) throw new Error(`ktx not found at ${KTX} (set KTX_BIN)`);
  const items = await plan();
  const manifest = readJson(MANIFEST) ?? { version: 1, entries: {} };
  manifest.entries ??= {};
  const todo = [];
  for (const it of items) {
    const st = fs.statSync(path.join(PUB, it.src));
    it.srcBytes = st.size;
    it.srcMtimeMs = Math.round(st.mtimeMs);
    if (it.alias) continue; // served from the source's KTX2 (written after the conversions)
    const prev = manifest.entries[it.key];
    const fresh = prev && prev.srcBytes === it.srcBytes && prev.srcMtimeMs === it.srcMtimeMs && prev.codec === it.codec && fs.existsSync(path.join(PUB, prev.ktx2));
    if (!fresh || FORCE) todo.push(it);
  }
  if (LIST) {
    for (const it of items) console.log(`${todo.includes(it) ? '*' : ' '} ${it.codec.padEnd(5)} ${it.linear ? 'lin ' : 'srgb'} ${String(it.width).padStart(5)}  ${it.key}  ->  ${it.dst}`);
    console.log(`${items.length} reachable HD maps, ${todo.length} to (re)convert`);
    return;
  }
  const free = fs.statfsSync(PUB);
  if ((free.bavail * free.bsize) / 1e9 < 3.5) throw new Error('less than 3.5 GB free on the public/ drive: refusing to write');
  let next = 0, done = 0;
  const t0 = Date.now();
  const worker = async () => {
    while (next < todo.length) {
      const it = todo[next++];
      const t = Date.now();
      try {
        await convert(it);
        const bytes = fs.statSync(path.join(PUB, it.dst)).size;
        // Re-read before writing so concurrent / interrupted runs never drop each other's entries.
        Object.assign(manifest.entries, readJson(MANIFEST)?.entries ?? {});
        manifest.entries[it.key] = {
          ktx2: it.dst, codec: it.codec, colorSpace: it.linear ? 'linear' : 'srgb', width: it.width, height: it.height,
          bytes, vramBytes: vramBytes(it.width, it.height), srcBytes: it.srcBytes, srcMtimeMs: it.srcMtimeMs,
        };
        manifest.generated = new Date().toISOString();
        manifest.tool = 'KTX-Software ktx create (Apache-2.0); scripts/data/textures-ktx2/convert.mjs';
        fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
        console.log(`[${++done}/${todo.length}] ${it.codec} ${it.key} ${(bytes / 1e6).toFixed(1)} MB (${((Date.now() - t) / 1000).toFixed(0)} s)`);
      } catch (e) {
        console.error(`FAILED ${it.key}: ${e.message}`);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, JOBS) }, worker));
  Object.assign(manifest.entries, { ...(readJson(MANIFEST)?.entries ?? {}), ...manifest.entries });
  // Power-of-two downscales ('<path>@4096'): the source's KTX2, uploaded from mip level `skipLevels`.
  for (const it of items) {
    if (!it.alias) continue;
    const src = manifest.entries[it.alias];
    if (src && !src.skipLevels) manifest.entries[it.key] = { ...src, width: it.width, height: it.height, vramBytes: vramBytes(it.width, it.height), skipLevels: it.skipLevels };
    else delete manifest.entries[it.key];
  }
  // Drop entries whose KTX2 file vanished, then KTX2 files no entry references (superseded encodes, stale .part files).
  for (const [k, e] of Object.entries(manifest.entries)) if (!fs.existsSync(path.join(PUB, e.ktx2))) delete manifest.entries[k];
  const used = new Set(Object.values(manifest.entries).map((e) => path.join(PUB, e.ktx2)));
  for (const d of fs.readdirSync(TEX)) {
    const dir = path.join(TEX, d);
    if (!fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) if (/\.ktx2(\.part)?$/.test(f) && !used.has(path.join(dir, f))) fs.rmSync(path.join(dir, f));
  }
  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 1)}\n`);
  const files = new Map(Object.values(manifest.entries).map((e) => [e.ktx2, e.bytes]));
  const total = [...files.values()].reduce((s, b) => s + b, 0);
  console.log(`done in ${((Date.now() - t0) / 60000).toFixed(1)} min; ${files.size} KTX2 files, ${(total / 1e6).toFixed(0)} MB`);
}

main().catch((e) => { console.error(e); process.exit(1); });
