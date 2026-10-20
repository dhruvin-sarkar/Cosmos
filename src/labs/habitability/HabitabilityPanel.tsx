/**
 * Habitability lab panel (LabId 'habitability'). Two views in one LabShell:
 *  - Habitability: choose a star and a planet (presets for real planets, or any catalogue planet) → equilibrium and
 *    surface temperature, habitable-zone position, Earth Similarity Index, tidal-locking hint and a plain verdict.
 *  - Explorer: the NASA Exoplanet Archive catalogue (counts by method/year, mass–radius and period–distance charts,
 *    search, fly-to, the featured systems and the filters of the 3-D planet-host marker field).
 */
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LabShell, type LabCompareRow, type LabResult } from '../../ui/labs/LabShell';
import type { LabPanelProps } from '../../ui/labs/registry';
import { SegmentedControl } from '../../ui/components/SegmentedControl';
import { Slider } from '../../ui/components/Slider';
import { Equation } from '../../ui/components/Equation';
import { ProvenanceBadge } from '../../ui/components/Provenance';
import { EXO_PREFIX, SYS_PREFIX, hostPlanetRange, type ExoCatalog, type ExoIndex } from '../../domains/exoplanets/catalog';
import {
  HZ_WORDS, PLANET_PRESETS, STAR_PRESETS, evaluateHabitability, inputsEqual, type HabInputs, type HabResult, type Redistribution,
} from './model';
import { inputsFromCatalog, type CatalogInputs } from './fromCatalog';
import { HzDiagram } from './HzDiagram';
import { useExplorerParts } from './Explorer';
import { useExoCatalog } from './useExo';
import '../debris/debris.css';
import './habitability.css';

type Mode = 'lab' | 'explorer';
const MODES: { value: Mode; label: string }[] = [
  { value: 'lab', label: 'Habitability' },
  { value: 'explorer', label: 'Explore exoplanets' },
];
const REDIST: { value: Redistribution; label: string }[] = [
  { value: 'full', label: 'Whole planet' },
  { value: 'dayside', label: 'Day side only' },
];

/** The "real" baseline the variables start from. */
interface Baseline {
  key: string;
  label: string;
  inputs: HabInputs;
  source: string;
  estimated: CatalogInputs['estimated'];
  archiveTeqK: number | null;
}

const EST_WORDS: Record<CatalogInputs['estimated'][number], string> = {
  radius: 'radius (from mass, Chen & Kipping 2017)',
  mass: 'mass (from radius, Chen & Kipping 2017)',
  distance: 'orbital distance (from the period, Kepler’s third law)',
  luminosity: 'star luminosity (from its radius and temperature)',
  teff: 'star temperature (Sun-like assumed)',
  starMass: 'star mass (from its luminosity)',
};

function presetBaseline(id: string, loaded: { catalog: ExoCatalog; index: ExoIndex } | null): Baseline {
  const p = PLANET_PRESETS.find((x) => x.id === id) ?? PLANET_PRESETS[0];
  // Refresh exoplanet presets from the archive when it is loaded (star and orbit), keeping the preset climate knobs.
  if (p.archiveName && loaded) {
    const i = loaded.index.planetByName.get(p.archiveName);
    const c = i != null ? inputsFromCatalog(loaded.catalog, i) : null;
    if (c) {
      return {
        key: p.id, label: p.label, source: p.source, estimated: c.estimated, archiveTeqK: c.archiveTeqK,
        inputs: { ...c.inputs, albedo: p.inputs.albedo, greenhouseK: p.inputs.greenhouseK, redistribution: p.inputs.redistribution },
      };
    }
  }
  return { key: p.id, label: p.label, inputs: p.inputs, source: p.source, estimated: [], archiveTeqK: null };
}

function catalogBaseline(c: ExoCatalog, planet: number): Baseline | null {
  const r = inputsFromCatalog(c, planet);
  if (!r) return null;
  return {
    key: `cat:${r.planetName}`, label: r.planetName, inputs: r.inputs, estimated: r.estimated, archiveTeqK: r.archiveTeqK,
    source: 'NASA Exoplanet Archive, Planetary Systems Composite Parameters; climate knobs Earth-like (assumed)',
  };
}

/** Best planet of a host for the lab: the one closest to its conservative HZ centre. */
function bestPlanetOfHost(c: ExoCatalog, host: number): number {
  const [a, b] = hostPlanetRange(c, host);
  let best = a, bd = Infinity;
  for (let i = a; i < b; i++) {
    const s = c.planets.insolE[i];
    const d = Number.isFinite(s) && s > 0 ? Math.abs(Math.log(s / 0.9)) : 50;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

// ── Formatting ──────────────────────────────────────────────────────────────────────────────

const sig = (v: number, n = 3): string => (Number.isFinite(v) ? Number(v.toPrecision(n)).toLocaleString('en-US') : 'Unknown');
const degC = (k: number): string => `${Math.round(k - 273.15).toLocaleString('en-US')} °C`;
const fmtLock = (yr: number): string => {
  if (!(yr > 0) || !Number.isFinite(yr)) return 'Unknown';
  if (yr < 1e6) return `≈ ${sig(yr, 2)} years`;
  if (yr < 1e9) return `≈ ${sig(yr / 1e6, 2)} million years`;
  return `≈ ${sig(yr / 1e9, 2)} billion years`;
};
const signed = (v: number, unit: string, n = 3): string => (Math.abs(v) < 1e-9 ? '0' : `${v > 0 ? '+' : '−'}${sig(Math.abs(v), n)}${unit}`);

function Fact({ k, v, est }: { k: string; v: ReactNode; est?: boolean }) {
  return (
    <div className="cx-fact">
      <span className="cx-fact__label">{k}</span>
      <span className="cx-fact__value cx-num">{v}{est && <span className="hab-est" title="Estimated, not measured"> est.</span>}</span>
    </div>
  );
}

// ── Lab view ────────────────────────────────────────────────────────────────────────────────

function LabVariables({ inputs, set, base, presetId, onPreset, loaded }: {
  inputs: HabInputs; set(p: Partial<HabInputs>): void; base: Baseline; presetId: string; onPreset(id: string): void;
  loaded: boolean;
}) {
  const starId = STAR_PRESETS.find((s) => Math.abs(s.teffK - inputs.starTeffK) < 1 && Math.abs(s.lum / inputs.starLum - 1) < 1e-3)?.id ?? '';
  return (
    <>
      <label className="hab-field">
        <span className="hab-field__label">Real planet</span>
        <select className="hab-select" value={presetId} onChange={(e) => onPreset(e.target.value)}>
          {PLANET_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          {presetId.startsWith('cat:') && <option value={presetId}>{base.label}</option>}
        </select>
      </label>
      {!loaded && <p className="hab-src">Loading the exoplanet catalogue… (presets use stored archive values meanwhile)</p>}
      <h4 className="hab-subhead">Star</h4>
      <label className="hab-field">
        <span className="hab-field__label">Star type</span>
        <select className="hab-select" value={starId} onChange={(e) => {
          const s = STAR_PRESETS.find((x) => x.id === e.target.value);
          if (s) set({ starTeffK: s.teffK, starLum: s.lum, starMass: s.mass });
        }}>
          {starId === '' && <option value="">Custom star</option>}
          {STAR_PRESETS.map((s) => <option key={s.id} value={s.id}>{s.label}{s.note ? ` · ${s.note}` : ''}</option>)}
        </select>
      </label>
      <Slider label="Star temperature" value={inputs.starTeffK} onChange={(v) => set({ starTeffK: Math.round(v), starMass: null })}
        min={2300} max={10000} step={10} unit="K" format={(v) => Math.round(v).toLocaleString('en-US')} referenceValue={base.inputs.starTeffK} referenceLabel="Real" />
      <Slider label="Star luminosity" scale="log" value={inputs.starLum} onChange={(v) => set({ starLum: v, starMass: null })}
        min={1e-4} max={100} unit="× Sun" format={(v) => sig(v, 2)} referenceValue={base.inputs.starLum} referenceLabel="Real" />
      <h4 className="hab-subhead">Planet</h4>
      <Slider label="Distance from the star" scale="log" value={inputs.distanceAu} onChange={(v) => set({ distanceAu: v })}
        min={0.005} max={50} unit="AU" format={(v) => sig(v, 3)} referenceValue={base.inputs.distanceAu} referenceLabel="Real" />
      <Slider label="Radius" scale="log" value={inputs.radiusE} onChange={(v) => set({ radiusE: v })}
        min={0.3} max={25} unit="× Earth" format={(v) => sig(v, 3)} referenceValue={base.inputs.radiusE} referenceLabel="Real" />
      <Slider label="Mass" scale="log" value={inputs.massE} onChange={(v) => set({ massE: v })}
        min={0.01} max={5000} unit="× Earth" format={(v) => sig(v, 3)} referenceValue={base.inputs.massE} referenceLabel="Real" />
      <h4 className="hab-subhead">Climate</h4>
      <Slider label="Reflectivity (Bond albedo)" value={inputs.albedo} onChange={(v) => set({ albedo: v })}
        min={0} max={0.95} step={0.01} format={(v) => v.toFixed(2)} referenceValue={base.inputs.albedo} referenceLabel="Real"
        marks={[{ value: 0.306, label: 'Earth' }, { value: 0.76, label: 'Venus' }]} />
      <Slider label="Greenhouse warming" value={inputs.greenhouseK} onChange={(v) => set({ greenhouseK: Math.round(v) })}
        min={0} max={600} step={1} unit="K" format={(v) => String(Math.round(v))} referenceValue={base.inputs.greenhouseK} referenceLabel="Real"
        marks={[{ value: 33, label: 'Earth' }, { value: 510, label: 'Venus' }]} />
      <SegmentedControl<Redistribution> label="Heat spread over" size="sm" value={inputs.redistribution}
        onChange={(v) => set({ redistribution: v })} options={REDIST} />
    </>
  );
}

function LabViz({ r, inputs, modified, label }: { r: HabResult; inputs: HabInputs; modified: boolean; label: string }) {
  const esi = r.esi.value;
  return (
    <div className="hab-viz">
      <div className="hab-viz__head">
        <p className="hab-viz__title">{label}{modified && <span className="hab-viz__sub"> (scenario)</span>}: {HZ_WORDS[r.hzPos]}</p>
      </div>
      <HzDiagram hz={r.hz} lum={inputs.starLum} teffK={inputs.starTeffK} distanceAu={inputs.distanceAu} modified={modified} />
      <p className="hab-viz__cap">
        Distance from the star on a logarithmic scale. Dark green: conservative habitable zone (runaway to maximum greenhouse);
        pale green: optimistic zone (recent Venus to early Mars), Kopparapu et al. 2013/2014. *Venus, Earth and Mars placed where
        they would get the same starlight around this star.
      </p>
      <div className="hab-gauges">
        <div className="hab-gauge">
          <span className="hab-gauge__label">Earth Similarity Index</span>
          <span className="hab-gauge__value cx-num">{esi == null ? 'Unknown' : esi.toFixed(2)}</span>
          <span className="hab-gauge__bar" aria-hidden="true"><span style={{ width: `${Math.round((esi ?? 0) * 100)}%` }} /></span>
        </div>
        <div className="hab-gauge">
          <span className="hab-gauge__label">Starlight received</span>
          <span className="hab-gauge__value cx-num">{sig(r.insolation, 3)} × Earth</span>
        </div>
        <div className="hab-gauge">
          <span className="hab-gauge__label">Water would be</span>
          <span className={`hab-gauge__value hab-water hab-water--${r.gaseous ? 'none' : r.water}`}>{r.gaseous ? 'no surface' : r.water}</span>
        </div>
      </div>
      <div className="cx-facts hab-facts">
        <Fact k="Equilibrium temperature" v={`${Math.round(r.teqK)} K (${degC(r.teqK)})`} />
        <Fact k="Surface temperature" v={`${Math.round(r.surfaceK)} K (${degC(r.surfaceK)})`} />
        <Fact k="Bulk density" v={`${sig(r.densityGcc, 3)} g/cm³`} />
        <Fact k="Surface gravity" v={`${sig(r.gravityG, 3)} g`} />
        <Fact k="Escape velocity" v={`${sig(r.escapeKms, 3)} km/s`} />
        <Fact k="Star radius" v={`${sig(r.starRadiusM / 6.957e8, 3)} × Sun`} />
        <Fact k="Star mass" v={`${sig(r.starMassSun, 3)} × Sun`} est={r.starMassEstimated} />
        <Fact k="Time to tidally lock" v={fmtLock(r.tidalLockYr)} />
      </div>
    </div>
  );
}

// ── Panel ───────────────────────────────────────────────────────────────────────────────────

export function HabitabilityPanel({ params, onClose }: LabPanelProps) {
  const { loaded, error } = useExoCatalog();
  const [mode, setMode] = useState<Mode>('lab');
  const [presetId, setPresetId] = useState('earth');
  const [catBase, setCatBase] = useState<Baseline | null>(null);
  const base = useMemo<Baseline>(() => (presetId.startsWith('cat:') && catBase ? catBase : presetBaseline(presetId, loaded)), [presetId, catBase, loaded]);
  const [inputs, setInputs] = useState<HabInputs>(base.inputs);
  useEffect(() => setInputs(base.inputs), [base]);
  const set = (p: Partial<HabInputs>): void => setInputs((s) => ({ ...s, ...p }));

  const pickPlanet = (planet: number): void => {
    if (!loaded) return;
    const b = catalogBaseline(loaded.catalog, planet);
    if (!b) return;
    const preset = PLANET_PRESETS.find((p) => p.archiveName === b.label);
    if (preset) { setCatBase(null); setPresetId(preset.id); } else { setCatBase(b); setPresetId(b.key); }
    setMode('lab');
  };

  // Opened from an entity (inspector "Test habitability" / tour): exo:<planet> or sys:<host>.
  const entityId = typeof params?.entityId === 'string' ? params.entityId : null;
  useEffect(() => {
    if (!entityId || !loaded) return;
    const { catalog, index } = loaded;
    if (entityId.startsWith(EXO_PREFIX)) {
      const i = index.planetByName.get(entityId.slice(EXO_PREFIX.length));
      if (i != null) pickPlanet(i);
    } else if (entityId.startsWith(SYS_PREFIX)) {
      const h = index.hostByName.get(entityId.slice(SYS_PREFIX.length));
      if (h != null) pickPlanet(bestPlanetOfHost(catalog, h));
    } else if (params?.view === 'explorer') setMode('explorer');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityId, loaded]);
  useEffect(() => { if (params?.view === 'explorer') setMode('explorer'); }, [params?.view]);

  const r = useMemo(() => evaluateHabitability(inputs), [inputs]);
  const r0 = useMemo(() => evaluateHabitability(base.inputs), [base]);
  const modified = !inputsEqual(inputs, base.inputs);
  const reset = (): void => setInputs(base.inputs);

  const modeSwitch = <SegmentedControl<Mode> label="Lab view" value={mode} onChange={setMode} options={MODES} className="hab-mode" />;

  if (mode === 'explorer') {
    return (
      <ExplorerShell loaded={loaded} error={error} modeSwitch={modeSwitch} onClose={onClose} onLab={pickPlanet} />
    );
  }

  const result: LabResult = {
    caption: r.gaseous ? 'Temperature at the cloud tops (no solid surface)' : 'Average surface temperature',
    value: String(Math.round(r.surfaceK - 273.15)), unit: '°C', numeric: Math.round(r.surfaceK - 273.15), decimals: 0,
  };
  const esiTxt = (x: HabResult): string => (x.esi.value == null ? 'Unknown' : x.esi.value.toFixed(2));
  const compare: LabCompareRow[] = [
    { label: 'Surface temperature', real: degC(r0.surfaceK), modified: degC(r.surfaceK), difference: signed(r.surfaceK - r0.surfaceK, ' K') },
    { label: 'Equilibrium temperature', real: `${Math.round(r0.teqK)} K`, modified: `${Math.round(r.teqK)} K`, difference: signed(r.teqK - r0.teqK, ' K') },
    { label: 'Starlight (× Earth)', real: sig(r0.insolation), modified: sig(r.insolation), difference: signed(r.insolation - r0.insolation, '') },
    { label: 'Earth Similarity Index', real: esiTxt(r0), modified: esiTxt(r), difference: r.esi.value != null && r0.esi.value != null ? signed(r.esi.value - r0.esi.value, '', 2) : '—' },
    { label: 'Habitable zone', real: HZ_WORDS[r0.hzPos].replace(/ \(.*\)/, ''), modified: HZ_WORDS[r.hzPos].replace(/ \(.*\)/, ''), difference: r.hzPos === r0.hzPos ? 'same' : 'changed' },
  ];

  const realState = (
    <>
      {modeSwitch}
      <p className="hab-lede">
        <strong>{base.label}</strong>: {sig(base.inputs.distanceAu)} AU from a {Math.round(base.inputs.starTeffK).toLocaleString('en-US')} K star
        shining at {sig(base.inputs.starLum, 2)} × the Sun; {sig(base.inputs.radiusE)} × Earth's radius and {sig(base.inputs.massE)} × its mass.
        {base.archiveTeqK != null && <> The archive lists an equilibrium temperature of <span className="cx-num">{Math.round(base.archiveTeqK)} K</span>.</>}
      </p>
      <p className="hab-src">
        <ProvenanceBadge kind={base.estimated.length ? 'derived' : 'observed'} /> {base.source}.
        {base.estimated.length > 0 && <> Estimated: {base.estimated.map((e) => EST_WORDS[e]).join('; ')}.</>}
        {base.key !== 'earth' && base.key !== 'venus' && base.key !== 'mars' && ' Albedo and greenhouse warming are unknown for exoplanets: Earth-like values assumed.'}
      </p>
    </>
  );

  const explanation = (
    <>
      <p className="hab-verdict">{r.verdict}</p>
      {r.notes.length > 0 && <ul className="hab-notes">{r.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
      <p>
        A planet's temperature is set by the balance between the starlight it absorbs and the heat it radiates. Without an
        atmosphere it would settle at the <em>equilibrium temperature</em>:
      </p>
      <Equation display tex={String.raw`T_\mathrm{eq} = T_\star \sqrt{\frac{R_\star}{a}}\,\bigl[f\,(1-A)\bigr]^{1/4}`} label="Equilibrium temperature" />
      <p>
        with the star's temperature T★ and radius R★, the orbital distance a, the Bond albedo A and f = ¼ when heat spreads
        over the whole planet (½ for the day side only). Greenhouse gases add warming on top: Earth's 255 K becomes 288 K.
        The habitable zone is where an Earth-like planet with a carbon-dioxide–water climate could keep liquid water on its
        surface (Kopparapu et al. 2013, 2014). The Earth Similarity Index compares radius, density, escape velocity and surface
        temperature with Earth's (Schulze-Makuch et al. 2011): 1 is Earth, above about 0.8 is "Earth-like" in these four numbers only.
      </p>
    </>
  );

  const assumptions = (
    <ul className="hab-notes">
      <li>Circular orbit at the semi-major axis; blackbody star and planet; no internal heat.</li>
      <li>Greenhouse warming is a single number added to the equilibrium temperature, not a climate model.</li>
      <li>Habitable-zone limits from Kopparapu et al. 2014 (1 Earth mass), calibrated for 2,600–7,200 K stars.</li>
      <li>"Gas-rich" when the radius exceeds 1.8 Earth radii or the planet is massive and low-density (Fulton et al. 2017 radius gap).</li>
      <li>Tidal-locking time from Gladman et al. 1996 with Q = 100 and an initial 12-hour day; "probably locked" below 1 billion years.</li>
      <li>Missing archive values are estimated (Chen & Kipping 2017 mass–radius relation, Kepler's third law) and marked "est.".</li>
    </ul>
  );

  return (
    <LabShell
      title="Habitability lab"
      subject={base.label}
      modified={modified}
      onReset={reset}
      onClose={onClose}
      realState={realState}
      variables={<LabVariables inputs={inputs} set={set} base={base} presetId={presetId} onPreset={(id) => { setCatBase(null); setPresetId(id); }} loaded={!!loaded} />}
      visualization={<LabViz r={r} inputs={inputs} modified={modified} label={base.label} />}
      result={result}
      compare={compare}
      explanation={explanation}
      assumptions={assumptions}
      className="dl-lab hab-lab"
    />
  );
}

function ExplorerShell({ loaded, error, modeSwitch, onClose, onLab }: {
  loaded: { catalog: ExoCatalog; index: ExoIndex } | null; error: boolean; modeSwitch: ReactNode; onClose(): void; onLab(planet: number): void;
}) {
  if (!loaded) {
    return (
      <LabShell title="Habitability lab" subject="Exoplanet explorer" modified={false} onReset={() => undefined} onClose={onClose}
        realState={<>{modeSwitch}<p className="hab-lede">{error ? 'The exoplanet catalogue could not be loaded.' : 'Loading the NASA Exoplanet Archive catalogue…'}</p></>}
        className="dl-lab hab-lab" />
    );
  }
  return <ExplorerLoaded loaded={loaded} modeSwitch={modeSwitch} onClose={onClose} onLab={onLab} />;
}

function ExplorerLoaded({ loaded, modeSwitch, onClose, onLab }: {
  loaded: { catalog: ExoCatalog; index: ExoIndex }; modeSwitch: ReactNode; onClose(): void; onLab(planet: number): void;
}) {
  const parts = useExplorerParts(loaded, onLab);
  return (
    <LabShell
      title="Habitability lab"
      subject="Exoplanet explorer"
      modified={false}
      onReset={() => undefined}
      onClose={onClose}
      realState={<>{modeSwitch}{parts.realState}</>}
      variables={parts.variables}
      visualization={parts.visualization}
      assumptions={
        <ul className="hab-notes">
          <li>Planets are drawn from the archive's composite table: one row per planet, best available values from several papers.</li>
          <li>Radial-velocity masses are minimum masses (M sin i) unless the inclination is known.</li>
          <li>3-D planet surfaces are artist's impressions chosen from the planet's size, mass and temperature.</li>
        </ul>
      }
      className="dl-lab hab-lab"
    />
  );
}
