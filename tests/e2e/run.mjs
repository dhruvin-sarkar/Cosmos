#!/usr/bin/env node
/**
 * Runtime health suite. Default = smoke (boot + 5 stops, exit 1 on any console error / page error / failed request).
 * COSMOS_E2E_FULL=1 = full sweep (every planet, dwarf planet, moon, ISS, small bodies, labs, tours, scale, spectral bands)
 * and writes .work/health/report.md + thumbs/. Does not modify app code.
 */
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, statSync, rmSync, writeFileSync } from 'node:fs';
import config from '../../playwright.config.ts';

const require = createRequire('C:/Projects/Cosmos/package.json');
const { chromium } = require('playwright');
const FULL = process.env.COSMOS_E2E_FULL === '1';
const OUT = config.outDir;
mkdirSync(`${OUT}/thumbs`, { recursive: true });

// Screenshot slot shared with tools/shot.mjs.
const rows = [];
async function acquireSlot() {
  mkdirSync(config.lockDir, { recursive: true });
  for (;;) {
    for (let i = 0; i < config.slots; i++) {
      const dir = `${config.lockDir}/slot-${i}`;
      try { mkdirSync(dir); return dir; } catch {
        try { if (Date.now() - statSync(dir).mtimeMs > 180000) rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 750));
  }
}

const pct = (a, p) => (a.length ? [...a].sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : NaN);
const f1 = n => (Number.isFinite(n) ? n.toFixed(1) : '-');
const slug = id => id.replace(/[^a-z0-9]+/gi, '_');

function writeReport() {
  const bad = rows.filter(r => r.errors > 0 || r.severity === 'high');
  if (FULL) {
    const lines = [
      '# Runtime health report', '', `Generated ${new Date().toISOString()} - ${rows.length} stops - ${bad.length} with errors`, '',
      '| stop | errors | warns | p50 ms | p95 ms | severity | notes |', '|---|---|---|---|---|---|---|',
      ...rows.map(r => `| ${r.name} | ${r.errors} | ${r.warns} | ${f1(r.p50)} | ${f1(r.p95)} | ${r.severity} | ${r.notes.replace(/\|/g, '/')} |`),
      '', '## Distinct problems', '',
    ];
    const seen = new Map();
    for (const r of rows) for (const e of r.detail) {
      const k = `${e.kind}: ${e.text.replace(/\d+(\.\d+)?/g, 'N')}`;
      if (!seen.has(k)) seen.set(k, { text: `${e.kind}: ${e.text}`, stops: [] });
      seen.get(k).stops.push(r.name);
    }
    for (const v of [...seen.values()].sort((a, b) => b.stops.length - a.stops.length))
      lines.push(`- ${v.text}  \n  _${v.stops.length} stop(s): ${v.stops.slice(0, 6).join(', ')}${v.stops.length > 6 ? ', ...' : ''}_`);
    writeFileSync(`${OUT}/report.md`, lines.join('\n') + '\n');
  }
}

async function main() {
  if (!(await fetch(config.baseURL).then(r => r.ok, () => false))) {
    console.error(`dev server not reachable at ${config.baseURL} (start: npx vite --port 5173 --strictPort)`);
    process.exit(2);
  }
  const executablePath = config.chromePaths.find(p => existsSync(p));
  const slot = await acquireSlot();
  const release = () => { try { rmSync(slot, { recursive: true, force: true }); } catch {} };
  process.on('exit', release);
  const browser = await chromium.launch({ executablePath, headless: true, args: config.gpuArgs });
  let current = { events: [] };

  try {
    const page = await browser.newPage({ viewport: config.viewport, deviceScaleFactor: 1 });
    const note = (kind, text) => { if (!/favicon\.ico/.test(text)) current.events.push({ kind, text: text.slice(0, 300) }); };
    page.on('console', m => {
      if (m.type() === 'error') note('error', `${m.text()}${m.text().startsWith('Failed to load') ? ` (${m.location()?.url ?? ''})` : ''}`);
      else if (m.type() === 'warning') note('warn', m.text());
    });
    page.on('pageerror', e => note('error', `pageerror: ${e.message}`));
    page.on('response', r => { if (r.status() >= 400) note('http', `${r.status()} ${r.url()}`); });
    page.on('requestfailed', r => {
      const f = r.failure()?.errorText ?? '';
      if (!f.includes('ERR_ABORTED')) note('http', `requestfailed ${r.url()} ${f}`);
    });

    async function ensureReady() {
      await page.waitForFunction(() => !!window.__cosmos, null, { timeout: 30000 });
      await page.evaluate(() => window.__cosmos.ready);
    }

    // Record one stop: run the action, settle, sample frame stats, thumbnail.
    async function stop(name, action) {
      current = { events: [] };
      const notes = [];
      let fatal = false;
      try {
        await Promise.race([
          page.evaluate(action.fn, action.arg),
          new Promise((_, rej) => setTimeout(() => rej(new Error('action timeout')), config.travelTimeoutMs)),
        ]);
      } catch (e) { fatal = true; notes.push(String(e.message).split('\n')[0]); }
      await page.waitForTimeout(config.settleMs);
      const sample = () => page.evaluate(async n => {
        const times = [];
        let last = performance.now();
        await new Promise(res => {
          const step = t => { times.push(t - last); last = t; times.length >= n ? res() : requestAnimationFrame(step); };
          requestAnimationFrame(step);
        });
        let perf = null;
        try { perf = window.__cosmos.perf(); } catch {}
        return { times: times.slice(1), perf };
      }, config.perfFrames);
      let frames;
      for (let k = 0; ; k++) {
        try { await ensureReady(); frames = await sample(); break; } catch (e) {
          if (k >= 2) { frames = { times: [], perf: null }; notes.push('frame sampling failed: ' + String(e.message).split('\n')[0]); break; }
          notes.push('page reloaded during sampling');
        }
      }
      if (FULL) try {
        const buf = await page.screenshot({ type: 'png' });
        const small = await page.evaluate(async b64 => {
          const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode();
          const c = document.createElement('canvas'); c.width = 480; c.height = 270;
          c.getContext('2d').drawImage(img, 0, 0, 480, 270);
          return c.toDataURL('image/jpeg', 0.85).split(',')[1];
        }, buf.toString('base64'));
        writeFileSync(`${OUT}/thumbs/${slug(name)}.jpg`, Buffer.from(small, 'base64'));
      } catch { notes.push('thumbnail failed'); }
      const errs = current.events.filter(e => e.kind === 'error' || e.kind === 'http');
      const warns = current.events.filter(e => e.kind === 'warn');
      const p50 = pct(frames.times, 0.5), p95 = pct(frames.times, 0.95);
      const gpu = frames.perf?.gpuMs ?? frames.perf?.gpu?.ms;
      if (Number.isFinite(gpu)) notes.push(`gpu ${f1(gpu)} ms`);
      if (warns.length) notes.push(`${warns.length} warn: ${warns[0].text.slice(0, 100)}`);
      if (errs.length) notes.push(errs[0].text.slice(0, 140));
      let severity = 'ok';
      if (warns.length || p95 > 25) severity = 'low';
      if (p95 > 40 || p50 > 20) severity = 'medium';
      if (errs.length || fatal) severity = 'high';
      rows.push({ name, errors: errs.length + (fatal ? 1 : 0), warns: warns.length, p50, p95, notes: notes.join('; '), severity, detail: current.events });
      if (FULL) writeReport();
      console.log(`${severity === 'ok' ? 'ok ' : 'BAD'} ${name}  err=${errs.length} warn=${warns.length} p50=${f1(p50)} p95=${f1(p95)} ${notes.join('; ')}`);
    }

    // Boot.
    current = { events: [] };
    await page.goto(config.baseURL, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => !!window.__cosmos, null, { timeout: 60000 });
    const ready = await page.evaluate(() => Promise.race([window.__cosmos.ready.then(() => 'ready'), new Promise(r => setTimeout(() => r('timeout'), 40000))]));
    await stop('boot', { fn: () => undefined });
    if (ready !== 'ready') rows.push({ name: 'boot-ready', errors: 1, warns: 0, p50: NaN, p95: NaN, notes: 'window.__cosmos.ready timed out', severity: 'high', detail: [] });

    const entities = await page.evaluate(() => window.__cosmos.registry.list().map(e => ({ id: e.id, name: e.name, kind: e.kind })));
    console.log(`registry: ${entities.length} entities`);
    const go = id => stop(id, { fn: i => window.__cosmos.commands.focus(i), arg: id });
    const has = id => entities.some(e => e.id === id);

    if (!FULL) {
      for (const id of config.smokeStops) await go(id);
    } else {
      const planets = ['mercury', 'venus', 'earth', 'mars', 'jupiter', 'saturn', 'uranus', 'neptune'].map(n => 'sol:' + n);
      const dwarfs = ['ceres', 'pluto', 'eris', 'haumea', 'makemake'].map(n => 'sol:' + n);
      const known = new Set(['sol:sun', ...planets, ...dwarfs]);
      const moons = entities.filter(e => e.id.startsWith('sol:') && !known.has(e.id)).map(e => e.id);
      const sc = entities.filter(e => e.id.startsWith('sc:')).map(e => e.id);
      const iss = sc.filter(i => /iss|zarya/i.test(i));
      const sb = entities.filter(e => e.id.startsWith('sb:')).map(e => e.id).slice(0, Number(process.env.COSMOS_E2E_SB ?? 60));
      for (const id of [...planets, ...dwarfs]) if (!has(id)) rows.push({ name: id, errors: 1, warns: 0, p50: NaN, p95: NaN, notes: 'entity not registered', severity: 'high', detail: [] });
      if (!iss.length) rows.push({ name: 'ISS', errors: 1, warns: 0, p50: NaN, p95: NaN, notes: 'no sc:iss entity in registry', severity: 'medium', detail: [] });
      const stops = [...new Set(['sol:sun', ...planets, ...dwarfs, ...moons, ...iss, ...sc.slice(0, 15), ...sb])].filter(has);
      for (const id of stops) await go(id);

      for (const lab of ['debris', 'defense', 'habitability', 'relativity']) {
        await stop(`lab:${lab}`, { fn: async l => {
          window.__cosmos.commands.openLab(l); await new Promise(r => setTimeout(r, 800));
          const a = window.__cosmos.store.getState().lab.active; window.__cosmos.commands.closeLab();
          if (a !== l) throw new Error('lab did not open'); }, arg: lab });
      }
      for (const tour of ['solar-system', 'golden-journey-preview']) {
        await stop(`tour:${tour}`, { fn: async t => {
          const c = window.__cosmos.commands; c.startTour(t); await new Promise(r => setTimeout(r, 600));
          const st = window.__cosmos.store.getState().tour;
          if (st.activeId !== t) throw new Error('tour did not start');
          for (let i = 1; i < Math.min(st.stepCount, 6); i++) { c.tourNext(); await new Promise(r => setTimeout(r, 1200)); }
          c.exitTour(); }, arg: tour });
      }
      for (const mode of ['true', 'exhibition']) {
        await stop(`scale:${mode}`, { fn: async m => {
          window.__cosmos.store.setState({ visualScale: m }); await window.__cosmos.commands.focus('sol:earth'); }, arg: mode });
      }
      for (const band of ['visible', 'h-alpha', 'ultraviolet', 'near-infrared', 'mid-infrared', 'far-infrared', 'x-ray', 'gamma-ray', 'microwave', 'cmb', 'radio']) {
        await stop(`band:${band}`, { fn: b => window.__cosmos.commands.setSpectralBand(b), arg: band });
      }
      await page.evaluate(() => window.__cosmos.commands.setSpectralBand('visible'));
    }
  } finally {
    await browser.close();
    release();
  }

  writeReport();
  const bad = rows.filter(r => r.errors > 0 || r.severity === 'high');
  if (bad.length) { console.error(`FAIL: ${bad.length} stop(s) with errors: ${bad.map(b => b.name).join(', ')}`); process.exit(1); }
  console.log('OK');
}

main().catch(e => { console.error(e); process.exit(1); });
