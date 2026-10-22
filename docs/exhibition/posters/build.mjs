#!/usr/bin/env node
/**
 * Build the Cosmos exhibition posters (A2 portrait) from their HTML sources.
 *
 *   node docs/exhibition/posters/build.mjs [prep] [render] [--only hero|how|explore]
 *
 *   prep    Converts the 4K print captures (G:/CosmosWork/posters/raw2/*.png, made by capture2.mjs from the running app)
 *           into the JPEGs the posters use (assets/img/). Skipped for files that already exist unless --force.
 *   render  Prints each poster with Playwright/Chromium:
 *             pdf/<name>-A2.pdf        exact A2 trim, 420 x 594 mm (for printers that want trim size)
 *             pdf/<name>-A2-bleed.pdf  426 x 600 mm, 3 mm bleed on every side (for print shops; trim 3 mm all round)
 *             preview/<name>.png       screen preview of the trimmed poster (<= 2 MB)
 * With no mode both run. Fonts are bundled in assets/fonts, so the build works offline.
 */
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire('C:/Projects/Cosmos/package.json');
const { chromium } = require('playwright');
const sharp = require('sharp');

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = 'G:/CosmosWork/posters/raw2';
const args = process.argv.slice(2);
const modes = args.filter(a => a === 'prep' || a === 'render');
const doPrep = modes.length === 0 || modes.includes('prep');
const doRender = modes.length === 0 || modes.includes('render');
const force = args.includes('--force');
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : null;

const POSTERS = [
  { name: 'cosmos-poster-1-hero', file: 'poster-1-hero.html', key: 'hero' },
  { name: 'cosmos-poster-2-how-do-we-know', file: 'poster-2-how.html', key: 'how' },
  { name: 'cosmos-poster-3-explore-it', file: 'poster-3-explore.html', key: 'explore' },
];

/** Print images: [source capture, output, width or null (keep), optional extract box in source px]. */
const IMAGES = [
  ['earth-P.png', 'earth-portrait.jpg'],
  ['earth-L.png', 'earth.jpg'],
  ['iss-L.png', 'iss.jpg'],
  ['moon-L.png', 'moon.jpg'],
  ['planets-L.png', 'planets.jpg'],
  ['planets-P.png', 'planets-portrait.jpg'],
  ['jupiter-L.png', 'jupiter.jpg'],
  ['saturn-L.png', 'saturn.jpg'],
  ['saturn-P.png', 'saturn-portrait.jpg'],
  ['trappist-L.png', 'trappist.jpg'],
  ['milkyway-L.png', 'milkyway.jpg'],
  ['milkyway-P.png', 'milkyway-portrait.jpg'],
  ['blackhole-L.png', 'blackhole.jpg'],
  ['blackhole-P.png', 'blackhole-portrait.jpg'],
  ['andromeda-L.png', 'andromeda.jpg'],
  ['web-L.png', 'web.jpg'],
  ['web-P.png', 'web-portrait.jpg'],
  ['cmb-L.png', 'cmb.jpg'],
  ['cmb-P.png', 'cmb-portrait.jpg'],
  ['ui-home.png', 'ui-home.jpg'],
  ['ui-earth-inspector.png', 'ui-earth-inspector.jpg'],
  ['ui-debris-lab.png', 'ui-debris-lab.jpg'],
  ['ui-saturn-inspector.png', 'ui-saturn-inspector.jpg'],
  ['ui-blackhole-lab.png', 'ui-blackhole-lab.jpg'],
  ['ui-tour-proxima.png', 'ui-tour-proxima.jpg'],
  ['ui-interior-earth.png', 'ui-interior-earth.jpg'],
];

/** Round thumbnails for the hero's journey ladder: [capture, output, square side as a fraction of the frame height]. */
const THUMBS = [
  ['earth-L.png', 'thumb-earth.jpg', 0.62],
  ['iss-L.png', 'thumb-iss.jpg', 0.9],
  ['planets-L.png', 'thumb-planets.jpg', 0.55],
  ['saturn-L.png', 'thumb-saturn.jpg', 0.75],
  ['raw:proxima-L.png', 'thumb-proxima.jpg', 0.11, 0.736, 0.348],
  ['raw:trappist-L.png', 'thumb-trappist.jpg', 0.5],
  ['milkyway-L.png', 'thumb-milkyway.jpg', 0.8],
  ['blackhole-L.png', 'thumb-blackhole.jpg', 0.5],
  ['andromeda-L.png', 'thumb-andromeda.jpg', 0.62],
  ['web-L.png', 'thumb-web.jpg', 0.9],
  ['cmb-L.png', 'thumb-cmb.jpg', 0.78],
];

async function prep() {
  const out = resolve(HERE, 'assets/img');
  mkdirSync(out, { recursive: true });
  for (const [src, dst, frac, cx = 0.5, cy = 0.5] of THUMBS) {
    const from = !src.startsWith('raw:') && existsSync(`${RAW}/${src}`) ? `${RAW}/${src}` : `G:/CosmosWork/posters/raw/${src.replace('raw:', '')}`;
    const to = resolve(out, dst);
    if (!existsSync(from) || (existsSync(to) && !force)) continue;
    const m = await sharp(from).metadata();
    const side = Math.round(m.height * frac);
    await sharp(from).extract({ left: Math.round(m.width * cx - side / 2), top: Math.round(m.height * cy - side / 2), width: side, height: side })
      .resize(480, 480).jpeg({ quality: 90, mozjpeg: true }).toFile(to);
    console.log('thumb', dst, 'from', from.includes('raw2') ? 'raw2' : 'raw');
  }
  for (const [src, dst] of IMAGES) {
    const from = `${RAW}/${src}`;
    const to = resolve(out, dst);
    if (!existsSync(from)) { console.log('missing capture', src); continue; }
    if (existsSync(to) && !force) continue;
    await sharp(from).jpeg({ quality: 90, mozjpeg: true, chromaSubsampling: '4:4:4' }).toFile(to);
    console.log('prep', dst, (statSync(to).size / 1e6).toFixed(2), 'MB');
  }
}

async function render() {
  const siteFile = 'C:/Projects/Cosmos/.work/site-url.txt';
  const site = (existsSync(siteFile) ? readFileSync(siteFile, 'utf8').trim() : '') || 'https://cosmos-astronexus.vercel.app';
  const js = readFileSync(resolve(HERE, 'site.js'), 'utf8').replace(/window\.COSMOS_SITE_URL = '[^']*';/, `window.COSMOS_SITE_URL = '${site}';`);
  writeFileSync(resolve(HERE, 'site.js'), js);
  // QR to the live site: dark modules on a white plate (inverted codes fail on some phone scanners), error level M.
  try {
    execFileSync('npx', ['--yes', 'qrcode', '-t', 'svg', '-e', 'M', '-q', '4', '-d', '#000000', '-l', '#FFFFFF', '-o', resolve(HERE, 'assets/qr-site.svg'), site], { stdio: 'ignore', shell: process.platform === 'win32' });
  } catch (e) { console.log('QR not regenerated (offline?); keeping assets/qr-site.svg'); }
  console.log('site', site);
  mkdirSync(resolve(HERE, 'pdf'), { recursive: true });
  mkdirSync(resolve(HERE, 'preview'), { recursive: true });
  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(p => existsSync(p));
  const browser = await chromium.launch({ headless: true, ...(chrome ? { executablePath: chrome } : {}) });
  try {
    for (const p of POSTERS) {
      if (only && only !== p.key) continue;
      const url = pathToFileURL(resolve(HERE, p.file)).href;
      // 1 mm = 96 / 25.4 CSS px.
      const px = mm => Math.round((mm * 96) / 25.4);
      const page = await browser.newPage({ viewport: { width: px(426), height: px(600) }, deviceScaleFactor: 1 });
      page.on('pageerror', e => console.log('[pageerror]', p.key, String(e)));
      page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('[console]', p.key, m.text()); });
      await page.goto(url, { waitUntil: 'load' });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(() => (window.posterReady ? window.posterReady : null));
      // Bleed PDF
      await page.emulateMedia({ media: 'print' });
      const bleedPdf = resolve(HERE, `pdf/${p.name}-A2-bleed.pdf`);
      await page.pdf({ path: bleedPdf, width: '426mm', height: '600mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
      // Trimmed (exact A2)
      await page.evaluate(() => {
        document.documentElement.classList.add('trimmed');
        const s = document.createElement('style');
        s.id = 'trim-page';
        s.textContent = '@page { size: 420mm 594mm; margin: 0; }';
        document.head.appendChild(s);
      });
      const trimPdf = resolve(HERE, `pdf/${p.name}-A2.pdf`);
      await page.pdf({ path: trimPdf, width: '420mm', height: '594mm', printBackground: true, margin: { top: 0, right: 0, bottom: 0, left: 0 }, preferCSSPageSize: false });
      // Preview PNG of the trimmed poster
      await page.emulateMedia({ media: 'screen' });
      await page.setViewportSize({ width: px(420), height: px(594) });
      const buf = await page.screenshot({ type: 'png', clip: { x: 0, y: 0, width: px(420), height: px(594) } });
      const prev = resolve(HERE, `preview/${p.name}.png`);
      let width = 1587;
      for (;;) {
        await sharp(buf).resize({ width }).png({ palette: true, quality: 92, effort: 10, compressionLevel: 9 }).toFile(prev);
        if (statSync(prev).size <= 2e6 || width < 900) break;
        width = Math.round(width * 0.85);
      }
      // Chromium rounds the page to whole CSS pixels (A2 comes out 420.2 x 594.1 mm). Patch the MediaBox to the exact
      // size with a same-length string, so the xref offsets stay valid. The content origin is top-left, so this trims
      // at most 0.1 mm of black off the top edge.
      for (const [file, from, to] of [[trimPdf, '1191.12 1684.08', '1190.55 1683.78'], [bleedPdf, '1207.91992 1700.88', '1207.55906 1700.79']]) {
        const bin = readFileSync(file).toString('latin1');
        const tag = `/MediaBox [0 0 ${from}]`;
        if (bin.includes(tag)) writeFileSync(file, Buffer.from(bin.replace(tag, `/MediaBox [0 0 ${to}]`), 'latin1'));
        else console.log('MediaBox not patched in', file);
      }
      const mb = f => (statSync(f).size / 1e6).toFixed(1) + ' MB';
      console.log(p.key, 'bleed', mb(bleedPdf), 'trim', mb(trimPdf), 'preview', mb(prev), width + 'px');
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

if (doPrep) await prep();
if (doRender) await render();
