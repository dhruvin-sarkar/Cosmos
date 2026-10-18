#!/usr/bin/env node
/**
 * Screenshot a Cosmos page with the real GPU (headless Chrome, ANGLE D3D11).
 *
 *   node tools/shot.mjs <url> <out.png> [--width 1600] [--height 900] [--wait 2500] [--eval "<js>"]
 *        [--frames 30] [--timeout 30000] [--strict] [--quiet]
 *
 * Steps: launch → open url → wait for window.__cosmos.ready (if the page publishes it; bounded by --timeout)
 * → run --eval (may be repeated; awaited if it returns a promise) → wait --wait ms → wait --frames animation
 * frames → write the PNG → print window.__cosmos.perf() as JSON. Console errors/warnings and page errors are
 * printed as they occur. --strict exits with code 1 when the page threw or logged an error.
 * A relative url is resolved against http://localhost:5173/ (e.g. "sandbox/core.html?scale=12").
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Projects/Cosmos/package.json');
const { chromium } = require('playwright');

const CHROME_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Users/dhruv/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',
];
const GPU_ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'];

function parseArgs(argv) {
  const opts = { width: 1600, height: 900, wait: 2500, frames: 30, timeout: 30000, evals: [], strict: false, quiet: false, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`Missing value for ${a}`);
      return argv[++i];
    };
    switch (a) {
      case '--width': opts.width = Number(next()); break;
      case '--height': opts.height = Number(next()); break;
      case '--wait': opts.wait = Number(next()); break;
      case '--frames': opts.frames = Number(next()); break;
      case '--timeout': opts.timeout = Number(next()); break;
      case '--eval': opts.evals.push(next()); break;
      case '--strict': opts.strict = true; break;
      case '--quiet': opts.quiet = true; break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown option ${a}`);
        opts.positional.push(a);
    }
  }
  return opts;
}

const USAGE = 'usage: node tools/shot.mjs <url> <out.png> [--width 1600] [--height 900] [--wait 2500] [--eval "<js>"] [--frames 30] [--timeout 30000] [--strict] [--quiet]';

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(String(err.message ?? err));
    console.error(USAGE);
    process.exit(2);
  }
  if (opts.help || opts.positional.length < 2) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 2);
  }
  const [rawUrl, outPath] = opts.positional;
  const url = /^[a-z]+:\/\//i.test(rawUrl) ? rawUrl : new URL(rawUrl.replace(/^\/+/, ''), 'http://localhost:5173/').href;
  const out = resolve(outPath);
  mkdirSync(dirname(out), { recursive: true });

  const executablePath = CHROME_PATHS.find(p => existsSync(p));
  const browser = await chromium.launch({ executablePath, headless: true, args: GPU_ARGS });
  let pageErrors = 0;
  let consoleErrors = 0;
  const t0 = Date.now();
  const log = (...a) => {
    if (!opts.quiet) console.log(...a);
  };
  try {
    const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
    page.on('console', msg => {
      const type = msg.type();
      if (type === 'error') {
        const where = msg.location()?.url ?? '';
        if (/favicon\.ico/.test(where)) return;
        consoleErrors++;
        console.log(`[console.error] ${msg.text()}${where && msg.text().startsWith('Failed to load resource') ? ` (${where})` : ''}`);
      } else if (type === 'warning') {
        console.log(`[console.warn] ${msg.text()}`);
      }
    });
    page.on('pageerror', err => {
      pageErrors++;
      console.log(`[pageerror] ${err.message}${err.stack ? `\n${err.stack.split('\n').slice(1, 4).join('\n')}` : ''}`);
    });
    page.on('response', res => {
      if (res.status() >= 400) console.log(`[http ${res.status()}] ${res.url()}`);
    });
    page.on('requestfailed', req => {
      const failure = req.failure()?.errorText ?? '';
      if (!failure.includes('ERR_ABORTED')) console.log(`[requestfailed] ${req.url()} ${failure}`);
    });

    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: opts.timeout });

    const readyState = await page
      .evaluate(async timeoutMs => {
        const start = performance.now();
        while (!window.__cosmos && performance.now() - start < Math.min(timeoutMs, 5000)) {
          await new Promise(r => setTimeout(r, 50));
        }
        if (!window.__cosmos) return 'no-handle';
        const timeout = new Promise(r => setTimeout(() => r('timeout'), Math.max(0, timeoutMs - (performance.now() - start))));
        try {
          return await Promise.race([window.__cosmos.ready.then(() => 'ready'), timeout]);
        } catch (e) {
          return `rejected: ${e?.message ?? e}`;
        }
      }, opts.timeout)
      .catch(err => `evaluate-failed: ${err.message}`);
    log(`[shot] ${url} → ${readyState} after ${Date.now() - t0} ms`);

    for (const code of opts.evals) {
      try {
        const result = await page.evaluate(async src => {
          // eslint-disable-next-line no-new-func
          const value = await new Function(`return (async () => { return (${src}); })()`)();
          try {
            return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
          } catch {
            return String(value);
          }
        }, code);
        if (result !== undefined) log(`[eval] ${JSON.stringify(result)}`);
      } catch (err) {
        pageErrors++;
        console.log(`[eval-error] ${err.message.split('\n')[0]}`);
      }
    }

    if (opts.wait > 0) await page.waitForTimeout(opts.wait);
    if (opts.frames > 0) {
      await page.evaluate(
        n =>
          new Promise(resolveFrames => {
            let left = n;
            const step = () => (--left <= 0 ? resolveFrames() : requestAnimationFrame(step));
            requestAnimationFrame(step);
          }),
        opts.frames,
      );
    }

    await page.screenshot({ path: out, type: 'png' });
    log(`[shot] wrote ${out}`);

    const perf = await page.evaluate(() => {
      try {
        return window.__cosmos?.perf?.() ?? null;
      } catch {
        return null;
      }
    });
    if (perf) console.log(JSON.stringify(perf));
  } finally {
    await browser.close();
  }
  if (opts.strict && (pageErrors > 0 || consoleErrors > 0)) {
    console.error(`[shot] strict: ${pageErrors} page error(s), ${consoleErrors} console error(s)`);
    process.exit(1);
  }
}

main().catch(err => {
  console.error(`[shot] failed: ${err?.message ?? err}`);
  process.exit(1);
});
