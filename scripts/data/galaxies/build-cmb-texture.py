"""
CMB temperature texture for the last-scattering sphere (src/domains/cosmology).
Input: public/data/sky/cmb/cmb_smica_4k_u16.png (Planck PR3 SMICA via CDS hips2fits, ICRS CAR, dT_uK = (grey-32768)/32;
see public/data/sky/bands.json 'cmb'). Output: 8-bit grey, linear in dT over [-500, +500] uK (3.92 uK per level):
public/textures/galaxies/cmb_dT_4k.jpg and cmb_dT_1k.jpg. The shader applies the colour map and the readout scale.
Credit: ESA and the Planck Collaboration (Planck Legacy Archive, CC BY-NC 3.0 IGO for archive products); HiPS by CDS.
"""
import os
import numpy as np
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
src = Image.open(os.path.join(ROOT, 'public', 'data', 'sky', 'cmb', 'cmb_smica_4k_u16.png'))
a = np.asarray(src).astype(np.float64)
if a.ndim == 3:
    a = a[..., 0]
dT = (a - 32768.0) * 0.03125
print('dT range', dT.min(), dT.max(), 'rms', dT.std())
g = np.clip((dT + 500.0) / 1000.0, 0, 1) * 255.0 + 0.5
img = Image.fromarray(g.astype(np.uint8), 'L')
out = os.path.join(ROOT, 'public', 'textures', 'galaxies')
img.save(os.path.join(out, 'cmb_dT_4k.jpg'), quality=96)
img.resize((1024, 512), Image.LANCZOS).save(os.path.join(out, 'cmb_dT_1k.jpg'), quality=95)
print('ok')
