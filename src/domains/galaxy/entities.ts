/**
 * Galaxy-domain entities: the Milky Way ('mw:galaxy'), Sagittarius A* ('mw:sgr-a*'), the S-star cluster and the 40 S-stars
 * ('mw:s2', 'mw:s1', …), the bar and the spiral arms ('mw:arm:<key>'), plus a provider for ~250 landmarks (globular
 * clusters, galactic Messier objects, nebulae, open clusters, stellar black holes) at their real 3-D positions.
 */
import type * as THREE from 'three';
import type { Capability, Entity, EntityProvider, SearchRecord } from '../../core/entity';
import { observed, derived, type Fact, type FactSheet, type ProvenanceClass, type SourceRef } from '../../data/provenance';
import { AU_M, C_M_PER_S, KPC_M, LY_M, PC_M } from '../../core/units';
import {
  ARMS, BAR_ANGLE_DEG, BAR_HALF_LENGTH_KPC, EHT_RING_ERR_UAS, EHT_RING_UAS, R0_PC, S2_GRAVITY2020, SGRA_MASS_ERR_MSUN, SGRA_MASS_KG,
  SGRA_MASS_MSUN, SGRA_RS_M, armPointKpc, decimalYear, galKpcToWorld, nextPericentreYr, orbitExtremes, schwarzschildPrecessionRad,
  DEG, type SStarElements, type V3,
} from './model';
import { DATASET, loadMilkyWay, loadSgra, toQuantity, type MilkyWayJson, type RawQuantity } from './data';
import { galaxyRuntime, type GalaxyRuntime, type LandmarkRecord } from './runtime';

export const GALAXY_IDS = {
  galaxy: 'mw:galaxy',
  sgrA: 'mw:sgr-a*',
  sCluster: 'mw:s-stars',
  bar: 'mw:bar',
  nsc: 'mw:nuclear-star-cluster',
} as const;

export const sStarEntityId = (id: string): string => `mw:${id.toLowerCase()}`;
export const armEntityId = (key: string): string => `mw:arm:${key}`;

const SRC_MW: SourceRef = { datasetId: DATASET.milkyway };
const SRC_SG: SourceRef = { datasetId: DATASET.sgra };
const SRC_LM: SourceRef = { datasetId: DATASET.landmarks };
const SRC_MS: SourceRef = { datasetId: DATASET.messier };
const MODEL = 'galaxy-model@1';

const fact = (key: string, label: string, q: Fact['quantity'], help?: string, provenance: ProvenanceClass = q?.provenance ?? 'observed'): Fact => ({ key, label, quantity: q, provenance, source: q?.source, help });
const textFact = (key: string, label: string, text: string, provenance: ProvenanceClass, source?: SourceRef, help?: string): Fact => ({ key, label, text, provenance, source, help });

function sheet(id: string, summary: string, sections: FactSheet['sections'], representation: FactSheet['representation'], sources: SourceRef[], extra?: Partial<FactSheet>): FactSheet {
  return { entityId: id, summary, sections, representation, sources, ...extra };
}

const fixedPosition = (w: V3) => (_t: number, out: THREE.Vector3): THREE.Vector3 => out.set(w.x, w.y, w.z);
const FOCUS: Capability[] = ['focus', 'orbit', 'travel', 'sources', 'bookmark'];

// ── Milky Way ─────────────────────────────────────────────────────────────────────────────────────────────────────

async function milkyWayFacts(): Promise<FactSheet> {
  const mw = await loadMilkyWay().catch(() => null as MilkyWayJson | null);
  const refs = mw?.references;
  const g = (o: unknown, k: string): RawQuantity | undefined => (o as Record<string, RawQuantity> | undefined)?.[k];
  const q = (raw: RawQuantity | undefined, p: ProvenanceClass = 'observed', unit?: string) => toQuantity(raw, DATASET.milkyway, refs, p, unit);
  const range = (raw: RawQuantity | undefined, fmt: (n: number) => string): string => raw?.range ? `${fmt(raw.range[0])} – ${fmt(raw.range[1])}` : 'Unknown';
  const disk = mw?.disk as Record<string, Record<string, RawQuantity>> | undefined;
  return sheet(GALAXY_IDS.galaxy,
    'Our home galaxy: a barred spiral of a few hundred billion stars, about 100,000 light-years across its bright disc. The Sun orbits 8.3 kiloparsecs (27,000 light-years) from the central black hole, once every ~220 million years.',
    [
      {
        id: 'overview', title: 'Structure', facts: [
          fact('r0', 'Sun – Galactic Centre distance', q(g(mw?.sun, 'galactocentricDistancePc')), 'Geometric distance from the orbit of the star S2 around Sgr A* (GRAVITY 2024).'),
          fact('zsun', 'Sun above the mid-plane', q(g(mw?.sun, 'heightAboveMidplanePc'))),
          fact('vc', 'Circular speed at the Sun', q(g(mw?.sun, 'circularSpeedKmS'))),
          fact('mstar', 'Stellar mass', q(g(mw?.global, 'stellarMassMsun'))),
          fact('mbary', 'Baryonic mass (stars + gas)', q(g(mw?.global, 'baryonicMassMsun'))),
          fact('rvir', 'Virial radius of the dark halo', q(g(mw?.global, 'virialRadiusKpc'))),
          textFact('stars', 'Number of stars', range(g(mw?.global, 'starCountRange'), (n) => `${n / 1e9} billion`), 'illustrative', SRC_MW, 'Order of magnitude only: stellar mass divided by a typical mean stellar mass.'),
          textFact('diam', 'Diameter', `${range(g(mw?.global, 'diameterEstimatesKly'), (n) => `${n}`)} thousand light-years`, 'observed', SRC_MW, '≈100,000 ly for the dense disc; disc stars are found beyond 26–31 kpc from the centre.'),
        ],
      },
      {
        id: 'properties', title: 'Components', facts: [
          fact('bar', 'Bar half-length', q(g(mw?.bar, 'halfLengthKpc'))),
          fact('barAngle', 'Bar angle to the Sun–centre line', q(g(mw?.bar, 'angleToSunGcLineDeg'))),
          fact('barOmega', 'Bar pattern speed', q(g(mw?.bar, 'patternSpeedKmSKpc'))),
          fact('thinL', 'Thin disc scale length', q(disk?.thin?.scaleLengthKpc)),
          fact('thinH', 'Thin disc scale height', q(disk?.thin?.scaleHeightPc)),
          fact('thickH', 'Thick disc scale height', q(disk?.thick?.scaleHeightPc)),
          fact('dustL', 'Dust disc scale length', q(disk?.dust?.scaleLengthKpc)),
        ],
        paragraphs: [
          'Spiral arms follow Reid et al. (2019): logarithmic spirals fitted to 147 maser parallaxes of young massive stars. Each arm is drawn exactly where masers constrain it; the far side of the Galaxy, behind the bulge, is an illustrative extension of the same spirals.',
        ],
      },
    ],
    {
      provenance: 'reconstructed',
      description: 'The Milky Way has never been photographed from outside. This 3-D model is reconstructed from surveys: spiral arms from maser parallaxes (Reid 2019), bar and bulge from red-clump giants (Wegg 2015, Portail 2017), discs and dust from star counts and far-infrared emission. Individual particles are illustrative; the 157 globular clusters and catalogued nebulae are real objects at measured distances.',
    },
    [SRC_MW, SRC_LM],
    {
      assumptions: [
        'Disc light: exponential discs (thin 2.6 kpc × 300 pc, thick 2.0 kpc × 900 pc; Bland-Hawthorn & Gerhard 2016). Bulge/bar: triaxial box/peanut + long bar 5 kpc at 28° (Wegg 2015; Portail 2017).',
        'Arm brightness contrasts, star-forming knots and colours are illustrative (physically motivated: old stars yellow, young stars blue, ionised hydrogen pink).',
        'Dust: exponential disc of scale length 2.26 kpc and sech² height 134 pc (Drimmel & Spergel 2001), concentrated on the inner edges of the arms.',
      ],
      missing: ['Exact arm shapes beyond the solar circle and on the far side of the Galaxy', 'Number of spiral arms (two vs four major arms is debated)'],
    });
}

// ── Sgr A* ────────────────────────────────────────────────────────────────────────────────────────────────────────

async function sgrAFacts(): Promise<FactSheet> {
  const sg = await loadSgra().catch(() => null);
  const refs = sg?.references;
  const bh = sg?.blackHole;
  const q = (raw: RawQuantity | undefined, p: ProvenanceClass = 'observed', unit?: string) => toQuantity(raw, DATASET.sgra, refs, p, unit);
  const rsKm = SGRA_RS_M / 1000;
  return sheet(GALAXY_IDS.sgrA,
    'Sagittarius A* is the 4.3-million-solar-mass black hole at the centre of the Milky Way. Its mass is weighed by stars racing around it on 16-year orbits; in 2022 the Event Horizon Telescope published the first image of the glowing ring around its shadow.',
    [
      {
        id: 'overview', title: 'Black hole', facts: [
          fact('mass', 'Mass', bh ? q(bh.mass.adopted) : observed(SGRA_MASS_MSUN, 'M_sun', SRC_SG, { kind: 'symmetric', sigma: SGRA_MASS_ERR_MSUN }), 'From the orbits of S2, S29, S38 and S55 (GRAVITY 2024).'),
          fact('dist', 'Distance', bh ? q(bh.distanceR0.adopted) : observed(R0_PC, 'pc', SRC_SG)),
          fact('rs', 'Schwarzschild radius (event horizon)', derived(rsKm, 'km', 'schwarzschild@1', SRC_SG), `r_s = 2GM/c² ≈ ${(SGRA_RS_M / AU_M).toFixed(3)} AU — about 18 times the Sun's radius.`),
          fact('shadow', 'Shadow diameter', derived(2 * Math.sqrt(27) / 2 * rsKm, 'km', 'schwarzschild@1', SRC_SG), 'A non-rotating black hole casts a shadow √27 GM/c² in radius (≈ 5.2 r_s across).'),
          fact('shadowAng', 'Predicted shadow diameter on the sky', bh ? q(bh.derived.angularShadowDiameterMicroArcsec, 'derived') : derived(53.3, 'µas', 'schwarzschild@1', SRC_SG)),
          fact('ring', 'EHT ring diameter (2017 data)', bh ? q(bh.ehtRing.diameterMicroArcsec as RawQuantity) : observed(EHT_RING_UAS, 'µas', SRC_SG, { kind: 'symmetric', sigma: EHT_RING_ERR_UAS }), 'Event Horizon Telescope Collaboration 2022, ApJL 930, L12: the bright ring of lensed emission around the shadow, observed at 1.3 mm.'),
          textFact('spin', 'Spin', 'Unknown (not measured)', 'observed', SRC_SG, 'EHT models disfavour edge-on and most retrograde configurations, but no spin value is measured. The accretion flow drawn here is illustrative.'),
        ],
      },
      {
        id: 'science', title: 'What you are seeing', facts: [],
        paragraphs: [
          'The black hole is drawn with a ray-traced Schwarzschild lens: each pixel follows a bent light ray, so background stars are distorted into arcs, a thin photon ring circles the shadow, and the far side of the accretion flow appears above and below the hole.',
          'The glowing accretion flow is illustrative: Sgr A* is fed by a faint, hot, radiatively inefficient flow, seen by the EHT at millimetre wavelengths. Its colour, brightness and inclination here are artistic choices consistent with the EHT preference for a face-on-ish view (inclination < 50°).',
        ],
      },
    ],
    { provenance: 'derived', description: 'Lensing computed from General Relativity (Schwarzschild metric) for the measured mass; the accretion flow and its colours are illustrative.' },
    [SRC_SG],
    { assumptions: ['Non-rotating (Schwarzschild) black hole; real spin unknown.', 'Accretion flow is a thin illustrative disc from the innermost stable orbit (3 r_s) outward.'] });
}

// ── S-stars ───────────────────────────────────────────────────────────────────────────────────────────────────────

function sStarFacts(el: SStarElements): FactSheet {
  const isS2 = el.id === 'S2';
  const r0 = isS2 ? 8246.7 : 8323;
  const mMsun = isS2 ? 4.261e6 : 4.28e6;
  const mKg = mMsun * (SGRA_MASS_KG / SGRA_MASS_MSUN);
  const src: SourceRef = { datasetId: DATASET.sgra, reference: isS2 ? 'GRAVITY Collaboration 2020, A&A 636, L5' : 'Gillessen et al. 2017, ApJ 837, 30' };
  const facts: Fact[] = [
    fact('a', 'Semi-major axis (angular)', observed(el.aMas, 'mas', src)),
    fact('e', 'Eccentricity', observed(el.e, '', src)),
    fact('i', 'Inclination', observed(el.iDeg, 'deg', src)),
    fact('P', 'Orbital period', observed(el.periodYr, 'yr', src)),
    fact('tp', 'Pericentre passage', observed(el.tPeriYr, 'yr', src), 'Decimal year.'),
  ];
  const assumptions = [`Distance R0 = ${r0} pc and mass ${mMsun.toExponential(3)} M_sun as assumed by the fit.`];
  if (el.periodYr !== null && el.e < 1) {
    const x = orbitExtremes(el.aMas, el.e, r0, mKg);
    facts.push(
      fact('peri', 'Closest approach', derived(x.periAu, 'AU', 'kepler@1', src), `${(x.periAu / (SGRA_RS_M / AU_M)).toFixed(0)} Schwarzschild radii.`),
      fact('apo', 'Farthest distance', derived(x.apoAu, 'AU', 'kepler@1', src)),
      fact('vp', 'Speed at pericentre', derived(x.vPeriKmS, 'km/s', 'kepler@1', src), `${((x.vPeriKmS * 1000) / C_M_PER_S * 100).toFixed(1)} % of the speed of light.`),
      fact('prec', 'GR pericentre advance per orbit', derived(schwarzschildPrecessionRad(x.aM, el.e, mKg) / DEG * 60, 'arcmin', 'schwarzschild@1', src)),
    );
    const next = nextPericentreYr(el, decimalYear(Date.now()));
    if (next !== null) facts.push(fact('next', 'Next pericentre', derived(next, 'yr', 'kepler@1', src)));
  }
  if (isS2) facts.push(fact('fsp', 'Measured precession / GR prediction', observed(1.1, '', src, { kind: 'symmetric', sigma: 0.19 }), 'GRAVITY 2020 detected the Schwarzschild precession of S2: f_SP = 1.10 ± 0.19 (1 = General Relativity, 0 = Newton).'));
  return sheet(sStarEntityId(el.id),
    isS2
      ? 'S2 is a hot young B-type star on a 16-year orbit around Sgr A*. At its closest approach (May 2018, next in 2034) it passes 120 AU from the black hole at 7,700 km/s. Its orbit revealed the gravitational redshift (2018) and the Schwarzschild precession (2020) predicted by General Relativity.'
      : `${el.id} is one of the "S-stars" orbiting Sagittarius A*, followed by the VLT and Keck since the 1990s.`,
    [{ id: 'orbit', title: 'Orbit', facts }],
    { provenance: 'observed', description: 'Position computed from the published Keplerian orbit (observed elements); the star is drawn as a point of light.' },
    [SRC_SG],
    { assumptions, epoch: { label: `Elements: ${isS2 ? 'GRAVITY 2020' : 'Gillessen et al. 2017'}` } });
}

export function createSStarEntity(rt: GalaxyRuntime, el: SStarElements): Entity {
  const isS2 = el.id === 'S2';
  return {
    id: sStarEntityId(el.id),
    name: el.id,
    aliases: isS2 ? ['S0-2', 'S2 star', 'S-02'] : [],
    kind: 'star',
    domain: 'galaxy',
    parentId: GALAXY_IDS.sgrA,
    radiusM: null,
    viewDistance: { min: 5 * AU_M, default: 400 * AU_M, max: 1e16 },
    tagline: isS2 ? 'Star on a 16-year orbit around the Milky Way\'s black hole' : 'Star orbiting Sagittarius A*',
    capabilities: [...FOCUS, 'follow', 'show-orbit', 'experiment:relativity'],
    importance: isS2 ? 60 : 25,
    representation: 'observed',
    position: (t, out) => { rt.sStarWorld(el, t, out); return out; },
    facts: () => sStarFacts(el),
  };
}

// ── Landmarks ─────────────────────────────────────────────────────────────────────────────────────────────────────

function landmarkFacts(l: LandmarkRecord): FactSheet {
  const lm = l.landmark, ms = l.messier;
  const distSrc: SourceRef = { datasetId: lm ? DATASET.landmarks : DATASET.messier, reference: (lm?.distRef ?? ms?.distRef) ?? undefined, note: (lm?.distMethod ?? ms?.distMethod) ?? undefined };
  const dErr = lm ?? ms;
  const unc = dErr && dErr.distErrMinusPc !== null && dErr.distErrPlusPc !== null && dErr.distErrMinusPc !== dErr.distErrPlusPc
    ? { kind: 'asymmetric' as const, plus: dErr.distErrPlusPc, minus: dErr.distErrMinusPc }
    : dErr?.distErrPc != null ? { kind: 'symmetric' as const, sigma: dErr.distErrPc } : undefined;
  const facts: Fact[] = [
    fact('dist', 'Distance from the Sun', observed(l.distPc, 'pc', distSrc, unc)),
    fact('distLy', 'Distance (light-years)', derived(l.distPc * PC_M / LY_M, 'ly', 'unit-conversion@1', distSrc)),
    fact('rgc', 'Distance from the Galactic Centre', derived(Math.hypot(l.gal.x, l.gal.y, l.gal.z), 'kpc', MODEL, SRC_MW)),
    fact('zgal', 'Height above the Galactic plane', derived(l.gal.z * 1000, 'pc', MODEL, SRC_MW)),
  ];
  if (lm?.sizePc != null) facts.push(fact('size', 'Size', observed(lm.sizePc, 'pc', SRC_LM)));
  if (lm?.massMsun != null) facts.push(fact('mass', 'Mass', observed(lm.massMsun, 'M_sun', SRC_LM)));
  if (lm?.metallicityFeH != null) facts.push(fact('feh', 'Metallicity [Fe/H]', observed(lm.metallicityFeH, '', { datasetId: DATASET.landmarks, reference: 'Harris 1996 (2010 edition)' }), 'Iron abundance relative to the Sun on a log scale: −1 means one tenth of the Sun\'s iron.'));
  if (ms) {
    if (ms.apparentMag != null) facts.push(fact('mag', `Apparent magnitude (${ms.apparentMagBand ?? 'V'})`, observed(ms.apparentMag, '', { datasetId: DATASET.messier, reference: ms.apparentMagSource ?? undefined })));
    if (ms.constellation) facts.push(textFact('const', 'Constellation', ms.constellation, 'observed', SRC_MS));
    if (ms.ngcIc.length) facts.push(textFact('ngc', 'Catalogue', ms.ngcIc.join(', '), 'observed', SRC_MS));
  }
  const gc = l.type === 'globular-cluster';
  const summary = lm?.summary
    ?? `${l.name} is a ${l.type.replace(/-/g, ' ')} in ${ms?.constellation ?? 'the Milky Way'}, ${Math.round(l.distPc * PC_M / LY_M).toLocaleString('en-US')} light-years away.`;
  return sheet(l.id, summary,
    [{ id: 'properties', title: 'Properties', facts }],
    {
      provenance: gc ? 'reconstructed' : 'observed',
      description: gc
        ? 'Position and distance are measured; the swarm of stars drawn around it is an illustrative Plummer-profile sample, not a star catalogue.'
        : 'Marker at the catalogued position and distance; the object itself is too small to resolve at galactic scale.',
    },
    [lm ? SRC_LM : SRC_MS, ...(lm && ms ? [SRC_MS] : [])]);
}

function landmarkViewDistance(l: LandmarkRecord): Entity['viewDistance'] {
  const size = l.landmark?.sizePc ?? (l.type === 'globular-cluster' ? 25 : l.type === 'open-cluster' ? 8 : l.type === 'black-hole' || l.type === 'pulsar' ? 2 : 15);
  return { min: 0.2 * PC_M, default: Math.max(3, size * 3) * PC_M, max: 50 * KPC_M };
}

export function createLandmarkEntity(l: LandmarkRecord): Entity {
  return {
    id: l.id,
    name: l.name,
    aliases: l.aliases,
    kind: l.kind,
    domain: 'galaxy',
    parentId: GALAXY_IDS.galaxy,
    radiusM: l.landmark?.sizePc != null ? (l.landmark.sizePc / 2) * PC_M : null,
    viewDistance: landmarkViewDistance(l),
    tagline: `${l.type.replace(/-/g, ' ')} · ${Math.round(l.distPc * PC_M / LY_M).toLocaleString('en-US')} ly`,
    capabilities: FOCUS,
    importance: l.importance,
    representation: l.type === 'globular-cluster' ? 'reconstructed' : 'observed',
    position: fixedPosition(l.world),
    facts: () => landmarkFacts(l),
  };
}

export function createLandmarkProvider(rt: GalaxyRuntime): EntityProvider {
  const cache = new Map<string, Entity>();
  let records: SearchRecord[] | null = null;
  return {
    domain: 'galaxy',
    resolve(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const l = rt.byId.get(id);
      if (!l) return undefined;
      const e = createLandmarkEntity(l);
      cache.set(id, e);
      return e;
    },
    searchRecords() {
      if (!records) records = rt.landmarks.map((l) => ({ id: l.id, name: l.name, aliases: l.aliases, kind: l.kind, domain: 'galaxy' as const, importance: l.importance, tagline: `${l.type.replace(/-/g, ' ')}` }));
      return records;
    },
    resolveIdentifier(query) {
      const q = query.trim().toLowerCase().replace(/\s+/g, ' ');
      const m = /^m ?(\d{1,3})$/.exec(q);
      if (m) { const id = `mw:m${Number(m[1])}`; return rt.byId.has(id) ? [id] : []; }
      const out: string[] = [];
      for (const l of rt.landmarks) if (l.aliases.some((a) => a.toLowerCase().replace(/\s+/g, ' ') === q)) out.push(l.id);
      return out;
    },
  };
}

// ── Hero entities ─────────────────────────────────────────────────────────────────────────────────────────────────

export function createGalaxyEntities(rt: GalaxyRuntime = galaxyRuntime()): Entity[] {
  const f = rt.frame;
  const origin = fixedPosition(f.origin);
  const galaxy: Entity = {
    id: GALAXY_IDS.galaxy,
    name: 'Milky Way',
    aliases: ['Milky Way Galaxy', 'the Galaxy', 'our galaxy', 'Via Lactea', 'galaxy'],
    kind: 'galaxy',
    domain: 'galaxy',
    parentId: 'struct:local-group',
    // Extended structures: radiusM null (not a solid disc - the label occluder would hide everything inside); framingRadiusM frames them.
    radiusM: null,
    framingRadiusM: 17 * KPC_M,
    viewDistance: { min: 1 * KPC_M, default: 62 * KPC_M, max: 3000 * KPC_M },
    contextScaleMin: 20.6,
    tagline: 'Our home galaxy: a barred spiral 100,000 light-years across',
    capabilities: FOCUS,
    importance: 95,
    representation: 'reconstructed',
    position: origin,
    facts: milkyWayFacts,
  };
  const sgrA: Entity = {
    id: GALAXY_IDS.sgrA,
    name: 'Sagittarius A*',
    aliases: ['Sgr A*', 'SgrA*', 'Sgr A star', 'Milky Way black hole', 'supermassive black hole', 'black hole', 'Galactic Centre', 'Galactic Center'],
    kind: 'black-hole',
    domain: 'blackhole',
    parentId: GALAXY_IDS.sCluster,
    radiusM: SGRA_RS_M,
    framingRadiusM: 7 * SGRA_RS_M,
    viewDistance: { min: 4 * SGRA_RS_M, default: 34 * SGRA_RS_M, max: 0.5 * PC_M },
    contextScaleMin: 12.5,
    tagline: 'The 4.3-million-solar-mass black hole at the heart of the Milky Way',
    capabilities: [...FOCUS, 'experiment:relativity'],
    importance: 92,
    representation: 'derived',
    position: origin,
    facts: sgrAFacts,
  };
  const s2orbit = orbitExtremes(S2_GRAVITY2020.aMas, S2_GRAVITY2020.e, R0_PC, SGRA_MASS_KG);
  const sCluster: Entity = {
    id: GALAXY_IDS.sCluster,
    name: 'S-star cluster',
    aliases: ['S-stars', 'S stars', 'S-cluster', 'Galactic Centre stars', 'S2 orbit'],
    kind: 'star-cluster',
    domain: 'galaxy',
    parentId: GALAXY_IDS.galaxy,
    radiusM: null,
    framingRadiusM: s2orbit.aM * 2.2,
    viewDistance: { min: 50 * AU_M, default: s2orbit.aM * 5.5, max: 20 * PC_M },
    contextScaleMin: 16.5,
    tagline: 'Stars on real orbits around Sagittarius A*',
    capabilities: [...FOCUS, 'experiment:relativity'],
    importance: 70,
    representation: 'observed',
    position: origin,
    facts: () => sheet(GALAXY_IDS.sCluster,
      'Within a light-month of Sagittarius A*, dozens of stars whirl around the black hole on elliptical orbits. Tracking them for 30 years (Genzel and Ghez, Nobel Prize 2020) proved a compact 4.3-million-solar-mass object sits at the centre.',
      [{ id: 'overview', title: 'Orbits', facts: [
        fact('n', 'Stars with orbits drawn', observed(rt.sStars.length, '', SRC_SG)),
        fact('s2a', 'S2 semi-major axis', derived(s2orbit.aM / AU_M, 'AU', 'kepler@1', SRC_SG)),
      ], paragraphs: ['Orbits are the published Keplerian fits (Gillessen et al. 2017; S2 from GRAVITY 2020). Speed up time to watch S2 swing past the black hole every 16 years.'] }],
      { provenance: 'observed', description: 'Orbits from published orbital elements; stars drawn as points.' }, [SRC_SG]),
  };
  const nsc: Entity = {
    id: GALAXY_IDS.nsc,
    name: 'Nuclear star cluster',
    aliases: ['NSC', 'Milky Way nuclear cluster'],
    kind: 'star-cluster',
    domain: 'galaxy',
    parentId: GALAXY_IDS.galaxy,
    radiusM: null,
    framingRadiusM: 4.2 * PC_M,
    viewDistance: { min: 0.05 * PC_M, default: 22 * PC_M, max: 2 * KPC_M },
    contextScaleMin: 17.8,
    tagline: 'The densest star cluster in the Galaxy, around Sgr A*',
    capabilities: FOCUS,
    importance: 45,
    representation: 'illustrative',
    position: origin,
    facts: () => sheet(GALAXY_IDS.nsc,
      'About 18 million solar masses of stars packed within a few parsecs of Sgr A*: the densest stellar system in the Milky Way.',
      [{ id: 'properties', title: 'Properties', facts: [
        fact('mass', 'Mass', observed(1.8e7, 'M_sun', { ...SRC_MW, reference: 'Bland-Hawthorn & Gerhard 2016' }, { kind: 'symmetric', sigma: 3e6 })),
        fact('rh', 'Half-light radius', observed(4.2, 'pc', { ...SRC_MW, reference: 'Bland-Hawthorn & Gerhard 2016' }, { kind: 'symmetric', sigma: 0.4 })),
      ] }],
      { provenance: 'illustrative', description: 'Individual stars are an illustrative sample with the measured size; their positions are not catalogued.' }, [SRC_MW]),
  };
  const barMid = galKpcToWorld(f, 0, 0, 0, { x: 0, y: 0, z: 0 });
  const bar: Entity = {
    id: GALAXY_IDS.bar,
    name: 'Galactic bar',
    aliases: ['bar', 'bulge', 'Galactic bulge', 'box/peanut bulge', 'long bar'],
    kind: 'region',
    domain: 'galaxy',
    parentId: GALAXY_IDS.galaxy,
    radiusM: null,
    framingRadiusM: BAR_HALF_LENGTH_KPC * KPC_M,
    viewDistance: { min: 1 * KPC_M, default: 22 * KPC_M, max: 200 * KPC_M },
    contextScaleMin: 20.5,
    tagline: 'A 10-kpc bar of old stars across the Galaxy\'s centre',
    capabilities: FOCUS,
    importance: 50,
    representation: 'reconstructed',
    position: fixedPosition(barMid),
    facts: () => sheet(GALAXY_IDS.bar,
      `The Milky Way is a barred spiral: a box/peanut-shaped bulge and a long bar of old stars, ${BAR_HALF_LENGTH_KPC} kpc in half-length, tilted about ${BAR_ANGLE_DEG}° to our line of sight to the centre, with its near end at positive Galactic longitude.`,
      [{ id: 'properties', title: 'Properties', facts: [
        fact('hl', 'Half-length', observed(BAR_HALF_LENGTH_KPC, 'kpc', { ...SRC_MW, reference: 'Wegg et al. 2015' }, { kind: 'symmetric', sigma: 0.2 })),
        fact('ang', 'Angle to the Sun–centre line', observed(BAR_ANGLE_DEG, 'deg', { ...SRC_MW, reference: 'Portail et al. 2017' })),
        fact('ps', 'Pattern speed', observed(39, 'km/s/kpc', { ...SRC_MW, reference: 'Portail et al. 2017' }, { kind: 'symmetric', sigma: 3.5 })),
      ] }],
      { provenance: 'reconstructed', description: 'Shape reconstructed from red-clump giant star counts (VVV, UKIDSS, 2MASS).' }, [SRC_MW]),
  };
  const arms: Entity[] = ARMS.map((a) => {
    const mid = (a.betaMinDeg + a.betaMaxDeg) / 2 * DEG;
    const p = armPointKpc(a, mid, { x: 0, y: 0, z: 0 });
    const w = galKpcToWorld(f, p.x, p.y, 0, { x: 0, y: 0, z: 0 });
    return {
      id: armEntityId(a.key),
      name: a.name,
      aliases: [a.reidLabel, `${a.reidLabel} arm`],
      kind: 'region',
      domain: 'galaxy',
      parentId: GALAXY_IDS.galaxy,
      radiusM: null,
      framingRadiusM: 3 * KPC_M,
      viewDistance: { min: 0.5 * KPC_M, default: 12 * KPC_M, max: 200 * KPC_M },
      contextScaleMin: 20.5,
      tagline: a.major ? 'Major spiral arm of the Milky Way' : 'Spiral arm of the Milky Way',
      capabilities: FOCUS,
      importance: a.key === 'local' ? 55 : a.major ? 50 : 42,
      representation: 'reconstructed',
      position: fixedPosition(w),
      facts: () => sheet(armEntityId(a.key),
        `${a.name}: traced by ${a.nMasers} masers in star-forming regions whose distances were measured by trigonometric parallax (Reid et al. 2019).${a.key === 'local' ? ' The Sun lies on the inner edge of this short arm, also called the Orion Spur.' : ''}`,
        [{ id: 'properties', title: 'Fit (Reid et al. 2019, Table 2)', facts: [
          fact('n', 'Masers in the fit', observed(a.nMasers, '', SRC_MW)),
          fact('rk', 'Radius at the kink', observed(a.rKinkKpc, 'kpc', SRC_MW)),
          fact('pi', 'Pitch angle (inner part)', observed(a.pitchInDeg, 'deg', SRC_MW)),
          fact('po', 'Pitch angle (outer part)', observed(a.pitchOutDeg, 'deg', SRC_MW)),
          fact('w', 'Width (1σ)', observed(a.widthKpc, 'kpc', SRC_MW)),
          textFact('range', 'Constrained azimuth range', `${a.betaMinDeg}° to ${a.betaMaxDeg}° (Galactocentric)`, 'observed', SRC_MW, 'Outside this range the arm is an illustrative extension of the same log-spiral.'),
        ] }],
        { provenance: 'reconstructed', description: 'Arm centre line from the published log-spiral fit; brightness, colours and the far-side extension are illustrative.' }, [SRC_MW]),
    } satisfies Entity;
  });
  return [galaxy, sgrA, sCluster, nsc, bar, ...arms];
}

export function createSStarProvider(rt: GalaxyRuntime): EntityProvider {
  const cache = new Map<string, Entity>();
  return {
    domain: 'galaxy',
    resolve(id) {
      const hit = cache.get(id);
      if (hit) return hit;
      const el = rt.sStars.find((s) => sStarEntityId(s.id) === id);
      if (!el || el.periodYr === null) return undefined;
      const e = createSStarEntity(rt, el);
      cache.set(id, e);
      return e;
    },
    searchRecords() {
      return rt.sStars.filter((s) => s.periodYr !== null).map((s) => ({ id: sStarEntityId(s.id), name: s.id, aliases: s.id === 'S2' ? ['S0-2'] : [], kind: 'star' as const, domain: 'galaxy' as const, importance: s.id === 'S2' ? 60 : 22, tagline: 'Star orbiting Sagittarius A*' }));
    },
    resolveIdentifier(query) {
      const q = query.trim().toUpperCase().replace(/\s+/g, '');
      if (q === 'S0-2') return [sStarEntityId('S2')];
      return rt.sStars.some((s) => s.id.toUpperCase() === q) ? [sStarEntityId(q)] : [];
    },
  };
}
