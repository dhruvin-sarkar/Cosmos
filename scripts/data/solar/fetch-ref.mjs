// Downloads (or reuses cached) reference pages/kernels used by build-bodies.mjs into data-raw/solar/ref/
import { fetchCached, log } from './lib.mjs';
const J = 'https://ssd.jpl.nasa.gov', N = 'https://naif.jpl.nasa.gov/pub/naif/generic_kernels/pck', S = 'https://nssdc.gsfc.nasa.gov/planetary/factsheet';
const files = [
  ['jpl-approx_pos.html', `${J}/planets/approx_pos.html`], ['jpl-planets-phys_par.html', `${J}/planets/phys_par.html`], ['jpl-sats-discovery.html', `${J}/sats/discovery.html`],
  ['jpl-sats-elem.html', `${J}/sats/elem/`], ['jpl-sats-phys_par.html', `${J}/sats/phys_par/`], ['naif-gm_de440.tpc', `${N}/gm_de440.tpc`], ['naif-pck00011.tpc', `${N}/pck00011.tpc`],
  ...['earth', 'jupiter', 'mars', 'mercury', 'moon', 'neptune', 'pluto', 'saturn', 'sun', 'uranus', 'venus'].map((p) => [`nssdca-${p}fact.html`, `${S}/${p}fact.html`]),
  ['nssdca-galileanfact_table.html', `${S}/galileanfact_table.html`],
  ...['jovian', 'neptunian', 'saturnian', 'uranian'].map((p) => [`nssdca-${p}satfact.html`, `${S}/${p}satfact.html`]),
];
for (const [name, url] of files) { const r = await fetchCached(url, { cache: `ref/${name}` }); log(name, r.fromCache ? '(cached)' : 'downloaded', r.text.length); }
