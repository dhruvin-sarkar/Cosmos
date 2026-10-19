/**
 * Orbital debris lab panel (LabId 'debris'): real catalogue state, policy scenarios on the shell source–sink model,
 * growth / altitude charts, the population as a density field around Earth, and real breakup events animated as
 * fragment clouds. Composes <LabShell>.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Pause, Play, RotateCcw } from 'lucide-react';
import { LabShell, type LabCompareRow, type LabResult } from '../../ui/labs/LabShell';
import type { LabPanelProps } from '../../ui/labs/registry';
import { useCommands, useReducedMotion, useStoreApi } from '../../ui/hooks';
import { Button } from '../../ui/components/Button';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { ProvenanceBadge } from '../../ui/components/Provenance';
import { Equation } from '../../ui/components/Equation';
import { DEBRIS_MODELS, SHELL_SCENARIOS, SOLAR_ACTIVITY_FACTOR, type ShellScenarioId } from '../../science/debris';
import { ORBIT_MODELS } from '../../science/orbits';
import {
  ADR_MAX_PER_YEAR, BREAKUP_EVENTS, CATALOG, HORIZON_MAX_YEARS, HORIZON_MIN_YEARS, REAL_INPUTS, SCENARIO_TITLES, SHELL_COUNT,
  breakupEvent, buildBreakupCloud, cloudSpread, inputsModified, realStateSummary, shellDensityPerKm3, shellGlowLevel, shellsAtYear, summarize,
  type BreakupCloud, type BreakupEventId, type ScenarioInputs, type ScenarioRun, type SolarLevel,
} from './model';
import { requestScenario } from './scenarioClient';
import { AltitudeChart, GrowthChart, type GrowthSeries } from './Charts';
import { BASE_YEAR, fmtCount, fmtElapsed, fmtExact, fmtRate } from './format';
import { attachOverlay, detachOverlay, overlayState } from './engineBridge';
import './debris.css';

type View = 'growth' | 'altitude' | 'earth' | 'breakup';
const VIEW_OPTIONS: { value: View; label: string }[] = [
  { value: 'growth', label: 'Growth' },
  { value: 'altitude', label: 'By altitude' },
  { value: 'earth', label: 'Around Earth' },
  { value: 'breakup', label: 'Breakup' },
];
const SOLAR_OPTIONS: { value: SolarLevel; label: string }[] = [
  { value: 'low', label: 'Quiet Sun' },
  { value: 'moderate', label: 'Average' },
  { value: 'high', label: 'Active Sun' },
];
const BREAKUP_T_MIN_S = 60;
const BREAKUP_T_MAX_S = 10 * 86400;
/** Playback: the log-time playhead crosses 1 min → 10 days in this many seconds. */
const PLAY_DURATION_S = 26;
/** Camera distance from Earth's centre that frames Earth and every shell up to 2,000 km, m. */
const EARTH_FRAME_DISTANCE_M = 2.6e7;

const REAL = realStateSummary();
const CLASS_ROWS = [
  { key: 'activePayload', label: 'Working satellites', n: REAL.activePayloadsLeo, color: 'var(--dl-c-active)' },
  { key: 'inactivePayload', label: 'Dead satellites', n: REAL.deadPayloadsLeo, color: 'var(--dl-c-dead)' },
  { key: 'rocketBody', label: 'Spent rocket stages', n: REAL.rocketBodiesLeo, color: 'var(--dl-c-rocket)' },
  { key: 'debris', label: 'Debris fragments', n: REAL.debrisLeo, color: 'var(--dl-c-debris)' },
  { key: 'unknown', label: 'Unidentified', n: REAL.unknownLeo, color: 'var(--dl-c-unknown)' },
] as const;

/** Today's densest shell (all objects), objects per km³: the 3D field's unit. */
const TODAY_PEAK_DENSITY = (() => {
  const s = CATALOG.shells;
  const all = s.activePayload.map((v, i) => v + s.inactivePayload[i] + s.rocketBody[i] + s.debris[i] + s.unknown[i]);
  return Math.max(...shellDensityPerKm3(all, new Float64Array(SHELL_COUNT)));
})();

function diffText(real: number, mod: number): string {
  if (!(real > 0) || !Number.isFinite(mod)) return 'Unknown';
  const r = mod / real;
  if (Math.abs(r - 1) < 0.005) return 'No change';
  if (r >= 2) return `${r >= 10 ? Math.round(r) : r.toFixed(1)} times as many`;
  return `${r > 1 ? '+' : '−'}${Math.round(Math.abs(r - 1) * 100)}%`;
}

/** Latest-wins async scenario run. */
function useScenario(inp: ScenarioInputs, withShells: boolean): ScenarioRun | null {
  const [run, setRun] = useState<ScenarioRun | null>(null);
  const key = `${inp.scenario}|${inp.solar}|${inp.horizonYears}|${inp.adrPerYear}|${withShells}`;
  useEffect(() => {
    let live = true;
    requestScenario(inp, withShells).then(r => { if (live) setRun(r); }, e => console.warn('[debris lab] scenario failed', e));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return run;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

function RealState() {
  const s = CATALOG.shells;
  const max = Math.max(...s.debris.map((_, i) => s.activePayload[i] + s.inactivePayload[i] + s.rocketBody[i] + s.debris[i] + s.unknown[i]));
  const W = 300, H = 92, bw = W / SHELL_COUNT;
  return (
    <div className="dl-real">
      <p className="dl-real__headline">
        <span className="dl-real__big cx-num">{fmtExact(REAL.leo)}</span> tracked objects in low Earth orbit
      </p>
      <p className="dl-note">
        Objects about 10 cm and larger, below 2,000 km. Catalogue of <span className="dl-mono">{CATALOG.catalogGenerated.slice(0, 10)}</span>{' '}
        (CelesTrak GP and SATCAT, from US Space Force tracking). <ProvenanceBadge kind="observed" detail="CelesTrak GP + SATCAT snapshot, binned by mean altitude" />
      </p>
      <ul className="dl-classes">
        {CLASS_ROWS.map(r => (
          <li key={r.key}>
            <span className="dl-swatch" style={{ background: r.color }} aria-hidden="true" />
            <span>{r.label}</span>
            <span className="cx-num">{fmtExact(r.n)}</span>
          </li>
        ))}
      </ul>
      <figure className="dl-profile">
        <svg viewBox={`0 0 ${W} ${H + 16}`} role="img" aria-label={`Objects per 50 km altitude shell today. Busiest shell: ${REAL.busiestShellKm - 25}–${REAL.busiestShellKm + 25} km with ${fmtExact(REAL.busiestShellCount)} objects.`}>
          {s.debris.map((_, i) => {
            let y = H;
            return CLASS_ROWS.map(r => {
              const v = (s[r.key] as number[])[i];
              const h = (v / max) * (H - 4);
              y -= h;
              return h > 0 ? <rect key={`${i}-${r.key}`} x={i * bw + 0.5} y={y} width={bw - 1} height={h} fill={r.color} /> : null;
            });
          })}
          {[200, 800, 1400, 2000].map(km => (
            <text key={km} x={((km - 200) / 1800) * W} y={H + 13} className="dl-axis-label" textAnchor={km === 200 ? 'start' : km === 2000 ? 'end' : 'middle'}>{km} km</text>
          ))}
        </svg>
        <figcaption className="dl-note">Objects per 50 km of altitude. Busiest today: {REAL.busiestShellKm - 25}–{REAL.busiestShellKm + 25} km ({fmtExact(REAL.busiestShellCount)}), mostly Starlink.</figcaption>
      </figure>
      <p className="dl-note">
        Still in orbit from the breakups in this lab: Fengyun-1C {fmtExact(CATALOG.breakupDebris.totals['fengyun-1c-debris'])}, Cosmos 2251{' '}
        {fmtExact(CATALOG.breakupDebris.totals['cosmos-2251-debris'])}, Iridium 33 {fmtExact(CATALOG.breakupDebris.totals['iridium-33-debris'])} fragments.
      </p>
    </div>
  );
}

function Variables({ inputs, set }: { inputs: ScenarioInputs; set(p: Partial<ScenarioInputs>): void }) {
  return (
    <>
      <fieldset className="dl-scenarios">
        <legend className="dl-label">Policy scenario</legend>
        {SHELL_SCENARIOS.map(s => (
          <label key={s.id} className={`dl-scn${inputs.scenario === s.id ? ' is-on' : ''}`}>
            <input type="radio" name="dl-scenario" value={s.id} checked={inputs.scenario === s.id} onChange={() => set({ scenario: s.id })} />
            <span className="dl-scn__title">{s.title}{s.id === REAL_INPUTS.scenario && <span className="dl-scn__tag"> today</span>}</span>
            <span className="dl-scn__desc">{s.description}</span>
          </label>
        ))}
      </fieldset>
      {inputs.scenario === 'adr' && (
        <Slider
          label="Derelicts removed per year" value={inputs.adrPerYear} min={0} max={ADR_MAX_PER_YEAR} step={1} unit="per year"
          format={v => String(Math.round(v))} onChange={v => set({ adrPerYear: Math.round(v) })}
        />
      )}
      <div className="dl-field">
        <span className="dl-label" id="dl-solar-label">Solar activity</span>
        <SegmentedControl<SolarLevel> label="Solar activity" value={inputs.solar} options={SOLAR_OPTIONS} onChange={v => set({ solar: v })} />
        <p className="dl-note">
          An active Sun heats and puffs up the upper atmosphere, so drag clears low orbits faster (air density above 250 km ×{SOLAR_ACTIVITY_FACTOR.low} to ×{SOLAR_ACTIVITY_FACTOR.high}).
        </p>
      </div>
      <Slider
        label="Look ahead" value={inputs.horizonYears} min={HORIZON_MIN_YEARS} max={HORIZON_MAX_YEARS} step={10} unit="years"
        format={v => String(Math.round(v))} onChange={v => set({ horizonYears: Math.round(v / 10) * 10 })}
      />
    </>
  );
}

function ScenarioTable({ runs, selected, onSelect, horizon }: { runs: Partial<Record<ShellScenarioId, ScenarioRun>>; selected: ShellScenarioId; onSelect(id: ShellScenarioId): void; horizon: number }) {
  return (
    <table className="dl-table">
      <caption className="dl-table__caption">Scenarios side by side, {BASE_YEAR} to {BASE_YEAR + horizon} (model)</caption>
      <thead>
        <tr>
          <th scope="col">Scenario</th>
          <th scope="col" className="cx-num">Objects in {BASE_YEAR + horizon}</th>
          <th scope="col" className="cx-num">Change</th>
          <th scope="col" className="cx-num">Collisions per year</th>
        </tr>
      </thead>
      <tbody>
        {SHELL_SCENARIOS.map(s => {
          const r = runs[s.id];
          const m = r ? summarize(r) : null;
          return (
            <tr key={s.id} className={s.id === selected ? 'is-selected' : undefined}>
              <th scope="row">
                <button type="button" className="dl-linkbtn" aria-pressed={s.id === selected} onClick={() => onSelect(s.id)}>{s.title}</button>
              </th>
              <td className="cx-num">{m ? fmtCount(m.totalEnd) : '…'}</td>
              <td className="cx-num">{m ? diffText(m.totalStart, m.totalEnd) : '…'}</td>
              <td className="cx-num">{m ? fmtRate(m.collisionsPerYearEnd) : '…'}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function Explanation({ sel, stop, inputs }: { sel: ReturnType<typeof summarize> | null; stop: ReturnType<typeof summarize> | null; inputs: ScenarioInputs }) {
  const endYear = BASE_YEAR + inputs.horizonYears;
  return (
    <div className="dl-prose">
      <p>
        Low Earth orbit is a crowded road with no traffic lights. Two objects that collide there meet at about 10 km/s, ten times
        faster than a rifle bullet, and shatter into hundreds or thousands of fragments. Every fragment is a new bullet that can hit
        something else.
      </p>
      <p>
        In 1978 NASA scientist Donald Kessler warned that once an orbit is crowded enough, collisions make debris faster than the thin
        upper atmosphere can drag it down. The result is a chain reaction that could make some orbits unusable for generations. This
        is the Kessler syndrome.
      </p>
      <p>
        Drag is the only natural cleaner. Below about 500 km, fragments fall back and burn up within a few years. At 800–1,000 km they
        can stay for centuries, which is why the debris piles up there.
      </p>
      {sel && (
        <p>
          With <strong>{SCENARIO_TITLES[inputs.scenario].toLowerCase()}</strong>, the model takes the {fmtCount(sel.totalStart)} tracked
          objects of today to {fmtCount(sel.totalEnd)} by {endYear}, with about {fmtRate(sel.collisionsPerYearEnd)} collisions a year at the end.
        </p>
      )}
      {stop && (
        <p>
          Kessler's test: if every launch stopped today, the model's debris would still go from {fmtCount(stop.debrisStart)} to{' '}
          {fmtCount(stop.debrisEnd)} by {endYear}.{' '}
          {stop.debrisEnd > stop.debrisStart * 1.02
            ? 'The chain reaction has already started in the most crowded shells: it keeps growing on its own.'
            : 'Here drag wins: without new launches the debris slowly falls back.'}
        </p>
      )}
      <p className="dl-note">These are trends from a simple model, not a forecast. Compare scenarios with each other rather than reading single numbers as predictions.</p>
    </div>
  );
}

function Assumptions() {
  const models = DEBRIS_MODELS.filter(m => ['debris-shell-source-sink', 'nasa-sbm-simplified', 'drag-lifetime-circular', 'exponential-atmosphere'].includes(m.id));
  const orbit = ORBIT_MODELS.filter(m => m.id === 'kepler-two-body' || m.id === 'j2-secular');
  return (
    <div className="dl-prose">
      <ul className="dl-list">
        <li>Starting counts: tracked objects in the catalogue snapshot, sorted by mean altitude into 36 shells of 50 km. Dead satellites and rocket stages count as derelicts; unidentified objects count as debris.</li>
        <li>Launch rates, an 8-year mission life and 60% disposal success for business as usual come from the scenario presets of the science library.</li>
        <li>Only objects 10 cm and larger are counted. Hundreds of millions of smaller pieces are also dangerous but not modelled.</li>
        <li>Breakup clouds: both satellites on circular orbits through the published collision point; fragments 10 cm and larger from the simplified NASA breakup model, flying apart in random directions; Kepler orbits with the slow drift from Earth's equatorial bulge (J2), no drag over the 10 days shown. The cloud is turned about the pole so the breakup point sits over its real place on today's globe.</li>
      </ul>
      {[...models, ...orbit].map(m => (
        <section key={m.id} className="dl-model">
          <p className="dl-model__title">{m.title} <span className="dl-mono">{m.id}@{m.version}</span></p>
          <p>{m.summary}</p>
          {m.latex && <Equation tex={m.latex} display label={m.title} />}
          {m.assumptions?.length ? <ul className="dl-list">{m.assumptions.map(a => <li key={a}>{a}</li>)}</ul> : null}
          {m.validity && <p className="dl-note">Valid for: {m.validity}{m.accuracy ? ` Accuracy: ${m.accuracy}` : ''}</p>}
          {m.references?.length ? <p className="dl-note">{m.references.map(r => r.citation).join(' · ')}</p> : null}
        </section>
      ))}
    </div>
  );
}

function BreakupStrip({ eventId, setEventId, cloud, tS, setTS, playing, setPlaying }: {
  eventId: BreakupEventId; setEventId(id: BreakupEventId): void; cloud: BreakupCloud | null; tS: number; setTS(t: number): void;
  playing: boolean; setPlaying(p: boolean): void;
}) {
  const ev = breakupEvent(eventId);
  const [spread, setSpread] = useState<{ arc90Deg: number } | null>(null);
  const scratch = useRef<Float64Array>(new Float64Array(0));
  const lastCalc = useRef(0);
  useEffect(() => {
    if (!cloud) return;
    const now = performance.now();
    if (playing && now - lastCalc.current < 250) return;
    lastCalc.current = now;
    if (scratch.current.length < cloud.count) scratch.current = new Float64Array(cloud.count);
    setSpread(cloudSpread(cloud, tS, scratch.current));
  }, [cloud, tS, playing]);
  const tracked = ev.catalogGroups.reduce((s, g) => s + (CATALOG.breakupDebris.totals[g] ?? 0), 0);
  const date = new Date(ev.dateUtc);
  return (
    <div className="dl-strip" role="group" aria-label="Breakup animation">
      <div className="dl-strip__row">
        <SegmentedControl<BreakupEventId>
          label="Breakup event" size="sm" value={eventId}
          options={BREAKUP_EVENTS.map(e => ({ value: e.id, label: e.short }))}
          onChange={id => setEventId(id)}
        />
        <Button size="sm" variant="primary" icon={playing ? Pause : Play} onClick={() => {
          if (!playing && tS >= BREAKUP_T_MAX_S * 0.999) setTS(BREAKUP_T_MIN_S);
          setPlaying(!playing);
        }}>{playing ? 'Pause' : 'Play'}</Button>
        <Button size="sm" variant="quiet" icon={RotateCcw} onClick={() => { setPlaying(false); setTS(BREAKUP_T_MIN_S); }}>Restart</Button>
      </div>
      <Slider
        label="Time after the breakup" scale="log" min={BREAKUP_T_MIN_S} max={BREAKUP_T_MAX_S} step={0.01} value={tS}
        format={fmtElapsed} onChange={v => { setPlaying(false); setTS(v); }}
        marks={[{ value: 3600, label: '1 h' }, { value: 86400, label: '1 day' }]}
      />
      <div className="dl-strip__facts">
        <p>
          <strong>{ev.title}</strong>, {date.toISOString().slice(0, 10)} {date.toISOString().slice(11, 16)} UTC, {ev.parents[0].altitudeKm} km up
          {ev.locationApprox ? ' (location approximate)' : ` over ${ev.latDeg.toFixed(1)}° N, ${ev.lonDeg.toFixed(1)}° E`}, impact speed {(ev.impactSpeedMS / 1000).toFixed(1)} km/s.
        </p>
        <p className="cx-num">
          {cloud ? <>Model: {fmtExact(cloud.count)} fragments 10 cm and larger in orbit{cloud.reenteredCount > 0 ? `, ${fmtExact(cloud.reenteredCount)} more thrown into the atmosphere` : ''}; typical ejection speed {fmtExact(cloud.medianDeltaVMS)} m/s. </> : 'Building the fragment cloud… '}
          {spread && Number.isFinite(spread.arc90Deg) && <>After {fmtElapsed(tS)}, 90% of the cloud is spread over {Math.round(spread.arc90Deg)}° of the orbit{spread.arc90Deg > 300 ? ': a ring around Earth' : ''}.</>}
        </p>
        <p className="dl-note">
          Observed: {ev.observed} {fmtExact(tracked)} are still tracked today. <ProvenanceBadge kind="derived" detail="nasa-sbm-simplified@1 + kepler-two-body@1 + j2-secular@1" />
        </p>
        <p className="dl-legend" aria-label="Colour key">
          {ev.parents.map((p, i) => (
            <span key={p.norad}><span className="dl-dot" style={{ background: i === 0 ? '#56B4E9' : '#E69F00' }} aria-hidden="true" />{p.name} fragments <span className="dl-mono">NORAD {p.norad}</span></span>
          ))}
        </p>
      </div>
    </div>
  );
}

export function DebrisPanel({ onClose }: LabPanelProps) {
  const commands = useCommands();
  const store = useStoreApi();
  const reduced = useReducedMotion();
  const [inputs, setInputs] = useState<ScenarioInputs>(REAL_INPUTS);
  const set = useCallback((p: Partial<ScenarioInputs>) => setInputs(i => ({ ...i, ...p })), []);
  const committed = useDebounced(inputs, 150);
  const [view, setView] = useState<View>('growth');
  const [year, setYear] = useState(REAL_INPUTS.horizonYears);
  const [eventId, setEventId] = useState<BreakupEventId>('iridium-cosmos-2009');
  const [tS, setTS] = useState(BREAKUP_T_MIN_S);
  const [playing, setPlaying] = useState(false);
  const horizon = committed.horizonYears;
  const yearC = Math.min(year, horizon);
  const modified = inputsModified(inputs);

  // Model runs (worker): the chosen scenario with per-shell snapshots, the real case, and every scenario for comparison.
  const selRun = useScenario(committed, true);
  const realInputs = useMemo(() => ({ ...REAL_INPUTS, horizonYears: horizon }), [horizon]);
  const realRun = useScenario(realInputs, false);
  const cmp: Partial<Record<ShellScenarioId, ScenarioRun>> = {};
  const r0 = useScenario({ ...committed, scenario: 'business-as-usual' }, false);
  const r1 = useScenario({ ...committed, scenario: 'pmd-90' }, false);
  const r2 = useScenario({ ...committed, scenario: 'five-year-rule' }, false);
  const r3 = useScenario({ ...committed, scenario: 'adr' }, false);
  const r4 = useScenario({ ...committed, scenario: 'launch-stop' }, false);
  [r0, r1, r2, r3, r4].forEach(r => { if (r) cmp[r.inputs.scenario] = r; });
  const selSum = selRun ? summarize(selRun) : null;
  const realSum = realRun ? summarize(realRun) : null;
  const stopSum = r4 ? summarize(r4) : null;

  // Breakup cloud (built lazily, ~10 ms).
  const cloud = useMemo(() => (view === 'breakup' ? buildBreakupCloud(eventId) : null), [view, eventId]);

  // 3D overlay attach/detach.
  const [attached, setAttached] = useState(false);
  useEffect(() => {
    let tries = 0;
    let timer = 0;
    let ok = false;
    const tryAttach = (): void => {
      ok = attachOverlay();
      if (ok) setAttached(true);
      else if (++tries < 40) timer = window.setTimeout(tryAttach, 500);
    };
    tryAttach();
    return () => { clearTimeout(timer); if (ok) detachOverlay(); };
  }, []);

  // Feed the overlay.
  const levels = useRef(new Float64Array(SHELL_COUNT));
  const dens = useRef(new Float64Array(SHELL_COUNT));
  useEffect(() => {
    overlayState.mode = view === 'earth' ? 'shells' : view === 'breakup' ? 'breakup' : 'off';
    if (view === 'earth' && selRun) {
      shellsAtYear(selRun, yearC, 'total', levels.current);
      shellDensityPerKm3(levels.current, dens.current);
      for (let i = 0; i < SHELL_COUNT; i++) overlayState.shellLevel[i] = shellGlowLevel(dens.current[i] / TODAY_PEAK_DENSITY);
    }
    overlayState.cloud = cloud;
    overlayState.tS = tS;
  }, [view, selRun, yearC, cloud, tS, attached]);
  useEffect(() => () => { overlayState.mode = 'off'; overlayState.cloud = null; }, []);

  // Frame Earth when entering a 3D view; hide the tracked-object dots during the breakup so the fragments stand out.
  const prevOverlays = useRef<{ debris: boolean; satellites: boolean } | null>(null);
  const restoreOverlays = useCallback(() => {
    const p = prevOverlays.current;
    if (!p) return;
    prevOverlays.current = null;
    commands.setOverlay('debris', p.debris);
    commands.setOverlay('satellites', p.satellites);
  }, [commands]);
  useEffect(() => {
    if (view !== 'earth' && view !== 'breakup') return;
    commands.focus('sol:earth', { distanceM: EARTH_FRAME_DISTANCE_M, instant: reduced }).catch(() => undefined);
  }, [view, commands, reduced]);
  useEffect(() => {
    if (view === 'breakup') {
      if (!prevOverlays.current) {
        const o = store.getState().overlays as Record<string, boolean>;
        prevOverlays.current = { debris: !!o.debris, satellites: !!o.satellites };
        commands.setOverlay('debris', false);
        commands.setOverlay('satellites', false);
      }
    } else restoreOverlays();
  }, [view, store, commands, restoreOverlays]);
  useEffect(() => restoreOverlays, [restoreOverlays]);

  // Breakup playback: log-time playhead.
  useEffect(() => {
    if (!playing || view !== 'breakup') return;
    let raf = 0;
    let last = performance.now();
    const rate = Math.log10(BREAKUP_T_MAX_S / BREAKUP_T_MIN_S) / PLAY_DURATION_S;
    const step = (now: number): void => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setTS(t => {
        const n = Math.min(BREAKUP_T_MAX_S, t * 10 ** (rate * dt));
        if (n >= BREAKUP_T_MAX_S) setPlaying(false);
        return n;
      });
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [playing, view]);
  useEffect(() => { if (view !== 'breakup') setPlaying(false); }, [view]);
  useEffect(() => { setTS(BREAKUP_T_MIN_S); setPlaying(!reduced && view === 'breakup'); }, [eventId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (view === 'breakup' && !reduced && tS <= BREAKUP_T_MIN_S) setPlaying(true); }, [view]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = (): void => {
    setInputs(REAL_INPUTS);
    setYear(REAL_INPUTS.horizonYears);
  };

  const result: LabResult | undefined = selSum ? {
    caption: `Objects 10 cm and larger in low Earth orbit in ${BASE_YEAR + horizon} (model)`,
    value: fmtCount(selSum.totalEnd),
    unit: ' objects',
    numeric: selSum.totalEnd,
    decimals: 0,
  } : undefined;

  const compare: LabCompareRow[] | undefined = selSum && realSum ? [
    { label: `Objects in ${BASE_YEAR + horizon}`, real: fmtCount(realSum.totalEnd), modified: fmtCount(selSum.totalEnd), difference: diffText(realSum.totalEnd, selSum.totalEnd) },
    { label: 'Debris fragments', real: fmtCount(realSum.debrisEnd), modified: fmtCount(selSum.debrisEnd), difference: diffText(realSum.debrisEnd, selSum.debrisEnd) },
    { label: `Collisions per year in ${BASE_YEAR + horizon}`, real: fmtRate(realSum.collisionsPerYearEnd), modified: fmtRate(selSum.collisionsPerYearEnd), difference: diffText(realSum.collisionsPerYearEnd, selSum.collisionsPerYearEnd) },
    { label: `Collisions over ${horizon} years`, real: fmtCount(realSum.cumulativeCollisions), modified: fmtCount(selSum.cumulativeCollisions), difference: diffText(realSum.cumulativeCollisions, selSum.cumulativeCollisions) },
  ] : undefined;

  const series: GrowthSeries[] = SHELL_SCENARIOS.map(s => ({
    id: s.id,
    title: s.title,
    run: s.id === committed.scenario && selRun ? selRun : (cmp[s.id] ?? null),
    role: s.id === committed.scenario ? (modified ? 'modified' : 'real') : s.id === 'business-as-usual' && committed.solar === 'moderate' ? 'real' : 'other',
  }));
  if (modified && committed.solar !== 'moderate' && realRun) {
    series.push({ id: 'business-as-usual', title: 'Today (average Sun)', run: realRun, role: 'real' });
  }

  let viz: ReactNode;
  const toolbar = (
    <div className="dl-toolbar">
      <SegmentedControl<View> label="Visualization" size="sm" value={view} options={VIEW_OPTIONS} onChange={setView} />
      {(view === 'growth' || view === 'altitude') && <ProvenanceBadge kind="derived" detail="debris-shell-source-sink@1 seeded with the catalogue snapshot" />}
    </div>
  );
  if (view === 'growth') {
    viz = (
      <div className="dl-viz dl-viz--chart">
        {toolbar}
        <div className="dl-card">
          <GrowthChart series={series} year={yearC} horizon={horizon} onYear={setYear} />
          <ScenarioTable runs={cmp} selected={committed.scenario} onSelect={id => set({ scenario: id })} horizon={horizon} />
        </div>
      </div>
    );
  } else if (view === 'altitude') {
    viz = (
      <div className="dl-viz dl-viz--chart">
        {toolbar}
        <div className="dl-card">
          <p className="dl-card__title">{SCENARIO_TITLES[committed.scenario]}: where the objects are, shell by shell</p>
          <AltitudeChart run={selRun} year={yearC} horizon={horizon} onYear={setYear} role={modified ? 'modified' : 'real'} />
        </div>
      </div>
    );
  } else if (view === 'earth') {
    const tot = selRun ? (() => { const a = shellsAtYear(selRun, yearC, 'total', new Float64Array(SHELL_COUNT)); return a.reduce((x, y) => x + y, 0); })() : NaN;
    viz = (
      <div className="dl-viz dl-viz--live">
        {toolbar}
        <div className="dl-strip" role="group" aria-label="Year shown around Earth">
          <Slider label="Year" value={yearC} min={0} max={horizon} step={1} format={v => String(BASE_YEAR + Math.round(v))} onChange={v => setYear(Math.round(v))} />
          <p className="dl-strip__facts cx-num">
            {SCENARIO_TITLES[committed.scenario]}: {fmtCount(tot)} objects in {BASE_YEAR + yearC} (model). The glow shows how crowded each
            200–2,000 km shell is; brighter is denser. Dots are today's real tracked objects.
          </p>
          <div className="dl-ramp" aria-hidden="true"><span>Sparse</span><i /><span>Crowded</span></div>
          {!attached && <p className="dl-note">The 3D view is starting…</p>}
        </div>
      </div>
    );
  } else {
    viz = (
      <div className="dl-viz dl-viz--live">
        {toolbar}
        <BreakupStrip eventId={eventId} setEventId={setEventId} cloud={cloud} tS={tS} setTS={setTS} playing={playing} setPlaying={setPlaying} />
      </div>
    );
  }

  return (
    <LabShell
      title="Orbital debris lab"
      subject="Low Earth orbit"
      modified={modified}
      onReset={reset}
      onClose={onClose}
      realState={<RealState />}
      variables={<Variables inputs={inputs} set={set} />}
      visualization={viz}
      result={result}
      compare={compare}
      explanation={<Explanation sel={selSum} stop={stopSum} inputs={committed} />}
      assumptions={<Assumptions />}
      className="dl-lab"
    />
  );
}
