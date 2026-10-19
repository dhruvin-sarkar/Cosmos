# usage: python tiff_dem.py in.tif out.f32 [outW outH]
# Reads the USGS uncompressed single-strip-per-row int16 GeoTIFF (offset of first strip taken from tag 273) and writes an
# area-averaged float32 grid (rows north->south, columns from the file's left edge). PIL mis-decodes this file ("I" mode).
import sys, numpy as np
from PIL import Image
Image.MAX_IMAGE_PIXELS = None
im = Image.open(sys.argv[1])
W, H = im.size
t = im.tag_v2
off = t[273][0]
assert t[259] == 1 and (t[258], t[339]) in (((16,), (2,)), ((32,), (3,))), 'expected uncompressed int16 or float32'
dt = 'i2' if t[258] == (16,) else 'f4'
endian = '<' if open(sys.argv[1], 'rb').read(2) == b'II' else '>'
endian = '<' if open(sys.argv[1], 'rb').read(2) == b'II' else '>'
a = np.memmap(sys.argv[1], dtype=endian + dt, mode='r', offset=off, shape=(H, W))
ow, oh = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (8192, 4096)
nodata = float(sys.argv[5]) if len(sys.argv) > 5 else None  # extra nodata value (Pluto/Charon DEMs use exact 0 outside the observed area)
xi = (np.arange(ow + 1) * W / ow).astype(int); yi = (np.arange(oh + 1) * H / oh).astype(int)
cnt_x = np.diff(xi).astype(np.float32)
out = np.empty((oh, ow), dtype='<f4')
valid = np.empty((oh, ow), dtype=np.uint8)
for r in range(oh):  # row-chunked box filter over VALID source pixels only; valid = more than half of the box observed
    blk = a[yi[r]:yi[r + 1]].astype(np.float32)
    bad = (blk <= -32000) | ~np.isfinite(blk)
    if nodata is not None: bad |= (blk == nodata)
    good = ~bad
    sv = np.where(good, blk, 0).sum(axis=0)
    cn = good.sum(axis=0).astype(np.float32)
    sv_x = np.add.reduceat(sv, xi[:-1]); cn_x = np.add.reduceat(cn, xi[:-1])
    out[r] = np.where(cn_x > 0, sv_x / np.maximum(cn_x, 1), 0)
    valid[r] = (cn_x > 0.5 * cnt_x * (yi[r + 1] - yi[r])).astype(np.uint8)
print('range', float(out.min()), float(out.max()), 'valid fraction', float(valid.mean()))
out.tofile(sys.argv[2])
valid.tofile(sys.argv[2] + '.valid')
