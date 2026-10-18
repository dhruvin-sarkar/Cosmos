/**
 * UI sandbox: the full HUD over a mock universe (real store, real registry with sample entities, fake commands).
 * URL parameters set a starting state for screenshots:
 *   ?select=exo:TRAPPIST-1 e&section=know  ?lab=debris  ?tour=1  ?panel=help|sources|settings|debug
 *   ?travel=1 (ruler in travel mode)  ?scale=16.6  ?exhibition=1
 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Vector3 } from 'three';
import '../src/styles/index.css';
import type { AppCommands, AppContextValue } from '../src/app/commands';
import type { Entity, EntityKind, DomainId, Capability, LabId } from '../src/core/entity';
import { AU_M, LY_M, PC_M, KPC_M, R_EARTH_MEAN_M, R_SUN_M } from '../src/core/units';
import { createRegistry } from '../src/core/registry';
import type { DataManifest, FactSheet, ProvenanceClass } from '../src/data/provenance';
import { derived, observed } from '../src/data/provenance';
import { createCosmosStore, pushNotice, type Crumb } from '../src/state/store';
import { CosmosApp } from '../src/ui/App';
import { registerLabPanel, type LabPanelProps } from '../src/ui/labs/registry';
import { LabShell } from '../src/ui/labs/LabShell';
import { Slider } from '../src/ui/components/Slider';
import { QuantityView } from '../src/ui/components/QuantityView';
import { ProvenanceBadge } from '../src/ui/components/Provenance';
import { Equation } from '../src/ui/components/Equation';

const params = new URLSearchParams(location.search);
const NOW = Date.UTC(2026, 9, 17, 20, 15, 0);
const YEAR_MS = 365.25 * 86_400_000;

// ── Sample entities ────────────────────────────────────────────────────────────────────────

function circular(radiusM: number, periodYr: number, phase = 0, center?: () => Vector3): (t: number, out: Vector3) => Vector3 {
  return (t, out) => {
    const a = phase + ((t - NOW) / YEAR_MS / periodYr) * Math.PI * 2;
    out.set(Math.cos(a) * radiusM, Math.sin(a) * radiusM, 0);
    if (center) out.add(center());
    return out;
  };
}

function fixed(x: number, y: number, z: number): (t: number, out: Vector3) => Vector3 {
  return (_t, out) => out.set(x, y, z);
}

const CAPS: Capability[] = ['focus', 'travel', 'show-orbit', 'bookmark', 'sources'];
const src = (datasetId: string, field?: string, reference?: string) => ({ datasetId, field, reference });

function entity(p: {
  id: string; name: string; kind: EntityKind; domain: DomainId; parentId: string | null; radiusM: number | null;
  position: Entity['position']; importance: number; representation?: ProvenanceClass; aliases?: string[]; tagline?: string;
  capabilities?: Capability[]; facts?: () => FactSheet | Promise<FactSheet>;
}): Entity {
  return {
    aliases: [],
    capabilities: CAPS,
    representation: 'observed',
    facts: () => ({
      entityId: p.id,
      summary: p.tagline ?? '',
      sections: [],
      representation: { provenance: p.representation ?? 'observed', description: 'Sample representation.' },
      sources: [],
    }),
    ...p,
  };
}

const registry = createRegistry();
const sunPos = fixed(0, 0, 0);
const earthPos = circular(AU_M, 1, 0.4);
const earthCenter = (): Vector3 => earthPos(NOW, new Vector3());

const planets: Array<[string, string, number, number, number]> = [
  ['mercury', 'Mercury', 0.387, 0.241, 2_439.7e3],
  ['venus', 'Venus', 0.723, 0.615, 6_051.8e3],
  ['mars', 'Mars', 1.524, 1.881, 3_389.5e3],
  ['saturn', 'Saturn', 9.537, 29.45, 58_232e3],
  ['uranus', 'Uranus', 19.19, 84.0, 25_362e3],
  ['neptune', 'Neptune', 30.07, 164.8, 24_622e3],
];

registry.register(entity({ id: 'sol:sun', name: 'Sun', kind: 'star', domain: 'solar', parentId: 'mw:galaxy', radiusM: R_SUN_M, position: sunPos, importance: 100, tagline: 'G2 V main-sequence star' }));
registry.register(entity({ id: 'mw:galaxy', name: 'Milky Way', kind: 'galaxy', domain: 'galaxy', parentId: null, radiusM: 15 * KPC_M, position: fixed(-8.178 * KPC_M, 0, 0), importance: 95, representation: 'reconstructed', tagline: 'Barred spiral galaxy' }));
for (const [id, name, a, per, r] of planets) {
  registry.register(entity({ id: `sol:${id}`, name, kind: 'planet', domain: 'solar', parentId: 'sol:sun', radiusM: r, position: circular(a * AU_M, per, a), importance: 90, tagline: 'Planet' }));
}

registry.register(entity({
  id: 'sol:earth', name: 'Earth', kind: 'planet', domain: 'earth', parentId: 'sol:sun', radiusM: R_EARTH_MEAN_M, position: earthPos, importance: 100,
  tagline: 'Terrestrial planet, third from the Sun', capabilities: [...CAPS, 'follow', 'experiment:debris'],
  facts: () => ({
    entityId: 'sol:earth',
    summary: 'The only world known to host life. Oceans cover 71% of its surface, and a thin atmosphere keeps it warm enough for liquid water.',
    sections: [
      { id: 'overview', title: 'Overview', facts: [
        { key: 'classification', label: 'Class', text: 'Terrestrial planet', provenance: 'observed' },
        { key: 'radius', label: 'Mean radius', quantity: { ...observed(6_371.0088, 'km', src('iau-wgccre-2015')), sigDigits: 5 }, provenance: 'observed' },
        { key: 'mass', label: 'Mass', quantity: { ...observed(5.9722e24, 'kg', src('jpl-ssd-constants'), { kind: 'symmetric', sigma: 0.0006e24 }) }, provenance: 'observed' },
        { key: 'day', label: 'Sidereal day', quantity: { ...observed(23.9345, 'h', src('jpl-ssd-constants')), sigDigits: 6 }, provenance: 'observed' },
      ] },
      { id: 'orbit', title: 'Orbit', facts: [
        { key: 'a', label: 'Semi-major axis', quantity: { ...observed(1.000_001, 'AU', src('jpl-horizons')), sigDigits: 7 }, provenance: 'observed' },
        { key: 'e', label: 'Eccentricity', quantity: { ...observed(0.0167, '', src('jpl-horizons')), sigDigits: 3 }, provenance: 'observed' },
      ] },
    ],
    representation: { provenance: 'observed', description: 'Surface: NASA Blue Marble Next Generation mosaic; clouds from a single day of MODIS imagery.' },
    sources: [src('jpl-horizons'), src('jpl-ssd-constants')],
    epoch: { label: 'J2000.0', iso: '2000-01-01T12:00:00Z' },
  }),
}));

registry.register(entity({
  id: 'sol:jupiter', name: 'Jupiter', kind: 'planet', domain: 'solar', parentId: 'sol:sun', radiusM: 69_911e3, position: circular(5.2038 * AU_M, 11.86, 2.1), importance: 95,
  tagline: 'Gas giant, the largest planet', aliases: ['NAIF 599'],
  facts: () => new Promise(resolve => setTimeout(() => resolve({
    entityId: 'sol:jupiter',
    summary: 'A gas giant more than twice as massive as all the other planets combined. Its Great Red Spot is a storm wider than Earth.',
    sections: [{ id: 'overview', title: 'Overview', facts: [
      { key: 'classification', label: 'Class', text: 'Gas giant', provenance: 'observed' },
      { key: 'radius', label: 'Mean radius', quantity: { ...observed(69_911, 'km', src('iau-wgccre-2015')), sigDigits: 5 }, provenance: 'observed' },
      { key: 'moons', label: 'Known moons', text: '97', provenance: 'observed', source: src('jpl-ssd-sats') },
    ] }],
    representation: { provenance: 'observed', description: 'Cassini and Juno global mosaics.' },
    sources: [src('jpl-horizons')],
  }), 700)),
}));

registry.register(entity({
  id: 'sat:25544', name: 'ISS', kind: 'space-station', domain: 'orbital', parentId: 'sol:earth', radiusM: 54.5, importance: 80,
  position: (t, out) => circular(6_791e3, 92.9 / 525_960, 0)(t, out).add(earthCenter()),
  aliases: ['International Space Station', 'NORAD 25544', 'COSPAR 1998-067A'], tagline: 'Crewed space station in low Earth orbit',
  capabilities: [...CAPS, 'follow', 'experiment:debris'],
  facts: () => ({
    entityId: 'sat:25544',
    summary: 'A crewed laboratory circling Earth every 93 minutes, about 420 km up. People have lived aboard continuously since November 2000.',
    sections: [{ id: 'overview', title: 'Overview', facts: [
      { key: 'classification', label: 'Class', text: 'Crewed space station', provenance: 'observed' },
      { key: 'alt', label: 'Altitude', quantity: { ...derived(417, 'km', 'sgp4@1', src('celestrak-gp', 'MEAN_MOTION')), sigDigits: 3 }, provenance: 'derived' },
      { key: 'period', label: 'Orbital period', quantity: { ...observed(92.9, 'min', src('celestrak-gp', 'MEAN_MOTION')), sigDigits: 3 }, provenance: 'observed' },
      { key: 'norad', label: 'NORAD id', text: '25544', provenance: 'observed', source: src('celestrak-gp', 'NORAD_CAT_ID') },
    ] }],
    representation: { provenance: 'illustrative', description: 'Shown as a marker; the station is far too small to see at this scale.' },
    sources: [src('celestrak-gp')],
    epoch: { label: 'TLE epoch 2026-10-16 18:41 UTC', iso: '2026-10-16T18:41:00Z' },
  }),
}));

registry.register(entity({
  id: 'star:hip:70890', name: 'Proxima Centauri', kind: 'star', domain: 'stars', parentId: 'mw:galaxy', radiusM: 0.1542 * R_SUN_M, importance: 85,
  position: fixed(-1.546 * LY_M, -1.183 * LY_M, -3.769 * LY_M), aliases: ['α Centauri C', 'HIP 70890', 'GJ 551'], tagline: 'M5.5 V red dwarf, the nearest star',
}));
registry.register(entity({
  id: 'sys:TRAPPIST-1', name: 'TRAPPIST-1', kind: 'star', domain: 'exoplanets', parentId: 'mw:galaxy', radiusM: 0.1192 * R_SUN_M, importance: 70,
  position: fixed(12.43 * PC_M, 0, 0), aliases: ['2MASS J23062928-0502285'], tagline: 'M8 V ultracool dwarf with seven planets',
}));

const trappistSheet: FactSheet = {
  entityId: 'exo:TRAPPIST-1 e',
  summary: 'A rocky planet a little smaller than Earth, orbiting inside its star’s habitable zone. Whether it keeps an atmosphere is still unknown.',
  sections: [
    { id: 'overview', title: 'Overview', facts: [
      { key: 'classification', label: 'Class', text: 'Rocky exoplanet', provenance: 'observed' },
      { key: 'radius', label: 'Radius', quantity: { ...observed(0.920, 'R_earth', src('nasa-exoplanet-archive-pscomp', 'pl_rade', '2021PSJ.....2....1A'), { kind: 'asymmetric', plus: 0.013, minus: 0.012 }) }, provenance: 'observed' },
      { key: 'mass', label: 'Mass', quantity: { ...observed(0.692, 'M_earth', src('nasa-exoplanet-archive-pscomp', 'pl_bmasse', '2021PSJ.....2....1A'), { kind: 'symmetric', sigma: 0.022 }) }, provenance: 'observed' },
      { key: 'teq', label: 'Equilibrium temperature', quantity: { ...derived(249.7, 'K', 'teq-blackbody@1', src('nasa-exoplanet-archive-pscomp', 'pl_eqt')), sigDigits: 4 }, provenance: 'derived', help: 'The temperature a planet would have with no atmosphere, if it absorbed and re-radiated starlight evenly.' },
      { key: 'albedo', label: 'Bond albedo', quantity: { value: null, unit: '', provenance: 'observed' }, provenance: 'observed' },
    ] },
    { id: 'properties', title: 'Properties', facts: [
      { key: 'insol', label: 'Starlight received', quantity: { ...observed(0.646, 'S_earth', src('nasa-exoplanet-archive-pscomp', 'pl_insol')), sigDigits: 3 }, provenance: 'observed' },
      { key: 'density', label: 'Bulk density', quantity: { ...derived(4.885, 'g/cm3', 'bulk-density@1', src('nasa-exoplanet-archive-pscomp')), sigDigits: 3, uncertainty: { kind: 'symmetric', sigma: 0.168 } }, provenance: 'derived' },
      { key: 'atmo', label: 'Atmosphere', text: '', provenance: 'observed' },
    ] },
    { id: 'orbit', title: 'Orbit', paragraphs: ['It circles its star in about six days, so close that it is probably tidally locked: one side always faces the star.'], facts: [
      { key: 'period', label: 'Orbital period', quantity: { ...observed(6.101013, 'd', src('nasa-exoplanet-archive-pscomp', 'pl_orbper'), { kind: 'symmetric', sigma: 0.000035 }) }, provenance: 'observed' },
      { key: 'a', label: 'Semi-major axis', quantity: { ...observed(0.02925, 'AU', src('nasa-exoplanet-archive-pscomp', 'pl_orbsmax'), { kind: 'range', min: 0.02922, max: 0.02928 }) }, provenance: 'observed' },
      { key: 'ecc', label: 'Eccentricity', quantity: { ...observed(0.00510, '', src('nasa-exoplanet-archive-pscomp', 'pl_orbeccen'), { kind: 'limit', type: 'upper' }) }, provenance: 'observed' },
    ] },
    { id: 'observations', title: 'Discovery', facts: [
      { key: 'method', label: 'Discovery method', text: 'Transit', provenance: 'observed', source: src('nasa-exoplanet-archive-pscomp', 'discoverymethod') },
      { key: 'year', label: 'Discovered', text: '2017', provenance: 'observed', source: src('nasa-exoplanet-archive-pscomp', 'disc_year') },
      { key: 'facility', label: 'Facility', text: 'Spitzer Space Telescope', provenance: 'observed' },
    ] },
    { id: 'experiment', title: 'Experiment', paragraphs: ['Change the star’s brightness or the planet’s albedo and see whether liquid water could survive.'], facts: [] },
  ],
  representation: { provenance: 'illustrative', description: 'No image of this planet exists. Its appearance is generated from its measured radius and equilibrium temperature.' },
  sources: [src('nasa-exoplanet-archive-pscomp'), src('gaia-dr3')],
  epoch: { label: 'Archive retrieval 2026-10-16', iso: '2026-10-16T20:00:00Z' },
  missing: ['Bond albedo', 'Atmospheric composition', 'Surface temperature'],
  assumptions: ['Equilibrium temperature assumes a Bond albedo of 0 and full heat redistribution.', 'Density assumes a spherical planet.'],
};

registry.register(entity({
  id: 'exo:TRAPPIST-1 e', name: 'TRAPPIST-1 e', kind: 'exoplanet', domain: 'exoplanets', parentId: 'sys:TRAPPIST-1', radiusM: 0.92 * R_EARTH_MEAN_M, importance: 75,
  position: fixed(12.43 * PC_M + 0.02925 * AU_M, 0, 0), representation: 'illustrative', aliases: ['TRAPPIST-1 e', '2MASS J23062928-0502285 e'],
  tagline: 'Rocky planet in the habitable zone of TRAPPIST-1', capabilities: [...CAPS, 'experiment:habitability'],
  facts: () => new Promise(resolve => setTimeout(() => resolve(trappistSheet), 400)),
}));
registry.register(entity({
  id: 'mw:sgr-a*', name: 'Sagittarius A*', kind: 'black-hole', domain: 'blackhole', parentId: 'mw:galaxy', radiusM: 1.2e10, importance: 90,
  position: fixed(-8.178 * KPC_M, 0, 0), aliases: ['Sgr A*'], tagline: 'Supermassive black hole at the centre of the Milky Way', capabilities: [...CAPS, 'experiment:relativity'],
}));
registry.register(entity({
  id: 'gal:m31', name: 'Andromeda', kind: 'galaxy', domain: 'extragalactic', parentId: null, radiusM: 23 * KPC_M, importance: 88,
  position: fixed(765 * KPC_M, 0, 0), aliases: ['M 31', 'NGC 224', 'Andromeda Galaxy'], tagline: 'Barred spiral galaxy, 2.5 million light-years away',
}));

// ── Manifest ───────────────────────────────────────────────────────────────────────────────

function ds(id: string, name: string, organization: string, version: string, license: string, provenanceClass: ProvenanceClass, domain: string, limitations: string) {
  return {
    id, name, organization, purpose: '', mechanism: 'Snapshot', endpoint: '', query: null, version, retrieved: '2026-10-16T20:00:00Z', license,
    licenseUrl: null, citation: `${organization}. ${name}, ${version}.`, rateLimits: '', fieldsUsed: [], updateCadence: '', cachePolicy: '',
    normalization: '', fallback: '', files: [], limitations, provenanceClass, domain,
  };
}
const manifest: DataManifest = {
  schemaVersion: 1,
  generated: '2026-10-16T21:04:00Z',
  datasets: {
    'nasa-exoplanet-archive-pscomp': ds('nasa-exoplanet-archive-pscomp', 'NASA Exoplanet Archive: Planetary Systems Composite Parameters', 'NASA Exoplanet Science Institute (Caltech/IPAC)', 'TAP 2026-10-16', 'Public domain. Acknowledge the NASA Exoplanet Archive.', 'observed', 'exoplanets', 'Composite table mixes values from different papers; uncertainties are not always consistent.'),
    'jpl-horizons': ds('jpl-horizons', 'JPL Horizons ephemerides', 'NASA Jet Propulsion Laboratory, Solar System Dynamics', 'DE441', 'Public domain.', 'observed', 'solar', 'Positions are interpolated between daily samples.'),
    'celestrak-gp': ds('celestrak-gp', 'CelesTrak general perturbations element sets', 'CelesTrak (T.S. Kelso)', 'GP 2026-10-16', 'Free for non-commercial use with attribution.', 'observed', 'orbital', 'SGP4 accuracy degrades by about 1 km per day from the element epoch.'),
    'gaia-dr3': ds('gaia-dr3', 'Gaia Data Release 3', 'European Space Agency, Gaia DPAC', 'DR3', 'CC BY-SA 3.0 IGO.', 'observed', 'stars', 'Parallaxes for very bright stars carry larger systematic errors.'),
    'iau-wgccre-2015': ds('iau-wgccre-2015', 'IAU WGCCRE report on cartographic coordinates and rotational elements 2015', 'International Astronomical Union', '2015', 'Published report.', 'observed', 'solar', 'Rotation models valid near the current epoch.'),
  },
};

// ── Store and fake commands ────────────────────────────────────────────────────────────────

const store = createCosmosStore({
  boot: { phase: params.get('boot') === 'loading' ? 'loading' : 'ready', progress: 0.62, message: 'Loading star catalogue…', error: null, webgl: 'ok' },
  time: { simTimeMs: NOW, rate: 86_400, paused: false },
});

function crumbsFor(id: string): Crumb[] {
  const chain = [id, ...registry.ancestors(id).map(e => e.id)].reverse();
  return chain.map(c => ({ id: c, name: registry.get(c)?.name ?? c }));
}

let tween = 0;
function animateScale(to: number, ms = 1600): Promise<void> {
  window.clearInterval(tween);
  const from = store.getState().view.scaleLog10;
  const t0 = performance.now();
  store.setState(s => ({ camera: { ...s.camera, traveling: true } }));
  return new Promise(resolve => {
    tween = window.setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / ms);
      const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
      store.setState(s => ({ view: { ...s.view, scaleLog10: from + (to - from) * e, focusDistanceM: 10 ** (from + (to - from) * e) } }));
      if (k >= 1) {
        window.clearInterval(tween);
        store.setState(s => ({ camera: { ...s.camera, traveling: false } }));
        resolve();
      }
    }, 100);
  });
}

const TOUR = [
  { title: 'Home planet', narration: 'Everything you know happened on this sphere, 12,742 km across.', scaleLog10: 7.1 },
  { title: 'The debris shell', narration: 'Over 30,000 tracked objects circle Earth. Most are fragments, not working satellites.', scaleLog10: 7.6 },
  { title: 'The Solar System', narration: 'Eight planets, and the Sun holds 99.86% of all the mass.', scaleLog10: 13 },
];

const commands: AppCommands = {
  select: id => store.setState(s => ({ selection: { id }, ui: { ...s.ui, inspectorOpen: id != null } })),
  focus: async id => {
    const e = registry.get(id);
    store.setState(s => ({ selection: { id }, camera: { ...s.camera, focusId: id, travelTargetId: id }, view: { ...s.view, breadcrumb: crumbsFor(id) } }));
    await animateScale(Math.log10((e?.radiusM ?? 1e7) * 2 * 1.25));
  },
  travelTo: async id => commands.focus(id),
  setScale: (v, o) => {
    if (o?.animate) void animateScale(v, 900);
    else store.setState(s => ({ view: { ...s.view, scaleLog10: v } }));
  },
  setCameraMode: mode => store.setState(s => ({ camera: { ...s.camera, mode } })),
  back: () => undefined,
  home: () => void commands.focus('sol:earth'),
  setTimeRate: rate => store.setState(s => ({ time: { ...s.time, rate, paused: false } })),
  pause: () => store.setState(s => ({ time: { ...s.time, paused: true } })),
  resume: () => store.setState(s => ({ time: { ...s.time, paused: false } })),
  togglePause: () => store.setState(s => ({ time: { ...s.time, paused: !s.time.paused } })),
  jumpToTime: ms => store.setState(s => ({ time: { ...s.time, simTimeMs: ms } })),
  timeToNow: () => store.setState(s => ({ time: { ...s.time, simTimeMs: Date.now(), rate: 1, paused: false } })),
  setOverlay: (id, on) => store.setState(s => ({ overlays: { ...s.overlays, [id]: on } })),
  toggleOverlay: id => store.setState(s => ({ overlays: { ...s.overlays, [id]: !s.overlays[id] } })),
  setSpectralBand: band => store.setState({ spectral: { band } }),
  setQuality: preset => store.setState(s => ({ quality: { ...s.quality, preset } })),
  openLab: (lab: LabId, p) => store.setState({ lab: { active: lab, params: p ?? null } }),
  closeLab: () => store.setState({ lab: { active: null, params: null } }),
  startTour: id => store.setState({ tour: { activeId: id, step: 0, stepCount: TOUR.length } }),
  tourNext: () => store.setState(s => ({ tour: { ...s.tour, step: Math.min(s.tour.stepCount - 1, s.tour.step + 1) } })),
  tourPrev: () => store.setState(s => ({ tour: { ...s.tour, step: Math.max(0, s.tour.step - 1) } })),
  tourRestartStep: () => undefined,
  exitTour: () => store.setState({ tour: { activeId: null, step: 0, stepCount: 0 } }),
  addBookmark: name => pushNotice(store, { kind: 'info', text: `Bookmarked ${name ?? 'this view'}.`, ttlMs: 4000 }),
  goToBookmark: () => undefined,
  removeBookmark: () => undefined,
};

// Simulation clock at 10 Hz, like the engine's throttled store writes.
setInterval(() => {
  const s = store.getState();
  if (!s.time.paused) store.setState({ time: { ...s.time, simTimeMs: s.time.simTimeMs + s.time.rate * 100 } });
}, 100);

// ── Demo lab panel (exercises LabShell) ───────────────────────────────────────────────────

function DebrisPanel({ onClose }: LabPanelProps) {
  const REAL_LAUNCHES = 2_800;
  const REAL_PMD = 0.9;
  const [launches, setLaunches] = useState(REAL_LAUNCHES);
  const [pmd, setPmd] = useState(REAL_PMD);
  const risk = (l: number, m: number): number => 1.2 * (l / REAL_LAUNCHES) ** 1.4 * ((1 - m) / (1 - REAL_PMD)) ** 0.8;
  const real = risk(REAL_LAUNCHES, REAL_PMD);
  const mod = risk(launches, pmd);
  const modified = launches !== REAL_LAUNCHES || pmd !== REAL_PMD;
  return (
    <LabShell
      title="Debris lab"
      subject="Low Earth orbit"
      modified={modified}
      onReset={() => { setLaunches(REAL_LAUNCHES); setPmd(REAL_PMD); }}
      onClose={onClose}
      realState={
        <dl className="cx-facts">
          <div className="cx-fact"><dt className="cx-fact__label">Tracked objects</dt><dd className="cx-fact__value"><ProvenanceBadge kind="observed" showLabel={false} /><QuantityView quantity={{ value: 30_412, unit: '', provenance: 'observed', sigDigits: 5 }} /></dd></div>
          <div className="cx-fact"><dt className="cx-fact__label">Launches per year</dt><dd className="cx-fact__value"><ProvenanceBadge kind="observed" showLabel={false} /><QuantityView quantity={{ value: REAL_LAUNCHES, unit: '', provenance: 'observed', sigDigits: 4 }} /></dd></div>
        </dl>
      }
      variables={
        <>
          <Slider label="Satellites launched per year" value={launches} onChange={v => setLaunches(Math.round(v))} min={100} max={100_000} scale="log" referenceValue={REAL_LAUNCHES} format={v => Math.round(v).toLocaleString('en-US')} />
          <Slider label="Satellites removed after their mission" value={pmd} onChange={setPmd} min={0} max={0.99} step={0.01} referenceValue={REAL_PMD} format={v => `${Math.round(v * 100)}`} unit="%" />
        </>
      }
      result={{ caption: 'Chance of a catastrophic collision in the next 10 years (illustrative model)', value: mod.toFixed(1), numeric: mod, decimals: 1, unit: '%' }}
      compare={[{ label: 'Collision chance', real: `${real.toFixed(1)}%`, modified: `${mod.toFixed(1)}%`, difference: `${mod - real >= 0 ? '+' : '−'}${Math.abs(mod - real).toFixed(1)} points` }]}
      explanation={
        <>
          <p>More satellites means more targets; fragments from each collision become new projectiles. Above a critical density, collisions feed themselves: the Kessler syndrome.</p>
          <Equation tex={'N_{\\text{collisions}} \\propto \\rho^2 \\, \\sigma \\, v_{\\text{rel}}'} display label="Collision rate grows with the square of object density" />
        </>
      }
      assumptions={<ul><li>Sample model for the UI sandbox only; the real lab uses the ESA MASTER-derived flux model.</li></ul>}
    />
  );
}
registerLabPanel('debris', DebrisPanel, { title: 'Debris lab', subject: 'Low Earth orbit' });

// ── Backdrop: a photographic-feeling body at 0.60 W, plus bright regions to test scrims ───

function Backdrop() {
  return (
    <div className="sbx-backdrop" aria-hidden="true">
      <div className="sbx-stars" />
      <div className="sbx-bright sbx-bright--left" />
      <div className="sbx-bright sbx-bright--right" />
      <div className="sbx-planet" />
    </div>
  );
}

const style = document.createElement('style');
style.textContent = `
.sbx-backdrop { position: absolute; inset: 0; overflow: hidden; background: #000; }
.sbx-stars { position: absolute; inset: 0; background-image:
  radial-gradient(1px 1px at 12% 22%, #fff 60%, transparent), radial-gradient(1px 1px at 33% 71%, #ddd 60%, transparent),
  radial-gradient(1.4px 1.4px at 48% 12%, #fff 60%, transparent), radial-gradient(1px 1px at 81% 35%, #cfe 60%, transparent),
  radial-gradient(1px 1px at 91% 82%, #fff 60%, transparent), radial-gradient(1px 1px at 22% 90%, #fed 60%, transparent),
  radial-gradient(1px 1px at 66% 58%, #fff 60%, transparent), radial-gradient(1.2px 1.2px at 5% 55%, #fff 60%, transparent);
  background-size: 420px 380px; opacity: .8; }
.sbx-bright { position: absolute; border-radius: 50%; filter: blur(40px); }
.sbx-bright--left { left: -6%; top: 6%; width: 46vw; height: 52vh; background: radial-gradient(closest-side, #fff, #fff 45%, rgba(255,240,220,.6) 70%, transparent); }
.sbx-bright--right { right: -4%; top: 30%; width: 22vw; height: 40vh; background: radial-gradient(closest-side, #fff, rgba(255,255,255,.85) 50%, transparent); }
.sbx-planet { position: absolute; left: 60vw; top: 50vh; width: 86vh; height: 86vh; translate: -50% -50%; border-radius: 50%;
  background:
    radial-gradient(circle at 30% 32%, rgba(255,255,255,.18), transparent 38%),
    linear-gradient(115deg, transparent 52%, rgba(0,0,0,.92) 66%),
    repeating-linear-gradient(8deg, #b98d63 0 3.2%, #d9c3a2 3.2% 5.1%, #8f6747 5.1% 6.4%, #e8dcc6 6.4% 9.5%, #a6795a 9.5% 11%),
    #9c7b5c;
  box-shadow: inset -60px -40px 120px rgba(0,0,0,.85); }
`;
document.head.appendChild(style);

const ctx: AppContextValue = { store, commands, registry, manifest: () => manifest };

// ── Initial state from URL ────────────────────────────────────────────────────────────────

store.setState(s => ({ camera: { ...s.camera, focusId: 'sol:earth' }, view: { ...s.view, breadcrumb: crumbsFor('sol:earth'), scaleLog10: Number(params.get('scale') ?? 7.4) } }));
const sel = params.get('select');
if (sel) {
  store.setState(s => ({ selection: { id: sel }, camera: { ...s.camera, focusId: sel }, view: { ...s.view, breadcrumb: crumbsFor(sel) } }));
}
const lab = params.get('lab') as LabId | null;
if (lab) commands.openLab(lab);
if (params.get('tour')) commands.startTour('golden-journey');
const panel = params.get('panel');
if (panel) store.setState(s => ({ ui: { ...s.ui, helpOpen: panel === 'help', sourcesOpen: panel === 'sources', settingsOpen: panel === 'settings', debugOpen: panel === 'debug' } }));
if (params.get('travel')) store.setState(s => ({ camera: { ...s.camera, traveling: true } }));
if (params.get('notice')) pushNotice(store, { kind: 'warning', text: 'Couldn’t load the Gaia star tiles. Showing the bright-star catalogue instead.' });
if (params.get('enlarge')) commands.setOverlay('enlarge-bodies', true);
if (params.get('exhibition')) localStorage.setItem('cosmos.exhibition', 'true');
else localStorage.removeItem('cosmos.exhibition');

createRoot(document.getElementById('cosmos-root')!).render(
  <CosmosApp
    ctx={ctx}
    backdrop={<Backdrop />}
    tourId="golden-journey"
    extensions={{
      tourStep: (_id, step) => TOUR[step] ?? null,
      screenBounds: id => (id ? { x: window.innerWidth * 0.6 - window.innerHeight * 0.43, y: window.innerHeight * 0.07, width: window.innerHeight * 0.86, height: window.innerHeight * 0.86 } : null),
      cameraDistanceM: id => (id === store.getState().camera.focusId ? store.getState().view.focusDistanceM : null),
      perf: () => ({ fps: 60, cpuFrameMs: 4.2, gpuFrameMs: 7.9, worstFrameMs: 12.1, drawCalls: 212, triangles: 1_482_000, points: 120_000, lines: 40, textures: 38, geometries: 61, jsHeapMB: 184, longTasks: 0, pixelRatio: 1.5, renderScale: 1 }),
    }}
  />,
);
