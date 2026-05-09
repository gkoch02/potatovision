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

There is **no build step, no package manager, no linter**. Editing the files
and reloading the page is the development loop.

```bash
# Serve the directory (recommended — Safari requires HTTPS or localhost for getUserMedia)
python3 -m http.server 8000
# then open http://localhost:8000

# Or just open the file directly (works in Chromium/Firefox over file://)
xdg-open index.html
```

Do **not** introduce a `package.json`, bundler, framework, or transpiler. The
"no dependencies, runs from a static directory" property is a deliberate
constraint — the README and footer make this promise to users.

## Tests

Open `tests.html` in a browser (same way you run the app). It's a
zero-dependency, in-page assertion harness — no runner, no `package.json`. The
script imports `potatovision.js`, then exercises three areas:

1. **Pure effect math** via `window.PV` (exposed by `potatovision.js` for
   tests; production code does not read it). Covers `clamp`/`lerp`/`easeIn`,
   `pixelTarget`, `quantizationStep`, `chromaticParams`,
   `scanline`/`vignetteAlpha`, `greenTint`, `stutterChance`, `jpegQuality`,
   `emojiBucket`, plus the per-stage engagement thresholds (regression guard
   against someone bumping `p > 0.25` to `p > 0.5`, etc.).
2. **`index.html` DOM contract** — `fetch`es `index.html` and asserts every ID
   `potatovision.js` queries is present, plus `[data-preset]` buttons. Skips
   under `file://` where `fetch` can't reach the file; run via the http server
   to enable it.
3. **Camera lifecycle and snapshot paths** — stubs `getUserMedia`,
   `video.play`, `requestAnimationFrame`, and the canvas `toDataURL`/`toBlob`
   prototypes; clicks the real `#start` and `#snap` buttons; asserts the
   `visibilitychange` privacy promise (tracks stopped, button reset) and that
   `level < 0.05` skips the JPEG round-trip.

Quick syntax check (no real test runner needed):

```bash
node --check potatovision.js
```

When adding new effects: write the math as a small named function next to the
existing helpers, call it from `render()`/`snap()`, expose it on `window.PV`,
and add assertions to `tests.html`. Don't recreate the math in the test file —
the point is that `render()` and the tests use the same code.

## Architecture

Three files do all the runtime work:

- `index.html` — markup, two visible canvases inside a `.viewport`, the
  slider/buttons. `potatovision.js` is loaded as `<script type="module">`.
- `styles.css` — retro-CRT theme. Two load-bearing rules:
  - `image-rendering: pixelated` on `#canvas, #emojiCanvas` preserves the
    chunky look when the 480×360 internal canvas is CSS-scaled up.
  - `#canvas:not([hidden]), #emojiCanvas:not([hidden])` is the *only* thing
    that makes them visible — the two canvases are swapped (not stacked) by
    flipping the `hidden` attribute in `toggleEmojiMode`. Don't switch to
    `display:none` / class-based hiding without updating this selector.
- `potatovision.js` — everything else.

`tests.html` is a fourth file used only for testing — it imports
`potatovision.js` against stub DOM elements and runs assertions in-page. It is
not loaded by `index.html` and adds zero runtime cost.

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
threshold on `p` (the normalized potato level, 0..1). The threshold + curve
math for each stage lives in a small pure helper near the top of the file
(`pixelTarget`, `quantizationStep`, `chromaticParams`, `scanlineAlpha`,
`vignetteAlpha`, `greenTint`, `stutterChance`); `render()` calls them. This
indirection exists so `tests.html` can assert against the same math `render()`
uses — don't inline the formulas back into the loop.

1. Pixelate → `effectsCanvas` at `pixelTarget(p, W, H).w` width
2. Color quantization (in-place ImageData on the small canvas; cheap there, expensive at full size — keep it small)
3. Scale up to `ctx` with `imageSmoothingEnabled = false`
4. Chromatic ghosting via two offset `screen`-blended copies
5. Scanlines (alpha-blended)
6. Vignette (alpha-blended)
7. Green tint via `multiply` blend

Frame stutter is implemented as an early `return` (skipping the redraw so the
canvas keeps last frame's contents) at high `p`, gated by `stutterChance(p)`.

When adding a new effect, follow the same pattern: write a pure helper that
returns parameters or `null` (or `0` for probabilities) below its engagement
threshold, gate the stage on its return value in `render()`, expose it on
`window.PV`, and add assertions in `tests.html`.

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
- Otherwise: `toDataURL('image/jpeg', jpegQuality(level))`, decode via `<img>`, redraw, stamp, download.

The two helpers `stampCanvas` and `downloadCanvas` exist to share between those
branches. Both branches are covered in `tests.html` (the `<` boundary at 0.05
is asserted explicitly).

### Camera lifecycle

Camera starts on a click (browser autoplay/permission policy requires user
gesture). On `visibilitychange` to hidden, all tracks are stopped and `stream`
is nulled — coming back to the tab requires another click. This is
intentional: the README and footer promise the camera turns off when the tab
is backgrounded. `tests.html` exercises this path with a stubbed
`getUserMedia` and asserts `track.stop()` was called and the start button
reset; if you change the lifecycle, update those assertions too.

If you add network or analytics, update the privacy copy in `README.md` and
`index.html` (footer line "No frames leave your machine. Promise."). The
honesty of that line is part of the product.

## Git

`main` is the long-lived branch. Feature work happens on `claude/...` task
branches; pushes go to whatever branch the current task specifies, not to
`main` directly.
