# PotatoVision 🥔📷

> Filmed on a potato. By choice.

A tiny, dependency-free web app that turns your webcam feed into the worst
possible video on demand. Drag the **Potato Level** slider from 0 to 100 and
watch your beautiful HD self disintegrate into pixelated, color-quantized,
chromatically-bleeding, scanlined, sickly-green found-footage glory.

Bonus: **🥔 Emoji Mode** renders the feed as a live grid of potato emojis.

## Run it

It's a static page. Two options:

```bash
# Option A — open the file directly
open index.html        # macOS
xdg-open index.html    # Linux

# Option B — serve it (recommended; some browsers prefer http for getUserMedia)
python3 -m http.server 8000
# then visit http://localhost:8000
```

Click **Start camera**, accept the permission prompt, and start ruining your
own face.

## Features

- **Single slider** drives a multi-stage degradation pipeline:
  - resolution drop (down to 28×21 pixels)
  - per-channel color quantization (8 → 1 bits)
  - chromatic ghosting / RGB ghost
  - CRT scanlines
  - radial vignette
  - sickly-green color cast at maximum potato
  - frame stutter — at high levels, frames spontaneously hold to fake bandwidth starvation
- **Presets** — *Pristine*, *Zoom 2020*, *Skype 2008*, *Found Footage*, *Actual Potato*
- **📸 Snap** — downloads the current frame as a `potatovision-<timestamp>.png`,
  re-encoded through a punishing JPEG pass, with a red `● REC` and a date stamp
  for that early-2000s camcorder vibe
- **🥔 Emoji Mode** — replaces the canvas with a live, animated 🥔/🍟/🟧/🟫/⬛ grid

## Privacy

No frames leave your machine. There is no backend. Closing the tab pauses the
camera. So does switching to another tab — and `tests.html` asserts this.
The code is plain JS in `potatovision.js` — read it.

## Browser support

- ✅ Chromium / Chrome / Edge
- ✅ Firefox
- ⚠️ Safari — `getUserMedia` requires HTTPS or `localhost`
- ❌ IE — sorry, the potato is too modern

## Tests

There's no test runner — open `tests.html` in a browser the same way you run
the app. It imports `potatovision.js` against stub DOM elements and runs
~70 assertions covering the per-stage effect math, the snapshot path, and the
camera-paused-when-tab-hidden privacy promise. Pass/fail counts at the top.

## Files

```
potatovision/
├── index.html
├── styles.css
├── potatovision.js
├── tests.html
└── README.md
```

No build step, no `package.json`, no framework. Just the web platform.

## License

MIT
