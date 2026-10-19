import { useId } from 'react';
import { EARTH_RADIUS_M, LUNAR_DISTANCE_M, YEAR_S, displacementPerUnitDeltaV, type EarthInputs, type EarthResult } from './model';
import { dist, percent, years } from './format';

function niceStep(x: number): number {
  const e = 10 ** Math.floor(Math.log10(x));
  const m = x / e;
  return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * e;
}

/**
 * B-plane view: the target plane through Earth's centre, perpendicular to the asteroid's approach. The undeflected asteroid
 * crosses it at the centre (a hit). The deflection moves the crossing point along ζ (timing); the band shows the Monte Carlo
 * spread (5–95 % and 16–84 %) and the rug individual trials. Earth's capture radius (gravitational focusing) is the circle the
 * crossing point has to leave.
 */
export function BPlane({ result }: { result: EarthResult }) {
  const hatch = useId().replace(/:/g, '');
  const S = 300, C = S / 2, R = 122;
  const b = result.captureRadiusM;
  const band = result.missBand;
  const extent = Math.max(b * 2.2, (Number.isFinite(band.p95) ? band.p95 : 0) * 1.12);
  const k = R / extent;
  const y = (m: number): number => C - m * k;
  const earthPx = Math.max(1.5, EARTH_RADIUS_M * k);
  const bPx = b * k;
  const step = niceStep(extent / 2.5);
  const showMoon = LUNAR_DISTANCE_M < extent * 1.05 && LUNAR_DISTANCE_M > extent * 0.2;
  const ok = result.successProbability;
  const markers = [0, 90, 180, 270].map(a => [C + bPx * Math.cos((a * Math.PI) / 180), C + bPx * Math.sin((a * Math.PI) / 180)]);
  return (
    <figure className="cx-dfn-fig">
      <svg viewBox={`0 0 ${S} ${S}`} className="cx-dfn-svg" role="img"
        aria-label={`B-plane: the deflected asteroid crosses ${dist(band.p50)} from Earth's centre; the capture radius is ${dist(b)}. ${percent(ok)} percent of trials miss.`}>
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <line x1="0" y1="0" x2="0" y2="5" className="cx-dfn-hatch" />
          </pattern>
        </defs>
        <line x1={C - R - 12} y1={C} x2={C + R + 12} y2={C} className="cx-dfn-axis" />
        <line x1={C} y1={C - R - 12} x2={C} y2={C + R + 12} className="cx-dfn-axis" />
        <text x={C + R + 10} y={C - 6} className="cx-dfn-svg__label" textAnchor="end">ξ</text>
        <text x={C + 8} y={C - R - 2} className="cx-dfn-svg__label">ζ, arrival-time shift</text>
        {showMoon && <circle cx={C} cy={C} r={LUNAR_DISTANCE_M * k} className="cx-dfn-moon" />}
        {showMoon && <text x={C + LUNAR_DISTANCE_M * k * 0.71 + 4} y={C + LUNAR_DISTANCE_M * k * 0.71 + 12} className="cx-dfn-svg__label">Moon's distance</text>}
        <circle cx={C} cy={C} r={bPx} className="cx-dfn-capture" />
        {markers.map(([mx, my], i) => <circle key={i} cx={mx} cy={my} r={2.5} className="cx-dfn-capture__mark" />)}
        <circle cx={C} cy={C} r={earthPx} className="cx-dfn-earth" />
        <text x={C + 8} y={C + bPx + 16} className="cx-dfn-svg__label">Capture radius<tspan x={C + 8} dy="1.2em">{dist(b)}</tspan></text>
        <text x={C + Math.max(bPx, earthPx) + 8} y={C + 16} className="cx-dfn-svg__label cx-dfn-svg__label--dim">Earth, to scale</text>
        {/* Undeflected crossing point. */}
        <path d={`M${C - 5} ${C - 5} L${C + 5} ${C + 5} M${C + 5} ${C - 5} L${C - 5} ${C + 5}`} className="cx-dfn-nominal" />
        {/* Deflected: rug of trials, 5–95 % band (hatched), 16–84 % bar, median. */}
        {Array.from(result.rug, (m, i) => (Number.isFinite(m) ? <line key={i} x1={C + 10} x2={C + 18} y1={y(m)} y2={y(m)} className="cx-dfn-rug" /> : null))}
        {Number.isFinite(band.p05) && (
          <>
            <rect x={C - 4} width={8} y={y(band.p95)} height={Math.max(1, (band.p95 - band.p05) * k)} fill={`url(#${hatch})`} className="cx-dfn-band" />
            <rect x={C - 2} width={4} y={y(band.p84)} height={Math.max(1, (band.p84 - band.p16) * k)} className="cx-dfn-band__core" />
            <circle cx={C} cy={y(band.p50)} r={4.5} className="cx-dfn-median" />
            <text x={C - 12} y={y(band.p50) + 4} className="cx-dfn-svg__label cx-dfn-svg__label--mod" textAnchor="end">Deflected {dist(band.p50)}</text>
          </>
        )}
        {/* Scale bar. */}
        <line x1={20} x2={20 + step * k} y1={S - 18} y2={S - 18} className="cx-dfn-scale" />
        <text x={20} y={S - 26} className="cx-dfn-svg__label cx-dfn-svg__label--dim">{dist(step)}</text>
      </svg>
      <figcaption className="cx-dfn-figcap">
        B-plane at the encounter. Cross: where the undeflected asteroid would cross (a hit). Orange: where the deflected one crosses in
        the simulated trials (bar 16–84 %, hatched 5–95 %).
      </figcaption>
    </figure>
  );
}

/** Miss distance against warning time (log–log), for this spacecraft and asteroid, with the capture radius. */
export function WarningChart({ inputs, result }: { inputs: EarthInputs; result: EarthResult }) {
  const W = 340, H = 250, L = 80, Rm = 10, T = 18, B = 38;
  const t0 = 0.1, t1 = 30;
  const gNow = displacementPerUnitDeltaV(inputs.warningYears * YEAR_S);
  const q = (m: number): number => (gNow > 0 ? m / gNow : NaN);
  const q05 = q(result.missBand.p05), q50 = q(result.missBand.p50), q95 = q(result.missBand.p95);
  const N = 90;
  const ts: number[] = [];
  for (let i = 0; i <= N; i++) ts.push(t0 * (t1 / t0) ** (i / N));
  const g = ts.map(t => displacementPerUnitDeltaV(t * YEAR_S));
  const b = result.captureRadiusM;
  let yMin = Math.min(b / 20, ...g.map(v => v * q05).filter(v => v > 0));
  let yMax = Math.max(b * 4, ...g.map(v => v * q95).filter(Number.isFinite));
  if (!(yMin > 0)) yMin = b / 100;
  if (!(yMax > yMin)) yMax = b * 10;
  yMin = 10 ** Math.floor(Math.log10(yMin));
  yMax = 10 ** Math.ceil(Math.log10(yMax));
  const x = (t: number): number => L + ((Math.log10(t) - Math.log10(t0)) / (Math.log10(t1) - Math.log10(t0))) * (W - L - Rm);
  const y = (m: number): number => T + (1 - (Math.log10(Math.max(m, yMin)) - Math.log10(yMin)) / (Math.log10(yMax) - Math.log10(yMin))) * (H - T - B);
  const line = (qq: number): string => ts.map((t, i) => `${i ? 'L' : 'M'}${x(t).toFixed(1)} ${y(g[i] * qq).toFixed(1)}`).join(' ');
  const area = Number.isFinite(q05) && Number.isFinite(q95)
    ? `${line(q95)} ${ts.slice().reverse().map((t, i) => `L${x(t).toFixed(1)} ${y(g[N - i] * q05).toFixed(1)}`).join(' ')} Z`
    : '';
  const decades: number[] = [];
  for (let e = Math.log10(yMin); e <= Math.log10(yMax) + 1e-9; e++) decades.push(10 ** e);
  const xt = [0.1, 0.3, 1, 3, 10, 30];
  const wNow = Math.min(t1, Math.max(t0, inputs.warningYears));
  return (
    <figure className="cx-dfn-fig">
      <svg viewBox={`0 0 ${W} ${H}`} className="cx-dfn-svg" role="img"
        aria-label={`Miss distance grows with warning time. With ${years(inputs.warningYears)} the median miss is ${dist(result.missBand.p50)}; the capture radius is ${dist(b)}.`}>
        {decades.map(d => (
          <g key={d}>
            <line x1={L} x2={W - Rm} y1={y(d)} y2={y(d)} className="cx-dfn-grid" />
            <text x={L - 6} y={y(d) + 4} textAnchor="end" className="cx-dfn-svg__tick">{dist(d)}</text>
          </g>
        ))}
        {xt.map(t => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={H - B} y2={H - B + 5} className="cx-dfn-axis" />
            <text x={x(t)} y={H - B + 18} textAnchor="middle" className="cx-dfn-svg__tick">{t < 1 ? `${Math.round(t * 12)} mo` : `${t} yr`}</text>
          </g>
        ))}
        <text x={(L + W - Rm) / 2} y={H - 4} textAnchor="middle" className="cx-dfn-svg__label cx-dfn-svg__label--dim">Warning time before the encounter</text>
        <line x1={L} x2={W - Rm} y1={H - B} y2={H - B} className="cx-dfn-axis" />
        {area && <path d={area} className="cx-dfn-area" />}
        {Number.isFinite(q50) && <path d={line(q50)} className="cx-dfn-curve" />}
        <line x1={L} x2={W - Rm} y1={y(b)} y2={y(b)} className="cx-dfn-capture-line" />
        <text x={L + 6} y={y(b) + 14} className="cx-dfn-svg__label">Below this line: a hit</text>
        <line x1={x(wNow)} x2={x(wNow)} y1={T} y2={H - B} className="cx-dfn-now" />
        {Number.isFinite(q50) && <circle cx={x(wNow)} cy={y(gNow * q50)} r={4.5} className="cx-dfn-median" />}
      </svg>
      <figcaption className="cx-dfn-figcap">
        Median miss distance (line) and 5–95 % range (shaded) for this spacecraft, by warning time. The wiggle under a year is the
        asteroid's orbit: the push first lifts it, then the along-track drift takes over (about 3 × Δv × time).
      </figcaption>
    </figure>
  );
}
