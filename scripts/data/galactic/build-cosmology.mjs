// cosmology.json — Planck 2018 base-LCDM parameters (TT,TE,EE+lowE+lensing+BAO), Fixsen 2009 T_CMB, Planck 2018 I dipole,
// plus derived comoving distances / horizons computed here. Every transcribed literal is asserted to occur in the arXiv TeX.
import { arxivSource, makeVerifier, writeOut, nowIso, log, sig, ICRS_TO_GAL, matVec, DEG } from './lib.mjs';
import { refsFor } from './refs.mjs';
import { makeModel, comovingDistanceMpc, ageGyr, particleHorizonMpc, MPC_IN_GLY, makeRng, meanStd } from './cosmo-math.mjs';

const p6 = makeVerifier((await arxivSource('1807.06209')).text, 'Planck2018VI');
const p1 = makeVerifier((await arxivSource('1807.06205')).text, 'Planck2018I');
const fx = makeVerifier((await arxivSource('0911.1955')).text, 'Fixsen2009');

// Table 2 last column "TT,TE,EE+lowE+lensing+BAO": [value, 1-sigma, unit, TeX snippet that must exist in the source]
const T2 = {
  H0: [67.66, 0.42, 'km s^-1 Mpc^-1', '66.88\\pm 0.92&68.44\\pm 0.91&69.9\\pm 2.7&67.27\\pm 0.60&67.36\\pm 0.54&67.66\\pm 0.42'],
  omegaM: [0.3111, 0.0056, null, '0.3111\\pm 0.0056\\cr'],
  omegaLambda: [0.6889, 0.0056, null, '0.6889\\pm 0.0056\\cr'],
  omegaBh2: [0.02242, 0.00014, null, '0.02242\\pm 0.00014\\cr'],
  omegaCh2: [0.11933, 0.00091, null, '0.11933\\pm 0.00091\\cr'],
  omegaMh2: [0.14240, 0.00087, null, '0.14240\\pm 0.00087\\cr'],
  nS: [0.9665, 0.0038, null, '0.9665\\pm 0.0038\\cr'],
  sigma8: [0.8102, 0.0060, null, '0.8102\\pm 0.0060\\cr'],
  tau: [0.0561, 0.0071, null, '0.0561\\pm 0.0071\\cr'],
  lnAs: [3.047, 0.014, null, '3.047\\pm 0.014\\cr'],
  ageGyr: [13.787, 0.020, 'Gyr', '13.787\\pm 0.020\\cr'],
  zStar: [1089.80, 0.21, null, '1089.80\\pm 0.21\\cr'],
  rStarMpc: [144.57, 0.22, 'Mpc', '144.57\\pm 0.22\\cr'],
  zReion: [7.82, 0.71, null, '7.82\\pm 0.71\\cr'],
  theta100MC: [1.04101, 0.00029, null, '1.04101\\pm 0.00029\\cr'],
};
for (const v of Object.values(T2)) p6.has(v[3]);
const q = (k) => ({ value: T2[k][0], unit: T2[k][2], uncertainty: { kind: 'stdDev1Sigma', value: T2[k][1] }, ref: 'planck2018vi', note: 'Table 2, column TT,TE,EE+lowE+lensing+BAO' });

p1.has('3362.08\\pm*0.99& 264.021\\pm0.011', '369.82\\pm0.11& $264.021\\pm0.011& $48.253\\pm0.005');
fx.has('2.72548', '0.00057');

// ---- derived with central values (flat LCDM + photons + Neff=3.046)
const m = makeModel({ H0: T2.H0[0], Om: T2.omegaM[0], Tcmb: 2.7255 });
const DMstar = comovingDistanceMpc(m, 1 / (1 + T2.zStar[0]), 1);
const horizon = particleHorizonMpc(m);
const age = ageGyr(m, 1);
const rng = makeRng(2018);
const mc = { DM: [], hor: [], age: [] };
for (let i = 0; i < 400; i++) {
  const mm = (() => { const h0 = T2.H0[0] + T2.H0[1] * rng(); const wm = T2.omegaMh2[0] + T2.omegaMh2[1] * rng(); return makeModel({ H0: h0, Om: wm / ((h0 / 100) ** 2) }); })();
  const zs = T2.zStar[0] + T2.zStar[1] * rng();
  mc.DM.push(comovingDistanceMpc(mm, 1 / (1 + zs), 1)); mc.hor.push(particleHorizonMpc(mm)); mc.age.push(ageGyr(mm, 1));
}
const sd = (a) => meanStd(a).std;
// D_M* = r*/theta* (both published; theta* is measured to 0.03%): propagate their errors in quadrature
const DMstarErr = DMstar * Math.hypot(T2.rStarMpc[1] / T2.rStarMpc[0], T2.theta100MC[1] / T2.theta100MC[0]);
const derivedRef = 'cosmosDerived';
const d = (value, unit, std, extra = {}) => ({
  value: sig(value, 7), unit,
  uncertainty: std == null ? null : { kind: std === 0.020 ? 'stdDev1Sigma' : std === DMstarErr ? 'propagatedStdDev' : 'monteCarloStdDev', value: sig(std, 3), note: std === 0.020 ? 'published Planck 2018 VI sigma' : std === DMstarErr ? 'r*/theta* quadrature propagation (published r*, 100theta_MC errors; correlation ignored)' : 'CONSERVATIVE upper bound (reproduces age sigma 0.047 vs published 0.020 Gyr): '+'Gaussian draws of H0 and the physical density omega_m h^2 (Omega_m = omega_m h^2/h^2, which respects the Omega_m-h degeneracy), n=400; residual correlations ignored' },
  ref: derivedRef, ...extra,
});

// ---- CMB dipole direction: Galactic -> ICRS (transpose of the Hipparcos matrix)
const vSun = 369.82, lDip = 264.021, bDip = 48.253;
const gal = [Math.cos(bDip * DEG) * Math.cos(lDip * DEG), Math.cos(bDip * DEG) * Math.sin(lDip * DEG), Math.sin(bDip * DEG)];
const inv = [0, 1, 2].map((j) => ICRS_TO_GAL.map((r) => r[j]));
const icrs = matVec(inv, gal);
let ra = Math.atan2(icrs[1], icrs[0]) / DEG; if (ra < 0) ra += 360;
const dec = Math.asin(icrs[2]) / DEG;

const out = {
  schemaVersion: 1, generated: nowIso(), domain: 'galactic', dataset: 'cosmology',
  provenanceClass: 'observed',
  parameterSet: { name: 'Planck 2018 base-LCDM, TT,TE,EE+lowE+lensing+BAO', table: 'Planck 2018 results VI (A&A 641, A6) Table 2, last column', ref: 'planck2018vi', model: 'spatially flat LCDM, Neff=3.046, one massive neutrino (0.06 eV)' },
  parameters: {
    H0: q('H0'), omegaM: q('omegaM'), omegaLambda: q('omegaLambda'), omegaBh2: q('omegaBh2'), omegaCh2: q('omegaCh2'), omegaMh2: q('omegaMh2'),
    nS: q('nS'), sigma8: q('sigma8'), tau: q('tau'), lnA10s: q('lnAs'), zReionization: q('zReion'), theta100MC: q('theta100MC'),
    ageGyr: q('ageGyr'), zLastScattering: q('zStar'), soundHorizonAtLastScatteringComovingMpc: q('rStarMpc'),
    omegaK: { value: 0, unit: null, uncertainty: null, ref: 'planck2018vi', note: 'assumed exactly flat in the base model' },
    TcmbK: { value: 2.72548, unit: 'K', uncertainty: { kind: 'stdDev1Sigma', value: 0.00057 }, ref: 'fixsen2009', note: 'Fixsen 2009 (ApJ 707, 916): 2.72548 ± 0.00057 K; commonly quoted/used by Planck as 2.7255 K' },
  },
  cmbDipole: {
    amplitudeMicroK: { value: 3362.08, unit: 'uK', uncertainty: { kind: 'stdDev1Sigma', value: 0.99 }, ref: 'planck2018i', note: 'Planck 2018 I, Planck 2018 solar dipole' },
    galacticLonDeg: { value: 264.021, uncertainty: { kind: 'stdDev1Sigma', value: 0.011 }, ref: 'planck2018i' },
    galacticLatDeg: { value: 48.253, uncertainty: { kind: 'stdDev1Sigma', value: 0.005 }, ref: 'planck2018i' },
    raDeg: { value: sig(ra, 7), ref: derivedRef, note: 'ICRS, converted from (l,b) with the Hipparcos matrix; the hot lobe of the dipole' },
    decDeg: { value: sig(dec, 7), ref: derivedRef },
    solarVelocityKmS: { value: vSun, unit: 'km s^-1', uncertainty: { kind: 'stdDev1Sigma', value: 0.11 }, ref: 'planck2018i', note: 'velocity of the Sun w.r.t. the CMB rest frame, toward (l,b) above' },
  },
  derived: {
    method: 'Flat LCDM, Omega_r from T_CMB=2.7255 K and Neff=3.046 (massless-equivalent), Omega_Lambda=1-Omega_m-Omega_r; Simpson integration (scripts/data/galactic/cosmo-math.mjs). Comoving distances at z=0.',
    comovingDistanceToLastScatteringMpc: d(DMstar, 'Mpc', DMstarErr, { note: 'uncertainty from r*/theta* quadrature (144.57±0.22 Mpc, 100theta_MC 1.04101±0.00029); r*/theta* = '+(144.57/0.0104101).toFixed(0)+' Mpc cross-check' }),
    comovingDistanceToLastScatteringGly: d(DMstar * MPC_IN_GLY, 'Gly', DMstarErr * MPC_IN_GLY),
    particleHorizonComovingMpc: d(horizon, 'Mpc', sd(mc.hor)),
    particleHorizonComovingGly: d(horizon * MPC_IN_GLY, 'Gly', sd(mc.hor) * MPC_IN_GLY, { note: 'comoving radius of the observable universe (~46 Gly); diameter ~93 Gly' }),
    particleHorizonDiameterGly: d(2 * horizon * MPC_IN_GLY, 'Gly', 2 * sd(mc.hor) * MPC_IN_GLY),
    ageGyrComputed: d(age, 'Gyr', 0.020, { note: 'cross-check of published age 13.787 ± 0.020 Gyr' }),
    hubbleDistanceMpc: d(m.hubbleDistMpc, 'Mpc', null),
    hubbleTimeGyr: d(m.hubbleTimeGyr, 'Gyr', null),
    omegaRadiation: d(m.Or, null, null),
  },
  verification: { planck2018vi: p6.checked, planck2018i: p1.checked, fixsen2009: fx.checked },
};
out.references = refsFor(['planck2018vi', 'planck2018i', 'fixsen2009', derivedRef]);
const r = writeOut('cosmology.json', out);
log('cosmology.json', r.bytes, 'B; D_M(z*)=', DMstar.toFixed(1), 'Mpc; horizon', (horizon * MPC_IN_GLY).toFixed(2), 'Gly; age', age.toFixed(3), 'Gyr; dipole RA/Dec', ra.toFixed(3), dec.toFixed(3));
