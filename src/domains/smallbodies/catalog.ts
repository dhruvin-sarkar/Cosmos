/**
 * Named small bodies: SBDB physical data + full-precision elements (named.generated.json, built by
 * tools/build-named.mjs) joined with the editorial / literature layer below (shape recipe, colour class,
 * mission facts). Every literature number carries its citation in `refs`.
 */
import named from './named.generated.json';
import type { HelioElements } from './orbits';
import type { EntityKind } from '../../core/entity';

export type ShapeRecipe = 'ellipsoid' | 'top' | 'peanut' | 'bilobed' | 'elongated' | 'shard';
export type SurfaceClass = 'C' | 'S' | 'V' | 'X' | 'B' | 'comet' | 'ice' | 'D';

export interface SbRecord {
  id: string;
  name: string;
  fullname: string;
  designation: string;
  kind: 'asteroid' | 'comet' | 'interstellar' | 'asteroid-moon';
  orbitClass: string | null;
  neo: boolean;
  pha: boolean;
  H: number | null;
  M1: number | null;
  K1: number | null;
  diameterKm: number | null;
  diameterSigmaKm: number | null;
  albedo: number | null;
  rotationPeriodH: number | null;
  spectralType: string | null;
  gmKm3s2: number | null;
  extentKm: string | null;
  elements: (HelioElements & { qAU: number; tpJD: number; periodDays: number | null }) | null;
  conditionCode: string | null;
  dataArcDays: number | null;
  moidAU: number | null;
  discovery: { by: string | null; date: string | null; site: string | null } | null;
  role: string;
  elementsFullPrecision?: boolean;
  binaryOrbit?: {
    semiMajorAxisKm: number;
    periodPreImpactH: number;
    periodPostImpactH: number;
    periodChangeMin: number;
    periodChangeSigmaMin3: number;
    periodChangeRef: string;
  };
  dart?: {
    massAtImpactKg: number;
    impactSpeedKms: number;
    kineticEnergyGJ: number;
    beta: number;
    betaSigmaPlus: number;
    betaSigmaMinus: number;
    betaAssumedDensityKgM3: number;
    betaRange: [number, number];
    alongTrackVelocityChangeMmS: number;
    ref: string;
    betaRef: string;
  };
  volumeKm3?: number;
  massKgEstimate?: number;
}

export const SB_RECORDS: SbRecord[] = (named as unknown as { bodies: SbRecord[] }).bodies;
export const SB_RETRIEVED: string = (named as unknown as { retrieved: string }).retrieved;

export interface Editorial {
  /** Human name override (SBDB shortname is "433 Eros"). */
  name: string;
  aliases: string[];
  tagline: string;
  summary: string;
  shape: ShapeRecipe;
  surface: SurfaceClass;
  /** Semi-axes in km [a, b, c] when published (full extents are halved); otherwise derived from the diameter. */
  axesKm?: [number, number, number];
  /** Whether `axesKm` is a published dimension or an illustrative proportion on a published diameter. */
  axesPublished: boolean;
  /** Heuristic comet scale 0..1 (≈ relative dust/gas production): Hale-Bopp 1, Halley 0.8, 67P 0.35, … */
  activity?: number;
  /** Camera framing distance, m. */
  viewDistanceM?: number;
  importance: number;
  paragraphs: string[];
  refs: { label: string; note: string }[];
}

const SBDB = 'NASA/JPL Small-Body Database (SBDB)';

export const EDITORIAL: Record<string, Editorial> = {
  vesta: {
    name: '4 Vesta', aliases: ['Vesta', '(4) Vesta'], tagline: 'Second-most massive main-belt asteroid, visited by Dawn',
    summary: 'Vesta is a differentiated protoplanet with an iron core, a basaltic crust and a giant south-polar basin. Fragments of it fall to Earth as HED meteorites.',
    shape: 'ellipsoid', surface: 'V', axesPublished: true, importance: 62,
    paragraphs: ['NASA\'s Dawn orbited Vesta from July 2011 to September 2012 before moving on to Ceres.'],
    refs: [{ label: 'Dawn at Vesta', note: 'Russell et al. 2012, Science 336:684 — shape and mass' }],
  },
  pallas: {
    name: '2 Pallas', aliases: ['Pallas', '(2) Pallas'], tagline: 'Third-largest asteroid, on a steeply inclined orbit',
    summary: 'Pallas is a large B-type asteroid whose 34.9° orbital inclination keeps it far from the other big asteroids.',
    shape: 'ellipsoid', surface: 'B', axesPublished: true, importance: 50,
    paragraphs: [], refs: [],
  },
  hygiea: {
    name: '10 Hygiea', aliases: ['Hygiea', '(10) Hygiea'], tagline: 'Fourth-largest asteroid, nearly spherical',
    summary: 'Hygiea is a dark C-type asteroid that may be round enough to qualify as a dwarf planet; SPHERE imaging (VLT) shows it is almost spherical.',
    shape: 'ellipsoid', surface: 'C', axesPublished: false, importance: 46,
    paragraphs: [], refs: [{ label: 'Vernazza et al. 2020', note: 'Nature Astronomy 4:136 — Hygiea shape from VLT/SPHERE' }],
  },
  psyche: {
    name: '16 Psyche', aliases: ['Psyche', '(16) Psyche'], tagline: 'Metal-rich asteroid, target of NASA\'s Psyche mission',
    summary: 'Psyche is an M/X-type asteroid whose radar and thermal properties suggest an unusually high metal content. NASA\'s Psyche spacecraft is travelling there.',
    shape: 'ellipsoid', surface: 'X', axesPublished: true, importance: 52,
    paragraphs: ['The Psyche spacecraft launched on 13 October 2023; its arrival is planned for 2029.'],
    refs: [{ label: 'NASA Psyche mission', note: 'mission timeline as of October 2026' }],
  },
  eros: {
    name: '433 Eros', aliases: ['Eros', '(433) Eros'], tagline: 'First near-Earth asteroid orbited and landed on (NEAR Shoemaker)',
    summary: 'Eros is an elongated S-type asteroid, 34 km long. NEAR Shoemaker orbited it in 2000 and touched down on 12 February 2001.',
    shape: 'elongated', surface: 'S', axesPublished: true, importance: 60,
    paragraphs: ['Eros is a Mars-crosser-turned-near-Earth object and the second-largest NEO.'],
    refs: [{ label: 'NEAR Shoemaker', note: 'Veverka et al. 2001, Science 292:484 — landing results' }],
  },
  bennu: {
    name: '101955 Bennu', aliases: ['Bennu', '(101955) Bennu', '1999 RQ36'], tagline: 'Rubble-pile asteroid; OSIRIS-REx returned a sample in 2023',
    summary: 'Bennu is a carbon-rich, spinning-top rubble pile about 490 m across. OSIRIS-REx collected 121.6 g of regolith in 2020 and delivered it to Earth on 24 September 2023.',
    shape: 'top', surface: 'B', axesPublished: true, importance: 62,
    paragraphs: ['Bennu has one of the highest cumulative impact probabilities (about 1 in 2,700 over 2175–2199) among known asteroids.'],
    refs: [{ label: 'Lauretta et al. 2019', note: 'Nature 568:55 — Bennu shape and geology' }, { label: 'OSIRIS-REx sample', note: 'NASA, 121.6 g, 2023-09-24' }],
  },
  ryugu: {
    name: '162173 Ryugu', aliases: ['Ryugu', '(162173) Ryugu', '1999 JU3'], tagline: 'Diamond-shaped carbonaceous asteroid sampled by Hayabusa2',
    summary: 'Ryugu is a dark, top-shaped C-type rubble pile about 1 km across. Hayabusa2 returned 5.4 g of its surface in December 2020.',
    shape: 'top', surface: 'C', axesPublished: true, importance: 55,
    paragraphs: [], refs: [{ label: 'Watanabe et al. 2019', note: 'Science 364:268 — Ryugu shape and rubble-pile structure' }],
  },
  itokawa: {
    name: '25143 Itokawa', aliases: ['Itokawa', '(25143) Itokawa'], tagline: 'Peanut-shaped asteroid; first asteroid sample returned (Hayabusa)',
    summary: 'Itokawa is a 535 m-long contact-binary rubble pile. JAXA\'s Hayabusa brought back thousands of grains in 2010.',
    shape: 'peanut', surface: 'S', axesPublished: true, importance: 52,
    paragraphs: [], refs: [{ label: 'Fujiwara et al. 2006', note: 'Science 312:1330 — Itokawa shape' }],
  },
  apophis: {
    name: '99942 Apophis', aliases: ['Apophis', '(99942) Apophis', '2004 MN4'], tagline: 'Will pass Earth within 38,000 km on 13 April 2029',
    summary: 'Apophis is an Aten-class near-Earth asteroid. On 13 April 2029 it passes about 38,000 km from Earth\'s centre — inside the ring of geostationary satellites — and will be visible to the naked eye.',
    shape: 'peanut', surface: 'S', axesPublished: false, importance: 78,
    paragraphs: ['Radar ruled out an Earth impact in 2029, 2036 and 2068. OSIRIS-APEX (the extended OSIRIS-REx mission) is planned to rendezvous with it in 2029.'],
    refs: [{ label: 'CNEOS close-approach table', note: 'distance 0.000254 au, 7.42 km/s (data/solar/close-approaches.json)' }],
  },
  didymos: {
    name: '65803 Didymos', aliases: ['Didymos', '(65803) Didymos', '1996 GT'], tagline: 'Binary asteroid; target of the DART kinetic-impact test',
    summary: 'Didymos is a 780 m near-Earth asteroid spinning in 2.26 h, with a 150 m moonlet, Dimorphos, in orbit. DART struck Dimorphos on 26 September 2022; ESA\'s Hera will survey the pair.',
    shape: 'top', surface: 'S', axesPublished: true, importance: 76,
    paragraphs: ['Didymos is the primary of the only asteroid system whose orbit humans have measurably changed.'],
    refs: [{ label: 'Daly et al. 2023', note: 'Nature 616:443 — DART at Didymos/Dimorphos' }],
  },
  dimorphos: {
    name: 'Dimorphos', aliases: ['(65803) Didymos I', 'Didymos B', 'S/2003 (65803) 1'], tagline: 'Didymos\' moonlet; its orbit was shortened by DART',
    summary: 'Dimorphos is a ~150 m rubble pile orbiting Didymos at about 1.2 km. DART\'s impact on 26 September 2022 shortened its 11.92 h orbit by 33 minutes.',
    shape: 'ellipsoid', surface: 'S', axesKm: [0.0885, 0.087, 0.058], axesPublished: true, importance: 74,
    paragraphs: ['Dimorphos is an oblate spheroid about 177 × 174 × 116 m (Daly et al. 2023). The orbital phase shown is illustrative; periods before and after the impact are the measured ones.'],
    refs: [{ label: 'Thomas et al. 2023', note: 'Nature 616:448 — orbital period change' }, { label: 'Cheng et al. 2023', note: 'Nature 616:457 — momentum transfer, β' }],
  },
  '2024-yr4': {
    name: '2024 YR4', aliases: ['2024 YR4'], tagline: 'Small near-Earth asteroid that briefly topped the impact-risk list',
    summary: '2024 YR4 is a ~60 m Apollo-type asteroid found on 27 December 2024. It reached Torino level 3 in early 2025 before follow-up observations ruled out an Earth impact in 2032.',
    shape: 'shard', surface: 'S', axesPublished: false, importance: 66,
    paragraphs: ['The diameter is a thermal-infrared estimate (JWST, 2025), not a direct image. Current Sentry values are shown in the Observations section when available.'],
    refs: [{ label: 'JWST thermal estimate', note: 'NASA/ESA, March 2025, 60 m ± ~7 m' }],
  },
  phaethon: {
    name: '3200 Phaethon', aliases: ['Phaethon', '(3200) Phaethon'], tagline: 'Parent body of the Geminid meteor shower',
    summary: 'Phaethon is a 5–6 km B-type near-Earth asteroid that passes within 0.14 au of the Sun and sheds dust that Earth crosses every December as the Geminids.',
    shape: 'top', surface: 'B', axesPublished: false, importance: 50,
    paragraphs: ['JAXA\'s DESTINY+ is planned to fly past it.'], refs: [],
  },
  halley: {
    name: '1P/Halley', aliases: ['Halley', 'Halley\'s Comet', '1P'], tagline: 'The most famous periodic comet; returns every 75–76 years',
    summary: 'Halley\'s nucleus is a 15 × 8 km peanut. It last reached perihelion on 9 February 1986 and returns in July 2061. Giotto and Vega imaged the nucleus in 1986.',
    shape: 'peanut', surface: 'comet', axesPublished: true, activity: 0.85, viewDistanceM: 6e9, importance: 90,
    paragraphs: ['Today (2026) Halley is near aphelion beyond Neptune, about 35 au away, and inactive. Set the clock to February 1986 or July 2061 to see its tails.'],
    refs: [{ label: 'Keller et al. 1986', note: 'Nature 321:320 — Giotto HMC nucleus images' }],
  },
  encke: {
    name: '2P/Encke', aliases: ['Encke', 'Comet Encke', '2P'], tagline: 'Shortest-period comet known: 3.3 years',
    summary: 'Encke orbits entirely inside Jupiter\'s orbit every 3.3 years and is the parent of the Taurid meteor stream.',
    shape: 'ellipsoid', surface: 'comet', axesPublished: false, activity: 0.35, viewDistanceM: 3e9, importance: 55,
    paragraphs: [], refs: [],
  },
  'tempel-1': {
    name: '9P/Tempel 1', aliases: ['Tempel 1', '9P'], tagline: 'Deep Impact\'s target (2005)',
    summary: 'Tempel 1 is a Jupiter-family comet. In July 2005 NASA\'s Deep Impact struck it with a 370 kg copper impactor to look beneath the surface.',
    shape: 'ellipsoid', surface: 'comet', axesPublished: false, activity: 0.3, viewDistanceM: 3e9, importance: 52,
    paragraphs: [], refs: [{ label: 'A\'Hearn et al. 2005', note: 'Science 310:258 — Deep Impact' }],
  },
  '67p': {
    name: '67P/Churyumov–Gerasimenko', aliases: ['67P', 'Churyumov-Gerasimenko', 'Rosetta comet', '67P/C-G'], tagline: 'Rosetta\'s comet; the first soft landing on a comet nucleus',
    summary: '67P is a bilobed Jupiter-family comet about 4 km across. ESA\'s Rosetta orbited it from 2014 to 2016 and Philae landed on it on 12 November 2014.',
    shape: 'bilobed', surface: 'comet', axesKm: [2.3, 1.55, 1.1], axesPublished: false, activity: 0.4, viewDistanceM: 3e9, importance: 74,
    paragraphs: ['The two lobes are shown with illustrative proportions; the published mean radius is about 1.65 km.'],
    refs: [{ label: 'Sierks et al. 2015', note: 'Science 347:aaa1044 — OSIRIS images of 67P' }],
  },
  'hale-bopp': {
    name: 'C/1995 O1 (Hale–Bopp)', aliases: ['Hale-Bopp', 'Comet Hale-Bopp', 'C/1995 O1'], tagline: 'The Great Comet of 1997, visible to the naked eye for 18 months',
    summary: 'Hale–Bopp has an unusually large nucleus (~60 km). It reached perihelion at 0.91 au in April 1997 and will not return for more than two thousand years.',
    shape: 'ellipsoid', surface: 'comet', axesPublished: false, activity: 1.0, viewDistanceM: 8e9, importance: 70,
    paragraphs: ['Set the clock to April 1997 to see it at perihelion. Today it is ~400 au out.'], refs: [],
  },
  oumuamua: {
    name: '1I/ʻOumuamua', aliases: ['Oumuamua', '1I/2017 U1', '1I'], tagline: 'First interstellar object seen passing through the Solar System',
    summary: 'Discovered by Pan-STARRS on 19 October 2017, ʻOumuamua was on a hyperbolic orbit (e = 1.2) and is leaving the Solar System at about 26 km/s. Its extreme light curve implies an elongated or flattened shape.',
    shape: 'elongated', surface: 'D', axesKm: [0.115, 0.0175, 0.0175], axesPublished: false, importance: 72,
    paragraphs: ['The shape here is illustrative: a ≥ 5:1 elongated body, scaled to ~230 m (Meech et al. 2017). Its size and shape are inferred from brightness variations only.'],
    refs: [{ label: 'Meech et al. 2017', note: 'Nature 552:378' }],
  },
  borisov: {
    name: '2I/Borisov', aliases: ['Borisov', 'C/2019 Q4', '2I'], tagline: 'First confirmed interstellar comet',
    summary: 'Discovered by amateur astronomer Gennady Borisov on 30 August 2019, 2I/Borisov is a comet from another star, on a strongly hyperbolic orbit (e = 3.36).',
    shape: 'ellipsoid', surface: 'comet', axesKm: [0.4, 0.4, 0.4], axesPublished: false, activity: 0.3, viewDistanceM: 3e9, importance: 66,
    paragraphs: ['The nucleus radius is only constrained to ≲ 0.5 km (HST); the size shown is an illustrative upper-limit scale.'],
    refs: [{ label: 'Jewitt & Luu 2019', note: 'ApJL 886:L29 — nucleus size limit' }],
  },
  '3i-atlas': {
    name: '3I/ATLAS', aliases: ['ATLAS', 'C/2025 N1', '3I'], tagline: 'Third interstellar object, found in July 2025',
    summary: '3I/ATLAS was discovered by the ATLAS survey (Rio Hurtado, Chile) on 1 July 2025 on a very fast hyperbolic orbit (e ≈ 6.1). It passed perihelion at 1.36 au on 29 October 2025 and is now outbound.',
    shape: 'ellipsoid', surface: 'comet', axesKm: [1.0, 1.0, 1.0], axesPublished: false, activity: 0.6, viewDistanceM: 5e9, importance: 78,
    paragraphs: ['The nucleus size is not well constrained (HST upper limit of a few km radius); the size shown is illustrative.'],
    refs: [{ label: 'JPL SBDB', note: 'osculating hyperbolic elements, full precision' }],
  },
  arrokoth: {
    name: '486958 Arrokoth', aliases: ['Arrokoth', '(486958) Arrokoth', '2014 MU69', 'Ultima Thule'], tagline: 'Most distant world explored up close; a primordial contact binary',
    summary: 'Arrokoth is a 36 km-long contact binary in the cold classical Kuiper belt. New Horizons flew by on 1 January 2019, revealing a pristine, reddish, snowman-shaped body.',
    shape: 'bilobed', surface: 'ice', axesKm: [18.0, 9.0, 4.5], axesPublished: false, importance: 66,
    paragraphs: ['Dimensions are approximate (two lobes 22 km and 15 km); shape is illustrative.'],
    refs: [{ label: 'Stern et al. 2019', note: 'Science 364:eaaw9771' }],
  },
  sedna: {
    name: '90377 Sedna', aliases: ['Sedna', '(90377) Sedna'], tagline: 'Extreme trans-Neptunian object on a ~12,000-year orbit',
    summary: 'Sedna swings from 76 au out to roughly 1,000 au from the Sun, far outside the Kuiper belt, in an orbit of about 12,000 years (osculating, Sun-centred). It is currently near perihelion.',
    shape: 'ellipsoid', surface: 'D', axesKm: [500, 500, 500], axesPublished: false, importance: 60,
    paragraphs: ['Its size (~1,000 km) is a thermal estimate and its appearance is illustrative: a very red surface.'],
    refs: [{ label: 'Pál et al. 2012', note: 'A&A 541:L6 — Herschel size estimate' }],
  },
};

export const SB_KIND_TO_ENTITY: Record<SbRecord['kind'], EntityKind> = {
  asteroid: 'asteroid',
  comet: 'comet',
  interstellar: 'interstellar-object',
  'asteroid-moon': 'asteroid',
};

export const ORBIT_CLASS_NAMES: Record<string, string> = {
  MBA: 'Main-belt asteroid',
  IMB: 'Inner main-belt asteroid',
  OMB: 'Outer main-belt asteroid',
  MCA: 'Mars-crossing asteroid',
  AMO: 'Amor-class near-Earth asteroid',
  APO: 'Apollo-class near-Earth asteroid',
  ATE: 'Aten-class near-Earth asteroid',
  IEO: 'Atira (interior-Earth) asteroid',
  TJN: 'Jupiter Trojan',
  CEN: 'Centaur',
  TNO: 'Trans-Neptunian object',
  HTC: 'Halley-type comet',
  ETc: 'Encke-type comet',
  JFc: 'Jupiter-family comet',
  COM: 'Long-period comet',
  HYA: 'Hyperbolic asteroid',
  HYP: 'Hyperbolic comet',
  AST: 'Asteroid (other)',
};

export { SBDB };
