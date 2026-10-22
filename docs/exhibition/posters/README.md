# Cosmos exhibition posters

Three A2 portrait posters for the SCI-FORGE 2026 stand.

| # | Poster | What it does | Print file | Preview |
| --- | --- | --- | --- | --- |
| 1 | **Cosmos** (hero) | A full-bleed render of Earth, the golden journey from Earth to the cosmic microwave background on one powers-of-ten ladder with real distances, and one line of invitation | `pdf/cosmos-poster-1-hero-A2.pdf` | `preview/cosmos-poster-1-hero.png` |
| 2 | **How do we know?** | The provenance marks, the real catalogues behind what you see (with counts), and how the hard parts work: black-hole lensing, planet interiors, star colours and the CMB | `pdf/cosmos-poster-2-how-do-we-know-A2.pdf` | `preview/cosmos-poster-2-how-do-we-know.png` |
| 3 | **Explore it** | Visitor guide: six things to try, touch, mouse and keyboard controls, the four labs, a QR code to the live site and credits | `pdf/cosmos-poster-3-explore-it-A2.pdf` | `preview/cosmos-poster-3-explore-it.png` |

Every image on the posters is a real-time render or screenshot from the running app (Ultra quality, interface hidden for the renders). The facts and counts come from `docs/EXHIBITION.md`, `docs/SCIENCE.md`, `docs/USER_GUIDE.md`, `docs/data/*.md` and the tour narration in `src/content/tours/`.

## Printing

Each poster comes in two PDFs. Both are one page, vector text with embedded fonts, images at full resolution.

- **`*-A2.pdf`**: exactly A2, 420 × 594 mm, no bleed. Use this for an office or plotter print, or when the printer asks for the trim size. The black background runs to the edge; a printer that cannot print to the edge leaves a thin white border, which is fine.
- **`*-A2-bleed.pdf`**: 426 × 600 mm, with 3 mm bleed on every side. Use this at a print shop: tell them "A2, 3 mm bleed, trim 3 mm on each side". No crop marks are drawn, so ask the shop to add theirs if they need them.

Settings to ask for:

- **Size:** A2 portrait (420 × 594 mm). Print at **100 % / actual size**, never "fit to page".
- **Paper:** matte or satin photo paper, or 170–200 g/m² silk. Matte keeps reflections off the black backgrounds under hall lighting. Avoid plain uncoated paper: the black turns grey.
- **Colour:** the files are sRGB. Ask for a "rich black" or photo print, not a single-ink black. The poster backgrounds are true black (#000).
- **Resolution:** the full-bleed Earth render on poster 1 is a 2,480 × 3,508 px capture (about 125 dpi at A2), the screenshots on posters 2 and 3 are 3,840 × 2,160 px (4K, or 1920 × 1080 at 2× for the interface shots). That is sharp at normal viewing distance (1 m and more).
- **Mounting:** foam board (5 mm) or a poster hanger. Leave the 20 mm safe margin clear of clips: nothing important is printed there.

Check before printing: open the PDF at 100 % and look at the poster 3 QR code; scan it with a phone. It must open the live site.

## The QR code and the site address

The QR code (poster 3) and the address in every footer come from `.work/site-url.txt`, the live site's URL (today `https://cosmos-astronexus.vercel.app`, the Vercel project's current address). When the address changes, update that file and rebuild: the build regenerates `assets/qr-site.svg` and `site.js`. The QR code is dark on a white plate, error correction level M, with a 4-module quiet zone; it was decoded from the rendered poster to check it (it reads `https://cosmos-astronexus.vercel.app`).

## Rebuilding

```bash
node docs/exhibition/posters/build.mjs            # prep images, then render all three
node docs/exhibition/posters/build.mjs render     # render only (uses the images already in assets/img)
node docs/exhibition/posters/build.mjs render --only hero   # one poster: hero | how | explore
```

The build uses Playwright with the installed Chrome. It works offline (the fonts are bundled in `assets/fonts/`), except for regenerating the QR code, which runs `npx qrcode` and keeps the existing SVG if that fails.

- `prep` converts the print captures in `G:/CosmosWork/posters/raw2/` (PNG, made from the running app by `G:/CosmosWork/posters/capture2.mjs`) into the JPEGs in `assets/img/` (quality 90, 4:4:4) and cuts the round thumbnails for the journey ladder. Existing files are kept unless you pass `--force`. The captures are not in the repository; the JPEGs are.
- `render` prints each HTML poster to the two PDFs and a PNG preview (at most 2 MB). Chromium rounds the page size to whole pixels, so the build patches each PDF's MediaBox back to exact A2 (420 × 594 mm) and A2 + bleed (426 × 600 mm).

To edit a poster, open its HTML in Chrome (add `?guides=1` to the address to see the trim line in magenta and the safe area in cyan), change it, and rebuild.

## Files

- `poster-1-hero.html`, `poster-2-how.html`, `poster-3-explore.html`: the posters, built at physical size in millimetres (sheet 426 × 600 mm including bleed; safe margin 20 mm inside the trim).
- `poster.css`: the shared print system: the app's type voices (Bodoni Moda for names and titles, Mona Sans for text, JetBrains Mono for figures), true black, hairlines and the one brass accent, as in `docs/design/UI_SYSTEM.md`, plus the provenance marks used in the inspector.
- `site.js`: the live-site address (written by the build).
- `assets/img/`: the renders and screenshots; `assets/fonts/`: the font files (SIL Open Font License, licences included); `assets/qr-site.svg`: the QR code.
- `pdf/`, `preview/`: the outputs.

## Design notes

- **Poster 1.** The ladder is one log axis: distance from Earth in metres, from 10⁵ m (100 km, the edge of space) to about 4 × 10²⁶ m (the cosmic microwave background, 45 billion light-years away now). Each stop sits at its true distance on that axis; labels are pushed apart when stops are close (Sagittarius A* and the Milky Way, for example) and joined to their stop by a leader line. The empty stretch between Neptune and Proxima Centauri is real. The poster says that planets are drawn larger than life in the app.
- **Poster 2.** The catalogue chart is a single series on a log scale, so every bar is labelled with its count and there is no legend. The star-colour strip is computed: a Planck spectrum at each temperature, integrated against the CIE 1931 colour-matching functions (the Wyman, Sloan and Shirley 2013 fit) and converted to sRGB. TRAPPIST-1 (2,566 K, Agol et al. 2021) and the Sun (5,772 K, IAU 2015) are marked.
- **Poster 3.** The controls are the app's own (`docs/USER_GUIDE.md`). The four labs and their numbers match `docs/EXHIBITION.md`.
