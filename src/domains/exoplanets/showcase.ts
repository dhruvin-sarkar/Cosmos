/**
 * Showcase systems: the famous planetary systems the exhibition tells stories with. Every numeric value comes from the
 * archive snapshot except the explicitly cited extras (Kepler-16 B, HR 8799 planet temperatures).
 */
import { AU_M, L_SUN_W, M_SUN_KG, R_SUN_M, SIGMA_SB } from '../../core/units';
import { trueToMeanAnomaly } from '../../science/orbits';
import type { CompanionStar, SystemExtras } from './physics';

export interface ShowcaseSystem {
  /** Archive hostname. */
  host: string;
  /** Display name. */
  title: string;
  aliases: string[];
  tagline: string;
  /** Plain-language story (1–3 sentences). */
  story: string;
  /** Discovery / key papers. */
  references: string[];
  importance: number;
  /** Spectral class from the literature when the archive's st_spectype is empty. */
  spectralType?: { text: string; reference: string };
}

export const SHOWCASE: readonly ShowcaseSystem[] = [
  {
    host: 'TRAPPIST-1', title: 'TRAPPIST-1', aliases: ['2MASS J23062928-0502285'], importance: 72,
    tagline: 'Seven Earth-sized worlds around an ultracool red dwarf',
    story:
      'Seven rocky planets, all smaller than or close to Earth, circle a star barely larger than Jupiter. The whole system would fit well inside the orbit of Mercury, and several planets receive about as much light as Earth or Mars do.',
    references: ['Gillon et al. 2016, Nature 533, 221', 'Gillon et al. 2017, Nature 542, 456', 'Agol et al. 2021, PSJ 2, 1'],
  },
  {
    host: 'Proxima Cen', title: 'Proxima Centauri', aliases: ['Proxima', 'Alpha Centauri C', 'GJ 551'], importance: 74,
    tagline: 'The closest star to the Sun, with a planet in its habitable zone',
    story:
      'Proxima Centauri is the nearest star to the Sun, 4.2 light years away. Proxima b, found from the tiny wobble it causes in the star, orbits in the habitable zone every 11 days, but the star is a flare star that bathes it in X-rays.',
    references: ['Anglada-Escudé et al. 2016, Nature 536, 437', 'Faria et al. 2022, A&A 658, A115'],
  },
  {
    host: 'Kepler-186', title: 'Kepler-186', aliases: [], importance: 55,
    tagline: 'The first Earth-size planet found in a habitable zone',
    story:
      'Kepler-186 f was the first planet close to Earth\'s size found in the habitable zone of another star. Its red-dwarf sun gives it about a third of the light Earth gets.',
    references: ['Quintana et al. 2014, Science 344, 277'],
  },
  {
    host: 'Kepler-452', title: 'Kepler-452', aliases: [], importance: 50,
    tagline: 'A super-Earth on a 385-day orbit around a Sun-like star',
    story:
      'Kepler-452 b orbits a star very like the Sun with a year only 20 days longer than ours. It is 1.6 times Earth\'s size, so it may be rocky or may hold a thick gas envelope; later analyses also questioned how secure its signal is.',
    references: ['Jenkins et al. 2015, AJ 150, 56', 'Mullally et al. 2018, AJ 155, 210'],
  },
  {
    host: '51 Peg', title: '51 Pegasi', aliases: ['51 Pegasi', 'Helvetios', 'HD 217014'], importance: 62,
    tagline: 'The first planet found around a Sun-like star',
    story:
      'In 1995 Michel Mayor and Didier Queloz found a giant planet circling 51 Pegasi every 4.2 days, far closer than Mercury is to the Sun. The discovery of this first "hot Jupiter" won the 2019 Nobel Prize in Physics.',
    references: ['Mayor & Queloz 1995, Nature 378, 355'],
  },
  {
    host: 'HD 209458', title: 'HD 209458', aliases: ['Osiris'], importance: 55,
    tagline: 'The first transiting planet and the first exoplanet atmosphere',
    story:
      'HD 209458 b was the first planet seen passing in front of its star, and the first whose atmosphere was detected. Hydrogen escapes from it in a long comet-like tail.',
    references: ['Charbonneau et al. 2000, ApJ 529, L45', 'Charbonneau et al. 2002, ApJ 568, 377', 'Vidal-Madjar et al. 2003, Nature 422, 143'],
  },
  {
    host: 'Kepler-16', title: 'Kepler-16', aliases: ['Tatooine'], importance: 56,
    spectralType: { text: 'K dwarf + M dwarf', reference: 'Doyle et al. 2011, Science 333, 1602' },
    tagline: 'A planet with two suns',
    story:
      'Kepler-16 b orbits a pair of stars that eclipse each other every 41 days, so it has two suns in its sky. It was the first planet confirmed to transit a binary star.',
    references: ['Doyle et al. 2011, Science 333, 1602'],
  },
  {
    host: 'TOI-700', title: 'TOI-700', aliases: [], importance: 52,
    tagline: 'TESS\'s Earth-size planets in a habitable zone',
    story:
      'TOI-700 d was the first Earth-size habitable-zone planet found by NASA\'s TESS mission; a second one, TOI-700 e, followed in 2023. Their star is a quiet red dwarf.',
    references: ['Gilbert et al. 2020, AJ 160, 116', 'Gilbert et al. 2023, ApJL 944, L35'],
  },
  {
    host: 'LHS 1140', title: 'LHS 1140', aliases: ['GJ 3053'], importance: 52,
    tagline: 'A dense super-Earth, maybe a water world, in a habitable zone',
    story:
      'LHS 1140 b is 1.7 times Earth\'s size and lies in its red dwarf\'s habitable zone. Its density suggests a large fraction of water or ice, which makes it one of the best targets for JWST.',
    references: ['Dittmann et al. 2017, Nature 544, 333', 'Cadieux et al. 2024, ApJL 960, L3'],
  },
  {
    host: '55 Cnc', title: '55 Cancri', aliases: ['55 Cancri', 'Copernicus', 'Rho1 Cancri'], importance: 56,
    tagline: 'Five planets, including a lava world with an 18-hour year',
    story:
      '55 Cancri A has five known planets. The innermost, 55 Cancri e, is a super-Earth so close to its star that its day side is likely an ocean of magma; JWST found signs of an atmosphere.',
    references: ['Fischer et al. 2008, ApJ 675, 790', 'Hu et al. 2024, Nature 630, 609'],
  },
  {
    host: 'HR 8799', title: 'HR 8799', aliases: [], importance: 58,
    tagline: 'Four giant planets photographed directly',
    story:
      'HR 8799 was the first planetary system to be photographed. Its four young giants are so far from their star, and still so hot from their formation, that telescopes see them glowing by their own heat.',
    references: ['Marois et al. 2008, Science 322, 1348', 'Marois et al. 2010, Nature 468, 1080'],
  },
  {
    host: 'GJ 581', title: 'Gliese 581', aliases: ['Gliese 581', 'GJ581'], importance: 48,
    tagline: 'Planets, and a cautionary tale about "habitable" claims',
    story:
      'Gliese 581 has three confirmed planets. Two more, once announced as habitable, turned out to be signals from the star\'s own magnetic activity: a reminder that extraordinary claims need careful checks.',
    references: ['Udry et al. 2007, A&A 469, L43', 'Robertson et al. 2014, Science 345, 440'],
  },
  {
    host: 'tau Cet', title: 'Tau Ceti', aliases: ['Tau Ceti', 'τ Cet', 'HD 10700'], importance: 54,
    tagline: 'A nearby Sun-like star with candidate super-Earths',
    story:
      'Tau Ceti is one of the closest Sun-like stars, 12 light years away. Tiny radial-velocity signals suggest several super-Earths; they are hard to confirm because each tugs the star by less than a metre per second.',
    references: ['Feng et al. 2017, AJ 154, 135'],
  },
  {
    host: 'eps Eri', title: 'Epsilon Eridani', aliases: ['Epsilon Eridani', 'ε Eri', 'Ran'], importance: 54,
    tagline: 'A young nearby star with a giant planet and dust belts',
    story:
      'Epsilon Eridani is a young star 10.5 light years away, surrounded by belts of dust and ice like a younger Solar System. A planet a little smaller than Jupiter orbits it every seven years.',
    references: ['Hatzes et al. 2000, ApJ 544, L145', 'Mawet et al. 2019, AJ 157, 33'],
  },
];

export const SHOWCASE_BY_HOST: ReadonlyMap<string, ShowcaseSystem> = new Map(SHOWCASE.map((s) => [s.host, s]));

/**
 * Kepler-16 B (Doyle et al. 2011, Science 333, 1602, Table 1): binary period 41.079220 d, a = 0.22431 AU,
 * e = 0.15944, i = 90.3401°, ω = 263.464°, M_B = 0.20255 M☉, R_B = 0.22623 R☉, primary eclipse BJD 2455212.12316.
 * Teff_B ≈ 3300 K is an estimate for a 0.2 M☉ M dwarf (Doyle et al. give only the flux ratio).
 */
function kepler16B(): CompanionStar {
  const teff = 3300;
  const rM = 0.22623 * R_SUN_M;
  const mA = 0.6897, mB = 0.20255;
  const omega = (263.464 * Math.PI) / 180;
  return {
    star: {
      name: 'Kepler-16 B', teffK: teff, radiusM: rM, massKg: mB * M_SUN_KG,
      luminosityW: 4 * Math.PI * rM * rM * SIGMA_SB * teff ** 4, estimated: 1 | 8,
    },
    periodS: 41.07922 * 86_400,
    aM: 0.22431 * AU_M,
    ecc: 0.15944,
    inclRad: (90.3401 * Math.PI) / 180,
    omegaRad: omega,
    // Primary eclipse: B passes in front of A, at true anomaly f = π/2 − ω.
    meanAnomalyEpochRad: trueToMeanAnomaly(Math.PI / 2 - omega, 0.15944),
    epochJd: 2_455_212.12316,
    massFraction: mB / (mA + mB),
    source: 'Doyle et al. 2011, Science 333, 1602',
  };
}

/** Extras per showcase host (companion stars, observed planet temperatures). */
export function showcaseExtras(host: string): SystemExtras {
  if (host === 'Kepler-16') return { companion: kepler16B() };
  if (host === 'HR 8799') {
    // Effective temperatures from the planets' own infrared spectra (Marois et al. 2008; e: Marois et al. 2010).
    return { internalTeffK: { 'HR 8799 b': 870, 'HR 8799 c': 1090, 'HR 8799 d': 1090, 'HR 8799 e': 1150 } };
  }
  return {};
}

/** Luminosity helper (W) for display. */
export const lSun = (w: number): number => w / L_SUN_W;
