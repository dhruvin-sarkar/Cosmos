"""
Galaxy impostor textures for the galaxies domain (src/domains/galaxies).

For every hero galaxy (M31, M33, LMC, SMC) and up to 63 further large/famous galaxies we request a
north-up / east-left gnomonic (TAN) cutout of the DSS2 colour HiPS from the CDS hips2fits service, centred on the
catalogue position with a known field of view, so the renderer can map every disc point back to the exact image
pixel it projects onto as seen from Earth (deprojection happens in the shader, see impostorMaterial.ts).

Processing (linear light): sky background subtraction, foreground-star removal (median-residual mask, two scales),
an elliptical window at ~1.15 x the Holmberg/D25 isophote, normalisation, sRGB JPEG. Missing position angles and
inclinations are measured from second moments of the cleaned image (recorded as 'image-moments').

Companions/foreground clusters on hero images (M32 on M31; 47 Tuc and NGC 362 on the SMC) are replaced by the
point-mirrored disc (they are rendered at their own positions). M31 and M33 heroes are 4096 px (+ a 2048 px tier).

Run:  python -I scripts/data/galaxies/build-impostors.py   (raw cutouts cached in data-raw/big/galaxies/img/)
Credit: DSS2 colour HiPS (CDS/P/DSS2/color) - The Digitized Sky Surveys were produced at the Space Telescope
Science Institute under U.S. Government grant NAG W-2166, based on photographic data of the Palomar (POSS-II) and
UK Schmidt telescopes; HiPS and hips2fits by CDS, Strasbourg.
"""
import io, json, math, os, sys, time, urllib.parse, urllib.request
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
RAW = os.path.join(ROOT, 'data-raw', 'big', 'galaxies', 'img')
OUT = os.path.join(ROOT, 'public', 'textures', 'galaxies')
os.makedirs(RAW, exist_ok=True)
os.makedirs(OUT, exist_ok=True)

HIPS = 'CDS/P/DSS2/color'
SLOT = 512
ATLAS_GRID = 8  # 8 x 8 slots of 512 px = 4096 px atlas
HERO_SIZE = 2048
HERO_SIZE_BIG = 4096  # M31 and M33: 4.3"/px and 1.6"/px, close to the DSS2 plate resolution
BIG_HEROES = ('m31', 'm33')
# Objects that are not part of the hero galaxy but sit on its image: (ra, dec, radius arcmin). Each is replaced by the
# point-mirrored pixel about the galaxy centre (discs are roughly point-symmetric), so the deprojected disc does not
# carry a smeared copy of the companion (which is rendered separately at its own 3-D position).
COMPANIONS = {
    'm31': [(10.67417, 40.86528, 4.5)],                                # M32 (NGC 221), in front of M31's disc
    'smc': [(6.02375, -72.08128, 16.0), (15.80942, -70.84878, 6.0)],  # 47 Tuc, NGC 362 (Milky Way globulars)
}


def table(name):
    with open(os.path.join(ROOT, 'public', 'data', 'galaxies', name), encoding='utf-8') as f:
        j = json.load(f)
    return [dict(zip(j['fields'], r)) for r in j['rows']]


def fetch(key, ra, dec, fov, size):
    path = os.path.join(RAW, f'{key}_{size}.png')
    if os.path.exists(path) and os.path.getsize(path) > 1000:
        return Image.open(path).convert('RGB')
    q = urllib.parse.urlencode({
        'hips': HIPS, 'width': size, 'height': size, 'fov': f'{fov:.5f}', 'projection': 'TAN',
        'coordsys': 'icrs', 'ra': f'{ra:.6f}', 'dec': f'{dec:.6f}', 'format': 'png',
    })
    url = 'https://alasky.cds.unistra.fr/hips-image-services/hips2fits?' + q
    for attempt in range(4):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                data = r.read()
            img = Image.open(io.BytesIO(data)).convert('RGB')
            img.save(path)
            return img
        except Exception as e:  # noqa: BLE001
            print('  retry', key, e, file=sys.stderr)
            time.sleep(3 + attempt * 5)
    raise RuntimeError('fetch failed ' + key)


def to_linear(img):
    a = np.asarray(img, dtype=np.float32) / 255.0
    return np.where(a <= 0.04045, a / 12.92, ((a + 0.055) / 1.055) ** 2.4)


def to_srgb8(a):
    a = np.clip(a, 0, 1)
    s = np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)
    return Image.fromarray((s * 255 + 0.5).astype(np.uint8), 'RGB')


def ellipse_rho(n, a_px, pa_deg, q):
    """Elliptical radius (1 at the ellipse) for a north-up east-left image; PA measured N through E."""
    c = (n - 1) / 2
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    east = -(x - c)  # east is to the left
    north = -(y - c)  # north is up (row 0 at the top)
    p = math.radians(pa_deg)
    maj = east * math.sin(p) + north * math.cos(p)
    mnr = east * math.cos(p) - north * math.sin(p)
    return np.sqrt((maj / a_px) ** 2 + (mnr / (a_px * q)) ** 2)


def mask_companions(lin, ra0, dec0, fov, comps):
    n = lin.shape[0]
    c = (n - 1) / 2
    scale = fov / n  # deg per pixel
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    out = lin.copy()
    mirror = lin[::-1, ::-1]  # pixel p -> 2c - p
    for ra, dec, r_arcmin in comps:
        a0, d0, a1, d1 = map(math.radians, (ra0, dec0, ra, dec))
        cosc = math.sin(d0) * math.sin(d1) + math.cos(d0) * math.cos(d1) * math.cos(a1 - a0)
        xi = math.degrees(math.cos(d1) * math.sin(a1 - a0) / cosc)
        eta = math.degrees((math.cos(d0) * math.sin(d1) - math.sin(d0) * math.cos(d1) * math.cos(a1 - a0)) / cosc)
        px, py = c - xi / scale, c - eta / scale  # east left, north up
        r = r_arcmin / 60 / scale
        d = np.sqrt((x - px) ** 2 + (y - py) ** 2)
        w = np.clip((1.5 * r - d) / (0.5 * r), 0, 1)
        w = w * w * (3 - 2 * w)
        ring = (d > 1.5 * r) & (d < 2.2 * r)
        gain = np.array([out[..., k][ring].mean() / max(mirror[..., k][ring].mean(), 1e-6) for k in range(3)], dtype=np.float32)
        out = out * (1 - w[..., None]) + mirror * gain * w[..., None]
    return out


def clean(lin, a_px):
    n = lin.shape[0]
    L = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    rr = ellipse_rho(n, a_px * 1.35, 0, 1)
    sky = rr > 1
    if sky.sum() < 1000:
        sky = np.ones_like(L, dtype=bool)
        sky[n // 6: -n // 6, n // 6: -n // 6] = False
    bg = np.array([np.median(lin[..., k][sky]) for k in range(3)], dtype=np.float32)
    lin = np.clip(lin - bg, 0, None)
    L = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    noise = 1.4826 * np.median(np.abs(L[sky] - np.median(L[sky]))) + 1e-5
    out = lin.copy()
    for size, k, grow in ((max(5, int(n * 0.0025) | 1), 8.0, 1), (max(9, int(n * 0.006) | 1), 30.0, 2)):
        Lc = out @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        # Morphological opening (separable min/max filters, fast) removes features smaller than `size`.
        # The square opening leaves blocky plateaus: smooth it (Gaussian ~ size/2) and feather the mask edge.
        M = ndimage.gaussian_filter(ndimage.grey_opening(Lc, size=(size, size)), size * 0.35)
        mask = (Lc - M) > (k * noise + 0.8 * M)
        mask = ndimage.binary_dilation(mask, iterations=grow)
        m = np.clip(ndimage.gaussian_filter(mask.astype(np.float32), 1.2) * 1.6, 0, 1)[..., None]
        med = np.stack([ndimage.gaussian_filter(ndimage.grey_opening(out[..., c], size=(size, size)), size * 0.35) for c in range(3)], -1)
        out = out * (1 - m) + np.minimum(med, out) * m
    return out, noise


def moments(lin, a_px):
    n = lin.shape[0]
    L = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    rr = ellipse_rho(n, a_px, 0, 1)
    w = np.where(rr < 1, L, 0)
    w = np.clip(w - np.percentile(w[rr < 1], 30), 0, None)
    c = (n - 1) / 2
    y, x = np.mgrid[0:n, 0:n].astype(np.float64)
    east, north = -(x - c), -(y - c)
    s = w.sum() + 1e-9
    me, mn = (w * east).sum() / s, (w * north).sum() / s
    e, nn = east - me, north - mn
    cee, cnn, cen = (w * e * e).sum() / s, (w * nn * nn).sum() / s, (w * e * nn).sum() / s
    vals, vecs = np.linalg.eigh(np.array([[cee, cen], [cen, cnn]]))
    v = vecs[:, 1]  # major axis (east, north)
    pa = math.degrees(math.atan2(v[0], v[1])) % 180
    q = math.sqrt(max(vals[0], 1e-9) / max(vals[1], 1e-9))
    return pa, q


def process(key, ra, dec, a_arcmin, pa, inc, size, fov_scale=1.55, comps=()):
    fov = max(2 * a_arcmin * fov_scale / 60.0, 0.05)
    img = fetch(key, ra, dec, fov, size)
    lin = to_linear(img)
    a_px = (a_arcmin / 60.0) / fov * size
    lin, _noise = clean(lin, a_px)
    if comps:
        lin = mask_companions(lin, ra, dec, fov, comps)
    pa_src, inc_src = 'catalogue', 'catalogue'
    mpa, mq = moments(lin, a_px)
    if pa is None:
        pa, pa_src = mpa, 'image-moments'
    if inc is None:
        inc, inc_src = math.degrees(math.acos(min(max(mq, 0.05), 1.0))), 'image-moments'
    q = max(math.cos(math.radians(inc)), 0.22)
    rho = ellipse_rho(size, a_px * 1.12, pa, q)
    win = 1 - np.clip((rho - 0.8) / 0.5, 0, 1) ** 2 * (3 - 2 * np.clip((rho - 0.8) / 0.5, 0, 1))
    lin *= win[..., None]
    L = lin @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    inside = rho < 1
    peak = float(np.percentile(L[inside], 99.8)) if inside.any() else 1.0
    lin /= max(peak, 1e-6) / 0.92
    total = lin.reshape(-1, 3).sum(0)
    mean_col = (total / max(total.max(), 1e-9)).tolist()
    meta = {
        'raDeg': ra, 'decDeg': dec, 'fovDeg': round(fov, 6), 'semiMajorArcmin': a_arcmin,
        'positionAngleDeg': round(pa, 2), 'inclinationDeg': round(inc, 2),
        'positionAngleSource': pa_src, 'inclinationSource': inc_src,
        'meanColorLinear': [round(c, 4) for c in mean_col],
        'fillFraction': round(float(L.sum() / (L.max() * size * size + 1e-9)), 5),
    }
    return lin, meta


def main():
    famous = table('famous.json')
    local = table('local.json')
    by_ungc = {r['name']: r for r in local}
    heroes = {
        # id: (ra, dec, semi-major arcmin, PA, inclination) - LMC/SMC sizes from UNGC (Holmberg diameters).
        'm31': None, 'm33': None,
        'lmc': (80.89417, -69.75611, 645.65 / 2 * 0.75, 170.0, 34.7),
        'smc': (13.15833, -72.80028, 380.19 / 2 * 0.75, 45.0, 58.0),
    }
    entries = []
    for gid in heroes:
        f = next(r for r in famous if r['id'] == gid)
        if heroes[gid] is None:
            ra, dec, a, pa, inc = f['raDeg'], f['decDeg'], f['majorAxisArcmin'] / 2, f['positionAngleDeg'], f['inclinationDeg']
        else:
            ra, dec, a, pa, inc = heroes[gid]
        if gid == 'lmc':
            pa_note = 'line of nodes PA 129.9 deg (famous.json); bar/disc image major axis ~170 deg used for the window'
        else:
            pa_note = None
        size = HERO_SIZE_BIG if gid in BIG_HEROES else HERO_SIZE
        lin, meta = process('hero_' + gid, ra, dec, a, pa, inc, size, 1.45 if gid in ('lmc', 'smc') else 1.55, COMPANIONS.get(gid, ()))
        fn = f'hero_{gid}.jpg'
        full = to_srgb8(lin)
        full.save(os.path.join(OUT, fn), quality=93, optimize=True, progressive=True)
        full.resize((512, 512), Image.LANCZOS).save(os.path.join(OUT, f'hero_{gid}_512.jpg'), quality=90, optimize=True)
        meta.update({'id': 'gal:' + gid, 'file': 'textures/galaxies/' + fn, 'fileLow': f'textures/galaxies/hero_{gid}_512.jpg'})
        if size > HERO_SIZE:
            full.resize((HERO_SIZE, HERO_SIZE), Image.LANCZOS).save(os.path.join(OUT, f'hero_{gid}_2k.jpg'), quality=92, optimize=True, progressive=True)
            meta['fileMid'] = f'textures/galaxies/hero_{gid}_2k.jpg'
        if gid in COMPANIONS:
            meta['masked'] = 'foreground/companion objects replaced by the point-mirrored disc: ' + ', '.join(f'(RA {c[0]:.3f}, Dec {c[1]:.3f}, r {c[2]} arcmin)' for c in COMPANIONS[gid])
        if pa_note:
            meta['note'] = pa_note
        if gid == 'lmc':
            meta['positionAngleDeg'] = 129.9
            meta['positionAngleSource'] = 'catalogue (line of nodes)'
        entries.append(meta)
        print('hero', gid, meta['positionAngleDeg'], meta['inclinationDeg'])

    # Atlas: famous (skip heroes and dwarf spheroidals, which are invisible in DSS) + the largest UNGC galaxies.
    picks = []
    for f in famous:
        if f['id'] in heroes or 'dSph' in (f['morphology'] or '') or f['id'] in ('sculptor', 'draco', 'umi', 'carina', 'leo1', 'fornax-dsph', 'sagdsph'):
            continue
        a = f['majorAxisArcmin']
        if a is None and f['ungcName'] in by_ungc:
            a = by_ungc[f['ungcName']]['majorAxisArcmin']
        if a is None:
            a = {'m87': 8.3, 'ngc1300': 6.2, 'm100': 7.4, 'antennae': 5.2}.get(f['id'], 5.0)
        inc = f['inclinationDeg']
        if inc is None and f['ungcName'] in by_ungc:
            inc = by_ungc[f['ungcName']]['inclinationDeg']
        picks.append(('gal:' + f['id'], f['raDeg'], f['decDeg'], a / 2, f['positionAngleDeg'], inc))
    fam_ungc = {f['ungcName'] for f in famous if f['ungcName']}
    cands = [r for r in local if r['name'] not in fam_ungc and r['majorAxisArcmin'] and r['majorAxisArcmin'] >= 7
             and r['morphology'] not in ('Sph', 'dSph') and (r['absMagB'] or 0) < -14.5 and r['name'] not in ('LMC', 'SMC')]
    cands.sort(key=lambda r: -r['majorAxisArcmin'])
    for r in cands:
        if len(picks) >= ATLAS_GRID * ATLAS_GRID:
            break
        picks.append(('gal:ungc:' + slug(r['name']), r['raDeg'], r['decDeg'], r['majorAxisArcmin'] / 2, None, r['inclinationDeg']))
    atlas = np.zeros((SLOT * ATLAS_GRID, SLOT * ATLAS_GRID, 3), dtype=np.float32)
    for slot, (eid, ra, dec, a, pa, inc) in enumerate(picks):
        key = 'atlas_' + eid.replace(':', '_')
        lin, meta = process(key, ra, dec, a, pa, inc, SLOT)
        gy, gx = divmod(slot, ATLAS_GRID)
        atlas[gy * SLOT:(gy + 1) * SLOT, gx * SLOT:(gx + 1) * SLOT] = lin
        meta.update({'id': eid, 'atlasSlot': slot})
        entries.append(meta)
        print('atlas', slot, eid, meta['positionAngleDeg'], meta['positionAngleSource'], meta['inclinationDeg'])
    to_srgb8(atlas).save(os.path.join(OUT, 'atlas_4k.jpg'), quality=92, optimize=True, progressive=True)
    to_srgb8(atlas).resize((2048, 2048), Image.LANCZOS).save(os.path.join(OUT, 'atlas_2k.jpg'), quality=90, optimize=True)
    doc = {
        'schemaVersion': 1,
        'generated': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
        'script': 'scripts/data/galaxies/build-impostors.py',
        'projection': 'TAN (gnomonic), north up, east left, centred on raDeg/decDeg; fovDeg = full image width',
        'atlas': {'files': {'4k': 'textures/galaxies/atlas_4k.jpg', '2k': 'textures/galaxies/atlas_2k.jpg'}, 'grid': ATLAS_GRID},
        'processing': 'sRGB->linear, sky background subtracted (median outside 1.35 a), foreground stars replaced by a '
                      'smoothed local opening (two scales, feathered), elliptical window at 1.12 a (smooth to 1.42 a), normalised to the '
                      '99.8th percentile inside the ellipse, linear->sRGB JPEG',
        'source': 'DSS2 colour HiPS (CDS/P/DSS2/color) via CDS hips2fits',
        'license': 'DSS: free for educational/non-commercial use with acknowledgement (STScI); HiPS/hips2fits: CDS',
        'credit': 'The Digitized Sky Surveys were produced at the Space Telescope Science Institute under U.S. Government '
                  'grant NAG W-2166 (POSS-II: Caltech/Palomar; UKSTU: AAO/ROE). HiPS and hips2fits by CDS, Strasbourg.',
        'entries': entries,
    }
    with open(os.path.join(OUT, 'impostors.json'), 'w', encoding='utf-8') as f:
        json.dump(doc, f, indent=1)
    print('wrote', len(entries), 'entries')


def slug(name):
    s = ''.join(ch.lower() if ch.isalnum() else '-' for ch in name)
    while '--' in s:
        s = s.replace('--', '-')
    return s.strip('-')


if __name__ == '__main__':
    main()
