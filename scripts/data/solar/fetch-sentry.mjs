// CNEOS Sentry API -> public/data/solar/sentry.json
import { fetchJSON, writeJSON, fileEntry, upsertManifest, JPL_SSD_LICENSE, JPL_SSD_LICENSE_URL, JPL_RATE, OUT_DIR, log, assert, num } from './lib.mjs';
const URL_ = 'https://ssd-api.jpl.nasa.gov/sentry.api';
const r = await fetchJSON(URL_, { cache: 'sentry/list.json' });
const d = r.json.data;
assert(Array.isArray(d) && d.length > 100, 'Sentry list too short');
log('sentry keys', Object.keys(d[0]).join(','), 'signature', JSON.stringify(r.json.signature ?? null), 'count', r.json.count);
const fields = ['des', 'fullname', 'ipCumulative', 'psCum', 'psMax', 'tsMax', 'nImp', 'yearMin', 'yearMax', 'hMag', 'diameterKm', 'massKg', 'vInfKms', 'lastObs', 'lastObsJD', 'sigmaMass'];
const rows = d.map((o) => {
  const yr = String(o.range ?? '').split('-');
  return [o.des, String(o.fullname).trim(), num(o.ip), num(o.ps_cum), num(o.ps_max), num(o.ts_max), num(o.n_imp), num(yr[0]), num(yr[1] ?? yr[0]), num(o.h), num(o.diameter), num(o.mass), num(o.v_inf), o.last_obs ?? null, num(o.last_obs_jd), null];
});
rows.forEach((x) => x.pop()); fields.pop();
rows.sort((a, b) => b[2] - a[2]);
const out = { schemaVersion: 1, generated: new Date().toISOString(), source: 'JPL CNEOS Sentry', retrieved: r.retrieved,
  notes: 'ipCumulative = cumulative impact probability (0-1); psCum/psMax = cumulative/maximum Palermo Scale; tsMax = maximum Torino Scale (0-10); nImp = number of potential impacts; yearMin/yearMax = range of years of possible impacts; diameterKm in km (null if unknown); massKg estimated; vInfKms = hyperbolic excess speed. Sorted by ipCumulative descending.',
  fields, rows };
const p = `${OUT_DIR}/sentry.json`;
await writeJSON(p, out);
const ap = rows.find((x) => x[0] === '99942');
log(`sentry: ${rows.length} objects; top`, rows[0].slice(0, 4).join(' | '), '; Apophis on list:', !!ap);
await upsertManifest([{
  id: 'cneos-sentry', name: 'CNEOS Sentry Impact Risk Table', organization: 'NASA JPL CNEOS',
  purpose: 'Planetary-defense lab: objects with non-zero computed Earth-impact probability over the next 100 years',
  mechanism: 'REST API (JSON) summary list', endpoint: URL_, query: null, version: 'live archive state at retrieval', retrieved: r.retrieved,
  license: JPL_SSD_LICENSE, licenseUrl: JPL_SSD_LICENSE_URL,
  citation: 'NASA/JPL-Caltech Center for Near Earth Object Studies (CNEOS), Sentry Impact Risk Table.',
  rateLimits: JPL_RATE, fieldsUsed: ['des', 'fullname', 'ip', 'ps_cum', 'ps_max', 'ts_max', 'n_imp', 'range', 'h', 'diameter', 'mass', 'v_inf', 'last_obs', 'last_obs_jd'],
  updateCadence: 'updated as new observations arrive (objects are added and removed)', cachePolicy: 'versioned offline snapshot; optional online refresh',
  normalization: 'scripts/data/solar/fetch-sentry.mjs', fallback: 'Hide the risk table.',
  files: [await fileEntry(p, rows.length)],
  limitations: 'Impact probabilities are computed from current orbit fits and routinely drop to zero as data improve; a non-zero entry is not a prediction of impact. The Sentry list is a snapshot.',
  provenanceClass: 'derived',
}]);
