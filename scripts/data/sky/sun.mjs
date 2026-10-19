// Fetch latest SDO images (public domain, NASA/SDO) -> public/data/sky/sun/
import fs from 'node:fs'
const UA = 'Cosmos-AstroNexus/0.1 (educational SCI-FORGE 2026 project)'
const OUT = 'public/data/sky/sun'
fs.mkdirSync(OUT, { recursive: true })
const BANDS = [
  ['aia171', '0171', 'AIA 171 Å', '171 Å (Fe IX), ~0.6 MK', 'Quiet corona and coronal loops tracing magnetic field lines.'],
  ['aia193', '0193', 'AIA 193 Å', '193 Å (Fe XII), ~1.2 MK / flares 20 MK', 'Hot corona and coronal holes (dark open-field regions); flare plasma.'],
  ['aia304', '0304', 'AIA 304 Å', '304 Å (He II), ~50,000 K', 'Chromosphere/transition region: prominences and spicules.'],
  ['aia1600', '1600', 'AIA 1600 Å', '1600 Å (C IV + continuum), ~10,000 K', 'Upper photosphere and transition region; flare ribbons.'],
  ['hmi-continuum', 'HMIIC', 'HMI Continuum', '6173 Å visible continuum', 'The visible photosphere with sunspots.'],
]
const items = []
let last = 0
for (const [id, code, label, wl, shows] of BANDS) {
  const url = `https://sdo.gsfc.nasa.gov/assets/img/latest/latest_1024_${code}.jpg`
  const wait = 1100 - (Date.now() - last); if (wait > 0) await new Promise(r => setTimeout(r, wait))
  last = Date.now()
  const r = await fetch(url, { headers: { 'User-Agent': UA } })
  if (!r.ok) throw new Error(`${url} -> ${r.status}`)
  const buf = Buffer.from(await r.arrayBuffer())
  const file = `${id}_1024.jpg`
  fs.writeFileSync(`${OUT}/${file}`, buf)
  const lm = r.headers.get('last-modified')
  items.push({ id, label, wavelength: wl, shows, file: `data/sky/sun/${file}`, bytes: buf.length, width: 1024, height: 1024,
    imageTimeUtc: lm ? new Date(lm).toISOString() : null, retrieved: new Date().toISOString(), source: url })
}
fs.writeFileSync(`${OUT}/sun.json`, JSON.stringify({ schemaVersion: 1, generated: new Date().toISOString(),
  note: 'Snapshot of "latest" SDO images; imageTimeUtc is the HTTP Last-Modified of the file (approximate image time). Sun disc centred, north up.',
  credit: 'NASA/SDO and the AIA, EVE, and HMI science teams', license: 'Public domain (NASA); credit requested', items }))
console.log(items.map(i => `${i.id} ${i.bytes} ${i.imageTimeUtc}`).join('\n'))
