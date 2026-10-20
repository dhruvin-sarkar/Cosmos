"""
Face-on Milky Way texture for the galaxies domain's Local Group view (a RECONSTRUCTION, not an image).

Ingredients, all from public/data/galactic/milkyway.json (see docs/data/galactic.md):
  - spiral arms: Reid et al. 2019 (ApJ 885, 131) log-spiral law with kinks, widths and maser-constrained beta ranges;
    arms are extended beyond the constrained range (fainter) - the far side of the Galaxy is inferred/illustrative;
  - exponential thin disc (scale length 2.6 kpc, BHG16), long bar (half-length 5 kpc, 28 deg to the Sun-GC line,
    near end at l > 0), box/peanut bulge;
  - dust lanes on the inner (concave) side of the arms, H II knots along the arms (illustrative texture).
Image frame: column -> galactic +x (Sun -> Galactic Centre), row-from-top -> galactic +y (l = 90 deg) decreasing,
i.e. pixel (i, j) has X = (2 (i + .5) / W - 1) * HALF, Y = (1 - 2 (j + .5) / H) * HALF, GC at the centre (Reid frame:
X = -R cos(beta), Y = R sin(beta), Sun at (-R0, 0)). HALF = 20 kpc.

Run: python scripts/data/galaxies/build-milkyway-faceon.py
"""
import json, math, os
import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
OUT = os.path.join(ROOT, 'public', 'textures', 'galaxies')
N = 2048
HALF = 20.0
rng = np.random.default_rng(20261019)

with open(os.path.join(ROOT, 'public', 'data', 'galactic', 'milkyway.json'), encoding='utf-8') as f:
    mw = json.load(f)
arms = [dict(zip(mw['spiralArms']['fields'], r)) for r in mw['spiralArms']['rows']]
R0_REID = 8.15

c = (np.arange(N) + 0.5) / N * 2 - 1
X = c[None, :] * HALF
Y = -c[:, None] * HALF
X = np.broadcast_to(X, (N, N)).copy()
Y = np.broadcast_to(Y, (N, N)).copy()
R = np.hypot(X, Y)
px_kpc = 2 * HALF / N


def arm_curve(a, beta_lo, beta_hi, step=0.25):
    out = []
    psi_in, psi_out = math.radians(a['pitchInsideKinkDeg']), math.radians(a['pitchOutsideKinkDeg'])
    bk = a['betaKinkDeg']
    b = beta_lo
    while b <= beta_hi:
        psi = psi_in if b <= bk else psi_out
        r = a['rKinkKpc'] * math.exp(-math.radians(b - bk) * math.tan(psi))
        br = math.radians(b)
        out.append((-r * math.cos(br), r * math.sin(br), b, r))
        b += step
    return out


def splat(img, pts, width_kpc, weights):
    """Accumulate Gaussian line strokes (sampled densely) into img."""
    acc = np.zeros_like(img)
    for (x, y, *_), w in zip(pts, weights):
        i = int((x / HALF + 1) / 2 * N)
        j = int((1 - y / HALF) / 2 * N)
        if 0 <= i < N and 0 <= j < N:
            acc[j, i] += w
    sig = max(width_kpc / px_kpc, 1.0)
    return img + ndimage.gaussian_filter(acc, sig) * sig * 2.5


arm_light = np.zeros((N, N), np.float32)
dust = np.zeros((N, N), np.float32)
hii = np.zeros((N, N), np.float32)
major = {'Norma', 'Sct-Cen', 'Sgr-Car', 'Perseus', 'Outer'}
for a in arms:
    lo, hi = a['betaMinDeg'], a['betaMaxDeg']
    label = a['reidLabel']
    if label in major:
        ext_lo, ext_hi = lo - 140, hi + 220
    elif label == 'Local':
        ext_lo, ext_hi = lo - 10, hi + 10
    else:
        ext_lo, ext_hi = lo - 5, hi + 25
    pts = [p for p in arm_curve(a, ext_lo, ext_hi) if 2.2 < p[3] < 17.5]
    w = []
    for (_x, _y, b, r) in pts:
        inside = 1.0 if lo <= b <= hi else 0.55
        w.append(inside * math.exp(-max(r - 4, 0) / 5.5) * (0.55 if label == 'Local' else 1.0))
    width = max(a['widthKpc'], 0.2) * 1.6
    arm_light = splat(arm_light, pts, width, w)
    # Dust lane: offset towards the inner (concave) side by ~0.35 width, narrower.
    dpts = [((x * (1 - 0.35 * width / max(r, 1))), (y * (1 - 0.35 * width / max(r, 1))), b, r) for (x, y, b, r) in pts]
    dust = splat(dust, dpts, width * 0.45, [wi * 0.9 for wi in w])
    # H II knots: random seeds along the arm.
    for (x, y, b, r), wi in zip(pts, w):
        if rng.random() < 0.18 * wi:
            jx, jy = rng.normal(0, width * 0.6, 2)
            i = int(((x + jx) / HALF + 1) / 2 * N)
            j = int((1 - (y + jy) / HALF) / 2 * N)
            if 0 <= i < N and 0 <= j < N:
                hii[j, i] += rng.uniform(0.4, 1.6)
    # Far side: the inferred symmetric partner (rotated by 180 deg) for the two major symmetric arms.
    if label in ('Sct-Cen', 'Perseus'):
        pass  # the extended curves already wrap round the far side

hii = ndimage.gaussian_filter(hii, 1.3) * 9

# Smooth components.
disc = np.exp(-R / 2.6) * (R < 16) + np.exp(-R / 2.6) * (R >= 16) * np.exp(-(R - 16) / 1.2)
bar_ang = math.radians(28)  # bar major axis 28 deg from the Sun-GC line, near end at l > 0 (Y > 0 on the Sun's side)
# Sun is at X < 0; near end at positive l -> point (X < 0, Y > 0) side
ux, uy = -math.cos(bar_ang), math.sin(bar_ang)
bu = X * ux + Y * uy
bv = -X * uy + Y * ux
bar = np.exp(-((np.abs(bu) / 4.2) ** 3) - (bv / 1.1) ** 2)
bulge = np.exp(-(R / 0.65) ** 1.2)

field = rng.random((N, N)).astype(np.float32)
grain = ndimage.gaussian_filter(field, 1.0)
grain = (grain - grain.mean()) / (grain.std() + 1e-6)
clump = ndimage.gaussian_filter(rng.random((N, N)).astype(np.float32), 6)
clump = (clump - clump.mean()) / (clump.std() + 1e-6)

arm_n = arm_light / (np.percentile(arm_light, 99.7) + 1e-9)
dust_n = dust / (np.percentile(dust, 99.7) + 1e-9)

old = 0.32 * disc + 1.2 * bar + 2.2 * bulge
young = arm_n * (0.75 + 0.25 * clump) * np.exp(-np.clip(3.0 - R, 0, None) / 1.0)
col_old = np.array([1.0, 0.82, 0.62], np.float32)
col_young = np.array([0.62, 0.74, 1.0], np.float32)
col_hii = np.array([1.0, 0.35, 0.55], np.float32)
img = old[..., None] * col_old + 1.35 * young[..., None] * col_young + np.clip(hii, 0, 3)[..., None] * col_hii * 1.1
img *= (1 + 0.08 * grain)[..., None]
ext = np.exp(-2.2 * np.clip(dust_n * (0.7 + 0.3 * clump), 0, 1.5) * (R > 1.2))
img *= ext[..., None]
edge = np.clip((19.0 - R) / 2.5, 0, 1)
img *= edge[..., None]
img /= np.percentile(img, 99.9) / 0.95
s = np.clip(img, 0, 1)
s = np.where(s <= 0.0031308, s * 12.92, 1.055 * np.power(s, 1 / 2.4) - 0.055)
Image.fromarray((s * 255 + 0.5).astype(np.uint8), 'RGB').save(os.path.join(OUT, 'milkyway_faceon_2k.jpg'), quality=92, optimize=True)
print('ok')
