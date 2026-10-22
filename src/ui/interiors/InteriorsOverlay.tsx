import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { X, RotateCcw } from 'lucide-react';
import { Button, IconButton } from '../components/Button';
import { SegmentedControl } from '../components/SegmentedControl';
import { ProvenanceGlyph } from '../components/Provenance';
import { cx } from '../lib/dom';
import { drawnRadii, findBody, loadInteriors, type InteriorBody, type InteriorLayer, type InteriorsData } from './data';
import { CutawayRenderer, temperatureRange, type ColourMode, type CutawayLayout } from './cutaway';
import { layoutLabels, ringBottom } from './labelLayout';
import { depthText, fmtKm, fmtNum, fmtRange, MATERIAL_SWATCH, niceKm, PROVENANCE_CLASS, PROVENANCE_TEXT } from './format';

export interface InteriorsOverlayProps {
  /** Entity id ('sol:earth') or body key ('earth'). */
  entityId: string;
  onClose(): void;
  /** Start in compare mode with this body key (e.g. 'mars'). */
  initialCompare?: string | null;
  initialMode?: ColourMode;
  /** Layer index (centre = 0) to select once loaded. */
  initialLayer?: number | null;
}

type Sel = { body: number; layer: number } | null;

const LABEL_GAP = 50;

function prefersReducedMotion(): boolean {
  if (document.documentElement.dataset.reducedMotion === 'true') return true;
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Inferno stops for the CSS legend (same polynomial as the shader, sRGB). */
function infernoCss(): string {
  const c = [
    [0.0002189403691192265, 0.001651004631001012, -0.01948089843709184],
    [0.1065134194856116, 0.5639564367884091, 3.932712388889277],
    [11.60249308247187, -3.972853965665698, -15.9423941062914],
    [-41.70399613139459, 17.43639888205313, 44.35414519872813],
    [77.162935699427, -33.40235894210092, -81.80730925738993],
    [-71.31942824499214, 32.62606426397723, 73.20951985803202],
    [25.13112622477341, -12.24266895238567, -23.07032500287172],
  ];
  const stops: string[] = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const rgb = [0, 1, 2].map(k => {
      let v = 0;
      for (let j = 6; j >= 0; j--) v = v * t + c[j][k];
      return Math.round(Math.min(1, Math.max(0, v)) * 255);
    });
    stops.push(`rgb(${rgb.join(' ')}) ${t * 100}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

/** Ticks for the legend over [l0, l1] (log10 K): every decade, plus the 3x steps when the scale is short. */
function legendTicks([l0, l1]: [number, number]): Array<{ t: number; pct: number; label: string }> {
  const ts: number[] = [];
  for (let k = Math.ceil(l0); k <= l1; k++) {
    ts.push(10 ** k);
    if (l1 - l0 <= 3 && k < l1) ts.push(3 * 10 ** k);
  }
  return ts.map(t => ({
    t,
    pct: ((Math.log10(t) - l0) / (l1 - l0)) * 100,
    label: t >= 1e6 ? `${t / 1e6} million K` : `${t.toLocaleString('en-US')} K`,
  }));
}

export function InteriorsOverlay({ entityId, onClose, initialCompare = null, initialMode = 'material', initialLayer = null }: InteriorsOverlayProps) {
  const [data, setData] = useState<InteriorsData | null>(null);
  const [error, setError] = useState(false);
  const [compareKey, setCompareKey] = useState<string | null>(initialCompare);
  const [mode, setMode] = useState<ColourMode>(initialMode);
  const initialLayerRef = useRef(initialLayer);
  const [selected, setSelected] = useState<number | null>(null);
  const [hover, setHover] = useState<Sel>(null);
  const [tip, setTip] = useState<{ x: number; y: number; text: string } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<CutawayRenderer | null>(null);
  const labelRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const leaderRefs = useRef<Array<SVGPathElement | null>>([]);
  const dotRefs = useRef<Array<SVGCircleElement | null>>([]);
  const scaleRef = useRef<HTMLDivElement>(null);
  const captionRefs = useRef<Array<HTMLDivElement | null>>([]);
  const layoutRef = useRef<CutawayLayout | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const [scaleKm, setScaleKm] = useState(0);

  useEffect(() => {
    let live = true;
    loadInteriors().then(d => { if (live) setData(d); }, () => { if (live) setError(true); });
    return () => { live = false; };
  }, []);

  const body = useMemo(() => (data ? findBody(data, entityId) ?? null : null), [data, entityId]);
  const other = useMemo(() => (data && compareKey ? findBody(data, compareKey) ?? null : null), [data, compareKey]);
  const comparing = other != null;
  const layersOuterFirst = useMemo(() => (body ? body.layers.map((l, i) => ({ l, i })).reverse() : []), [body]);
  const exaggerated = useMemo(() => {
    if (!body) return [] as InteriorLayer[];
    const ex = drawnRadii(body).exaggerated;
    return body.layers.filter((_, i) => ex[i]);
  }, [body]);

  // Positions labels, leaders, captions and the scale bar directly (no React render per camera change).
  const placeOverlay = useCallback(() => {
    const layout = layoutRef.current;
    if (!layout || !body || layout.bodies.length === 0) return;
    const b0 = layout.bodies[0];
    const n = body.layers.length;
    const showLabels = !comparing;
    const { items: placed, colX, kneeX } = layoutLabels(b0, n, layout.width, layout.height);
    placed.forEach((p, i) => {
      const el = labelRefs.current[i];
      const path = leaderRefs.current[i];
      const dot = dotRefs.current[i];
      const vis = showLabels && p.visible;
      if (el) {
        el.style.transform = `translate(${Math.round(colX)}px, ${Math.round(p.y - 18)}px)`;
        el.dataset.visible = String(vis);
      }
      if (path) {
        const kx = Math.max(kneeX, p.ax + 12);
        path.setAttribute('d', `M${p.ax.toFixed(1)} ${p.ay.toFixed(1)} L${kx.toFixed(1)} ${p.y.toFixed(1)} L${(colX - 8).toFixed(1)} ${p.y.toFixed(1)}`);
        path.style.opacity = vis ? '1' : '0';
      }
      if (dot) {
        dot.setAttribute('cx', p.ax.toFixed(1));
        dot.setAttribute('cy', p.ay.toFixed(1));
        dot.style.opacity = vis ? '1' : '0';
      }
    });
    layout.bodies.forEach((b, k) => {
      const cap = captionRefs.current[k];
      if (cap) cap.style.transform = `translate(${Math.round(b.cx)}px, ${Math.round(Math.max(b.cy + b.rPx, ringBottom(b)) + 18)}px)`;
    });
    const km = niceKm(b0.kmPerPx * 160);
    if (scaleRef.current) scaleRef.current.style.width = `${Math.round(km / b0.kmPerPx)}px`;
    setScaleKm(prev => (prev === km ? prev : km));
  }, [body, comparing]);

  const placeRef = useRef(placeOverlay);
  placeRef.current = placeOverlay;

  // Renderer lifetime: created once on mount, disposed on unmount.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const insetLeft = (): number => (window.innerWidth < 900 ? 0 : panelRef.current?.getBoundingClientRect().right ?? 440);
    const r = new CutawayRenderer({
      canvas,
      reducedMotion: prefersReducedMotion(),
      insetLeft: insetLeft(),
      onLayout: layout => {
        layoutRef.current = layout;
        placeRef.current();
      },
    });
    rendererRef.current = r;
    const onResize = (): void => r.setInsetLeft(insetLeft());
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      r.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!body) return;
    rendererRef.current?.setBodies(body, other);
    setSelected(initialLayerRef.current != null && initialLayerRef.current < body.layers.length ? initialLayerRef.current : null);
    initialLayerRef.current = null;
    setHover(null);
  }, [body, other]);

  useEffect(() => { rendererRef.current?.setMode(mode); }, [mode]);
  useEffect(() => { rendererRef.current?.setSelected(selected == null ? null : { body: 0, layer: selected }); }, [selected]);
  useEffect(() => { rendererRef.current?.setHover(hover); }, [hover]);
  useEffect(() => { placeOverlay(); }, [placeOverlay]);
  useEffect(() => { if (body) headingRef.current?.focus(); }, [body]);

  const pickAt = (e: ReactPointerEvent<HTMLCanvasElement>): Sel => {
    const rect = e.currentTarget.getBoundingClientRect();
    return rendererRef.current?.pick(e.clientX - rect.left, e.clientY - rect.top) ?? null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    if (d) {
      const dx = e.clientX - d.x, dy = e.clientY - d.y;
      if (d.moved || Math.abs(dx) + Math.abs(dy) > 4) {
        d.moved = true;
        rendererRef.current?.orbitBy(dx, dy);
        d.x = e.clientX;
        d.y = e.clientY;
        setTip(null);
        return;
      }
    }
    if (e.pointerType !== 'mouse') return;
    const s = pickAt(e);
    setHover(prev => (prev?.body === s?.body && prev?.layer === s?.layer ? prev : s));
    const target = s ? (s.body === 0 ? body : other) : null;
    setTip(s && target ? { x: e.clientX, y: e.clientY, text: comparing ? `${target.name}: ${target.layers[s.layer].name}` : target.layers[s.layer].name } : null);
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLCanvasElement>): void => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const s = pickAt(e);
      if (s && s.body === 0) setSelected(prev => (prev === s.layer ? null : s.layer));
      else if (!s) setSelected(null);
    }
  };
  const onPointerLeave = (): void => {
    setHover(null);
    setTip(null);
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    e.stopPropagation();
    const tag = (e.target as HTMLElement).tagName;
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if (!body || tag === 'SELECT' || tag === 'INPUT') return;
    const inRadio = (e.target as HTMLElement).closest('[role="radiogroup"]');
    if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && !inRadio) {
      e.preventDefault();
      const n = body.layers.length;
      // The list reads surface -> centre, so ArrowDown goes deeper.
      setSelected(prev => {
        if (prev == null) return e.key === 'ArrowDown' ? n - 1 : 0;
        return Math.min(n - 1, Math.max(0, prev + (e.key === 'ArrowDown' ? -1 : 1)));
      });
    } else if (e.key === 't' || e.key === 'T') {
      setMode(m => (m === 'material' ? 'temperature' : 'material'));
    } else if (e.key === 'c' || e.key === 'C') {
      setCompareKey(k => (k ? null : body.compareWith));
    } else if (e.key === '+' || e.key === '=') {
      rendererRef.current?.zoomBy(1.12);
    } else if (e.key === '-') {
      rendererRef.current?.zoomBy(1 / 1.12);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      if (inRadio) return;
      rendererRef.current?.orbitBy(e.key === 'ArrowLeft' ? -40 : 40, 0);
    } else if (e.key === 'Tab' && panelRef.current) {
      // Keep focus inside the dialog.
      const root = e.currentTarget;
      const f = Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), select, [tabindex="0"], h2[tabindex]')).filter(el => el.offsetParent !== null);
      if (f.length === 0) return;
      const first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  };

  const sel = body && selected != null ? body.layers[selected] : null;
  const refs = data?.references ?? {};
  const usedSources = useMemo(() => {
    if (!body) return [] as string[];
    const s = new Set<string>();
    body.howWeKnow.forEach(h => h.sources.forEach(x => s.add(x)));
    body.layers.forEach(l => l.sources.forEach(x => s.add(x)));
    return [...s];
  }, [body]);
  const compareOptions = data?.bodies.filter(b => b.body !== body?.body) ?? [];

  return (
    <div
      className={cx('cx-int', comparing && 'is-comparing')}
      role="dialog"
      aria-modal="true"
      aria-labelledby="cx-int-title"
      data-testid="interiors-overlay"
      onKeyDown={onKeyDown}
    >
      <canvas
        ref={canvasRef}
        className="cx-int__canvas"
        aria-label={body ? `Cutaway of ${body.name} showing its layers. Drag to turn, use the layer list to read each layer.` : 'Cutaway view'}
        role="img"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerLeave}
        onWheel={e => rendererRef.current?.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08)}
      />
      <div className="cx-int__scrim" aria-hidden="true" />

      {body && (
        <>
          <svg className="cx-int__leaders" aria-hidden="true">
            {body.layers.map((l, i) => (
              <g key={l.id} className={cx('cx-int__leader', (selected === i || (hover?.body === 0 && hover.layer === i)) && 'is-active')}>
                <path ref={el => { leaderRefs.current[i] = el; }} />
                <circle ref={el => { dotRefs.current[i] = el; }} r="3" />
              </g>
            ))}
          </svg>
          <div className="cx-int__labels">
            {body.layers.map((l, i) => (
              <button
                key={l.id}
                type="button"
                tabIndex={-1}
                ref={el => { labelRefs.current[i] = el; }}
                className={cx('cx-int__label', selected === i && 'is-selected', hover?.body === 0 && hover.layer === i && 'is-hover')}
                onClick={() => setSelected(prev => (prev === i ? null : i))}
                onPointerEnter={() => setHover({ body: 0, layer: i })}
                onPointerLeave={() => setHover(null)}
              >
                <span className="cx-int__label-name">{l.name}</span>
                <span className="cx-int__label-sub">{l.state}</span>
              </button>
            ))}
          </div>
          {comparing && other && (
            <>
              {[body, other].map((b, k) => (
                <div key={b.body} className="cx-int__caption" ref={el => { captionRefs.current[k] = el; }}>
                  <span className="cx-int__caption-name">{b.name}</span>
                  <span className="cx-int__caption-sub">{fmtKm(b.radiusKm)} radius</span>
                </div>
              ))}
            </>
          )}
        </>
      )}

      <aside className="cx-int__panel" ref={panelRef} aria-label="Interior structure">
        <div className="cx-int__panel-top">
          <p className="cx-int__crumb">{body ? `${body.name} / Inside` : 'Inside'}</p>
          <IconButton label="Close the cutaway" icon={X} shortcut="Escape" onClick={onClose} data-testid="interiors-close" />
        </div>
        {error && <p className="cx-int__p">Couldn't load the interior data. Close this view and try again.</p>}
        {!data && !error && <p className="cx-int__p cx-int__muted">Loading the layers…</p>}
        {data && !body && <p className="cx-int__p">There is no interior model for this object yet.</p>}
        {body && (
          <>
            <p className="cx-int__class">Interior structure of a {body.classification.toLowerCase().startsWith('moon') ? 'moon' : body.classification.toLowerCase()}</p>
            <h2 id="cx-int-title" className="cx-int__title" tabIndex={-1} ref={headingRef}>{body.name}</h2>
            <p className="cx-int__lede">{body.lede}</p>
            {body.uncertainty && (
              <p className="cx-int__note">
                <ProvenanceGlyph kind="reconstructed" /> {body.uncertainty}
              </p>
            )}

            <h3 className="cx-int__h3">Layers, surface to centre</h3>
            <ol className="cx-int__layers" data-testid="interiors-layers">
              {layersOuterFirst.map(({ l, i }) => (
                <li key={l.id}>
                  <button
                    type="button"
                    className={cx('cx-int__layer', selected === i && 'is-selected')}
                    aria-expanded={selected === i}
                    onClick={() => setSelected(prev => (prev === i ? null : i))}
                    onPointerEnter={() => setHover({ body: 0, layer: i })}
                    onPointerLeave={() => setHover(null)}
                    onFocus={() => setHover({ body: 0, layer: i })}
                    onBlur={() => setHover(null)}
                  >
                    <span className="cx-int__swatch" style={{ background: MATERIAL_SWATCH[l.material] }} aria-hidden="true" />
                    <span className="cx-int__layer-name">{l.name}</span>
                    <span className="cx-int__layer-depth">{depthText(body, l)}</span>
                  </button>
                  {selected === i && sel && <LayerFacts body={body} layer={sel} refs={refs} />}
                </li>
              ))}
            </ol>

            <h3 className="cx-int__h3">How do we know?</h3>
            {body.howWeKnow.map(h => (
              <div key={h.method} className="cx-int__method">
                <p className="cx-int__method-name">{h.method}</p>
                <p className="cx-int__p">{h.text}</p>
              </div>
            ))}

            <details className="cx-int__sources">
              <summary>Sources ({usedSources.length})</summary>
              <ul>
                {usedSources.map(k => (
                  <li key={k}>
                    {refs[k]?.cite ?? k}
                    {refs[k]?.doi && <span className="cx-int__doi"> doi:{refs[k].doi}</span>}
                  </li>
                ))}
              </ul>
            </details>
          </>
        )}
      </aside>

      <div className="cx-int__tools">
        <SegmentedControl<ColourMode>
          label="Colour the layers by"
          size="sm"
          value={mode}
          onChange={setMode}
          options={[{ value: 'material', label: 'Material' }, { value: 'temperature', label: 'Temperature' }]}
        />
        {body && (
          <Button size="sm" variant="secondary" pressed={comparing} onClick={() => setCompareKey(k => (k ? null : body.compareWith))} data-testid="interiors-compare">
            {comparing ? 'Stop comparing' : `Compare with ${findBody(data!, body.compareWith)?.name ?? 'another body'}`}
          </Button>
        )}
        {comparing && (
          <label className="cx-int__select">
            <span className="cx-sr-only">Compare with</span>
            <select value={compareKey ?? ''} onChange={e => setCompareKey(e.target.value || null)}>
              {compareOptions.map(b => <option key={b.body} value={b.body}>{b.name}</option>)}
            </select>
          </label>
        )}
        <IconButton label="Reset view" icon={RotateCcw} size="sm" onClick={() => rendererRef.current?.resetView()} />
      </div>

      {body && (
        <div className="cx-int__foot">
          <div className="cx-int__scale">
            <div className="cx-int__scale-bar" ref={scaleRef} />
            <span className="cx-int__scale-text">{fmtKm(scaleKm)}{comparing ? ', both bodies at the same scale' : ''}</span>
          </div>
          {mode === 'temperature' ? (
            <div className="cx-int__legend" aria-label="Temperature colour scale, logarithmic">
              <div className="cx-int__legend-bar" style={{ background: infernoCss() }} />
              <div className="cx-int__legend-ticks">
                {legendTicks(temperatureRange([body, other])).map(t => <span key={t.t} style={{ left: `${t.pct}%` }}>{t.label}</span>)}
              </div>
              <p className="cx-int__disclose">Temperatures are model estimates; hatched layers are unknown.</p>
            </div>
          ) : (
            <p className="cx-int__disclose">
              Illustrative colours. Layer sizes to scale
              {exaggerated.length > 0 ? `, except the thinnest (${exaggerated.map(l => l.name.toLowerCase()).join(', ')}), drawn thicker so they can be seen.` : '.'}
            </p>
          )}
        </div>
      )}

      {tip && <div className="cx-int__tip" style={{ transform: `translate(${tip.x + 14}px, ${tip.y + 14}px)` }} role="status">{tip.text}</div>}
    </div>
  );
}

/** "Weber et al. 2011" / "Hedman & Nicholson 2013" from a full citation. */
function shortCite(cite: string): string {
  const year = /\((\d{4})\)/.exec(cite)?.[1] ?? '';
  const authors = cite.slice(0, Math.max(0, cite.indexOf(' (')));
  const first = authors.split(',')[0].trim();
  if (/et al\./.test(authors)) return `${first} et al. ${year}`;
  const parts = authors.split('&').map(p => p.trim());
  if (parts.length === 2 && parts[0].split(',').length <= 3) return `${first} & ${parts[1].split(',')[0].trim()} ${year}`;
  if (parts.length >= 2) return `${first} et al. ${year}`;
  return `${first} ${year}`.trim();
}

function LayerFacts({ body, layer, refs }: { body: InteriorBody; layer: InteriorLayer; refs: InteriorsData['references'] }) {
  const pct = (layer.outerKm / body.radiusKm) * 100;
  return (
    <div className="cx-int__facts" data-testid="interiors-facts">
      <p className="cx-int__p">{layer.plain}</p>
      <dl className="cx-int__grid">
        <div><dt>Depth</dt><dd>{depthText(body, layer)}</dd></div>
        <div>
          <dt>Outer edge from the centre</dt>
          <dd>
            {fmtKm(layer.outerKm)} ({fmtNum(pct)}% of the radius)
            {layer.outerRangeKm && <span className="cx-int__range">Models: {fmtRange(layer.outerRangeKm, 'km')}</span>}
          </dd>
        </div>
        <div><dt>Thickness</dt><dd>{fmtKm(layer.thicknessKm)}</dd></div>
        <div><dt>State</dt><dd>{layer.state}</dd></div>
        <div className="cx-int__wide"><dt>Made of</dt><dd>{layer.composition}</dd></div>
        <div><dt>Density</dt><dd>{fmtRange(layer.densityKgM3, 'kg/m³')}</dd></div>
        <div><dt>Temperature</dt><dd>{fmtRange(layer.temperatureK, 'K')}</dd></div>
        <div className="cx-int__wide">
          <dt>Evidence</dt>
          <dd>
            <ProvenanceGlyph kind={PROVENANCE_CLASS[layer.provenance]} /> {PROVENANCE_TEXT[layer.provenance]}
            {layer.model && layer.provenance !== 'model' ? '; boundary is model-dependent' : ''}
          </dd>
        </div>
      </dl>
      <p className="cx-int__cite">
        {layer.sources.map(s => shortCite(refs[s]?.cite ?? s)).join('; ')}
      </p>
    </div>
  );
}
