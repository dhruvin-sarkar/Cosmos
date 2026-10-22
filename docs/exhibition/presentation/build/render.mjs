// Renders the deck: one PNG per slide (export/slides/NN.png), a PDF (export/Cosmos-SCI-FORGE-2026.pdf) and notes.md.
//   node docs/exhibition/presentation/build/render.mjs [--only 3,4] [--no-pdf]     (run from the repo root)
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire('C:/Projects/Cosmos/package.json');
const { chromium } = require('playwright');
const ROOT = resolve('docs/exhibition/presentation');
const DECK = pathToFileURL(resolve(ROOT, 'deck/index.html')).href;
const OUT = resolve(ROOT, 'export');
const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',').map(Number) : null;
const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);

mkdirSync(resolve(OUT, 'slides'), { recursive: true });
const browser = await chromium.launch({ executablePath: CHROME, args: ['--allow-file-access-from-files'] });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const ready = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    });
    await page.waitForTimeout(150);
  };
  await page.goto(`${DECK}?static#1`);
  await ready();
  const { count, notes, titles } = await page.evaluate(() => window.__deck);
  for (let n = 1; n <= count; n++) {
    if (only && !only.includes(n)) continue;
    await page.evaluate((k) => window.__deck.go(k), n);
    await page.waitForTimeout(80);
    const file = resolve(OUT, 'slides', `${String(n).padStart(2, '0')}.png`);
    await page.screenshot({ path: file, clip: { x: 0, y: 0, width: 1920, height: 1080 } });
    console.log('slide', n, titles[n - 1]);
  }
  // Speaker notes, one section per slide.
  const words = notes.join(' ').split(/\s+/).filter(Boolean).length;
  const md = ['# Cosmos · speaker notes', '',
    `${count} slides, about ${words} words: roughly ${Math.round(words / 140)}–${Math.round(words / 125)} minutes at a calm speaking pace. Generated from the deck (\`deck/index.html\`, the \`<aside class="notes">\` of each slide) by \`build/render.mjs\`; edit the deck, not this file.`, '',
    ...notes.flatMap((t, i) => [`## ${i + 1}. ${titles[i]}`, '', t, ''])].join('\n');
  writeFileSync(resolve(ROOT, 'notes.md'), md);
  writeFileSync(resolve(OUT, 'notes.json'), JSON.stringify({ titles, notes }, null, 1));
  console.log('notes', words, 'words');
  if (!args.includes('--no-pdf')) {
    const pdfPage = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
    await pdfPage.goto(`${DECK}?print`);
    await pdfPage.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map((im) => im.complete ? 0 : new Promise((r) => { im.onload = im.onerror = r; })));
    });
    await pdfPage.pdf({ path: resolve(OUT, 'Cosmos-SCI-FORGE-2026.pdf'), width: '1920px', height: '1080px', printBackground: true, preferCSSPageSize: true });
    console.log('pdf done');
  }
} finally {
  await browser.close();
}
