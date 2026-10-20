/**
 * Fact sheets for exoplanets ('exo:<pl_name>') and planetary systems ('sys:<hostname>'). Measured values come from
 * the full archive row (uncertainties, limit flags and the per-value literature reference); derived values name
 * their model. Null stays "Unknown" — never 0. Pure (no THREE), so it is unit-tested.
 */
import type { Fact, FactSection, FactSheet, ProvenanceClass, Quantity, SourceRef, Uncertainty } from '../../data/provenance';
import { AU_M, L_SUN_W, LY_M, PC_M } from '../../core/units';
import {
  earthSimilarityIndex, ESI_DISCLAIMER, MODEL_ESI, MODEL_HZ, MODEL_TEQ, equilibriumTemperatureK,
} from '../../science/exoplanets';
import type { ExoDetail } from './detail';
import { MODEL_MASS_RADIUS, MODEL_TIDAL_LOCK, VISUAL_TYPE_LABEL, hzLabel, type PlanetModel, type SystemModel } from './physics';
import { SHOWCASE_BY_HOST } from './showcase';

export const DATASET_PLANETS = 'exoplanets-pscomppars';
export const DATASET_SYSTEMS = 'exoplanets-host-systems';

type Rec = Record<string, unknown>;
const numOf = (r: Rec | null, k: string): number | null => {
  const v = r?.[k];
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};
const strOf = (r: Rec | null, k: string): string | null => {
  const v = r?.[k];
  return typeof v === 'string' && v ? v : null;
};

function refLabel(d: ExoDetail, r: Rec | null, field: string): string | undefined {
  const idx = numOf(r, `${field}_refIdx`);
  if (idx === null) return undefined;
  const ref = d.refs[idx];
  return ref ? ref.label + (ref.url ? ` (${ref.url})` : '') : undefined;
}

/** Archive quantity with its uncertainty / limit flag and reference. */
function archiveQ(d: ExoDetail, r: Rec | null, field: string, unit: string, dataset: string, sig = 3): Quantity {
  const value = numOf(r, field);
  let uncertainty: Uncertainty | undefined;
  const lim = numOf(r, `${field}lim`);
  const e1 = numOf(r, `${field}err1`), e2 = numOf(r, `${field}err2`);
  if (lim === 1) uncertainty = { kind: 'limit', type: 'upper' };
  else if (lim === -1) uncertainty = { kind: 'limit', type: 'lower' };
  else if (e1 !== null && e2 !== null) {
    uncertainty = Math.abs(e1 + e2) < 1e-12 * Math.max(Math.abs(e1), 1) ? { kind: 'symmetric', sigma: e1 } : { kind: 'asymmetric', plus: e1, minus: -e2 };
  }
  const calc = refLabel(d, r, field)?.startsWith('Calculated');
  return {
    value, unit, uncertainty, sigDigits: sig,
    provenance: calc ? 'derived' : 'observed',
    source: { datasetId: dataset, field, reference: refLabel(d, r, field) },
  };
}

function fact(key: string, label: string, quantity: Quantity, help?: string): Fact {
  return { key, label, quantity, provenance: quantity.provenance, source: quantity.source, help };
}

function textFact(key: string, label: string, text: string | null, provenance: ProvenanceClass, source?: SourceRef, help?: string): Fact {
  return { key, label, text: text ?? 'Unknown', provenance, source, help };
}

function derivedQ(value: number, unit: string, model: string, sig = 3): Quantity {
  return { value: Number.isFinite(value) ? value : null, unit, provenance: 'derived', model, sigDigits: sig };
}

const fmt = (x: number, d = 2): string => (Math.abs(x) >= 100 ? x.toFixed(0) : x.toPrecision(d === 2 ? 3 : d));

/** "every 6.1 days" / "every 11.9 years". */
export function periodWords(days: number): string {
  if (!(days > 0)) return 'on an unknown orbit';
  if (days < 2) return `every ${fmt(days * 24)} hours`;
  if (days < 800) return `every ${fmt(days)} days`;
  return `every ${fmt(days / 365.25)} years`;
}

export function distanceWords(pc: number): string {
  if (!(pc > 0)) return 'at an unknown distance';
  const ly = (pc * PC_M) / LY_M;
  return `${ly < 100 ? ly.toFixed(1) : Math.round(ly).toLocaleString('en-US')} light years away`;
}

const MASS_PROV_LABEL: Record<string, string> = {
  Mass: 'Mass',
  Msini: 'Minimum mass (M sin i)',
  'Msin(i)/sin(i)': 'Mass (M sin i / sin i)',
  'M-R relationship': 'Mass (estimated from radius)',
};

export function planetFactSheet(entityId: string, m: SystemModel, p: PlanetModel, d: ExoDetail): FactSheet {
  const r = d.planet;
  const host = m.name;
  const show = SHOWCASE_BY_HOST.get(host);
  const method = strOf(r, 'discoverymethod');
  const year = numOf(r, 'disc_year');
  const per = numOf(r, 'pl_orbper');
  const aAu = p.aM / AU_M;
  const typeLabel = VISUAL_TYPE_LABEL[p.type];
  const hz = hzLabel(p.insolation, m.star.teffK);
  const prov = strOf(r, 'pl_bmassprov') ?? '';
  const summary =
    `${p.name} is ${/^[AEIOU]/.test(typeLabel) ? 'an' : 'a'} ${typeLabel.toLowerCase()} that orbits ${host} ${periodWords(per ?? NaN)}` +
    (aAu > 0 ? ` at ${fmt(aAu)} AU` : '') +
    `. It was found by ${method ? method.toLowerCase() : 'an unknown method'}${year ? ` in ${year}` : ''}.` +
    (p.insolation > 0 ? ` It receives ${fmt(p.insolation)} times the starlight Earth gets from the Sun (${hz.toLowerCase()}).` : '');

  // Derived values.
  const teq03 = equilibriumTemperatureK({ starTeffK: m.star.teffK, starRadiusM: m.star.radiusM, semiMajorAxisM: p.aM, bondAlbedo: 0.3, redistribution: 'full' });
  const radE = numOf(r, 'pl_rade');
  const massE = numOf(r, 'pl_bmasse');
  const dens = numOf(r, 'pl_dens');
  const esi = earthSimilarityIndex({
    radiusEarth: radE, insolationEarth: p.insolation > 0 ? p.insolation : null,
    densityEarth: dens !== null ? dens / 5.514 : null,
  });

  const properties: Fact[] = [
    fact('radius', 'Radius', archiveQ(d, r, 'pl_rade', 'R_earth', DATASET_PLANETS)),
    fact('mass', MASS_PROV_LABEL[prov] ?? 'Mass', archiveQ(d, r, 'pl_bmasse', 'M_earth', DATASET_PLANETS),
      prov === 'Msini' ? 'Radial velocities only give the mass times the sine of the unknown orbit tilt: the true mass is at least this.' :
      prov === 'M-R relationship' ? 'Not measured: the archive estimates it from the radius (Chen & Kipping 2017).' : undefined),
    fact('density', 'Bulk density', archiveQ(d, r, 'pl_dens', 'g/cm3', DATASET_PLANETS)),
    fact('insolation', 'Starlight received', archiveQ(d, r, 'pl_insol', 'S_earth', DATASET_PLANETS), 'Relative to the sunlight Earth receives (1 = Earth).'),
    fact('teq', 'Equilibrium temperature (published)', archiveQ(d, r, 'pl_eqt', 'K', DATASET_PLANETS), 'Albedo and heat-redistribution assumptions are those of the cited paper.'),
    fact('teq-a03', 'Equilibrium temperature (albedo 0.3)', derivedQ(teq03, 'K', MODEL_TEQ),
      'Teq = T★ √(R★/a) (¼ (1 − A))^¼ with Bond albedo 0.3 (Earth-like) and full heat redistribution; no greenhouse effect.'),
  ];
  if (radE === null && p.radiusSource === 'estimated') {
    properties.push(fact('radius-est', 'Radius (estimated from mass)', derivedQ(p.radiusM / 6.3710088e6, 'R_earth', MODEL_MASS_RADIUS),
      'Mean Chen & Kipping (2017) mass–radius relation; real planets scatter widely around it.'));
  }
  const science: Fact[] = [
    textFact('hz', 'Habitable-zone position', hz, 'derived', { datasetId: DATASET_PLANETS, note: MODEL_HZ },
      'Kopparapu et al. (2013, 2014) limits for the host star; being in the habitable zone does not mean a planet is habitable.'),
    fact('esi', 'Earth Similarity Index', derivedQ(esi.value ?? NaN, '', MODEL_ESI, 2), ESI_DISCLAIMER),
    textFact('tidal', 'Rotation',
      !(p.tidalLockYr > 0) ? null : p.tidallyLocked ? 'Probably tidally locked (one face toward the star)' : 'Probably not tidally locked',
      'derived', undefined,
      `Despinning time ≈ ${p.tidalLockYr > 0 ? p.tidalLockYr.toExponential(1) : '?'} years (Gladman et al. 1996, Q = 100, k₂ = 0.3, start: 12 h day). An order-of-magnitude estimate.`),
    textFact('class', 'Planet type (for the artwork)', typeLabel, 'illustrative', undefined,
      'Chosen from radius, density and temperature; it decides the artist\'s impression, not a measured composition.'),
  ];
  const orbit: Fact[] = [
    fact('period', 'Orbital period', archiveQ(d, r, 'pl_orbper', 'd', DATASET_PLANETS, 6)),
    fact('a', 'Semi-major axis', archiveQ(d, r, 'pl_orbsmax', 'AU', DATASET_PLANETS, 4)),
    fact('ecc', 'Eccentricity', archiveQ(d, r, 'pl_orbeccen', '', DATASET_PLANETS, 3)),
    fact('incl', 'Inclination to the sky', archiveQ(d, r, 'pl_orbincl', 'deg', DATASET_PLANETS, 4), '90° = seen edge-on (transiting).'),
  ];
  const observations: Fact[] = [
    textFact('method', 'Discovery method', method, 'observed', { datasetId: DATASET_PLANETS, field: 'discoverymethod' }),
    textFact('year', 'Discovered', year !== null ? String(year) : null, 'observed', { datasetId: DATASET_PLANETS, field: 'disc_year', reference: refLabel(d, r, 'disc') }),
    textFact('facility', 'Discovery facility', strOf(r, 'disc_facility'), 'observed', { datasetId: DATASET_PLANETS, field: 'disc_facility' }),
  ];
  if (numOf(r, 'pl_controv_flag') === 1) {
    observations.push(textFact('controv', 'Status', 'Questioned in the literature', 'observed', { datasetId: DATASET_PLANETS, field: 'pl_controv_flag' }));
  }
  const assumptions = [
    'Appearance: artist\'s impression generated from the planet type, temperature and insolation (no image of this planet exists).',
    p.inclIllustrative ? 'Orbit tilt not measured: drawn with the system\'s typical (or an assumed 60°) inclination.' : '',
    'The orientation of the orbit on the sky (longitude of the node) is not measured and is illustrative.',
    p.phaseIllustrative ? 'Orbital position is illustrative (no transit or conjunction time in the archive).' : 'Orbital position follows the published transit / conjunction time.',
    p.eccAssumed ? 'Eccentricity unknown: drawn circular.' : '',
  ].filter(Boolean);
  const missing: string[] = [];
  if (radE === null) missing.push('Radius (not measured)');
  if (massE === null) missing.push('Mass (not measured)');

  const sections: FactSection[] = [
    { id: 'overview', title: 'Overview', facts: [], paragraphs: show ? [show.story] : undefined },
    { id: 'properties', title: 'Planet', facts: properties },
    { id: 'orbit', title: 'Orbit', facts: orbit },
    { id: 'science', title: 'Habitability (derived)', facts: science },
    { id: 'observations', title: 'Discovery', facts: observations },
  ];
  return {
    entityId,
    summary,
    sections,
    representation: {
      provenance: 'illustrative',
      description: p.internalTeffK > 0
        ? 'Artist\'s impression. Telescopes see this young planet only as a dot glowing with its own heat (temperature from its spectrum).'
        : 'Artist\'s impression: surface generated from the planet\'s size, temperature and insolation class. Orbit drawn from archive values.',
    },
    sources: [{ datasetId: DATASET_PLANETS }, ...Object.values(d.refs).slice(0, 12).map((x) => ({ datasetId: DATASET_PLANETS, reference: x.label + (x.url ? ` (${x.url})` : '') }))],
    epoch: numOf(r, 'pl_tranmid') !== null ? { label: 'Transit / conjunction time', jd: numOf(r, 'pl_tranmid')! } : undefined,
    missing,
    assumptions,
  };
}

export function systemFactSheet(entityId: string, m: SystemModel, d: ExoDetail): FactSheet {
  const h = d.host;
  const show = SHOWCASE_BY_HOST.get(m.name);
  const dist = numOf(h, 'distPc');
  const n = m.planets.length;
  const spt = strOf(h, 'st_spectype');
  const summary = show
    ? `${show.tagline}. ${m.name} is ${distanceWords(dist ?? NaN)}.`
    : `${m.name}${spt ? `, a ${spt} star` : ''} ${distanceWords(dist ?? NaN)}, has ${n} known planet${n === 1 ? '' : 's'}.`;
  const hz = m.hz;
  const au = (x: number): Quantity => derivedQ(x / AU_M, 'AU', MODEL_HZ, 3);
  const star: Fact[] = [
    spt || !show?.spectralType
      ? textFact('spectype', 'Spectral type', spt, 'observed', { datasetId: DATASET_SYSTEMS, field: 'st_spectype' })
      : textFact('spectype', 'Spectral type', show.spectralType.text, 'observed', { datasetId: DATASET_SYSTEMS, reference: show.spectralType.reference, note: 'Archive st_spectype is empty; class from the discovery paper.' }),
    fact('teff', 'Surface temperature', archiveQ(d, h, 'st_teff', 'K', DATASET_SYSTEMS, 4)),
    fact('radius', 'Radius', archiveQ(d, h, 'st_rad', 'R_sun', DATASET_SYSTEMS)),
    fact('mass', 'Mass', archiveQ(d, h, 'st_mass', 'M_sun', DATASET_SYSTEMS)),
    fact('lum', 'Luminosity', derivedQ(m.star.luminosityW / L_SUN_W, 'L_sun', 'st_lum (log10) or 4πR²σT⁴'), 'Relative to the Sun.'),
    fact('met', 'Metallicity [Fe/H]', archiveQ(d, h, 'st_met', 'dex', DATASET_SYSTEMS)),
    fact('age', 'Age', archiveQ(d, h, 'st_age', 'Gyr', DATASET_SYSTEMS, 2)),
    fact('dist', 'Distance', archiveQ(d, h, 'distPc', 'pc', DATASET_SYSTEMS, 4)),
    fact('vmag', 'Brightness (V magnitude)', archiveQ(d, h, 'sy_vmag', '', DATASET_SYSTEMS, 3)),
  ];
  const system: Fact[] = [
    fact('nplanets', 'Known planets', { value: numOf(h, 'sy_pnum') ?? n, unit: '', provenance: 'observed', source: { datasetId: DATASET_SYSTEMS, field: 'sy_pnum' } }),
    fact('nstars', 'Stars in the system', { value: numOf(h, 'sy_snum'), unit: '', provenance: 'observed', source: { datasetId: DATASET_SYSTEMS, field: 'sy_snum' } }),
    fact('hz-in', 'Habitable zone, conservative inner edge', au(hz.runawayGreenhouse.distanceM), 'Runaway greenhouse limit (Kopparapu et al. 2014).'),
    fact('hz-out', 'Habitable zone, conservative outer edge', au(hz.maximumGreenhouse.distanceM), 'Maximum greenhouse limit.'),
    fact('hz-opt', 'Optimistic habitable zone', { ...au(hz.recentVenus.distanceM), uncertainty: { kind: 'range', min: hz.recentVenus.distanceM / AU_M, max: hz.earlyMars.distanceM / AU_M } },
      '"Recent Venus" to "early Mars": where Venus and Mars may once have had liquid water.'),
  ];
  const assumptions = [
    hz.valid ? '' : 'The star is outside 2600–7200 K, where the habitable-zone fits are calibrated: limits are extrapolated.',
    m.star.estimated ? 'Some stellar values are missing and were estimated (mass–radius scaling or Stefan–Boltzmann).' : '',
    m.companion ? `Companion star: ${m.companion.source}.` : '',
  ].filter(Boolean);
  return {
    entityId,
    summary,
    sections: [
      { id: 'overview', title: 'Overview', facts: [], paragraphs: show ? [show.story, ...show.references.map((x) => `Reference: ${x}`)] : undefined },
      { id: 'properties', title: 'Star', facts: star },
      { id: 'science', title: 'System', facts: system },
    ],
    representation: {
      provenance: 'derived',
      description: 'Star drawn from its temperature and radius; planets are artist\'s impressions on orbits from the archive. The habitable zone is computed (Kopparapu et al. 2014).',
    },
    sources: [{ datasetId: DATASET_SYSTEMS }, { datasetId: DATASET_PLANETS }],
    assumptions,
  };
}
