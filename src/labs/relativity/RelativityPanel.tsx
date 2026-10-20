/**
 * Black hole lab panel (LabId 'relativity'): Sgr A* (and M87*, Cygnus X-1) from the measured masses - the Schwarzschild
 * radius, the shadow and its size on the sky against the EHT 2022 ring, how clocks slow down near the horizon ("drop a
 * clock"), and S2's 16-year orbit with its relativistic precession. The live view flies the 3-D camera to the ray-traced
 * black hole of the galaxy domain. Composes <LabShell>.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { LabShell, type LabCompareRow, type LabResult } from '../../ui/labs/LabShell';
import type { LabPanelProps } from '../../ui/labs/registry';
import { useCommands, useReducedMotion } from '../../ui/hooks';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { ProvenanceBadge } from '../../ui/components/Provenance';
import { Equation } from '../../ui/components/Equation';
import type { CameraViewState } from '../../core/types';
import { GALAXY_IDS } from '../../domains/galaxy/entities';
import { galaxyView, type GalaxyViewName } from '../../domains/galaxy/views';
import {
  PRESETS, SGRA, SRC, blackHole, clockAt, dilationCurve, freeFall, orbitPlaneAt, orbitPlanePath, s2Numbers, type Preset,
} from './model';
import './relativity.css';

type Viz = 'clock' | 'dilation' | 's2' | 'live';
const VIZ_OPTIONS: { value: Viz; label: string }[] = [
  { value: 'clock', label: 'Drop a clock' },
  { value: 'dilation', label: 'Time dilation' },
  { value: 's2', label: 'S2 orbit' },
  { value: 'live', label: 'In 3D' },
];
type PresetId = 'sgra' | 'm87' | 'cygx1';
const PRESET_OPTIONS = PRESETS.map(p => ({ value: p.id as PresetId, label: p.label }));
const CLOCK_DEFAULT_RS = 3;
/** The "drop a clock" demo starts from rest at 10 r_s. */
const CLOCK_DROP_RS = 10;

// ── Formatting ───────────────────────────────────────────────────────────────────────────────
const SUP: Record<string, string> = { '-': '⁻', '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹' };
function sci(x: number, digits = 3): string {
  if (!Number.isFinite(x)) return 'Unknown';
  if (x === 0) return '0';
  const e = Math.floor(Math.log10(Math.abs(x)));
  if (e >= -2 && e < 6) return x.toLocaleString('en-US', { maximumSignificantDigits: digits });
  const m = x / 10 ** e;
  return `${m.toFixed(Math.max(0, digits - 1))} × 10${String(e).split('').map(c => SUP[c] ?? c).join('')}`;
}
function length(m: number): string {
  const AU = 1.495978707e11;
  if (m < 1e3) return `${sci(m)} m`;
  if (m < 0.05 * AU) return `${sci(m / 1e3)} km`;
  return `${sci(m / AU)} AU`;
}
function duration(s: number): string {
  if (!Number.isFinite(s)) return '∞';
  if (s < 1e-3) return `${sci(s * 1e6)} µs`;
  if (s < 1) return `${sci(s * 1e3)} ms`;
  if (s < 120) return `${s.toFixed(s < 10 ? 2 : 1)} s`;
  if (s < 7200) return `${(s / 60).toFixed(1)} min`;
  if (s < 172800) return `${(s / 3600).toFixed(1)} h`;
  if (s < 3.156e7 * 2) return `${(s / 86400).toFixed(1)} days`;
  return `${sci(s / 3.156e7)} years`;
}
const ratio = (a: number, b: number): string => {
  const r = a / b;
  return Math.abs(r - 1) < 5e-4 ? 'same' : `× ${sci(r, 3)}`;
};

// ── Live 3-D views (camera of the running engine) ──────────────────────────────────────────────
interface CameraLike { setView(v: CameraViewState, o?: { instant?: boolean; durationSec?: number }): Promise<void> }
function cameraController(): CameraLike | null {
  const c = (window as unknown as { __cosmos?: { engine?: { services?: { cameraController?: Partial<CameraLike> } } } }).__cosmos?.engine?.services?.cameraController;
  return c && typeof c.setView === 'function' ? (c as CameraLike) : null;
}

// ── Visualizations ─────────────────────────────────────────────────────────────────────────────
function useAnimation(playing: boolean, onTick: (dt: number) => void): void {
  const cb = useRef(onTick);
  cb.current = onTick;
  useEffect(() => {
    if (!playing) return;
    let raf = 0, last = performance.now();
    const step = (now: number): void => {
      cb.current(Math.min(0.1, (now - last) / 1000));
      last = now;
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Received colour of a clock's light at r (static redshift 1 + z = 1/√(1 − r_s/r)): white → red → dark. */
function clockColour(r: number): { fill: string; opacity: number } {
  const g = Math.sqrt(Math.max(0, 1 - 1 / r));
  const k = Math.min(1, Math.max(0, (1 - g) / 0.8));
  const R = 255, G = Math.round(245 - 200 * k), B = Math.round(230 - 225 * k);
  return { fill: `rgb(${R} ${G} ${B})`, opacity: Math.max(0.04, g ** 2) };
}

function ClockDrop({ r0, lightCrossS }: { r0: number; lightCrossS: number }) {
  const reduced = useReducedMotion();
  const samples = useMemo(() => freeFall(Math.max(r0, 1.05), 1200), [r0]);
  const tauH = samples[samples.length - 1]!.tau;
  const [s, setS] = useState(0);
  const [playing, setPlaying] = useState(!reduced);
  useEffect(() => { setS(0); }, [r0]);
  // 7 s of playback = the clock's own fall to the horizon; then 3 s more of far-away time.
  const k = tauH / 7;
  useAnimation(playing, dt => setS(v => (v * k > tauH * 1.45 ? 0 : v + dt)));
  const param = s * k;
  // Clock's own experience: r(τ). Far observer: r(t) at the same reading of their own clock.
  const at = (key: 'tau' | 't', v: number): { r: number; tau: number; t: number; crossed: boolean } => {
    let lo = 0, hi = samples.length - 1;
    if (v >= samples[hi]![key]) return { ...samples[hi]!, crossed: key === 'tau' };
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m]![key] < v) lo = m; else hi = m; }
    const a = samples[lo]!, b = samples[hi]!, f = (v - a[key]) / Math.max(1e-12, b[key] - a[key]);
    return { r: a.r + (b.r - a.r) * f, tau: a.tau + (b.tau - a.tau) * f, t: a.t + (b.t - a.t) * f, crossed: false };
  };
  const own = at('tau', param);
  const far = at('t', param);
  const W = 560, H = 230, cx = 70, cy = 0;
  const xOf = (r: number): number => cx + ((W - cx - 30) * Math.log10(r)) / Math.log10(Math.max(r0, 1.05));
  const lane = (y: number, label: string, r: number, sub: string, crossed: boolean): ReactNode => {
    const c = crossed ? { fill: 'rgb(255 60 20)', opacity: 0 } : clockColour(r);
    return (
      <g transform={`translate(0 ${y})`}>
        <text x={cx} y={-34} className="rl-axis rl-axis--title">{label}</text>
        <line x1={cx} x2={W - 30} y1={0} y2={0} className="rl-track" />
        <circle cx={cx - 32} cy={0} r={30} className="rl-hole" />
        <circle cx={cx - 32} cy={0} r={30} className="rl-horizon" />
        <circle cx={xOf(r)} cy={0} r={7} fill={c.fill} opacity={c.opacity} className="rl-clock" />
        <text x={W - 30} y={26} textAnchor="end" className="rl-axis">{sub}</text>
      </g>
    );
  };
  const reached = own.crossed;
  return (
    <div className="rl-card">
      <div className="rl-card__head">
        <p className="rl-card__title">A clock dropped from rest at {r0.toFixed(r0 < 10 ? 2 : 0)} r<sub>s</sub></p>
        <div className="rl-card__actions">
          <Button size="sm" variant="quiet" icon={playing ? Pause : Play} onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</Button>
          <Button size="sm" variant="quiet" icon={RotateCcw} onClick={() => setS(0)}>Drop again</Button>
        </div>
      </div>
      <svg viewBox={`0 ${cy - 10} ${W} ${H}`} className="rl-svg" role="img" aria-label="Falling clock seen from far away and by the clock itself">
        {lane(50, 'Seen from far away: it slows, reddens and fades, never quite reaching the horizon', far.r,
          `far-away clock ${duration(param * lightCrossS)}  ·  falling clock shows ${duration(far.tau * lightCrossS)}`, false)}
        {lane(160, 'The clock’s own experience: it crosses the horizon in finite time', own.r,
          reached ? `crossed the horizon after ${duration(tauH * lightCrossS)} of its own time` : `own time ${duration(own.tau * lightCrossS)}  ·  r = ${own.r.toFixed(2)} rs`, reached)}
      </svg>
      <p className="rl-note">Times scale with the mass: here r<sub>s</sub>/c = {duration(lightCrossS)}. Colour = gravitational redshift of the clock's light received far away (hovering-source approximation).</p>
    </div>
  );
}

function DilationChart({ rClock }: { rClock: number }) {
  const W = 560, H = 260, L = 46, R = 14, T = 14, B = 34;
  const maxX = 1000;
  const curve = useMemo(() => dilationCurve(240, maxX), []);
  const x = (v: number): number => L + ((W - L - R) * Math.log10(v)) / Math.log10(maxX);
  const y = (v: number): number => T + (H - T - B) * (1 - v);
  const path = (ys: number[]): string => ys.reduce((acc, v, i) => (Number.isFinite(v) ? `${acc}${acc && !acc.endsWith('M') ? 'L' : 'M'}${x(curve.x[i]!).toFixed(1)},${y(v).toFixed(1)}` : acc), '');
  const c = clockAt(rClock, 1);
  const markers: Array<{ r: number; label: string }> = [
    { r: 1, label: 'horizon' }, { r: 1.5, label: 'photon sphere' }, { r: 3, label: 'ISCO' },
  ];
  return (
    <div className="rl-card">
      <p className="rl-card__title">Clock rate (seconds ticked per far-away second) against distance</p>
      <svg viewBox={`0 0 ${W} ${H}`} className="rl-svg" role="img" aria-label="Time dilation against distance from the black hole">
        {[0, 0.25, 0.5, 0.75, 1].map(v => (
          <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="rl-grid" /><text x={L - 6} y={y(v) + 4} textAnchor="end" className="rl-axis">{v}</text></g>
        ))}
        {[1, 10, 100, 1000].map(v => (
          <g key={v}><line x1={x(v)} x2={x(v)} y1={T} y2={H - B} className="rl-grid" /><text x={x(v)} y={H - B + 16} textAnchor="middle" className="rl-axis">{v} rs</text></g>
        ))}
        {markers.map(m => (
          <g key={m.label}><line x1={x(m.r)} x2={x(m.r)} y1={T} y2={H - B} className="rl-mark" /><text x={x(m.r) + 4} y={T + 10 + (m.r === 1.5 ? 12 : m.r === 3 ? 24 : 0)} className="rl-axis">{m.label}</text></g>
        ))}
        <path d={path(curve.hover)} className="rl-line rl-line--hover" />
        <path d={path(curve.orbit)} className="rl-line rl-line--orbit" />
        <circle cx={x(rClock)} cy={y(c.staticRate)} r={5} className="rl-dot" />
        {Number.isFinite(c.orbitRate) && <circle cx={x(rClock)} cy={y(c.orbitRate)} r={4} className="rl-dot rl-dot--orbit" />}
      </svg>
      <ul className="rl-legend">
        <li><span className="rl-swatch rl-swatch--hover" />Hovering clock √(1 − r<sub>s</sub>/r)</li>
        <li><span className="rl-swatch rl-swatch--orbit" />Clock on a circular orbit √(1 − 3r<sub>s</sub>/2r) (none inside 1.5 r<sub>s</sub>)</li>
      </ul>
    </div>
  );
}

/** Schwarzschild precession is exaggerated in the drawing so the rosette is visible. */
const PRECESSION_EXAGGERATION = 20;

function S2Orbit() {
  const reduced = useReducedMotion();
  const s2 = useMemo(() => s2Numbers(), []);
  const [phase, setPhase] = useState(0.47);
  const [playing, setPlaying] = useState(!reduced);
  // One orbit (16 years) in 10 s of playback; the star speeds through pericentre as it really does.
  useAnimation(playing, dt => setPhase(p => p + dt / 10));
  const e = s2.e;
  const dphi = (s2.precessionArcminPerOrbit / 60) * (Math.PI / 180) * PRECESSION_EXAGGERATION;
  const orbits = useMemo(() => [0, 1, 2, 3].map(k => orbitPlanePath(e, 220, k * dphi)), [e, dphi]);
  const n = Math.floor(phase);
  const pos = orbitPlaneAt(e, phase - n);
  const rot = (n % 4) * dphi;
  const px = pos.x * Math.cos(rot) - pos.y * Math.sin(rot), py = pos.x * Math.sin(rot) + pos.y * Math.cos(rot);
  const aAu = s2.periAu / (1 - e);
  const vUnit = s2.vPeriKmS / Math.sqrt((1 + e) / (1 - e));
  const W = 560, H = 330, S = 230, oy = 178, ox = W / 2 + e * S;
  const P = (p: [number, number] | { x: number; y: number }): [number, number] => Array.isArray(p) ? [ox + p[0] * S, oy - p[1] * S] : [ox + p.x * S, oy - p.y * S];
  const d = (pts: Array<[number, number]>): string => pts.map((p, i) => `${i ? 'L' : 'M'}${P(p)[0].toFixed(1)},${P(p)[1].toFixed(1)}`).join('');
  const [sx, sy] = P({ x: px, y: py });
  return (
    <div className="rl-card">
      <div className="rl-card__head">
        <p className="rl-card__title">S2 around Sgr A* (orbit plane, GRAVITY 2020 elements)</p>
        <div className="rl-card__actions">
          <Button size="sm" variant="quiet" icon={playing ? Pause : Play} onClick={() => setPlaying(p => !p)}>{playing ? 'Pause' : 'Play'}</Button>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="rl-svg" role="img" aria-label="Orbit of the star S2 around the black hole, with its precession">
        {orbits.map((o, i) => <path key={i} d={d(o)} className={i === (n % 4) ? 'rl-orbit rl-orbit--now' : 'rl-orbit'} />)}
        <circle cx={ox} cy={oy} r={5} className="rl-hole" />
        <circle cx={ox} cy={oy} r={5} className="rl-horizon" />
        <text x={ox + 8} y={oy - 8} className="rl-axis">Sgr A*</text>
        <circle cx={sx} cy={sy} r={5} className="rl-star" />
        <text x={14} y={22} className="rl-axis rl-axis--title">r = {(pos.r * aAu).toFixed(0)} AU</text>
        <text x={14} y={40} className="rl-axis rl-axis--title">v = {(pos.v * vUnit).toFixed(0)} km/s ({((pos.v * vUnit) / 2997.92458).toFixed(2)} % of light)</text>
        <text x={14} y={58} className="rl-axis">year ≈ {(s2.lastPeriYr + (phase - n) * s2.periodYr).toFixed(1)} in the cycle {s2.lastPeriYr.toFixed(1)}–{s2.nextPeriYr.toFixed(1)}</text>
        <text x={14} y={H - 12} className="rl-axis">Precession drawn × {PRECESSION_EXAGGERATION} (real: {s2.precessionArcminPerOrbit.toFixed(1)}′ per orbit)</text>
      </svg>
    </div>
  );
}

function LiveViews({ onFly }: { onFly(name: GalaxyViewName | 'focus'): void }) {
  return (
    <div className="rl-viz rl-viz--live">
      <div className="rl-toolbar">
        <Button size="sm" variant="secondary" onClick={() => onFly('focus')}>Fly to Sgr A*</Button>
        <Button size="sm" variant="quiet" onClick={() => onFly('sstars')}>S-star orbits</Button>
        <Button size="sm" variant="quiet" onClick={() => onFly('bh')}>Black hole</Button>
        <Button size="sm" variant="quiet" onClick={() => onFly('bh-edge')}>Edge-on</Button>
        <Button size="sm" variant="quiet" onClick={() => onFly('bh-earth')}>As seen from Earth</Button>
      </div>
      <p className="rl-strip">
        Ray-traced Schwarzschild black hole: the shadow, photon ring and lensed stars follow from the geometry. The bright disc is
        <strong> illustrative</strong>; Sgr A*'s real flow is faint and hot (the EHT ring is 1.3 mm radio light).
      </p>
    </div>
  );
}

// ── Panel ──────────────────────────────────────────────────────────────────────────────────────
export function RelativityPanel({ onClose }: LabPanelProps) {
  const commands = useCommands();
  const reduced = useReducedMotion();
  const [presetId, setPresetId] = useState<PresetId>('sgra');
  const preset: Preset = PRESETS.find(p => p.id === presetId) ?? PRESETS[0]!;
  const [mass, setMass] = useState(preset.massMsun);
  const [rClock, setRClock] = useState(CLOCK_DEFAULT_RS);
  const [viz, setViz] = useState<Viz>('clock');
  const modified = Math.abs(mass / preset.massMsun - 1) > 0.005;

  const real = useMemo(() => blackHole(preset.massMsun, preset.distancePc), [preset]);
  const mod = useMemo(() => blackHole(mass, preset.distancePc), [mass, preset]);
  const clock = clockAt(rClock, mod.rsM);
  const s2 = useMemo(() => s2Numbers(), []);

  const choosePreset = (id: PresetId): void => {
    setPresetId(id);
    setMass((PRESETS.find(p => p.id === id) ?? PRESETS[0]!).massMsun);
  };
  const reset = (): void => { setMass(preset.massMsun); setRClock(CLOCK_DEFAULT_RS); };

  const fly = (name: GalaxyViewName | 'focus'): void => {
    if (name === 'focus') { void commands.focus(GALAXY_IDS.sgrA, { distanceM: 46 * real.rsM, instant: reduced }).catch(() => undefined); return; }
    const cam = cameraController();
    if (cam) void cam.setView(galaxyView(name), { instant: reduced, durationSec: 4 }).catch(() => undefined);
    else void commands.focus(GALAXY_IDS.sgrA).catch(() => undefined);
  };

  const result: LabResult = {
    caption: `A clock hovering at ${rClock < 10 ? rClock.toFixed(2) : rClock.toFixed(0)} rs ticks this many seconds per far-away second`,
    value: clock.staticRate.toFixed(4),
    numeric: clock.staticRate,
    decimals: 4,
    unit: 's',
  };
  const compare: LabCompareRow[] = [
    { label: 'Schwarzschild radius', real: length(real.rsM), modified: length(mod.rsM), difference: ratio(mod.rsM, real.rsM) },
    { label: 'Shadow diameter', real: length(real.shadowDiameterM), modified: length(mod.shadowDiameterM), difference: ratio(mod.shadowDiameterM, real.shadowDiameterM) },
    ...(real.shadowUas != null && mod.shadowUas != null
      ? [{ label: 'Shadow on our sky', real: `${sci(real.shadowUas)} µas`, modified: `${sci(mod.shadowUas)} µas`, difference: ratio(mod.shadowUas, real.shadowUas) }]
      : []),
    { label: 'Mean density inside rs', real: `${sci(real.meanDensityKgM3)} kg/m³`, modified: `${sci(mod.meanDensityKgM3)} kg/m³`, difference: ratio(mod.meanDensityKgM3, real.meanDensityKgM3) },
    { label: 'Tidal stretch on a person at the horizon', real: `${sci(real.tidalAtHorizonMS2)} m/s²`, modified: `${sci(mod.tidalAtHorizonMS2)} m/s²`, difference: ratio(mod.tidalAtHorizonMS2, real.tidalAtHorizonMS2) },
  ];

  const realState = (
    <div className="rl-real">
      <SegmentedControl<PresetId> label="Black hole" value={presetId} options={PRESET_OPTIONS} onChange={choosePreset} size="sm" />
      <dl className="rl-facts">
        <dt>Mass</dt><dd className="cx-num">{sci(preset.massMsun)} M☉{preset.id === 'sgra' && <> ± {sci(SGRA.massErrMsun, 2)}</>}</dd>
        <dt>Distance</dt><dd className="cx-num">{preset.distancePc ? (preset.distancePc >= 1e6 ? `${(preset.distancePc / 1e6).toFixed(1)} Mpc` : `${(preset.distancePc / 1e3).toFixed(2)} kpc`) : 'Unknown'}</dd>
        <dt>Schwarzschild radius</dt><dd className="cx-num">{length(real.rsM)}</dd>
        <dt>Shadow (≈ 5.2 rs across)</dt><dd className="cx-num">{length(real.shadowDiameterM)}{real.shadowUas != null && <> = {sci(real.shadowUas)} µas</>}</dd>
        {preset.id === 'sgra' && <><dt>EHT ring (measured)</dt><dd className="cx-num">{SGRA.ehtRingUas} ± {SGRA.ehtRingErrUas} µas</dd></>}
        {preset.id === 'sgra' && <><dt>S2 pericentre speed</dt><dd className="cx-num">{s2.vPeriKmS.toFixed(0)} km/s ({(s2.vPeriFracC * 100).toFixed(2)} % of c)</dd></>}
        {preset.id === 'sgra' && <><dt>S2 pericentres</dt><dd className="cx-num">{s2.lastPeriYr.toFixed(1)} and next {s2.nextPeriYr.toFixed(1)}</dd></>}
      </dl>
      <p className="rl-note"><ProvenanceBadge kind="observed" detail={preset.source} /> {preset.source}</p>
    </div>
  );

  const variables = (
    <>
      <Slider label="Mass" scale="log" min={1} max={1e11} step={0.01} value={mass} onChange={setMass} unit="M☉" format={v => sci(v)}
        referenceValue={preset.massMsun} referenceLabel={`${preset.label} (measured)`} />
      <Slider label="Clock distance" scale="log" min={1.001} max={1000} step={0.005} value={rClock} onChange={setRClock} unit="rs"
        format={v => (v < 10 ? v.toFixed(3) : v.toFixed(0))} marks={[{ value: 1.5, label: 'photon sphere' }, { value: 3, label: 'ISCO' }]} />
      <p className="rl-note">
        At {rClock < 10 ? rClock.toFixed(2) : rClock.toFixed(0)} r<sub>s</sub> ({length(rClock * mod.rsM)} from the centre): one far-away year is{' '}
        {duration(clock.secondsPerFarYear)} on the hovering clock; its light arrives redshifted by z = {sci(clock.redshift, 3)}
        {Number.isFinite(clock.orbitRate) ? <>; an orbiting clock ticks at {clock.orbitRate.toFixed(4)}</> : <>; no orbit exists this close</>}.
      </p>
    </>
  );

  const visualization = (
    <div className={viz === 'live' ? 'rl-viz rl-viz--wrap rl-viz--wrap-live' : 'rl-viz rl-viz--wrap'}>
      <div className="rl-toolbar">
        <SegmentedControl<Viz> label="Visualization" value={viz} options={VIZ_OPTIONS} onChange={setViz} size="sm" />
      </div>
      {viz === 'clock' && <ClockDrop r0={CLOCK_DROP_RS} lightCrossS={mod.lightCrossS} />}
      {viz === 'dilation' && <DilationChart rClock={rClock} />}
      {viz === 's2' && <S2Orbit />}
      {viz === 'live' && <LiveViews onFly={fly} />}
    </div>
  );

  const explanation = (
    <div className="rl-prose">
      <p>
        A black hole's size is set by its mass alone: the Schwarzschild radius <Equation tex="r_s = 2GM/c^2" />. Light grazing the
        photon sphere at 1.5 r<sub>s</sub> can circle the hole; rays that pass closer than <Equation tex="b = \tfrac{3\sqrt3}{2}\,r_s" /> fall in,
        so the hole casts a shadow about 5.2 r<sub>s</sub> across, ringed by the photon ring.
      </p>
      <p>
        Clocks deeper in the gravity well run slow: <Equation tex="\frac{d\tau}{dt} = \sqrt{1 - \frac{r_s}{r}}" display />
        A clock dropped in crosses the horizon after a finite time on its own dial, but a distant watcher sees it slow, redden and fade, never
        quite arriving.
      </p>
      <p>
        S2 dives to {s2.periAu.toFixed(0)} AU ({s2.periLightHours.toFixed(0)} light-hours, {s2.periOverRs.toFixed(0)} r<sub>s</sub>) every{' '}
        {s2.periodYr.toFixed(1)} years at {s2.vPeriKmS.toFixed(0)} km/s. GRAVITY measured its gravitational redshift in 2018 and its orbit's
        Schwarzschild precession ({s2.precessionArcminPerOrbit.toFixed(1)}′ per orbit) in 2020: Einstein's predictions, tested at a
        supermassive black hole.
      </p>
      <p>
        The EHT's 2022 image of Sgr A* shows a ring {SGRA.ehtRingUas} ± {SGRA.ehtRingErrUas} µas across; general relativity predicts a
        shadow of {sci(blackHole(SGRA.massMsun, SGRA.distancePc).shadowUas ?? NaN)} µas for the mass measured from the S-stars.
      </p>
    </div>
  );

  const assumptions = (
    <ul className="rl-prose rl-list">
      <li>Non-rotating (Schwarzschild) black holes. Spin changes the shadow by only a few per cent, and the ISCO a lot.</li>
      <li>"Hovering" clocks are held static by rockets; orbiting clocks follow circular geodesics.</li>
      <li>The falling clock starts from rest; its colour uses the static redshift (Doppler shift of the fall is left out).</li>
      <li>The S2 orbit is drawn Keplerian in its plane with the precession exaggerated × {PRECESSION_EXAGGERATION}.</li>
      <li>The 3D accretion disc is illustrative (thin, hot, beamed); Sgr A*'s real flow is faint, thick and radio-bright.</li>
      <li>Sources: {SRC.gravity2024}; {SRC.gravity2020}; {SRC.gravity2018}; {SRC.gillessen2017}; {SRC.eht2022}; {SRC.eht2019}.</li>
    </ul>
  );

  return (
    <LabShell
      title="Black hole lab"
      subject={preset.label}
      modified={modified}
      onReset={reset}
      onClose={onClose}
      realState={realState}
      variables={variables}
      visualization={visualization}
      result={result}
      compare={compare}
      explanation={explanation}
      assumptions={assumptions}
      className="rl-lab"
    />
  );
}
