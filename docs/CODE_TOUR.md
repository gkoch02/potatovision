# A tour of the code

For anyone opening this repo for the first time. The README says what PotatoVision does and how to run it, and CLAUDE.md describes the architecture in detail, stage by stage; this page is the gentler way in. Read it once, top to bottom, and you'll know which file does what, how one webcam frame becomes a potato, and how to try a change.

You don't need to know JavaScript well to follow it. Where code is quoted, the sentence around it says what it does.

## The big picture

PotatoVision is a single web page with no server, no build step and no libraries. Four files do everything:

| File | What it is |
|---|---|
| `index.html` | The page: the hidden video element, two canvases (one shown at a time), the slider, the buttons |
| `styles.css` | The retro CRT look |
| `potatovision.js` | All the behaviour: the camera, the effects, emoji mode, snapshots |
| `tests.html` | A test page you open in a browser; not part of the app |

The browser does the heavy lifting. The camera's picture arrives in a `<video>` element that's never shown; about sixty times a second the script copies it onto a `<canvas>` (a picture the script can draw on), damaging it on the way according to the slider.

## Words this code uses

| Word | Means |
|---|---|
| **potato level** | The slider, 0 to 100. In the code it's `level`, kept as 0 to 1, and called `p` inside the drawing code |
| **preset** | A button that sets the slider to a fixed value (*Pristine* 0, *Actual Potato* 100…). Each is a `data-preset` attribute in `index.html` |
| **canvas**, **context** (`ctx`) | A picture element and the object you draw on it with. The app has four canvases; CLAUDE.md's table says which is which |
| **offscreen canvas** | A canvas made in code and never put on the page, used as a scratch pad (`effectsCanvas`, `emojiSampleCanvas`) |
| **stage** | One effect in the chain: pixelate, quantize, ghost, scanlines, vignette, green tint, stutter |
| **helper** | A small function near the top of `potatovision.js` that does one stage's arithmetic, e.g. `pixelTarget` or `quantizationStep`. It returns `null` when the level is too low for that stage to start |
| **quantization** | Cutting the number of shades per colour, from 256 down to as few as 2 |
| **chromatic ghosting** | Faint offset copies of the picture in red and blue, like a badly aligned old camera |
| **stutter** | At high levels, sometimes skipping a frame on purpose so the picture freezes, like a starved video call |
| **`requestAnimationFrame`** | The browser's "call me before you next draw the screen", about sixty times a second. Each call draws one frame |
| **`getUserMedia`** | The browser's way of asking for the camera |
| **emoji mode** | Drawing the camera as a 32 × 24 grid of 🥔🍟🟧🟫⬛, chosen by how bright each patch is |
| **tile** | One emoji drawn once into a small picture and reused, so every emoji is exactly the same size |
| **`window.PV`** | The helpers, made reachable from outside so `tests.html` can test the very same arithmetic the app uses |

## Following one frame

Say the camera is on and the slider is at 90 (*Found Footage*). Here's what happens, all in `potatovision.js`. To find a function, search for `function` and its name, e.g. `function render`.

**1. Starting.** Clicking **Start camera** calls `startCamera`. It asks for the camera with `getUserMedia`, plugs the stream into the hidden `<video>`, sets `running`, and starts the loop with `requestAnimationFrame(render)`.

**2. The slider.** Moving it calls `setLevel`, which stores `level = 0.9`. The loop reads it each frame, so the change shows at once.

**3. A frame.** `render` is called. It returns at once if the camera has stopped, and hands over to `renderEmoji` in emoji mode. Then:

```js
if (Math.random() < stutterChance(p)) {
  requestAnimationFrame(render);
  return;
}
```

In words: now and then, ask to be called again next time and skip this frame, so the last picture stays on screen. `stutterChance` is 0 up to 85 on the slider; at 90 it skips nearly one frame in five.

**4. Pixelate.** `pixelTarget(p, W, H)` says how small to make the picture (at 90, 114 pixels across instead of 480). The video is drawn into `effectsCanvas` at that size.

**5. Fewer colours.** `quantizationStep(p)` says how coarse the colours get; the code walks every pixel of the tiny picture and rounds its red, green and blue to that step. Doing this on the tiny picture is what keeps it fast.

**6. Back to full size.** The tiny picture is drawn onto the visible 480 × 360 canvas with smoothing turned off, so each pixel becomes a hard-edged block.

**7. The rest of the damage**, each only when its helper says the level is high enough: ghosting (`chromaticParams`: two offset copies blended in), scanlines (`scanlineAlpha`, from a striped picture built once at start, `buildScanlines`), the dark corners (`vignetteAlpha`, `buildVignette`), and the sick green cast (`greenTint`, above 70 on the slider).

**8. Again.** `render` asks to be called for the next frame. The CSS rule `image-rendering: pixelated` stretches the 480 × 360 canvas to the window without blurring the blocks.

**Snap** (`snap`) copies the canvas on show, squeezes it through a low-quality JPEG (`jpegQuality`) unless the level is under 5, stamps `● REC` and the date on it (`stampCanvas`), and downloads it (`downloadCanvas`).

**Switching tabs** fires the `visibilitychange` listener at the bottom of the file, which stops the camera, so it's never on in the background. That's the privacy promise in the README and the page footer.

## What you can skip

- **`styles.css`**, apart from the two rules CLAUDE.md calls load-bearing.
- **The emoji code** (`buildEmojiTiles`, `renderEmoji`, `emojiBucket`) unless you're working on emoji mode.
- **`title.svg`**, **`preview-strip.png`**: the README's pictures.

## Finding things

From the repo folder:

```bash
grep -n "function " potatovision.js          # every function
grep -n "greenTint" potatovision.js tests.html   # where it's defined, used and tested
grep -n 'id="' index.html                    # every element the script can look up
```

`-n` shows line numbers. In VS Code, Cmd-clicking a function name jumps to where it's defined.

## Reading a crash

Errors show in the browser's developer console: View → Developer → JavaScript Console in Chrome, Develop → Show JavaScript Console in Safari, or Cmd-Option-J / Cmd-Option-C. An error looks like this (invented):

```
Uncaught TypeError: Cannot read properties of null (reading 'addEventListener')
    at potatovision.js:422:9
```

The first line is what went wrong; the `at` lines below say where (file, line, column), newest first. Clicking the file name opens it at that line.

| Error | Usually means |
|---|---|
| `Cannot read properties of null` | The script looked up an element by id and `index.html` doesn't have it |
| `… is not defined` / `… is not a function` | A misspelled name |
| `NotAllowedError` (camera) | Camera permission was refused; allow it in the browser's site settings |
| `NotFoundError` (camera) | No camera, or another app has it |
| The page works from a file but `tests.html` doesn't | `tests.html` loads the script as a module, which browsers allow only over `http://`: serve the folder |

## Making a change

1. **Find the place**: an effect's strength is in its helper near the top of `potatovision.js`; how it's drawn is in `render`. Say the green tint should start earlier than 70: `greenTint`.
2. **Change one thing.**
3. **Check the syntax**: `node --check potatovision.js` prints nothing if the file is valid JavaScript.
4. **Try it**:

   ```bash
   python3 -m http.server 8000
   ```

   Open <http://localhost:8000>, click **Start camera**, and drag the slider. Reload the page after each edit. Ctrl-C in the terminal stops the server.
5. **Run the tests**: with the server still running, open <http://localhost:8000/tests.html>. The pass and fail counts are at the top; a failure says what it expected. Some tests pin where each stage starts, so moving a threshold fails one on purpose: update the test if you meant it.
6. **Undo** if it's wrong: `git diff` shows what you changed, `git checkout -- <file>` puts the original back.

CLAUDE.md says how to add a new effect so the tests use the same arithmetic as the app, and what not to change (no build step, the canvas setup, the camera lifecycle).

## Where to go next

| To understand | Read |
|---|---|
| What it does, running it, using it as a Zoom camera, privacy | `README.md` |
| Every stage, the four canvases, emoji mode, snapshots, the camera lifecycle | `CLAUDE.md` |
| Canvas drawing in the browser | MDN's [Canvas tutorial](https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial) |
