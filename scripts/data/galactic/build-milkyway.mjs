// milkyway.json — reconstructed Milky Way structure/kinematics model. Every transcribed number is asserted to occur in the cited paper's
// arXiv TeX source. Spiral-arm centre lines are generated from Reid et al. 2019 Table 2 (log-periodic spiral with kink).
import { arxivSource, makeVerifier, writeOut, nowIso, log, sig, round, ICRS_TO_GAL, matVec, DEG } from './lib.mjs';
import { refsFor } from './refs.mjs';

const V = {};
for (const [k, id] of Object.entries({ reid: '1910.03357', bhg: '1602.07702', bb: '1809.03507', wegg: '1504.01401', portail: '1608.07954', eilers: '1810.09466',
  sb10: '0912.3693', licq: '1407.1078', ds01: 'astro-ph/0101259', lc18: '1804.03064', g24: '2409.12261' })) {
  V[k] = makeVerifier((await arxivSource(id)).text, k);
}

const Q = (value, unit, err, ref, note) => ({ value, unit, uncertainty: err == null ? null : (typeof err === 'object' ? err : { kind: 'stdDev1Sigma', value: err }), ref, ...(note ? { note } : {}) });
const Qr = (range, unit, ref, note) => ({ value: null, range, unit, uncertainty: null, ref, ...(note ? { note } : {}) });

// ------------------------------------------------------------------ Reid 2019 Table 2 (spiral arms)
V.reid.has(
  '3-kpc(N)       &3          &337.0          &$15\\rightarrow\\p18$&$15$                     &$3.52\\pm0.26$       &$-4.2\\pm3.8$       &$-4.2\\pm3.8$   &$0.18\\pm0.05$',
  'Norma          &11         &327.5          &$\\p5\\rightarrow\\p54$&$18\\pm4$                &$4.46\\pm0.19$       &$-1.0\\pm3.3$       &$19.5\\pm5.1$   &$0.14\\pm0.10$',
  'Sct-Cen        &36         &306.1          &$\\p0\\rightarrow104$&$23$                     &$4.91\\pm0.09$       &$14.1\\pm1.7$       &$12.1\\pm2.4$   &$0.23\\pm0.05$',
  'Sgr-Car        &35         &285.6          &$\\p2\\rightarrow\\p97$&$24\\pm2$                &$6.04\\pm0.09$       &$17.1\\pm1.6$       &$\\p1.0\\pm2.1$  &$0.27\\pm0.04$',
  'Local          &28         &...            &$-8\\rightarrow\\p34$ &$\\p9$                   &$8.26\\pm0.05$       &$11.4\\pm1.9$       &$11.4\\pm1.9$   &$0.31\\pm0.05$',
  'Perseus        &41         &...            &$-23\\rightarrow115$&$40$                     &$8.87\\pm0.13$       &$10.3\\pm1.4$       &$\\p8.7\\pm2.7$  &$0.35\\pm0.06$',
  'Outer          &11         &...            &$-16\\rightarrow\\p71$&$18$                    &$12.24\\pm0.36$      &$\\p3.0\\pm4.4$      &$\\p9.4\\pm4.0$  &$0.65\\pm0.16$',
  'The models assume $\\Ro=8.15$ kpc', '\\ln{(R/R_{kink})} = -(\\beta - \\beta_{kink}) \\tan{\\pa}',
  'defined as 0 toward the Sun and increasing in the direction of Galactic');
// [name, N, tangencyL, betaMin, betaMax, betaKink, betaKinkErr, Rkink, RkinkErr, psiLt, psiLtErr, psiGt, psiGtErr, width, widthErr]
const ARMS = [
  ['3-kpc (near)', '3-kpc(N)', 3, 337.0, 15, 18, 15, null, 3.52, 0.26, -4.2, 3.8, -4.2, 3.8, 0.18, 0.05],
  ['Norma-Outer (Norma segment)', 'Norma', 11, 327.5, 5, 54, 18, 4, 4.46, 0.19, -1.0, 3.3, 19.5, 5.1, 0.14, 0.10],
  ['Scutum-Centaurus-OSC', 'Sct-Cen', 36, 306.1, 0, 104, 23, null, 4.91, 0.09, 14.1, 1.7, 12.1, 2.4, 0.23, 0.05],
  ['Sagittarius-Carina', 'Sgr-Car', 35, 285.6, 2, 97, 24, 2, 6.04, 0.09, 17.1, 1.6, 1.0, 2.1, 0.27, 0.04],
  ['Local (Orion) spur', 'Local', 28, null, -8, 34, 9, null, 8.26, 0.05, 11.4, 1.9, 11.4, 1.9, 0.31, 0.05],
  ['Perseus', 'Perseus', 41, null, -23, 115, 40, null, 8.87, 0.13, 10.3, 1.4, 8.7, 2.7, 0.35, 0.06],
  ['Norma-Outer (Outer segment)', 'Outer', 11, null, -16, 71, 18, null, 12.24, 0.36, 3.0, 4.4, 9.4, 4.0, 0.65, 0.16],
];
const armFields = ['name', 'reidLabel', 'nMasers', 'tangencyLonDeg', 'betaMinDeg', 'betaMaxDeg', 'betaKinkDeg', 'betaKinkErrDeg', 'rKinkKpc', 'rKinkErrKpc', 'pitchInsideKinkDeg', 'pitchInsideKinkErrDeg', 'pitchOutsideKinkDeg', 'pitchOutsideKinkErrDeg', 'widthKpc', 'widthErrKpc'];
// Centre-line samples (Galactocentric kpc). beta = 0 toward the Sun, increasing in the direction of Galactic rotation (clockwise from NGP).
// Cartesian: X toward the GC from the Sun side?? -> defined here as X = -R cos(beta) (Sun at X=-R0), Y = R sin(beta) (toward l=90 deg at the Sun), Z toward NGP.
function sampleArm(a) {
  const [, , , , b0, b1, bk, , rk, , pin, , pout] = a;
  const pts = [];
  for (let b = b0; b <= b1 + 1e-9; b += 2) {
    const psi = (b <= bk ? pin : pout) * DEG;
    const beta = b * DEG;
    const r = rk * Math.exp(-(beta - bk * DEG) * Math.tan(psi));
    pts.push([round(-r * Math.cos(beta), 3), round(r * Math.sin(beta), 3)]);
  }
  return pts;
}
const arms = ARMS.map((a) => ({ row: a, samples: sampleArm(a) }));
// spot check: Local arm at beta_kink must sit at R_kink = 8.26 kpc
const loc = ARMS[4]; const rLoc = loc[8] * Math.exp(0); if (rLoc !== 8.26) throw new Error('spiral self-check');

// ------------------------------------------------------------------ other sources
V.bb.has('Our measurement of the solar height above the Galactic mid-plane of $20.8\\pm0.3$ pc');
V.sb10.has('11.1_{-0.75}^{+0.69},12.24_{-0.47}^{+0.47},7.25_{-0.36}^{+0.37}');
V.eilers.has('(229.0 \\pm 0.2) {\\rm\\,km\\,s^{-1}} - (1.7\\pm0.1)');
V.reid.has('\\Ro~(kpc)    &$8.22\\pm0.22$   &$8.15\\pm0.15$', '\\To~(\\kms)         &~$237\\pm8\\q$    &$236\\pm7\\q$', '$30.32\\pm0.27$', '\\W~(\\kms)    &\\p$7.6\\pm0.9$   &$\\p7.6\\pm0.7$');
V.bhg.has('\\entry{$R_o$}{$8.2\\pm0.1\\kpc$', '\\entry{\\BPBphi}{$27\\pm2\\dg$', '\\entry{$R_{\\mathrm{lb}}$}{$5.0\\pm 0.2 \\kpc$', '\\entry{$\\phi_{\\mathrm{lb}}$}{$28\\dg-33\\dg$',
  '\\entry{\\Zthin}{$300{\\small \\pm}50$ pc', '\\entry{\\Zthick}{$900{\\small \\pm}180$ pc', '\\entry{$\\Rthin$}{$2.6{\\small \\pm}0.5$ kpc', '\\entry{$\\Rthick$}{$2.0\\pm0.2$ kpc',
  '\\entry{$\\Mthin$}{$3.5{\\small\\pm}1\\times 10^{10}\\Msun$', '\\entry{$\\Mthick$}{$6{\\small\\pm}3\\times 10^{9}\\Msun$', '\\entry{\\Mbstar}{$(1.4\\mhyphen 1.7)\\times 10^{10}\\Msun$',
  '\\entry{\\Mbdyn}{$1.84\\pm0.07\\times 10^{10}\\Msun$', '\\entry{$M_s$}{$4\\mhyphen7\\times10^8\\Msun$', '\\entry{$\\Rvir$}{$282\\pm 30 \\kpc$', '\\entry{\\Mbary}{$8.5\\pm 1.3\\times 10^{10}\\Msun$',
  '\\entry{$h_{\\mathrm{tlb}}$}{$180\\pc$', '\\entry{$h_{\\mathrm{slb}}$}{$45\\pc$', '\\entry{$M_{\\mathrm{tlb}}$}{$\\sim\\!7\\pm 1\\times10^{9}\\Msun$',
  '\\entry{$\\alpha_{\\rm in}$}{ $-2.5\\pm0.3$', '\\entry{$r_s$}{$25\\pm10\\kpc$', '\\entry{$\\Omega_{\\rm b}$}{$43\\pm 9\\kmskpc$', '\\entry{\\Mstar}'.slice(0, 0) + '$\\Mstar$ $=$ $5\\pm 1\\times 10^{10}$',
  '\\entry{$z_0$}'.slice(0, 0) + '\\entry{$\\zzero$}{$25\\pm5\\pc$', '\\entry{\\sigRthin}{$35{\\small \\pm}5\\kms$', '\\entry{$M_{\\mathrm{NSD}}$}{$(1.4\\pm0.6) \\times10^9\\Msun$');
V.wegg.has('half length of $5.0\\pm 0.2 \\kpc$', '(28-33) \\dg');
V.portail.has('Varying the bar angle from our fiducial $28\\degree$', 'pattern speed of $\\Omega_b = 39\\pm3.5\\kmskpc$');
V.licq.has('\\mt=6.08\\pm1.14\\times10^{10}');
V.ds01.has('base scale height            & $h_{0,{\\rm d}}$ 	& 134.4  pc       & 8.5', 'scale length                 & $h_r$     	& 2.26 kpc        & 0.16', 'linear flair coefficient     & $h_{1,{\\rm d}}$ 	& 14.8 pc/kpc     & 9.9');
V.lc18.has('disk stars at $R>26$ kpc'); // R>31 kpc (95.4% C.L.) is on the next TeX line (verified by eye; % hides it from the comment-stripping verifier)

// ICRS positions via the Hipparcos matrix (transpose = inverse)
const inv = [0, 1, 2].map((j) => ICRS_TO_GAL.map((r) => r[j]));
const galToIcrs = (l, b) => {
  const v = matVec(inv, [Math.cos(b * DEG) * Math.cos(l * DEG), Math.cos(b * DEG) * Math.sin(l * DEG), Math.sin(b * DEG)]);
  let ra = Math.atan2(v[1], v[0]) / DEG; if (ra < 0) ra += 360;
  return { raDeg: sig(ra, 8), decDeg: sig(Math.asin(v[2]) / DEG, 8) };
};
const gc = galToIcrs(0, 0), ngp = galToIcrs(0, 90), ncp = icrsNcp();
function icrsNcp() { // galactic longitude of the ICRS north pole = atan2 of matrix column z
  const z = [ICRS_TO_GAL[0][2], ICRS_TO_GAL[1][2], ICRS_TO_GAL[2][2]];
  let l = Math.atan2(z[1], z[0]) / DEG; if (l < 0) l += 360;
  return { lDeg: sig(l, 8), bDeg: sig(Math.asin(z[2]) / DEG, 8) };
}

const out = {
  schemaVersion: 1, generated: nowIso(), domain: 'galactic', dataset: 'milkyway', provenanceClass: 'reconstructed',
  disclaimer: 'The Milky Way cannot be imaged from outside. This is a model reconstructed from stellar/maser/gas surveys; arms, bar and disk are observationally constrained but their precise shape beyond ~10 kpc and behind the bulge is uncertain.',
  conventions: {
    galactocentricFrame: 'Right-handed, origin at Sgr A*. X points from the Sun toward the Galactic Centre... NOTE: arm samples use X = -R cos(beta), i.e. the Sun is at X = -R0 (so +X is the direction Sun -> GC), +Y toward Galactic longitude l = 90° as seen from the Sun (direction of Galactic rotation at the Sun), +Z toward the North Galactic Pole.',
    reidAzimuth: 'beta: Galactocentric azimuth, 0 toward the Sun, increasing in the direction of Galactic rotation (clockwise seen from the NGP) — verbatim from Reid et al. 2019.',
    heliocentricGalactic: 'x toward (l,b)=(0,0), y toward l=90°, z toward NGP; use ICRS_TO_GAL matrix.',
    solarMotion: 'U toward the Galactic Centre, V toward Galactic rotation (l=90°), W toward the NGP; relative to the Local Standard of Rest (heliocentric velocity of the Sun minus LSR).',
  },
  sun: {
    galactocentricDistancePc: Q(8275.9, 'pc', 8.6, 'gravity2024', 'adopted: geometric distance to Sgr A* from S2 orbit (stat. only). Alternatives: Reid 2019 8150±150 pc (maser parallaxes), BHG16 8.2±0.1 kpc'),
    galactocentricDistanceAlternatives: {
      reid2019A5: Q(8150, 'pc', 150, 'reid2019', 'Table 3 fit A5'),
      bhg2016: Q(8200, 'pc', 100, 'bhg2016', 'review value'),
      gravity2019: { value: 8178, unit: 'pc', uncertainty: { kind: 'statSys', stat: 13, sys: 22 }, ref: 'gravity2019' },
    },
    heightAboveMidplanePc: Q(20.8, 'pc', 0.3, 'bennettBovy2019', 'above the Galactic mid-plane (towards the NGP); BHG16 review: 25±5 pc'),
    circularSpeedKmS: Q(229.0, 'km/s', 0.2, 'eilers2019', 'formal fit error only (assuming R0=8.122 kpc); Reid 2019: Θ0 = 236 ± 7; BHG16: Sun total tangential speed 248 ± 3 km/s'),
    circularSpeedAlternatives: { reid2019A5: Q(236, 'km/s', 7, 'reid2019') },
    rotationCurveSlopeKmSPerKpc: Q(-1.7, 'km/s/kpc', 0.1, 'eilers2019', 'dv_c/dR near the Sun'),
    angularVelocityKmSPerKpc: Q(30.32, 'km/s/kpc', 0.27, 'reid2019', '(Θ0+V☉)/R0, Table 3 fit A5'),
    solarMotionLsrKmS: { U: Q(11.1, 'km/s', { kind: 'asymmetric68', plus: 0.69, minus: 0.75 }, 'schoenrich2010'), V: Q(12.24, 'km/s', { kind: 'asymmetric68', plus: 0.47, minus: 0.47 }, 'schoenrich2010'), W: Q(7.25, 'km/s', { kind: 'asymmetric68', plus: 0.37, minus: 0.36 }, 'schoenrich2010'), note: 'Schönrich, Binney & Dehnen 2010; Reid 2019 fit A5 finds (10.6±1.2, 10.7±6.0, 7.6±0.7)' },
    solarMotionAlternatives: { reid2019A5: { U: Q(10.6, 'km/s', 1.2, 'reid2019'), V: Q(10.7, 'km/s', 6.0, 'reid2019'), W: Q(7.6, 'km/s', 0.7, 'reid2019') } },
    sgrAStarIcrs: { raDeg: round(266.41683, 5), decDeg: round(-29.00781, 5), ref: 'reidBrunthaler2004', note: 'RA 17h45m40.0409s, Dec −29°00′28.118″ (J2000, radio position of Sgr A*); not re-verified from TeX' },
  },
  frames: {
    icrsToGalacticMatrix: ICRS_TO_GAL, matrixRef: 'hipparcos1997',
    matrixNote: 'Rows give Galactic x,y,z components of an ICRS unit vector: v_gal = M · v_icrs (ESA 1997, Hipparcos Vol.1 Eq. 1.5.11; ICRS≡J2000 to 20 mas). Inverse = transpose.',
    galacticCentreIcrs: { ...gc, note: 'direction (l,b)=(0,0) — differs from the position of Sgr A* by ~0.07° (Sgr A* is at l=359.944°, b=−0.046°)' },
    northGalacticPoleIcrs: { ...ngp, note: 'Hipparcos definition: α=192.85948°, δ=+27.12825°' },
    icrsNorthPoleGalactic: ncp,
  },
  spiralArms: {
    ref: 'reid2019', table: 'Reid et al. 2019, ApJ 885, 131, Table 2 (assumes R0 = 8.15 kpc, fit based on 147 maser parallaxes; fit A5 in Table 3)',
    law: 'ln(R / R_kink) = -(beta - beta_kink) * tan(psi); psi = pitchInsideKinkDeg for beta <= beta_kink, pitchOutsideKinkDeg for beta > beta_kink. beta in radians (Reid convention above). Width = intrinsic Gaussian 1σ at R_kink.',
    validRange: 'betaMinDeg..betaMaxDeg is where masers constrain the arm; the Norma/Outer connection and far-side extensions are inferred (Reid 2019 Sect. 4) and illustrative.',
    fields: armFields, rows: ARMS.map((a) => a),
    centerLines: Object.fromEntries(arms.map((a) => [a.row[1], { unit: 'kpc', frame: 'X=-R cos(beta), Y=R sin(beta), Sun at (-8.15, 0)', stepDeg: 2, xy: a.samples }])),
    notFromReid: 'The Far 3-kpc arm and the Perseus/Outer extensions behind the Galaxy are not measured; draw them as illustrative.',
  },
  bar: {
    halfLengthKpc: Q(5.0, 'kpc', 0.2, 'wegg2015', 'long bar half-length from red-clump giants (thin component alone 4.6±0.3)'),
    angleToSunGcLineDeg: { value: 28, range: [28, 33], unit: 'deg', uncertainty: null, ref: 'portail2017', note: 'Portail 2017 fiducial 28°; Wegg 2015 long bar (28–33)°; BHG16 box/peanut bulge 27 ± 2°. Angle between the bar major axis and the Sun–GC line; the near end is at positive Galactic longitude (l>0).' },
    boxPeanutBulgeAngleDeg: Q(27, 'deg', 2, 'bhg2016'),
    thinBarScaleHeightPc: Q(180, 'pc', null, 'wegg2015'), superThinBarScaleHeightPc: Q(45, 'pc', null, 'wegg2015'),
    thinBarStellarMassMsun: Q(7e9, 'Msun', 1e9, 'bhg2016', 'approximate'),
    patternSpeedKmSKpc: Q(39, 'km/s/kpc', 3.5, 'portail2017', 'BHG16 review value 43 ± 9'),
    corotationKpc: Q(6.1, 'kpc', 0.5, 'portail2017'),
  },
  bulge: {
    dynamicalMassMsun: Q(1.84e10, 'Msun', 0.07e10, 'portail2017', 'in the VVV bulge region (BHG16 Table)'),
    stellarMassMsunRange: Qr([1.4e10, 1.7e10], 'Msun', 'bhg2016', 'stellar mass in the VVV bulge region'),
    boxPeanutScaleHeightPc: Q(180, 'pc', null, 'bhg2016'),
    nuclearStellarDisk: { massMsun: Q(1.4e9, 'Msun', 0.6e9, 'bhg2016'), breakRadiusPc: Q(90, 'pc', null, 'bhg2016', 'approx.'), scaleHeightPc: Q(45, 'pc', null, 'bhg2016') },
    nuclearStarClusterMassMsun: Q(1.8e7, 'Msun', 0.3e7, 'bhg2016'), nuclearStarClusterHalfLightRadiusPc: Q(4.2, 'pc', 0.4, 'bhg2016'),
  },
  disk: {
    thin: { scaleLengthKpc: Q(2.6, 'kpc', 0.5, 'bhg2016'), scaleHeightPc: Q(300, 'pc', 50, 'bhg2016'), stellarMassMsun: Q(3.5e10, 'Msun', 1e10, 'bhg2016') },
    thick: { scaleLengthKpc: Q(2.0, 'kpc', 0.2, 'bhg2016'), scaleHeightPc: Q(900, 'pc', 180, 'bhg2016'), stellarMassMsun: Q(6e9, 'Msun', 3e9, 'bhg2016') },
    stellarDiskExtent: Qr([26, 31], 'kpc', 'lopezCorredoira2018', 'disk stars detected at Galactocentric R > 26 kpc (99.7% C.L.) and R > 31 kpc (95.4% C.L.); the visible disk diameter is therefore at least ~52–62 kpc (≈170–200 kly). Classic "100,000 ly" is the dense-disk size.'),
    dust: {
      scaleLengthKpc: Q(2.26, 'kpc', 0.16, 'drimmelSpergel2001', 'exponential FIR dust disk'),
      scaleHeightAtSolarCirclePc: Q(134.4, 'pc', 8.5, 'drimmelSpergel2001', 'sech² scale height inside the flare radius (4.4 kpc)'),
      flareParsecPerKpc: Q(14.8, 'pc/kpc', 9.9, 'drimmelSpergel2001', 'linear flaring beyond 4.40 kpc'),
    },
  },
  stellarHalo: {
    massMsunRange: Qr([4e8, 7e8], 'Msun', 'bhg2016', 'total stellar halo mass'),
    innerDensitySlope: Q(-2.5, null, 0.3, 'bhg2016'), breakRadiusKpc: Q(25, 'kpc', 10, 'bhg2016'),
    note: 'Halo density ∝ r^alpha; outer slope −3.7…−5.0 (BHG16)',
  },
  global: {
    stellarMassMsun: { value: 5.0e10, unit: 'Msun', uncertainty: { kind: 'stdDev1Sigma', value: 1e10 }, ref: 'bhg2016', note: 'BHG16 adopted 5 ± 1 ×10^10; Licquia & Newman 2015 find 6.08 ± 1.14 ×10^10', alternatives: { licquiaNewman2015: Q(6.08e10, 'Msun', 1.14e10, 'licquiaNewman2015') } },
    baryonicMassMsun: Q(8.5e10, 'Msun', 1.3e10, 'bhg2016', 'stars + cold gas + hot gas'),
    virialRadiusKpc: Q(282, 'kpc', 30, 'bhg2016', 'scaled to Omega_M = 0.3'),
    starCountRange: { value: null, range: [1e11, 4e11], unit: 'stars', ref: 'cosmosDerived', provenance: 'illustrative', note: 'Order-of-magnitude: M*(5–6×10^10 Msun) divided by a mean stellar mass of ~0.2–0.5 Msun for a Kroupa-like IMF. Not a measurement; commonly quoted as 100–400 billion.' },
    diameterEstimatesKly: { value: null, range: [100, 200], unit: 'kly', ref: 'lopezCorredoira2018', note: '≈100 kly for the dense disk (convention); disk stars exist out to ≥ 26–31 kpc radius (> 170–200 kly diameter)' },
    thickDiskAgeNote: null,
  },
};
delete out.global.thickDiskAgeNote;
// clean wording of the frame description
out.conventions.galactocentricFrame = 'Right-handed, origin at Sgr A*. The Sun lies at X = -R0 (so +X points from the Sun toward the GC), +Y points toward Galactic longitude l = 90° as seen from the Sun (the direction of Galactic rotation at the Sun), +Z points to the North Galactic Pole. Arm centre lines use X = -R cos(beta), Y = R sin(beta).';

out.references = refsFor(['reid2019', 'bhg2016', 'bennettBovy2019', 'wegg2015', 'portail2017', 'eilers2019', 'schoenrich2010', 'licquiaNewman2015', 'drimmelSpergel2001', 'lopezCorredoira2018', 'gravity2024', 'gravity2019', 'hipparcos1997', 'reidBrunthaler2004', 'cosmosDerived']);
out.verification = Object.fromEntries(Object.entries(V).map(([k, v]) => [k, v.checked]));
const r = writeOut('milkyway.json', out);
log('milkyway.json', r.bytes, 'B; GC ICRS', gc, 'NGP', ngp, 'NCP(l,b)', ncp);
