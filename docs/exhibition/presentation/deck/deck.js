// Cosmos deck: navigation, presenter view, audience window, static/print modes, and the two inline charts.
(() => {
  const params = new URLSearchParams(location.search);
  const mode = params.has('print') ? 'print' : params.has('static') ? 'static' : 'screen';
  document.body.classList.add(mode);
  const stage = document.getElementById('stage');
  const slides = [...stage.querySelectorAll('.slide')];
  const count = slides.length;
  let index = 0;

  // ---- charts (drawn once into the slides' SVGs) ----
  const NS = 'http://www.w3.org/2000/svg';
  const el = (name, attrs, text) => {
    const n = document.createElementNS(NS, name);
    for (const k in attrs) n.setAttribute(k, attrs[k]);
    if (text != null) n.textContent = text;
    return n;
  };

  // Distance ladder, log10 metres (values as on slide 2 / facts.md).
  const ladder = document.getElementById('ladder');
  if (ladder) {
    const lo = 2, hi = 27, x0 = 10, x1 = 1750, y = 150;
    const X = (e) => x0 + ((e - lo) / (hi - lo)) * (x1 - x0);
    ladder.append(el('line', { x1: x0, x2: x1, y1: y, y2: y, stroke: 'oklch(1 0 0 / 0.26)', 'stroke-width': 1 }));
    for (let e = lo; e <= hi; e++) {
      const major = e % 5 === 0;
      ladder.append(el('line', { x1: X(e), x2: X(e), y1: y - (major ? 10 : 5), y2: y + (major ? 10 : 5), stroke: 'oklch(1 0 0 / 0.3)', 'stroke-width': 1 }));
      if (major || e === lo || e === hi) {
        const t = el('text', { x: X(e), y: y + 34, 'text-anchor': 'middle', fill: 'oklch(0.7 0 0)', 'font-size': 18 });
        t.append('10');
        t.append(el('tspan', { dy: -8, 'font-size': 13 }, String(e)));
        t.append(el('tspan', { dy: 8, 'font-size': 18 }, ' m'));
        ladder.append(t);
      }
    }
    const marks = [
      ['ISS', '109 m', 109], ['Earth', '12,742 km', 1.2742e7], ['Moon', '384,400 km', 3.844e8], ['Sun', '1 AU', 1.496e11],
      ['Neptune', '30 AU', 4.498e12], ['Voyager 1', '172 AU', 2.573e13], ['Proxima Cen', '4.25 ly', 4.02e16],
      ['Sgr A*', '27,000 ly', 2.554e20], ['Andromeda', '2.5 million ly', 2.365e22], ['Laniakea', '520 million ly', 4.92e24],
      ['CMB', '45 billion ly', 4.28e26],
    ];
    marks.forEach(([name, value, m], i) => {
      const x = X(Math.log10(m));
      const up = i % 2 === 0;
      const ly = up ? y - 62 : y + 92;
      ladder.append(el('line', { x1: x, x2: x, y1: y, y2: up ? y - 44 : y + 56, stroke: 'oklch(0.85 0.1 88 / 0.7)', 'stroke-width': 1 }));
      ladder.append(el('circle', { cx: x, cy: y, r: 6, fill: 'oklch(0.85 0.1 88)', stroke: '#000', 'stroke-width': 2 }));
      const anchor = x > 1650 ? 'end' : x < 60 ? 'start' : 'middle';
      ladder.append(el('text', { x, y: ly - (up ? 26 : 0), 'text-anchor': anchor, fill: 'oklch(0.93 0 0)', 'font-size': 24, 'font-weight': 500 }, name));
      ladder.append(el('text', { x, y: ly + (up ? 0 : 26), 'text-anchor': anchor, fill: 'oklch(0.8 0 0)', 'font-size': 20 }, value));
    });
  }

  // Golden-journey frame rate per chapter (.work/shots/final/journey/log.json, production build, 1920×1080 Ultra).
  const fps = document.getElementById('fps');
  if (fps) {
    const chapters = ['Earth', 'ISS', 'Debris lab', 'Moon', 'Sun', 'The planets', 'Jupiter', 'Saturn', 'DART lab', 'Looking back',
      'Oort cloud', 'Proxima', 'TRAPPIST-1', 'Orion Arm', 'Milky Way', 'Sgr A*', 'Black hole', 'Andromeda', 'Local Group',
      'Laniakea', 'Cosmic web', 'CMB', 'Home'];
    const values = [100, 96.9, 100, 100, 99.4, 100, 99.8, 99.8, 100, 100, 99.9, 100, 99.4, 64.6, 100, 100, 100, 100, 100, 99.8, 100, 100, 100];
    const L = 64, R = 1740, T = 36, B = 250, max = 120;
    const Y = (v) => B - (v / max) * (B - T);
    for (const g of [0, 30, 60, 90, 120]) {
      fps.append(el('line', { x1: L, x2: R, y1: Y(g), y2: Y(g), stroke: g === 0 ? 'oklch(1 0 0 / 0.3)' : 'oklch(1 0 0 / 0.08)', 'stroke-width': 1 }));
      fps.append(el('text', { x: L - 12, y: Y(g) + 6, 'text-anchor': 'end', fill: 'oklch(0.7 0 0)', 'font-size': 17 }, String(g)));
    }
    fps.append(el('text', { x: L - 12, y: T - 18, 'text-anchor': 'end', fill: 'oklch(0.7 0 0)', 'font-size': 15 }, 'fps'));
    const step = (R - L) / values.length, w = step - 10;
    values.forEach((v, i) => {
      const x = L + i * step + 5, top = Y(v), r = 4;
      const d = `M${x},${B} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${B} Z`;
      const bar = el('path', { d, fill: i === 13 ? 'oklch(0.78 0.14 52)' : 'oklch(0.8 0.085 235)' });
      bar.append(el('title', {}, `${i + 1}. ${chapters[i]}: ${v} fps`));
      fps.append(bar);
      fps.append(el('text', { x: x + w / 2, y: B + 24, 'text-anchor': 'middle', fill: 'oklch(0.7 0 0)', 'font-size': 16 }, String(i + 1)));
    });
    fps.append(el('line', { x1: L, x2: R, y1: Y(60), y2: Y(60), stroke: 'oklch(0.93 0 0 / 0.75)', 'stroke-width': 2, 'stroke-dasharray': '8 6' }));
    const xo = L + 13 * step + 5 + w / 2;
    fps.append(el('text', { x: xo, y: Y(64.6) - 12, 'text-anchor': 'middle', fill: 'oklch(0.93 0 0)', 'font-size': 19, 'font-weight': 500 }, '65'));
    fps.append(el('text', { x: xo, y: B + 48, 'text-anchor': 'middle', fill: 'oklch(0.93 0 0)', 'font-size': 17, 'font-weight': 500 }, 'Orion Arm'));
    fps.append(el('text', { x: L + 2.5 * step, y: Y(100) - 10, 'text-anchor': 'middle', fill: 'oklch(0.93 0 0)', 'font-size': 19, 'font-weight': 500 }, '97–100 fps'));
    fps.append(el('text', { x: R, y: B + 48, 'text-anchor': 'end', fill: 'oklch(0.7 0 0)', 'font-size': 16 }, 'chapter (1 Earth … 22 CMB, 23 home)'));
  }

  // ---- notes ----
  const notesOf = (s) => (s.querySelector('.notes')?.textContent ?? '').trim();
  window.__deck = { count, notes: slides.map(notesOf), titles: slides.map((s) => s.dataset.title ?? '') };

  if (mode === 'print') { slides.forEach((s) => s.classList.add('active')); return; }

  // ---- layout ----
  const fit = () => {
    if (mode === 'static') return;
    const s = Math.min(innerWidth / 1920, innerHeight / 1080);
    stage.style.transform = `scale(${s}) translate(-50%, -50%)`;
    for (const f of document.querySelectorAll('.p-frame')) {
      const c = f.firstElementChild;
      if (c) c.style.transform = `scale(${f.clientWidth / 1920})`;
    }
  };

  // ---- presenter ----
  const presenter = document.getElementById('presenter');
  let audience = null;
  let t0 = Date.now();
  const timer = document.getElementById('p-timer');
  setInterval(() => {
    const s = Math.floor((Date.now() - t0) / 1000);
    timer.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
  }, 500);
  const mirror = (id, i) => {
    const box = document.getElementById(id);
    box.replaceChildren();
    if (i < count) { const c = slides[i].cloneNode(true); c.classList.add('active'); box.append(c); }
  };
  const renderPresenter = () => {
    if (presenter.hidden) return;
    mirror('p-current', index);
    mirror('p-next', index + 1);
    document.getElementById('p-count').textContent = `${index + 1} / ${count}  ·  ${slides[index].dataset.title}`;
    document.getElementById('p-notes').textContent = notesOf(slides[index]) || '(no notes)';
    fit();
  };

  // ---- navigation ----
  const go = (i, fromRemote = false) => {
    index = Math.max(0, Math.min(count - 1, i));
    slides.forEach((s, k) => s.classList.toggle('active', k === index));
    document.getElementById('counter').textContent = `${index + 1} / ${count}`;
    if (location.hash !== `#${index + 1}`) history.replaceState(null, '', `#${index + 1}`);
    renderPresenter();
    if (!fromRemote) {
      const msg = { cosmosDeck: index };
      if (audience && !audience.closed) audience.postMessage(msg, '*');
      if (window.opener && !window.opener.closed) window.opener.postMessage(msg, '*');
    }
  };
  window.__deck.go = (n) => go(n - 1);
  addEventListener('message', (e) => { if (e.data && typeof e.data.cosmosDeck === 'number') go(e.data.cosmosDeck, true); });

  addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (['ArrowRight', 'ArrowDown', 'PageDown', ' ', 'Enter'].includes(k)) { go(index + 1); e.preventDefault(); }
    else if (['ArrowLeft', 'ArrowUp', 'PageUp', 'Backspace'].includes(k)) { go(index - 1); e.preventDefault(); }
    else if (k === 'Home') go(0);
    else if (k === 'End') go(count - 1);
    else if (k === 'p' || k === 'P') { presenter.hidden = !presenter.hidden; document.body.classList.toggle('presenter', !presenter.hidden); renderPresenter(); fit(); }
    else if (k === 'w' || k === 'W') { audience = window.open(location.href.split('#')[0].split('?')[0] + `#${index + 1}`, 'cosmos-audience', 'popup'); }
    else if (k === 'f' || k === 'F') { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen?.(); }
    else if (k === 'r' || k === 'R') t0 = Date.now();
  });
  addEventListener('click', (e) => {
    if (e.target.closest('a, button, .p-notes')) return;
    go(e.clientX < innerWidth * 0.25 ? index - 1 : index + 1);
  });
  addEventListener('resize', fit);
  addEventListener('hashchange', () => { const n = parseInt(location.hash.slice(1), 10); if (n && n - 1 !== index) go(n - 1); });

  fit();
  go((parseInt(location.hash.slice(1), 10) || 1) - 1);
})();
