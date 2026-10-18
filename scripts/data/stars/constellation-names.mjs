// The 88 IAU constellations: official abbreviation, Latin name, genitive and English name.
//
// Source (verified 2026-10-16): IAU "The Constellations" page,
//   https://iauarchive.eso.org/public/themes/constellations/  (formerly https://www.iau.org/public/themes/constellations/)
// The IAU publishes this list only as an HTML page; it has been fixed since the IAU adopted the
// 88 names and abbreviations in 1922 (boundaries 1928/1930), so it is embedded here verbatim.
// englishName: IAU wording with the leading article removed; one typo on the IAU page is
// corrected ("Bernice's Hair" -> "Berenice's Hair").
//
// Order: as listed by the IAU (alphabetical by Latin name).

export const IAU_CONSTELLATIONS = [
  ['And', 'Andromeda', 'Andromedae', 'Chained Maiden'],
  ['Ant', 'Antlia', 'Antliae', 'Air Pump'],
  ['Aps', 'Apus', 'Apodis', 'Bird of Paradise'],
  ['Aqr', 'Aquarius', 'Aquarii', 'Water Bearer'],
  ['Aql', 'Aquila', 'Aquilae', 'Eagle'],
  ['Ara', 'Ara', 'Arae', 'Altar'],
  ['Ari', 'Aries', 'Arietis', 'Ram'],
  ['Aur', 'Auriga', 'Aurigae', 'Charioteer'],
  ['Boo', 'Boötes', 'Boötis', 'Herdsman'],
  ['Cae', 'Caelum', 'Caeli', 'Engraving Tool'],
  ['Cam', 'Camelopardalis', 'Camelopardalis', 'Giraffe'],
  ['Cnc', 'Cancer', 'Cancri', 'Crab'],
  ['CVn', 'Canes Venatici', 'Canum Venaticorum', 'Hunting Dogs'],
  ['CMa', 'Canis Major', 'Canis Majoris', 'Great Dog'],
  ['CMi', 'Canis Minor', 'Canis Minoris', 'Lesser Dog'],
  ['Cap', 'Capricornus', 'Capricorni', 'Sea Goat'],
  ['Car', 'Carina', 'Carinae', 'Keel'],
  ['Cas', 'Cassiopeia', 'Cassiopeiae', 'Seated Queen'],
  ['Cen', 'Centaurus', 'Centauri', 'Centaur'],
  ['Cep', 'Cepheus', 'Cephei', 'King'],
  ['Cet', 'Cetus', 'Ceti', 'Sea Monster'],
  ['Cha', 'Chamaeleon', 'Chamaeleontis', 'Chameleon'],
  ['Cir', 'Circinus', 'Circini', 'Drawing Compass'],
  ['Col', 'Columba', 'Columbae', 'Dove'],
  ['Com', 'Coma Berenices', 'Comae Berenices', "Berenice's Hair"],
  ['CrA', 'Corona Australis', 'Coronae Australis', 'Southern Crown'],
  ['CrB', 'Corona Borealis', 'Coronae Borealis', 'Northern Crown'],
  ['Crv', 'Corvus', 'Corvi', 'Crow'],
  ['Crt', 'Crater', 'Crateris', 'Cup'],
  ['Cru', 'Crux', 'Crucis', 'Southern Cross'],
  ['Cyg', 'Cygnus', 'Cygni', 'Swan'],
  ['Del', 'Delphinus', 'Delphini', 'Dolphin'],
  ['Dor', 'Dorado', 'Doradus', 'Swordfish'],
  ['Dra', 'Draco', 'Draconis', 'Dragon'],
  ['Equ', 'Equuleus', 'Equulei', 'Little Horse'],
  ['Eri', 'Eridanus', 'Eridani', 'River'],
  ['For', 'Fornax', 'Fornacis', 'Furnace'],
  ['Gem', 'Gemini', 'Geminorum', 'Twins'],
  ['Gru', 'Grus', 'Gruis', 'Crane'],
  ['Her', 'Hercules', 'Herculis', 'Hercules'],
  ['Hor', 'Horologium', 'Horologii', 'Clock'],
  ['Hya', 'Hydra', 'Hydrae', 'Female Water Snake'],
  ['Hyi', 'Hydrus', 'Hydri', 'Male Water Snake'],
  ['Ind', 'Indus', 'Indi', 'Indian'],
  ['Lac', 'Lacerta', 'Lacertae', 'Lizard'],
  ['Leo', 'Leo', 'Leonis', 'Lion'],
  ['LMi', 'Leo Minor', 'Leonis Minoris', 'Lesser Lion'],
  ['Lep', 'Lepus', 'Leporis', 'Hare'],
  ['Lib', 'Libra', 'Librae', 'Scales'],
  ['Lup', 'Lupus', 'Lupi', 'Wolf'],
  ['Lyn', 'Lynx', 'Lyncis', 'Lynx'],
  ['Lyr', 'Lyra', 'Lyrae', 'Lyre'],
  ['Men', 'Mensa', 'Mensae', 'Table Mountain'],
  ['Mic', 'Microscopium', 'Microscopii', 'Microscope'],
  ['Mon', 'Monoceros', 'Monocerotis', 'Unicorn'],
  ['Mus', 'Musca', 'Muscae', 'Fly'],
  ['Nor', 'Norma', 'Normae', "Carpenter's Square"],
  ['Oct', 'Octans', 'Octantis', 'Octant'],
  ['Oph', 'Ophiuchus', 'Ophiuchi', 'Serpent Bearer'],
  ['Ori', 'Orion', 'Orionis', 'Hunter'],
  ['Pav', 'Pavo', 'Pavonis', 'Peacock'],
  ['Peg', 'Pegasus', 'Pegasi', 'Winged Horse'],
  ['Per', 'Perseus', 'Persei', 'Hero'],
  ['Phe', 'Phoenix', 'Phoenicis', 'Phoenix'],
  ['Pic', 'Pictor', 'Pictoris', "Painter's Easel"],
  ['Psc', 'Pisces', 'Piscium', 'Fishes'],
  ['PsA', 'Piscis Austrinus', 'Piscis Austrini', 'Southern Fish'],
  ['Pup', 'Puppis', 'Puppis', 'Stern'],
  ['Pyx', 'Pyxis', 'Pyxidis', 'Mariner Compass'],
  ['Ret', 'Reticulum', 'Reticuli', 'Reticle'],
  ['Sge', 'Sagitta', 'Sagittae', 'Arrow'],
  ['Sgr', 'Sagittarius', 'Sagittarii', 'Archer'],
  ['Sco', 'Scorpius', 'Scorpii', 'Scorpion'],
  ['Scl', 'Sculptor', 'Sculptoris', 'Sculptor'],
  ['Sct', 'Scutum', 'Scuti', 'Shield'],
  ['Ser', 'Serpens', 'Serpentis', 'Serpent'],
  ['Sex', 'Sextans', 'Sextantis', 'Sextant'],
  ['Tau', 'Taurus', 'Tauri', 'Bull'],
  ['Tel', 'Telescopium', 'Telescopii', 'Telescope'],
  ['Tri', 'Triangulum', 'Trianguli', 'Triangle'],
  ['TrA', 'Triangulum Australe', 'Trianguli Australis', 'Southern Triangle'],
  ['Tuc', 'Tucana', 'Tucanae', 'Toucan'],
  ['UMa', 'Ursa Major', 'Ursae Majoris', 'Great Bear'],
  ['UMi', 'Ursa Minor', 'Ursae Minoris', 'Little Bear'],
  ['Vel', 'Vela', 'Velorum', 'Sails'],
  ['Vir', 'Virgo', 'Virginis', 'Maiden'],
  ['Vol', 'Volans', 'Volantis', 'Flying Fish'],
  ['Vul', 'Vulpecula', 'Vulpeculae', 'Fox'],
].map(([abbr, name, genitive, englishName]) => ({ abbr, name, genitive, englishName }));

export const IAU_CONSTELLATIONS_URL = 'https://iauarchive.eso.org/public/themes/constellations/';

if (IAU_CONSTELLATIONS.length !== 88) {
  throw new Error(`IAU constellation table must have 88 entries, has ${IAU_CONSTELLATIONS.length}`);
}

/** Case-insensitive lookup: 'ORI' / 'ori' / 'Ori' -> 'Ori'. */
const byUpper = new Map(IAU_CONSTELLATIONS.map((c) => [c.abbr.toUpperCase(), c]));
export function canonicalAbbr(code) {
  if (code == null) return null;
  const c = byUpper.get(String(code).trim().toUpperCase());
  return c ? c.abbr : null;
}
export function constellationByAbbr(code) {
  return byUpper.get(String(code).trim().toUpperCase()) ?? null;
}
