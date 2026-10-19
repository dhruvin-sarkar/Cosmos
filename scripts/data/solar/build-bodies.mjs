// Cached JPL SSD / NAIF / NSSDCA raw files (data-raw/solar/ref, probe) + smallbodies.json -> public/data/solar/bodies.json
// Run fetch-ref.mjs first (downloads the reference files) and fetch-smallbodies.mjs + build-smallbodies.mjs.
import fs from 'node:fs';
import { RAW_DIR, OUT_DIR, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, NAIF_LICENSE, NAIF_LICENSE_URL, NASA_LICENSE, NASA_LICENSE_URL, G_SI, J2000_JD, log, assert, checkClose, sig, round } from './lib.mjs';
import * as P from './parsers.mjs';

const rd = (f) => fs.readFileSync(`${RAW_DIR}/ref/${f}`, 'utf8');
const meta = (f) => JSON.parse(fs.readFileSync(`${RAW_DIR}/ref/${f}.meta.json`, 'utf8')).retrieved;
const planetsPP = P.parseJplPlanetPhysPar(rd('jpl-planets-phys_par.html'));
const satsPP = P.parseJplSatPhysPar(rd('jpl-sats-phys_par.html'));
const satsEl = P.parseJplSatElem(rd('jpl-sats-elem.html'));
const satsDisc = P.parseJplSatDiscovery(rd('jpl-sats-discovery.html'));
const approx = P.parseApproxPosTable1(rd('jpl-approx_pos.html'));
const pck = P.parseSpiceKernel(rd('naif-pck00011.tpc'));
const gmk = P.parseSpiceKernel(rd('naif-gm_de440.tpc'));
const smallWorlds = P.parseNssdcaSmallWorlds(rd('nssdca-galileanfact_table.html'));
const sb = new Map(JSON.parse(fs.readFileSync(`${OUT_DIR}/smallbodies.json`, 'utf8')).bodies.map((b) => [b.id, b]));

const R2D = 180 / Math.PI;
const clean = (s) => { const t = String(s ?? '').replace(/[,*\s]/g, ''); const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
/** value in column `col` (1 = first body) of the sheet row whose label matches. */
function sheetVal(file, labelRe, col = 1) {
  const html = rd(file);
  for (const t of P.parseHtmlTables(html)) for (const r of t.rows) if (r.length > col && labelRe.test(r[0])) return clean(r[col]);
  // plain-text sheets (e.g. Earth) have no HTML tables: match "label   value" lines
  for (const line of html.split(/\r?\n/)) { const t = line.trim(); if (labelRe.test(t)) { const m = t.split(/\s{2,}/); if (m.length > col) return clean(m[col]); } }
  return null;
}
const gm = (key) => { const v = gmk.get(key); return v ? v[0] : null; };

// --------------------------------------------------------------- curated atmosphere / temperature (every figure appears in the cited NSSDCA sheet unless noted)
const ATM = {
  mercury: { p: 5e-15, comp: 'Tenuous exosphere (surface pressure < ~5e-15 bar): Na, Mg, O, K, Ca (column abundances)' , src: 'nssdca-mercuryfact' },
  venus: { p: 92, comp: '96.5% CO2, 3.5% N2 (minor: SO2 150 ppm, Ar 70 ppm, H2O 20 ppm)', src: 'nssdca-venusfact' },
  earth: { p: 1.014, comp: '78.08% N2, 20.95% O2, ~0.93% Ar, CO2 ~420 ppm (dry air by volume)', src: 'nssdca-earthfact' },
  moon: { p: 3e-15, comp: 'Exosphere (night surface pressure ~3e-15 bar): He-4, Ne-20, H2, Ar-40 (poorly known, variable)', src: 'nssdca-moonfact' },
  mars: { p: 0.00636, comp: '95.1% CO2, 2.59% N2, 1.94% Ar, 0.16% O2, 0.06% CO (mean surface pressure 6.36 mb)', src: 'nssdca-marsfact' },
  jupiter: { p: null, comp: '89.8% H2, 10.2% He (CH4 3000 ppm, NH3 260 ppm); no solid surface (1-bar level used)', src: 'nssdca-jupiterfact' },
  saturn: { p: null, comp: '96.3% H2, 3.25% He (CH4 4500 ppm, NH3 125 ppm); no solid surface (1-bar level used)', src: 'nssdca-saturnfact' },
  uranus: { p: null, comp: '82.5% H2, 15.2% He, 2.3% CH4; no solid surface (1-bar level used)', src: 'nssdca-uranusfact' },
  neptune: { p: null, comp: '80.0% H2, 19.0% He, 1.5% CH4; no solid surface (1-bar level used)', src: 'nssdca-neptunefact' },
  pluto: { p: 1.3e-5, comp: '99% N2, 0.5% CH4, 0.05% CO (surface pressure ~13 microbar)', src: 'nssdca-plutofact' },
  titan: { p: 1.467, comp: '~95% N2, ~5% CH4 (literature value, Huygens HASI; not in the NSSDCA sheets we fetched)', src: 'literature: Fulchignoni et al. 2005, Nature 438:785' },
};
const TEMP = {
  sun: { effectiveK: 5772 },
  mercury: { meanK: 440 }, venus: { meanK: 737 }, earth: { meanK: 288 }, mars: { meanK: 214 },
  jupiter: { meanK: 165, note: 'temperature at the 1-bar level' }, saturn: { meanK: 134, note: 'temperature at the 1-bar level' },
  uranus: { meanK: 76, note: 'temperature at the 1-bar level' }, neptune: { meanK: 72, note: 'temperature at the 1-bar level' },
  pluto: { minK: 24, maxK: 38, note: 'surface temperature range' }, moon: { minK: 95, maxK: 390, note: 'equatorial surface range' },
};
const SW = Object.fromEntries([...smallWorlds].map(([k, v]) => [k.toLowerCase(), v]));
for (const id of ['io', 'europa', 'ganymede', 'callisto', 'titan', 'triton', 'ceres']) TEMP[id] = { meanK: round(SW[id] + 273.15, 0), note: 'NSSDCA Small Worlds table (rounded to 5 C)' };
// verify planet temps against the cached sheets
for (const [id, f, re] of [['mercury', 'mercury', /Average temperature: 440 K/], ['venus', 'venus', /Average temperature: 737 K/], ['earth', 'earth', /Average temperature: 288 K/], ['jupiter', 'jupiter', /Temperature at 1 bar: 165 K/], ['saturn', 'saturn', /Temperature at 1 bar: 134 K/], ['uranus', 'uranus', /Temperature at 1 bar: 76 K/], ['neptune', 'neptune', /Temperature at 1 bar: 72 K/], ['mars', 'mars', /Average temperature: ~214 K/]]) {
  assert(re.test(P.htmlToText(rd(`nssdca-${f}fact.html`)).replace(/\s+/g, ' ')), `temperature check failed for ${id}`);
}

// --------------------------------------------------------------- rotation
function rotation(naif) {
  const r = P.pckRotation(pck, naif);
  if (!r) return null;
  const w = r.pm;
  const rot = {
    siderealPeriodHours: sig((360 / w[1]) * 24, 8), poleRaDeg: r.poleRa[0], poleDecDeg: r.poleDec[0],
    poleRaRateDegPerCentury: r.poleRa[1], poleDecRateDegPerCentury: r.poleDec[1], w0Deg: w[0], wDotDegPerDay: w[1],
    model: 'IAU WGCCRE 2015',
    note: 'Elements at J2000 (JD 2451545.0 TDB); pole(T) = pole0 + rate*T with T in Julian centuries, W(d) = w0 + wDot*d + wDotDot*d^2 with d days from J2000. Negative period = W decreasing (retrograde spin about the IAU north pole). Source: NAIF pck00011.tpc, which encodes Archinal et al. 2018 (Celest. Mech. Dyn. Astr. 130:22).',
  };
  if (w[2]) rot.wDotDotDegPerDay2 = w[2];
  if (r.poleRa[2] || r.poleDec[2]) rot.poleRateSecondDegPerCentury2 = [r.poleRa[2], r.poleDec[2]];
  if (r.periodic) rot.periodicTerms = r.periodic;
  return rot;
}
const radiiOf = (naif) => { const a = pck.get(`BODY${naif}_RADII`); return a ? { equatorialKm: a[0], polarKm: a[2], triaxialKm: a } : null; };

// --------------------------------------------------------------- body definitions
const SUMMARY = {
  sun: 'The Sun is a G2V main-sequence star containing 99.86% of the Solar System mass; its nominal photospheric effective temperature is 5772 K.',
  mercury: 'Mercury is the innermost and smallest planet, with a heavily cratered surface and an iron-rich core; it has a 3:2 spin-orbit resonance (59-day rotation, 88-day orbit).',
  venus: 'Venus is the second planet, with a dense carbon dioxide atmosphere giving a surface pressure near 92 bar and a mean temperature of about 737 K. It rotates retrograde, once per 243 days.',
  earth: 'Earth is the third planet and the only body known to host life, with a nitrogen-oxygen atmosphere and liquid water oceans. It has one natural satellite, the Moon.',
  mars: 'Mars is the fourth planet, a cold desert world with a thin carbon dioxide atmosphere. It has two small moons, Phobos and Deimos.',
  jupiter: 'Jupiter is the largest planet, a gas giant of mostly hydrogen and helium whose mass is about 2.5 times that of all other planets combined.',
  saturn: 'Saturn is a gas giant with the most extensive ring system of the planets and a mean density below that of water.',
  uranus: 'Uranus is an ice giant that rotates retrograde on its side, with an axial tilt of about 98 degrees.',
  neptune: 'Neptune is the outermost planet, an ice giant discovered in 1846 from predictions based on perturbations of Uranus.',
  ceres: 'Ceres is the largest object in the asteroid belt and the only dwarf planet in the inner Solar System; it was visited by the Dawn spacecraft in 2015-2018.',
  pluto: 'Pluto is a dwarf planet in the Kuiper belt with a nitrogen-dominated atmosphere, visited by New Horizons in July 2015. Pluto and its largest moon Charon orbit a barycentre outside Pluto.',
  eris: 'Eris is the most massive known dwarf planet, a scattered-disc object whose discovery in 2005 prompted the IAU definition of a planet.',
  haumea: 'Haumea is a rapidly rotating, elongated dwarf planet in the Kuiper belt with two known moons and a ring.',
  makemake: 'Makemake is a dwarf planet in the Kuiper belt, among the brightest trans-Neptunian objects, with one known moon.',
  moon: 'The Moon is Earth\'s only natural satellite and the fifth largest moon in the Solar System; it is tidally locked, always showing the same face to Earth.',
  phobos: 'Phobos is the larger and inner moon of Mars, an irregular body orbiting about 6,000 km above the surface in under eight hours.',
  deimos: 'Deimos is the smaller and outer moon of Mars, an irregular body with a 30-hour orbit.',
  io: 'Io is the innermost Galilean moon and the most volcanically active body in the Solar System, heated by tidal flexing.',
  europa: 'Europa is a Galilean moon with a water-ice crust above a global subsurface ocean, a target of the Europa Clipper mission.',
  ganymede: 'Ganymede is the largest moon in the Solar System, larger than Mercury, and the only moon known to have its own magnetic field.',
  callisto: 'Callisto is the outermost Galilean moon, with one of the most heavily cratered surfaces in the Solar System.',
  amalthea: 'Amalthea is a small, irregular, reddish inner moon of Jupiter discovered in 1892, the last moon found by direct visual observation.',
  mimas: 'Mimas is a small icy moon of Saturn dominated by the large Herschel impact crater.',
  enceladus: 'Enceladus is an icy moon of Saturn whose south polar plumes vent water from a subsurface ocean.',
  tethys: 'Tethys is a mid-sized, low-density icy moon of Saturn with a large impact basin (Odysseus) and a long canyon (Ithaca Chasma).',
  dione: 'Dione is an icy moon of Saturn with wispy bright terrain on its trailing hemisphere.',
  rhea: 'Rhea is the second-largest moon of Saturn, a heavily cratered icy body.',
  titan: 'Titan is the largest moon of Saturn and the only moon with a dense atmosphere (about 1.5 bar, mostly nitrogen), with methane lakes and seas near its poles. Dragonfly is planned to explore it.',
  hyperion: 'Hyperion is an irregular, sponge-like moon of Saturn with chaotic rotation.',
  iapetus: 'Iapetus is a moon of Saturn with a strongly two-toned surface (a dark leading hemisphere and a bright trailing one) and a prominent equatorial ridge.',
  miranda: 'Miranda is the smallest of the five major moons of Uranus, with a patchwork of extreme geological terrain including Verona Rupes.',
  ariel: 'Ariel is a moon of Uranus with the brightest and youngest-looking surface among its major moons, cut by canyons.',
  umbriel: 'Umbriel is a dark, heavily cratered moon of Uranus.',
  titania: 'Titania is the largest moon of Uranus, with canyons and scarps.',
  oberon: 'Oberon is the outermost of the five major moons of Uranus, old and heavily cratered.',
  triton: 'Triton is the largest moon of Neptune and orbits retrograde, which indicates it is a captured Kuiper-belt object; Voyager 2 observed active nitrogen geysers in 1989.',
  nereid: 'Nereid is a small irregular moon of Neptune with one of the most eccentric orbits of any known moon.',
  charon: 'Charon is the largest moon of Pluto, about half Pluto\'s diameter; the two are mutually tidally locked.',
};
const PLANETS = [
  ['mercury', 'Mercury', 'planet', 199, 'Mercury', 'mercury', null], ['venus', 'Venus', 'planet', 299, 'Venus', 'venus', null], ['earth', 'Earth', 'planet', 399, 'EM Bary', 'earth', null],
  ['mars', 'Mars', 'planet', 499, 'Mars', 'mars', null], ['jupiter', 'Jupiter', 'planet', 599, 'Jupiter', 'jupiter', null], ['saturn', 'Saturn', 'planet', 699, 'Saturn', 'saturn', null],
  ['uranus', 'Uranus', 'planet', 799, 'Uranus', 'uranus', { by: 'William Herschel', year: 1781 }], ['neptune', 'Neptune', 'planet', 899, 'Neptune', 'neptune', { by: 'Urbain Le Verrier, Johann Galle (predicted, then observed)', year: 1846 }],
];
const DWARFS = [['ceres', 'Ceres', 2000001, 'ceres'], ['pluto', 'Pluto', 999, 'pluto'], ['eris', 'Eris', 2136199, 'eris'], ['haumea', 'Haumea', 2136108, 'haumea'], ['makemake', 'Makemake', 2136472, 'makemake']];
const MOONS = [
  ['moon', 'Moon', 'earth', 301], ['phobos', 'Phobos', 'mars', 401], ['deimos', 'Deimos', 'mars', 402],
  ['io', 'Io', 'jupiter', 501], ['europa', 'Europa', 'jupiter', 502], ['ganymede', 'Ganymede', 'jupiter', 503], ['callisto', 'Callisto', 'jupiter', 504], ['amalthea', 'Amalthea', 'jupiter', 505],
  ['mimas', 'Mimas', 'saturn', 601], ['enceladus', 'Enceladus', 'saturn', 602], ['tethys', 'Tethys', 'saturn', 603], ['dione', 'Dione', 'saturn', 604], ['rhea', 'Rhea', 'saturn', 605],
  ['titan', 'Titan', 'saturn', 606], ['hyperion', 'Hyperion', 'saturn', 607], ['iapetus', 'Iapetus', 'saturn', 608],
  ['miranda', 'Miranda', 'uranus', 705], ['ariel', 'Ariel', 'uranus', 701], ['umbriel', 'Umbriel', 'uranus', 702], ['titania', 'Titania', 'uranus', 703], ['oberon', 'Oberon', 'uranus', 704],
  ['triton', 'Triton', 'neptune', 801], ['nereid', 'Nereid', 'neptune', 802], ['charon', 'Charon', 'pluto', 901],
];

const atmosphere = (id) => (ATM[id] ? { surfacePressureBar: ATM[id].p, composition: ATM[id].comp } : null);
const derive = (gmKm3s2, rEqKm, rMeanKm) => ({
  surfaceGravityMs2: sig((gmKm3s2 * 1e9) / (rEqKm * 1e3) ** 2, 4), escapeVelocityKms: sig(Math.sqrt((2 * gmKm3s2) / rMeanKm), 4),
});
const bodies = [];

// Sun
{
  const gmSun = gm('BODY10_GM'); const R = 695700;
  const mass = (gmSun * 1e9) / G_SI;
  bodies.push({
    id: 'sun', name: 'Sun', kind: 'star', parentId: null, naifId: 10,
    radius: { equatorialKm: R, polarKm: R, meanKm: R }, massKg: sig(mass, 8), gmKm3s2: gmSun, densityKgM3: sig(mass / ((4 / 3) * Math.PI * (R * 1e3) ** 3), 5),
    ...derive(gmSun, R, R), rotation: rotation(10), obliquityDeg: 7.25,
    albedo: null, temperature: TEMP.sun, luminosityW: 3.828e26, spectralType: 'G2V', atmosphere: null, orbit: null, discovery: null,
    summary: SUMMARY.sun,
    sources: { radius: 'iau-2015-b3-nominal-solar-radius', gm: 'naif-gm-de440', rotation: 'naif-pck00011', obliquity: 'nssdca-planetary-fact-sheets', temperature: 'iau-2015-b3-nominal-teff', luminosity: 'iau-2015-b3-nominal-luminosity' },
  });
}
// Planets
for (const [id, name, kind, naif, apKey, sheet, disc] of PLANETS) {
  const pp = planetsPP.get(id); const gmv = gm(`BODY${naif}_GM`);
  const eq = pp.equatorialRadiusKm.value, mean = pp.meanRadiusKm.value;
  const polar = sheetVal(`nssdca-${sheet}fact.html`, /^Polar radius \(km\)/);
  const ap = approx.get(apKey);
  const bond = sheetVal(`nssdca-${sheet}fact.html`, /^Bond albedo/);
  const obl = sheetVal(`nssdca-${sheet}fact.html`, /^Obliquity to orbit/);
  const d = derive(gmv, eq, mean);
  bodies.push({
    id, name, kind, parentId: 'sun', naifId: naif,
    radius: { equatorialKm: eq, polarKm: polar ?? radiiOf(naif)?.polarKm ?? null, meanKm: mean },
    massKg: pp.massKg, massSigmaKg: pp.massSigmaKg, gmKm3s2: gmv, densityKgM3: sig(pp.densityGcm3.value * 1000, 5),
    ...d, rotation: rotation(naif), obliquityDeg: obl,
    albedo: { geometric: pp.geometricAlbedo.value, bond }, temperature: TEMP[id] ?? null, atmosphere: atmosphere(id),
    orbit: {
      model: 'JPL Approximate Positions (Standish) Table 1, valid 1800-2050 AD', refPlane: 'ecliptic J2000', epochJD: J2000_JD, timeScale: 'TDB',
      aAU: ap.a, e: ap.e, iDeg: ap.I, LDeg: ap.L, lonPeriDeg: ap.lonPeri, nodeDeg: ap.node,
      aAUPerCentury: ap.aDot, ePerCentury: ap.eDot, iDegPerCentury: ap.IDot, LDegPerCentury: ap.LDot, lonPeriDegPerCentury: ap.lonPeriDot, nodeDegPerCentury: ap.nodeDot,
      note: id === 'earth' ? 'Elements are for the Earth-Moon barycentre.' : undefined,
    },
    discovery: disc, summary: SUMMARY[id],
    sources: { radius: 'jpl-ssd-planet-phys-par', mass: 'jpl-ssd-planet-phys-par', gm: 'naif-gm-de440', rotation: 'naif-pck00011', orbit: 'jpl-ssd-approx-pos', albedo: 'jpl-ssd-planet-phys-par+nssdca-planetary-fact-sheets', polarRadius: 'nssdca-planetary-fact-sheets', obliquity: 'nssdca-planetary-fact-sheets', temperature: 'nssdca-planetary-fact-sheets', atmosphere: 'nssdca-planetary-fact-sheets', summary: 'editorial' },
  });
}
// Dwarf planets
for (const [id, name, naif, key] of DWARFS) {
  const pp = planetsPP.get(key); const s = sb.get(id);
  const rad = radiiOf(naif);
  const eq = pp.equatorialRadiusKm.value ?? rad?.equatorialKm ?? null;
  const mean = pp.meanRadiusKm.value;
  const gmv = pp.massKg == null ? null : sig((pp.massKg * G_SI) / 1e9, 7);
  const rotP = pp.siderealRotationDays.value;
  const rot = rotation(naif) ?? (rotP == null ? null : {
    siderealPeriodHours: sig(rotP * 24, 6), poleRaDeg: null, poleDecDeg: null, poleRaRateDegPerCentury: null, poleDecRateDegPerCentury: null, w0Deg: null, wDotDegPerDay: sig(360 / rotP, 8),
    model: 'none (no IAU WGCCRE 2015 pole solution)', note: 'Only the sidereal rotation period (JPL SSD planets/phys_par) is available; pole orientation is not defined by the IAU report.',
  });
  const disc = s?.discovery ? { by: s.discovery.by, year: Number(String(s.discovery.date ?? '').slice(0, 4)) || null } : null;
  const el = s.elements;
  const d = gmv && eq ? derive(gmv, eq, mean) : { surfaceGravityMs2: null, escapeVelocityKms: null };
  bodies.push({
    id, name, kind: 'dwarf-planet', parentId: 'sun', naifId: naif,
    radius: { equatorialKm: eq, polarKm: rad?.polarKm ?? (id === 'pluto' ? mean : null), meanKm: mean },
    massKg: pp.massKg, massSigmaKg: pp.massSigmaKg, gmKm3s2: gmv, densityKgM3: pp.densityGcm3.value ? sig(pp.densityGcm3.value * 1000, 5) : null,
    ...d, rotation: rot, obliquityDeg: id === 'pluto' ? sheetVal('nssdca-plutofact.html', /^Obliquity to orbit/) : null,
    albedo: { geometric: pp.geometricAlbedo.value, bond: id === 'pluto' ? sheetVal('nssdca-plutofact.html', /^Bond albedo/) : null },
    temperature: TEMP[id] ?? null, atmosphere: atmosphere(id),
    orbit: { model: 'JPL SBDB osculating elements (heliocentric ecliptic J2000)', refPlane: 'ecliptic J2000', timeScale: 'TDB', epochJD: el.epochJD, aAU: el.aAU, e: el.e, iDeg: el.iDeg, nodeDeg: el.nodeDeg, argPeriDeg: el.argPeriDeg, meanAnomalyDeg: el.meanAnomalyDeg, periodDays: el.periodDays,
      note: id === 'pluto' ? 'SBDB heliocentric elements of the Pluto system barycentre solution.' : undefined },
    discovery: disc, summary: SUMMARY[id],
    sources: { radius: 'jpl-ssd-planet-phys-par', mass: 'jpl-ssd-planet-phys-par', rotation: id === 'pluto' || id === 'ceres' ? 'naif-pck00011' : 'jpl-ssd-planet-phys-par', orbit: 'jpl-sbdb-notable-small-bodies', albedo: 'jpl-ssd-planet-phys-par', atmosphere: 'nssdca-planetary-fact-sheets', summary: 'editorial' },
  });
}
// Moons
for (const [id, name, parent, naif] of MOONS) {
  const pp = satsPP.get(naif); const el = satsEl.get(naif); const dc = satsDisc.get(name.toLowerCase());
  assert(pp && el, `missing JPL data for ${name}`);
  const rad = radiiOf(naif);
  const mean = pp.meanRadiusKm.value;
  const gmv = pp.gm.value || null; // JPL lists 0 when GM is unknown
  const eq = rad ? Math.max(rad.triaxialKm[0], rad.triaxialKm[1]) : mean;
  const mass = gmv == null ? null : (gmv * 1e9) / G_SI;
  const d = gmv != null && mean ? derive(gmv, mean, mean) : { surfaceGravityMs2: null, escapeVelocityKms: null };
  const rot = rotation(naif);
  const isMoon = id === 'moon';
  bodies.push({
    id, name, kind: 'moon', parentId: parent, naifId: naif,
    radius: { equatorialKm: eq, polarKm: rad ? rad.polarKm : null, meanKm: mean, triaxialKm: rad ? rad.triaxialKm : null },
    massKg: mass == null ? null : sig(mass, 6), gmKm3s2: gmv, gmSigmaKm3s2: pp.gm.sigma,
    densityKgM3: pp.densityGcm3.value ? sig(pp.densityGcm3.value * 1000, 5) : null,
    ...d, rotation: rot ?? (id === 'hyperion' ? { siderealPeriodHours: null, poleRaDeg: null, poleDecDeg: null, poleRaRateDegPerCentury: null, poleDecRateDegPerCentury: null, w0Deg: null, wDotDegPerDay: null, model: 'none', note: 'Chaotic tumbling rotation; no IAU pole solution.' } : { siderealPeriodHours: null, poleRaDeg: null, poleDecDeg: null, poleRaRateDegPerCentury: null, poleDecRateDegPerCentury: null, w0Deg: null, wDotDegPerDay: null, model: 'none', note: 'No IAU WGCCRE 2015 rotation model; assume synchronous rotation only if justified.' }),
    obliquityDeg: isMoon ? sheetVal('nssdca-moonfact.html', /^Obliquity to orbit/) : null,
    albedo: isMoon ? { geometric: sheetVal('nssdca-moonfact.html', /^Geometric albedo/), bond: sheetVal('nssdca-moonfact.html', /^Bond albedo/) } : null,
    temperature: TEMP[id] ?? null, atmosphere: atmosphere(id),
    orbit: {
      model: 'JPL SSD planetary satellite mean elements', ephemeris: el.ephemeris, epochJD: P.calFracToJD(el.epoch), timeScale: 'TDB',
      aKm: el.aKm, e: el.e, iDeg: el.iDeg, nodeDeg: el.nodeDeg, periDeg: el.periDeg, meanAnomalyDeg: el.meanAnomalyDeg, periodDays: el.periodDays,
      refPlane: el.frame, laplacePoleRaDeg: el.laplaceRaDeg, laplacePoleDecDeg: el.laplaceDecDeg, laplaceTiltDeg: el.tiltDeg,
      note: 'periDeg = argument of periapsis, nodeDeg = longitude of ascending node, both measured in refPlane about the primary (J2000). refPlane "laplace": plane through the Laplace pole (RA/Dec in ICRF); "equatorial": primary equator J2000; "ecliptic": ecliptic J2000. Mean elements: use for orbit lines, not precise positions.',
    },
    discovery: isMoon ? null : dc ? { by: dc.by, year: dc.year } : null, summary: SUMMARY[id],
    sources: { radius: 'jpl-ssd-satellite-phys-par+naif-pck00011', gm: 'jpl-ssd-satellite-phys-par', mass: 'derived-from-gm', density: 'jpl-ssd-satellite-phys-par', rotation: 'naif-pck00011', orbit: 'jpl-ssd-satellite-mean-elements', discovery: 'jpl-ssd-satellite-discovery', atmosphere: id === 'titan' ? 'literature' : 'nssdca-planetary-fact-sheets', summary: 'editorial' },
  });
}

// --------------------------------------------------------------- validation
const rel = (l, a, x, r, s) => checkClose(l, a, x, Math.abs(x) * r, s);
const get = (id) => bodies.find((b) => b.id === id);
rel('Earth mean radius km', get('earth').radius.meanKm, 6371.0, 0.01, 'IAU/NSSDCA');
rel('Earth mass kg', get('earth').massKg, 5.9722e24, 0.001, 'NSSDCA Earth fact sheet');
rel('Earth surface gravity m/s2', get('earth').surfaceGravityMs2, 9.80, 0.01, 'NSSDCA (equatorial 9.78)');
rel('Earth escape km/s', get('earth').escapeVelocityKms, 11.19, 0.01, 'NSSDCA');
rel('Sun mass kg', get('sun').massKg, 1.98841e30, 0.001, 'NSSDCA Sun fact sheet 1988400e24');
rel('Sun escape km/s', get('sun').escapeVelocityKms, 617.6, 0.005, 'NSSDCA Sun fact sheet');
rel('Jupiter mass kg', get('jupiter').massKg, 1.89813e27, 0.001, 'NSSDCA');
rel('Moon mass kg', get('moon').massKg, 7.346e22, 0.002, 'NSSDCA Moon fact sheet 0.07346e24');
rel('Moon surface gravity', get('moon').surfaceGravityMs2, 1.62, 0.01, 'NSSDCA');
rel('Titan mean radius', get('titan').radius.meanKm, 2574.7, 0.001, 'NSSDCA 2574.7');
rel('Mars sidereal rotation hours', get('mars').rotation.siderealPeriodHours, 24.6229, 0.0005, 'NSSDCA 24.6229');
rel('Earth sidereal rotation hours', get('earth').rotation.siderealPeriodHours, 23.9345, 0.0005, 'NSSDCA 23.9345');
rel('Venus sidereal rotation hours (retrograde)', get('venus').rotation.siderealPeriodHours, -5832.5, 0.001, 'NSSDCA -5832.5 hr');
rel('Pluto sidereal rotation hours', get('pluto').rotation.siderealPeriodHours, 153.2928, 0.001, 'NSSDCA -153.2928 (retrograde about the Pluto positive-pole convention differs)');
rel('Triton orbital period (retrograde, i=157)', get('triton').orbit.periodDays, 5.877, 0.001, 'NSSDCA 5.877 d');
rel('Mars semi-major axis AU', get('mars').orbit.aAU, 1.5237, 0.001, 'NSSDCA 227.956e6 km');
rel('Neptune sidereal rotation hours (IAU 2015; NSSDCA lists older 16.11 h)', get('neptune').rotation.siderealPeriodHours, 15.9663, 0.001, 'Archinal 2018 W-dot 541.1397757 deg/d');
rel('Uranus obliquity', get('uranus').obliquityDeg, 97.77, 0.001, 'NSSDCA 97.77');
const walk = (o, p = '$') => { if (typeof o === 'number') assert(Number.isFinite(o), `non-finite at ${p}`); else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) walk(v, `${p}.${k}`); };
walk(bodies);
log('bodies:', bodies.length, bodies.map((b) => b.id).join(','));

const doc = {
  schemaVersion: 1, generated: new Date().toISOString(),
  notes: 'Units: Km/Kg/Ms2/Kms/Deg/Hours as in field names. gmKm3s2 = GM in km^3/s^2. massKg for moons derived as GM/G with G=6.6743e-11. surfaceGravityMs2 = GM/R_eq^2 (non-rotating, at equatorial/1-bar radius); escapeVelocityKms = sqrt(2GM/R_mean) (both derived). rotation: IAU WGCCRE 2015 via NAIF pck00011; null fields = no IAU solution. orbit: planets use Standish elements (see orbit.model), dwarf planets SBDB osculating elements, moons JPL mean elements; epochJD in TDB. null = unknown. sources maps field groups to dataset ids in manifest.part.json.',
  bodies,
};
const p = `${OUT_DIR}/bodies.json`;
await writeJSON(p, doc);
const rr = meta('jpl-planets-phys_par.html');
const common = { version: 'live archive state at retrieval', cachePolicy: 'versioned offline snapshot; optional online refresh', fallback: 'Use bundled snapshot.', provenanceClass: 'observed' };
await upsertManifest([
  { id: 'jpl-ssd-planet-phys-par', name: 'JPL SSD planet and dwarf-planet physical parameters', organization: 'NASA JPL SSD', purpose: 'Radii, mass, density, albedo of planets and dwarf planets', mechanism: 'HTML table scrape (no structured API exists)', endpoint: 'https://ssd.jpl.nasa.gov/planets/phys_par.html', query: null, retrieved: rr, license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics, Planetary Physical Parameters (Park et al. 2021 for planet masses).', rateLimits: JPL_RATE, fieldsUsed: ['equatorial/mean radius', 'mass', 'density', 'geometric albedo', 'sidereal rotation'], updateCadence: 'irregular', normalization: 'scripts/data/solar/build-bodies.mjs', files: [await fileEntry(p, bodies.length)], limitations: 'Dwarf-planet values have large uncertainties (Eris, Haumea, Makemake).', ...common },
  { id: 'jpl-ssd-satellite-phys-par', name: 'JPL SSD planetary satellite physical parameters', organization: 'NASA JPL SSD', purpose: 'Moon GM, mean radius, density', mechanism: 'HTML table scrape', endpoint: 'https://ssd.jpl.nasa.gov/sats/phys_par/', query: null, retrieved: meta('jpl-sats-phys_par.html'), license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics, Planetary Satellite Physical Parameters.', rateLimits: JPL_RATE, fieldsUsed: ['GM', 'mean radius', 'mean density'], updateCadence: 'irregular', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: MOONS.length }], limitations: 'Irregular moons have approximate radii.', ...common },
  { id: 'jpl-ssd-satellite-mean-elements', name: 'JPL SSD planetary satellite mean orbital elements', organization: 'NASA JPL SSD', purpose: 'Moon orbit lines and Laplace-plane orientation', mechanism: 'HTML table scrape', endpoint: 'https://ssd.jpl.nasa.gov/sats/elem/', query: null, retrieved: meta('jpl-sats-elem.html'), license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics, Planetary Satellite Mean Elements.', rateLimits: JPL_RATE, fieldsUsed: ['a', 'e', 'omega', 'M', 'i', 'node', 'P', 'Laplace pole'], updateCadence: 'irregular', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: MOONS.length }], limitations: 'Mean elements at epoch 2000-01-01.5 TDB, rounded; not for precise positions.', ...common },
  { id: 'jpl-ssd-satellite-discovery', name: 'JPL SSD planetary satellite discovery circumstances', organization: 'NASA JPL SSD', purpose: 'Moon discoverer and discovery year', mechanism: 'HTML table scrape', endpoint: 'https://ssd.jpl.nasa.gov/sats/discovery.html', query: null, retrieved: meta('jpl-sats-discovery.html'), license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'NASA/JPL Solar System Dynamics, Planetary Satellite Discovery Circumstances.', rateLimits: JPL_RATE, fieldsUsed: ['name', 'year', 'discoverer'], updateCadence: 'as moons are announced', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: MOONS.length }], limitations: 'None significant.', ...common },
  { id: 'jpl-ssd-approx-pos', name: 'JPL Approximate Positions of the Planets (Standish) Table 1', organization: 'NASA JPL SSD', purpose: 'Planet Keplerian elements and rates for orbit lines / fallback positions', mechanism: 'HTML <pre> table parse', endpoint: 'https://ssd.jpl.nasa.gov/planets/approx_pos.html', query: 'Table 1 (1800-2050 AD)', retrieved: meta('jpl-approx_pos.html'), license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL, citation: 'E. M. Standish, Keplerian Elements for Approximate Positions of the Major Planets, NASA/JPL SSD.', rateLimits: JPL_RATE, fieldsUsed: ['a', 'e', 'I', 'L', 'long.peri', 'long.node', 'rates'], updateCadence: 'static', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: 8 }], limitations: 'Accuracy of arcminutes to arcseconds-scale only within 1800-2050; Earth row is the Earth-Moon barycentre. Use astronomy-engine for runtime positions.', ...common },
  { id: 'naif-pck00011', name: 'NAIF PCK pck00011.tpc (IAU WGCCRE 2015 rotation elements and radii)', organization: 'NASA JPL NAIF', purpose: 'Body pole/prime-meridian rotation models and triaxial radii', mechanism: 'SPICE text kernel parse', endpoint: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/pck00011.tpc', query: null, retrieved: meta('naif-pck00011.tpc'), license: NAIF_LICENSE, licenseUrl: NAIF_LICENSE_URL, citation: 'Archinal et al. 2018, Report of the IAU Working Group on Cartographic Coordinates and Rotational Elements: 2015, Celest. Mech. Dyn. Astr. 130:22; kernel by NASA JPL NAIF.', rateLimits: 'not documented', fieldsUsed: ['BODYn_POLE_RA', 'BODYn_POLE_DEC', 'BODYn_PM', 'BODYn_NUT_PREC_*', 'BODYn_RADII'], updateCadence: 'with IAU reports', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: bodies.length }], limitations: 'Mars system requires the pck00011 convention; Eris/Haumea/Makemake and some irregular moons have no solution.', ...common },
  { id: 'naif-gm-de440', name: 'NAIF gm_de440.tpc (planetary GM values)', organization: 'NASA JPL NAIF', purpose: 'GM of Sun and planets', mechanism: 'SPICE text kernel parse', endpoint: 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck/gm_de440.tpc', query: null, retrieved: meta('naif-gm_de440.tpc'), license: NAIF_LICENSE, licenseUrl: NAIF_LICENSE_URL, citation: 'Park et al. 2021, The JPL Planetary and Lunar Ephemerides DE440 and DE441, AJ 161:105.', rateLimits: 'not documented', fieldsUsed: ['BODYn_GM'], updateCadence: 'with ephemeris releases', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: 9 }], limitations: 'GM of the Sun is in km^3/s^2 (TDB-compatible units).', ...common },
  { id: 'nssdca-planetary-fact-sheets', name: 'NASA NSSDCA Planetary Fact Sheets', organization: 'NASA GSFC NSSDCA', purpose: 'Polar radius, Bond albedo, obliquity, temperatures, atmosphere composition', mechanism: 'HTML table scrape (no API)', endpoint: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/', query: null, retrieved: meta('nssdca-marsfact.html'), license: NASA_LICENSE, licenseUrl: NASA_LICENSE_URL, citation: 'NASA Goddard Space Flight Center, NSSDCA Planetary Fact Sheets (D. R. Williams).', rateLimits: 'not documented', fieldsUsed: ['Polar radius', 'Bond albedo', 'Obliquity to orbit', 'Average temperature', 'Surface pressure', 'Atmospheric composition'], updateCadence: 'infrequent', normalization: 'scripts/data/solar/build-bodies.mjs', files: [{ path: 'data/solar/bodies.json', bytes: (await fileEntry(p, 1)).bytes, records: 10 }], limitations: 'Rounded values; gas giants have no surface (1-bar level used). Titan atmosphere pressure comes from the literature (Fulchignoni et al. 2005).', ...common },
]);
