import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useCosmosShallow, useManifest } from '../hooks';
import { formatIsoDateLong } from '../format';
import { Button } from '../components/Button';

/** The loader index.html paints before any script runs (its critical CSS is inline there). */
export const LOADER_ID = 'cx-loader';
/** Length of the loader's exit crossfade (index.html `.cxl` transitions) before its node is removed. */
const EXIT_MS = 1500;
/** Cursor sweep duration (index.html `.cxl__cursor` transition): landmarks light up as the cursor passes them. */
const SWEEP_MS = 900;
const TAGLINE = 'From the Earth to the edge of the observable universe';

/** Engine status lines read "Stage · detail" (e.g. "Linking shaders · 12 of 40 objects"). */
function splitMessage(message: string): [string, string] {
  const i = message.indexOf(' · ');
  return i < 0 ? [message, ''] : [message.slice(0, i), message.slice(i + 3)];
}

function findLoader(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.getElementById(LOADER_ID);
}

function setText(el: Element | null | undefined, text: string): void {
  if (el && el.textContent !== text) el.textContent = text;
}

/**
 * Boot: drives the Cosmic Ruler loader that index.html already painted (one DOM from first paint to first frame, so
 * nothing re-mounts or shifts), with the engine's real progress and status. On boot.phase 'ready' it crossfades into the
 * rendered scene and removes itself; WebGL failures are explained in place. Without the pre-painted node (a hot reload
 * after it was removed) it renders a minimal equivalent.
 */
export function BootScreen() {
  const boot = useCosmosShallow(s => ({ phase: s.boot.phase, progress: s.boot.progress, message: s.boot.message, error: s.boot.error, webgl: s.boot.webgl }));
  const manifest = useManifest();
  const [el, setEl] = useState<HTMLElement | null>(findLoader);
  const shownP = useRef(-1);
  const litAt = useRef(Number.NEGATIVE_INFINITY);
  const unsupported = boot.webgl === 'unsupported';
  const failed = boot.phase === 'error';
  const done = boot.phase === 'ready' && !unsupported;
  const p = done ? 1 : Math.min(1, Math.max(0, boot.progress));
  const [stage, detail] = splitMessage(done ? 'Ready' : boot.message || 'Loading Cosmos');
  const pct = `${Math.round(p * 100)} %`;
  const detailText = detail ? `${detail} · ${pct}` : pct;

  // Progress, status and landmarks: direct writes to the pre-painted DOM.
  useLayoutEffect(() => {
    if (!el) return;
    el.classList.add('is-live');
    const prev = shownP.current < 0 ? Number(el.style.getPropertyValue('--p') || 0.02) : shownP.current;
    shownP.current = p;
    el.style.setProperty('--p', p.toFixed(4));
    const sweep = p - prev;
    for (const m of el.querySelectorAll<HTMLElement>('.cxl__m')) {
      const at = Number(m.dataset.at);
      const passed = at <= p;
      if (passed && !m.classList.contains('is-passed')) {
        // Light each landmark when the sweeping cursor reaches it, not all at once.
        // Never before a nearer landmark still waiting from an earlier sweep (the cursor passes them in order).
        const now = performance.now();
        const sweepDelay = sweep > 0 ? Math.max(0, (at - prev) / sweep) * SWEEP_MS * 0.75 : 0;
        const delay = Math.max(sweepDelay, litAt.current + 60 - now);
        litAt.current = now + delay;
        m.style.setProperty('--d', `${Math.round(delay)}ms`);
      }
      m.classList.toggle('is-passed', passed);
    }
    el.querySelector('[role="progressbar"]')?.setAttribute('aria-valuenow', String(Math.round(p * 100)));
    setText(el.querySelector('.cxl__stage'), stage);
    setText(el.querySelector('.cxl__detail'), detailText);
  }, [el, p, stage, detailText]);

  useLayoutEffect(() => {
    if (!el) return;
    el.classList.toggle('is-error', failed || unsupported);
    el.setAttribute('aria-busy', String(!done && !failed && !unsupported));
  }, [el, failed, unsupported, done]);

  useLayoutEffect(() => {
    setText(el?.querySelector('.cxl__snap'), manifest ? `Data snapshot ${formatIsoDateLong(manifest.generated)}` : '');
  }, [el, manifest]);

  // Ready: the scene is already drawn underneath; lift the loader off it (non-blocking: input passes through at once).
  useEffect(() => {
    if (!el || !done) return;
    el.classList.add('is-done');
    const id = window.setTimeout(() => {
      el.remove();
      setEl(null);
    }, EXIT_MS);
    return () => window.clearTimeout(id);
  }, [el, done]);

  let errorBody: ReactNode = null;
  if (unsupported) {
    errorBody = (
      <div role="alert">
        <p className="cxl__error-line">This browser can't draw 3D graphics (WebGL 2 is unavailable).</p>
        <p>Open Cosmos in a current version of Chrome, Edge or Firefox with hardware acceleration turned on.</p>
      </div>
    );
  } else if (failed) {
    errorBody = (
      <div role="alert">
        <p className="cxl__error-line">Cosmos couldn't start.</p>
        <p>{boot.error ?? 'An unknown error stopped the engine.'}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    );
  }

  if (el) {
    const slot = el.querySelector<HTMLElement>('.cxl__error');
    return errorBody && slot ? createPortal(errorBody, slot) : null;
  }
  if (done) return null;
  return (
    <div className="cxl is-live is-fonts" style={{ '--p': p } as CSSProperties} aria-busy={!failed && !unsupported}>
      <div className="cxl__inner">
        <header className="cxl__mark">
          <h1 className="cxl__word">Cosmos</h1>
          <p className="cxl__tag">{TAGLINE}</p>
        </header>
        <div className="cxl__rule">
          <div className="cxl__ticks" role="progressbar" aria-label="Loading Cosmos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p * 100)}>
            <span className="cxl__cursor" aria-hidden="true" />
          </div>
          {errorBody ? (
            <div className="cxl__error">{errorBody}</div>
          ) : (
            <p className="cxl__status">
              <span className="cxl__stage" role="status" aria-live="polite">{stage}</span>
              <span className="cxl__detail" aria-hidden="true">{detailText}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
