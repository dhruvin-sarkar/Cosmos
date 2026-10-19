// Validation of public/data/galactic/*.json: NaN/Inf, counts, spot checks vs published values.
import fs from 'node:fs'
const rd = (f) => JSON.parse(fs.readFileSync(`public/data/galactic/${f}.json`, 'utf8'))
let fail = 0
const ok = (c, m) => { if (!c) { fail++; console.error('FAIL', m) } else console.log('ok  ', m) }
const walk = (o, p, cb) => { if (o && typeof o === 'object') for (const k in o) walk(o[k], p + '/' + k, cb); else cb(o, p) }
const near = (a, b, tol) => typeof a === 'number' && Math.abs(a - b) <= tol

for (const f of ['sgra', 'milkyway', 'landmarks', 'messier', 'cosmology']) {
  const j = rd(f); let bad = 0
  walk(j, f, (v, p) => { if (typeof v === 'number' && !Number.isFinite(v)) { bad++; console.error('nonfinite', p) } })
  ok(bad === 0, `${f}: all numbers finite`)
}
const lm = rd('landmarks'), ms = rd('messier')
ok(ms.objects.length === 110, 'messier: 110 objects')
ok(lm.objects.filter((o) => o.type && /globular/i.test(o.type)).length >= 150, 'landmarks: >=150 globular clusters')
const find = (a, f) => a.find(f)
const m31 = find(ms.objects, (o) => o.messier === 31)
if (m31) { ok(near(m31.raDeg, 10.685, 0.05) && near(m31.decDeg, 41.269, 0.05), 'M31 position ~ (10.685, +41.269)') } else { fail++; console.error('FAIL no M31') }
for (const o of [...lm.objects, ...ms.objects]) {
  if (!(o.raDeg >= 0 && o.raDeg < 360 && o.decDeg >= -90 && o.decDeg <= 90)) { fail++; console.error('bad coords', o.id) }
}
const cos = rd('cosmology'); const s = JSON.stringify(cos)
ok(near(cos.parameters.H0.value, 67.66, 0.01) && near(cos.parameters.TcmbK.value, 2.7255, 1e-4), 'cosmology: H0 67.66 (TT,TE,EE+lowE+lensing+BAO), T_CMB 2.7255')
ok(near(cos.derived.particleHorizonComovingGly.value, 46.2, 0.3), 'particle horizon ~46 Gly')
ok(near(cos.derived.comovingDistanceToLastScatteringMpc.value, 13880, 100), 'D_M(z*) ~ 13.9 Gpc')
const sgb = rd('sgra').blackHole
ok(near(sgb.mass.adopted.value, 4.30e6, 0.05e6), 'Sgr A* mass ~4.30e6 Msun (GRAVITY 2024)')
ok(near(sgb.ehtRing.diameterMicroArcsec.value ?? sgb.ehtRing.diameterMicroArcsec, 51.8, 0.01), 'EHT ring 51.8 uas')
const mw = rd('milkyway')
ok(near(mw.sun.galactocentricDistancePc.value, 8277, 40), 'R0 ~ 8.27 kpc (Bennett&Bovy/GRAVITY)')
ok(mw.spiralArms.rows.length >= 5, 'spiral arms >= 5')
const sg = rd('sgra'); const s2 = JSON.stringify(sg)
ok(sg.sStars.gillessen2017.rows.length >= 20, 'sgra: Gillessen stars >= 20')
ok(/S2/.test(s2) && /51\.8/.test(s2), 'sgra: S2 and EHT 51.8 uas present')
console.log(fail ? `${fail} FAILURES` : 'ALL OK')
process.exit(fail ? 1 : 0)
