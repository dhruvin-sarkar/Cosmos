# Cosmos · SCI-FORGE 2026 presentation

15 slides, 16:9 (1920 × 1080), about 970 words of speaker notes (a calm 6–7 minute talk). Every number comes from the repo; the
sources are listed in [`facts.md`](facts.md).

| File | What it is |
| --- | --- |
| `deck/index.html` | The live deck. Fully offline: fonts, images and the QR code are all local, with no network requests. |
| `export/Cosmos-SCI-FORGE-2026.pdf` | 15-page PDF, one slide per page (backup / handout). |
| `export/Cosmos-SCI-FORGE-2026.pptx` | PowerPoint: one full-bleed slide image per slide, with the speaker notes in the notes pane. |
| `export/slides/01.png … 15.png` | Slide images, 1920 × 1080. |
| `notes.md` | Speaker notes for every slide (generated from the deck). |
| `facts.md` | The numbers on the slides and where each one comes from. |

## Presenting offline

1. Copy the whole `docs/exhibition/presentation/` folder onto the exhibition laptop (or a USB stick).
2. Open `deck/index.html` in Chrome or Edge (double-click it; no server is needed).
3. Press **F** for full screen.

| Key | Action |
| --- | --- |
| → ↓ Space Enter PageDown, or click the right ¾ of the screen | Next slide |
| ← ↑ Backspace PageUp, or click the left ¼ | Previous slide |
| Home / End | First / last slide |
| **P** | Presenter view: current slide, next slide, notes and a timer |
| **W** | Open an audience window (put it on the projector); it follows the presenter window |
| **F** | Full screen |
| **R** | Reset the presenter timer |

A slide can be linked directly: `deck/index.html#8` opens slide 8.

**Two screens:** open the deck on the laptop, press **W** and drag the new window to the projector, press **F** in it, then press **P** in
the laptop window to see your notes. Navigate from the laptop window.

**Fallbacks:** if the browser misbehaves, open the PDF full screen, or the PPTX in PowerPoint / LibreOffice Impress / Google Slides
(Presenter View shows the notes). The PPTX slides are images, so edit text in the HTML deck and rebuild.

## Rebuilding (from the repo root)

The build tools need Playwright (already a repo dev dependency) and Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe`.
`qrcode` and `pptxgenjs` are installed outside the repo in `.work/deck-tools` (`npm i qrcode pptxgenjs` there if it is missing).

```sh
node docs/exhibition/presentation/build/images.mjs   # screenshots -> deck/img (1920-wide JPEGs)
node docs/exhibition/presentation/build/qr.mjs       # QR code + printed URL from .work/site-url.txt (or pass a URL)
node docs/exhibition/presentation/build/render.mjs   # export/slides/*.png, notes.md, export/notes.json, the PDF
node docs/exhibition/presentation/build/pptx.mjs     # export/*.pptx from the PNGs and notes
```

`render.mjs --only 3,4 --no-pdf` re-renders just those slides. Edit content and notes in `deck/index.html` (each slide's
`<aside class="notes">`), never in `notes.md`.

**If the live-site URL changes** (the rename to a new Vercel domain), write it to `.work/site-url.txt` and run `qr.mjs`, `render.mjs`
and `pptx.mjs` again: the QR code, the footer URL and the closing slide all update.
