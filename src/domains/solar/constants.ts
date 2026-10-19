/**
 * Static description of the Sun, planets and dwarf planets rendered by the solar domain.
 *
 * Physical values mirror public/data/solar/bodies.json (JPL SSD planetary physical parameters, NAIF pck00011 /
 * IAU WGCCRE 2015 rotation, SBDB osculating elements) so entities exist synchronously at startup; the fact
 * sheets read the JSON itself. Haumea's triaxial shape is from Ortiz et al. 2017 (Nature 550, 219).
 */
import { DEG } from '../../core/units';

export type SurfaceKind = 'rocky' | 'giant' | 'cloud' | 'ice';

/** IAU rotation model: pole(T) = pole0 + rate·T (T Julian centuries TDB), W(d) = w0 + wDot·d (d days TDB). */
export interface RotationModel {
  ra0: number;
  dec0: number;
  raRate: number;
  decRate: number;
  w0: number;
  wDot: number;
  /** Neptune's IAU periodic terms (N = 357.85 + 52.316 T). */
  neptuneTerms?: boolean;
  /** Mars' long-period IAU 2015 terms (argument 0.5042615 T), up to 1.6° in declination. */
  marsTerms?: boolean;
  /** True when no IAU pole exists and the pole shown is an assumption. */
  illustrativePole?: boolean;
}

/** Osculating heliocentric elements in the J2000 ecliptic frame (SBDB). */
export interface DwarfElements {
  epochJd: number;
  aAu: number;
  e: number;
  iDeg: number;
  nodeDeg: number;
  argPeriDeg: number;
  meanAnomalyDeg: number;
}

export interface RingDef {
  innerM: number;
  outerM: number;
  /** Texture key of the radial strip, or a procedural profile id. */
  strip: 'saturn' | 'jupiter' | 'uranus' | 'neptune';
  /** Fraction of forward-scattering dust. */
  dust: number;
  /** Strip colour → single-scattering albedo ϖ (the strip stores image brightness, not ϖ). Default 1. */
  albedoScale?: number;
}

export interface SolarBodyDef {
  id: string;
  /** Key into bodies.json / public/textures/<key>. */
  key: string;
  name: string;
  aliases: string[];
  kind: 'star' | 'planet' | 'dwarf-planet';
  /** astronomy-engine body name, when the library models it. */
  aeBody?: 'Sun' | 'Earth' | 'Mercury' | 'Venus' | 'Mars' | 'Jupiter' | 'Saturn' | 'Uranus' | 'Neptune' | 'Pluto';
  elements?: DwarfElements;
  /** Semi-axes in metres: equatorial a, b (b = a unless triaxial), polar c. */
  axesM: [number, number, number];
  meanRadiusM: number;
  gmM3S2: number;
  /** Geometric albedo (null = unknown). */
  geometricAlbedo: number | null;
  /**
   * Linear-sRGB albedo factor multiplied into the map, calibrated so map × tint averages to the body's measured
   * albedo and colour (map means measured in linear light, cos-latitude weighted); the whole albedo without a map.
   */
  tint: [number, number, number];
  surface: SurfaceKind;
  /** Texture role for the colour map (Venus uses its cloud-deck map, never the radar surface). */
  colorMap: 'color' | 'atmosphere' | null;
  hasNormalMap?: boolean;
  /** Coverage mask (255 = observed) used to keep unobserved terrain featureless. */
  hasCoverage?: boolean;
  /** Visual provenance of the rendered appearance. */
  appearance: 'observed' | 'reconstructed' | 'illustrative';
  appearanceNote: string;
  rotation: RotationModel;
  rings?: RingDef[];
  /** Thin atmospheric limb (render-kit AtmosphereShell params set in the bodies layer). */
  atmosphere?: 'venus' | 'mars' | 'pluto';
  /** Gas-giant limb darkening (Minnaert k). */
  minnaertK?: number;
  importance: number;
  tagline: string;
  /** Orbit period, days (orbit sampling and interpolation windows). */
  periodDays: number;
}

const km = (v: number): number => v * 1000;
const GM = (km3s2: number): number => km3s2 * 1e9;

export const SOLAR_BODIES: readonly SolarBodyDef[] = [
  {
    id: 'sol:sun', key: 'sun', name: 'Sun', aliases: ['Sol'], kind: 'star', aeBody: 'Sun',
    axesM: [km(695700), km(695700), km(695700)], meanRadiusM: km(695700), gmM3S2: GM(132712440041.27942),
    geometricAlbedo: null, tint: [1, 1, 1], surface: 'rocky', colorMap: null,
    appearance: 'observed', appearanceNote: 'Photosphere rendered physically: 5772 K blackbody colour, measured limb-darkening law and granulation at its real scale.',
    rotation: { ra0: 286.13, dec0: 63.87, raRate: 0, decRate: 0, w0: 84.176, wDot: 14.1844 },
    importance: 100, tagline: 'The star at the centre of the Solar System', periodDays: 1,
  },
  {
    id: 'sol:mercury', key: 'mercury', name: 'Mercury', aliases: [], kind: 'planet', aeBody: 'Mercury',
    axesM: [km(2440.53), km(2440.53), km(2438.3)], meanRadiusM: km(2439.4), gmM3S2: GM(22031.8685514),
    geometricAlbedo: 0.106, tint: [1.6, 1.47, 1.31], surface: 'rocky', colorMap: 'color',
    appearance: 'observed', appearanceNote: 'MESSENGER MDIS global mosaic (USGS Astrogeology), greyscale tinted to Mercury’s measured mean colour.',
    rotation: { ra0: 281.0103, dec0: 61.4155, raRate: -0.0328, decRate: -0.0049, w0: 329.5988, wDot: 6.1385108 },
    importance: 80, tagline: 'The smallest planet and the closest to the Sun', periodDays: 87.969,
  },
  {
    id: 'sol:venus', key: 'venus', name: 'Venus', aliases: [], kind: 'planet', aeBody: 'Venus',
    axesM: [km(6051.8), km(6051.8), km(6051.8)], meanRadiusM: km(6051.8), gmM3S2: GM(324858.592),
    geometricAlbedo: 0.65, tint: [0.95, 1.31, 2.34], surface: 'cloud', colorMap: 'atmosphere', atmosphere: 'venus', minnaertK: 0.75,
    appearance: 'reconstructed', appearanceNote: 'Cloud deck from an illustrative visible-light composite (Solar System Scope, CC BY 4.0). In visible light Venus is a near-featureless creamy haze.',
    rotation: { ra0: 272.76, dec0: 67.16, raRate: 0, decRate: 0, w0: 160.2, wDot: -1.4813688 },
    importance: 85, tagline: 'A runaway-greenhouse world wrapped in sulfuric-acid clouds', periodDays: 224.701,
  },
  {
    id: 'sol:mars', key: 'mars', name: 'Mars', aliases: ['the Red Planet'], kind: 'planet', aeBody: 'Mars',
    axesM: [km(3396.19), km(3396.19), km(3376.2)], meanRadiusM: km(3389.5), gmM3S2: GM(42828.37362),
    geometricAlbedo: 0.15, tint: [1.3, 1.15, 0.64], surface: 'rocky', colorMap: 'color', hasNormalMap: true, atmosphere: 'mars',
    appearance: 'observed', appearanceNote: 'Viking MDIM 2.1 colour mosaic with MOLA relief (USGS Astrogeology).',
    rotation: { ra0: 317.269202, dec0: 54.432516, raRate: -0.10927547, decRate: -0.05827105, w0: 176.049863, wDot: 350.891982443297, marsTerms: true },
    importance: 92, tagline: 'A cold desert world with the largest volcanoes in the Solar System', periodDays: 686.98,
  },
  {
    id: 'sol:jupiter', key: 'jupiter', name: 'Jupiter', aliases: [], kind: 'planet', aeBody: 'Jupiter',
    axesM: [km(71492), km(71492), km(66854)], meanRadiusM: km(69911), gmM3S2: GM(126686531.9),
    geometricAlbedo: 0.52, tint: [1, 1, 0.95], surface: 'giant', colorMap: 'color', minnaertK: 1.05,
    appearance: 'reconstructed', appearanceNote: 'Cloud bands from a Cassini/Juno-based composite (Solar System Scope, CC BY 4.0); the real bands drift and the Great Red Spot’s longitude changes, so the pattern is illustrative.',
    rotation: { ra0: 268.056595, dec0: 64.495303, raRate: -0.006499, decRate: 0.002413, w0: 284.95, wDot: 870.536 },
    importance: 95, tagline: 'The largest planet: a gas giant with a storm wider than Earth', periodDays: 4332.59,
  },
  {
    id: 'sol:saturn', key: 'saturn', name: 'Saturn', aliases: [], kind: 'planet', aeBody: 'Saturn',
    axesM: [km(60268), km(60268), km(54364)], meanRadiusM: km(58232), gmM3S2: GM(37931206.23),
    geometricAlbedo: 0.47, tint: [0.8, 0.83, 0.88], surface: 'giant', colorMap: 'color', minnaertK: 1.05,
    // Strip B-ring peak ≈ 0.24 linear; ϖ ≈ 0.6 for the B ring at visible wavelengths (Cuzzi et al. 1984; Porco et al. 2008).
    rings: [{ innerM: km(74500), outerM: km(140220), strip: 'saturn', dust: 0.08, albedoScale: 2.5 }],
    appearance: 'reconstructed', appearanceNote: 'Cloud bands from a Cassini-based composite (Solar System Scope, CC BY 4.0); rings from a Cassini radial profile. Band longitudes are illustrative.',
    rotation: { ra0: 40.589, dec0: 83.537, raRate: -0.036, decRate: -0.004, w0: 38.9, wDot: 810.7939024 },
    importance: 95, tagline: 'The ringed gas giant, less dense than water', periodDays: 10759.22,
  },
  {
    id: 'sol:uranus', key: 'uranus', name: 'Uranus', aliases: [], kind: 'planet', aeBody: 'Uranus',
    axesM: [km(25559), km(25559), km(24973)], meanRadiusM: km(25362), gmM3S2: GM(5793951.26),
    geometricAlbedo: 0.51, tint: [1.1, 0.97, 0.93], surface: 'giant', colorMap: 'color', minnaertK: 1.1,
    rings: [{ innerM: km(41837), outerM: km(51149), strip: 'uranus', dust: 0.05 }],
    appearance: 'reconstructed', appearanceNote: 'Pale cyan disc after Voyager 2 imagery (Solar System Scope, CC BY 4.0); faint cloud features are illustrative.',
    rotation: { ra0: 257.311, dec0: -15.175, raRate: 0, decRate: 0, w0: 203.81, wDot: -501.1600928 },
    importance: 88, tagline: 'An ice giant rolling on its side', periodDays: 30688.5,
  },
  {
    id: 'sol:neptune', key: 'neptune', name: 'Neptune', aliases: [], kind: 'planet', aeBody: 'Neptune',
    axesM: [km(24764), km(24764), km(24341)], meanRadiusM: km(24622), gmM3S2: GM(6835103.15),
    geometricAlbedo: 0.41, tint: [2, 1.6, 0.95], surface: 'giant', colorMap: 'color', minnaertK: 1.1,
    appearance: 'reconstructed', appearanceNote: 'Deep blue disc after Voyager 2 imagery (Solar System Scope, CC BY 4.0); storm positions are illustrative.',
    rotation: { ra0: 299.36, dec0: 43.46, raRate: 0, decRate: 0, w0: 249.978, wDot: 541.1397757, neptuneTerms: true },
    importance: 88, tagline: 'The windiest planet, deep blue and far from the Sun', periodDays: 60182,
  },
  {
    id: 'sol:ceres', key: 'ceres', name: 'Ceres', aliases: ['1 Ceres'], kind: 'dwarf-planet',
    elements: { epochJd: 2461200.5, aAu: 2.77, e: 0.0797, iDeg: 10.6, nodeDeg: 80.2, argPeriDeg: 73.3, meanAnomalyDeg: 274 },
    axesM: [km(482.1), km(482.1), km(446)], meanRadiusM: km(469.7), gmM3S2: GM(62.6327),
    geometricAlbedo: 0.09, tint: [0.58, 0.57, 0.56], surface: 'rocky', colorMap: 'color',
    appearance: 'observed', appearanceNote: 'Dawn Framing Camera global mosaic (DLR / NASA Solar System Treks), tinted to Ceres’ dark grey albedo.',
    rotation: { ra0: 291.418, dec0: 66.764, raRate: 0, decRate: 0, w0: 170.65, wDot: 952.1532 },
    importance: 60, tagline: 'The largest object in the asteroid belt', periodDays: 1680,
  },
  {
    id: 'sol:pluto', key: 'pluto', name: 'Pluto', aliases: ['134340 Pluto'], kind: 'dwarf-planet', aeBody: 'Pluto',
    axesM: [km(1188.3), km(1188.3), km(1188.3)], meanRadiusM: km(1188.3), gmM3S2: GM(869.3009),
    geometricAlbedo: 0.52, tint: [3.6, 3, 2.4], surface: 'ice', colorMap: 'color', hasCoverage: true, atmosphere: 'pluto',
    appearance: 'observed', appearanceNote: 'New Horizons LORRI/MVIC global mosaic (USGS); the hemisphere New Horizons did not see in detail is shown featureless.',
    rotation: { ra0: 132.993, dec0: -6.163, raRate: 0, decRate: 0, w0: 302.695, wDot: 56.3625225 },
    importance: 75, tagline: 'A dwarf planet with a nitrogen-ice heart', periodDays: 90560,
  },
  {
    id: 'sol:eris', key: 'eris', name: 'Eris', aliases: ['136199 Eris'], kind: 'dwarf-planet',
    elements: { epochJd: 2461200.5, aAu: 67.9, e: 0.438, iDeg: 43.9, nodeDeg: 36, argPeriDeg: 151, meanAnomalyDeg: 212 },
    axesM: [km(1200), km(1200), km(1200)], meanRadiusM: km(1200), gmM3S2: GM(1107.934),
    geometricAlbedo: 0.84, tint: [0.84, 0.83, 0.82], surface: 'ice', colorMap: null,
    appearance: 'illustrative', appearanceNote: 'No resolved image of Eris exists: a uniform bright-grey ice disc at its measured albedo.',
    rotation: { ra0: 270, dec0: 66.5607, raRate: 0, decRate: 0, w0: 0, wDot: 333.64226, illustrativePole: true },
    importance: 55, tagline: 'The most massive known dwarf planet, far beyond Pluto', periodDays: 204_400,
  },
  {
    id: 'sol:haumea', key: 'haumea', name: 'Haumea', aliases: ['136108 Haumea'], kind: 'dwarf-planet',
    elements: { epochJd: 2461200.5, aAu: 43.1, e: 0.194, iDeg: 28.2, nodeDeg: 122, argPeriDeg: 241, meanAnomalyDeg: 223 },
    axesM: [km(1161), km(852), km(513)], meanRadiusM: km(715), gmM3S2: GM(267.3725),
    geometricAlbedo: 0.72, tint: [0.74, 0.73, 0.72], surface: 'ice', colorMap: null,
    appearance: 'illustrative', appearanceNote: 'No resolved image exists: a uniform crystalline-ice ellipsoid with the measured 1161 × 852 × 513 km shape (Ortiz et al. 2017). Its thin ring is not drawn.',
    rotation: { ra0: 270, dec0: 66.5607, raRate: 0, decRate: 0, w0: 0, wDot: 2207.2348, illustrativePole: true },
    importance: 50, tagline: 'A fast-spinning, egg-shaped dwarf planet', periodDays: 103_400,
  },
  {
    id: 'sol:makemake', key: 'makemake', name: 'Makemake', aliases: ['136472 Makemake'], kind: 'dwarf-planet',
    elements: { epochJd: 2461200.5, aAu: 45.6, e: 0.159, iDeg: 29, nodeDeg: 79.3, argPeriDeg: 297, meanAnomalyDeg: 170 },
    axesM: [km(717), km(717), km(710)], meanRadiusM: km(714), gmM3S2: GM(206.9033),
    geometricAlbedo: 0.81, tint: [0.86, 0.68, 0.55], surface: 'ice', colorMap: null,
    appearance: 'illustrative', appearanceNote: 'No resolved image exists: a uniform reddish methane-ice disc at its measured albedo and colour.',
    rotation: { ra0: 270, dec0: 66.5607, raRate: 0, decRate: 0, w0: 0, wDot: 384.20491, illustrativePole: true },
    importance: 50, tagline: 'A reddish dwarf planet coated in methane ice', periodDays: 111_800,
  },
];

export const SOLAR_BODY_BY_ID: ReadonlyMap<string, SolarBodyDef> = new Map(SOLAR_BODIES.map((b) => [b.id, b]));
export const SOLAR_PROVIDED_IDS: string[] = SOLAR_BODIES.map((b) => b.id);

/** Mean obliquity of the ecliptic at J2000 (IAU 2006), radians. */
export const OBLIQUITY_J2000_RAD = 23.4392911 * DEG;
