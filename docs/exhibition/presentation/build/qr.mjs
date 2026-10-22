// Regenerates the QR code (deck/img/qr.svg) and the printed URL in deck/index.html from .work/site-url.txt.
//   node docs/exhibition/presentation/build/qr.mjs [url]     (run from the repo root; qrcode lives in .work/deck-tools)
import { createRequire } from 'node:module';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const require = createRequire(resolve('.work/deck-tools/package.json'));
const QRCode = require('qrcode');
const ROOT = resolve('docs/exhibition/presentation');
const urlFile = resolve('.work/site-url.txt');
const url = (process.argv[2] || (existsSync(urlFile) ? readFileSync(urlFile, 'utf8') : '') || 'https://cosmos-astronexus.vercel.app').trim();
const svg = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0, color: { dark: '#000000', light: '#ffffff' } });
writeFileSync(resolve(ROOT, 'deck/img/qr.svg'), svg);
const host = url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const htmlPath = resolve(ROOT, 'deck/index.html');
const html = readFileSync(htmlPath, 'utf8').replace(/(<p class="(?:foot url|url-big)">)[^<]*(<\/p>)/g, `$1${host}$2`);
writeFileSync(htmlPath, html);
console.log('qr + url ->', url);
