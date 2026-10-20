/**
 * Black-hole entities ('bh:<id>') and their companion stars ('bh:<id>:companion'), with fact sheets built from the cited
 * catalogue. Positions: fixed ICRS barycentres plus the binary orbit; supermassive holes sit on their host galaxy's
 * entity (gal:m31, gal:m87) when the galaxies domain is loaded.
 */
import * as THREE from 'three';
import type { Capability, Entity, EntityKind, EntityProvider, EntityRegistry, SearchRecord } from '../../core/entity';
import { derived, observed, type Fact, type FactSheet, type ProvenanceClass, type Quantity, type SourceRef, type Uncertainty } from '../../data/provenance';
import {
  C, PC_M, discPeakTemperatureK, iscoRadiusM, radiativeEfficiency, shadowDiameterMicroarcsec, spaghettificationRadiusM,
  staticTimeRate, horizonRadiusM, R_SUN_M, AU_M,
} from '../../render/blackhole/physics';
import { binaryPositions, companionId, DATASET_ID, type BlackHoleCatalogue, type BlackHoleModel, type RawQ } from './catalog';

const FOCUS: Capability[] = ['focus', 'orbit', 'travel', 'sources', 'bookmark', 'experiment:relativity'];

export const BLACKHOLE_SECTION_ORDER = ['cygnus-x1', 'gaia-bh1', 'gaia-bh3', 'gaia-bh2', 'v404-cygni', 'a0620-00', 'grs1915', 'gro-j1655', 'xte-j1118', 'maxi-j1820', 'm31', 'm87', 'gw150914'];

const CLASS_TEXT: Record<string, string> = {
  'stellar-xrb': 'Stellar-mass black hole in an X-ray binary',
  'stellar-dormant': 'Dormant stellar-mass black hole',
  supermassive: 'Supermassive black hole',
  merger: 'Black-hole merger (gravitational waves)',
};

const STATE_TEXT: Record<string, string> = {
  persistent: 'Actively feeding: a bright X-ray source all the time',
  'transient-quiescent': 'Quiet now; flares up in X-ray outbursts every few decades',
  dormant: 'Dormant: not feeding, found only from the orbit of its companion star',
  agn: 'Active galactic nucleus',
  'low-luminosity-agn': 'Feeding slowly (a low-luminosity active nucleus)',
  merged: 'Two black holes that merged; seen only in gravitational waves',
};

function unc(q: RawQ | null | undefined): Uncertainty | undefined {
  if (!q || q.value == null) return undefined;
  const m = q.errMinus, p = q.errPlus;
  if (m != null && p != null) return m === p ? { kind: 'symmetric', sigma: m } : { kind: 'asymmetric', plus: p, minus: m };
  return undefined;
}

export interface CatalogueContext {
  cat: BlackHoleCatalogue;
  refSource(ref: string | null | undefined, note?: string): SourceRef;
}

export function makeContext(cat: BlackHoleCatalogue): CatalogueContext {
  return {
    cat,
    refSource(ref, note) {
      const r = ref ? cat.references[ref] : undefined;
      return { datasetId: DATASET_ID, reference: r ? r.citation : ref ?? undefined, note };
    },
  };
}

function q(ctx: CatalogueContext, raw: RawQ | null | undefined, unit: string, scale = 1): Quantity {
  const u = unc(raw);
  const scaled: Uncertainty | undefined = u && scale !== 1
    ? (u.kind === 'symmetric' ? { kind: 'symmetric', sigma: u.sigma * scale } : u.kind === 'asymmetric' ? { kind: 'asymmetric', plus: u.plus * scale, minus: u.minus * scale } : u)
    : u;
  return observed(raw?.value != null ? raw.value * scale : null, unit, raw?.ref ? ctx.refSource(raw.ref) : undefined, scaled);
}

const fact = (key: string, label: string, quantity: Quantity, help?: string): Fact => ({ key, label, quantity, provenance: quantity.provenance, source: quantity.source, help });
const text = (key: string, label: string, t: string, provenance: ProvenanceClass, source?: SourceRef, help?: string): Fact => ({ key, label, text: t, provenance, source, help });

function blackHoleFacts(m: BlackHoleModel, ctx: CatalogueContext): FactSheet {
  const r = m.raw;
  const src = (ref: string | null | undefined): SourceRef => ctx.refSource(ref);
  const refs = new Set<string>();
  const walk = (o: unknown): void => {
    if (!o || typeof o !== 'object') return;
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if ((k === 'ref' || k.endsWith('Ref')) && typeof v === 'string' && ctx.cat.references[v]) refs.add(v);
      else if (typeof v === 'object') walk(v);
    }
  };
  walk(r);

  const props: Fact[] = [];
  props.push(fact('mass', 'Mass', q(ctx, r.massMsun, 'M_sun'), 'How much matter the black hole contains, in Suns.'));
  props.push(fact('distance', 'Distance from the Sun', q(ctx, r.distancePc, 'pc', 1), r.positionIllustrative ? 'Luminosity distance from the gravitational-wave signal; the direction on the sky is only roughly known.' : undefined));
  const rsKm = m.rsM / 1000;
  props.push(fact('rs', 'Event-horizon radius (non-spinning)', derived(m.rsM, 'm', 'schwarzschild-radius@1'), `The Schwarzschild radius 2GM/c²: about ${rsKm < 1e4 ? `${rsKm.toFixed(rsKm < 100 ? 1 : 0)} km` : 'a few times the size of the Solar System'}. Nothing, not even light, escapes from inside it.`));
  if (r.spin && (r.spin.value != null || r.spin.lowerLimit != null)) {
    const sq: Quantity = r.spin.value != null
      ? q(ctx, r.spin, '')
      : { value: r.spin.lowerLimit, unit: '', provenance: 'observed', uncertainty: { kind: 'limit', type: 'lower' }, source: src(r.spin.ref) };
    props.push(fact('spin', 'Spin a*', sq, `How fast it rotates, from 0 (not at all) to 1 (the maximum General Relativity allows).${r.spin.note ? ' ' + r.spin.note : ''}`));
  } else props.push(fact('spin', 'Spin a*', observed(null, ''), m.spinShown === 'illustrative' ? 'Not measured. The view uses a* = 0.9 (illustrative), typical of the spinning models the EHT favours.' : 'Not measured.'));
  const isco = (iscoRadiusM(m.spin) * m.rsM) / 2;
  props.push(fact('isco', 'Innermost stable orbit (ISCO)', derived(isco, 'm', 'kerr-isco-bpt1972@1'), 'Closer than this, gas cannot orbit and plunges in. A faster spin pulls the ISCO inwards (Bardeen, Press & Teukolsky 1972).'));
  props.push(text('state', 'Activity', STATE_TEXT[r.accretionState] ?? r.accretionState, 'observed', src(r.discovery.ref)));
  if (r.constellation) props.push(text('constellation', 'Constellation', r.constellation, 'observed'));
  if (r.class !== 'merger') {
    props.push(fact('shadow', 'Shadow seen from Earth', derived(shadowDiameterMicroarcsec(m.massMsun, m.distanceM), 'µas', 'schwarzschild-shadow@1'), 'Angular diameter of the black hole\'s shadow (√27 GM/c² across ×2) seen from Earth, in micro-arcseconds. 1 µas is the width of a coin on the Moon.'));
  }

  const sections: FactSheet['sections'] = [
    { id: 'overview', title: 'Overview', facts: [text('class', 'Type', CLASS_TEXT[r.class] ?? r.class, 'observed')], paragraphs: [r.summary, r.discovery.text] },
    { id: 'properties', title: 'Properties', facts: props },
  ];

  if (r.orbit && r.companion) {
    const o = r.orbit, c = r.companion;
    const of: Fact[] = [];
    of.push(text('companion', 'Companion star', `${c.name}${c.spectralType ? ` (${c.spectralType})` : ''}`, 'observed', src(c.ref)));
    of.push(fact('m2', 'Companion mass', q(ctx, c.massMsun, 'M_sun')));
    of.push(m.companion && !m.companion.radiusMeasured
      ? fact('r2', 'Companion radius', derived(m.companion.radiusM / R_SUN_M, 'R_sun', 'roche-lobe-eggleton1983@1'), 'Not measured directly: taken as filling its Roche lobe (Eggleton 1983), as the star must to feed the black hole.')
      : fact('r2', 'Companion radius', q(ctx, c.radiusRsun, 'R_sun')));
    of.push(fact('teff2', 'Companion temperature', q(ctx, c.teffK, 'K')));
    of.push(fact('period', 'Orbital period', q(ctx, o.periodDays, 'd')));
    of.push(fact('sep', 'Separation (semi-major axis)', o.semiMajorAxisAU?.value != null ? q(ctx, o.semiMajorAxisAU, 'AU') : derived(m.binary ? m.binary.aM / AU_M : null, 'AU', 'kepler3@1'), 'Average distance between the star and the black hole.'));
    if (o.eccentricity) of.push(fact('e', 'Eccentricity', q(ctx, o.eccentricity, ''), '0 is a circle; close to 1 a long thin ellipse.'));
    of.push(fact('inc', 'Inclination', q(ctx, o.inclinationDeg, 'deg'), 'Tilt of the orbit to our line of sight (90° = edge-on).'));
    sections.push({
      id: 'orbit', title: 'Orbit and companion', facts: of,
      paragraphs: [m.binary?.nodeMeasured
        ? 'The orbit\'s orientation on the sky and its timing come from Gaia\'s measurement of the star\'s wobble.'
        : 'The orbit\'s tilt to our line of sight is measured; its orientation around the line of sight and the current orbital phase are illustrative.'],
    });
  }

  const sci: Fact[] = [];
  const paras: string[] = [];
  if (r.class === 'stellar-xrb' || r.class === 'supermassive') {
    const edd = r.accretionState === 'persistent' ? 0.02 : r.class === 'supermassive' ? 1e-5 : 1e-6;
    const tPeak = discPeakTemperatureK(m.massMsun, edd, m.spin);
    sci.push({ ...fact('tdisc', 'Inner disc temperature (model)', { ...derived(tPeak, 'K', 'shakura-sunyaev-novikov-thorne@1'), sigDigits: 1 }, `Thin-disc model for gas falling in at ${edd * 100 >= 1 ? `${edd * 100}%` : `${edd.toExponential(0)} ×`} of the Eddington rate. Hotter discs glow in X-rays; the colours in the view are mapped into visible light.`) });
    sci.push(fact('eff', 'Energy released by infalling gas', derived(radiativeEfficiency(m.spin) * 100, '%', 'thin-disc-efficiency@1'), 'Fraction of the infalling mass turned into light before it crosses the ISCO (nuclear fusion manages 0.7%).'));
  }
  const tidal = spaghettificationRadiusM(m.massMsun);
  const hz = (horizonRadiusM(m.spin) * m.rsM) / 2;
  sci.push(fact('spag', 'Spaghettification distance', derived(tidal, 'm', 'newtonian-tidal@1'), tidal > hz ? 'Where a 2 m person would be stretched by 10 g between head and feet. For stellar-mass black holes this happens long before the horizon.' : 'Here the tidal stretch at the horizon is gentle: a person would cross the horizon of this giant black hole without being torn apart.'));
  const rate3 = staticTimeRate(1.5);
  sci.push(fact('clock', 'Clock rate hovering at 1.5 r_s', derived(rate3, '', 'schwarzschild-static-clock@1'), `A clock held at the photon-sphere distance ticks at ${(rate3 * 100).toFixed(0)}% of the rate far away.`));
  const ex = r.extra ?? {};
  if (r.id === 'm87') {
    sci.push(fact('ring', 'EHT ring diameter (2017 image)', observed(ex.ringDiameterUas as number ?? null, 'µas', src('ehtI'), ex.ringDiameterErrUas != null ? { kind: 'symmetric', sigma: ex.ringDiameterErrUas as number } : undefined), 'Measured by the Event Horizon Telescope in 2017 (published 2019): the first image of a black hole.'));
    paras.push('The bright ring is light bent around the black hole by its gravity; the dark centre is its shadow. The bottom (south) is brighter because gas there moves towards us at a large fraction of the speed of light (Doppler beaming). The jet shoots out 5,000 light-years at nearly the speed of light.');
  }
  if (r.id === 'gw150914') {
    const er = ex as Record<string, number>;
    sci.push(fact('m1', 'Black hole 1 (before)', observed(er.primaryMsun ?? null, 'M_sun', src('abbott2016'), { kind: 'asymmetric', plus: er.primaryErrPlus, minus: er.primaryErrMinus })));
    sci.push(fact('m2', 'Black hole 2 (before)', observed(er.secondaryMsun ?? null, 'M_sun', src('abbott2016'), { kind: 'asymmetric', plus: er.secondaryErrPlus, minus: er.secondaryErrMinus })));
    sci.push(fact('mrad', 'Energy radiated as gravitational waves', observed(er.radiatedMsun ?? null, 'M_sun', src('abbott2016'), { kind: 'symmetric', sigma: er.radiatedErr }), 'Three Suns\' worth of mass turned into ripples of spacetime in a fifth of a second: for an instant more power than all the stars in the visible Universe.'));
    sci.push(fact('fspin', 'Final spin', observed(er.finalSpin ?? null, '', src('abbott2016'))));
    paras.push('On 14 September 2015 the two LIGO detectors felt spacetime stretch and squeeze by less than a thousandth of a proton\'s width: the last fraction of a second of two black holes spiralling together 1.3 billion light-years away. It was the first direct detection of gravitational waves, a century after Einstein predicted them.');
  }
  if (r.class === 'stellar-dormant') paras.push('This black hole is not feeding, so it gives off no light at all. Gaia found it from the tiny wobble of its companion star across the sky; up close you would see it only by how it bends the starlight behind it.');
  sections.push({ id: 'science', title: 'Relativity up close', facts: sci, paragraphs: paras.length ? paras : undefined });

  const illus: string[] = [];
  if (m.disc) illus.push('the accretion disc\'s colours, brightness and streaks');
  if (m.jet) illus.push('the jets\' brightness and length');
  if (m.stream) illus.push(m.stream === 'wind' ? 'the stellar-wind stream' : 'the gas stream from the companion');
  if (m.companion && !m.companion.radiusMeasured) illus.push('the companion\'s exact shape');
  return {
    entityId: m.id,
    summary: r.summary,
    sections,
    representation: {
      provenance: 'derived',
      description: `Light bending computed from General Relativity for the measured mass${m.spin ? ` (approximate Kerr for spin ${m.spin.toFixed(2)})` : ' (Schwarzschild)'}${illus.length ? `; ${illus.join(', ')} are illustrative` : ''}.`,
    },
    sources: [...refs].map((k) => ctx.refSource(k)),
    missing: r.spin?.value == null && r.spin?.lowerLimit == null ? ['Spin'] : undefined,
    assumptions: ['Disc temperatures use the Shakura–Sunyaev / Novikov–Thorne thin-disc model with the stated accretion rate.', 'Clock rates are for an observer hovering at rest (Schwarzschild metric).'],
  };
}

function companionFacts(m: BlackHoleModel, ctx: CatalogueContext): FactSheet {
  const c = m.raw.companion!;
  const cm = m.companion!;
  const facts: Fact[] = [
    text('sp', 'Spectral type', c.spectralType ?? 'Unknown', 'observed', ctx.refSource(c.ref)),
    fact('mass', 'Mass', q(ctx, c.massMsun, 'M_sun')),
    cm.radiusMeasured ? fact('radius', 'Radius', q(ctx, c.radiusRsun, 'R_sun')) : fact('radius', 'Radius', derived(cm.radiusM / R_SUN_M, 'R_sun', cm.rocheFill > 0.9 ? 'roche-lobe-eggleton1983@1' : 'mass-radius@1')),
    cm.teffMeasured ? fact('teff', 'Surface temperature', q(ctx, c.teffK, 'K')) : fact('teff', 'Surface temperature', derived(cm.teffK, 'K', 'spectral-type-teff@1')),
  ];
  return {
    entityId: companionId(m.raw),
    summary: `${c.name} is the star orbiting ${m.raw.name}${m.binary ? ` every ${(m.binary.periodSec / 86400).toPrecision(3)} days` : ''}. ${m.stream === 'rlof' ? 'It is stretched into a teardrop by the black hole\'s pull, and gas flows from its tip into the accretion disc.' : m.stream === 'wind' ? 'Its strong stellar wind is focused towards the black hole, which feeds on it.' : 'Its orbit is how astronomers weighed the unseen black hole.'}`,
    sections: [{ id: 'properties', title: 'Properties', facts }],
    representation: { provenance: cm.radiusMeasured ? 'derived' : 'illustrative', description: 'Drawn as a blackbody sphere with limb darkening at the catalogue temperature and radius; tidal distortion is illustrative.' },
    sources: [ctx.refSource(c.ref)],
  };
}

export interface BlackHoleEntities {
  entities: Entity[];
  provider: EntityProvider;
  /** Live black-hole position for a model (the same the layer draws). */
  bhPosition(m: BlackHoleModel, tMs: number, out: THREE.Vector3): THREE.Vector3;
  starPosition(m: BlackHoleModel, tMs: number, out: THREE.Vector3): THREE.Vector3;
}

export function createBlackHoleEntities(models: readonly BlackHoleModel[], ctx: CatalogueContext, registry: EntityRegistry): BlackHoleEntities {
  const scratchBary = new THREE.Vector3();
  const scratchDummy = new THREE.Vector3();
  const bary = (m: BlackHoleModel, tMs: number): THREE.Vector3 => {
    const host = m.raw.hostGalaxyId ? registry.get(m.raw.hostGalaxyId) : undefined;
    if (host) {
      try {
        host.position(tMs, scratchBary);
        if (Number.isFinite(scratchBary.x)) return scratchBary;
      } catch { /* fall through */ }
    }
    return scratchBary.copy(m.bary);
  };
  const bhPosition = (m: BlackHoleModel, tMs: number, out: THREE.Vector3): THREE.Vector3 => {
    binaryPositions(m, bary(m, tMs), tMs, out, null);
    return out;
  };
  const starPosition = (m: BlackHoleModel, tMs: number, out: THREE.Vector3): THREE.Vector3 => {
    binaryPositions(m, bary(m, tMs), tMs, scratchDummy, out);
    return out;
  };

  const entities: Entity[] = [];
  const records: SearchRecord[] = [];
  for (const m of models) {
    const r = m.raw;
    const sys = m.binary ? m.binary.aM * (1 + m.binary.e) + (m.companion?.radiusM ?? 0) : 0;
    const discR = m.disc ? m.disc.outerRs * m.rsM : 0;
    const framing = r.class === 'stellar-dormant' || r.class === 'stellar-xrb' ? Math.max(sys * 0.75, discR) : 14 * m.rsM;
    const parentId = r.hostGalaxyId ?? (r.class === 'merger' ? null : 'mw:galaxy');
    const e: Entity = {
      id: m.id,
      name: r.name,
      aliases: [...r.aliases, 'black hole'],
      kind: 'black-hole',
      domain: 'blackhole',
      parentId,
      radiusM: m.rsM,
      framingRadiusM: framing,
      viewDistance: { min: 2.2 * m.rsM, default: r.class === 'supermassive' ? 34 * m.rsM : framing * 2.6, max: Math.max(framing * 200, 1e4 * m.rsM) },
      approachDir: approachDirection(m),
      contextScaleMin: Math.log10(Math.max(framing, 1e3 * m.rsM) * 40),
      tagline: tagline(m),
      capabilities: r.class === 'merger' ? ['focus', 'travel', 'sources', 'bookmark'] : FOCUS,
      importance: r.id === 'm87' ? 88 : r.id === 'cygnus-x1' ? 80 : r.id.startsWith('gaia-bh') ? 72 : r.class === 'merger' ? 66 : 62,
      representation: 'derived',
      position: (t, out) => bhPosition(m, t, out),
      facts: () => blackHoleFacts(m, ctx),
    };
    entities.push(e);
    if (m.companion) {
      const cm = m.companion;
      entities.push({
        id: companionId(r),
        name: cm.name,
        aliases: [`${r.name} companion`],
        kind: 'star' as EntityKind,
        domain: 'blackhole',
        parentId: m.id,
        radiusM: cm.radiusM,
        viewDistance: { min: cm.radiusM * 1.3, default: cm.radiusM * 6 },
        tagline: `The star orbiting ${r.name}`,
        capabilities: ['focus', 'orbit', 'travel', 'sources'],
        importance: 40,
        representation: cm.radiusMeasured ? 'derived' : 'illustrative',
        position: (t, out) => starPosition(m, t, out),
        facts: () => companionFacts(m, ctx),
      });
    }
    records.push({ id: m.id, name: r.name, aliases: r.aliases, kind: 'black-hole', domain: 'blackhole', importance: e.importance, tagline: e.tagline });
  }
  const byId = new Map(entities.map((e) => [e.id, e]));
  const provider: EntityProvider = {
    domain: 'blackhole',
    resolve: (id) => byId.get(id),
    searchRecords: () => records,
    resolveIdentifier(query) {
      const s = query.trim().toLowerCase().replace(/\s+/g, ' ');
      const out: string[] = [];
      for (const m of models) {
        if (m.raw.name.toLowerCase() === s || m.raw.aliases.some((a) => a.toLowerCase() === s)) out.push(m.id);
      }
      return out;
    },
  };
  return { entities, provider, bhPosition, starPosition };
}

function tagline(m: BlackHoleModel): string {
  const r = m.raw;
  const mass = m.massMsun >= 1e6 ? `${(m.massMsun / 1e9 >= 1 ? (m.massMsun / 1e9).toPrecision(2) + ' billion' : (m.massMsun / 1e6).toPrecision(2) + ' million')}` : m.massMsun.toPrecision(3);
  const ly = (m.distanceM / PC_M) * 3.26156;
  const dist = ly >= 1e9 ? `${(ly / 1e9).toPrecision(2)} billion` : ly >= 1e6 ? `${(ly / 1e6).toPrecision(3)} million` : Math.round(ly).toLocaleString('en-US');
  if (r.class === 'merger') return `Two black holes that merged ${dist} light-years away: the first gravitational waves ever detected`;
  return `${mass}-solar-mass black hole, ${dist} light-years away`;
}

/** Arrival direction: ~68° from the disc axis (an Interstellar-like view of the disc), on the side facing the companion. */
function approachDirection(m: BlackHoleModel): readonly [number, number, number] | undefined {
  const n = m.normal;
  const toEarth = m.bary.clone().negate().normalize();
  let side = toEarth.clone().addScaledVector(n, -toEarth.dot(n));
  if (side.lengthSq() < 1e-6) side = new THREE.Vector3(1, 0, 0).addScaledVector(n, -n.x);
  side.normalize();
  const incl = m.raw.class === 'supermassive' ? 75 : 68;
  const t = (incl * Math.PI) / 180;
  const d = n.clone().multiplyScalar(Math.cos(t)).addScaledVector(side, Math.sin(t)).normalize();
  return [d.x, d.y, d.z];
}

/** Light-travel helper for the readout. */
export const lightSeconds = (m: number): number => m / C;
