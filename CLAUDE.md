# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

PotatoVision is a single-page browser app that runs the user's webcam through a
chain of "potato quality" effects (pixelation, color quantization, chromatic
ghosting, scanlines, vignette, frame stutter, sickly-green tint), all driven by
one **Potato Level** slider (0–100). It also has a 🥔 Emoji Mode that renders
the feed as a grid of emojis, and a 📸 Snap button that downloads the current
frame as a (deliberately-crunched) PNG.

## Run / develop

There is **no build step, no package manager, no test runner, no linter**.
Editing the files and reloading the page is the development loop.

```bash
# Serve the directory (recommended — Safari requires HTTPS or localhost for getUserMedia)
python3 -m http.server 8000
# then open http://localhost:8000

# Or just open the file directly (works in Chromium/Firefox over file://)
xdg-open index.html
```

JS sanity check (no real test suite exists):

```bash
node --check potatovision.js
```

Do **not** introduce a `package.json`, bundler, framework, or transpiler. The
"no dependencies, runs from a static directory" property is a deliberate
constraint — the README and footer make this promise to users.

## Architecture

Three files do all the work:

- `index.html` — markup, two canvases stacked in a `.viewport`, the slider/buttons.
- `styles.css` — retro-CRT theme. The `image-rendering: pixelated` rule on
  `#canvas, #emojiCanvas` is load-bearing: it preserves the chunky look when
  the 480×360 internal canvas is CSS-scaled up to the viewport.
- `potatovision.js` — everything else.

### Canvases (potatovision.js)

The app keeps **four** canvases. Knowing which is which prevents confusion:

| Variable | Purpose | Size |
|---|---|---|
| `canvas` / `ctx` | Visible main feed | 480×360 |
| `emojiCanvas` / `emojiCtx` | Visible emoji-mode feed | 480×360 |
| `effectsCanvas` / `effectsCtx` | Offscreen pixelation source for the main pipeline | resized per frame to `targetW × targetH` |
| `emojiSampleCanvas` / `emojiSampleCtx` | Offscreen luminance grid sampled from the video | 32×24 |

`effectsCanvas` and `emojiSampleCanvas` were split deliberately — they used to
share one offscreen canvas, which was a footgun. Don't merge them back.

`scanlineCanvas` and `vignetteCanvas` are pre-built once at module load.
`emojiTiles` is built lazily on the first emoji-mode frame so system emoji
fonts have a chance to load before we rasterize them into tiles.

### Render loop

`render(now)` runs on `requestAnimationFrame`. Top of the loop branches:

1. If `!running` (camera stopped/tab hidden) → return without rescheduling.
2. If `emojiMode` → call `renderEmoji(now)`, reschedule, return.
3. Otherwise run the main pipeline.

The main pipeline is **strictly ordered** and each stage is gated by a
threshold on `p` (the normalized potato level, 0..1):

1. Pixelate → `effectsCanvas` at `lerp(W, 28, easeIn(p))` width
2. Color quantization (in-place ImageData on the small canvas; cheap there, expensive at full size — keep it small)
3. Scale up to `ctx` with `imageSmoothingEnabled = false`
4. Chromatic ghosting via two offset `screen`-blended copies
5. Scanlines (alpha-blended)
6. Vignette (alpha-blended)
7. Green tint via `multiply` blend

Frame stutter is implemented as an early `return` (skipping the redraw so the
canvas keeps last frame's contents) at high `p`.

When adding a new effect, follow the same pattern: gate it on a `p` threshold,
scale strength via `lerp` (often through `easeIn`), restore `globalAlpha` and
`globalCompositeOperation` after use.

### Emoji mode

`renderEmoji` is throttled to ~11 fps (`now - lastEmojiAt < 90`). It samples
the video into the 32×24 `emojiSampleCanvas`, computes per-cell luminance,
buckets into `EMOJI_PALETTE`, and `drawImage`s the appropriate pre-rendered
tile from `emojiTiles` into each cell of `emojiCanvas`. Tiles are square
(`EMOJI_CELL_W === EMOJI_CELL_H === 15`) which is why the grid is 32×24 (4:3).

The pre-rendered-tile approach exists because emoji glyphs have inconsistent
widths in monospace `<pre>` elements across systems. Don't revert to a
text-grid implementation.

### Snapshot path

`snap()` is independent of the render loop. It copies whichever canvas is
active (`emojiCanvas` if in emoji mode, otherwise `canvas`), and:

- If `level < 0.05`: skip the JPEG pass entirely (Pristine should be pristine), stamp, download.
- Otherwise: `toDataURL('image/jpeg', q)` with `q = lerp(0.92, 0.03, easeIn(level))`, decode via `<img>`, redraw, stamp, download.

The two helpers `stampCanvas` and `downloadCanvas` exist to share between those branches.

### Camera lifecycle

Camera starts on a click (browser autoplay/permission policy requires user
gesture). On `visibilitychange` to hidden, all tracks are stopped and `stream`
is nulled — coming back to the tab requires another click. This is
intentional: the README and footer promise the camera turns off when the tab
is backgrounded.

If you add network or analytics, update the privacy copy in `README.md` and
`index.html` (footer line "No frames leave your machine. Promise."). The
honesty of that line is part of the product.

## Git

Branch: `claude/creative-greenfield-project-nLhf2`. Pushes go to that branch
unless the user says otherwise.
