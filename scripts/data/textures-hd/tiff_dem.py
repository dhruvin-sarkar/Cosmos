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
assert t[259] == 1 and t[258] == (16,) and t[339] == (2,), 'expected uncompressed int16'
endian = '<' if open(sys.argv[1], 'rb').read(2) == b'II' else '>'
endian = '<' if open(sys.argv[1], 'rb').read(2) == b'II' else '>'
a = np.memmap(sys.argv[1], dtype=endian + 'i2', mode='r', offset=off, shape=(H, W))
ow, oh = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (8192, 4096)
xi = (np.arange(ow + 1) * W / ow).astype(int); yi = (np.arange(oh + 1) * H / oh).astype(int)
cnt_x = np.diff(xi).astype(np.float32)
out = np.empty((oh, ow), dtype='<f4')
for r in range(oh):  # row-chunked box filter (source nodata <= -32000 is replaced by the row mean before averaging)
    blk = a[yi[r]:yi[r + 1]].astype(np.float32)
    bad = blk <= -32000
    if bad.any(): blk[bad] = np.nan
    row = np.nanmean(blk, axis=0) if bad.any() else blk.mean(axis=0)
    row = np.nan_to_num(row, nan=0.0)
    out[r] = np.add.reduceat(row, xi[:-1]) / cnt_x
print('range', float(out.min()), float(out.max()))
out.tofile(sys.argv[2])
