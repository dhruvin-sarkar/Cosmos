// NASA DONKI (api.nasa.gov) + NOAA SWPC solar-cycle indices -> public/data/solar/space-weather.json
// The NASA key is read from .env.ingest.local inside this process only and is never logged or written.
import fs from 'node:fs';
import { writeJSON, fileEntry, upsertManifest, NASA_LICENSE, NASA_LICENSE_URL, USER_AGENT, OUT_DIR, RAW_DIR, log, assert, num, fetchCached } from './lib.mjs';

try { process.loadEnvFile('.env.ingest.local'); } catch { /* optional */ }
const KEY = process.env.NASA_API_KEY || 'DEMO_KEY';
const START = '2024-10-01', END = '2026-10-17';
const chunks = [['2024-10-01', '2025-03-31'], ['2025-04-01', '2025-09-30'], ['2025-10-01', '2026-03-31'], ['2026-04-01', '2026-10-17']];
fs.mkdirSync(`${RAW_DIR}/donki`, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function donki(type, a, b) {
  const cache = `${RAW_DIR}/donki/${type}-${a}_${b}.json`;
  if (fs.existsSync(cache)) return JSON.parse(fs.readFileSync(cache, 'utf8'));
  for (let attempt = 0; attempt < 4; attempt++) {
    await sleep(1500);
    const res = await fetch(`https://api.nasa.gov/DONKI/${type}?startDate=${a}&endDate=${b}&api_key=${encodeURIComponent(KEY)}`, { headers: { 'User-Agent': USER_AGENT } });
    const text = await res.text();
    if (res.ok) {
      const j = text.trim() === '' ? [] : JSON.parse(text);
      assert(Array.isArray(j), `DONKI ${type}: unexpected payload`);
      fs.writeFileSync(cache, JSON.stringify(j));
      log(`DONKI ${type} ${a}..${b}: ${j.length} records (HTTP ${res.status})`);
      return j;
    }
    log(`WARN DONKI ${type} ${a}..${b} HTTP ${res.status}; retry ${attempt + 1}`);
    await sleep(10000 * (attempt + 1));
  }
  throw new Error(`DONKI ${type} ${a}..${b} failed`);
}
const gather = async (type) => { const out = []; for (const [a, b] of chunks) out.push(...(await donki(type, a, b))); return out; };

let flrRaw = [], cmeRaw = [], gstRaw = [], donkiOk = true;
if (!process.argv.includes('--skip-donki')) {
  try { flrRaw = await gather('FLR'); cmeRaw = await gather('CME'); gstRaw = await gather('GST'); } catch (e) { donkiOk = false; log('DONKI UNAVAILABLE:', e.message, '- writing solar-cycle part only (re-run later to add events)'); flrRaw = []; cmeRaw = []; gstRaw = []; }
} else donkiOk = false;
const clsVal = (c) => { const m = /^([ABCMX])(\d+(?:\.\d+)?)/.exec(c ?? ''); if (!m) return null; return { A: 1e-8, B: 1e-7, C: 1e-6, M: 1e-5, X: 1e-4 }[m[1]] * Number(m[2]); };
// flares >= M1.0
const flares = flrRaw.filter((f) => (clsVal(f.classType) ?? 0) >= 1e-5 - 1e-12)
  .map((f) => ({ id: f.flrID, beginTimeUTC: f.beginTime, peakTimeUTC: f.peakTime, endTimeUTC: f.endTime ?? null, classType: f.classType,
    peakFluxWm2: clsVal(f.classType), activeRegion: f.activeRegionNum ?? null, sourceLocation: f.sourceLocation || null }))
  .sort((a, b) => a.peakTimeUTC.localeCompare(b.peakTimeUTC));
const cmes = cmeRaw.map((c) => {
  const an = (c.cmeAnalyses ?? []).find((x) => x.isMostAccurate) ?? (c.cmeAnalyses ?? [])[0] ?? null;
  return { id: c.activityID, startTimeUTC: c.startTime, sourceLocation: c.sourceLocation || null, activeRegion: c.activeRegionNum ?? null,
    speedKms: num(an?.speed), halfAngleDeg: num(an?.halfAngle), type: an?.type ?? null, latitudeDeg: num(an?.latitude), longitudeDeg: num(an?.longitude), note: c.note ? String(c.note).slice(0, 240) : null };
}).sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC));
const storms = gstRaw.map((g) => {
  const kp = (g.allKpIndex ?? []).map((k) => ({ t: k.observedTime, kp: num(k.kpIndex) })).filter((k) => k.kp !== null);
  const mx = kp.reduce((m, k) => (m === null || k.kp > m.kp ? k : m), null);
  return { id: g.gstID, startTimeUTC: g.startTime, maxKp: mx?.kp ?? null, maxKpTimeUTC: mx?.t ?? null, nKpSamples: kp.length };
}).sort((a, b) => a.startTimeUTC.localeCompare(b.startTimeUTC));

// NOAA SWPC observed solar cycle indices
const sw = await fetchCached('https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json', { cache: 'swpc/observed-solar-cycle-indices.json' });
const swj = JSON.parse(sw.text);
const nn = (v) => (v === null || v === undefined || v < 0 ? null : v);
const cycle = swj.filter((r) => r['time-tag'] >= '1950-01').map((r) => [r['time-tag'], nn(r.ssn), nn(r.smoothed_ssn), nn(r['f10.7']), nn(r['smoothed_f10.7'])]);
assert(cycle.length > 800, 'solar cycle series short');
const last = cycle[cycle.length - 1];
log('solar cycle last row', JSON.stringify(last), 'flares>=M1', flares.length, 'X-class', flares.filter((f) => f.classType.startsWith('X')).length, 'CMEs', cmes.length, 'GSTs', storms.length);
// sanity: the 2024-05-10 G5 storm is before our window; check X9.0 flare 2024-10-03 present
const x9 = flares.find((f) => f.classType.startsWith('X9') && f.peakTimeUTC.startsWith('2024-10-03'));
log('X9.0 flare 2024-10-03 present:', !!x9);
if (donkiOk) assert(flares.length > 50 && cmes.length > 100, 'implausibly few events');

const doc = {
  schemaVersion: 1, generated: new Date().toISOString(), retrieved: new Date().toISOString(), window: { from: START, to: END }, donkiStatus: donkiOk ? 'ok' : 'unavailable at retrieval (api.nasa.gov DONKI returned HTTP 503; keyless CCMC host unreachable): flares/cmes/geomagneticStorms are EMPTY, not zero activity',
  notes: 'Events from NASA CCMC DONKI. Times are UTC ISO strings as published (minutes precision, e.g. "2024-10-03T12:18Z"). Flares: GOES soft X-ray class >= M1.0 (peakFluxWm2 = 1e-5 for M1.0, 1e-4 for X1.0). CMEs: all DONKI CMEs; speed/halfAngle/type/lat/lon from the most accurate analysis (null if no analysis). Storms: geomagnetic storm events with the maximum 3-hourly Kp from DONKI allKpIndex. solarCycle.rows = [month "YYYY-MM", monthlyMeanSunspotNumber, smoothed13MonthSSN, F10.7 monthly (sfu), smoothed F10.7 (sfu)] from NOAA SWPC; null = missing (-1 in source); smoothed values are null for the most recent ~6 months.',
  flares, cmes, geomagneticStorms: storms,
  solarCycle: { source: 'NOAA SWPC observed-solar-cycle-indices', fields: ['month', 'ssn', 'smoothedSsn', 'f107Sfu', 'smoothedF107Sfu'], rows: cycle },
};
const p = `${OUT_DIR}/space-weather.json`;
await writeJSON(p, doc);
await upsertManifest([
  ...(!donkiOk ? [] : [{
    id: 'nasa-donki-space-weather', name: 'NASA DONKI solar flares, CMEs and geomagnetic storms (2024-10 to 2026-10)', organization: 'NASA CCMC (Space Weather Database Of Notifications, Knowledge, Information)',
    purpose: 'Link solar activity to thermospheric heating and orbital-debris decay; Sun inspector', mechanism: 'api.nasa.gov DONKI REST API (FLR, CME, GST) -> JSON',
    endpoint: 'https://api.nasa.gov/DONKI/{FLR|CME|GST}', query: 'startDate=<a>&endDate=<b>&api_key=<redacted> (4 half-year chunks, 2024-10-01..2026-10-17)',
    version: 'live archive state at retrieval', retrieved: doc.retrieved, license: NASA_LICENSE, licenseUrl: NASA_LICENSE_URL,
    citation: 'NASA Community Coordinated Modeling Center (CCMC), DONKI database (https://kauai.ccmc.gsfc.nasa.gov/DONKI/).',
    rateLimits: 'api.nasa.gov: 1,000 requests/hour per key (DEMO_KEY far lower: 30/hour, 50/day). Scripts make 12 requests, 1.5 s apart.',
    fieldsUsed: ['flrID', 'beginTime', 'peakTime', 'endTime', 'classType', 'activeRegionNum', 'sourceLocation', 'activityID', 'startTime', 'cmeAnalyses.*', 'gstID', 'allKpIndex'],
    updateCadence: 'continuous', cachePolicy: 'versioned offline snapshot; optional online refresh', normalization: 'scripts/data/solar/fetch-space-weather.mjs',
    fallback: 'Hide the space-weather timeline.', files: [await fileEntry(p, flares.length + cmes.length + storms.length)],
    limitations: 'DONKI is a notification database curated by human forecasters: CME speed/type depend on the chosen analysis and some CMEs have none; flare class is the GOES-reported peak. Key-less CCMC host kauai.ccmc.gsfc.nasa.gov was unreachable at retrieval so api.nasa.gov was used.',
    provenanceClass: 'observed',
  }]),
  {
    id: 'noaa-swpc-solar-cycle-indices', name: 'NOAA SWPC observed solar cycle indices (sunspot number, F10.7)', organization: 'NOAA Space Weather Prediction Center',
    purpose: 'Solar-cycle context (cycle 25) for thermospheric drag and debris decay', mechanism: 'JSON file', endpoint: 'https://services.swpc.noaa.gov/json/solar-cycle/observed-solar-cycle-indices.json', query: null,
    version: 'live archive state at retrieval', retrieved: sw.retrieved,
    license: 'U.S. Government work (NOAA/NWS); public domain, no restrictions stated; SWPC data usage guidance requests attribution.', licenseUrl: 'https://www.swpc.noaa.gov/content/data-access',
    citation: 'NOAA Space Weather Prediction Center; sunspot numbers originate from SILSO/Royal Observatory of Belgium.', rateLimits: 'not documented (single static file)',
    fieldsUsed: ['time-tag', 'ssn', 'smoothed_ssn', 'f10.7', 'smoothed_f10.7'], updateCadence: 'monthly', cachePolicy: 'versioned offline snapshot; optional online refresh',
    normalization: 'scripts/data/solar/fetch-space-weather.mjs', fallback: 'Hide the cycle chart.', files: [{ path: 'data/solar/space-weather.json', bytes: (await fileEntry(p, 1)).bytes, records: cycle.length }],
    limitations: 'Monthly means from 1950 only (source starts 1749). F10.7 pre-1947 not available. Last months provisional.', provenanceClass: 'observed',
  },
]);
