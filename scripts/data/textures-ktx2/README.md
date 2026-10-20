# GPU-compressed textures (KTX2 / Basis Universal)

`convert.mjs` turns the HD texture tiers the app can load (>= 4096 px) into KTX2 files next to their sources and records
them in `public/textures/ktx2.json`. At runtime `src/core/textures/` loads the KTX2 twin when one exists, transcodes it in
Web Workers (three's KTX2Loader, transcoder served from `public/basis/`, fully offline) to BC7 on desktop GPUs, and falls
back to the JPEG/PNG when there is no twin, the twin is stale, or the GPU cannot transcode.

    node scripts/data/textures-ktx2/convert.mjs --list        # plan: codec per map, '*' = needs (re)conversion
    node scripts/data/textures-ktx2/convert.mjs --jobs 2      # convert new/changed maps (incremental, resumable)
    node scripts/data/textures-ktx2/convert.mjs --only mars --force

Run it after adding or replacing maps (hd.json / index.json). Until then the app keeps using the image (a size mismatch
between the source and the manifest's `srcBytes` is detected at runtime and logged).

Tool: KTX-Software 4.4.2 `ktx create` (Apache-2.0, https://github.com/KhronosGroup/KTX-Software). The Windows installer
is unpacked without installing: `7z x KTX-Software-4.4.2-Windows-x64.exe -odata-raw/big/tools/ktx`. Override with
`KTX_BIN=...`.

Encoding:
- UASTC (quality 1, RDO lambda 1.0 normals / 2.0 data / 3.0 colour, zstd 20) for normal and data maps, every map
  >= 8K, every Earth map, and a body's top colour tier. Near-lossless after BC7 transcoding.
- ETC1S / BasisLZ (qlevel 255) for 4K colour tiers that sit under an 8K tier (distant-body tier, small files).
- Full mip chains (wrap filtering, so the antimeridian has no seam), bottom-left texcoord origin (matches the
  ImageBitmap path's flipped orientation: north up, east-positive), sRGB transfer for colour, linear for data.

Effect (RTX-class desktop GPU, BC7): an 8192x4096 map is ~43 MB of VRAM instead of ~171 MB (RGBA8 + mips), and its
upload is a few ms instead of a 190-290 ms main-thread stall (texImage2D + generateMipmap). Debug: append `?ktx2=0` to a
page URL to disable the compressed path; `window.__cosmosTextures.stats()` reports loads, uploads, VRAM and evictions.
