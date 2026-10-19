/**
 * Build the surface-features dataset for src/domains/features from the cached IAU/USGS Gazetteer table
 * (data-raw/features/gazetteer_all.json, see fetch_gazetteer.py + parse_gazetteer.py) plus mission landing sites from
 * published coordinates (cited per site) and a few informal / dynamic features.
 *
 * Writes: public/data/features/features.json, public/data/features/manifest.part.json,
 *         src/domains/features/features.generated.json (same records, bundled so entities exist synchronously),
 *         docs/data/features.md.
 * Usage:  node scripts/data/features/build-features.mjs
 */
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const RAW = join(ROOT, 'data-raw', 'features');
const gaz = JSON.parse(readFileSync(join(RAW, 'gazetteer_all.json'), 'utf8'));
const retrieval = JSON.parse(readFileSync(join(RAW, 'retrieval.json'), 'utf8'));
const retrievedAt = Object.values(retrieval).map((r) => r.retrieved).sort()[0] ?? new Date().toISOString();

const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const wrapLon = (l) => { let x = ((l + 180) % 360 + 360) % 360 - 180; if (x === -180) x = 180; return Math.round(x * 1e4) / 1e4; };

/** Body key (lowercase) → Gazetteer export name. */
const BODIES = {
  moon: 'MOON', mercury: 'MERCURY', venus: 'VENUS', mars: 'MARS', io: 'IO', europa: 'EUROPA', ganymede: 'GANYMEDE',
  callisto: 'CALLISTO', titan: 'TITAN', enceladus: 'ENCELADUS', mimas: 'MIMAS', iapetus: 'IAPETUS', tethys: 'TETHYS',
  dione: 'DIONE', rhea: 'RHEA', miranda: 'MIRANDA', ariel: 'ARIEL', titania: 'TITANIA', triton: 'TRITON', pluto: 'PLUTO',
  charon: 'CHARON', ceres: 'CERES', vesta: 'VESTA', phobos: 'PHOBOS', eros: 'EROS',
};

/**
 * Curated Gazetteer selection: [body, exact Gazetteer name, importance 0-100, short description (optional), aliases (optional)].
 * Importance drives label decluttering: ≥ 80 hero (visible from a whole-disc view), 60-79 major, < 60 close-range only.
 */
const PICK = [
  // Moon
  ['moon', 'Mare Tranquillitatis', 82, 'Basalt plain where Apollo 11 landed in 1969.', ['Sea of Tranquility']],
  ['moon', 'Mare Imbrium', 84, 'Vast lava-flooded impact basin, the right eye of the "man in the Moon".', ['Sea of Showers']],
  ['moon', 'Mare Serenitatis', 80, 'Circular mare of a 3.9-billion-year-old impact basin; Apollo 17 landed on its edge.', ['Sea of Serenity']],
  ['moon', 'Mare Crisium', 78, 'Isolated circular mare near the eastern limb.', ['Sea of Crises']],
  ['moon', 'Oceanus Procellarum', 85, 'The largest mare, a dark lava ocean covering much of the western near side.', ['Ocean of Storms']],
  ['moon', 'Mare Nubium', 70, null, ['Sea of Clouds']],
  ['moon', 'Mare Frigoris', 66, null, ['Sea of Cold']],
  ['moon', 'Mare Fecunditatis', 70, null, ['Sea of Fertility']],
  ['moon', 'Mare Nectaris', 66, null, ['Sea of Nectar']],
  ['moon', 'Mare Humorum', 64, null, ['Sea of Moisture']],
  ['moon', 'Mare Vaporum', 52, null, ['Sea of Vapours']],
  ['moon', 'Sinus Iridum', 58, 'A half-ring "bay of rainbows" on the shore of Mare Imbrium.', ['Bay of Rainbows']],
  ['moon', 'Mare Orientale', 74, 'Bull\'s-eye multi-ring basin on the western limb, the best preserved large impact basin.', ['Eastern Sea']],
  ['moon', 'Mare Moscoviense', 62, 'One of the few maria on the far side.', ['Sea of Moscow']],
  ['moon', 'Mare Australe', 50, null, ['Southern Sea']],
  ['moon', 'Mare Smythii', 46, null, ['Smyth\'s Sea']],
  ['moon', 'Mare Marginis', 44, null, ['Border Sea']],
  ['moon', 'Mare Ingenii', 52, 'Far-side mare famous for its lunar swirls.', ['Sea of Cleverness']],
  ['moon', 'Lacus Somniorum', 40, null, ['Lake of Dreams']],
  ['moon', 'Tycho', 86, 'Young (≈108-million-year) crater whose bright rays stretch across the near side; Surveyor 7 landed on its rim.'],
  ['moon', 'Copernicus', 84, 'Textbook 93 km complex crater with terraced walls and central peaks, ≈800 million years old.'],
  ['moon', 'Kepler', 62, 'Small bright-rayed crater in Oceanus Procellarum.'],
  ['moon', 'Aristarchus', 70, 'The brightest large feature on the Moon, sitting on a volcanic plateau.'],
  ['moon', 'Plato', 66, 'Dark lava-flooded crater on the northern shore of Mare Imbrium.'],
  ['moon', 'Clavius', 68, 'One of the largest near-side craters, where SOFIA detected molecular water in 2020.'],
  ['moon', 'Grimaldi', 54, 'Dark-floored basin near the western limb.'],
  ['moon', 'Langrenus', 52, null],
  ['moon', 'Theophilus', 56, null],
  ['moon', 'Petavius', 52, null],
  ['moon', 'Ptolemaeus', 56, null],
  ['moon', 'Alphonsus', 52, 'Crater where Ranger 9 impacted in 1965.'],
  ['moon', 'Arzachel', 44, null],
  ['moon', 'Bailly', 46, null],
  ['moon', 'Hevelius', 40, null],
  ['moon', 'Shackleton', 78, 'Crater at the lunar south pole whose floor never sees sunlight; a prime target for Artemis.'],
  ['moon', 'de Gerlache', 50, 'Polar crater next to Shackleton on the Artemis exploration list.'],
  ['moon', 'Tsiolkovskiy', 66, 'Far-side crater with a striking dark lava floor and central peak.'],
  ['moon', 'Korolev', 50, null],
  ['moon', 'Hertzsprung', 54, 'Huge far-side multi-ring basin.'],
  ['moon', 'Apollo', 56, 'Far-side basin inside South Pole-Aitken, named for the Apollo programme.'],
  ['moon', 'Von Karman', 66, 'Far-side crater inside South Pole-Aitken where Chang\'e 4 made the first far-side landing.'],
  ['moon', 'Schrodinger', 52, 'Young far-side peak-ring basin near the south pole.', ['Schrödinger']],
  ['moon', 'Montes Apenninus', 66, 'Mountain range on the rim of the Imbrium basin, rising up to 5 km.', ['Apennine Mountains']],
  ['moon', 'Montes Carpatus', 44, null, ['Carpathian Mountains']],
  ['moon', 'Mons Hadley', 50, 'Mountain beside the Apollo 15 landing site.'],
  ['moon', 'Rima Hadley', 52, 'Sinuous lava channel explored by Apollo 15.', ['Hadley Rille']],
  ['moon', 'Vallis Alpes', 52, 'A 166 km straight valley cutting through the lunar Alps.', ['Alpine Valley']],
  ['moon', 'Rupes Recta', 54, 'A 110 km fault scarp, the "Straight Wall".', ['Straight Wall']],
  // Mars
  ['mars', 'Olympus Mons', 95, 'The tallest volcano in the Solar System: ≈22 km above the surrounding plains and 600 km across.'],
  ['mars', 'Valles Marineris', 94, 'A canyon system ≈4,000 km long and up to 7 km deep, long enough to span the continental USA.'],
  ['mars', 'Tharsis Montes', 78, 'Three giant shield volcanoes in a row on the Tharsis bulge.'],
  ['mars', 'Arsia Mons', 64, null],
  ['mars', 'Pavonis Mons', 62, null],
  ['mars', 'Ascraeus Mons', 64, null],
  ['mars', 'Alba Mons', 60, 'The largest volcano by area on Mars, very broad and very low.'],
  ['mars', 'Elysium Mons', 66, null],
  ['mars', 'Hellas Planitia', 90, 'An impact basin 2,300 km wide and 7 km deep; air pressure at its floor is the highest on Mars.'],
  ['mars', 'Argyre Planitia', 70, null],
  ['mars', 'Isidis Planitia', 66, null],
  ['mars', 'Utopia Planitia', 74, 'The largest recognised impact basin in the Solar System; Viking 2 and Zhurong landed here.'],
  ['mars', 'Chryse Planitia', 64, null],
  ['mars', 'Acidalia Planitia', 60, null],
  ['mars', 'Amazonis Planitia', 54, null],
  ['mars', 'Elysium Planitia', 60, null],
  ['mars', 'Syrtis Major Planum', 76, 'Dark basaltic plain, the first surface feature ever recorded on another planet (Huygens, 1659).'],
  ['mars', 'Meridiani Planum', 66, 'Plain rich in hematite "blueberries"; Opportunity roamed here for 14 years.'],
  ['mars', 'Arabia Terra', 56, null],
  ['mars', 'Terra Sabaea', 48, null],
  ['mars', 'Noctis Labyrinthus', 66, 'A maze of fault-bounded canyons at the western end of Valles Marineris.', ['Labyrinth of the Night']],
  ['mars', 'Candor Chasma', 52, null],
  ['mars', 'Melas Chasma', 52, null],
  ['mars', 'Ius Chasma', 48, null],
  ['mars', 'Kasei Valles', 56, 'Giant outflow channels carved by catastrophic floods.'],
  ['mars', 'Ares Vallis', 52, null],
  ['mars', 'Medusae Fossae', 44, null],
  ['mars', 'Planum Boreum', 86, 'The north polar cap: water ice up to 3 km thick, capped with seasonal CO2 frost.', ['North polar cap']],
  ['mars', 'Planum Australe', 84, 'The south polar cap, with a permanent layer of CO2 ice over water ice.', ['South polar cap']],
  ['mars', 'Gale', 80, '154 km crater with a 5 km layered mountain (Aeolis Mons) explored by Curiosity since 2012.', ['Gale crater']],
  ['mars', 'Jezero', 80, 'Ancient lake crater with a river delta; Perseverance is collecting samples here.', ['Jezero crater']],
  ['mars', 'Gusev', 62, 'Crater explored by the Spirit rover.'],
  ['mars', 'Endeavour', 48, 'Crater Opportunity explored for its last seven years.'],
  ['mars', 'Victoria', 40, 'Small crater Opportunity circled in 2006-08.'],
  ['mars', 'Eberswalde', 46, 'Crater with a beautifully preserved fossil river delta.'],
  ['mars', 'Holden', 40, null],
  ['mars', 'Huygens', 56, null],
  ['mars', 'Schiaparelli', 56, null],
  ['mars', 'Lyot', 44, null],
  ['mars', 'Korolev', 56, 'An 82 km crater permanently filled with a 1.8 km thick block of water ice.'],
  // Mercury
  ['mercury', 'Caloris Planitia', 90, 'Impact basin ≈1,500 km across; the impact shook the opposite side of the planet into "weird terrain".', ['Caloris Basin']],
  ['mercury', 'Caloris Montes', 54, null],
  ['mercury', 'Rembrandt', 66, null],
  ['mercury', 'Beethoven', 58, null],
  ['mercury', 'Tolstoj', 56, null],
  ['mercury', 'Mozart', 50, null],
  ['mercury', 'Rachmaninoff', 60, 'Peak-ring basin with some of the youngest volcanic plains on Mercury.'],
  ['mercury', 'Raditladi', 48, null],
  ['mercury', 'Hokusai', 58, 'Bright young crater with rays extending over 4,000 km.'],
  ['mercury', 'Kuiper', 52, null],
  ['mercury', 'Prokofiev', 54, 'North-polar crater with water ice in permanent shadow.'],
  ['mercury', 'Borealis Planitia', 60, null],
  ['mercury', 'Enterprise Rupes', 58, 'The longest scarp on Mercury, ≈820 km: the planet is shrinking as its core cools.'],
  ['mercury', 'Discovery Rupes', 50, null],
  ['mercury', 'Carnegie Rupes', 44, null],
  ['mercury', 'Bach', 44, null],
  ['mercury', 'Debussy', 44, null],
  ['mercury', 'Degas', 40, null],
  // Venus (radar features beneath the clouds)
  ['venus', 'Maxwell Montes', 90, 'The highest mountains on Venus, ≈11 km above the mean radius; the only male name on the planet.'],
  ['venus', 'Ishtar Terra', 86, 'Northern highland "continent" about the size of Australia.'],
  ['venus', 'Aphrodite Terra', 86, 'Equatorial highland roughly the size of South America.'],
  ['venus', 'Lakshmi Planum', 62, null],
  ['venus', 'Beta Regio', 66, 'Volcanic rise split by a rift valley.'],
  ['venus', 'Maat Mons', 72, 'The highest volcano on Venus, ≈8 km; Magellan data hint at recent eruptions.'],
  ['venus', 'Sapas Mons', 52, null],
  ['venus', 'Theia Mons', 52, null],
  ['venus', 'Artemis Corona', 62, 'A 2,600 km ring structure, the largest corona on Venus.'],
  ['venus', 'Artemis Chasma', 46, null],
  ['venus', 'Mead', 50, 'The largest impact crater on Venus.'],
  // Galilean moons
  ['io', 'Loki Patera', 88, 'The most powerful persistent volcano in the Solar System: a 200 km lava lake that overturns every few hundred days.'],
  ['io', 'Pele', 84, 'Eruptive centre whose plume rises ≈300 km and paints a red ring 1,200 km wide.'],
  ['io', 'Prometheus', 72, 'Long-lived volcano whose plume has been active since Voyager 1.'],
  ['io', 'Tvashtar Paterae', 64, null],
  ['io', 'Masubi', 54, null],
  ['io', 'Marduk', 52, null],
  ['io', 'Amirani', 60, 'Source of the longest active lava flows known in the Solar System.'],
  ['io', 'Pillan Patera', 54, null],
  ['io', 'Tupan Patera', 46, null],
  ['io', 'Ra Patera', 44, null],
  ['io', 'Culann Patera', 40, null],
  ['io', 'Boosaule Montes', 58, 'Io\'s highest mountain, ≈17.5 km — taller than Everest.', ['Boösaule Montes']],
  ['europa', 'Conamara Chaos', 86, 'Rafts of ice that broke apart, drifted and refroze: evidence of the ocean below.'],
  ['europa', 'Pwyll', 82, 'Young 45 km crater with bright rays stretching over 1,000 km.'],
  ['europa', 'Thera Macula', 56, null],
  ['europa', 'Thrace Macula', 50, null],
  ['europa', 'Tyre', 54, 'Multi-ring impact structure.'],
  ['europa', 'Callanish', 48, null],
  ['europa', 'Manannan', 46, null],
  ['europa', 'Agenor Linea', 48, null],
  ['ganymede', 'Galileo Regio', 88, 'Dark ancient terrain covering a third of the hemisphere, the largest single feature on Ganymede.'],
  ['ganymede', 'Marius Regio', 64, null],
  ['ganymede', 'Nicholson Regio', 56, null],
  ['ganymede', 'Uruk Sulcus', 62, 'Bright grooved terrain formed by tectonic stretching of the ice shell.'],
  ['ganymede', 'Osiris', 56, null],
  ['ganymede', 'Tros', 56, 'Bright-rayed crater.'],
  ['ganymede', 'Gilgamesh', 54, 'The largest well-preserved impact basin on Ganymede.'],
  ['ganymede', 'Enki Catena', 52, 'Chain of 13 craters left by a comet torn apart by Jupiter\'s gravity.'],
  ['callisto', 'Valhalla', 90, 'Multi-ring impact structure ≈3,800 km across, the largest in the Solar System.'],
  ['callisto', 'Asgard', 72, 'Second-largest multi-ring structure on Callisto.'],
  ['callisto', 'Adlinda', 48, null],
  ['callisto', 'Heimdall', 46, null],
  ['callisto', 'Burr', 44, null],
  // Saturn system
  ['titan', 'Kraken Mare', 90, 'The largest sea of liquid methane and ethane on Titan, bigger than the Caspian Sea.'],
  ['titan', 'Ligeia Mare', 84, 'Second-largest hydrocarbon sea; radar measured depths of ≈160 m.'],
  ['titan', 'Punga Mare', 66, null],
  ['titan', 'Ontario Lacus', 66, 'The largest lake in Titan\'s southern hemisphere.'],
  ['titan', 'Jingpo Lacus', 48, null],
  ['titan', 'Bolsena Lacus', 40, null],
  ['titan', 'Xanadu', 84, 'Bright continent-sized highland the size of Australia, the first surface feature seen on Titan.'],
  ['titan', 'Shangri La', 76, 'Vast dark field of hydrocarbon sand dunes where Huygens landed.', ['Shangri-La']],
  ['titan', 'Belet', 56, null],
  ['titan', 'Adiri', 50, null],
  ['titan', 'Menrva', 64, 'The largest impact crater on Titan.'],
  ['titan', 'Selk', 66, 'Crater chosen as the landing target of NASA\'s Dragonfly rotorcraft (arriving 2034).'],
  ['titan', 'Sotra Patera', 52, 'Possible cryovolcano, Titan\'s deepest known pit.'],
  ['titan', 'Doom Mons', 48, null],
  ['titan', 'Hotei Regio', 46, null],
  ['titan', 'Mayda Insula', 40, null],
  ['enceladus', 'Baghdad Sulcus', 86, 'Tiger stripe: a fracture venting water-ice jets from the subsurface ocean.'],
  ['enceladus', 'Damascus Sulcus', 84, 'Tiger stripe: the most active jet source seen by Cassini.'],
  ['enceladus', 'Cairo Sulcus', 82, 'Tiger stripe at the south pole of Enceladus.'],
  ['enceladus', 'Alexandria Sulcus', 82, 'Tiger stripe at the south pole of Enceladus.'],
  ['enceladus', 'Samarkand Sulci', 50, null],
  ['enceladus', 'Sarandib Planitia', 44, null],
  ['enceladus', 'Diyar Planitia', 44, null],
  ['enceladus', 'Ali Baba', 40, null],
  ['enceladus', 'Aladdin', 40, null],
  ['mimas', 'Herschel', 92, 'A crater one third of Mimas\' diameter: the impact nearly shattered the moon.'],
  ['iapetus', 'Cassini Regio', 90, 'The coal-dark leading hemisphere of the two-toned moon Iapetus.'],
  ['iapetus', 'Roncevaux Terra', 70, 'The bright trailing hemisphere.'],
  ['iapetus', 'Turgis', 56, null],
  ['iapetus', 'Engelier', 52, null],
  ['iapetus', 'Gerin', 46, null],
  ['tethys', 'Odysseus', 80, 'Impact basin 445 km across on a 1,062 km moon.'],
  ['tethys', 'Ithaca Chasma', 74, 'Canyon ≈2,000 km long, wrapping three quarters of the way around Tethys.'],
  ['dione', 'Padua Chasmata', 64, null],
  ['dione', 'Evander', 62, null],
  ['rhea', 'Tirawa', 62, null],
  ['rhea', 'Mamaldi', 56, null],
  ['rhea', 'Inktomi', 60, 'Young bright-rayed crater.'],
  // Uranus and Neptune systems
  ['miranda', 'Verona Rupes', 84, 'Cliff ≈20 km high, possibly the tallest in the Solar System.'],
  ['miranda', 'Inverness Corona', 62, null],
  ['miranda', 'Arden Corona', 60, null],
  ['miranda', 'Elsinore Corona', 56, null],
  ['ariel', 'Kachina Chasmata', 66, null],
  ['ariel', 'Yangoor', 44, null],
  ['titania', 'Messina Chasmata', 66, null],
  ['titania', 'Gertrude', 60, null],
  ['triton', 'Mahilani', 70, 'One of the dark streaks left by nitrogen geysers seen by Voyager 2.'],
  ['triton', 'Hili', 70, 'Active nitrogen geyser plume seen by Voyager 2 in 1989.'],
  ['triton', 'Uhlanga Regio', 74, 'The bright southern polar cap of nitrogen frost.'],
  ['triton', 'Bubembe Regio', 62, 'Home of the "cantaloupe terrain", unique to Triton.'],
  ['triton', 'Monad Regio', 50, null],
  ['triton', 'Tuonela Planitia', 54, null],
  ['triton', 'Ruach Planitia', 54, null],
  ['triton', 'Sipapu Planitia', 46, null],
  ['triton', 'Leviathan Patera', 52, null],
  ['triton', 'Abatos Planum', 44, null],
  // Pluto and Charon
  ['pluto', 'Tombaugh Regio', 95, 'Pluto\'s "heart": a bright region of nitrogen, methane and carbon monoxide ices 2,300 km across.', ['The Heart']],
  ['pluto', 'Sputnik Planitia', 92, 'The heart\'s western lobe: a 1,000 km glacier of convecting nitrogen ice with no craters at all.'],
  ['pluto', 'Wright Mons', 74, 'Possible giant cryovolcano, ≈4 km high with a central depression.'],
  ['pluto', 'Piccard Mons', 60, null],
  ['pluto', 'Hillary Montes', 66, 'Water-ice mountains up to ≈3 km on the heart\'s edge.'],
  ['pluto', 'Tenzing Montes', 66, 'Pluto\'s highest mountains, ≈6 km of water ice.'],
  ['pluto', 'Al-Idrisi Montes', 56, null],
  ['pluto', 'Belton Regio', 82, 'Dark reddish equatorial band coloured by tholins (formerly nicknamed Cthulhu).', ['Cthulhu', 'Cthulhu Macula', 'Cthulhu Regio']],
  ['pluto', 'Lowell Regio', 66, 'The north-polar region.'],
  ['pluto', 'Tartarus Dorsa', 62, 'Bladed terrain of methane ice "snakeskin" ridges hundreds of metres tall.'],
  ['pluto', 'Viking Terra', 50, null],
  ['pluto', 'Voyager Terra', 50, null],
  ['pluto', 'Pioneer Terra', 46, null],
  ['pluto', 'Burney', 50, null],
  ['pluto', 'Hayabusa Terra', 44, null],
  ['pluto', 'Venera Terra', 44, null],
  ['charon', 'Argo Chasma', 60, null],
  ['charon', 'Mandjet Chasma', 56, null],
  ['charon', 'Kubrick Mons', 66, 'A mountain sitting in a moat — the ice crust sagged under its weight.'],
  ['charon', 'Dorothy', 52, null],
  ['charon', 'Clarke Montes', 44, null],
  ['charon', 'Caleuche Chasma', 50, null],
  // Ceres, Vesta, Phobos, Eros
  ['ceres', 'Occator', 92, 'A 92 km crater with the brightest spots on Ceres: salt deposits left by brine from below.'],
  ['ceres', 'Cerealia Facula', 74, 'The brightest spot on Ceres: sodium carbonate dome in the centre of Occator.'],
  ['ceres', 'Vinalia Faculae', 56, null],
  ['ceres', 'Ahuna Mons', 86, 'A lone 4 km ice volcano made of salty mud.'],
  ['ceres', 'Kerwan', 66, 'The largest crater on Ceres.'],
  ['ceres', 'Yalode', 58, null],
  ['ceres', 'Urvara', 56, null],
  ['ceres', 'Haulani', 60, 'Young crater with bright blue-tinted ejecta.'],
  ['ceres', 'Dantu', 50, null],
  ['ceres', 'Ernutet', 48, 'Crater where Dawn detected organic compounds.'],
  ['vesta', 'Rheasilvia', 92, 'Impact basin 500 km wide (95% of Vesta\'s diameter) with a central peak ≈22 km high; source of the HED meteorites.'],
  ['vesta', 'Veneneia', 64, 'Older giant basin partly overlapped by Rheasilvia.'],
  ['vesta', 'Divalia Fossae', 64, 'Equatorial troughs encircling Vesta, cracks from the Rheasilvia impact.'],
  ['vesta', 'Saturnalia Fossae', 50, null],
  ['vesta', 'Marcia', 56, null],
  ['vesta', 'Calpurnia', 44, null],
  ['vesta', 'Minucia', 42, null],
  ['vesta', 'Cornelia', 42, null],
  ['phobos', 'Stickney', 88, 'A 9 km crater on a 22 km moon.'],
  ['eros', 'Himeros', 60, 'Saddle-shaped depression on the side of Eros.'],
  ['eros', 'Psyche', 56, 'The largest crater on Eros.'],
  ['eros', 'Charlois Regio', 44, null],
];

/**
 * Mission landing sites from published coordinates (planetocentric, east-positive). `src` is the citation shown in the fact sheet.
 * Lunar coordinates from LROC (Wagner et al. 2017, Icarus 283, 92-103 for Apollo/Luna/Surveyor; LROC news releases for Chang'e).
 */
const LROC = 'LROC: Wagner, R. V. et al. (2017), Coordinates of anthropogenic features on the Moon, Icarus 283, 92-103';
const NSSDCA = 'NASA NSSDCA Master Catalog (nssdc.gsfc.nasa.gov)';
const SITES = [
  // body, name, lat, lon, date (UTC), agency, importance, crew/notes, coordinate source
  ['moon', 'Apollo 11', 0.67408, 23.47297, '1969-07-20', 'NASA', 96, 'Neil Armstrong and Buzz Aldrin: the first humans on another world. Tranquility Base.', LROC, ['Tranquility Base', 'Statio Tranquillitatis', 'Eagle']],
  ['moon', 'Apollo 12', -3.01239, -23.42157, '1969-11-19', 'NASA', 80, 'Pete Conrad and Alan Bean landed within walking distance of Surveyor 3.', LROC, ['Intrepid']],
  ['moon', 'Apollo 14', -3.6453, -17.47136, '1971-02-05', 'NASA', 78, 'Alan Shepard and Edgar Mitchell explored the Fra Mauro highlands.', LROC, ['Antares', 'Fra Mauro']],
  ['moon', 'Apollo 15', 26.13222, 3.63386, '1971-07-30', 'NASA', 82, 'David Scott and James Irwin, first Lunar Roving Vehicle, at Hadley Rille below the Apennines.', LROC, ['Falcon', 'Hadley-Apennine']],
  ['moon', 'Apollo 16', -8.97301, 15.50019, '1972-04-21', 'NASA', 78, 'John Young and Charles Duke in the Descartes highlands.', LROC, ['Orion', 'Descartes']],
  ['moon', 'Apollo 17', 20.1908, 30.77168, '1972-12-11', 'NASA', 84, 'Gene Cernan and Harrison Schmitt, the last humans on the Moon, in the Taurus-Littrow valley.', LROC, ['Challenger', 'Taurus-Littrow']],
  ['moon', 'Luna 9', 7.08, -64.37, '1966-02-03', 'USSR', 72, 'First soft landing on another world and first photographs from the lunar surface.', `${NSSDCA} (site not yet identified in LROC images; position approximate)`],
  ['moon', 'Luna 16', -0.5137, 56.3638, '1970-09-20', 'USSR', 64, 'First robotic sample return (101 g of soil from Mare Fecunditatis).', LROC],
  ['moon', 'Luna 17 / Lunokhod 1', 38.2378, -35.0017, '1970-11-17', 'USSR', 70, 'Delivered Lunokhod 1, the first remote-controlled rover on another world.', LROC, ['Lunokhod 1', 'Luna 17']],
  ['moon', 'Luna 24', 12.7145, 62.2129, '1976-08-18', 'USSR', 58, 'Last Soviet sample return, from Mare Crisium.', LROC],
  ['moon', 'Surveyor 1', -2.4745, -43.3394, '1966-06-02', 'NASA', 54, 'First US soft landing on the Moon.', LROC],
  ['moon', 'Surveyor 3', -3.0161, -23.4157, '1967-04-20', 'NASA', 52, 'Visited by the Apollo 12 astronauts, who brought its camera home.', LROC],
  ['moon', 'Surveyor 5', 1.41, 23.1926, '1967-09-11', 'NASA', 44, 'First chemical analysis of lunar soil.', LROC],
  ['moon', 'Surveyor 6', 0.4743, -1.4278, '1967-11-10', 'NASA', 44, 'Made the first lift-off from the Moon (a 3 m hop).', LROC],
  ['moon', 'Surveyor 7', -40.981, -11.5121, '1968-01-10', 'NASA', 50, 'Landed on the rim of Tycho.', LROC],
  ['moon', "Chang'e 3 / Yutu", 44.1214, -19.5116, '2013-12-14', 'CNSA', 62, 'First soft landing on the Moon since 1976, with the Yutu rover.', 'LROC news release (2014)', ['Yutu', "Chang'e 3"]],
  ['moon', "Chang'e 4 / Yutu-2", -45.4446, 177.5991, '2019-01-03', 'CNSA', 80, 'First landing on the far side of the Moon, in Von Kármán crater.', 'LROC news release (2019)', ['Yutu-2', "Chang'e 4"]],
  ['moon', "Chang'e 5", 43.0576, -51.9161, '2020-12-01', 'CNSA', 70, 'Returned 1.7 kg of young (≈2-billion-year) basalt from Oceanus Procellarum.', 'LROC news release (2020)'],
  ['moon', "Chang'e 6", -41.6385, -153.9852, '2024-06-01', 'CNSA', 76, 'First samples from the far side, from the Apollo basin inside South Pole-Aitken.', 'LROC news release (2024)'],
  ['moon', 'Chandrayaan-3 Vikram', -69.373, 32.319, '2023-08-23', 'ISRO', 72, 'First landing near the lunar south pole, with the Pragyan rover.', 'ISRO / LROC news release (2023)', ['Vikram', 'Pragyan', 'Shiv Shakti point']],
  // Mars (MOLA planetocentric, east)
  ['mars', 'Viking 1', 22.27, 312.05, '1976-07-20', 'NASA', 76, 'First successful Mars lander, in Chryse Planitia.', `${NSSDCA}; Parker & Kirk (1999)`],
  ['mars', 'Viking 2', 47.64, 134.29, '1976-09-03', 'NASA', 66, 'Second Viking lander, photographed frost on Utopia Planitia.', NSSDCA],
  ['mars', 'Mars Pathfinder', 19.13, 326.78, '1997-07-04', 'NASA', 66, 'Carried Sojourner, the first rover on Mars, to Ares Vallis.', 'Golombek et al. (1997), Science 278', ['Sojourner', 'Carl Sagan Memorial Station']],
  ['mars', 'Spirit', -14.5684, 175.4726, '2004-01-04', 'NASA', 70, 'Mars Exploration Rover A, explored Gusev crater for six years.', 'Arvidson et al. (2004), Science 305', ['MER-A']],
  ['mars', 'Opportunity', -1.9462, 354.4734, '2004-01-25', 'NASA', 76, 'Mars Exploration Rover B: drove 45 km over 14 years on Meridiani Planum.', 'Squyres et al. (2004), Science 306', ['MER-B', 'Challenger Memorial Station']],
  ['mars', 'Phoenix', 68.22, 234.25, '2008-05-25', 'NASA', 62, 'Dug up and confirmed water ice in the northern arctic plains.', 'Smith et al. (2009), Science 325'],
  ['mars', 'Curiosity', -4.5895, 137.4417, '2012-08-06', 'NASA', 88, 'Mars Science Laboratory rover exploring Gale crater and Mount Sharp.', 'Vasavada et al. (2014), JGR Planets 119', ['MSL', 'Bradbury Landing']],
  ['mars', 'InSight', 4.502, 135.623, '2018-11-26', 'NASA', 64, 'Seismometer lander that measured the size of Mars\' core.', 'Golombek et al. (2020), Nat. Commun. 11'],
  ['mars', 'Perseverance', 18.4447, 77.4508, '2021-02-18', 'NASA', 90, 'Mars 2020 rover caching samples in Jezero crater; Ingenuity flew here.', 'NASA/JPL Mars 2020 (Octavia E. Butler Landing)', ['Mars 2020', 'Ingenuity', 'Octavia E. Butler Landing']],
  ['mars', 'Zhurong', 25.066, 109.925, '2021-05-14', 'CNSA', 70, 'Tianwen-1 rover, China\'s first on Mars, in southern Utopia Planitia.', 'Ding et al. (2022), Nat. Astron. 6', ['Tianwen-1']],
  // Venus (NSSDCA)
  ['venus', 'Venera 7', -5, 351, '1970-12-15', 'USSR', 66, 'First transmission from the surface of another planet (≈475 °C, 90 bar).', `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 8', -10.7, 335.25, '1972-07-22', 'USSR', 54, 'Measured sunlight reaching the surface.', `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 9', 31.01, 291.64, '1975-10-22', 'USSR', 66, 'First photograph from the surface of another planet.', `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 10', 15.42, 291.51, '1975-10-25', 'USSR', 54, null, `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 11', -14, 299, '1978-12-25', 'USSR', 48, null, `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 12', -7, 294, '1978-12-21', 'USSR', 48, null, `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 13', -7.5, 303, '1982-03-01', 'USSR', 70, 'First colour panoramas of Venus; survived 127 minutes.', `${NSSDCA} (position approximate)`],
  ['venus', 'Venera 14', -13.25, 310, '1982-03-05', 'USSR', 56, null, `${NSSDCA} (position approximate)`],
  // Titan, Eros
  ['titan', 'Huygens', -10.3, 167.7, '2005-01-14', 'ESA', 90, 'The most distant landing ever made, on the dunes of Shangri-La.', 'Karkoschka et al. (2007), Planet. Space Sci. 55; Lebreton et al. (2005), Nature 438', ['Huygens probe']],
  ['eros', 'NEAR Shoemaker', -35.9, 79.5, '2001-02-12', 'NASA', 70, 'First spacecraft to orbit and then land on an asteroid.', NSSDCA, ['NEAR']],
];

/** Informal or dynamic features absent from the Gazetteer (published coordinates; provenance noted). */
const EXTRA = [
  {
    body: 'moon', name: 'South Pole-Aitken basin', lat: -53, lon: -169, diameterKm: 2500, type: 'Impact basin (informal name)', importance: 84,
    tagline: 'The largest and oldest impact basin on the Moon, ≈2,500 km across and 8 km deep.',
    source: 'Garrick-Bethell & Zuber (2009), Icarus 204, 399-408 (elliptical fit centre 53°S, 191°E)', informal: true, aliases: ['SPA basin', 'Aitken basin'],
  },
  {
    body: 'charon', name: 'Mordor Macula', lat: 82, lon: 0, diameterKm: 475, type: 'Polar dark region (informal name)', importance: 82,
    tagline: 'Charon\'s red north-polar cap, tholins made from methane that escaped Pluto and froze out in the polar night.',
    source: 'Grundy et al. (2016), Nature 539, 65-68 (New Horizons)', informal: true, aliases: ['Mordor'],
  },
  {
    body: 'jupiter', name: 'Great Red Spot', lat: -20.5, lon: null, diameterKm: 13000, type: 'Anticyclonic storm', importance: 92,
    tagline: 'A storm wider than Earth that has raged for at least 190 years; it drifts in longitude, so its position is approximate.',
    source: 'System II longitude 91° on 2026-06-01, drifting +1.75°/month (JUPOS via Sky & Telescope GRS transit predictions); latitude ≈22°S planetographic (Simon et al. 2018, AJ 155, 151)',
    informal: false, aliases: ['GRS', 'Red Spot'], dynamic: { systemIILonDeg: 91, epoch: '2026-06-01T00:00:00Z', driftDegPerMonth: 1.75 },
  },
];

// ── assemble ───────────────────────────────────────────────────────────────────────────────
const records = [];
const seen = new Set();
const missing = [];
const add = (r) => {
  if (seen.has(r.id)) throw new Error(`duplicate id ${r.id}`);
  seen.add(r.id);
  records.push(r);
};
const descriptor = (type) => (type || '').split(',')[0].trim();

for (const [body, name, importance, tagline, aliases] of PICK) {
  const g = gaz[BODIES[body]]?.find((x) => x.name === name);
  if (!g) { missing.push(`${body}:${name}`); continue; }
  const featureId = Number((g.link.match(/Feature\/(\d+)/) || [])[1]) || null;
  add({
    id: `feat:${body}:${slug(name)}`, body, name: g.name, aliases: aliases ?? [], category: 'feature',
    type: descriptor(g.type), code: g.code, lat: Math.round(g.lat * 1e4) / 1e4, lon: wrapLon(g.lon),
    diameterKm: g.diameterKm && g.diameterKm > 0 ? Math.round(g.diameterKm * 10) / 10 : null,
    origin: g.origin || null, approval: g.approval || null, approvalDate: g.approvalDate || null,
    gazetteerId: featureId, link: featureId ? `https://planetarynames.wr.usgs.gov/Feature/${featureId}` : null,
    importance, tagline: tagline ?? null, source: 'gazetteer',
  });
}
for (const [body, name, lat, lon, date, agency, importance, note, src, aliases] of SITES) {
  add({
    id: `feat:${body}:${slug(name)}`, body, name, aliases: aliases ?? [], category: 'landing-site',
    type: 'Landing site', code: null, lat, lon: wrapLon(lon), diameterKm: null, origin: null, approval: null, approvalDate: null,
    gazetteerId: null, link: null, importance, tagline: note ?? null, source: 'mission',
    mission: { name, agency, date, coordinateSource: src },
  });
}
for (const e of EXTRA) {
  add({
    id: `feat:${e.body}:${slug(e.name)}`, body: e.body, name: e.name, aliases: e.aliases ?? [], category: e.dynamic ? 'atmospheric' : 'feature',
    type: e.type, code: null, lat: e.lat, lon: e.lon === null ? null : wrapLon(e.lon), diameterKm: e.diameterKm, origin: null,
    approval: e.informal ? 'Informal (not IAU-approved)' : null, approvalDate: null, gazetteerId: null, link: null,
    importance: e.importance, tagline: e.tagline, source: 'literature', reference: e.source, ...(e.dynamic ? { dynamic: e.dynamic } : {}),
  });
}
if (missing.length) console.warn('not in Gazetteer:', missing.join(', '));

records.sort((a, b) => a.body.localeCompare(b.body) || b.importance - a.importance || a.name.localeCompare(b.name));
const out = {
  version: 1,
  generated: new Date().toISOString(),
  retrieved: retrievedAt,
  datasets: ['iau-usgs-gazetteer', 'features-landing-sites'],
  coordinateSystem: 'planetocentric latitude, longitude east-positive in (-180, 180], degrees',
  features: records,
};

const pubDir = join(ROOT, 'public', 'data', 'features');
mkdirSync(pubDir, { recursive: true });
const pubPath = join(pubDir, 'features.json');
writeFileSync(pubPath, JSON.stringify(out));
writeFileSync(join(ROOT, 'src', 'domains', 'features', 'features.generated.json'), JSON.stringify(out));
const bytes = statSync(pubPath).size;

const byBody = {};
for (const r of records) byBody[r.body] = (byBody[r.body] ?? 0) + 1;
const nGaz = records.filter((r) => r.source === 'gazetteer').length;
const nSites = records.filter((r) => r.source === 'mission').length;

const manifest = {
  domain: 'features',
  datasets: [
    {
      id: 'iau-usgs-gazetteer',
      name: 'Gazetteer of Planetary Nomenclature (feature centre points)',
      organization: 'IAU Working Group for Planetary System Nomenclature / USGS Astrogeology Science Center',
      purpose: 'Names, types, sizes, centre coordinates and name origins of surface features labelled on planets, moons and minor planets',
      mechanism: 'GIS download (KMZ per target body) -> curated selection -> compact JSON',
      endpoint: 'https://planetarynames.wr.usgs.gov/GIS_Downloads',
      query: Object.values(BODIES).map((b) => `${b}_nomenclature_center_pts.kmz`).join(', '),
      version: 'live gazetteer state at retrieval',
      retrieved: retrievedAt,
      license: 'Public domain (U.S. Government work, USGS); IAU nomenclature is freely usable. Cite the Gazetteer.',
      licenseUrl: 'https://planetarynames.wr.usgs.gov/Page/About',
      citation: 'Gazetteer of Planetary Nomenclature, International Astronomical Union (IAU) Working Group for Planetary System Nomenclature (WGPSN), USGS Astrogeology Science Center. https://planetarynames.wr.usgs.gov',
      rateLimits: 'Static files on Amazon S3; one sequential download per body, cached in data-raw/features.',
      fieldsUsed: ['clean_name', 'type', 'code', 'center_lat', 'center_lon', 'diameter', 'origin', 'approval', 'approvaldt', 'link'],
      updateCadence: 'continuously as the IAU approves names',
      cachePolicy: 'versioned offline snapshot',
      normalization: 'Longitudes converted from 0-360 east to (-180, 180] east; planetocentric latitudes kept; zero diameters stored as null (unknown); a curated subset of notable features with importance ranks and short descriptions added by the Cosmos team.',
      fallback: 'Bundled copy in src/domains/features/features.generated.json',
      files: [{ path: 'data/features/features.json', bytes, records: records.length }],
      limitations: 'Centre points only (no outlines). Positions are placed on a sphere of the body\'s mean radius, so markers on very irregular bodies (Eros, Vesta\'s south pole) sit above or below the true surface.',
      provenanceClass: 'observed',
    },
    {
      id: 'features-landing-sites',
      name: 'Mission landing sites and informal features (literature compilation)',
      organization: 'Cosmos team compilation from LROC, NASA NSSDCA and mission papers',
      purpose: 'Landing-site markers (Apollo, Luna, Surveyor, Chang\'e, Chandrayaan-3, Viking, Mars rovers and landers, Venera, Huygens, NEAR) and informal features (South Pole-Aitken, Mordor Macula, the Great Red Spot)',
      mechanism: 'Manual compilation of published coordinates (cited per record)',
      endpoint: 'https://www.lroc.asu.edu/ ; https://nssdc.gsfc.nasa.gov/',
      query: null,
      version: '1',
      retrieved: new Date().toISOString(),
      license: 'Facts (coordinates) from cited publications; compilation released with the project.',
      licenseUrl: null,
      citation: 'Wagner, R. V. et al. (2017) Icarus 283, 92-103 (LROC coordinates of anthropogenic features); NASA NSSDCA Master Catalog; mission papers cited per record.',
      rateLimits: 'none (static)',
      fieldsUsed: ['lat', 'lon', 'date', 'agency'],
      updateCadence: 'per new landing',
      cachePolicy: 'static',
      normalization: 'Planetocentric latitude, east longitude in (-180, 180].',
      fallback: 'none',
      files: [{ path: 'data/features/features.json', bytes, records: records.length - nGaz }],
      limitations: 'Venera and Luna 9 positions are approximate (to about a degree). The Great Red Spot\'s longitude is extrapolated from a published drift rate.',
      provenanceClass: 'observed',
    },
  ],
};
writeFileSync(join(pubDir, 'manifest.part.json'), JSON.stringify(manifest, null, 1));

const docRows = Object.entries(byBody).sort((a, b) => b[1] - a[1]).map(([b, n]) => `| ${b} | ${n} |`).join('\n');
const doc = `# Surface features (features domain)

Named surface features, mission landing sites and a few informal/dynamic features, shown as surface labels and inspectable
entities (\`feat:<body>:<slug>\`) by \`src/domains/features\`.

## Sources

- **Gazetteer of Planetary Nomenclature** — IAU WGPSN / USGS Astrogeology Science Center, https://planetarynames.wr.usgs.gov
  (public domain). Feature centre-point exports (KMZ) downloaded from https://planetarynames.wr.usgs.gov/GIS_Downloads,
  retrieved ${retrievedAt}. Coordinates are planetocentric latitude and east-positive longitude (0-360 in the export,
  stored here in (-180, 180]). Each record keeps its Gazetteer feature id and URL.
- **Landing sites** — LROC coordinates of anthropogenic features (Wagner et al. 2017, Icarus 283, 92-103) and LROC news
  releases for the Moon; NASA NSSDCA and mission papers for Mars, Venus, Titan and Eros (cited per record in the fact sheet).
- **Informal / dynamic** — South Pole-Aitken basin (Garrick-Bethell & Zuber 2009), Charon's Mordor Macula (Grundy et al. 2016),
  Jupiter's Great Red Spot (System II longitude 91° on 2026-06-01 drifting +1.75°/month from JUPOS via Sky & Telescope;
  labelled "drifts; position approximate").

## Contents

${records.length} records: ${nGaz} Gazetteer features, ${nSites} landing sites, ${records.length - nGaz - nSites} informal/dynamic.

| Body | Records |
| --- | --- |
${docRows}

## Pipeline

\`\`\`
python -I scripts/data/features/fetch_gazetteer.py      # once: data-raw/features/*.kmz + retrieval.json
python -I scripts/data/features/parse_gazetteer.py      # -> data-raw/features/gazetteer_all.json
node scripts/data/features/build-features.mjs           # curated selection -> public/data/features/, src/domains/features/
\`\`\`

The curated selection (names, importance ranks 0-100, one-line descriptions) lives in \`build-features.mjs\`.

## Limitations

- Centre points only; features are placed on a sphere of the body's mean radius (irregular bodies: Eros, Vesta's south pole).
- Venera and Luna 9 positions are approximate (≈1°). The Great Red Spot longitude is extrapolated.
- Jupiter's map is an illustrative composite whose Great Red Spot is fixed in the texture; the label follows the drawn spot
  and the fact sheet gives the real System II longitude for the current date.
`;
mkdirSync(join(ROOT, 'docs', 'data'), { recursive: true });
writeFileSync(join(ROOT, 'docs', 'data', 'features.md'), doc);
console.log(`features: ${records.length} (${nGaz} gazetteer, ${nSites} sites), ${bytes} B`, byBody);
