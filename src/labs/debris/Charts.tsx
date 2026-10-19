/**
 * Debris lab charts (SVG, sized to their container):
 *  - GrowthChart: tracked-size objects in LEO over time for every scenario on a log axis with slide-rule ticks; the
 *    real case in Real blue, the chosen scenario in Modified orange, the rest as ink hairlines with direct labels.
 *  - AltitudeChart: objects per 50 km shell over time for the chosen scenario (magma, log colour scale).
 * Both carry a draggable, keyboard-operable year cursor (role="slider").
 */
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from 'react';
import type { ShellScenarioId } from '../../science/debris';
import { CATALOG, SHELL_COUNT, type ScenarioRun } from './model';
import { BASE_YEAR, fmtCount, fmtPow10, magmaCss } from './format';

export function useElementSize<T extends HTMLElement>(): [RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      const r = entries[0]?.contentRect;
      if (r) setSize(s => (Math.abs(s.w - r.width) < 1 && Math.abs(s.h - r.height) < 1 ? s : { w: Math.round(r.width), h: Math.round(r.height) }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

interface YearCursorProps {
  year: number;
  horizon: number;
  onYear(y: number): void;
}

/** Shared pointer + keyboard handling for a plot area spanning years [0, horizon] over x ∈ [x0, x1]. */
function useYearScrub({ year, horizon, onYear }: YearCursorProps, x0: number, x1: number) {
  const dragging = useRef(false);
  const toYear = (clientX: number, el: Element): number => {
    const r = el.getBoundingClientRect();
    const t = (clientX - r.left - x0) / Math.max(1, x1 - x0);
    return Math.round(Math.min(1, Math.max(0, t)) * horizon);
  };
  return {
    onPointerDown(e: PointerEvent<SVGSVGElement>) {
      dragging.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
      onYear(toYear(e.clientX, e.currentTarget));
    },
    onPointerMove(e: PointerEvent<SVGSVGElement>) {
      if (dragging.current) onYear(toYear(e.clientX, e.currentTarget));
    },
    onPointerUp() { dragging.current = false; },
    onPointerCancel() { dragging.current = false; },
    onKeyDown(e: KeyboardEvent<SVGSVGElement>) {
      const step = e.shiftKey ? 10 : 1;
      let y = year;
      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') y = year + step;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') y = year - step;
      else if (e.key === 'Home') y = 0;
      else if (e.key === 'End') y = horizon;
      else if (e.key === 'PageUp') y = year + 25;
      else if (e.key === 'PageDown') y = year - 25;
      else return;
      e.preventDefault();
      onYear(Math.min(horizon, Math.max(0, y)));
    },
  };
}

function yearTicks(horizon: number): number[] {
  const step = horizon > 120 ? 50 : 25;
  const out: number[] = [];
  for (let y = 0; y <= horizon + 1e-9; y += step) out.push(y);
  return out;
}

export interface GrowthSeries {
  id: ShellScenarioId;
  title: string;
  run: ScenarioRun | null;
  role: 'real' | 'modified' | 'other';
}

const M = { l: 64, r: 150, t: 20, b: 44 };

export function GrowthChart({ series, year, horizon, onYear }: { series: GrowthSeries[] } & YearCursorProps) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const x0 = M.l, x1 = Math.max(M.l + 10, w - M.r), y0 = M.t, y1 = Math.max(M.t + 10, h - M.b);
  const scrub = useYearScrub({ year, horizon, onYear }, x0, x1);
  let vmin = Infinity, vmax = -Infinity;
  for (const s of series) {
    if (!s.run) continue;
    for (let i = 0; i < s.run.total.length; i++) {
      const v = s.run.total[i];
      if (v > 0) { vmin = Math.min(vmin, v); vmax = Math.max(vmax, v); }
    }
  }
  if (!Number.isFinite(vmin)) { vmin = 1e4; vmax = 1e5; }
  const d0 = Math.floor(Math.log10(vmin)), d1 = Math.max(d0 + 1, Math.ceil(Math.log10(vmax)));
  const X = (yr: number): number => x0 + (yr / horizon) * (x1 - x0);
  const Y = (v: number): number => y1 - ((Math.log10(Math.max(v, 1)) - d0) / (d1 - d0)) * (y1 - y0);
  const ticks: { v: number; major: boolean }[] = [];
  for (let d = d0; d <= d1; d++) {
    ticks.push({ v: 10 ** d, major: true });
    if (d < d1) for (let k = 2; k <= 9; k++) ticks.push({ v: k * 10 ** d, major: false });
  }
  const order = [...series].sort((a, b) => (a.role === 'other' ? 0 : a.role === 'real' ? 1 : 2) - (b.role === 'other' ? 0 : b.role === 'real' ? 1 : 2));
  // Direct end labels, pushed apart vertically.
  const labels = series.filter(s => s.run).map(s => {
    const r = s.run as ScenarioRun;
    return { s, y: Y(r.total[r.total.length - 1]), v: r.total[r.total.length - 1] };
  }).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 30) labels[i].y = labels[i - 1].y + 30;
  const over = labels.length ? labels[labels.length - 1].y - y1 : 0;
  if (over > 0) for (const l of labels) l.y -= over;
  const cursorX = X(Math.min(year, horizon));
  const focus = series.find(s => s.role === 'modified') ?? series.find(s => s.role === 'real');
  const fr = focus?.run;
  const fi = fr ? Math.min(fr.total.length - 1, Math.round((year / horizon) * (fr.total.length - 1))) : -1;
  return (
    <div ref={ref} className="dl-chart">
      {w > 0 && h > 0 && (
        <svg
          width={w} height={h} className="dl-chart__svg" tabIndex={0} role="slider"
          aria-label="Year shown. Tracked objects in low Earth orbit over time for each scenario"
          aria-valuemin={BASE_YEAR} aria-valuemax={BASE_YEAR + horizon} aria-valuenow={BASE_YEAR + year}
          aria-valuetext={`${BASE_YEAR + year}${fr && fi >= 0 ? `: ${fmtCount(fr.total[fi])} objects` : ''}`}
          {...scrub}
        >
          {ticks.map(t => (
            <g key={t.v}>
              <line x1={x0} x2={x1} y1={Y(t.v)} y2={Y(t.v)} className={t.major ? 'dl-grid dl-grid--major' : 'dl-grid'} />
              <line x1={x0 - (t.major ? 8 : 4)} x2={x0} y1={Y(t.v)} y2={Y(t.v)} className="dl-tick" />
              {t.major && <text x={x0 - 12} y={Y(t.v) + 4} className="dl-axis-label" textAnchor="end">{fmtPow10(t.v)}</text>}
            </g>
          ))}
          {yearTicks(horizon).map(yr => (
            <g key={yr}>
              <line x1={X(yr)} x2={X(yr)} y1={y1} y2={y1 + 6} className="dl-tick" />
              <text x={X(yr)} y={y1 + 22} className="dl-axis-label" textAnchor="middle">{BASE_YEAR + yr}</text>
            </g>
          ))}
          <text x={x0} y={y0 - 6} className="dl-axis-title">Objects 10 cm and larger in low Earth orbit (log scale)</text>
          {order.map(s => {
            if (!s.run) return null;
            const r = s.run;
            let d = '';
            const n = r.total.length;
            const stride = Math.max(1, Math.floor(n / Math.max(50, x1 - x0)));
            for (let i = 0; i < n; i += stride) d += `${i === 0 ? 'M' : 'L'}${X(r.timesYears[i]).toFixed(1)},${Y(r.total[i]).toFixed(1)}`;
            d += `L${X(r.timesYears[n - 1]).toFixed(1)},${Y(r.total[n - 1]).toFixed(1)}`;
            return <path key={s.id} d={d} className={`dl-line dl-line--${s.role}`} />;
          })}
          {labels.map(l => (
            <g key={l.s.id} className={`dl-endlabel dl-endlabel--${l.s.role}`}>
              <text x={x1 + 10} y={l.y - 2}>{l.s.title}</text>
              <text x={x1 + 10} y={l.y + 12} className="dl-endlabel__value">{fmtCount(l.v)}</text>
            </g>
          ))}
          <line x1={cursorX} x2={cursorX} y1={y0} y2={y1} className="dl-cursor" />
          {fr && fi >= 0 && (
            <g>
              <circle cx={cursorX} cy={Y(fr.total[fi])} r={4} className={`dl-cursor-dot dl-cursor-dot--${focus?.role}`} />
              <text x={cursorX + (cursorX > (x0 + x1) / 2 ? -10 : 10)} y={y1 - 12} textAnchor={cursorX > (x0 + x1) / 2 ? 'end' : 'start'} className="dl-cursor-label dl-cursor-label--halo">
                {BASE_YEAR + year}: {fmtCount(fr.total[fi])} objects
              </text>
            </g>
          )}
        </svg>
      )}
    </div>
  );
}

const HM = { l: 64, r: 96, t: 20, b: 44 };

export function AltitudeChart({ run, year, horizon, onYear, role }: { run: ScenarioRun | null; role: 'real' | 'modified' } & YearCursorProps) {
  const [ref, { w, h }] = useElementSize<HTMLDivElement>();
  const x0 = HM.l, x1 = Math.max(HM.l + 10, w - HM.r), y0 = HM.t, y1 = Math.max(HM.t + 10, h - HM.b);
  const scrub = useYearScrub({ year, horizon, onYear }, x0, x1);
  const minKm = CATALOG.shellMinKm, maxKm = CATALOG.shellMaxKm, step = CATALOG.shellStepKm;
  const X = (yr: number): number => x0 + (yr / horizon) * (x1 - x0);
  const Yk = (km: number): number => y1 - ((km - minKm) / (maxKm - minKm)) * (y1 - y0);
  let vmax = 1;
  if (run) for (const s of run.shellTotals) for (let i = 0; i < s.length; i++) vmax = Math.max(vmax, s[i]);
  const dMax = Math.max(1, Math.ceil(Math.log10(vmax)));
  const colorOf = (v: number): string | null => (v < 1 ? null : magmaCss(0.12 + 0.88 * Math.min(1, Math.log10(v) / dMax)));
  const cells: { x: number; y: number; w: number; h: number; c: string }[] = [];
  if (run) {
    const ys = run.snapshotYears;
    for (let k = 0; k < ys.length; k++) {
      const a = k === 0 ? 0 : (ys[k - 1] + ys[k]) / 2, b = k === ys.length - 1 ? ys[k] : (ys[k] + ys[k + 1]) / 2;
      const xa = X(a), xb = X(b);
      for (let i = 0; i < SHELL_COUNT; i++) {
        const c = colorOf(run.shellTotals[k][i]);
        if (!c) continue;
        const ya = Yk(minKm + (i + 1) * step), yb = Yk(minKm + i * step);
        cells.push({ x: xa, y: ya, w: Math.max(0.5, xb - xa + 0.5), h: Math.max(0.5, yb - ya + 0.5), c });
      }
    }
  }
  const kmTicks = [200, 500, 800, 1100, 1400, 1700, 2000];
  const cursorX = X(Math.min(year, horizon));
  const legendTicks: number[] = [];
  for (let d = 0; d <= dMax; d++) legendTicks.push(d);
  const lx = x1 + 28, lw = 12;
  return (
    <div ref={ref} className="dl-chart">
      {w > 0 && h > 0 && (
        <svg
          width={w} height={h} className="dl-chart__svg" tabIndex={0} role="slider"
          aria-label="Year shown. Objects per 50 km altitude shell over time for the chosen scenario"
          aria-valuemin={BASE_YEAR} aria-valuemax={BASE_YEAR + horizon} aria-valuenow={BASE_YEAR + year}
          {...scrub}
        >
          <text x={x0} y={y0 - 6} className="dl-axis-title">Altitude (km) · colour: objects per 50 km shell</text>
          <rect x={x0} y={y0} width={x1 - x0} height={y1 - y0} className="dl-plotbg" />
          {cells.map((c, i) => <rect key={i} x={c.x} y={c.y} width={c.w} height={c.h} fill={c.c} />)}
          {kmTicks.map(km => (
            <g key={km}>
              <line x1={x0 - 6} x2={x0} y1={Yk(km)} y2={Yk(km)} className="dl-tick" />
              <text x={x0 - 10} y={Yk(km) + 4} className="dl-axis-label" textAnchor="end">{km.toLocaleString('en-US')}</text>
            </g>
          ))}
          {yearTicks(horizon).map(yr => (
            <g key={yr}>
              <line x1={X(yr)} x2={X(yr)} y1={y1} y2={y1 + 6} className="dl-tick" />
              <text x={X(yr)} y={y1 + 22} className="dl-axis-label" textAnchor="middle">{BASE_YEAR + yr}</text>
            </g>
          ))}
          <line x1={cursorX} x2={cursorX} y1={y0} y2={y1} className={`dl-cursor dl-cursor--on-map dl-cursor--${role}`} />
          <text x={cursorX + (cursorX > (x0 + x1) / 2 ? -8 : 8)} y={y0 + 16} textAnchor={cursorX > (x0 + x1) / 2 ? 'end' : 'start'} className="dl-cursor-label dl-cursor-label--halo">
            {BASE_YEAR + year}
          </text>
          {/* Colour legend */}
          <defs>
            <linearGradient id="dl-magma" x1="0" y1="1" x2="0" y2="0">
              {[0, 0.25, 0.5, 0.75, 1].map(t => <stop key={t} offset={t} stopColor={magmaCss(0.12 + 0.88 * t)} />)}
            </linearGradient>
          </defs>
          <rect x={lx} y={y0} width={lw} height={y1 - y0} fill="url(#dl-magma)" />
          {legendTicks.map(d => {
            const y = y1 - (d / dMax) * (y1 - y0);
            return (
              <g key={d}>
                <line x1={lx + lw} x2={lx + lw + 5} y1={y} y2={y} className="dl-tick" />
                <text x={lx + lw + 8} y={y + 4} className="dl-axis-label">{fmtPow10(10 ** d)}</text>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
