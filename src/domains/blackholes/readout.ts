/**
 * Approach readout: while the camera is within ~10⁴ Schwarzschild radii of a black hole, a small instrument plate
 * shows what General Relativity says about "here": how fast your clock runs compared with far away, how much light
 * sent from here is redshifted, and how hard a 2 m body would be stretched. Updated 4× a second; plain DOM so it
 * needs no shared UI wiring. Opens the Black hole lab (relativity) on request.
 */
import type { CosmosStore } from '../../state/store';
import { approachReadout, G0 } from '../../render/blackhole/physics';
import type { BlackHoleModel } from './catalog';
import './readout.css';

const SHOW_WITHIN_RS = 1e4;
const BASE = (typeof import.meta !== 'undefined' && (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL) || '/';
/** The real thing next to the render, for black holes that have been imaged. */
const REAL_IMAGES: Record<string, { src: string; caption: string }> = {
  'bh:m87': {
    src: 'data/blackholes/eht-m87-2019.jpg',
    caption: 'The real M87*: Event Horizon Telescope 2019, 1.3 mm radio. EHT Collaboration, CC BY 4.0.',
  },
};

function sci(x: number, digits = 2): string {
  if (!Number.isFinite(x)) return '∞';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 5) return x.toLocaleString('en-US', { maximumSignificantDigits: digits + 1 });
  const m = x / 10 ** e;
  const sup = String(e).replace('-', '⁻').replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)]);
  return `${m.toFixed(digits - 1)} × 10${sup}`;
}

function lengthText(m: number): string {
  if (m < 1e3) return `${m.toFixed(0)} m`;
  if (m < 1e7) return `${sci(m / 1e3)} km`;
  if (m < 1.5e11 * 0.05) return `${sci(m / 1e3)} km`;
  return `${sci(m / 1.495978707e11)} AU`;
}

export interface Readout {
  update(model: BlackHoleModel | null, distanceM: number, dtSec: number): void;
  dispose(): void;
}

export function createReadout(container: HTMLElement | null, store: CosmosStore | null): Readout {
  if (!container || typeof document === 'undefined') return { update() {}, dispose() {} };
  const root = document.createElement('section');
  root.className = 'cx-bh-readout';
  root.setAttribute('data-testid', 'bh-readout');
  root.setAttribute('aria-live', 'off');
  root.setAttribute('aria-label', 'Relativity readout');
  root.hidden = true;
  root.innerHTML = `
    <header class="cx-bh-readout__head"><span class="cx-bh-readout__name"></span><span class="cx-bh-readout__dist"></span></header>
    <dl class="cx-bh-readout__grid">
      <dt>Your clock</dt><dd data-k="clock"></dd>
      <dt>Light from here</dt><dd data-k="z"></dd>
      <dt>Tidal stretch</dt><dd data-k="tide"></dd>
    </dl>
    <figure class="cx-bh-readout__real" hidden><img alt="" loading="lazy" decoding="async" /><figcaption></figcaption></figure>
    <p class="cx-bh-readout__note">For an observer hovering at rest (Schwarzschild). Tidal stretch across a 2 m body.</p>
    <button type="button" class="cx-bh-readout__lab">Open the black hole lab</button>`;
  container.appendChild(root);
  const name = root.querySelector('.cx-bh-readout__name') as HTMLElement;
  const dist = root.querySelector('.cx-bh-readout__dist') as HTMLElement;
  const clock = root.querySelector('[data-k="clock"]') as HTMLElement;
  const z = root.querySelector('[data-k="z"]') as HTMLElement;
  const tide = root.querySelector('[data-k="tide"]') as HTMLElement;
  const lab = root.querySelector('.cx-bh-readout__lab') as HTMLButtonElement;
  const real = root.querySelector('.cx-bh-readout__real') as HTMLElement;
  const realImg = real.querySelector('img') as HTMLImageElement;
  const realCap = real.querySelector('figcaption') as HTMLElement;
  let realFor = '';
  let current: BlackHoleModel | null = null;
  lab.addEventListener('click', () => {
    if (!store) return;
    store.setState({ lab: { active: 'relativity', params: current ? { entityId: current.id, massMsun: current.massMsun } : null } } as never);
  });
  let acc = 1;
  return {
    update(model, distanceM, dtSec) {
      acc += dtSec;
      if (acc < 0.25) return;
      acc = 0;
      const show = !!model && model.raw.class !== 'merger' && distanceM < SHOW_WITHIN_RS * model.rsM;
      if (!show || !model) {
        if (!root.hidden) root.hidden = true;
        current = null;
        return;
      }
      current = model;
      if (realFor !== model.id) {
        realFor = model.id;
        const ri = REAL_IMAGES[model.id];
        real.hidden = !ri;
        if (ri) {
          realImg.src = `${BASE}${ri.src}`;
          realImg.alt = `Event Horizon Telescope image of ${model.raw.name}`;
          realCap.textContent = ri.caption;
        }
      }
      const r = approachReadout(model.massMsun, distanceM);
      root.hidden = false;
      name.textContent = model.raw.name;
      dist.textContent = r.inside ? 'inside the event horizon' : `${sci(r.rOverRs, 3)} r_s · ${lengthText(distanceM)} from the centre`;
      if (r.inside) {
        clock.textContent = 'No way to hover: everything falls inward';
        z.textContent = 'Cannot escape';
      } else {
        clock.textContent = `${r.clockRate.toFixed(r.clockRate > 0.999 ? 5 : 3)}× · 1 s here = ${sci(r.farSecondsPerSecond, 3)} s far away`;
        z.textContent = r.redshiftZ < 1e-4 ? `z = ${sci(r.redshiftZ)} (barely)` : `z = ${sci(r.redshiftZ)} · wavelengths ×${sci(1 + r.redshiftZ, 3)}`;
      }
      const g = r.tidalMs2 / G0;
      tide.textContent = g < 1e-3 ? `${sci(g)} g · harmless` : g < 10 ? `${sci(g)} g · uncomfortable` : `${sci(g)} g · spaghettified`;
    },
    dispose() {
      root.remove();
    },
  };
}
