#!/usr/bin/env node
/**
 * Per-view performance profile of the running app with the real GPU (headless Chrome, ANGLE D3D11, vsync off).
 *
 *   node tools/perf-profile.mjs [--views inner,earth,saturn,...] [--quality ultra] [--width 1920] [--height 1080]
 *        [--frames 180] [--breakdown] [--cpuprofile] [--out .work/perf/run.json] [--url http://localhost:5173/]
 *
 * For each view: drive the app through window.__cosmos.commands, record every frame during the travel (hitches),
 * settle, then sample N frames: main-thread ms of the engine frame (phases: rig, layers, labels, post), GPU ms
 * (EXT_disjoint_timer_query_webgl2), real frame interval (uncapped), renderer.info, JS heap, long tasks and
 * per-layer update/collectLabels CPU. --breakdown hides each render-group child in turn and reports its GPU cost.
 * --cpuprofile samples the JS profiler (CDP) during each travel and prints the top self-time functions.
 */
import { createRequire } from 'node:module';
import { existsSync, readFileSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire('C:/Projects/Cosmos/package.json');
const { chromium } = require('playwright');

const CHROME = ['C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Users/dhruv/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe'].find(p => existsSync(p));
const ARGS = ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit',
  '--enable-precise-memory-info', '--force_high_performance_gpu'];

const opts = { views: null, quality: 'ultra', width: 1920, height: 1080, frames: 180, breakdown: false, cpuprofile: false, out: null, url: 'http://localhost:5173/' };
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i], n = () => process.argv[++i];
  if (a === '--views') opts.views = n().split(',');
  else if (a === '--quality') opts.quality = n();
  else if (a === '--width') opts.width = +n();
  else if (a === '--height') opts.height = +n();
  else if (a === '--frames') opts.frames = +n();
  else if (a === '--breakdown') opts.breakdown = true;
  else if (a === '--cpuprofile') opts.cpuprofile = true;
  else if (a === '--react') opts.react = true;
  else if (a === '--drawlist') opts.drawlist = true;
  else if (a === '--stalls') opts.stalls = true;
  else if (a === '--vsync') opts.vsync = true;
  else if (a === '--trace') opts.trace = n().split(',');
  else if (a === '--steadyprofile') opts.steadyprofile = true;
  else if (a === '--loaf') opts.loaf = true;
  else if (a === '--bootprofile') opts.bootprofile = true;
  else if (a === '--out') opts.out = n();
  else if (a === '--url') opts.url = n();
}

/** View recipes: an expression evaluated in the page with c = commands, s = store. */
const VIEWS = {
  boot: `null`,
  earth: `c.focus('sol:earth')`,
  'earth-debris': `(c.setOverlay('debris', true), c.focus('sol:earth').then(() => c.setScale(8.2)))`,
  moon: `c.focus('sol:moon')`,
  sun: `c.focus('sol:sun')`,
  inner: `c.focus('sol:sun').then(() => c.setScale(11.6))`,
  mars: `c.focus('sol:mars')`,
  jupiter: `c.focus('sol:jupiter')`,
  'jupiter-system': `c.focus('sol:jupiter').then(() => c.setScale(9.6))`,
  saturn: `c.focus('sol:saturn')`,
  'saturn-system': `c.focus('sol:saturn').then(() => c.setScale(9.8))`,
  uranus: `c.focus('sol:uranus')`,
  neptune: `c.focus('sol:neptune')`,
  pluto: `c.focus('sol:pluto')`,
  belt: `c.focus('sol:ceres').then(() => c.setScale(11.2))`,
  outer: `c.focus('sol:sun').then(() => c.setScale(13.2))`,
  kuiper: `c.focus('sol:sun').then(() => c.setScale(13.7))`,
  stars: `c.focus('sol:sun').then(() => c.setScale(17.5))`,
  milkyway: `c.focus('sol:sun').then(() => c.setScale(21.3))`,
  galaxies: `c.focus('sol:sun').then(() => c.setScale(23.5))`,
  trappist: `c.focus('sys:TRAPPIST-1')`,
  'mw-above': `c.focus('mw:galaxy')`,
  'galactic-centre': `c.focus('mw:sgr-a*').then(() => c.setScale(20))`,
  'sstars': `c.focus('mw:s-stars')`,
  'sgr-a': `c.focus('mw:sgr-a*')`,
  m31: `c.focus('gal:m31')`,
  'local-group': `c.focus('struct:local-group')`,
  web: `c.focus('struct:laniakea')`,
  cmb: `c.focus('cosmo:cmb')`,
  home: `c.home()`,
  // Whole guided tours: every step, waiting for each travel to settle (+1.2 s dwell). Use --views tour-golden.
  'tour-golden': `(async () => { c.startTour('golden-journey'); const n = s.getState().tour.stepCount; for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, 800)); while (s.getState().camera.traveling) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 1200)); c.tourNext(); } })()`,
  'tour-solar': `(async () => { c.startTour('solar-system'); const n = s.getState().tour.stepCount; for (let i = 0; i < n; i++) { await new Promise(r => setTimeout(r, 800)); while (s.getState().camera.traveling) await new Promise(r => setTimeout(r, 100)); await new Promise(r => setTimeout(r, 1200)); c.tourNext(); } })()`,
};

const quantile = (a, q) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const r2 = v => v == null ? null : Math.round(v * 100) / 100;

const smaps = new Map();
/** Minified prod frame -> original source:line (function) via dist/assets/*.map; null when no map. */
function mapFrame(file, line, col) {
  if (!file.endsWith('.js')) return null;
  let m = smaps.get(file);
  if (m === undefined) {
    m = null;
    const mp = 'dist/assets/' + file + '.map';
    if (existsSync(mp)) { const { SourceMapConsumer } = require('source-map-js'); m = new SourceMapConsumer(JSON.parse(readFileSync(mp, 'utf8'))); }
    smaps.set(file, m);
  }
  if (!m) return null;
  const o = m.originalPositionFor({ line: line + 1, column: col });
  return o.source ? `${o.name ?? '?'}@${o.source.replace(/^(\.\.\/)+/, '')}:${o.line}` : null;
}

function topSelf(profile, n = +(process.env.TOPN ?? 14)) {
  const byId = new Map(profile.nodes.map(nd => [nd.id, nd]));
  const self = new Map();
  const dt = profile.timeDeltas;
  for (let i = 0; i < profile.samples.length; i++) {
    const nd = byId.get(profile.samples[i]);
    const cf = nd.callFrame;
    if (cf.functionName === '(idle)' || cf.functionName === '(program)') continue;
    const file = (cf.url || '').split('/').pop().split('?')[0];
    const key = mapFrame(file, cf.lineNumber, cf.columnNumber) ?? `${cf.functionName || '(anon)'}@${file}:${cf.lineNumber + 1}`;
    self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0) / 1000);
  }
  return [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k}=${Math.round(v)}`);
}

// Share the machine-wide GPU slots with tools/shot.mjs so parallel agents do not distort each other's timings.
async function acquireShotSlot() {
  const LOCK_DIR = 'C:/Projects/Cosmos/.work/shot-locks';
  mkdirSync(LOCK_DIR, { recursive: true });
  for (;;) {
    for (let i = 0; i < Number(process.env.SHOT_SLOTS || 2); i++) {
      const dir = LOCK_DIR + '/slot-' + i;
      try { mkdirSync(dir); return dir; } catch {
        try { if (Date.now() - statSync(dir).mtimeMs > 180000) rmSync(dir, { recursive: true, force: true }); } catch {}
      }
    }
    await new Promise(r => setTimeout(r, 750));
  }
}

async function main() {
  const slot = await acquireShotSlot();
  process.on('exit', () => { try { rmSync(slot, { recursive: true, force: true }); } catch {} });
  // Long runs keep the slot fresh (others reclaim slots idle for 3 min).
  setInterval(() => { try { utimesSync(slot, new Date(), new Date()); } catch {} }, 30000).unref();
  const browser = await chromium.launch({ executablePath: CHROME, headless: true, args: opts.vsync ? ARGS.filter(a => a !== '--disable-gpu-vsync' && a !== '--disable-frame-rate-limit') : ARGS });
  const page = await browser.newPage({ viewport: { width: opts.width, height: opts.height }, deviceScaleFactor: 1 });
  if (opts.stalls) {
    // Time slow WebGL calls (sync shader links, big texture uploads, readbacks) and keep a short stack for each.
    await page.addInitScript(() => {
      Error.stackTraceLimit = 40; const S = window.__stalls = [];
      const P = WebGL2RenderingContext.prototype;
      for (const name of ['getProgramParameter', 'getShaderParameter', 'getProgramInfoLog', 'texSubImage2D', 'texImage2D', 'compressedTexSubImage2D', 'getBufferSubData', 'getUniformLocation', 'getActiveUniform', 'linkProgram', 'compileShader', 'generateMipmap', 'bufferData', 'bufferSubData']) {
        const orig = P[name];
        P[name] = function () {
          const t = performance.now(); const r = orig.apply(this, arguments); const d = performance.now() - t;
          if (d > 12) {
            const a0 = arguments[0], dims = arguments.length >= 9 ? `${arguments[4]}x${arguments[5]}` : (a0 && a0.width ? `${a0.width}x${a0.height}` : '');
            const src = [...arguments].find(x => x && typeof x === 'object' && 'width' in x); const url = src?.currentSrc || src?.src || window.__lastTexName || '';
            const R_ = window.__cosmos?.engine?.services?.renderer; const pr_ = name === 'getProgramParameter' && R_ ? R_.info.programs.find(p => p.program === a0) : undefined; const pid = pr_?.id; window.__lastProgName = pr_ ? pr_.name + '|' + String(pr_.cacheKey).slice(0, 90) : undefined;
            S.push({ name, url, pid, pn: window.__lastProgName, pname: name === 'getProgramParameter' ? arguments[1] : undefined, gated: window.__cosmos?.engine?.services?.shaderWarmup?.gated, obj: window.__curObj, ms: Math.round(d), dims: src ? `${src.width}x${src.height}` : dims, stack: (new Error().stack || '').split(String.fromCharCode(10)).slice(2, 30).map(l => l.trim().replace(/\(?https?:\/\/[^/]+\//, '(').replace(/\?[^:)]*/, '')).join(' < ') });
          }
          return r;
        };
      }
    });
  }
  const cdp = (opts.cpuprofile || opts.steadyprofile || opts.bootprofile) ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); }
  const errors = [];
  if (opts.react) {
    // Minimal devtools hook: per-component self render time (dev build profiler timers) for fibers that rendered.
    await page.addInitScript(() => {
      const R = (window.__reactProf = { on: false, commits: 0, by: new Map(), prev: 0 });
      const nameOf = f => { const t = f.type; return typeof t === 'string' ? null : t ? (t.displayName || t.name || (t.render && (t.render.displayName || t.render.name)) || null) : null; };
      const walk = f => {
        while (f) {
          if ((f.flags & 1) !== 0 && f.actualStartTime > R.prev) { const n = nameOf(f); if (n) { const e = R.by.get(n) ?? [0, 0]; e[0]++; e[1] += f.selfBaseDuration || 0; R.by.set(n, e); } }
          if (f.child) walk(f.child);
          f = f.sibling;
        }
      };
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { isDisabled: false, supportsFiber: true, renderers: new Map(), inject() { return 1; },
        onCommitFiberRoot(_id, root) { if (R.on) { R.commits++; walk(root.current.child); } R.prev = performance.now(); }, onCommitFiberUnmount() {}, onPostCommitFiberRoot() {}, checkDCE() {} };
    });
  }
  page.on('pageerror', e => errors.push(e.message));
  const tBoot = Date.now();
  if (cdp && opts.bootprofile) await cdp.send('Profiler.start');
  await page.goto(opts.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => window.__cosmos, null, { timeout: 30000 });
  await page.evaluate(() => window.__cosmos.ready);
  const bootMs = Date.now() - tBoot;
  if (cdp && opts.bootprofile) { await new Promise(r => setTimeout(r, +(process.env.BOOT_EXTRA_MS ?? 6000))); const { profile } = await cdp.send('Profiler.stop'); console.log('boot top self (ms): ' + topSelf(profile).join('  ')); }

  // In-page instrumentation: per-frame recorder, per-layer and per-phase timing wrappers.
  const gpuName = await page.evaluate(quality => {
    const C = window.__cosmos;
    C.commands.setQuality(quality);
    const P = (window.__perfProbe = { frames: [], rec: false, layer: new Map(), phase: new Map(), ltasks: 0, cur: new Map(), slow: [] });
    const wrap = (obj, fn, key) => {
      const o = obj?.[fn];
      if (typeof o !== 'function') return;
      obj[fn] = function (...a) {
        if (!P.rec) return o.apply(this, a);
        const t = performance.now();
        try { return o.apply(this, a); } finally { const d = performance.now() - t; P.phase.set(key, (P.phase.get(key) ?? 0) + d); P.cur.set(key, (P.cur.get(key) ?? 0) + d); }
      };
    };
    wrap(C.engine.rig, 'update', 'rig'); wrap(C.engine.labels, 'update', 'labels');
    wrap(C.engine.post, 'update', 'post.update'); wrap(C.engine.post, 'render', 'post.render');
    for (const layer of C.engine.layers()) {
      for (const fn of ['update', 'collectLabels']) {
        const orig = layer[fn];
        if (typeof orig !== 'function') continue;
        const key = layer.id + (fn === 'update' ? '' : ':labels');
        layer[fn] = function (...args) {
          if (!P.rec) return orig.apply(this, args);
          const t = performance.now();
          try { return orig.apply(this, args); } finally { const d = performance.now() - t; P.layer.set(key, (P.layer.get(key) ?? 0) + d); P.cur.set(key, (P.cur.get(key) ?? 0) + d); }
        };
      }
    }
    new PerformanceObserver(l => { if (P.rec) P.ltasks += l.getEntries().length; }).observe({ type: 'longtask' });
    P.loaf = [];
    try { new PerformanceObserver(l => { if (!P.rec) return; for (const e of l.getEntries()) { if (e.duration < 50 || P.loaf.length > 200) continue;
      const st = C.store.getState(); const sc = (e.scripts ?? []).slice().sort((x, y) => y.duration - x.duration).slice(0, 3).map(x => `${Math.round(x.duration)}:${x.invokerType}:${x.invoker}|${x.sourceFunctionName || '?'}@${String(x.sourceURL).split('/').pop()}:${x.sourceCharPosition}${x.forcedStyleAndLayoutDuration > 5 ? ' fsl=' + Math.round(x.forcedStyleAndLayoutDuration) : ''}`);
      P.loaf.push(`${Math.round(e.duration)}ms blk=${Math.round(e.blockingDuration)} render=${Math.round(e.renderStart ? e.startTime + e.duration - e.renderStart : 0)} layout=${Math.round(e.styleAndLayoutStart ? e.startTime + e.duration - e.styleAndLayoutStart : 0)} step=${st.tour?.step ?? '-'} sc=${st.view?.scaleLog10?.toFixed?.(1)} :: ${sc.join(' ; ')}`); } }).observe({ type: 'long-animation-frame' }); } catch {}
    const tick = () => {
      if (P.rec) {
        const pm = C.engine.perf();
        if (pm.cpuFrameMs > 25 && P.slow.length < 40) P.slow.push(Math.round(pm.cpuFrameMs) + ':' + [...P.cur.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => k + '=' + Math.round(v)).join(','));
        P.cur.clear();
        P.frames.push({ cpu: pm.cpuFrameMs, gpu: pm.gpuFrameMs, t: performance.now(), dc: pm.drawCalls, tri: pm.triangles, pts: pm.points, sc: C.store.getState().view.scaleLog10 });
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    const gl = document.querySelector('canvas')?.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    return dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : '?';
  }, opts.quality);
  console.log(`GPU: ${gpuName}  boot ${bootMs} ms  ${opts.width}x${opts.height} ${opts.quality}`);

  const sample = async n => page.evaluate(async n => {
    const P = window.__perfProbe; P.frames = []; P.layer.clear(); P.phase.clear(); P.ltasks = 0; P.rec = true;
    await new Promise(r => { const step = () => P.frames.length >= n ? r() : requestAnimationFrame(step); requestAnimationFrame(step); });
    P.rec = false;
    const f = P.frames;
    const nF = f.length;
    const phases = [...P.phase.entries()].map(([k, v]) => `${k}=${(v / nF).toFixed(2)}`).join(' ');
    const perLayer = [...P.layer.entries()].map(([k, v]) => [k, v / nF]).sort((a, b) => b[1] - a[1]).slice(0, 14);
    const rows = [];
    for (let i = 1; i < f.length; i++) rows.push([f[i].cpu, f[i].gpu, f[i].t - f[i - 1].t, f[i].dc, f[i].tri, f[i].pts]);
    return { phases, f: rows, perLayer, ltasks: P.ltasks, snap: window.__cosmos.perf() };
  }, n);

  const summarize = s => {
    const cpu = s.f.map(x => x[0]), gpu = s.f.map(x => x[1]).filter(x => x != null), int = s.f.map(x => x[2]);
    const last = s.f[s.f.length - 1] ?? [];
    return {
      fps: r2(1000 / mean(int)), intP50: r2(quantile(int, .5)), intP95: r2(quantile(int, .95)), intMax: r2(Math.max(...int)),
      cpuP50: r2(quantile(cpu, .5)), cpuP95: r2(quantile(cpu, .95)), gpuP50: r2(quantile(gpu, .5)), gpuP95: r2(quantile(gpu, .95)),
      draws: last[3], tris: last[4], points: last[5], textures: s.snap.textures, geoms: s.snap.geometries, heapMB: s.snap.jsHeapMB,
      longTasks: s.ltasks, phases: s.phases, layers: s.perLayer.map(([k, v]) => `${k}=${v.toFixed(2)}`).join(' '),
    };
  };

  const results = { date: new Date().toISOString(), gpu: gpuName, quality: opts.quality, size: `${opts.width}x${opts.height}`, bootMs, views: {} };
  for (const name of opts.views ?? Object.keys(VIEWS)) {
    const recipe = VIEWS[name];
    if (recipe === undefined) { console.log(`unknown view ${name}`); continue; }
    if (cdp && opts.cpuprofile) await cdp.send('Profiler.start');
    if (opts.stalls) console.log('   pre-travel ' + await page.evaluate(() => {
      const C = window.__cosmos; const R = C.engine.services.renderer; let un = 0, tot = 0; const names = [];
      const root = C.engine.services.groups.main.parent;
      root.traverse(o => { if (!(o.isMesh || o.isPoints || o.isLine || o.isSprite) || !o.material) return; for (const m of [].concat(o.material)) { tot++; if (R.properties.get(m).currentProgram === undefined) { un++; if (names.length < 12) names.push(o.name || o.parent?.name || '?'); } } });
      if (!R.__stallWrap) { R.__stallWrap = true; const orig = R.renderBufferDirect; R.renderBufferDirect = function (cam, sc, geo, mat, obj) { const ch = []; for (let x = obj; x && ch.length < 5; x = x.parent) ch.push(x.name || x.type); window.__curObj = ch.join('<') + '/' + (mat.name || mat.type) + '[' + Object.keys(mat.uniforms ?? {}).filter(k => mat.uniforms[k]?.value?.isTexture).join(',') + ']'; return orig.apply(this, arguments); }; }
      const big = [];
      root.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) for (const [k, u] of Object.entries(m.uniforms ?? {})) { const t = u?.value; if (!t?.isTexture) continue; const im = t.image ?? t.source?.data; const w = im?.width ?? 0; if (w >= 4096 && R.properties.get(t).__webglTexture === undefined) big.push(`${o.name || o.parent?.name || o.parent?.parent?.name || '?'}.${k}=${w}x${im.height}`); } });
      return `materials uncompiled ${un}/${tot}: ${names.join(',')} | big textures not on GPU: ${big.join(' ')}`;
    }));
    const tracing = opts.trace?.includes(name);
    if (tracing) await browser.startTracing(page, { categories: (process.env.TRACE_CATS ?? 'gpu,gpu.angle,disabled-by-default-gpu.angle,gpu.service,toplevel,devtools.timeline').split(',') });
    const travel = await page.evaluate(async recipe => {
      const P = window.__perfProbe; const C = window.__cosmos; const c = C.commands, s = C.store;
      if (window.__stalls) window.__stalls.length = 0; P.loaf.length = 0; P.frames = []; P.slow = []; P.rec = true; P.ltasks = 0; P.layer.clear(); P.phase.clear();
      if (window.__reactProf) { window.__reactProf.on = true; window.__reactProf.commits = 0; window.__reactProf.by.clear(); }
      const progs0 = new Set(C.engine.services.renderer.info.programs.map(p => p.id));
      const t0 = performance.now();
      try {
        await Promise.race([(0, eval)(`(c, s) => ${recipe}`)(c, s), new Promise(r => setTimeout(r, recipe.includes('startTour') ? 300000 : 20000))]);
      } catch (e) { console.warn('view failed', e); }
      const t1 = performance.now();
      while (s.getState().camera.traveling && performance.now() - t1 < 15000) await new Promise(r => setTimeout(r, 100));
      await new Promise(r => setTimeout(r, 600));
      P.rec = false;
      const RP = window.__reactProf; let react = null;
      if (RP) { RP.on = false; react = RP.commits + ' commits: ' + [...RP.by.entries()].sort((a, b) => b[1][1] - a[1][1]).slice(0, 12).map(([k, v]) => k + '=' + v[0] + 'x/' + Math.round(v[1]) + 'ms').join(' ') + ' | by count: ' + [...RP.by.entries()].sort((a, b) => b[1][0] - a[1][0]).slice(0, 16).map(([k, v]) => k + '=' + v[0]).join(' ') + ' | every commit: ' + [...RP.by.entries()].filter(([, v]) => v[0] >= RP.commits * 0.8).map(([k]) => k).join(','); }
      const R0 = C.engine.services.renderer; const owner = new Map(); C.engine.services.groups.main.parent.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) { const pid = R0.properties.get(m).currentProgram?.id; if (pid !== undefined && !owner.has(pid)) { const ch = []; for (let x = o; x && ch.length < 4; x = x.parent) ch.push(x.name || x.type); owner.set(pid, ch.join('<') + '/' + (m.name || m.type)); } } });
      const newProgs = R0.info.programs.filter(p => !progs0.has(p.id)).map(p => (owner.get(p.id) ?? p.name ?? '?') + '[' + String(p.cacheKey).split(',').filter(Boolean).slice(0, 3).join(',').slice(0, 60) + ']');
      const f = P.frames; const ints = [];
      for (let i = 1; i < f.length; i++) ints.push([f[i].t - f[i - 1].t, f[i].cpu]);
      ints.sort((a, b) => b[0] - a[0]);
      return { ms: Math.round(performance.now() - t0), worst: ints.slice(0, 6).map(x => `${Math.round(x[0])}(${Math.round(x[1])})`),
        slow: P.slow.slice(0, 8), gpuTop: f.filter(x => x.gpu != null).sort((a, b) => b.gpu - a.gpu).slice(0, 6).map(x => Math.round(x.gpu) + '@' + x.sc.toFixed(1) + '/' + x.pts), over50: ints.filter(x => x[0] > 50).length, n: ints.length, ltasks: P.ltasks, loaf: P.loaf.slice(0, 60), react, newProgs,
        phases: [...P.phase.entries()].map(([k, v]) => `${k}=${Math.round(v)}`).join(' ') };
    }, recipe);
    if (tracing) { const buf = await browser.stopTracing(); const p = `.work/perf/trace-${name}.json`; (await import('node:fs')).writeFileSync(p, buf); console.log('   trace -> ' + p); }
    if (cdp && opts.cpuprofile) { const { profile } = await cdp.send('Profiler.stop'); travel.top = topSelf(profile); }
    if (opts.stalls) travel.stalls = await page.evaluate(() => { const R0 = window.__cosmos.engine.services.renderer; const owner = new Map(); window.__cosmos.engine.services.groups.main.parent.traverse(o => { if (!o.material) return; for (const m of [].concat(o.material)) { const pid = R0.properties.get(m).currentProgram?.id; if (pid !== undefined && !owner.has(pid)) owner.set(pid, (o.name || o.parent?.name || o.type) + '/' + (m.name || m.type)); } }); return window.__stalls.splice(0).map(x => (x.pid !== undefined ? { ...x, obj: 'prog' + x.pid + ':' + (owner.get(x.pid) ?? ('not-in-scene:' + x.pn + ' drawing=' + x.obj)) + ' pname=' + x.pname + ' gated=' + x.gated } : x)); });
    await page.waitForTimeout(1200);
    if (cdp && opts.steadyprofile) await cdp.send('Profiler.start');
    const s = await sample(opts.frames);
    const row = { ...summarize(s), travel };
    if (cdp && opts.steadyprofile) { const { profile } = await cdp.send('Profiler.stop'); row.steadyTop = topSelf(profile); }
    if (opts.drawlist) {
      row.drawlist = await page.evaluate(async () => {
        const R = window.__cosmos.engine.services.renderer; const orig = R.renderBufferDirect; const by = new Map();
        const key = o => { const parts = []; for (let x = o; x && parts.length < 3; x = x.parent) if (x.name) parts.push(x.name); return (parts.join('<') || ('?' + (o.parent?.type ?? '') + '>' + (o.parent?.parent?.type ?? '') + '>' + (o.parent?.parent?.parent?.name ?? '') + ' geo=' + (o.geometry?.type ?? '') + ' uni=' + Object.keys(o.material?.uniforms ?? {}).slice(0, 4).join(','))) + ':' + o.type + '/' + (o.material?.type ?? '') ; };
        R.renderBufferDirect = function (cam, scene, geo, mat, obj, group) { const k = key(obj); by.set(k, (by.get(k) ?? 0) + 1); return orig.apply(this, arguments); };
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        by.clear();
        await new Promise(r => requestAnimationFrame(r));
        R.renderBufferDirect = orig;
        const census = [];
        const g = window.__cosmos.engine.services.groups;
        for (const gname of Object.keys(g)) for (const child of g[gname].children) { let n = 0, auto = 0; child.traverse(o => { n++; if (o.matrixAutoUpdate) auto++; }); census.push([`${gname}/${child.name || child.type}`, n, auto]); }
        census.sort((a, b) => b[1] - a[1]);
        window.__drawCensus = census.slice(0, 15);
        return [...by.entries()].sort((a, b) => b[1] - a[1]);
      });
    }
    if (opts.breakdown) {
      row.gpuBreakdown = await page.evaluate(async () => {
        const C = window.__cosmos; const g = C.engine.services.groups;
        const measure = async n => {
          const v = [];
          await new Promise(r => { let k = 0; const step = () => { const x = C.engine.perf().gpuFrameMs; if (k++ > 5 && x != null) v.push(x); k > n + 5 ? r() : requestAnimationFrame(step); }; requestAnimationFrame(step); });
          v.sort((a, b) => a - b); return v[Math.floor(v.length / 2)];
        };
        const base = await measure(40);
        const out = [];
        for (const gname of Object.keys(g)) {
          for (const child of g[gname].children) {
            if (!child.visible) continue;
            child.visible = false;
            const m = await measure(20);
            child.visible = true;
            out.push([`${gname}/${child.name || child.type}`, Math.round((base - m) * 100) / 100]);
          }
        }
        out.sort((a, b) => b[1] - a[1]);
        return { base, top: out.slice(0, 12) };
      });
    }
    results.views[name] = row;
    const t = row.travel;
    console.log(`${name.padEnd(15)} fps=${row.fps} int p50/p95/max=${row.intP50}/${row.intP95}/${row.intMax} cpu p50/p95=${row.cpuP50}/${row.cpuP95} gpu p50/p95=${row.gpuP50}/${row.gpuP95} draws=${row.draws} tris=${row.tris} pts=${row.points} tex=${row.textures} heap=${row.heapMB} lt=${row.longTasks}`);
    console.log(`   phases: ${row.phases}`);
    console.log(`   layers: ${row.layers}`);
    console.log(`   travel ${t.ms}ms frames=${t.n} worst=${t.worst.join(',')} >50ms=${t.over50} lt=${t.ltasks} | ${t.phases}`);
    if (t.gpuTop?.length) console.log(`   gpu top (ms@scaleLog10/points): ${t.gpuTop.join(" ")}`);
    if (t.newProgs.length) console.log(`   new programs (${t.newProgs.length}): ${t.newProgs.join(', ')}`);
    if (t.react) console.log(`   react: ${t.react}`);
    if (opts.loaf && t.loaf?.length) for (const x of t.loaf) console.log('   loaf ' + x.slice(0, 420));
    if (t.slow?.length) console.log(`   slow frames (cpu:top phases): ${t.slow.join(' | ')}`);
    if (t.stalls) for (const x of t.stalls.slice(0, 12)) console.log(`   stall ${x.name} ${x.ms}ms ${x.dims} ${x.url ?? ''} obj=${x.obj} :: ${x.stack.slice(0, Number(process.env.STACKLEN ?? 160))}`);
    if (t.top) console.log(`   travel self-time ms: ${t.top.join(' ')}`);
    if (row.steadyTop) console.log(`   steady self-time ms: ${row.steadyTop.join(' ')}`);
    if (row.drawlist) console.log(`   scene objects: ${(await page.evaluate(() => window.__drawCensus)).map(([k, n, a]) => `${k}=${n}/${a}`).join(' ')}`);
    if (row.drawlist) console.log(`   draws (${row.drawlist.reduce((a, x) => a + x[1], 0)}): ${row.drawlist.map(([k, v]) => `${k}=${v}`).join(' ')}`);
    if (row.gpuBreakdown) console.log(`   gpu base=${row.gpuBreakdown.base} top: ${row.gpuBreakdown.top.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  }
  if (errors.length) console.log(`page errors: ${errors.slice(0, 5).join(' | ')}`);
  if (opts.out) { const out = resolve(opts.out); mkdirSync(dirname(out), { recursive: true }); writeFileSync(out, JSON.stringify(results, null, 1)); }
  await browser.close();
}

main().catch(e => { console.error(e); process.exit(1); });
