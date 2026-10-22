#!/usr/bin/env node
/**
 * Builds the three Cosmos media-kit charts as standalone SVGs (solid background, fonts embedded as base64 so they
 * render the same as an <img> on GitHub light and dark):  node docs/media/charts/build-charts.mjs
 * Colours are the src/styles/tokens.css values (ink ramp, brass accent, Real blue, Modified orange).
 * Numbers: catalogue sizes from public/data/manifest.json + docs/data/*.md; frame times from .work/perf/final.json
 * (tools/perf-profile.mjs, RTX 3050 Laptop, Ultra, 1920x1080); distances cited in the caption of ladder.svg.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../..');
const font = (p) => readFileSync(resolve(root, 'public/fonts', p)).toString('base64');
const FONTS = `
@font-face{font-family:'Mona Sans';src:url(data:font/woff2;base64,${font('mona-sans/mona-sans-latin-wdth-normal.woff2')}) format('woff2');font-weight:200 900;font-stretch:75% 125%}
@font-face{font-family:'JetBrains Mono';src:url(data:font/woff2;base64,${font('jetbrains-mono/jetbrains-mono-latin-400-normal.woff2')}) format('woff2');font-weight:400}`;

// tokens.css (oklch -> sRGB hex, precomputed): ink-100 .13, ink-300 .285, ink-400 .4, ink-500 .5, text .93/.8/.7
const C = { bg: '#0a0a0a', grid: '#2a2a2a', axis: '#4a4a4a', dim: '#8a8a8a', text3: '#9e9e9e', text2: '#bebebe', text: '#e8e8e8', accent: '#e9ca80', real: '#86c7ed', mod: '#fd9c5d' };
const UI = "'Mona Sans','Inter',system-ui,'Segoe UI',sans-serif";
const MONO = "'JetBrains Mono',ui-monospace,Consolas,monospace";
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
const wrap = (w, h, title, desc, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-labelledby="t d">
<title id="t">${esc(title)}</title><desc id="d">${esc(desc)}</desc>
<style>${FONTS}
text{font-family:${UI};fill:${C.text2}} .m{font-family:${MONO}} .h{font-weight:600;fill:${C.text}} .s{fill:${C.text3}}</style>
<rect width="${w}" height="${h}" fill="${C.bg}"/>
${body}
</svg>
`;
const header = (title, sub) => `<text x="60" y="78" font-size="34" class="h">${esc(title)}</text><text x="60" y="108" font-size="17" class="s">${esc(sub)}</text>
<line x1="60" y1="128" x2="116" y2="128" stroke="${C.accent}" stroke-width="2"/>`;
const fmt = (n) => n.toLocaleString('en-US');
const SUP = '⁰¹²³⁴⁵⁶⁷⁸⁹';

// ───────────────────────── (a) log ladder ─────────────────────────
{
  const LY = 9.4607e15, PC = 3.0857e16, AU = 1.495978707e11;
  const stops = [
    ['International Space Station', 4.0e5, '≈ 400 km up'],
    ['Geostationary debris belt', 3.5786e7, '35,786 km up'],
    ['The Moon', 3.844e8, '384,400 km'],
    ['The Sun', AU, '1 AU · light takes 8 min 19 s'],
    ['Neptune', 30.07 * AU, '30 AU · light takes 4 h 10 min'],
    ['Oort cloud (1 ly ring)', LY, '1 light-year'],
    ['Proxima Centauri', 4.2465 * LY, '4.25 ly'],
    ['TRAPPIST-1', 12.43 * PC, '≈ 41 ly'],
    ['Sagittarius A*', 8275.9 * PC, '27,000 ly · 8.28 kpc'],
    ['Andromeda (M31)', 0.785e6 * PC, '2.5 million ly'],
    ['Virgo Cluster', 16.5e6 * PC, '54 million ly'],
    ['Laniakea (centre)', 69.3e6 * PC, '230 million ly'],
    ['Cosmic microwave background', 13880e6 * PC, '45 billion ly · 13.9 Gpc'],
  ];
  const W = 1800, H = 900, x0 = 90, x1 = 1710, lo = 5, hi = 27.2;
  const X = (m) => x0 + ((Math.log10(m) - lo) / (hi - lo)) * (x1 - x0);
  const ay = 430;
  let b = header('The golden journey on a log scale', 'Distance from Earth to each stop. Every tick is ten times farther than the last.');
  const bands = [
    ['Near Earth', 5, 9.4], ['Solar System', 9.4, 13.7], ['Interstellar', 13.7, 18.4], ['The Galaxy', 18.4, 21.7], ['Local Universe', 21.7, 25.0], ['Observable universe', 25.0, 27.2],
  ];
  bands.forEach(([n, a, z], i) => {
    const xa = x0 + ((a - lo) / (hi - lo)) * (x1 - x0), xz = x0 + ((z - lo) / (hi - lo)) * (x1 - x0);
    b += `<rect x="${xa.toFixed(1)}" y="${ay + 62}" width="${(xz - xa).toFixed(1)}" height="26" fill="${i % 2 ? '#161616' : '#1d1d1d'}"/>`;
    b += `<text x="${((xa + xz) / 2).toFixed(1)}" y="${ay + 79}" font-size="12" text-anchor="middle" style="fill:${C.dim};letter-spacing:.08em;text-transform:uppercase">${esc(n)}</text>`;
  });
  b += `<line x1="${x0}" y1="${ay}" x2="${x1}" y2="${ay}" stroke="${C.axis}" stroke-width="1"/>`;
  for (let e = 5; e <= 27; e++) {
    const x = X(10 ** e);
    b += `<line x1="${x.toFixed(1)}" y1="${ay - (e % 5 === 0 ? 22 : 16)}" x2="${x.toFixed(1)}" y2="${ay + (e % 5 === 0 ? 22 : 16)}" stroke="${C.axis}"/>`;
    if (e % 2 === 1) b += `<text class="m" x="${x.toFixed(1)}" y="${ay + 44}" font-size="12" text-anchor="middle" style="fill:${C.dim}">10${String(e).split('').map((c) => SUP[+c]).join('')} m</text>`;
  }
  const lv = [-110, 110, -215, 215];
  stops.forEach(([name, m, sub], i) => {
    const x = X(m), dy = lv[i % 4], up = dy < 0, ty = ay + dy;
    const anchor = i === 0 ? 'start' : i === stops.length - 1 ? 'end' : 'middle';
    const tx = anchor === 'start' ? x - 8 : anchor === 'end' ? x + 8 : x;
    b += `<line x1="${x.toFixed(1)}" y1="${ay}" x2="${x.toFixed(1)}" y2="${ty + (up ? 22 : -8)}" stroke="${C.axis}"/>`;
    b += `<circle cx="${x.toFixed(1)}" cy="${ay}" r="6" fill="${C.accent}" stroke="${C.bg}" stroke-width="2"/>`;
    b += `<text x="${tx.toFixed(1)}" y="${ty - (up ? 6 : -22)}" font-size="18" class="h" text-anchor="${anchor}">${esc(name)}</text>`;
    b += `<text x="${tx.toFixed(1)}" y="${ty - (up ? -14 : -44)}" font-size="14" class="m s" text-anchor="${anchor}">${esc(sub)}</text>`;
  });
  b += `<text x="60" y="${H - 108}" font-size="13" class="s">Distances from Earth, rounded. Bodies orbiting the Sun are given as their Sun distance (within 1 AU of their Earth distance); the Moon, ISS and GEO are measured from Earth.</text>
<text x="60" y="${H - 86}" font-size="13" style="fill:${C.dim}">Sources: ISS ≈ 400 km (NASA); GEO 35,786 km (ESA Space Debris Office); Moon 384,400 km mean (NASA NSSDCA); 1 AU = 149,597,870,700 m (IAU 2012 B2); Neptune a = 30.07 AU (NASA NSSDCA);</text>
<text x="60" y="${H - 66}" font-size="13" style="fill:${C.dim}">Proxima 4.2465 ly and TRAPPIST-1 12.43 pc (Gaia DR3 via NASA Exoplanet Archive); Sgr A* 8275.9 pc (GRAVITY 2024, A&amp;A 692, A242); M31 0.785 Mpc (McConnachie 2012); Virgo 16.5 Mpc and Laniakea 69.3 Mpc</text>
<text x="60" y="${H - 46}" font-size="13" style="fill:${C.dim}">(Cosmos structures catalogue; Tully et al. 2014, Nature 513, 71); CMB comoving distance to last scattering 13,880 Mpc (Planck 2018 ΛCDM, derived in docs/data/galactic.md).</text>
<text x="${W - 60}" y="${H - 20}" font-size="13" text-anchor="end" style="fill:${C.accent}">Cosmos · SCI-FORGE 2026</text>`;
  writeFileSync(resolve(here, 'ladder.svg'), wrap(W, H, 'The golden journey on a log scale', 'Log-scale ladder of the golden-journey stops with real distances from Earth, from the ISS at 400 km to the cosmic microwave background at 45 billion light-years.', b));
}

// ───────────────────────── (b) what's inside ─────────────────────────
{
  // [label, count, unit, source, group]
  const rows = [
    ['Galaxies in the cosmic web', 2243508, 'galaxies', '2MRS 43,508 + DESI DR1 BGS 1.8M + LRG 0.4M (sampled)', 'U'],
    ['Nearby stars', 330881, 'stars', 'Gaia Catalogue of Nearby Stars, within 100 pc', 'G'],
    ['Stars in the 3-D field', 109389, 'stars', 'HYG v4.4 (Hipparcos, Yale BSC, Gliese)', 'G'],
    ['Numbered asteroids', 75855, 'objects', 'JPL SBDB, H < 15', 'S'],
    ['Satellites and debris', 35652, 'objects', 'CelesTrak SATCAT; 31,839 with orbit elements', 'S'],
    ['Space-weather events', 4408, 'events', 'NASA DONKI flares, CMEs, storms (2024-10 to 2026-10)', 'S'],
    ['Trans-Neptunian objects', 7301, 'objects', 'JPL SBDB, all catalogued', 'S'],
    ['Confirmed exoplanets', 6451, 'planets', 'NASA Exoplanet Archive PSCompPars (4,847 host stars)', 'G'],
    ['Near-Earth objects', 3449, 'objects', 'JPL SBDB NEOs and PHAs', 'S'],
    ['Impact-risk objects', 2222, 'objects', 'CNEOS Sentry risk table', 'S'],
    ['Nearby galaxies', 869, 'galaxies', 'Updated Nearby Galaxy Catalog (UNGC)', 'U'],
    ['Surface features and landing sites', 336, 'features', 'IAU Gazetteer 293 + mission sites 43', 'S'],
    ['Milky Way landmarks', 185, 'objects', '157 globular clusters + 28 curated', 'G'],
    ['Messier objects', 110, 'objects', 'SIMBAD / OpenNGC', 'G'],
    ['Constellations', 88, 'figures', 'IAU lines (Stellarium) and boundaries', 'G'],
    ['Famous galaxies, curated', 37, 'galaxies', 'Literature compilation', 'U'],
    ['Interior cutaways', 18, 'bodies', 'Published seismology, gravity, geodesy', 'S'],
    ['All-sky maps', 14, 'wavebands', 'Radio to gamma rays (Planck, Gaia, 2MASS, WISE, ROSAT, Fermi)', 'G'],
    ['Measured black holes', 13, 'objects', 'Curated, 42 references', 'G'],
  ].sort((a, b) => b[1] - a[1]);
  const grp = { S: ['Solar System', C.accent], G: ['Stars and Galaxy', C.real], U: ['Universe', C.mod] };
  const W = 1800, rowH = 52, top = 190, H = top + rows.length * rowH + 110;
  const lx = 60, bx = 640, bw = 700, lo = 0, hi = Math.log10(5e6);
  let b = header('What’s inside Cosmos', 'Real catalogues, counted from public/data. Bar length is log scale (each tick is 10×); every record carries a source.');
  for (const e of [1, 10, 100, 1000, 10000, 100000, 1000000]) {
    const x = bx + ((Math.log10(e) - lo) / (hi - lo)) * bw;
    b += `<line x1="${x.toFixed(1)}" y1="${top - 14}" x2="${x.toFixed(1)}" y2="${top + rows.length * rowH - 10}" stroke="${C.grid}"/><text class="m" x="${x.toFixed(1)}" y="${top - 22}" font-size="12" text-anchor="middle" style="fill:${C.dim}">${e >= 1e6 ? '1M' : e >= 1000 ? e / 1000 + 'k' : e}</text>`;
  }
  rows.forEach(([name, n, unit, src, g], i) => {
    const y = top + i * rowH, w = Math.max(3, ((Math.log10(n) - lo) / (hi - lo)) * bw), col = grp[g][1];
    b += `<text x="${lx}" y="${y + 20}" font-size="18" class="h">${esc(name)}</text>`;
    b += `<text x="${lx}" y="${y + 39}" font-size="12.5" style="fill:${C.dim}">${esc(src)}</text>`;
    b += `<rect x="${bx}" y="${y + 8}" width="${w.toFixed(1)}" height="26" rx="2" fill="${col}"/>`;
    b += `<text class="m" x="${(bx + w + 12).toFixed(1)}" y="${y + 27}" font-size="16" style="fill:${C.text}">${fmt(n)}</text><text x="${(bx + w + 22 + 9.8 * fmt(n).length).toFixed(1)}" y="${y + 27}" font-size="14" class="s">${unit}</text>`;
  });
  const ly = top + rows.length * rowH + 18;
  Object.values(grp).forEach(([n, c], i) => {
    b += `<rect x="${60 + i * 220}" y="${ly}" width="16" height="16" rx="2" fill="${c}"/><text x="${84 + i * 220}" y="${ly + 13}" font-size="15">${n}</text>`;
  });
  b += `<text x="60" y="${ly + 50}" font-size="13" style="fill:${C.dim}">Counts from public/data/manifest.json (generated 2026-10-20) and docs/data/*.md. Orbital counts follow the CelesTrak snapshot of 2026-10-17; the on-screen total of about 31,800 is the objects with orbit elements.</text>
<text x="${W - 60}" y="${H - 20}" font-size="13" text-anchor="end" style="fill:${C.accent}">Cosmos · SCI-FORGE 2026</text>`;
  writeFileSync(resolve(here, 'inside.svg'), wrap(W, H, 'What’s inside Cosmos', 'Catalogue sizes and sources: 2.2 million galaxies, 109,389 stars, 75,855 asteroids, 35,652 satellites and debris, 6,451 exoplanets and more.', b));
}

// ───────────────────────── (c) performance per view ─────────────────────────
{
  const j = JSON.parse(readFileSync(resolve(root, '.work/perf/final.json'), 'utf8'));
  const names = { boot: 'Boot (Earth)', earth: 'Earth', 'earth-debris': 'Earth + debris', moon: 'Moon', sun: 'Sun', inner: 'Inner Solar System', mars: 'Mars', jupiter: 'Jupiter', 'jupiter-system': 'Jupiter system', saturn: 'Saturn', 'saturn-system': 'Saturn system', uranus: 'Uranus', neptune: 'Neptune', pluto: 'Pluto', belt: 'Asteroid belt', outer: 'Outer system', kuiper: 'Kuiper belt', stars: 'Nearby stars', milkyway: 'Milky Way', galaxies: 'Galaxies', trappist: 'TRAPPIST-1', 'mw-above': 'Milky Way from above', 'galactic-centre': 'Galactic centre', sstars: 'S-stars', 'sgr-a': 'Sagittarius A*', m31: 'Andromeda', 'local-group': 'Local Group', web: 'Cosmic web', cmb: 'CMB', home: 'Home' };
  const keys = Object.keys(names).filter((k) => j.views[k]);
  const rows = keys.map((k) => ({ k, n: names[k], gpu: j.views[k].gpuP50, gpu95: j.views[k].gpuP95, cpu: j.views[k].cpuP50, cpu95: j.views[k].cpuP95 }));
  const W = 1800, rowH = 34, top = 210, H = top + rows.length * rowH + 170, lx = 60, bx = 330, bw = 1000, max = 20;
  const X = (ms) => bx + (ms / max) * bw;
  let b = header('Frame time per view', `RTX 3050 Laptop (4 GB), Ultra quality, 1920×1080, ${j.date.slice(0, 10)}. Bars: median GPU time per frame. Whiskers: 95th percentile. Budget: 16.7 ms = 60 FPS.`);
  for (let ms = 0; ms <= max; ms += 2) b += `<line x1="${X(ms)}" y1="${top - 16}" x2="${X(ms)}" y2="${top + rows.length * rowH - 6}" stroke="${C.grid}"/><text class="m" x="${X(ms)}" y="${top - 24}" font-size="12" text-anchor="middle" style="fill:${C.dim}">${ms}</text>`;
  b += `<text class="m" x="${bx + bw + 20}" y="${top - 24}" font-size="12" style="fill:${C.dim}">ms</text>`;
  b += `<line x1="${X(16.67)}" y1="${top - 16}" x2="${X(16.67)}" y2="${top + rows.length * rowH - 6}" stroke="${C.mod}" stroke-dasharray="5 4"/><text x="${X(16.67) + 8}" y="${top - 46}" font-size="13" style="fill:${C.mod}">60 FPS budget (16.7 ms)</text>`;
  rows.forEach((r, i) => {
    const y = top + i * rowH;
    b += `<text x="${lx}" y="${y + 19}" font-size="16" class="h" style="font-weight:500">${esc(r.n)}</text>`;
    b += `<rect x="${bx}" y="${y + 4}" width="${(X(r.gpu) - bx).toFixed(1)}" height="18" rx="2" fill="${C.accent}"/>`;
    const xw = X(Math.max(r.gpu, r.gpu95));
    b += `<line x1="${X(r.gpu)}" y1="${y + 13}" x2="${xw.toFixed(1)}" y2="${y + 13}" stroke="${C.text}" stroke-width="1.5"/><line x1="${xw.toFixed(1)}" y1="${y + 7}" x2="${xw.toFixed(1)}" y2="${y + 19}" stroke="${C.text}" stroke-width="1.5"/>`;
    b += `<text class="m" x="${(xw + 12).toFixed(1)}" y="${y + 18}" font-size="13" style="fill:${C.text2}">${r.gpu.toFixed(1)} ms · p95 ${r.gpu95.toFixed(1)} · CPU ${r.cpu.toFixed(1)}</text>`;
  });
  const gMax = Math.max(...rows.map((r) => r.gpu)), g95 = Math.max(...rows.map((r) => r.gpu95)), cMax = Math.max(...rows.map((r) => r.cpu));
  const spikes = rows.filter((r) => r.cpu95 > 16.67).map((r) => r.n);
  const ly = top + rows.length * rowH + 20;
  b += `<text x="60" y="${ly + 10}" font-size="13" style="fill:${C.dim}">Measured by tools/perf-profile.mjs with vsync off, so frames are GPU-bound and not capped at 60. GPU time is the timer-query time of the whole frame, including bloom and tone mapping.</text>
<text x="60" y="${ly + 30}" font-size="13" style="fill:${C.dim}">Across ${rows.length} views: worst median GPU time ${gMax.toFixed(1)} ms, worst p95 ${g95.toFixed(1)} ms, worst median CPU time ${cMax.toFixed(1)} ms. Median and p95 GPU time stay inside the 16.7 ms budget in every view.</text>
<text x="60" y="${ly + 50}" font-size="13" style="fill:${C.dim}">CPU p95 exceeds 16.7 ms in ${spikes.length} views (${esc(spikes.join(', '))}): those are occasional long frames, not the median.</text>
<text x="${W - 60}" y="${H - 20}" font-size="13" text-anchor="end" style="fill:${C.accent}">Cosmos · SCI-FORGE 2026</text>`;
  writeFileSync(resolve(here, 'performance.svg'), wrap(W, H, 'Frame time per view', `Median and 95th-percentile GPU frame time for ${rows.length} views on an RTX 3050 Laptop at Ultra, 1920x1080.`, b));
}
console.log('charts written');
