// sgra.json — Sgr A* black hole parameters (GRAVITY, EHT) + S-star orbital elements (GRAVITY 2020 S2; Gillessen+2017 table3, 40 stars).
// Transcribed literals are asserted to exist in the authors' arXiv TeX; Gillessen elements are parsed from the CDS table3.dat.
import { arxivSource, makeVerifier, cached, CDSARC, parseFixedWidth, writeOut, nowIso, log, sig, round, fail } from './lib.mjs';
import { refsFor } from './refs.mjs';

const g20 = makeVerifier((await arxivSource('2004.07187')).text, 'GRAVITY2020');
const g22 = makeVerifier((await arxivSource('2112.07478')).text, 'GRAVITY2022');
const g24 = makeVerifier((await arxivSource('2409.12261')).text, 'GRAVITY2024');
const g19 = makeVerifier((await arxivSource('1904.05721')).text, 'GRAVITY2019');
const eht1 = makeVerifier((await arxivSource('2311.08680')).text, 'EHT-I');
const gi17 = makeVerifier((await arxivSource('1611.09144')).text, 'Gillessen2017');

// ---- literals (value, error) with evidence snippets
g20.has('M_\\bullet$ & 4.261 & 0.012 & 0.012', 'R_0$ & 8246.7 & 9.3 & 9.3', '$a$ & 125.058 & 0.041 & 0.044 & mas', '$e$ & 0.884649 & 0.000066  & 0.000079',
  '$i$ & 134.567 &0.033 & 0.033', '$\\omega$ & 66.263 & 0.031 & 0.030', '$\\Omega$ & 228.171&0.031 & 0.031', '$P$ & 16.0455 & 0.0013 & 0.0013',
  't_{\\rm peri}$ & 2018.37900 & 0.00016 & 0.00017', 'f_\\mathrm{SP}$ & 1.10 & 0.19 & 0.21');
g24.has('M_\\bullet$ [$10^6 M_\\odot$]& 4.2996 &	0.0118', 'R_0$ [pc]& 8275.9	& 8.6', 'f_{SP}$ & 1.1350 &	0.1104');
g22.has('M_\\bullet \\,[10^6 M_\\odot]$ & 4.297 & 0.012', 'R_0 \\,[\\mathrm{pc}]$&8277&9');
g19.has('R_0  = 8178 \\pm 13_\\mathrm{stat.} \\pm 22_\\mathrm{sys.}\\,\\mathrm{pc}');
eht1.has('Diameter, $d$             & $51.8 \\pm 2.3\\,\\mu{\\rm as}$', 'M$  & $4.0_{-0.6}^{+1.1}\\times10^6 \\,M_{\\odot}$',
  '\\theta_{\\rm g}$   & $4.8_{-0.7}^{+1.4}\\,\\mu{\\rm as}$', '\\pm 0.009 \\pm 0.020\\,\\mu{\\rm as}');
gi17.has('R_0 &=& 8.323 \\pm 0.070', 'M &=& 4.280 \\pm 0.103 \\times 10^6');

const U = (v, err, kind = 'stdDev1Sigma') => ({ kind, value: err });
const Q = (value, unit, err, ref, note) => ({ value, unit, uncertainty: err == null ? null : U(value, err), ref, ...(note ? { note } : {}) });

// ---- physical constants (IAU 2015 nominal / CODATA 2018)
const GMSUN = 1.32712440018e20, C = 299792458, AU = 149597870700, PC = AU * 648000 / Math.PI, RAD2UAS = 180 / Math.PI * 3600 * 1e6;
const M = 4.2996e6; // GRAVITY 2024
const R0pc = 8275.9;
const gm = GMSUN * M;
const rg = gm / C ** 2; // m
const derived = {
  gravitationalRadiusKm: Q(sig(rg / 1e3, 8), 'km', null, 'cosmosDerived', 'r_g = GM/c^2 with M=4.2996e6 Msun (GRAVITY 2024)'),
  schwarzschildRadiusKm: Q(sig(2 * rg / 1e3, 8), 'km', null, 'cosmosDerived', 'r_s = 2GM/c^2 (~0.082 AU)'),
  schwarzschildRadiusAu: Q(sig(2 * rg / AU, 6), 'AU', null, 'cosmosDerived'),
  photonSphereRadiusKm: Q(sig(3 * rg / 1e3, 8), 'km', null, 'cosmosDerived', '1.5 r_s, non-spinning'),
  shadowRadiusKm: Q(sig(Math.sqrt(27) * rg / 1e3, 8), 'km', null, 'cosmosDerived', 'critical impact parameter sqrt(27) GM/c^2 for a = 0 (spin changes it by <~5%)'),
  angularGravitationalRadiusMicroArcsec: Q(sig(rg / (R0pc * PC) * RAD2UAS, 5), 'uas', null, 'cosmosDerived', 'theta_g = GM/(c^2 D) with GRAVITY 2024 M and R0'),
  angularShadowDiameterMicroArcsec: Q(sig(2 * Math.sqrt(27) * rg / (R0pc * PC) * RAD2UAS, 5), 'uas', null, 'cosmosDerived', 'Schwarzschild shadow diameter; EHT measured ring diameter is 51.8 ± 2.3 uas (ring is not the shadow edge exactly)'),
};

// ---- S2 (GRAVITY 2020 Table: fit errors; MCMC error also available)
const s2 = {
  id: 'S2', alias: ['S0-2'], ref: 'gravity2020',
  note: 'GRAVITY Collaboration 2020 (A&A 636, L5) best-fit with Schwarzschild precession fSP free; first 4 orbital elements are for the osculating Keplerian orbit',
  semiMajorAxisMas: Q(125.058, 'mas', 0.041), eccentricity: Q(0.884649, null, 0.000066),
  inclinationDeg: Q(134.567, 'deg', 0.033), longitudeAscendingNodeDeg: Q(228.171, 'deg', 0.031), argumentPericentreDeg: Q(66.263, 'deg', 0.031),
  periodYr: Q(16.0455, 'yr', 0.0013), tPeriYr: Q(2018.379, 'yr', 0.00016, undefined, 'decimal year (2018.379 = 2018 May 19)'),
  distanceR0Pc: Q(8246.7, 'pc', 9.3), centralMassMsun: Q(4.261e6, 'Msun', 0.012e6),
  fSchwarzschildPrecession: Q(1.10, null, 0.19, undefined, '1 = GR; 0 = Newton'),
  errorsMcmcMultiplier: { semiMajorAxisMas: 0.044, eccentricity: 0.000079, inclinationDeg: 0.033, longitudeAscendingNodeDeg: 0.031, argumentPericentreDeg: 0.030, periodYr: 0.0013, tPeriYr: 0.00017 },
};
// GRAVITY 2024 S2 fit (extended-mass paper) mass+R0+fSP
const sgrA = {
  mass: {
    adopted: Q(4.2996e6, 'Msun', 0.0118e6, 'gravity2024', 'GRAVITY 2024 (A&A 692, A242) fit of S2/S29/S38/S55 (+ precession); stat. error only. Mass scales as R0^2; do not add this error to R0 error'),
    gravity2022: Q(4.297e6, 'Msun', 0.012e6, 'gravity2022', 'stat. error; paper quotes additional systematic error — see paper'),
    gravity2020: Q(4.261e6, 'Msun', 0.012e6, 'gravity2020', 'S2 only, with R0=8246.7 pc'),
    gillessen2017: Q(4.28e6, 'Msun', 0.10e6, 'gillessen2017', '+/-0.21e6 systematic (17-star combined fit)'),
    eht2022: { value: 4.0e6, unit: 'Msun', uncertainty: { kind: 'asymmetric68', plus: 1.1e6, minus: 0.6e6 }, ref: 'eht2022a', note: 'EHT-only estimate from the ring, using the Reid 2019 maser distance; consistent with stellar orbits. Stellar orbits are far more precise' },
  },
  distanceR0: {
    adopted: Q(8275.9, 'pc', 8.6, 'gravity2024', 'stat.'),
    gravity2022: Q(8277, 'pc', 9, 'gravity2022', 'stat.; systematic error ±33 pc'),
    gravity2020: Q(8246.7, 'pc', 9.3, 'gravity2020'),
    gravity2019: { value: 8178, unit: 'pc', uncertainty: { kind: 'statSys', stat: 13, sys: 22 }, ref: 'gravity2019' },
    gillessen2017: { value: 8323, unit: 'pc', uncertainty: { kind: 'stdDev1Sigma', value: 70 }, ref: 'gillessen2017', note: 'sys. ±140 pc' },
  },
  ehtRing: {
    diameterMicroArcsec: Q(51.8, 'uas', 2.3, 'eht2022a', 'EHT 2017 observations, 1.3 mm; Paper I Table 1'),
    angularGravitationalRadiusMicroArcsec: { value: 4.8, unit: 'uas', uncertainty: { kind: 'asymmetric68', plus: 1.4, minus: 0.7 }, ref: 'eht2022a' },
    fractionalWidth: { value: null, range: [0.3, 0.5], ref: 'eht2022a', note: 'W/d ~30–50%' },
    note: 'The ring orientation/brightness asymmetry is poorly constrained; the ring is lensed emission from hot plasma, not the shadow edge itself',
  },
  spin: {
    value: null, ref: 'eht2022e',
    note: 'The spin of Sgr A* is NOT measured. EHT GRMHD comparison disfavours edge-on and (almost all) retrograde models but does not give a value; neither GRAVITY orbits nor flares give a precise a*. Treat any spin value in visualisations as illustrative.',
  },
  derived,
};

// ---- Gillessen et al. 2017 table3.dat
const t3 = await cached('vizier/J_ApJ_837_30/table3.dat', `${CDSARC}/J/ApJ/837/30/table3.dat`);
const spec = [['star', 1, 4, 'A'], ['flag', 6, 6, 'A'], ['aArcsec', 8, 15, 'F'], ['aErr', 17, 22, 'F'], ['e', 24, 29, 'F'], ['eErr', 31, 36, 'F'], ['i', 38, 43, 'F'], ['iErr', 45, 48, 'F'],
  ['Omega', 50, 55, 'F'], ['OmegaErr', 57, 61, 'F'], ['w', 63, 68, 'F'], ['wErr', 70, 74, 'F'], ['Tp', 76, 82, 'F'], ['TpErr', 84, 89, 'F'], ['Per', 91, 97, 'F'], ['PerErr', 99, 105, 'F'],
  ['spt', 107, 107, 'A'], ['K', 109, 113, 'F'], ['r', 115, 118, 'F']];
const recs = parseFixedWidth(t3.text, spec.map(([n, a, b, t]) => [n, a, b, t === 'F' ? 'F' : 'A']));
if (recs.length !== 40) fail(`expected 40 Gillessen stars, got ${recs.length}`);
const fields = ['id', 'semiMajorAxisMas', 'semiMajorAxisErrMas', 'eccentricity', 'eccentricityErr', 'inclinationDeg', 'inclinationErrDeg', 'longitudeAscendingNodeDeg', 'longitudeAscendingNodeErrDeg',
  'argumentPericentreDeg', 'argumentPericentreErrDeg', 'tPeriYr', 'tPeriErrYr', 'periodYr', 'periodErrYr', 'spectralClass', 'kMag', 'rescalingFactor', 'flag'];
const GI_R0 = 8323, GI_M = 4.28e6;
let worst = 0; const kepler = [];
const rows = recs.map((o) => {
  const aMas = o.aArcsec * 1000; // S111 has negative a (hyperbolic)
  if (o.Per != null && o.aArcsec > 0) {
    const aAu = o.aArcsec * (GI_R0); // arcsec * pc = AU
    const m = aAu ** 3 / o.Per ** 2;
    const dev = m / GI_M - 1; kepler.push([o.star, round(dev, 3)]); worst = Math.max(worst, Math.abs(dev));
  }
  return [o.star, sig(aMas, 6), sig(o.aErr * 1000, 4), o.e, o.eErr, o.i, o.iErr, o.Omega, o.OmegaErr, o.w, o.wErr, o.Tp, o.TpErr, o.Per, o.PerErr,
    o.spt === 'e' ? 'early' : o.spt === 'l' ? 'late' : null, o.K, o.r, o.flag ?? null];
});
const s2row = rows.find((r) => r[0] === 'S2');
if (Math.abs(s2row[1] - 125.5) > 0.5 || Math.abs(s2row[13] - 16.0) > 0.1) fail('S2 row sanity failed');
log('Gillessen stars', rows.length, 'worst Kepler-3 mass deviation vs 4.28e6:', round(worst, 3));

// S2 periapsis geometry (derived)
const aAu = 125.058e-3 * 8246.7, rp = aAu * (1 - 0.884649), P = 16.0455 * 365.25 * 86400;
const vp = Math.sqrt(GMSUN * 4.261e6 * (2 / (rp * AU) - 1 / (aAu * AU)));
s2.derived = {
  semiMajorAxisAu: Q(sig(aAu, 6), 'AU', null, 'cosmosDerived', 'a[mas] × R0[pc] / 1000'),
  pericentreDistanceAu: Q(sig(rp, 5), 'AU', null, 'cosmosDerived', 'paper: ≈120 AU'),
  pericentreSpeedKmS: Q(sig(vp / 1e3, 5), 'km/s', null, 'cosmosDerived', 'vis-viva; paper: ≈7700 km/s'),
  keplerCheckMassMsun: Q(sig(aAu ** 3 / 16.0455 ** 2, 5), 'Msun', null, 'cosmosDerived', "Kepler's 3rd law M = a^3/P^2 (a in AU, P in yr)"),
};

const out = {
  schemaVersion: 1, generated: nowIso(), domain: 'galactic', dataset: 'sgra', provenanceClass: 'observed',
  blackHole: sgrA,
  sStars: {
    s2Gravity2020: s2,
    gillessen2017: {
      ref: 'gillessen2017', source: 'VizieR J/ApJ/837/30 table3.dat (CDS ftp)', stars: rows.length,
      assumedR0Pc: GI_R0, assumedMassMsun: GI_M,
      fields, rows,
      notes: ['semiMajorAxisMas is the angular semi-major axis from Sgr A* (arcsec in the catalogue ×1000); multiply by R0 (pc)/1000 to get AU',
        'S111 has a negative a and e>1 (hyperbolic, formally unbound); its period is null',
        'Elements are rescaled by the factor "rescalingFactor" in the paper; errors are the paper’s combined-fit errors',
        'periodYr/tPeriYr as published; tPeriYr is a fractional year (not JD)'],
    },
    conventions: {
      frame: 'Elements describe the orbit as seen from the Sun on the plane of the sky centred on Sgr A* (visual-binary convention, Thiele–Innes).',
      axes: 'x = offset toward celestial North (Δδ), y = offset toward East (Δα·cosδ), z along the line of sight, positive AWAY from the observer (receding = positive radial velocity).',
      Omega: 'position angle of the ascending node, North through East. The ascending node is the node where the star recedes from us.',
      omega: 'argument of pericentre measured from the ascending node along the direction of motion (Gillessen catalogue label "w" = "longitude of the pericenter"; same quantity, verified against S2 astrometry)',
      i: 'inclination to the plane of the sky; i > 90° = clockwise on the sky (S2: 134°, clockwise).',
      time: 'tPeriYr = decimal year of pericentre passage (fraction of calendar year, UTC-ish; precision beyond ~0.01 yr is not meaningful for Gillessen epochs).',
      implementation: 'scripts/data/galactic/orbits.mjs contains a reference Kepler solver with this convention; to place a star in the Sgr A* frame use a(1−e cosE) etc.',
    },
  },
  validation: { gillessenKeplerMassMaxRelDeviation: round(worst, 3), note: 'M = a^3/P^2 using Gillessen assumed R0=8323 pc vs 4.28e6 Msun; large deviations mean poorly constrained orbits', deviations: kepler },
  verification: { gravity2020: g20.checked, gravity2024: g24.checked, gravity2022: g22.checked, gravity2019: g19.checked, eht2022a: eht1.checked, gillessen2017: gi17.checked },
};
out.references = refsFor(['gravity2024', 'gravity2022', 'gravity2020', 'gravity2019', 'gillessen2017', 'eht2022a', 'eht2022e', 'do2019', 'cosmosDerived']);
const r = writeOut('sgra.json', out);
log('sgra.json', r.bytes, 'B');
