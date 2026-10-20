/**
 * Exoplanet explorer charts: discoveries per year stacked by method (SVG), and log–log scatter plots on a canvas
 * (mass–radius, period–distance) for the ~6,000 archive planets, coloured by discovery method (Okabe–Ito, the same
 * colours as the 3-D marker field). Solar System planets are drawn as labelled reference rings. Hover shows the planet,
 * click flies to its system.
 */
import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { METHOD_COLORS, METHOD_GROUPS, type ExoCatalog } from '../../domains/exoplanets/catalog';
import type { MethodYearCounts } from '../../domains/exoplanets/stats';
import { useElementSize } from '../debris/Charts';

// ── Discoveries per year ─────────────────────────────────────────────────────────────────────

export function YearChart({ counts }: { counts: MethodYearCounts }) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const L = 44, R = 8, T = 10, B = 26;
  const n = counts.byYear.length;
  const totals = counts.byYear.map((r) => r.reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...totals);
  const niceMax = max <= 100 ? Math.ceil(max / 20) * 20 : max <= 1000 ? Math.ceil(max / 200) * 200 : Math.ceil(max / 500) * 500;
  const pw = Math.max(1, w - L - R);
  const ph = Math.max(1, h - T - B);
  const bw = pw / n;
  const yTicks = [0, niceMax / 2, niceMax];
  return (
    <div ref={ref} className="hab-chart hab-chart--short">
      {w > 0 && (
        <svg width={w} height={h} role="img" aria-label="Exoplanet discoveries per year, stacked by discovery method" onPointerLeave={() => setHover(null)}>
          <rect className="dl-plotbg" x={L} y={T} width={pw} height={ph} />
          {yTicks.map((t) => {
            const y = T + ph - (t / niceMax) * ph;
            return (
              <g key={t}>
                <line className="dl-grid" x1={L} x2={L + pw} y1={y} y2={y} />
                <text className="dl-axis-label" x={L - 6} y={y + 4} textAnchor="end">{t.toLocaleString('en-US')}</text>
              </g>
            );
          })}
          {counts.byYear.map((row, k) => {
            let acc = 0;
            const x = L + k * bw;
            return (
              <g key={k} onPointerEnter={() => setHover(k)}>
                <rect x={x} y={T} width={bw} height={ph} fill="transparent" />
                {row.map((v, m) => {
                  if (!v) return null;
                  const y0 = T + ph - ((acc + v) / niceMax) * ph;
                  const hh = (v / niceMax) * ph;
                  acc += v;
                  return <rect key={m} x={x + 0.5} y={y0} width={Math.max(1, bw - 1)} height={hh} fill={METHOD_COLORS[m]} opacity={hover == null || hover === k ? 0.92 : 0.45} />;
                })}
              </g>
            );
          })}
          {Array.from({ length: n }, (_, k) => counts.year0 + k).filter((y) => y % 5 === 0).map((y) => (
            <text key={y} className="dl-axis-label" x={L + (y - counts.year0 + 0.5) * bw} y={T + ph + 16} textAnchor="middle">{y}</text>
          ))}
          {hover != null && (
            <text className="dl-axis-title" x={L + 8} y={T + 14}>
              {counts.year0 + hover}: {totals[hover].toLocaleString('en-US')} planet{totals[hover] === 1 ? '' : 's'}
            </text>
          )}
        </svg>
      )}
    </div>
  );
}

export function MethodLegend({ counts, mask, onToggle }: { counts: number[]; mask: number; onToggle(m: number): void }) {
  return (
    <ul className="hab-legend" aria-label="Discovery methods (toggle to filter)">
      {METHOD_GROUPS.map((g, m) => (
        <li key={g}>
          <button type="button" className="hab-legend__item" aria-pressed={!!((mask >> m) & 1)} onClick={() => onToggle(m)}>
            <span className="hab-legend__sw" style={{ background: METHOD_COLORS[m] }} aria-hidden="true" />
            <span>{g}</span>
            <span className="cx-num hab-legend__n">{counts[m].toLocaleString('en-US')}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

// ── Log–log scatter ──────────────────────────────────────────────────────────────────────────

export interface ScatterSpec {
  id: 'mass-radius' | 'period-distance';
  title: string;
  xLabel: string;
  yLabel: string;
  x: (c: ExoCatalog, i: number) => number;
  y: (c: ExoCatalog, i: number) => number;
  xRange: [number, number];
  yRange: [number, number];
  /** Labelled reference points (Solar System). */
  refs: ReadonlyArray<{ label: string; x: number; y: number }>;
}

/** Solar System references: NASA Planetary Fact Sheets (Williams 2024). Distance of the Solar System planets is ~0. */
export const SCATTERS: readonly ScatterSpec[] = [
  {
    id: 'mass-radius', title: 'Mass and radius', xLabel: 'Mass (Earth = 1)', yLabel: 'Radius (Earth = 1)',
    // Measured pairs only: masses or radii the archive computed from a mass–radius relation would draw the relation itself.
    x: (c, i) => (c.planets.massProv[i] === 4 ? NaN : c.planets.massE[i]),
    y: (c, i) => (c.planets.calc[i] & 1 ? NaN : c.planets.radiusE[i]),
    xRange: [0.03, 30000], yRange: [0.2, 30],
    refs: [
      { label: 'Mars', x: 0.107, y: 0.532 }, { label: 'Earth', x: 1, y: 1 }, { label: 'Venus', x: 0.815, y: 0.949 },
      { label: 'Uranus', x: 14.54, y: 4.007 }, { label: 'Neptune', x: 17.15, y: 3.883 }, { label: 'Saturn', x: 95.16, y: 9.449 },
      { label: 'Jupiter', x: 317.8, y: 11.21 },
    ],
  },
  {
    id: 'period-distance', title: 'Orbital period and distance from us', xLabel: 'Orbital period (days)', yLabel: 'Distance from the Sun (light-years)',
    x: (c, i) => c.planets.periodDays[i], y: (c, i) => { const h = c.planets.host[i]; return h >= 0 ? c.hosts.distPc[h] * 3.26156 : NaN; },
    xRange: [0.1, 1e7], yRange: [3, 30000],
    refs: [],
  },
];

const fin = (v: number): boolean => Number.isFinite(v) && v > 0;

function decades(lo: number, hi: number): number[] {
  const out: number[] = [];
  for (let e = Math.ceil(Math.log10(lo) - 1e-9); e <= Math.floor(Math.log10(hi) + 1e-9); e++) out.push(10 ** e);
  return out;
}

const fmtTick = (v: number): string => (v >= 1e4 || v < 0.01 ? `10${superscript(Math.round(Math.log10(v)))}` : v.toLocaleString('en-US'));
function superscript(n: number): string {
  const map: Record<string, string> = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
  return String(n).split('').map((ch) => map[ch] ?? ch).join('');
}

export function Scatter({ spec, catalog, pass, highlight, onPick }: {
  spec: ScatterSpec;
  catalog: ExoCatalog;
  /** Filter: planet index → shown. */
  pass: (i: number) => boolean;
  /** Planet indices drawn emphasised (showcase, current). */
  highlight: ReadonlySet<number>;
  onPick(planet: number): void;
}) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const L = 52, R = 10, T = 10, B = 34;
  const pw = Math.max(1, w - L - R);
  const ph = Math.max(1, h - T - B);
  const lx0 = Math.log10(spec.xRange[0]), lx1 = Math.log10(spec.xRange[1]);
  const ly0 = Math.log10(spec.yRange[0]), ly1 = Math.log10(spec.yRange[1]);
  const sx = (v: number): number => L + ((Math.log10(v) - lx0) / (lx1 - lx0)) * pw;
  const sy = (v: number): number => T + ph - ((Math.log10(v) - ly0) / (ly1 - ly0)) * ph;

  // Screen positions of plotted points (for hit testing), recomputed with the layout or the filter.
  const pts = useMemo(() => {
    const idx: number[] = [];
    const xy: number[] = [];
    for (let i = 0; i < catalog.planets.count; i++) {
      const xv = spec.x(catalog, i), yv = spec.y(catalog, i);
      if (!fin(xv) || !fin(yv) || !pass(i)) continue;
      idx.push(i);
      xy.push(sx(xv), sy(yv));
    }
    return { idx, xy };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalog, spec, pass, w, h]);

  useEffect(() => {
    const cv = canvas.current;
    if (!cv || w <= 0) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = Math.round(pw * dpr);
    cv.height = Math.round(ph * dpr);
    const g = cv.getContext('2d');
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, -L * dpr, -T * dpr);
    g.clearRect(L, T, pw, ph);
    g.globalCompositeOperation = 'lighter';
    const { idx, xy } = pts;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (highlight.has(i)) continue;
      g.fillStyle = METHOD_COLORS[catalog.planets.method[i]];
      g.globalAlpha = 0.55;
      g.beginPath();
      g.arc(xy[2 * k], xy[2 * k + 1], 1.6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    for (let k = 0; k < idx.length; k++) {
      const i = idx[k];
      if (!highlight.has(i)) continue;
      g.fillStyle = METHOD_COLORS[catalog.planets.method[i]];
      g.strokeStyle = '#fff';
      g.lineWidth = 1.25;
      g.beginPath();
      g.arc(xy[2 * k], xy[2 * k + 1], 3.6, 0, Math.PI * 2);
      g.fill();
      g.stroke();
    }
  }, [pts, highlight, catalog, w, h, pw, ph]);

  const nearest = (e: ReactMouseEvent<HTMLDivElement>): { i: number; x: number; y: number } | null => {
    const r = e.currentTarget.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    let best = -1, bd = 64;
    const { idx, xy } = pts;
    for (let k = 0; k < idx.length; k++) {
      const dx = xy[2 * k] - mx, dy = xy[2 * k + 1] - my;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = k; }
    }
    return best < 0 ? null : { i: idx[best], x: xy[2 * best], y: xy[2 * best + 1] };
  };

  const xt = decades(spec.xRange[0], spec.xRange[1]);
  const yt = decades(spec.yRange[0], spec.yRange[1]);
  const hoverName = hover ? catalog.planets.name[hover.i] : '';
  return (
    <div ref={ref} className="hab-chart" onPointerMove={(e) => setHover(nearest(e))} onPointerLeave={() => setHover(null)}
      onClick={(e) => { const n = nearest(e); if (n) onPick(n.i); }}>
      {w > 0 && (
        <>
          <svg width={w} height={h} className="hab-chart__axes" role="img" aria-label={`${spec.title}: ${pts.idx.length.toLocaleString('en-US')} planets, log–log`}>
            <rect className="dl-plotbg" x={L} y={T} width={pw} height={ph} />
            {xt.map((v) => <line key={`x${v}`} className="dl-grid dl-grid--major" x1={sx(v)} x2={sx(v)} y1={T} y2={T + ph} />)}
            {yt.map((v) => <line key={`y${v}`} className="dl-grid dl-grid--major" x1={L} x2={L + pw} y1={sy(v)} y2={sy(v)} />)}
            {xt.map((v) => <text key={`xl${v}`} className="dl-axis-label" x={sx(v)} y={T + ph + 15} textAnchor="middle">{fmtTick(v)}</text>)}
            {yt.map((v) => <text key={`yl${v}`} className="dl-axis-label" x={L - 6} y={sy(v) + 4} textAnchor="end">{fmtTick(v)}</text>)}
            <text className="dl-axis-title" x={L + pw / 2} y={h - 4} textAnchor="middle">{spec.xLabel}</text>
            <text className="dl-axis-title" transform={`translate(12 ${T + ph / 2}) rotate(-90)`} textAnchor="middle">{spec.yLabel}</text>
          </svg>
          <canvas ref={canvas} className="hab-chart__canvas" style={{ left: L, top: T, width: pw, height: ph }} aria-hidden="true" />
          <svg width={w} height={h} className="hab-chart__over" aria-hidden="true">
            {spec.refs.map((r) => (
              <g key={r.label}>
                <circle cx={sx(r.x)} cy={sy(r.y)} r={4} className="hab-ref" />
                <text className="hab-ref__label" x={sx(r.x) + 7} y={sy(r.y) + (r.label === 'Venus' ? -6 : 4)}>{r.label}</text>
              </g>
            ))}
            {hover && (
              <g>
                <circle cx={hover.x} cy={hover.y} r={6} className="hab-hover" />
                <text className="hab-tip" x={Math.min(hover.x + 10, w - 8)} y={Math.max(hover.y - 10, T + 12)} textAnchor={hover.x > w - 160 ? 'end' : 'start'}>{hoverName}</text>
              </g>
            )}
          </svg>
        </>
      )}
    </div>
  );
}
