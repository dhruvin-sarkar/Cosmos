// DSCOVR EPIC natural-colour full-disc Earth images (NASA/NOAA, public domain) -> public/textures/earth/epic/{*.jpg, epic.json}
//   node scripts/data/textures/build-epic.mjs   (FORCE=1 to refetch the latest day)
import fs from 'node:fs';
import { TEX_DIR, RAW_DIR, getBuffer, download, log, mkdirp, relPublic, sharp } from './lib.mjs';
import { saveRecords } from './records.mjs';

const API = 'https://epic.gsfc.nasa.gov/api/natural';
const OUT = `${TEX_DIR}/earth/epic`;
mkdirp(OUT);
if (fs.existsSync(`${OUT}/epic.json`) && !process.env.FORCE) { log('skip epic (exists)'); process.exit(0); }
const { buf } = await getBuffer(API, { label: 'EPIC natural list', expectType: /json/ });
const list = JSON.parse(buf.toString('utf8'));
if (!Array.isArray(list) || !list.length) throw new Error('EPIC API returned no images');
const day = list[0].date.slice(0, 10);
const sameDay = list.filter((e) => e.date.slice(0, 10) === day);
const lonDist = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
const picks = [];
for (const target of [-75, 10, 105]) { // Americas, Europe/Africa, Asia-Pacific
  const best = sameDay.filter((e) => !picks.includes(e)).sort((a, b) => lonDist(a.centroid_coordinates.lon, target) - lonDist(b.centroid_coordinates.lon, target))[0];
  if (best) picks.push(best);
}
const [Y, M, D] = day.split('-');
const images = [];
for (const e of picks) {
  const url = `https://epic.gsfc.nasa.gov/archive/natural/${Y}/${M}/${D}/jpg/${e.image}.jpg`;
  const raw = `${RAW_DIR}/epic/${e.image}.jpg`;
  await download(url, raw, { expectType: /image\/jpeg/, minBytes: 50000, label: e.image });
  const file = `${OUT}/${e.image}_2048.jpg`;
  await sharp(raw).resize(2048, 2048, { fit: 'inside' }).jpeg({ quality: 88, mozjpeg: true }).toFile(file);
  const m = await sharp(file).metadata();
  images.push({
    id: e.identifier, file: relPublic(file), widthPx: m.width, heightPx: m.height, bytes: fs.statSync(file).size,
    dateUtc: `${e.date.replace(' ', 'T')}Z`, centroidLatDeg: e.centroid_coordinates.lat, centroidLonDeg: e.centroid_coordinates.lon,
    dscovrJ2000Km: [e.dscovr_j2000_position.x, e.dscovr_j2000_position.y, e.dscovr_j2000_position.z],
    sunJ2000Km: [e.sun_j2000_position.x, e.sun_j2000_position.y, e.sun_j2000_position.z],
    moonJ2000Km: [e.lunar_j2000_position.x, e.lunar_j2000_position.y, e.lunar_j2000_position.z],
    attitudeQuaternion: [e.attitude_quaternions.q0, e.attitude_quaternions.q1, e.attitude_quaternions.q2, e.attitude_quaternions.q3],
    version: e.version, caption: e.caption, sourceUrl: url,
  });
}
const retrieved = new Date().toISOString();
fs.writeFileSync(`${OUT}/epic.json`, JSON.stringify({
  schemaVersion: 1, retrieved, source: API, imageArchive: 'https://epic.gsfc.nasa.gov/archive/natural/',
  credit: 'NASA/NOAA DSCOVR EPIC team (Earth Polychromatic Imaging Camera, Sun-Earth L1)', license: 'Public domain (NASA); credit "DSCOVR EPIC / NASA"',
  units: { positions: 'km, J2000 geocentric equatorial (as published by the EPIC API; dscovrJ2000Km = DSCOVR relative to Earth, sunJ2000Km = Sun relative to Earth, moonJ2000Km = Moon relative to Earth)', centroid: 'deg: sub-camera geodetic point latitude / east longitude of the image centre', dateUtc: 'ISO-8601 UTC image time' },
  images,
}));
saveRecords('epic', [{ key: 'earth/epic', body: 'earth', map: 'epic', files: Object.fromEntries(images.map((i, k) => [`image${k}`, i.file])), credit: 'NASA/NOAA DSCOVR EPIC team', license: 'Public domain (NASA)', source: API, endpoint: API, provenanceClass: 'observed', retrieved, notes: `EPIC L1B natural-colour full-disc images of ${day} (3 of ${sameDay.length}), resized to 2048 px JPEG; metadata in earth/epic/epic.json`, bytes: images.map((i) => i.bytes) }]);
log(`epic done: ${images.length} images of ${day}`);
