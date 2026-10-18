// assembled SBDB records (+ literature Dimorphos record) -> public/data/solar/smallbodies.json
import fs from 'node:fs';
import { RAW_DIR, OUT_DIR, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, log, assert } from './lib.mjs';

const { retrieved, out } = JSON.parse(fs.readFileSync(`${RAW_DIR}/sbdb/_assembled.json`, 'utf8'));
const DWARF = new Set(['pluto', 'eris', 'haumea', 'makemake']);
const bodies = out.map((r) => ({ ...r, role: DWARF.has(r.id) ? 'dwarf-planet-orbit-only' : 'notable' }));
const dimorphos = {
  id: 'dimorphos', name: 'Dimorphos', fullname: '(65803) Didymos I Dimorphos', designation: 'S/2003 (65803) 1', spkid: 920065803, kind: 'asteroid-moon',
  parentId: 'didymos', orbitClass: 'satellite of NEA 65803 Didymos', neo: true, pha: true, role: 'literature',
  H: null, diameterKm: 0.151, diameterSigmaKm: 0.005, albedo: null, rotationPeriodH: 11.921, spectralType: null,
  elements: null, sigmas: null,
  binaryOrbit: {
    aboutId: 'didymos', semiMajorAxisKm: 1.19, semiMajorAxisNote: 'orbit radius ~1.19 km (task brief; DART literature, Daly et al. 2023 Nature 616:443)',
    periodPreImpactH: 11.921, periodPostImpactH: 11.372, periodChangeMin: -33.0, periodChangeSigmaMin3: 1.0,
    periodChangeRef: 'Thomas et al. 2023, Nature 616:448, doi:10.1038/s41586-023-05805-2 (-33.0 +/- 1.0 min, 3 sigma; confirmed from arXiv:2303.02077 abstract)',
    periodNote: 'Pre/post periods are from the task brief; 11.921 - 11.372 h = 32.9 min, consistent with the published -33.0 min. Not independently re-verified against the paper full text (paywalled at retrieval).',
  },
  dart: {
    massAtImpactKg: 579.4, massSigmaKg: 0.7, impactSpeedKms: 6.1449, impactSpeedSigmaKms: 0.0003, kineticEnergyGJ: 10.94,
    ref: 'Impact-parameter table (Nature 616, 2023; PMC10115643 Table 1): 6.1449 +/- 0.0003 km/s, 579.4 +/- 0.7 kg, 10.94 +/- 0.01 GJ',
    beta: 3.61, betaSigmaPlus: 0.19, betaSigmaMinus: 0.25, betaAssumedDensityKgM3: 2400, betaRange: [2.2, 4.9], betaRangeDensityKgM3: [1500, 3300],
    betaRef: 'Cheng et al. 2023, Nature 616:457, doi:10.1038/s41586-023-05878-z (beta = 3.61 +0.19/-0.25 (1 sigma) for equal densities 2400 kg/m3; 2.2-4.9 over 1500-3300 kg/m3)',
    alongTrackVelocityChangeMmS: -2.7, alongTrackVelocityChangeSigmaMmS: 0.1,
  },
  volumeKm3: 0.00181, volumeSigmaFrac: 0.1,
  densityKgM3: null, densityRangeKgM3: [1500, 3300],
  massKgEstimate: 4.3e9,
  massEstimateNote: 'DERIVED, not measured: 2400 kg/m3 x 1.81e9 m3 (volume 0.00181 km3 +/-10%) = 4.3e9 kg; plausible 2.7e9-6.0e9 kg for 1500-3300 kg/m3. Hera is expected to measure the mass.',
  hera: {
    agency: 'ESA', launchDateUTC: '2024-10-07', plannedArrivalAtDidymos: '2026-11',
    statusAsOf2026_10_16: 'In cruise. ESA announced in Oct 2025 that arrival moves one month earlier, to November 2026; a Sept 2026 EPSC session still states November 2026. No later change found; planned, not yet achieved.',
    cubesats: ['Milani', 'Juventas'], ref: 'https://www.esa.int/Space_Safety/Hera/ESA_s_Hera_targets_early_arrival_at_Didymos_asteroids',
  },
  source: 'Literature (Thomas+2023; Cheng+2023; DART impact-parameter table); see per-field refs',
};
const all = [...bodies, dimorphos];
for (const b of bodies) assert(b.elements.aAU !== null && b.elements.e !== null, `${b.id} missing elements`);
const apophis = bodies.find((b) => b.id === 'apophis');
assert(Math.abs(apophis.elements.aAU - 0.9223) < 0.002, 'Apophis a');
const doc = {
  schemaVersion: 1, generated: new Date().toISOString(), retrieved,
  notes: 'elements: osculating heliocentric J2000 ecliptic; epochJD TDB; angles deg; aAU negative for hyperbolic orbits; tpJD TDB; sigmas are 1-sigma formal (null if absent). H = absolute magnitude (comets: null, see M1/K1). diameterKm measured (null if unknown). role=dwarf-planet-orbit-only entries supply orbits for bodies.json. Dimorphos has no SBDB heliocentric record (literature values only).',
  bodies: all,
};
const p = `${OUT_DIR}/smallbodies.json`;
await writeJSON(p, doc);
await upsertManifest([{
  id: 'jpl-sbdb-notable-small-bodies', name: 'JPL Small-Body Database - notable bodies', organization: 'NASA JPL SSD',
  purpose: 'Orbits and physical parameters of notable asteroids, comets, interstellar objects and dwarf-planet orbits; planetary-defense lab (Apophis, Didymos, 2024 YR4)',
  mechanism: 'SBDB API (JSON) per object, phys-par=1&discovery=1', endpoint: 'https://ssd-api.jpl.nasa.gov/sbdb.api', query: 'sstr=<designation>&phys-par=1&discovery=1',
  version: 'live archive state at retrieval', retrieved, license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL,
  citation: 'NASA/JPL Solar System Dynamics, Small-Body Database (https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html). Dimorphos: Thomas et al. 2023 Nature 616:448; Cheng et al. 2023 Nature 616:457.',
  rateLimits: JPL_RATE,
  fieldsUsed: ['object.*', 'orbit.elements', 'orbit.epoch', 'orbit.condition_code', 'orbit.data_arc', 'orbit.n_obs_used', 'orbit.moid', 'orbit.soln_date', 'phys_par.*', 'discovery'],
  updateCadence: 'orbit solutions updated as new astrometry arrives', cachePolicy: 'versioned offline snapshot; optional online refresh',
  normalization: 'scripts/data/solar/fetch-smallbodies.mjs + build-smallbodies.mjs', fallback: 'Use bundled snapshot; hide uncertainties if absent.',
  files: [await fileEntry(p, all.length)],
  limitations: 'Osculating elements drift and are valid near their epoch only; low condition-code objects (2024 YR4, 3I) have large uncertainties; hyperbolic orbits need the hyperbolic Kepler equation. Dimorphos mass is an estimate pending Hera.',
  provenanceClass: 'observed',
}]);
log('smallbodies.json', all.length, 'records');
